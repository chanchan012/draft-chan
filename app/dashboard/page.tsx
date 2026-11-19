import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { authModalHref } from "@/lib/auth-navigation";
import { Dashboard } from "@/components/dashboard";
import { clerkEnabled } from "@/lib/server/auth";
import "./dashboard.css";

export default async function DashboardPage() {
  if (!clerkEnabled()) redirect(authModalHref("sign-in", "/dashboard"));
  const session = await auth();
  if (!session.isAuthenticated)
    redirect(authModalHref("sign-in", "/dashboard"));
  return <Dashboard account={<UserButton />} />;
}
