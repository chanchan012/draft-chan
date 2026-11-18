import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { clerkEnabled } from "./lib/server/auth";
const authenticate = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  return clerkEnabled() ? authenticate(request, event) : NextResponse.next();
}
export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
