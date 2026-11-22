// Feste Testuhr: Die Tests benutzen feste Kalenderdaten (z. B. 2026-11-03). Damit sie nicht
// veralten, sobald diese Tage in der Vergangenheit liegen, startet jedes Testfenster mit
// derselben Uhrzeit – im Testfenster und in Node; die Zeit läuft von dort aus normal weiter (Timer und Abstände bleiben echt).
const START = new Date(2026, 9, 31, 12, 0, 0).getTime(); // Sa 31.10.2026 12:00 Ortszeit

function install(w, start = START) {
  const Real = w.Date;
  const offset = start - Real.now();
  class TestDate extends Real {
    constructor(...a) { if (a.length === 0) super(Real.now() + offset); else super(...a); }
    static now() { return Real.now() + offset; }
  }
  w.Date = TestDate;
}

// Auch die Node-Seite (nachgebaute Brücke, erwartete Werte der Tests) nutzt dieselbe Uhr.
install(globalThis);

module.exports = install;
module.exports.START = START;
