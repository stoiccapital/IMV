import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { SqlClient } from "../db/client.ts";
import { calculateLine, money, rollupKgk, validateEstimate } from "../../shared/domain.ts";
import type { AuthUser, EstimateLineInput, UserRole, ValidationIssue } from "../../shared/types.ts";

type Row = Record<string, unknown>;

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ImmutableError extends Error {}

export class Repository {
  constructor(public readonly sql: SqlClient) {}

  async findUserByEmail(email: string): Promise<(AuthUser & { passwordHash: string }) | null> {
    const result = await this.sql.query<Row>(
      `SELECT id,email,display_name AS "displayName",role,password_hash AS "passwordHash"
       FROM users WHERE lower(email)=lower($1) AND active=true`, [email],
    );
    return (result.rows[0] as (AuthUser & { passwordHash: string }) | undefined) ?? null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.sql.query(`INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)`, [randomUUID(), userId, tokenHash, expiresAt]);
  }

  async getSessionUser(tokenHash: string): Promise<AuthUser | null> {
    const result = await this.sql.query<Row>(
      `SELECT u.id,u.email,u.display_name AS "displayName",u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [tokenHash],
    );
    return (result.rows[0] as AuthUser | undefined) ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql.query(`DELETE FROM sessions WHERE token_hash=$1`, [tokenHash]);
  }

  async listProjects(user: AuthUser, query = "", status = ""): Promise<Row[]> {
    const conditions = [
      `(p.created_by=$1 OR $2='admin' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1))`,
    ];
    const params: unknown[] = [user.id, user.role];
    if (query.trim()) {
      params.push(`%${query.trim()}%`);
      conditions.push(`(p.project_number ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.client ILIKE $${params.length})`);
    }
    if (status.trim()) {
      params.push(status.trim());
      conditions.push(`pv.status=$${params.length}`);
    }
    const result = await this.sql.query<Row>(
      `SELECT p.id,p.project_number AS "projectNumber",p.name,p.client,p.route,p.kilometer,p.project_manager AS "projectManager",p.editor,
              p.updated_at AS "updatedAt",pv.id AS "versionId",pv.version_number AS "versionNumber",pv.variant_name AS "variantName",
              pv.status,pv.planning_phase AS "planningPhase",pv.estimate_type AS "estimateType",pv.price_year AS "priceYear",
              pv.price_quarter AS "priceQuarter",cv.name AS "catalogVersion",stats.total::text AS "total",stats."openIssueCount"
       FROM projects p
       LEFT JOIN LATERAL (SELECT * FROM project_versions v WHERE v.project_id=p.id ORDER BY v.updated_at DESC LIMIT 1) pv ON true
       LEFT JOIN catalog_versions cv ON cv.id=pv.catalog_version_id
       LEFT JOIN LATERAL (
         SELECT coalesce(sum(el.total),0) AS total,
                count(*) FILTER (WHERE el.total IS NULL OR el.usage_classification='review_required' OR (el.review_note IS NOT NULL AND el.review_note_status='open'))::int AS "openIssueCount"
         FROM estimate_lines el WHERE el.project_version_id=pv.id
       ) stats ON true
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.updated_at DESC`, params,
    );
    return result.rows;
  }

  async resolveCatalogVersionId(idOrName: string): Promise<string> {
    const result = await this.sql.query<Row>(`SELECT id FROM catalog_versions WHERE id::text=$1 OR name=$1 ORDER BY imported_at DESC LIMIT 1`, [idOrName]);
    if (!result.rows[0]) throw new NotFoundError("Catalog version not found");
    return String(result.rows[0].id);
  }

  async createProject(user: AuthUser, input: {
    projectNumber: string; name: string; client: string; route?: string | null; kilometer?: string | null;
    projectManager: string; editor?: string; planningPhase: string; estimateType: string; priceYear: number; priceQuarter: number;
    catalogVersionId: string; taxMode?: string; variantName?: string;
  }): Promise<Row> {
    if (!(["admin", "editor"] as UserRole[]).includes(user.role)) throw new ForbiddenError("Role may not create projects");
    const projectId = randomUUID();
    const versionId = randomUUID();
    await this.sql.transaction(async () => {
      await this.sql.query(
        `INSERT INTO projects (id,project_number,name,client,route,kilometer,project_manager,editor,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [projectId, input.projectNumber, input.name, input.client, input.route ?? null, input.kilometer ?? null, input.projectManager, input.editor?.trim() || user.displayName, user.id],
      );
      await this.sql.query(`INSERT INTO project_members (project_id,user_id,access_role) VALUES ($1,$2,'owner')`, [projectId, user.id]);
      await this.sql.query(
        `INSERT INTO project_versions
         (id,project_id,version_number,variant_name,planning_phase,estimate_type,price_year,price_quarter,catalog_version_id,tax_mode,created_by)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [versionId, projectId, input.variantName ?? "Basis", input.planningPhase, input.estimateType, input.priceYear,
          input.priceQuarter, input.catalogVersionId, input.taxMode ?? "net", user.id],
      );
      await this.audit(user.id, projectId, versionId, "project", projectId, "create", null, input, "Projekt angelegt");
    });
    return { id: projectId, versionId, versionNumber: 1, status: "draft", ...input };
  }

  async assertProjectAccess(user: AuthUser, projectId: string): Promise<void> {
    if (user.role === "admin") return;
    const result = await this.sql.query<Row>(
      `SELECT 1 FROM projects p WHERE p.id=$1 AND (p.created_by=$2 OR EXISTS
       (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2))`, [projectId, user.id],
    );
    if (!result.rows.length) throw new ForbiddenError("No project access");
  }

  async getProject(user: AuthUser, projectId: string): Promise<Row> {
    await this.assertProjectAccess(user, projectId);
    const project = await this.sql.query<Row>(
      `SELECT id,project_number AS "projectNumber",name,client,route,kilometer,project_manager AS "projectManager",editor,
              created_at AS "createdAt",updated_at AS "updatedAt" FROM projects WHERE id=$1`, [projectId],
    );
    if (!project.rows[0]) throw new NotFoundError("Project not found");
    const versions = await this.sql.query<Row>(
      `SELECT id,version_number AS "versionNumber",variant_name AS "variantName",planning_phase AS "planningPhase",
              estimate_type AS "estimateType",price_year AS "priceYear",price_quarter AS "priceQuarter",status,immutable,
              created_at AS "createdAt",updated_at AS "updatedAt",released_at AS "releasedAt"
       FROM project_versions WHERE project_id=$1 ORDER BY variant_name,version_number DESC`, [projectId],
    );
    return { ...project.rows[0], versions: versions.rows };
  }

  async listProjectVersions(user: AuthUser, projectId: string): Promise<Row[]> {
    await this.assertProjectAccess(user, projectId);
    const result = await this.sql.query<Row>(
      `SELECT pv.id,pv.version_number AS "number",pv.variant_name AS "variantName",pv.status,pv.immutable,
              pv.planning_phase AS "planningPhase",pv.estimate_type AS "estimateType",pv.price_year AS "priceYear",
              pv.price_quarter AS "priceQuarter",cv.name AS "catalogVersion",pv.created_at AS "createdAt",
              pv.updated_at AS "updatedAt",pv.released_at AS "releasedAt",coalesce(stats.total,0)::text AS "total"
       FROM project_versions pv
       JOIN catalog_versions cv ON cv.id=pv.catalog_version_id
       LEFT JOIN LATERAL (
         SELECT sum(el.total) AS total FROM estimate_lines el WHERE el.project_version_id=pv.id
       ) stats ON true
       WHERE pv.project_id=$1
       ORDER BY pv.variant_name,pv.version_number DESC,pv.created_at DESC`,
      [projectId],
    );
    return result.rows;
  }

  async compareVersions(user: AuthUser, projectId: string, fromVersionId: string, toVersionId: string): Promise<Row> {
    const fromVersion = await this.getVersion(user, projectId, fromVersionId);
    const toVersion = await this.getVersion(user, projectId, toVersionId);
    const [fromLines, toLines] = await Promise.all([
      this.listLines(user, projectId, fromVersionId),
      this.listLines(user, projectId, toVersionId),
    ]);
    const fromTotals = calculateTotals(fromLines, String(fromVersion.vatRate ?? "19"));
    const toTotals = calculateTotals(toLines, String(toVersion.vatRate ?? "19"));
    return buildVersionComparison(fromVersion, toVersion, fromLines, toLines, fromTotals, toTotals);
  }

  async getVersion(user: AuthUser, projectId: string, versionId: string): Promise<Row> {
    await this.assertProjectAccess(user, projectId);
    const result = await this.sql.query<Row>(
      `SELECT pv.id,pv.project_id AS "projectId",pv.version_number AS "versionNumber",pv.variant_name AS "variantName",
              pv.planning_phase AS "planningPhase",pv.estimate_type AS "estimateType",pv.price_year AS "priceYear",
              pv.price_quarter AS "priceQuarter",pv.catalog_version_id AS "catalogVersionId",cv.name AS "catalogVersionName",
              cv.index_series_confirmed AS "indexSeriesConfirmed",cv.index_series_id AS "indexSeriesId",
              ix.name AS "indexSeriesName",ix.source AS "indexSeriesSource",ix.approved AS "indexSeriesApproved",
              pv.tax_mode AS "taxMode",pv.vat_rate::text AS "vatRate",
              pv.status,pv.immutable,pv.checksum,pv.created_at AS "createdAt",pv.updated_at AS "updatedAt",pv.released_at AS "releasedAt",
              p.project_number AS "projectNumber",p.name AS "projectName",p.client,p.route,p.kilometer,p.project_manager AS "projectManager",p.editor
       FROM project_versions pv JOIN projects p ON p.id=pv.project_id JOIN catalog_versions cv ON cv.id=pv.catalog_version_id
       LEFT JOIN index_series ix ON ix.id=cv.index_series_id
       WHERE pv.project_id=$1 AND pv.id=$2`, [projectId, versionId],
    );
    if (!result.rows[0]) throw new NotFoundError("Version not found");
    return result.rows[0];
  }

  async updateVersion(user: AuthUser, projectId: string, versionId: string, patch: Record<string, unknown>): Promise<Row> {
    if (!(["admin", "editor"] as UserRole[]).includes(user.role)) throw new ForbiddenError("Role may not edit");
    const before = await this.getVersion(user, projectId, versionId);
    if (before.immutable) throw new ImmutableError("Released version is immutable");
    const columns: Record<string, string> = {
      variantName: "variant_name", planningPhase: "planning_phase", estimateType: "estimate_type", priceYear: "price_year",
      priceQuarter: "price_quarter", catalogVersionId: "catalog_version_id", taxMode: "tax_mode", vatRate: "vat_rate", status: "status",
    };
    const changes = Object.entries(patch).filter(([key, value]) => key in columns && value !== undefined);
    if (changes.length) {
      const params = changes.map(([, value]) => value);
      params.push(versionId);
      await this.sql.query(
        `UPDATE project_versions SET ${changes.map(([key], index) => `${columns[key]}=$${index + 1}`).join(",")},updated_at=now()
         WHERE id=$${params.length}`, params,
      );
      await this.sql.query(`UPDATE projects SET updated_at=now() WHERE id=$1`, [projectId]);
      await this.audit(user.id, projectId, versionId, "project_version", versionId, "update", before, patch, String(patch.reason ?? "Version geändert"));
    }
    return this.getVersion(user, projectId, versionId);
  }

  async cloneVersion(user: AuthUser, projectId: string, sourceVersionId: string, variantName?: string, reason?: string): Promise<Row> {
    if (!(["admin", "editor"] as UserRole[]).includes(user.role)) throw new ForbiddenError("Role may not create versions");
    const source = await this.getVersion(user, projectId, sourceVersionId);
    const targetVariant = variantName?.trim() || String(source.variantName);
    const numberResult = await this.sql.query<Row>(
      `SELECT coalesce(max(version_number),0)::int+1 AS next FROM project_versions WHERE project_id=$1 AND variant_name=$2`,
      [projectId, targetVariant],
    );
    const targetVersionId = randomUUID();
    await this.sql.transaction(async () => {
      await this.sql.query(
        `INSERT INTO project_versions
         (id,project_id,version_number,variant_name,planning_phase,estimate_type,price_year,price_quarter,catalog_version_id,tax_mode,vat_rate,status,immutable,created_by)
         SELECT $1,project_id,$2,$3,planning_phase,estimate_type,price_year,price_quarter,catalog_version_id,tax_mode,vat_rate,'draft',false,$4
         FROM project_versions WHERE id=$5`,
        [targetVersionId, Number(numberResult.rows[0]?.next ?? 1), targetVariant, user.id, sourceVersionId],
      );
      const sourceLines = await this.sql.query<Row>(`SELECT * FROM estimate_lines WHERE project_version_id=$1 ORDER BY sequence`, [sourceVersionId]);
      const idMap = new Map<string, string>();
      for (const line of sourceLines.rows) idMap.set(String(line.id), randomUUID());
      for (const line of sourceLines.rows) {
        const newId = idMap.get(String(line.id))!;
        const mappedReference = line.reference_kind === "line" && line.reference_id ? (idMap.get(String(line.reference_id)) ?? line.reference_id) : line.reference_id;
        await this.sql.query(
          `INSERT INTO estimate_lines
           (id,project_version_id,sequence,catalog_item_id,catalog_snapshot,kgk_code,kgk_path,kgk_outline,position_id,designation,explanation,basis,
            quantity,unit,original_unit_price,indexed_unit_price,manual_unit_price,manual_price_source,manual_price_date,manual_price_reason,manual_price_editor,
            price_type,percent_rate,reference_kind,reference_id,factor,calculation_rule,calculation_parameters,calculation_formula,total,source,source_reference,
            review_note,review_note_status,own_note,usage_classification,planning_phase_allowed,negative_confirmed,negative_reason,work_status)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`,
          [newId, targetVersionId, line.sequence, line.catalog_item_id, line.catalog_snapshot ? JSON.stringify(line.catalog_snapshot) : null,
            line.kgk_code, line.kgk_path, line.kgk_outline, line.position_id, line.designation, line.explanation, line.basis, line.quantity, line.unit,
            line.original_unit_price, line.indexed_unit_price, line.manual_unit_price, line.manual_price_source, line.manual_price_date,
            line.manual_price_reason, line.manual_price_editor, line.price_type, line.percent_rate, line.reference_kind, mappedReference, line.factor,
            line.calculation_rule, line.calculation_parameters ? JSON.stringify(line.calculation_parameters) : null, line.calculation_formula, line.total,
            line.source, line.source_reference, line.review_note, line.review_note_status, line.own_note, line.usage_classification,
            line.planning_phase_allowed, line.negative_confirmed, line.negative_reason, line.work_status],
        );
      }
      await this.audit(user.id, projectId, targetVersionId, "project_version", targetVersionId, "clone", source, { sourceVersionId, variantName: targetVariant }, reason ?? "Neue bearbeitbare Version erzeugt");
    });
    return this.getVersion(user, projectId, targetVersionId);
  }

  async listLines(user: AuthUser, projectId: string, versionId: string): Promise<Row[]> {
    await this.getVersion(user, projectId, versionId);
    const result = await this.sql.query<Row>(`${LINE_SELECT} WHERE el.project_version_id=$1 ORDER BY el.sequence`, [versionId]);
    return result.rows;
  }

  async listKgkNodes(user: AuthUser, projectId: string, versionId: string): Promise<Row[]> {
    await this.getVersion(user, projectId, versionId);
    const result = await this.sql.query<Row>(
      `SELECT kn.code,kn.label,kn.path,kn.level
       FROM kgk_nodes kn
       JOIN project_versions pv ON pv.catalog_version_id=kn.catalog_version_id
       WHERE pv.id=$1
       ORDER BY kn.level,kn.code`, [versionId],
    );
    return result.rows;
  }

  async addLine(user: AuthUser, projectId: string, versionId: string, input: Record<string, unknown>): Promise<Row> {
    await this.ensureEditable(user, projectId, versionId);
    const id = randomUUID();
    const nextSequence = input.sequence ?? (await this.nextSequence(versionId));
    await this.sql.query(
      `INSERT INTO estimate_lines
       (id,project_version_id,sequence,kgk_code,kgk_path,kgk_outline,position_id,designation,explanation,basis,quantity,unit,
        original_unit_price,indexed_unit_price,manual_unit_price,manual_price_source,manual_price_date,manual_price_reason,manual_price_editor,
        price_type,percent_rate,reference_kind,reference_id,factor,calculation_rule,calculation_parameters,source,source_reference,review_note,
        review_note_status,own_note,usage_classification,planning_phase_allowed,negative_confirmed,negative_reason,work_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36)`,
      [id, versionId, nextSequence, input.kgkCode, input.kgkPath ?? null, input.kgkOutline ?? null, input.positionId ?? null,
        input.designation, input.explanation ?? null, input.basis ?? null, input.quantity ?? null, input.unit ?? null,
        input.originalUnitPrice ?? null, input.indexedUnitPrice ?? null, input.manualUnitPrice ?? null, input.manualPriceSource ?? null,
        input.manualPriceDate ?? null, input.manualPriceReason ?? null, input.manualPriceEditor ?? null, input.priceType ?? "unit",
        input.percentRate ?? null, input.referenceKind ?? null, input.referenceId ?? null, input.factor ?? 1, input.calculationRule ?? null,
        JSON.stringify(input.calculationParameters ?? null), input.source ?? null, input.sourceReference ?? null, input.reviewNote ?? null,
        input.reviewNoteStatus ?? "open", input.ownNote ?? null, input.usageClassification ?? "review_required",
        input.planningPhaseAllowed ?? null, input.negativeConfirmed ?? false, input.negativeReason ?? null, input.workStatus ?? "open"],
    );
    await this.recomputeVersion(versionId);
    const row = await this.getLine(versionId, id);
    await this.audit(user.id, projectId, versionId, "estimate_line", id, "create", null, row, "Position hinzugefügt");
    return row;
  }

  async addCatalogLines(user: AuthUser, projectId: string, versionId: string, catalogItemIds: string[]): Promise<Row[]> {
    await this.ensureEditable(user, projectId, versionId);
    const version = await this.getVersion(user, projectId, versionId);
    const usesStoredQ32026 = Number(version.priceYear) === 2026 && Number(version.priceQuarter) === 3;
    let configuredTargetIndex: string | null = null;
    let configuredIndexReference: string | null = null;
    if (!usesStoredQ32026 && version.indexSeriesId && version.indexSeriesConfirmed && version.indexSeriesApproved) {
      const target = await this.sql.query<Row>(
        `SELECT value::text,source_reference AS "sourceReference"
         FROM index_values WHERE series_id=$1 AND year=$2 AND quarter=$3`,
        [version.indexSeriesId, version.priceYear, version.priceQuarter],
      );
      configuredTargetIndex = target.rows[0]?.value ? String(target.rows[0].value) : null;
      configuredIndexReference = target.rows[0]?.sourceReference ? String(target.rows[0].sourceReference) : null;
    }
    const result: Row[] = [];
    for (const catalogItemId of catalogItemIds) {
      const itemResult = await this.sql.query<Row>(
        `SELECT * FROM price_items WHERE id=$1 AND catalog_version_id=$2`, [catalogItemId, version.catalogVersionId],
      );
      const item = itemResult.rows[0];
      if (!item) throw new NotFoundError(`Catalog item ${catalogItemId} not found in selected catalog`);
      const id = randomUUID();
      const sequence = await this.nextSequence(versionId);
      const priceType = mapPriceType(String(item.price_type_raw ?? ""));
      let indexedUnitPrice: unknown = item.price_q3_2026;
      let targetIndex: unknown = item.target_index;
      let escalationFactor: unknown = item.escalation_factor;
      if (!usesStoredQ32026) {
        indexedUnitPrice = null;
        targetIndex = configuredTargetIndex;
        escalationFactor = null;
        if (configuredTargetIndex && item.base_price !== null && item.base_price !== undefined && item.base_index) {
          const factor = new Decimal(configuredTargetIndex).div(String(item.base_index));
          escalationFactor = factor.toDecimalPlaces(10, Decimal.ROUND_HALF_UP).toString();
          indexedUnitPrice = new Decimal(String(item.base_price)).mul(factor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
        }
      }
      const phaseMatch = String(version.planningPhase ?? "").match(/(?:LPH\s*)?(\d+)/i);
      const phase = phaseMatch?.[1] ? Number(phaseMatch[1]) : null;
      const allowedFrom = item.allowed_from_lph === null || item.allowed_from_lph === undefined ? null : Number(item.allowed_from_lph);
      const allowedTo = item.allowed_to_lph === null || item.allowed_to_lph === undefined ? null : Number(item.allowed_to_lph);
      const planningPhaseAllowed = phase === null || item.usage_classification === "review_required"
        ? null
        : (allowedFrom === null || phase >= allowedFrom) && (allowedTo === null || phase <= allowedTo);
      const snapshot = {
        ...item,
        selected_period: `Q${version.priceQuarter} ${version.priceYear}`,
        target_index: targetIndex,
        escalation_factor: escalationFactor,
        index_source: usesStoredQ32026 ? item.index_source : version.indexSeriesSource,
        index_series: usesStoredQ32026 ? item.index_series : version.indexSeriesName,
        index_source_reference: usesStoredQ32026 ? item.source_reference : configuredIndexReference,
      };
      await this.sql.query(
        `INSERT INTO estimate_lines
         (id,project_version_id,sequence,catalog_item_id,catalog_snapshot,kgk_code,kgk_path,kgk_outline,position_id,designation,explanation,basis,
          quantity,unit,original_unit_price,indexed_unit_price,price_type,percent_rate,factor,source,source_reference,review_note,usage_classification,planning_phase_allowed)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,NULL,$13,$14,$15,$16,$17,1,$18,$19,$20,$21,$22)`,
        [id, versionId, sequence, catalogItemId, JSON.stringify(snapshot), item.kgk_code, item.kgk_path, item.kgk_outline,
          item.position_id, item.designation, item.explanation, item.basis, item.unit, item.base_price, indexedUnitPrice,
          priceType, item.percent_rate, item.source, item.source_reference, item.review_note, item.usage_classification, planningPhaseAllowed],
      );
      result.push(await this.getLine(versionId, id));
    }
    await this.recomputeVersion(versionId);
    await this.audit(user.id, projectId, versionId, "project_version", versionId, "catalog_add", null, { catalogItemIds }, "Katalogpositionen übernommen");
    return this.listLines(user, projectId, versionId);
  }

  async updateLine(user: AuthUser, projectId: string, versionId: string, lineId: string, patch: Record<string, unknown>): Promise<Row> {
    await this.ensureEditable(user, projectId, versionId);
    const before = await this.getLine(versionId, lineId);
    const snapshot = (before.catalogSnapshot && typeof before.catalogSnapshot === "object" ? before.catalogSnapshot : {}) as Record<string, unknown>;
    const snapshotUnit = snapshot.unit;
    if (before.usageClassification === "kkk" && patch.unit !== undefined && snapshotUnit && patch.unit !== snapshotUnit) {
      throw new ImmutableError("Kostenschätzungs-Einheit eines KKK-Kennwerts ist unveränderbar");
    }
    const columns: Record<string, string> = {
      sequence: "sequence", kgkCode: "kgk_code", kgkPath: "kgk_path", kgkOutline: "kgk_outline", positionId: "position_id",
      designation: "designation", explanation: "explanation", basis: "basis", quantity: "quantity", unit: "unit",
      originalUnitPrice: "original_unit_price", indexedUnitPrice: "indexed_unit_price", manualUnitPrice: "manual_unit_price",
      manualPriceSource: "manual_price_source", manualPriceDate: "manual_price_date", manualPriceReason: "manual_price_reason",
      manualPriceEditor: "manual_price_editor", priceType: "price_type", percentRate: "percent_rate", referenceKind: "reference_kind",
      referenceId: "reference_id", factor: "factor", calculationRule: "calculation_rule", calculationParameters: "calculation_parameters",
      source: "source", sourceReference: "source_reference", reviewNote: "review_note", reviewNoteStatus: "review_note_status",
      ownNote: "own_note", usageClassification: "usage_classification", planningPhaseAllowed: "planning_phase_allowed",
      negativeConfirmed: "negative_confirmed", negativeReason: "negative_reason", workStatus: "work_status",
    };
    const changes = Object.entries(patch).filter(([key, value]) => key in columns && value !== undefined);
    if (changes.length) {
      const params = changes.map(([key, value]) => key === "calculationParameters" ? JSON.stringify(value) : value);
      params.push(lineId, versionId);
      await this.sql.query(
        `UPDATE estimate_lines SET ${changes.map(([key], index) => `${columns[key]}=$${index + 1}${key === "calculationParameters" ? "::jsonb" : ""}`).join(",")},updated_at=now()
         WHERE id=$${params.length - 1} AND project_version_id=$${params.length}`, params,
      );
      await this.recomputeVersion(versionId);
      await this.audit(user.id, projectId, versionId, "estimate_line", lineId, "update", before, patch, String(patch.reason ?? "Position geändert"));
    }
    return this.getLine(versionId, lineId);
  }

  async deleteLine(user: AuthUser, projectId: string, versionId: string, lineId: string, reason?: string): Promise<void> {
    await this.ensureEditable(user, projectId, versionId);
    const before = await this.getLine(versionId, lineId);
    await this.sql.query(`DELETE FROM estimate_lines WHERE id=$1 AND project_version_id=$2`, [lineId, versionId]);
    await this.recomputeVersion(versionId);
    await this.audit(user.id, projectId, versionId, "estimate_line", lineId, "delete", before, null, reason ?? "Position entfernt");
  }

  async copyLine(user: AuthUser, projectId: string, versionId: string, lineId: string): Promise<Row> {
    await this.ensureEditable(user, projectId, versionId);
    const source = await this.getLine(versionId, lineId);
    return this.addLine(user, projectId, versionId, {
      ...source,
      sequence: await this.nextSequence(versionId),
      designation: `${String(source.designation)} (Kopie)`,
    });
  }

  async reorderLines(user: AuthUser, projectId: string, versionId: string, lineIds: string[]): Promise<void> {
    await this.ensureEditable(user, projectId, versionId);
    const existing = await this.sql.query<Row>(`SELECT id FROM estimate_lines WHERE project_version_id=$1 ORDER BY sequence`, [versionId]);
    const existingIds = existing.rows.map((row) => String(row.id));
    if (lineIds.length !== existingIds.length || new Set(lineIds).size !== lineIds.length || existingIds.some((id) => !lineIds.includes(id))) {
      throw new Error("Reorder must contain every line exactly once");
    }
    await this.sql.transaction(async () => {
      await this.sql.query(`UPDATE estimate_lines SET sequence=-sequence WHERE project_version_id=$1`, [versionId]);
      for (const [index, id] of lineIds.entries()) await this.sql.query(`UPDATE estimate_lines SET sequence=$1,updated_at=now() WHERE id=$2`, [index + 1, id]);
      await this.audit(user.id, projectId, versionId, "project_version", versionId, "reorder", existingIds, lineIds, "Positionen neu sortiert");
    });
  }

  async searchCatalog(user: AuthUser, filters: Record<string, string | undefined>): Promise<{ items: Row[]; total: number; page: number; pageSize: number }> {
    void user;
    const params: unknown[] = [];
    const conditions = ["1=1"];
    if (filters.catalogVersionId) { params.push(filters.catalogVersionId); conditions.push(`pi.catalog_version_id=$${params.length}`); }
    if (filters.q) {
      params.push(filters.q.trim());
      const queryParameter = params.length;
      params.push(`%${filters.q.trim()}%`);
      conditions.push(`(
        to_tsvector('simple',
          coalesce(pi.dataset_id,'')||' '||coalesce(pi.position_id,'')||' '||coalesce(pi.kgk_code,'')||' '||
          coalesce(pi.kgk_label,'')||' '||coalesce(pi.kgk_path,'')||' '||coalesce(pi.designation,'')||' '||
          coalesce(pi.explanation,'')||' '||coalesce(pi.basis,'')||' '||coalesce(pi.source,'')||' '||
          coalesce(pi.source_reference,'')||' '||coalesce(pi.raw_snapshot->>'EPK_Quellcodes','')
        ) @@ plainto_tsquery('simple',$${queryParameter})
        OR pi.dataset_id ILIKE $${params.length} OR pi.position_id ILIKE $${params.length}
        OR pi.kgk_code ILIKE $${params.length} OR pi.kgk_path ILIKE $${params.length}
        OR pi.source ILIKE $${params.length} OR pi.source_reference ILIKE $${params.length}
      )`);
    }
    if (filters.kgk) { params.push(`${filters.kgk}%`); conditions.push(`pi.kgk_code LIKE $${params.length}`); }
    if (filters.unit) { params.push(filters.unit); conditions.push(`pi.unit=$${params.length}`); }
    if (filters.priceType) { params.push(filters.priceType); conditions.push(`pi.price_type_raw=$${params.length}`); }
    if (filters.source) { params.push(`%${filters.source}%`); conditions.push(`pi.source ILIKE $${params.length}`); }
    if (filters.usageClassification) { params.push(filters.usageClassification); conditions.push(`pi.usage_classification=$${params.length}`); }
    if (filters.planningPhase) {
      params.push(Number(filters.planningPhase));
      conditions.push(`pi.usage_classification<>'review_required' AND (pi.allowed_from_lph IS NULL OR pi.allowed_from_lph<=$${params.length}) AND (pi.allowed_to_lph IS NULL OR pi.allowed_to_lph>=$${params.length})`);
    }
    if (filters.hasReviewNote === "true") conditions.push(`nullif(trim(pi.review_note),'') IS NOT NULL`);
    if (filters.withoutReviewNote === "true") conditions.push(`nullif(trim(pi.review_note),'') IS NULL`);
    const page = Math.max(Number(filters.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(filters.pageSize ?? filters.limit) || 50, 1), 200);
    const count = await this.sql.query<Row>(`SELECT count(*)::int AS total FROM price_items pi WHERE ${conditions.join(" AND ")}`, params);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await this.sql.query<Row>(
      `SELECT pi.id,pi.catalog_version_id AS "catalogVersionId",pi.dataset_id AS "datasetId",pi.position_id AS "positionId",
              pi.kgk_code AS "kgkCode",pi.kgk_path AS "kgkPath",pi.designation,pi.explanation,pi.basis,pi.unit,
              pi.price_type_raw AS "priceType",pi.price_q3_2026::text AS "price",pi.percent_rate::text AS "percentRate",
              pi.source,pi.source_reference AS "sourceReference",pi.review_note AS "reviewNote",pi.usage_classification AS "usageClassification",
              pi.allowed_from_lph AS "allowedFromLph",pi.allowed_to_lph AS "allowedToLph",
              cv.name AS "catalogVersionName"
       FROM price_items pi JOIN catalog_versions cv ON cv.id=pi.catalog_version_id
       WHERE ${conditions.join(" AND ")} ORDER BY pi.kgk_code,pi.designation LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
    return { items: result.rows, total: Number(count.rows[0]?.total ?? 0), page, pageSize };
  }

