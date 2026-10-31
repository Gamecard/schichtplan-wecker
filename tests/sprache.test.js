// Tests der Mehrsprachigkeit (lang/*.json, t(), Sprachwechsel, eigene Übersetzung) und des
// versteckten Design-Umschalters (Versionsnummer antippen).
// Ausführen: cd tests && npm install && npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { withLang } = require('./lang-bridge');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const JS = fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8');
const html = HTML_SRC
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<link rel="stylesheet" href="anime.css">', '')
  .replace('<script src="app.js"></script>', () => '<script>' + JS + '</script>');
const LS = 'schichtplan-native-v1';
const LANG = code => JSON.parse(fs.readFileSync(path.join(ASSETS, 'lang', code + '.json'), 'utf8'));
// alle eingebauten Sprachen (wie Android.listLanguages: <code>.json, sortiert nach Code)
const ALL_CODES = fs.readdirSync(path.join(ASSETS, 'lang')).filter(f => /^[a-z]{2,3}(-[A-Za-z]{2,4})?\.json$/.test(f)).map(f => f.slice(0, -5)).sort();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBridge(native, lang) {
  return withLang({
    store: native, migrated: true, exported: null,
    setAlarmForDateSilent(y, mo, d, h, mi, key, msg) {
      if (new Date(y, mo - 1, d, h, mi).getTime() <= Date.now()) return false;
      this.store[key] = { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, y, mo, d, h, mi, msg };
      this.sets = (this.sets || 0) + 1;
      return true;
    },
    setAlarmForDate(...a) { return this.setAlarmForDateSilent(...a); },
    cancelAlarm(key) { delete this.store[key]; return true; },
    cancelAllAlarms() { for (const k in this.store) delete this.store[k]; return 0; },
    getScheduledKeys() { return JSON.stringify(Object.keys(this.store)); },
    getScheduledAlarms() { return JSON.stringify(Object.entries(this.store).map(([key, v]) => ({ key, y: v.y, mo: v.mo, d: v.d, h: v.h, mi: v.mi }))); },
    getAppVersion() { return '1.9'; },
    updateWidget(j) { this.widget = JSON.parse(j); },
    permIssue: 'exact', getAlarmPermissionIssue() { return this.permIssue; }, openAlarmPermissionSettings() {},
    syncAlarmWindow() { return 0; },
    opts: { snoozeMinutes: 5, risingVolume: false, vibrateOnly: false },
    getAlarmOptions() { return JSON.stringify(this.opts); }, setAlarmOptions(j) { Object.assign(this.opts, JSON.parse(j)); return true; },
    isStoreMigrated() { return true; }, setStoreMigrated() {},
    exportProfile(json, name) { this.exported = { json, name }; },
    exportFile(content, name, mime) { this.file = { content, name, mime }; },
    importProfile() {},
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
      if (bridge) w.Android = bridge;
      w.scrollTo = () => {};
    }
  }).window;
}
const state = w => JSON.parse(w.localStorage.getItem(LS));
const dump = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
const base = {
  startDate: '2026-10-26', weeksCount: 2, bundesland: 'SN',
  pattern: [2, 2, 2, 2, 2, 1, 1, 3, 3, 3, 4, 0, 0, 0],
  exceptions: [{ id: 'x1', start: '2026-12-01', end: '2026-12-03', type: 'Urlaub' }, { id: 'x2', start: '2026-12-08', end: '2026-12-08', type: 'Krank' }],
  alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
  alarmEnabled: { 1: false, 2: true, 3: true, 4: false }, autoSchedule: { 1: false, 2: true, 3: true, 4: false, free: false },
  activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }, preAlarmMin: 10,
  overrides: { '2026-11-19': 4 }
};

