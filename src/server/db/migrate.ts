import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlClient, type SqlClient } from "./client.ts";
import { loadConfig } from "../config.ts";

export async function migrate(client: SqlClient): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../drizzle/0000_initial.sql"),
    path.resolve(process.cwd(), "drizzle/0000_initial.sql"),
  ];
  let sql: string | undefined;
  for (const candidate of candidates) {
    try {
      sql = await fs.readFile(candidate, "utf8");
      break;
    } catch {
      // Try the next packaged/source location.
    }
  }
  if (!sql) throw new Error("Migration drizzle/0000_initial.sql was not found");
  await client.exec(sql);
}

async function main() {
  const config = loadConfig();
  const client = await createSqlClient(config.DATABASE_URL);
  try {
    await migrate(client);
    console.log("Database migration completed.");
  } finally {
    await client.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
