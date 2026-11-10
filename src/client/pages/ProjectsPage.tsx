import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  CirclePlus,
  Clock3,
  Euro,
  Filter,
  FolderKanban,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../App";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, api, type ProjectStatus, type ProjectSummary } from "../lib/api";
import { formatCents, formatDate } from "../lib/format";

const statusOptions: Array<{ value: ProjectStatus | "all"; label: string }> = [
  { value: "all", label: "Alle Status" },
  { value: "draft", label: "Entwurf" },
  { value: "internal_review", label: "Interne Prüfung" },
  { value: "released", label: "Freigegeben" },
  { value: "archived", label: "Archiviert" },
];

export function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    const timer = window.setTimeout(() => {
      api
        .projects(params.size ? `?${params}` : "")
        .then((result) => {
          setProjects(result.projects);
          setError("");
        })
        .catch((reason) => setError(reason instanceof ApiError ? reason.message : "Projekte konnten nicht geladen werden."))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, status]);

  const metrics = useMemo(() => {
    const active = projects.filter((project) => project.status !== "archived");
    return {
      active: active.length,
      review: projects.filter((project) => project.status === "internal_review").length,
      issues: projects.reduce((sum, project) => sum + project.openIssueCount, 0),
      volume: projects.reduce((sum, project) => sum + project.totalNetCents, 0),
    };
  }, [projects]);

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Projektportfolio</p>
          <h2>Kostenermittlungen im Überblick</h2>
          <p>Bearbeitungsstand, Prüfstatus und Kostenvolumen der aktuellen Projektversionen.</p>
        </div>
        {(user?.role === "admin" || user?.role === "editor") && <Link className="button primary" to="/projects/new">
          <CirclePlus size={18} /> Neues Projekt
        </Link>}
      </section>

      <section className="metric-grid four">
        <article className="metric-card">
          <div className="metric-icon petrol"><FolderKanban size={20} /></div>
          <div><span>Aktive Projekte</span><strong>{metrics.active}</strong><small>ohne Archiv</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon blue"><Clock3 size={20} /></div>
          <div><span>In Prüfung</span><strong>{metrics.review}</strong><small>interne Freigabe offen</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon amber"><AlertTriangle size={20} /></div>
          <div><span>Offene Prüfpunkte</span><strong>{metrics.issues}</strong><small>über alle Projekte</small></div>
        </article>
        <article className="metric-card">
          <div className="metric-icon green"><Euro size={20} /></div>
          <div><span>Aktuelles Volumen</span><strong>{formatCents(metrics.volume)}</strong><small>netto</small></div>
        </article>
      </section>

      <section className="data-card project-card">
        <div className="table-toolbar">
          <div className="toolbar-title">
            <h3>Projekte</h3>
            <span>{projects.length} Einträge</span>
          </div>
          <div className="toolbar-controls">
            <label className="search-field">
              <Search size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Projektnummer oder Bezeichnung" />
            </label>
            <label className="select-field">
              <Filter size={16} />
              <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}>
                {statusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
        </div>

        {error && <div className="inline-alert error">{error}</div>}
        <div className="table-scroll">
          <table className="project-table">
            <thead>
              <tr>
                <th>Projekt</th>
                <th>Status</th>
                <th>LPH</th>
                <th>Version</th>
                <th>Prüfung</th>
                <th className="numeric">Gesamtkosten netto</th>
                <th>Letzte Änderung</th>
                <th aria-label="Öffnen" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr className="skeleton-row" key={index}><td colSpan={8}><span /></td></tr>
                ))
              ) : projects.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="empty-state compact">
                    <FolderKanban size={30} />
                    <strong>Keine Projekte gefunden</strong>
                    <span>Passen Sie die Filter an oder legen Sie ein neues Projekt an.</span>
                  </div>
                </td></tr>
              ) : (
                projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link className="project-name" to={`/projects/${project.id}/versions/${project.currentVersionId}`}>
                        <strong>{project.name}</strong>
                        <span>{project.projectNumber} · {project.client}</span>
                      </Link>
                    </td>
                    <td><StatusBadge status={project.status} /></td>
                    <td><span className="cell-main">{project.planningPhase}</span><small>{project.estimateType === "detailed" ? "Detailliert" : "Kostenkennwert"}</small></td>
                    <td><span className="version-pill">V{project.currentVersion}</span><small>{project.catalogVersion}</small></td>
                    <td>
                      {project.openIssueCount ? (
                        <span className="issue-count"><AlertTriangle size={14} /> {project.openIssueCount} offen</span>
                      ) : (
                        <span className="ok-count">Ohne Blocker</span>
                      )}
                    </td>
                    <td className="numeric amount-cell">{formatCents(project.totalNetCents)}</td>
                    <td><span className="cell-main">{formatDate(project.updatedAt)}</span><small>{project.updatedBy ?? "—"}</small></td>
                    <td><Link className="icon-button" to={`/projects/${project.id}/versions/${project.currentVersionId}`} aria-label="Projekt öffnen"><ArrowUpRight size={17} /></Link></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