(async () => {
  // ── 1) Sprachdateien: Schlüssel vollständig und konsistent
  const de = LANG('de'), en = LANG('en');
  const PLURAL = /_(zero|one|two|few|many|other)$/;
  const baseKey = k => k.replace(PLURAL, '');
  const keysOf = o => Object.keys(o).filter(k => k !== '_meta');
  ok(de._meta && de._meta.code === 'de' && de._meta.name === 'Deutsch' && en._meta.code === 'en' && en._meta.name === 'English', '_meta: Code und Name in eigener Sprache');
  const deBase = new Set(keysOf(de).map(baseKey)), enBase = new Set(keysOf(en).map(baseKey));
  const onlyDe = [...deBase].filter(k => !enBase.has(k)), onlyEn = [...enBase].filter(k => !deBase.has(k));
  ok(!onlyDe.length && !onlyEn.length, 'de.json und en.json haben dieselben Schlüssel' + (onlyDe.length || onlyEn.length ? ': ' + onlyDe.concat(onlyEn).join(', ') : ` (${deBase.size})`));
  const empty = ['de', 'en'].flatMap(c => { const o = c === 'de' ? de : en; return keysOf(o).filter(k => typeof o[k] !== 'string' || !o[k].trim()).map(k => c + ':' + k); });
  ok(!empty.length, 'keine leeren Werte ' + empty.join(', '));
  const ph = (o, b) => [...new Set(keysOf(o).filter(k => baseKey(k) === b).flatMap(k => (o[k].match(/\{\w+\}/g) || [])))].sort().join();
  // Datumsvorlagen dürfen je Sprache andere Datumsfelder wählen ({d} {dd} {m} {mm} {yyyy} {mon} {month} {wd} {weekday}):
  // format.* (Web) sowie native.format.date und native.widget.date (Kotlin)
  const isDateTpl = b => /^(native\.)?format\./.test(b) || b === 'native.widget.date';
  const phDiff = [...deBase].filter(b => enBase.has(b) && !isDateTpl(b) && ph(de, b) !== ph(en, b));
  const FMT_FIELDS = /^\{(d|dd|m|mm|yyyy|mon|month|month_gen|wd|weekday|time|year)\}$/;
  ok(keysOf(de).concat(keysOf(en)).filter(k => /^format\./.test(k)).every(k => ((de[k] || '') + (en[k] || '')).match(/\{\w+\}/g).every(p => FMT_FIELDS.test(p))), 'format.*: nur bekannte Datumsfelder');
  ok(!phDiff.length, 'Platzhalter je Schlüssel identisch ' + phDiff.map(b => b + ' de[' + ph(de, b) + '] en[' + ph(en, b) + ']').join('; '));
  const pluralBases = [...deBase].filter(b => keysOf(de).some(k => k !== b && baseKey(k) === b));
  ok(pluralBases.every(b => (b in de || (b + '_other') in de) && (b in en || (b + '_other') in en)), 'Mehrzahl-Schlüssel haben immer eine _other-Form');
  ok(!keysOf(de).concat(keysOf(en)).some(k => /^native\./.test(k)) || keysOf(de).filter(k => /^native\./.test(k)).length === keysOf(en).filter(k => /^native\./.test(k)).length, 'native.* (Kotlin) höchstens gleichmäßig in beiden Dateien');
  // ── 1b) alle weiteren Sprachdateien (tr, ru, pl, …) gegen en.json prüfen
  for (const code of ALL_CODES.filter(c => c !== 'de' && c !== 'en')) {
    const o = LANG(code);
    const base = new Set(keysOf(o).map(baseKey));
    const missing = [...enBase].filter(k => !base.has(k)), extra = [...base].filter(k => !enBase.has(k));
    ok(o._meta && o._meta.code === code && o._meta.name && o._meta.englishName, code + '.json: _meta vollständig (' + (o._meta && o._meta.name) + ')');
    ok(!missing.length && !extra.length, code + '.json: dieselben Schlüssel wie en.json' + (missing.length || extra.length ? ' – fehlt: ' + missing.join(', ') + ' zu viel: ' + extra.join(', ') : ''));
    const emptyX = keysOf(o).filter(k => typeof o[k] !== 'string' || !o[k].trim());
    ok(!emptyX.length, code + '.json: keine leeren Werte ' + emptyX.join(', '));
    const phX = [...base].filter(b => enBase.has(b) && !isDateTpl(b) && ph(o, b) !== ph(en, b));
    ok(!phX.length, code + '.json: Platzhalter wie en.json ' + phX.map(b => b + ' [' + ph(o, b) + '] en[' + ph(en, b) + ']').join('; '));
    const fmtX = keysOf(o).filter(k => isDateTpl(baseKey(k)) && (o[k].match(/\{\w+\}/g) || []).some(p => !FMT_FIELDS.test(p) && !/^\{(MM|dd|yyyy|month|weekday|d)\}$/.test(p)));
    ok(!fmtX.length, code + '.json: Datumsvorlagen nur mit bekannten Feldern ' + fmtX.join(', '));
    const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    const plBases = [...base].filter(b => keysOf(o).some(k => k !== b && baseKey(k) === b));
    const plBad = plBases.filter(b => !(b + '_other' in o) || keysOf(o).some(k => baseKey(k) === b && k !== b && !cats.includes(k.slice(b.length + 1))));
    ok(!plBad.length, code + '.json: Mehrzahlformen passen zur Sprache (' + cats.join('/') + ') ' + plBad.join(', '));
    const htmlX = keysOf(o).filter(k => /<(?!\/?b>)/.test(o[k]));
    ok(!htmlX.length, code + '.json: höchstens <b> als HTML ' + htmlX.join(', '));
  }
  // für Kotlin festgelegte Schlüssel
  const required = ['shift.1', 'shift.2', 'shift.3', 'shift.4'].concat([0, 1, 2, 3, 4, 5, 6].map(i => 'weekday.short.' + i), [...Array(12).keys()].map(i => 'month.long.' + i));
  ok(required.every(k => de[k] && en[k]), 'Pflicht-Schlüssel für Kotlin vorhanden (shift.1–4, weekday.short.0–6, month.long.0–11)');
  ok(de['shift.1'] === 'Frei' && de['shift.2'] === 'Früh' && de['weekday.short.0'] === 'Mo' && de['month.long.0'] === 'Januar', 'deutsche Werte der Pflicht-Schlüssel');
  // Schlüssel, die app.js/index.html benutzen
  const used = new Set();
  for (const m of JS.matchAll(/'([a-z]+(?:\.[a-z0-9_]+)+)'/g)) used.add(m[1]);
  for (const m of HTML_SRC.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of HTML_SRC.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach(p => used.add(p.split(':')[1].trim()));
  // zusammengesetzte Schlüssel ('shift.'+t, 'holiday.'+id, …) – alle Werte der Familie prüfen
  const holBody = JS.slice(JS.indexOf('function holidays('), JS.indexOf('return h;', JS.indexOf('function holidays(')));
  // Kennungen stehen einzeln ('neujahr') oder als Liste je Kanton ('karfreitag ostermontag …')
  const holIds = [...new Set([...holBody.matchAll(/'([a-z][a-z_0-9 ]+)'/g)].flatMap(m => m[1].split(' ')))];
  ['weekday.long.', 'month.short.'].forEach(p => { for (let i = 0; i < (p.startsWith('month') ? 12 : 7); i++) used.add(p + i); });
  holIds.forEach(id => used.add('holiday.' + id));
  ['urlaub', 'krank', 'schulung'].forEach(x => used.add('exception.' + x));
  [2, 3, 4].forEach(x => used.add('ics.shift.' + x));
  ['fs', 'fsn', 'leer'].forEach(x => { used.add('wiz.tpl.' + x + '.name'); used.add('wiz.tpl.' + x + '.desc'); });
  required.forEach(k => used.add(k));
  const NS = new Set(keysOf(de).map(k => k.split('.')[0]));
  [...used].forEach(k => { if (!NS.has(k.split('.')[0])) used.delete(k); });   // z. B. 'input.tnative' (CSS-Selektor)
  const has = (o, k) => k in o || Object.keys(o).some(x => baseKey(x) === k);
  const missing = [...used].filter(k => !has(de, k) || !has(en, k));
  ok(holIds.length === 35 && !missing.length, `alle ${used.size} benutzten Schlüssel in de.json und en.json vorhanden` + (missing.length ? ': ' + missing.join(', ') : ''));

  // ── 2) Englisch: nach dem Rendern aller Bereiche kein deutscher Text mehr
  const nE = {}; const brE = makeBridge(nE, { system: 'en' });
  const wE = open({ [LS]: JSON.stringify(base) }, brE); await sleep(50);
  const dE = wE.document, $E = id => dE.getElementById(id);
  ok(dE.documentElement.getAttribute('lang') === 'en', '<html lang="en"> bei englischer Systemsprache');
  ok(dE.title === 'Schichtwecker' && /Schichtwecker/.test(dE.querySelector('.hdr-title').textContent), 'Seitentitel und App-Name bleiben „Schichtwecker“');
  // Daten (keine Oberflächentexte): Bundesländer, Sprachnamen, App-Name
  const ALLOWED = [...dE.querySelectorAll('#bundesland option')].map(o => o.textContent).concat(['Deutsch', 'Schichtwecker']);
  const GERMAN = /[äöüßÄÖÜ]|\b(Wecker\w*|Schicht\w*|Früh|Spät|Nacht|Frei|Urlaub|Krank|Schulung|Woche\w*|Tage?|Uhr|und|oder|nicht|kein\w*|für|mit|ein|eine[nmrs]?|der|die|das|dem|den|ist|sind|wird|werden|Einstellung\w*|Abbrechen|Übernehmen|Zurück|Weiter|Heute|heute|morgen|Feiertag\w*|Ausnahme\w*|Rhythmus|Muster|Bundesland|Klingelton|Schlummern|Vorwecker|Einrichtung|Datum|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Januar|Februar|März|Mai|Juni|Juli|Oktober|Dezember|Di|Mi|Do|KW|antippen|gestellt|löschen|wählen|Profil|Sichern|Vorlage|Übersetzung|Schließen|Erlauben|Prüfen|Tipp|Fertig|Schritt|Einrichten)\b/;
  const seen = new Set(), hits = new Map();
  function scan(label) {
    const body = dE.body.cloneNode(true);
    body.querySelectorAll('script,style,#bundesland,#wizBl,#langSel').forEach(e => e.remove());
    const texts = [];
    const walk = el => {
      if (el.nodeType === 3) { const s = el.textContent.replace(/\s+/g, ' ').trim(); if (s) texts.push(s); return; }
      if (el.nodeType !== 1) return;
      ['aria-label', 'title', 'placeholder'].forEach(a => { if (el.hasAttribute(a)) texts.push(el.getAttribute(a)); });
      el.childNodes.forEach(walk);
    };
    walk(body);
    texts.forEach(s => {
      let x = s; ALLOWED.forEach(a => { x = x.split(a).join(' '); });
      seen.add(x);
      const m = GERMAN.exec(x); if (m && !hits.has(x)) hits.set(x, label + ' [' + m[0] + ']');
    });
  }
  const tab = n => dE.querySelector('#bottomNav [data-tab="' + n + '"]').click();
  const openDayE = ds => { const [y, m, d] = ds.split('-').map(Number);
    for (let i = 0; i < 24 && $E('mTitle').textContent !== en['month.long.' + (m - 1)] + ' ' + y; i++) $E('nextM').click();
    const c = [...dE.querySelectorAll('.cday.click')].find(c => c.querySelector('.dnum').textContent === String(d)); c.click(); };
  scan('Plan');
  ok(/^⏰ Next alarm: (today|tomorrow|[A-Z][a-z] \d{1,2} [A-Z][a-z]{2}) · \d\d:\d\d – [A-Z]/.test($E('nextAlarm').textContent), 'Plan: „Next alarm“-Zeile englisch: ' + $E('nextAlarm').textContent);
  ok($E('mTitle').textContent === 'October 2026' || /^[A-Z][a-z]+ \d{4}$/.test($E('mTitle').textContent), 'Monatstitel englisch: ' + $E('mTitle').textContent);
  openDayE('2026-11-16'); scan('Tages-Sheet mit Wecker');
  ok(/Monday, 16 November 2026/.test($E('sDate').textContent), 'Tages-Sheet: Datum englisch: ' + $E('sDate').textContent);
  wE.handleBack(); openDayE('2026-11-21'); scan('Tages-Sheet ohne Wecker');
  wE.handleBack(); openDayE('2026-12-02'); scan('Tages-Sheet Ausnahme');
  ok(/Vacation \(1 Dec 2026 – 3 Dec 2026\)/.test($E('sSwap').textContent), 'Ausnahme im Sheet übersetzt: ' + $E('sSwap').textContent.slice(0, 60));
  dE.querySelector('#exDelBtn') && wE.handleBack();
  openDayE('2026-12-25'); scan('Feiertag'); wE.handleBack();
  $E('allAlarmsBtn').click(); scan('Alle Wecker'); wE.handleBack();
  tab('wecker'); scan('Wecker');
  $E('tp2').click(); scan('Zeit-Fenster'); wE.handleBack();
  $E('ae4').click(); scan('Wecker: Hinweis-Toast'); $E('ae4').click(); scan('Wecker: Aus-Toast');
  $E('freeAlarmEnabled').click(); scan('Freie Tage an');
  tab('schicht'); scan('Schichtplan');
  dE.querySelector('#patLegend [data-pick="2"]').click(); scan('Legende gewählt');
  $E('startModeBtn').click(); scan('Datumsmodus');
  $E('addEx').click(); scan('Ausnahme ohne Datum');
  $E('exportIcsBtn').click();
  ok(/SUMMARY:Early shift/.test(brE.file.content) && /X-WR-CALNAME:Shift plan/.test(brE.file.content), 'ICS-Export in Englisch');
  $E('resetAll').click(); scan('Reset-Dialog'); $E('cdlgCancel').click();
  $E('startWizBtn').click();
  for (let i = 0; i < 4; i++) { scan('Einrichtung Schritt ' + (i + 1)); $E('wizNext').click(); }
  scan('Einrichtung Abschluss');
  ok(/^\d+ alarms? set · next: [A-Z][a-z] \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/.test($E('wizSummary').textContent), 'Einrichtung: Zusammenfassung englisch: ' + $E('wizSummary').textContent);
  $E('wizNext').click(); scan('nach Einrichtung');
  ok(brE.widget && brE.widget['2026-11-09'] === 'Früh' && brE.widget['2026-11-16'] === 'Spät' && brE.widget['2026-12-02'] === 'Urlaub', 'Widget bekommt interne (deutsche) Namen – ShiftWidget übersetzt selbst');
  ok(!hits.size, `Englisch: kein deutscher Text (${seen.size} Texte geprüft)` + (hits.size ? '\n      ' + [...hits].slice(0, 15).map(([t, l]) => l + ': ' + t).join('\n      ') : ''));
  wE.close();

  // ── 3) Sprachwechsel zur Laufzeit: Texte sofort neu, Wecker neu geschrieben, Anzahl/Zeiten gleich
  const nS = {}; const brS = makeBridge(nS);
  const wS = open({ [LS]: JSON.stringify(base) }, brS); await sleep(50);
  const dS = wS.document, $S = id => dS.getElementById(id);
  ok(dS.documentElement.lang === 'de' && $S('langSel').value === 'auto' && dS.querySelector('#bottomNav [data-tab="wecker"] span[data-i18n]').textContent === 'Wecker', 'Start auf Deutsch (Systemsprache de, Einstellung auto)');
  // erwartete Liste aus den Dateien in lang/ (sortiert nach Code, wie listLanguages) – neue Sprachen kommen automatisch dazu
  const langNames = ALL_CODES.map(c => LANG(c)._meta.name);
  ok([...$S('langSel').options].map(o => o.textContent).join('|') === ['Automatisch (Handysprache)'].concat(langNames).join('|'), 'Sprachauswahl: Automatisch + Sprachnamen in eigener Sprache (' + langNames.join(', ') + ')');
  const before = JSON.parse(JSON.stringify(nS));
  ok(Object.keys(before).length > 200 && before['shift-2026-11-09-t2'].msg === 'Früh (09.11.2026)' && before['pre-shift-2026-11-09-t2'].msg === 'Vorwecker: Früh um 05:30 (09.11.2026)', 'deutsche Wecker-Texte: ' + before['pre-shift-2026-11-09-t2'].msg);
  const activeBefore = JSON.stringify(state(wS).activeAlarms);
  brS.sets = 0;
  $S('langSel').value = 'en'; $S('langSel').dispatchEvent(new wS.Event('change'));
  ok(brS.langSetting === 'en' && dS.documentElement.lang === 'en', 'Auswahl „English“ wird nativ gespeichert, <html lang> = en');
  ok(dS.querySelector('#bottomNav [data-tab="wecker"] span[data-i18n]').textContent === 'Alarms' && dS.querySelector('[data-i18n="plan.next_alarms"]').textContent === 'Upcoming alarms'
     && /^⏰ Next alarm/.test($S('nextAlarm').textContent) && $S('aeState2').textContent.startsWith('On – '), 'Oberfläche sofort englisch (ohne Neustart)');
  ok([...dS.querySelectorAll('.cgrid .dow')].map(e => e.textContent).join() === 'Wk,Mo,Tu,We,Th,Fr,Sa,Su', 'Kalenderkopf englisch');
  ok($S('langSel').value === 'en' && $S('langSel').options[0].textContent === 'Automatic (phone language)', 'Sprachauswahl selbst übersetzt');
  const after = nS;
  ok(Object.keys(after).sort().join() === Object.keys(before).sort().join() && Object.keys(after).every(k => after[k].time === before[k].time && after[k].d === before[k].d), `Weckerzahl (${Object.keys(after).length}) und Weckzeiten unverändert`);
  ok(brS.sets === Object.keys(before).length, 'jeder Wecker genau einmal neu geschrieben (' + brS.sets + ')');
  ok(after['shift-2026-11-09-t2'].msg === 'Early (9 Nov 2026)' && after['pre-shift-2026-11-09-t2'].msg === 'Pre-alarm: Early at 05:30 (9 Nov 2026)' && after['shift-2026-11-16-t3'].msg === 'Late (16 Nov 2026)', 'Wecker-Texte englisch: ' + after['pre-shift-2026-11-09-t2'].msg);
  ok(JSON.stringify(state(wS).activeAlarms) === activeBefore, 'Wecker-Liste im Zustand unverändert (interne Daten bleiben)');
  ok(brS.widget['2026-11-09'] === 'Früh' && brS.widget['2026-11-21'] === 'kein Eintrag', 'Widget-Daten nach Sprachwechsel unverändert intern (Kotlin übersetzt)');
  // Zustand/Profil bleibt kompatibel: interne Ausnahme-Typen deutsch
  ok(state(wS).exceptions.every(e => ['Urlaub', 'Krank'].includes(e.type)), 'Ausnahme-Typen bleiben intern deutsch');
  dS.querySelector('#bottomNav [data-tab="schicht"]').click();
  $S('exS').value = '2027-02-01'; $S('exT').value = 'Krank'; $S('addEx').click();
  ok(state(wS).exceptions.some(e => e.start === '2027-02-01' && e.type === 'Krank') && $S('toast').textContent === 'Sick added!', 'Ausnahme auf Englisch eintragen speichert internen Typ „Krank“');
  // Exportvorlage
  $S('exportLangBtn').click();
  const tpl = brS.file && JSON.parse(brS.file.content);
  ok(brS.file.name === 'schichtwecker-sprache-en.json' && brS.file.mime === 'application/json' && tpl._meta.code === 'en' && Object.keys(tpl).length === Object.keys(en).length, 'Übersetzungsvorlage exportiert: ' + brS.file.name);
  // zurück auf automatisch
  $S('langSel').value = 'auto'; $S('langSel').dispatchEvent(new wS.Event('change'));
  ok(brS.langSetting === 'auto' && dS.documentElement.lang === 'de' && nS['shift-2026-11-09-t2'].msg === 'Früh (09.11.2026)', 'zurück auf „Automatisch“ → wieder Deutsch, Wecker-Texte deutsch');
  $S('exportLangBtn').click();
  ok(brS.file.name === 'schichtwecker-sprache-de.json' && JSON.parse(brS.file.content)['nav.wecker'] === 'Wecker', 'Vorlage der aktuellen Sprache (de)');
  // nach Neuladen bleibt die Wahl erhalten
  brS.langSetting = 'en';
  const saved = dump(wS); wS.close();
  const wS2 = open(saved, brS); await sleep(50);
  ok(wS2.document.documentElement.lang === 'en' && wS2.document.getElementById('langSel').value === 'en', 'gespeicherte Sprache gilt beim nächsten Start');
  wS2.close();

  // ── 4) Eigene Übersetzung (custom): wird benutzt, fehlende Schlüssel fallen auf en zurück
  const nC = {}; const brC = makeBridge(nC);
  const wC = open({ [LS]: JSON.stringify(base) }, brC); await sleep(50);
  const dC = wC.document, $C = id => dC.getElementById(id);
  $C('importLangBtn').click();
  ok(brC.langImportCalls === 1, '„Übersetzung laden“ öffnet die Dateiauswahl');
  brC.customLang = JSON.stringify({
    _meta: { code: 'ru', name: 'Тест', englishName: 'Test', version: 1 },
    'nav.plan': 'План', 'shift.2': 'Утро',
    'alarm.set_count_one': 'ONE {n}', 'alarm.set_count_few': 'FEW {n}', 'alarm.set_count_many': 'MANY {n}', 'alarm.set_count_other': 'OTHER {n}',
    'next.label': '<img src=x onerror="window.__xss=1"><b>{when}</b> {time} {name}',
    'perm.allow': '<script>window.__xss=2</script>OK'
  });
  wC.onLanguageImported(true, 'Тест');
  ok(brC.langSetting === 'custom' && $C('langSel').value === 'custom' && /Тест/.test($C('langSel').selectedOptions[0].textContent), 'nach Import: Sprache „custom“ gewählt und in der Auswahl');
  ok(/Тест/.test($C('toast').textContent), 'Toast nach Import: ' + $C('toast').textContent);
  ok(dC.querySelector('#bottomNav [data-tab="plan"] span[data-i18n]').textContent === 'План' && $C('aeState2') && dC.querySelector('[data-pick="2"] span').textContent === 'Утро', 'eigene Texte werden benutzt');
  ok(dC.querySelector('#bottomNav [data-tab="wecker"] span[data-i18n]').textContent === 'Alarms' && dC.querySelector('[data-i18n="plan.next_alarms"]').textContent === 'Upcoming alarms', 'fehlende Schlüssel fallen auf Englisch zurück');
  ok(dC.documentElement.lang === 'ru', '<html lang> aus _meta.code der eigenen Datei');
  ok(nC['shift-2026-11-09-t2'].msg === 'Утро (9 Nov 2026)', 'Wecker-Texte in eigener Übersetzung: ' + nC['shift-2026-11-09-t2'].msg);
  ok(!$C('nextAlarm').querySelector('img') && $C('nextAlarm').querySelector('b') && !wC.__xss && !$C('permWarn').querySelector('script'), 'eigene Übersetzung kann kein HTML/Script einschleusen (nur <b>)');
  $C('allAlarmsBtn').click();
  const cnt = $C('allAlarmList').querySelectorAll('.adel').length, cat = new Intl.PluralRules('ru').select(cnt);
  ok($C('allSummary').textContent === cat.toUpperCase() + ' ' + cnt, `Mehrzahl nach Intl.PluralRules(ru): ${cnt} → ${cat} („${$C('allSummary').textContent}“)`);
  wC.handleBack();
  // fehlgeschlagener Import ändert nichts
  wC.onLanguageImported(false, '');
  ok(brC.langSetting === 'custom' && /could not be loaded/.test($C('toast').textContent), 'fehlgeschlagener Import: Meldung, Sprache bleibt');
  // kaputte eigene Datei → zurück auf automatische Sprache
  brC.customLang = '{kaputt';
  wC.onLanguageImported(true, 'x');
  ok(dC.documentElement.lang === 'de' && /konnte nicht geladen/.test($C('toast').textContent), 'ungültige eigene Datei → automatische Sprache + Fehlermeldung');
  wC.close();

  // ── 5) Ohne Bridge (Browser): Sprachdatei per XHR, Systemsprache aus navigator.language
  const wB = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) {
      w.localStorage.setItem('schichtplan-wizard-done', '1'); w.scrollTo = () => {};
      Object.defineProperty(w.navigator, 'language', { value: 'de-AT', configurable: true });
      w.XMLHttpRequest = function () { let u = ''; return { open(m, url) { u = url; }, send() {
        const f = path.join(ASSETS, u); this.status = fs.existsSync(f) ? 200 : 404; this.responseText = this.status === 200 ? fs.readFileSync(f, 'utf8') : ''; } }; };
    } }).window; await sleep(50);
  ok(wB.document.documentElement.lang === 'de' && wB.document.querySelector('[data-i18n="plan.next_alarms"]').textContent === 'Nächste Wecker', 'ohne Bridge: lang/de.json per XHR, navigator.language de-AT → Deutsch');
  wB.close();

  // ── 6) Design-Umschalter: Versionsnummer antippen
  const nD = {}; const brD = makeBridge(nD); let natD = '';
  brD.saveState = j => { natD = j; return true; }; brD.loadState = () => natD;
  const wD = open({ [LS]: JSON.stringify(base) }, brD); await sleep(50);
  const html1 = wD.document.documentElement;
  ok(!html1.hasAttribute('data-design') && (state(wD) || {}).design !== 'anime', 'Standard: klassisches Design (kein data-design)');
  wD.document.getElementById('appVersion').click();
  ok(html1.getAttribute('data-design') === 'anime' && state(wD).design === 'anime' && wD.document.getElementById('toast').textContent === 'Anime-Design an', 'Versionsnummer antippen → Anime-Design + Toast');
  wD.document.getElementById('exportProfileBtn').click();
  ok(JSON.parse(brD.exported.json).data.design === 'anime', 'Design ist im Profil enthalten');
  const savedD = dump(wD); wD.close();
  const wD2 = open({}, brD); await sleep(50);   // localStorage leer → nativer Stand
  ok(wD2.document.documentElement.getAttribute('data-design') === 'anime', 'Anime-Design bleibt nach Neuladen erhalten');
  wD2.document.getElementById('appVersion').click();
  ok(!wD2.document.documentElement.hasAttribute('data-design') && state(wD2).design === 'classic' && wD2.document.getElementById('toast').textContent === 'Klassisches Design', 'erneut antippen → klassisch');
  wD2.close();
  const wD3 = open(savedD, brD); await sleep(50);
  ok(!wD3.document.documentElement.hasAttribute('data-design'), 'klassisch bleibt nach Neuladen erhalten');
  // Englisch: Toast in der Sprache
  brD.langSetting = 'en';
  wD3.close();
  const wD4 = open({}, brD); await sleep(50);
  wD4.document.getElementById('appVersion').click();
  ok(wD4.document.getElementById('toast').textContent === 'Anime design on', 'Toast auf Englisch: ' + wD4.document.getElementById('toast').textContent);
  wD4.close();
  ok(/<link rel="stylesheet" href="app\.css">\s*<link rel="stylesheet" href="anime\.css">/.test(HTML_SRC), 'anime.css wird nach app.css eingebunden');

  // ── 7) Anime-Design: Maskottchen, Sprechblasen, Schicht-Symbole, Schrift
  const ANIME_CSS = fs.readFileSync(path.join(ASSETS, 'anime.css'), 'utf8');
  const htmlA = html.replace('</head>', () => '<style>' + ANIME_CSS + '</style></head>');   // wie in der App: anime.css nach app.css
  const openA = (storage, bridge) => new JSDOM(htmlA, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/',
    beforeParse(w) { for (const k in storage) w.localStorage.setItem(k, storage[k]); w.localStorage.setItem('schichtplan-wizard-done', '1'); w.Android = bridge; w.scrollTo = () => {}; }
  }).window;
  const nA = {}; const brA = makeBridge(nA); const designCalls = [];
  brA.setDesign = d => { designCalls.push(d); return true; };
  const wA = openA({ [LS]: JSON.stringify(base) }, brA); await sleep(50);
  const dA = wA.document, disp = el => wA.getComputedStyle(el).display;
  const anOnly = [...dA.querySelectorAll('.an-only')];
  ok(anOnly.length >= 3 && dA.getElementById('hdrMascot') && dA.getElementById('wizMascot'), 'Maskottchen-Elemente vorhanden (Kopf, Wecker-Bereich, Einrichtung): ' + anOnly.length);
  ok(anOnly.every(el => disp(el) === 'none'), 'klassisch: alle .an-only-Elemente ausgeblendet');
  ok(!dA.querySelector('#nextAlarm .an-masc') && /^⏰ /.test(dA.getElementById('nextAlarm').textContent), 'klassisch: „Nächster Wecker“ unverändert ohne Maskottchen');
  ok(dA.querySelector('#alarmBox .ld[data-shift="2"]').getAttribute('style') === 'background:var(--frueh)' && dA.querySelectorAll('#patLegend .ld[data-shift]').length === 4, 'Farbpunkte tragen data-shift, Inline-Farbe unverändert');
  ok(designCalls[designCalls.length - 1] === 'classic', 'Design wird beim Start nativ gemeldet (setDesign)');
  dA.getElementById('appVersion').click();
  ok(designCalls[designCalls.length - 1] === 'anime', 'Umschalten meldet „anime“ an die Brücke');
  ok(anOnly.every(el => disp(el) !== 'none'), 'Anime: .an-only-Elemente sichtbar');
  const nx = dA.getElementById('nextAlarm'), face = nx.querySelector('.an-masc');
  ok(face && ['happy', 'sleepy', 'excited', 'wink', 'oops'].includes(face.dataset.face) && face.getAttribute('aria-hidden') === 'true', 'Anime: Maskottchen im Hinweis „nächster Wecker“ (Gesicht ' + (face && face.dataset.face) + ')');
  const greets = ['anime.greet.morning', 'anime.greet.day', 'anime.greet.evening', 'anime.greet.night'].map(k => de[k]);
  ok(greets.includes(nx.querySelector('.an-greet').textContent) && nx.querySelector('.an-bubble').textContent.includes('Dein nächster Wecker:') && nx.querySelector('.an-bubble b'), 'Anime: Sprechblase mit Begrüßung und nächstem Wecker (übersetzt, <b> erhalten)');
  ok(dA.querySelector('#tabWecker .an-bubble').textContent === de['anime.wecker_tip'], 'Anime: Tipp des Maskottchens im Bereich Wecker');
  dA.getElementById('startWizBtn').click();
  ok(dA.getElementById('wizMascotTxt').textContent === de['anime.wiz.s1'] && dA.getElementById('wizMascot').dataset.face === 'wink', 'Einrichtung: Begrüßung des Maskottchens');
  dA.getElementById('wizSkip').click();
  dA.getElementById('appVersion').click();
  ok(!dA.querySelector('#nextAlarm .an-masc') && /^⏰ /.test(dA.getElementById('nextAlarm').textContent) && anOnly.every(el => disp(el) === 'none'), 'zurück auf klassisch: Maskottchen wieder weg');
  wA.close();
  // leere Wecker-Liste: Maskottchen schläft
  const empty0 = Object.assign({}, base, { alarmEnabled: { 1: false, 2: false, 3: false, 4: false }, autoSchedule: { 1: false, 2: false, 3: false, 4: false, free: false }, design: 'anime' });
  const wLeer = openA({ [LS]: JSON.stringify(empty0) }, makeBridge({})); await sleep(50);
  ok(wLeer.document.querySelector('#nextAlarm .an-masc').dataset.face === 'sleepy' && wLeer.document.getElementById('nextAlarm').textContent.includes(de['anime.next_none']), 'kein Wecker: schläfriges Maskottchen mit Hinweis');
  wLeer.document.getElementById('allAlarmsBtn2').click();
  ok(wLeer.document.querySelector('#allAlarmList .an-empty .an-bubble').textContent === de['anime.empty_alarms'], '„Alle Wecker“ leer: Maskottchen-Sprechblase');
  wLeer.close();
  // Texte: in allen Sprachen übersetzt, Mehrzahl vollständig
  const animeKeys = keysOf(en).filter(k => k.startsWith('anime.'));
  ok(animeKeys.length >= 15, 'anime.*-Texte vorhanden: ' + animeKeys.length);
  for (const code of ['tr', 'ru', 'pl']) {
    const o = LANG(code), same = animeKeys.filter(k => k in o && o[k] === en[k]);
    ok(!same.length, code + '.json: anime.* übersetzt ' + same.join(', '));
  }
  ok(['ru', 'pl'].every(c => ['one', 'few', 'many', 'other'].every(f => ['anime.soon_hours', 'anime.soon_minutes'].every(b => LANG(c)[b + '_' + f]))), 'ru/pl: anime.soon_* mit _one/_few/_many/_other');
  // Dateien: jede url() in anime.css existiert, Schrift klein und lizenziert, Maskottchen-SVGs ohne Fremdbezug
  const urls = [...new Set([...ANIME_CSS.matchAll(/url\("(anime\/[^"]+)"\)/g)].map(m => m[1]))];
  ok(urls.length >= 10 && urls.every(u => fs.existsSync(path.join(ASSETS, u))), 'alle Anime-Dateien aus anime.css vorhanden (' + urls.length + ')');
  const fontDir = path.join(ASSETS, 'anime', 'fonts');
  const fontBytes = fs.readdirSync(fontDir).filter(f => f.endsWith('.woff2')).reduce((n, f) => n + fs.statSync(path.join(fontDir, f)).size, 0);
  ok(fontBytes > 0 && fontBytes < 250 * 1024 && /SIL Open Font License/.test(fs.readFileSync(path.join(fontDir, 'OFL.txt'), 'utf8')), 'Schrift lokal, < 250 KB (' + Math.round(fontBytes / 1024) + ' KB), OFL.txt dabei');
  const svgs = fs.readdirSync(path.join(ASSETS, 'anime')).filter(f => f.endsWith('.svg'));
  ok(svgs.length >= 9 && svgs.every(f => !/(https?:|<script|<image|<text)/i.test(fs.readFileSync(path.join(ASSETS, 'anime', f), 'utf8').replace('http://www.w3.org/2000/svg', ''))), 'SVGs ohne Skripte/externe Bezüge/Text (' + svgs.length + ')');
  ok(!/@import|https?:\/\//.test(ANIME_CSS.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'anime.css lädt nichts von außen');

  console.log(fails ? `\n${fails} FEHLER` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
