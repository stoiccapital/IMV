export const USER_ROLES = ["admin", "editor", "reviewer", "reader"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VERSION_STATUSES = ["draft", "internal_review", "released", "archived"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const PRICE_TYPES = ["unit", "percentage", "surcharge", "parameter"] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export type ValidationSeverity = "info" | "warning" | "blocking";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  lineId?: string;
  field?: string;
}

export interface EstimateLineInput {
  id?: string;
  sequence: number;
  kgkCode: string;
  kgkPath?: string | null;
  kgkOutline?: string | null;
  positionId?: string | null;
  designation: string;
  quantity?: string | number | null;
  unit?: string | null;
  originalUnitPrice?: string | number | null;
  indexedUnitPrice?: string | number | null;
  manualUnitPrice?: string | number | null;
  manualPriceSource?: string | null;
  manualPriceDate?: string | null;
  manualPriceReason?: string | null;
  manualPriceEditor?: string | null;
  priceType: PriceType;
  percentRate?: string | number | null;
  referenceKind?: "line" | "kgk" | "group" | null;
  referenceId?: string | null;
  factor?: string | number | null;
  calculationRule?: string | null;
  calculationParameters?: Record<string, string | number | null> | null;
  usageClassification?: "detail" | "kkk" | "review_required" | null;
  planningPhaseAllowed?: boolean | null;
  reviewNote?: string | null;
  reviewNoteStatus?: "open" | "acknowledged" | "resolved" | null;
  negativeConfirmed?: boolean;
  negativeReason?: string | null;
}

export interface CalculationResult {
  total: string | null;
  appliedUnitPrice: string | null;
  formula: string;
  issues: ValidationIssue[];
}

export interface KgkRollup {
  code: string;
  level: number;
  total: string;
}

export interface CatalogItemSnapshot {
  catalogVersionId: string;
  catalogItemId: string;
  datasetId: string;
  positionId?: string | null;
  kgkCode: string;
  kgkOutline?: string | null;
  kgkPath?: string | null;
  designation: string;
  explanation?: string | null;
  basis?: string | null;
  unit?: string | null;
  priceTypeRaw?: string | null;
  priceQ32026?: string | null;
  percentRate?: string | null;
  source?: string | null;
  sourceReference?: string | null;
  reviewNote?: string | null;
  priceDate?: string | null;
  indexSource?: string | null;
  indexSeries?: string | null;
  raw: Record<string, string>;
}
