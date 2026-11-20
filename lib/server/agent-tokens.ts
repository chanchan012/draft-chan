import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { openDatabase } from "../../db/client";
import { floorplanAgentTokens, floorplans } from "../../db/schema";

export const agentName = z.string().trim().min(1).max(48);
const tokenPattern = /^draft_mcp_[A-Za-z0-9_-]{43}$/;
const expiresInMs = 7 * 24 * 60 * 60 * 1000;
const tokens = floorplanAgentTokens;
const details = {
  id: tokens.id,
  name: tokens.name,
  expiresAt: tokens.expiresAt,
};
export type AgentScope = { owner: string; planId: string; agentId: string };

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function owned(owner: string, id: string) {
  return and(eq(floorplans.id, id), eq(floorplans.ownerId, owner));
}

export async function listAgentTokens(owner: string, planId: string) {
  const rows = await openDatabase()
    .select({ token: details })
    .from(floorplans)
    .leftJoin(
      tokens,
      and(
        eq(floorplans.id, tokens.floorplanId),
        gt(tokens.expiresAt, new Date()),
      ),
    )
    .where(owned(owner, planId))
    .orderBy(desc(tokens.expiresAt));
  return rows.length
    ? rows.flatMap(({ token }) => (token ? [token] : []))
    : null;
}

export async function issueAgentToken(
  owner: string,
  planId: string,
  name: string,
) {
  const db = openDatabase();
  const token = "draft_mcp_" + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInMs);
  const plan = owned(owner, planId);
  // Authorize insertion against the same plan row used to scope the credential.
  const [created] = await db
    .insert(tokens)
    .select(
      db
        .select({
          id: sql`gen_random_uuid()`.as("id"),
          floorplanId: floorplans.id,
          name: sql`${name}::text`.as("name"),
          tokenHash: sql`${hash(token)}::text`.as("token_hash"),
          expiresAt: sql`${expiresAt.toISOString()}::timestamptz`.as(
            "expires_at",
          ),
        })
        .from(floorplans)
        .where(
          and(
            plan,
            sql`(select count(*) from ${tokens} where ${tokens.floorplanId} = ${floorplans.id} and ${tokens.expiresAt} > now()) < 16`,
          ),
        ),
    )
    .returning(details);
  if (created) {
    await db
      .delete(tokens)
      .where(
        and(eq(tokens.floorplanId, planId), lte(tokens.expiresAt, new Date())),
      )
      .catch(() => {});
    return { status: "created", credential: { ...created, token } } as const;
  }
  const [existing] = await db
    .select({ id: floorplans.id })
    .from(floorplans)
    .where(plan);
  return { status: existing ? "limit" : "missing" } as const;
}

export async function revokeAgentToken(
  owner: string,
  planId: string,
  id: string,
) {
  const db = openDatabase();
  const [revoked] = await db
    .delete(tokens)
    .where(
      and(
        eq(tokens.id, id),
        eq(tokens.floorplanId, planId),
        sql`exists (select 1 from ${floorplans} where ${owned(owner, planId)})`,
      ),
    )
    .returning({ id: tokens.id });
  return Boolean(revoked);
}

export async function authenticateAgent(
  token: string,
): Promise<AgentScope | null> {
  if (!tokenPattern.test(token)) return null;
  const [scope] = await openDatabase()
    .select({
      owner: floorplans.ownerId,
      planId: floorplans.id,
      agentId: tokens.id,
    })
    .from(tokens)
    .innerJoin(floorplans, eq(floorplans.id, tokens.floorplanId))
    .where(
      and(eq(tokens.tokenHash, hash(token)), gt(tokens.expiresAt, new Date())),
    );
  return scope ?? null;
}
