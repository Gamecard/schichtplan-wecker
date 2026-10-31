// Ablauftests für den Zuverlässigkeits-Check (Karte „Zuverlässigkeit“ im Bereich Wecker,
// roter Hinweis über dem Kalender, Hinweis oben im Bereich Wecker, Einrichtungs-Abschluss).
// Brücke: Android.getReliabilityStatus() (JSON) + Android.openSystemSettings(ziel).
// Ausführen: cd tests && npm install && npm test
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { withLang, REL_OK, REL_TARGETS } = require('./lang-bridge');
const ASSETS = process.argv[2] || path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="app.css">', () => '<style>' + fs.readFileSync(path.join(ASSETS, 'app.css'), 'utf8') + '</style>')
  .replace('<link rel="stylesheet" href="anime.css">', '')
  .replace('<script src="app.js"></script>', () => '<script>' + fs.readFileSync(path.join(ASSETS, 'app.js'), 'utf8') + '</script>');
const LS = 'schichtplan-native-v1';
const LANG = code => JSON.parse(fs.readFileSync(path.join(ASSETS, 'lang', code + '.json'), 'utf8'));
const ALL_CODES = fs.readdirSync(path.join(ASSETS, 'lang')).filter(f => /^[a-z]{2,3}\.json$/.test(f)).map(f => f.slice(0, -5)).sort();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeBridge(native, rel, lang) {
  return withLang({
    store: native, migrated: true, rel,
    setAlarmForDateSilent(y, mo, d, h, mi, key) {
      if (new Date(y, mo - 1, d, h, mi).getTime() <= Date.now()) return false;
      this.store[key] = { y, mo, d, h, mi }; return true;
    },
    setAlarmForDate(...a) { return this.setAlarmForDateSilent(...a); },
    cancelAlarm(key) { delete this.store[key]; return true; },
    cancelAllAlarms() { return 0; },
    getScheduledKeys() { return JSON.stringify(Object.keys(this.store)); },
    getScheduledAlarms() { return JSON.stringify(Object.entries(this.store).map(([key, v]) => ({ key, ...v }))); },
    getAppVersion() { return '1.16'; },
    updateWidget() {},
    permIssue: '', getAlarmPermissionIssue() { return this.permIssue; },
    openAlarmPermissionSettings(i) { this.openedSettings = i; },
    syncAlarmWindow() { return 0; },
    getAlarmOptions() { return JSON.stringify({ snoozeMinutes: 5, risingVolume: false, vibrateOnly: false }); },
    setAlarmOptions() { return true; },
    isStoreMigrated() { return true; }, setStoreMigrated() {},
    usesCustomRingtone() { return false; }, getCustomRingtoneName() { return ''; },
    testAlarm() {}, pickRingtone() {}, resetRingtone() {}
  }, ASSETS, lang);
}
// errors = JS-Fehler der Seite (jsdom-Konsole), damit „nichts geht kaputt“ prüfbar ist
function open(storage, bridge, wizardSeen = true) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e && (e.detail || e.message) || e)));
  const w = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://localhost/', virtualConsole: vc,
    beforeParse(win) {
      for (const k in storage) win.localStorage.setItem(k, storage[k]);
      if (wizardSeen) win.localStorage.setItem('schichtplan-wizard-done', '1');
      if (bridge) win.Android = bridge;
      win.scrollTo = () => {};
    }
  }).window;
  w.__errors = errors;
  return w;
}
const base = {
  startDate: '2026-10-26', weeksCount: 1, bundesland: 'NI',
  pattern: [2, 2, 2, 2, 2, 1, 1], exceptions: [],
  alarmTimes: { 1: '07:00', 2: '05:30', 3: '13:00', 4: '21:00' },
  alarmEnabled: { 1: false, 2: true, 3: false, 4: false },
  activeAlarms: [], freeAlarm: { enabled: false, time: '07:00', days: [0, 1, 2, 3, 4] }
};
const store = (extra = {}) => ({ [LS]: JSON.stringify(Object.assign({}, base, extra)) });
const $ = (w, id) => w.document.getElementById(id);
const rows = w => [...w.document.querySelectorAll('#relStatus .relrow')].map(r => ({
  id: r.dataset.rel, cls: r.className, txt: r.querySelector('.reltxt').textContent,
  btn: r.querySelector('[data-rel-target]') && r.querySelector('[data-rel-target]').dataset.relTarget
}));
const row = (w, id) => rows(w).find(r => r.id === id);
const tab = (w, n) => w.document.querySelector('#bottomNav [data-tab="' + n + '"]').click();
const visible = el => !!el && !el.hidden && el.style.display !== 'none';

