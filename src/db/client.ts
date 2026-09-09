import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import * as schema from './schema';

/**
 * One database, opened once for the life of the process.
 *
 * `enableChangeListener` is what lets `useLiveQuery` re-render a screen when a
 * row changes anywhere in the app — add an expense and the home screen updates
 * itself, with no manual refresh plumbing.
 */
export const sqlite = SQLite.openDatabaseSync('expense.db', {
  enableChangeListener: true,
});

export const db = drizzle(sqlite, { schema });

export { schema };
