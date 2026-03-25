import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const history = await prisma.transferHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // BigInt is not JSON-serializable — convert fileSize to string
  const serializable = history.map((entry) => ({
    ...entry,
    fileSize: entry.fileSize.toString(),
  }));

  return NextResponse.json({ history: serializable });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { direction, fileName, fileSize, roomId, peers } = await req.json();

  if (!direction || !fileName || !roomId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const entry = await prisma.transferHistory.create({
    data: {
      userId: session.user.id,
      direction,
      fileName,
      fileSize: BigInt(fileSize || 0),
      roomId,
      peers: peers || [],
    },
  });

  return NextResponse.json({ success: true, id: entry.id });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    await prisma.transferHistory.delete({
      where: {
        id,
        userId: session.user.id,
      },
    });
  } else {
    await prisma.transferHistory.deleteMany({
      where: {
        userId: session.user.id,
      },
    });
  }

  return NextResponse.json({ success: true });
}
