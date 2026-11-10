import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  ClipboardCheck,
  Copy,
  FileClock,
  GitCompareArrows,
  Info,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { CatalogPicker } from "../components/CatalogPicker";
import { CloneVersionButton } from "../components/CloneVersionButton";
import { StatusBadge } from "../components/StatusBadge";
import { ApiError, api, type EstimateLine, type EstimatePayload, type KgkNode } from "../lib/api";
import { formatCents, formatMoney, formatNumber } from "../lib/format";

function KgkTreeNode({ node, activeCode, onSelect }: { node: KgkNode; activeCode: string; onSelect: (code: string) => void }) {
  const [open, setOpen] = useState(node.level < 2);
  const hasChildren = Boolean(node.children?.length);
  return (
    <div className="kgk-node" style={{ "--level": node.level } as React.CSSProperties}>
      <button type="button" className={activeCode === node.code ? "active" : ""} onClick={() => { onSelect(node.code); if (hasChildren) setOpen((value) => !value); }}>
        <span className="tree-chevron">{hasChildren ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
        <span className="tree-label"><code>{node.code}</code><span>{node.label}</span></span>
        <span className="tree-total">{formatCents(node.totalCents)}</span>
      </button>
      {open && node.children?.map((child) => <KgkTreeNode node={child} activeCode={activeCode} onSelect={onSelect} key={child.code} />)}
    </div>
  );
}

const editableFields = [
  "quantity", "manualUnitPrice", "manualPriceSource", "manualPriceDate", "manualPriceReason", "manualPriceEditor",
  "ownNote", "factor", "percentage", "referenceKind", "referenceId", "calculationRule", "calculationParameters",
  "reviewNoteStatus", "usageClassification", "planningPhaseAllowed", "negativeConfirmed", "negativeReason", "workStatus",
] as const satisfies ReadonlyArray<keyof EstimateLine>;

type EditableField = (typeof editableFields)[number];

export function EstimateEditorPage() {
  const { projectId = "", versionId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<EstimatePayload | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [activeKgk, setActiveKgk] = useState("");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [undoStack, setUndoStack] = useState<EstimateLine[][]>([]);
  const [redoStack, setRedoStack] = useState<EstimateLine[][]>([]);
  const [bulkSelection, setBulkSelection] = useState<string[]>([]);
  const [bulkUsage, setBulkUsage] = useState<"" | "detailed" | "kkk" | "review">("");
  const [bulkReviewStatus, setBulkReviewStatus] = useState<"" | "open" | "acknowledged" | "resolved">("");
  const lastCommitted = useRef<Record<string, EstimateLine>>({});

  const load = useCallback(async () => {
    try {
      const result = await api.estimate(projectId, versionId);
      setData(result);
      lastCommitted.current = Object.fromEntries(result.lines.map((line) => [line.id, line]));
      if (!selectedLineId && result.lines[0]) setSelectedLineId(result.lines[0].id);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Die Kostenermittlung konnte nicht geladen werden.");
    }
  }, [projectId, versionId, selectedLineId]);

  useEffect(() => { void load(); }, [projectId, versionId]);

  const canEdit = user?.role === "admin" || user?.role === "editor";
  const readOnly = !canEdit || data?.version.status === "released" || data?.version.status === "archived";
  const selectedLine = data?.lines.find((line) => line.id === selectedLineId) ?? null;
  const filteredLines = useMemo(() => {
    if (!data) return [];
    const normalized = query.trim().toLocaleLowerCase("de-DE");
    return data.lines.filter((line) => {
      const kgkMatch = !activeKgk || line.kgkCode.startsWith(activeKgk);
      const textMatch = !normalized || [line.kgkCode, line.positionId, line.description, line.source, line.ownNote].some((value) => value?.toLocaleLowerCase("de-DE").includes(normalized));
      return kgkMatch && textMatch;
    });
  }, [data, query, activeKgk]);

  const updateLocal = <K extends EditableField>(lineId: string, field: K, value: EstimateLine[K]) => {
    if (!data || readOnly) return;
    setUndoStack((stack) => [...stack.slice(-29), data.lines.map((line) => ({ ...line }))]);
    setRedoStack([]);
    setData({ ...data, lines: data.lines.map((line) => line.id === lineId ? { ...line, [field]: value } : line) });
  };

  const editablePatch = (before: EstimateLine, after: EstimateLine): Partial<EstimateLine> => {
    const patch: Partial<EstimateLine> = {};
    for (const field of editableFields) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
        (patch as Record<string, unknown>)[field] = after[field];
      }
    }
    return patch;
  };

  const commit = async (line: EstimateLine) => {
    const original = lastCommitted.current[line.id];
    if (!original) return;
    const patch = editablePatch(original, line);
    if (!Object.keys(patch).length) return;
    setSaveState("saving");
    try {
      const result = await api.updateLine(projectId, versionId, line.id, patch);
      lastCommitted.current[line.id] = result.line;
      await load();
      setSaveState("saved");
    } catch (reason) {
      setSaveState("error");
      setError(reason instanceof ApiError ? reason.message : "Änderung konnte nicht gespeichert werden.");
    }
  };

  const commitImmediate = async (line: EstimateLine, patch: Partial<EstimateLine>) => {
    if (!data || readOnly) return;
    const snapshot = data.lines.map((item) => ({ ...item }));
    const optimistic = { ...line, ...patch };
    setUndoStack((stack) => [...stack.slice(-29), snapshot]);
    setRedoStack([]);
    setData({ ...data, lines: data.lines.map((item) => item.id === line.id ? optimistic : item) });
    setSaveState("saving");
    try {
      await api.updateLine(projectId, versionId, line.id, patch);
      await load();
      setSaveState("saved");
    } catch (reason) {
      setData({ ...data, lines: snapshot });
      setSaveState("error");
      setError(reason instanceof ApiError ? reason.message : "Änderung konnte nicht gespeichert werden.");
    }
  };

  const persistSnapshot = async (snapshot: EstimateLine[], fallback: EstimateLine[]) => {
    const currentById = new Map(fallback.map((line) => [line.id, line]));
    const changes = snapshot.flatMap((line) => {
      const current = currentById.get(line.id);
      if (!current) return [];
      const patch = editablePatch(current, line);
      return Object.keys(patch).length ? [{ line, patch }] : [];
    });
    setSaveState("saving");
    setData((current) => current ? { ...current, lines: snapshot } : current);
    try {
      await Promise.all(changes.map(({ line, patch }) => api.updateLine(projectId, versionId, line.id, patch)));
      await load();
      setSaveState("saved");
    } catch (reason) {
      setData((current) => current ? { ...current, lines: fallback } : current);
      setSaveState("error");
      setError(reason instanceof ApiError ? reason.message : "Rückgängig/Wiederholen konnte nicht gespeichert werden.");
    }
  };

  const undo = async () => {
    if (!data || !undoStack.length || readOnly || saveState === "saving") return;
    const previous = undoStack.at(-1)!;
    const current = data.lines.map((line) => ({ ...line }));
    setRedoStack((stack) => [...stack, current]);
    setUndoStack((stack) => stack.slice(0, -1));
    await persistSnapshot(previous, current);
  };

  const redo = async () => {
    if (!data || !redoStack.length || readOnly || saveState === "saving") return;
    const next = redoStack.at(-1)!;
    const current = data.lines.map((line) => ({ ...line }));
    setUndoStack((stack) => [...stack, current]);
    setRedoStack((stack) => stack.slice(0, -1));
    await persistSnapshot(next, current);
  };

  const remove = async (line: EstimateLine) => {
    if (readOnly || !window.confirm(`Position ${line.sequence} wirklich entfernen?`)) return;
    await api.deleteLine(projectId, versionId, line.id);
    setSelectedLineId(null);
    await load();
  };

  const copy = async (line: EstimateLine) => {
    if (readOnly) return;
    const result = await api.copyLine(projectId, versionId, line.id);
    await load();
    setSelectedLineId(result.line.id);
  };

  const move = async (line: EstimateLine, direction: -1 | 1) => {
    if (!data || readOnly) return;
    const index = data.lines.findIndex((item) => item.id === line.id);
    const target = index + direction;
    if (target < 0 || target >= data.lines.length) return;
    const next = [...data.lines];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setData({ ...data, lines: next });
    await api.reorderLines(projectId, versionId, next.map((item) => item.id));
    await load();
  };

  const applyBulkEdit = async () => {
    if (!data || readOnly || !bulkSelection.length || (!bulkUsage && !bulkReviewStatus)) return;
    const selected = data.lines.filter((line) => bulkSelection.includes(line.id));
    const patch: Partial<EstimateLine> = {};
    if (bulkUsage) patch.usageClassification = bulkUsage;
    if (bulkReviewStatus) patch.reviewNoteStatus = bulkReviewStatus;
    setUndoStack((stack) => [...stack.slice(-29), data.lines.map((line) => ({ ...line }))]);
    setRedoStack([]);
    setSaveState("saving");
    try {
      await Promise.all(selected.map((line) => api.updateLine(projectId, versionId, line.id, patch)));
      setBulkSelection([]);
      setBulkUsage("");
      setBulkReviewStatus("");
      await load();
      setSaveState("saved");
    } catch (reason) {
      setSaveState("error");
      setError(reason instanceof ApiError ? reason.message : "Mehrfachbearbeitung konnte nicht gespeichert werden.");
    }
  };

  if (!data) {
    return <div className="editor-loading">{error || "Kostenermittlung wird geladen …"}</div>;
  }

  return (
    <div className="editor-page">
      <div className="editor-project-head">
        <div className="editor-project-title">
          <Link to="/projects" className="icon-button"><ArrowLeft size={17} /></Link>
          <div><p>{data.project.projectNumber} · {data.project.client}</p><h2>{data.project.name}</h2></div>
          <StatusBadge status={data.version.status} />
        </div>
        <div className="editor-head-actions">
          <div className={`autosave ${saveState}`}>
            {saveState === "saved" ? <Check size={14} /> : saveState === "saving" ? <Save size={14} /> : <AlertTriangle size={14} />}
            {saveState === "saved" ? "Gespeichert" : saveState === "saving" ? "Speichert …" : "Speichern fehlgeschlagen"}
          </div>
          <div className="history-buttons"><button type="button" disabled={!undoStack.length || readOnly || saveState === "saving"} onClick={() => void undo()} title="Rückgängig und speichern"><Undo2 size={17} /></button><button type="button" disabled={!redoStack.length || readOnly || saveState === "saving"} onClick={() => void redo()} title="Wiederholen und speichern"><Redo2 size={17} /></button></div>
          <button className="button secondary" type="button" onClick={() => navigate(`/projects/${projectId}/versions/${versionId}/compare`)}><GitCompareArrows size={17} /> Vergleichen</button>
          {canEdit && <CloneVersionButton projectId={projectId} versionId={versionId} currentVariant={data.version.variantName} onCreated={(createdId) => navigate(`/projects/${projectId}/versions/${createdId}`)} />}
          <button className="button secondary" type="button" onClick={() => navigate(`/projects/${projectId}/versions/${versionId}/review`)}><ClipboardCheck size={17} /> Prüfen</button>
          <button className="button primary" type="button" disabled={readOnly} onClick={() => setPickerOpen(true)}><CirclePlus size={17} /> Positionen</button>
        </div>
      </div>

      <div className="editor-context-bar">
        <div><span>Planungsphase</span><strong>{data.project.planningPhase}</strong></div>
        <div><span>Katalog</span><strong>{data.version.catalogVersion}</strong></div>
        <div><span>Preisstand</span><strong>Q{data.version.priceQuarter} {data.version.priceYear}</strong></div>
        <div><span>Variante / Version</span><strong>{data.version.variantName} · V{data.version.number}</strong></div>
        <div className="context-grow" />
        <label className="editor-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Positionen filtern" /></label>
      </div>

      {error && <div className="inline-alert error">{error}</div>}
      {!canEdit && <div className="inline-alert info editor-role-notice"><Info size={17} /><span>Ihre Rolle „{user?.role === "reviewer" ? "Prüfer/Freigeber" : "Leser"}“ hat Lesezugriff. Fachliche Änderungen sind Bearbeitern und Administratoren vorbehalten.</span></div>}
      <div className="editor-workspace">
        <aside className="kgk-panel">
          <div className="panel-heading"><div><p>Struktur</p><h3>KGK-Gliederung</h3></div><span>{data.lines.length}</span></div>
          <button type="button" className={`kgk-all ${!activeKgk ? "active" : ""}`} onClick={() => setActiveKgk("")}><span>Alle Positionen</span><strong>{formatCents(data.totals.netCents)}</strong></button>
          <div className="kgk-tree">{data.kgkTree.map((node) => <KgkTreeNode key={node.code} node={node} activeCode={activeKgk} onSelect={setActiveKgk} />)}</div>
          <div className="kgk-legend"><span><i className="dot ready" /> Preis vollständig</span><span><i className="dot review" /> Prüfung offen</span><span><i className="dot blocked" /> Blockierender Fehler</span></div>
        </aside>

        <section className="positions-panel">
          <div className="panel-heading positions-heading"><div><p>Bearbeitung</p><h3>Positionen <span>{filteredLines.length}</span></h3></div><div className="table-actions"><button type="button" disabled={readOnly} onClick={() => setPickerOpen(true)}><BookOpenText size={16} /> Katalog öffnen</button></div></div>
          {bulkSelection.length > 0 && <div className="bulk-edit-bar"><strong>{bulkSelection.length} ausgewählt</strong><select aria-label="Verwendungsart mehrfach ändern" value={bulkUsage} onChange={(event) => setBulkUsage(event.target.value as typeof bulkUsage)}><option value="">Verwendungsart …</option><option value="detailed">Detailliert</option><option value="kkk">KKK</option><option value="review">Fachlich prüfen</option></select><select aria-label="Prüfstatus mehrfach ändern" value={bulkReviewStatus} onChange={(event) => setBulkReviewStatus(event.target.value as typeof bulkReviewStatus)}><option value="">Prüfstatus …</option><option value="open">Offen</option><option value="acknowledged">Bestätigt</option><option value="resolved">Erledigt</option></select><button type="button" disabled={readOnly || (!bulkUsage && !bulkReviewStatus)} onClick={() => void applyBulkEdit()}>Übernehmen</button><button type="button" onClick={() => setBulkSelection([])}>Auswahl aufheben</button></div>}
          <div className="positions-scroll">
            <table className="positions-table">
              <thead><tr><th className="selection-cell"><input type="checkbox" aria-label="Alle sichtbaren Positionen auswählen" disabled={readOnly || !filteredLines.length} checked={filteredLines.length > 0 && filteredLines.every((line) => bulkSelection.includes(line.id))} onChange={(event) => setBulkSelection(event.target.checked ? [...new Set([...bulkSelection, ...filteredLines.map((line) => line.id)])] : bulkSelection.filter((id) => !filteredLines.some((line) => line.id === id)))} /></th><th>Nr.</th><th>KGK / Position</th><th className="numeric">Menge</th><th>Einheit</th><th className="numeric">Einheitspreis</th><th>Preisart</th><th className="numeric">Gesamtpreis</th><th>Status</th><th /></tr></thead>
              <tbody>
                {filteredLines.map((line) => (
                  <tr key={line.id} className={`${selectedLineId === line.id ? "selected" : ""} line-${line.status}`} onClick={() => setSelectedLineId(line.id)}>
                    <td className="selection-cell"><input type="checkbox" aria-label={`Position ${line.sequence} auswählen`} disabled={readOnly} checked={bulkSelection.includes(line.id)} onChange={(event) => setBulkSelection((current) => event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id))} onClick={(event) => event.stopPropagation()} /></td>
                    <td className="sequence-cell"><span className={`line-dot ${line.status}`} />{line.sequence}</td>
                    <td className="position-main"><div><code>{line.kgkCode}</code>{line.positionId && <span>{line.positionId}</span>}</div><strong>{line.description}</strong><small>{line.kgkPath}</small></td>
                    <td className="numeric editable-cell">
                      <input
                        aria-label={`Menge Position ${line.sequence}`}
                        disabled={readOnly}
                        inputMode="decimal"
                        value={line.quantity ?? ""}
                        onChange={(event) => updateLocal(line.id, "quantity", event.target.value || null)}
                        onBlur={() => void commit(line)}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="—"
                      />
                    </td>
                    <td>{line.unit || "—"}</td>
                    <td className="numeric"><strong>{formatMoney(line.manualUnitPrice ?? line.catalogUnitPrice)}</strong>{line.manualUnitPrice && <small>manuell</small>}</td>
                    <td><span className={`price-type type-${line.priceType}`}>{line.priceType === "unit" ? "Einheitspreis" : line.priceType === "percentage" ? "Prozent" : line.priceType === "surcharge" ? "Zuschlag" : "Regel"}</span></td>
                    <td className="numeric total-cell">{formatCents(line.totalCents)}</td>
                    <td><StatusBadge status={line.status} compact /></td>
                    <td><button className="row-menu" type="button" onClick={(event) => { event.stopPropagation(); setSelectedLineId(line.id); }}><ChevronRight size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredLines.length && <div className="empty-state compact"><Search size={28} /><strong>Keine passenden Positionen</strong><span>Filter oder KGK-Auswahl ändern.</span></div>}
          </div>
        </section>

        <aside className="detail-panel">
          {selectedLine ? (
            <>
              <div className="panel-heading"><div><p>Position {selectedLine.sequence}</p><h3>Eigenschaften</h3></div><StatusBadge status={selectedLine.status} compact /></div>
              <div className="detail-scroll">
                <section className="detail-section"><h4>Einordnung</h4><dl><div><dt>KGK-Code</dt><dd><code>{selectedLine.kgkCode}</code></dd></div><div><dt>Datensatz-ID</dt><dd>{selectedLine.dataRecordId ?? "Eigene Position"}</dd></div><div><dt>Position-ID</dt><dd>{selectedLine.positionId ?? <span className="muted-text">Nicht im Katalog vorhanden</span>}</dd></div><div className="full"><dt>KGK-Pfad</dt><dd>{selectedLine.kgkPath}</dd></div></dl></section>
                <section className="detail-section">
                  <h4>Ansatz und Berechnung</h4>
                  <div className="formula-card"><Calculator size={17} /><div><span>Aktuelle Formel</span><strong>{selectedLine.calculationFormula || (selectedLine.priceType === "percentage" ? "Bezugsbasis × Prozent / 100" : selectedLine.priceType === "parameter" ? "base + coefficient × parameter" : "Menge × Einheitspreis × Faktor")}</strong></div></div>
                  <div className="detail-form-grid">
                    <label>Menge<input disabled={readOnly} value={selectedLine.quantity ?? ""} onChange={(e) => updateLocal(selectedLine.id, "quantity", e.target.value || null)} onBlur={() => void commit(selectedLine)} /></label>
                    <label>Einheit<input disabled value={selectedLine.unit} /></label>
                    <label>Faktor<input disabled={readOnly} value={selectedLine.factor ?? "1"} onChange={(e) => updateLocal(selectedLine.id, "factor", e.target.value || null)} onBlur={() => void commit(selectedLine)} /></label>
                    <label>Indexfaktor<input disabled value={selectedLine.indexFactor ?? "—"} /></label>
                  </div>
                  {selectedLine.priceType === "percentage" && <>
                    <label className="detail-label">Prozentansatz<input disabled={readOnly} value={selectedLine.percentage ?? ""} onChange={(e) => updateLocal(selectedLine.id, "percentage", e.target.value || null)} onBlur={() => void commit(selectedLine)} /></label>
                    <label className="detail-label">Art der Bezugsbasis<select disabled={readOnly} value={selectedLine.referenceKind ?? ""} onChange={(event) => void commitImmediate(selectedLine, { referenceKind: (event.target.value || null) as EstimateLine["referenceKind"], referenceId: null })}><option value="">Bitte wählen</option><option value="line">Position</option><option value="kgk">KGK-Zwischensumme</option></select></label>
                    {selectedLine.referenceKind === "line" && <label className="detail-label">Bezugsposition<select disabled={readOnly} value={selectedLine.referenceId ?? ""} onChange={(event) => void commitImmediate(selectedLine, { referenceId: event.target.value || null })}><option value="">Bitte wählen</option>{data.lines.filter((line) => line.id !== selectedLine.id).map((line) => <option value={line.id} key={line.id}>{line.sequence}. {line.description}</option>)}</select></label>}
                    {selectedLine.referenceKind === "kgk" && <label className="detail-label">KGK-Bezugsbasis<select disabled={readOnly} value={selectedLine.referenceId ?? ""} onChange={(event) => void commitImmediate(selectedLine, { referenceId: event.target.value || null })}><option value="">Bitte wählen</option>{[...new Set(data.lines.filter((line) => line.id !== selectedLine.id).map((line) => line.kgkCode))].map((code) => <option value={code} key={code}>{code}</option>)}</select></label>}
                  </>}
                  {selectedLine.priceType === "surcharge" && <><label className="detail-label">Grundposition (falls abhängig)<select disabled={readOnly} value={selectedLine.referenceId ?? ""} onChange={(event) => void commitImmediate(selectedLine, { referenceKind: event.target.value ? "line" : null, referenceId: event.target.value || null })}><option value="">Eigenständiger Zuschlag</option>{data.lines.filter((line) => line.id !== selectedLine.id).map((line) => <option value={line.id} key={line.id}>{line.sequence}. {line.description}</option>)}</select></label></>}
                  {selectedLine.priceType === "parameter" && <>
                    <label className="detail-label">Freigegebene Berechnungsregel<select disabled={readOnly} value={selectedLine.calculationRule ?? ""} onChange={(event) => void commitImmediate(selectedLine, { calculationRule: event.target.value || null })}><option value="">Regel auswählen</option><option value="linear">Linear: base + coefficient × parameter</option></select></label>
                    <div className="detail-form-grid parameter-grid">
                      {(["base", "coefficient", "parameter"] as const).map((key) => <label key={key}>{key}<input disabled={readOnly} value={String(selectedLine.calculationParameters?.[key] ?? "")} onChange={(event) => updateLocal(selectedLine.id, "calculationParameters", { ...(selectedLine.calculationParameters ?? {}), [key]: event.target.value || null })} onBlur={() => void commit(selectedLine)} /></label>)}
                    </div>
                  </>}
                </section>
                <section className="detail-section">
                  <h4>Preis</h4><dl><div><dt>Ausgangspreis</dt><dd>{formatMoney(selectedLine.basePrice)}</dd></div><div><dt>Preisstand</dt><dd>{selectedLine.basePeriod ?? "—"}</dd></div><div><dt>Katalogpreis</dt><dd>{formatMoney(selectedLine.catalogUnitPrice)}</dd></div><div><dt>Gesamtpreis</dt><dd className="detail-total">{formatCents(selectedLine.totalCents)}</dd></div></dl>
                  <label className="detail-label manual-price">Manueller Einheitspreis<input disabled={readOnly} value={selectedLine.manualUnitPrice ?? ""} onChange={(event) => updateLocal(selectedLine.id, "manualUnitPrice", event.target.value || null)} onBlur={() => void commit(selectedLine)} placeholder="Kein manueller Preis" /></label>
                  {selectedLine.manualUnitPrice && <div className="manual-metadata"><div className="inline-alert warning compact"><AlertTriangle size={15} /><span>Original- und manueller Preis bleiben parallel dokumentiert.</span></div><label className="detail-label">Quelle des manuellen Preises<input disabled={readOnly} value={selectedLine.manualPriceSource ?? ""} onChange={(event) => updateLocal(selectedLine.id, "manualPriceSource", event.target.value || null)} onBlur={() => void commit(selectedLine)} /></label><label className="detail-label">Preisstand<input disabled={readOnly} value={selectedLine.manualPriceDate ?? ""} onChange={(event) => updateLocal(selectedLine.id, "manualPriceDate", event.target.value || null)} onBlur={() => void commit(selectedLine)} placeholder="z. B. Q3 2026" /></label><label className="detail-label">Begründung<textarea disabled={readOnly} value={selectedLine.manualPriceReason ?? selectedLine.manualReason ?? ""} onChange={(event) => updateLocal(selectedLine.id, "manualPriceReason", event.target.value || null)} onBlur={() => void commit(selectedLine)} rows={2} /></label><label className="detail-label">Bearbeiter<input disabled={readOnly} value={selectedLine.manualPriceEditor ?? ""} onChange={(event) => updateLocal(selectedLine.id, "manualPriceEditor", event.target.value || null)} onBlur={() => void commit(selectedLine)} /></label></div>}
                  <label className="toggle-row compact-toggle"><input type="checkbox" disabled={readOnly} checked={Boolean(selectedLine.negativeConfirmed)} onChange={(event) => void commitImmediate(selectedLine, { negativeConfirmed: event.target.checked })} /><span className="toggle" /><div><strong>Negativen Wert fachlich bestätigt</strong><small>Nur bei negativer Menge oder negativem Preis erforderlich.</small></div></label>
                  {selectedLine.negativeConfirmed && <label className="detail-label">Begründung für negativen Wert<textarea disabled={readOnly} value={selectedLine.negativeReason ?? ""} onChange={(event) => updateLocal(selectedLine.id, "negativeReason", event.target.value || null)} onBlur={() => void commit(selectedLine)} rows={2} /></label>}
                </section>
                <section className="detail-section">
                  <h4>Quelle und Prüfung</h4><dl><div className="full"><dt>Quelle</dt><dd>{selectedLine.source ?? "—"}</dd></div><div className="full"><dt>Fundstelle</dt><dd>{selectedLine.sourceLocation ?? "—"}</dd></div></dl>
                  {selectedLine.reviewNote ? <div className="review-note"><AlertTriangle size={17} /><div><strong>Prüfhinweis</strong><p>{selectedLine.reviewNote}</p></div></div> : <div className="review-note clear"><Info size={17} /><span>Kein Prüfhinweis im Katalogdatensatz.</span></div>}
                  {selectedLine.reviewNote && <label className="detail-label">Bearbeitungsstatus des Prüfhinweises<select disabled={readOnly} value={selectedLine.reviewNoteStatus ?? "open"} onChange={(event) => void commitImmediate(selectedLine, { reviewNoteStatus: event.target.value as EstimateLine["reviewNoteStatus"] })}><option value="open">Offen</option><option value="acknowledged">Fachlich bestätigt</option><option value="resolved">Erledigt</option></select></label>}
                  <label className="detail-label">Verwendungsart<select disabled={readOnly} value={selectedLine.usageClassification ?? "review"} onChange={(event) => void commitImmediate(selectedLine, { usageClassification: event.target.value as EstimateLine["usageClassification"] })}><option value="review">Fachlich prüfen</option><option value="detailed">Detaillierte Kostenermittlung</option><option value="kkk">KKK-Kostenkennwert</option></select></label>
                  <label className="detail-label">Zulässigkeit in {data.project.planningPhase}<select disabled={readOnly} value={selectedLine.planningPhaseAllowed === null || selectedLine.planningPhaseAllowed === undefined ? "" : String(selectedLine.planningPhaseAllowed)} onChange={(event) => void commitImmediate(selectedLine, { planningPhaseAllowed: event.target.value === "" ? null : event.target.value === "true" })}><option value="">Fachlich prüfen</option><option value="true">Zulässig</option><option value="false">Nicht zulässig</option></select></label>
                  <label className="detail-label">Eigene Bemerkung<textarea disabled={readOnly} value={selectedLine.ownNote ?? ""} onChange={(e) => updateLocal(selectedLine.id, "ownNote", e.target.value)} onBlur={() => void commit(selectedLine)} rows={3} /></label>
                </section>
                {selectedLine.blockingReasons?.length ? <section className="detail-section"><h4>Blockierende Punkte</h4><ul className="blocking-list">{selectedLine.blockingReasons.map((reason) => <li key={reason}><AlertTriangle size={14} />{reason}</li>)}</ul></section> : null}
              </div>
              <div className="detail-actions"><button type="button" title="Nach oben" disabled={readOnly} onClick={() => void move(selectedLine, -1)}><ArrowUp size={16} /></button><button type="button" title="Nach unten" disabled={readOnly} onClick={() => void move(selectedLine, 1)}><ArrowDown size={16} /></button><button type="button" title="Kopieren" disabled={readOnly} onClick={() => void copy(selectedLine)}><Copy size={16} /></button><span /><button type="button" className="danger" title="Entfernen" disabled={readOnly} onClick={() => void remove(selectedLine)}><Trash2 size={16} /></button></div>
            </>
          ) : <div className="empty-detail"><FileClock size={32} /><strong>Position auswählen</strong><span>Eigenschaften, Quelle und Prüfhinweise erscheinen hier.</span></div>}
        </aside>
      </div>

      <footer className="editor-total-bar">
        <div className="validation-summary"><span className={data.lines.some((line) => line.status === "blocked") ? "has-errors" : "clear"}><AlertTriangle size={16} />{data.lines.filter((line) => line.status === "blocked").length} blockierende Fehler</span><span>{data.lines.filter((line) => line.status === "review").length} Warnungen</span><span>{data.totals.pricedLineCount} von {data.totals.lineCount} Positionen bepreist</span></div>
        <div className="totals"><div><span>Netto</span><strong>{formatCents(data.totals.netCents)}</strong></div>{data.project.grossMode && <><div><span>USt.</span><strong>{formatCents(data.totals.taxCents)}</strong></div><div className="grand-total"><span>Brutto</span><strong>{formatCents(data.totals.grossCents)}</strong></div></>}</div>
      </footer>

      <CatalogPicker open={pickerOpen} projectId={projectId} versionId={versionId} planningPhase={data.project.planningPhase} onClose={() => setPickerOpen(false)} onAdded={() => void load()} />
    </div>
  );
}
