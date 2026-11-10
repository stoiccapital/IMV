import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth/crypto.ts";
import type { SqlClient } from "../db/client.ts";
import type { AuthUser, UserRole } from "../../shared/types.ts";
import { ForbiddenError, ImmutableError, NotFoundError } from "./repository.ts";

type Row = Record<string, unknown>;
const USER_ROLES = new Set<UserRole>(["admin", "editor", "reviewer", "reader"]);
const CLASSIFICATIONS = new Set(["detail", "kkk", "review_required"]);

export interface CatalogClassificationInput {
  catalogVersionId?: string;
  itemIds?: string[];
  filter?: { q?: string; kgk?: string; unit?: string; source?: string; hasReviewNote?: boolean };
  usageClassification: "detail" | "kkk" | "review_required";
  allowedFromLph?: number | null;
  allowedToLph?: number | null;
  classificationSource: string;
  reason: string;
}

export class AdminService {
  constructor(private readonly sql: SqlClient) {}

  async listUsers(actor: AuthUser): Promise<Row[]> {
    this.assertAdmin(actor);
    const result = await this.sql.query<Row>(
      `SELECT id,email,display_name AS "displayName",role,active,created_at AS "createdAt"
       FROM users ORDER BY active DESC,display_name,email`,
    );
    return result.rows;
  }

  async createUser(actor: AuthUser, input: { email: string; displayName: string; password: string; role: UserRole }): Promise<Row> {
    this.assertAdmin(actor);
    if (!USER_ROLES.has(input.role)) throw new Error("Ungültige Rolle");
    const id = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await this.sql.query(
      `INSERT INTO users (id,email,display_name,password_hash,role,active) VALUES ($1,lower($2),$3,$4,$5,true)`,
      [id, input.email.trim(), input.displayName.trim(), passwordHash, input.role],
    );
    const created = await this.userById(id);
    await this.audit(actor.id, "user", id, "create", null, withoutSecrets(created), "Benutzer administrativ angelegt");
    return created;
  }

