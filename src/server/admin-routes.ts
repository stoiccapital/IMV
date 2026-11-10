import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AuthUser } from "../shared/types.ts";
import type { Repository } from "./services/repository.ts";
import { AdminService } from "./services/admin-service.ts";

type AuthRequest = Request & { user?: AuthUser };
const reason = z.string().trim().min(3).max(1000).optional();
const role = z.enum(["admin", "editor", "reviewer", "reader"]);
const uuid = z.string().uuid();

export function registerAdminRoutes(app: Express, repository: Repository): void {
  const admin = new AdminService(repository.sql);

  app.get("/api/admin/users", wrap(async (req, res) => res.json({ users: await admin.listUsers(req.user!) })));
  app.post("/api/admin/users", wrap(async (req, res) => {
    const input = z.object({ email: z.string().email(), displayName: z.string().trim().min(2).max(200), password: z.string().min(12).max(200), role }).parse(req.body);
    res.status(201).json({ user: await admin.createUser(req.user!, input) });
  }));
  app.patch("/api/admin/users/:userId", wrap(async (req, res) => {
    const input = z.object({ displayName: z.string().trim().min(2).max(200).optional(), role: role.optional(), active: z.boolean().optional(), reason }).parse(req.body);
    res.json({ user: await admin.updateUser(req.user!, routeParam(req, "userId"), { ...input, reason: input.reason ?? "Änderung über die Administrationsoberfläche" }) });
  }));

  app.get("/api/admin/units", wrap(async (req, res) => res.json({ units: await admin.listUnits(req.user!) })));
  app.patch("/api/admin/units/:unitId", wrap(async (req, res) => {
    const input = z.object({ displayName: z.string().trim().min(1).max(100).optional(), label: z.string().trim().min(1).max(100).optional(), approved: z.boolean().optional(), note: z.string().trim().max(1000).nullable().optional(), reason }).parse(req.body);
    res.json({ unit: await admin.updateUnit(req.user!, routeParam(req, "unitId"), {
      label: input.displayName ?? input.label, approved: input.approved, note: input.note,
      reason: input.reason ?? "Einheitenregister über die Administrationsoberfläche geändert",
    }) });
  }));

  app.get("/api/admin/index-series", wrap(async (req, res) => res.json({ indexSeries: await admin.listIndexSeries(req.user!) })));
  app.post("/api/admin/index-series", wrap(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(200), source: z.string().trim().min(2).max(500), baseYear: z.number().int().min(1900).max(2200), version: z.number().int().positive().optional(), approved: z.boolean().optional(), reason }).parse(req.body);
    const created = await admin.createIndexSeries(req.user!, { ...input, reason: input.reason ?? "Indexreihe administrativ angelegt" });
    res.status(201).json({ indexSeries: created });
  }));
  app.patch("/api/admin/index-series/:seriesId", wrap(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(200).optional(), source: z.string().trim().min(2).max(500).optional(), approved: z.boolean().optional(), reason }).parse(req.body);
    res.json({ indexSeries: await admin.updateIndexSeries(req.user!, routeParam(req, "seriesId"), { ...input, reason: input.reason ?? "Indexreihe administrativ geändert" }) });
  }));
  app.post("/api/admin/index-series/:seriesId/values", wrap(async (req, res) => {
    const input = z.object({ year: z.number().int().min(1900).max(2200), quarter: z.number().int().min(1).max(4), value: z.union([z.string().trim().regex(/^\d+(?:[.,]\d+)?$/), z.number().positive()]), sourceReference: z.string().trim().max(1000).nullable().optional(), reason }).parse(req.body);
    const normalized = typeof input.value === "string" ? input.value.replace(",", ".") : input.value;
    await admin.upsertIndexValue(req.user!, routeParam(req, "seriesId"), { ...input, value: normalized, reason: input.reason ?? "Quartalswert administrativ gepflegt" });
    const series = (await admin.listIndexSeries(req.user!)).find((entry) => entry.id === routeParam(req, "seriesId"));
    res.json({ indexSeries: series });
  }));
  app.post("/api/admin/catalog-versions/:catalogVersionId/index-series", wrap(async (req, res) => {
    const input = z.object({ indexSeriesId: uuid, reason }).parse(req.body);
    const catalogVersion = await admin.assignCatalogIndexSeries(req.user!, routeParam(req, "catalogVersionId"), input.indexSeriesId, input.reason ?? "Maßgebliche Indexreihe administrativ bestätigt");
    res.json({ catalogVersion });
  }));

  app.get("/api/admin/calculation-rules", wrap(async (req, res) => res.json({ calculationRules: await admin.listCalculationRules(req.user!) })));
  app.post("/api/admin/calculation-rules", wrap(async (req, res) => {
    const input = ruleSchema.extend({ code: z.string().trim().min(2).max(100), version: z.number().int().positive().optional() }).parse(req.body);
    const created = await admin.createCalculationRule(req.user!, { ...input, reason: input.reason ?? "Berechnungsregel administrativ angelegt" });
    res.status(201).json({ calculationRule: created });
  }));
  app.patch("/api/admin/calculation-rules/:ruleId", wrap(async (req, res) => {
    const input = ruleSchema.partial().extend({ reason }).parse(req.body);
    res.json({ calculationRule: await admin.updateCalculationRule(req.user!, routeParam(req, "ruleId"), { ...input, reason: input.reason ?? "Berechnungsregel administrativ geändert" }) });
  }));

  app.get("/api/admin/catalog-items/classification", wrap(async (req, res) => {
    const input = z.object({ catalogVersionId: uuid, q: z.string().max(300).optional(), kgk: z.string().max(7).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(200).optional() }).parse(req.query);
    res.json(await admin.searchClassificationCandidates(req.user!, input));
  }));
  app.post("/api/admin/catalog-items/classify", wrap(async (req, res) => {
    const input = z.object({
      catalogVersionId: uuid.optional(), priceItemIds: z.array(uuid).min(1).max(500).optional(), itemIds: z.array(uuid).min(1).max(500).optional(),
      usageClassification: z.enum(["detail", "kkk", "review_required"]), allowedFromLph: z.number().int().min(1).max(9).nullable().optional(),
      allowedToLph: z.number().int().min(1).max(9).nullable().optional(), classificationSource: z.string().trim().min(3).max(1000), reason,
    }).parse(req.body);
    const result = await admin.classifyCatalogItems(req.user!, {
      catalogVersionId: input.catalogVersionId, itemIds: input.priceItemIds ?? input.itemIds,
      usageClassification: input.usageClassification, allowedFromLph: input.allowedFromLph, allowedToLph: input.allowedToLph,
      classificationSource: input.classificationSource, reason: input.reason ?? input.classificationSource,
    });
    res.json({ updated: result.count, ...result });
  }));

  app.get("/api/admin/projects/:projectId/members", wrap(async (req, res) => res.json(await admin.listProjectMembers(req.user!, routeParam(req, "projectId")))));
  app.put("/api/admin/projects/:projectId/members/:userId", wrap(async (req, res) => {
    const input = z.object({ accessRole: z.string().trim().min(1).max(50).nullable(), reason }).parse(req.body);
    await admin.setProjectMember(req.user!, routeParam(req, "projectId"), routeParam(req, "userId"), input.accessRole, input.reason ?? "Projektmitgliedschaft administrativ geändert");
    res.status(204).end();
  }));
}

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(200), expression: z.string().trim().min(2).max(2000),
  parameterSchema: z.record(z.string(), z.unknown()).optional(), approved: z.boolean().optional(), note: z.string().trim().max(1000).nullable().optional(), reason,
});

function wrap(handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
