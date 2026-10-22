# Fitnesstracker – Trainings-Dashboard für Garmin

Schlichte Weboberfläche, die Aktivitäten und Erholungswerte einer Garmin-Uhr auswertet,
Tipps für einen wirksamen Trainingsreiz gibt und den eigenen Wochenplan für die
nächsten 7 Tage an den aktuellen Zustand anpasst.

## Datenquellen

| Quelle | Was wird übertragen | Voraussetzung |
|---|---|---|
| **Garmin Connect** | Aktivitäten (120 Tage) inkl. Trainingslast, Trainingseffekt und VO2max; Schritte, Kalorien und Distanz je Tag (62 Tage); Herzfrequenz-Tagesverlauf und Schlafphasen-Verlauf (14 Tage); HRV (Herzfrequenzvariabilität) mit Status, Ruhepuls, Schlafphasen, Atemfrequenz, Body Battery, Stress | lokaler Server (`server.py`), Garmin-Konto |
| **FIT-Import** | einzelne Aktivitäten inkl. Pulsverlauf | `.fit`-Dateien aus `GARMIN/Activity` (Uhr per USB anschließen) |
| **Bluetooth** | Live-Herzfrequenz, optional als Einheit aufzeichnen | Chrome/Edge (Desktop oder Android), auf der Uhr „Herzfrequenz übertragen“ aktivieren |

Ohne eigene Daten zeigt die Oberfläche Beispieldaten.

**Hinweise zu den Schnittstellen**

