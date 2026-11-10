import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z, ZodError } from "zod";
import Decimal from "decimal.js";
import type { AppConfig } from "./config.ts";
import { createSessionToken, hashSessionToken, verifyPassword } from "./auth/crypto.ts";
import { createExport, type ExportFormat } from "./services/exports.ts";
import { ForbiddenError, ImmutableError, NotFoundError, Repository } from "./services/repository.ts";
import type { AuthUser } from "../shared/types.ts";
import { kgkLevelCodes } from "../shared/domain.ts";
import { registerAdminRoutes } from "./admin-routes.ts";

const SESSION_COOKIE = "imv_session";
const SESSION_DAYS = 8;

type AuthRequest = Request & { user?: AuthUser; sessionHash?: string };

export function createApp(repository: Repository, config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: config.NODE_ENV === "production" ? undefined : false }));
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser(config.SESSION_SECRET));
  app.use((req, res, next) => originGuard(req, res, next, config));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "imv-kostenmanager-808" }));

  app.post("/api/auth/login", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ email: z.string().email(), password: z.string().min(8).max(200) }).parse(req.body);
    const user = await repository.findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      return res.status(401).json({ error: "Anmeldung fehlgeschlagen.", message: "Anmeldung fehlgeschlagen." });
    }
    const session = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await repository.createSession(user.id, session.hash, expiresAt);
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: "strict", secure: config.NODE_ENV === "production", signed: true,
      expires: expiresAt, path: "/",
    });
    return res.json({ user: publicUser(stripPassword(user)) });
  }));

  app.get("/api/auth/me", authenticate(repository), (req: AuthRequest, res) => res.json({ user: publicUser(req.user!) }));
  app.post("/api/auth/logout", authenticate(repository), asyncHandler(async (req: AuthRequest, res) => {
    if (req.sessionHash) await repository.deleteSession(req.sessionHash);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.status(204).end();
  }));

  app.use("/api", authenticate(repository));
  registerAdminRoutes(app, repository);

  app.get("/api/projects", asyncHandler(async (req: AuthRequest, res) => {
    const projects = await repository.listProjects(req.user!, String(req.query.q ?? ""), String(req.query.status ?? ""));
    res.json({ projects: projects.map(publicProjectSummary) });
  }));
  app.post("/api/projects", asyncHandler(async (req: AuthRequest, res) => {
    const input = projectSchema.parse(req.body);
    const catalogVersionId = await repository.resolveCatalogVersionId(input.catalogVersionId ?? input.catalogVersion ?? "Q3 2026");
    const project = await repository.createProject(req.user!, {
      projectNumber: input.projectNumber, name: input.name, client: input.client, route: input.route,
      kilometer: [input.kilometerFrom, input.kilometerTo].filter(Boolean).join("–") || input.kilometer,
      projectManager: input.projectManager, editor: input.editor ?? req.user!.displayName, planningPhase: input.planningPhase,
      estimateType: input.estimateType === "detailed" ? "detail" : input.estimateType,
      priceYear: input.priceYear, priceQuarter: input.priceQuarter, catalogVersionId,
      taxMode: input.grossMode ? "gross" : input.taxMode, variantName: input.variantName,
    });
    const projects = await repository.listProjects(req.user!);
    const summary = projects.find((candidate) => candidate.id === project.id) ?? project;
    res.status(201).json({ project: publicProjectSummary(summary) });
  }));
  app.get("/api/projects/:projectId", asyncHandler(async (req: AuthRequest, res) => {
    const project = await repository.getProject(req.user!, routeParam(req, "projectId"));
    res.json({ project });
  }));
  app.get("/api/projects/:projectId/versions", asyncHandler(async (req: AuthRequest, res) => {
    const versions = await repository.listProjectVersions(req.user!, routeParam(req, "projectId"));
    res.json({ versions: versions.map((version) => ({ ...version, totalNetCents: cents(version.total) })) });
  }));
  app.get("/api/projects/:projectId/versions/:versionId/compare/:otherVersionId", asyncHandler(async (req: AuthRequest, res) => {
    const comparison = await repository.compareVersions(
      req.user!, routeParam(req, "projectId"), routeParam(req, "otherVersionId"), routeParam(req, "versionId"),
    );
    res.json({ comparison });
  }));
  app.get("/api/projects/:projectId/versions/:versionId", asyncHandler(async (req: AuthRequest, res) => {
    const version = await repository.getVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const lines = await repository.listLines(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const kgkNodes = await repository.listKgkNodes(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.json(publicEstimatePayload(version, lines, validation, req.user!, kgkNodes));
  }));
  app.patch("/api/projects/:projectId/versions/:versionId", asyncHandler(async (req: AuthRequest, res) => {
    const patch = versionPatchSchema.parse(req.body);
    const version = await repository.updateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), patch);
    res.json({ version });
  }));
  app.post("/api/projects/:projectId/versions/:versionId/clone", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ variantName: z.string().trim().min(1).max(100).optional(), reason: z.string().trim().min(3).max(1000).optional() }).parse(req.body ?? {});
    const version = await repository.cloneVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), input.variantName, input.reason);
    res.status(201).json({ version });
  }));
  app.get("/api/projects/:projectId/versions/:versionId/lines", asyncHandler(async (req: AuthRequest, res) => {
    const lines = await repository.listLines(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.json({ lines: lines.map((line) => publicLine(line, validation.issues)) });
  }));
  app.post("/api/projects/:projectId/versions/:versionId/lines", asyncHandler(async (req: AuthRequest, res) => {
    const line = await repository.addLine(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), lineSchema.parse(req.body));
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.status(201).json({ line: publicLine(line, validation.issues) });
  }));
  app.patch("/api/projects/:projectId/versions/:versionId/lines/:lineId", asyncHandler(async (req: AuthRequest, res) => {
    const patch = normalizeLinePatch(linePatchSchema.parse(req.body));
    const line = await repository.updateLine(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), routeParam(req, "lineId"), patch);
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.json({ line: publicLine(line, validation.issues) });
  }));
  app.post("/api/projects/:projectId/versions/:versionId/lines/:lineId/copy", asyncHandler(async (req: AuthRequest, res) => {
    const line = await repository.copyLine(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), routeParam(req, "lineId"));
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.status(201).json({ line: publicLine(line, validation.issues) });
  }));
  app.post("/api/projects/:projectId/versions/:versionId/lines/reorder", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ lineIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
    await repository.reorderLines(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), input.lineIds);
    res.status(204).end();
  }));
  app.delete("/api/projects/:projectId/versions/:versionId/lines/:lineId", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ reason: z.string().min(3).max(1000).optional() }).parse(req.body ?? {});
    await repository.deleteLine(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), routeParam(req, "lineId"), input.reason);
    res.status(204).end();
  }));
  app.post("/api/projects/:projectId/versions/:versionId/lines/from-catalog", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ catalogItemIds: z.array(z.string().uuid()).min(1).max(200).optional(), priceItemIds: z.array(z.string().uuid()).min(1).max(200).optional() }).refine((value) => value.catalogItemIds || value.priceItemIds).parse(req.body);
    const lines = await repository.addCatalogLines(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), input.catalogItemIds ?? input.priceItemIds ?? []);
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.status(201).json({ lines: lines.map((line) => publicLine(line, validation.issues)) });
  }));
  app.get("/api/catalog/items", asyncHandler(async (req: AuthRequest, res) => {
    const filters = catalogFilterSchema.parse(req.query);
    const result = await repository.searchCatalog(req.user!, filters);
    res.json({ ...result, items: result.items.map(publicCatalogItem) });
  }));
  app.get("/api/projects/:projectId/versions/:versionId/validation", asyncHandler(async (req: AuthRequest, res) => {
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    res.json(publicValidation(validation.issues));
  }));
  app.post("/api/projects/:projectId/versions/:versionId/release", asyncHandler(async (req: AuthRequest, res) => {
    const input = z.object({ note: z.string().trim().min(3).max(2000).optional() }).parse(req.body ?? {});
    const version = await repository.releaseVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"), input.note);
    res.json({ releasedAt: version.releasedAt, version });
  }));
  app.get("/api/projects/:projectId/versions/:versionId/exports/:format", asyncHandler(async (req: AuthRequest, res) => {
    const format = z.enum(["json", "csv", "xlsx", "pdf"]).parse(routeParam(req, "format")) as ExportFormat;
    const version = await repository.getVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const lines = await repository.listLines(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const validation = await repository.validateVersion(req.user!, routeParam(req, "projectId"), routeParam(req, "versionId"));
    const artifact = await createExport(format, version, lines, validation.issues);
    res.setHeader("Content-Type", artifact.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    res.send(artifact.body);
  }));
  app.get("/api/admin/overview", asyncHandler(async (req: AuthRequest, res) => {
    res.json(await repository.adminOverview(req.user!));
  }));
  app.get("/api/admin/catalog-versions", asyncHandler(async (req: AuthRequest, res) => {
    res.json({ catalogVersions: await repository.listCatalogVersions(req.user!) });
  }));
  app.get("/api/admin/catalog-versions/:catalogVersionId/import-report", asyncHandler(async (req: AuthRequest, res) => {
    const report = await repository.getCatalogImportReport(req.user!, routeParam(req, "catalogVersionId"));
    res.setHeader("Content-Disposition", `attachment; filename="catalog-import-${routeParam(req, "catalogVersionId")}.json"`);
    res.json(report);
  }));

  if (config.NODE_ENV === "production") {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
    app.use(express.static(root, { index: false, immutable: true, maxAge: "1h" }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(root, "index.html")));
  }

  app.use((_req, res) => res.status(404).json({ error: "Nicht gefunden.", message: "Nicht gefunden." }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: "Ungültige Eingabe.", message: "Ungültige Eingabe.", details: error.issues });
    if (error instanceof NotFoundError) return res.status(404).json({ error: error.message, message: error.message });
    if (error instanceof ForbiddenError) return res.status(403).json({ error: error.message, message: error.message });
    if (error instanceof ImmutableError) return res.status(409).json({ error: error.message, message: error.message, code: "VERSION_IMMUTABLE" });
    const issueError = error as Error & { issues?: unknown };
    if (issueError.issues) return res.status(409).json({ error: issueError.message, message: issueError.message, issues: issueError.issues });
    console.error(error);
    return res.status(500).json({ error: "Interner Fehler.", message: "Interner Fehler." });
  });
  return app;
}

