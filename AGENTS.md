# Projekt: Mein Schichtplan (Android WebView App)

## WebView Overlay/Sheet Pattern (WICHTIG - NICHT ANDERS MACHEN)

**Problem:** `position:absolute; bottom:0; overflow-y:auto` funktioniert in Android WebView NICHT zuverlässig. Inhalte werden abgeschnitten statt scrollbar.

**Lösung (getestet und funktioniert):**
- Overlay: `position:fixed; inset:0; overflow-y:auto; -webkit-overflow-scrolling:touch`
- Animieren per `transform:translateY(100%)` ↔ `translateY(0)` (CSS-Transition)
- Öffnen/Schließen per CSS-Klasse `.open` (nicht `style.display`)
- Der Overlay selbst ist der Scroll-Container, das Sheet ist normales Block-Element
- `body.overflow='hidden'` wenn Sheet/Overlay offen, sonst Background-Scroll

**NICHT VERWENDEN:**
- ❌ `position:absolute; bottom:0; overflow-y:auto` auf Sheet
- ❌ `display:flex; justify-content:flex-end` auf Overlay
- ❌ `max-height:` + `overflow-y:auto` auf `position:fixed; bottom:0` Element
- ❌ `style.display='block'/'none'` zum Umschalten (stattdessen `.open`-Klasse)

## Projektstruktur

- **Kotlin**: `MainActivity.kt` (WebView + JS-Bridge), `AlarmScheduler.kt` (+ `AlarmStore`), `AlarmReceiver.kt`, `AlarmService.kt`, `AlarmActivity.kt`, `AlarmOptions.kt`, `BootReceiver.kt`, `ShiftWidget.kt`
- **Web** (`app/src/main/assets/`): `index.html` (Struktur), `app.css` (Gestaltung), `app.js` (Logik, eine IIFE – Funktionen sind NICHT global, Tests bedienen die Oberfläche)
- **minSdk 36** (Android 16). Regel: nur Android-Versionen unterstützen, die noch ≥ 2 Jahre Sicherheitspatches bekommen (nachschlagen: endoflife.date/android, Android Security Bulletin). Stand 10/2026: gepatcht 14–17, ≥ 2 Jahre nur 16 und 17. Keine `Build.VERSION`-Abfragen für Versionen unter minSdk (Lint `ObsoleteSdkInt`)
- **Paket**: `de.schichtwecker.app`
- **App-Name**: Schichtwecker
- **Theme**: `Theme.Schichtwecker` (res/values, res/values-night), Compose: `SchichtweckerTheme` in `ui/theme/`

## Build & Lint

- Build: `./gradlew assembleDebug`
- APK: `app/build/outputs/apk/debug/app-debug.apk`
- Release: `isMinifyEnabled = true`, `isShrinkResources = true`
- Release-Signierung: Werte aus `keystore.properties` im Repo-Root (NICHT committen, in .gitignore); ohne die Datei baut Release unsigniert

## Bekannte Patterns

- AlarmKeys: `shift-YYYY-MM-DD-tN` (Schicht), `custom-YYYY-MM-DD` (Einzelwecker), `free-day-YYYY-MM-DD` (Freier Tag), `<key>#snooze` (Schlummern), `test-alarm`
- Schichttypen: 0=kein Eintrag, 1=Frei, 2=Früh, 3=Spät, 4=Nacht
- SNAMES[0]='' (leer, kein Eintrag), SNAMES[1]='Frei'
- Custom Klingelton: `ActivityResultContracts.OpenDocument("audio/*")` + `takePersistableUriPermission`

## Design-System: Material Design 3 (M3)

Die App nutzt Material Design 3 mit tonalen Paletten, abgeleitet vom Seed `#4758A8`.

### M3 Color Tokens
- Alle Farben als `--md-*` CSS-Variablen definiert (Light + Dark + System)
- `--bg` → `--md-background`, `--fg` → `--md-on-background`
- `--primary` → `--md-primary`, `--card` → `--md-surface-container-low`
- `--border` → `--md-outline-variant`, `--chip` → `--md-surface-container`

### M3 Typography Tokens
- `--t-display-lg/md/sm`, `--t-headline-lg/md/sm`, `--t-title-lg/md/sm`
- `--t-body-lg/md/sm`, `--t-label-lg/md/sm`
- Font: Roboto, Weight 500 für Titel, 400 für Body

### M3 Shape Tokens
- `--shape-xs:4px`, `--shape-sm:8px`, `--shape-md:12px`, `--shape-lg:16px`, `--shape-xl:28px`, `--shape-full:9999px`

