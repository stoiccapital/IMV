# Deployment über GitHub

## Warum GitHub Pages nicht genügt

GitHub Pages liefert statische HTML-, CSS- und JavaScript-Dateien. Der IMV Kostenmanager benötigt dagegen:

- eine serverseitige Anmeldung und Sitzungen,
- serverseitig erzwungene Rollen und Projektzugriffe,
- eine private PostgreSQL-Datenbank,
- unveränderbare Versions- und Katalogsnapshots,
- Audit-Logs,
- serverseitige Excel-/PDF-Erzeugung,
- vertrauliche Preis- und Projektkostendaten.

Eine Pages-Variante mit Browser-Speicher wäre höchstens eine lokale Demo. Sie wäre weder ein sicherer interner Mehrbenutzerbetrieb noch eine revisionsfähige Anwendung.

„Über GitHub deploybar“ bedeutet für dieses Projekt: privates Repository, automatisierte Qualitätsprüfung, reproduzierbarer Docker-Build und Deployment des Images auf eine geeignete Containerplattform mit PostgreSQL.

Im Repository liegen zwei Workflows: `.github/workflows/ci.yml` führt bei Pull Requests und Änderungen an `main` Typecheck, Tests und Build aus. `.github/workflows/container.yml` prüft Änderungen an `main` und Tags `v*`, baut anschließend das Docker-Image und veröffentlicht unveränderbar referenzierbare Tags in GHCR. Der Workflow deployt bewusst nicht selbst auf eine konkrete Zielplattform; dafür werden deren Zugang, Zielname und Freigabeverfahren benötigt.

## Zielarchitektur

```text
Privates GitHub-Repository
  ├─ Pull Request: Typecheck + Tests + Build
  └─ Main/Tag: Docker-Image bauen und in private Registry schreiben
                         │
                         ▼
             Render / Railway / Azure / interne Plattform
                         │
                HTTPS-Reverse-Proxy
                         │
                 private PostgreSQL-DB
```

Mögliche Plattformen sind Render, Railway, Azure Container Apps, Kubernetes/OpenShift oder eine interne Docker-Plattform. Die Plattform muss persistente PostgreSQL-Daten, private Secrets, TLS, Backups und Netzwerkregeln unterstützen.

## GitHub-Repository

- Repository auf **privat** setzen.
- Branch Protection für `main` aktivieren.
- Änderungen nur nach erfolgreicher CI und Review mergen.
- Katalog-CSV, Excel-/PDF-Quellen, `.env`, Datenbanken und Exporte nicht committen.
- Container Registry ebenfalls privat halten, sofern das Unternehmenskonzept nichts anderes erlaubt.
- Nach dem ersten Push die Sichtbarkeit des GHCR-Pakets und dessen Zugriffsvererbung ausdrücklich kontrollieren.

## Erforderliche Konfiguration

| Variable | Produktion |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | vom Host vorgegeben, standardmäßig `3000` |
| `DATABASE_URL` | TLS-geschützte PostgreSQL-Verbindung |
| `SESSION_SECRET` | mindestens 32 kryptografisch zufällige Zeichen |
| `APP_ORIGIN` | exakte öffentliche HTTPS-Origin, ohne zusätzlichen Pfad |
| `SEED_ADMIN_EMAIL` | nur für den einmaligen Initialisierungslauf |
| `SEED_ADMIN_PASSWORD` | einmaliges starkes Kennwort; danach rotieren/entfernen |
| `SEED_ADMIN_NAME` | sichtbarer Name der ersten Administration |

`POSTGRES_PASSWORD` wird nur für das lokale Compose-Beispiel verwendet. In einer verwalteten Plattform kommt die komplette Verbindung über `DATABASE_URL` aus dem Secret Store.

## Build

Der Docker-Build ist reproduzierbar über `pnpm-lock.yaml`:

```bash
docker build -t imv-kostenmanager-808:0.1.0 .
```

Der Container startet die Express-Anwendung und liefert die gebaute React-Oberfläche aus. Die Anwendung führt beim Serverstart die idempotente Migration aus. Für kontrollierte Produktionsänderungen sollte die Plattform denselben Migrationsschritt als einmaligen Release-Job vor dem Rollout ausführen und erst danach die Web-Instanzen starten.

## Einmalige Initialisierung

Seed und Katalogimport werden bewusst nicht in jedem Web-Containerstart wiederholt. Sie laufen einmalig aus einem geschützten Administrationsarbeitsplatz bzw. CI-Job mit temporärem Datenbankzugang:

```bash
pnpm db:migrate
pnpm qa:catalog -- --file /secure/input/Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv
pnpm catalog:import -- --file /secure/input/Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv --name "Q3 2026" --year 2026 --quarter 3
pnpm db:seed
```