  async validateVersion(user: AuthUser, projectId: string, versionId: string): Promise<{ issues: ValidationIssue[]; totals: Row }> {
    const version = await this.getVersion(user, projectId, versionId);
    const lines = await this.listLines(user, projectId, versionId);
    const projectComplete = Boolean(version.projectNumber && version.projectName && version.client && version.projectManager && version.planningPhase && version.estimateType);
    const issues = validateEstimate(lines as unknown as EstimateLineInput[], projectComplete);
    const phaseMatch = String(version.planningPhase ?? "").match(/(?:LPH\s*)?(\d+)/i);
    const phaseNumber = phaseMatch?.[1] ? Number(phaseMatch[1]) : null;
    const unitRegistry = await this.sql.query<Row>(`SELECT unit,approved FROM unit_registry`);
    const approvedUnits = new Set(unitRegistry.rows.filter((entry) => entry.approved).map((entry) => String(entry.unit)));
    const ruleRegistry = await this.sql.query<Row>(`SELECT code FROM calculation_rules WHERE approved=true`);
    const approvedRules = new Set(ruleRegistry.rows.map((entry) => String(entry.code)));
    for (const line of lines) {
      if (unitRegistry.rows.length && line.unit && !approvedUnits.has(String(line.unit))) {
        issues.push({ severity: "blocking", code: "UNIT_NOT_APPROVED", message: `Die Einheit ${String(line.unit)} ist im Einheitenregister noch nicht fachlich freigegeben.`, lineId: String(line.id), field: "unit" });
      }
      if (line.priceType === "parameter" && line.calculationRule && !approvedRules.has(String(line.calculationRule))) {
        issues.push({ severity: "blocking", code: "CALCULATION_RULE_NOT_ADMIN_APPROVED", message: "Die verwendete Berechnungsregel ist im administrativen Regelregister nicht freigegeben.", lineId: String(line.id), field: "calculationRule" });
      }
      if (line.usageClassification === "kkk" && phaseNumber !== null && phaseNumber >= 3) {
        issues.push({ severity: "blocking", code: "KKK_NOT_ALLOWED_FROM_LPH3", message: "Kostenkennwerte des KKK sind ab Kostenberechnung/LPH 3 nicht zulässig.", lineId: String(line.id) });
      }
      if (line.usageClassification === "kkk" && line.catalogSnapshot && typeof line.catalogSnapshot === "object") {
        const snapshotUnit = (line.catalogSnapshot as Record<string, unknown>).unit;
        if (snapshotUnit && line.unit !== snapshotUnit) {
          issues.push({ severity: "blocking", code: "KKK_UNIT_CHANGED", message: "Die Kostenschätzungs-Einheit des KKK-Kennwerts darf nicht verändert werden.", lineId: String(line.id), field: "unit" });
        }
      }
    }
    if (!version.indexSeriesConfirmed) {
      const unresolvedIndexConflict = await this.sql.query<Row>(
        `SELECT 1 FROM catalog_import_issues WHERE catalog_version_id=$1 AND code IN ('SOURCE_INDEX_CONFLICT','INDEX_SERIES_CONFLICT') LIMIT 1`,
        [version.catalogVersionId],
      );
      if (unresolvedIndexConflict.rows[0]) {
        issues.push({ severity: "blocking", code: "CATALOG_INDEX_DECISION_REQUIRED", message: "Die für diese Katalogversion maßgebliche Indexreihe wurde wegen widersprüchlicher Quellen noch nicht administrativ bestätigt." });
      }
    }
    if (Number(version.priceYear) !== 2026 || Number(version.priceQuarter) !== 3) {
      const targetIndex = version.indexSeriesId && version.indexSeriesConfirmed && version.indexSeriesApproved
        ? await this.sql.query<Row>(`SELECT value FROM index_values WHERE series_id=$1 AND year=$2 AND quarter=$3`, [version.indexSeriesId, version.priceYear, version.priceQuarter])
        : { rows: [] as Row[], rowCount: 0 };
      if (!targetIndex.rows[0]) {
        issues.push({ severity: "blocking", code: "TARGET_INDEX_UNCONFIRMED", message: "Für den Zielpreisstand fehlt eine ausgewählte, freigegebene Indexreihe mit konkretem Zielindex." });
      }
    }
    const totals = calculateTotals(lines, String(version.vatRate ?? "19"));
    return { issues: dedupeIssues(issues), totals };
  }