function authenticate(repository: Repository) {
  return asyncHandler(async (req: AuthRequest, res, next) => {
    const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return res.status(401).json({ error: "Anmeldung erforderlich.", message: "Anmeldung erforderlich." });
    const sessionHash = hashSessionToken(token);
    const user = await repository.getSessionUser(sessionHash);
    if (!user) return res.status(401).json({ error: "Sitzung ist abgelaufen.", message: "Sitzung ist abgelaufen." });
    req.user = user;
    req.sessionHash = sessionHash;
    return next();
  });
}

function originGuard(req: Request, res: Response, next: NextFunction, config: AppConfig) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== config.APP_ORIGIN) return res.status(403).json({ error: "Ungültige Anfragequelle.", message: "Ungültige Anfragequelle." });
  return next();
}

function asyncHandler(handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function stripPassword<T extends { passwordHash: string }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

function publicUser(user: AuthUser) {
  return { ...user, name: user.displayName };
}

function publicProjectSummary(row: Record<string, unknown>) {
  const currentVersionId = row.versionId ?? row.currentVersionId;
  const currentVersion = Number(row.versionNumber ?? row.currentVersion ?? 1);
  return {
    id: row.id,
    projectNumber: row.projectNumber,
    name: row.name,
    client: row.client,
    planningPhase: row.planningPhase,
    estimateType: row.estimateType === "detail" ? "detailed" : row.estimateType,
    status: row.status ?? "draft",
    currentVersionId,
    currentVersion,
    versionId: currentVersionId,
    versionNumber: currentVersion,
    catalogVersion: row.catalogVersion ?? "",
    priceQuarter: Number(row.priceQuarter ?? 3),
    priceYear: Number(row.priceYear ?? 2026),
    totalNetCents: cents(row.total),
    openIssueCount: Number(row.openIssueCount ?? 0),
    updatedAt: row.updatedAt,
  };
}

function publicEstimatePayload(
  version: Record<string, unknown>, lines: Record<string, unknown>[],
  validation: { issues: Array<{ severity: string; code: string; message: string; lineId?: string }>; totals: Record<string, unknown> },
  user: AuthUser, catalogKgkNodes: Record<string, unknown>[],
) {
  const kilometerParts = String(version.kilometer ?? "").split("–");
  return {
    project: {
      id: version.projectId, projectNumber: version.projectNumber, name: version.projectName, client: version.client,
      planningPhase: version.planningPhase, estimateType: version.estimateType === "detail" ? "detailed" : version.estimateType,
      status: version.status, currentVersionId: version.id, currentVersion: Number(version.versionNumber),
      catalogVersion: version.catalogVersionName, priceQuarter: Number(version.priceQuarter), priceYear: Number(version.priceYear),
      totalNetCents: cents(validation.totals.net), openIssueCount: validation.issues.length, updatedAt: version.updatedAt,
      route: version.route, kilometerFrom: kilometerParts[0] ?? "", kilometerTo: kilometerParts[1] ?? "",
      projectManager: version.projectManager, editor: version.editor ?? user.displayName, grossMode: version.taxMode === "gross",
      taxRate: Number(version.vatRate ?? 19), createdAt: version.createdAt,
    },
    version: {
      id: version.id, number: Number(version.versionNumber), variantName: version.variantName, status: version.status, catalogVersion: version.catalogVersionName,
      priceYear: Number(version.priceYear), priceQuarter: Number(version.priceQuarter), lastSavedAt: version.updatedAt,
    },
    lines: lines.map((line) => publicLine(line, validation.issues)),
    kgkTree: buildKgkTree(validation.totals.kgk as Array<{ code: string; level: number; total: string }> ?? [], lines, catalogKgkNodes),
    totals: {
      netCents: cents(validation.totals.net), taxCents: cents(validation.totals.vat), grossCents: cents(validation.totals.gross),
      pricedLineCount: lines.filter((line) => line.total !== null).length, lineCount: lines.length,
    },
  };
}

function publicLine(line: Record<string, unknown>, issues: Array<{ severity: string; code: string; message: string; lineId?: string }>) {
  const snapshot = (line.catalogSnapshot && typeof line.catalogSnapshot === "object" ? line.catalogSnapshot : {}) as Record<string, unknown>;
  const blockingReasons = issues.filter((issue) => issue.lineId === line.id && issue.severity === "blocking").map((issue) => issue.message);
  const review = (Boolean(line.reviewNote) && line.reviewNoteStatus === "open") || line.usageClassification === "review_required";
  return {
    ...line,
    dataRecordId: snapshot.dataset_id ?? snapshot.datasetId,
    description: line.designation,
    basePrice: line.originalUnitPrice,
    basePeriod: snapshot.selected_period ?? snapshot.selectedPeriod ?? "Q3 2026",
    indexFactor: snapshot.escalation_factor ?? snapshot.escalationFactor ?? line.factor,
    catalogUnitPrice: line.indexedUnitPrice,
    manualReason: line.manualPriceReason,
    percentage: line.percentRate,
    referenceLineId: line.referenceKind === "line" ? line.referenceId : null,
    totalCents: line.total === null ? null : cents(line.total),
    sourceLocation: line.sourceReference,
    usageClassification: line.usageClassification === "detail" ? "detailed" : line.usageClassification === "review_required" ? "review" : line.usageClassification,
    status: blockingReasons.length ? "blocked" : review ? "review" : "ready",
    blockingReasons,
  };
}

function publicCatalogItem(item: Record<string, unknown>) {
  return {
    ...item,
    dataRecordId: item.datasetId,
    description: item.designation,
    sourceLocation: item.sourceReference,
    usageClassification: item.usageClassification === "detail" ? "detailed" : item.usageClassification === "review_required" ? "review" : item.usageClassification,
    allowedForPlanningPhase: item.usageClassification !== "review_required",
  };
}

function publicValidation(issues: Array<{ severity: string; code: string; message: string; lineId?: string }>) {
  const publicIssues = issues.map((issue, index) => ({
    id: `${issue.code}-${issue.lineId ?? "project"}-${index}`,
    severity: issue.severity === "blocking" ? "error" : issue.severity,
    code: issue.code,
    title: issue.message,
    detail: issue.message,
    lineId: issue.lineId,
  }));
  const counts = publicIssues.reduce((result, issue) => {
    result[issue.severity] = (result[issue.severity] ?? 0) + 1;
    return result;
  }, { info: 0, warning: 0, error: 0 } as Record<string, number>);
  return { releaseAllowed: counts.error === 0, checkedAt: new Date().toISOString(), issues: publicIssues, counts };
}

function normalizeLinePatch(input: Record<string, unknown>): Record<string, unknown> {
  const result = { ...input };
  if ("description" in input) result.designation = input.description;
  if ("basePrice" in input) result.originalUnitPrice = input.basePrice;
  if ("catalogUnitPrice" in input) result.indexedUnitPrice = input.catalogUnitPrice;
  if ("percentage" in input) result.percentRate = input.percentage;
  if ("referenceLineId" in input) { result.referenceId = input.referenceLineId; result.referenceKind = input.referenceLineId ? "line" : null; }
  if ("sourceLocation" in input) result.sourceReference = input.sourceLocation;
  if ("manualReason" in input) result.manualPriceReason = input.manualReason;
  if (input.usageClassification === "detailed") result.usageClassification = "detail";
  if (input.usageClassification === "review") result.usageClassification = "review_required";
  if ("status" in input) result.workStatus = input.status;
  return result;
}

function buildKgkTree(rollups: Array<{ code: string; level: number; total: string }>, lines: Record<string, unknown>[], catalogNodes: Record<string, unknown>[]) {
  type Node = { code: string; label: string; level: number; totalCents: number; lineCount: number; children: Node[] };
  const nodes = new Map<string, Node>();
  const labels = new Map(catalogNodes.map((node) => [String(node.code), String(node.label ?? node.code)]));
  for (const item of rollups) {
    const matching = lines.filter((line) => String(line.kgkCode ?? "").startsWith(item.code.replace(/0+$/, "")));
    nodes.set(item.code, { code: item.code, label: labels.get(item.code) ?? item.code, level: item.level, totalCents: cents(item.total), lineCount: matching.length, children: [] });
  }
  const roots: Node[] = [];
  for (const node of [...nodes.values()].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))) {
    const levels = kgkLevelCodes(node.code);
    const parent = levels.slice(0, node.level - 1).reverse().map((code) => nodes.get(code)).find(Boolean);
    if (parent && parent.code !== node.code) parent.children.push(node); else roots.push(node);
  }
  return roots;
}

