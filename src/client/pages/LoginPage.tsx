import { ArrowRight, DatabaseZap, FileCheck2, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { ApiError, api } from "../lib/api";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.login(email.trim(), password);
      await refresh();
      const target = (location.state as { from?: string } | null)?.from ?? "/projects";
      navigate(target, { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Anmeldung derzeit nicht möglich.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand">
          <span className="brand-monogram light">IMV</span>
          <div>
            <strong>Kostenmanager</strong>
            <span>Ril 808</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow-light">Nachvollziehbare Kostenermittlungen</p>
          <h1>Von der Position bis zur Freigabe in einem klaren Arbeitsablauf.</h1>
          <p>
            Preise, Quellen, Annahmen und Änderungen bleiben über jede Projektversion hinweg prüfbar.
          </p>
        </div>
        <div className="assurance-grid">
          <div>
            <DatabaseZap size={21} />
            <strong>Versionierte Kataloge</strong>
            <span>Unveränderte Datensätze und Preisstände</span>
          </div>
          <div>
            <FileCheck2 size={21} />
            <strong>Prüfbare Exporte</strong>
            <span>Gleiche Summen in App, Excel und PDF</span>
          </div>
          <div>
            <ShieldCheck size={21} />
            <strong>Klare Freigaben</strong>
            <span>Blockierende Fehler bleiben sichtbar</span>
          </div>
        </div>
        <p className="login-disclaimer">Interne Anwendung der Ingenieurbüro Merkin &amp; Völker GmbH. Keine offizielle DB-Anwendung.</p>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="secure-pill"><LockKeyhole size={14} /> Geschützter Arbeitsbereich</div>
          <h2>Willkommen zurück</h2>
          <p>Melden Sie sich mit Ihrem internen Benutzerkonto an.</p>
          <form onSubmit={submit}>
            <label>
              E-Mail-Adresse
              <input
                autoComplete="username"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@unternehmen.de"
                required
              />
            </label>
            <label>
              Passwort
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
                required
              />
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button primary login-submit" disabled={submitting} type="submit">
              {submitting ? "Anmeldung läuft …" : "Anmelden"}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>
          <div className="login-help">
            <span>Kein Zugriff?</span>
            <a href="mailto:it@localhost">Administration kontaktieren</a>
          </div>
        </div>
      </section>
    </div>
  );
}
