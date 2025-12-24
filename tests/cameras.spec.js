const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await page.fill('#email', 'admin@local');
  await page.fill('#password', 'admin123');
  await page.click('#login-btn');
}

test.skip('Visualiza 3 câmeras simultaneamente e responsivo', async ({ page }) => {
  await login(page);
  await page.click('#side-cameras');
  // cria 3 câmeras usando imagens de placeholder
  const urls = [
    'https://picsum.photos/400/200?random=1',
    'https://picsum.photos/400/200?random=2',
    'https://picsum.photos/400/200?random=3'
  ];
  for (let i = 0; i < urls.length; i++) {
    await page.evaluate(async ({ u, idx }) => {
      const res = await fetch('/api/cameras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ storeId: 'loja-1', name: 'Cam ' + (idx+1), url: u })
      });
      if (!res.ok) throw new Error(await res.text());
    }, { u: urls[i], idx: i });
  }
  await page.click('#side-cameras');
  await page.waitForSelector('#camera-grid .camera-item');
  const count = await page.locator('#camera-grid .camera-item').count();
  expect(count).toBeGreaterThanOrEqual(3);
  // responsividade
  await page.setViewportSize({ width: 380, height: 800 });
  await expect(page.locator('#camera-grid')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('#camera-grid')).toBeVisible();
});

test.skip('Edita nome de câmera e persiste localmente', async ({ page }) => {
  await login(page);
  await page.click('#side-cameras');
  await page.waitForSelector('#camera-grid .camera-item .camera-head input');
  const nameInp = page.locator('#camera-grid .camera-item .camera-head input').first();
  await nameInp.fill('Entrada Principal');
  await page.reload();
  await page.click('#side-cameras');
  await page.waitForSelector('#camera-grid .camera-item .camera-head input');
  const after = page.locator('#camera-grid .camera-item .camera-head input').first();
  await expect(after).toHaveValue('Entrada Principal');
});

test('Protege segurança do login e API de câmeras', async ({ page }) => {
  await page.goto('/');
  // sem login, a API deve recusar
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/cameras');
    return { ok: r.ok, status: r.status };
  });
  expect(status.ok).toBeFalsy();
  expect(status.status).toBe(401);
});
