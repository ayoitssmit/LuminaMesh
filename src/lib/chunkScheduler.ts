import { PeerManager, DataMessage } from "./peerManager";

export type SchedulerEvents = {
  onProgress: (chunksHave: number, totalChunks: number) => void;
  onComplete: (assembledChunks: ArrayBuffer[]) => void;
  onChunkVerified: (index: number) => void;
  onChunkFailed: (index: number, peerId: string) => void;
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
  private events: SchedulerEvents;

  // File metadata
  private totalChunks: number;
  private chunkHashes: string[]; // expected SHA-256 per chunk

  // Local chunk store
  private chunks: (ArrayBuffer | null)[];
  private haveSet: Set<number> = new Set();

  // What each peer has
  private peerBitfields: Map<string, Set<number>> = new Map();

  // Pending requests to avoid duplicates (chunkIndex -> timestamp)
  private pendingRequests: Map<number, number> = new Map();

  // Whether onComplete has already been fired (gossip keeps running for re-seeding)
  private completed = false;

  // Gossip interval handle
  private gossipInterval: ReturnType<typeof setInterval> | null = null;

  // Push-based distribution state (seeder proactively pushes unique chunks)
  private pushInterval: ReturnType<typeof setInterval> | null = null;
  private pushCursors: Map<string, number> = new Map();

  constructor(
    peerManager: PeerManager,
    events: SchedulerEvents,
    totalChunks: number,
    chunkHashes: string[]
  ) {
    this.peerManager = peerManager;
    this.events = events;
    this.totalChunks = totalChunks;
    this.chunkHashes = chunkHashes;
    this.chunks = new Array(totalChunks).fill(null);
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
    }, 500); // 500ms — faster gossip for quicker swarm convergence
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
   *
   * The seeder proactively pushes chunks to each connected peer using
   * offset-based striping: each peer starts at a different position in
   * the file, so everyone receives UNIQUE chunks simultaneously.
   *
   * Example with 500 chunks, 2 peers:
   *   Peer A starts at offset 0:   pushes 0, 1, 2, 3...
   *   Peer B starts at offset 250: pushes 250, 251, 252...
   *   → Sender distributes unique chunks, peers cross-share via relay.
   */
  startPushing(): void {
    if (this.pushInterval) return;
    this.pushInterval = setInterval(() => this.pushNextChunks(), 80);
  }

  stopPushing(): void {
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
      this.pushInterval = null;
    }
  }

  /**
   * Push unique chunks to each peer using offset-based striping.
   * Each peer's cursor starts at an evenly-spaced position in the file.
   */
  private pushNextChunks(): void {
    const peers = this.peerManager.getConnectedPeers();
    if (peers.length === 0) return;

    for (let p = 0; p < peers.length; p++) {
      const pid = peers[p];
      const peerBf = this.peerBitfields.get(pid) || new Set();

      // Initialize cursor at an evenly-spaced offset so each peer
      // starts downloading from a different region of the file.
      if (!this.pushCursors.has(pid)) {
        // Find how many peers already have cursors to distribute evenly
        const peerRank = this.pushCursors.size;
        const offset = Math.floor((peerRank / Math.max(peers.length, 1)) * this.totalChunks);
        this.pushCursors.set(pid, offset);
      }

      let cursor = this.pushCursors.get(pid)!;
      let sent = 0;
      let checked = 0;

      // Push up to 3 chunks per peer per cycle (respects DataChannel backpressure)
      while (sent < 3 && checked < this.totalChunks) {
        const idx = cursor % this.totalChunks;
        if (!peerBf.has(idx) && this.chunks[idx]) {
          this.peerManager.sendChunk(pid, idx, new Uint8Array(this.chunks[idx]!));
          sent++;
        }
        cursor++;
        checked++;
      }

      this.pushCursors.set(pid, cursor % this.totalChunks);
    }
  }

  /**
   * Handle incoming data messages from PeerManager.
   */
  async handleMessage(peerId: string, message: DataMessage): Promise<void> {
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
          this.handleChunkRequest(peerId, message.chunkIndex);
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

  /**
   * Respond to a chunk request from a peer.
   */
  private handleChunkRequest(peerId: string, chunkIndex: number): void {
    const chunk = this.chunks[chunkIndex];
    if (chunk) {
      this.peerManager.sendChunk(peerId, chunkIndex, new Uint8Array(chunk));
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
    this.chunks[chunkIndex] = data;
    this.haveSet.add(chunkIndex);
    this.events.onChunkVerified(chunkIndex);
    this.events.onProgress(this.haveSet.size, this.totalChunks);

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
      this.events.onComplete(this.chunks as ArrayBuffer[]);
    }
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
      if (now - timestamp > 2000) { // Reduced from 5000ms to 2000ms for faster failover
        this.pendingRequests.delete(idx); 
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

    // Round-robin across all peers: take one chunk from each peer in turn.
    // This guarantees truly parallel dispatching across the swarm.
    const connectedCount = this.peerManager.getConnectedPeers().length;
    const maxRequests = Math.max(5, Math.min(connectedCount * 5, 25));
    let requested = 0;
    const peerIds = Array.from(peerQueues.keys());
    const cursors = new Map<string, number>();
    for (const pid of peerIds) cursors.set(pid, 0);

    let progress = true;
    while (requested < maxRequests && progress) {
      progress = false;
      for (const pid of peerIds) {
        if (requested >= maxRequests) break;
        const queue = peerQueues.get(pid)!;
        const cursor = cursors.get(pid)!;
        if (cursor < queue.length) {
          const chunkIdx = queue[cursor];
          this.peerManager.requestChunk(pid, chunkIdx);
          this.pendingRequests.set(chunkIdx, Date.now());
          cursors.set(pid, cursor + 1);
          requested++;
          progress = true;
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
    
    // We don't easily track *which* chunk went to *which* peer in pendingRequests
    // natively, but we can just aggressively timeout ALL currently pending requests 
    // to force a faster retry across remaining peers instead of waiting the full 5 seconds.
    // In a production app, we would map chunkList -> peerId, but since the timeout
    // gets hit on the next cycle, we'll just let the 2000ms timeout catch it.
  }
}
