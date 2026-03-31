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
  // Queue to sequence asynchronous signaling operations and prevent WebRTC Glare crashes
  private signalingQueue: Promise<void> = Promise.resolve();
  private pendingCandidates: any[] = [];

  constructor(
    private initiator: boolean,
    private onSignal: (data: any) => void,
    private onConnect: () => void,
    private onData: (data: Uint8Array) => void,
    private onClose: () => void,
    private onError: (err: Error) => void,
    private dynamicIceServers?: RTCIceServer[]
  ) {
    const iceServers: RTCIceServer[] = this.dynamicIceServers || [];

    this.pc = new RTCPeerConnection({
      iceCandidatePoolSize: 2, // Speeds up gathering on restrictive networks
      iceServers
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onSignal({ type: "candidate", candidate: event.candidate });
      }
    };

    // Track detailed ICE connection state for debugging restrictive firewalls
    this.pc.oniceconnectionstatechange = () => {
      console.log(`[NativePeer] ICE state changed to: ${this.pc.iceConnectionState}`);
      if (this.pc.iceConnectionState === "failed") {
        console.error("[NativePeer] ICE connection failed. The network firewall is dropping the WebRTC relay stream.");
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "closed") {
        this.destroy();
      }
    };

    if (this.initiator) {
      this.setupDataChannel(this.pc.createDataChannel("lumina-mesh-data", { ordered: true }));
      this.signalingQueue = this.signalingQueue.then(async () => {
        try {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.onSignal({ type: "offer", sdp: offer.sdp });
        } catch (err: any) {
          this.onError(err);
        }
      });
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
    
    // Set our "Low Water Mark" Tripwire to 4 MB.
    // If we wait until 64 KB, the pipe goes "dry" on high-speed fiber before we can refill it.
    this.dc.bufferedAmountLowThreshold = 4 * 1024 * 1024;

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

    this.signalingQueue = this.signalingQueue.then(async () => {
      if (this.destroyed) return;

      try {
        if (data.type === "offer" || data.type === "answer") {
          // Prevent "Called in wrong state: stable" crashes by ignoring answers when not expecting them
          if (data.type === "answer" && this.pc.signalingState !== "have-local-offer") {
            console.warn(`[NativePeer] Ignoring answer in unexpected state: ${this.pc.signalingState}`);
            return;
          }

          await this.pc.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
          
          if (data.type === "offer" && !this.initiator) {
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            this.onSignal({ type: "answer", sdp: answer.sdp });
          }

          // Process any out-of-order candidates that arrived before the RemoteDescription
          if (this.pendingCandidates.length > 0) {
            console.log(`[NativePeer] Processing ${this.pendingCandidates.length} deferred ICE candidates.`);
            for (const candidate of this.pendingCandidates) {
              try {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                console.warn("[NativePeer] Deferred candidate failed:", e);
              }
            }
            this.pendingCandidates = [];
          }

        } else if (data.type === "candidate") {
          try {
            if (!this.pc.remoteDescription) {
               // Fast-path defer instead of throwing a DOMException natively
               console.warn("[NativePeer] Deferring candidate, no remote description.");
               this.pendingCandidates.push(data.candidate);
            } else {
               await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          } catch (candidateErr) {
            console.warn("[NativePeer] ICE Candidate failed to apply.", candidateErr);
          }
        }
      } catch (err: any) {
        // Look specifically for the glare error on answers when stable.
        if (err.message && err.message.includes("stable") && data.type === "answer") {
          console.warn("[NativePeer] Suppressed stable state glare error.");
        } else {
          this.onError(err);
        }
      }
    });
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
  private localPeerId: string = "";
  private dynamicIceServers?: RTCIceServer[];

  constructor(handlers: PeerEventHandler, dynamicIceServers?: RTCIceServer[]) {
    this.handlers = handlers;
    this.dynamicIceServers = dynamicIceServers;
  }

  setPeerId(id: string) {
    this.localPeerId = id;
  }

  getPeerId(): string {
    return this.localPeerId;
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
          const text = new TextDecoder().decode(raw);
          const message: any = JSON.parse(text);

          // If the message contains a base64 encoded chunk, decode it back to Uint8Array
          if (message.dataBase64) {
            const binaryString = atob(message.dataBase64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            message.data = bytes;
            delete message.dataBase64; // Clean up
          }

          this.handlers.onData(peerId, message as DataMessage);
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
      },
      this.dynamicIceServers
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
        const payload: any = { ...message };
        
        // Convert binary Uint8Array into a Base64 string to guarantee 100% data integrity across all browser WebRTC implementations
        if (payload.data) {
          let binary = '';
          const bytes = new Uint8Array(payload.data);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          payload.dataBase64 = btoa(binary);
          delete payload.data; // Remove raw binary from JSON
        }
        
        const jsonString = JSON.stringify(payload);
        const encoded = new TextEncoder().encode(jsonString);
        peer.send(encoded);
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

  sendChunkAvailable(peerId: string, chunkIndex: number): void {
    this.send(peerId, { type: "chunk-available", chunkIndex });
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
