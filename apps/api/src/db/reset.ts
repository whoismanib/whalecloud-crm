import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config';
import { runMigrations } from '../migrate';
import { createDb } from './client';

/**
 * `npm run db:reset` (development only): drops every object in the app schemas, re-applies the
 * migrations and runs the seed. Pass `--demo` to also load the demo data. The `public` schema
 * itself is kept so the default privileges granted to the app role by the init script survive.
 */
const config = loadConfig();
if (config.NODE_ENV !== 'development')
  throw new Error('db:reset only runs with NODE_ENV=development');
const url = config.DATABASE_URL_MIGRATIONS ?? config.DATABASE_URL;

const { db, pool } = createDb(url, { max: 1 });
try {
  await db.execute(
    sql.raw(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
      END LOOP;
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;
      FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequence_name);
      END LOOP;
      FOR r IN
        SELECT p.oid::regprocedure AS fn FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.fn || ' CASCADE';
      END LOOP;
      FOR r IN
        SELECT t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
      END LOOP;
    END $$;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS pgboss CASCADE;
  `),
  );
  console.log('schemas emptied');
} finally {
  await pool.end();
}

await runMigrations(url);
console.log('migrations applied');

const seed = resolve(dirname(fileURLToPath(import.meta.url)), 'seed/seed.ts');
const res = spawnSync(process.execPath, ['--import', 'tsx', seed, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);