### M3 Elevation
- 5-stufig: `--elev-0` bis `--elev-5` (tonal shadows, dunkel = stärkere Werte)

### M3 Motion Tokens
- `--motion-duration-short:200ms`, `--motion-duration-medium:350ms`, `--motion-duration-long:500ms`
- `--motion-easing-standard`, `--motion-easing-emphasized`, `--motion-easing-decelerated`

### Dark Mode (System)
- Die WebView beantwortet `prefers-color-scheme` nach dem App-Theme (`isLightTheme`), NICHT direkt nach der Systemeinstellung. Deshalb gibt es `res/values-night/themes.xml` mit dunklem Parent – ohne das bleibt „System“ immer hell

### CSS-Kompatibilität (WICHTIG)
- ❌ KEIN `color-mix()` verwenden — wird in älteren Android WebViews nicht unterstützt
- Stattdessen: feste rgba-Werte oder bestehende M3-Tokens nutzen
- ✅ `backdrop-filter:blur()` mit `-webkit-backdrop-filter` Fallback
- ✅ `color-mix()` wurde durch harte Fallback-Werte ersetzt

## Alarm-Architektur

### Ablauf
- JS ruft `Android.setAlarmForDate[Silent]` → `AlarmScheduler.schedule()` → `setAlarmClock()` + Eintrag im `AlarmStore` (SharedPreferences `alarm_store`, JSON je Schlüssel: Wanduhrzeit, Nachricht, requestCode)
- Auslösen: `AlarmReceiver` entfernt den Eintrag aus dem Store und startet `AlarmService` per `startForegroundService()` (setAlarmClock-Wecker dürfen das aus dem Hintergrund). Scheitert das → Fallback: Vollbild-Benachrichtigung + `AlarmActivity`, die den Service dann aus dem Vordergrund startet
- `AlarmService` (FGS-Typ `mediaPlayback`) spielt Ton (looping MediaPlayer, `USAGE_ALARM`) + Vibration, hält WakeLock, Auto-Dismiss nach 15 Min, Benachrichtigung mit Aktionen „Aus“ / „Schlummern“
- `AlarmActivity` ist NUR Oberfläche: beobachtet `AlarmService.ringing` (StateFlow) und schickt `ACTION_DISMISS`/`ACTION_SNOOZE` an den Service. Ein/Aus-Taste oder Home stoppen den Ton NICHT mehr
- `BootReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIME_SET`, `TIMEZONE_CHANGED`) → `AlarmScheduler.rescheduleAll()`; Wanduhr-Wecker werden in der aktuellen Zeitzone neu berechnet, verpasste verworfen

### Berechtigungen
- `setAlarmClock()` braucht ab Android 12 eine Exact-Alarm-Berechtigung → `USE_EXACT_ALARM` (automatisch erteilt für Wecker-Apps) + `SCHEDULE_EXACT_ALARM` als Rückfall. NICHT wieder entfernen – ohne sie wirft `setAlarmClock()` eine `SecurityException` und KEIN Wecker wird gesetzt
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `RECEIVE_BOOT_COMPLETED`, `USE_FULL_SCREEN_INTENT` (fehlt sie, erklärt ein Dialog beim Start, warum)

### Ton-Wiedergabe
- Notification-Kanal `schichtplan_alarm_v4` hat KEIN Sound/Vibration — sonst doppelter Ton. NICHT `setSilent(true)` an der Notification setzen (unterdrückt laut Gerätetest ggf. das Heads-up bei entsperrtem Handy; der Kanal ist ohnehin stumm).
- BAL-Sperre: Aus dem Hintergrund blockiert Android den direkten Start der `AlarmActivity` (Gerätetest Android 16). Bei gesperrtem Bildschirm übernimmt der Full-Screen-Intent (Vollbild), bei entsperrtem Handy erscheint ein Heads-up – der TON läuft in beiden Fällen, weil er im Service spielt. Es gibt nur noch EINEN Kanal (der alte `schichtplan_alarm_custom` wird gelöscht)

### Notification-Management
- ❌ NIEMALS `nm.cancelAll()` — löscht alle App-Notifications
- Die Alarm-Notification gehört zum Foreground-Service und verschwindet mit `stopForeground(STOP_FOREGROUND_REMOVE)`

