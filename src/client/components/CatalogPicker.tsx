import { AlertTriangle, Check, Search, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type CatalogItem } from "../lib/api";
import { formatMoney } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

interface CatalogPickerProps {
  open: boolean;
  projectId: string;
  versionId: string;
  planningPhase?: string;
  onClose: () => void;
  onAdded: () => void;
}

export function CatalogPicker({ open, projectId, versionId, planningPhase, onClose, onAdded }: CatalogPickerProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyClean, setOnlyClean] = useState(false);
  const [unit, setUnit] = useState("");
  const [source, setSource] = useState("");
  const [usageClassification, setUsageClassification] = useState("");
  const [onlyAllowed, setOnlyAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, page: "1", pageSize: "40" });
      if (onlyClean) params.set("withoutReviewNote", "true");
      if (unit.trim()) params.set("unit", unit.trim());
      if (source.trim()) params.set("source", source.trim());
      if (usageClassification) params.set("usageClassification", usageClassification);
      const phase = planningPhase?.match(/(?:LPH\s*)?([1-9])/i)?.[1];
      if (onlyAllowed && phase) params.set("planningPhase", phase);
      api.catalog(params)
        .then((result) => {
          setItems(result.items);
          setTotal(result.total);
        })
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, query, onlyClean, unit, source, usageClassification, onlyAllowed, planningPhase]);

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);

  if (!open) return null;

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const add = async () => {
    if (!selected.size) return;
    setAdding(true);
    try {
      await api.addCatalogItems(projectId, versionId, [...selected]);
      setSelected(new Set());
      onAdded();
      onClose();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="catalog-drawer" role="dialog" aria-modal="true" aria-label="Positionen aus dem Preiskatalog übernehmen">
        <div className="drawer-head">
          <div><p className="eyebrow">Katalog Q3 2026</p><h2>Positionen übernehmen</h2><span>{total.toLocaleString("de-DE")} Datensätze gefunden</span></div>
          <button className="icon-button" type="button" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="drawer-search-row">
          <label className="search-field large"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="KGK, Bezeichnung, Datensatz-ID oder Quelle" /></label>
          <label className="search-field drawer-small-filter"><input aria-label="Einheit filtern" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Einheit" /></label>
          <label className="search-field drawer-source-filter"><input aria-label="Quelle filtern" value={source} onChange={(event) => setSource(event.target.value)} placeholder="Quelle" /></label>
          <label className="select-field"><select aria-label="Verwendungsart filtern" value={usageClassification} onChange={(event) => setUsageClassification(event.target.value)}><option value="">Alle Verwendungsarten</option><option value="detail">Detailliert</option><option value="kkk">KKK</option><option value="review_required">Fachlich prüfen</option></select></label>
          <label className="check-filter"><input type="checkbox" checked={onlyClean} onChange={(event) => setOnlyClean(event.target.checked)} /><span>Ohne Prüfhinweis</span></label>
          {planningPhase && <label className="check-filter"><input type="checkbox" checked={onlyAllowed} onChange={(event) => setOnlyAllowed(event.target.checked)} /><span>Nur zulässig für {planningPhase}</span></label>}
        </div>

        <div className="catalog-result-list">
          {loading ? <div className="drawer-loader">Katalog wird durchsucht …</div> : items.map((item) => (
            <button type="button" className={`catalog-result ${selected.has(item.id) ? "selected" : ""}`} key={item.id} onClick={() => toggle(item.id)}>
              <span className="result-check">{selected.has(item.id) && <Check size={15} />}</span>
              <div className="result-main">
                <div className="result-meta"><code>{item.kgkCode}</code><span>{item.dataRecordId}</span>{item.positionId && <span>{item.positionId}</span>}</div>
                <strong>{item.description}</strong>
                <p>{item.kgkPath}</p>
                <div className="result-foot">
                  <span>{item.source ?? "Quelle nicht angegeben"}</span>
                  {item.sourceLocation && <span>Fundstelle: {item.sourceLocation}</span>}
                  {item.reviewNote && <span className="warning-text"><AlertTriangle size={13} /> Prüfhinweis</span>}
                  {item.usageClassification === "review" ? <StatusBadge status="review_required" compact /> : <StatusBadge status="classified" compact />}
                </div>
              </div>
              <div className="result-price"><strong>{formatMoney(item.price)}</strong><span>je {item.unit || "—"}</span>{item.price === null && <small><ShieldAlert size={12} /> kein Preis</small>}</div>
            </button>
          ))}
        </div>
        <div className="drawer-foot">
          <div><strong>{selectedItems.length}</strong><span>Positionen ausgewählt</span></div>
          <button className="button secondary" type="button" onClick={onClose}>Abbrechen</button>
          <button className="button primary" type="button" disabled={!selected.size || adding} onClick={() => void add()}>{adding ? "Wird übernommen …" : "Auswahl übernehmen"}</button>
        </div>
      </aside>
    </div>
  );
}
