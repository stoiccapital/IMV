import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/server/app.ts";
import { hashPassword } from "../src/server/auth/crypto.ts";
import { createSqlClient, type SqlClient } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { Repository } from "../src/server/services/repository.ts";
import type { AppConfig } from "../src/server/config.ts";

describe("API authorization, validation and immutability", () => {
  let sql: SqlClient;
  let app: ReturnType<typeof createApp>;
  const adminId = randomUUID();
  const catalogId = randomUUID();
  const config: AppConfig = {
    NODE_ENV: "test", PORT: 3000, DATABASE_URL: "pglite://:memory:",
    SESSION_SECRET: "test-session-secret-with-at-least-thirty-two-chars", APP_ORIGIN: "http://localhost:5173",
  };

  beforeAll(async () => {
    sql = await createSqlClient(config.DATABASE_URL);
    await migrate(sql);
    await sql.query(`INSERT INTO users (id,email,display_name,password_hash,role) VALUES ($1,'admin@example.test','Admin',$2,'admin')`, [adminId, await hashPassword("correct-horse-battery-staple")]);
    await sql.query(
      `INSERT INTO catalog_versions (id,name,year,quarter,source_file_name,source_file_sha256,record_count,kgk_code_count,review_note_count,index_series_confirmed,import_summary)
       VALUES ($1,'Q3 2026',2026,3,'private.csv','sha256',0,0,0,false,'{}'::jsonb)`, [catalogId],
    );
    app = createApp(new Repository(sql), config);
  }, 30_000);
  afterAll(async () => sql.close());

  it("rejects unauthenticated project access", async () => {
    await request(app).get("/api/projects").expect(401);
  });

  it("logs in, creates a project, calculates a line and blocks an invalid release", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "admin@example.test", password: "correct-horse-battery-staple" }).expect(200);
    expect(login.body.user).not.toHaveProperty("passwordHash");
    await agent.get("/api/auth/me").expect(200);

    const projectResponse = await agent.post("/api/projects").send({
      projectNumber: "T-001", name: "Testprojekt", client: "Auftraggeber", projectManager: "Admin", planningPhase: "LPH 2",
      estimateType: "detail", priceYear: 2026, priceQuarter: 3, catalogVersionId: catalogId, taxMode: "net",
    }).expect(201);
    const projectId = projectResponse.body.project.id;
    const versionId = projectResponse.body.project.versionId;
    const lineResponse = await agent.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send({
      kgkCode: "1011000", designation: "Testposition", quantity: "2", unit: "m²", indexedUnitPrice: "40.57",
      priceType: "unit", factor: "1", usageClassification: "detail", planningPhaseAllowed: true, reviewNoteStatus: "resolved",
    }).expect(201);
    expect(lineResponse.body.line.total).toBe("81.14");

    await agent.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send({
      kgkCode: "1011000", designation: "Unvollständige Regel", quantity: "1", unit: "St", priceType: "parameter",
      usageClassification: "detail", planningPhaseAllowed: true, reviewNoteStatus: "resolved",
    }).expect(201);
    const validation = await agent.get(`/api/projects/${projectId}/versions/${versionId}/validation`).expect(200);
    expect(validation.body.issues).toContainEqual(expect.objectContaining({ code: "CALCULATION_RULE_INCOMPLETE", severity: "error" }));
    await agent.post(`/api/projects/${projectId}/versions/${versionId}/release`).expect(409);

    const exportResult = await agent.get(`/api/projects/${projectId}/versions/${versionId}/exports/json`).expect(200);
    expect(exportResult.body.totals.net).toBe("81.14");
  }, 30_000);

  it("blocks KKK cost indicators from LPH 3", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin@example.test", password: "correct-horse-battery-staple" }).expect(200);
    const created = await agent.post("/api/projects").send({
      projectNumber: "T-KKK-003", name: "KKK Test", client: "Auftraggeber", projectManager: "Admin", planningPhase: "LPH 3",
      estimateType: "kkk", priceYear: 2026, priceQuarter: 3, catalogVersionId: catalogId,
    }).expect(201);
    const projectId = created.body.project.id;
    const versionId = created.body.project.currentVersionId;
    await agent.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send({
      kgkCode: "1011000", designation: "KKK-Kennwert", quantity: "1", unit: "m²", indexedUnitPrice: "100",
      priceType: "unit", usageClassification: "kkk", planningPhaseAllowed: true, reviewNoteStatus: "resolved",
    }).expect(201);
    const validation = await agent.get(`/api/projects/${projectId}/versions/${versionId}/validation`).expect(200);
    expect(validation.body.issues).toContainEqual(expect.objectContaining({ code: "KKK_NOT_ALLOWED_FROM_LPH3", severity: "error" }));
  }, 30_000);

  it("clones an immutable snapshot and compares quantity, price and total changes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "admin@example.test", password: "correct-horse-battery-staple" }).expect(200);
    const created = await agent.post("/api/projects").send({
      projectNumber: "T-VERSION-001", name: "Versionsvergleich", client: "Auftraggeber", projectManager: "Admin", planningPhase: "LPH 2",
      estimateType: "detail", priceYear: 2026, priceQuarter: 3, catalogVersionId: catalogId,
    }).expect(201);
    const projectId = created.body.project.id;
    const baseVersionId = created.body.project.currentVersionId;
    await agent.post(`/api/projects/${projectId}/versions/${baseVersionId}/lines`).send({
      kgkCode: "1011000", designation: "Vergleichsposition", quantity: "2", unit: "m²", indexedUnitPrice: "25",
      priceType: "unit", factor: "1", usageClassification: "detail", planningPhaseAllowed: true, reviewNoteStatus: "resolved",
    }).expect(201);
    const cloned = await agent.post(`/api/projects/${projectId}/versions/${baseVersionId}/clone`).send({
      variantName: "Optimiert", reason: "Mengenoptimierung",
    }).expect(201);
    const targetVersionId = cloned.body.version.id;
    const targetEstimate = await agent.get(`/api/projects/${projectId}/versions/${targetVersionId}`).expect(200);
    const targetLineId = targetEstimate.body.lines[0].id;
    await agent.patch(`/api/projects/${projectId}/versions/${targetVersionId}/lines/${targetLineId}`).send({ quantity: "3", reason: "Menge angepasst" }).expect(200);

    const versions = await agent.get(`/api/projects/${projectId}/versions`).expect(200);
    expect(versions.body.versions).toHaveLength(2);
    expect(versions.body.versions).toContainEqual(expect.objectContaining({ id: targetVersionId, variantName: "Optimiert", totalNetCents: 7500 }));
    const comparison = await agent.get(`/api/projects/${projectId}/versions/${targetVersionId}/compare/${baseVersionId}`).expect(200);
    expect(comparison.body.comparison.totals).toMatchObject({ fromNet: "50.00", toNet: "75.00", absoluteDelta: "25.00", percentageDelta: "50" });
    expect(comparison.body.comparison.counts).toMatchObject({ added: 0, removed: 0, modified: 1, unchanged: 0 });
    expect(comparison.body.comparison.changes[0]).toMatchObject({ type: "modified", fields: expect.arrayContaining(["Menge", "Gesamtpreis"]) });
  }, 30_000);
});
