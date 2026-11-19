import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  index,
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
    graph: jsonb("graph")
      .notNull()
      .default({
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
