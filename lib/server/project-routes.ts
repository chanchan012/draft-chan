import { Hono } from "hono";
import { z } from "zod";
import type { Environment } from "./api";
import { liveBus, planChannel, type LiveBus } from "./live-bus";
import { queueThumbnail } from "./thumbnails";
import { exportRevision } from "../plans/exports";
import {
  clientGrantInput,
  mayEdit,
  mayReview,
  memberInput,
  optionInput,
  projectUserId,
  restoreInput,
  reviewInput,
} from "../plans/projects";
import { projectAccess, type ProjectAccess } from "./project-access";
import {
  compareDesignOptions,
  createDesignOption,
  listPlanRevisions,
  listReviewNotes,
  projectDetails,
  removeProjectMember,
  restorePlanRevision,
  setProjectMember,
  writeReviewNote,
} from "./projects";
import { listClientGrants, setClientGrant } from "./oauth-grants";

type ProjectEnvironment = Environment & {
  Variables: { access: ProjectAccess; planId: string };
};
const compareInput = z.strictObject({
  beforeRevision: exportRevision,
  afterRevision: exportRevision,
  optionId: z.uuid(),
});
const reviewRequest = reviewInput.extend({
  kind: z.enum(["comment", "request"]),
});

export function projectRoutes(bus: LiveBus = liveBus) {
  const app = new Hono<ProjectEnvironment>();
  app.use("*", async (c, next) => {
    const user = c.get("identity")?.userId;
    if (!user) return c.json({ error: "Sign in required" }, 401);
    const id = z.uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid plan ID" }, 400);
    const origin = c.req.header("Origin");
    if (
      c.req.method !== "GET" &&
      origin &&
      origin !== new URL(c.req.url).origin
    )
      return c.json({ error: "Invalid origin" }, 403);
    const access = await projectAccess(user, id.data);
    if (!access) return c.json({ error: "Project unavailable" }, 404);
    c.set("access", access);
    c.set("planId", id.data);
    await next();
  });
  return app
    .get("/", async (c) => c.json(await projectDetails(c.get("access"))))
    .put("/members", async (c) => {
      const input = memberInput.safeParse(await c.req.json().catch(() => null));
      if (!input.success)
        return c.json(
          { error: "Enter a Clerk user ID and project role." },
          400,
        );
      if (
        !(await setProjectMember(
          c.get("access"),
          input.data.userId,
          input.data.role,
        ))
      )
        return c.json(
          { error: "Only the owner can manage project membership." },
          403,
        );
      return c.json(input.data);
    })
    .delete("/members/:userId", async (c) => {
      const user = projectUserId.safeParse(c.req.param("userId"));
      if (!user.success) return c.json({ error: "Invalid member ID" }, 400);
      if (!(await removeProjectMember(c.get("access"), user.data)))
        return c.json(
          { error: "Only the owner can manage project membership." },
          403,
        );
      return c.body(null, 204);
    })
    .post("/options", async (c) => {
      const access = c.get("access");
      if (!mayEdit(access.role))
        return c.json({ error: "Editors can create options." }, 403);
      const input = optionInput.safeParse(await c.req.json().catch(() => null));
      if (!input.success)
        return c.json({ error: "Enter a name and a saved revision." }, 400);
      const option = await createDesignOption(
        { owner: access.owner, planId: c.get("planId") },
        input.data,
        c.get("identity")!.userId,
      );
      if (!option)
        return c.json(
          { error: "Source revision or option ID is unavailable." },
          409,
        );
      await queueThumbnail(option.id).catch(() => {});
      return c.json(option, 201);
    })
    .get("/compare", async (c) => {
      const candidate = c.req.query();
      const input = compareInput.safeParse({
        ...candidate,
        beforeRevision: /^\d+$/.test(candidate.beforeRevision ?? "")
          ? Number(candidate.beforeRevision)
          : null,
        afterRevision: /^\d+$/.test(candidate.afterRevision ?? "")
          ? Number(candidate.afterRevision)
          : null,
      });
      if (!input.success)
        return c.json({ error: "Choose two saved option revisions." }, 400);
      const access = c.get("access");
      const other = await projectAccess(
        c.get("identity")!.userId,
        input.data.optionId,
      );
      if (!other || other.projectId !== access.projectId)
        return c.json({ error: "Option unavailable." }, 404);
      const result = await compareDesignOptions(
        {
          owner: access.owner,
          planId: c.get("planId"),
          revision: input.data.beforeRevision,
        },
        {
          owner: other.owner,
          planId: input.data.optionId,
          revision: input.data.afterRevision,
        },
      );
      return result
        ? c.json(result)
        : c.json({ error: "Revision unavailable." }, 404);
    })
    .get("/reviews", async (c) =>
      c.json(
        await listReviewNotes({
          owner: c.get("access").owner,
          planId: c.get("planId"),
        }),
      ),
    )
    .post("/reviews", async (c) => {
      const access = c.get("access");
      const input = reviewRequest.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success)
        return c.json(
          { error: "Enter a review note for a saved revision." },
          400,
        );
      const { kind, ...note } = input.data;
      if (
        !mayReview(access.role) ||
        (kind === "request" && !mayEdit(access.role))
      )
        return c.json(
          { error: "Your project role does not allow this review action." },
          403,
        );
      const result = await writeReviewNote(
        { owner: access.owner, planId: c.get("planId") },
        note,
        kind,
        { kind: "human", id: c.get("identity")!.userId },
      );
      return result
        ? c.json(result, 201)
        : c.json({ error: "Review revision or note ID is unavailable." }, 409);
    })
    .get("/revisions", async (c) => {
      const before = c.req.query("before");
      const parsed = exportRevision
        .optional()
        .safeParse(
          before === undefined
            ? undefined
            : /^\d+$/.test(before)
              ? Number(before)
              : null,
        );
      if (!parsed.success)
        return c.json({ error: "Invalid revision cursor." }, 400);
      return c.json(
        await listPlanRevisions(
          { owner: c.get("access").owner, planId: c.get("planId") },
          parsed.data,
        ),
      );
    })
    .post("/restore", async (c) => {
      const access = c.get("access");
      if (!mayEdit(access.role))
        return c.json({ error: "Editors can restore a revision." }, 403);
      const input = restoreInput.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success)
        return c.json({ error: "Choose an earlier saved revision." }, 400);
      const planId = c.get("planId");
      const restored = await restorePlanRevision(
        { owner: access.owner, planId },
        input.data,
        { kind: "human", id: c.get("identity")!.userId },
      );
      if (!restored)
        return c.json(
          { error: "The source or current revision changed." },
          409,
        );
      await Promise.allSettled([
        bus.publish(planChannel(access.owner, planId), {
          type: "revision",
          revision: restored.revision,
        }),
        queueThumbnail(planId),
      ]);
      return c.json(restored);
    })
    .get("/agent-clients", async (c) => {
      const access = c.get("access");
      if (access.role !== "owner")
        return c.json(
          { error: "Only the owner can manage agent access." },
          403,
        );
      return c.json(await listClientGrants(access.owner, c.get("planId")));
    })
    .put("/agent-clients", async (c) => {
      const access = c.get("access");
      if (access.role !== "owner")
        return c.json(
          { error: "Only the owner can manage agent access." },
          403,
        );
      const input = clientGrantInput.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!input.success)
        return c.json({ error: "Enter an OAuth client ID." }, 400);
      const grant = await setClientGrant(
        access.owner,
        c.get("planId"),
        input.data.clientId,
        input.data.enabled,
      );
      return grant
        ? c.json(grant)
        : c.json(
            {
              error:
                "That client is assigned to another option or has no access here.",
            },
            409,
          );
    });
}
