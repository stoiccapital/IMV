import Decimal from "decimal.js";
import type {
  CalculationResult,
  EstimateLineInput,
  KgkRollup,
  ValidationIssue,
} from "./types.ts";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function decimalOrNull(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

export function money(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export function calculateLine(
  line: EstimateLineInput,
  referenceAmount?: string | number | null,
): CalculationResult {
  const issues: ValidationIssue[] = [];
  const quantity = decimalOrNull(line.quantity);
  const factor = decimalOrNull(line.factor) ?? new Decimal(1);
  const manual = decimalOrNull(line.manualUnitPrice);
  const indexed = decimalOrNull(line.indexedUnitPrice);
  const original = decimalOrNull(line.originalUnitPrice);
  const applied = manual ?? indexed ?? original;

  if (!line.kgkCode?.trim()) {
    issues.push(block("KGK_MISSING", "KGK-Code fehlt.", line.id, "kgkCode"));
  }

  if (line.usageClassification === "review_required" || !line.usageClassification) {
    issues.push(block("USAGE_UNCLASSIFIED", "Zulässige Verwendungsart ist fachlich zu prüfen.", line.id));
  }
  if (line.planningPhaseAllowed === false) {
    issues.push(block("PHASE_NOT_ALLOWED", "Position ist für die gewählte Planungsphase nicht zulässig.", line.id));
  }
  if (line.reviewNote && line.reviewNoteStatus !== "acknowledged" && line.reviewNoteStatus !== "resolved") {
    issues.push(block("REVIEW_NOTE_OPEN", "Prüfhinweis ist noch nicht fachlich bearbeitet.", line.id));
  }
  if (manual !== null) {
    const requiredManualFields = [
      [line.manualPriceSource, "manualPriceSource", "Quelle"],
      [line.manualPriceDate, "manualPriceDate", "Preisstand"],
      [line.manualPriceReason, "manualPriceReason", "Begründung"],
      [line.manualPriceEditor, "manualPriceEditor", "Bearbeiter"],
      [line.unit, "unit", "Einheit"],
    ] as const;
    for (const [value, field, label] of requiredManualFields) {
      if (!value?.trim()) issues.push(block("MANUAL_PRICE_METADATA", `Manueller Preis benötigt: ${label}.`, line.id, field));
    }
  }

  const negative = [quantity, applied].some((value) => value?.isNegative());
  if (negative && (!line.negativeConfirmed || !line.negativeReason?.trim())) {
    issues.push(block("NEGATIVE_UNCONFIRMED", "Negative Menge oder negativer Preis benötigt Bestätigung und Begründung.", line.id));
  }

  if (line.priceType === "percentage") {
    const rate = decimalOrNull(line.percentRate);
    const basis = decimalOrNull(referenceAmount);
    if (!line.referenceKind || !line.referenceId) {
      issues.push(block("PERCENT_REFERENCE_MISSING", "Prozentansatz benötigt eine ausdrücklich gewählte Bezugsbasis.", line.id, "referenceId"));
    }
    if (rate === null) issues.push(block("PERCENT_RATE_MISSING", "Prozentansatz fehlt.", line.id, "percentRate"));
    if (basis === null) issues.push(block("PERCENT_BASIS_MISSING", "Bezugsbasis ist nicht verfügbar.", line.id, "referenceId"));
    if (rate === null || basis === null || issues.some((issue) => issue.code.startsWith("PERCENT_"))) {
      return { total: null, appliedUnitPrice: null, formula: "Bezugsbasis × Prozentansatz / 100", issues };
    }
    return {
      total: money(basis.mul(rate).div(100)),
      appliedUnitPrice: null,
      formula: `${money(basis)} × ${rate.toString()} % / 100`,
      issues,
    };
  }

  if (line.priceType === "parameter") {
    const params = line.calculationParameters ?? {};
    if (!line.calculationRule) {
      issues.push(block("CALCULATION_RULE_INCOMPLETE", "Berechnungsregel ist unvollständig.", line.id, "calculationRule"));
      return { total: null, appliedUnitPrice: null, formula: "Berechnungsregel unvollständig", issues };
    }
    if (line.calculationRule !== "linear") {
      issues.push(block("CALCULATION_RULE_UNAPPROVED", "Berechnungsregel ist nicht freigegeben.", line.id, "calculationRule"));
      return { total: null, appliedUnitPrice: null, formula: line.calculationRule, issues };
    }
    const base = decimalOrNull(params.base);
    const coefficient = decimalOrNull(params.coefficient);
    const parameter = decimalOrNull(params.parameter);
    if (base === null || coefficient === null || parameter === null) {
      issues.push(block("CALCULATION_PARAMETERS_MISSING", "Benötigte Parameter base, coefficient und parameter fehlen.", line.id));
      return { total: null, appliedUnitPrice: null, formula: "base + coefficient × parameter", issues };
    }
    const calculatedUnit = base.add(coefficient.mul(parameter));
    if (quantity === null) issues.push(block("QUANTITY_MISSING", "Menge fehlt.", line.id, "quantity"));
    if (quantity === null) return { total: null, appliedUnitPrice: money(calculatedUnit), formula: "Menge × (base + coefficient × parameter)", issues };
    return {
      total: money(quantity.mul(calculatedUnit).mul(factor)),
      appliedUnitPrice: money(calculatedUnit),
      formula: `${quantity.toString()} × (${base.toString()} + ${coefficient.toString()} × ${parameter.toString()}) × ${factor.toString()}`,
      issues,
    };
  }

  if (quantity === null) issues.push(block("QUANTITY_MISSING", "Menge fehlt.", line.id, "quantity"));
  if (!line.unit?.trim()) issues.push(block("UNIT_MISSING", "Mengeneinheit fehlt.", line.id, "unit"));
  if (applied === null) issues.push(block("PRICE_MISSING", "Erforderlicher Einheitspreis fehlt; leer ist nicht 0,00 EUR.", line.id, "indexedUnitPrice"));

  if (line.priceType === "surcharge" && line.referenceKind && !line.referenceId) {
    issues.push(block("SURCHARGE_REFERENCE_MISSING", "Zuschlag benötigt die ausdrücklich gewählte Grundposition.", line.id, "referenceId"));
  }

  if (quantity === null || applied === null) {
    return { total: null, appliedUnitPrice: applied ? money(applied) : null, formula: "Menge × Einheitspreis × Faktor", issues };
  }

  return {
    total: money(quantity.mul(applied).mul(factor)),
    appliedUnitPrice: money(applied),
    formula: `${quantity.toString()} × ${applied.toString()} × ${factor.toString()}`,
    issues,
  };
}

export function validateEstimate(lines: EstimateLineInput[], projectComplete = true): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!projectComplete) issues.push(block("PROJECT_FIELDS_MISSING", "Pflichtangaben des Projekts sind unvollständig."));
  const totals = new Map<string, string>();
  for (const line of [...lines].sort((a, b) => a.sequence - b.sequence)) {
    let reference: string | null = null;
    if (line.referenceKind === "line" && line.referenceId) reference = totals.get(line.referenceId) ?? null;
    if (line.referenceKind === "kgk" && line.referenceId) {
      const matching = lines.filter((candidate) => candidate.kgkCode.startsWith(line.referenceId!));
      reference = matching.reduce((sum, candidate) => {
        const value = candidate.id ? totals.get(candidate.id) : null;
        return value === undefined || value === null ? sum : sum.add(value);
      }, new Decimal(0)).toFixed(2);
    }
    const result = calculateLine(line, reference);
    issues.push(...result.issues);
    if (line.id && result.total !== null) totals.set(line.id, result.total);
  }
  return issues;
}

export function kgkLevelCodes(code: string): string[] {
  if (!/^\d{7}$/.test(code)) return [code];
  const widths = [1, 2, 1, 1, 1, 1];
  const result: string[] = [];
  let consumed = 0;
  for (const width of widths) {
    consumed += width;
    result.push(code.slice(0, consumed).padEnd(7, "0"));
  }
  return [...new Set(result)];
}

export function rollupKgk(lines: Array<{ kgkCode: string; total: string | number | null }>): KgkRollup[] {
  const sums = new Map<string, { level: number; total: Decimal }>();
  for (const line of lines) {
    const total = decimalOrNull(line.total);
    if (total === null) continue;
    kgkLevelCodes(line.kgkCode).forEach((code, index) => {
      const existing = sums.get(code)?.total ?? new Decimal(0);
      sums.set(code, { level: index + 1, total: existing.add(total) });
    });
  }
  return [...sums.entries()]
    .map(([code, value]) => ({ code, level: value.level, total: money(value.total) }))
    .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
}

function block(code: string, message: string, lineId?: string, field?: string): ValidationIssue {
  return { severity: "blocking", code, message, ...(lineId ? { lineId } : {}), ...(field ? { field } : {}) };
}
