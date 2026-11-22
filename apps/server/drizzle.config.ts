import { defineConfig } from 'drizzle-kit';

// `bun run db:generate` writes the next migration from the schema into drizzle/; the server applies them at boot
// (src/database/migrations.ts). Generating needs no database. Column names are spelled out in the schema, so there is
// no `casing` here or on the connection to keep in step.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
