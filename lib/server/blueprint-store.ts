import { and, eq, lt, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import { floorplanExports, floorplans } from "../../db/schema";
import type { BlueprintRequest } from "../plans/exports";
import { renderBlueprint } from "../plans/blueprints";
import { loadDraftPlan } from "../plans/plan-state";

const job = floorplanExports;
const summary = {
  id: job.id,
  revision: job.revision,
  format: job.format,
  status: job.status,
};
export type BlueprintAttempt = { id: string; attempt: number };

function ownedPlan(owner: string, id: string) {
  return and(eq(floorplans.id, id), eq(floorplans.ownerId, owner));
}

export async function requestBlueprint(
  owner: string,
  planId: string,
  input: BlueprintRequest,
) {
  const db = openDatabase();
  const plan = ownedPlan(owner, planId);
  // INSERT ... SELECT captures ownership, revision, name and graph in one statement.
  const [queued] = await db
    .insert(job)
    .select(
      db
        .select({
          id: sql`gen_random_uuid()`.as("id"),
          floorplanId: floorplans.id,
          revision: floorplans.revision,
          format: sql`${input.format}::blueprint_format`.as("format"),
          status: sql`'pending'::blueprint_status`.as("status"),
          attempt: sql`1`.as("attempt"),
          name: floorplans.name,
          snapshot: floorplans.graph,
          artifact: sql`NULL::text`.as("artifact"),
          requestedAt: sql`now()`.as("requested_at"),
        })
        .from(floorplans)
        .where(and(plan, eq(floorplans.revision, input.revision))),
    )
    .onConflictDoUpdate({
      target: [job.floorplanId, job.revision, job.format],
      set: {
        status: "pending",
        attempt: sql`${job.attempt} + 1`,
        requestedAt: sql`now()`,
      },
      setWhere: eq(job.status, "failed"),
    })
    .returning({ ...summary, attempt: job.attempt });
  if (queued) {
    const { attempt, ...blueprint } = queued;
    return {
      status: "accepted",
      blueprint,
      queue: { id: blueprint.id, attempt },
    } as const;
  }

  const [saved] = await db
    .select({ revision: floorplans.revision })
    .from(floorplans)
    .where(plan);
  if (!saved) return { status: "missing" } as const;
  if (saved.revision !== input.revision) return { status: "stale" } as const;
  const [existing] = await db
    .select(summary)
    .from(job)
    .innerJoin(floorplans, eq(floorplans.id, job.floorplanId))
    .where(
      and(
        plan,
        eq(floorplans.revision, input.revision),
        eq(job.revision, input.revision),
        eq(job.format, input.format),
      ),
    );
  return existing
    ? ({ status: "accepted", blueprint: existing, queue: null } as const)
    : ({ status: "stale" } as const);
}

export async function listBlueprints(
  owner: string,
  planId: string,
  revision: number,
) {
  const db = openDatabase();
  // Start from the plan so a missing owner and an empty export list remain distinct.
  const rows = await db
    .select({ blueprint: summary })
    .from(floorplans)
    .leftJoin(
      job,
      and(eq(job.floorplanId, floorplans.id), eq(job.revision, revision)),
    )
    .where(ownedPlan(owner, planId))
    .orderBy(job.format);
  return rows.length
    ? rows.flatMap(({ blueprint }) => (blueprint ? [blueprint] : []))
    : null;
}

export async function getBlueprintFile(
  owner: string,
  planId: string,
  id: string,
) {
  const [row] = await openDatabase()
    .select({
      revision: job.revision,
      format: job.format,
      name: job.name,
      artifact: job.artifact,
    })
    .from(job)
    .innerJoin(floorplans, eq(floorplans.id, job.floorplanId))
    .where(and(ownedPlan(owner, planId), eq(job.id, id)));
  return row ?? null;
}

function pending({ id, attempt }: BlueprintAttempt) {
  return and(
    eq(job.id, id),
    eq(job.attempt, attempt),
    eq(job.status, "pending"),
  );
}

export async function renderQueuedBlueprint(input: BlueprintAttempt) {
  const db = openDatabase();
  const [row] = await db
    .select({
      snapshot: job.snapshot,
      name: job.name,
      format: job.format,
      revision: job.revision,
    })
    .from(job)
    .where(pending(input));
  if (!row) return { written: false };
  const artifact = renderBlueprint(
    row.format,
    loadDraftPlan(row.snapshot),
    `${row.name} · Revision ${row.revision}`,
  );
  // Keep the Inngest step output small. The snapshot is replaced by the artifact.
  const written = await db
    .update(job)
    .set({ status: "ready", snapshot: null, artifact })
    .where(pending(input))
    .returning({ id: job.id });
  return { written: written.length > 0 };
}

export async function failBlueprint(input: BlueprintAttempt) {
  await openDatabase()
    .update(job)
    .set({ status: "failed" })
    .where(pending(input));
}

export function unconfirmedBlueprints() {
  return openDatabase()
    .select({ id: job.id, attempt: job.attempt })
    .from(job)
    .where(
      and(
        eq(job.status, "pending"),
        lt(job.requestedAt, new Date(Date.now() - 120_000)),
      ),
    )
    .orderBy(job.requestedAt)
    .limit(100);
}
