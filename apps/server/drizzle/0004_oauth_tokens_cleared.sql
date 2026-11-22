-- The Google and Discord tokens better-auth kept in plaintext before they were encrypted (decision 224: the access and
-- refresh tokens are encrypted with AUTH_SECRET from now on, and the ID token is not kept; auth/oauth-tokens.ts). The
-- server never calls a provider with them, so they are cleared rather than encrypted in place; the player's next
-- sign-in with that provider writes its own, encrypted. The sign-in itself (`account_id`) is untouched.
UPDATE "accounts" SET "access_token" = NULL, "refresh_token" = NULL, "id_token" = NULL
WHERE "access_token" IS NOT NULL OR "refresh_token" IS NOT NULL OR "id_token" IS NOT NULL;