  async releaseVersion(user: AuthUser, projectId: string, versionId: string, note?: string): Promise<Row> {
    if (!(["admin", "reviewer"] as UserRole[]).includes(user.role)) throw new ForbiddenError("Only reviewers may release");
    const version = await this.getVersion(user, projectId, versionId);
    if (version.immutable) return version;
    const validation = await this.validateVersion(user, projectId, versionId);
    const blocking = validation.issues.filter((item) => item.severity === "blocking");
    if (blocking.length) {
      const error = new Error("Version contains blocking validation issues") as Error & { issues?: ValidationIssue[] };
      error.issues = blocking;
      throw error;
    }
    const lines = await this.listLines(user, projectId, versionId);
    const checksum = createHash("sha256").update(JSON.stringify({ version, lines, totals: validation.totals })).digest("hex");
    await this.sql.query(
      `UPDATE project_versions SET status='released',immutable=true,checksum=$1,released_by=$2,released_at=now(),updated_at=now() WHERE id=$3`,
      [checksum, user.id, versionId],
    );
    await this.audit(user.id, projectId, versionId, "project_version", versionId, "release", version, { checksum, totals: validation.totals }, note?.trim() || "Fachlich freigegeben");
    return this.getVersion(user, projectId, versionId);
  }

  async adminOverview(user: AuthUser): Promise<Row> {
    if (user.role !== "admin") throw new ForbiddenError("Admin only");
    const counts = await this.sql.query<Row>(
      `SELECT (SELECT count(*) FROM users WHERE active)::int AS "activeUsers",
              (SELECT count(*) FROM catalog_import_issues WHERE severity='blocking')::int AS "openConflicts",
              (SELECT count(*) FROM estimate_lines WHERE price_type='parameter' AND calculation_rule IS NULL)::int AS "pendingRules",
              (SELECT count(*) FROM unit_registry WHERE approved=true)::int AS "approvedUnits"`,
    );
    const audit = await this.sql.query<Row>(
      `SELECT al.id,coalesce(u.display_name,'System') AS "user",al.action,al.entity_type AS entity,al.created_at AS at
       FROM audit_log al LEFT JOIN users u ON u.id=al.actor_user_id ORDER BY al.created_at DESC LIMIT 10`,
    );
    return { ...(counts.rows[0] ?? {}), catalogVersions: await this.listCatalogVersions(user), recentAudit: audit.rows };
  }

