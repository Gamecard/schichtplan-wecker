// Ablauftests für index.html mit nachgebauter Android-Bridge.
// Ausführen: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'index.html'), 'utf8');
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
    isStoreMigrated() { return this.migrated; },
    setStoreMigrated() { this.migrated = true; },
    exportProfile(json, name) { this.exported = { json, name }; },
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
  [...w.document.querySelectorAll('.adel')].find(b => b.dataset.key === 'shift-2026-11-09-t2').click();
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

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
