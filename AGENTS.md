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

- **Kotlin** (6 Dateien): `MainActivity.kt` (WebView + JS-Bridge), `AlarmScheduler.kt` (+ `AlarmStore`), `AlarmReceiver.kt`, `AlarmService.kt`, `AlarmActivity.kt`, `BootReceiver.kt`
- **JS/CSS/HTML** (1 Datei): `app/src/main/assets/index.html`
- **Paket**: `de.schichtwecker.app`
- **App-Name**: Schichtwecker
- **Theme**: `de/schichtwecker/app/ui/theme/` ( Color.kt, Type.kt, Theme.kt )

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

## Build-Commands

```bash
./gradlew assembleDebug    # Debug APK bauen
./gradlew assembleRelease  # Release APK bauen (signing nötig)
```