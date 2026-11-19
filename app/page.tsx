import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Home } from "@/components/home";
import { clerkEnabled } from "@/lib/server/auth";
import { returnPath } from "@/lib/auth-navigation";

type Search = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const query = await searchParams;
  const configured = clerkEnabled();
  const signedIn = configured && (await auth()).isAuthenticated;
  const mode =
    query.auth === "sign-in" || query.auth === "sign-up" ? query.auth : null;
  const returnTo = returnPath(query.returnTo);
  if (mode && signedIn) redirect(returnTo ?? "/dashboard");

  return (
    <Home
      signedIn={signedIn}
      authConfigured={configured}
      authMode={mode}
      returnTo={returnTo}
    />
  );
}
