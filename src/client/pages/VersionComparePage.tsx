import { ArrowLeft, ArrowRight, Check, CirclePlus, GitCompareArrows, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { CloneVersionButton } from "../components/CloneVersionButton";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, api, type EstimatePayload, type ProjectVersionSummary, type VersionComparison } from "../lib/api";
import { formatCents, formatDate, formatMoney, formatNumber } from "../lib/format";

const changeLabels = { added: "Hinzugefügt", removed: "Entfernt", modified: "Geändert", unchanged: "Unverändert" } as const;

export function VersionComparePage() {
  const { projectId = "", versionId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [estimate, setEstimate] = useState<EstimatePayload | null>(null);
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([]);
  const [baseVersionId, setBaseVersionId] = useState("");
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.estimate(projectId, versionId), api.versions(projectId)])
      .then(([estimateResult, versionsResult]) => {
        setEstimate(estimateResult);
        setVersions(versionsResult.versions);
        const candidates = versionsResult.versions.filter((item) => item.id !== versionId);
        const previous = candidates.find((item) => item.variantName === estimateResult.version.variantName && item.number < estimateResult.version.number) ?? candidates[0];
        setBaseVersionId(previous?.id ?? "");
      })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Die Versionen konnten nicht geladen werden."));
  }, [projectId, versionId]);

  useEffect(() => {
    if (!baseVersionId) { setComparison(null); return; }
    setComparison(null);
    api.compareVersions(projectId, versionId, baseVersionId)
      .then((result) => { setComparison(result.comparison); setError(""); })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Der Vergleich konnte nicht erstellt werden."));
  }, [projectId, versionId, baseVersionId]);

  const visibleChanges = useMemo(() => comparison?.changes.filter((change) => showUnchanged || change.type !== "unchanged") ?? [], [comparison, showUnchanged]);
  if (!estimate) return <div className="editor-loading">{error || "Versionen werden geladen …"}</div>;
  const canClone = user?.role === "admin" || user?.role === "editor";

  return <div className="page-stack version-compare-page">
    <section className="review-heading compare-heading">
      <div><Link className="back-link" to={`/projects/${projectId}/versions/${versionId}`}><ArrowLeft size={16} /> Kostenermittlung</Link><p className="eyebrow">Projekt {estimate.project.projectNumber}</p><h2>Varianten und Versionen vergleichen</h2><p>{estimate.project.name} · Ziel {estimate.version.variantName} V{estimate.version.number}</p></div>
      <div className="compare-heading-actions">{canClone && <CloneVersionButton projectId={projectId} versionId={versionId} currentVariant={estimate.version.variantName} onCreated={(createdId) => navigate(`/projects/${projectId}/versions/${createdId}`)} />}<StatusBadge status={estimate.version.status} /></div>
    </section>

    <section className="data-card compare-selector">
      <div><span>Vergleichsbasis</span><select aria-label="Vergleichsbasis" value={baseVersionId} onChange={(event) => setBaseVersionId(event.target.value)}><option value="">Version wählen</option>{versions.filter((item) => item.id !== versionId).map((item) => <option value={item.id} key={item.id}>{item.variantName} · V{item.number} · {formatCents(item.totalNetCents)} · {item.status}</option>)}</select></div>
      <ArrowRight size={20} />
      <div className="compare-target"><span>Zielversion</span><strong>{estimate.version.variantName} · V{estimate.version.number}</strong><small>Q{estimate.version.priceQuarter} {estimate.version.priceYear}</small></div>
    </section>

    {error && <div className="inline-alert error">{error}</div>}
    {!baseVersionId ? <section className="data-card compare-empty"><GitCompareArrows size={34} /><strong>Noch keine Vergleichsversion vorhanden</strong><span>{canClone ? "Legen Sie eine neue Version oder Variante an. Die Ausgangsversion bleibt unverändert." : "Sobald eine weitere Version vorhanden ist, kann sie hier verglichen werden."}</span>{canClone && <CloneVersionButton projectId={projectId} versionId={versionId} currentVariant={estimate.version.variantName} onCreated={(createdId) => navigate(`/projects/${projectId}/versions/${createdId}`)} className="button primary" />}</section> : !comparison ? <div className="editor-loading">Vergleich wird berechnet …</div> : <>
      <section className="compare-summary-grid">
        <article><span>Ausgangssumme</span><strong>{formatMoney(comparison.totals.fromNet)}</strong><small>{comparison.from.variantName} · V{comparison.from.number}</small></article>
        <article><span>Zielsumme</span><strong>{formatMoney(comparison.totals.toNet)}</strong><small>{comparison.to.variantName} · V{comparison.to.number}</small></article>
        <article className={Number(comparison.totals.absoluteDelta) >= 0 ? "delta-up" : "delta-down"}><span>Absolute Abweichung</span><strong>{Number(comparison.totals.absoluteDelta) > 0 ? "+" : ""}{formatMoney(comparison.totals.absoluteDelta)}</strong><small>{comparison.totals.percentageDelta === null ? "keine Vergleichsbasis" : `${Number(comparison.totals.percentageDelta) > 0 ? "+" : ""}${formatNumber(comparison.totals.percentageDelta)} %`}</small></article>
        <article><span>Änderungen</span><strong>{comparison.counts.added + comparison.counts.removed + comparison.counts.modified}</strong><small>{comparison.counts.added} neu · {comparison.counts.removed} entfernt · {comparison.counts.modified} geändert</small></article>
      </section>

      <section className="data-card comparison-table-card">
        <div className="card-heading"><div><h3>Positionsvergleich</h3><p>Mengen, Preise, Faktoren, Prozentansätze, Zuschläge und Summen im direkten Vergleich.</p></div><label className="compare-toggle"><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> Unveränderte anzeigen</label></div>
        <div className="table-scroll"><table className="comparison-table"><thead><tr><th>Status</th><th>KGK / Position</th><th>Geänderte Felder</th><th>Ausgang</th><th>Ziel</th><th className="numeric">Abweichung</th></tr></thead><tbody>{visibleChanges.map((change) => {
          const line = change.after ?? change.before!;
          const Icon = change.type === "added" ? Plus : change.type === "removed" ? Minus : Check;
          return <tr key={change.key} className={`comparison-${change.type}`}><td><span className={`change-badge ${change.type}`}><Icon size={13} />{changeLabels[change.type]}</span></td><td><code>{line.kgkCode}</code><strong>{line.designation}</strong><small>Position {line.sequence} · {line.priceType === "surcharge" ? "Zuschlag" : line.priceType === "percentage" ? "Prozentansatz" : "Einheitspreis"}</small></td><td><div className="field-chips">{change.fields.map((field) => <span key={field}>{field}</span>)}</div></td><td>{change.before ? <ComparisonValues line={change.before} /> : <span className="empty-value">—</span>}</td><td>{change.after ? <ComparisonValues line={change.after} /> : <span className="empty-value">—</span>}</td><td className="numeric comparison-delta"><strong>{Number(change.absoluteDelta) > 0 ? "+" : ""}{formatMoney(change.absoluteDelta)}</strong>{change.percentageDelta !== null && <small>{Number(change.percentageDelta) > 0 ? "+" : ""}{formatNumber(change.percentageDelta)} %</small>}</td></tr>;
        })}</tbody></table></div>
        {!visibleChanges.length && <div className="empty-state compact"><Check size={28} /><strong>Keine Unterschiede</strong><span>Die ausgewählten Versionen sind inhaltlich identisch.</span></div>}
      </section>
      <p className="compare-timestamp">Verglichen mit Stand {formatDate(comparison.from.updatedAt)}; Zielstand {formatDate(comparison.to.updatedAt)}.</p>
    </>}
  </div>;
}

function ComparisonValues({ line }: { line: NonNullable<VersionComparison["changes"][number]["before"]> }) {
  return <div className="comparison-values"><span>{formatNumber(line.quantity)} {line.unit ?? ""}</span><span>{formatMoney(line.unitPrice)}</span><strong>{formatMoney(line.total)}</strong></div>;
}
