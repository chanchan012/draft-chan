import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { clerkEnabled } from "./lib/server/auth";

function isPrivate(request: NextRequest) {
  return /^\/(dashboard|studio)(\/|$)/.test(request.nextUrl.pathname);
}

const authenticate = clerkMiddleware(async (auth, request) => {
  if (!isPrivate(request)) return;
  const session = await auth();
  if (!session.isAuthenticated) return session.redirectToSignIn();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (clerkEnabled()) return authenticate(request, event);
  if (isPrivate(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/studio/:path*",
    "/((?!api|_next|.*\\..*).*)",
  ],
};
