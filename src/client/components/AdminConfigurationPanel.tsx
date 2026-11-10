import {
  BookOpenCheck,
  Calculator,
  Check,
  DatabaseZap,
  Gauge,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  adminApi,
  adminErrorMessage,
  type AdminCatalogVersion,
  type AdminProjectRecord,
  type AdminRole,
  type AdminUserRecord,
  type CalculationRuleRecord,
  type ClassificationCatalogItem,
  type IndexSeriesRecord,
  type ProjectMemberRecord,
  type UnitRegistryRecord,
} from "../lib/admin-api";
import "./AdminConfigurationPanel.css";

type Tab = "users" | "members" | "units" | "indices" | "rules" | "classification";
type Notice = { kind: "success" | "error"; text: string } | null;

const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "users", label: "Benutzer", icon: Users },
  { id: "members", label: "Projektzugriffe", icon: ShieldCheck },
  { id: "units", label: "Einheiten", icon: ShieldCheck },
  { id: "indices", label: "Indexreihen", icon: Gauge },
  { id: "rules", label: "Berechnungsregeln", icon: Calculator },
  { id: "classification", label: "Katalogklassifizierung", icon: BookOpenCheck },
];

const roleLabels: Record<AdminRole, string> = {
  admin: "Administration",
  editor: "Bearbeitung",
  reviewer: "Prüfung / Freigabe",
  reader: "Lesen",
};

export function AdminConfigurationPanel() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [units, setUnits] = useState<UnitRegistryRecord[]>([]);
  const [series, setSeries] = useState<IndexSeriesRecord[]>([]);
  const [rules, setRules] = useState<CalculationRuleRecord[]>([]);
  const [catalogVersions, setCatalogVersions] = useState<AdminCatalogVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [userResult, unitResult, seriesResult, ruleResult, catalogResult] = await Promise.all([
        adminApi.users(), adminApi.units(), adminApi.indexSeries(), adminApi.calculationRules(), adminApi.catalogVersions(),
      ]);
      setUsers(userResult.users);
      setUnits(unitResult.units);
      setSeries(seriesResult.indexSeries);
      setRules(ruleResult.calculationRules);
      setCatalogVersions(catalogResult.catalogVersions);
      setNotice(null);
    } catch (reason) {
      setNotice({ kind: "error", text: adminErrorMessage(reason) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="data-card admin-config">
      <div className="admin-config__head">
        <div><h3>Fachliche Konfiguration</h3><p>Freigaberelevante Festlegungen werden serverseitig protokolliert.</p></div>
        <button type="button" className="icon-button" onClick={() => void load()} title="Daten aktualisieren" disabled={loading}><RefreshCw size={17} /></button>
      </div>
      <nav className="admin-config__tabs" aria-label="Administrative Konfiguration">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setNotice(null); }}><Icon size={16} />{item.label}</button>;
        })}
      </nav>
      <div className="admin-config__body">
        {notice && <div className={`admin-config__status ${notice.kind}`}>{notice.kind === "success" ? <Check size={16} /> : null}{notice.text}</div>}
        {loading ? <div className="admin-config__empty">Konfiguration wird geladen …</div> : (
          <>
            {tab === "users" && <UsersPanel users={users} setUsers={setUsers} setNotice={setNotice} />}
            {tab === "members" && <ProjectMembersPanel users={users} setNotice={setNotice} />}
            {tab === "units" && <UnitsPanel units={units} setUnits={setUnits} setNotice={setNotice} />}
            {tab === "indices" && <IndexPanel series={series} setSeries={setSeries} catalogVersions={catalogVersions} setCatalogVersions={setCatalogVersions} setNotice={setNotice} />}
            {tab === "rules" && <RulesPanel rules={rules} setRules={setRules} setNotice={setNotice} />}
            {tab === "classification" && <ClassificationPanel setNotice={setNotice} />}
          </>
        )}
      </div>
    </section>
  );
}

