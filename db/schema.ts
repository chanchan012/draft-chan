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
} from "drizzle-orm/pg-core";

export const displayUnit = pgEnum("display_unit", ["mm", "in"]);
export const floorplans = pgTable(
  "floorplans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
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
  ],
);

export const blueprintFormat = pgEnum("blueprint_format", ["dxf", "svg"]);
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
