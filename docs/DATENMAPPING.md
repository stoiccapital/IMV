# Datenmapping und Quellenbefunde

## Quellenrangfolge

1. Die CSV ist die führende Quelle für importierte Preis- und Positionsdatensätze.
2. `Datenbank Kostenermittlung.xlsm` ist eine statische Referenz für frühere Such-, Eingabe-, Tag-, Index- und Vergleichsabläufe. VBA wurde nicht ausgeführt.
3. `Kostenermittlung nach Ril 808_Vorlage.xlsx` ist eine Layout- und Exportreferenz, keine verlässliche Rechenquelle.
4. Fachliche Regeln, die in den verfügbaren Quellen nicht eindeutig belegt sind, werden nicht erfunden. Sie bleiben administrativ zu entscheiden und blockieren bei Bedarf die Freigabe.

## Belegte KEB-Regeln

Die statische Auswertung von `808_0210 Kostenermittlungsbuch KEB 2022.pdf`, Seiten 1–4, belegt für die Umsetzung:

- Eine KGK-Nummer wird immer vollständig mit sieben Zeichen geführt.
- Der KGK hat sechs Ebenen mit den Segmentbreiten `1 / 2 / 1 / 1 / 1 / 1`.
- KKK-Kostenkennwerte sind für die Kostenschätzung in Grundlagenermittlung und Vorplanung vorgesehen.
- Ab Kostenberechnung bzw. LPH 3 dürfen diese Kennwerte nicht verwendet werden.
- Die im KKK vorgegebene Kostenschätzungs-Einheit darf nicht geändert werden.
- In der Kostenberechnung sind die Mengeneinheiten des KGK zu verwenden.
- Ausprägungen werden über gültige Faktoren angepasst. Ist eine Anpassung per Faktor nicht möglich, ist ein eigener Euro-Betrag mit nachvollziehbarem Bezug zur Ausprägung anzusetzen.

Diese Regeln werden als explizite Planungsphasen-, Einheiten- und Faktorprüfung modelliert. Wo dem CSV-Datensatz die nötige Klassifizierung fehlt, bleibt die Position `review_required`; die belegte Regel wird nicht aus Freitext erraten.

## Kontrollwerte der bereitgestellten CSV

| Kennzahl | Befund |
| --- | ---: |
| Encoding | UTF-8 mit BOM |
| Trennzeichen | Semikolon |
| Datensätze | 6.719 |
| tatsächliche Spalten | 31 |
| spezifizierte Spalten | 32 |
| unterschiedliche siebenstellige KGK-Codes | 1.055 |
| Datensätze mit Prüfhinweis | 1.591 |
| eindeutige `Datensatz_ID` | 6.719 |
| doppelte `Datensatz_ID` | 0 |
| befüllte Zielpreise Q3 2026 | 6.677 |
| bewusst fehlende Zielpreise | 42 |

Die tatsächliche Datei hat durchgängig dieselbe Feldbreite. Der Importer unterstützt Quotes und eingebettete Zeilenumbrüche, auch wenn diese Sonderfälle in der analysierten Datei nicht vorkommen.

## Abweichungen zur Spezifikation

### `Position_ID` fehlt

Die spezifizierte Spalte `Position_ID` ist in der CSV nicht vorhanden. Der Import setzt das normalisierte Feld auf `null` und protokolliert `SCHEMA_CONFLICT`. `EPK_Quellcodes` wird nicht als Ersatz verwendet: Herkunftscodes sind nicht identisch mit einer stabilen Position-ID und sind vielfach leer bzw. nicht eindeutig.

### Tags fehlen

Eine explizite Tag-Spalte fehlt ebenfalls. Freitext darf nicht stillschweigend als alleinige fachliche Klassifizierung dienen. Eine spätere, nachvollziehbare Anreicherung aus der XLSM-Referenz ist möglich, muss aber CSV-Werte unangetastet lassen und ihre Herkunft speichern.

### Verwendungs- und Planungsphasenklassifizierung fehlt

Die CSV enthält kein strukturiertes Feld für KKK versus Detailposition und keine zulässigen Planungsphasen. Jeder Erstimport erhält daher zunächst `usage_classification=review_required`. Ein Administrator muss die Klassifizierung aus einer bestätigten Regelquelle festlegen. Freitexttreffer wie „KKK“ reichen nicht aus.

## Preisarten

| CSV-Preisart | Anzahl | Normalisierte Art | Regel |
| --- | ---: | --- | --- |
| Einheitspreis | 6.591 | `unit` | Menge × Ziel-/manueller Einheitspreis × Faktor |
| Zuschlag EUR | 86 | `surcharge` | getrennte Position; erforderlicher Grundbezug ausdrücklich wählen |
| Prozentansatz | 21 | `percentage` | gewählte Bezugsbasis × Prozent / 100; keine Preisindexierung |
| Berechnungsregel | 21 | `parameter` | ohne geprüfte Regel und vollständige Parameter blockieren |

