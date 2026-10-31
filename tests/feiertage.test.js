// Feiertage für Deutschland, Österreich und die Schweiz: Land/Region-Auswahl, Feiertagslisten
// (gegen von Hand recherchierte Listen, s. Quellenkommentar über holidays() in app.js),
// Migration alter Daten (ohne Land = Deutschland), Wecker-Neuplanung beim Landwechsel,
// Profil, Einrichtung und Übersetzungen.
// Ausführen: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { withLang } = require('./lang-bridge');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const JS = fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<script src="app.js"></script>', () => '<script>' + JS + '</script>');
const LS = 'schichtplan-native-v1';
const LANG = code => JSON.parse(fs.readFileSync(path.join(ASSETS, 'lang', code + '.json'), 'utf8'));
const de = LANG('de');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBridge(native, lang) {
  return withLang({
    store: native, migrated: true, exported: null, importCalls: 0,
    setAlarmForDateSilent(y, mo, d, h, mi, key) {
      if (new Date(y, mo - 1, d, h, mi).getTime() <= Date.now()) return false;
      this.store[key] = { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, y, mo, d, h, mi };
      return true;
    },
    setAlarmForDate(...a) { return this.setAlarmForDateSilent(...a); },
    cancelAlarm(key) { const had = key in this.store; delete this.store[key]; return had; },
    cancelAllAlarms() { for (const k in this.store) delete this.store[k]; return 0; },
    getScheduledKeys() { return JSON.stringify(Object.keys(this.store)); },
    getScheduledAlarms() { return JSON.stringify(Object.entries(this.store).map(([key, v]) => ({ key, y: v.y, mo: v.mo, d: v.d, h: v.h, mi: v.mi }))); },
    getAppVersion() { return '1.15'; },
    updateWidget() {},
    getAlarmPermissionIssue() { return ''; }, openAlarmPermissionSettings() {},
    syncAlarmWindow() { return 0; },
    opts: { snoozeMinutes: 5, risingVolume: false, vibrateOnly: false },
    getAlarmOptions() { return JSON.stringify(this.opts); }, setAlarmOptions(j) { Object.assign(this.opts, JSON.parse(j)); return true; },
    isStoreMigrated() { return true; }, setStoreMigrated() {},
    exportProfile(json, name) { this.exported = { json, name }; },
    exportFile() {}, importProfile() { this.importCalls++; },
    usesCustomRingtone() { return false; }, getCustomRingtoneName() { return ''; },
    testAlarm() {}, pickRingtone() {}, resetRingtone() {}
  }, ASSETS, lang);
}
function open(storage, bridge, wizardSeen = true) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) {
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
      if (wizardSeen) w.localStorage.setItem('schichtplan-wizard-done', '1');
      w.Android = bridge; w.scrollTo = () => {};
    }
  }).window;
}
const state = w => JSON.parse(w.localStorage.getItem(LS));
const select = (w, id, v) => { const s = w.document.getElementById(id); s.value = v; s.dispatchEvent(new w.Event('change', { bubbles: true })); };
const base = (extra = {}) => Object.assign({
  startDate: '2026-10-26', weeksCount: 1, pattern: [0, 0, 0, 0, 0, 0, 0], exceptions: [],
  alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
  alarmEnabled: { 1: false, 2: false, 3: false, 4: false }, autoSchedule: { 1: false, 2: false, 3: false, 4: false, free: false },
  activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }
}, extra);

