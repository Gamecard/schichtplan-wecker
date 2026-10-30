# Schichtwecker (Mein Schichtplan)

Eine Android-App zur Verwaltung von Schichtplänen mit Wecker-Funktion.

## Funktionen

- **Schichtkalender** – Monatsansicht mit Kalenderwochen, Feiertagen und Schichtfarben (Frei, Früh, Spät, Nacht)
- **Wochenrhythmus** – Flexibles Schichtmuster mit 1–6 Wochen Rhythmus; Woche 1 wird als Kalenderwoche gewählt (alternativ per Datum, dann wird die KW angezeigt); schnelle Eingabe: Schicht in der Legende antippen, dann Tage mit einem Klick belegen
- **Wecker pro Schicht** – Uhrzeit je Schichtart und EIN Schalter „automatisch wecken“: stellt die Wecker für alle passenden Tage der nächsten 12 Monate und hält sie aktuell (Muster, Ausnahmen, Tausch, Weckzeit, Feiertage)
- **Einzelwecker** – für genau einen Tag direkt aus dem Kalender stellbar; bleibt, bis man ihn löscht
- **Wecker für unbelegte Tage** – Wecker für Tage ohne Eintrag im Rhythmus mit wählbaren Wochentagen (gleicher Schalter)
- **Ausnahmen** – Urlaub, Krank oder Schulung für einzelne Tage oder Zeiträume
- **Schichttausch** – Schicht an einem einzelnen Tag ändern (Tag im Kalender antippen); Wecker passen sich an
- **Nächster Wecker** – über dem Kalender auf einen Blick
- **Weck-Verhalten** – Schlummerzeit (3–20 Min), Vorwecker, langsam ansteigende Lautstärke, nur Vibration
- **Widget** – heutige/morgige Schicht und nächster Wecker auf dem Startbildschirm
- **Profil sichern/laden** – Plan und Einstellungen als Datei (z. B. für ein neues Handy)
- **Kalender-Export** – Schichten der nächsten 12 Monate als .ics-Datei (z. B. für den Google-Kalender)
- **Feiertage** – Automatische Anzeige für alle deutschen Bundesländer
- **Dark Mode** – Unterstützung für helles und dunkles Design
- **Eigener Klingelton** – Alarmton aus den eigenen Dateien wählbar

## Technologie

- Kotlin + Jetpack Compose (Android-Wrapper)
- HTML/CSS/JavaScript (App-Logik in WebView)
- AlarmManager mit `setAlarmClock()` für zuverlässige Wecker (Berechtigung `USE_EXACT_ALARM`, wird Wecker-Apps automatisch erteilt)
- Weckton im Foreground-Service (`AlarmService`) – klingelt weiter, auch wenn der Bildschirm ausgeschaltet wird
- Wecker werden nativ gespeichert (`AlarmStore`) und nach Neustart, App-Update und Zeitzonenwechsel neu eingeplant (`BootReceiver`)
- LocalStorage für persistente Datenspeicherung

## Mindestanforderung

Android 16 (API 36)+

Unterstützt werden nur Android-Versionen, die noch mindestens zwei Jahre offizielle Sicherheitspatches erhalten (Stand Oktober 2026: Android 16 und 17). Mit jeder neuen Android-Version wird geprüft, ob die Mindestversion angehoben wird.

## Projektstruktur

```
schichtplan-wecker/
├── app/
│   └── src/
│       └── main/
│           ├── assets/
│           │   ├── index.html          # Oberfläche (HTML)
│           │   ├── app.css             # Gestaltung
│           │   └── app.js              # App-Logik (Plan, Wecker-Abgleich, Profil, Export)
│           ├── java/de/schichtwecker/app/
│           │   ├── MainActivity.kt     # WebView-Host + JavaScript-Bridge
│           │   ├── AlarmScheduler.kt   # Wecker setzen/löschen + AlarmStore (nativer Speicher)
│           │   ├── AlarmReceiver.kt    # BroadcastReceiver für Wecker → startet AlarmService
│           │   ├── AlarmService.kt     # Foreground-Service: Ton, Vibration, Benachrichtigung
│           │   ├── AlarmActivity.kt    # Vollbild-Alarm-Anzeige (nur Oberfläche)
│           │   ├── AlarmOptions.kt     # Weck-Verhalten (Schlummerzeit, Lautstärke, Vibration)
│           │   ├── BootReceiver.kt     # Neu-Einplanen nach Neustart/Update/Zeitwechsel
│           │   └── ShiftWidget.kt      # Startbildschirm-Widget
│           ├── res/
│           │   ├── drawable/           # App-Icon, Widget-Hintergrund
│           │   ├── layout/             # Widget-Layout
│           │   └── mipmap-*/           # App-Icon in verschiedenen Auflösungen
│           └── AndroidManifest.xml
├── tests/                              # Web-Tests (npm test)
├── .github/workflows/build.yml         # CI: Tests, Lint, Build, Release bei Tag
├── gradle/
│   └── libs.versions.toml              # Abhängigkeiten & Versionen
├── build.gradle.kts
└── settings.gradle.kts
```

## Tests und automatischer Build

- Web-Tests: `cd tests && npm install && npm test`
- Android-Lint: `./gradlew lintDebug` (muss fehlerfrei sein)
- GitHub Actions führt beides bei jedem Push aus und baut eine Debug-APK (Artefakt `app-debug`)
- Release: `versionName` in `app/build.gradle.kts` erhöhen, committen, Tag `v<versionName>` pushen (z. B. `git tag v1.5 && git push origin v1.5`). Der Workflow baut die signierte APK und legt ein GitHub-Release an. Dafür müssen die Secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` gesetzt sein

## Installation

1. APK aus `app/build/outputs/apk/debug/app-debug.apk` auf das Gerät übertragen
2. "Unbekannte Quellen" in den Android-Einstellungen erlauben
3. APK installieren

## Release bauen

Die Release-Signierung liest ihre Werte aus `keystore.properties` im Repo-Root (nicht eingecheckt):

```properties
storeFile=release.jks
storePassword=...
keyAlias=release
keyPassword=...
```

Neuen Keystore erzeugen:

```bash
keytool -genkeypair -v -keystore release.jks -alias release -keyalg RSA -keysize 4096 -validity 10000
```

Danach `./gradlew assembleRelease`. Ohne `keystore.properties` wird die Release-APK unsigniert gebaut.