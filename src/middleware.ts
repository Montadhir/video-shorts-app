import { NextResponse, type NextRequest } from "next/server";

// If ACCESS_PASSWORD is set, every page and API route asks for it (browser login box).
// If it isn't set (normal local dev), everything stays open.
export function middleware(request: NextRequest) {
  const password = process.env.ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given === password) return NextResponse.next();
    } catch {
      // fall through to the login prompt
    }
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Shorts Generator"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