Alle 21 Prozentansätze haben erwartungsgemäß keinen pauschalen Einheitspreis. Alle 21 Berechnungsregel-Positionen haben weder Preis noch belastbare Regelkonfiguration und dürfen nicht als `0,00 EUR` erscheinen.

## Einheiten

Die CSV enthält zwölf Schreibweisen:

`St`, `m`, `m²`, `m³`, `psch`, `t`, `km`, `%`, `h`, `d`, `Monat`, `Wo`.

Ohne bestätigtes Einheitenregister ist keine davon automatisch „unbekannt“ oder „freigegeben“. Der Erstimport führt deshalb den Hinweis `UNIT_CATALOG_MISSING`. Eine spätere Normalisierung muss Originaleinheit und Umrechnungsregel nachvollziehbar erhalten.

## CSV nach Datenbank

| CSV-Spalte | Datenbank/Verwendung | Regel |
| --- | --- | --- |
| `Datensatz_ID` | `price_items.dataset_id` | fachlich stabiler Schlüssel innerhalb der Katalogversion |
| `KGK_Code` | `price_items.kgk_code`, `kgk_nodes.code` | immer siebenstellig als Text |
| `KGK_Gliederung` | `kgk_outline` | Originaltext erhalten |
| `KGK_Bezeichnung` | `kgk_label` | Bezeichnung des Knotens |
| `KGK_Pfad` | `kgk_path` | Anzeige; nicht an `>` teilen, da dieses Zeichen in Bezeichnungen vorkommt |
| `Position_ID` | `position_id` | fehlt in der Quelle; bleibt `null` |
| `Bezeichnung` | `designation` | Pflichtfeld |
| `Erlaeuterung` | `explanation` | vollständig erhalten |
| `Ansatz_Grundlage` | `basis` | Freitext, kein stabiler Abhängigkeitsverweis |
| `Einheit` | `unit` | Originalschreibweise erhalten |
| `Preisart` | `price_type_raw` | zusätzlich auf normalisierte Rechenart abbilden |
| `Preis_Q3_2026_EUR` | `price_q3_2026` | freigegebener Zielpreis nur für Katalog Q3 2026 |
| `Prozentansatz` | `percent_rate` | Prozent, nicht preisindexieren |
| `Gewaehlter_Bezugszeitraum` | `selected_period` | Preisstand des Ausgangspreises |
| `Ausgangspreis` | `base_price` | leer bleibt leer, nicht Null |
| `Ausgangspreis_Untergrenze` | `base_price_lower` | optionaler Vergleichswert |
| `Index_Basis` | `base_index` | Dezimalwert |
| `Index_Q3_2026` | `target_index` | in der Datei durchgängig 141,7, soweit befüllt |
| `Fortschreibungsfaktor` | `escalation_factor` | gegen Zielindex/Basisindex prüfen |
| `Gewaehlte_Quelle` | `source` | sichtbar in Position und Export |
| `Gewaehlte_Fundstelle` | `source_reference` | sichtbare Fundstelle; kann auf XLSM-Zeile verweisen |
| `Pruefhinweis` | `review_note` | nie verwerfen; Bestätigung/Bearbeitung im Projekt erforderlich |
| `Indexquelle` | `index_source` | nicht automatisch mit Excel-Metadaten mischen |
| `Indexreihe` | `index_series` | administrative Bestätigung nötig |
| `Umsatzsteuer` | `tax_note` | Freitext, keine Zahlenspalte |
| `Berechnung` | `calculation` | Quelltext der Regel/Erklärung |
| alle Originalfelder | `raw_snapshot` | unveränderter JSON-Feldsatz |

Auch Felder wie Vergleiche, Preisbezüge, Originaleinheiten und EPK-Quellcodes bleiben im Rohsnapshot verlustfrei erhalten, selbst wenn kein eigenes normalisiertes Suchfeld existiert.

## Zahlenlogik

Deutsche Dezimalzahlen werden ohne Tausenderpunkt bzw. mit Dezimalkomma in kanonische Dezimalstrings überführt. Leer, `k. a.`, `n. a.` und `-` werden als fehlend behandelt, nicht als Null.

Für 6.677 bepreiste Datensätze stimmen:

```text
Ausgangspreis × Fortschreibungsfaktor ≈ Preis_Q3_2026_EUR
Fortschreibungsfaktor ≈ Index_Q3_2026 / Index_Basis
```

Die maximale beobachtete Differenz zur centgenauen Zielpreisrundung liegt bei etwa 0,0051 EUR. Die Anwendung rechnet mit Dezimalarithmetik und rundet Geldwerte für Zeilensummen/Exporte auf zwei Nachkommastellen.

## Indexkonflikt

Die Quellen dürfen nicht automatisch vermischt werden:

