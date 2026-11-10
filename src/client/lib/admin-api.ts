export type AdminRole = "admin" | "editor" | "reviewer" | "reader";
export type UsageClassification = "detail" | "kkk" | "review_required";

export interface AdminUserRecord {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
}

export interface UnitRegistryRecord {
  id: string;
  canonicalUnit: string;
  displayName: string;
  approved: boolean;
  note: string | null;
  updatedAt: string;
}

export interface IndexValueRecord {
  year: number;
  quarter: number;
  value: string;
  sourceReference: string | null;
}

export interface IndexSeriesRecord {
  id: string;
  name: string;
  source: string;
  baseYear: number;
  version: number;
  approved: boolean;
  values: IndexValueRecord[];
}

export interface CalculationRuleRecord {
  id: string;
  code: string;
  name: string;
  expression: string;
  parameterSchema: Record<string, unknown>;
  version: number;
  approved: boolean;
  updatedAt: string;
}

export interface AdminCatalogVersion {
  id: string;
  name: string;
  indexSeriesId: string | null;
  indexSeriesConfirmed: boolean;
}

export interface ClassificationCatalogItem {
  id: string;
  dataRecordId: string;
  kgkCode: string;
  description: string;
  unit: string | null;
  usageClassification: "detailed" | "kkk" | "review";
  allowedFromLph?: number | null;
  allowedToLph?: number | null;
}

export interface AdminProjectRecord { id: string; projectNumber: string; name: string }
export interface ProjectMemberRecord { id: string; email: string; displayName: string; role: AdminRole; accessRole: string }

class AdminApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new AdminApiError(response.status, body.message ?? body.error ?? "Die administrative Änderung ist fehlgeschlagen.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const adminApi = {
  users: () => request<{ users: AdminUserRecord[] }>("/api/admin/users"),
  createUser: (input: { email: string; displayName: string; password: string; role: AdminRole }) =>
    request<{ user: AdminUserRecord }>("/api/admin/users", { method: "POST", body: JSON.stringify(input) }),
  updateUser: (id: string, patch: Partial<Pick<AdminUserRecord, "displayName" | "role" | "active">>) =>
    request<{ user: AdminUserRecord }>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  projects: () => request<{ projects: AdminProjectRecord[] }>("/api/projects"),
  projectMembers: (projectId: string) => request<{ project: AdminProjectRecord; members: ProjectMemberRecord[] }>(`/api/admin/projects/${projectId}/members`),
  setProjectMember: (projectId: string, userId: string, accessRole: string | null) =>
    request<void>(`/api/admin/projects/${projectId}/members/${userId}`, { method: "PUT", body: JSON.stringify({ accessRole }) }),

  units: () => request<{ units: UnitRegistryRecord[] }>("/api/admin/units"),
  updateUnit: (id: string, patch: { approved: boolean; note?: string }) =>
    request<{ unit: UnitRegistryRecord }>(`/api/admin/units/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  indexSeries: () => request<{ indexSeries: IndexSeriesRecord[] }>("/api/admin/index-series"),
  createIndexSeries: (input: { name: string; source: string; baseYear: number; version: number; approved: boolean }) =>
    request<{ indexSeries: IndexSeriesRecord }>("/api/admin/index-series", { method: "POST", body: JSON.stringify(input) }),
  addIndexValue: (seriesId: string, input: { year: number; quarter: number; value: string; sourceReference?: string }) =>
    request<{ indexSeries: IndexSeriesRecord }>(`/api/admin/index-series/${seriesId}/values`, { method: "POST", body: JSON.stringify(input) }),
  catalogVersions: () => request<{ catalogVersions: AdminCatalogVersion[] }>("/api/admin/catalog-versions"),
  assignIndexSeries: (catalogVersionId: string, indexSeriesId: string) =>
    request<{ catalogVersion: AdminCatalogVersion }>(`/api/admin/catalog-versions/${catalogVersionId}/index-series`, {
      method: "POST", body: JSON.stringify({ indexSeriesId }),
    }),

  calculationRules: () => request<{ calculationRules: CalculationRuleRecord[] }>("/api/admin/calculation-rules"),
  createCalculationRule: (input: { code: string; name: string; expression: string; parameterSchema: Record<string, unknown>; approved: boolean }) =>
    request<{ calculationRule: CalculationRuleRecord }>("/api/admin/calculation-rules", { method: "POST", body: JSON.stringify(input) }),
  updateCalculationRule: (id: string, patch: Partial<Pick<CalculationRuleRecord, "name" | "expression" | "parameterSchema" | "approved">>) =>
    request<{ calculationRule: CalculationRuleRecord }>(`/api/admin/calculation-rules/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  searchCatalog: (query: string) => {
    const params = new URLSearchParams({ q: query, page: "1", pageSize: "25" });
    return request<{ items: ClassificationCatalogItem[]; total: number }>(`/api/catalog/items?${params}`);
  },
  classifyCatalogItems: (input: {
    priceItemIds: string[];
    usageClassification: Exclude<UsageClassification, "review_required">;
    allowedFromLph: number | null;
    allowedToLph: number | null;
    classificationSource: string;
  }) => request<{ updated: number }>("/api/admin/catalog-items/classify", { method: "POST", body: JSON.stringify(input) }),
};

export function adminErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Die administrative Änderung ist fehlgeschlagen.";
}
