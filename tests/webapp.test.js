// Ablauftests für index.html mit nachgebauter Android-Bridge.
// Ausführen: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
// index.html lädt app.css/app.js – für jsdom direkt einbetten
const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<script src="app.js"></script>', () => '<script>' + fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8') + '</script>');
const LS = 'schichtplan-native-v1';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBridge(native) {
  return {
    store: native, migrated: true, exported: null, importCalls: 0,
    setAlarmForDateSilent(y, mo, d, h, mi, key) {
      const t = new Date(y, mo - 1, d, h, mi).getTime();
      if (t <= Date.now()) return false;
      this.store[key] = { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, y, mo, d, h, mi };
      return true;
    },
    setAlarmForDate(...a) { return this.setAlarmForDateSilent(...a); },
    cancelAlarm(key) { const had = key in this.store; delete this.store[key]; return had; },
    cancelAllAlarms() { const n = Object.keys(this.store).length; for (const k in this.store) delete this.store[k]; return n; },
    getScheduledKeys() { return JSON.stringify(Object.keys(this.store)); },
    getScheduledAlarms() { return JSON.stringify(Object.entries(this.store).map(([key, v]) => ({ key, y: v.y, mo: v.mo, d: v.d, h: v.h, mi: v.mi }))); },
    getAppVersion() { return '1.3'; },
    updateWidget(j) { this.widget = JSON.parse(j); },
    permIssue: '', getAlarmPermissionIssue() { return this.permIssue; },
    openAlarmPermissionSettings(i) { this.openedSettings = i; },
    syncAlarmWindow() { this.windowSyncs = (this.windowSyncs || 0) + 1; return 0; },
    opts: { snoozeMinutes: 5, risingVolume: false, vibrateOnly: false },
    getAlarmOptions() { return JSON.stringify(this.opts); },
    setAlarmOptions(j) { Object.assign(this.opts, JSON.parse(j)); return true; },
    isStoreMigrated() { return this.migrated; },
    setStoreMigrated() { this.migrated = true; },
    exportProfile(json, name) { this.exported = { json, name }; },
    exportFile(content, name, mime) { this.file = { content, name, mime }; },
    importProfile() { this.importCalls++; },
    usesCustomRingtone() { return false; }, getCustomRingtoneName() { return ''; },
    testAlarm() {}, pickRingtone() {}, resetRingtone() {}
  };
}
function open(storage, bridge) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) {
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
      w.localStorage.setItem('schichtplan-wizard-done', '1');
      w.Android = bridge; w.scrollTo = () => {};
    }
  });
  return dom.window;
}
const state = w => JSON.parse(w.localStorage.getItem(LS));
const dump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
const autoKeys = (w, re) => state(w).activeAlarms.filter(a => a.auto && re.test(a.alarmKey));
const click = (w, id) => w.document.getElementById(id).click();
// Tag im Kalender antippen (blättert zum richtigen Monat)
function openDay(w, ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const months = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  for (let i = 0; i < 24 && !w.document.getElementById('mTitle').textContent.includes(months[m - 1] + ' ' + y); i++) click(w, 'nextM');
  const cell = [...w.document.querySelectorAll('.cday.click')].find(c => c.querySelector('.dnum') && c.querySelector('.dnum').textContent === d + '.');
  if (!cell) throw new Error('Tag nicht im Kalender: ' + ds);
  cell.click();
}