  async updateUser(actor: AuthUser, userId: string, patch: { displayName?: string; role?: UserRole; active?: boolean; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const before = await this.userById(userId);
    if (patch.role && !USER_ROLES.has(patch.role)) throw new Error("Ungültige Rolle");
    const removesAdmin = before.role === "admin" && (patch.role && patch.role !== "admin" || patch.active === false);
    if (removesAdmin) {
      const otherAdmins = await this.sql.query<Row>(`SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true AND id<>$1`, [userId]);
      if (Number(otherAdmins.rows[0]?.count ?? 0) === 0) throw new ImmutableError("Der letzte aktive Administrator kann nicht entfernt werden");
    }
    const entries = Object.entries(patch).filter(([key, value]) => key !== "reason" && value !== undefined);
    if (entries.length) {
      const columns: Record<string, string> = { displayName: "display_name", role: "role", active: "active" };
      const params = entries.map(([, value]) => value);
      params.push(userId);
      await this.sql.query(`UPDATE users SET ${entries.map(([key], index) => `${columns[key]}=$${index + 1}`).join(",")} WHERE id=$${params.length}`, params);
      if (patch.active === false) await this.sql.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
    }
    const after = await this.userById(userId);
    await this.audit(actor.id, "user", userId, "update", withoutSecrets(before), withoutSecrets(after), patch.reason.trim());
    return after;
  }

  async listUnits(actor: AuthUser): Promise<Row[]> {
    this.assertAdmin(actor);
    const result = await this.sql.query<Row>(
      `SELECT ur.id,ur.unit AS "canonicalUnit",ur.label AS "displayName",ur.approved,ur.note,ur.updated_at AS "updatedAt",
              coalesce(count(pi.id),0)::int AS "catalogItemCount"
       FROM unit_registry ur LEFT JOIN price_items pi ON pi.unit=ur.unit
       GROUP BY ur.id ORDER BY ur.unit`,
    );
    return result.rows;
  }

  async updateUnit(actor: AuthUser, unitId: string, input: { label?: string; approved?: boolean; note?: string | null; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const before = await this.one(`SELECT id,unit,label,approved,note FROM unit_registry WHERE id=$1`, [unitId], "Einheit nicht gefunden");
    await this.sql.query(
      `UPDATE unit_registry SET label=coalesce($1,label),approved=coalesce($2,approved),note=$3,updated_by=$4,updated_at=now() WHERE id=$5`,
      [input.label?.trim() || null, input.approved ?? null, input.note?.trim() || null, actor.id, unitId],
    );
    const after = await this.one(`SELECT id,unit AS "canonicalUnit",label AS "displayName",approved,note,updated_at AS "updatedAt" FROM unit_registry WHERE id=$1`, [unitId]);
    await this.audit(actor.id, "unit_registry", unitId, "update", before, after, input.reason.trim());
    return after;
  }

  async listIndexSeries(actor: AuthUser): Promise<Row[]> {
    this.assertAdmin(actor);
    const series = await this.sql.query<Row>(
      `SELECT id,name,source,base_year AS "baseYear",version,approved,created_at AS "createdAt"
       FROM index_series ORDER BY name,version DESC`,
    );
    const values = await this.sql.query<Row>(
      `SELECT series_id AS "seriesId",year,quarter,value::text,source_reference AS "sourceReference"
       FROM index_values ORDER BY year,quarter`,
    );
    return series.rows.map((entry) => ({ ...entry, values: values.rows.filter((value) => value.seriesId === entry.id) }));
  }

  async createIndexSeries(actor: AuthUser, input: { name: string; source: string; baseYear: number; version?: number; approved?: boolean; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const id = randomUUID();
    await this.sql.query(
      `INSERT INTO index_series (id,name,source,base_year,version,approved) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, input.name.trim(), input.source.trim(), input.baseYear, input.version ?? 1, input.approved ?? false],
    );
    const created = await this.one(`SELECT id,name,source,base_year AS "baseYear",version,approved FROM index_series WHERE id=$1`, [id]);
    await this.audit(actor.id, "index_series", id, "create", null, created, input.reason.trim());
    return { ...created, values: [] };
  }

  async updateIndexSeries(actor: AuthUser, seriesId: string, input: { approved?: boolean; name?: string; source?: string; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const before = await this.one(`SELECT id,name,source,base_year AS "baseYear",version,approved FROM index_series WHERE id=$1`, [seriesId], "Indexreihe nicht gefunden");
    await this.sql.query(
      `UPDATE index_series SET name=coalesce($1,name),source=coalesce($2,source),approved=coalesce($3,approved) WHERE id=$4`,
      [input.name?.trim() || null, input.source?.trim() || null, input.approved ?? null, seriesId],
    );
    const after = await this.one(`SELECT id,name,source,base_year AS "baseYear",version,approved FROM index_series WHERE id=$1`, [seriesId]);
    await this.audit(actor.id, "index_series", seriesId, "update", before, after, input.reason.trim());
    return after;
  }

  async upsertIndexValue(actor: AuthUser, seriesId: string, input: { year: number; quarter: number; value: string | number; sourceReference?: string | null; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    await this.one(`SELECT id FROM index_series WHERE id=$1`, [seriesId], "Indexreihe nicht gefunden");
    const existing = await this.sql.query<Row>(`SELECT value::text,"source_reference" AS "sourceReference" FROM index_values WHERE series_id=$1 AND year=$2 AND quarter=$3`, [seriesId, input.year, input.quarter]);
    await this.sql.query(
      `INSERT INTO index_values (series_id,year,quarter,value,source_reference) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (series_id,year,quarter) DO UPDATE SET value=excluded.value,source_reference=excluded.source_reference`,
      [seriesId, input.year, input.quarter, input.value, input.sourceReference?.trim() || null],
    );
    const after = await this.one(
      `SELECT series_id AS "seriesId",year,quarter,value::text,source_reference AS "sourceReference"
       FROM index_values WHERE series_id=$1 AND year=$2 AND quarter=$3`, [seriesId, input.year, input.quarter],
    );
    await this.audit(actor.id, "index_value", `${seriesId}:${input.year}:Q${input.quarter}`, existing.rows.length ? "update" : "create", existing.rows[0] ?? null, after, input.reason.trim());
    return after;
  }

  async assignCatalogIndexSeries(actor: AuthUser, catalogVersionId: string, seriesId: string, reason: string): Promise<Row> {
    this.assertAdmin(actor);
    const catalog = await this.one(
      `SELECT id,name,year,quarter,index_series_id AS "indexSeriesId",index_series_confirmed AS "indexSeriesConfirmed"
       FROM catalog_versions WHERE id=$1`, [catalogVersionId], "Katalogversion nicht gefunden",
    );
    const series = await this.one(`SELECT id,name,approved FROM index_series WHERE id=$1`, [seriesId], "Indexreihe nicht gefunden");
    if (!series.approved) throw new ImmutableError("Nur eine freigegebene Indexreihe kann zugeordnet werden");
    const targetValue = await this.sql.query<Row>(
      `SELECT value::text FROM index_values WHERE series_id=$1 AND year=$2 AND quarter=$3`,
      [seriesId, catalog.year, catalog.quarter],
    );
    if (!targetValue.rows[0]) throw new ImmutableError("Für den Katalogpreisstand fehlt ein Indexwert in der ausgewählten Reihe");
    await this.sql.query(`UPDATE catalog_versions SET index_series_id=$1,index_series_confirmed=true WHERE id=$2`, [seriesId, catalogVersionId]);
    const after = { ...catalog, indexSeriesId: seriesId, indexSeriesConfirmed: true, indexSeriesName: series.name, targetIndex: targetValue.rows[0].value };
    await this.audit(actor.id, "catalog_version", catalogVersionId, "assign_index_series", catalog, after, reason.trim());
    return after;
  }

  async listCalculationRules(actor: AuthUser): Promise<Row[]> {
    this.assertAdmin(actor);
    const result = await this.sql.query<Row>(
      `SELECT id,code,name,expression,parameter_schema AS "parameterSchema",version,approved,note,updated_at AS "updatedAt"
       FROM calculation_rules ORDER BY code,version DESC`,
    );
    return result.rows;
  }

  async createCalculationRule(actor: AuthUser, input: { code: string; name: string; expression: string; parameterSchema?: Record<string, unknown>; version?: number; approved?: boolean; note?: string | null; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const id = randomUUID();
    await this.sql.query(
      `INSERT INTO calculation_rules (id,code,name,expression,parameter_schema,version,approved,note,updated_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
      [id, input.code.trim(), input.name.trim(), input.expression.trim(), JSON.stringify(input.parameterSchema ?? {}), input.version ?? 1,
        input.approved ?? false, input.note?.trim() || null, actor.id],
    );
    const created = await this.ruleById(id);
    await this.audit(actor.id, "calculation_rule", id, "create", null, created, input.reason.trim());
    return created;
  }

  async updateCalculationRule(actor: AuthUser, ruleId: string, input: { name?: string; expression?: string; parameterSchema?: Record<string, unknown>; approved?: boolean; note?: string | null; reason: string }): Promise<Row> {
    this.assertAdmin(actor);
    const before = await this.ruleById(ruleId);
    await this.sql.query(
      `UPDATE calculation_rules SET name=coalesce($1,name),expression=coalesce($2,expression),
       parameter_schema=coalesce($3::jsonb,parameter_schema),approved=coalesce($4,approved),note=$5,updated_by=$6,updated_at=now() WHERE id=$7`,
      [input.name?.trim() || null, input.expression?.trim() || null,
        input.parameterSchema === undefined ? null : JSON.stringify(input.parameterSchema), input.approved ?? null,
        input.note?.trim() || null, actor.id, ruleId],
    );
    const after = await this.ruleById(ruleId);
    await this.audit(actor.id, "calculation_rule", ruleId, "update", before, after, input.reason.trim());
    return after;
  }

  async searchClassificationCandidates(actor: AuthUser, filters: { catalogVersionId: string; q?: string; kgk?: string; page?: number; pageSize?: number }): Promise<Row> {
    this.assertAdmin(actor);
    const params: unknown[] = [filters.catalogVersionId];
    const conditions = [`catalog_version_id=$1`];
    if (filters.q?.trim()) {
      params.push(`%${filters.q.trim()}%`);
      conditions.push(`(dataset_id ILIKE $${params.length} OR position_id ILIKE $${params.length} OR designation ILIKE $${params.length} OR kgk_path ILIKE $${params.length} OR source ILIKE $${params.length})`);
    }
    if (filters.kgk?.trim()) { params.push(`${filters.kgk.trim()}%`); conditions.push(`kgk_code LIKE $${params.length}`); }
    const page = Math.max(filters.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const count = await this.sql.query<Row>(`SELECT count(*)::int AS total FROM price_items WHERE ${conditions.join(" AND ")}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const items = await this.sql.query<Row>(
      `SELECT id,dataset_id AS "datasetId",position_id AS "positionId",kgk_code AS "kgkCode",designation,unit,source,
              usage_classification AS "usageClassification",classification_source AS "classificationSource",
              allowed_from_lph AS "allowedFromLph",allowed_to_lph AS "allowedToLph"
       FROM price_items WHERE ${conditions.join(" AND ")} ORDER BY kgk_code,dataset_id
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return { items: items.rows, total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  }

  async classifyCatalogItems(actor: AuthUser, input: CatalogClassificationInput): Promise<Row> {
    this.assertAdmin(actor);
    if (!CLASSIFICATIONS.has(input.usageClassification)) throw new Error("Ungültige Verwendungsart");
    const from = validLph(input.allowedFromLph);
    const to = validLph(input.allowedToLph);
    if (from && to && from > to) throw new Error("LPH-Untergrenze liegt über der Obergrenze");
    if (!input.classificationSource.trim()) throw new Error("Klassifizierungsquelle ist erforderlich");
    const params: unknown[] = [];
    const conditions = ["1=1"];
    if (input.catalogVersionId) { params.push(input.catalogVersionId); conditions.push(`catalog_version_id=$${params.length}`); }
    if (input.itemIds?.length) {
      const ids = [...new Set(input.itemIds)].slice(0, 500);
      conditions.push(`id IN (${ids.map((id) => { params.push(id); return `$${params.length}`; }).join(",")})`);
    } else {
      const filter = input.filter ?? {};
      if (filter.q?.trim()) {
        params.push(`%${filter.q.trim()}%`);
        conditions.push(`(dataset_id ILIKE $${params.length} OR position_id ILIKE $${params.length} OR designation ILIKE $${params.length} OR kgk_path ILIKE $${params.length} OR source ILIKE $${params.length})`);
      }
      if (filter.kgk?.trim()) { params.push(`${filter.kgk.trim()}%`); conditions.push(`kgk_code LIKE $${params.length}`); }
      if (filter.unit?.trim()) { params.push(filter.unit.trim()); conditions.push(`unit=$${params.length}`); }
      if (filter.source?.trim()) { params.push(`%${filter.source.trim()}%`); conditions.push(`source ILIKE $${params.length}`); }
      if (filter.hasReviewNote) conditions.push(`nullif(trim(review_note),'') IS NOT NULL`);
      if (conditions.length === 1) throw new Error("Für eine Massenklassifizierung ist eine Auswahl oder ein Filter erforderlich");
    }
    const before = await this.sql.query<Row>(
      `SELECT count(*)::int AS count,
              count(*) FILTER (WHERE usage_classification='review_required')::int AS "previouslyUnclassified"
       FROM price_items WHERE ${conditions.join(" AND ")}`, params,
    );
    const count = Number(before.rows[0]?.count ?? 0);
    if (!count) throw new NotFoundError("Keine Katalogposition für die Klassifizierung gefunden");
    params.push(input.usageClassification, input.classificationSource.trim(), from, to);
    await this.sql.query(
      `UPDATE price_items SET usage_classification=$${params.length - 3},classification_source=$${params.length - 2},
       allowed_from_lph=$${params.length - 1},allowed_to_lph=$${params.length}
       WHERE ${conditions.join(" AND ")}`, params,
    );
    const result = { count, usageClassification: input.usageClassification, allowedFromLph: from, allowedToLph: to, classificationSource: input.classificationSource.trim() };
    await this.audit(actor.id, "catalog_classification", input.catalogVersionId ?? "selected-items", "bulk_update", before.rows[0] ?? null, result, input.reason.trim());
    return result;
  }

  async listProjectMembers(actor: AuthUser, projectId: string): Promise<Row> {
    this.assertAdmin(actor);
    const project = await this.one(`SELECT id,project_number AS "projectNumber",name FROM projects WHERE id=$1`, [projectId], "Projekt nicht gefunden");
    const members = await this.sql.query<Row>(
      `SELECT u.id,u.email,u.display_name AS "displayName",u.role,pm.access_role AS "accessRole"
       FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 ORDER BY u.display_name`, [projectId],
    );
    return { project, members: members.rows };
  }

  async setProjectMember(actor: AuthUser, projectId: string, userId: string, accessRole: string | null, reason: string): Promise<void> {
    this.assertAdmin(actor);
    await this.one(`SELECT id FROM projects WHERE id=$1`, [projectId], "Projekt nicht gefunden");
    await this.one(`SELECT id FROM users WHERE id=$1 AND active=true`, [userId], "Aktiver Benutzer nicht gefunden");
    const before = await this.sql.query<Row>(`SELECT access_role AS "accessRole" FROM project_members WHERE project_id=$1 AND user_id=$2`, [projectId, userId]);
    if (accessRole) {
      await this.sql.query(
        `INSERT INTO project_members (project_id,user_id,access_role) VALUES ($1,$2,$3)
         ON CONFLICT (project_id,user_id) DO UPDATE SET access_role=excluded.access_role`, [projectId, userId, accessRole],
      );
    } else {
      await this.sql.query(`DELETE FROM project_members WHERE project_id=$1 AND user_id=$2`, [projectId, userId]);
    }
    await this.audit(actor.id, "project_member", `${projectId}:${userId}`, accessRole ? "upsert" : "delete", before.rows[0] ?? null, accessRole ? { accessRole } : null, reason.trim());
  }

  private assertAdmin(actor: AuthUser) {
    if (actor.role !== "admin") throw new ForbiddenError("Admin only");
  }

  private async userById(id: string): Promise<Row> {
    return this.one(`SELECT id,email,display_name AS "displayName",role,active,created_at AS "createdAt" FROM users WHERE id=$1`, [id], "Benutzer nicht gefunden");
  }

  private async ruleById(id: string): Promise<Row> {
    return this.one(
      `SELECT id,code,name,expression,parameter_schema AS "parameterSchema",version,approved,note,updated_at AS "updatedAt"
       FROM calculation_rules WHERE id=$1`, [id], "Berechnungsregel nicht gefunden",
    );
  }

  private async one(sql: string, params: unknown[], notFoundMessage = "Nicht gefunden"): Promise<Row> {
    const result = await this.sql.query<Row>(sql, params);
    if (!result.rows[0]) throw new NotFoundError(notFoundMessage);
    return result.rows[0];
  }

  private async audit(actorUserId: string, entityType: string, entityId: string, action: string, oldValue: unknown, newValue: unknown, reason: string) {
    await this.sql.query(
      `INSERT INTO audit_log (id,actor_user_id,entity_type,entity_id,action,old_value,new_value,reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
      [randomUUID(), actorUserId, entityType, entityId, action,
        oldValue === null ? null : JSON.stringify(oldValue), newValue === null ? null : JSON.stringify(newValue), reason],
    );
  }
}

function validLph(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 9) throw new Error("LPH muss zwischen 1 und 9 liegen");
  return value;
}

function withoutSecrets(row: Row): Row {
  const { passwordHash: _passwordHash, ...safe } = row;
  return safe;
}
