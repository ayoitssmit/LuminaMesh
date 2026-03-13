import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, size, masterHash, chunkCount, mimeType } = body;

    // Validate required fields
    if (!name || size === undefined || !masterHash || chunkCount === undefined) {
      return NextResponse.json({ error: "Missing required manifest fields" }, { status: 400 });
    }

    // Since we don't have full user auth yet, create or get an "Anonymous" user
    let user = await prisma.user.findFirst({ where: { email: "anon@luminamesh.local" } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "anon@luminamesh.local",
          name: "Anonymous Uploader",
        },
      });
    }

    // Create the FileMetadata and generate a Room ID
    const fileMeta = await prisma.fileMetadata.create({
      data: {
        name,
        size: BigInt(size),
        masterHash,
        chunkCount,
        mimeType,
        uploaderId: user.id,
      },
    });

    // Generate an 8-character alphanumeric room ID and ensure it is unique
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let roomId = '';
    let isUnique = false;
    
    while (!isUnique) {
      roomId = Array.from({ length: 8 })
        .map(() => characters.charAt(Math.floor(Math.random() * characters.length)))
        .join('');
      
      const existingRoom = await prisma.fileMetadata.findUnique({
        where: { roomId }
      });
      
      if (!existingRoom) {
        isUnique = true;
      }
    }

    // Update the record with the generated short code
    await prisma.fileMetadata.update({
      where: { id: fileMeta.id },
      data: { roomId },
    });

    // Generate a secure JWT for the uploader to join this specific room
    // The uploader is the "seeder", so their peerId can be special or generated
    const peerId = `seeder-${Math.random().toString(36).substring(2, 9)}`;
    const token = jwt.sign({ roomId, peerId, isSeeder: true }, process.env.JWT_SECRET!, {
      expiresIn: "24h",
    });

    return NextResponse.json({
      success: true,
      roomId,
      peerId,
      token,
      fileId: fileMeta.id,
    });

  } catch (error) {
    console.error("[Upload API Error]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
