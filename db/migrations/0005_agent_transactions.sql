CREATE TABLE "floorplan_edit_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"revision" integer NOT NULL,
	"receipt" jsonb NOT NULL,
	CONSTRAINT "floorplan_edit_batch_revision" UNIQUE("floorplan_id","revision")
);
--> statement-breakpoint
CREATE TABLE "floorplan_revisions" (
	"floorplan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"unit" "display_unit" NOT NULL,
	"graph" jsonb NOT NULL,
	CONSTRAINT "floorplan_revisions_floorplan_id_revision_pk" PRIMARY KEY("floorplan_id","revision")
);
--> statement-breakpoint
ALTER TABLE "floorplan_edit_batches" ADD CONSTRAINT "floorplan_edit_batches_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floorplan_revisions" ADD CONSTRAINT "floorplan_revisions_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION public.archive_floorplan_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.floorplan_revisions (floorplan_id, revision, name, unit, graph)
  VALUES (OLD.id, OLD.revision, OLD.name, OLD.unit, OLD.graph)
  ON CONFLICT (floorplan_id, revision) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER archive_floorplan_revision
AFTER UPDATE OF revision ON public.floorplans
FOR EACH ROW WHEN (OLD.revision IS DISTINCT FROM NEW.revision)
EXECUTE FUNCTION public.archive_floorplan_revision();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'draft_app') THEN
    GRANT SELECT ON public.floorplan_revisions TO draft_app;
    GRANT SELECT, INSERT ON public.floorplan_edit_batches TO draft_app;
  END IF;
END;
$$;
