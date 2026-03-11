import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req as any;
  const isLoggedIn = !!session;
  const { pathname } = nextUrl;

  const protectedPaths = ["/dashboard", "/profile", "/onboarding"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  // Not logged in → can't access protected pages
  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // Logged in + on landing page → send to dashboard
  if (isLoggedIn && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|room).*)"],
};
