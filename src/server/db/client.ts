import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export interface SqlResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createSqlClient(databaseUrl: string): Promise<SqlClient> {
  if (databaseUrl.startsWith("pglite://")) {
    // Keep the embedded engine out of production bundles; PostgreSQL is mandatory in production.
    const pgliteModule = "@electric-sql/pglite";
    const { PGlite } = await import(pgliteModule);
    const location = databaseUrl.slice("pglite://".length) || "memory://";
    const db = new PGlite(location === ":memory:" ? undefined : location);
    await db.waitReady;
    return {
      async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const result = await db.query(sql, params) as { rows: T[]; affectedRows?: number };
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
      },
      async exec(sql: string) {
        await db.exec(sql);
      },
      async transaction<T>(callback: () => Promise<T>) {
        await db.exec("BEGIN");
        try {
          const value = await callback();
          await db.exec("COMMIT");
          return value;
        } catch (error) {
          await db.exec("ROLLBACK");
          throw error;
        }
      },
      async close() {
        await db.close();
      },
    };
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 12 });
  const transactionStore = new AsyncLocalStorage<PoolClient>();
  // Instantiate Drizzle so the runtime and schema share one production connection.
  drizzle(pool, { schema });
  return {
    async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await (transactionStore.getStore() ?? pool).query<T>(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async exec(sql: string) {
      await (transactionStore.getStore() ?? pool).query(sql);
    },
    async transaction<T>(callback: () => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await transactionStore.run(client, callback);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
