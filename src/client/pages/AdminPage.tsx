import { AlertTriangle, BookOpenCheck, Database, Download, FileWarning, Gauge, Scale, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AdminOverview } from "../lib/api";
import { formatDate } from "../lib/format";
import { AdminConfigurationPanel } from "../components/AdminConfigurationPanel";

export function AdminPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  useEffect(() => { void api.adminOverview().then(setData); }, []);
  if (!data) return <div className="editor-loading">Administration wird geladen …</div>;
  const catalog = data.catalogVersions[0];
  return (
    <div className="page-stack admin-page">
      <section className="page-heading"><div><p className="eyebrow">Systemverwaltung</p><h2>Kataloge, Regeln und Zugriffe</h2><p>Administrative Festlegungen bleiben versioniert und nachvollziehbar.</p></div></section>
      <section className="metric-grid four"><article className="metric-card"><div className="metric-icon petrol"><Database size={20} /></div><div><span>Katalogdatensätze</span><strong>{catalog?.recordCount.toLocaleString("de-DE") ?? "—"}</strong><small>{catalog?.name ?? "kein Katalog"}</small></div></article><article className="metric-card"><div className="metric-icon amber"><FileWarning size={20} /></div><div><span>Offene Konflikte</span><strong>{data.openConflicts}</strong><small>administrative Entscheidung</small></div></article><article className="metric-card"><div className="metric-icon blue"><Users size={20} /></div><div><span>Aktive Benutzer</span><strong>{data.activeUsers}</strong><small>rollenbasiert</small></div></article><article className="metric-card"><div className="metric-icon green"><Scale size={20} /></div><div><span>Freigegebene Einheiten</span><strong>{data.approvedUnits}</strong><small>Einheitenregister</small></div></article></section>
      <AdminConfigurationPanel />
      <div className="admin-grid">
        <section className="data-card catalog-version-card"><div className="card-heading"><div><h3>Katalogversionen</h3><p>Jeder Import ist unveränderbar und besitzt ein eigenes Prüfprotokoll.</p></div><BookOpenCheck size={20} /></div>{data.catalogVersions.map((version) => <article key={version.id}><div className="catalog-version-title"><span className="catalog-chip">{version.name}</span><div><strong>{version.recordCount.toLocaleString("de-DE")} Datensätze</strong><small>Importiert {formatDate(version.importedAt)}{version.importedBy ? ` von ${version.importedBy}` : ""}</small></div></div><div className="catalog-version-stats"><span><strong>{version.kgkCount.toLocaleString("de-DE")}</strong> KGK-Codes</span><span className="warning-text"><strong>{version.reviewNoteCount.toLocaleString("de-DE")}</strong> Prüfhinweise</span><span><strong>{version.issueCounts?.schema ?? 0}</strong> Schemakonflikte</span></div><div className="version-foot"><code>{version.fileSha256?.slice(0, 16) ?? "Prüfsumme ausstehend"}…</code><a href={`/api/admin/catalog-versions/${version.id}/import-report`}><Download size={15} /> Prüfprotokoll</a></div></article>)}</section>
        <section className="data-card conflict-card"><div className="card-heading"><div><h3>Offene Festlegungen</h3><p>Diese Punkte verhindern eine unbeabsichtigte fachliche Auswahl.</p></div><AlertTriangle size={20} /></div><div className="conflict-item critical"><span><AlertTriangle size={17} /></span><div><strong>Indexreihe der Katalogversion bestätigen</strong><p>CSV und Excel-Metadaten verwenden abweichende Bezeichnungen. Die Angaben werden nicht automatisch vermischt.</p><small>Katalog {catalog?.name ?? "Q3 2026"}</small></div></div><div className="conflict-item"><span><Gauge size={17} /></span><div><strong>Verwendungsarten klassifizieren</strong><p>Die CSV enthält keine explizite KKK-/Detail- oder Planungsphasenklassifizierung.</p><small>Freigabe bleibt für unklare Positionen blockiert</small></div></div><div className="conflict-item"><span><ShieldCheck size={17} /></span><div><strong>{data.pendingRules} Berechnungsregeln unvollständig</strong><p>Parameterpositionen erhalten erst nach geprüfter Regelkonfiguration einen Wert.</p></div></div></section>
        <section className="data-card audit-card"><div className="card-heading"><div><h3>Letzte fachliche Änderungen</h3><p>Auszug aus dem unveränderbaren Audit-Log.</p></div><ShieldCheck size={20} /></div><div className="audit-list">{data.recentAudit.map((entry) => <div key={entry.id}><span className="audit-dot" /><div><strong>{entry.action}</strong><span>{entry.entity}</span><small>{entry.user} · {formatDate(entry.at)}</small></div></div>)}</div></section>
      </div>
    </div>
  );
}
