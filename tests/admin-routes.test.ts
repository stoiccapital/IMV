import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAdminRoutes } from "../src/server/admin-routes.ts";
import { createSqlClient, type SqlClient } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { Repository } from "../src/server/services/repository.ts";
import type { AuthUser } from "../src/shared/types.ts";

describe("admin route contract", () => {
  let sql: SqlClient;
  let app: express.Express;
  let actor: AuthUser;

  beforeAll(async () => {
    sql = await createSqlClient("pglite://:memory:");
    await migrate(sql);
    actor = { id: randomUUID(), email: "admin@example.test", displayName: "Administration", role: "admin" };
    await sql.query("INSERT INTO users (id,email,display_name,password_hash,role) VALUES ($1,$2,$3,'x','admin')", [actor.id, actor.email, actor.displayName]);
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as typeof req & { user: AuthUser }).user = actor; next(); });
    registerAdminRoutes(app, new Repository(sql));
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ message: error.message }));
  });
  afterAll(async () => sql.close());

  it("returns the response shapes consumed by the administrative UI", async () => {
    const user = await request(app).post("/api/admin/users").send({
      email: "editor@example.test", displayName: "Bearbeitung", password: "sicheres-testpasswort", role: "editor",
    }).expect(201);
    expect(user.body.user).toMatchObject({ displayName: "Bearbeitung", role: "editor", active: true });
    await request(app).patch(`/api/admin/users/${user.body.user.id}`).send({ role: "reviewer" }).expect(200);

    const unitId = randomUUID();
    await sql.query("INSERT INTO unit_registry (id,unit,label) VALUES ($1,'m²','Quadratmeter')", [unitId]);
    const units = await request(app).get("/api/admin/units").expect(200);
    expect(units.body.units[0]).toMatchObject({ canonicalUnit: "m²", displayName: "Quadratmeter", approved: false });
    await request(app).patch(`/api/admin/units/${unitId}`).send({ approved: true, note: "geprüft" }).expect(200);

    const series = await request(app).post("/api/admin/index-series").send({ name: "QA Index", source: "QA", baseYear: 2021, version: 1, approved: true }).expect(201);
    const seriesId = series.body.indexSeries.id;
    const withValue = await request(app).post(`/api/admin/index-series/${seriesId}/values`).send({ year: 2026, quarter: 3, value: "141,7", sourceReference: "QA" }).expect(200);
    expect(withValue.body.indexSeries.values).toContainEqual(expect.objectContaining({ year: 2026, quarter: 3, value: "141.70000000" }));

    const catalogId = randomUUID();
    await sql.query("INSERT INTO catalog_versions (id,name,year,quarter,source_file_name,source_file_sha256) VALUES ($1,'QA',2026,3,'qa.csv','sha')", [catalogId]);
    await request(app).post(`/api/admin/catalog-versions/${catalogId}/index-series`).send({ indexSeriesId: seriesId }).expect(200);

    const itemId = randomUUID();
    await sql.query("INSERT INTO price_items (id,catalog_version_id,dataset_id,kgk_code,designation,unit,usage_classification,raw_snapshot) VALUES ($1,$2,'KGK-QA','1011000','QA Position','m²','review_required','{}'::jsonb)", [itemId, catalogId]);
    const classified = await request(app).post("/api/admin/catalog-items/classify").send({
      priceItemIds: [itemId], usageClassification: "detail", allowedFromLph: 1, allowedToLph: 9, classificationSource: "Fachprüfung QA",
    }).expect(200);
    expect(classified.body.updated).toBe(1);

    const rule = await request(app).post("/api/admin/calculation-rules").send({
      code: "LINEAR", name: "Lineare Regel", expression: "linear", parameterSchema: { basis: "number" }, approved: true,
    }).expect(201);
    expect(rule.body.calculationRule).toMatchObject({ code: "LINEAR", approved: true });
  });
});
