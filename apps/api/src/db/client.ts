import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export interface DbHandle { db: Db; kind: 'postgres' | 'pglite'; close: () => Promise<void> }

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/**
 * PostgreSQL when a connection string is configured; otherwise PGlite (the Postgres engine
 * compiled to WASM). Both run the same SQL migrations, so behaviour matches production.
 * `memory` is used by tests.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, kind: 'postgres', close: () => pool.end() };
  }
  const dir = opts.pgliteDir ?? 'memory';
  if (dir !== 'memory') mkdirSync(dir, { recursive: true });
  const client = dir === 'memory' ? new PGlite() : new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}