// Anzeige-Text (de) → Kennung
const LABEL2ID = {};
Object.keys(de).filter(k => k.startsWith('holiday.')).forEach(k => { LABEL2ID[de[k]] = k.slice(8); });
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
// Feiertage eines Jahres aus dem Kalender ablesen: {"MM-DD": kennung}
function calendarHolidays(w, year) {
  const d = w.document, title = () => d.getElementById('mTitle').textContent;
  const idx = () => { const [m, y] = title().split(' '); return Number(y) * 12 + MONTHS.indexOf(m); };
  const target = year * 12;
  for (let i = 0; i < 200 && idx() !== target; i++) d.getElementById(idx() > target ? 'prevM' : 'nextM').click();
  const out = {};
  for (let m = 0; m < 12; m++) {
    d.querySelectorAll('#calGrid .cday').forEach(c => {
      const p = c.querySelector('.dpill.hp'), n = c.querySelector('.dnum');
      if (p && n) out[String(m + 1).padStart(2, '0') + '-' + n.textContent.replace('.', '').padStart(2, '0')] = LABEL2ID[p.textContent] || '?' + p.textContent;
    });
    d.getElementById('nextM').click();
  }
  return out;
}
const fmt = h => Object.keys(h).sort().map(k => k + ' ' + h[k]).join(', ');
function expectYear(country, region, year, list) {
  const w = open({ [LS]: JSON.stringify(base({ country, bundesland: region })) }, makeBridge({}));
  const got = calendarHolidays(w, year); w.close();
  const want = {};
  list.split(',').map(s => s.trim()).filter(Boolean).forEach(s => { const [md, id] = s.split(' '); want[md] = id; });
  const same = fmt(got) === fmt(want);
  ok(same, `${country || "ohne Land"}/${region} ${year}: ${Object.keys(want).length} Feiertage` + (same ? '' : '\n      ist:  ' + fmt(got) + '\n      soll: ' + fmt(want)));
}

