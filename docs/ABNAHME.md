# Abnahme und Prüfnachweise

## Reproduzierbarer Prüflauf

Standardlauf ohne vertrauliche Quelldatei:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Zusätzlicher Lauf gegen die bereitgestellte private CSV:

```powershell
$env:CATALOG_TEST_FILE="C:\privat\Datenbank_Baupreise_Ril808_KGK_Q3_2026.csv"
pnpm test
pnpm qa:catalog -- --file $env:CATALOG_TEST_FILE
```

Die private Datei wird nur gelesen und nicht in Testartefakte kopiert. Der Test kann ohne `CATALOG_TEST_FILE` laufen; dann wird ausschließlich der private Erstimport-Test übersprungen, nicht die synthetische Parserprüfung.

## Aktuelle automatisierte Abdeckung

### Katalogimport

`tests/catalog-import.test.ts` prüft:

- deutsche Zahlen wie `1.234,56`, `40,57` und reale Nullwerte
- leere und nicht anwendbare Angaben ohne Umdeutung zu Null
- UTF-8-BOM und Semikolon
- eingebettete Semikolons, doppelte Quotes und Zeilenumbrüche
- Erhalt des ursprünglichen Feldinhalts im Rohdatensatz
- beim privaten Erstimport: 6.719 Datensätze, 1.055 KGK-Codes, 1.591 Prüfhinweise
- 31 statt 32 Spalten und fehlende `Position_ID`
- Preisartverteilung 6.591/86/21/21
- eindeutige `Datensatz_ID`
- sichtbare Schema-, Tag- und Indexquellenkonflikte

### Fachliche Berechnung

`tests/domain.test.ts` prüft:

- Menge × Einheitspreis × Faktor mit kaufmännischer Cent-Rundung
- Prozentansatz ausschließlich auf ausdrücklich gewählter Bezugsbasis
- blockierenden Fehler bei fehlender Prozentbasis
- blockierenden Fehler statt Nullpreis bei unvollständiger Parameterregel
- Pflichtmetadaten bei manueller Preisänderung
- Bestätigung und Begründung negativer Werte
- Freigabesperre bei unklarer Klassifizierung und offenem Prüfhinweis
- sechs KGK-Ebenen aus siebenstelligem Textcode
- Rollup auf übergeordnete KGK-Ebenen

### API

`tests/api.test.ts` läuft mit einem flüchtigen PGlite-PostgreSQL und prüft:

- Projektzugriff ohne Anmeldung wird abgewiesen
- Anmeldung gibt keinen Passwort-Hash aus
- Projekt- und Positionserstellung
- serverseitige Berechnung der Zeilensumme
- Freigabe wird bei unvollständiger Berechnungsregel abgewiesen
- JSON-Export verwendet dieselbe Nettosumme wie die gespeicherten Positionen

`tests/api.test.ts` prüft zusätzlich:

- die KKK-Sperre ab LPH 3
- das Klonen eines unveränderbaren Snapshots
- Versionslisten sowie Positions- und Summendifferenzen im Versionsvergleich

`tests/acceptance-integration.test.ts` prüft über die HTTP-API und eine reale PGlite-Datenbank:

- Suche nach KGK, Position-ID und Freitext
- Pflichtmetadaten einer manuellen Preisänderung sowie alten/neuen Auditwert und Begründung
- Projektmitgliedschaften und schreibgeschützten Leserzugriff
- vollständige Unveränderbarkeit einer freigegebenen Version bei Ändern, Hinzufügen, Löschen und Versions-Patch
- centgleiche Nettosumme in Web-API, JSON, CSV, XLSX und PDF

`tests/admin-service.test.ts` und `tests/admin-routes.test.ts` prüfen Benutzer-/Rollenschutz sowie die Verträge für Einheiten, Indexreihen und -werte, Katalogzuordnung, Berechnungsregeln und Katalogklassifizierung. Die Tests verwenden flüchtige, synthetische Daten; sie ersetzen keine fachliche Freigabe der produktiven Registerinhalte.

