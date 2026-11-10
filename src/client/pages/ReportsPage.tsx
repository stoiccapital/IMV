import { Download, FileJson2, FileSpreadsheet, FileText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { api, type ProjectSummary } from "../lib/api";
import { formatCents, formatDate } from "../lib/format";

export function ReportsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { void api.projects().then((result) => setProjects(result.projects)); }, []);
  const filtered = useMemo(() => projects.filter((project) => `${project.projectNumber} ${project.name}`.toLocaleLowerCase("de-DE").includes(query.toLocaleLowerCase("de-DE"))), [projects, query]);
  return (
    <div className="page-stack">
      <section className="page-heading"><div><p className="eyebrow">Ausgabe</p><h2>Berichte und strukturierte Exporte</h2><p>Projekt- und Versionsdaten mit einheitlicher, centgenauer Summenbasis.</p></div></section>
      <section className="data-card reports-card">
        <div className="table-toolbar"><div className="toolbar-title"><h3>Projektversionen</h3><span>{filtered.length} Einträge</span></div><label className="search-field"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Projekt suchen" /></label></div>
        <div className="report-list">{filtered.map((project) => {
          const root = `/api/projects/${project.id}/versions/${project.currentVersionId}/exports`;
          return <article key={project.id}><div className="report-project"><span className="file-monogram">{project.projectNumber.slice(0, 3)}</span><div><strong>{project.name}</strong><span>{project.projectNumber} · Version {project.currentVersion}</span><small>Geändert {formatDate(project.updatedAt)}</small></div></div><StatusBadge status={project.status} /><strong className="report-total">{formatCents(project.totalNetCents)}</strong><div className="export-actions"><a href={`${root}/pdf`} title="PDF"><FileText size={17} /><span>PDF</span><Download size={13} /></a><a href={`${root}/xlsx`} title="Excel"><FileSpreadsheet size={17} /><span>Excel</span><Download size={13} /></a><a href={`${root}/json`} title="JSON"><FileJson2 size={17} /><span>JSON</span><Download size={13} /></a></div></article>;
        })}</div>
      </section>
    </div>
  );
}