Wichtig:

- Die CSV darf nicht in CI-Artefakten, Logs oder im Docker-Image landen.
- Ein Serverimport erhält die Datei über einen kurzlebigen privaten Runner, Secret-Download oder read-only Mount.
- `qa:catalog` muss vor dem Import die Kontrollwerte 6.719/1.055/1.591 bestätigen.
- Der bekannte 31/32-Spaltenkonflikt, die fehlende `Position_ID`, fehlende Tags und der Indexquellenkonflikt bleiben als Importprobleme gespeichert.
- Der erste Administrator muss das Startkennwort unmittelbar ändern bzw. das Konto an das spätere Identitätssystem anbinden.
- Vor der ersten fachlichen Freigabe müssen in der Administrationsoberfläche Einheiten, Indexreihe/-werte, Katalogzuordnung, Klassifizierungen und benötigte Berechnungsregeln bestätigt sowie Projektmitgliedschaften geprüft werden.

## Beispiel GitHub Actions

Eine CI-Pipeline sollte mindestens ausführen:

```yaml
- run: corepack enable
- run: pnpm install --frozen-lockfile
- run: pnpm typecheck
- run: pnpm test
- run: pnpm build
```

Für ein Container-Release:

1. GitHub OIDC oder ein eng begrenztes Registry-Token verwenden.
2. Image mit Commit-SHA und SemVer-Tag bauen.
3. Image-SHA im Deployment festhalten; nicht nur `latest` verwenden.
4. Migration/Smoke-Test ausführen.
5. Erst danach Traffic auf die neue Version umschalten.

GitHub-Secrets dürfen nur Verbindungsdaten oder Deployment-Token enthalten. Produktive CSV- und Projektdaten gehören nicht in GitHub Secrets, weil sie zu groß und fachlich vertraulich sind.

## Plattformhinweise

### Render oder Railway

- Repository bzw. privates Container-Image verbinden.
- verwaltete PostgreSQL-Datenbank anlegen.
- `DATABASE_URL`, `SESSION_SECRET` und `APP_ORIGIN` als Secrets setzen.
- Health-Check auf `/api/health` konfigurieren.
- interne Datenbankverbindung verwenden; öffentliche DB-Zugriffe deaktivieren oder auf Admin-IP/Runner begrenzen.

### Azure Container Apps

- Image in Azure Container Registry oder GHCR ablegen.
- PostgreSQL Flexible Server mit privatem Zugriff verwenden.
- Secrets in Container Apps bzw. Key Vault pflegen.
- Ingress ausschließlich HTTPS; Minimal-/Maximalreplikate passend zum Sitzungs-/DB-Pool wählen.

### Interne Plattform / Kubernetes

- Deployment, Service, Ingress und NetworkPolicy definieren.
- Secret Store/External Secrets verwenden.
- PostgreSQL außerhalb des Web-Pods betreiben.
- Pod-Security, Read-only Root Filesystem und Ressourcenlimits aktivieren, soweit die Plattform dies unterstützt.

## Release-Checkliste

- [ ] CI: Typecheck, Tests und Build erfolgreich
- [ ] Image anhand Commit-SHA eindeutig identifizierbar
- [ ] Datenbank-Backup vor Migration erstellt und Restore getestet
- [ ] Migration in Staging erfolgreich
- [ ] `APP_ORIGIN` entspricht exakt der HTTPS-Adresse
- [ ] `SESSION_SECRET` und DB-Zugang nicht im Repository
- [ ] Seed-Kennwort entfernt/rotiert
- [ ] Katalogimportprotokoll geprüft
- [ ] Indexkonflikt administrativ entschieden oder Freigabeservices weiterhin gesperrt
- [ ] Rollen und Projektmitgliedschaften geprüft
- [ ] Export-Summen mit UI-Summen centgenau verglichen
- [ ] Monitoring für `/api/health`, Fehlerquote und Datenbankverbindungen aktiv
- [ ] Backup-/Restore- und Aufbewahrungsverfahren dokumentiert

## Rollback

Ein Rollback besteht aus zwei getrennten Entscheidungen:

1. **Anwendung:** vorheriges, unveränderbares Image anhand seiner Digest/SHA erneut deployen.
2. **Datenbank:** Migrationen sind grundsätzlich vorwärtsgerichtet. Ein Datenbank-Restore erfolgt nur nach geprüftem Runbook, da ein einfaches Zurücksetzen neue fachliche Änderungen verlieren kann.

Freigegebene Projektversionen und Katalogversionen werden nicht durch ein Anwendungsrollback überschrieben.
