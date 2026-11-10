import { randomUUID } from "node:crypto";
import { createSqlClient } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { loadConfig } from "../config.ts";
import { hashPassword } from "../auth/crypto.ts";
import { Repository } from "../services/repository.ts";
import type { AuthUser } from "../../shared/types.ts";

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const displayName = process.env.SEED_ADMIN_NAME ?? "Lokale Administration";
if (!email || !password || password.length < 12) {
  throw new Error("SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD with at least 12 characters are required");
}
const config = loadConfig();
const sql = await createSqlClient(config.DATABASE_URL);
try {
  await migrate(sql);
  let user = await new Repository(sql).findUserByEmail(email);
  if (!user) {
    const id = randomUUID();
    await sql.query(`INSERT INTO users (id,email,display_name,password_hash,role) VALUES ($1,$2,$3,$4,'admin')`, [id, email, displayName, await hashPassword(password)]);
    user = { id, email, displayName, role: "admin", passwordHash: "" };
    console.log(`Admin user ${email} created.`);
  } else {
    console.log(`Admin user ${email} already exists.`);
  }

  const admin: AuthUser = { id: user.id, email: user.email, displayName: user.displayName, role: "admin" };
  const catalog = await sql.query<Record<string, unknown>>(`SELECT id FROM catalog_versions ORDER BY imported_at DESC LIMIT 1`);
  if (!catalog.rows[0]) {
    console.log("No catalog imported; demo project skipped. Import the private CSV and run db:seed again.");
  } else {
    const existing = await sql.query<Record<string, unknown>>(`SELECT id FROM projects WHERE project_number='IMV-DEMO-808'`);
    if (!existing.rows.length) await seedExample(new Repository(sql), sql, admin, String(catalog.rows[0].id));
  }
} finally {
  await sql.close();
}

async function seedExample(repository: Repository, sql: Awaited<ReturnType<typeof createSqlClient>>, admin: AuthUser, catalogVersionId: string) {
  const project = await repository.createProject(admin, {
    projectNumber: "IMV-DEMO-808", name: "Beispielprojekt Ril 808", client: "Interne Demonstration", route: "Beispielstrecke",
    kilometer: "km 0,0–1,0", projectManager: admin.displayName, planningPhase: "LPH 2", estimateType: "detail",
    priceYear: 2026, priceQuarter: 3, catalogVersionId, taxMode: "net", variantName: "Basis",
  });
  const versionId = String(project.versionId);
  const catalog = await sql.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (kgk_code)
            id,dataset_id,kgk_code,kgk_path,designation,unit,base_price,price_q3_2026,source,source_reference
     FROM price_items
     WHERE catalog_version_id=$1 AND price_q3_2026 IS NOT NULL
     ORDER BY kgk_code,dataset_id
     LIMIT 3`, [catalogVersionId],
  );
  const [first, second, third] = catalog.rows;
  if (!first) return;
  const line1 = await repository.addLine(admin, String(project.id), versionId, {
    kgkCode: first.kgk_code, kgkPath: first.kgk_path, designation: first.designation, quantity: "10", unit: first.unit,
    originalUnitPrice: first.base_price, indexedUnitPrice: first.price_q3_2026, priceType: "unit", factor: "1",
    source: first.source, sourceReference: first.source_reference, usageClassification: "detail", planningPhaseAllowed: true,
    reviewNoteStatus: "acknowledged", workStatus: "checked",
  });
  await repository.addLine(admin, String(project.id), versionId, {
    kgkCode: second?.kgk_code ?? first.kgk_code, kgkPath: second?.kgk_path, designation: "Prozentansatz – Beispiel",
    priceType: "percentage", percentRate: "5", referenceKind: "line", referenceId: line1.id,
    usageClassification: "detail", planningPhaseAllowed: true, reviewNoteStatus: "acknowledged", workStatus: "open",
  });
  await repository.addLine(admin, String(project.id), versionId, {
    kgkCode: third?.kgk_code ?? first.kgk_code, designation: "Zuschlag – Beispiel", quantity: "1", unit: "St",
    indexedUnitPrice: third?.price_q3_2026 ?? "250", priceType: "surcharge", referenceKind: "line", referenceId: line1.id,
    usageClassification: "detail", planningPhaseAllowed: true, reviewNoteStatus: "acknowledged", workStatus: "open",
  });
  await repository.addLine(admin, String(project.id), versionId, {
    kgkCode: first.kgk_code, designation: "Manueller Einheitspreis – Beispiel", quantity: "2", unit: first.unit,
    originalUnitPrice: first.price_q3_2026, indexedUnitPrice: first.price_q3_2026, manualUnitPrice: "125.50",
    manualPriceSource: "Interne Kostenprüfung", manualPriceDate: "Q3 2026", manualPriceReason: "Beispiel einer dokumentierten Abweichung",
    manualPriceEditor: admin.displayName, priceType: "unit", usageClassification: "detail", planningPhaseAllowed: true,
    reviewNoteStatus: "acknowledged", workStatus: "checked",
  });
  await repository.addLine(admin, String(project.id), versionId, {
    kgkCode: first.kgk_code, designation: "Unvollständige Berechnungsregel – Beispiel", quantity: "1", unit: "St",
    priceType: "parameter", calculationRule: null, usageClassification: "detail", planningPhaseAllowed: true,
    reviewNoteStatus: "acknowledged", workStatus: "open",
  });
  console.log("Example project IMV-DEMO-808 created; incomplete parameter rule intentionally blocks release.");
}
