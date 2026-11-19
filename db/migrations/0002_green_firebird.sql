CREATE TYPE "public"."blueprint_format" AS ENUM('dxf', 'svg');--> statement-breakpoint
CREATE TYPE "public"."blueprint_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "floorplan_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"format" "blueprint_format" NOT NULL,
	"status" "blueprint_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb,
	"artifact" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplan_export_revision_format" UNIQUE("floorplan_id","revision","format"),
	CONSTRAINT "floorplan_export_valid_attempt" CHECK ("floorplan_exports"."attempt" >= 1 AND "floorplan_exports"."revision" >= 0),
	CONSTRAINT "floorplan_export_contents" CHECK ((
      "floorplan_exports"."status" = 'ready' AND "floorplan_exports"."snapshot" IS NULL AND "floorplan_exports"."artifact" IS NOT NULL
    ) OR (
      "floorplan_exports"."status" != 'ready' AND "floorplan_exports"."snapshot" IS NOT NULL AND "floorplan_exports"."artifact" IS NULL
    ))
);
--> statement-breakpoint
ALTER TABLE "floorplan_exports" ADD CONSTRAINT "floorplan_exports_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floorplan_export_pending_idx" ON "floorplan_exports" USING btree ("requested_at") WHERE "floorplan_exports"."status" = 'pending';