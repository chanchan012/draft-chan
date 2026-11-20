CREATE TABLE "floorplan_agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floorplan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "floorplan_agent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "floorplan_agent_tokens" ADD CONSTRAINT "floorplan_agent_tokens_floorplan_id_floorplans_id_fk" FOREIGN KEY ("floorplan_id") REFERENCES "public"."floorplans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floorplan_agent_tokens_plan_idx" ON "floorplan_agent_tokens" USING btree ("floorplan_id","expires_at");