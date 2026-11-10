import { CopyPlus, X } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "../lib/api";

export function CloneVersionButton({
  projectId,
  versionId,
  currentVariant,
  onCreated,
  className = "button secondary",
  label = "Neue Version",
}: {
  projectId: string;
  versionId: string;
  currentVariant: string;
  onCreated: (versionId: string) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [variantName, setVariantName] = useState(currentVariant || "Basis");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (!variantName.trim() || reason.trim().length < 3) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.cloneVersion(projectId, versionId, variantName.trim(), reason.trim());
      onCreated(result.version.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Die neue Version konnte nicht angelegt werden.");
      setSaving(false);
    }
  };

  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)}><CopyPlus size={17} /> {label}</button>
      {open && <div className="clone-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section className="clone-dialog" role="dialog" aria-modal="true" aria-labelledby="clone-version-title">
          <div className="clone-dialog-head"><div><p className="eyebrow">Versionierung</p><h3 id="clone-version-title">Bearbeitbare Version anlegen</h3></div><button type="button" aria-label="Dialog schließen" onClick={() => setOpen(false)}><X size={18} /></button></div>
          <p>Alle Positionen und ihre fachlichen Snapshots werden kopiert. Die bestehende Version bleibt unverändert.</p>
          <label>Variante<input value={variantName} onChange={(event) => setVariantName(event.target.value)} maxLength={100} autoFocus /></label>
          <label>Änderungsgrund<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} placeholder="Anlass und Ziel der neuen Version dokumentieren" /></label>
          {error && <div className="inline-alert error">{error}</div>}
          <div className="clone-dialog-actions"><button className="button secondary" type="button" onClick={() => setOpen(false)}>Abbrechen</button><button className="button primary" type="button" disabled={saving || !variantName.trim() || reason.trim().length < 3} onClick={() => void create()}>{saving ? "Wird angelegt …" : "Version anlegen"}</button></div>
        </section>
      </div>}
    </>
  );
}
