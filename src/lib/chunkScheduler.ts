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

    // Announce to all peers that we have this chunk
    for (const pid of this.peerManager.getConnectedPeers()) {
      this.peerManager.send(pid, {
        type: "chunk-available",
        chunkIndex,
      });
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
   * Pick the rarest missing chunks and request them from peers that have them.
   */
  private requestNextChunks(): void {
    const missing = this.getMissingChunks();
    if (missing.length === 0) return;

    const now = Date.now();
    for (const [idx, timestamp] of this.pendingRequests.entries()) {
      if (now - timestamp > 5000) {
        this.pendingRequests.delete(idx); // timeout after 5s
      }
    }

    // Count how many peers have each missing chunk (rarest-first)
    const chunkRarity: { index: number; count: number; peers: string[] }[] = [];

    for (const idx of missing) {
      if (this.pendingRequests.has(idx)) continue;
      const peersWithChunk: string[] = [];
      for (const [pid, bitfield] of this.peerBitfields) {
        if (bitfield.has(idx) && this.peerManager.isConnected(pid)) {
          peersWithChunk.push(pid);
        }
      }
      if (peersWithChunk.length > 0) {
        chunkRarity.push({ index: idx, count: peersWithChunk.length, peers: peersWithChunk });
      }
    }

    // Sort by rarity (fewest peers first)
    chunkRarity.sort((a, b) => a.count - b.count);

    // Scale concurrency with the number of connected peers (min 5, max 20)
    const connectedCount = this.peerManager.getConnectedPeers().length;
    const maxRequests = Math.max(5, Math.min(connectedCount * 3, 20));
    let requested = 0;

    // Track load per peer so we spread requests evenly (least-loaded first)
    const peerLoadMap = new Map<string, number>();

    for (const entry of chunkRarity) {
      if (requested >= maxRequests) break;
      // Pick the LEAST-LOADED peer that has this chunk
      entry.peers.sort(
        (a, b) => (peerLoadMap.get(a) || 0) - (peerLoadMap.get(b) || 0)
      );
      const selectedPeer = entry.peers[0];
      peerLoadMap.set(selectedPeer, (peerLoadMap.get(selectedPeer) || 0) + 1);
      this.peerManager.requestChunk(selectedPeer, entry.index);
      this.pendingRequests.set(entry.index, Date.now());
      requested++;
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
   */
  removePeer(peerId: string): void {
    this.peerBitfields.delete(peerId);
  }
}
