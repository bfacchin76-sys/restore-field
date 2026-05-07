import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (!pathname.startsWith("/app")) return NextResponse.next();

  const session = req.auth;
  if (!session?.user?.id || !session.user.active) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/app") {
      url.searchParams.set("next", pathname + search);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // Run on /app/* and /login (so we can redirect already-authed users away)
  matcher: ["/app/:path*", "/login"],
};
