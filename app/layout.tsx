import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
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
            signInUrl="/sign-in"
            signUpUrl="/sign-up"
            signInFallbackRedirectUrl="/?view=sample"
            signUpFallbackRedirectUrl="/?view=sample"
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
