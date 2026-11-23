import { z } from "zod";
import { inngest } from "./thumbnails";
import {
  failBlueprint,
  renderQueuedBlueprint,
  unconfirmedBlueprints,
  type BlueprintAttempt,
} from "./blueprint-store";
import { traceOperation } from "./operations";

export const blueprintEvent = "draft/floorplan.blueprint.requested";
const attemptSchema = z.strictObject({
  id: z.uuid(),
  attempt: z.int().positive(),
});

function eventFor(data: BlueprintAttempt) {
  return {
    id: `draft-blueprint-${data.id}-${data.attempt}`,
    name: blueprintEvent,
    data,
  };
}

export async function queueBlueprint(input: BlueprintAttempt) {
  const sent = await inngest.send(eventFor(input));
  traceOperation({
    kind: "export",
    id: input.id,
    stage: "dispatched",
    attempt: input.attempt,
  });
  return sent;
}

export const blueprintJob = inngest.createFunction(
  {
    id: "render-floorplan-blueprint",
    retries: 4,
    onFailure: async ({ event, step }) => {
      const input = attemptSchema.safeParse(event.data.event.data);
      if (input.success)
        await step.run("mark-export-failed", () => failBlueprint(input.data));
    },
  },
  { event: blueprintEvent },
  async ({ event, step }) => {
    const input = attemptSchema.parse(event.data);
    return step.run("render-and-save-blueprint", () =>
      renderQueuedBlueprint(input),
    );
  },
);

export const recoverBlueprints = inngest.createFunction(
  { id: "recover-pending-blueprints" },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const pending = await step.run(
      "find-pending-blueprints",
      unconfirmedBlueprints,
    );
    if (pending.length)
      await step.sendEvent("request-blueprints", pending.map(eventFor));
    return { count: pending.length };
  },
);