function cents(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  return new Decimal(String(value)).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const projectSchema = z.object({
  projectNumber: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(300), client: z.string().trim().min(1).max(300),
  route: z.string().trim().max(200).nullable().optional(), kilometer: z.string().trim().max(100).nullable().optional(),
  projectManager: z.string().trim().min(1).max(200), planningPhase: z.string().trim().min(1).max(50),
  estimateType: z.enum(["detail", "detailed", "kkk"]), priceYear: z.number().int().min(2000).max(2200), priceQuarter: z.number().int().min(1).max(4),
  catalogVersionId: z.string().uuid().optional(), catalogVersion: z.string().trim().min(1).max(100).optional(),
  taxMode: z.enum(["net", "gross"]).optional(), grossMode: z.boolean().optional(), variantName: z.string().trim().min(1).max(100).optional(),
  kilometerFrom: z.string().trim().max(100).optional(), kilometerTo: z.string().trim().max(100).optional(), editor: z.string().trim().max(200).optional(),
});

const versionPatchSchema = z.object({
  variantName: z.string().trim().min(1).max(100).optional(), planningPhase: z.string().trim().min(1).max(50).optional(),
  estimateType: z.enum(["detail", "kkk"]).optional(), priceYear: z.number().int().min(2000).max(2200).optional(),
  priceQuarter: z.number().int().min(1).max(4).optional(), catalogVersionId: z.string().uuid().optional(),
  taxMode: z.enum(["net", "gross"]).optional(), vatRate: z.union([z.string(), z.number()]).optional(),
  status: z.enum(["draft", "internal_review", "archived"]).optional(), reason: z.string().trim().min(3).max(1000).optional(),
}).strict();

const nullableNumber = z.union([z.string(), z.number()]).nullable().optional();
const lineSchema = z.object({
  sequence: z.number().int().positive().optional(), kgkCode: z.string().regex(/^\d{7}$/), kgkPath: z.string().nullable().optional(),
  kgkOutline: z.string().nullable().optional(), positionId: z.string().nullable().optional(), designation: z.string().trim().min(1).max(1000),
  explanation: z.string().nullable().optional(), basis: z.string().nullable().optional(), quantity: nullableNumber, unit: z.string().nullable().optional(),
  originalUnitPrice: nullableNumber, indexedUnitPrice: nullableNumber, manualUnitPrice: nullableNumber, manualPriceSource: z.string().nullable().optional(),
  manualPriceDate: z.string().nullable().optional(), manualPriceReason: z.string().nullable().optional(), manualPriceEditor: z.string().nullable().optional(),
  priceType: z.enum(["unit", "percentage", "surcharge", "parameter"]), percentRate: nullableNumber,
  referenceKind: z.enum(["line", "kgk", "group"]).nullable().optional(), referenceId: z.string().nullable().optional(), factor: nullableNumber,
  calculationRule: z.string().nullable().optional(), calculationParameters: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable().optional(),
  source: z.string().nullable().optional(), sourceReference: z.string().nullable().optional(), reviewNote: z.string().nullable().optional(),
  reviewNoteStatus: z.enum(["open", "acknowledged", "resolved"]).optional(), ownNote: z.string().nullable().optional(),
  usageClassification: z.enum(["detail", "kkk", "review_required"]).optional(), planningPhaseAllowed: z.boolean().nullable().optional(),
  negativeConfirmed: z.boolean().optional(), negativeReason: z.string().nullable().optional(), workStatus: z.string().optional(),
});
const linePatchSchema = lineSchema.partial().extend({
  description: z.string().trim().min(1).max(1000).optional(), basePrice: nullableNumber, catalogUnitPrice: nullableNumber,
  percentage: nullableNumber, referenceLineId: z.string().nullable().optional(), sourceLocation: z.string().nullable().optional(),
  manualReason: z.string().nullable().optional(), status: z.enum(["ready", "review", "blocked"]).optional(),
  usageClassification: z.enum(["detail", "detailed", "kkk", "review_required", "review"]).optional(),
  totalCents: z.number().nullable().optional(), blockingReasons: z.array(z.string()).optional(), reason: z.string().trim().min(3).max(1000).optional(),
});

const catalogFilterSchema = z.object({
  q: z.string().max(300).optional(), catalogVersionId: z.string().uuid().optional(), kgk: z.string().max(7).optional(),
  unit: z.string().max(50).optional(), priceType: z.string().max(100).optional(), source: z.string().max(300).optional(),
  usageClassification: z.enum(["detail", "kkk", "review_required"]).optional(),
  planningPhase: z.string().regex(/^[1-9]$/).optional(),
  hasReviewNote: z.enum(["true", "false"]).optional(), limit: z.string().regex(/^\d+$/).optional(),
  withoutReviewNote: z.enum(["true", "false"]).optional(), page: z.string().regex(/^\d+$/).optional(), pageSize: z.string().regex(/^\d+$/).optional(),
});
