import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { openDatabase } from "../../db/client";
import {
  floorplans,
  floorplanProjectMembers as members,
  floorplanReviewNotes as notes,
} from "../../db/schema";
import { areaM2 } from "../plans/geometry";
import { summarizeChanges } from "../plans/change-summary";
import type { DraftActor } from "../plans/model";
import type {
  optionInput,
  restoreInput,
  reviewInput,
  ProjectOption,
  ProjectDetails,
  ProjectRole,
  RevisionEntry,
} from "../plans/projects";
import { planPermission, type ProjectAccess } from "./project-access";
import { revisionStore } from "./revision-store";

const optionFields = {
  id: floorplans.id,
  name: floorplans.name,
  revision: floorplans.revision,
  forkFromPlanId: floorplans.forkFromPlanId,
  forkFromRevision: floorplans.forkFromRevision,
};

export async function projectDetails(
  access: ProjectAccess,
): Promise<ProjectDetails> {
  const db = openDatabase();
  const [options, roster] = await Promise.all([
    db
      .select(optionFields)
      .from(floorplans)
      .where(
        and(
          eq(floorplans.ownerId, access.owner),
          or(
            eq(floorplans.id, access.projectId),
            eq(floorplans.projectId, access.projectId),
          ),
        ),
      )
      .orderBy(
        sql`${floorplans.projectId} nulls first`,
        asc(floorplans.name),
        asc(floorplans.id),
      ),
    access.role === "owner"
      ? db
          .select({ userId: members.userId, role: members.role })
          .from(members)
          .where(eq(members.projectId, access.projectId))
          .orderBy(members.userId)
      : undefined,
  ]);
  return {
    projectId: access.projectId,
    role: access.role,
    options,
    ...(roster && { members: roster }),
  };
}

export async function setProjectMember(
  access: ProjectAccess,
  userId: string,
  role: Exclude<ProjectRole, "owner">,
) {
  if (access.role !== "owner" || userId === access.owner) return false;
  await openDatabase()
    .insert(members)
    .values({ projectId: access.projectId, userId, role })
    .onConflictDoUpdate({
      target: [members.projectId, members.userId],
      set: { role },
    });
  return true;
}

export async function removeProjectMember(
  access: ProjectAccess,
  userId: string,
) {
  if (access.role !== "owner") return false;
  await openDatabase()
    .delete(members)
    .where(
      and(eq(members.projectId, access.projectId), eq(members.userId, userId)),
    );
  return true;
}

type Scope = { owner: string; planId: string };
function register(
  which: Scope,
  humanId?: string,
  permission: "edit" | "review" = "edit",
) {
  return and(
    eq(floorplans.id, which.planId),
    eq(floorplans.ownerId, which.owner),
    humanId ? planPermission(humanId, permission) : undefined,
  );
}

export async function createDesignOption(
  scope: Scope,
  input: z.infer<typeof optionInput>,
  humanId?: string,
) {
  const result = await openDatabase().execute<ProjectOption>(sql`
    WITH source AS (
      SELECT id, owner_id, coalesce(project_id, id) AS project_id, revision, unit, graph
      FROM public.floorplans WHERE ${register(scope, humanId)}
    ), snapshot AS (
      SELECT source.id, source.owner_id, source.project_id, source.unit, source.graph
        FROM source WHERE revision = ${input.sourceRevision}
      UNION ALL
      SELECT source.id, source.owner_id, source.project_id, history.unit, history.graph
        FROM source JOIN public.floorplan_revisions history ON history.floorplan_id = source.id
        WHERE history.revision = ${input.sourceRevision}
    ), inserted AS (
      INSERT INTO public.floorplans (id, owner_id, project_id, fork_from_plan_id, fork_from_revision, name, unit, graph)
      SELECT ${input.id}::uuid, owner_id, project_id, id, ${input.sourceRevision}, ${input.name},
        unit, graph || jsonb_build_object('coordination', coalesce(
          (SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(coalesce(graph->'coordination', '[]'::jsonb))
            WITH ORDINALITY AS items(value, ord) WHERE value->>'kind' <> 'issue'), '[]'::jsonb))
      FROM snapshot ON CONFLICT (id) DO NOTHING
      RETURNING id, name, revision, fork_from_plan_id, fork_from_revision
    ), replay AS (
      SELECT alternative.id, alternative.name, alternative.revision, alternative.fork_from_plan_id, alternative.fork_from_revision
      FROM snapshot JOIN public.floorplans alternative ON alternative.project_id = snapshot.project_id
        AND alternative.owner_id = snapshot.owner_id AND alternative.id = ${input.id}::uuid
        AND alternative.fork_from_plan_id = snapshot.id AND alternative.fork_from_revision = ${input.sourceRevision}
        AND alternative.name = ${input.name}
    )
    SELECT id, name, revision, fork_from_plan_id AS "forkFromPlanId", fork_from_revision AS "forkFromRevision" FROM inserted
    UNION ALL
    SELECT id, name, revision, fork_from_plan_id, fork_from_revision FROM replay WHERE NOT EXISTS (SELECT 1 FROM inserted)
  `);
  return result.rows[0] ?? null;
}

