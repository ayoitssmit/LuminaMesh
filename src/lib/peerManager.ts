import SimplePeer from "simple-peer";
import type { Instance as PeerInstance } from "simple-peer";

// Message types sent over WebRTC data channels
export interface DataMessage {
  type: "chunk-request" | "chunk-response" | "chunk-available" | "bitfield";
  chunkIndex?: number;
  data?: Uint8Array;
  bitfield?: number[]; // array of chunk indices this peer has
}

export type PeerEventHandler = {
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onSignal: (peerId: string, signalData: SimplePeer.SignalData) => void;
  onData: (peerId: string, message: DataMessage) => void;
};

/**
 * Manages all active WebRTC peer connections.
 * Each connection is a SimplePeer instance mapped by remote peerId.
 */
export class PeerManager {
  private peers: Map<string, PeerInstance> = new Map();
  private handlers: PeerEventHandler;

  constructor(handlers: PeerEventHandler) {
    this.handlers = handlers;
  }

  /**
   * Create a new peer connection.
   * @param peerId   - Remote peer's ID
   * @param initiator - True if this side is sending the offer
   */
  createPeer(peerId: string, initiator: boolean): PeerInstance {
    // Tear down existing connection to same peer if any
    this.destroyPeer(peerId);

    const peer = new SimplePeer({
      initiator,
      trickle: true, // send ICE candidates as they arrive
    });

    // When simple-peer generates signaling data, forward it via Socket.io
    peer.on("signal", (signalData: SimplePeer.SignalData) => {
      this.handlers.onSignal(peerId, signalData);
    });

    // Connection established — data channel is open
    peer.on("connect", () => {
      this.handlers.onPeerConnected(peerId);
    });

    // Incoming binary data from the remote peer
    peer.on("data", (raw: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(raw);
        const message: DataMessage = JSON.parse(text);
        this.handlers.onData(peerId, message);
      } catch {
        // Non-JSON data, ignore
      }
    });

    peer.on("close", () => {
      this.peers.delete(peerId);
      this.handlers.onPeerDisconnected(peerId);
    });

    peer.on("error", (err: Error) => {
      console.error("[PeerManager] Error with peer " + peerId + ":", err.message);
      this.destroyPeer(peerId);
    });

    this.peers.set(peerId, peer);
    return peer;
  }

  /**
   * Feed remote signaling data (offer/answer/candidate) into a peer connection.
   */
  signal(peerId: string, signalData: SimplePeer.SignalData): void {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed) {
      peer.signal(signalData);
    }
  }

  /**
   * Send a structured message over the WebRTC data channel.
   */
  send(peerId: string, message: DataMessage): void {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed) {
      const encoded = new TextEncoder().encode(JSON.stringify(message));
      peer.send(encoded);
    }
  }

  /**
   * Request a specific chunk from a peer.
   */
  requestChunk(peerId: string, chunkIndex: number): void {
    this.send(peerId, { type: "chunk-request", chunkIndex });
  }

  /**
   * Send a chunk to a peer (response to their request).
   */
  sendChunk(peerId: string, chunkIndex: number, data: Uint8Array): void {
    this.send(peerId, { type: "chunk-response", chunkIndex, data });
  }

  /**
   * Broadcast our current bitfield (which chunks we have) to a peer.
   */
  sendBitfield(peerId: string, availableChunks: number[]): void {
    this.send(peerId, { type: "bitfield", bitfield: availableChunks });
  }

  /**
   * Tear down a specific peer connection.
   */
  destroyPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(peerId);
    }
  }

  /**
   * Tear down all peer connections.
   */
  destroyAll(): void {
    for (const [id, peer] of this.peers) {
      peer.destroy();
    }
    this.peers.clear();
  }

  /**
   * Get all currently connected peer IDs.
   */
  getConnectedPeers(): string[] {
    return Array.from(this.peers.keys()).filter((id) => {
      const p = this.peers.get(id);
      return p && !p.destroyed;
    });
  }

  /**
   * Check if a specific peer is connected.
   */
  isConnected(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    return !!peer && !peer.destroyed;
  }
}
