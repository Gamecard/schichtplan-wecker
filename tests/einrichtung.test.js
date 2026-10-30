// Ablauftests der geführten Einrichtung (Startwoche, Rhythmus, Weckzeiten, Feiertage, Abschluss).
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
const WIZ = 'schichtplan-wizard-done';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Nachgebaute Android-Bridge (wie in webapp.test.js)
function makeBridge(native) {
  return {
    store: native, migrated: true,
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
    getAlarmPermissionIssue() { return ''; },
    syncAlarmWindow() { return 0; },
    opts: { snoozeMinutes: 5, risingVolume: false, vibrateOnly: false },
    getAlarmOptions() { return JSON.stringify(this.opts); },
    setAlarmOptions(j) { Object.assign(this.opts, JSON.parse(j)); return true; },
    isStoreMigrated() { return this.migrated; },
    setStoreMigrated() { this.migrated = true; },
    usesCustomRingtone() { return false; }, getCustomRingtoneName() { return ''; },
    testAlarm() {}, pickRingtone() {}, resetRingtone() {}
  };
}
// wizardSeen=false → localStorage-Merker fehlt (Erststart-Verhalten)
function open(storage, bridge, wizardSeen = true) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) {
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
      if (wizardSeen) w.localStorage.setItem(WIZ, '1');
      w.Android = bridge; w.scrollTo = () => {};
    }
  });
  return dom.window;
}
const state = w => JSON.parse(w.localStorage.getItem(LS));
// Plan-relevanter Teil des Zustands (für „ändert nichts“-Vergleiche)
const core = s => JSON.stringify(['startDate', 'startMode', 'weeksCount', 'pattern', 'bundesland', 'alarmTimes', 'alarmEnabled', 'autoSchedule', 'suppressed', 'activeAlarms'].map(k => s && s[k]));
const dump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  return [y, Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)];
}
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

// Kleine Bedienhilfe für die Einrichtung
function wiz(w) {
  const d = w.document, $ = id => d.getElementById(id);
  return {
    $, isOpen: () => $('wizBg').classList.contains('open'),
    step: () => $('wizStepTxt').textContent,
    next: () => $('wizNext').click(), prev: () => $('wizPrev').click(), skip: () => $('wizSkip').click(),
    set(id, v) { const e = $(id); if (e.type === 'checkbox') e.checked = v; else e.value = String(v); e.dispatchEvent(new w.Event('change', { bubbles: true })); },
    tpl: id => d.querySelector('#wizBody [data-tpl="' + id + '"]').click(),
    day: i => d.querySelector('#wizPat .pday[data-wi="' + i + '"]').click(),
    weeks: delta => d.querySelector('#wizBody [data-wweeks="' + delta + '"]').click(),
    gridTypes: () => [...d.querySelectorAll('#wizPat .pday[data-wi]')].map(e => e.textContent)
  };
}