export async function listPlanRevisions(scope: Scope, before?: number) {
  const result = await openDatabase().execute<RevisionEntry>(sql`
    WITH selected AS (
      SELECT id, revision, name FROM public.floorplans WHERE ${register(scope)}
    ), versions AS (
      SELECT id, revision, name FROM selected
      UNION ALL
      SELECT selected.id, history.revision, history.name
      FROM selected JOIN public.floorplan_revisions history ON history.floorplan_id = selected.id
    )
    SELECT versions.revision, versions.name, restored.source_revision AS "sourceRevision",
        restored.actor_kind AS "actorKind", restored.actor_id AS "actorId",
        restored.restored_at AS "restoredAt"
    FROM versions LEFT JOIN public.floorplan_revision_restores restored
      ON restored.floorplan_id = versions.id AND restored.revision = versions.revision
    ${before === undefined ? sql.empty() : sql`WHERE versions.revision < ${before}`}
    ORDER BY versions.revision DESC LIMIT 40
  `);
  return result.rows;
}

export async function restorePlanRevision(
  scope: Scope,
  input: z.infer<typeof restoreInput>,
  actor: DraftActor,
) {
  if (input.sourceRevision >= input.expectedRevision) return null;
  const result = await openDatabase().execute<{
    revision: number;
    sourceRevision: number;
  }>(sql`
    WITH saved AS (
      UPDATE public.floorplans SET graph = history.graph, unit = history.unit,
        revision = public.floorplans.revision + 1, thumbnail = NULL, updated_at = now()
      FROM public.floorplan_revisions history
      WHERE ${register(scope, actor.kind === "human" ? actor.id : undefined)}
        AND public.floorplans.revision = ${input.expectedRevision}
        AND history.floorplan_id = public.floorplans.id AND history.revision = ${input.sourceRevision}
      RETURNING public.floorplans.id, public.floorplans.revision
    )
    INSERT INTO public.floorplan_revision_restores (floorplan_id, revision, source_revision, actor_kind, actor_id)
    SELECT id, revision, ${input.sourceRevision}, ${actor.kind}::project_actor_kind, ${actor.id} FROM saved
    RETURNING revision, source_revision AS "sourceRevision"
  `);
  return result.rows[0] ?? null;
}

export async function listReviewNotes(scope: Scope) {
  const rows = await openDatabase()
    .select()
    .from(notes)
    .innerJoin(floorplans, eq(floorplans.id, notes.floorplanId))
    .where(register(scope))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(50);
  return rows.map(({ floorplan_review_notes: note }) => ({
    ...note,
    createdAt: note.createdAt.toISOString(),
  }));
}

export async function writeReviewNote(
  scope: Scope,
  input: z.infer<typeof reviewInput>,
  kind: "comment" | "request",
  actor: DraftActor,
) {
  const gate = register(
    scope,
    actor.kind === "human" ? actor.id : undefined,
    kind === "request" ? "edit" : "review",
  );
  const result = await openDatabase().execute<{ id: string }>(sql`
    WITH allowed AS (
      SELECT id FROM public.floorplans WHERE ${gate} AND (revision = ${input.revision} OR EXISTS (
        SELECT 1 FROM public.floorplan_revisions history
        WHERE history.floorplan_id = public.floorplans.id AND history.revision = ${input.revision}
      ))
    ), inserted AS (
      INSERT INTO public.floorplan_review_notes (id, floorplan_id, revision, actor_kind, actor_id, kind, body)
      SELECT ${input.id}::uuid, id, ${input.revision}, ${actor.kind}::project_actor_kind, ${actor.id}, ${kind}, ${input.body}
      FROM allowed ON CONFLICT (id) DO NOTHING RETURNING id
    )
    SELECT id FROM inserted
    UNION ALL
    SELECT note.id FROM allowed JOIN public.floorplan_review_notes note ON note.floorplan_id = allowed.id
      WHERE note.id = ${input.id}::uuid AND note.revision = ${input.revision} AND note.actor_kind = ${actor.kind}::project_actor_kind
        AND note.actor_id = ${actor.id} AND note.kind = ${kind} AND note.body = ${input.body}
        AND NOT EXISTS (SELECT 1 FROM inserted)
  `);
  return result.rows[0] ?? null;
}

export async function compareDesignOptions(
  before: Scope & { revision: number },
  after: Scope & { revision: number },
) {
  const [earlier, later] = await Promise.all([
    revisionStore.revisions(before, before.revision, before.revision),
    revisionStore.revisions(after, after.revision, after.revision),
  ]);
  if (!earlier[0] || !later[0]) return null;
  const summary = summarizeChanges(earlier[0].graph, later[0].graph);
  const changeCounts = { added: 0, updated: 0, removed: 0 };
  for (const change of summary.changes)
    changeCounts[change.action as keyof typeof changeCounts]++;
  return {
    before: {
      id: before.planId,
      revision: before.revision,
      areaM2: areaM2(earlier[0].graph),
    },
    after: {
      id: after.planId,
      revision: after.revision,
      areaM2: areaM2(later[0].graph),
    },
    changeCounts,
    changes: summary.changes
      .slice(0, 200)
      .map(({ id, kind, action }) => ({ id, kind, action })),
    truncated: summary.changes.length > 200,
  };
}
