import { loadConfig } from "./config.ts";
import { createSqlClient } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";
import { Repository } from "./services/repository.ts";
import { createApp } from "./app.ts";

const config = loadConfig();
const sql = await createSqlClient(config.DATABASE_URL);
await migrate(sql);
const repository = new Repository(sql);
const app = createApp(repository, config);
const server = app.listen(config.PORT, () => {
  console.log(`IMV Kostenmanager 808 listening on port ${config.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await sql.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
