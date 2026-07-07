import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic cookie check — redirects unauthenticated users to /login.
// Authoritative session validation still happens in the server components.
// (Next.js 16 renamed the "middleware" convention to "proxy".)
export function proxy(req: NextRequest) {
  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const url = new URL("/login", req.url);
    url.searchParams.set("redirect", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/dashboard/:path*", "/billing/:path*", "/onboarding/:path*"],
};
