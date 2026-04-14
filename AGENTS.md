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

- **Kotlin** (3 Dateien): `MainActivity.kt`, `AlarmReceiver.kt`, `AlarmActivity.kt`
- **JS/CSS/HTML** (1 Datei): `app/src/main/assets/index.html`
- **Paket**: `de.schichtwecker.app`
- **App-Name**: Schichtwecker
- **Theme**: `de/schichtwecker/app/ui/theme/` ( Color.kt, Type.kt, Theme.kt )

## Build & Lint

- Build: `./gradlew assembleDebug`
- APK: `app/build/outputs/apk/debug/app-debug.apk`
- Release: `isMinifyEnabled = true`, `isShrinkResources = true`

## Bekannte Patterns

- AlarmKeys: `shift-YYYY-MM-DD-tN` (Schicht), `custom-YYYY-MM-DD` (Einzelwecker), `free-day-YYYY-MM-DD` (Freier Tag)
- Snooze RequestCode: `900000 + originalRequestCode`
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

### Ton-Wiedergabe
- AlarmActivity spielt den Ton via `MediaPlayer` (looping) + Vibration
- Notification hat KEIN `.setSound()` / `.setVibrate()` — sonst doppelter Ton
- `onStop()` stoppt MediaPlayer, `onRestart()` startet ihn neu + löscht Notification

### Notification-Management
- ❌ NIEMALS `nm.cancelAll()` — löscht alle App-Notifications (z.B. Downloads)
- ✅ Statt dessen: `nm.cancel(requestCode)` für spezifische Alarm-Notification

### Snooze
- `canScheduleExactAlarms()` MUSS vor `setAlarmClock()` geprüft werden
- Snooze RequestCode: `900000 + originalRequestCode` (keine Trunkierung mit `& 0x0FFFFF`)

### activeAlarms (Datenstruktur)
- Format: **Array** von `{ds:"YYYY-MM-DD", alarmKey:"...", time:"HH:MM", shiftName:"..."}`
- älteres Format `{date: {alarmKey, time, shiftName}}` wird automatisch migriert (load()-Funktion)
- Mehrere Wecker pro Tag möglich (Helfer: `addActiveAlarm`, `removeActiveAlarm`, `getActiveAlarmsForDate`)

### Reset-Verhalten
- "Alles zurücksetzen" MUSS alle Android-Alarme per `cancelAlarm()` kündigen VOR `createDefaultState()`
- Andernfalls bleiben PendingIntents im AlarmManager aktiv

### Rückgabewerte
- `setAlarmForDate` / `setAlarmForDateSilent` geben `Boolean` zurück
- JS MUSS den Rückgabewert prüfen (`if(result===false)`) — bei Misserfolg nicht als "gesetzt" zählen

## Kalender-Icons

- `🔔` = Wecker TATSÄCHLICH gesetzt (via `activeAlarms`)
- ❌ KEINE halbtransparenten "Wecker stellbar"-Icons mehr (verwirrend für Nutzer)
- Kalendertage sind klickbar für Wecker-Einstellung ohne extra Icon-Hinweis

## Bekannte Bugs (behoben)

- ~~AlarmActivity.onStop stoppt Alarm dauerhaft~~ → onRestart() startet Ton neu
- ~~Doppelter Alarm-Ton~~ → setSound/setVibrate aus Notification entfernt
- ~~cancelAll() löscht alle Notifications~~ → cancel(requestCode)
- ~~Snooze-Key-Trunkierung~~ → 900000 + originalRequestCode
- ~~color-mix() inkompatibel~~ → harte Fallback-Werte
- ~~activeAlarms erlaubt nur 1 Wecker/Tag~~ → Array-Struktur
- ~~Feiertage nicht ausgeschlossen~~ → prüfen in findAllShiftDates/scheduleAllFreeAlarms
- ~~DST off-by-one~~ → Uhrzeit 12:00 statt 0:00 in mondayOf/getShift
- ~~"Wecker stellbar"-Icons überall~~ → entfernt, nur noch echte Wecker-Icons
- ~~pendingWebView Memory Leak~~ → onDestroy() setzt auf null
- ~~Snooze ohne Berechtigungscheck~~ → canScheduleExactAlarms() vor setAlarmClock()
- ~~setAlarmForDate Rückgabewert ignoriert~~ → prüft jetzt false
- ~~Reset löscht keine Android-Wecker~~ → cancelAlarm() vor createDefaultState()

## Build-Commands

```bash
./gradlew assembleDebug    # Debug APK bauen
./gradlew assembleRelease  # Release APK bauen (signing nötig)
```