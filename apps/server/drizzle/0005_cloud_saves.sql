CREATE TABLE "cloud_saves" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"play_seconds" bigint DEFAULT 0 NOT NULL,
	"game_version" text,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_saves_size" CHECK ("cloud_saves"."size" = octet_length("cloud_saves"."data") AND "cloud_saves"."size" BETWEEN 1 AND 3000000),
	CONSTRAINT "cloud_saves_sha256" CHECK ("cloud_saves"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cloud_saves_play_seconds" CHECK ("cloud_saves"."play_seconds" >= 0),
	CONSTRAINT "cloud_saves_game_version" CHECK ("cloud_saves"."game_version" ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$')
);
--> statement-breakpoint
ALTER TABLE "cloud_saves" ADD CONSTRAINT "cloud_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;