(async () => {
  // ── 1) Alles in Ordnung → kurze positive Zeile, keine Liste, kein Hinweis
  {
    const br = makeBridge({});
    const w = open(store(), br); await sleep(50);
    tab(w, 'wecker');
    ok(visible($(w, 'relCard')) && visible($(w, 'relStatus')), 'Karte „Zuverlässigkeit“ im Bereich Wecker sichtbar');
    ok(/Zuverlässigkeit/.test($(w, 'relCard').querySelector('.ctitle').textContent), 'Kartentitel deutsch');
    const sum = w.document.querySelector('#relStatus .relsum');
    ok(sum && sum.classList.contains('ok') && /Alles bereit/.test(sum.textContent) && /✓/.test(sum.textContent), 'alles ok → positive Zeile mit ✓: ' + (sum && sum.textContent));
    ok(!w.document.querySelector('#relStatus .rellist'), 'alles ok → keine Liste');
    ok($(w, 'relBadge').hidden, 'alles ok → kein Hinweis oben im Bereich Wecker');
    ok(!visible($(w, 'permWarn')), 'alles ok → kein roter Hinweis über dem Kalender');
    ok(!w.document.querySelector('#relStatus .relinfo'), 'Energiesparmodus aus → kein Energiespar-Hinweis');
    ok(/Wichtige Apps/.test($(w, 'relCard').querySelector('.relextreme').textContent) && $(w, 'relCard').querySelector('.relextreme b'), 'fester Hinweis „Extremer Energiesparmodus“ mit Menüpfad (fett)');
    ok(visible($(w, 'relExtremeBtn')), 'Knopf „Energiesparmodus öffnen“ mit Brücke sichtbar');
    $(w, 'relExtremeBtn').click();
    ok(br.openedTargets.join() === 'battery_saver', 'Knopf öffnet die Energiespar-Einstellungen (battery_saver)');
    ok(!w.__errors.length, 'keine JS-Fehler ' + w.__errors.join(' | '));
    w.close();
  }

  // ── 2) Benachrichtigungen aus → kritisch: Warnung, Knopf, Hinweis oben, roter Hinweis im Plan
  {
    const br = makeBridge({}, { notificationsEnabled: false, appNotificationsEnabled: false });
    const w = open(store(), br); await sleep(50);
    const pw = $(w, 'permWarn');
    ok(visible(pw) && /Benachrichtigungen sind aus/.test(pw.textContent), 'Plan: roter Hinweis bei ausgeschalteten Benachrichtigungen');
    $(w, 'permFixBtn').click();
    ok(br.openedTargets.join() === 'notifications' && /Einstellungen öffnen/.test($(w, 'permFixBtn').textContent), 'roter Hinweis öffnet die Benachrichtigungs-Einstellungen');
    tab(w, 'wecker');
    const sum = w.document.querySelector('#relStatus .relsum');
    ok(sum.classList.contains('bad') && /1 Einstellung kann deine Wecker verhindern/.test(sum.textContent), 'Zusammenfassung Einzahl: ' + sum.textContent);
    const r = row(w, 'notifications');
    ok(r && /crit/.test(r.cls) && r.btn === 'notifications' && /⚠/.test(w.document.querySelector('[data-rel="notifications"] .relico').textContent), 'Zeile Benachrichtigungen: ⚠ kritisch, Knopf → notifications');
    ok(row(w, 'exact') && /ok/.test(row(w, 'exact').cls) && !row(w, 'exact').btn, 'Punkte in Ordnung: ✓ ohne Knopf');
    ok(!$(w, 'relBadge').hidden, 'kritischer Punkt → Hinweis oben im Bereich Wecker');
    $(w, 'relBadge').click();   // scrollIntoView fehlt in jsdom – darf nicht abstürzen
    br.openedTargets.length = 0;
    w.document.querySelector('#relStatus [data-rel-target="notifications"]').click();
    ok(br.openedTargets.join() === 'notifications', '„Einstellungen öffnen“ ruft openSystemSettings("notifications")');
    // zurück aus den Einstellungen: Benachrichtigungen jetzt an → onAppResumed zeichnet neu
    br.rel.notificationsEnabled = true; br.rel.appNotificationsEnabled = true;
    w.onAppResumed();
    ok(/Alles bereit/.test($(w, 'relStatus').textContent) && $(w, 'relBadge').hidden && !visible(pw), 'onAppResumed: neuer Stand sofort sichtbar, Hinweise weg');
    // dasselbe über visibilitychange
    br.rel.backgroundRestricted = true;
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    ok(row(w, 'background') && row(w, 'background').btn === 'app_battery' && visible(pw) && /Eingeschränkt/.test(pw.textContent), 'visibilitychange: „Eingeschränkt“ erkannt (Karte + roter Hinweis)');
    ok(!w.__errors.length, 'keine JS-Fehler ' + w.__errors.join(' | '));
    w.close();
  }

  // ── 3) Mehrere Punkte: richtige Ziele, Mehrzahl, Empfehlung zählt nicht als Problem
  {
    const br = makeBridge({}, { backgroundRestricted: true, fullScreenIntentAllowed: false, ignoringBatteryOptimizations: false, standbyBucket: 45, standbyBucketName: 'restricted' });
    const w = open(store(), br); await sleep(50);
    tab(w, 'wecker');
    const want = { background: 'app_battery', fullscreen: 'full_screen', battery_opt: 'battery_optimization' };
    ok(Object.keys(want).every(id => row(w, id) && row(w, id).btn === want[id]), 'Knöpfe mit passendem Ziel: ' + JSON.stringify(rows(w).map(r => r.id + '→' + r.btn)));
    ok(!row(w, 'bucket'), 'Standby-Gruppe nicht doppelt, wenn „Eingeschränkt“ schon gemeldet');
    ok(/warn/.test(row(w, 'fullscreen').cls) && /tip/.test(row(w, 'battery_opt').cls) && /crit/.test(row(w, 'background').cls), 'Stufen: Hintergrund kritisch, Vollbild Warnung, Akku-Optimierung Empfehlung');
    ok(/2 Einstellungen können deine Wecker verhindern/.test(w.document.querySelector('#relStatus .relsum').textContent), 'Mehrzahl: 2 Probleme (Empfehlung nicht mitgezählt)');
    br.openedTargets.length = 0;
    w.document.querySelectorAll('#relStatus [data-rel-target]').forEach(b => b.click());
    ok(br.openedTargets.slice().sort().join() === 'app_battery,battery_optimization,full_screen' && !br.rejectedTargets, 'alle Knöpfe öffnen nur erlaubte Ziele: ' + br.openedTargets.join());
    ok(br.openedTargets.every(t => REL_TARGETS.includes(t)), 'Ziele stammen aus der festen Liste');
    w.close();
  }

  // ── 4) Nur Empfehlung / nur Standby-Gruppe / Energiesparmodus
  {
    const br = makeBridge({}, { ignoringBatteryOptimizations: false, powerSave: true });
    const w = open(store(), br); await sleep(50);
    tab(w, 'wecker');
    ok(/Alles bereit/.test(w.document.querySelector('#relStatus .relsum').textContent) && row(w, 'battery_opt') && row(w, 'battery_opt').btn === 'battery_optimization', 'nur Empfehlung: positive Zeile + Empfehlung mit Knopf');
    ok($(w, 'relBadge').hidden && !visible($(w, 'permWarn')), 'Empfehlung allein → kein Warnhinweis');
    const info = w.document.querySelector('#relStatus .relinfo');
    ok(info && /klingeln trotzdem/.test(info.textContent) && /extreme Energiesparmodus/.test(info.textContent), 'Energiesparmodus an → Hinweis „klingeln trotzdem, nur extremer Modus pausiert“');
    br.rel.ignoringBatteryOptimizations = true; br.rel.standbyBucket = 45; br.rel.powerSave = false;
    const before = br.relCalls;
    tab(w, 'plan'); tab(w, 'wecker');
    ok(br.relCalls > before, 'Öffnen des Bereichs Wecker fragt den Status neu ab');
    ok(row(w, 'bucket') && row(w, 'bucket').btn === 'app_battery' && /warn/.test(row(w, 'bucket').cls) && $(w, 'relBadge').hidden, 'Standby-Gruppe „restricted“: Warnung mit Knopf → app_battery, kein kritischer Hinweis');
    ok(!w.document.querySelector('#relStatus .relinfo'), 'Energiesparmodus wieder aus → Hinweis weg');
    w.close();
  }

  // ── 5) Exakte Wecker (altes Format getAlarmPermissionIssue) bleibt der rote Hinweis mit „Erlauben“
  {
    const br = makeBridge({}); br.permIssue = 'exact';
    const w = open(store(), br); await sleep(50);
    ok(/Wecker sind nicht erlaubt/.test($(w, 'permWarn').textContent) && /Erlauben/.test($(w, 'permFixBtn').textContent), 'exakte Wecker fehlen: bisheriger roter Hinweis');
    $(w, 'permFixBtn').click();
    ok(br.openedSettings === 'exact', '„Erlauben“ nutzt weiter openAlarmPermissionSettings("exact")');
    tab(w, 'wecker');
    ok(row(w, 'exact') && row(w, 'exact').btn === 'exact_alarm' && !$(w, 'relBadge').hidden, 'Karte: „Wecker und Erinnerungen“ kritisch, Knopf → exact_alarm');
    w.close();
  }

  // ── 6) Ohne Brücke / ohne die neuen Methoden / kaputtes JSON → nichts geht kaputt
  {
    const w = open(store(), null); await sleep(50);
    tab(w, 'wecker');
    ok($(w, 'relStatus').hidden && $(w, 'relExtremeBtn').hidden && $(w, 'relBadge').hidden, 'ohne Brücke: keine Prüfpunkte, kein Knopf, fester Hinweis bleibt');
    // (ohne Brücke lädt jsdom keine Sprachdatei – geprüft wird der Aufbau, nicht der Text)
    ok(visible($(w, 'relCard').querySelector('.relextreme')) && $(w, 'relCard').querySelector('[data-i18n-html="rel.extreme_text"]'), 'ohne Brücke: fester Hinweisblock sichtbar');
    w.onAppResumed(); $(w, 'relCard').click(); $(w, 'relBadge').click();
    ok(!w.__errors.length && !/Fehler/.test($(w, 'toast').textContent), 'ohne Brücke: keine JS-Fehler ' + w.__errors.join(' | '));
    w.close();

    const br = makeBridge({}); delete br.getReliabilityStatus; delete br.openSystemSettings;
    const w2 = open(store(), br); await sleep(50);
    tab(w2, 'wecker'); w2.onAppResumed();
    ok($(w2, 'relStatus').hidden && $(w2, 'relExtremeBtn').hidden && !w2.__errors.length, 'ältere Brücke ohne neue Methoden: Karte ohne Prüfpunkte, kein Fehler');
    w2.close();

    const br3 = makeBridge({}); br3.getReliabilityStatus = () => 'kaputt{';
    const w3 = open(store(), br3); await sleep(50);
    tab(w3, 'wecker');
    ok($(w3, 'relStatus').hidden && !w3.__errors.length, 'kaputtes JSON: Prüfpunkte ausgeblendet, kein Fehler');
    br3.getReliabilityStatus = () => '{"powerSave":true}';
    w3.onAppResumed();
    ok($(w3, 'relStatus').hidden, 'nur unbekannte/fehlende Punkte → keine Liste');
    br3.getReliabilityStatus = () => { throw new Error('Brücke weg'); };
    w3.onAppResumed();
    ok(!w3.__errors.length, 'Ausnahme der Brücke wird abgefangen');
    w3.close();
  }

  // ── 7) Einrichtung: Abschluss mit Hinweis + Knopf (ohne Brücke ohne Knopf)
  {
    const br = makeBridge({});
    const w = open(store(), br, false); await sleep(50);
    for (let i = 0; i < 4; i++) $(w, 'wizNext').click();
    const ex = w.document.querySelector('#wizBody .wiz-extreme');
    ok(ex && /Extremer Energiesparmodus/.test(ex.textContent) && /wichtigen Apps/.test(ex.textContent), 'Einrichtung, letzter Schritt: Hinweis auf den extremen Energiesparmodus');
    $(w, 'wizExtremeBtn').click();
    ok(br.openedTargets.join() === 'battery_saver' && /Energiesparmodus öffnen/.test($(w, 'wizExtremeBtn').textContent), 'Einrichtung: Knopf öffnet die Energiespar-Einstellungen');
    w.close();
    const w2 = open(store(), null, false); await sleep(50);
    for (let i = 0; i < 4; i++) $(w2, 'wizNext').click();
    ok(w2.document.querySelector('#wizBody .wiz-extreme') && !$(w2, 'wizExtremeBtn') && !w2.__errors.length, 'Einrichtung ohne Brücke: Hinweis ohne Knopf, kein Fehler');
    w2.close();
  }

  // ── 8) Anime-Design: Maskottchen in der Zusammenfassung, klassisch nicht
  {
    const br = makeBridge({}, { notificationsEnabled: false });
    const w = open(store({ design: 'anime' }), br); await sleep(50);
    tab(w, 'wecker');
    const m = w.document.querySelector('#relStatus .relsum .an-masc');
    ok(m && m.getAttribute('data-face') === 'oops', 'Anime: Maskottchen „oops“ bei Problemen');
    br.rel.notificationsEnabled = true; w.onAppResumed();
    ok(w.document.querySelector('#relStatus .relsum .an-masc').getAttribute('data-face') === 'happy', 'Anime: Maskottchen „happy“, wenn alles passt');
    $(w, 'appVersion').click();   // Design wechseln → klassisch
    ok(!w.document.querySelector('#relStatus .an-masc') && /✓/.test($(w, 'relStatus').textContent), 'Designwechsel: klassisch wieder mit ✓ statt Maskottchen');
    w.close();
    const anime = fs.readFileSync(path.join(ASSETS, 'anime.css'), 'utf8');
    const relRules = anime.split('\n').filter(l => /\.rel(badge|list|row|sum|info|extreme|x-title)/.test(l) && /\{/.test(l));
    ok(relRules.length >= 6 && relRules.every(l => /^html\[data-design="anime"\]/.test(l.trim()) || /^,?\s*html\[data-design="anime"\]/.test(l)), 'anime.css: Regeln der Karte unter html[data-design="anime"] (' + relRules.length + ')');
  }

  // ── 9) Texte in allen Sprachen vorhanden, Karte rendert ohne rohe Schlüssel
  const KEYS = ['rel.title', 'rel.intro', 'rel.all_ok', 'rel.notifications_ok', 'rel.notifications_bad', 'rel.exact_ok', 'rel.exact_bad',
    'rel.background_ok', 'rel.background_bad', 'rel.fullscreen_ok', 'rel.fullscreen_bad', 'rel.bucket_bad', 'rel.battery_opt_ok',
    'rel.battery_opt_bad', 'rel.power_save', 'rel.open', 'rel.extreme_title', 'rel.extreme_text', 'rel.extreme_btn', 'rel.badge', 'wiz.extreme'];
  for (const code of ALL_CODES) {
    const o = LANG(code);
    const miss = KEYS.filter(k => typeof o[k] !== 'string' || !o[k].trim());
    const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories.filter(c => c !== 'zero' || code === 'ar');
    const plMiss = cats.filter(c => !o['rel.problems_' + c] || !/\{n\}/.test(o['rel.problems_' + c]));
    ok(!miss.length && !plMiss.length, code + '.json: alle Zuverlässigkeits-Texte + Mehrzahl rel.problems (' + cats.join('/') + ')' + (miss.length || plMiss.length ? ' – fehlt: ' + miss.concat(plMiss.map(c => 'rel.problems_' + c)).join(', ') : ''));
    ok(/Schichtwecker/.test(o['rel.extreme_text']) && /<b>[^<]+→[^<]+<\/b>/.test(o['rel.extreme_text']) && /Schichtwecker/.test(o['wiz.extreme']), code + '.json: Hinweis nennt die App und den Menüpfad (fett)');
    const br = makeBridge({}, { notificationsEnabled: false, backgroundRestricted: true, ignoringBatteryOptimizations: false, powerSave: true }, { system: code });
    const w = open(store(), br); await sleep(30);
    tab(w, 'wecker');
    const txt = $(w, 'relCard').textContent + $(w, 'relBadge').textContent + $(w, 'permWarn').textContent;
    const n = rows(w).length;
    ok(n === 6 - 1 && !/\brel\.\w/.test(txt) && txt.includes(o['rel.open']) && txt.includes(o['rel.title']), code + ': Karte vollständig übersetzt (' + n + ' Punkte)');
    w.close();
  }
  ok(Object.keys(REL_OK).length === 10, 'Mock liefert alle 10 Felder des Kotlin-Formats');

  console.log(fails ? `\n${fails} Test(s) fehlgeschlagen` : '\nalle Tests bestanden');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
