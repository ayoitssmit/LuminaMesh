import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.passwordHash) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    } else {
      return NextResponse.json({ error: "Account exists via Google or GitHub. Please log in using that provider." }, { status: 409 });
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash },
  });

  // Generate an Email Verification Token
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });

  console.log(`\n===========================================`);
  console.log(`EMAIL VERIFICATION LINK (LOCAL TESTING)`);
  console.log(`Email: ${email}`);
  console.log(`Link: http://localhost:3000/api/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`);
  console.log(`===========================================\n`);

  return NextResponse.json({ success: true, message: "Verification required. Check server console for link." });
}
