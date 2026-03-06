import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import jwt from "jsonwebtoken";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: Context) {
  try {
    const { id: roomId } = await context.params;

    const fileMeta = await prisma.fileMetadata.findUnique({
      where: { roomId },
    });

    if (!fileMeta) {
      return NextResponse.json({ error: "Room or File not found" }, { status: 404 });
    }

    // Generate a secure JWT for the downloade/leecher to join this specific room
    const peerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
    const token = jwt.sign({ roomId, peerId, isSeeder: false }, process.env.JWT_SECRET!, {
      expiresIn: "24h",
    });

    return NextResponse.json({
      success: true,
      room: {
        roomId: fileMeta.roomId,
        file: {
          name: fileMeta.name,
          size: fileMeta.size.toString(), // BigInt cannot be directly JSON stringified
          masterHash: fileMeta.masterHash,
          chunkCount: fileMeta.chunkCount,
          mimeType: fileMeta.mimeType,
        },
      },
      peerId,
      token,
    });

  } catch (error) {
    console.error("[Room API Error]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
