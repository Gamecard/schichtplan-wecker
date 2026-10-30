// Führt alle *.test.js in diesem Ordner nacheinander aus; Exit-Code != 0 bei Fehlern
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
let failed = 0;
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  console.log('\n### ' + f);
  try { process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' })); }
  catch (e) { process.stdout.write(e.stdout || ''); process.stderr.write(e.stderr || ''); failed++; }
}
console.log(failed ? '\n' + failed + ' Testdatei(en) mit Fehlern' : '\nalle Testdateien bestanden');
process.exit(failed ? 1 : 0);
