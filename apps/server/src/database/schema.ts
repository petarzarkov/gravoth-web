// The one schema object of the one Postgres connection: better-auth's tables under their singular model names (the
// adapter reads `db._.fullSchema`, so `drizzleDatabase(connection)` passes none of its own), then the game's.
//
// drizzle-kit generates the migrations in ../../drizzle from this module (drizzle.config.ts); the server applies them
// at boot (migrations.ts). A table or column change is an edit here and `bun run db:generate`, never an edit of a
// migration already committed.
export * from './auth.schema.js';
export * from './social.schema.js';
export * from './heroes.schema.js';
export * from './boards.schema.js';
export * from './saves.schema.js';
export * from './realms.schema.js';
