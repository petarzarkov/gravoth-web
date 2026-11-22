CREATE TABLE "realms" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea",
	"revision" integer DEFAULT 0 NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"game_version" text,
	"checked_revision" integer DEFAULT 0 NOT NULL,
	"lease_device" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realms_size" CHECK ("realms"."size" = coalesce(octet_length("realms"."data"), 0) AND "realms"."size" BETWEEN 0 AND 3000000),
	CONSTRAINT "realms_sha256" CHECK (("realms"."data" IS NULL AND "realms"."sha256" IS NULL) OR ("realms"."data" IS NOT NULL AND "realms"."sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "realms_revisions" CHECK ("realms"."revision" >= 0 AND "realms"."checked_revision" BETWEEN 0 AND "realms"."revision"),
	CONSTRAINT "realms_game_version" CHECK ("realms"."game_version" ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$'),
	CONSTRAINT "realms_lease_device" CHECK (char_length("realms"."lease_device") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "realm_transfers" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realm_transfers_fingerprint" CHECK ("realm_transfers"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "realm_transfers_character" CHECK ("realm_transfers"."character_id" >= 0)
);
--> statement-breakpoint
DROP INDEX "heroes_user_name_key";--> statement-breakpoint
ALTER TABLE "heroes" ADD COLUMN "realm_character_id" integer;--> statement-breakpoint
ALTER TABLE "heroes" ADD COLUMN "level" smallint;--> statement-breakpoint
ALTER TABLE "heroes" ADD COLUMN "flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "heroes" ADD COLUMN "flag_note" text;--> statement-breakpoint
ALTER TABLE "realms" ADD CONSTRAINT "realms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_transfers" ADD CONSTRAINT "realm_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realm_transfers_user_idx" ON "realm_transfers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "heroes_user_realm_character_key" ON "heroes" USING btree ("user_id","realm_character_id") WHERE "heroes"."realm_character_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "heroes_user_name_key" ON "heroes" USING btree ("user_id",lower("name")) WHERE NOT "heroes"."online";--> statement-breakpoint
ALTER TABLE "heroes" ADD CONSTRAINT "heroes_realm_character" CHECK ("heroes"."realm_character_id" IS NULL OR ("heroes"."online" AND "heroes"."realm_character_id" >= 0));