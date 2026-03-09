import { io, Socket } from "socket.io-client";
import { PeerManager } from "./peerManager";

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
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on("connect", () => {
      console.log("[SocketClient] Connected, my peerId:", this.myPeerId);
      this.events.onConnected();
      this.socket!.emit("join-room");
    });

    this.socket.on("connect_error", (err: Error) => {
      console.error("[SocketClient] Connect error:", err.message);
      this.events.onError(err.message);
    });

    this.socket.io.on("reconnect_failed", () => {
      console.error("[SocketClient] Reconnection failed completely.");
      this.events.onError("Connection lost permanently.");
      this.disconnect();
    });

    // A new peer entered the room — we are NOT the initiator.
    // We wait for them to send us an offer, because they receive our ID in "existing-peers".
    this.socket.on("peer-joined", (peerId: string) => {
      console.log("[SocketClient] peer-joined:", peerId);
      if (this.peerManager.hasPeer(peerId)) {
        console.log(`[SocketClient] Already connected to ${peerId}, ignoring peer-joined`);
        return;
      }
      this.events.onPeerJoined(peerId);
      // DO NOT initiate WebRTC handshake here to prevent crossed offers!
      // The new peer will initiate to us.
    });

    // Full-Mesh: We just joined — server tells us who's already here.
    // Initiate outbound WebRTC handshakes to ALL existing peers.
    this.socket.on("existing-peers", (peerIds: string[]) => {
      console.log("[SocketClient] existing-peers:", peerIds);
      for (const pid of peerIds) {
        if (!this.peerManager.hasPeer(pid)) {
          this.events.onPeerJoined(pid);
          this.peerManager.createPeer(pid, true);
        }
      }
    });

    // Receive a WebRTC offer — create a non-initiator peer and feed the signal
    this.socket.on("offer", (data: { from: string; to: string; offer: any }) => {
      console.log("[SocketClient] offer from:", data.from, "to:", data.to);
      if (data.to !== this.myPeerId) return;
      // Create peer as responder if we don't already have a peer instance
      if (!this.peerManager.hasPeer(data.from)) {
        this.peerManager.createPeer(data.from, false);
      }
      this.peerManager.signal(data.from, data.offer);
    });

    // Receive a WebRTC answer
    this.socket.on("answer", (data: { from: string; to: string; answer: any }) => {
      console.log("[SocketClient] answer from:", data.from, "to:", data.to);
      if (data.to !== this.myPeerId) return;
      this.peerManager.signal(data.from, data.answer);
    });

    // Receive an ICE candidate
    this.socket.on("ice-candidate", (data: { from: string; to: string; candidate: any }) => {
      console.log("[SocketClient] ice-candidate from:", data.from);
      if (data.to !== this.myPeerId) return;
      this.peerManager.signal(data.from, data.candidate);
    });

    // A peer left the room
    this.socket.on("peer-disconnected", (peerId: string) => {
      console.log("[SocketClient] peer-disconnected:", peerId);
      this.peerManager.destroyPeer(peerId);
      this.events.onPeerLeft(peerId);
    });

    this.socket.on("disconnect", () => {
      console.log("[SocketClient] Disconnected");
      this.events.onDisconnected();
    });
  }

  /**
   * Send signaling data (offer/answer/ICE) to a specific peer via the server.
   */
  sendSignal(toPeerId: string, signalData: any): void {
    if (!this.socket) return;

    const sigType = signalData.type || "ice-candidate";
    console.log("[SocketClient] sendSignal", sigType, "to", toPeerId);

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