### requestCodes & Schlummern
- requestCode = `key.hashCode() and 0x7fffffff` (wie in Altversionen → bestehende PendingIntents werden ersetzt statt verdoppelt); bei Kollision zählt `AlarmStore.requestCodeFor()` weiter. Der Code wird im Store gemerkt
- Schlummern = eigener Wecker unter `<key>#snooze` (Mehrfach-Schlummern überschreibt denselben Schlüssel). `cancel(key)` löscht immer auch `<key>#snooze` und den Alt-Code `900000 + hashCode`
- Alle Planungsfehler (auch `IllegalStateException` beim 500-Wecker-Limit) → `false`, kein Absturz

### activeAlarms (Datenstruktur, JS)
- Format: **Array** von `{ds, alarmKey, time, shiftName, auto}`; `auto:true` = per „Alle stellen“/Abgleich gesetzt, `false` = von Hand
- älteres Objekt-Format wird in `load()` migriert
- Start: `purgeExpiredAlarms()` → `syncWithNative()` (übernimmt einmalig Alt-Wecker in den Store, `Android.isStoreMigrated()`; danach fliegt aus der Liste, was nativ nicht mehr geplant ist) → `resyncAlarms({quiet:true})`

### Automatischer Abgleich (`resyncAlarms`)
- Soll-Liste = `expectedAlarmsFor(ds)` für 370 Tage (Schicht passt, Wecker-Art aktiviert, Ausnahmen, Feiertage, Wochentage, Zukunft)
- Auto-Wecker, die nicht mehr passen → gelöscht; geänderte Weckzeit → neu gesetzt. Manuelle Wecker (`auto:false`) werden NIE angefasst; heute schon fällige auch nicht (evtl. läuft Schlummern)
- Fehlende Wecker werden nur ergänzt, wenn `S.autoSchedule[art]` an ist (durch „Alle stellen“; Arten 1–4 und `free`)
- `S.suppressed`: vom Nutzer gelöschte Auto-Wecker, werden nicht wieder angelegt
- Auslöser: jede Planänderung ruft `scheduleResync()` (800 ms gebündelt)
- `S.skipHolidaysShift` (Standard `false`): Schicht-Wecker an Feiertagen auslassen. Freie-Tage-Wecker lassen Feiertage immer aus