(async () => {
  // ── 1) Österreich: 13 Feiertage, in allen Bundesländern gleich (ARG § 7 Abs. 2)
  const AT26 = '01-01 neujahr, 01-06 heilige_drei_koenige, 04-06 ostermontag, 05-01 staatsfeiertag, 05-14 himmelfahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 08-15 mariae_himmelfahrt, 10-26 nationalfeiertag, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten, 12-26 stephanstag';
  const AT27 = '01-01 neujahr, 01-06 heilige_drei_koenige, 03-29 ostermontag, 05-01 staatsfeiertag, 05-06 himmelfahrt, 05-17 pfingstmontag, 05-27 fronleichnam, 08-15 mariae_himmelfahrt, 10-26 nationalfeiertag, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten, 12-26 stephanstag';
  expectYear('AT', 'W', 2026, AT26);
  expectYear('AT', 'T', 2027, AT27);
  expectYear('AT', 'NOE', 2026, AT26);   // kein Leopolditag 15.11., kein Karfreitag 03.04.

  // ── 2) Schweiz: Stichproben (Art. 20a ArG + kantonale Ruhetage), 2026 Ostern 5.4., 2027 Ostern 28.3.
  expectYear('CH', 'ZH', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-01 tag_der_arbeit, 05-14 auffahrt, 05-25 pfingstmontag, 08-01 bundesfeier, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'GE', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-14 auffahrt, 05-25 pfingstmontag, 08-01 bundesfeier, 09-10 jeune_genevois, 12-25 weihnachten, 12-31 restauration_ge');
  expectYear('CH', 'GE', 2027, '01-01 neujahr, 03-26 karfreitag, 03-29 ostermontag, 05-06 auffahrt, 05-17 pfingstmontag, 08-01 bundesfeier, 09-09 jeune_genevois, 12-25 weihnachten, 12-31 restauration_ge');
  expectYear('CH', 'VD', 2026, '01-01 neujahr, 01-02 berchtoldstag, 04-03 karfreitag, 04-06 ostermontag, 05-14 auffahrt, 05-25 pfingstmontag, 08-01 bundesfeier, 09-21 bettagsmontag, 12-25 weihnachten');
  expectYear('CH', 'VD', 2027, '01-01 neujahr, 01-02 berchtoldstag, 03-26 karfreitag, 03-29 ostermontag, 05-06 auffahrt, 05-17 pfingstmontag, 08-01 bundesfeier, 09-20 bettagsmontag, 12-25 weihnachten');
  // Näfelser Fahrt: 1. Donnerstag im April, auf Gründonnerstag → eine Woche später (2026: 2.4. → 9.4.; 2023: 6.4. → 13.4.)
  expectYear('CH', 'GL', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 04-09 naefelser_fahrt, 05-14 auffahrt, 05-25 pfingstmontag, 08-01 bundesfeier, 11-01 allerheiligen, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'GL', 2027, '01-01 neujahr, 03-26 karfreitag, 03-29 ostermontag, 04-01 naefelser_fahrt, 05-06 auffahrt, 05-17 pfingstmontag, 08-01 bundesfeier, 11-01 allerheiligen, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'GL', 2023, '01-01 neujahr, 04-07 karfreitag, 04-10 ostermontag, 04-13 naefelser_fahrt, 05-18 auffahrt, 05-29 pfingstmontag, 08-01 bundesfeier, 11-01 allerheiligen, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'TI', 2026, '01-01 neujahr, 01-06 heilige_drei_koenige, 03-19 josefstag, 04-06 ostermontag, 05-01 tag_der_arbeit, 05-14 auffahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 06-29 peter_und_paul, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'JU', 2026, '01-01 neujahr, 01-02 berchtoldstag, 04-03 karfreitag, 04-06 ostermontag, 05-01 tag_der_arbeit, 05-14 auffahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 06-23 unabhaengigkeit_ju, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-25 weihnachten');
  // AR/AI: Stephanstag entfällt am Samstag (2026), am Sonntag (2027) bleibt er
  expectYear('CH', 'AR', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-14 auffahrt, 05-25 pfingstmontag, 08-01 bundesfeier, 12-25 weihnachten');
  expectYear('CH', 'AR', 2027, '01-01 neujahr, 03-26 karfreitag, 03-29 ostermontag, 05-06 auffahrt, 05-17 pfingstmontag, 08-01 bundesfeier, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'AI', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-14 auffahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 09-22 mauritiustag, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');
  expectYear('CH', 'AI-OB', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-14 auffahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');
  // NE: 2.1. und 26.12. nur montags (2023: 2.1. = Mo; 2022: 26.12. = Mo); Le Landeron zusätzlich Fronleichnam
  expectYear('CH', 'NE', 2026, '01-01 neujahr, 03-01 republik_ne, 04-03 karfreitag, 05-01 tag_der_arbeit, 05-14 auffahrt, 08-01 bundesfeier, 12-25 weihnachten');
  expectYear('CH', 'NE', 2023, '01-01 neujahr, 01-02 berchtoldstag, 03-01 republik_ne, 04-07 karfreitag, 05-01 tag_der_arbeit, 05-18 auffahrt, 08-01 bundesfeier, 12-25 weihnachten');
  expectYear('CH', 'NE', 2022, '01-01 neujahr, 03-01 republik_ne, 04-15 karfreitag, 05-01 tag_der_arbeit, 05-26 auffahrt, 08-01 bundesfeier, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'NE-LL', 2027, '01-01 neujahr, 03-01 republik_ne, 03-26 karfreitag, 05-01 tag_der_arbeit, 05-06 auffahrt, 05-27 fronleichnam, 08-01 bundesfeier, 12-25 weihnachten');
  expectYear('CH', 'FR', 2027, '01-01 neujahr, 03-26 karfreitag, 05-06 auffahrt, 05-27 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');
  expectYear('CH', 'FR-REF', 2027, '01-01 neujahr, 01-02 berchtoldstag, 03-26 karfreitag, 03-29 ostermontag, 05-06 auffahrt, 05-17 pfingstmontag, 08-01 bundesfeier, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'SO-BU', 2027, '01-01 neujahr, 03-26 karfreitag, 05-06 auffahrt, 08-01 bundesfeier, 12-25 weihnachten');
  expectYear('CH', 'UR', 2027, '01-01 neujahr, 01-06 heilige_drei_koenige, 03-19 josefstag, 03-26 karfreitag, 03-29 ostermontag, 05-06 auffahrt, 05-17 pfingstmontag, 05-27 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten, 12-26 stephanstag');
  expectYear('CH', 'OW', 2027, '01-01 neujahr, 03-26 karfreitag, 05-06 auffahrt, 05-27 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 09-25 bruder_klaus, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');
  expectYear('CH', 'VS', 2026, '01-01 neujahr, 03-19 josefstag, 05-14 auffahrt, 06-04 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');
  expectYear('CH', 'AG-LM', 2026, '01-01 neujahr, 04-03 karfreitag, 05-14 auffahrt, 06-04 fronleichnam, 08-01 bundesfeier, 08-15 mariae_himmelfahrt, 11-01 allerheiligen, 12-08 mariae_empfaengnis, 12-25 weihnachten');

  // ── 3) Deutschland unverändert (auch ohne Feld „country“)
  expectYear('DE', 'NW', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-01 tag_der_arbeit, 05-14 himmelfahrt, 05-25 pfingstmontag, 06-04 fronleichnam, 10-03 einheit, 11-01 allerheiligen, 12-25 weihnacht1, 12-26 weihnacht2');
  expectYear('DE', 'SN', 2026, '01-01 neujahr, 04-03 karfreitag, 04-06 ostermontag, 05-01 tag_der_arbeit, 05-14 himmelfahrt, 05-25 pfingstmontag, 10-03 einheit, 10-31 reformationstag, 11-18 buss_und_bettag, 12-25 weihnacht1, 12-26 weihnacht2');
  expectYear(undefined, 'BY', 2027, '01-01 neujahr, 01-06 heilige_drei_koenige, 03-26 karfreitag, 03-29 ostermontag, 05-01 tag_der_arbeit, 05-06 himmelfahrt, 05-17 pfingstmontag, 05-27 fronleichnam, 10-03 einheit, 11-01 allerheiligen, 12-25 weihnacht1, 12-26 weihnacht2');

  // ── 4) Migration: alte Daten ohne Land = Deutschland, ungültige Kombinationen bereinigt
  let w = open({ [LS]: JSON.stringify(base({ bundesland: 'NI' })) }, makeBridge({}));
  const $ = id => w.document.getElementById(id);
  ok($('country').value === 'DE' && $('bundesland').value === 'NI' && $('bundesland').options.length === 16, 'Altdaten ohne Land: Deutschland/Niedersachsen, 16 Bundesländer');
  ok($('country').options.length === 3 && [...$('country').options].map(o => o.textContent).join() === 'Deutschland,Österreich,Schweiz', 'Länderauswahl: Deutschland, Österreich, Schweiz');
  ok($('holHint').hidden && $('blLabel').textContent === 'Bundesland (Feiertage)', 'Deutschland: Feldname Bundesland, kein Hinweis');
  w.close();
  w = open({ [LS]: JSON.stringify(base({ country: 'AT', bundesland: 'NI' })) }, makeBridge({}));
  ok(w.document.getElementById('country').value === 'AT' && w.document.getElementById('bundesland').value === 'W', 'AT mit fremdem Kürzel → Standard-Region Wien');
  w.close();
  w = open({ [LS]: JSON.stringify(base({ country: 'XX', bundesland: 'GE' })) }, makeBridge({}));
  ok(w.document.getElementById('country').value === 'DE' && w.document.getElementById('bundesland').value === 'NW', 'unbekanntes Land → Deutschland/NW');
  w.close();
  w = open({ [LS]: JSON.stringify(base({ country: 'CH', bundesland: 'TI' })) }, makeBridge({}));
  ok(w.document.getElementById('bundesland').options.length === 35 && w.document.getElementById('blLabel').textContent === 'Kanton (Feiertage)', 'Schweiz: 26 Kantone + 9 Teilgebiete, Feldname Kanton');
  ok(!w.document.getElementById('holHint').hidden && /Kanton/.test(w.document.getElementById('holHint').textContent), 'Schweiz: Hinweis zur Zählweise sichtbar');
  ok([...w.document.getElementById('bundesland').options].some(o => o.value === 'FR' && o.textContent === de['region.fr_cath']), 'Teilgebiet Freiburg katholisch übersetzt');
  w.close();

  // ── 5) Landwechsel plant Wecker neu (Schicht-Wecker an Feiertagen auslassen)
  const native = {}; const br = makeBridge(native);
  w = open({ [LS]: JSON.stringify(base({ country: 'DE', bundesland: 'NW', pattern: [2, 2, 2, 2, 2, 0, 0], skipHolidaysShift: true,
    alarmEnabled: { 1: false, 2: true, 3: false, 4: false }, autoSchedule: { 1: false, 2: true, 3: false, 4: false, free: false } })) }, br);
  await sleep(50);
  const has = k => !!native['shift-' + k + '-t2'];
  ok(!has('2027-05-27') && !has('2027-03-26') && has('2027-09-09') && has('2027-10-26'), 'DE/NW: Fronleichnam + Karfreitag ohne Wecker, 9.9./26.10. mit');
  select(w, 'country', 'CH'); await sleep(1000);
  ok(state(w).country === 'CH' && state(w).bundesland === 'ZH' && w.document.getElementById('bundesland').value === 'ZH', 'Land Schweiz → Standard-Kanton Zürich');
  select(w, 'bundesland', 'GE'); await sleep(1000);
  ok(has('2027-05-27') && !has('2027-03-26') && !has('2027-09-09'), 'CH/GE: Fronleichnam wieder mit Wecker, Jeûne genevois (9.9.2027) ohne');
  select(w, 'country', 'AT'); await sleep(1000);
  ok(state(w).bundesland === 'W' && has('2027-03-26') && !has('2027-10-26') && !has('2027-05-27') && has('2027-09-09'), 'AT: Karfreitag mit Wecker, Nationalfeiertag + Fronleichnam ohne');
  ok(w.document.getElementById('bundesland').options.length === 9 && !w.document.getElementById('holHint').hidden, 'AT: 9 Bundesländer, Hinweis sichtbar');
  // Kalender zeigt die Feiertage des gewählten Landes
  const atHol = calendarHolidays(w, 2027);
  ok(atHol['10-26'] === 'nationalfeiertag' && !atHol['03-26'] && !atHol['10-03'], 'Kalender: österreichische Feiertage');
  select(w, 'country', 'DE'); await sleep(1000);
  ok(state(w).bundesland === 'NW' && !has('2027-05-27') && !has('2027-03-26') && has('2027-10-26'), 'zurück zu DE/NW: Wecker wie am Anfang');
  w.close();

  // ── 6) Profil enthält das Land; altes Profil ohne Land = Deutschland
  const n2 = {}; const br2 = makeBridge(n2);
  w = open({ [LS]: JSON.stringify(base({ country: 'CH', bundesland: 'GE' })) }, br2); await sleep(50);
  w.document.getElementById('exportProfileBtn').click();
  const prof = JSON.parse(br2.exported.json);
  ok(prof.data.country === 'CH' && prof.data.bundesland === 'GE' && prof.format === 1, 'Profil: country CH, bundesland GE (Format 1)');
  w.close();
  const n3 = {}; const br3 = makeBridge(n3);
  w = open({}, br3); await sleep(50);
  w.onProfileImported(JSON.stringify(prof)); w.document.getElementById('cdlgOk').click();
  ok(state(w).country === 'CH' && state(w).bundesland === 'GE' && w.document.getElementById('country').value === 'CH' && w.document.getElementById('bundesland').value === 'GE', 'Import: Schweiz/Genf übernommen und angezeigt');
  const old = JSON.parse(JSON.stringify(prof)); delete old.data.country; old.data.bundesland = 'HE';
  w.onProfileImported(JSON.stringify(old)); w.document.getElementById('cdlgOk').click();
  ok(state(w).country === 'DE' && state(w).bundesland === 'HE' && w.document.getElementById('country').value === 'DE', 'altes Profil ohne Land → Deutschland/Hessen');
  const bad = JSON.parse(JSON.stringify(prof)); bad.data.country = 'AT'; bad.data.bundesland = '<img>';
  w.onProfileImported(JSON.stringify(bad)); w.document.getElementById('cdlgOk').click();
  ok(state(w).country === 'AT' && state(w).bundesland === 'W', 'manipuliertes Profil: ungültige Region → Standard-Region des Landes');
  w.close();

  // ── 7) Einrichtung: Land und Kanton wählen
  const n4 = {}; const br4 = makeBridge(n4);
  w = open({ [LS]: JSON.stringify(base({ bundesland: 'NW', pattern: [2, 2, 2, 2, 2, 1, 1] })) }, br4); await sleep(50);
  const $w = id => w.document.getElementById(id);
  $w('startWizBtn').click();
  for (let i = 0; i < 3; i++) $w('wizNext').click();
  ok($w('wizCountry').value === 'DE' && $w('wizBl').options.length === 16 && $w('wizBlLabel').textContent === 'Bundesland', 'Einrichtung Schritt 4: Land + Bundesland vorbelegt');
  select(w, 'wizCountry', 'CH');
  ok($w('wizBl').options.length === 35 && $w('wizBl').value === 'ZH' && $w('wizBlLabel').textContent === 'Kanton' && !$w('wizHolHint').hidden, 'Einrichtung: Schweiz → Kantone, Hinweis');
  ok(state(w).country !== 'CH', 'Entwurf: noch nichts übernommen');
  select(w, 'wizBl', 'VD');
  $w('wizNext').click();
  ok(state(w).country === 'CH' && state(w).bundesland === 'VD', 'Einrichten übernimmt Schweiz/Waadt');
  ok(/Schweiz · Vaud/.test($w('wizBody').textContent), 'Abschluss zeigt „Schweiz · Vaud“');
  $w('wizNext').click();
  ok($w('country').value === 'CH' && $w('bundesland').value === 'VD', 'Bereich Schichtplan zeigt Schweiz/Waadt');
  w.close();

  // ── 8) Übersetzungen: neue Schlüssel in allen Sprachen, Englisch ohne „German …“
  const codes = fs.readdirSync(path.join(ASSETS, 'lang')).filter(f => /^[a-z]{2,3}\.json$/.test(f)).map(f => f.slice(0, -5));
  const holBody = JS.slice(JS.indexOf('function holidays('), JS.indexOf('return h;', JS.indexOf('function holidays(')));
  const ids = [...new Set([...holBody.matchAll(/'([a-z][a-z_0-9 ]+)'/g)].flatMap(m => m[1].split(' ')))];
  const need = ids.map(i => 'holiday.' + i).concat(['country.de', 'country.at', 'country.ch', 'holidays.country_label', 'holidays.canton_label',
    'holidays.hint_at', 'holidays.hint_ch', 'region.fr_cath', 'region.fr_ref', 'wiz.country_label', 'wiz.canton_label']);
  for (const c of codes) {
    const o = LANG(c), miss = need.filter(k => typeof o[k] !== 'string' || !o[k].trim());
    ok(!miss.length, `${c}.json: alle ${need.length} Feiertags-/Länder-Schlüssel vorhanden` + (miss.length ? ': ' + miss.join(', ') : ''));
  }
  const en = LANG('en');
  ok(!/German/.test(en['holidays.title'] + en['holidays.state_label'] + en['wiz.s4_title'] + en['wiz.state_label']), 'en: Texte nicht mehr auf „German …“ beschränkt');
  const wE = open({ [LS]: JSON.stringify(base({ country: 'CH', bundesland: 'GE' })) }, makeBridge({}, { system: 'en' }));
  ok([...wE.document.getElementById('country').options].map(o => o.textContent).join() === 'Germany,Austria,Switzerland' && wE.document.getElementById('blLabel').textContent === 'Canton (public holidays)', 'Englisch: Ländernamen und „Canton“');
  wE.close();

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})();