  async listCatalogVersions(user: AuthUser): Promise<Row[]> {
    if (user.role !== "admin") throw new ForbiddenError("Admin only");
    const result = await this.sql.query<Row>(
      `SELECT cv.id,cv.name,cv.year,cv.quarter,cv.source_file_name AS "sourceFileName",cv.source_file_sha256 AS "sourceFileSha256",
              cv.record_count AS "recordCount",cv.kgk_code_count AS "kgkCount",cv.review_note_count AS "reviewNoteCount",
              cv.status,cv.index_series_id AS "indexSeriesId",cv.index_series_confirmed AS "indexSeriesConfirmed",cv.import_summary AS "importSummary",cv.imported_at AS "importedAt",
              cv.source_file_sha256 AS "fileSha256",count(cio.id)::int AS "issueCount",
              jsonb_build_object('schema',count(*) FILTER (WHERE cio.code='SCHEMA_CONFLICT'),'blocking',count(*) FILTER (WHERE cio.severity='blocking')) AS "issueCounts"
       FROM catalog_versions cv LEFT JOIN catalog_import_issues cio ON cio.catalog_version_id=cv.id
       GROUP BY cv.id ORDER BY cv.imported_at DESC`,
    );
    return result.rows;
  }

  async getCatalogImportReport(user: AuthUser, catalogVersionId: string): Promise<Row> {
    if (user.role !== "admin") throw new ForbiddenError("Admin only");
    const version = await this.sql.query<Row>(
      `SELECT id,name,year,quarter,source_file_name AS "sourceFileName",source_file_sha256 AS "fileSha256",
              record_count AS "recordCount",kgk_code_count AS "kgkCount",review_note_count AS "reviewNoteCount",
              index_series_confirmed AS "indexSeriesConfirmed",import_summary AS "importSummary",imported_at AS "importedAt"
       FROM catalog_versions WHERE id=$1`, [catalogVersionId],
    );
    if (!version.rows[0]) throw new NotFoundError("Catalog version not found");
    const issues = await this.sql.query<Row>(
      `SELECT severity,code,record_key AS "recordKey",message,details,created_at AS "createdAt"
       FROM catalog_import_issues WHERE catalog_version_id=$1 ORDER BY severity DESC,code`, [catalogVersionId],
    );
    return { ...version.rows[0], issues: issues.rows };
  }