### Persistenz (WICHTIG)
- `save()` schreibt den Zustand ZUERST synchron nativ (`Android.saveState`, SharedPreferences `app_state`, `commit()`), danach in `localStorage`. `load()` bevorzugt `Android.loadState()`
- Grund (Gerätetest): Der localStorage der WebView schreibt verzögert. Wird die App direkt nach einer Änderung beendet (z. B. aus den „Letzten Apps" gewischt), ging die Änderung verloren – gelöschte Wecker kamen zurück
- `syncWithNative()` übernimmt beim Start Wecker, die nativ geplant, aber in `activeAlarms` unbekannt sind (`Android.getScheduledAlarms()`), damit es keine unsichtbaren, nicht löschbaren Wecker gibt

### Direct Boot (WICHTIG)
- Android-Handys starten nachts für Updates neu. Mit PIN kommt `BOOT_COMPLETED` erst nach dem ersten Entsperren – ohne Direct Boot würde bis dahin KEIN Wecker klingeln (im Gerätetest nachgewiesen)
- Deshalb: `AlarmStore` liegt im gerätegeschützten Speicher (`createDeviceProtectedStorageContext()`, einmalige Migration aus dem alten Speicher), `BootReceiver` hört auf `LOCKED_BOOT_COMPLETED`, `AlarmReceiver`/`AlarmService`/`AlarmActivity`/`BootReceiver` sind `directBootAware`
- Vor dem ersten Entsperren ist der eigene Klingelton nicht lesbar → Standard-Weckton (`getAlarmSoundUri` prüft `isUserUnlocked`)

### Profil (Sicherung)
- Einstellungen → „Profil sichern“/„Profil laden“: JSON-Datei über den System-Dateidialog (`CreateDocument`/`OpenDocument` in `MainActivity`, Rückruf `onProfileImported(text)`)
- Inhalt: `{app:"schichtwecker", format:1, exportedAt, theme, data:{Plan, Einstellungen, autoSchedule, suppressed, manualAlarms}}` – automatische Wecker werden NICHT gespeichert, sondern beim Laden per `resyncAlarms()` neu berechnet
- Import läuft durch `applyState()` (dieselben Prüfungen wie beim Laden, plus Bereinigung von Muster, Bundesland, Ausnahmen). Eigener Klingelton ist nicht übertragbar (Dateizugriff gilt nur auf dem Gerät)
- `format` erhöhen, wenn sich die Struktur inkompatibel ändert; neuere Formate werden abgelehnt

### Schichttausch, Vorwecker, Weck-Verhalten
- `S.overrides` = `{"YYYY-MM-DD": 0..4}`: Schicht für einen Tag. `getShift()`: Ausnahme > Tausch > Muster. Vergangene Einträge löscht `purgeExpiredAlarms()`
- `S.preAlarmMin` (0/5/10/15/30/45/60): Vorwecker-Schlüssel `pre-<shift-Schlüssel>`, gehört zur selben Art wie der Hauptwecker (folgt „Alle stellen“). Kann über Mitternacht auf den Vortag fallen → eigenes `ds` im Soll-Eintrag. Löschen eines Schicht-Weckers löscht seinen Vorwecker mit
- Schlummerzeit / ansteigende Lautstärke / nur Vibration liegen NATIV in `AlarmOptions` (gerätegeschützter Speicher, Direct Boot), Bridge `getAlarmOptions`/`setAlarmOptions`. Im Profil als `alarmOptions`

### Wecker-Limit (WICHTIG)
- Android erlaubt max. 500 gleichzeitige Wecker pro App (`IllegalStateException`). Mit Vorwecker kommen schnell >500 zusammen (im Test: 526)
- Deshalb: `AlarmStore` speichert ALLE, scharf beim AlarmManager sind nur die frühesten `AlarmScheduler.MAX_ARMED` (350). `place()` hält das Fenster beim Setzen ein, `refillWindow()` nach Löschen/Auslösen, `ensureWindow()` (Bridge `syncAlarmWindow`) nach Sammel-Abgleichen, `rescheduleAll()` nach Neustart
- `setAlarmForDate*` gibt `true` zurück, sobald gespeichert – auch wenn der Wecker erst später scharf wird

### Klingeln
- Jeder Wecker bekommt eine NEUE Benachrichtigungs-ID (`notificationId` im `AlarmService`). Bei gleicher ID behandelt SystemUI einen zweiten Wecker (z. B. Hauptwecker während der Vorwecker noch klingelt) als Update und zeigt KEIN Vollbild
- Vibration mit `VibrationAttributes.USAGE_ALARM` (ab 13) bzw. `AudioAttributes.USAGE_ALARM` – sonst unterdrückt Android sie bei „Bitte nicht stören“/Lautlos. Im DND-Modus „Totale Stille“ blockiert Android Wecker absichtlich komplett
- Fehlt die Vollbild- (14+) oder Exact-Alarm-Berechtigung (12/12L), zeigt die App oben einen roten Hinweis mit „Erlauben“ (`getAlarmPermissionIssue`/`openAlarmPermissionSettings`), Prüfung bei jeder Rückkehr in die App

### Zurück-Geste
- `MainActivity.backCallback` fragt `window.handleBack()`: schließt Dialog → Anleitung → Tages-Sheet → Einstellungen; erst wenn nichts offen ist, verlässt die App

### WebView-Kompatibilität
- Die WebView wird über den Play Store aktualisiert; die Fallbacks in `app.css` (`top/right/bottom/left` vor `inset`, `margin` statt Flexbox-`gap` bei den Anleitungs-Punkten) stammen aus einem Test mit altem WebView und schaden nicht

### Widget
- `ShiftWidget` zeigt heute/morgen + nächsten Wecker. `app.js` schickt bei jedem `save()` 60 Tage Schichtnamen (`Android.updateWidget`), der nächste Wecker kommt aus dem `AlarmStore`
- KEIN `updatePeriodMillis` (Strom): Aktualisierung bei Änderungen, nach Wecker/Schlummern/Neustart und per nicht weckendem `AlarmManager.RTC`-Alarm kurz nach Mitternacht

### Kalender-Export
- `buildIcs()`: Früh/Spät/Nacht + Ausnahmen der nächsten 12 Monate als ganztägige Termine, gleiche Folgetage zusammengefasst, CRLF. Export über `Android.exportFile(text, name, mime)` (eigener `CreateDocument`-Dialog je MIME-Typ)

### Version
- `versionCode`/`versionName` NUR in `app/build.gradle.kts` pflegen und bei jeder ausgelieferten APK erhöhen. Die App zeigt die Version unten in den Einstellungen (`Android.getAppVersion()`)

### Reset-Verhalten
- „Alles zurücksetzen“ ruft `cancelAlarm()` je Wecker + `Android.cancelAllAlarms()` VOR `createDefaultState()`

### Rückgabewerte
- `setAlarmForDate` / `setAlarmForDateSilent` / `cancelAlarm` geben `Boolean` zurück; `cancelAlarm` zeigt KEINEN Toast (Meldung macht die Web-Oberfläche)

## Kalender-Icons

- `🔔` = Wecker TATSÄCHLICH gesetzt (via `activeAlarms`)
- ❌ KEINE halbtransparenten "Wecker stellbar"-Icons mehr (verwirrend für Nutzer)
- Kalendertage sind klickbar für Wecker-Einstellung ohne extra Icon-Hinweis

## Bekannte Bugs (behoben)

- ~~Doppelter Alarm-Ton~~ → setSound/setVibrate aus Notification entfernt
- ~~cancelAll() löscht alle Notifications~~ → cancel(requestCode)
- ~~Snooze-Key-Trunkierung~~ → (inzwischen ersetzt durch `<key>#snooze`)
- ~~color-mix() inkompatibel~~ → harte Fallback-Werte
- ~~activeAlarms erlaubt nur 1 Wecker/Tag~~ → Array-Struktur
- ~~Feiertage nicht ausgeschlossen~~ → prüfen in findAllShiftDates/scheduleAllFreeAlarms
- ~~DST off-by-one~~ → Uhrzeit 12:00 statt 0:00 in mondayOf/getShift
- ~~"Wecker stellbar"-Icons überall~~ → entfernt, nur noch echte Wecker-Icons
- ~~pendingWebView Memory Leak~~ → onDestroy() setzt auf null
- ~~setAlarmForDate Rückgabewert ignoriert~~ → prüft jetzt false
- ~~Reset löscht keine Android-Wecker~~ → cancelAlarm() vor createDefaultState()
- ~~Doppelter Ton via Channel-Sound~~ → Notification-Channel ohne setSound()/Vibration, ID auf v4 gebumpt
- ~~Buß-und-Bettag (SN) falsch, wenn 23.11. Mittwoch~~ → Rückwärtssuche ab 22.11. (16.–22.11. korrekt)
- ~~Klingelton-Anzeige nach Neustart falsch~~ → updateRingtoneUI() im INIT
- ~~save() verschluckt localStorage-Fehler~~ → Toast-Meldung bei Fehlern
- ~~SCHEDULE_EXACT_ALARM-Entfernung (15.09.2026) ließ setAlarmClock() mit SecurityException scheitern~~ → USE_EXACT_ALARM + SCHEDULE_EXACT_ALARM
- ~~Wecker nach Neustart verloren~~ → AlarmStore + BootReceiver
- ~~Ein/Aus-Taste schaltet Wecker stumm (onStop)~~ → Ton im AlarmService
- ~~Stummer Wecker bei entsperrtem Handy (Activity-Start blockiert)~~ → Ton im AlarmService, Notification mit contentIntent + Aktionen
- ~~Urlaub/Musteränderung/Abschalten lässt alte Wecker stehen~~ → resyncAlarms()
- ~~Schichtwecker an Feiertagen stillschweigend übersprungen~~ → Option, Standard: klingeln
- ~~Reformationstag fehlte in HB/HH/NI/SH, Mariä Himmelfahrt in SL~~ → ergänzt
- ~~Reset: Toast-Flut durch cancelAlarm()~~ → cancelAlarm ohne Toast
- ~~Zweites Schlummern nicht mehr löschbar~~ → Schlüssel `<key>#snooze`
- ~~Vollbild-Berechtigung: Einstellungen ohne Erklärung bei jedem Start~~ → Hinweisdialog

## Tests

- Web-Logik: `cd tests && npm install && npm test` (jsdom, nachgebaute Android-Bridge; deckt Alle stellen, Urlaub, Weckzeit, Löschen, Feiertage, Profil-Export/-Import inkl. manipulierter Dateien, Waisen-Übernahme, Persistenz, Reset ab)
- Vor jedem Release zusätzlich auf Gerät/Emulator: frische Installation, Dark Mode an/aus, Test-Alarm bei gesperrtem Bildschirm, Neustart MIT PIN ohne Entsperren
- `./gradlew lintDebug` muss ohne Fehler durchlaufen
- CI: `.github/workflows/build.yml` (Tests, Lint, Debug-APK bei jedem Push; signiertes GitHub-Release bei Tag `v<versionName>`)

## Build-Commands

```bash
./gradlew assembleDebug    # Debug APK bauen
./gradlew assembleRelease  # Release APK bauen (signing nötig)
```