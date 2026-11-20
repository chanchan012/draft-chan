import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import { floorplanOAuthGrants as grants, floorplans } from "../../db/schema";
import type { AgentScope } from "./agent-tokens";

export async function floorplanOAuthState(owner: string, planId: string) {
  const [row] = await openDatabase()
    .select({ selected: grants.floorplanId })
    .from(floorplans)
    .leftJoin(grants, eq(grants.ownerId, floorplans.ownerId))
    .where(and(eq(floorplans.ownerId, owner), eq(floorplans.id, planId)));
  if (!row) return null;
  if (row.selected === planId) return "enabled";
  return row.selected ? "other_plan" : "disabled";
}

export async function enableFloorplanOAuth(owner: string, planId: string) {
  const db = openDatabase();
  const [selected] = await db
    .insert(grants)
    .select(
      db
        .select({
          ownerId: floorplans.ownerId,
          id: sql`gen_random_uuid()`.as("id"),
          floorplanId: floorplans.id,
        })
        .from(floorplans)
        .where(and(eq(floorplans.ownerId, owner), eq(floorplans.id, planId))),
    )
    .onConflictDoNothing({ target: grants.ownerId })
    .returning({ id: grants.id });
  return selected ? "enabled" : await floorplanOAuthState(owner, planId);
}

export async function disableFloorplanOAuth(owner: string, planId: string) {
  await openDatabase()
    .delete(grants)
    .where(and(eq(grants.ownerId, owner), eq(grants.floorplanId, planId)));
}

export async function resolveFloorplanOAuth(
  owner: string,
  clientId: string,
): Promise<AgentScope | null> {
  const [grant] = await openDatabase()
    .select({ id: grants.id, planId: grants.floorplanId })
    .from(grants)
    .innerJoin(
      floorplans,
      and(
        eq(grants.floorplanId, floorplans.id),
        eq(grants.ownerId, floorplans.ownerId),
      ),
    )
    .where(eq(grants.ownerId, owner));
  if (!grant) return null;

  // UUIDv8 makes each Clerk client's cursor stable for this floorplan grant.
  const bytes = createHash("sha256")
    .update(grant.id)
    .update("\0")
    .update(clientId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  const agentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { owner, planId: grant.planId, agentId };
}
