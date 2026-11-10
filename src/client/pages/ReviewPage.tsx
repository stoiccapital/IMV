import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileCheck2, FileSpreadsheet, FileText, GitCompareArrows, Info, LockKeyhole, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { CloneVersionButton } from "../components/CloneVersionButton";
import { StatusBadge } from "../components/StatusBadge";
import { api, type EstimatePayload, type Severity, type ValidationPayload } from "../lib/api";
import { formatCents, formatDate } from "../lib/format";

const severityMeta: Record<Severity, { label: string; icon: typeof Info }> = {
  error: { label: "Blockierende Fehler", icon: ShieldAlert },
  warning: { label: "Warnungen", icon: AlertTriangle },
  info: { label: "Hinweise", icon: Info },
};

export function ReviewPage() {
  const { projectId = "", versionId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [estimate, setEstimate] = useState<EstimatePayload | null>(null);
  const [validation, setValidation] = useState<ValidationPayload | null>(null);
  const [note, setNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [releasedAt, setReleasedAt] = useState("");

  const load = async () => {
    const [estimateResult, validationResult] = await Promise.all([api.estimate(projectId, versionId), api.validation(projectId, versionId)]);
    setEstimate(estimateResult);
    setValidation(validationResult);
  };

  useEffect(() => { void load(); }, [projectId, versionId]);

  const release = async () => {
    if (!validation?.releaseAllowed || !note.trim()) return;
    setReleasing(true);
    try {
      const result = await api.release(projectId, versionId, note.trim());
      setReleasedAt(result.releasedAt);
      await load();
    } finally {
      setReleasing(false);
    }
  };

  if (!estimate || !validation) return <div className="editor-loading">Prüfung wird ausgeführt …</div>;
  const alreadyReleased = estimate.version.status === "released";
  const canRelease = user?.role === "admin" || user?.role === "reviewer";
  const canClone = user?.role === "admin" || user?.role === "editor";

  return (
    <div className="page-stack review-page">
      <section className="review-heading">
        <div><Link className="back-link" to={`/projects/${projectId}/versions/${versionId}`}><ArrowLeft size={16} /> Kostenermittlung</Link><p className="eyebrow">Projekt {estimate.project.projectNumber} · Version {estimate.version.number}</p><h2>Prüfung und Freigabe</h2><p>{estimate.project.name}</p></div>
        <StatusBadge status={estimate.version.status} />
      </section>

      {releasedAt && <div className="release-success"><CheckCircle2 size={20} /><div><strong>Version freigegeben</strong><span>Unveränderbarer Snapshot erstellt am {formatDate(releasedAt)}.</span></div></div>}

      <section className="review-summary-grid">
        <article className={`release-readiness ${validation.releaseAllowed ? "ready" : "blocked"}`}>
          <div className="readiness-icon">{validation.releaseAllowed ? <CheckCircle2 size={28} /> : <ShieldAlert size={28} />}</div>
          <div><span>Freigabestatus</span><strong>{validation.releaseAllowed ? "Freigabefähig" : "Freigabe blockiert"}</strong><p>{validation.releaseAllowed ? "Alle blockierenden Regeln sind erfüllt." : `${validation.counts.error} blockierende Punkte müssen bearbeitet werden.`}</p></div>
        </article>
        <article><span>Gesamtsumme netto</span><strong>{formatCents(estimate.totals.netCents)}</strong><small>{estimate.totals.lineCount} Positionen</small></article>
        <article><span>Preisstand</span><strong>Q{estimate.version.priceQuarter} {estimate.version.priceYear}</strong><small>{estimate.version.catalogVersion}</small></article>
        <article><span>Prüflauf</span><strong>{formatDate(validation.checkedAt)}</strong><small>14 Regelgruppen</small></article>
      </section>

      <div className="review-layout">
        <section className="data-card validation-card">
          <div className="card-heading"><div><h3>Prüfergebnisse</h3><p>Hinweise, Warnungen und blockierende Fehler nach Position.</p></div><div className="validation-counts"><span className="error">{validation.counts.error}</span><span className="warning">{validation.counts.warning}</span><span className="info">{validation.counts.info}</span></div></div>
          {(["error", "warning", "info"] as Severity[]).map((severity) => {
            const issues = validation.issues.filter((issue) => issue.severity === severity);
            if (!issues.length) return null;
            const Icon = severityMeta[severity].icon;
            return <div className={`issue-group severity-${severity}`} key={severity}><h4><Icon size={17} />{severityMeta[severity].label}<span>{issues.length}</span></h4>{issues.map((issue) => <article key={issue.id}><StatusBadge status={severity} compact /><div><strong>{issue.title}</strong><p>{issue.detail}</p>{issue.lineSequence && <Link to={`/projects/${projectId}/versions/${versionId}`}>Position {issue.lineSequence} öffnen</Link>}</div><code>{issue.code}</code></article>)}</div>;
          })}
          {!validation.issues.length && <div className="empty-state compact"><CheckCircle2 size={32} /><strong>Keine Prüfpunkte</strong><span>Die aktuelle Version erfüllt alle Regeln.</span></div>}
        </section>

        <aside className="review-side">
          <section className="data-card release-card">
            <div className="card-heading"><div><h3>Fachliche Freigabe</h3><p>Die freigegebene Version wird unveränderbar.</p></div><LockKeyhole size={20} /></div>
            {alreadyReleased ? <div className="released-box"><CheckCircle2 size={26} /><strong>Version freigegeben</strong><span>Änderungen erfordern eine neue Version.</span></div> : <>{!canRelease && <div className="inline-alert info compact"><Info size={15} /><span>Die Freigabe ist Prüfern/Freigebern und Administratoren vorbehalten.</span></div>}<label>Freigabevermerk<textarea disabled={!canRelease} rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Prüfumfang und Entscheidung kurz dokumentieren" /></label><button className="button primary wide" type="button" disabled={!canRelease || !validation.releaseAllowed || !note.trim() || releasing} onClick={() => void release()}><FileCheck2 size={17} />{releasing ? "Freigabe läuft …" : "Version freigeben"}</button>{!validation.releaseAllowed && <p className="blocked-copy"><ShieldAlert size={14} /> Freigabe erst nach Behebung aller blockierenden Fehler möglich.</p>}</>}
            <div className="version-actions"><Link className="button secondary" to={`/projects/${projectId}/versions/${versionId}/compare`}><GitCompareArrows size={16} /> Versionen vergleichen</Link>{canClone && <CloneVersionButton projectId={projectId} versionId={versionId} currentVariant={estimate.version.variantName} onCreated={(createdId) => navigate(`/projects/${projectId}/versions/${createdId}`)} className="button secondary" />}</div>
          </section>
          <section className="data-card export-card">
            <div className="card-heading"><div><h3>Prüfexporte</h3><p>Alle Formate verwenden dieselbe Summenbasis.</p></div><Download size={20} /></div>
            <a href={`/api/projects/${projectId}/versions/${versionId}/exports/pdf`}><FileText size={18} /><div><strong>Prüfbericht PDF</strong><span>Deckblatt, Zusammenfassung, Positionen</span></div><Download size={15} /></a>
            <a href={`/api/projects/${projectId}/versions/${versionId}/exports/xlsx`}><FileSpreadsheet size={18} /><div><strong>Kostenermittlung Excel</strong><span>Strukturierte Arbeitsmappe</span></div><Download size={15} /></a>
            <a href={`/api/projects/${projectId}/versions/${versionId}/exports/json`}><FileCheck2 size={18} /><div><strong>Projektdaten JSON</strong><span>Maschinenlesbarer Snapshot</span></div><Download size={15} /></a>
          </section>
        </aside>
      </div>
    </div>
  );
}
