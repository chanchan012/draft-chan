import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { authModalHref } from "@/lib/auth-navigation";
import { clerkEnabled } from "@/lib/server/auth";
import "./globals.css";
export const metadata: Metadata = {
  title: "Draft — Collaborative CAD Studio",
  description: "A parametric floorplan studio for humans and AI.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {clerkEnabled() ? (
          <ClerkProvider
            signInUrl={authModalHref("sign-in")}
            signUpUrl={authModalHref("sign-up")}
            signInFallbackRedirectUrl="/dashboard"
            signUpFallbackRedirectUrl="/dashboard"
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
