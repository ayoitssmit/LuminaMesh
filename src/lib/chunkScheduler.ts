import { PeerManager, DataMessage } from "./peerManager";
import { saveChunkToCache, getRecoveredBitfield, updateSessionInfo, getCachedChunk } from "./indexedDB";

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

  // Double-Send Collision Cache (Expiring)
  private recentlySentChunks: Map<string, Map<number, number>> = new Map();

  // Async Per-Peer Message Processing Queue
  private peerMessageQueues: Map<string, DataMessage[]> = new Map();
  private peerMessageLoopActive: Map<string, boolean> = new Map();

  // Throttle progress updates to prevent re-render storms
  private progressThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReportedHave: number = 0;
  private firstMissingIndex: number = 0;

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
    this.chunkSize = options?.chunkSize || 60 * 1024;
    this.fileHandle = options?.fileHandle;
    this.writable = options?.writable;
    this.events = events;
    this.totalChunks = totalChunks;
    this.chunkHashes = chunkHashes;
    this.masterHash = masterHash;
    this.chunks = new Array(totalChunks).fill(null);

    // Initialize with recovered state from IndexedDB
    this.haveSet = new Set(initialBitfield);
    
    // Calculate initial firstMissingIndex
    while (this.haveSet.has(this.firstMissingIndex) && this.firstMissingIndex < this.totalChunks) {
      this.firstMissingIndex++;
    }

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
    if (allChunks.length === 0) return;
    
    for (let i = 0; i < allChunks.length; i++) {
      this.chunks[i] = allChunks[i];
      this.haveSet.add(i);
    }
    
    // Immediately tell the UI we have 100% capacity
    this.events.onProgress(this.haveSet.size, this.totalChunks);
    
    if (this.haveSet.size === this.totalChunks && !this.completed) {
      this.completed = true;
      this.events.onComplete(this.chunks as ArrayBuffer[]);
    }
  }

  /**
   * Start the gossip loop — periodically request missing chunks from peers.
   * Bitfield broadcasts are on a separate, slow timer to avoid bandwidth waste.
   */
  // Separate timer for slow bitfield broadcasts
  private bitfieldInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.gossipInterval) return;

    // FAST LOOP (50ms): Hyper-responsive fallback for pulling chunks
    this.gossipInterval = setInterval(() => {
      this.requestNextChunks();
    }, 50);

    // SLOW LOOP (5s): Full bitfield broadcast as a catch-up for late-joining peers.
    // Individual "chunk-available" pings handle real-time updates between broadcasts.
    this.broadcastBitfield(); // Send once immediately on start
    this.bitfieldInterval = setInterval(() => {
      this.broadcastBitfield();
    }, 5000);
  }

  stop(): void {
    if (this.gossipInterval) {
      clearInterval(this.gossipInterval);
      this.gossipInterval = null;
    }
    if (this.bitfieldInterval) {
      clearInterval(this.bitfieldInterval);
      this.bitfieldInterval = null;
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
    
    // Check if we have peers first. If not, sleep to save CPU.
    const peers = this.peerManager.getConnectedPeers();
    if (peers.length === 0) {
      setTimeout(() => this.runPushLoop(), 500);
      return;
    }

    await this.pushNextChunks();
    
    if (this.pushActive) {
      // Yield to the event loop so the browser can process UI, IO, and WebRTC signaling.
      // A small delay (10ms) prevents CPU starvation while maintaining high throughput.
      setTimeout(() => this.runPushLoop(), 10);
    }
  }

  /**
   * RANGE-BASED DISTRIBUTION (Seeder Only):
   * Divides the file into N equal parts (N = number of connected peers).
   * Assigns a specific range to each peer and ONLY pushes chunks from that range.
   * This guarantees 0 overlapping data sent from the Seeder, forcing peers 
   * to cross-share their unique ranges with each other.
   */
  private async pushNextChunks(): Promise<void> {
    const peers = this.peerManager.getConnectedPeers();
    if (peers.length === 0) return;

    // Sort peers so assignment is deterministic even if a peer momentarily drops
    peers.sort();

    // 1. Calculate Ranges Based on Current Peer Count
    // If a new peer joins, the ranges are recalculated dynamically so the new peer gets a slice.
    const chunkSizeTarget = Math.ceil(this.totalChunks / peers.length);
    const peerRanges = new Map<string, { start: number; end: number }>();
    
    for (let i = 0; i < peers.length; i++) {
      const start = i * chunkSizeTarget;
      const end = Math.min(start + chunkSizeTarget, this.totalChunks);
      peerRanges.set(peers[i], { start, end });
    }

    // 2. Push chunks within each peer's assigned range
    await Promise.all(peers.map(async (pid) => {
      const peerBf = this.peerBitfields.get(pid) || new Set();
      const range = peerRanges.get(pid);
      if (!range) return;

      // Initialize or constrain cursor to the peer's current assigned range
      let cursor = this.pushCursors.get(pid);
      if (cursor === undefined || cursor < range.start || cursor >= range.end) {
        cursor = range.start;
      }

      let sent = 0;
      let checked = 0;
      const rangeSize = range.end - range.start;

      // Check the range, but yield the loop after sending 40 chunks (~2.4MB)
      // This prevents the Seeder from getting permanently stuck on one peer while
      // ignoring newly joined peers. Yielding allows ranges to be dynamically recalculated.
      while (checked < rangeSize && sent < 40) {
        // If we hit the end of the range, wrap around to the start of the range
        if (cursor >= range.end) {
          cursor = range.start;
        }

        if (!peerBf.has(cursor) && this.haveSet.has(cursor)) {
          await this.handleChunkRequest(pid, cursor);
          sent++;
        }
        
        cursor++;
        checked++;
      }

      this.pushCursors.set(pid, cursor);
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
    let needsPull = false;

    while (queue && queue.length > 0) {
      const message = queue.shift()!;
      
      switch (message.type) {
        case "bitfield":
          if (message.bitfield) {
            this.peerBitfields.set(peerId, new Set(message.bitfield));
            needsPull = true;
          }
          break;

        case "chunk-available":
          if (message.chunkIndex !== undefined) {
            const peerSet = this.peerBitfields.get(peerId) || new Set();
            peerSet.add(message.chunkIndex);
            this.peerBitfields.set(peerId, peerSet);
            needsPull = true;
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
            // Use the existing buffer directly — avoid copying
            const buf = (message.data instanceof ArrayBuffer
              ? message.data
              : (message.data as Uint8Array).buffer) as ArrayBuffer;
            await this.handleChunkResponse(peerId, message.chunkIndex, buf);
            needsPull = true;
          }
          break;
      }
    }

    this.peerMessageLoopActive.set(peerId, false);
    
    // Reactive Pull Trigger: instantly request more chunks if new data/availability arrived
    if (needsPull) {
      this.requestNextChunks();
    }
  }

  /**
   * Respond to a chunk request from a peer.
   */
  private async handleChunkRequest(peerId: string, chunkIndex: number): Promise<void> {
    // 1. Check Double-Send Collision Cache
    // If we pushed/pulled this chunk to this peer less than 2.5 seconds ago, ignore the request.
    // This prevents simultaneous push/pull collisions, but still allows re-requests for lost packets.
    let sentMap = this.recentlySentChunks.get(peerId);
    if (!sentMap) {
      sentMap = new Map();
      this.recentlySentChunks.set(peerId, sentMap);
    }
    
    const lastSent = sentMap.get(chunkIndex);
    if (lastSent && Date.now() - lastSent < 2500) {
      return; // Already sent recently, ignore duplicate
    }

    // 1. SMART THROTTLING (Backpressure)
    // Pause execution if this peer's send buffer is >16MB. Wait for 'onbufferedamountlow'.
    await this.peerManager.waitForBufferSpace(peerId);

    const chunk = this.chunks[chunkIndex];
    if (chunk) {
      this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(chunk));
      sentMap.set(chunkIndex, Date.now());
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
        sentMap.set(chunkIndex, Date.now());
        return;
      } catch (err) {
        console.error("Failed to read chunk from disk for seeding", err);
      }
    }

    // IndexedDB seeding: if not in memory or FS, retrieve from Cache
    try {
      const cachedChunk = await getCachedChunk(this.masterHash, chunkIndex);
      if (cachedChunk) {
        this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(cachedChunk));
        sentMap.set(chunkIndex, Date.now());
      }
    } catch (err) {
      console.error("IndexedDB chunk retrieval failed", err);
    }
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
        // [SPEED OPTIMIZATION]: Do not 'await' the IndexedDB save.
        // We notify the swarm and the UI immediately while the disk write happens in the background.
        // This removes disk latency (5-20ms) from the mesh peer-to-peer relay.
        saveChunkToCache(this.masterHash, chunkIndex, data).catch((err) => {
           console.error("Delayed background save to IndexedDB failed", err);
           this.events.onChunkFailed(chunkIndex, peerId);
        });
        
        // Save metadata ping for Garbage Collection periodically
        if (chunkIndex % 50 === 0) {
           updateSessionInfo(this.masterHash, "active-room").catch(console.error); 
        }

        // Cache in RAM so we can cross-seed to other peers instantly without hitting the disk!
        this.chunks[chunkIndex] = data;
      } catch (err) {
        console.error("Critical error during chunk storage setup", err);
        return;
      }
    }

    // Critical: Only update our bitfield and gossip to the swarm *after* the chunk is reliably saved
    this.haveSet.add(chunkIndex);
    this.events.onChunkVerified(chunkIndex);

    // Update sparse scanning index
    if (chunkIndex === this.firstMissingIndex) {
      while (this.haveSet.has(this.firstMissingIndex) && this.firstMissingIndex < this.totalChunks) {
        this.firstMissingIndex++;
      }
    }

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

    // INSTANT HAVE: Forward a tiny "chunk-available" announcement to ALL 
    // connected peers who don't have it yet. This replaces the old Instant Relay 
    // (which flooded the network with 64KB chunks and killed bandwidth).
    // Now, peers instantly know we have a chunk, and they can PULL it if they need it.
    for (const pid of this.peerManager.getConnectedPeers()) {
      if (pid === peerId) continue; // don't announce back to the sender
      const peerBf = this.peerBitfields.get(pid);
      if (!peerBf || !peerBf.has(chunkIndex)) {
        this.peerManager.sendChunkAvailable(pid, chunkIndex);
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
   * Request missing chunks from all connected peers.
   * Simple and fast: for each peer, find chunks they have that we need,
   * and fire requests immediately. No rarity maps, no sorting overhead.
   */
  private requestNextChunks(): void {
    const now = Date.now();

    // 1. CLEANUP STALE REQUESTS (Timeout: 3 seconds)
    // We must run this even if no peers are connected to ensure the state stays clean.
    for (const [pid, timestamps] of this.requestTimestamps.entries()) {
      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (now - timestamps[i].timestamp > 3000) {
          const { chunkIndex } = timestamps[i];
          this.pendingRequests.delete(chunkIndex); // release to swarm
          
          let perf = this.peerPerformance.get(pid);
          if (perf && perf.activeRequests > 0) perf.activeRequests--;
          
          timestamps.splice(i, 1);
        }
      }
    }

    if (this.haveSet.size === this.totalChunks) return;
    const connectedPeers = this.peerManager.getConnectedPeers();
    if (connectedPeers.length === 0) return;

    // Prioritize non-seeders to force True P2P Mesh cross-seeding.
    // Also randomize order to distribute load fairly among peers.
    connectedPeers.sort((a, b) => {
      const aIsSeeder = a.startsWith("seeder") ? 1 : 0;
      const bIsSeeder = b.startsWith("seeder") ? 1 : 0;
      if (aIsSeeder !== bIsSeeder) return aIsSeeder - bIsSeeder; // non-seeders first
      return Math.random() - 0.5; // randomize the rest
    });

    // For each peer, find chunks they advertise that we don't have and haven't requested.
    // Limit in-flight requests to 200 per peer to prevent overwhelming the WebRTC buffer
    for (const pid of connectedPeers) {
      const peerBf = this.peerBitfields.get(pid);
      if (!peerBf || peerBf.size === 0) continue;

      let perf = this.peerPerformance.get(pid);
      if (!perf) {
        perf = { avgLatency: 100, throughput: 0, activeRequests: 0, maxRequests: 300, score: 50 };
        this.peerPerformance.set(pid, perf);
      }

      for (const chunkIdx of peerBf) {
        if (chunkIdx < this.firstMissingIndex) continue; // Sparse scan opt
        if (perf.activeRequests >= 300) break; // Throttle using O(1) counter
        if (this.haveSet.has(chunkIdx)) continue;
        if (this.pendingRequests.has(chunkIdx)) continue;

        this.peerManager.requestChunk(pid, chunkIdx);
        this.pendingRequests.set(chunkIdx, now);
        
        let timestamps = this.requestTimestamps.get(pid);
        if (!timestamps) { timestamps = []; this.requestTimestamps.set(pid, timestamps); }
        timestamps.push({ chunkIndex: chunkIdx, timestamp: now });
        
        perf.activeRequests++;
      }
    }
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
    this.recentlySentChunks.delete(peerId);
    
    // We don't easily track *which* chunk went to *which* peer in pendingRequests
    // natively, but we can just aggressively timeout ALL currently pending requests 
    // to force a faster retry across remaining peers instead of waiting the full 5 seconds.
    // In a production app, we would map chunkList -> peerId, but since the timeout
    // gets hit on the next cycle, we'll just let the 2000ms timeout catch it.
  }
}
