# IMV Kostenmanager 808

Interne Full-Stack-Webanwendung zum Erstellen, Prüfen, Versionieren und Ausgeben von Kostenermittlungen im Umfeld der Ril 808. Die Anwendung ersetzt keine fachliche Freigabe: Unklare Katalogklassifizierungen, offene Prüfhinweise und widersprüchliche Indexangaben werden sichtbar geführt und blockieren die Freigabe.

Die Oberfläche ist deutschsprachig und für Desktop-Arbeitsplätze ausgelegt. Es wird kein DB-Logo verwendet; die Anwendung ist keine offizielle oder zertifizierte Anwendung der Deutschen Bahn.

## Funktionsumfang

- Rollenbasierte Anmeldung mit Administrator, Bearbeiter, Prüfer/Freigeber und Leser
- Projekt-, Varianten- und Versionsverwaltung mit Klonen, Positionsvergleich und unveränderbaren freigegebenen Versionen
- Kostenermittlungseditor mit KGK-Navigation, Positionstabelle und Detail-/Prüfbereich
- Robuster, versionierter CSV-Import einschließlich Rohdaten-Snapshot und Importprotokoll
- Katalogsuche über KGK, Datensatz-/Position-ID, EPK-Quellcode, Freitext, Einheit, Preisart, Quelle, Verwendungsart und Planungsphase
- Einheitspreise, feste Zuschläge, Prozentansätze mit expliziter Bezugsbasis und parameterabhängige Regeln
- Manuelle Preise mit Quelle, Preisstand, Begründung und Audit-Log
- Prüfregeln mit Hinweisen, Warnungen und blockierenden Fehlern
- KGK-Summen, Netto/Umsatzsteuer/Brutto sowie JSON-, CSV-, Excel- und PDF-Export
- Administration für Benutzer/Rollen, Projektzugriffe, Einheitenfreigaben, versionierte Indexreihen, Berechnungsregeln und Katalogklassifizierung
- Reproduzierbare Migrationen, Seed, Tests und Container-Build

## Technischer Aufbau

- React, TypeScript und Vite im Frontend
- Express und TypeScript im Backend
- PostgreSQL in Produktion; PGlite nur für lokale Entwicklung und automatisierte QA
- Drizzle-Schema und SQL-Migrationen
- `decimal.js` und PostgreSQL-`numeric` für Geld- und Mengenlogik
- ExcelJS und PDFKit für serverseitige Exporte

Details stehen in [Architektur](docs/ARCHITEKTUR.md), [Datenmapping](docs/DATENMAPPING.md), [Abnahme](docs/ABNAHME.md) und [Deployment](docs/DEPLOYMENT.md).

## Voraussetzungen

- Node.js 22 oder neuer
- pnpm 11 oder neuer
- für den produktionsnahen Betrieb: Docker mit PostgreSQL oder eine erreichbare PostgreSQL-Instanz
- die Katalog-CSV auf einem privaten Datenträger; sie wird nicht in Git eingecheckt

## Lokaler Schnellstart mit PGlite

PGlite ist ein eingebetteter PostgreSQL-Laufzeitmodus für Entwicklung und QA. Er ist nicht für den Mehrbenutzer-Produktivbetrieb vorgesehen.

```powershell
Copy-Item .env.example .env
```

In `.env` setzen:

```dotenv
DATABASE_URL=pglite://./data/dev
SESSION_SECRET=<mindestens-32-zufällige-Zeichen>
APP_ORIGIN=http://localhost:5173
SEED_ADMIN_EMAIL=admin@localhost
SEED_ADMIN_PASSWORD=<mindestens-12-Zeichen>
SEED_ADMIN_NAME=Lokale Administration
```

Dann:

```powershell
pnpm install
pnpm db:migrate
pnpm qa:catalog -- --file "C:\privat\Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv"
pnpm catalog:import -- --file "C:\privat\Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv" --name "Q3 2026" --year 2026 --quarter 3
pnpm db:seed
pnpm dev
```

Die Oberfläche läuft unter `http://localhost:5173`, die API unter `http://localhost:3000`.

`db:seed` legt den Administrator nur an, wenn er noch nicht existiert. Nach einem Katalogimport erzeugt es außerdem das Beispielprojekt `IMV-DEMO-808` mit mehreren KGK-Gruppen, Einheitspreis, Prozentansatz, Zuschlag, dokumentierter manueller Preisänderung und bewusst unvollständiger Berechnungsregel. Diese letzte Position muss die Freigabe blockieren.

Nach dem Erstimport werden die fachlichen Entscheidungen in **Administration** gepflegt: Einheiten freigeben, eine bestätigte Indexreihe einschließlich Quartalswerten anlegen und dem Katalog zuordnen, Berechnungsregeln freigeben sowie Katalogpositionen als Detailposition oder KKK mit zulässigem LPH-Bereich klassifizieren. Für den Preisstand Q3 2026 nutzt die Anwendung den importierten Zielpreis. Für andere Zielquartale wird nur mit einer dem Katalog zugeordneten, freigegebenen Indexreihe und vorhandenem Zielwert fortgeschrieben; andernfalls bleibt die Freigabe gesperrt.

## Lokaler Betrieb mit PostgreSQL

