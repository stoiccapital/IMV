import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import Decimal from "decimal.js";
import type { SqlClient } from "../db/client.ts";

export const EXPECTED_CATALOG_COLUMNS = [
  "Datensatz_ID", "KGK_Code", "KGK_Gliederung", "KGK_Bezeichnung", "KGK_Pfad", "Position_ID",
  "Bezeichnung", "Erlaeuterung", "Ansatz_Grundlage", "Einheit", "Preisart", "Preis_Q3_2026_EUR",
  "Prozentansatz", "Gewaehlter_Bezugszeitraum", "Ausgangspreis", "Ausgangspreis_Untergrenze",
  "Index_Basis", "Index_Q3_2026", "Fortschreibungsfaktor", "Vergleich_2016_Q3_2026_EUR",
  "Vergleich_2022_Q3_2026_EUR", "Anzahl_Preisbezuege", "Gewaehlte_Quelle", "Gewaehlte_Fundstelle",
  "Original_Einheiten", "EPK_Quellcodes", "Pruefhinweis", "Preisbezuege_und_Vergleich", "Indexquelle",
  "Indexreihe", "Umsatzsteuer", "Berechnung",
] as const;

const NUMERIC_COLUMNS = [
  "Preis_Q3_2026_EUR", "Prozentansatz", "Ausgangspreis", "Ausgangspreis_Untergrenze",
  "Index_Basis", "Index_Q3_2026", "Fortschreibungsfaktor", "Vergleich_2016_Q3_2026_EUR",
  "Vergleich_2022_Q3_2026_EUR", "Anzahl_Preisbezuege",
] as const;

export interface CatalogImportIssue {
  severity: "info" | "warning" | "blocking";
  code: string;
  message: string;
  count: number;
  sampleIds: string[];
  details?: Record<string, unknown>;
}

export interface CatalogAnalysis {
  fileName: string;
  fileSha256: string;
  hasUtf8Bom: boolean;
  delimiter: ";";
  header: string[];
  headerCount: number;
  recordCount: number;
  kgkCodeCount: number;
  reviewNoteCount: number;
  duplicateDatasetIds: string[];
  duplicatePositionIds: string[];
  missingRequiredCount: number;
  invalidNumberCount: number;
  missingPriceCount: number;
  unclassifiedCount: number;
  distinctUnits: string[];
  priceTypeCounts: Record<string, number>;
  indexSeries: Array<{ source: string; series: string; count: number }>;
  issues: CatalogImportIssue[];
}

export type RawCatalogRow = Record<string, string>;

export interface ParsedCatalog {
  rows: RawCatalogRow[];
  analysis: CatalogAnalysis;
}

