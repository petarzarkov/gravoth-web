-- The pictures of the profiles made before them (0002 gave each its own random portrait through the column's volatile
-- default): a player whose sign-in brought a photo shows it (`provider`), everyone else their portrait. A photo is a
-- Google one (`*.googleusercontent.com`) or a Discord avatar of the player's own; Discord's generated default avatars
-- (`/embed/avatars/`) are not a photo of anyone (players/avatars.ts holds the same rule).
UPDATE "profiles" SET "avatar_kind" = 'provider'
FROM "users"
WHERE "users"."id" = "profiles"."user_id"
	AND (
		"users"."image" ~ '^https://([a-z0-9-]+\.)+googleusercontent\.com/'
		OR ("users"."image" LIKE 'https://cdn.discordapp.com/%' AND "users"."image" NOT LIKE 'https://cdn.discordapp.com/embed/avatars/%')
	);
