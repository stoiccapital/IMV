import path from "node:path";
import { createSqlClient } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { loadConfig } from "../config.ts";
import { importCatalog } from "../services/catalog-import.ts";

const args = parseArgs(process.argv.slice(2));
const file = args.file ?? process.env.CATALOG_BOOTSTRAP_FILE;
if (!file) throw new Error("Usage: pnpm catalog:import -- --file <private.csv> [--name 'Q3 2026'] [--year 2026] [--quarter 3]");
const config = loadConfig();
const sql = await createSqlClient(config.DATABASE_URL);
try {
  await migrate(sql);
  const result = await importCatalog(sql, path.resolve(file), {
    name: args.name ?? "Q3 2026",
    year: Number(args.year ?? 2026),
    quarter: Number(args.quarter ?? 3),
  });
  console.log(JSON.stringify({ catalogVersionId: result.catalogVersionId, ...result.analysis }, null, 2));
} finally {
  await sql.close();
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const next = values[index + 1];
    if (next && !next.startsWith("--")) { result[value.slice(2)] = next; index += 1; }
  }
  return result;
}
