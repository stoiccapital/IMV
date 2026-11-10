import { describe, expect, it } from "vitest";
import { calculateLine, kgkLevelCodes, rollupKgk, validateEstimate } from "../src/shared/domain.ts";
import type { EstimateLineInput } from "../src/shared/types.ts";

const base: EstimateLineInput = {
  id: "line-1", sequence: 1, kgkCode: "1011000", designation: "Beispiel", quantity: "2.5", unit: "m²",
  indexedUnitPrice: "40.57", priceType: "unit", factor: "1.1", usageClassification: "detail",
  planningPhaseAllowed: true, reviewNoteStatus: "resolved",
};

describe("calculation domain", () => {
  it("calculates quantity × unit price × factor with commercial cent rounding", () => {
    const result = calculateLine(base);
    expect(result.total).toBe("111.57");
    expect(result.issues).toEqual([]);
  });

  it("uses only an explicit percentage reference and does not index the percentage", () => {
    const result = calculateLine({ ...base, id: "percent", quantity: null, unit: null, indexedUnitPrice: null, priceType: "percentage", percentRate: "5", referenceKind: "line", referenceId: "line-1" }, "111.57");
    expect(result.total).toBe("5.58");
    expect(result.formula).toContain("5 %");
  });

  it("blocks percentage lines without a selected reference", () => {
    const result = calculateLine({ ...base, priceType: "percentage", percentRate: "10", referenceKind: null, referenceId: null }, null);
    expect(result.total).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain("PERCENT_REFERENCE_MISSING");
  });

  it("returns a blocking error instead of zero for incomplete parameter rules", () => {
    const result = calculateLine({ ...base, priceType: "parameter", indexedUnitPrice: null, calculationRule: null });
    expect(result.total).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "blocking", code: "CALCULATION_RULE_INCOMPLETE" }));
  });

  it("requires full metadata for a manual price", () => {
    const result = calculateLine({ ...base, manualUnitPrice: "100" });
    expect(result.issues.filter((issue) => issue.code === "MANUAL_PRICE_METADATA")).toHaveLength(4);
  });

  it("requires confirmation and reason for negative values", () => {
    const result = calculateLine({ ...base, quantity: "-1" });
    expect(result.issues.map((issue) => issue.code)).toContain("NEGATIVE_UNCONFIRMED");
  });

  it("blocks release validation for unclassified positions and open review notes", () => {
    const issues = validateEstimate([{ ...base, usageClassification: "review_required", reviewNote: "Prüfen", reviewNoteStatus: "open" }]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["USAGE_UNCLASSIFIED", "REVIEW_NOTE_OPEN"]));
  });
});

describe("KGK hierarchy", () => {
  it("builds six levels from the seven-character text code", () => {
    expect(kgkLevelCodes("1011234")).toEqual(["1000000", "1010000", "1011000", "1011200", "1011230", "1011234"]);
  });

  it("rolls line totals up to every parent level", () => {
    const rollup = rollupKgk([{ kgkCode: "1011234", total: "100.10" }, { kgkCode: "1011567", total: "20.20" }]);
    expect(rollup.find((entry) => entry.code === "1011000")?.total).toBe("120.30");
    expect(rollup.find((entry) => entry.code === "1011234")?.total).toBe("100.10");
  });
});
