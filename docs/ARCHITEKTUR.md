# Architektur

## Zielbild

Der IMV Kostenmanager 808 trennt Oberfläche, Fachlogik, Datenzugriff, Import und Export. Die Geschäftslogik hängt weder von Excel-Zelladressen noch von VBA ab. PostgreSQL ist die führende Laufzeitdatenbank; die bereitgestellte CSV bleibt die führende Importquelle für den Preis- und Positionskatalog.

```text
Browser
  │ HTTPS + HttpOnly-Session
  ▼
React-/Vite-Oberfläche
  │ JSON/Dateidownload über /api
  ▼
Express API
  ├─ Authentifizierung und RBAC
  ├─ Projekt-/Versionsservice
  ├─ Fachliche Berechnung und Validierung
  ├─ Katalogimport und Datenqualitätsprotokoll
  └─ JSON/CSV/XLSX/PDF-Exportmapping
  │
  ▼
PostgreSQL
  ├─ unveränderbare Katalogversionen
  ├─ Projekt- und Positionssnapshots
  ├─ Einheiten, Indexreihen, Berechnungsregeln und Klassifizierungen
  └─ Audit-Log
```

## Schichten

### Oberfläche

`src/client` enthält die React-Anwendung. Sie stellt Anmeldung, Projektübersicht, Projektassistent, Katalogsuche, dreigeteilten Kostenermittlungseditor, Mehrfachbearbeitung, persistentes Rückgängig/Wiederholen, Prüfung/Freigabe, Varianten-/Versionsvergleich, Berichte und Administration bereit. Die Oberfläche formatiert nach `de-DE`, führt aber keine freigaberelevante Berechtigung oder Preisberechnung als alleinige Wahrheit aus.

### API und Zugriffsschutz

`src/server/app.ts` stellt die Express-API bereit. Bis auf Anmeldung und Health-Check sind API-Routen authentifiziert. Ändernde Aufrufe werden zusätzlich gegen den erwarteten Origin geprüft. Eingaben werden mit Zod validiert.

Wichtige Schutzmechanismen:

- mit Node `scrypt` gehashte Passwörter
- zufällige Sitzungstoken; in der Datenbank liegt nur der Token-Hash
- signierte `HttpOnly`-Cookies, `SameSite=Strict`, in Produktion `Secure`
- Helmet-Sicherheitsheader
- serverseitige Rollen- und Projektmitgliedschaftsprüfung
- unveränderbare freigegebene Projektversionen
- Audit-Log mit altem und neuem Wert sowie Begründung

### Fachlogik

`src/shared/domain.ts` enthält testbare Funktionen für:

- deutsche Dezimal- und Geldlogik ohne binäre Gleitkomma-Rundung
- Einheitspreise: Menge × angewendeter Einheitspreis × Faktor
- Prozentansätze mit ausdrücklich gewählter Bezugsbasis
- Zuschläge als getrennte Positionen
- parameterabhängige Regeln; der MVP führt die geprüfte lineare Regel aus, weitere Regeltypen blockieren ohne Ausführungslogik statt `0,00 EUR` zu erzeugen
- negative Werte nur mit Bestätigung und Begründung
- Validierung von Klassifizierung, Preis, Einheit, Index, Quelle, manueller Änderung und Prüfhinweisen
- KGK-Rollup über sechs Ebenen

Die KGK-Ebenen folgen der im KEB belegten siebenstelligen Struktur mit Segmentbreiten `1/2/1/1/1/1`. KKK-Kostenkennwerte sind nur für Kostenschätzung in Grundlagenermittlung und Vorplanung zulässig; ab Kostenberechnung/LPH 3 blockiert ihre Verwendung. KKK-Kostenschätzungs-Einheiten bleiben unverändert, während die Kostenberechnung KGK-Mengeneinheiten nutzt. Ausprägungsfaktoren müssen gültig sein; andernfalls ist ein begründeter eigener Euro-Ansatz mit Bezug zur Ausprägung nötig (KEB 2022, Seiten 1–4).

In PostgreSQL werden Mengen und Geldwerte als `numeric` gespeichert. Im TypeScript-Domainmodell verwendet die Anwendung `decimal.js`; Geldwerte werden für Ausgaben auf zwei Dezimalstellen gerundet.

### Datenzugriff

`src/server/services/repository.ts` kapselt Transaktionen, Berechtigungsprüfung, Projekte, Versionen, Positionen, Suche, Validierung, Freigabe und Audit. `src/server/db/schema.ts` dokumentiert das relationale Schema mit Drizzle. Die reproduzierbare Initialmigration liegt unter `drizzle/`.

### Import

`src/server/services/catalog-import.ts` liest UTF-8-BOM, Semikolon, deutsche Dezimalzahlen, Quotes und eingebettete Zeilenumbrüche. Der Parser speichert neben normalisierten Feldern den vollständigen ursprünglichen Feldsatz als JSON-Rohsnapshot.

Vor dem Schreiben werden Schema, IDs, Pflichtfelder, Zahlen, Preise/Regeln, Einheiten, Klassifizierung und Indexangaben analysiert. Jeder Import erzeugt:

- eine neue unveränderbare `catalog_versions`-Zeile
- normalisierte `price_items`
- `kgk_nodes`
- `catalog_import_issues`
- SHA-256 der Quelldatei und aggregierte Importstatistik

`Datensatz_ID` ist innerhalb einer Katalogversion eindeutig. `Position_ID` ist optional und niemals alleiniger Primärschlüssel.

### Export