## Abnahmematrix

Die folgenden 14 Fälle stammen aus dem fachlichen Auftrag. „Automatisiert“ bedeutet, dass ein direkter Test im Repository vorhanden ist. „Ergänzende Abnahme“ benennt die noch erforderliche produktionsnahe Prüfung; sie darf nicht durch einen erfolgreichen Unit-Test ersetzt werden.

| Nr. | Fall | Automatisierter Nachweis | Ergänzende Abnahme vor Produktion |
| ---: | --- | --- | --- |
| 1 | Alle CSV-Datensätze verlustfrei importieren | Parser-Sonderfälle und private 6.719-Kontrolle | DB-Import: Zeilenzahl, SHA-256, Rohsnapshot-Stichproben und Importprotokoll prüfen |
| 2 | Deutsche Dezimalzahlen korrekt | ja, Parser- und Domain-Test | Stichproben mit Preis, Faktor, Prozent, leer und realer Null |
| 3 | `Datensatz_ID` eindeutig; doppelte `Position_ID` ohne Datenverlust | eindeutige reale IDs; `Position_ID`-Dubletten werden analysiert | synthetischen Import mit doppelter Position-ID in DB prüfen |
| 4 | Suche nach KGK, Position-ID und Freitext | ja, API-Integrationstest | UI-Stichprobe mit realen Treffern und Sonderzeichen |
| 5 | Menge × Einheitspreis | ja, Domain und API | UI-Eingabe gegen gespeicherte/ausgegebene Summe vergleichen |
| 6 | Preisfortschreibung nur mit gewählter freigegebener Indexreihe | Admin-Zuordnung und Sperrlogik getestet | bestätigte Testreihe mit Basis-/Zielindex, abweichendem Zielquartal und fehlendem Zielindex durchspielen |
| 7 | Prozentansatz nur auf expliziter Bezugsbasis | ja | Position, KGK-Zwischensumme und definierte Gruppe jeweils prüfen |
| 8 | Fehlende Parameter erzeugen Blocker, keinen Nullpreis | ja, Domain und API | UI-Prüfansicht und alle Exportformate kontrollieren |
| 9 | Unzulässiger KKK-Kennwert ab LPH 3 wird verhindert | ja, API-Test für LPH 3 | fachliche Grenzfall-Stichprobe für LPH 2/3 |
| 10 | Manuelle Preisänderung braucht Begründung und Audit | ja, Domain- und API-Integrationstest | Benutzer und Zeitpunkt in einer Staging-Stichprobe kontrollieren |
| 11 | Summen auf allen KGK-Ebenen | ja | Mehrgruppenprojekt mit unabhängiger Kontrollrechnung exportieren |
| 12 | Freigegebene Version bleibt unverändert | ja, API-Integrationstest für Versions- und Positionsmutationen | Restore-/Rollback-Verhalten auf Staging prüfen |
| 13 | Excel-/PDF-Export centgenau zur Web-App | ja, API-Integrationstest für JSON/CSV/XLSX/PDF | mehrgruppiges Fachprojekt und Positionsdetails visuell kontrollieren |
| 14 | Rollen und Projektzugriffe serverseitig | ja, Anmeldung, Admin-Grenze, Mitgliedschaft, Bearbeiter- und Leserzugriff | vollständige Prüfer-/Projektrollenmatrix mit zwei getrennten Projekten testen |

Die rechte Spalte ist Teil der Produktionsabnahme. Insbesondere Fälle 6, 12, 13 und 14 benötigen eine Staging-Instanz mit PostgreSQL und fachlich bestätigten Regeln bzw. Registerinhalten.

Das Klonen und der Versionsvergleich sind zusätzlich automatisiert abgedeckt. Für die fachliche Abnahme bleibt zu prüfen, ob die gewählte Zuordnung von manuell erstellten, gleich benannten Positionen den erwarteten Vergleichsschlüssel trifft.

## Importabnahme Q3 2026

