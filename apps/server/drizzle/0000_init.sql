CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_password_only_credential" CHECK ("accounts"."password" IS NULL OR "accounts"."provider_id" = 'credential')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"is_anonymous" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friendships_not_self" CHECK ("friendships"."requester_id" <> "friendships"."addressee_id"),
	CONSTRAINT "friendships_status" CHECK ("friendships"."status" IN ('pending', 'accepted')),
	CONSTRAINT "friendships_responded" CHECK (("friendships"."status" = 'pending') = ("friendships"."responded_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"name_chosen" boolean DEFAULT false NOT NULL,
	"public_profile" boolean DEFAULT true NOT NULL,
	"allow_friend_requests" boolean DEFAULT true NOT NULL,
	"show_online" boolean DEFAULT true NOT NULL,
	"email_friend_requests" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_display_name_format" CHECK ("profiles"."display_name" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,19}$')
);
--> statement-breakpoint
CREATE TABLE "heroes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"class" text NOT NULL,
	"hardcore" boolean DEFAULT false NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "heroes_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "heroes_name_length" CHECK (char_length("heroes"."name") BETWEEN 1 AND 24 AND "heroes"."name" = btrim("heroes"."name")),
	CONSTRAINT "heroes_class" CHECK ("heroes"."class" IN ('barbarian', 'ranger', 'sorcerer', 'templar'))
);
--> statement-breakpoint
CREATE TABLE "hero_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hero_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"game_version" text NOT NULL,
	"level" smallint NOT NULL,
	"ascendancy" text,
	"dps" double precision NOT NULL,
	"clear_dps" double precision NOT NULL,
	"ehp" double precision NOT NULL,
	"life" integer NOT NULL,
	"energy_shield" integer DEFAULT 0 NOT NULL,
	"skills" jsonb NOT NULL,
	"gear" jsonb NOT NULL,
	"talents" jsonb NOT NULL,
	"atlas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auras" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"card" jsonb,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hero_builds_hero_revision_key" UNIQUE("hero_id","revision"),
	CONSTRAINT "hero_builds_id_hero_key" UNIQUE("id","hero_id"),
	CONSTRAINT "hero_builds_revision" CHECK ("hero_builds"."revision" >= 0),
	CONSTRAINT "hero_builds_level" CHECK ("hero_builds"."level" BETWEEN 1 AND 100),
	CONSTRAINT "hero_builds_game_version" CHECK ("hero_builds"."game_version" ~ '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$'),
	CONSTRAINT "hero_builds_numbers" CHECK ("hero_builds"."dps" >= 0 AND "hero_builds"."clear_dps" >= 0 AND "hero_builds"."ehp" >= 0 AND "hero_builds"."life" >= 0 AND "hero_builds"."energy_shield" >= 0),
	CONSTRAINT "hero_builds_json_shapes" CHECK (jsonb_typeof("hero_builds"."skills") = 'array' AND jsonb_typeof("hero_builds"."gear") = 'array' AND jsonb_typeof("hero_builds"."auras") = 'array' AND jsonb_typeof("hero_builds"."summary") = 'object'),
	CONSTRAINT "hero_builds_hash" CHECK ("hero_builds"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "leaderboards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leaderboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"hardcore" boolean DEFAULT false NOT NULL,
	"season" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"sort" text NOT NULL,
	"format" text NOT NULL,
	"min_score" bigint NOT NULL,
	"max_score" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboards_key_hardcore_season_key" UNIQUE("key","hardcore","season"),
	CONSTRAINT "leaderboards_key_format" CHECK ("leaderboards"."key" ~ '^[a-z][a-z0-9_]{1,39}$' AND "leaderboards"."key" NOT LIKE 'hc\_%'),
	CONSTRAINT "leaderboards_sort" CHECK ("leaderboards"."sort" IN ('asc', 'desc')),
	CONSTRAINT "leaderboards_format" CHECK ("leaderboards"."format" IN ('number', 'time_ms')),
	CONSTRAINT "leaderboards_season" CHECK ("leaderboards"."season" >= 0),
	CONSTRAINT "leaderboards_range" CHECK ("leaderboards"."min_score" <= "leaderboards"."max_score")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"hero_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"score" bigint NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verdict" text DEFAULT 'pending' NOT NULL,
	"verdict_note" text,
	CONSTRAINT "leaderboard_entries_board_hero_key" UNIQUE("board_id","hero_id"),
	CONSTRAINT "leaderboard_entries_verdict" CHECK ("leaderboard_entries"."verdict" IN ('pending', 'verified', 'flagged')),
	CONSTRAINT "leaderboard_entries_achieved" CHECK ("leaderboard_entries"."achieved_at" <= "leaderboard_entries"."recorded_at")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonated_by_users_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heroes" ADD CONSTRAINT "heroes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hero_builds" ADD CONSTRAINT "hero_builds_hero_id_heroes_id_fk" FOREIGN KEY ("hero_id") REFERENCES "public"."heroes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_board_id_leaderboards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."leaderboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_hero_fk" FOREIGN KEY ("hero_id","user_id") REFERENCES "public"."heroes"("id","user_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_build_fk" FOREIGN KEY ("build_id","hero_id") REFERENCES "public"."hero_builds"("id","hero_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_key" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_provider_key" ON "accounts" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verifications_expires_idx" ON "verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_key" ON "friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendships_requester_idx" ON "friendships" USING btree ("requester_id","status","created_at");--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" USING btree ("addressee_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_display_name_key" ON "profiles" USING btree (lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "heroes_user_name_key" ON "heroes" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "hero_builds_dps_idx" ON "hero_builds" USING btree ("dps");--> statement-breakpoint
CREATE INDEX "hero_builds_ehp_idx" ON "hero_builds" USING btree ("ehp");--> statement-breakpoint
CREATE INDEX "hero_builds_level_idx" ON "hero_builds" USING btree ("level");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_rank_desc_idx" ON "leaderboard_entries" USING btree ("board_id","score" DESC NULLS LAST,"achieved_at","id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_rank_asc_idx" ON "leaderboard_entries" USING btree ("board_id","score","achieved_at","id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_user_idx" ON "leaderboard_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_hero_idx" ON "leaderboard_entries" USING btree ("hero_id","user_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_build_idx" ON "leaderboard_entries" USING btree ("build_id");