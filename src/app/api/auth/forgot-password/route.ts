import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Return success to avoid leaking which emails exist
    return NextResponse.json({ success: true, message: "If an account exists, a reset link will be sent." });
  }

  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  
  // Clean up any existing tokens for this user
  await prisma.verificationToken.deleteMany({
    where: { identifier: `reset-${email}` },
  });

  await prisma.verificationToken.create({
    data: {
      identifier: `reset-${email}`,
      token,
      expires: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour for resets
    },
  });

  // Since we don't have an email provider, log the token
  console.log(`\n===========================================`);
  console.log(`PASSWORD RESET LINK (LOCAL TESTING)`);
  console.log(`Email: ${email}`);
  console.log(`Link: http://localhost:3000/api/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`);
  console.log(`===========================================\n`);

  return NextResponse.json({ success: true, message: "If an account exists, a reset link will be sent (check console)." });
}
