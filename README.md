# Mein Schichtplan

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

## Technologie

- Kotlin + Jetpack Compose (Android-Wrapper)
- HTML/CSS/JavaScript (App-Logik in WebView)
- AlarmManager mit `setAlarmClock()` für zuverlässige Wecker
- LocalStorage für persistente Datenspeicherung

## Mindestanforderung

Android API 36+

## Projektstruktur

```
MyApplication2/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── assets/
│   │       │   └── index.html          # Gesamte App-Logik (HTML/CSS/JS)
│   │       ├── java/com/mein/schichtplan/
│   │       │   ├── MainActivity.kt     # WebView-Host + JavaScript-Bridge
│   │       │   ├── AlarmReceiver.kt    # BroadcastReceiver für Wecker
│   │       │   └── AlarmActivity.kt    # Vollbild-Alarm-Anzeige
│   │       ├── res/
│   │       │   ├── drawable/           # App-Icon (Vektorgrafiken)
│   │       │   └── mipmap-*/           # App-Icon in verschiedenen Auflösungen
│   │       └── AndroidManifest.xml
│   └── build.gradle.kts
├── gradle/
│   └── libs.versions.toml              # Abhängigkeiten & Versionen
├── build.gradle.kts
└── settings.gradle.kts
```

## Installation

1. APK aus `app/build/outputs/apk/debug/app-debug.apk` auf das Gerät übertragen
2. "Unbekannte Quellen" in den Android-Einstellungen erlauben
3. APK installieren
