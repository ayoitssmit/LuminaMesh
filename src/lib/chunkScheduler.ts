import { PeerManager, DataMessage } from "./peerManager";
import { saveChunkToCache, getRecoveredBitfield, updateSessionInfo } from "./indexedDB";

export type SchedulerEvents = {
  onProgress: (chunksHave: number, totalChunks: number) => void;
  onComplete: (assembledChunks: ArrayBuffer[]) => void;
  onChunkVerified: (index: number) => void;
  onChunkFailed: (index: number, peerId: string) => void;
};

export type PeerPerformance = {
  avgLatency: number; // ms
  throughput: number; // KB/s
  activeRequests: number;
  maxRequests: number;
  score: number;
};

/**
 * Chunk Scheduler — the "Tracker" gossip logic.
 *
 * Maintains a local bitfield of owned chunks, tracks remote peers'
 * bitfields, and uses a rarest-first strategy to decide which chunk
 * to request from which peer.
 */
export class ChunkScheduler {
  private peerManager: PeerManager;
  public events: SchedulerEvents;

  // File metadata
  private totalChunks: number;
  private chunkHashes: string[]; // expected SHA-256 per chunk
  private masterHash: string; // File identifier for IndexedDB

  // Local chunk store
  public chunks: (ArrayBuffer | null)[];
  private haveSet: Set<number> = new Set();

  // What each peer has
  private peerBitfields: Map<string, Set<number>> = new Map();

  // Pending requests to avoid duplicates (chunkIndex -> timestamp)
  private pendingRequests: Map<number, number> = new Map();

  // Whether onComplete has already been fired (gossip keeps running for re-seeding)
  private completed = false;

  // Gossip interval handle
  private gossipInterval: ReturnType<typeof setInterval> | null = null;

  // Push-based distribution state (seeder only)
  private pushActive: boolean = false;
  private pushCursors: Map<string, number> = new Map();

  // Performance tracking
  private peerPerformance: Map<string, PeerPerformance> = new Map();
  private requestTimestamps: Map<string, { chunkIndex: number, timestamp: number }[]> = new Map();

  // Async Per-Peer Message Processing Queue
  private peerMessageQueues: Map<string, DataMessage[]> = new Map();
  private peerMessageLoopActive: Map<string, boolean> = new Map();

  // Throttle progress updates to prevent re-render storms
  private progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReportedHave: number = 0;

  // Direct-to-Disk options
  private chunkSize: number;
  private fileHandle?: FileSystemFileHandle;
  private writable?: FileSystemWritableFileStream;

  constructor(
    peerManager: PeerManager,
    events: SchedulerEvents,
    totalChunks: number,
    chunkHashes: string[],
    masterHash: string,
    initialBitfield: Set<number>,
    options?: {
      chunkSize?: number;
      fileHandle?: FileSystemFileHandle;
      writable?: FileSystemWritableFileStream;
    }
  ) {
    this.peerManager = peerManager;
    this.chunkSize = options?.chunkSize || 64 * 1024;
    this.fileHandle = options?.fileHandle;
    this.writable = options?.writable;
    this.events = events;
    this.totalChunks = totalChunks;
    this.chunkHashes = chunkHashes;
    this.masterHash = masterHash;
    this.chunks = new Array(totalChunks).fill(null);

    // Initialize with recovered state from IndexedDB
    this.haveSet = new Set(initialBitfield);
    
    // Automatically fire progress to Sync UI smoothly for resumable downloads
    if (this.haveSet.size > 0) {
      setTimeout(() => {
        this.events.onProgress(this.haveSet.size, this.totalChunks);
        
        // If they refreshed *after* getting all chunks but *before* stitching/purging closed:
        if (this.haveSet.size === this.totalChunks && !this.completed) {
          this.completed = true;
          this.events.onComplete(this.chunks as ArrayBuffer[]);
        }
      }, 0);
    }
  }

  /**
   * Initialize as seeder — we already have all chunks.
   */
  seedAll(allChunks: ArrayBuffer[]): void {
    for (let i = 0; i < allChunks.length; i++) {
      this.chunks[i] = allChunks[i];
      this.haveSet.add(i);
    }
  }

  /**
   * Start the gossip loop — periodically announce our bitfield
   * and request missing chunks from peers.
   */
  start(): void {
    if (this.gossipInterval) return;

    this.gossipInterval = setInterval(() => {
      this.broadcastBitfield();
      this.requestNextChunks();
    }, 150); // 150ms — exceptionally fast polling for high-throughput stream resumption
  }

