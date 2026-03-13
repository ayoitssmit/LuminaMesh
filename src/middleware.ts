import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req as any;
  const isLoggedIn = !!session;
  const { pathname } = nextUrl;

  const protectedPaths = ["/dashboard", "/profile", "/onboarding", "/room"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  // Not logged in → redirect to landing page, preserve destination as callbackUrl
  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname + nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in user without a name → MUST go to onboarding
  if (isLoggedIn && !session.user?.name && pathname !== "/onboarding") {
    const onboardingUrl = new URL("/onboarding", nextUrl);
    // Don't pass callbackUrl if they were just going to / or /dashboard anyway
    const skipPaths = ["/", "/dashboard"];
    if (!skipPaths.includes(pathname)) {
      onboardingUrl.searchParams.set("callbackUrl", pathname + nextUrl.search);
    }
    return NextResponse.redirect(onboardingUrl);
  }

  // Logged in user with a name trying to go to onboarding or landing page → send to dashboard
  if (isLoggedIn && session.user?.name && (pathname === "/" || pathname === "/onboarding")) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
