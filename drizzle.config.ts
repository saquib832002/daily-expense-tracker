import type { Config } from 'drizzle-kit';

/**
 * Generates SQL migrations for the phone's SQLite database.
 * Run `npm run db:generate` after every change to src/db/schema.ts,
 * then commit the files it writes into ./drizzle.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
