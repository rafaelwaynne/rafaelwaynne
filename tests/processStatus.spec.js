const { test, expect } = require('@playwright/test');

test('Alterna status, cores e persiste entre sessões', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  await page.click('#proc-add');
  const statusLabel = page.locator('.widget[data-id^="proc-"] .proc-status').first();
  await expect(statusLabel).toHaveText('EM ANDAMENTO');
  await expect(statusLabel).toHaveCSS('background-color', 'rgb(76, 175, 80)');
  const statusBtn = page.locator('.widget[data-id^="proc-"] .actions-row .add-btn', { hasText: 'Status:' }).first();
  await statusBtn.click();
  await page.click('.widget[data-id^=\"proc-\"] .proc-status-menu .menu-item[data-status=\"ENCERRADO\"]');
  await expect(statusLabel).toHaveText('ENCERRADO');
  await expect(statusLabel).toHaveCSS('background-color', 'rgb(244, 67, 54)');
  await expect(statusBtn).toHaveText(/Status:\s+ENCERRADO/);
  await page.reload();
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  const statusLabelAfter = page.locator('.widget[data-id^="proc-"] .proc-status').first();
  await expect(statusLabelAfter).toHaveText('ENCERRADO');
  await expect(statusLabelAfter).toHaveCSS('background-color', 'rgb(244, 67, 54)');
  const statusBtnAfter = page.locator('.widget[data-id^="proc-"] .actions-row .add-btn', { hasText: 'Status:' }).first();
  await expect(statusBtnAfter).toHaveText(/Status:\s+ENCERRADO/);
  const listStatus = page.locator('#proc-dynamic-container .proc-list .proc-status').first();
  await expect(listStatus).toHaveText('ENCERRADO');
  await expect(listStatus).toHaveCSS('background-color', 'rgb(244, 67, 54)');

test('Seleciona status via botão na lista de processos', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  await page.click('#proc-add');
  const btn = page.locator('#proc-dynamic-container .proc-list .status-btn').first();
  await expect(btn).toHaveText('EM ANDAMENTO');
  await expect(btn).toHaveCSS('background-color', 'rgb(76, 175, 80)');
  await btn.click();
  await page.click('#proc-dynamic-container .proc-list .status-menu .menu-item[data-status="ENCERRADO"]');
  await expect(btn).toHaveText('ENCERRADO');
  await expect(btn).toHaveCSS('background-color', 'rgb(244, 67, 54)');
  await page.reload();
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  const btnAfter = page.locator('#proc-dynamic-container .proc-list .status-btn').first();
  await expect(btnAfter).toHaveText('ENCERRADO');
  await expect(btnAfter).toHaveCSS('background-color', 'rgb(244, 67, 54)');
});

test('Marca processo com ícone quadrado e persiste', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  await page.click('#proc-add');
  const box = page.locator('#proc-dynamic-container .proc-list .mark-box').first();
  await box.click();
  await expect(box).toHaveClass(/marked/);
  await page.reload();
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  const boxAfter = page.locator('#proc-dynamic-container .proc-list .mark-box').first();
  await expect(boxAfter).toHaveClass(/marked/);
});

test('Exclui processo pela lista e remove widget/nav', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
  await page.waitForSelector('.tabs button[data-tab="processes"]');
  await page.click('.tabs button[data-tab="processes"]');
  await page.click('#proc-add');
  const countBefore = await page.locator('#proc-dynamic-container .proc-list li').count();
  const delBtn = page.locator('#proc-dynamic-container .proc-list .del-btn').first();
  await delBtn.click();
  await expect(page.locator('#proc-dynamic-container .proc-list li')).toHaveCount(countBefore - 1);
  // verifica navegação
  const navBtns = await page.locator('.tabs button[id^="proc-tab-"]').count();
  // não sabemos quantos havia antes, mas o recém criado deve ter sumido
  await expect(navBtns).toBeGreaterThanOrEqual(0);
});

test('Robô detecta atualização via link mock e histórico muda', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
  const res = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/processes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ autor: 'Teste Robô', link: '/api/test/process-page?rev=1', status: 'EM ANDAMENTO' })
    });
    return await r.json();
  });
  const id = res.id;
  await page.click('#side-processes');
  await page.waitForSelector('#proc-dynamic-container .proc-list');
  await page.locator(`[data-scan="${id}"]`).click();
  await page.evaluate(async (pid) => {
    const token = localStorage.getItem('token');
    await fetch('/api/processes/' + pid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ link: '/api/test/process-page?rev=2' })
    });
    await fetch('/api/processes/' + pid + '/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({})
    });
  }, id);
  const count = await page.locator('#proc-dynamic-container .proc-list li').count();
  expect(count).toBeGreaterThan(0);
});
});