function UsersPanel({ users, setUsers, setNotice }: {
  users: AdminUserRecord[];
  setUsers: (value: AdminUserRecord[]) => void;
  setNotice: (value: Notice) => void;
}) {
  const [form, setForm] = useState({ email: "", displayName: "", password: "", role: "editor" as AdminRole });
  const [saving, setSaving] = useState(false);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const result = await adminApi.createUser(form);
      setUsers([...users, result.user].sort((a, b) => a.displayName.localeCompare(b.displayName, "de")));
      setForm({ email: "", displayName: "", password: "", role: "editor" });
      setNotice({ kind: "success", text: "Benutzerkonto wurde angelegt." });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
    finally { setSaving(false); }
  };
  const update = async (user: AdminUserRecord, patch: Partial<Pick<AdminUserRecord, "role" | "active">>) => {
    try {
      const result = await adminApi.updateUser(user.id, patch);
      setUsers(users.map((entry) => entry.id === user.id ? result.user : entry));
      setNotice({ kind: "success", text: `Zugriff für ${result.user.displayName} wurde aktualisiert.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  return <>
    <div className="admin-config__toolbar"><div><h4>Benutzer und Rollen</h4><p>Rollen wirken zusätzlich zu den projektspezifischen Mitgliedschaften.</p></div><span>{users.filter((user) => user.active).length} aktiv</span></div>
    <form className="admin-config__form" onSubmit={(event) => void create(event)}>
      <label>Name<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
      <label>E-Mail<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label>Startkennwort<input required minLength={12} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
      <label>Rolle<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AdminRole })}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <button className="button primary" disabled={saving}><Plus size={16} />{saving ? "Wird angelegt …" : "Benutzer anlegen"}</button>
    </form>
    <div className="admin-config__table-wrap"><table className="admin-config__table"><thead><tr><th>Benutzer</th><th>Rolle</th><th>Aktiv</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.email}</small></td><td><select value={user.role} onChange={(event) => void update(user, { role: event.target.value as AdminRole })}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td><td><label className="admin-config__actions"><input type="checkbox" checked={user.active} onChange={(event) => void update(user, { active: event.target.checked })} />{user.active ? "aktiv" : "gesperrt"}</label></td></tr>)}</tbody></table></div>
  </>;
}

function ProjectMembersPanel({ users, setNotice }: { users: AdminUserRecord[]; setNotice: (value: Notice) => void }) {
  const [projects, setProjects] = useState<AdminProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [members, setMembers] = useState<ProjectMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void adminApi.projects().then((result) => {
      setProjects(result.projects);
      setProjectId((current) => current || result.projects[0]?.id || "");
    }).catch((reason) => setNotice({ kind: "error", text: adminErrorMessage(reason) })).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!projectId) { setMembers([]); return; }
    setLoading(true);
    void adminApi.projectMembers(projectId).then((result) => setMembers(result.members))
      .catch((reason) => setNotice({ kind: "error", text: adminErrorMessage(reason) })).finally(() => setLoading(false));
  }, [projectId]);

  const toggle = async (user: AdminUserRecord, enabled: boolean) => {
    try {
      await adminApi.setProjectMember(projectId, user.id, enabled ? "member" : null);
      const result = await adminApi.projectMembers(projectId);
      setMembers(result.members);
      setNotice({ kind: "success", text: `Projektzugriff für ${user.displayName} wurde aktualisiert.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };

  const memberIds = new Set(members.map((member) => member.id));
  return <>
    <div className="admin-config__toolbar"><div><h4>Projektzugriffe</h4><p>Die globale Rolle bestimmt die Rechte; die Mitgliedschaft begrenzt den Zugriff auf das gewählte Projekt.</p></div></div>
    <label>Projekt<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Projekt wählen</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.projectNumber} · {project.name}</option>)}</select></label>
    {loading ? <div className="admin-config__empty">Projektzugriffe werden geladen …</div> : projectId ? <div className="admin-config__table-wrap" style={{ marginTop: 16 }}><table className="admin-config__table"><thead><tr><th>Benutzer</th><th>Rolle</th><th>Projektzugriff</th></tr></thead><tbody>{users.filter((user) => user.active).map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.email}</small></td><td>{roleLabels[user.role]}</td><td><label className="admin-config__actions"><input type="checkbox" checked={memberIds.has(user.id)} onChange={(event) => void toggle(user, event.target.checked)} />{memberIds.has(user.id) ? "zugewiesen" : "kein Zugriff"}</label></td></tr>)}</tbody></table></div> : <div className="admin-config__empty">Noch kein Projekt vorhanden.</div>}
  </>;
}