1. `.env.example` nach `.env` kopieren.
2. `POSTGRES_PASSWORD`, `SESSION_SECRET` und `SEED_ADMIN_PASSWORD` mit starken, unterschiedlichen Werten setzen.
3. PostgreSQL starten:

```powershell
docker compose up -d db
```

4. `DATABASE_URL` auf die PostgreSQL-Instanz setzen und aus dem Checkout initialisieren:

```powershell
pnpm db:migrate
pnpm catalog:import -- --file "C:\privat\katalog.csv" --name "Q3 2026" --year 2026 --quarter 3
pnpm db:seed
pnpm dev
```

## Qualitätsprüfungen

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm qa:catalog -- --file "C:\privat\Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv"
```

Die Katalogkontrolle erwartet beim bereitgestellten Erstimport:

| Kontrolle | Erwartung |
| --- | ---: |
| Datensätze | 6.719 |
| unterschiedliche KGK-Codes | 1.055 |
| Datensätze mit Prüfhinweis | 1.591 |
| doppelte `Datensatz_ID` | 0 |

Die Datei enthält tatsächlich 31 statt der spezifizierten 32 Spalten. `Position_ID` und eine explizite Tag-Spalte fehlen. Der Import führt das als Datenqualitätskonflikt; er erfindet keine Ersatzwerte.

## Katalogimport und Vertraulichkeit

Die CSV ist die führende Quelle für Preis- und Positionsdaten. Jeder Import erzeugt eine eigene, unveränderbare Katalogversion mit SHA-256-Prüfsumme, Rohdaten-Snapshot und Prüfprotokoll. Bereits übernommene Projektpositionen behalten ihren fachlichen Snapshot.

Quelldateien und Produktivdaten gehören nicht in das Repository oder ein öffentliches Container-Image. Der Ordner `data/` und typische Katalogformate sind über `.gitignore` ausgeschlossen. Für einen Serverimport wird die Datei nur auf einem privaten Administrationsrechner oder als read-only Secret/Volume bereitgestellt.

## Rollen

| Rolle | Wesentliche Rechte |
| --- | --- |
| Administrator | Kataloge, Konflikte, Benutzer und alle Projekte verwalten |
| Bearbeiter | Projekte anlegen sowie zugewiesene Entwürfe bearbeiten, klonen und vergleichen |
| Prüfer/Freigeber | zugewiesene Projekte prüfen und freigeben |
| Leser | zugewiesene Projekte und Exporte lesen |

Projektzugriffe und Freigaben werden serverseitig geprüft. Ein ausgeblendeter Button im Frontend ist keine Berechtigungskontrolle.

## GitHub-Deployment

GitHub Pages ist für diese Anwendung ungeeignet: Es liefert nur statische Dateien und bietet weder geschützte serverseitige Rechteprüfung noch PostgreSQL, Sitzungen oder revisionsfähige Audit-Logs.

Der vorgesehene Weg ist ein privates GitHub-Repository mit CI/CD, Docker-Image und Deployment auf einen Containerdienst oder eine interne Plattform mit PostgreSQL, zum Beispiel Render, Railway, Azure Container Apps oder Kubernetes. Die enthaltenen GitHub-Actions prüfen Pull Requests und `main`; ein zweiter Workflow veröffentlicht Images nach GHCR. Siehe [Deployment](docs/DEPLOYMENT.md).

## Bekannte fachliche Festlegungen vor Produktivbetrieb

- CSV und Excel nennen für denselben Zielindex unterschiedliche Quellen/Reihen. Die CSV nennt BKI und „Neubau Wohngebäude insgesamt“, die Excel-Referenz Destatis und „Brücken im Straßenbau“. Das wird nicht automatisch zusammengeführt.
- `Position_ID`, Tags sowie eine explizite KKK-/Detail- und Planungsphasenklassifizierung fehlen in der CSV.
- Die bereitgestellte Excel-Vorlage enthält zahlreiche defekte Namen und `#REF!`-Formeln. Sie dient nur als Layout-/Mappingreferenz; vorhandene Formeln werden nicht als Geschäftslogik übernommen.
- Es wurden keine VBA-Makros ausgeführt.
- Das vorhandene Einheiten- und Regelregister muss vor einer produktiven Freigabe fachlich gepflegt werden. Im MVP wird als ausführbare Parameterregel ausschließlich die lineare Regel ausgewertet; weitere Regeltypen benötigen eine zusätzliche, getestete Ausführungslogik.

Aus dem KEB 2022 (Seiten 1–4) sind die KGK-Struktur mit sieben Zeichen/sechs Ebenen sowie die Verwendungsgrenze für KKK-Kennwerte belegt: Kennwerte nur für Kostenschätzung in Grundlagenermittlung/Vorplanung, nicht ab Kostenberechnung bzw. LPH 3. KKK-Einheiten dürfen nicht geändert werden; in der Kostenberechnung gelten KGK-Mengeneinheiten.

## Sicherheitshinweis

Der MVP stellt technische Schutzmechanismen bereit, ist aber ohne Betriebsmaßnahmen nicht automatisch „revisionssicher“. Für den Produktivbetrieb sind mindestens TLS, ein privates Netzwerk bzw. geeigneter Zugriffsschutz, Datenbank-Backups mit Wiederherstellungstest, zentrale Protokollierung, Secret-Verwaltung, Benutzer-Lifecycle und ein dokumentiertes Aufbewahrungs-/Löschkonzept erforderlich.
