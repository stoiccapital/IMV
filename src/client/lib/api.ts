export type Role = "admin" | "editor" | "reviewer" | "reader";
export type ProjectStatus = "draft" | "internal_review" | "released" | "archived";
export type Severity = "info" | "warning" | "error";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface ProjectSummary {
  id: string;
  projectNumber: string;
  name: string;
  client: string;
  planningPhase: string;
  estimateType: "detailed" | "kkk";
  status: ProjectStatus;
  currentVersionId: string;
  currentVersion: number;
  catalogVersion: string;
  priceQuarter: number;
  priceYear: number;
  totalNetCents: number;
  openIssueCount: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface ProjectDetail extends ProjectSummary {
  route?: string;
  kilometerFrom?: string;
  kilometerTo?: string;
  projectManager: string;
  editor: string;
  grossMode: boolean;
  taxRate: number;
  createdAt: string;
  notes?: string;
}

export type PriceType = "unit" | "percentage" | "surcharge" | "parameter";
export type LineStatus = "ready" | "review" | "blocked";

export interface EstimateLine {
  id: string;
  sequence: number;
  kgkCode: string;
  kgkPath: string;
  dataRecordId?: string;
  positionId?: string;
  description: string;
  explanation?: string;
  quantity: string | null;
  unit: string;
  basePrice: string | null;
  basePeriod?: string;
  indexFactor: string | null;
  catalogUnitPrice: string | null;
  manualUnitPrice?: string | null;
  manualReason?: string;
  manualPriceSource?: string | null;
  manualPriceDate?: string | null;
  manualPriceReason?: string | null;
  manualPriceEditor?: string | null;
  priceType: PriceType;
  percentage?: string | null;
  percentRate?: string | null;
  factor?: string | null;
  referenceKind?: "line" | "kgk" | "group" | null;
  referenceId?: string | null;
  referenceLineId?: string | null;
  calculationRule?: string | null;
  calculationParameters?: Record<string, string | number | null> | null;
  calculationFormula?: string | null;
  totalCents: number | null;
  source?: string;
  sourceLocation?: string;
  reviewNote?: string;
  reviewNoteStatus?: "open" | "acknowledged" | "resolved";
  ownNote?: string;
  usageClassification?: "detailed" | "kkk" | "review";
  planningPhaseAllowed?: boolean | null;
  negativeConfirmed?: boolean;
  negativeReason?: string | null;
  workStatus?: string;
  status: LineStatus;
  blockingReasons?: string[];
  updatedAt?: string;
}

export interface KgkNode {
  code: string;
  label: string;
  level: number;
  totalCents: number;
  lineCount: number;
  children?: KgkNode[];
}

export interface VersionTotals {
  netCents: number;
  taxCents: number;
  grossCents: number;
  pricedLineCount: number;
  lineCount: number;
}

export interface EstimatePayload {
  project: ProjectDetail;
  version: {
    id: string;
    number: number;
    variantName: string;
    status: ProjectStatus;
    catalogVersion: string;
    priceYear: number;
    priceQuarter: number;
    lastSavedAt?: string;
  };
  lines: EstimateLine[];
  kgkTree: KgkNode[];
  totals: VersionTotals;
}

export interface ProjectVersionSummary {
  id: string;
  number: number;
  variantName: string;
  status: ProjectStatus;
  immutable: boolean;
  planningPhase: string;
  estimateType: "detail" | "kkk";
  priceYear: number;
  priceQuarter: number;
  catalogVersion: string;
  totalNetCents: number;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string | null;
}

export interface ComparisonLineSummary {
  id: string;
  sequence: number;
  kgkCode: string;
  designation: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  priceType: PriceType;
  factor: string | null;
  percentRate: string | null;
  total: string | null;
}

export interface VersionComparison {
  from: { id: string; number: number; variantName: string; status: ProjectStatus; priceYear: number; priceQuarter: number; updatedAt: string; total: string };
  to: { id: string; number: number; variantName: string; status: ProjectStatus; priceYear: number; priceQuarter: number; updatedAt: string; total: string };
  totals: { fromNet: string; toNet: string; absoluteDelta: string; percentageDelta: string | null };
  counts: { added: number; removed: number; modified: number; unchanged: number };
  changes: Array<{
    key: string;
    type: "added" | "removed" | "modified" | "unchanged";
    fields: string[];
    before: ComparisonLineSummary | null;
    after: ComparisonLineSummary | null;
    absoluteDelta: string;
    percentageDelta: string | null;
  }>;
}

export interface CatalogItem {
  id: string;
  dataRecordId: string;
  positionId?: string;
  kgkCode: string;
  kgkPath: string;
  description: string;
  explanation?: string;
  unit: string;
  priceType: string;
  price: string | null;
  source?: string;
  sourceLocation?: string;
  reviewNote?: string;
  usageClassification: "detailed" | "kkk" | "review";
  allowedForPlanningPhase?: boolean;
}

export interface ValidationIssue {
  id: string;
  severity: Severity;
  code: string;
  title: string;
  detail: string;
  lineId?: string;
  lineSequence?: number;
  acknowledged?: boolean;
}

export interface ValidationPayload {
  releaseAllowed: boolean;
  checkedAt: string;
  issues: ValidationIssue[];
  counts: Record<Severity, number>;
}

export interface CatalogVersionSummary {
  id: string;
  name: string;
  status: string;
  recordCount: number;
  kgkCount: number;
  reviewNoteCount: number;
  importedAt: string;
  importedBy?: string;
  fileSha256?: string;
  issueCounts?: Record<string, number>;
}

export interface AdminOverview {
  catalogVersions: CatalogVersionSummary[];
  activeUsers: number;
  openConflicts: number;
  pendingRules: number;
  approvedUnits: number;
  recentAudit: Array<{
    id: string;
    user: string;
    action: string;
    entity: string;
    at: string;
  }>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body.message ?? "Die Anfrage ist fehlgeschlagen.", body);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: User }>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  projects: (query = "") => request<{ projects: ProjectSummary[] }>(`/api/projects${query}`),
  createProject: (payload: Record<string, unknown>) =>
    request<{ project: ProjectSummary }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  estimate: (projectId: string, versionId: string) =>
    request<EstimatePayload>(`/api/projects/${projectId}/versions/${versionId}`),
  versions: (projectId: string) =>
    request<{ versions: ProjectVersionSummary[] }>(`/api/projects/${projectId}/versions`),
  cloneVersion: (projectId: string, versionId: string, variantName: string, reason: string) =>
    request<{ version: { id: string; versionNumber: number; variantName: string } }>(`/api/projects/${projectId}/versions/${versionId}/clone`, {
      method: "POST",
      body: JSON.stringify({ variantName, reason }),
    }),
  compareVersions: (projectId: string, versionId: string, otherVersionId: string) =>
    request<{ comparison: VersionComparison }>(`/api/projects/${projectId}/versions/${versionId}/compare/${otherVersionId}`),
  updateLine: (projectId: string, versionId: string, lineId: string, payload: Partial<EstimateLine>) =>
    request<{ line: EstimateLine }>(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteLine: (projectId: string, versionId: string, lineId: string) =>
    request<void>(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}`, { method: "DELETE" }),
  copyLine: (projectId: string, versionId: string, lineId: string) =>
    request<{ line: EstimateLine }>(`/api/projects/${projectId}/versions/${versionId}/lines/${lineId}/copy`, {
      method: "POST",
    }),
  reorderLines: (projectId: string, versionId: string, lineIds: string[]) =>
    request<void>(`/api/projects/${projectId}/versions/${versionId}/lines/reorder`, {
      method: "POST",
      body: JSON.stringify({ lineIds }),
    }),
  catalog: (params: URLSearchParams) =>
    request<{ items: CatalogItem[]; total: number; page: number; pageSize: number }>(`/api/catalog/items?${params}`),
  addCatalogItems: (projectId: string, versionId: string, priceItemIds: string[]) =>
    request<{ lines: EstimateLine[] }>(`/api/projects/${projectId}/versions/${versionId}/lines/from-catalog`, {
      method: "POST",
      body: JSON.stringify({ priceItemIds }),
    }),
  validation: (projectId: string, versionId: string) =>
    request<ValidationPayload>(`/api/projects/${projectId}/versions/${versionId}/validation`),
  release: (projectId: string, versionId: string, note: string) =>
    request<{ releasedAt: string }>(`/api/projects/${projectId}/versions/${versionId}/release`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
};
