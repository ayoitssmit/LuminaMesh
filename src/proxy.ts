import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./lib/redis";

// Rate limiter: 5 requests per 15 minutes per IP+endpoint
const authRateLimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  analytics: true,
});

const RATE_LIMITED_PATHS = [
  "/api/auth/callback/credentials",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/user/password",
];

export default auth(async (req) => {
  const { nextUrl, auth: session } = req as any;
  const isLoggedIn = !!session;
  const { pathname } = nextUrl;

  // Apply rate limiting to sensitive auth endpoints
  if (RATE_LIMITED_PATHS.some((p) => pathname.startsWith(p))) {
    const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
    const { success, limit, reset, remaining } = await authRateLimit.limit(
      `${ip}_${pathname}`
    );

    if (!success) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", limit.toString());
    response.headers.set("X-RateLimit-Remaining", remaining.toString());
    response.headers.set("X-RateLimit-Reset", reset.toString());
    return response;
  }

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
    const skipPaths = ["/", "/dashboard"];
    if (!skipPaths.includes(pathname)) {
      onboardingUrl.searchParams.set("callbackUrl", pathname + nextUrl.search);
    }
    return NextResponse.redirect(onboardingUrl);
  }

  // Logged in user with a name trying to go to onboarding or landing → send to dashboard
  if (isLoggedIn && session.user?.name && (pathname === "/" || pathname === "/onboarding")) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