  stop(): void {
    if (this.gossipInterval) {
      clearInterval(this.gossipInterval);
      this.gossipInterval = null;
    }
    this.stopPushing();
  }

  /**
   * Start push-based distribution (seeder only).
   * Proactively sends chunks to peers, respecting backpressure.
   */
  startPushing(): void {
    if (this.pushActive) return;
    this.pushActive = true;
    this.runPushLoop();
  }

  stopPushing(): void {
    this.pushActive = false;
  }

  private async runPushLoop(): Promise<void> {
    if (!this.pushActive) return;
    await this.pushNextChunks();
    if (this.pushActive) {
      setTimeout(() => this.runPushLoop(), 50);
    }
  }

  /**
   * Push unique chunks to each peer with proper backpressure.
   * Each peer's cursor starts at an evenly-spaced offset so they get
   * different regions of the file, maximizing cross-sharing later.
   */
  private async pushNextChunks(): Promise<void> {
    const peers = this.peerManager.getConnectedPeers();
    if (peers.length === 0) return;

    await Promise.all(peers.map(async (pid) => {
      const peerBf = this.peerBitfields.get(pid) || new Set();

      if (!this.pushCursors.has(pid)) {
        const peerRank = this.pushCursors.size;
        const offset = Math.floor((peerRank / Math.max(peers.length, 1)) * this.totalChunks);
        this.pushCursors.set(pid, offset);
      }

      let cursor = this.pushCursors.get(pid)!;
      let sent = 0;
      let checked = 0;

      // Push up to 20 chunks per peer per cycle, awaiting backpressure each time
      while (sent < 20 && checked < this.totalChunks) {
        const idx = cursor % this.totalChunks;
        if (!peerBf.has(idx) && this.haveSet.has(idx)) {
          await this.handleChunkRequest(pid, idx);
          sent++;
        }
        cursor++;
        checked++;
      }

      this.pushCursors.set(pid, cursor % this.totalChunks);
    }));
  }

  /**
   * Handle incoming data messages from PeerManager.
   * Placed into a per-peer async queue to prevent WebRTC backpressure limits from causing OOM.
   */
  async handleMessage(peerId: string, message: DataMessage): Promise<void> {
    if (!this.peerMessageQueues.has(peerId)) {
      this.peerMessageQueues.set(peerId, []);
    }
    this.peerMessageQueues.get(peerId)!.push(message);

    if (!this.peerMessageLoopActive.get(peerId)) {
      this.processPeerMessages(peerId).catch(console.error);
    }
  }

  /**
   * Sequentially process messages for a specific peer to respect DataChannel backpressure
   */
  private async processPeerMessages(peerId: string): Promise<void> {
    this.peerMessageLoopActive.set(peerId, true);
    const queue = this.peerMessageQueues.get(peerId);

    while (queue && queue.length > 0) {
      const message = queue.shift()!;
      
      switch (message.type) {
        case "bitfield":
          if (message.bitfield) {
            this.peerBitfields.set(peerId, new Set(message.bitfield));
          }
          break;

        case "chunk-available":
          if (message.chunkIndex !== undefined) {
            const peerSet = this.peerBitfields.get(peerId) || new Set();
            peerSet.add(message.chunkIndex);
            this.peerBitfields.set(peerId, peerSet);
          }
          break;

        case "chunk-request":
          if (message.chunkIndex !== undefined) {
            // Decoupled: Handle requests asynchronously so they don't block
            // the incoming message queue while waiting for send buffer space.
            this.handleChunkRequest(peerId, message.chunkIndex).catch(console.error);
          }
          break;

        case "chunk-response":
          if (message.chunkIndex !== undefined && message.data) {
            await this.handleChunkResponse(
              peerId,
              message.chunkIndex,
              new Uint8Array(message.data).buffer as ArrayBuffer
            );
          }
          break;
      }
    }

    this.peerMessageLoopActive.set(peerId, false);
  }

  /**
   * Respond to a chunk request from a peer.
   */
  private async handleChunkRequest(peerId: string, chunkIndex: number): Promise<void> {
    // 1. SMART THROTTLING (Backpressure)
    // Pause execution if this peer's send buffer is >16MB. Wait for 'onbufferedamountlow'.
    await this.peerManager.waitForBufferSpace(peerId);

    const chunk = this.chunks[chunkIndex];
    if (chunk) {
      this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(chunk));
      return;
    }

