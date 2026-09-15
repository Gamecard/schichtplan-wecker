# Schichtwecker (Mein Schichtplan)

Eine Android-App zur Verwaltung von Schichtplänen mit Wecker-Funktion.

## Funktionen

- **Schichtkalender** – Monatsansicht mit Kalenderwochen, Feiertagen und Schichtfarben (Frei, Früh, Spät, Nacht)
- **Wochenrhythmus** – Flexibles Schichtmuster mit 1–6 Wochen Rhythmus und frei wählbarem Startdatum
- **Wecker pro Schicht** – Individuelle Weckzeiten für jede Schichtart, direkt aus dem Kalender stellbar
- **Alle stellen** – Setzt automatisch alle Wecker für die nächsten 12 Monate
- **Wecker für unbelegte Tage** – Wecker für freie Tage mit wählbaren Wochentagen
- **Ausnahmen** – Einzelne Tage oder Zeiträume abweichend belegen
- **Feiertage** – Automatische Anzeige für alle deutschen Bundesländer
- **Dark Mode** – Unterstützung für helles und dunkles Design
- **Eigener Klingelton** – Alarmton aus den eigenen Dateien wählbar

## Technologie

- Kotlin + Jetpack Compose (Android-Wrapper)
- HTML/CSS/JavaScript (App-Logik in WebView)
- AlarmManager mit `setAlarmClock()` für zuverlässige Wecker (`setAlarmClock()` gilt als AlarmClock-App-Nutzung und benötigt keine exakte-Alarm-Sonderberechtigung)
- LocalStorage für persistente Datenspeicherung

## Mindestanforderung

Android 15 (API 35)+

## Projektstruktur

```
schichtplan-wecker/
├── app/
│   └── src/
│       └── main/
│           ├── assets/
│           │   └── index.html          # Gesamte App-Logik (HTML/CSS/JS)
│           ├── java/de/schichtwecker/app/
│           │   ├── MainActivity.kt     # WebView-Host + JavaScript-Bridge
│           │   ├── AlarmReceiver.kt    # BroadcastReceiver für Wecker
│           │   └── AlarmActivity.kt    # Vollbild-Alarm-Anzeige
│           ├── res/
│           │   ├── drawable/           # App-Icon (Vektorgrafiken)
│           │   └── mipmap-*/           # App-Icon in verschiedenen Auflösungen
│           └── AndroidManifest.xml
├── gradle/
│   └── libs.versions.toml              # Abhängigkeiten & Versionen
├── build.gradle.kts
└── settings.gradle.kts
```

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