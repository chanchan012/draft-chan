import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import {
  floorplanClientGrants as clients,
  floorplanOAuthGrants as grants,
  floorplans,
} from "../../db/schema";
import type { AgentScope } from "./agent-tokens";

export async function floorplanOAuthState(owner: string, planId: string) {
  const [row] = await openDatabase()
    .select({ selected: grants.floorplanId })
    .from(floorplans)
    .leftJoin(grants, eq(grants.ownerId, floorplans.ownerId))
    .where(
      and(
        eq(floorplans.ownerId, owner),
        eq(floorplans.id, planId),
        isNull(floorplans.projectId),
      ),
    );
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
        .where(
          and(
            eq(floorplans.ownerId, owner),
            eq(floorplans.id, planId),
            isNull(floorplans.projectId),
          ),
        ),
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
  const result = await openDatabase().execute<{
    id: string;
    planId: string;
  }>(sql`
    WITH explicit AS (
      SELECT id, floorplan_id, enabled FROM public.floorplan_client_grants
      WHERE owner_id = ${owner} AND client_id = ${clientId}
    ), selected AS (
      SELECT id, floorplan_id FROM explicit WHERE enabled
      UNION ALL
      SELECT id, floorplan_id FROM public.floorplan_oauth_grants
      WHERE owner_id = ${owner} AND NOT EXISTS (SELECT 1 FROM explicit)
    )
    SELECT selected.id, floorplans.id AS "planId" FROM selected
    JOIN public.floorplans ON floorplans.id = selected.floorplan_id AND floorplans.owner_id = ${owner}
  `);
  const grant = result.rows[0];
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

export async function listClientGrants(owner: string, planId: string) {
  return openDatabase()
    .select({
      clientId: clients.clientId,
      floorplanId: clients.floorplanId,
      enabled: clients.enabled,
    })
    .from(clients)
    .where(and(eq(clients.ownerId, owner), eq(clients.floorplanId, planId)))
    .orderBy(clients.clientId);
}

export async function setClientGrant(
  owner: string,
  planId: string,
  clientId: string,
  enabled: boolean,
) {
  const result = await openDatabase().execute<{
    clientId: string;
    floorplanId: string;
    enabled: boolean;
  }>(sql`
    INSERT INTO public.floorplan_client_grants (owner_id, client_id, floorplan_id, enabled)
    SELECT owner_id, ${clientId}, id, ${enabled} FROM public.floorplans
    WHERE id = ${planId}::uuid AND owner_id = ${owner}
      AND (${enabled} OR EXISTS (
        SELECT 1 FROM public.floorplan_oauth_grants legacy WHERE legacy.owner_id = ${owner} AND legacy.floorplan_id = ${planId}::uuid
      ) OR EXISTS (
        SELECT 1 FROM public.floorplan_client_grants explicit WHERE explicit.owner_id = ${owner}
          AND explicit.client_id = ${clientId} AND explicit.floorplan_id = ${planId}::uuid
      ))
    ON CONFLICT (owner_id, client_id) DO UPDATE SET
      floorplan_id = EXCLUDED.floorplan_id, enabled = EXCLUDED.enabled,
      id = CASE WHEN floorplan_client_grants.floorplan_id = EXCLUDED.floorplan_id
                 AND floorplan_client_grants.enabled = EXCLUDED.enabled
           THEN floorplan_client_grants.id ELSE gen_random_uuid() END
    WHERE EXCLUDED.enabled OR floorplan_client_grants.floorplan_id = EXCLUDED.floorplan_id
    RETURNING client_id AS "clientId", floorplan_id AS "floorplanId", enabled
  `);
  return result.rows[0] ?? null;
}
