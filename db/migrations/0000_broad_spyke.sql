CREATE TYPE "public"."display_unit" AS ENUM('mm', 'in');--> statement-breakpoint
CREATE TABLE "floorplans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"unit" "display_unit" DEFAULT 'mm' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"graph" jsonb DEFAULT '{"version":1,"walls":[],"rooms":[],"openings":[],"fixtures":[],"dimensions":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_nonnegative" CHECK ("floorplans"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX "plans_owner_updated_idx" ON "floorplans" USING btree ("owner_id","updated_at");