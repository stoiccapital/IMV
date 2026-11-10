import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ValidationIssue } from "../../shared/types.ts";
import { calculateTotals } from "./repository.ts";
import { EXPORT_MAPPING } from "./export-mapping.ts";

type Row = Record<string, unknown>;
export type ExportFormat = "json" | "csv" | "xlsx" | "pdf";

export interface ExportArtifact {
  body: Buffer | string;
  contentType: string;
  fileName: string;
}

export async function createExport(
  format: ExportFormat,
  version: Row,
  lines: Row[],
  issues: ValidationIssue[],
): Promise<ExportArtifact> {
  const totals = calculateTotals(lines, String(version.vatRate ?? "19"));
  const baseName = safeFileName(`${version.projectNumber ?? "Projekt"}_V${version.versionNumber ?? 1}_${version.variantName ?? "Basis"}`);
  if (format === "json") {
    return {
      body: JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), projectVersion: version, totals, lines, validation: issues }, null, 2),
      contentType: "application/json; charset=utf-8",
      fileName: `${baseName}.json`,
    };
  }
  if (format === "csv") {
    const headers = EXPORT_MAPPING.positionColumns.map(([label]) => label);
    const rows = lines.map((line) => exportLine(line).map(csvCell).join(";"));
    const footer = ["", "", "", "", "", "", "", "", "", "", "", "Gesamtsumme netto", csvCell(totals.net)].join(";");
    return {
      body: `\ufeff${headers.map(csvCell).join(";")}\r\n${rows.join("\r\n")}\r\n${footer}\r\n`,
      contentType: "text/csv; charset=utf-8",
      fileName: `${baseName}.csv`,
    };
  }
  if (format === "xlsx") return createXlsx(version, lines, issues, totals, baseName);
  return createPdf(version, lines, issues, totals, baseName);
}

async function createXlsx(version: Row, lines: Row[], issues: ValidationIssue[], totals: Row, baseName: string): Promise<ExportArtifact> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IMV Kostenmanager 808";
  workbook.created = new Date();

  const cover = workbook.addWorksheet(EXPORT_MAPPING.sheets.cover, { views: [{ showGridLines: false }] });
  cover.columns = [{ width: 28 }, { width: 54 }];
  cover.mergeCells("A2:B2");
  cover.getCell("A2").value = "IMV Kostenmanager 808";
  cover.getCell("A2").font = { bold: true, size: 18, color: { argb: "FF173F4F" } };
  const coverRows: Array<[string, unknown]> = [
    ["Projekt", `${version.projectNumber ?? ""} – ${version.projectName ?? ""}`], ["Auftraggeber", version.client],
    ["Strecke / Kilometer", [version.route, version.kilometer].filter(Boolean).join(" / ")], ["Projektleitung", version.projectManager],
    ["Planungsphase", version.planningPhase], ["Art der Kostenermittlung", version.estimateType],
    ["Preisstand", `Q${version.priceQuarter ?? ""} ${version.priceYear ?? ""}`], ["Katalogversion", version.catalogVersionName],
    ["Variante / Version", `${version.variantName ?? "Basis"} / ${version.versionNumber ?? 1}`], ["Status", statusLabel(version.status)],
    ["Summe netto", Number(totals.net)], ["Umsatzsteuer", Number(totals.vat)], ["Summe brutto", Number(totals.gross)],
    ["Prüfsumme", version.checksum ?? "Entwurf – noch nicht freigegeben"],
  ];
  coverRows.forEach(([label, value], index) => {
    const row = index + 5;
    cover.getCell(row, 1).value = label;
    cover.getCell(row, 1).font = { bold: true };
    cover.getCell(row, 2).value = value as ExcelJS.CellValue;
    if (row >= 15 && row <= 17) cover.getCell(row, 2).numFmt = "#,##0.00 [$€-407]";
  });

  const summary = workbook.addWorksheet(EXPORT_MAPPING.sheets.summary, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  summary.columns = [{ header: "KGK-Code", key: "code", width: 16 }, { header: "Ebene", key: "level", width: 10 }, { header: "Summe netto", key: "total", width: 22 }];
  for (const rollup of totals.kgk as Array<{ code: string; level: number; total: string }>) summary.addRow({ ...rollup, total: Number(rollup.total) });
  styleHeader(summary.getRow(1));
  summary.getColumn(3).numFmt = "#,##0.00 [$€-407]";

  const positions = workbook.addWorksheet(EXPORT_MAPPING.sheets.positions, { views: [{ state: "frozen", ySplit: 1, xSplit: 5, showGridLines: false }] });
  positions.columns = EXPORT_MAPPING.positionColumns.map(([header, key]) => ({ header, key, width: columnWidth(key) }));
  for (const line of lines) positions.addRow(exportLineObject(line));
  styleHeader(positions.getRow(1));
  positions.autoFilter = { from: "A1", to: `${positions.getColumn(positions.columnCount).letter}1` };
  positions.getColumn("quantity").numFmt = "#,##0.000";
  ["originalUnitPrice", "catalogUnitPrice", "appliedUnitPrice", "manualUnitPrice", "total"].forEach((key) => {
    positions.getColumn(key).numFmt = "#,##0.00 [$€-407]";
  });
  ["baseIndex", "targetIndex", "indexFactor", "factorOrPercent"].forEach((key) => {
    positions.getColumn(key).numFmt = "#,##0.000000";
  });
  positions.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.alignment = { vertical: "top", wrapText: false };
      row.height = 18;
    }
  });

  const notes = workbook.addWorksheet(EXPORT_MAPPING.sheets.notes, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  notes.columns = [{ header: "Schweregrad", key: "severity", width: 16 }, { header: "Code", key: "code", width: 30 }, { header: "Position", key: "lineId", width: 38 }, { header: "Hinweis", key: "message", width: 90 }];
  issues.forEach((entry) => notes.addRow({ ...entry, severity: severityLabel(entry.severity) }));
  styleHeader(notes.getRow(1));

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { body: buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: `${baseName}.xlsx` };
}