- Die offizielle Garmin-Schnittstelle (Garmin Connect Developer Program) steht nur
  Unternehmen nach Freigabe zur Verfügung. Für die private Nutzung verwendet dieses
  Projekt daher die inoffizielle Python-Bibliothek
  [`garminconnect`](https://pypi.org/project/garminconnect/). Sie kann bei Änderungen
  durch Garmin zeitweise ausfallen.
- Per Bluetooth überträgt eine Garmin-Uhr nur den standardisierten *Heart Rate Service*
  der Bluetooth SIG (Special Interest Group), also die Live-Herzfrequenz. Gespeicherte
  Aktivitäten lassen sich über Bluetooth nicht auslesen; dafür dienen Garmin Connect
  oder der FIT-Import.
- FIT-Dateien werden mit dem offiziellen [Garmin FIT SDK](https://developer.garmin.com/fit/overview/)
  (Software Development Kit) direkt im Browser gelesen.

## Start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# einmalige Anmeldung (fragt E-Mail, Passwort und ggf. MFA-Code ab;
# die Tokens werden in ~/.garminconnect gespeichert)
python garmin_sync.py

python server.py          # http://127.0.0.1:8000
```

Danach aktualisiert der Button **Garmin Connect** die Daten. Alternativ können
`GARMIN_EMAIL` und `GARMIN_PASSWORD` als Umgebungsvariablen gesetzt werden.
Der Server lauscht bewusst nur auf `127.0.0.1`.

Nur Beispieldaten, FIT-Import und Bluetooth ansehen: `web/` mit einem beliebigen
statischen Webserver ausliefern (z. B. `python -m http.server -d web`).

### In einer Claude-Code-Cloud-Umgebung

1. Lokal einmalig anmelden und die Tokens ausgeben: `python garmin_sync.py --export-tokens`
2. In den Einstellungen der Cloud-Umgebung die Ausgabe als Secret bzw. Umgebungsvariable `GARMINTOKENS` hinterlegen
   (die Tokens gewähren vollen Zugriff auf das Garmin-Konto und laufen nach einiger Zeit ab).
3. Unter Netzwerkzugriff die Domains `connect.garmin.com`, `connectapi.garmin.com`, `sso.garmin.com`
   und `diauth.garmin.com` erlauben.
4. Neue Sitzung starten; danach liest `python garmin_sync.py` die Daten ohne Passwort und MFA-Abfrage.

## Bereiche der Oberfläche

| Reiter | Inhalt |
|---|---|
| Statistik | Tag, Woche oder Monat im Neon-Dashboard-Stil: Schritte (Ring mit Ziel), Kalorien, Trainingszeit und Erholung mit Vergleich zum Vorzeitraum, Aktivitätstrend, Tagesleistung, Trainingsverteilung, Erholungsstatus, Schlafphasen (Hypnogramm in der Tagesansicht), Herzfrequenz im Tagesverlauf |
| Übersicht | Kennzahlen, Tabelle der letzten 7 Tage (Schlaf, HRV, Ruhepuls, Body Battery, Belastung, Readiness), 7-Tage-Empfehlung, Fitness-/Ermüdungsverlauf, Coach-Hinweise |
| Training | VO2max (maximale Sauerstoffaufnahme) mit Trend über 4 und 12 Wochen, Belastungssteuerung (TRIMP und Garmin-Trainingslast), aerober/anaerober Trainingseffekt, Pace und Herzfrequenz, Wochenumfang, Intensitätsverteilung, Aktivitäten |
| Erholung | Schlafarchitektur (Tief-, Leicht-, REM-Schlaf, Wachphasen), HRV-Verlauf mit Normalbereich, Ruhepuls, Atemfrequenz, Body Battery, Stress |
| Muster | Illness-Score, wöchentliche Bereitschaft (Readiness), Zusammenhänge zwischen Schlaf, Belastung, HRV und Laufeffizienz |
| Workouts | Strukturiertes Workout aus der Tagesempfehlung; senden an Garmin Connect (Kalender) oder als FIT-Datei herunterladen |

### Workouts an die Uhr senden

- **Garmin Connect:** „An Garmin Connect senden“ legt das Workout im Garmin-Konto an und plant es für den Tag ein. Die Uhr übernimmt es bei der nächsten Synchronisation mit der Garmin-Connect-App.
- **USB:** Die FIT-Datei in den Ordner `GARMIN/NewFiles` der Uhr kopieren ([FIT Cookbook: Encoding Workout Files](https://developer.garmin.com/fit/cookbook/encoding-workout-files/)).

Unterstützt werden Lauf- und Rad-Workouts mit Pulsbereichen aus dem Profil.

## Was berechnet wird

| Kennzahl | Bedeutung | Grundlage |
|---|---|---|
| Belastung (TRIMP, Training Impulse) | Dauer × pulsbasierte Intensität je Einheit | Morton, Fitz-Clarke & Banister 1990, J Appl Physiol 69(3) |
| Fitness (CTL, Chronic Training Load) / Ermüdung (ATL, Acute Training Load) / Form (TSB, Training Stress Balance) | 42- bzw. 7-Tage-Mittel der Belastung, Form = Fitness − Ermüdung | Impulse-Response-Modell nach Banister |
| Belastungsverhältnis (ACWR, Acute:Chronic Workload Ratio) | 7-Tage- zu 28-Tage-Belastung; Zielbereich 0,8–1,3 | Gabbett 2016, Br J Sports Med 50(5) |
| Monotonie | Mittelwert / Standardabweichung der Tageslast | Foster 1998, Med Sci Sports Exerc 30(7) |
| Intensitätsverteilung | Anteil locker / moderat / intensiv, Orientierung ~80 % locker | Seiler 2010, Int J Sports Physiol Perform 5(3) |
| Bereitschaft (Readiness) | HRV 40 % (inkl. Ruhepuls) im Vergleich zum eigenen 28-Tage-Normalbereich, Schlaf 35 %, akuter Trainingsstress (Form) 25 %; Wochenwert = Ø der letzten 7 Tage | Plews et al. 2013, Sports Med 43(9); Banister-Modell |
| Illness-Score | Frühwarnwert 0–100 aus Anstieg von Ruhepuls und Atemfrequenz, Abfall von HRV und Schlafscore gegenüber dem eigenen Normalbereich; keine Diagnose | Radin et al. 2020, Lancet Digit Health 2(2); Mishra et al. 2020, Nat Biomed Eng 4; Miller et al. 2020, PLOS ONE 15(12) |
| Schlaf & Leistung | Laufeffizienz (Tempo je Herzschlag) nach guten vs. schlechten Nächten | Fullagar et al. 2015, Sports Med 45(2) |
| Schlafdauer | Hinweis bei weniger als 7 h | Watson et al. 2015, Sleep 38(6) |
| Maximalpuls (ohne Messwert) | 208 − 0,7 × Alter | Tanaka et al. 2001, J Am Coll Cardiol 37(1) |

### Anpassung des Trainingsplans

Im Kalender-Dialog wird eine Wochenvorlage (Sportart, Intensität, Dauer) sowie optional
ein Wettkampfdatum hinterlegt. Für die nächsten 7 Tage gilt:

- **Niedrige Bereitschaft heute** → fordernde Einheit wird zu einer lockeren, kürzeren Einheit (Plews et al. 2013).
- **Hohe Ermüdung** (Form < −30 oder ACWR > 1,5) → Umfang und Intensität der nächsten 3 Tage reduziert (Gabbett 2016).
- **Keine zwei harten Tage in Folge** (Seiler 2010).
- **Ausgeruht und Belastung unter Niveau** → lockere Einheiten leicht verlängert.
- **Tapering** in den 14 Tagen vor dem Wettkampf: Umfang reduziert, Intensität beibehalten (Bosquet et al. 2007, Med Sci Sports Exerc 39(8)).
- Zu jeder Einheit wird der Zielreiz mit Pulsbereich angegeben, z. B. 4 × 4 min bei 90–95 % HFmax für Intervalle (Helgerud et al. 2007, Med Sci Sports Exerc 39(4)).

Ergänzende Tipps prüfen u. a. die Empfehlungen der WHO (Weltgesundheitsorganisation) 2020:
150–300 min moderate Ausdaueraktivität und an mindestens 2 Tagen muskelkräftigendes Training pro Woche.

Die Empfehlungen sind Richtwerte und ersetzen keine ärztliche oder trainerische Beratung.
Pulsschwellen lassen sich im Profil-Dialog anpassen – am genauesten mit Werten aus einer
Leistungsdiagnostik.

## Projektstruktur

```
garmin_sync.py        Abruf aus Garmin Connect → data/garmin.json
server.py             lokaler Webserver + API (Sync, Trainingsplan)
web/index.html        Oberfläche
web/styles.css        Gestaltung (hell/dunkel nach Systemeinstellung)
web/js/analysis.js    Belastung, Readiness, Tipps, Wochenvorschläge
web/js/insights.js    VO2max, Effizienz, Schlafarchitektur, Illness-Score, Muster
web/js/workouts.js    strukturierte Workouts (Garmin Connect, FIT)
web/js/period.js      Zusammenfassung von Tag, Woche, Monat
web/js/stats-charts.js  Neon-Diagramme (Ring, Donut, Gauge, Hypnogramm, Tagespuls)
web/js/charts.js      SVG-Diagramme
web/js/bluetooth.js   Live-Puls per Web Bluetooth
web/js/fit-import.js  FIT-Dateien über das Garmin FIT SDK
web/js/demo.js        Beispieldaten
tests/                Tests: node --test tests/*.test.mjs · python -m unittest tests/test_garmin_sync.py
```
