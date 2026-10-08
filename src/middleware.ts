import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const hostname = host.replace(/:\d+$/, "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    return NextResponse.json({ error: "Probator only accepts loopback requests." }, { status: 403 });
  }
  if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host.toLowerCase() !== host) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
      } catch {
        return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
      }
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
