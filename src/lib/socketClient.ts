import Pusher from "pusher-js";
import { PeerManager } from "./peerManager";

export type SocketClientEvents = {
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onPeerJoined: (peerId: string) => void;
  onPeerLeft: (peerId: string) => void;
};

/**
 * Signaling via Pusher Channels instead of Socket.IO
 * Connects using the public pusher key, and authenticates via /api/pusher/auth
 */
export class SocketClient {
  private pusher: Pusher | null = null;
  private channel: any = null;
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
   * Connect to Pusher and subscribe to the room channel 
   */
  connect(roomToken: string): void {
    if (this.pusher) {
      this.disconnect();
    }

    // Decode token strictly to extract the roomId (normally done on backend, but we need it for channel name)
    let roomId = "";
    try {
      const payloadBase64 = roomToken.split('.')[1];
      const decodedPayload = JSON.parse(atob(payloadBase64));
      roomId = decodedPayload.roomId;
    } catch(e) {
      console.error("Failed to extract roomId from token", e);
      this.events.onError("Invalid room token");
      return;
    }

    this.pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      authEndpoint: "/api/pusher/auth",
      auth: {
        headers: {
          Authorization: `Bearer ${roomToken}`
        }
      }
    });

    this.pusher.connection.bind("connected", () => {
      console.log("[Pusher] Connected, my peerId:", this.myPeerId);
      this.events.onConnected();
    });

    this.pusher.connection.bind("error", (err: any) => {
      console.error("[Pusher] Connect error:", err);
      // Suppress specific pusher internal errors from spamming the UI if they aren't fatal
      if (err?.error?.data?.code !== 4004) {
        this.events.onError(err.message || "Connection error");
      }
    });

    this.pusher.connection.bind("disconnected", () => {
      console.log("[Pusher] Disconnected");
      this.events.onDisconnected();
    });

    // We must use a presence channel to get the "existing peers" list when we join
    this.channel = this.pusher.subscribe(`presence-room-${roomId}`);

    this.channel.bind("pusher:subscription_succeeded", (members: any) => {
       console.log("[Pusher] Joined room. Existing peers:", members.count);
       
       // Loop through all members currently in the channel (excluding ourselves)
       members.each((member: any) => {
          if (member.id !== this.myPeerId && !this.peerManager.hasPeer(member.id)) {
             this.events.onPeerJoined(member.id);
             // Full-mesh: we initiate to everyone already in the room
             this.peerManager.createPeer(member.id, true);
          }
       });
    });

    this.channel.bind("pusher:subscription_error", (status: number) => {
      console.error("[Pusher] Subscription error:", status);
      this.events.onError(`Failed to join room: ${status}`);
    });

    this.channel.bind("pusher:member_added", (member: any) => {
      console.log("[Pusher] peer-joined:", member.id);
      if (this.peerManager.hasPeer(member.id)) {
        return;
      }
      this.events.onPeerJoined(member.id);
      // We do not initiate here; the newly joined member will initiate to us via subscription_succeeded
    });

    this.channel.bind("pusher:member_removed", (member: any) => {
      console.log("[Pusher] peer-disconnected:", member.id);
      this.peerManager.destroyPeer(member.id);
      this.events.onPeerLeft(member.id);
    });

    // Listen for WebRTC Signaling Events
    // In Pusher, these can be custom events broadcasted via the backend, or Client Events if enabled
    // We are routing them through an API endpoint to avoid enabling client-events on the public dashboard
    this.channel.bind("signal-offer", (data: { from: string; to: string; offer: any }) => {
      if (data.to !== this.myPeerId) return;
      console.log("[Pusher] offer from:", data.from);
      if (!this.peerManager.hasPeer(data.from)) {
        this.peerManager.createPeer(data.from, false);
      }
      this.peerManager.signal(data.from, data.offer);
    });

    this.channel.bind("signal-answer", (data: { from: string; to: string; answer: any }) => {
      if (data.to !== this.myPeerId) return;
      console.log("[Pusher] answer from:", data.from);
      this.peerManager.signal(data.from, data.answer);
    });

    this.channel.bind("signal-ice", (data: { from: string; to: string; candidate: any }) => {
      if (data.to !== this.myPeerId) return;
      // console.log("[Pusher] ice-candidate from:", data.from);
      this.peerManager.signal(data.from, data.candidate);
    });
  }

  /**
   * Send signaling data to a specific peer via a Next.js Serverless API Route.
   */
  sendSignal(toPeerId: string, signalData: any): void {
    if (!this.pusher || !this.channel) return;

    let eventName = "signal-ice";
    let payload = { to: toPeerId, candidate: signalData };

    if (signalData.type === "offer") {
      eventName = "signal-offer";
      payload = { to: toPeerId, offer: signalData } as any;
    } else if (signalData.type === "answer") {
      eventName = "signal-answer";
      payload = { to: toPeerId, answer: signalData } as any;
    }

    // Call Next.js API to broadcast the message to the Pusher channel
    fetch("/api/pusher/event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel: this.channel.name,
        event: eventName,
        data: payload,
        socketId: this.pusher.connection.socket_id, // Prevent echoing back to sender
        peerId: this.myPeerId
      })
    }).catch(err => console.error("[Pusher] Failed to send signal node", err));
  }

  /**
   * Disconnect from Pusher and tear down WebRTC peers.
   */
  disconnect(): void {
    this.peerManager.destroyAll();
    if (this.channel) {
      this.channel.unbind();
    }
    if (this.pusher) {
      this.pusher.unsubscribe(this.channel.name);
      this.pusher.disconnect();
      this.pusher = null;
      this.channel = null;
    }
  }

  isConnected(): boolean {
    return !!this.pusher && this.pusher.connection.state === "connected";
  }
}
