CREATE TABLE "chat_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" text,
	CONSTRAINT "chat_messages_channel" CHECK ("chat_messages"."channel" IN ('global', 'direct')),
	CONSTRAINT "chat_messages_recipient" CHECK (("chat_messages"."channel" = 'global') = ("chat_messages"."recipient_id" IS NULL)),
	CONSTRAINT "chat_messages_not_self" CHECK ("chat_messages"."recipient_id" <> "chat_messages"."sender_id"),
	CONSTRAINT "chat_messages_body" CHECK (char_length("chat_messages"."body") BETWEEN 1 AND 300),
	CONSTRAINT "chat_messages_hidden" CHECK (("chat_messages"."hidden_at" IS NULL) = ("chat_messages"."hidden_by" IS NULL) AND ("chat_messages"."hidden_by" IS NULL OR "chat_messages"."hidden_by" IN ('reports', 'moderator')))
);
--> statement-breakpoint
CREATE TABLE "chat_mutes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"muted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_mutes_reason" CHECK (char_length("chat_mutes"."reason") <= 200),
	CONSTRAINT "chat_mutes_until" CHECK ("chat_mutes"."until" > "chat_mutes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "chat_reads" (
	"user_id" uuid NOT NULL,
	"peer_id" uuid NOT NULL,
	"last_read_id" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reads_pkey" PRIMARY KEY("user_id","peer_id"),
	CONSTRAINT "chat_reads_not_self" CHECK ("chat_reads"."user_id" <> "chat_reads"."peer_id"),
	CONSTRAINT "chat_reads_last_read" CHECK ("chat_reads"."last_read_id" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_reports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"message_id" bigint NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"channel" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "chat_reports_reason" CHECK ("chat_reports"."reason" IN ('spam', 'harassment', 'hate', 'sexual', 'cheating', 'other')),
	CONSTRAINT "chat_reports_note" CHECK (char_length("chat_reports"."note") <= 200),
	CONSTRAINT "chat_reports_channel" CHECK ("chat_reports"."channel" IN ('global', 'direct')),
	CONSTRAINT "chat_reports_recipient" CHECK (("chat_reports"."channel" = 'global') = ("chat_reports"."recipient_id" IS NULL)),
	CONSTRAINT "chat_reports_resolution" CHECK (("chat_reports"."resolution" IS NULL) = ("chat_reports"."resolved_at" IS NULL) AND ("chat_reports"."resolution" IS NULL OR "chat_reports"."resolution" IN ('dismiss', 'hide', 'mute')))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "chat_rules_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mutes" ADD CONSTRAINT "chat_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_mutes" ADD CONSTRAINT "chat_mutes_muted_by_users_id_fk" FOREIGN KEY ("muted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_peer_id_users_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_global_idx" ON "chat_messages" USING btree ("id") WHERE "chat_messages"."channel" = 'global';--> statement-breakpoint
CREATE INDEX "chat_messages_pair_idx" ON "chat_messages" USING btree (least("sender_id", "recipient_id"),greatest("sender_id", "recipient_id"),"id") WHERE "chat_messages"."channel" = 'direct';--> statement-breakpoint
CREATE INDEX "chat_messages_recipient_idx" ON "chat_messages" USING btree ("recipient_id","sender_id","id") WHERE "chat_messages"."channel" = 'direct';--> statement-breakpoint
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_hidden_idx" ON "chat_messages" USING btree ("hidden_at") WHERE "chat_messages"."hidden_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_mutes_until_idx" ON "chat_mutes" USING btree ("until");--> statement-breakpoint
CREATE INDEX "chat_reads_peer_idx" ON "chat_reads" USING btree ("peer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reports_message_reporter_key" ON "chat_reports" USING btree ("message_id","reporter_id");--> statement-breakpoint
CREATE INDEX "chat_reports_open_idx" ON "chat_reports" USING btree ("message_id") WHERE "chat_reports"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "chat_reports_resolved_idx" ON "chat_reports" USING btree ("resolved_at") WHERE "chat_reports"."resolved_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_reports_reporter_idx" ON "chat_reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "chat_reports_sender_idx" ON "chat_reports" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "chat_reports_recipient_idx" ON "chat_reports" USING btree ("recipient_id");