(async () => {
  // ── 1) Erststart: Einrichtung öffnet automatisch, kompletter Durchlauf mit Vorlage
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const thisMon = addDays(today, -((today.getDay() + 6) % 7));
  const startMon = addDays(thisMon, 7);                    // Startwoche = nächste Woche
  const [ky, kw] = isoWeek(startMon), [cy, cw] = isoWeek(today);
  const n1 = {}; const br1 = makeBridge(n1);
  const w1 = open({}, br1, false); await sleep(50);
  const z = wiz(w1);
  ok(z.isOpen(), 'Erststart: Einrichtung öffnet automatisch');
  ok(z.step() === 'Schritt 1 von 4' && w1.document.querySelectorAll('#wizBar span.on').length === 1, 'Fortschritt: Schritt 1 von 4');
  ok(z.$('wizKwNum').value === String(cw) && z.$('wizKwYear').value === String(cy), `Vorauswahl aktuelle Woche (KW ${cw}/${cy})`);
  ok(z.$('wizPrev').style.visibility === 'hidden', 'Schritt 1 ohne Zurück-Knopf (Schließen über „Überspringen“)');
  z.set('wizKwYear', ky); z.set('wizKwNum', kw);
  const sun = addDays(startMon, 6);
  const range = `Mo ${pad(startMon.getDate())}.${pad(startMon.getMonth() + 1)}. – So ${pad(sun.getDate())}.${pad(sun.getMonth() + 1)}.`;
  ok(z.$('wizKwInfo').textContent.startsWith(range), 'Anzeige Mo–So: ' + z.$('wizKwInfo').textContent);
  ok(Object.keys(n1).length === 0 && state(w1).startDate === ymd(today), 'Auswahl ändert noch nichts');
  z.next();
  ok(z.step() === 'Schritt 2 von 4', 'Weiter → Schritt 2');
  z.tpl('fs');
  ok(z.$('wizWeeksVal').textContent === '2' && z.gridTypes().join() === 'Früh,Früh,Früh,Früh,Früh,Frei,Frei,Spät,Spät,Spät,Spät,Spät,Frei,Frei',
    'Vorlage „Früh/Spät im Wochenwechsel“: ' + z.gridTypes().join());
  ok(w1.document.querySelector('#wizBody [data-tpl="fs"]').classList.contains('active'), 'gewählte Vorlage markiert');
  ok([...w1.document.querySelectorAll('#wizPat .pdh')].map(e => e.textContent).join() === 'Mo,Di,Mi,Do,Fr,Sa,So', 'Wochenraster mit Kopfzeile Mo–So');
  z.day(5);                                               // Sa Woche 1: Frei → Früh
  ok(z.gridTypes()[5] === 'Früh' && !w1.document.querySelector('#wizBody .wiz-tpl.active'), 'Tag antippen wechselt reihum, Vorlagen-Markierung weg');
  z.weeks(1); ok(z.$('wizWeeksVal').textContent === '3' && z.gridTypes().length === 21, 'Wochen + → 3');
  z.weeks(-1); ok(z.gridTypes().length === 14 && z.gridTypes()[7] === 'Spät', 'Wochen − → 2, Muster bleibt');
  z.next();
  ok(z.step() === 'Schritt 3 von 4', 'Weiter → Schritt 3');
  ok(z.$('wizTime2') && z.$('wizTime3') && z.$('wizTime1') && !z.$('wizTime4'), 'Weckzeiten nur für Schichten im Muster (Früh, Spät, Frei)');
  ok(z.$('wizTime2').value === '05:30' && z.$('wizAuto2').checked && z.$('wizAuto3').checked && !z.$('wizAuto1').checked, 'Standard: Schichten automatisch, Frei nicht');
  z.set('wizTime2', '05:15');
  z.prev(); ok(z.step() === 'Schritt 2 von 4' && z.gridTypes()[5] === 'Früh', 'Zurück-Knopf: Entwurf bleibt erhalten');
  z.next(); ok(z.$('wizTime2').value === '05:15', 'geänderte Weckzeit bleibt im Entwurf');
  z.next();
  ok(z.step() === 'Schritt 4 von 4' && z.$('wizBl').options.length === 16 && z.$('wizBl').value === 'NW', 'Schritt 4: Bundesland-Auswahl (Vorbelegung NW)');
  ok(z.$('wizNext').textContent === 'Einrichten', 'letzter Schritt: „Einrichten“');
  z.set('wizBl', 'BY');
  z.next();
  const s1 = state(w1);
  ok(s1.startDate === ymd(startMon) && s1.startMode === 'kw', `Startdatum = Montag der KW ${kw}/${ky} (${s1.startDate})`);
  ok(JSON.stringify(s1.pattern) === '[2,2,2,2,2,2,1,3,3,3,3,3,1,1]' && s1.weeksCount === 2, 'Muster übernommen: ' + JSON.stringify(s1.pattern));
  ok(s1.bundesland === 'BY' && s1.alarmTimes[2] === '05:15' && s1.alarmTimes[3] === '13:00', 'Bundesland und Weckzeiten übernommen');
  ok(s1.autoSchedule[2] && s1.autoSchedule[3] && !s1.autoSchedule[1] && !s1.autoSchedule[4], 'automatische Wecker für Früh und Spät an');
  const t2 = Object.keys(n1).filter(k => /^shift-.*-t2$/.test(k)), t3 = Object.keys(n1).filter(k => /^shift-.*-t3$/.test(k));
  ok(t2.length > 100 && t3.length > 100 && !Object.keys(n1).some(k => /-t[14]$/.test(k)), `Wecker nativ gesetzt (Früh ${t2.length}, Spät ${t3.length})`);
  ok(t2.every(k => n1[k].time === '05:15') && n1['shift-' + ymd(startMon) + '-t2'] && n1['shift-' + ymd(addDays(startMon, 5)) + '-t2'] && n1['shift-' + ymd(addDays(startMon, 7)) + '-t3'],
    'Mo/Sa Woche 1 Früh 05:15, Mo Woche 2 Spät');
  ok(!Object.keys(n1).some(k => k < 'shift-' + ymd(startMon)), 'kein Wecker vor der Startwoche');
  ok(s1.activeAlarms.length === Object.keys(n1).length && s1.wizardDone === true && w1.localStorage.getItem(WIZ) === '1', 'Liste nativ synchron, Einrichtung als erledigt gemerkt');
  ok(z.step() === 'Fertig' && z.$('wizNext').textContent === 'Zum Plan' && z.$('wizSkip').style.visibility === 'hidden', 'Abschluss-Seite');
  const sum = z.$('wizSummary').textContent;
  const m = sum.match(/^(\d+) Wecker gestellt · nächster: ([A-Z][a-z]) (\d{2}\.\d{2}\.) (\d{2}:\d{2})$/);
  ok(m && Number(m[1]) === Object.keys(n1).length && m[2] === 'Mo' && m[3] === `${pad(startMon.getDate())}.${pad(startMon.getMonth() + 1)}.` && m[4] === '05:15', 'Zusammenfassung: ' + sum);
  ok(/Test-Alarm/.test(z.$('wizBody').textContent) && /Bayern/.test(z.$('wizBody').textContent), 'Hinweis auf Test-Alarm, Bundesland in der Übersicht');
  ok(z.$('bundesland').value === 'BY' && z.$('weeksVal').textContent === '2' && z.$('kwNum').value === String(kw), 'Bereich Schichtplan zeigt die neuen Werte');
  w1.document.querySelector('#bottomNav [data-tab="schicht"]').click();
  z.next();
  ok(!z.isOpen() && !z.$('tabPlan').hidden && z.$('tabSchicht').hidden, '„Zum Plan“ schließt und zeigt den Plan');
  ok(z.$('mTitle').textContent.includes(MONTHS[startMon.getMonth()] + ' ' + startMon.getFullYear()), 'Kalender im Monat der Startwoche: ' + z.$('mTitle').textContent);
  const keys1 = Object.keys(n1).sort().join();
  await sleep(1000);
  ok(Object.keys(n1).sort().join() === keys1 && !/Wecker angepasst/.test(z.$('toast').textContent), 'kein nachlaufender Abgleich/Toast');
  // zweiter Start: keine Einrichtung mehr
  const saved1 = dump(w1); w1.close();
  const w1b = open(saved1, makeBridge(n1), false); await sleep(50);
  ok(!wiz(w1b).isOpen(), 'zweiter Start: Einrichtung öffnet nicht');
  ok(Object.keys(n1).sort().join() === keys1, 'zweiter Start lässt die Wecker unverändert');
  w1b.close();

  // ── 2) Überspringen ändert nichts
  const base = {
    startDate: '2026-10-26', weeksCount: 1, bundesland: 'NI',
    pattern: [2, 2, 2, 2, 2, 1, 1], exceptions: [],
    alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
    alarmEnabled: { 1: false, 2: false, 3: false, 4: false },
    activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }
  };
  const n2 = {}; const br2 = makeBridge(n2);
  const w2 = open({ [LS]: JSON.stringify(base) }, br2, false); await sleep(50);
  const z2 = wiz(w2);
  ok(z2.isOpen(), 'ohne Merker: Einrichtung öffnet beim Start');
  const before2 = core(state(w2) || {});
  z2.set('wizKwNum', 2); z2.next(); z2.tpl('fsn'); z2.next(); z2.set('wizTime2', '04:00'); z2.next(); z2.set('wizBl', 'SN');
  z2.skip(); await sleep(1000);
  const after2 = state(w2); const done2 = after2.wizardDone;
  ok(!z2.isOpen() && core(after2) === before2 && Object.keys(n2).length === 0, 'Überspringen in Schritt 4: nichts übernommen, keine Wecker');
  ok(done2 === true && w2.localStorage.getItem(WIZ) === '1', 'Überspringen merkt die Einrichtung als erledigt');
  z2.$('startWizBtn').click();
  ok(z2.isOpen() && z2.step() === 'Schritt 1 von 4', '„Einrichtung starten“ öffnet erneut bei Schritt 1');
  z2.skip();
  ok(!z2.isOpen() && core(state(w2)) === before2, 'Überspringen in Schritt 1 ändert nichts');
  w2.close();

  // ── 3) Erneuter Start: aktuelle Werte vorbelegt, ohne Änderung bleibt alles
  const cur = Object.assign({}, base, {
    startDate: '2026-11-09', weeksCount: 3, bundesland: 'HE', startMode: 'kw',
    pattern: [2, 2, 2, 2, 2, 1, 1, 3, 3, 3, 3, 3, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    alarmTimes: { 1: '07:00', 2: '04:45', 3: '12:30', 4: '21:00' },
    alarmEnabled: { 1: false, 2: true, 3: false, 4: false }, autoSchedule: { 1: false, 2: true, 3: false, 4: false, free: false },
    wizardDone: true
  });
  const n3 = {}; const br3 = makeBridge(n3);
  const w3 = open({ [LS]: JSON.stringify(cur) }, br3); await sleep(50);
  const z3 = wiz(w3);
  ok(!z3.isOpen(), 'eingerichtete App: Einrichtung öffnet nicht von selbst');
  // einen Auto-Wecker gezielt löschen – darf durch die Einrichtung nicht zurückkommen
  const del = Object.keys(n3).filter(k => /-t2$/.test(k)).sort()[1];
  z3.$('allAlarmsBtn').click();
  [...w3.document.querySelectorAll('#allAlarmList .adel')].find(b => b.dataset.key === del).click();
  z3.$('closeAlarms').click();
  const keys3 = Object.keys(n3).sort().join(), st3 = JSON.stringify(state(w3));
  z3.$('startWizBtn').click();
  ok(z3.$('wizKwNum').value === '46' && z3.$('wizKwYear').value === '2026' && /^Mo 09\.11\. – So 15\.11\./.test(z3.$('wizKwInfo').textContent), 'Startwoche vorbelegt (KW 46/2026)');
  z3.next();
  ok(z3.$('wizWeeksVal').textContent === '3' && z3.gridTypes().join() === 'Früh,Früh,Früh,Früh,Früh,Frei,Frei,Spät,Spät,Spät,Spät,Spät,Frei,Frei,Mo,Di,Mi,Do,Fr,Sa,So'
     && !w3.document.querySelector('#wizBody .wiz-tpl.active'), 'Rhythmus vorbelegt, keine Vorlage angewendet');
  z3.next();
  ok(z3.$('wizTime2').value === '04:45' && z3.$('wizAuto2').checked && z3.$('wizTime3').value === '12:30' && !z3.$('wizAuto3').checked, 'Weckzeiten + Schalter wie eingestellt (Spät bleibt aus)');
  z3.next();
  ok(z3.$('wizBl').value === 'HE', 'Bundesland vorbelegt');
  z3.next();
  ok(Object.keys(n3).sort().join() === keys3 && !n3[del] && JSON.stringify(state(w3)) === st3, 'Einrichten ohne Änderung: Plan und Wecker unverändert, gelöschter Wecker bleibt weg');
  w3.close();

  // ── 4) Zurück-Geste
  const n4 = {}; const br4 = makeBridge(n4);
  const w4 = open({ [LS]: JSON.stringify(base) }, br4); await sleep(50);
  const z4 = wiz(w4);
  const st4 = JSON.stringify(state(w4));
  z4.$('startWizBtn').click(); z4.next(); z4.tpl('leer'); z4.next();
  ok(z4.step() === 'Schritt 3 von 4' && /noch leer/.test(z4.$('wizBody').textContent), 'leeres Muster: Hinweis statt Weckzeiten');
  ok(w4.handleBack() === true && z4.step() === 'Schritt 2 von 4', 'Zurück-Geste: einen Schritt zurück');
  ok(w4.handleBack() === true && z4.step() === 'Schritt 1 von 4' && z4.isOpen(), 'Zurück-Geste: Schritt 1');
  ok(w4.handleBack() === true && !z4.isOpen(), 'Zurück-Geste auf Schritt 1 schließt');
  ok(JSON.stringify(state(w4)) === st4 && state(w4).pattern.join() === '2,2,2,2,2,1,1', 'Schließen per Geste ändert nichts');
  ok(w4.handleBack() === false, 'danach verlässt Zurück die App');
  // Abschluss-Seite: Zurück-Geste = „Zum Plan“
  z4.$('startWizBtn').click(); z4.next(); z4.next(); z4.next(); z4.next();
  ok(z4.step() === 'Fertig', 'Durchlauf ohne Änderungen bis zum Abschluss');
  ok(w4.handleBack() === true && !z4.isOpen() && !z4.$('tabPlan').hidden, 'Zurück-Geste auf dem Abschluss führt zum Plan');
  w4.close();

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
