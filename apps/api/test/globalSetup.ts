import pg from 'pg';
import { loadConfig } from '../src/config';
import { createDb } from '../src/db/client';
import { seedBase } from '../src/db/seed/base';
import { runMigrations } from '../src/migrate';
import { testConfig } from './config';

/** Recreates the test database, applies migrations and the base seed (CONVENTIONS §6). */
export default async function setup() {
  const config = loadConfig();
  const url = config.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required for API tests');
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`Refusing to recreate non-test database ${dbName}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();
  await runMigrations(url);
  const { db, pool } = createDb(url, { max: 2 });
  await seedBase(db, testConfig());
  await pool.end();
}