    // Direct-to-Disk seeding: read from FileSystem
    if (this.fileHandle && this.haveSet.has(chunkIndex)) {
      try {
        const file = await this.fileHandle.getFile();
        const start = chunkIndex * this.chunkSize;
        const end = Math.min(start + this.chunkSize, file.size);
        const slice = file.slice(start, end);
        const buffer = await slice.arrayBuffer();
        this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(buffer));
        return;
      } catch (err) {
        console.error("Failed to read chunk from disk for seeding", err);
      }
    }

    // IndexedDB seeding: if not in memory or FS, retrieve from Cache
    import("./indexedDB").then(async ({ getCachedChunk }) => {
       const cachedChunk = await getCachedChunk(this.masterHash, chunkIndex);
       if (cachedChunk) {
         this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(cachedChunk));
       }
    }).catch(console.error);
  }

  /**
   * Receive a chunk, verify its SHA-256 hash, store or reject.
   */
  private async handleChunkResponse(
    peerId: string,
    chunkIndex: number,
    data: ArrayBuffer
  ): Promise<void> {
    this.pendingRequests.delete(chunkIndex);

    // Stop the stopwatch and update performance
    this.updatePeerPerformance(peerId, chunkIndex);

    // Already have this chunk
    if (this.haveSet.has(chunkIndex)) return;

    // Verify hash (skip if no hash available)
    const expectedHash = this.chunkHashes[chunkIndex];
    if (expectedHash && expectedHash.length > 0) {
      const hash = await this.sha256(data);
      if (hash !== expectedHash) {
        this.events.onChunkFailed(chunkIndex, peerId);
        return;
      }
    }

    // Store verified chunk
    if (this.writable) {
      try {
        await this.writable.write({
          type: "write",
          position: chunkIndex * this.chunkSize,
          data
        });
        // We do NOT store in this.chunks array to save memory
      } catch (err) {
        console.error("Failed to write chunk to disk", err);
        this.events.onChunkFailed(chunkIndex, peerId);
        return;
      }
    } else {
      try {
        // Save to IndexedDB cache
        await saveChunkToCache(this.masterHash, chunkIndex, data);
        
        // Save metadata ping for Garbage Collection
        // Note: In production you might want to debounce this so you aren't doing 
        // a metadata write per 64KB chunk (which is thousands of writes per second),
        // but for safety we will update the session.
        if (chunkIndex % 50 === 0) {
           // We pass a dummy roomId, IndexedDB cares mostly about lastModified timestamp
           updateSessionInfo(this.masterHash, "active-room").catch(console.error); 
        }

      } catch (err) {
        console.error("Failed to write chunk to IndexedDB", err);
        // Do not broadcast that we have this chunk since DB storage failed
        this.events.onChunkFailed(chunkIndex, peerId);
        return;
      }
    }

    // Critical: Only update our bitfield and gossip to the swarm *after* the chunk is reliably saved
    this.haveSet.add(chunkIndex);
    this.events.onChunkVerified(chunkIndex);

    // Throttled progress update: batch UI updates to max ~5/sec instead of per-chunk
    if (!this.progressThrottleTimer) {
      this.progressThrottleTimer = setTimeout(() => {
        this.progressThrottleTimer = null;
        if (this.haveSet.size !== this.lastReportedHave) {
          this.lastReportedHave = this.haveSet.size;
          this.events.onProgress(this.haveSet.size, this.totalChunks);
        }
      }, 200);
    }

    // INSTANT RELAY: Forward this chunk to ALL connected peers who don't
    // have it yet. This is the core of simultaneous inflow/outflow —
    // the moment we receive a chunk, we push it to everyone else.
    // No waiting for gossip cycles or pull requests.
    for (const pid of this.peerManager.getConnectedPeers()) {
      if (pid === peerId) continue; // don't relay back to the sender
      const peerBf = this.peerBitfields.get(pid);
      if (!peerBf || !peerBf.has(chunkIndex)) {
        this.peerManager.sendChunk(pid, chunkIndex, new Uint8Array(data));
      }
    }

    // Check completion — but DON'T stop the gossip loop!
    // Keep broadcasting our bitfield so new peers can request chunks from us.
    if (this.haveSet.size === this.totalChunks && !this.completed) {
      this.completed = true;
      // Flush any pending throttled progress update
      if (this.progressThrottleTimer) {
        clearTimeout(this.progressThrottleTimer);
        this.progressThrottleTimer = null;
      }
      this.events.onProgress(this.haveSet.size, this.totalChunks);
      this.events.onComplete(this.chunks as ArrayBuffer[]);
    }
  }

  /**
   * Stop the stopwatch and calculate throughput and latency.
   */
  private updatePeerPerformance(peerId: string, chunkIndex: number): void {
    const timestamps = this.requestTimestamps.get(peerId);
    if (!timestamps) return;

    const requestIndex = timestamps.findIndex(t => t.chunkIndex === chunkIndex);
    if (requestIndex === -1) return;

    const { timestamp: startTime } = timestamps[requestIndex];
    timestamps.splice(requestIndex, 1); // remove from pending

    const duration = Date.now() - startTime;
    if (duration <= 0) return;

    const latency = duration;
    // (ChunkSize in KB) / (Duration in seconds) = KB/s
    const throughput = (this.chunkSize / 1024) / (duration / 1000);

    const perf = this.peerPerformance.get(peerId) || {
      avgLatency: latency,
      throughput: throughput,
      activeRequests: 0,
      maxRequests: 5,
      score: 50,
    };

    // Rolling average (80% old, 20% new)
    perf.avgLatency = (perf.avgLatency * 0.8) + (latency * 0.2);
    perf.throughput = (perf.throughput * 0.8) + (throughput * 0.2);

    // Dynamic Score = (Throughput * 20) / Latency
    perf.score = (perf.throughput * 20) / Math.max(perf.avgLatency, 1);

    // Map Score to Quota Window (between 1 and 500 requests at a time)
    // 500 requests * 64KB = 32MB streaming window, letting high-speed networks fly
    perf.maxRequests = Math.max(6, Math.min(500, Math.floor(perf.score / 5)));
    if (perf.activeRequests > 0) perf.activeRequests--;

    this.peerPerformance.set(peerId, perf);
  }

  /**
   * Broadcast our full bitfield to all connected peers.
   */
  private broadcastBitfield(): void {
    const bitfield = Array.from(this.haveSet);
    for (const peerId of this.peerManager.getConnectedPeers()) {
      this.peerManager.sendBitfield(peerId, bitfield);
    }
  }

  /**
   * Pick missing chunks and dispatch requests across all peers in parallel.
   *
   * Strategy: build a per-peer queue of chunks they can serve, then
   * round-robin across peers so every peer gets utilized every cycle.
   * Within each peer's queue, rarest chunks come first.
   */
  private requestNextChunks(): void {
    const missing = this.getMissingChunks();
    if (missing.length === 0) return;

    const now = Date.now();
    for (const [idx, timestamp] of this.pendingRequests.entries()) {
      // Timeout: 2.5 seconds. If a request takes this long, it's a "2G stall".
      if (now - timestamp > 2500) { 
        this.pendingRequests.delete(idx);
        
        // Decrement active requests for whoever held this
        for (const [pid, timestamps] of this.requestTimestamps.entries()) {
          const reqIndex = timestamps.findIndex((t) => t.chunkIndex === idx);
          if (reqIndex !== -1) {
             timestamps.splice(reqIndex, 1);
             const perf = this.peerPerformance.get(pid);
             if (perf && perf.activeRequests > 0) perf.activeRequests--;
             break;
          }
        }
      }
    }

    // Build rarity map: for each missing chunk, which connected peers have it?
    const chunkInfo: { index: number; count: number; peers: string[] }[] = [];
    for (const idx of missing) {
      if (this.pendingRequests.has(idx)) continue;
      const peersWithChunk: string[] = [];
      for (const [pid, bitfield] of this.peerBitfields) {
        if (bitfield.has(idx) && this.peerManager.isConnected(pid)) {
          peersWithChunk.push(pid);
        }
      }
      if (peersWithChunk.length > 0) {
        chunkInfo.push({ index: idx, count: peersWithChunk.length, peers: peersWithChunk });
      }
    }

    // Sort by rarity (fewest peers first = most critical to grab)
    chunkInfo.sort((a, b) => a.count - b.count);

    // Shuffle chunks WITHIN each rarity tier so different peers don't
    // all request the same chunks from the sender simultaneously.
    // Without this, peers A, B, C would all request chunks 0,1,2,3...
    // With this, A requests 47,312,8..., B requests 501,23,199...
    // Result: sender distributes DIFFERENT chunks to each peer,
    // and later they cross-share what they each uniquely received.
    let i = 0;
    while (i < chunkInfo.length) {
      let j = i;
      while (j < chunkInfo.length && chunkInfo[j].count === chunkInfo[i].count) j++;
      // Fisher-Yates shuffle of chunkInfo[i..j)
      for (let k = j - 1; k > i; k--) {
        const r = i + Math.floor(Math.random() * (k - i + 1));
        [chunkInfo[k], chunkInfo[r]] = [chunkInfo[r], chunkInfo[k]];
      }
      i = j;
    }

    // Build per-peer queues: each peer gets a list of chunks it can serve,
    // ordered by rarity. A chunk appears in ONLY ONE peer's queue
    // (the least-loaded one), guaranteeing no duplicate requests.
    const peerQueues = new Map<string, number[]>();
    const peerLoad = new Map<string, number>();
    const assigned = new Set<number>();

    for (const entry of chunkInfo) {
      if (assigned.has(entry.index)) continue;

      // Pick the least-loaded peer that has this chunk
      entry.peers.sort(
        (a, b) => (peerLoad.get(a) || 0) - (peerLoad.get(b) || 0)
      );
      const selectedPeer = entry.peers[0];

      if (!peerQueues.has(selectedPeer)) peerQueues.set(selectedPeer, []);
      peerQueues.get(selectedPeer)!.push(entry.index);
      peerLoad.set(selectedPeer, (peerLoad.get(selectedPeer) || 0) + 1);
      assigned.add(entry.index);
    }

    // Round-robin across all peers, but weighted by their dynamic maxRequests!
    // This guarantees truly parallel dispatching across the swarm where fast peers get more chunks.
    const peerIds = Array.from(peerQueues.keys());
    // Sort peerIds by their performance score descending, so we prioritize assigning chunks to fast peers
    peerIds.sort((a, b) => {
      const scoreA = this.peerPerformance.get(a)?.score || 50;
      const scoreB = this.peerPerformance.get(b)?.score || 50;
      return scoreB - scoreA;
    });

    const cursors = new Map<string, number>();
    for (const pid of peerIds) cursors.set(pid, 0);

    let progress = true;
    while (progress) {
      progress = false;
      for (const pid of peerIds) {
        const queue = peerQueues.get(pid)!;
        const cursor = cursors.get(pid)!;
        
        let perf = this.peerPerformance.get(pid);
        if (!perf) {
          perf = { avgLatency: 100, throughput: 100, activeRequests: 0, maxRequests: 50, score: 50 };
          this.peerPerformance.set(pid, perf);
        }

        // Keep giving this peer chunks until they hit their limit or run out of rare chunks they can serve
        while (cursor < queue.length && perf.activeRequests < perf.maxRequests) {
          const chunkIdx = queue[cursor];
          
          this.peerManager.requestChunk(pid, chunkIdx);
          this.pendingRequests.set(chunkIdx, Date.now());
          
          // Start the stopwatch for this specific chunk
          let timestamps = this.requestTimestamps.get(pid);
          if (!timestamps) {
            timestamps = [];
            this.requestTimestamps.set(pid, timestamps);
          }
          timestamps.push({ chunkIndex: chunkIdx, timestamp: Date.now() });
          
          perf.activeRequests++;
          cursors.set(pid, cursor + 1);
          progress = true;
          // No break — fill this peer's quota before moving to the next peer
        }
      }
    }
  }

  private getMissingChunks(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.haveSet.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  private async sha256(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Get current progress as a percentage.
   */
  getProgress(): number {
    return Math.round((this.haveSet.size / this.totalChunks) * 100);
  }

  /**
   * Remove a peer's bitfield when they disconnect.
   * Also clear any requests that were sent to this peer so they
   * get instantly reassigned on the next gossip cycle.
   */
  removePeer(peerId: string): void {
    this.peerBitfields.delete(peerId);
    this.pushCursors.delete(peerId);
    this.peerPerformance.delete(peerId);
    this.requestTimestamps.delete(peerId);
    
    // We don't easily track *which* chunk went to *which* peer in pendingRequests
    // natively, but we can just aggressively timeout ALL currently pending requests 
    // to force a faster retry across remaining peers instead of waiting the full 5 seconds.
    // In a production app, we would map chunkList -> peerId, but since the timeout
    // gets hit on the next cycle, we'll just let the 2000ms timeout catch it.
  }
}
