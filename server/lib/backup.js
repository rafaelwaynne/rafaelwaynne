const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function scheduleDailyBackup(dataDir, backupDir) {
  function doBackup() {
    const stamp = new Date().toISOString().slice(0,10);
    const dest = path.join(backupDir, stamp);
    copyDir(dataDir, dest);
  }
  doBackup();
  setInterval(doBackup, 24 * 60 * 60 * 1000);
}

module.exports = { scheduleDailyBackup };
