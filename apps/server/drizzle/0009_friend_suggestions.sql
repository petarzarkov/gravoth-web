CREATE TABLE "suggestion_dismissals" (
	"user_id" uuid NOT NULL,
	"dismissed_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_dismissals_pkey" PRIMARY KEY("user_id","dismissed_id"),
	CONSTRAINT "suggestion_dismissals_not_self" CHECK ("suggestion_dismissals"."user_id" <> "suggestion_dismissals"."dismissed_id")
);
--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_dismissals" ADD CONSTRAINT "suggestion_dismissals_dismissed_id_users_id_fk" FOREIGN KEY ("dismissed_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_dismissals_dismissed_idx" ON "suggestion_dismissals" USING btree ("dismissed_id");--> statement-breakpoint
CREATE INDEX "suggestion_dismissals_at_idx" ON "suggestion_dismissals" USING btree ("dismissed_at");