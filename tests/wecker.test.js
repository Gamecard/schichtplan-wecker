// Ablauftests für den Bereich „Wecker“: ein Schalter je Schicht, Migration alter Zustände,
// Meldungen, einheitliche Zeitauswahl und Einzelwecker im Tages-Sheet.
// Ausführen: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<script src="app.js"></script>', () => '<script>' + fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8') + '</script>');
const LS = 'schichtplan-native-v1';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Hilfsfunktionen (aus webapp.test.js übernommen)
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
const autoKeys = (w, re) => state(w).activeAlarms.filter(a => a.auto && re.test(a.alarmKey));
const click = (w, id) => w.document.getElementById(id).click();
const toastText = w => w.document.getElementById('toast').textContent;
function setAuto(w, t, on = true) {
  const cb = w.document.getElementById(t === 'free' ? 'freeAlarmEnabled' : 'ae' + t);
  if (cb.checked !== on) cb.click();
}
// Zeitauswahl: Pfeile und verstecktes Systemfeld der Auswahl, in der das Element (z. B. #tph2) liegt
const pickerOf = (w, id) => w.document.getElementById(id).closest('.tpick');
const arrows = (w, id) => w.document.getElementById(id).parentElement.querySelectorAll('.tbtn'); // [0]=▲ [1]=▼
function setNativeTime(w, pick, v) {
  const inp = pick.querySelector('input[type=time]');
  inp.value = v; inp.dispatchEvent(new w.Event('change', { bubbles: true }));
}
const shown = (w, hId, mId) => w.document.getElementById(hId).textContent + ':' + w.document.getElementById(mId).textContent;
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

  // ── 1. Ein Schalter je Schicht, Einzelwecker im Tages-Sheet, Meldungen
  {
    const n = {}; const br = makeBridge(n);
    const w = open({ [LS]: JSON.stringify(base) }, br); await sleep(50);
    const d = w.document;
    ok(![...d.querySelectorAll('#tabWecker button')].some(b => /Alle stellen/.test(b.textContent)), 'keine „Alle stellen“-Knöpfe mehr im Wecker-Bereich');
    ok([1, 2, 3, 4].every(t => d.getElementById('ae' + t).getAttribute('aria-label') === ['', 'Frei', 'Früh', 'Spät', 'Nacht'][t] + ': automatisch wecken')
       && d.getElementById('freeAlarmEnabled').getAttribute('aria-label') === 'Unbelegte Tage: automatisch wecken', 'Schalter haben aria-label');
    ok(d.querySelectorAll('#alarmBox .wkrow').length === 4 && d.querySelectorAll('#alarmBox .sw').length === 4, 'je Schicht eine Zeile mit genau einem Schalter');
    ok(!d.getElementById('ae2').checked && /^Aus/.test(d.getElementById('aeState2').textContent), 'Altzustand „aktiv ohne Alle stellen“ startet aus');

    // Einzelwecker von Hand (Tages-Sheet) – gemeinsame Zeitauswahl
    openDay(w, '2026-11-03');
    const sp = d.querySelector('#sPicker .tpick');
    ok(sp && sp.querySelector('input[type=time]') && sp.querySelectorAll('.tbtn').length === 4, 'Tages-Sheet nutzt die einheitliche Zeitauswahl');
    ok(d.querySelector('#sPicker [data-st="2"]').classList.contains('sftbtn-active') && shown(w, 'sqh', 'sqm') === '05:30', 'Sheet: Früh-Tag → Früh vorgewählt, 05:30');
    d.querySelector('#sPicker [data-st="0"]').click();
    ok(shown(w, 'sqh', 'sqm') === '07:00' && d.querySelector('#sPicker [data-st="0"]').getAttribute('aria-pressed') === 'true', 'Einzelwecker gewählt → Uhrzeit der unbelegten Tage (07:00)');
    arrows(w, 'sqh')[0].click(); arrows(w, 'sqm')[1].click();
    ok(shown(w, 'sqh', 'sqm') === '08:59', 'Sheet-Pfeile: Stunde ▲, Minute ▼ (00 → 59 ohne Übertrag)');
    setNativeTime(w, sp, '06:10');
    ok(shown(w, 'sqh', 'sqm') === '06:10', 'Sheet: Systemauswahl übernimmt 06:10');
    click(w, 'ssetBtn');
    ok(n['custom-2026-11-03'] && n['custom-2026-11-03'].time === '06:10'
       && state(w).activeAlarms.some(a => a.alarmKey === 'custom-2026-11-03' && a.auto === false && a.shiftName === 'Einzelwecker'), 'Einzelwecker 06:10 von Hand gestellt');
    openDay(w, '2026-11-04');
    setNativeTime(w, d.querySelector('#sPicker .tpick'), '04:50');
    click(w, 'ssetBtn');
    ok(n['shift-2026-11-04-t2'] && n['shift-2026-11-04-t2'].time === '04:50', 'Früh-Wecker 04:50 von Hand am 04.11.');

    // einschalten
    setAuto(w, 2);
    const cnt = autoKeys(w, /^shift-.*-t2$/).length;
    const m = /^Früh: (\d+) Wecker gestellt$/.exec(toastText(w));
    ok(m && Number(m[1]) === cnt && cnt > 250, 'Meldung beim Einschalten: ' + toastText(w));
    ok(state(w).alarmEnabled[2] === true && state(w).autoSchedule[2] === true, 'Einschalten setzt beide Merker');
    ok(d.getElementById('aeState2').textContent === 'An – ' + cnt + ' Wecker gestellt', 'Stand in der Zeile: ' + d.getElementById('aeState2').textContent);
    ok(n['shift-2026-11-04-t2'].time === '04:50' && state(w).activeAlarms.find(a => a.alarmKey === 'shift-2026-11-04-t2').auto === false, 'von Hand gestellter Früh-Wecker bleibt unverändert');

    // ausschalten
    setAuto(w, 2, false);
    ok(toastText(w) === 'Früh: automatische Wecker entfernt (von Hand gestellte bleiben)', 'Meldung beim Ausschalten: ' + toastText(w));
    ok(!autoKeys(w, /-t2$/).length && Object.keys(n).sort().join() === 'custom-2026-11-03,shift-2026-11-04-t2', 'Ausschalten entfernt nur die automatischen Wecker');
    ok(state(w).alarmEnabled[2] === false && state(w).autoSchedule[2] === false && /^Aus/.test(d.getElementById('aeState2').textContent), 'Ausschalten setzt beide Merker zurück');

    // keine passenden Tage → ehrlicher Hinweis, Schalter bleibt an
    setAuto(w, 4);
    ok(toastText(w) === 'Im Rhythmus gibt es keine Nacht-Tage – erst unter Schichtplan eintragen', 'Hinweis ohne Nacht-Tage: ' + toastText(w));
    ok(d.getElementById('ae4').checked && state(w).autoSchedule[4] === true && /keine Nacht-Tage im Rhythmus/.test(d.getElementById('aeState4').textContent), 'Schalter bleibt trotzdem an');
    d.querySelector('#patLegend [data-pick="4"]').click();
    d.querySelector('.pday[data-idx="2"]').click();   // Mittwoch → Nacht
    await sleep(1000);
    const nacht = Object.keys(n).filter(k => /^shift-.*-t4$/.test(k));
    ok(nacht.length > 45 && n['shift-2026-11-04-t4'] && n['shift-2026-11-04-t4'].time === '21:00', `Nacht-Tage eingetragen → Wecker kommen von selbst (${nacht.length})`);
    ok(/^An – \d+ Wecker gestellt$/.test(d.getElementById('aeState4').textContent), 'Stand aktualisiert sich nach Planänderung');
    w.close();
  }

  // ── 2. Unbelegte Tage: Schalter, Wochentag-Chips, Zeitauswahl
  {
    const n = {}; const br = makeBridge(n);
    const w = open({ [LS]: JSON.stringify(Object.assign({}, base, { pattern: [2, 2, 2, 2, 2, 0, 0] })) }, br); await sleep(50);
    const d = w.document;
    const chips = [...d.querySelectorAll('#freeAlarmBox .chiprow .sftbtn')];
    ok(chips.length === 7 && chips.map(b => b.textContent).join() === 'Mo,Di,Mi,Do,Fr,Sa,So', 'Wochentag-Chips Mo–So');
    ok(chips.every(b => !b.hasAttribute('style')) && chips.slice(0, 5).every(b => b.classList.contains('sftbtn-active') && b.getAttribute('aria-pressed') === 'true')
       && !chips[5].classList.contains('sftbtn-active') && chips[5].getAttribute('aria-label') === 'Samstag', 'Chips im Auswahl-Stil, ohne Inline-Styles, mit aria');
    setAuto(w, 'free');
    ok(toastText(w) === 'Im Rhythmus gibt es keine unbelegten Tage an den gewählten Wochentagen' && d.getElementById('freeAlarmEnabled').checked, 'Hinweis: keine unbelegten Tage an Mo–Fr, Schalter bleibt an');
    chips[5].click();
    ok(chips[5].classList.contains('sftbtn-active') && chips[5].getAttribute('aria-pressed') === 'true' && state(w).freeAlarm.days.includes(5), 'Samstag angetippt → ausgewählt');
    await sleep(1000);
    const fr = Object.keys(n).filter(k => /^free-day-/.test(k));
    ok(fr.length > 45 && n['free-day-2026-11-07'] && n['free-day-2026-11-07'].time === '07:00' && !n['free-day-2026-11-08'], `Samstags-Wecker automatisch (${fr.length}), Sonntag nicht`);
    setNativeTime(w, pickerOf(w, 'fatph'), '06:45');
    ok(state(w).freeAlarm.time === '06:45' && shown(w, 'fatph', 'fatpm') === '06:45', 'Systemauswahl setzt Uhrzeit für unbelegte Tage');
    arrows(w, 'fatpm')[0].click();
    ok(state(w).freeAlarm.time === '06:46', 'Pfeil ▲ Minute bei unbelegten Tagen');
    await sleep(1000);
    ok(n['free-day-2026-11-07'].time === '06:46', 'Uhrzeit-Änderung gleicht die Wecker ab');
    setAuto(w, 'free', false);
    ok(toastText(w) === 'Unbelegte Tage: automatische Wecker entfernt (von Hand gestellte bleiben)' && !Object.keys(n).some(k => /^free-day-/.test(k)), 'Ausschalten entfernt die Wecker der unbelegten Tage');
    setAuto(w, 'free');
    const fm = /^Unbelegte Tage: (\d+) Wecker gestellt$/.exec(toastText(w));
    ok(fm && Number(fm[1]) === autoKeys(w, /^free-day-/).length, 'Meldung beim Einschalten: ' + toastText(w));
    setAuto(w, 'free', false);
    [0, 1, 2, 3, 4, 5].forEach(i => chips[i].click());
    setAuto(w, 'free');
    ok(state(w).freeAlarm.days.length === 0 && toastText(w) === 'Unbelegte Tage: keine Wochentage gewählt – unten antippen', 'Hinweis ohne Wochentage: ' + toastText(w));
    w.close();
  }

  // ── 3. Einheitliche Zeitauswahl der Schichten
  {
    const n = {}; const br = makeBridge(n);
    const w = open({ [LS]: JSON.stringify(Object.assign({}, base, { autoSchedule: { 2: true } })) }, br); await sleep(50);
    const d = w.document;
    ok(d.querySelectorAll('#alarmBox .tpick').length === 4 && d.querySelectorAll('#alarmBox .tpick input[type=time]').length === 4, 'jede Schicht-Zeile hat dieselbe Zeitauswahl');
    ok(arrows(w, 'tph2')[0].getAttribute('aria-label') === 'Früh: Stunde später' && arrows(w, 'tpm2')[1].getAttribute('aria-label') === 'Früh: Minute früher', 'Pfeile mit aria-label');
    ok(/^Früh: Uhrzeit 05:30 Uhr/.test(d.getElementById('tph2').getAttribute('aria-label')), 'Ziffern sind beschriftete Knöpfe');
    const pick = pickerOf(w, 'tph2');
    setNativeTime(w, pick, '04:45');
    ok(state(w).alarmTimes[2] === '04:45' && shown(w, 'tph2', 'tpm2') === '04:45', 'Systemauswahl setzt Früh auf 04:45');
    await sleep(1000);
    ok(n['shift-2026-11-09-t2'] && n['shift-2026-11-09-t2'].time === '04:45', 'Wecker folgen der neuen Uhrzeit');
    setNativeTime(w, pick, '04:59'); arrows(w, 'tpm2')[0].click();
    ok(state(w).alarmTimes[2] === '04:00', 'Minute 59 ▲ → 00 ohne Übertrag');
    setNativeTime(w, pick, '00:10'); arrows(w, 'tph2')[1].click();
    ok(state(w).alarmTimes[2] === '23:10', 'Stunde 00 ▼ → 23');
    setNativeTime(w, pick, '');
    ok(state(w).alarmTimes[2] === '23:10', 'leere Systemauswahl ändert nichts');
    const inp = pick.querySelector('input[type=time]'); let calls = 0;
    inp.showPicker = () => { calls++; };
    click(w, 'tph2');
    ok(calls === 1, 'Ziffern antippen öffnet die System-Zeitauswahl (showPicker)');
    inp.showPicker = undefined;
    click(w, 'tpm2');
    ok(d.activeElement === inp, 'ohne showPicker wird das Zeitfeld fokussiert');
    w.close();
  }

  // ── 4. Migration alter Zustände (zwei Merker → ein Schalter)
  {
    // a) aktiv ohne „Alle stellen“ → aus; aktiv + „Alle stellen“ → an; „Alle stellen“ ohne aktiv → aus
    const n = {}; const br = makeBridge(n);
    const st = Object.assign({}, base, {
      alarmEnabled: { 1: true, 2: true, 3: false, 4: true }, autoSchedule: { 1: false, 2: true, 3: true, 4: false, free: false },
      freeAlarm: { enabled: true, time: '07:00', days: [5] },
      activeAlarms: [{ ds: '2026-11-21', alarmKey: 'custom-2026-11-21', time: '09:00', shiftName: 'Einzelwecker', auto: false }]
    });
    n['custom-2026-11-21'] = { time: '09:00', y: 2026, mo: 11, d: 21, h: 9, mi: 0 };
    const w = open({ [LS]: JSON.stringify(st) }, br); await sleep(50);
    const s = state(w), d = w.document;
    ok(s.alarmEnabled[1] === false && s.autoSchedule[1] === false && !d.getElementById('ae1').checked, 'aktiv ohne Alle stellen → aus');
    ok(s.alarmEnabled[2] === true && s.autoSchedule[2] === true && d.getElementById('ae2').checked, 'aktiv + Alle stellen → an');
    ok(s.alarmEnabled[3] === false && s.autoSchedule[3] === false && !d.getElementById('ae3').checked, 'Alle stellen ohne aktiv → aus');
    ok(s.freeAlarm.enabled === false && s.autoSchedule.free === false && !d.getElementById('freeAlarmEnabled').checked, 'unbelegte Tage aktiv ohne Alle stellen → aus');
    ok(autoKeys(w, /-t2$/).length > 250 && !Object.keys(n).some(k => /-t1$|^free-day-/.test(k)), 'nach dem Start nur Wecker der eingeschalteten Art');
    ok(n['custom-2026-11-21'] && s.activeAlarms.some(a => a.alarmKey === 'custom-2026-11-21' && !a.auto && a.time === '09:00'), 'manueller Wecker bleibt bei der Migration unberührt');
    w.close();
  }
  {
    // b) sehr alte Version ohne autoSchedule: per „Alle stellen“ gesetzte Wecker sollen nicht verschwinden
    const n = {}; const br = makeBridge(n);
    const st = Object.assign({}, base, {
      activeAlarms: [
        { ds: '2026-11-09', alarmKey: 'shift-2026-11-09-t2', time: '05:30', shiftName: 'Früh', auto: true },
        { ds: '2026-11-10', alarmKey: 'shift-2026-11-10-t2', time: '04:00', shiftName: 'Früh', auto: false }
      ]
    });
    n['shift-2026-11-09-t2'] = { time: '05:30', y: 2026, mo: 11, d: 9, h: 5, mi: 30 };
    n['shift-2026-11-10-t2'] = { time: '04:00', y: 2026, mo: 11, d: 10, h: 4, mi: 0 };
    const w = open({ [LS]: JSON.stringify(st) }, br); await sleep(50);
    ok(state(w).autoSchedule[2] === true && w.document.getElementById('ae2').checked, 'Altbestand mit automatischen Früh-Weckern bleibt an');
    ok(n['shift-2026-11-09-t2'] && n['shift-2026-11-10-t2'].time === '04:00' && state(w).activeAlarms.find(a => a.alarmKey === 'shift-2026-11-10-t2').auto === false, 'vorhandene Wecker bleiben, manueller unverändert');
    w.close();
  }
  {
    // c) alte Profil-Datei (ohne autoSchedule) und Profil mit beiden Merkern
    const n = {}; const br = makeBridge(n);
    const w = open({}, br); await sleep(50);
    const old = { app: 'schichtwecker', format: 1, exportedAt: '2026-09-01T10:00:00Z', data: {
      startDate: '2026-10-26', weeksCount: 1, bundesland: 'NI', pattern: [2, 2, 2, 2, 2, 0, 0], exceptions: [],
      alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' }, alarmEnabled: { 1: false, 2: true, 3: false, 4: false },
      freeAlarm: { enabled: true, time: '08:00', days: [5, 6] },
      manualAlarms: [{ ds: '2027-01-15', alarmKey: 'custom-2027-01-15', time: '04:15', shiftName: 'Einzelwecker' }] } };
    w.onProfileImported(JSON.stringify(old)); click(w, 'cdlgOk');
    const s = state(w);
    ok(s.alarmEnabled[2] === false && s.autoSchedule[2] === false && s.freeAlarm.enabled === false && !w.document.getElementById('ae2').checked, 'altes Profil: nur „aktiv“ → aus');
    ok(Object.keys(n).join() === 'custom-2027-01-15' && s.activeAlarms.length === 1 && !s.activeAlarms[0].auto, 'altes Profil: nur der manuelle Wecker gesetzt');
    const neu = JSON.parse(JSON.stringify(old)); neu.data.autoSchedule = { 2: true, free: true };
    w.onProfileImported(JSON.stringify(neu)); click(w, 'cdlgOk');
    ok(state(w).autoSchedule[2] === true && state(w).freeAlarm.enabled === true && w.document.getElementById('ae2').checked && w.document.getElementById('freeAlarmEnabled').checked, 'Profil mit beiden Merkern → an');
    ok(Object.keys(n).some(k => /-t2$/.test(k)) && n['free-day-2026-11-07'] && n['free-day-2026-11-07'].time === '08:00', 'Profil-Import stellt die automatischen Wecker');
    w.close();
  }

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
