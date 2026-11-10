import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.ts";

describe("production configuration", () => {
  it("rejects the development session secret in production", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "local-development-secret-change-before-use",
    })).toThrow("SESSION_SECRET must be explicitly configured for production");
  });

  it("accepts an explicitly configured production session secret", () => {
    expect(loadConfig({
      NODE_ENV: "production",
      SESSION_SECRET: "production-session-secret-with-at-least-32-characters",
    }).NODE_ENV).toBe("production");
  });
});
