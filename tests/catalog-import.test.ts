import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { importCatalog, parseGermanDecimal, readAndAnalyzeCatalog } from "../src/server/services/catalog-import.ts";
import { createSqlClient } from "../src/server/db/client.ts";
import { migrate } from "../src/server/db/migrate.ts";

describe("German catalog parsing", () => {
  it.each([
    ["1.234,56", "1234.56"], ["40,57", "40.57"], ["0,00", "0"], ["", null], ["k.A.", null],
  ])("parses %s", (input, expected) => expect(parseGermanDecimal(input)).toBe(expected));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "imv-catalog-"));
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("preserves quoted semicolons, embedded quotes, newlines and raw records", async () => {
    const file = path.join(tempDir, "fixture.csv");
    const header = [
      "Datensatz_ID", "KGK_Code", "KGK_Gliederung", "KGK_Bezeichnung", "KGK_Pfad", "Position_ID", "Bezeichnung",
      "Erlaeuterung", "Ansatz_Grundlage", "Einheit", "Preisart", "Preis_Q3_2026_EUR", "Prozentansatz",
      "Gewaehlter_Bezugszeitraum", "Ausgangspreis", "Ausgangspreis_Untergrenze", "Index_Basis", "Index_Q3_2026",
      "Fortschreibungsfaktor", "Vergleich_2016_Q3_2026_EUR", "Vergleich_2022_Q3_2026_EUR", "Anzahl_Preisbezuege",
      "Gewaehlte_Quelle", "Gewaehlte_Fundstelle", "Original_Einheiten", "EPK_Quellcodes", "Pruefhinweis",
      "Preisbezuege_und_Vergleich", "Indexquelle", "Indexreihe", "Umsatzsteuer", "Berechnung",
    ];
    const values = [
      "KGK-1", "1011000", "1.01.1.0.0.0", "Flächen", "Grundstück > Wert > Fläche", "P-1", "Position",
      '"Text mit; Semikolon, ""Zitat""\nund Zeilenumbruch"', "Ansatz", "m²", "Einheitspreis", "1.234,56", "",
      "Q3 2026", "1000,00", "", "100,0", "123,456", "1,23456", "", "", "1", "Quelle", "Fundstelle",
      "m2", "EPK-1", "Hinweis", "Vergleich", "Indexquelle", "Indexreihe", "Netto", "Ausgangspreis * Faktor",
    ];
    fs.writeFileSync(file, `\ufeff${header.join(";")}\r\n${values.join(";")}\r\n`, "utf8");
    const parsed = await readAndAnalyzeCatalog(file);
    expect(parsed.analysis.headerCount).toBe(32);
    expect(parsed.analysis.recordCount).toBe(1);
    expect(parsed.rows[0]?.Erlaeuterung).toContain("Zeilenumbruch");
    expect(parsed.rows[0]?.Preis_Q3_2026_EUR).toBe("1.234,56");
  });
});

const privateFile = process.env.CATALOG_TEST_FILE;
describe.runIf(Boolean(privateFile))("provided Q3 2026 catalog acceptance controls", () => {
  it("matches the documented first-import controls and exposes the 31/32-column conflict", async () => {
    const parsed = await readAndAnalyzeCatalog(privateFile!);
    expect(parsed.analysis.recordCount).toBe(6719);
    expect(parsed.analysis.kgkCodeCount).toBe(1055);
    expect(parsed.analysis.reviewNoteCount).toBe(1591);
    expect(parsed.analysis.headerCount).toBe(31);
    expect(parsed.analysis.header).not.toContain("Position_ID");
    expect(parsed.analysis.duplicateDatasetIds).toEqual([]);
    expect(parsed.analysis.priceTypeCounts).toMatchObject({ Einheitspreis: 6591, "Zuschlag EUR": 86, Prozentansatz: 21, Berechnungsregel: 21 });
    expect(parsed.analysis.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["SCHEMA_CONFLICT", "SOURCE_INDEX_CONFLICT", "TAGS_COLUMN_MISSING"]));
  }, 30_000);

  it("imports every record losslessly into an immutable catalog version", async () => {
    const sql = await createSqlClient("pglite://:memory:");
    try {
      await migrate(sql);
      const result = await importCatalog(sql, privateFile!, { name: "Q3 2026 Acceptance", year: 2026, quarter: 3 });
      const counts = await sql.query<Record<string, unknown>>(
        `SELECT (SELECT count(*) FROM price_items WHERE catalog_version_id=$1)::int AS items,
                (SELECT count(*) FROM kgk_nodes WHERE catalog_version_id=$1)::int AS kgk,
                (SELECT count(*) FROM price_items WHERE catalog_version_id=$1 AND nullif(trim(review_note),'') IS NOT NULL)::int AS notes,
                (SELECT bool_and(raw_snapshot IS NOT NULL) FROM price_items WHERE catalog_version_id=$1) AS "rawSnapshots"`,
        [result.catalogVersionId],
      );
      expect(counts.rows[0]).toMatchObject({ items: 6719, kgk: 1055, notes: 1591, rawSnapshots: true });
    } finally {
      await sql.close();
    }
  }, 120_000);
});
