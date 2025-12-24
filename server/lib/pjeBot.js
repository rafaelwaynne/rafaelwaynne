const { sendEmail } = require('./smtp');
const { URL } = require('url');

async function runHeadless({ pjeUrl, username, password, query, onItems }) {
  let browser = null;
  try {
    let pw;
    try { pw = require('playwright'); } catch {}
    if (!pw) throw new Error('Playwright não instalado');
    const { chromium } = pw;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (pjeUrl) {
      await page.goto(pjeUrl, { waitUntil: 'domcontentloaded' });
      const userSel = ['input[name="usuario"]','input[name="username"]','input#usuario','input#username'];
      const passSel = ['input[name="senha"]','input[name="password"]','input#senha','input#password'];
      let foundUser = null, foundPass = null;
      for (const s of userSel) { if (await page.$(s)) { foundUser = s; break; } }
      for (const s of passSel) { if (await page.$(s)) { foundPass = s; break; } }
      if (foundUser && foundPass) {
        await page.fill(foundUser, username || '');
        await page.fill(foundPass, password || '');
        const loginBtn = await page.$('button[type="submit"], input[type="submit"]');
        if (loginBtn) await loginBtn.click(); else await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(()=>{});
      }
    }
    const q = encodeURIComponent(query || '');
    await page.goto(`https://www.jusbrasil.com.br/processos/?q=${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const items = await page.evaluate(() => {
      const arr = [];
      const cards = document.querySelectorAll('[data-id="process-card"], article');
      cards.forEach(card => {
        const numero = (card.innerText.match(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})/)||[])[1] || '';
        const partes = (card.innerText.match(/Partes?:\s*(.+)/i)||[])[1] || '';
        const andamento = (card.innerText.match(/Andamento[s]?:\s*(.+)/i)||[])[1] || '';
        const status = (card.innerText.match(/Status:\s*(.+)/i)||[])[1] || '';
        arr.push({ numero, partes, andamento, prazos: [], status, fonte: 'Jusbrasil' });
      });
      return arr.filter(i => i.numero);
    });
    if (typeof onItems === 'function') await onItems(items);
    return { items };
  } finally {
    if (browser) await browser.close().catch(()=>{});
  }
}

module.exports = { runHeadless };
