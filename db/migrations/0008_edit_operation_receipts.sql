CREATE TABLE "floorplan_edit_operations" (
	"id" uuid NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"tool" text NOT NULL,
	"request_hash" text NOT NULL,
	"base_revision" integer NOT NULL,
	"revision" integer NOT NULL,
	"receipt" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floorplan_edit_operations_floorplan_id_agent_id_id_pk" PRIMARY KEY("floorplan_id","agent_id","id"),
	CONSTRAINT "floorplan_edit_operations_revision" CHECK ("floorplan_edit_operations"."base_revision" >= 0 AND "floorplan_edit_operations"."revision" = "floorplan_edit_operations"."base_revision" + 1)
);
--> statement-breakpoint
ALTER TABLE "floorplan_edit_operations" ADD CONSTRAINT "floorplan_edit_operations_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'draft_app') THEN
    GRANT SELECT, INSERT ON public.floorplan_edit_operations TO draft_app;
  END IF;
END;
$$;
