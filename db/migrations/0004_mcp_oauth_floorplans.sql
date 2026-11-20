CREATE TABLE "floorplan_oauth_grants" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"floorplan_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floorplan_oauth_grants" ADD CONSTRAINT "floorplan_oauth_grants_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;