import { z } from "zod";

const DEVELOPMENT_SESSION_SECRET = "local-development-secret-change-before-use";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default("pglite://./data/dev"),
  SESSION_SECRET: z.string().min(32).default(DEVELOPMENT_SESSION_SECRET),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(overrides: Partial<Record<keyof AppConfig, string | number>> = {}): AppConfig {
  const config = schema.parse({ ...process.env, ...overrides });
  if (config.NODE_ENV === "production" && config.SESSION_SECRET === DEVELOPMENT_SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be explicitly configured for production");
  }
  return config;
}