async function createPdf(version: Row, lines: Row[], issues: ValidationIssue[], totals: Row, baseName: string): Promise<ExportArtifact> {
  const document = new PDFDocument({ size: "A4", margin: 42, info: { Title: `Kostenermittlung ${version.projectNumber ?? ""}`, Author: "IMV Kostenmanager 808" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.fontSize(18).fillColor("#173F4F").text("IMV Kostenmanager 808");
  document.moveDown(0.5).fontSize(14).fillColor("#111827").text(`${version.projectNumber ?? ""} – ${version.projectName ?? ""}`);
  document.moveDown().fontSize(9);
  const metadata = [
    ["Auftraggeber", version.client], ["Planungsphase", version.planningPhase], ["Preisstand", `Q${version.priceQuarter} ${version.priceYear}`],
    ["Katalog", version.catalogVersionName], ["Variante / Version", `${version.variantName} / ${version.versionNumber}`], ["Status", statusLabel(version.status)],
  ];
  metadata.forEach(([label, value]) => document.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(String(value ?? "")));
  document.moveDown().fontSize(12).font("Helvetica-Bold").text(`Gesamtsumme netto: ${formatEuro(totals.net)}`);
  document.fontSize(9).font("Helvetica").text(`Umsatzsteuer: ${formatEuro(totals.vat)}   Brutto: ${formatEuro(totals.gross)}`);
  document.addPage().fontSize(13).font("Helvetica-Bold").text("Kostenzusammenfassung nach KGK").moveDown(0.5);
  document.fontSize(8).font("Helvetica");
  for (const item of totals.kgk as Array<{ code: string; level: number; total: string }>) {
    if (document.y > 760) document.addPage();
    document.text(`${"  ".repeat(Math.max(item.level - 1, 0))}${item.code}  ${formatEuro(item.total)}`);
  }
  document.addPage().fontSize(13).font("Helvetica-Bold").text("Positionsliste").moveDown(0.4);
  for (const line of lines) {
    if (document.y > 675) document.addPage();
    const exported = exportLineObject(line);
    document.fontSize(8).font("Helvetica-Bold").text(`${line.sequence}. ${line.kgkCode} ${line.designation}`);
    document.font("Helvetica").text(`${formatQuantity(line.quantity)} ${line.unit ?? ""} × ${formatEuro(exported.appliedUnitPrice)} = ${formatEuro(line.total)}`);
    document.fillColor("#4B5563");
    document.text(`Preisart: ${priceTypeLabel(line.priceType)} · Faktor/Prozent: ${formatNumber(exported.factorOrPercent)}`);
    if (exported.selectedPeriod || exported.indexFactor) {
      document.text(`Preisstand: ${exported.selectedPeriod ?? "–"} · Basisindex: ${formatNumber(exported.baseIndex)} · Zielindex: ${formatNumber(exported.targetIndex)} · Indexfaktor: ${formatNumber(exported.indexFactor)}`);
      document.text(`Index: ${exported.indexSource ?? "–"} / ${exported.indexSeries ?? "–"}`);
    }
    if (line.manualUnitPrice !== null && line.manualUnitPrice !== undefined) {
      document.text(`Manueller Preis: ${formatEuro(line.manualUnitPrice)} · Quelle: ${line.manualPriceSource ?? "–"} · Preisstand: ${line.manualPriceDate ?? "–"}`);
      document.text(`Begründung: ${line.manualPriceReason ?? "–"} · Bearbeiter: ${line.manualPriceEditor ?? "–"}`);
    }
    if (line.referenceKind || line.referenceId) document.text(`Bezugsbasis: ${line.referenceKind ?? "–"} / ${line.referenceId ?? "–"}`);
    if (line.calculationFormula) document.text(`Formel: ${line.calculationFormula}`);
    document.text(`Quelle: ${line.source ?? "–"}${line.sourceReference ? `, ${line.sourceReference}` : ""}`);
    if (line.reviewNote) document.text(`Prüfhinweis (${reviewStatusLabel(line.reviewNoteStatus)}): ${line.reviewNote}`);
    if (line.ownNote) document.text(`Eigene Bemerkung: ${line.ownNote}`);
    document.fillColor("#111827").moveDown(0.5);
  }
  if (issues.length) {
    document.addPage().fontSize(13).font("Helvetica-Bold").text("Prüfstatus").moveDown(0.4);
    for (const issue of issues) document.fontSize(8).font("Helvetica").text(`${severityLabel(issue.severity)} · ${issue.code}: ${issue.message}`);
  }
  document.moveDown(2).fontSize(8).text("Freigabe / Unterschrift: ______________________________________________");
  document.end();
  return { body: await complete, contentType: "application/pdf", fileName: `${baseName}.pdf` };
}

function exportLine(line: Row): unknown[] {
  const object = exportLineObject(line);
  return EXPORT_MAPPING.positionColumns.map(([, key]) => object[key]);
}

function exportLineObject(line: Row): Record<string, unknown> {
  const snapshot = line.catalogSnapshot && typeof line.catalogSnapshot === "object" ? line.catalogSnapshot as Row : {};
  return {
    sequence: Number(line.sequence), kgkCode: line.kgkCode, kgkPath: line.kgkPath,
    datasetId: snapshot.dataset_id ?? snapshot.datasetId, positionId: line.positionId,
    designation: line.designation, basis: line.basis ?? line.explanation, quantity: numberOrNull(line.quantity), unit: line.unit,
    originalUnitPrice: numberOrNull(line.originalUnitPrice), selectedPeriod: snapshot.selected_period ?? snapshot.selectedPeriod,
    baseIndex: numberOrNull(snapshot.base_index ?? snapshot.baseIndex), targetIndex: numberOrNull(snapshot.target_index ?? snapshot.targetIndex),
    indexFactor: numberOrNull(snapshot.escalation_factor ?? snapshot.escalationFactor ?? line.factor),
    indexSource: snapshot.index_source ?? snapshot.indexSource, indexSeries: snapshot.index_series ?? snapshot.indexSeries,
    catalogUnitPrice: numberOrNull(line.indexedUnitPrice),
    appliedUnitPrice: numberOrNull(line.manualUnitPrice ?? line.indexedUnitPrice ?? line.originalUnitPrice),
    manualUnitPrice: numberOrNull(line.manualUnitPrice), manualPriceSource: line.manualPriceSource,
    manualPriceDate: line.manualPriceDate, manualPriceReason: line.manualPriceReason, manualPriceEditor: line.manualPriceEditor,
    priceType: line.priceType, factorOrPercent: numberOrNull(line.priceType === "percentage" ? line.percentRate : line.factor),
    referenceKind: line.referenceKind, referenceId: line.referenceId, calculationRule: line.calculationRule,
    calculationFormula: line.calculationFormula,
    calculationParameters: line.calculationParameters ? JSON.stringify(line.calculationParameters) : null,
    total: numberOrNull(line.total), source: line.source, sourceReference: line.sourceReference, reviewNote: line.reviewNote,
    reviewNoteStatus: line.reviewNoteStatus, ownNote: line.ownNote, usageClassification: line.usageClassification,
    negativeConfirmed: line.negativeConfirmed ? "Ja" : "Nein", negativeReason: line.negativeReason, workStatus: line.workStatus,
  };
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F4F" } };
  row.alignment = { vertical: "middle", horizontal: "center" };
}

function columnWidth(key: string): number {
  if (["designation", "basis", "reviewNote", "ownNote", "manualPriceReason", "negativeReason", "calculationFormula", "calculationParameters"].includes(key)) return 36;
  if (["kgkPath", "source", "sourceReference", "indexSource", "indexSeries"].includes(key)) return 26;
  return 15;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).replaceAll('"', '""');
  return /[;"\r\n]/.test(text) ? `"${text}"` : text;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatEuro(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value));
}

function formatQuantity(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 }).format(Number(value));
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(parsed) : String(value);
}

function statusLabel(value: unknown): string {
  return ({ draft: "Entwurf", internal_review: "Interne Prüfung", released: "Freigegeben", archived: "Archiviert" } as Record<string, string>)[String(value)] ?? String(value ?? "");
}

function severityLabel(value: unknown): string {
  return ({ blocking: "Blockierender Fehler", error: "Blockierender Fehler", warning: "Warnung", info: "Hinweis" } as Record<string, string>)[String(value)] ?? String(value ?? "");
}

function reviewStatusLabel(value: unknown): string {
  return ({ open: "Offen", acknowledged: "Bestätigt", resolved: "Erledigt" } as Record<string, string>)[String(value)] ?? String(value ?? "");
}

function priceTypeLabel(value: unknown): string {
  return ({ unit: "Einheitspreis", percentage: "Prozentansatz", surcharge: "Zuschlag", parameter: "Berechnungsregel" } as Record<string, string>)[String(value)] ?? String(value ?? "");
}

function safeFileName(value: string): string {
  return value.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "kostenermittlung";
}