  private async ensureEditable(user: AuthUser, projectId: string, versionId: string): Promise<void> {
    if (!(["admin", "editor"] as UserRole[]).includes(user.role)) throw new ForbiddenError("Role may not edit");
    const version = await this.getVersion(user, projectId, versionId);
    if (version.immutable || version.status === "released" || version.status === "archived") throw new ImmutableError("Released version is immutable");
  }

  private async nextSequence(versionId: string): Promise<number> {
    const result = await this.sql.query<Row>(`SELECT coalesce(max(sequence),0)::int+1 AS next FROM estimate_lines WHERE project_version_id=$1`, [versionId]);
    return Number(result.rows[0]?.next ?? 1);
  }

  private async getLine(versionId: string, lineId: string): Promise<Row> {
    const result = await this.sql.query<Row>(`${LINE_SELECT} WHERE el.project_version_id=$1 AND el.id=$2`, [versionId, lineId]);
    if (!result.rows[0]) throw new NotFoundError("Line not found");
    return result.rows[0];
  }

  private async recomputeVersion(versionId: string): Promise<void> {
    const result = await this.sql.query<Row>(`${LINE_SELECT} WHERE el.project_version_id=$1 ORDER BY el.sequence`, [versionId]);
    const lines = result.rows as unknown as EstimateLineInput[];
    const totals = new Map<string, string>();
    for (const line of lines.filter((candidate) => candidate.priceType !== "percentage")) {
      const calculation = calculateLine(line);
      if (line.id) totals.set(line.id, calculation.total ?? "0");
      await this.sql.query(`UPDATE estimate_lines SET total=$1,calculation_formula=$2 WHERE id=$3`, [calculation.total, calculation.formula, line.id]);
    }
    for (const line of lines.filter((candidate) => candidate.priceType === "percentage")) {
      let reference: string | null = null;
      if (line.referenceKind === "line" && line.referenceId) reference = totals.get(line.referenceId) ?? null;
      if (line.referenceKind === "kgk" && line.referenceId) {
        reference = lines.reduce((sum, candidate) => {
          if (candidate.id && candidate.kgkCode.startsWith(line.referenceId!) && candidate.id !== line.id) return sum.add(totals.get(candidate.id) ?? 0);
          return sum;
        }, new Decimal(0)).toFixed(2);
      }
      const calculation = calculateLine(line, reference);
      if (line.id && calculation.total) totals.set(line.id, calculation.total);
      await this.sql.query(`UPDATE estimate_lines SET total=$1,calculation_formula=$2 WHERE id=$3`, [calculation.total, calculation.formula, line.id]);
    }
    await this.sql.query(`UPDATE project_versions SET updated_at=now() WHERE id=$1`, [versionId]);
  }

