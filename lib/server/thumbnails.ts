import { Inngest } from "inngest";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { openDatabase } from "../../db/client";
import { floorplans } from "../../db/schema";
import { thumbnailSvg } from "../plans/geometry";

export const inngest = new Inngest({ id: "draft-cad-studio" });
export const thumbnailEvent = "draft/floorplan.thumbnail.requested";
export function queueThumbnail(id: string) {
  return inngest.send({ name: thumbnailEvent, data: { id } });
}
export async function renderThumbnail(id: string) {
  const db = openDatabase();
  const [plan] = await db
    .select({ graph: floorplans.graph, revision: floorplans.revision })
    .from(floorplans)
    .where(and(eq(floorplans.id, id), isNull(floorplans.thumbnail)));
  if (!plan) return { written: false };
  const rows = await db
    .update(floorplans)
    .set({ thumbnail: thumbnailSvg(plan.graph) })
    .where(
      and(
        eq(floorplans.id, id),
        eq(floorplans.revision, plan.revision),
        isNull(floorplans.thumbnail),
      ),
    )
    .returning({ id: floorplans.id });
  return { written: rows.length > 0 };
}
export const thumbnailJob = inngest.createFunction(
  { id: "render-floorplan-thumbnail", retries: 4 },
  { event: thumbnailEvent },
  async ({ event, step }) => {
    const id = z.uuid().parse(event.data.id);
    return step.run("render-and-save", () => renderThumbnail(id));
  },
);
// Recover plans persisted immediately before an event delivery failure.
export const recoverThumbnails = inngest.createFunction(
  { id: "recover-pending-thumbnails" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const pending = await step.run("find-pending", () =>
      openDatabase()
        .select({ id: floorplans.id })
        .from(floorplans)
        .where(isNull(floorplans.thumbnail))
        .orderBy(floorplans.createdAt)
        .limit(100),
    );
    if (pending.length)
      await step.sendEvent(
        "request-thumbnails",
        pending.map((data) => ({ name: thumbnailEvent, data })),
      );
    return { count: pending.length };
  },
);
