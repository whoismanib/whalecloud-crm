import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from './config';
import { createDb } from './db/client';

/** Applies SQL migrations from apps/api/drizzle with the owner role (DATABASE_URL_MIGRATIONS). */
export async function runMigrations(url: string): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const folder = [
    resolve(here, '../drizzle'),
    resolve(here, '../../drizzle'),
    resolve(process.cwd(), 'drizzle'),
  ].find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!folder) throw new Error('migrations folder not found');
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  const url = config.DATABASE_URL_MIGRATIONS ?? config.DATABASE_URL;
  await runMigrations(url);
  console.log('migrations applied');
}