| Quelle | Bezeichnung |
| --- | --- |
| CSV | BKI, „Netto, Neubau Wohngebäude insgesamt, 2021=100“ |
| XLSM-Referenz | Destatis, „Preisindizes für Bauwerke, Ingenieurbau, Instandhaltung“, Reihe „Brücken im Straßenbau“ |

Beide enthalten für Q3 2026 den Zielwert 141,7, beschreiben aber unterschiedliche Reihen. Zusätzlich verwendet die ältere Excel-Vergleichslogik einen festen veralteten Wert für 2025 Q4. Der Import erzeugt deshalb `SOURCE_INDEX_CONFLICT`, und `catalog_versions.index_series_confirmed` bleibt `false`, bis eine nachvollziehbare administrative Entscheidung vorliegt.

Für einen anderen Zielpreisstand als Q3 2026 muss eine freigegebene Indexreihe mit Zielwert vorhanden sein. Fehlt der Zielindex, darf kein Zielpreis berechnet werden.

Die Administrationsoberfläche bildet diese Entscheidung explizit ab: Eine versionierte Indexreihe erhält Quelle, Basisjahr, Quartalswerte und Fundstellen, wird fachlich freigegeben und anschließend einer Katalogversion zugeordnet. Q3 2026 verwendet den importierten Zielpreis. Bei einem anderen Projektpreisstand berechnet die Übernahme den Zielpreis aus Ausgangspreis × Zielindex / Basisindex und speichert die verwendete Reihe, Werte und den Faktor im Positionssnapshot. Prozentansätze werden dabei nicht indexiert.

## XLSM-Referenz

`Datenbank Kostenermittlung.xlsm` wurde ausschließlich statisch analysiert. Es wurden keine VBA-Makros ausgeführt.

Relevante Befunde:

- acht Blätter: Inhaltsverzeichnis, Suchmaske, Eingabemaske, Kostenkennwerte DB, Preisindex, Hilfstabelle, Tags, Preisvergleich KEB
- 9.401 Tabellenzeilen und 3.747 unterschiedliche KGK-Codes
- berechnete `Preis_ID` hängt von KGK und laufender `COUNTIF`-Nummer ab; sie kann sich beim Sortieren/Einfügen ändern und ist kein Primärschlüssel
- frühere Abläufe für Suche, Einzel-/Sammeleingabe und „letzte Einsortierung rückgängig“ werden als transparente Weblogik nachgebildet
- uneinheitliche Einheiten wie `m2`/`m²`, `st`/`St`/`St.`, `Mon`/`Monat`
- zahlreiche defekte Namen, externe Verknüpfungen und Power-Query-Verbindungen; keine Live-Datenquelle

Optionale, nachvollziehbare Anreicherung aus Excel:

| XLSM-Spalte | Bedeutung |
| --- | --- |
| A | KGK-Code |
| H | frühere `Preis_ID` nur als `source_position_id` |
| I | Bezeichnung |
| J | Erläuterung |
| K | Originaleinheit |
| L/M | Basiszeitraum/Basispreis |
| P | Ansatz |
| Q:S | ergänzende Tags |

Eine Anreicherung darf CSV-Felder nicht überschreiben. Herkunft, Zeitpunkt und Konflikte müssen gespeichert werden.

## Excel-Exportvorlage

`Kostenermittlung nach Ril 808_Vorlage.xlsx` hat acht Blätter. Das sichtbare Hauptblatt verwendet A:R und den Druckbereich A1:R37; Projektname liegt in M2. Die Fachmuster positionieren Parameter/Faktoren vor Menge, Einheitspreis und Kosten.

Die Datei enthält jedoch 971 defekte definierte Namen, zahlreiche `#REF!`-Formeln und alte externe Verknüpfungen. Deshalb gilt:

- Layout und Gliederung dienen als Referenz.
- Bestehende Formeln und Zelladressen steuern keine Geschäftslogik.
- Positionszeilen, Summen, Formeln und Druckbereiche werden aus dem Exportmodell neu erzeugt.
- Spätere Vorlagenänderungen werden über die getrennte Mapping-Schicht umgesetzt.

## Projektpositions-Snapshot

Beim Übernehmen eines Katalogdatensatzes speichert `estimate_lines` mindestens:

- Katalogversion und Katalogdatensatz-ID
- KGK-Code, Pfad, Bezeichnung, Erläuterung und Ansatz
- Einheit, Preisart, Original-/Zielpreis und Preisstand
- Quelle, Fundstelle und Prüfhinweis
- Verwendungs-/Planungsphasenklassifizierung
- vollständigen fachlichen Katalogsnapshot

Spätere Katalogimporte dürfen diesen Snapshot nicht aktualisieren. Manuelle Preise bleiben zusätzlich neben dem Katalogpreis sichtbar und benötigen Quelle, Preisstand, Begründung und Bearbeiter.
