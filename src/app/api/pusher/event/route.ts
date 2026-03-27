import { NextResponse } from "next/server";
import Pusher from "pusher";

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  useTLS: true,
});

export async function POST(req: Request) {
  try {
    const { channel, event, data, socketId, peerId } = await req.json();

    if (!channel || !event || !data || !peerId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Embed the original sender into the data object so the receiver knows who its from
    const payload = { ...data, from: peerId };

    // Broadcast the event over Pusher
    // We pass `socketId` to prevent the message from echoing back to the exact client that sent it
    await pusher.trigger(channel, event, payload, { socket_id: socketId });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Pusher Event API] Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
