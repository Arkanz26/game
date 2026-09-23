import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

/** Optimistic check only: full session validation happens server-side on every request. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("silika_session");
  if (!hasSession && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  // Correlation id propagated to server code and the audit log.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", crypto.randomUUID());
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)"],
};
