import { z } from "zod";
import { exportRevision } from "./exports";

export const projectRoles = ["viewer", "reviewer", "editor"] as const;
export type ProjectRole = (typeof projectRoles)[number] | "owner";
export const mayEdit = (role: ProjectRole) =>
  role === "owner" || role === "editor";
export const mayReview = (role: ProjectRole) => role !== "viewer";

export const projectUserId = z
  .string()
  .trim()
  .regex(/^user_[A-Za-z0-9_-]{1,120}$/);
export const oauthClientId = z.string().trim().min(1).max(512).regex(/^\S+$/);
export const memberInput = z.strictObject({
  userId: projectUserId,
  role: z.enum(projectRoles),
});
export const optionInput = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  sourceRevision: exportRevision,
});
export const restoreInput = z.strictObject({
  expectedRevision: exportRevision,
  sourceRevision: exportRevision,
});
export const reviewInput = z.strictObject({
  id: z.uuid(),
  revision: exportRevision,
  body: z.string().trim().min(1).max(2000),
});
export const clientGrantInput = z.strictObject({
  clientId: oauthClientId,
  enabled: z.boolean(),
});

export type ProjectOption = {
  id: string;
  name: string;
  revision: number;
  forkFromPlanId: string | null;
  forkFromRevision: number | null;
};
export type ProjectDetails = {
  projectId: string;
  role: ProjectRole;
  options: ProjectOption[];
  members?: z.infer<typeof memberInput>[];
};
export type ReviewNote = z.infer<typeof reviewInput> & {
  kind: "comment" | "request";
  actorKind: "human" | "ai";
  actorId: string;
  createdAt: string;
};
export type RevisionEntry = {
  revision: number;
  name: string;
  sourceRevision: number | null;
  actorKind: "human" | "ai" | null;
  actorId: string | null;
  restoredAt: string | null;
};
export type ClientGrant = {
  clientId: string;
  enabled: boolean;
  floorplanId: string | null;
};
