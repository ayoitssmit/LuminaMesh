import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
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
    const data = await req.formData();
    const socketId = data.get("socket_id") as string;
    const channelName = data.get("channel_name") as string;
    
    // Extract token from pusher-js bearer auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.split(" ")[1];

    // Decode and verify the JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { roomId: string, peerId: string };

    // Prevent cross-room access
    if (`presence-room-${decoded.roomId}` !== channelName) {
      return NextResponse.json({ error: "Forbidden: Not your room" }, { status: 403 });
    }

    // Authorize the presence channel connection
    // We attach the `peerId` as the unique user ID within this presence channel
    const presenceData = {
      user_id: decoded.peerId,
      user_info: {
        isSeeder: decoded.peerId.startsWith("seeder")
      }
    };

    const authResponse = pusher.authorizeChannel(socketId, channelName, presenceData);
    return NextResponse.json(authResponse);

  } catch (err: any) {
    console.error("[Pusher Auth API] Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