`src/server/services/export-mapping.ts` bildet Projekt-, Versions-, Positions-, Quellen- und Prüfdaten in ein neutrales Exportmodell ab. `src/server/services/exports.ts` erzeugt daraus JSON, CSV, Excel und PDF. Damit bleibt die Berechnung unabhängig von einer konkreten Arbeitsmappe; spätere Vorlagenänderungen erfordern nur ein angepasstes Mapping bzw. Layout.

## Relationales Modell

Die Kernbeziehungen sind:

```text
users ──< sessions
users ──< project_members >── projects
projects ──< project_versions ──< estimate_lines
catalog_versions ──< price_items
catalog_versions ──< kgk_nodes
catalog_versions ──< catalog_import_issues
index_series ──< index_values
index_series ──< catalog_versions
unit_registry
calculation_rules
price_items ──(Snapshot bei Übernahme)──> estimate_lines
projects/project_versions/estimate_lines ──< audit_log
```

Eine Kostenermittlungsposition enthält ihren Katalogbezug und zusätzlich den fachlichen Snapshot. Ein späterer Katalogimport darf vorhandene Projektversionen nicht verändern.

## Versionierung und Freigabe

Projektversionen durchlaufen `draft`, `internal_review`, `released` und `archived`. Bei einer Freigabe:

1. führt der Server den vollständigen Prüflauf aus,
2. verweigert er die Freigabe bei blockierenden Fehlern,
3. berechnet er Summen aus denselben Zeilenwerten wie die Exporte,
4. bildet er eine SHA-256-Prüfsumme über Version, Positionen und Summen,
5. setzt er `immutable=true`, Freigeber und Zeitpunkt,
6. protokolliert er die Aktion im Audit-Log.

Änderungen an einer freigegebenen Fassung müssen in einer neuen Version erfolgen. Administratoren und Bearbeiter können jede zugängliche Version als neuen bearbeitbaren Snapshot klonen. Für dieselbe Variante wird die Versionsnummer hochgezählt; ein anderer Variantenname beginnt eine eigene Nummernfolge. Der Vergleich zeigt hinzugefügte, entfernte, geänderte und unveränderte Positionen sowie absolute und prozentuale Summendifferenzen.

## Administrative Fachkonfiguration

Die Administrationsoberfläche und `AdminService` pflegen nachvollziehbar:

- Benutzer, Rollen, Aktivstatus und Projektmitgliedschaften
- Einheitenregister mit explizitem Freigabestatus
- versionierte Indexreihen, Quartalswerte, Fundstellen und die ausdrückliche Zuordnung zu einer Katalogversion
- versionierte Berechnungsregeln mit Parameterschema und Freigabestatus
- Verwendungsart `detail`/`kkk`, zulässigen LPH-Bereich und Fachquelle ausgewählter Katalogpositionen

Diese Entscheidungen erzeugen Audit-Einträge. Die Freigabeprüfung blockiert nicht freigegebene Einheiten und Regeln, ungeklärte Katalog-Indexkonflikte, unklassifizierte Positionen sowie fehlende Zielindexwerte.

Für Q3 2026 übernimmt eine Projektposition den importierten Zielpreis. Bei einem abweichenden Zielquartal wird der Preis beim Übernehmen aus Ausgangspreis, Basisindex und dem konkreten Quartalswert der bestätigten Katalog-Indexreihe berechnet. Fehlt eine der fachlich bestätigten Grundlagen, bleibt der angewendete Preis leer bzw. die Version nicht freigabefähig.

## Suche und Skalierung

Die Katalogsuche läuft serverseitig auf PostgreSQL und ist für mehrere Tausend Datensätze ausgelegt. Neben Katalogversion, KGK-Code und Position-ID wird ein erweiterter GIN-Suchindex über KGK, Pfad, Bezeichnung, Erläuterung, Grundlage, Quelle, Fundstelle und EPK-Quellcodes geführt. Filter für Einheit, Preisart, Quelle, Verwendungsart und zulässige Planungsphase werden serverseitig angewendet. Für deutlich größere Datenmengen sind Query-Plan-Messungen und gegebenenfalls eine materialisierte Suchspalte ein späterer Skalierungsschritt.

## Lokale QA und Produktion

- **PGlite:** eingebetteter PostgreSQL-Modus für Entwicklung, Tests und visuelle QA. Kein Mehrbenutzer-Produktivbetrieb.
- **PostgreSQL:** verbindliche Produktionsdatenbank.
- **Docker Compose:** lokaler, produktionsnaher Betrieb mit App und PostgreSQL.
- **Containerplattform:** produktive Ausführung hinter TLS-Reverse-Proxy und mit verwalteter Secret-/Backup-Infrastruktur.

## Sicherheits- und Betriebsgrenzen

Der Quellcode enthält keine CSV-Katalogdaten und keine Produktivgeheimnisse. Produktiver Betrieb verlangt zusätzlich:

- ausschließlich HTTPS und korrekte `APP_ORIGIN`
- Secret-Verwaltung statt `.env` im Repository
- private Datenbank und restriktive Netzwerkregeln
- verschlüsselte Backups und dokumentierter Restore-Test
- zentrale, manipulationsgeschützte Logs bzw. Audit-Export
- Benutzer-Offboarding und regelmäßige Rollenprüfung
- Virenprüfung und Größenbegrenzung, sobald Anhänge aktiviert werden
- Aufbewahrungs-, Lösch- und Datenschutzkonzept
- gegebenenfalls Unternehmens-SSO statt lokaler Anmeldung

Ohne diese Betriebsmaßnahmen darf der MVP nicht als formal revisionssicher bezeichnet werden.
