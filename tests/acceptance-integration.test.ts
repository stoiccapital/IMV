import { TextDecoder } from "node:util";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { hashPassword } from "../src/server/auth/crypto.ts";
import { createSqlClient, type SqlClient } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";
import { Repository } from "../src/server/services/repository.ts";
import type { AppConfig } from "../src/server/config.ts";

const PASSWORD = "correct-horse-battery-staple";

describe("acceptance controls for search, audit, access, immutability and exports", () => {
  let sql: SqlClient;
  let app: ReturnType<typeof createApp>;
  let admin: ReturnType<typeof request.agent>;
  let editorA: ReturnType<typeof request.agent>;
  let editorB: ReturnType<typeof request.agent>;
  let reader: ReturnType<typeof request.agent>;
  const catalogId = randomUUID();
  const users = {
    admin: { id: randomUUID(), email: "acceptance-admin@example.test", role: "admin" },
    editorA: { id: randomUUID(), email: "acceptance-editor-a@example.test", role: "editor" },
    editorB: { id: randomUUID(), email: "acceptance-editor-b@example.test", role: "editor" },
    reader: { id: randomUUID(), email: "acceptance-reader@example.test", role: "reader" },
  } as const;
  const config: AppConfig = {
    NODE_ENV: "test",
    PORT: 3000,
    DATABASE_URL: "pglite://:memory:",
    SESSION_SECRET: "acceptance-session-secret-with-at-least-thirty-two-chars",
    APP_ORIGIN: "http://localhost:5173",
  };

  beforeAll(async () => {
    sql = await createSqlClient(config.DATABASE_URL);
    await migrate(sql);
    const passwordHash = await hashPassword(PASSWORD);
    for (const [key, user] of Object.entries(users)) {
      await sql.query(
        `INSERT INTO users (id,email,display_name,password_hash,role) VALUES ($1,$2,$3,$4,$5)`,
        [user.id, user.email, key, passwordHash, user.role],
      );
    }
    await sql.query(
      `INSERT INTO catalog_versions
       (id,name,year,quarter,source_file_name,source_file_sha256,record_count,kgk_code_count,review_note_count,index_series_confirmed,import_summary)
       VALUES ($1,'Q3 2026 Acceptance',2026,3,'acceptance.csv','acceptance-sha256',2,2,0,true,'{}'::jsonb)`,
      [catalogId],
    );
    await insertCatalogItem({
      datasetId: "KGK-SEARCH-001",
      positionId: "POS-SIG-42",
      kgkCode: "4011200",
      designation: "Signaltechnik Innenanlage",
      explanation: "Stellwerk und signaltechnische Ausrüstung",
      basis: "Ausführungsplanung Signaltechnik",
      source: "Einheitspreiskatalog Test",
    });
    await insertCatalogItem({
      datasetId: "KGK-SEARCH-002",
      positionId: "POS-BRU-17",
      kgkCode: "3031000",
      designation: "Brückenüberbau herstellen",
      explanation: "Überbau aus Stahlbeton",
      basis: "Tragwerksplanung",
      source: "Kostenkennwerte Test",
    });
    app = createApp(new Repository(sql), config);
    admin = await login(users.admin.email);
    editorA = await login(users.editorA.email);
    editorB = await login(users.editorB.email);
    reader = await login(users.reader.email);
  }, 30_000);

  afterAll(async () => sql.close());

  it("finds catalog records by KGK prefix, position ID and full text", async () => {
    const byKgk = await admin.get("/api/catalog/items").query({ kgk: "401", pageSize: 10 }).expect(200);
    expect(byKgk.body.items).toHaveLength(1);
    expect(byKgk.body.items[0]).toMatchObject({ dataRecordId: "KGK-SEARCH-001", kgkCode: "4011200" });

    const byPosition = await admin.get("/api/catalog/items").query({ q: "POS-SIG-42", pageSize: 10 }).expect(200);
    expect(byPosition.body.items).toHaveLength(1);
    expect(byPosition.body.items[0].positionId).toBe("POS-SIG-42");

    const byText = await admin.get("/api/catalog/items").query({ q: "signaltechnische Ausrüstung", pageSize: 10 }).expect(200);
    expect(byText.body.items).toHaveLength(1);
    expect(byText.body.items[0].description).toBe("Signaltechnik Innenanlage");
  });

  it("requires complete manual-price metadata and writes old/new values plus reason to the audit log", async () => {
    const { projectId, versionId } = await createProject(admin, "ACC-MANUAL");
    const created = await addLine(admin, projectId, versionId, {
      designation: "Manueller Preis",
      quantity: "2",
      indexedUnitPrice: "40.57",
    });
    const lineId = created.body.line.id as string;

    await admin.patch(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`).send({ manualUnitPrice: "125.50" }).expect(200);
    const invalid = await admin.get(`/api/projects/${projectId}/versions/${versionId}/validation`).expect(200);
    expect(invalid.body.issues.filter((issue: { code: string }) => issue.code === "MANUAL_PRICE_METADATA")).toHaveLength(4);

    await admin.patch(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`).send({
      manualUnitPrice: "125.50",
      manualPriceSource: "Interne Kostenprüfung",
      manualPriceDate: "Q3 2026",
      manualPriceReason: "Geprüftes projektspezifisches Angebot",
      manualPriceEditor: "Acceptance Admin",
      reason: "Einheitspreis auf geprüftes Angebot angepasst",
    }).expect(200);
    const valid = await admin.get(`/api/projects/${projectId}/versions/${versionId}/validation`).expect(200);
    expect(valid.body.issues).not.toContainEqual(expect.objectContaining({ code: "MANUAL_PRICE_METADATA" }));

    const audit = await sql.query<Record<string, unknown>>(
      `SELECT old_value AS "oldValue",new_value AS "newValue",reason
       FROM audit_log WHERE entity_type='estimate_line' AND entity_id=$1 AND action='update'
       ORDER BY created_at DESC LIMIT 1`,
      [lineId],
    );
    expect(audit.rows[0]?.reason).toBe("Einheitspreis auf geprüftes Angebot angepasst");
    expect(audit.rows[0]?.oldValue).toMatchObject({ manualUnitPrice: "125.500000" });
    expect(audit.rows[0]?.newValue).toMatchObject({ manualUnitPrice: "125.50", manualPriceSource: "Interne Kostenprüfung" });
  });

  it("enforces project membership and role permissions on the server", async () => {
    const { projectId, versionId } = await createProject(editorA, "ACC-ACCESS");

    await editorB.get(`/api/projects/${projectId}`).expect(403);
    const editorBProjects = await editorB.get("/api/projects").expect(200);
    expect(editorBProjects.body.projects).not.toContainEqual(expect.objectContaining({ id: projectId }));
    await editorB.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send(validLine()).expect(403);
    await editorA.get("/api/admin/overview").expect(403);
    await editorA.get("/api/admin/catalog-versions").expect(403);

    await sql.query(`INSERT INTO project_members (project_id,user_id,access_role) VALUES ($1,$2,'reader')`, [projectId, users.reader.id]);
    await reader.get(`/api/projects/${projectId}`).expect(200);
    await reader.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send(validLine()).expect(403);
  });

  it("keeps a released version immutable", async () => {
    const { projectId, versionId } = await createProject(admin, "ACC-IMMUTABLE");
    const line = await addLine(admin, projectId, versionId, { designation: "Freigabefähige Position" });
    const lineId = line.body.line.id as string;

    const released = await admin.post(`/api/projects/${projectId}/versions/${versionId}/release`).send({ note: "Fachlich geprüft" }).expect(200);
    expect(released.body.version).toMatchObject({ status: "released", immutable: true });

    await admin.patch(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`).send({ quantity: "3" }).expect(409);
    await admin.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send(validLine()).expect(409);
    await admin.delete(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`).send({ reason: "Sollte nicht möglich sein" }).expect(409);
    await admin.patch(`/api/projects/${projectId}/versions/${versionId}`).send({ variantName: "Geändert", reason: "Sollte nicht möglich sein" }).expect(409);

    const persisted = await sql.query<Record<string, unknown>>(
      `SELECT quantity::text,status,immutable FROM estimate_lines el
       JOIN project_versions pv ON pv.id=el.project_version_id WHERE el.id=$1`,
      [lineId],
    );
    expect(persisted.rows[0]).toMatchObject({ quantity: "2.000000", status: "released", immutable: true });
  });

  it("uses the same cent-accurate net total in JSON, CSV, XLSX and PDF exports", async () => {
    const { projectId, versionId } = await createProject(admin, "ACC-EXPORT");
    await addLine(admin, projectId, versionId, { designation: "Exportposition", quantity: "3", indexedUnitPrice: "12.50" });
    const estimate = await admin.get(`/api/projects/${projectId}/versions/${versionId}`).expect(200);
    expect(estimate.body.totals.netCents).toBe(3750);

    const json = await admin.get(`/api/projects/${projectId}/versions/${versionId}/exports/json`).expect(200);
    expect(json.body.totals.net).toBe("37.50");

    const csv = await admin.get(`/api/projects/${projectId}/versions/${versionId}/exports/csv`).expect(200);
    expect(csv.text).toContain("Gesamtsumme netto;37.50");

    const xlsx = await getBinary(admin, `/api/projects/${projectId}/versions/${versionId}/exports/xlsx`).expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from([asBuffer(xlsx.body)]));
    expect(workbook.getWorksheet("Deckblatt")?.getCell("B15").value).toBe(37.5);
    const positions = workbook.getWorksheet("Kostenermittlung");
    const headerValues = positions?.getRow(1).values;
    const headerArray = Array.isArray(headerValues) ? headerValues as ExcelJS.CellValue[] : [];
    const totalColumn = headerArray.findIndex((value) => value === "Gesamtpreis");
    expect(totalColumn).toBeGreaterThan(0);
    expect(positions?.getCell(2, totalColumn).value).toBe(37.5);

    const pdf = await getBinary(admin, `/api/projects/${projectId}/versions/${versionId}/exports/pdf`).expect(200);
    expect(asBuffer(pdf.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(extractPdfText(asBuffer(pdf.body)).replaceAll("\u00a0", " ")).toContain("Gesamtsumme netto: 37,50 €");
  }, 30_000);

  async function insertCatalogItem(input: {
    datasetId: string;
    positionId: string;
    kgkCode: string;
    designation: string;
    explanation: string;
    basis: string;
    source: string;
  }) {
    await sql.query(
      `INSERT INTO price_items
       (id,catalog_version_id,dataset_id,position_id,kgk_code,kgk_path,designation,explanation,basis,unit,price_type_raw,
        price_q3_2026,source,source_reference,usage_classification,raw_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'St','Einheitspreis',12.50,$10,'Testfundstelle','detail',$11::jsonb)`,
      [randomUUID(), catalogId, input.datasetId, input.positionId, input.kgkCode, `${input.kgkCode} > Test`, input.designation,
        input.explanation, input.basis, input.source, JSON.stringify(input)],
    );
  }

  async function login(email: string): Promise<ReturnType<typeof request.agent>> {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
    return agent;
  }

  async function createProject(agent: ReturnType<typeof request.agent>, projectNumber: string) {
    const response = await agent.post("/api/projects").send({
      projectNumber,
      name: `Projekt ${projectNumber}`,
      client: "Acceptance Auftraggeber",
      route: "Teststrecke",
      kilometer: "km 1,0–2,0",
      projectManager: "Acceptance Projektleitung",
      planningPhase: "LPH 2",
      estimateType: "detail",
      priceYear: 2026,
      priceQuarter: 3,
      catalogVersionId: catalogId,
      taxMode: "net",
    }).expect(201);
    return {
      projectId: response.body.project.id as string,
      versionId: (response.body.project.currentVersionId ?? response.body.project.versionId) as string,
    };
  }

  function validLine(overrides: Record<string, unknown> = {}) {
    return {
      kgkCode: "4011200",
      kgkPath: "Technische Anlagen > Signaltechnik",
      designation: "Gültige Testposition",
      quantity: "2",
      unit: "St",
      indexedUnitPrice: "40.57",
      priceType: "unit",
      factor: "1",
      source: "Acceptance Test",
      sourceReference: "Testfall",
      usageClassification: "detail",
      planningPhaseAllowed: true,
      reviewNoteStatus: "resolved",
      workStatus: "checked",
      ...overrides,
    };
  }

  function addLine(agent: ReturnType<typeof request.agent>, projectId: string, versionId: string, overrides: Record<string, unknown> = {}) {
    return agent.post(`/api/projects/${projectId}/versions/${versionId}/lines`).send(validLine(overrides)).expect(201);
  }
});

function getBinary(agent: ReturnType<typeof request.agent>, path: string) {
  return agent.get(path).buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
    response.on("error", (error: Error) => callback(error, null));
  });
}

function asBuffer(value: unknown): Buffer<ArrayBuffer> {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError("Expected a binary response body");
}

function extractPdfText(pdf: Buffer<ArrayBuffer>): string {
  const source = pdf.toString("latin1");
  const bytes: Buffer[] = [];
  for (const stream of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let inflated: Buffer;
    try {
      inflated = inflateSync(Buffer.from(stream[1] ?? "", "latin1"));
    } catch {
      continue;
    }
    const content = inflated.toString("latin1");
    for (const token of content.matchAll(/<([0-9a-f]+)>/gi)) bytes.push(Buffer.from(token[1] ?? "", "hex"));
  }
  return new TextDecoder("windows-1252").decode(Buffer.concat(bytes));
}
