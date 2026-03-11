import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req as any;
  const isLoggedIn = !!session;

  const protectedPaths = ["/dashboard", "/profile"];
  const isProtected = protectedPaths.some((p) =>
    nextUrl.pathname.startsWith(p)
  );

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // If logged in and on the landing page, redirect to dashboard
  if (isLoggedIn && nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|room).*)"],
};
