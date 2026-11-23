CREATE TYPE "public"."project_actor_kind" AS ENUM('human', 'ai');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('viewer', 'reviewer', 'editor');--> statement-breakpoint
CREATE TABLE "floorplan_client_grants" (
	"owner_id" text NOT NULL,
	"client_id" text NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"floorplan_id" uuid,
	"enabled" boolean NOT NULL,
	CONSTRAINT "floorplan_client_grants_owner_id_client_id_pk" PRIMARY KEY("owner_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "floorplan_project_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" NOT NULL,
	CONSTRAINT "floorplan_project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "floorplan_review_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"actor_kind" "project_actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplan_review_notes_kind" CHECK ("floorplan_review_notes"."kind" IN ('comment', 'request')),
	CONSTRAINT "floorplan_review_notes_revision" CHECK ("floorplan_review_notes"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "floorplan_revision_restores" (
	"floorplan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"source_revision" integer NOT NULL,
	"actor_kind" "project_actor_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"restored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplan_revision_restores_floorplan_id_revision_pk" PRIMARY KEY("floorplan_id","revision"),
	CONSTRAINT "floorplan_revision_restores_source" CHECK ("floorplan_revision_restores"."source_revision" >= 0 AND "floorplan_revision_restores"."source_revision" < "floorplan_revision_restores"."revision")
);
--> statement-breakpoint
ALTER TABLE "floorplans" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "floorplans" ADD COLUMN "fork_from_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "floorplans" ADD COLUMN "fork_from_revision" integer;--> statement-breakpoint
ALTER TABLE "floorplan_client_grants" ADD CONSTRAINT "floorplan_client_grants_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_project_members" ADD CONSTRAINT "floorplan_project_members_project_id_floorplans_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_review_notes" ADD CONSTRAINT "floorplan_review_notes_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_revision_restores" ADD CONSTRAINT "floorplan_revision_restores_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floorplan_client_grants_plan_idx" ON "floorplan_client_grants" USING btree ("floorplan_id");--> statement-breakpoint
CREATE INDEX "floorplan_project_members_user_idx" ON "floorplan_project_members" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "floorplan_review_notes_plan_idx" ON "floorplan_review_notes" USING btree ("floorplan_id","created_at","id");--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_project_id_floorplans_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."floorplans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floorplans_project_idx" ON "floorplans" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_fork_metadata" CHECK (
      ("floorplans"."project_id" IS NULL AND "floorplans"."fork_from_plan_id" IS NULL AND "floorplans"."fork_from_revision" IS NULL)
      OR ("floorplans"."project_id" IS NOT NULL AND "floorplans"."project_id" <> "floorplans"."id"
        AND "floorplans"."fork_from_plan_id" IS NOT NULL AND "floorplans"."fork_from_revision" IS NOT NULL AND "floorplans"."fork_from_revision" >= 0)
    );--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'draft_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.floorplan_project_members, public.floorplan_client_grants TO draft_app;
    GRANT SELECT, INSERT ON public.floorplan_review_notes, public.floorplan_revision_restores TO draft_app;
  END IF;
END;
$$;
