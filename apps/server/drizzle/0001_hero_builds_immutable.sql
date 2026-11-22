-- A hero build is a snapshot: what a board row showed when it was set must stay what it shows. A new build is a new
-- row with a higher revision; deleting (with the hero or the player) is allowed, changing one is not.
CREATE FUNCTION "hero_builds_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'hero_builds rows are immutable; insert a new revision instead' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "hero_builds_immutable" BEFORE UPDATE ON "hero_builds" FOR EACH ROW EXECUTE FUNCTION "hero_builds_refuse_update"();
