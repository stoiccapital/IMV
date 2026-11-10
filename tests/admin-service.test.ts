import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { AdminService } from "../src/server/services/admin-service.ts";
import type { AuthUser } from "../src/shared/types.ts";

describe("administrative configuration", () => {
  let sql: SqlClient;
  let service: AdminService;
  let actor: AuthUser;

  beforeAll(async () => {
    sql = await createSqlClient("pglite://:memory:");
    await migrate(sql);
    actor = { id: randomUUID(), email: "admin@example.test", displayName: "Administration", role: "admin" };
    await sql.query("INSERT INTO users (id,email,display_name,password_hash,role) VALUES ($1,$2,$3,'x','admin')", [actor.id, actor.email, actor.displayName]);
    service = new AdminService(sql);
  });
  afterAll(async () => sql.close());

  it("manages users and prevents removal of the last active administrator", async () => {
    const created = await service.createUser(actor, {
      email: "editor@example.test", displayName: "Bearbeitung", password: "sicheres-testpasswort", role: "editor",
    });
    const updated = await service.updateUser(actor, String(created.id), { role: "reviewer", reason: "Aufgabe geändert" });
    expect(updated).toMatchObject({ role: "reviewer", active: true });
    await expect(service.updateUser(actor, actor.id, { active: false, reason: "nicht zulässig" })).rejects.toThrow(/letzte aktive Administrator/i);
  });

  it("persists unit, index, rule and catalog-classification decisions with audit entries", async () => {
    const unitId = randomUUID();
    await sql.query("INSERT INTO unit_registry (id,unit,label) VALUES ($1,'m²','Quadratmeter')", [unitId]);
    expect(await service.updateUnit(actor, unitId, { approved: true, note: "fachlich geprüft", reason: "Einheitenregister" }))
      .toMatchObject({ canonicalUnit: "m²", approved: true });

    const catalogId = randomUUID();
    await sql.query("INSERT INTO catalog_versions (id,name,year,quarter,source_file_name,source_file_sha256) VALUES ($1,'QA',2026,3,'qa.csv','sha')", [catalogId]);
    const series = await service.createIndexSeries(actor, { name: "QA Index", source: "QA", baseYear: 2021, approved: true, reason: "Indexprüfung" });
    await service.upsertIndexValue(actor, String(series.id), { year: 2026, quarter: 3, value: "141.7", sourceReference: "QA", reason: "Indexprüfung" });
    expect(await service.assignCatalogIndexSeries(actor, catalogId, String(series.id), "Explizite Festlegung"))
      .toMatchObject({ indexSeriesConfirmed: true, targetIndex: "141.70000000" });

    const itemId = randomUUID();
    await sql.query("INSERT INTO price_items (id,catalog_version_id,dataset_id,kgk_code,designation,unit,usage_classification,raw_snapshot) VALUES ($1,$2,'KGK-QA','1011000','QA Position','m²','review_required','{}'::jsonb)", [itemId, catalogId]);
    expect(await service.classifyCatalogItems(actor, {
      itemIds: [itemId], usageClassification: "detail", allowedFromLph: 1, allowedToLph: 9,
      classificationSource: "Fachprüfung QA", reason: "Katalogklassifizierung",
    })).toMatchObject({ count: 1, usageClassification: "detail" });

    const rule = await service.createCalculationRule(actor, {
      code: "LINEAR", name: "Lineare Regel", expression: "linear", parameterSchema: { basis: "number", factor: "number" },
      approved: true, reason: "Regelprüfung",
    });
    expect(rule).toMatchObject({ code: "LINEAR", approved: true });
    const audit = await sql.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_log");
    expect(audit.rows[0]?.count).toBeGreaterThanOrEqual(6);
  });
});
