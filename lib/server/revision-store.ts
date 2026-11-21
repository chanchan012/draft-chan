import { and, eq, sql } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import { floorplanEditBatches, floorplans } from "../../db/schema";
import { loadDraftPlan } from "../plans/plan-state";
import type { DraftPlanState, DisplayUnit } from "../plans/model";
import type { StudioDocument } from "../plans/studio-document";
import type { AgentScope } from "./agent-tokens";

export type BatchReceipt = {
  planId: string;
  batchId: string;
  baseRevision: number;
  revision: number;
  summary: ReturnType<
    typeof import("../plans/change-summary").summarizeChanges
  >;
};
type VersionRow = {
  revision: number;
  name: string;
  unit: DisplayUnit;
  graph: unknown;
};
type Queries = {
  getReceipt(scope: AgentScope, id: string): Promise<BatchReceipt | null>;
  commit(
    scope: AgentScope,
    document: StudioDocument,
    graph: DraftPlanState,
    receipt: BatchReceipt,
  ): Promise<boolean>;
  revisions(
    scope: AgentScope,
    from: number,
    to: number,
  ): Promise<StudioDocument[]>;
};

export const revisionStore: Queries = {
  async getReceipt({ owner, planId, agentId }, id) {
    const [row] = await openDatabase()
      .select({ receipt: floorplanEditBatches.receipt })
      .from(floorplanEditBatches)
      .innerJoin(
        floorplans,
        eq(floorplans.id, floorplanEditBatches.floorplanId),
      )
      .where(
        and(
          eq(floorplans.ownerId, owner),
          eq(floorplans.id, planId),
          eq(floorplanEditBatches.agentId, agentId),
          eq(floorplanEditBatches.id, id),
        ),
      );
    return (row?.receipt as BatchReceipt | undefined) ?? null;
  },

  async commit({ owner, planId, agentId }, document, graph, receipt) {
    // The UPDATE wins the optimistic lock. If the receipt insert fails, the
    // UPDATE and revision archive in its trigger roll back with the statement.
    const result = await openDatabase().execute<{ id: string }>(sql`
      WITH saved AS (
        UPDATE public.floorplans
        SET graph = ${JSON.stringify(graph)}::jsonb, revision = revision + 1,
            thumbnail = NULL, updated_at = now()
        WHERE id = ${planId}::uuid AND owner_id = ${owner} AND revision = ${document.revision}
        RETURNING id, revision
      )
      INSERT INTO public.floorplan_edit_batches (id, floorplan_id, agent_id, revision, receipt)
      SELECT ${receipt.batchId}::uuid, id, ${agentId}, revision, ${JSON.stringify(receipt)}::jsonb
      FROM saved RETURNING id
    `);
    return result.rows.length === 1;
  },

  async revisions({ owner, planId }, from, to) {
    const result = await openDatabase().execute<VersionRow>(sql`
      WITH owned AS (
        SELECT id, revision, name, unit, graph FROM public.floorplans
        WHERE id = ${planId}::uuid AND owner_id = ${owner}
      )
      SELECT revision, name, unit, graph FROM owned WHERE revision IN (${from}, ${to})
      UNION ALL
      SELECT history.revision, history.name, history.unit, history.graph
      FROM owned JOIN public.floorplan_revisions history ON history.floorplan_id = owned.id
      WHERE history.revision IN (${from}, ${to})
    `);
    return result.rows.map((row) => ({
      id: planId,
      name: row.name,
      revision: row.revision,
      unit: row.unit,
      graph: loadDraftPlan(row.graph),
    }));
  },
};
