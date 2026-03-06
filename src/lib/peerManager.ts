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

  private setupDataChannel(channel: RTCDataChannel) {
    this.dc = channel;
    this.dc.binaryType = "arraybuffer";

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
      // Backpressure guard: if buffer exceeds 8MB, intentionally drop the packet.
      // The gossip protocol will automatically time it out and re-request.
      if (this.dc.bufferedAmount > 8 * 1024 * 1024) {
        console.warn("[NativePeer] Buffer full, dropping packet to prevent overflow");
        return;
      }
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
          const metaLen = view.getUint16(0);
          const metaBytes = raw.subarray(2, 2 + metaLen);
          const text = new TextDecoder().decode(metaBytes);
          const message: DataMessage = JSON.parse(text);

          if (raw.byteLength > 2 + metaLen) {
            message.data = raw.subarray(2 + metaLen);
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

  send(peerId: string, message: DataMessage): void {
    const peer = this.peers.get(peerId);
    if (peer && !peer.destroyed && this.openChannels.has(peerId)) {
      try {
        const { data, ...meta } = message;
        const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
        const payloadLength = 2 + metaBytes.length + (data ? data.length : 0);
        const payload = new Uint8Array(payloadLength);
        const view = new DataView(payload.buffer);
        
        view.setUint16(0, metaBytes.length);
        payload.set(metaBytes, 2);
        if (data) {
          payload.set(data, 2 + metaBytes.length);
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