`pnpm qa:catalog` muss mit Exit-Code 0 enden und diese Kontrollen ausgeben:

| Kontrolle | Soll |
| --- | ---: |
| `recordCount` | 6.719 |
| `kgkCodeCount` | 1.055 |
| `reviewNoteCount` | 1.591 |
| `sourceIdsUnique` | `true` |

Zusätzlich sind folgende erwartete Datenqualitätsmeldungen zu bestätigen, nicht zu unterdrücken:

- `SCHEMA_CONFLICT`: 31 statt 32 Spalten, `Position_ID` fehlt
- `TAGS_COLUMN_MISSING`
- `UNIT_CATALOG_MISSING`, bis das Einheitenregister freigegeben ist
- `USAGE_CLASSIFICATION_MISSING`
- `SOURCE_INDEX_CONFLICT` zwischen CSV- und Excel-Referenz

Ein erwarteter Konflikt ist kein technischer Parserfehler. Er muss jedoch in Administration und Freigabe sichtbar bleiben.

## Fachliche Stichproben

Für den ersten Katalogimport mindestens je eine Position prüfen aus:

- normalem Einheitspreis ohne Prüfhinweis
- Einheitspreis mit Prüfhinweis
- Zuschlag EUR mit erforderlicher Grundposition
- Prozentansatz mit ausdrücklicher Bezugsbasis
- Berechnungsregel ohne vollständige Parameter
- manueller Preisänderung
- leerem Preisfeld
- KGK-Pfad mit dem Zeichen `>` in einer Bezeichnung

Je Stichprobe sind CSV-Felder, normalisierte DB-Felder, Rohsnapshot, Projektpositionssnapshot, UI und Export zu vergleichen.

## Exportabnahme

Für eine Projektversion mit mehreren KGK-Gruppen:

1. Zeilensummen unabhängig aus Menge, Preis und Faktor berechnen.
2. Prozentposition gegen die ausgewählte Bezugsbasis prüfen.
3. KGK-Zwischen- und Gesamtsummen ermitteln.
4. Nettosumme, Umsatzsteuer und Brutto bestimmen.
5. dieselben Werte in UI, JSON, CSV, XLSX und PDF vergleichen.
6. Quelle, Fundstelle, Preisstand, Prüfhinweise, manuelle Änderung und Versionsdaten kontrollieren.

Alle Geldsummen müssen centgenau übereinstimmen. Abweichungen dürfen nicht über Anzeigeformatierung verdeckt werden.

## Sicherheitsabnahme

- Anmeldung mit falschem Kennwort schlägt fehl.
- Cookie ist `HttpOnly`, `SameSite=Strict` und in Produktion `Secure`.
- Mutationen mit fremdem Origin werden abgewiesen.
- Leser kann keine Position ändern.
- Bearbeiter kann nicht freigeben.
- Prüfer kann ein nicht zugewiesenes Projekt nicht öffnen.
- Administrator sieht keine Passwort-Hashes über die API.
- freigegebene/archivierte Versionen akzeptieren keine Änderung.
- Katalog-CSV und Exporte sind ohne Anmeldung nicht abrufbar.
- Logs enthalten keine Passwörter, Sitzungstoken oder kompletten vertraulichen Quelldatensätze.

## Abschlusskriterium

Der MVP ist für den internen Pilotbetrieb bereit, wenn:

- Typecheck, automatisierte Tests und Build erfolgreich sind,
- der reale Katalogkontrolllauf 6.719/1.055/1.591 bestätigt,
- alle blockierenden Quellkonflikte sichtbar und nicht automatisch entschieden sind,
- die ergänzende Abnahmematrix auf Staging dokumentiert wurde,
- Export- und Rollenprüfungen bestanden sind,
- Backup, Restore, TLS, Secrets und Benutzer-Lifecycle eingerichtet sind.

Eine fachliche Freigabe für produktive Projekte setzt zusätzlich die bestätigte Ril-Regelgrundlage, Einheiten, Verwendungsarten, Planungsphasenregeln und Indexreihe voraus.