export function parseGermanDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.replaceAll("\u00a0", " ").trim();
  if (!trimmed || /^(k\.?a\.?|n\.?a\.?|-)$/i.test(trimmed)) return null;
  let normalized = trimmed.replace(/[€%\s]/g, "");
  if (normalized.includes(",")) normalized = normalized.replaceAll(".", "").replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  try {
    const parsed = new Decimal(normalized);
    return parsed.isFinite() ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function readAndAnalyzeCatalog(filePath: string, approvedUnits?: Set<string>): Promise<ParsedCatalog> {
  const buffer = await fs.readFile(filePath);
  const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = buffer.toString("utf8");
  let header: string[] = [];
  const rows = parse(text, {
    bom: true,
    delimiter: ";",
    columns: (columns: string[]) => {
      header = columns;
      return columns;
    },
    encoding: "utf8",
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: false,
    trim: false,
  }) as RawCatalogRow[];

  const idCounts = countValues(rows, "Datensatz_ID");
  const positionCounts = countValues(rows, "Position_ID");
  const duplicateDatasetIds = [...idCounts].filter(([, count]) => count > 1).map(([value]) => value);
  const duplicatePositionIds = [...positionCounts].filter(([, count]) => count > 1).map(([value]) => value);
  const missingRequiredIds: string[] = [];
  const invalidNumberIds = new Set<string>();
  const missingPriceIds: string[] = [];
  const unclassifiedIds: string[] = [];
  const unknownUnitIds: string[] = [];
  const factorConflictIds: string[] = [];
  const priceTypeCounts: Record<string, number> = {};
  const indexCounts = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    const id = row.Datensatz_ID || `Zeile ${index + 2}`;
    if (!row.Datensatz_ID?.trim() || !/^\d{7}$/.test(row.KGK_Code?.trim() ?? "") || !row.Bezeichnung?.trim()) {
      missingRequiredIds.push(id);
    }
    for (const column of NUMERIC_COLUMNS) {
      if (row[column]?.trim() && parseGermanDecimal(row[column]) === null) invalidNumberIds.add(id);
    }
    const priceType = row.Preisart?.trim() || "(leer)";
    priceTypeCounts[priceType] = (priceTypeCounts[priceType] ?? 0) + 1;
    if (["Einheitspreis", "Zuschlag EUR"].includes(priceType) && parseGermanDecimal(row.Preis_Q3_2026_EUR) === null) {
      missingPriceIds.push(id);
    }
    if (priceType === "Berechnungsregel" && !row.Berechnung?.trim()) missingPriceIds.push(id);
    unclassifiedIds.push(id);
    if (approvedUnits && row.Einheit?.trim() && !approvedUnits.has(row.Einheit.trim())) unknownUnitIds.push(id);
    const baseIndex = parseGermanDecimal(row.Index_Basis);
    const targetIndex = parseGermanDecimal(row.Index_Q3_2026);
    const factor = parseGermanDecimal(row.Fortschreibungsfaktor);
    if (baseIndex && targetIndex && factor && !new Decimal(targetIndex).div(baseIndex).minus(factor).abs().lte("0.000001")) {
      factorConflictIds.push(id);
    }
    const indexKey = `${row.Indexquelle?.trim() ?? ""}\u0000${row.Indexreihe?.trim() ?? ""}`;
    indexCounts.set(indexKey, (indexCounts.get(indexKey) ?? 0) + 1);
  }

  const kgkCodes = new Set(rows.map((row) => row.KGK_Code?.trim()).filter(Boolean));
  const notes = rows.filter((row) => row.Pruefhinweis?.trim());
  const units = [...new Set(rows.map((row) => row.Einheit?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "de"));
  const missingHeaders = EXPECTED_CATALOG_COLUMNS.filter((column) => !header.includes(column));
  const extraHeaders = header.filter((column) => !EXPECTED_CATALOG_COLUMNS.includes(column as typeof EXPECTED_CATALOG_COLUMNS[number]));
  const indexSeries = [...indexCounts.entries()].map(([key, count]) => {
    const parts = key.split("\u0000");
    const source = parts[0] ?? "";
    const series = parts[1] ?? "";
    return { source, series, count };
  }).sort((a, b) => b.count - a.count);

  const issues: CatalogImportIssue[] = [];
  if (!hasUtf8Bom) issues.push(issue("warning", "UTF8_BOM_MISSING", "UTF-8-BOM fehlt.", 1));
  if (header.length !== 32 || missingHeaders.length || extraHeaders.length) {
    issues.push(issue("blocking", "SCHEMA_CONFLICT", `CSV-Schema hat ${header.length} statt erwarteter 32 Spalten.`, 1, [], { missingHeaders, extraHeaders }));
  }
  if (!header.includes("Tags")) {
    issues.push(issue("warning", "TAGS_COLUMN_MISSING", "CSV enthält keine explizite Tag-Spalte; Freitext darf nicht als alleinige Fachklassifizierung dienen.", 1));
  }
  if (duplicateDatasetIds.length) issues.push(issue("blocking", "DUPLICATE_DATASET_ID", "Datensatz_ID ist nicht eindeutig.", duplicateDatasetIds.length, duplicateDatasetIds));
  if (missingRequiredIds.length) issues.push(issue("blocking", "REQUIRED_FIELD_MISSING", "Pflichtfelder fehlen oder KGK-Code ist ungültig.", missingRequiredIds.length, missingRequiredIds));
  if (invalidNumberIds.size) issues.push(issue("blocking", "INVALID_NUMBER", "Zahlenfeld ist nicht als deutsche Dezimalzahl lesbar.", invalidNumberIds.size, [...invalidNumberIds]));
  if (missingPriceIds.length) issues.push(issue("warning", "PRICE_OR_RULE_MISSING", "Preis oder Berechnungsregel fehlt.", missingPriceIds.length, missingPriceIds));
  if (unknownUnitIds.length) issues.push(issue("warning", "UNKNOWN_UNIT", "Einheit ist nicht im freigegebenen Einheitenkatalog enthalten.", unknownUnitIds.length, unknownUnitIds));
  if (!approvedUnits) issues.push(issue("warning", "UNIT_CATALOG_MISSING", "Freigegebener Einheitenkatalog fehlt; Einheiten müssen administrativ bestätigt werden.", units.length, units));
  if (factorConflictIds.length) issues.push(issue("warning", "INDEX_FACTOR_CONFLICT", "Gespeicherter Fortschreibungsfaktor widerspricht Basis- und Zielindex.", factorConflictIds.length, factorConflictIds));
  if (indexSeries.filter((entry) => entry.source || entry.series).length > 1) {
    issues.push(issue("blocking", "INDEX_SERIES_CONFLICT", "Mehrere Indexquellen oder Indexreihen sind vorhanden; administrative Festlegung erforderlich.", indexSeries.length, [], { indexSeries }));
  }
  if (indexSeries.some((entry) => /bki\.de|neubau wohngebäude/i.test(`${entry.source} ${entry.series}`))) {
    issues.push(issue(
      "blocking",
      "SOURCE_INDEX_CONFLICT",
      "Indexmetadaten der CSV widersprechen der Excel-Referenz; administrative Festlegung erforderlich.",
      1,
      [],
      {
        csv: indexSeries,
        excelReference: {
          source: "Destatis – Preisindizes für Bauwerke, Ingenieurbau, Instandhaltung",
          series: "Brücken im Straßenbau",
          targetIndexQ32026: "141,7",
        },
        rule: "Quellen nicht automatisch vermischen",
      },
    ));
  }
  issues.push(issue("blocking", "USAGE_CLASSIFICATION_MISSING", "Verwendungsart ist nicht explizit klassifiziert.", rows.length, unclassifiedIds));

  return {
    rows,
    analysis: {
      fileName: path.basename(filePath),
      fileSha256: createHash("sha256").update(buffer).digest("hex"),
      hasUtf8Bom,
      delimiter: ";",
      header,
      headerCount: header.length,
      recordCount: rows.length,
      kgkCodeCount: kgkCodes.size,
      reviewNoteCount: notes.length,
      duplicateDatasetIds,
      duplicatePositionIds,
      missingRequiredCount: missingRequiredIds.length,
      invalidNumberCount: invalidNumberIds.size,
      missingPriceCount: missingPriceIds.length,
      unclassifiedCount: rows.length,
      distinctUnits: units,
      priceTypeCounts,
      indexSeries,
      issues,
    },
  };
}

export async function importCatalog(
  client: SqlClient,
  filePath: string,
  options: { name: string; year: number; quarter: number; importedBy?: string; approvedUnits?: Set<string> },
): Promise<{ catalogVersionId: string; analysis: CatalogAnalysis }> {
  let approvedUnits = options.approvedUnits;
  if (!approvedUnits) {
    const registered = await client.query<{ unit: string }>(`SELECT unit FROM unit_registry WHERE approved=true`);
    approvedUnits = new Set(registered.rows.map((row) => row.unit));
  }
  const parsed = await readAndAnalyzeCatalog(filePath, approvedUnits);
  if (parsed.analysis.duplicateDatasetIds.length) throw new Error("Import aborted: duplicate Datensatz_ID values");
  const catalogVersionId = randomUUID();
  await client.transaction(async () => {
    await client.query(
      `INSERT INTO catalog_versions
       (id,name,year,quarter,source_file_name,source_file_sha256,record_count,kgk_code_count,review_note_count,status,immutable,index_series_confirmed,import_summary,imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'imported',true,false,$10::jsonb,$11)`,
      [catalogVersionId, options.name, options.year, options.quarter, parsed.analysis.fileName, parsed.analysis.fileSha256,
        parsed.analysis.recordCount, parsed.analysis.kgkCodeCount, parsed.analysis.reviewNoteCount,
        JSON.stringify(parsed.analysis), options.importedBy ?? null],
    );

    for (const unit of parsed.analysis.distinctUnits) {
      await client.query(
        `INSERT INTO unit_registry (id,unit,label,approved,note,updated_by)
         VALUES ($1,$2,$2,false,'Aus Katalogimport erkannt; fachliche Freigabe ausstehend',$3)
         ON CONFLICT (unit) DO NOTHING`,
        [randomUUID(), unit, options.importedBy ?? null],
      );
    }

    const uniqueKgk = new Map<string, RawCatalogRow>();
    for (const row of parsed.rows) if (row.KGK_Code && !uniqueKgk.has(row.KGK_Code)) uniqueKgk.set(row.KGK_Code, row);
    for (const [code, row] of uniqueKgk) {
      await client.query(
        `INSERT INTO kgk_nodes (id,catalog_version_id,code,outline,label,path,parent_code,level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomUUID(), catalogVersionId, code, emptyToNull(row.KGK_Gliederung), row.KGK_Bezeichnung || code,
          row.KGK_Pfad || row.KGK_Bezeichnung || code, parentKgkCode(code), kgkLevel(code)],
      );
    }

    const fieldCount = 29;
    const batchSize = 100;
    for (let offset = 0; offset < parsed.rows.length; offset += batchSize) {
      const batch = parsed.rows.slice(offset, offset + batchSize);
      const params: unknown[] = [];
      const values = batch.map((row, rowIndex) => {
        const base = rowIndex * fieldCount;
        params.push(
          randomUUID(), catalogVersionId, row.Datensatz_ID, emptyToNull(row.Position_ID), row.KGK_Code,
          emptyToNull(row.KGK_Gliederung), emptyToNull(row.KGK_Bezeichnung), emptyToNull(row.KGK_Pfad), row.Bezeichnung,
          emptyToNull(row.Erlaeuterung), emptyToNull(row.Ansatz_Grundlage), emptyToNull(row.Einheit), emptyToNull(row.Preisart),
          parseGermanDecimal(row.Preis_Q3_2026_EUR), parseGermanDecimal(row.Prozentansatz), emptyToNull(row.Gewaehlter_Bezugszeitraum),
          parseGermanDecimal(row.Ausgangspreis), parseGermanDecimal(row.Ausgangspreis_Untergrenze), parseGermanDecimal(row.Index_Basis),
          parseGermanDecimal(row.Index_Q3_2026), parseGermanDecimal(row.Fortschreibungsfaktor), emptyToNull(row.Gewaehlte_Quelle),
          emptyToNull(row.Gewaehlte_Fundstelle), emptyToNull(row.Pruefhinweis), emptyToNull(row.Indexquelle), emptyToNull(row.Indexreihe),
          emptyToNull(row.Umsatzsteuer), emptyToNull(row.Berechnung), JSON.stringify(row),
        );
        return `(${Array.from({ length: fieldCount }, (_, index) => `$${base + index + 1}`).join(",")})`;
      });
      await client.query(
        `INSERT INTO price_items
         (id,catalog_version_id,dataset_id,position_id,kgk_code,kgk_outline,kgk_label,kgk_path,designation,explanation,basis,unit,price_type_raw,
          price_q3_2026,percent_rate,selected_period,base_price,base_price_lower,base_index,target_index,escalation_factor,source,source_reference,review_note,
          index_source,index_series,tax_note,calculation,raw_snapshot)
         VALUES ${values.join(",")}`,
        params,
      );
    }

    for (const entry of parsed.analysis.issues) {
      await client.query(
        `INSERT INTO catalog_import_issues (id,catalog_version_id,severity,code,message,details)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [randomUUID(), catalogVersionId, entry.severity, entry.code, entry.message, JSON.stringify({ count: entry.count, sampleIds: entry.sampleIds, ...entry.details })],
      );
    }
  });
  return { catalogVersionId, analysis: parsed.analysis };
}

function countValues(rows: RawCatalogRow[], column: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[column]?.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function issue(
  severity: CatalogImportIssue["severity"], code: string, message: string, count: number,
  sampleIds: string[] = [], details?: Record<string, unknown>,
): CatalogImportIssue {
  return { severity, code, message, count, sampleIds: sampleIds.slice(0, 25), ...(details ? { details } : {}) };
}

function emptyToNull(value: string | undefined): string | null {
  return value?.trim() ? value : null;
}

function kgkLevel(code: string): number {
  if (!/^\d{7}$/.test(code)) return 0;
  const widths = [1, 2, 1, 1, 1, 1];
  let offset = 0;
  let level = 1;
  for (const [index, width] of widths.entries()) {
    const segment = code.slice(offset, offset + width);
    if (segment !== "0".repeat(width)) level = index + 1;
    offset += width;
  }
  return level;
}

function parentKgkCode(code: string): string | null {
  if (!/^\d{7}$/.test(code)) return null;
  const widths = [1, 2, 1, 1, 1, 1];
  const level = kgkLevel(code);
  if (level <= 1) return null;
  const keep = widths.slice(0, level - 1).reduce((sum, width) => sum + width, 0);
  return code.slice(0, keep).padEnd(7, "0");
}