  private async audit(
    actorUserId: string, projectId: string | null, projectVersionId: string | null, entityType: string,
    entityId: string, action: string, oldValue: unknown, newValue: unknown, reason: string,
  ): Promise<void> {
    await this.sql.query(
      `INSERT INTO audit_log (id,actor_user_id,project_id,project_version_id,entity_type,entity_id,action,old_value,new_value,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
      [randomUUID(), actorUserId, projectId, projectVersionId, entityType, entityId, action,
        oldValue === null ? null : JSON.stringify(oldValue), newValue === null ? null : JSON.stringify(newValue), reason],
    );
  }
}

export const LINE_SELECT = `SELECT el.id,el.project_version_id AS "projectVersionId",el.sequence,el.catalog_item_id AS "catalogItemId",
  el.catalog_snapshot AS "catalogSnapshot",el.kgk_code AS "kgkCode",el.kgk_path AS "kgkPath",el.kgk_outline AS "kgkOutline",
  el.position_id AS "positionId",el.designation,el.explanation,el.basis,el.quantity::text,el.unit,
  el.original_unit_price::text AS "originalUnitPrice",el.indexed_unit_price::text AS "indexedUnitPrice",
  el.manual_unit_price::text AS "manualUnitPrice",el.manual_price_source AS "manualPriceSource",el.manual_price_date AS "manualPriceDate",
  el.manual_price_reason AS "manualPriceReason",el.manual_price_editor AS "manualPriceEditor",el.price_type AS "priceType",
  el.percent_rate::text AS "percentRate",el.reference_kind AS "referenceKind",el.reference_id AS "referenceId",el.factor::text,
  el.calculation_rule AS "calculationRule",el.calculation_parameters AS "calculationParameters",el.calculation_formula AS "calculationFormula",
  el.total::text,el.source,el.source_reference AS "sourceReference",el.review_note AS "reviewNote",
  el.review_note_status AS "reviewNoteStatus",el.own_note AS "ownNote",el.usage_classification AS "usageClassification",
  el.planning_phase_allowed AS "planningPhaseAllowed",el.negative_confirmed AS "negativeConfirmed",el.negative_reason AS "negativeReason",
  el.work_status AS "workStatus",el.created_at AS "createdAt",el.updated_at AS "updatedAt" FROM estimate_lines el`;

export function calculateTotals(lines: Row[], vatRate: string): Row {
  const net = lines.reduce((sum, line) => line.total === null ? sum : sum.add(String(line.total)), new Decimal(0));
  const vat = net.mul(vatRate || 0).div(100);
  return {
    net: money(net), vat: money(vat), gross: money(net.add(vat)),
    kgk: rollupKgk(lines.map((line) => ({ kgkCode: String(line.kgkCode ?? ""), total: line.total as string | null }))),
  };
}

export function buildVersionComparison(
  fromVersion: Row,
  toVersion: Row,
  fromLines: Row[],
  toLines: Row[],
  fromTotals: Row = calculateTotals(fromLines, String(fromVersion.vatRate ?? "19")),
  toTotals: Row = calculateTotals(toLines, String(toVersion.vatRate ?? "19")),
): Row {
  const buckets = new Map<string, Row[]>();
  for (const line of fromLines) {
    const key = comparisonLineKey(line);
    buckets.set(key, [...(buckets.get(key) ?? []), line]);
  }
  const changes: Row[] = [];
  const matchedFromIds = new Set<string>();
  for (const current of toLines) {
    const candidates = buckets.get(comparisonLineKey(current)) ?? [];
    const previous = candidates.shift();
    if (!previous) {
      changes.push(comparisonChange("added", null, current, comparisonFields(null, current)));
      continue;
    }
    matchedFromIds.add(String(previous.id));
    const fields = comparisonFields(previous, current);
    changes.push(comparisonChange(fields.length ? "modified" : "unchanged", previous, current, fields));
  }
  for (const previous of fromLines) {
    if (!matchedFromIds.has(String(previous.id))) {
      changes.push(comparisonChange("removed", previous, null, comparisonFields(previous, null)));
    }
  }
  const fromNet = new Decimal(String(fromTotals.net ?? 0));
  const toNet = new Decimal(String(toTotals.net ?? 0));
  const delta = toNet.minus(fromNet);
  return {
    from: versionComparisonSummary(fromVersion, fromTotals),
    to: versionComparisonSummary(toVersion, toTotals),
    totals: {
      fromNet: money(fromNet),
      toNet: money(toNet),
      absoluteDelta: money(delta),
      percentageDelta: fromNet.isZero() ? null : delta.div(fromNet).mul(100).toDecimalPlaces(2).toString(),
    },
    counts: {
      added: changes.filter((change) => change.type === "added").length,
      removed: changes.filter((change) => change.type === "removed").length,
      modified: changes.filter((change) => change.type === "modified").length,
      unchanged: changes.filter((change) => change.type === "unchanged").length,
    },
    changes: changes.sort((left, right) => comparisonSequence(left) - comparisonSequence(right)),
  };
}

function comparisonLineKey(line: Row): string {
  if (line.catalogItemId) return `catalog:${line.catalogItemId}`;
  if (line.positionId) return `position:${line.positionId}:${line.kgkCode ?? ""}`;
  return `manual:${line.kgkCode ?? ""}:${String(line.designation ?? "").trim().toLocaleLowerCase("de-DE")}`;
}

function comparisonFields(previous: Row | null, current: Row | null): string[] {
  if (!previous || !current) return ["position"];
  const fields: Array<[string, string]> = [
    ["kgk", "kgkCode"], ["Bezeichnung", "designation"], ["Menge", "quantity"], ["Einheit", "unit"],
    ["Einheitspreis", "appliedUnitPrice"], ["Preisart", "priceType"], ["Faktor", "factor"],
    ["Prozentansatz", "percentRate"], ["Bezugsbasis", "referenceId"], ["Gesamtpreis", "total"],
  ];
  const normalized = (line: Row, key: string) => key === "appliedUnitPrice"
    ? line.manualUnitPrice ?? line.indexedUnitPrice ?? line.originalUnitPrice ?? null
    : line[key] ?? null;
  return fields
    .filter(([, key], index) => fields.findIndex((entry) => entry[1] === key) === index)
    .filter(([, key]) => String(normalized(previous, key) ?? "") !== String(normalized(current, key) ?? ""))
    .map(([label]) => label);
}

function comparisonSequence(change: Row): number {
  const line = (change.after ?? change.before) as Row | null | undefined;
  return Number(line?.sequence ?? 0);
}

function comparisonChange(type: string, previous: Row | null, current: Row | null, fields: string[]): Row {
  const before = previous ? comparisonLineSummary(previous) : null;
  const after = current ? comparisonLineSummary(current) : null;
  const beforeTotal = new Decimal(String(previous?.total ?? 0));
  const afterTotal = new Decimal(String(current?.total ?? 0));
  const delta = afterTotal.minus(beforeTotal);
  return {
    key: `${comparisonLineKey(current ?? previous ?? {})}:${previous?.id ?? "new"}:${current?.id ?? "removed"}`,
    type,
    fields,
    before,
    after,
    absoluteDelta: money(delta),
    percentageDelta: beforeTotal.isZero() ? null : delta.div(beforeTotal).mul(100).toDecimalPlaces(2).toString(),
  };
}

function comparisonLineSummary(line: Row): Row {
  return {
    id: line.id,
    sequence: Number(line.sequence),
    kgkCode: line.kgkCode,
    designation: line.designation,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.manualUnitPrice ?? line.indexedUnitPrice ?? line.originalUnitPrice ?? null,
    priceType: line.priceType,
    factor: line.factor,
    percentRate: line.percentRate,
    total: line.total,
  };
}

function versionComparisonSummary(version: Row, totals: Row): Row {
  return {
    id: version.id,
    number: Number(version.versionNumber ?? version.number),
    variantName: version.variantName,
    status: version.status,
    priceYear: Number(version.priceYear),
    priceQuarter: Number(version.priceQuarter),
    updatedAt: version.updatedAt,
    total: totals.net,
  };
}

function mapPriceType(raw: string): EstimateLineInput["priceType"] {
  if (raw === "Prozentansatz") return "percentage";
  if (raw === "Zuschlag EUR") return "surcharge";
  if (raw === "Berechnungsregel") return "parameter";
  return "unit";
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.lineId ?? ""}:${issue.field ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
