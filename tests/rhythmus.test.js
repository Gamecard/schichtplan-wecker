// Rhythmus: bis 10 Wochen, Schalter „Rhythmus wiederholen“, Ziehen/Wischen über die Tage.
// Ausführen: cd tests && npm test
const fakeClock = require('./fake-clock');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { withLang } = require('./lang-bridge');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<script src="app.js"></script>', () => '<script>' + fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8') + '</script>');
const LS = 'schichtplan-native-v1';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBridge(store) {
  return withLang({
    store, migrated: true,
    setAlarmForDateSilent(y, mo, d, h, mi, key) {
      if (new Date(y, mo - 1, d, h, mi).getTime() <= Date.now()) return false;
      this.store[key] = { y, mo, d, h, mi }; return true;
    },
    setAlarmForDate(...a) { return this.setAlarmForDateSilent(...a); },
    cancelAlarm(key) { const had = key in this.store; delete this.store[key]; return had; },
    cancelAllAlarms() { for (const k in this.store) delete this.store[k]; return 0; },
    getScheduledKeys() { return JSON.stringify(Object.keys(this.store)); },
    getScheduledAlarms() { return JSON.stringify(Object.entries(this.store).map(([key, v]) => Object.assign({ key }, v))); },
    getAppVersion() { return '1.18'; },
    updateWidget() {}, getAlarmPermissionIssue() { return ''; }, syncAlarmWindow() { return 0; },
    getAlarmOptions() { return JSON.stringify({ snoozeMinutes: 5, risingVolume: false, vibrateOnly: false }); },
    setAlarmOptions() { return true; },
    isStoreMigrated() { return this.migrated; }, setStoreMigrated() { this.migrated = true; },
    exportProfile(json, name) { this.exported = { json, name }; },
    usesCustomRingtone() { return false; }, getCustomRingtoneName() { return ''; },
    testAlarm() {}, pickRingtone() {}, resetRingtone() {}
  }, ASSETS);
}
function open(storage, bridge, wizardDone = true) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) { fakeClock(w);
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
      if (wizardDone) w.localStorage.setItem('schichtplan-wizard-done', '1');
      w.Android = bridge; w.scrollTo = () => {};
      // jsdom hat kein Layout: x = Index des Tages × 50 px (wie echte Zellen ~50 px breit),
      // y = 0 → Schichtplan (data-idx), y = 1 → Einrichtung (data-wi)
      w.document.elementFromPoint = (x, y) => w.document.querySelector('.pday[data-' + (y ? 'wi' : 'idx') + '="' + Math.round(x / 50) + '"]');
    }
  });
  return dom.window;
}
const state = w => JSON.parse(w.localStorage.getItem(LS));
// Zeiger-Ereignis an einer Zelle (x = Index)
function ptr(w, type, el, x, wiz = 0) {
  el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x * 50, clientY: wiz, button: 0 }));
}

