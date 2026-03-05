import { io, Socket } from "socket.io-client";
import { PeerManager } from "./peerManager";
import type SimplePeer from "simple-peer";

export type SocketClientEvents = {
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onPeerJoined: (peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
};

/**
 * Thin wrapper around socket.io-client.
 * Connects using a JWT, listens for signaling events,
 * and delegates WebRTC handshakes to PeerManager.
 */
export class SocketClient {
  private socket: Socket | null = null;
  private peerManager: PeerManager;
  private events: SocketClientEvents;
  private myPeerId: string;

  constructor(
    peerManager: PeerManager,
    events: SocketClientEvents,
    myPeerId: string
  ) {
    this.peerManager = peerManager;
    this.events = events;
    this.myPeerId = myPeerId;
  }

  /**
   * Connect to the signaling server with a JWT token.
   */
  connect(serverUrl: string, token: string): void {
    if (this.socket) {
      this.socket.disconnect();
    }

    this.socket = io(serverUrl, {
      auth: { token },
    });

    this.socket.on("connect", () => {
      this.events.onConnected();
      // Immediately join the room
      this.socket!.emit("join-room");
    });

    this.socket.on("connect_error", (err: Error) => {
      this.events.onError(err.message);
    });

    // A new peer entered the room — we initiate the WebRTC handshake
    this.socket.on("peer-joined", (peerId: string) => {
      this.events.onPeerJoined(peerId);
      // We are the initiator since we were here first
      this.peerManager.createPeer(peerId, true);
    });

    // Receive a WebRTC offer — create a non-initiator peer and feed the signal
    this.socket.on("offer", (data: { from: string; to: string; offer: SimplePeer.SignalData }) => {
      if (data.to !== this.myPeerId) return;
      // Create peer as responder if not already connected
      if (!this.peerManager.isConnected(data.from)) {
        this.peerManager.createPeer(data.from, false);
      }
      this.peerManager.signal(data.from, data.offer);
    });

    // Receive a WebRTC answer
    this.socket.on("answer", (data: { from: string; to: string; answer: SimplePeer.SignalData }) => {
      if (data.to !== this.myPeerId) return;
      this.peerManager.signal(data.from, data.answer);
    });

    // Receive an ICE candidate
    this.socket.on("ice-candidate", (data: { from: string; to: string; candidate: SimplePeer.SignalData }) => {
      if (data.to !== this.myPeerId) return;
      this.peerManager.signal(data.from, data.candidate);
    });

    // A peer left the room
    this.socket.on("peer-disconnected", (peerId: string) => {
      this.peerManager.destroyPeer(peerId);
      this.events.onPeerLeft(peerId);
    });

    this.socket.on("disconnect", () => {
      this.events.onDisconnected();
    });
  }

  /**
   * Send signaling data (offer/answer/ICE) to a specific peer via the server.
   */
  sendSignal(toPeerId: string, signalData: SimplePeer.SignalData): void {
    if (!this.socket) return;

    if (signalData.type === "offer") {
      this.socket.emit("offer", { to: toPeerId, offer: signalData });
    } else if (signalData.type === "answer") {
      this.socket.emit("answer", { to: toPeerId, answer: signalData });
    } else {
      // ICE candidate or other signal types
      this.socket.emit("ice-candidate", { to: toPeerId, candidate: signalData });
    }
  }

  /**
   * Disconnect from the signaling server and tear down all peers.
   */
  disconnect(): void {
    this.peerManager.destroyAll();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return !!this.socket && this.socket.connected;
  }
}
