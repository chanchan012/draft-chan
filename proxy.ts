import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import {
  authModalHref,
  privatePath,
  type AuthMode,
} from "./lib/auth-navigation";
import { clerkEnabled } from "./lib/server/auth";

function openSignIn(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(
    new URL(authModalHref("sign-in", pathname + search), request.url),
  );
}

const authenticate = clerkMiddleware(async (auth, request) => {
  if (
    privatePath(request.nextUrl.pathname) &&
    !(await auth()).isAuthenticated
  ) {
    return openSignIn(request);
  }
});

function legacyMode(path: string): AuthMode | undefined {
  const route = path.split("/")[1];
  if (route === "sign-in" || route === "sign-up") return route;
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, searchParams, origin } = request.nextUrl;
  const mode = legacyMode(pathname);
  if (mode) {
    let target = searchParams.get("returnTo");
    const previous = searchParams.get("redirect_url");
    if (!target && previous) {
      const url = URL.parse(previous, origin);
      if (url?.origin === origin) target = url.pathname + url.search + url.hash;
    }
    return NextResponse.redirect(
      new URL(authModalHref(mode, target ?? undefined), request.url),
    );
  }
  if (clerkEnabled()) return authenticate(request, event);
  if (privatePath(pathname)) return openSignIn(request);
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/studio/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/((?!api|_next|.*\\..*).*)",
  ],
};
