import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  cadEditCommands,
  cadEditSchema,
  type CadEdit,
} from "../plans/cad-edit";
import { summarizeChanges } from "../plans/change-summary";
import { createDraftPlanStore } from "../plans/command-store";
import type { DraftActor } from "../plans/model";
import { studioSnapshot, type StudioDocument } from "../plans/studio-document";
import type { AgentScope } from "./agent-tokens";

export const operationsSchema = z.array(cadEditSchema).min(1).max(24);
const stampSchema = z.strictObject({
  version: z.literal(1),
  id: z.uuid(),
  revision: z.int().nonnegative(),
  expiresAt: z.int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.string().regex(/^[a-f0-9]{64}$/),
});
type Stamp = z.infer<typeof stampSchema>;
const lifetimeMs = 15 * 60 * 1000;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const operationDigest = (operations: CadEdit[]) =>
  digest(JSON.stringify(operations));

function signature(scope: AgentScope, body: string) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret)
    throw new Error("Draft's Clerk secret is required for preview signing.");
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "draft-cad-transaction-v1",
        scope.owner,
        scope.planId,
        scope.agentId,
        body,
      ]),
    )
    .digest("base64url");
}

export const newBatchId = randomUUID;

export function createPreview(
  scope: AgentScope,
  id: string,
  revision: number,
  operations: CadEdit[],
  outcome: string,
) {
  const stamp: Stamp = {
    version: 1,
    id,
    revision,
    expiresAt: Date.now() + lifetimeMs,
    digest: operationDigest(operations),
    outcome,
  };
  const body = Buffer.from(JSON.stringify(stamp)).toString("base64url");
  return { stamp, token: body + "." + signature(scope, body) };
}

export function readPreview(
  scope: AgentScope,
  token: string,
  operations: CadEdit[],
) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return;
  const [body, proof] = token.split(".");
  if (!timingSafeEqual(Buffer.from(proof), Buffer.from(signature(scope, body))))
    return;
  try {
    const parsed = stampSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (parsed.success && parsed.data.digest === operationDigest(operations))
      return parsed.data;
  } catch {
    // A token that cannot be decoded is unusable.
  }
}

export function prepareBatch(
  document: StudioDocument,
  actor: DraftActor,
  id: string,
  operations: CadEdit[],
) {
  const store = createDraftPlanStore(document.graph);
  let sequence = 0;
  // Identical accepted previews reproduce all generated entity IDs across instances.
  const nextId = () => "batch-" + digest(id + ":" + ++sequence).slice(0, 40);
  for (const [index, input] of operations.entries()) {
    try {
      const commands = cadEditCommands(store.getState().plan, input, nextId);
      store.getState().executeBatch(commands, actor);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Invalid geometry.";
      throw new Error(
        "Operation " + (index + 1) + " (" + input.operation + "). " + reason,
      );
    }
  }
  const graph = store.getState().plan;
  const summary = summarizeChanges(document.graph, graph);
  if (!summary.changes.length)
    throw new Error("The batch does not change any geometry.");
  return {
    graph,
    summary,
    outcome: digest(JSON.stringify(studioSnapshot(graph, document.unit))),
  };
}
