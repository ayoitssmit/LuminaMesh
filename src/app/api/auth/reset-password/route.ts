import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, token, newPassword } = await req.json();

  if (!email || !token || !newPassword) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const verificationToken = await prisma.verificationToken.findUnique({
    where: {
      identifier_token: {
        identifier: `reset-${email}`,
        token,
      },
    },
  });

  if (!verificationToken) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  if (new Date() > verificationToken.expires) {
    await prisma.verificationToken.delete({
      where: { identifier_token: { identifier: `reset-${email}`, token } },
    });
    return NextResponse.json({ error: "Token has expired" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { email },
    data: { passwordHash },
  });

  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: `reset-${email}`, token } },
  });

  return NextResponse.json({ success: true, message: "Password reset correctly." });
}