(async () => {
  const base = {
    startDate: '2026-10-26', weeksCount: 1, bundesland: 'NI',
    pattern: [2, 2, 2, 2, 2, 1, 1], exceptions: [],
    alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
    alarmEnabled: { 1: false, 2: true, 3: false, 4: false },
    activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }
  };
  const native = {};
  let br = makeBridge(native);
  let w = open({ [LS]: JSON.stringify(base) }, br); await sleep(50);

  // Alle stellen
  [...w.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click();
  click(w, 'cdlgOk');
  const n1 = autoKeys(w, /-t2$/).length;
  ok(n1 > 250 && n1 < 270 && Object.keys(native).length === n1, `Alle stellen Früh: ${n1} Wecker, nativ synchron`);

  // Urlaub
  w.document.getElementById('exS').value = '2026-11-02';
  w.document.getElementById('exE').value = '2026-11-06';
  click(w, 'addEx'); await sleep(1000);
  ok(!native['shift-2026-11-02-t2'] && !!native['shift-2026-11-09-t2'], 'Urlaub entfernt Wecker, danach bleiben sie');

  // Weckzeit
  w.document.getElementById('tph2').parentElement.querySelector('.tbtn').click(); await sleep(1000);
  ok(native['shift-2026-11-09-t2'].time === '06:30', 'Weckzeit-Änderung übernommen');

  // Gelöscht bleibt gelöscht
  click(w, 'allAlarmsBtn');
  [...w.document.querySelectorAll('#allAlarmList .adel')].find(b => b.dataset.key === 'shift-2026-11-09-t2').click();
  w.document.getElementById('bundesland').dispatchEvent(new w.Event('change')); await sleep(1000);
  ok(!native['shift-2026-11-09-t2'], 'gelöschter Auto-Wecker bleibt gelöscht');

  // Feiertag
  ok(!!native['shift-2026-12-25-t2'], 'Feiertag: standardmäßig Wecker');
  const cb = w.document.getElementById('skipHolShift'); cb.checked = true; cb.dispatchEvent(new w.Event('change')); await sleep(1000);
  ok(!native['shift-2026-12-25-t2'], 'Feiertag auslassen wirkt');

  // Einzelwecker von Hand (für Profil-Test)
  const p = [2027, 1, 15];
  ok(br.setAlarmForDate(...p, 4, 15, 'custom-2027-01-15', 'x'), 'Einzelwecker nativ gesetzt');
  // über die App-Logik eintragen: Kalender-Sheet simulieren ist aufwendig → direkt über den Zustand
  const st = state(w); st.activeAlarms.push({ ds: '2027-01-15', alarmKey: 'custom-2027-01-15', time: '04:15', shiftName: 'Einzelwecker', auto: false });
  const saved = dump(w); saved[LS] = JSON.stringify(st); w.close();
  br = makeBridge(native); w = open(saved, br); await sleep(50);

  // ── Profil exportieren
  click(w, 'exportProfileBtn');
  ok(br.exported && /^Schichtwecker-Profil-\d{4}-\d{2}-\d{2}\.json$/.test(br.exported.name), `Export-Dateiname ${br.exported && br.exported.name}`);
  const prof = JSON.parse(br.exported.json);
  ok(prof.app === 'schichtwecker' && prof.format === 1, 'Profil-Kopf korrekt');
  ok(prof.data.exceptions.length === 1 && prof.data.autoSchedule[2] === true && prof.data.skipHolidaysShift === true, 'Profil enthält Ausnahme, Dauer-Modus, Feiertags-Option');
  ok(prof.data.manualAlarms.length === 1 && prof.data.manualAlarms[0].alarmKey === 'custom-2027-01-15', 'Profil enthält nur den manuellen Wecker');
  ok(!('activeAlarms' in prof.data), 'automatische Wecker nicht im Profil');
  const plannedBefore = Object.keys(native).sort().join();
  w.close();

  // ── Profil auf „neuem Handy“ laden (leerer Speicher, keine Wecker)
  const n2 = {}; const br2 = makeBridge(n2);
  const w2 = open({}, br2); await sleep(50);
  ok(state(w2) === null || state(w2).startDate !== '' , 'frische Installation: Startdatum gesetzt');
  ok(w2.document.getElementById('sdYear').value === String(new Date().getFullYear()), 'frische Installation: Datumsauswahl zeigt aktuelles Jahr');
  click(w2, 'importProfileBtn');
  ok(br2.importCalls === 1, 'Import öffnet Dateidialog');
  w2.onProfileImported(br.exported.json);
  click(w2, 'cdlgOk');
  ok(Object.keys(n2).sort().join() === plannedBefore, `Import setzt exakt dieselben Wecker (${Object.keys(n2).length})`);
  const s2 = state(w2);
  ok(s2.startDate === '2026-10-26' && s2.bundesland === 'NI' && s2.exceptions.length === 1, 'Import übernimmt Plan');
  ok(w2.document.getElementById('bundesland').value === 'NI' && w2.document.getElementById('skipHolShift').checked, 'Import aktualisiert Oberfläche');
  ok(s2.activeAlarms.find(a => a.alarmKey === 'custom-2027-01-15').auto === false, 'manueller Wecker bleibt manuell');

  // ── Kaputte / fremde Dateien
  const before = JSON.stringify(state(w2));
  w2.onProfileImported('kein json');
  w2.onProfileImported('{"app":"anders","data":{}}');
  w2.onProfileImported(JSON.stringify({ app: 'schichtwecker', format: 99, data: {} }));
  ok(JSON.stringify(state(w2)) === before && w2.document.getElementById('cdlgBg').style.display !== 'flex', 'ungültige Dateien werden abgelehnt, nichts geändert');

  // ── Manipulierte Werte werden bereinigt
  const evil = JSON.parse(br.exported.json);
  evil.data.pattern = ['2', 9, -1, 3.5, 4, null, 1];
  evil.data.bundesland = '<img>';
  evil.data.exceptions = [{ start: 'x', end: 'y', type: 'Urlaub' }, { id: 5, start: '2026-12-01', end: '2026-12-02', type: 'Krank' }];
  evil.data.manualAlarms = [{ ds: '2027-02-01', alarmKey: 'javascript:alert(1)', time: '04:00' }];
  w2.onProfileImported(JSON.stringify(evil)); click(w2, 'cdlgOk');
  const s3 = state(w2);
  ok(JSON.stringify(s3.pattern) === '[0,0,0,0,4,0,1]', `Muster bereinigt ${JSON.stringify(s3.pattern)}`);
  ok(s3.bundesland === 'NW' && s3.exceptions.length === 1 && typeof s3.exceptions[0].id === 'string', 'Bundesland/Ausnahmen bereinigt');
  ok(!s3.activeAlarms.some(a => a.alarmKey.startsWith('javascript')), 'ungültiger Weckerschlüssel verworfen');

  // ── Reset
  click(w2, 'resetAll'); click(w2, 'cdlgOk');
  ok(Object.keys(n2).length === 0 && state(w2).activeAlarms.length === 0, 'Reset löscht alles');

  // ── Verwaiste native Wecker (localStorage-Schreibvorgang verloren) werden übernommen
  const n3 = {}; const br3 = makeBridge(n3);
  br3.setAlarmForDateSilent(2027, 3, 1, 7, 0, 'free-day-2027-03-01', 'x');
  br3.setAlarmForDateSilent(2027, 3, 2, 4, 30, 'custom-2027-03-02', 'x');
  br3.setAlarmForDateSilent(2027, 3, 2, 4, 30, 'test-alarm', 'x');
  const w3 = open({ [LS]: JSON.stringify(Object.assign({}, base, { pattern: [0, 0, 0, 0, 0, 0, 0], freeAlarm: { enabled: true, time: '07:00', days: [0] } })) }, br3); await sleep(50);
  const s4 = state(w3).activeAlarms;
  ok(s4.some(a => a.alarmKey === 'free-day-2027-03-01' && a.auto && a.time === '07:00'), 'verwaister Freie-Tage-Wecker übernommen (auto)');
  ok(s4.some(a => a.alarmKey === 'custom-2027-03-02' && !a.auto && a.ds === '2027-03-02'), 'verwaister Einzelwecker übernommen (manuell)');
  ok(!s4.some(a => a.alarmKey === 'test-alarm'), 'Test-Alarm wird nicht übernommen');
  ok(w3.document.getElementById('appVersion').textContent === 'Schichtwecker 1.3', 'Versionszeile: ' + w3.document.getElementById('appVersion').textContent);

  // ── Synchrones natives Speichern: hat Vorrang vor (verzögertem) localStorage
  const n4 = {}; const br4 = makeBridge(n4); let nativState = '';
  br4.saveState = j => { nativState = j; return true; };
  br4.loadState = () => nativState;
  const w4 = open({ [LS]: JSON.stringify(base) }, br4); await sleep(50);
  w4.document.getElementById('exS').value = '2027-05-03'; w4.document.getElementById('addEx').click();
  ok(JSON.parse(nativState).exceptions.length === 1, 'Änderung sofort nativ gespeichert');
  w4.close();
  // localStorage „verloren“ (alter Stand ohne Ausnahme), nativer Stand aktuell
  const w5 = open({ [LS]: JSON.stringify(base) }, br4); await sleep(50);
  ok(state(w5).exceptions.length === 1 && w5.document.getElementById('exList').textContent.includes('03.05.2027'), 'Start lädt nativen Stand statt veraltetem localStorage');
  w5.close();

  // ── Schichttausch, Nächster Wecker, ICS-Export
  const n6 = {}; const br6 = makeBridge(n6);
  const w6 = open({ [LS]: JSON.stringify(base) }, br6); await sleep(50);
  [...w6.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click();
  w6.document.getElementById('cdlgOk').click();
  const na = w6.document.getElementById('nextAlarm').textContent;
  ok(/Nächster Wecker: .*05:30 Uhr.*Früh/.test(na), 'Nächster-Wecker-Zeile: ' + na);
  // Mo 16.11. (Früh) per Sheet auf Spät tauschen
  openDay(w6, '2026-11-16');
  ok(w6.document.querySelectorAll('#sSwap [data-swap]').length === 5, 'Sheet zeigt 5 Tausch-Knöpfe');
  w6.document.querySelector('#sSwap [data-swap="3"]').click();
  ok(state(w6).overrides['2026-11-16'] === 3, 'Tausch gespeichert');
  ok(!n6['shift-2026-11-16-t2'], 'Früh-Wecker am getauschten Tag entfernt');
  ok(w6.document.querySelectorAll('.cday.swapped').length === 1, 'Kalender markiert getauschten Tag');
  // Spät ist nicht aktiviert → kein Spät-Wecker; Spät aktivieren + Alle stellen → Wecker am 16.11.
  const c3 = w6.document.getElementById('ae3'); c3.checked = true; c3.dispatchEvent(new w6.Event('change', { bubbles: true }));
  [...w6.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[2].click();
  w6.document.getElementById('cdlgOk').click();
  ok(!!n6['shift-2026-11-16-t3'] && !Object.keys(n6).some(k => /-t3$/.test(k) && k !== 'shift-2026-11-16-t3'), 'Spät-Wecker nur am getauschten Tag');
  // Zurück auf Plan
  openDay(w6, '2026-11-16');
  w6.document.querySelector('#sSwap [data-swap=""]').click();
  ok(!('2026-11-16' in state(w6).overrides) && !!n6['shift-2026-11-16-t2'] && !n6['shift-2026-11-16-t3'], '„Wie Plan“ stellt Früh-Wecker wieder her');
  // Tausch im Profil
  openDay(w6, '2026-11-17');
  w6.document.querySelector('#sSwap [data-swap="1"]').click();
  w6.document.getElementById('exportProfileBtn').click();
  ok(JSON.parse(br6.exported.json).data.overrides['2026-11-17'] === 1, 'Tausch im Profil enthalten');
  // ICS
  w6.document.getElementById('exportIcsBtn').click();
  const ics = br6.file && br6.file.content || '';
  ok(br6.file && br6.file.mime === 'text/calendar' && /^Schichtplan-\d{4}-\d{2}-\d{2}\.ics$/.test(br6.file.name), 'ICS-Export: Dateiname/Typ');
  ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trim().endsWith('END:VCALENDAR'), 'ICS-Rahmen korrekt (CRLF)');
  ok(/DTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261117\r\nSUMMARY:Frühschicht/.test(ics), 'ICS: Mo 16.11. einzelner Früh-Termin');
  ok(/DTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261121\r\nSUMMARY:Frühschicht/.test(ics), 'ICS: Mi–Fr zu einem Termin zusammengefasst');
  ok(!/DTSTART;VALUE=DATE:20261117/.test(ics), 'ICS: getauschter freier Tag 17.11. ohne Termin');
  // Ungültiger Tausch aus Profil wird verworfen
  const ev = JSON.parse(br6.exported.json); ev.data.overrides = { '2026-11-20': 7, 'x': 2, '2026-11-23': '2' };
  w6.onProfileImported(JSON.stringify(ev)); w6.document.getElementById('cdlgOk').click();
  ok(JSON.stringify(state(w6).overrides) === '{}', 'ungültige Tausch-Einträge verworfen');
  w6.close();

  // ── Vorwecker und Weck-Verhalten
  const n7 = {}; const br7 = makeBridge(n7);
  const w7 = open({ [LS]: JSON.stringify(base) }, br7); await sleep(50);
  [...w7.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click();
  w7.document.getElementById('cdlgOk').click();
  const pre = w7.document.getElementById('preSel'); pre.value = '30'; pre.dispatchEvent(new w7.Event('change')); await sleep(1000);
  ok(n7['pre-shift-2026-11-16-t2'] && n7['pre-shift-2026-11-16-t2'].time === '05:00', 'Vorwecker 30 Min vor Früh (05:00)');
  ok(Object.keys(n7).filter(k => k.startsWith('pre-')).length === Object.keys(n7).filter(k => k.startsWith('shift-')).length, 'zu jedem Schicht-Wecker ein Vorwecker');
  // über Mitternacht: Früh um 00:15 → Vorwecker am Vortag 23:45
  for (let i = 0; i < 5; i++) w7.document.getElementById('tph2').parentElement.querySelectorAll('.tbtn')[1].click(); // 05→00
  for (let i = 0; i < 15; i++) w7.document.getElementById('tpm2').parentElement.querySelectorAll('.tbtn')[1].click(); // 30→15
  await sleep(1000);
  const pa = state(w7).activeAlarms.find(a => a.alarmKey === 'pre-shift-2026-11-16-t2');
  ok(pa && pa.ds === '2026-11-15' && pa.time === '23:45' && n7['pre-shift-2026-11-16-t2'].d === 15, 'Vorwecker über Mitternacht am Vortag 23:45');
  // Schicht-Wecker löschen → Vorwecker weg und bleibt weg
  openDay(w7, '2026-11-17'); click(w7, 'scnBtn');
  w7.document.getElementById('bundesland').dispatchEvent(new w7.Event('change')); await sleep(1000);
  ok(!n7['shift-2026-11-17-t2'] && !n7['pre-shift-2026-11-17-t2'], 'Löschen entfernt auch den Vorwecker dauerhaft');
  // Vorwecker aus
  pre.value = '0'; pre.dispatchEvent(new w7.Event('change')); await sleep(1000);
  ok(!Object.keys(n7).some(k => k.startsWith('pre-')), 'Vorwecker aus entfernt alle Vorwecker');
  // Weck-Verhalten
  const sz = w7.document.getElementById('snoozeSel'); sz.value = '10'; sz.dispatchEvent(new w7.Event('change'));
  const rv = w7.document.getElementById('risingVol'); rv.checked = true; rv.dispatchEvent(new w7.Event('change'));
  ok(br7.opts.snoozeMinutes === 10 && br7.opts.risingVolume === true && br7.opts.vibrateOnly === false, 'Weck-Verhalten wird nativ gespeichert');
  w7.document.getElementById('exportProfileBtn').click();
  const pj = JSON.parse(br7.exported.json);
  ok(pj.alarmOptions.snoozeMinutes === 10 && pj.data.preAlarmMin === 0, 'Profil enthält Weck-Verhalten');
  click(w7, 'resetAll'); click(w7, 'cdlgOk');
  ok(br7.opts.snoozeMinutes === 5 && !br7.opts.risingVolume && w7.document.getElementById('snoozeSel').value === '5', 'Reset setzt Weck-Verhalten zurück');
  w7.onProfileImported(br7.exported.json); click(w7, 'cdlgOk');
  ok(br7.opts.snoozeMinutes === 10 && w7.document.getElementById('risingVol').checked, 'Profil-Import stellt Weck-Verhalten wieder her');
  w7.close();

  // ── Widget-Daten
  const n8 = {}; const br8 = makeBridge(n8);
  const w8 = open({ [LS]: JSON.stringify(Object.assign({}, base, { overrides: { '2026-11-18': 3 } })) }, br8); await sleep(50);
  w8.document.getElementById('bundesland').dispatchEvent(new w8.Event('change'));
  const wd = br8.widget || {};
  const today = new Date(); const tk = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  ok(Object.keys(wd).length === 60 && tk in wd, 'Widget erhält 60 Tage ab heute');
  ok(wd['2026-11-16'] === 'Früh' && wd['2026-11-18'] === 'Spät' && wd['2026-11-21'] === 'Frei', 'Widget-Daten berücksichtigen Muster und Tausch');
  w8.close();

  // ── Zurück-Geste und Berechtigungs-Warnung
  const n9 = {}; const br9 = makeBridge(n9); br9.permIssue = 'fullscreen';
  const w9 = open({ [LS]: JSON.stringify(base) }, br9); await sleep(50);
  const pw = w9.document.getElementById('permWarn');
  ok(pw.style.display !== 'none' && /Vollbild-Wecker nicht erlaubt/.test(pw.textContent), 'Warnung bei fehlender Vollbild-Berechtigung');
  click(w9, 'permFixBtn');
  ok(br9.openedSettings === 'fullscreen', '„Erlauben“ öffnet die passende Einstellung');
  br9.permIssue = '';
  Object.defineProperty(w9.document, 'hidden', { value: false, configurable: true });
  w9.document.dispatchEvent(new w9.Event('visibilitychange'));
  ok(pw.style.display === 'none', 'Warnung verschwindet nach Rückkehr mit Berechtigung');
  w9.document.querySelector('#bottomNav [data-tab="wecker"]').click();
  ok(!w9.document.getElementById('tabWecker').hidden && w9.document.getElementById('tabPlan').hidden, 'Navigation: Bereich Wecker sichtbar');
  ok(w9.handleBack() === true && !w9.document.getElementById('tabPlan').hidden, 'Zurück aus einem Bereich führt zum Plan');
  openDay(w9, '2026-11-16');
  ok(w9.handleBack() === true && !w9.document.getElementById('overlay').classList.contains('open'), 'Zurück schließt Tages-Sheet');
  ok(w9.handleBack() === false, 'Zurück ohne offene Ebene verlässt die App');
  [...w9.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click();
  click(w9, 'cdlgOk');
  ok(br9.windowSyncs > 0, 'Nach Sammel-Abgleich wird das Scharf-Fenster nativ geprüft');
  w9.close();

  // ── Startwoche per Kalenderwoche
  const n10 = {}; const br10 = makeBridge(n10);
  const w10 = open({}, br10); await sleep(50);
  const $w = id => w10.document.getElementById(id);
  const ch = (id, v) => { $w(id).value = String(v); $w(id).dispatchEvent(new w10.Event('change')); };
  ok($w('kwPick').style.display === 'flex' && $w('datePick').style.display === 'none', 'Standard: Auswahl per Kalenderwoche');
  ch('kwYear', 2026);
  ok($w('kwNum').options.length === 53, '2026 hat 53 Kalenderwochen');
  ch('kwNum', 46);
  ok(state(w10).startDate === '2026-11-09' && /Mo 09\.11\.2026 – So 15\.11\.2026/.test($w('startInfo').textContent), 'KW 46/2026 → Montag 09.11.2026, Hinweis Mo–So');
  ch('kwYear', 2027); ch('kwNum', 1);
  ok(state(w10).startDate === '2027-01-04', 'KW 1/2027 beginnt am 04.01.2027');
  ch('kwYear', 2026); ch('kwNum', 53);
  ok(state(w10).startDate === '2026-12-28', 'KW 53/2026 beginnt am 28.12.2026');
  click(w10, 'startModeBtn');
  ok($w('datePick').style.display === 'flex' && $w('kwPick').style.display === 'none' && state(w10).startMode === 'date', 'Umschalten auf Datum');
  ch('sdDay', 12); ch('sdMon', 11); ch('sdYear', 2026);
  ok(/Woche\s*1 = KW 46\)/.test($w('startLabel').textContent.replace(/\u00a0/g, ' ')), 'Datum gewählt → Label zeigt KW: ' + $w('startLabel').textContent);
  ch('sdDay', 2); ch('sdMon', 1); ch('sdYear', 2027);
  ok(/KW 53 2026/.test($w('startLabel').textContent), 'Datum 02.01.2027 → KW 53 2026: ' + $w('startLabel').textContent);
  click(w10, 'startModeBtn');
  ok(state(w10).startMode === 'kw' && state(w10).startDate === '2026-12-28' && $w('kwNum').value === '53', 'Zurück auf KW setzt Start auf den Montag');
  w10.close();

  // ── Wochenrhythmus: Wochentag-Kopfzeile und Schnellauswahl über die Legende
  const n11 = {}; const br11 = makeBridge(n11);
  const w11 = open({ [LS]: JSON.stringify(Object.assign({}, base, { weeksCount: 2, pattern: new Array(14).fill(0) })) }, br11); await sleep(50);
  const q = sel => w11.document.querySelector(sel);
  const qa = sel => [...w11.document.querySelectorAll(sel)];
  ok(qa('#patGrid .pdh').map(e => e.textContent).join(',') === 'Mo,Di,Mi,Do,Fr,Sa,So', 'Kopfzeile Mo–So über dem Muster');
  q('.pday[data-idx="0"]').click(); q('.pday[data-idx="0"]').click();
  ok(state(w11).pattern[0] === 2 && qa('#patGrid .pdh').length === 7, 'ohne Auswahl: Tippen wechselt reihum, Kopfzeile bleibt');
  ok(qa('#patLegend .pick').length === 4 && !qa('#patLegend .pick').some(b => /Ausnahme|Feiertag/.test(b.textContent)), 'nur Frei/Früh/Spät/Nacht auswählbar');
  q('#patLegend [data-pick="3"]').click();
  ok(q('#patLegend [data-pick="3"]').classList.contains('active') && /Spät gewählt/.test(q('#patHint').textContent), 'Legende „Spät“ aktiv mit Hinweis');
  [7, 8, 9, 10, 11].forEach(i => q('.pday[data-idx="' + i + '"]').click());
  ok(state(w11).pattern.slice(7, 12).every(t => t === 3), 'ein Klick je Tag setzt Spät (Woche 2 Mo–Fr)');
  q('.pday[data-idx="0"]').click();
  ok(state(w11).pattern[0] === 3, 'Früh-Tag wird mit einem Klick zu Spät');
  q('.pday[data-idx="0"]').click();
  ok(state(w11).pattern[0] === 0, 'erneuter Klick auf Spät-Tag leert ihn');
  q('#patLegend [data-pick="3"]').click();
  ok(!q('#patLegend .pick.active') && /Tipp/.test(q('#patHint').textContent), 'Legende erneut antippen beendet die Auswahl');
  q('.pday[data-idx="1"]').click();
  ok(state(w11).pattern[1] === 1, 'danach wieder reihum (leer → Frei)');
  w11.close();

  // ── Startseite: nächste Wecker kompakt, alle Wecker auf Abruf
  const n12 = {}; const br12 = makeBridge(n12);
  const w12 = open({ [LS]: JSON.stringify(base) }, br12); await sleep(50);
  [...w12.document.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click();
  click(w12, 'cdlgOk');
  const rows = [...w12.document.querySelectorAll('#aList .arow')];
  ok(rows.length === 3 && /Mo 02\.11\./.test(rows[0].textContent) && /05:30/.test(rows[0].textContent), 'Startseite zeigt nur die nächsten 3 Wecker: ' + rows.map(r => r.textContent).join(' | '));
  ok(/^\d+ Wecker bis [A-Z][a-zä]{2}\. \d{4}$/.test(w12.document.getElementById('aSummary').textContent), 'Zusammenfassung: ' + w12.document.getElementById('aSummary').textContent);
  click(w12, 'nextM');
  ok(!w12.document.querySelector('#aList .adel') && w12.document.querySelector('.cday .aind') && !w12.document.querySelector('.cday .aind').textContent, 'keine Löschknöpfe auf der Startseite, Kalender zeigt Punkt statt Glocke');
  w12.document.querySelector('#aList .arow').click();
  ok(w12.document.getElementById('overlay').classList.contains('open') && /2\. November 2026/.test(w12.document.getElementById('sDate').textContent), 'Tippen auf einen Wecker öffnet den Tag');
  w12.handleBack();
  click(w12, 'allAlarmsBtn');
  const months = [...w12.document.querySelectorAll('#allAlarmList details.amonth')];
  ok(w12.document.getElementById('alarmsOverlay').classList.contains('open') && months.length >= 12 && months[0].open && !months[1].open, 'Alle Wecker: nach Monaten gruppiert, erster Monat offen (' + months.length + ' Monate)');
  const total = [...w12.document.querySelectorAll('#allAlarmList .adel')].length;
  ok(total === Object.keys(n12).length, 'Alle Wecker enthält jeden gestellten Wecker (' + total + ')');
  months[2].open = true; months[2].dispatchEvent(new w12.Event('toggle'));
  w12.document.querySelector('#allAlarmList .adel').click();
  const after = [...w12.document.querySelectorAll('#allAlarmList details.amonth')];
  ok(w12.document.querySelectorAll('#allAlarmList .adel').length === total - 1 && after[2].open && w12.document.getElementById('alarmsOverlay').classList.contains('open'), 'Löschen in der Liste: Fenster bleibt offen, aufgeklappte Monate bleiben offen');
  ok(w12.handleBack() === true && !w12.document.getElementById('alarmsOverlay').classList.contains('open'), 'Zurück schließt „Alle Wecker“');
  w12.close();

  // ── Anleitung und Design überleben verlorenen localStorage (nativer Stand)
  const n13 = {}; const br13 = makeBridge(n13); let st13 = '';
  br13.saveState = j => { st13 = j; return true; }; br13.loadState = () => st13;
  const w13 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) { w.Android = br13; w.scrollTo = () => {}; } }).window; await sleep(50);
  ok(w13.document.getElementById('wizBg').style.display === 'flex', 'Erststart: Anleitung erscheint');
  for (let i = 0; i < 6; i++) w13.document.getElementById('wizNext').click();
  w13.document.getElementById('themeBtn').click();   // system → light
  ok(JSON.parse(st13).wizardDone === true && JSON.parse(st13).theme === 'light', 'Anleitung gesehen + Design nativ gespeichert');
  w13.close();
  // localStorage „verloren“ (neues Fenster ohne localStorage), nur nativer Stand vorhanden
  const w14 = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) { w.Android = br13; w.scrollTo = () => {}; } }).window; await sleep(50);
  ok(w14.document.getElementById('wizBg').style.display !== 'flex', 'Anleitung erscheint nicht erneut');
  ok(w14.document.documentElement.getAttribute('data-theme') === 'light', 'Design bleibt erhalten');
  w14.close();

  // ── Bereiche und Ausnahme direkt im Tages-Sheet
  const n15 = {}; const br15 = makeBridge(n15);
  const w15 = open({ [LS]: JSON.stringify(base) }, br15); await sleep(50);
  const d15 = w15.document;
  ok(['tabPlan','tabWecker','tabSchicht'].filter(id => !d15.getElementById(id).hidden).join() === 'tabPlan', 'Start im Plan, andere Bereiche verborgen');
  ok(d15.getElementById('tabWecker').contains(d15.getElementById('alarmBox')) && d15.getElementById('tabWecker').contains(d15.getElementById('testAlarmBtn'))
     && d15.getElementById('tabSchicht').contains(d15.getElementById('patGrid')) && d15.getElementById('tabSchicht').contains(d15.getElementById('exList'))
     && d15.getElementById('tabSchicht').contains(d15.getElementById('kwNum')) && d15.getElementById('tabSchicht').contains(d15.getElementById('resetAll')), 'Karten liegen im richtigen Bereich');
  ok(!d15.getElementById('settingsOverlay') && !d15.getElementById('settingsBtn'), 'altes Einstellungs-Fenster entfernt');
  [...d15.querySelectorAll('#alarmBox button')].filter(b => b.textContent === 'Alle stellen')[1].click(); click(w15, 'cdlgOk');
  openDay(w15, '2026-11-17');
  d15.querySelector('#sSwap [data-ex="Urlaub"]').click();
  ok(state(w15).exceptions.some(e => e.start === '2026-11-17' && e.end === '2026-11-17' && e.type === 'Urlaub') && !n15['shift-2026-11-17-t2'], 'Urlaub im Tages-Sheet: Ausnahme gesetzt, Wecker sofort entfernt');
  ok(/Urlaub \(17\.11\.2026\)/.test(d15.getElementById('sSwap').textContent), 'Sheet zeigt die Ausnahme an');
  d15.getElementById('exDelBtn').click();
  ok(!state(w15).exceptions.length && !!n15['shift-2026-11-17-t2'], 'Ausnahme entfernen stellt den Wecker wieder her');
  w15.close();

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
