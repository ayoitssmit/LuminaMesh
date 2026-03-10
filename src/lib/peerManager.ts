export interface DataMessage {
  type: "chunk-request" | "chunk-response" | "chunk-available" | "bitfield";
  chunkIndex?: number;
  data?: Uint8Array;
  bitfield?: number[];
}

export type PeerEventHandler = {
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onSignal: (peerId: string, signalData: any) => void;
  onData: (peerId: string, message: DataMessage) => void;
};

// Minimal Native RTCPeerConnection Adapter matching what we need
class NativePeer {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  public destroyed = false;

  constructor(
    private initiator: boolean,
    private onSignal: (data: any) => void,
    private onConnect: () => void,
    private onData: (data: Uint8Array) => void,
    private onClose: () => void,
    private onError: (err: Error) => void
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignal({ type: "candidate", candidate: event.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.destroy();
      }
    };

    if (this.initiator) {
      this.setupDataChannel(this.pc.createDataChannel("lumina-mesh-data", { ordered: true }));
      this.pc.createOffer().then((offer) => {
        this.pc.setLocalDescription(offer);
        this.onSignal({ type: "offer", sdp: offer.sdp });
      }).catch(this.onError);
    } else {
      this.pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel);
      };
    }
  }

  private resolveBufferWait: (() => void) | null = null;
  // User safe limit: 16 MB. Once the buffer hits this, we pause execution.
  private readonly MAX_BUFFER_LIMIT = 16 * 1024 * 1024;

  private setupDataChannel(channel: RTCDataChannel) {
    this.dc = channel;
    this.dc.binaryType = "arraybuffer";
    
    // Set our "Low Water Mark" Tripwire to 64 KB
    this.dc.bufferedAmountLowThreshold = 64 * 1024;

    this.dc.onbufferedamountlow = () => {
      // Wakes up any pending "waitForBufferSpace" promises
      if (this.resolveBufferWait) {
        this.resolveBufferWait();
        this.resolveBufferWait = null;
      }
    };

    this.dc.onopen = () => {
      this.onConnect();
    };

    this.dc.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.onData(new TextEncoder().encode(event.data));
      } else {
        this.onData(new Uint8Array(event.data as ArrayBuffer));
      }
    };

    this.dc.onclose = () => this.destroy();
    this.dc.onerror = () => this.destroy();
  }

  /**
   * Returns a promise that naturally pauses execution if the SCTP send 
   * buffer is saturated, waking up instantly when the browser flushes it.
   */
  public async waitForBufferSpace(): Promise<void> {
    if (this.destroyed || !this.dc || this.dc.readyState !== "open") return;

    if (this.dc.bufferedAmount < this.MAX_BUFFER_LIMIT) {
      return; // Fast path: There's space, send immediately
    }

    return new Promise((resolve) => {
      // If there's already someone waiting, we queue up
      const oldResolve = this.resolveBufferWait;
      this.resolveBufferWait = () => {
        if (oldResolve) oldResolve();
        resolve();
      };
    });
  }

  public signal(data: any) {
    if (this.destroyed) return;

    if (data.type === "offer" || data.type === "answer") {
      this.pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp })).then(() => {
        if (data.type === "offer" && !this.initiator) {
          this.pc.createAnswer().then((answer) => {
            this.pc.setLocalDescription(answer);
            this.onSignal({ type: "answer", sdp: answer.sdp });
          }).catch(this.onError);
        }
      }).catch(this.onError);
    } else if (data.type === "candidate") {
      this.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    }
  }

  public send(data: Uint8Array) {
    if (this.destroyed || !this.dc || this.dc.readyState !== "open") return;
    try {
      this.dc.send(data as unknown as ArrayBuffer);
    } catch (e) {
      console.warn("[NativePeer] Send failed (peer may be congested):", e);
      // DO NOT call this.onError() because that destroys the entire connection!
      // A failed send will be handled by the chunk requester timing out.
    }
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      if (this.dc) this.dc.close();
      this.pc.close();
    } catch (e) {}
    this.onClose();
  }
}

export class PeerManager {
  private peers: Map<string, NativePeer> = new Map();
  private openChannels: Set<string> = new Set();
  private handlers: PeerEventHandler;

  constructor(handlers: PeerEventHandler) {
    this.handlers = handlers;
  }

  createPeer(peerId: string, initiator: boolean): NativePeer {
    this.destroyPeer(peerId);

    const peer = new NativePeer(
      initiator,
      (signalData) => this.handlers.onSignal(peerId, signalData),
      () => {
        this.openChannels.add(peerId);
        this.handlers.onPeerConnected(peerId);
      },
      (raw: Uint8Array) => {
        try {
          const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
          const metaLen = view.getUint32(0);
          const metaBytes = raw.subarray(4, 4 + metaLen);
          const text = new TextDecoder().decode(metaBytes);
          const message: DataMessage = JSON.parse(text);

          if (raw.byteLength > 4 + metaLen) {
            message.data = raw.subarray(4 + metaLen);
          }

          this.handlers.onData(peerId, message);
        } catch (e) {
          console.error("[PeerManager] Frame decode error:", e);
        }
      },
      () => {
        this.peers.delete(peerId);
        this.openChannels.delete(peerId);
        this.handlers.onPeerDisconnected(peerId);
      },
      (err) => {
        console.error("[PeerManager] Error with peer " + peerId + ":", err.message);
        this.destroyPeer(peerId);
      }
    );

    this.peers.set(peerId, peer);
    return peer;
  }

  signal(peerId: string, signalData: any): void {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed) {
      peer.signal(signalData);
    }
  }

  async waitForBufferSpace(peerId: string): Promise<void> {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed) {
      await peer.waitForBufferSpace();
    }
  }

  send(peerId: string, message: DataMessage): void {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed && this.openChannels.has(peerId)) {
      try {
        const { data, ...meta } = message;
        const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
        const payloadLength = 4 + metaBytes.length + (data ? data.length : 0);
        const payload = new Uint8Array(payloadLength);
        const view = new DataView(payload.buffer);
        
        view.setUint32(0, metaBytes.length);
        payload.set(metaBytes, 4);
        if (data) {
          payload.set(data, 4 + metaBytes.length);
        }
        
        peer.send(payload);
      } catch (err) {
        console.warn("[PeerManager] Send failed for " + peerId + ":", err);
      }
    }
  }

  requestChunk(peerId: string, chunkIndex: number): void {
    this.send(peerId, { type: "chunk-request", chunkIndex });
  }

  sendChunk(peerId: string, chunkIndex: number, data: Uint8Array): void {
    this.send(peerId, { type: "chunk-response", chunkIndex, data });
  }

  sendBitfield(peerId: string, availableChunks: number[]): void {
    this.send(peerId, { type: "bitfield", bitfield: availableChunks });
  }

  destroyPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.destroy();
      this.peers.delete(peerId);
      this.openChannels.delete(peerId);
    }
  }

  destroyAll(): void {
    for (const [, peer] of this.peers) {
      peer.destroy();
    }
    this.peers.clear();
    this.openChannels.clear();
  }

  getConnectedPeers(): string[] {
    return Array.from(this.openChannels);
  }

  isConnected(peerId: string): boolean {
    return this.openChannels.has(peerId);
  }

  hasPeer(peerId: string): boolean {
    const peer = this.peers.get(peerId);
    return !!peer && !peer.destroyed;
  }
}
