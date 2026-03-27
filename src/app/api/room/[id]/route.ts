import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import jwt from "jsonwebtoken";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: Context) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
    }

    const { id: roomId } = await context.params;

    const fileMeta = await prisma.fileMetadata.findUnique({
      where: { roomId },
    });

    if (!fileMeta) {
      return NextResponse.json({ error: "Room or File not found" }, { status: 404 });
    }

    // Detect if the authenticated user is the original uploader (Seeder)
    const isSeeder = session.user.id === fileMeta.uploaderId;
    const peerId = isSeeder
      ? `seeder-${Math.random().toString(36).substring(2, 9)}`
      : `peer-${Math.random().toString(36).substring(2, 9)}`;
    const token = jwt.sign({ roomId, peerId, isSeeder }, process.env.JWT_SECRET!, {
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
