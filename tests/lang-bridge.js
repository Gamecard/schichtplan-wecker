// Sprach-Teil der nachgebauten Android-Bridge (wie MainActivity): liefert die Sprachdateien
// von der Platte, merkt die Spracheinstellung und simuliert den Import einer eigenen Übersetzung.
// Standard: Einstellung „auto“, Systemsprache Deutsch → die bestehenden Tests laufen auf Deutsch.
const fs = require('fs');
const path = require('path');

function withLang(bridge, assets, opts = {}) {
  const dir = path.join(assets, 'lang');
  return Object.assign(bridge, {
    langSetting: opts.setting || 'auto',
    sysLang: opts.system || 'de',
    customLang: opts.custom || '',
    langCalls: [],
    listLanguages() {
      // wie I18n.kt: nur <code>.json, nicht native.<code>.json
      const l = fs.readdirSync(dir).filter(f => /^[a-z]{2,3}(-[A-Za-z0-9]+)?\.json$/.test(f)).sort().map(f => {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { code: j._meta.code, name: j._meta.name };
      });
      if (this.customLang) {
        let name = 'Custom'; try { name = JSON.parse(this.customLang)._meta.name || name; } catch (e) {}
        l.push({ code: 'custom', name });
      }
      return JSON.stringify(l);
    },
    getLanguageFile(code) {
      this.langCalls.push(code);
      if (code === 'custom') return this.customLang || '';
      if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(code)) return '';
      const f = path.join(dir, code + '.json');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    },
    getLanguageSetting() { return this.langSetting; },
    setLanguageSetting(code) { this.langSetting = code; },
    getSystemLanguage() { return this.sysLang; },
    importCalls: bridge.importCalls || 0,
    langImportCalls: 0,
    importLanguageFile() { this.langImportCalls++; },
    getLicenseText(id) {
      const f = { 'apache-2.0': 'licenses/apache-2.0.txt', 'ofl-1.1': 'anime/fonts/OFL.txt', 'polyform-nc-1.0.0': 'licenses/polyform-noncommercial-1.0.0.txt' }[id];
      return f ? fs.readFileSync(path.join(assets, f), 'utf8') : '';
    }
  });
}
module.exports = { withLang };
