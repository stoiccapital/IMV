import { ArrowLeft, ArrowRight, Check, CirclePlus, Info } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { ApiError, api } from "../lib/api";

const steps = ["Stammdaten", "Kostenermittlung", "Preisstand", "Prüfen"];

const initialForm = {
  projectNumber: "",
  name: "",
  client: "",
  route: "",
  kilometerFrom: "",
  kilometerTo: "",
  projectManager: "",
  editor: "",
  planningPhase: "LPH 2",
  estimateType: "detailed",
  priceYear: 2026,
  priceQuarter: 3,
  catalogVersion: "Q3 2026",
  grossMode: false,
};

export function ProjectWizardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof typeof form, value: string | number | boolean) => setForm((current) => ({ ...current, [field]: value }));

  const next = (event: FormEvent) => {
    event.preventDefault();
    const phase = Number(form.planningPhase.match(/\d+/)?.[0] ?? 0);
    if (step === 1 && form.estimateType === "kkk" && phase >= 3) {
      setError("Kostenkennwerte des KKK sind ab Kostenberechnung/LPH 3 nicht zulässig. Wählen Sie eine detaillierte Kostenermittlung.");
      return;
    }
    setError("");
    if (step < steps.length - 1) setStep((value) => value + 1);
  };

  const createProject = async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = await api.createProject(form);
      navigate(`/projects/${result.project.id}/versions/${result.project.currentVersionId}`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Das Projekt konnte nicht angelegt werden.");
    } finally {
      setSubmitting(false);
    }
  };

  if (user?.role !== "admin" && user?.role !== "editor") {
    return <div className="empty-state access-denied"><Info size={34} /><strong>Nur für Bearbeiter und Administratoren</strong><span>Ihre Rolle besitzt Lese- beziehungsweise Prüfrechte, darf aber keine neuen Projekte anlegen.</span><Link className="button secondary" to="/projects"><ArrowLeft size={17} /> Zur Projektübersicht</Link></div>;
  }

  return (
    <div className="wizard-page">
      <div className="wizard-header">
        <Link to="/projects" className="back-link"><ArrowLeft size={16} /> Projektübersicht</Link>
        <div>
          <p className="eyebrow">Projektassistent</p>
          <h2>Neue Kostenermittlung anlegen</h2>
          <p>Die Angaben bilden den prüfbaren Projekt- und Versionsrahmen.</p>
        </div>
      </div>

      <div className="wizard-layout">
        <aside className="wizard-steps">
          {steps.map((label, index) => (
            <button type="button" key={label} className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} onClick={() => index <= step && setStep(index)}>
              <span>{index < step ? <Check size={15} /> : index + 1}</span>
              <div><strong>{label}</strong><small>{index === step ? "In Bearbeitung" : index < step ? "Abgeschlossen" : "Noch offen"}</small></div>
            </button>
          ))}
        </aside>

        <form className="wizard-card" onSubmit={next}>
          {step === 0 && (
            <>
              <div className="section-title"><span>01</span><div><h3>Projektstammdaten</h3><p>Eindeutige Zuordnung und Verantwortlichkeiten.</p></div></div>
              <div className="form-grid two">
                <label>Projektnummer<input required value={form.projectNumber} onChange={(e) => update("projectNumber", e.target.value)} placeholder="z. B. 26D000" /></label>
                <label>Auftraggeber<input required value={form.client} onChange={(e) => update("client", e.target.value)} placeholder="Organisation oder Bereich" /></label>
                <label className="full">Projektbezeichnung<input required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Aussagekräftige Projektbezeichnung" /></label>
                <label>Strecke<input value={form.route} onChange={(e) => update("route", e.target.value)} placeholder="Streckennummer / Abschnitt" /></label>
                <div className="field-group"><label>km von<input value={form.kilometerFrom} onChange={(e) => update("kilometerFrom", e.target.value)} /></label><label>km bis<input value={form.kilometerTo} onChange={(e) => update("kilometerTo", e.target.value)} /></label></div>
                <label>Projektleitung<input required value={form.projectManager} onChange={(e) => update("projectManager", e.target.value)} /></label>
                <label>Bearbeitung<input required value={form.editor} onChange={(e) => update("editor", e.target.value)} /></label>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="section-title"><span>02</span><div><h3>Art der Kostenermittlung</h3><p>Die Auswahl steuert Zulässigkeits- und Prüfregeln.</p></div></div>
              <div className="form-grid two">
                <label>Planungsphase
                  <select value={form.planningPhase} onChange={(e) => update("planningPhase", e.target.value)}>
                    {[1,2,3,4,5,6,7,8,9].map((value) => <option key={value}>LPH {value}</option>)}
                  </select>
                </label>
                <div />
              </div>
              <div className="choice-grid">
                <button type="button" className={form.estimateType === "detailed" ? "selected" : ""} onClick={() => update("estimateType", "detailed")}>
                  <span className="choice-radio" />
                  <strong>Detaillierte Kostenermittlung</strong>
                  <p>Menge, Mengeneinheit und belastbarer Einheitspreis je Position.</p>
                </button>
                <button type="button" className={form.estimateType === "kkk" ? "selected" : ""} onClick={() => update("estimateType", "kkk")}>
                  <span className="choice-radio" />
                  <strong>Kostenkennwerte und Ausprägungen</strong>
                  <p>Nur explizit klassifizierte Kennwerte und zulässige Kostenermittlungseinheiten.</p>
                </button>
              </div>
              <div className="inline-alert info"><Info size={17} /><span>Unklar klassifizierte Positionen dürfen im Entwurf verwendet werden, blockieren jedoch die Freigabe.</span></div>
              {error && <div className="inline-alert error">{error}</div>}
            </>
          )}

          {step === 2 && (
            <>
              <div className="section-title"><span>03</span><div><h3>Preisstand und Katalog</h3><p>Preise und Texte werden beim Übernehmen als Snapshot gespeichert.</p></div></div>
              <div className="form-grid two">
                <label>Katalogversion<select value={form.catalogVersion} onChange={(e) => update("catalogVersion", e.target.value)}><option>Q3 2026</option></select></label>
                <label>Preisstand
                  <div className="field-group"><select value={form.priceQuarter} onChange={(e) => update("priceQuarter", Number(e.target.value))}>{[1,2,3,4].map((q) => <option value={q} key={q}>Q{q}</option>)}</select><input type="number" value={form.priceYear} onChange={(e) => update("priceYear", Number(e.target.value))} /></div>
                </label>
              </div>
              <label className="toggle-row"><input type="checkbox" checked={form.grossMode} onChange={(e) => update("grossMode", e.target.checked)} /><span className="toggle" /><div><strong>Bruttodarstellung zusätzlich anzeigen</strong><small>Netto bleibt die führende Berechnungsbasis.</small></div></label>
              <div className="source-lock-card"><div><strong>{form.priceYear === 2026 && form.priceQuarter === 3 ? "Gespeicherter Zielpreis" : "Preisfortschreibung"}</strong><span>{form.priceYear === 2026 && form.priceQuarter === 3 ? "Preis_Q3_2026_EUR" : "Ausgangspreis × Index Ziel / Index Basis"}</span></div><div><strong>Indexstatus</strong><span className={form.priceYear === 2026 && form.priceQuarter === 3 ? "success-text" : "warning-text"}>{form.priceYear === 2026 && form.priceQuarter === 3 ? "Katalogzielpreis zulässig" : "Freigegebene Reihe und Zielwert erforderlich"}</span></div></div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="section-title"><span>04</span><div><h3>Angaben prüfen</h3><p>Nach dem Anlegen startet die Projektversion im Entwurf.</p></div></div>
              <dl className="review-grid">
                <div><dt>Projekt</dt><dd>{form.projectNumber || "—"}<strong>{form.name || "—"}</strong></dd></div>
                <div><dt>Auftraggeber</dt><dd>{form.client || "—"}</dd></div>
                <div><dt>Verantwortung</dt><dd>{form.projectManager || "—"}<span>Bearbeitung: {form.editor || "—"}</span></dd></div>
                <div><dt>Verfahren</dt><dd>{form.estimateType === "detailed" ? "Detaillierte Kostenermittlung" : "Kostenkennwerte"}<span>{form.planningPhase}</span></dd></div>
                <div><dt>Preisbasis</dt><dd>{form.catalogVersion}<span>Zielpreis Q{form.priceQuarter} {form.priceYear}</span></dd></div>
                <div><dt>Darstellung</dt><dd>{form.grossMode ? "Netto und Brutto" : "Netto"}</dd></div>
              </dl>
              {error && <div className="inline-alert error">{error}</div>}
            </>
          )}

          <div className="wizard-actions">
            <button type="button" className="button secondary" disabled={step === 0} onClick={() => setStep((value) => value - 1)}><ArrowLeft size={17} /> Zurück</button>
            {step < steps.length - 1 ? (
              <button type="submit" className="button primary">Weiter <ArrowRight size={17} /></button>
            ) : (
              <button type="button" className="button primary" disabled={submitting} onClick={() => void createProject()}><CirclePlus size={17} /> {submitting ? "Wird angelegt …" : "Projekt anlegen"}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
