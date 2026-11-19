import { and, desc, eq, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import { floorplans } from "../../db/schema";
import {
  areaM2,
  initialGraph,
  newPlan,
  type PlanCard,
} from "../plans/geometry";
import type { z } from "zod";

type Row = typeof floorplans.$inferSelect;
function card(row: Row): PlanCard {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    thumbnail: row.thumbnail,
    areaM2: areaM2(row.graph),
  };
}
function owned(owner: string, id: string) {
  return and(eq(floorplans.ownerId, owner), eq(floorplans.id, id));
}
export const plans = {
  async list(owner: string) {
    const rows = await openDatabase()
      .select()
      .from(floorplans)
      .where(eq(floorplans.ownerId, owner))
      .orderBy(desc(floorplans.updatedAt), desc(floorplans.id));
    return rows.map(card);
  },
  async get(owner: string, id: string) {
    const [row] = await openDatabase()
      .select()
      .from(floorplans)
      .where(owned(owner, id));
    return row ? card(row) : null;
  },
  async create(owner: string, input: z.infer<typeof newPlan>) {
    const [row] = await openDatabase()
      .insert(floorplans)
      .values({
        id: input.id,
        name: input.name,
        ownerId: owner,
        graph: initialGraph(input.room, { kind: "human", id: owner }),
      })
      .onConflictDoNothing()
      .returning();
    return row ? card(row) : this.get(owner, input.id);
  },
  async rename(owner: string, id: string, revision: number, name: string) {
    const [row] = await openDatabase()
      .update(floorplans)
      .set({
        name,
        revision: sql`${floorplans.revision}+1`,
        updatedAt: new Date(),
      })
      .where(and(owned(owner, id), eq(floorplans.revision, revision)))
      .returning();
    return row ? card(row) : null;
  },
  async remove(owner: string, id: string, revision: number) {
    const rows = await openDatabase()
      .delete(floorplans)
      .where(and(owned(owner, id), eq(floorplans.revision, revision)))
      .returning({ id: floorplans.id });
    return rows.length > 0;
  },
};