(async () => {
  const base = {
    startDate: '2026-10-26', weeksCount: 2, bundesland: 'NI',
    pattern: new Array(14).fill(0), exceptions: [],
    alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
    alarmEnabled: { 1: false, 2: false, 3: false, 4: false },
    activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }
  };

  // ── Alte Stände ohne neues Feld: Rhythmus wiederholt sich wie bisher
  let w = open({ [LS]: JSON.stringify(base) }, makeBridge({})); await sleep(50);
  let $ = id => w.document.getElementById(id);
  let cell = i => w.document.querySelector('#patGrid .pday[data-idx="' + i + '"]');
  ok($('patRepeat').checked && /beginnt der Rhythmus wieder mit Woche 1/.test($('patRepeatHint').textContent), 'Standard: Rhythmus wiederholen an, Erklärung sichtbar');

  // ── bis 10 Wochen
  for (let i = 0; i < 12; i++) $('incWeeks').click();
  ok($('weeksVal').textContent === '10' && state(w).weeksCount === 10 && state(w).pattern.length === 70
     && w.document.querySelectorAll('#patGrid .pday').length === 70, 'Wochen + geht bis 10 (70 Tage), nicht weiter');
  for (let i = 0; i < 8; i++) $('decWeeks').click();
  ok(state(w).weeksCount === 2 && state(w).pattern.length === 14, 'Wochen − zurück auf 2');

  // ── Antippen bleibt wie bisher
  cell(0).click(); cell(0).click();
  ok(state(w).pattern[0] === 2, 'Antippen wechselt weiter reihum (leer → Frei → Früh)');

  // ── Gedrückt halten + ziehen überträgt die Schicht des ersten Tags
  ptr(w, 'pointerdown', cell(0), 0);
  await sleep(450);
  ok($('patGrid').classList.contains('pat-drag'), 'nach Gedrückthalten startet das Ziehen');
  [1, 2, 3, 4].forEach(i => ptr(w, 'pointermove', cell(0), i));
  ptr(w, 'pointerup', cell(0), 4);
  cell(0).click();   // Klick nach dem Loslassen darf nichts ändern
  ok(JSON.stringify(state(w).pattern.slice(0, 7)) === '[2,2,2,2,2,0,0]', 'Mo gedrückt halten + bis Fr ziehen → Mo–Fr Früh: ' + JSON.stringify(state(w).pattern.slice(0, 7)));
  ok(!$('patGrid').classList.contains('pat-drag'), 'Ziehen beendet');

  // ── Wischen vor der Haltezeit (ohne Legende) ändert nichts (Seite scrollt)
  ptr(w, 'pointerdown', cell(0), 0);
  ptr(w, 'pointermove', cell(0), 7);
  ptr(w, 'pointerup', cell(0), 7);
  await sleep(450);
  ok(JSON.stringify(state(w).pattern.slice(0, 14)) === '[2,2,2,2,2,0,0,0,0,0,0,0,0,0]', 'schnelles Wischen ohne Halten ändert keine Tage');

  // ── Legende gewählt: über Tage wischen setzt die gewählte Schicht
  w.document.querySelector('#patLegend [data-pick="1"]').click();
  ok(/mehrere Tage wischen/.test($('patHint').textContent), 'Hinweis nennt das Wischen');
  ptr(w, 'pointerdown', cell(5), 5);
  ptr(w, 'pointermove', cell(5), 6);
  ptr(w, 'pointermove', cell(5), 12);
  ptr(w, 'pointermove', cell(5), 13);
  ptr(w, 'pointerup', cell(5), 13);
  cell(5).click();
  ok(JSON.stringify(state(w).pattern) === '[2,2,2,2,2,1,1,0,0,0,0,0,1,1]', 'Frei gewählt + über Sa/So beider Wochen gewischt: ' + JSON.stringify(state(w).pattern));
  cell(7).click();
  ok(state(w).pattern[7] === 1, 'Antippen mit gewählter Legende funktioniert weiter');
  cell(7).click();
  ok(state(w).pattern[7] === 0, '… und nochmal antippen leert den Tag wie bisher');
  w.document.querySelector('#patLegend [data-pick="1"]').click();

  // ── Rhythmus nicht wiederholen: Plan endet nach der letzten Woche
  $('patRepeat').click(); await sleep(20);
  ok(state(w).patternRepeat === false && /bis \d/.test($('patRepeatHint').textContent) && /08\.11\.2026/.test($('patRepeatHint').textContent),
     'Schalter aus: gespeichert, Enddatum genannt: ' + $('patRepeatHint').textContent);
  // Profil enthält den Schalter
  w.Android.exported = null;
  $('exportProfileBtn').click();
  ok(!!w.Android.exported && JSON.parse(w.Android.exported.json).data.patternRepeat === false, 'Profil enthält „Rhythmus wiederholen“');
  w.close();

  // ── Wecker richten sich nach dem Schalter
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const mo = new Date(today); mo.setDate(mo.getDate() - ((mo.getDay() + 6) % 7));
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const plan = Object.assign({}, base, {
    startDate: ymd(mo), weeksCount: 2, pattern: [2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 1, 1],
    alarmEnabled: { 1: false, 2: true, 3: false, 4: false }, autoSchedule: { 1: false, 2: true, 3: false, 4: false, free: false }
  });
  const nRep = {}; w = open({ [LS]: JSON.stringify(plan) }, makeBridge(nRep)); await sleep(1200);
  const repCount = Object.keys(nRep).filter(k => /-t2$/.test(k)).length;
  w.close();
  const nOnce = {}; w = open({ [LS]: JSON.stringify(Object.assign({}, plan, { patternRepeat: false })) }, makeBridge(nOnce)); await sleep(1200);
  const onceKeys = Object.keys(nOnce).filter(k => /-t2$/.test(k));
  const end = new Date(mo); end.setDate(end.getDate() + 13);
  ok(repCount > 200, 'wiederholt: Früh-Wecker übers ganze Jahr (' + repCount + ')');
  ok(onceKeys.length > 0 && onceKeys.length <= 10 && onceKeys.every(k => k.slice(6, 16) <= ymd(end)),
     'einmalig: nur Früh-Wecker innerhalb der 2 Wochen (' + onceKeys.length + ')');
  w.close();

  // ── Wertebereich beim Laden: mehr als 10 Wochen werden auf 10 begrenzt
  w = open({ [LS]: JSON.stringify(Object.assign({}, base, { weeksCount: 25, patternRepeat: 'nein' })) }, makeBridge({})); await sleep(50);
  ok(state(w).weeksCount === 10 && w.document.getElementById('patRepeat').checked, 'Laden: 25 Wochen → 10, ungültiger Schalterwert → Standard an');
  w.close();

  // ── Einrichtung: bis 10 Wochen und Ziehen
  w = open({ [LS]: JSON.stringify(base) }, makeBridge({}), false); await sleep(50);
  $ = id => w.document.getElementById(id);
  const next = () => $('wizNext').click();
  if ($('wizBg').classList.contains('open')) {
    next();   // Schritt 2: Rhythmus
    for (let i = 0; i < 12; i++) w.document.querySelector('#wizBody [data-wweeks="1"]').click();
    ok($('wizWeeksVal').textContent === '10' && w.document.querySelectorAll('#wizPat .pday').length === 70, 'Einrichtung: bis 10 Wochen');
    const wc = i => w.document.querySelector('#wizPat .pday[data-wi="' + i + '"]');
    wc(0).click(); wc(0).click(); wc(0).click();   // leer → Frei → Früh → Spät
    ptr(w, 'pointerdown', wc(0), 0, 1); await sleep(450);
    [1, 2].forEach(i => ptr(w, 'pointermove', wc(0), i, 1));
    ptr(w, 'pointerup', wc(0), 2, 1); wc(0).click();
    ok([0, 1, 2].every(i => wc(i).textContent === 'Spät') && wc(3).textContent === 'Do', 'Einrichtung: Mo halten + bis Mi ziehen → Mo–Mi Spät');
  } else ok(false, 'Einrichtung öffnet nicht automatisch');
  w.close();

  console.log(fails ? fails + ' Fehler' : 'alle Rhythmus-Tests bestanden');
  process.exit(fails ? 1 : 0);
})();
