import { AlertTriangle, BookOpenText, CheckCircle2, ChevronLeft, ChevronRight, Filter, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { api, type CatalogItem } from "../lib/api";
import { formatMoney } from "../lib/format";

export function CatalogPage() {
  const [query, setQuery] = useState("");
  const [priceType, setPriceType] = useState("");
  const [unit, setUnit] = useState("");
  const [source, setSource] = useState("");
  const [usageClassification, setUsageClassification] = useState("");
  const [planningPhase, setPlanningPhase] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query, page: String(page), pageSize: "40" });
      if (priceType) params.set("priceType", priceType);
      if (unit.trim()) params.set("unit", unit.trim());
      if (source.trim()) params.set("source", source.trim());
      if (usageClassification) params.set("usageClassification", usageClassification);
      if (planningPhase) params.set("planningPhase", planningPhase);
      if (reviewOnly) params.set("hasReviewNote", "true");
      api.catalog(params).then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setSelected((current) => current && result.items.some((item) => item.id === current.id) ? current : result.items[0] ?? null);
      }).finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, priceType, unit, source, usageClassification, planningPhase, reviewOnly, page]);

  const pages = Math.max(1, Math.ceil(total / 40));

  return (
    <div className="page-stack catalog-page">
      <section className="page-heading">
        <div><p className="eyebrow">Katalogversion Q3 2026</p><h2>Preis- und Positionskatalog</h2><p>Führende CSV-Datenquelle mit unverändertem Rohdaten-Snapshot je Datensatz.</p></div>
        <div className="catalog-count"><BookOpenText size={20} /><div><strong>{total.toLocaleString("de-DE")}</strong><span>Positionen</span></div></div>
      </section>

      <section className="data-card catalog-browser">
        <div className="catalog-filters">
          <label className="search-field large"><Search size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="KGK-Code, Datensatz-ID, Bezeichnung, Erläuterung oder Quelle" /></label>
          <label className="select-field"><Filter size={16} /><select value={priceType} onChange={(event) => { setPriceType(event.target.value); setPage(1); }}><option value="">Alle Preisarten</option><option value="Einheitspreis">Einheitspreis</option><option value="Zuschlag EUR">Zuschlag EUR</option><option value="Prozentansatz">Prozentansatz</option><option value="Berechnungsregel">Berechnungsregel</option></select></label>
          <label className="search-field catalog-short-filter"><input aria-label="Einheit filtern" value={unit} onChange={(event) => { setUnit(event.target.value); setPage(1); }} placeholder="Einheit" /></label>
          <label className="search-field catalog-source-filter"><input aria-label="Quelle filtern" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} placeholder="Quelle" /></label>
          <label className="select-field"><Filter size={16} /><select aria-label="Verwendungsart filtern" value={usageClassification} onChange={(event) => { setUsageClassification(event.target.value); setPage(1); }}><option value="">Alle Verwendungsarten</option><option value="detail">Detailliert</option><option value="kkk">KKK</option><option value="review_required">Fachlich prüfen</option></select></label>
          <label className="select-field"><Filter size={16} /><select aria-label="Planungsphase filtern" value={planningPhase} onChange={(event) => { setPlanningPhase(event.target.value); setPage(1); }}><option value="">Alle LPH</option>{[1,2,3,4,5,6,7,8,9].map((phase) => <option value={phase} key={phase}>Zulässig in LPH {phase}</option>)}</select></label>
          <label className="check-filter"><input type="checkbox" checked={reviewOnly} onChange={(event) => { setReviewOnly(event.target.checked); setPage(1); }} /><span>Nur mit Prüfhinweis</span></label>
        </div>

        <div className="catalog-browser-grid">
          <div className="catalog-table-wrap">
            <table className="catalog-table"><thead><tr><th>KGK / Datensatz</th><th>Bezeichnung</th><th>Einheit</th><th className="numeric">Preis Q3 2026</th><th>Zulässigkeit</th></tr></thead><tbody>
              {loading ? <tr><td colSpan={5}><div className="drawer-loader">Katalog wird durchsucht …</div></td></tr> : items.map((item) => (
                <tr key={item.id} className={selected?.id === item.id ? "selected" : ""} onClick={() => setSelected(item)}>
                  <td><code>{item.kgkCode}</code><small>{item.dataRecordId}{item.positionId ? ` · ${item.positionId}` : ""}</small></td>
                  <td><strong>{item.description}</strong><small>{item.source}{item.sourceLocation ? ` · ${item.sourceLocation}` : ""}</small>{item.reviewNote && <span className="mini-warning"><AlertTriangle size={12} /> Prüfhinweis</span>}</td>
                  <td>{item.unit || "—"}</td>
                  <td className="numeric amount-cell">{formatMoney(item.price)}</td>
                  <td>{item.usageClassification === "review" ? <StatusBadge status="review_required" compact /> : <StatusBadge status="classified" compact />}</td>
                </tr>
              ))}
            </tbody></table>
            <div className="pagination"><span>{total.toLocaleString("de-DE")} Treffer · Seite {page} von {pages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></div>
          </div>
          <aside className="catalog-inspector">
            {selected ? <>
              <div className="inspector-head"><div><p>{selected.dataRecordId}</p><h3>{selected.description}</h3></div>{selected.reviewNote ? <AlertTriangle className="warning-text" /> : <CheckCircle2 className="success-text" />}</div>
              <dl><div><dt>KGK-Code</dt><dd><code>{selected.kgkCode}</code></dd></div><div><dt>Position-ID</dt><dd>{selected.positionId ?? <span className="muted-text">Spalte fehlt in der Quelle</span>}</dd></div><div className="full"><dt>KGK-Pfad</dt><dd>{selected.kgkPath}</dd></div><div><dt>Preisart</dt><dd>{selected.priceType}</dd></div><div><dt>Einheit</dt><dd>{selected.unit}</dd></div><div><dt>Preis</dt><dd className="detail-total">{formatMoney(selected.price)}</dd></div><div><dt>Preisstand</dt><dd>Q3 2026</dd></div><div className="full"><dt>Quelle</dt><dd>{selected.source ?? "—"}</dd></div><div className="full"><dt>Fundstelle</dt><dd>{selected.sourceLocation ?? "—"}</dd></div></dl>
              {selected.explanation && <section><h4>Erläuterung</h4><p>{selected.explanation}</p></section>}
              {selected.reviewNote ? <div className="review-note"><AlertTriangle size={17} /><div><strong>Prüfhinweis</strong><p>{selected.reviewNote}</p></div></div> : <div className="review-note clear"><CheckCircle2 size={17} /><span>Kein Prüfhinweis im Katalogdatensatz.</span></div>}
              <div className="inline-alert warning compact"><AlertTriangle size={15} /><span>Verwendungsart und Planungsphase sind in der CSV nicht explizit klassifiziert. Eine Freigabe benötigt eine administrative Festlegung.</span></div>
            </> : <div className="empty-detail"><BookOpenText size={32} /><strong>Datensatz auswählen</strong></div>}
          </aside>
        </div>
      </section>
    </div>
  );
}
