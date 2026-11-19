import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Studio } from "@/components/studio/studio";
import { authModalHref } from "@/lib/auth-navigation";
import { clerkEnabled } from "@/lib/server/auth";
import { plans } from "@/lib/server/plans";
import "./studio.css";

export default async function StudioPage({
  params,
}: PageProps<"/studio/[id]">) {
  const { id } = await params;
  if (!clerkEnabled())
    redirect(authModalHref("sign-in", "/studio/" + encodeURIComponent(id)));
  const session = await auth();
  if (!session.isAuthenticated)
    redirect(authModalHref("sign-in", "/studio/" + encodeURIComponent(id)));
  if (!z.uuid().safeParse(id).success) notFound();
  const document = await plans.getStudio(session.userId, id);
  if (!document) notFound();
  return (
    <Studio initial={document} actor={{ kind: "human", id: session.userId }} />
  );
}
