import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

// numeric → string (default), date → string (YYYY-MM-DD) to avoid timezone shifts.
pg.types.setTypeParser(1082, (v: string) => v);

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url: string, opts: { max?: number; ssl?: boolean } = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, db };
}

export { schema };
