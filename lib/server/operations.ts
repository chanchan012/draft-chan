import { and, eq } from "drizzle-orm";
import { openDatabase } from "../../db/client";
import {
  floorplanEditOperations as operations,
  floorplans,
} from "../../db/schema";
import type { AgentScope } from "./agent-tokens";

export type EditOperation = {
  id: string;
  tool: string;
  requestHash: string;
  receipt: Record<string, unknown>;
};

export async function getEditOperation(scope: AgentScope, id: string) {
  const [row] = await openDatabase()
    .select({
      requestHash: operations.requestHash,
      tool: operations.tool,
      baseRevision: operations.baseRevision,
      revision: operations.revision,
      receipt: operations.receipt,
      savedAt: operations.savedAt,
    })
    .from(operations)
    .innerJoin(floorplans, eq(floorplans.id, operations.floorplanId))
    .where(
      and(
        eq(floorplans.ownerId, scope.owner),
        eq(floorplans.id, scope.planId),
        eq(operations.agentId, scope.agentId),
        eq(operations.id, id),
      ),
    );
  return row ?? null;
}

export function traceOperation(event: {
  kind: "edit" | "batch" | "export";
  id: string;
  stage:
    | "received"
    | "saved"
    | "replayed"
    | "requested"
    | "dispatched"
    | "ready"
    | "failed";
  tool?: string;
  planId?: string;
  revision?: number;
  attempt?: number;
}) {
  if (process.env.VERCEL)
    console.info(JSON.stringify({ event: "draft.operation", ...event }));
}