function UnitsPanel({ units, setUnits, setNotice }: {
  units: UnitRegistryRecord[];
  setUnits: (value: UnitRegistryRecord[]) => void;
  setNotice: (value: Notice) => void;
}) {
  const updateDraft = (id: string, patch: Partial<UnitRegistryRecord>) => setUnits(units.map((unit) => unit.id === id ? { ...unit, ...patch } : unit));
  const save = async (unit: UnitRegistryRecord) => {
    try {
      const result = await adminApi.updateUnit(unit.id, { approved: unit.approved, note: unit.note ?? "" });
      updateDraft(unit.id, result.unit);
      setNotice({ kind: "success", text: `Einheit ${unit.displayName} wurde gespeichert.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  return <>
    <div className="admin-config__toolbar"><div><h4>Einheitenregister</h4><p>Originaleinheiten bleiben erhalten; die Freigabe bestätigt nur ihre fachliche Verwendbarkeit.</p></div><span>{units.filter((unit) => unit.approved).length} von {units.length} freigegeben</span></div>
    <div className="admin-config__table-wrap"><table className="admin-config__table"><thead><tr><th>Einheit</th><th>Freigegeben</th><th>Festlegung / Hinweis</th><th /></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td><strong>{unit.displayName}</strong><small>{unit.canonicalUnit}</small></td><td><input type="checkbox" checked={unit.approved} onChange={(event) => updateDraft(unit.id, { approved: event.target.checked })} /></td><td><input className="compact-input" value={unit.note ?? ""} onChange={(event) => updateDraft(unit.id, { note: event.target.value })} placeholder="Norm, Umrechnung oder Einschränkung" /></td><td><button type="button" className="button secondary" onClick={() => void save(unit)}><Save size={15} />Speichern</button></td></tr>)}</tbody></table></div>
  </>;
}

function IndexPanel({ series, setSeries, catalogVersions, setCatalogVersions, setNotice }: {
  series: IndexSeriesRecord[];
  setSeries: (value: IndexSeriesRecord[]) => void;
  catalogVersions: AdminCatalogVersion[];
  setCatalogVersions: (value: AdminCatalogVersion[]) => void;
  setNotice: (value: Notice) => void;
}) {
  const [form, setForm] = useState({ name: "", source: "", baseYear: new Date().getFullYear(), version: 1, approved: false });
  const [valueDrafts, setValueDrafts] = useState<Record<string, { year: number; quarter: number; value: string; sourceReference: string }>>({});
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminApi.createIndexSeries(form);
      setSeries([...series, result.indexSeries]);
      setForm({ name: "", source: "", baseYear: new Date().getFullYear(), version: 1, approved: false });
      setNotice({ kind: "success", text: "Indexreihe wurde versioniert angelegt." });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  const addValue = async (seriesId: string) => {
    const draft = valueDrafts[seriesId] ?? { year: new Date().getFullYear(), quarter: 1, value: "", sourceReference: "" };
    try {
      const result = await adminApi.addIndexValue(seriesId, draft);
      setSeries(series.map((entry) => entry.id === seriesId ? result.indexSeries : entry));
      setNotice({ kind: "success", text: "Indexwert wurde gespeichert." });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  const assign = async (catalog: AdminCatalogVersion) => {
    const indexSeriesId = assignments[catalog.id] ?? catalog.indexSeriesId ?? "";
    if (!indexSeriesId) return;
    try {
      const result = await adminApi.assignIndexSeries(catalog.id, indexSeriesId);
      setCatalogVersions(catalogVersions.map((entry) => entry.id === catalog.id ? result.catalogVersion : entry));
      setNotice({ kind: "success", text: `Indexreihe für ${catalog.name} wurde bestätigt.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  return <>
    <div className="admin-config__toolbar"><div><h4>Indexreihen und Zielwerte</h4><p>Nur freigegebene Reihen mit vorhandenem Zielquartal dürfen Preise fortschreiben.</p></div></div>
    <form className="admin-config__form" onSubmit={(event) => void create(event)}>
      <label>Bezeichnung<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Quelle<input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></label>
      <label>Basisjahr<input required type="number" value={form.baseYear} onChange={(event) => setForm({ ...form, baseYear: Number(event.target.value) })} /></label>
      <label>Version<input required min={1} type="number" value={form.version} onChange={(event) => setForm({ ...form, version: Number(event.target.value) })} /></label>
      <label className="admin-config__checkbox"><input type="checkbox" checked={form.approved} onChange={(event) => setForm({ ...form, approved: event.target.checked })} />Fachlich freigegeben</label>
      <button className="button primary"><Plus size={16} />Reihe anlegen</button>
    </form>
    <div className="admin-config__series-grid">{series.map((entry) => {
      const draft = valueDrafts[entry.id] ?? { year: new Date().getFullYear(), quarter: 1, value: "", sourceReference: "" };
      const changeDraft = (patch: Partial<typeof draft>) => setValueDrafts({ ...valueDrafts, [entry.id]: { ...draft, ...patch } });
      return <article className="admin-config__series" key={entry.id}><header><div><strong>{entry.name} · V{entry.version}</strong><p>{entry.source} · Basis {entry.baseYear}</p></div><span className={entry.approved ? "ok-count" : "issue-count"}>{entry.approved ? "Freigegeben" : "Entwurf"}</span></header><div className="admin-config__values">{entry.values.length ? entry.values.map((value) => <span key={`${value.year}-${value.quarter}`}>Q{value.quarter} {value.year}: <strong>{value.value}</strong>{value.sourceReference ? ` · ${value.sourceReference}` : ""}<br /></span>) : "Noch keine Quartalswerte"}</div><div className="admin-config__value-form"><input aria-label="Jahr" type="number" value={draft.year} onChange={(event) => changeDraft({ year: Number(event.target.value) })} /><select aria-label="Quartal" value={draft.quarter} onChange={(event) => changeDraft({ quarter: Number(event.target.value) })}>{[1, 2, 3, 4].map((quarter) => <option value={quarter} key={quarter}>Q{quarter}</option>)}</select><input aria-label="Indexwert" required value={draft.value} onChange={(event) => changeDraft({ value: event.target.value })} placeholder="141,7" /><input aria-label="Fundstelle" value={draft.sourceReference} onChange={(event) => changeDraft({ sourceReference: event.target.value })} placeholder="Fundstelle" /><button type="button" className="icon-button" onClick={() => void addValue(entry.id)} title="Indexwert speichern"><Save size={15} /></button></div></article>;
    })}</div>
    <div className="admin-config__toolbar" style={{ marginTop: 22 }}><div><h4>Zuordnung zu Katalogversionen</h4><p>Die Zuordnung bestätigt ausdrücklich die maßgebliche Indexreihe.</p></div></div>
    <div className="admin-config__table-wrap"><table className="admin-config__table"><thead><tr><th>Katalog</th><th>Indexreihe</th><th>Status</th><th /></tr></thead><tbody>{catalogVersions.map((catalog) => <tr key={catalog.id}><td><strong>{catalog.name}</strong></td><td><select value={assignments[catalog.id] ?? catalog.indexSeriesId ?? ""} onChange={(event) => setAssignments({ ...assignments, [catalog.id]: event.target.value })}><option value="">Bitte wählen</option>{series.filter((entry) => entry.approved).map((entry) => <option value={entry.id} key={entry.id}>{entry.name} · V{entry.version}</option>)}</select></td><td>{catalog.indexSeriesConfirmed ? <span className="ok-count">Bestätigt</span> : <span className="issue-count">Offen</span>}</td><td><button type="button" className="button secondary" onClick={() => void assign(catalog)} disabled={!(assignments[catalog.id] ?? catalog.indexSeriesId)}><ShieldCheck size={15} />Bestätigen</button></td></tr>)}</tbody></table></div>
  </>;
}

function RulesPanel({ rules, setRules, setNotice }: {
  rules: CalculationRuleRecord[];
  setRules: (value: CalculationRuleRecord[]) => void;
  setNotice: (value: Notice) => void;
}) {
  const [form, setForm] = useState({ code: "linear", name: "Lineare Parameterregel", expression: "base + coefficient × parameter", parameterSchema: '{"base":"number","coefficient":"number","parameter":"number"}', approved: false });
  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const parameterSchema = JSON.parse(form.parameterSchema) as Record<string, unknown>;
      const result = await adminApi.createCalculationRule({ ...form, parameterSchema });
      setRules([...rules, result.calculationRule]);
      setForm({ code: "linear", name: "Lineare Parameterregel", expression: "base + coefficient × parameter", parameterSchema: '{"base":"number","coefficient":"number","parameter":"number"}', approved: false });
      setNotice({ kind: "success", text: "Berechnungsregel wurde versioniert gespeichert." });
    } catch (reason) { setNotice({ kind: "error", text: reason instanceof SyntaxError ? "Das Parameterschema ist kein gültiges JSON." : adminErrorMessage(reason) }); }
  };
  const toggle = async (rule: CalculationRuleRecord) => {
    try {
      const result = await adminApi.updateCalculationRule(rule.id, { approved: !rule.approved });
      setRules(rules.map((entry) => entry.id === rule.id ? result.calculationRule : entry));
      setNotice({ kind: "success", text: `Regel ${rule.code} wurde aktualisiert.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  return <>
    <div className="admin-config__toolbar"><div><h4>Berechnungsregelregister</h4><p>Formel und Parameterschema bleiben je Version nachvollziehbar. Der MVP führt ausschließlich die transparente Regel <code>linear</code> aus.</p></div></div>
    <form className="admin-config__form" onSubmit={(event) => void create(event)}>
      <label>Regelcode<input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="linear" /></label>
      <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="wide">Formel<input required value={form.expression} onChange={(event) => setForm({ ...form, expression: event.target.value })} placeholder="basis × faktor × menge" /></label>
      <label className="full">Parameterschema (JSON)<textarea required value={form.parameterSchema} onChange={(event) => setForm({ ...form, parameterSchema: event.target.value })} /></label>
      <label className="admin-config__checkbox"><input type="checkbox" checked={form.approved} onChange={(event) => setForm({ ...form, approved: event.target.checked })} />Fachlich freigegeben</label>
      <button className="button primary"><Plus size={16} />Regel anlegen</button>
    </form>
    <div className="admin-config__rule-grid">{rules.map((rule) => <article className="admin-config__rule" key={rule.id}><header><div><strong>{rule.code} · {rule.name}</strong><p>Version {rule.version}</p></div><button type="button" className="button secondary" onClick={() => void toggle(rule)}>{rule.approved ? "Freigabe aufheben" : "Freigeben"}</button></header><p><code>{rule.expression}</code></p><small>Parameter: {Object.keys(rule.parameterSchema).join(", ") || "keine"}</small></article>)}</div>
  </>;
}

function ClassificationPanel({ setNotice }: { setNotice: (value: Notice) => void }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClassificationCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ usageClassification: "detail" as "detail" | "kkk", allowedFromLph: "1", allowedToLph: "9", classificationSource: "" });
  const search = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminApi.searchCatalog(query);
      setItems(result.items); setTotal(result.total); setSelected(new Set());
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  const classify = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminApi.classifyCatalogItems({
        priceItemIds: [...selected], usageClassification: form.usageClassification,
        allowedFromLph: form.allowedFromLph ? Number(form.allowedFromLph) : null,
        allowedToLph: form.allowedToLph ? Number(form.allowedToLph) : null,
        classificationSource: form.classificationSource,
      });
      setItems(items.map((item) => selected.has(item.id) ? { ...item, usageClassification: form.usageClassification === "detail" ? "detailed" : "kkk", allowedFromLph: Number(form.allowedFromLph), allowedToLph: Number(form.allowedToLph) } : item));
      setSelected(new Set());
      setNotice({ kind: "success", text: `${result.updated} Katalogdatensätze wurden fachlich klassifiziert.` });
    } catch (reason) { setNotice({ kind: "error", text: adminErrorMessage(reason) }); }
  };
  const toggle = (id: string) => {
    const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next);
  };
  return <>
    <div className="admin-config__toolbar"><div><h4>Katalogdatensätze klassifizieren</h4><p>Die Festlegung basiert auf einer benannten Fachquelle, nicht auf automatischer Freitextdeutung.</p></div><span className="admin-config__selection">{selected.size} ausgewählt</span></div>
    <form className="admin-config__classification-search" onSubmit={(event) => void search(event)}><input required minLength={2} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="KGK, Datensatz-ID, Position-ID oder Bezeichnung" /><button className="button secondary"><Search size={16} />Suchen</button></form>
    {items.length ? <form onSubmit={(event) => void classify(event)}>
      <div className="admin-config__table-wrap" style={{ marginTop: 16 }}><table className="admin-config__table"><thead><tr><th><input aria-label="Alle auswählen" type="checkbox" checked={selected.size === items.length} onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())} /></th><th>Datensatz</th><th>Bezeichnung</th><th>Einheit</th><th>Aktueller Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><input aria-label={`${item.dataRecordId} auswählen`} type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td><td><strong>{item.kgkCode}</strong><small>{item.dataRecordId}</small></td><td>{item.description}</td><td>{item.unit ?? "—"}</td><td>{item.usageClassification === "review" ? "Fachlich prüfen" : item.usageClassification === "detailed" ? "Detailliert" : "KKK"}</td></tr>)}</tbody></table></div>
      <p><small>{total.toLocaleString("de-DE")} Treffer; die ersten {items.length} werden angezeigt.</small></p>
      <div className="admin-config__form">
        <label>Verwendungsart<select value={form.usageClassification} onChange={(event) => setForm({ ...form, usageClassification: event.target.value as "detail" | "kkk" })}><option value="detail">Detaillierte Kostenermittlung</option><option value="kkk">KKK-Kostenkennwert</option></select></label>
        <label>Zulässig ab LPH<input min={1} max={9} type="number" value={form.allowedFromLph} onChange={(event) => setForm({ ...form, allowedFromLph: event.target.value })} /></label>
        <label>Zulässig bis LPH<input min={1} max={9} type="number" value={form.allowedToLph} onChange={(event) => setForm({ ...form, allowedToLph: event.target.value })} /></label>
        <label>Fachquelle / Begründung<input required value={form.classificationSource} onChange={(event) => setForm({ ...form, classificationSource: event.target.value })} placeholder="Regelwerk, Fundstelle oder Entscheidung" /></label>
        <button className="button primary" disabled={!selected.size}><DatabaseZap size={16} />Auswahl klassifizieren</button>
      </div>
    </form> : query && <div className="admin-config__empty">Keine Treffer geladen. Starten Sie die Suche.</div>}
  </>;
}
