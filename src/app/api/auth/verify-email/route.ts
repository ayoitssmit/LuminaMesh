import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");

  if (!token || !email) {
    return NextResponse.json({ error: "Missing token or email" }, { status: 400 });
  }

  const verificationToken = await prisma.verificationToken.findUnique({
    where: {
      identifier_token: {
        identifier: email,
        token,
      },
    },
  });

  if (!verificationToken) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  if (new Date() > verificationToken.expires) {
    // Optionally delete it
    await prisma.verificationToken.delete({
      where: {
        identifier_token: { identifier: email, token },
      },
    });
    return NextResponse.json({ error: "Token has expired" }, { status: 400 });
  }

  // Verify the user
  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });

  // Clean up token
  await prisma.verificationToken.delete({
    where: {
      identifier_token: { identifier: email, token },
    },
  });

  return NextResponse.json({ success: true, message: "Email verified successfully. You can now log in." });
}
