import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  primaryKey,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  unique,
  check,
  boolean,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const displayUnit = pgEnum("display_unit", ["mm", "in"]);
export const floorplans = pgTable(
  "floorplans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    projectId: uuid("project_id").references((): AnyPgColumn => floorplans.id, {
      onDelete: "restrict",
    }),
    forkFromPlanId: uuid("fork_from_plan_id"),
    forkFromRevision: integer("fork_from_revision"),
    name: text("name").notNull(),
    unit: displayUnit("unit").notNull().default("mm"),
    revision: integer("revision").notNull().default(0),
    thumbnail: text("thumbnail"),
    graph: jsonb("graph").notNull().default({
      version: 1,
      walls: [],
      rooms: [],
      openings: [],
      fixtures: [],
      dimensions: [],
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("plans_owner_updated_idx").on(t.ownerId, t.updatedAt),
    check("revision_nonnegative", sql`${t.revision} >= 0`),
    index("floorplans_project_idx").on(t.projectId),
    check(
      "floorplans_fork_metadata",
      sql`
      (${t.projectId} IS NULL AND ${t.forkFromPlanId} IS NULL AND ${t.forkFromRevision} IS NULL)
      OR (${t.projectId} IS NOT NULL AND ${t.projectId} <> ${t.id}
        AND ${t.forkFromPlanId} IS NOT NULL AND ${t.forkFromRevision} IS NOT NULL AND ${t.forkFromRevision} >= 0)
    `,
    ),
  ],
);

export const blueprintFormat = pgEnum("blueprint_format", [
  "dxf",
  "svg",
  "pdf",
]);
export const blueprintStatus = pgEnum("blueprint_status", [
  "pending",
  "ready",
  "failed",
]);

export const floorplanExports = pgTable(
  "floorplan_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    format: blueprintFormat("format").notNull(),
    status: blueprintStatus("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(1),
    name: text("name").notNull(),
    snapshot: jsonb("snapshot"),
    artifact: text("artifact"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("floorplan_export_revision_format").on(
      t.floorplanId,
      t.revision,
      t.format,
    ),
    index("floorplan_export_pending_idx")
      .on(t.requestedAt)
      .where(sql`${t.status} = 'pending'`),
    check(
      "floorplan_export_valid_attempt",
      sql`${t.attempt} >= 1 AND ${t.revision} >= 0`,
    ),
    check(
      "floorplan_export_contents",
      sql`(
      ${t.status} = 'ready' AND ${t.snapshot} IS NULL AND ${t.artifact} IS NOT NULL
    ) OR (
      ${t.status} != 'ready' AND ${t.snapshot} IS NOT NULL AND ${t.artifact} IS NULL
    )`,
    ),
  ],
);

export const floorplanAgentTokens = pgTable(
  "floorplan_agent_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("floorplan_agent_tokens_plan_idx").on(t.floorplanId, t.expiresAt),
  ],
);

export const floorplanOAuthGrants = pgTable("floorplan_oauth_grants", {
  ownerId: text("owner_id").primaryKey(),
  id: uuid("id").notNull().defaultRandom(),
  floorplanId: uuid("floorplan_id")
    .notNull()
    .references(() => floorplans.id, { onDelete: "cascade" }),
});

export const floorplanRevisions = pgTable(
  "floorplan_revisions",
  {
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    name: text("name").notNull(),
    unit: displayUnit("unit").notNull(),
    graph: jsonb("graph").notNull(),
  },
  (t) => [primaryKey({ columns: [t.floorplanId, t.revision] })],
);

export const floorplanEditBatches = pgTable(
  "floorplan_edit_batches",
  {
    id: uuid("id").primaryKey(),
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    revision: integer("revision").notNull(),
    receipt: jsonb("receipt").notNull(),
  },
  (t) => [
    unique("floorplan_edit_batch_revision").on(t.floorplanId, t.revision),
  ],
);

export const projectRole = pgEnum("project_role", [
  "viewer",
  "reviewer",
  "editor",
]);
export const floorplanProjectMembers = pgTable(
  "floorplan_project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: projectRole("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("floorplan_project_members_user_idx").on(t.userId, t.projectId),
  ],
);

export const floorplanClientGrants = pgTable(
  "floorplan_client_grants",
  {
    ownerId: text("owner_id").notNull(),
    clientId: text("client_id").notNull(),
    id: uuid("id").notNull().defaultRandom(),
    floorplanId: uuid("floorplan_id").references(() => floorplans.id, {
      onDelete: "set null",
    }),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.clientId] }),
    index("floorplan_client_grants_plan_idx").on(t.floorplanId),
  ],
);

export const projectActorKind = pgEnum("project_actor_kind", ["human", "ai"]);
export const floorplanReviewNotes = pgTable(
  "floorplan_review_notes",
  {
    id: uuid("id").primaryKey(),
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    actorKind: projectActorKind("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    kind: text("kind", { enum: ["comment", "request"] }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("floorplan_review_notes_plan_idx").on(
      t.floorplanId,
      t.createdAt,
      t.id,
    ),
    check(
      "floorplan_review_notes_kind",
      sql`${t.kind} IN ('comment', 'request')`,
    ),
    check("floorplan_review_notes_revision", sql`${t.revision} >= 0`),
  ],
);

export const floorplanRevisionRestores = pgTable(
  "floorplan_revision_restores",
  {
    floorplanId: uuid("floorplan_id")
      .notNull()
      .references(() => floorplans.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    actorKind: projectActorKind("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    restoredAt: timestamp("restored_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.floorplanId, t.revision] }),
    check(
      "floorplan_revision_restores_source",
      sql`${t.sourceRevision} >= 0 AND ${t.sourceRevision} < ${t.revision}`,
    ),
  ],
);
