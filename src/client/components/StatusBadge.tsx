import { AlertTriangle, CheckCircle2, CircleDot, Info, LockKeyhole, ShieldAlert } from "lucide-react";
import type { LineStatus, ProjectStatus, Severity } from "../lib/api";

type SupportedStatus = ProjectStatus | LineStatus | Severity | "classified" | "review_required";

const labels: Record<SupportedStatus, string> = {
  draft: "Entwurf",
  internal_review: "Interne Prüfung",
  released: "Freigegeben",
  archived: "Archiviert",
  ready: "Bereit",
  review: "Prüfen",
  blocked: "Blockiert",
  info: "Hinweis",
  warning: "Warnung",
  error: "Fehler",
  classified: "Klassifiziert",
  review_required: "Fachlich prüfen",
};

export function StatusBadge({ status, compact = false }: { status: SupportedStatus; compact?: boolean }) {
  const Icon =
    status === "released" || status === "ready" || status === "classified"
      ? CheckCircle2
      : status === "blocked" || status === "error"
        ? ShieldAlert
        : status === "warning" || status === "review" || status === "review_required"
          ? AlertTriangle
          : status === "archived"
            ? LockKeyhole
            : status === "info"
              ? Info
              : CircleDot;

  return (
    <span className={`status-badge status-${status} ${compact ? "compact" : ""}`}>
      <Icon size={compact ? 12 : 14} />
      {labels[status]}
    </span>
  );
}
