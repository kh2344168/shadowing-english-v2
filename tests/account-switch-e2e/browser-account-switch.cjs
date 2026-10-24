const { chromium } = require('../../node_modules/playwright');

(async () => {
  const base = process.env.DEMO_URL;
  if (!base?.startsWith('https://') || !base.endsWith('.trycloudflare.com'))
    throw Error('Unexpected demo URL');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const failures = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/api/auth/'))
        console.log(`AUTH ${new URL(response.url()).pathname} ${response.status()}`);
      if (response.status() >= 500 && response.url().startsWith(base))
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    async function login(letter) {
      await page.goto(`${base}/login`);
      await page.locator('#login-email').fill(process.env[`DEMO_${letter}_EMAIL`]);
      await page.locator('#login-password').fill(process.env[`DEMO_${letter}_PASSWORD`]);
      await page.locator('button[type="submit"]').click();
      try {
        await page.waitForURL(/\/student\/dashboard/, { timeout: 10000 });
      } catch (error) {
        const alert = await page.locator('[role="alert"]').allTextContents();
        throw Error(`${letter} login failed at ${page.url()}: ${alert.join(' | ') || error.message}`);
      }
      const session = await page.evaluate(async () =>
        (await fetch('/api/auth/session', { cache: 'no-store' })).json());
      if (session.userId.toLowerCase() !== process.env[`DEMO_${letter}_ID`].toLowerCase())
        throw Error(`${letter} session owner mismatch`);
      return session;
    }
    await login('A');
    const curriculum = await page.evaluate(async () =>
      (await fetch('/api/student/learning/curriculum', { cache: 'no-store' })).json());
    const slot = curriculum.items[0]?.slotId;
    if (!slot) throw Error('No published lesson for account switch fixture');
    const shadowing = `${base}/student/lessons/${slot}/shadowing`;
    await page.goto(shadowing);
    await page.locator('.shadowing-mobile-ui').waitFor({ state: 'attached' });
    await page.locator('#btn-toggle-settings').click();
    await page.getByRole('button', { name: 'اختبر الميكروفون' }).click();
    await page.getByRole('button', { name: 'إيقاف الاختبار' }).waitFor();
    await page.getByRole('button', { name: 'إيقاف الاختبار' }).click();
    await page.getByRole('button', { name: 'اختبر الميكروفون' }).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: 'إغلاق إعدادات الشادوينج' }).click();
    console.log('Student microphone test with fake browser device: PASS');
    await page.evaluate(async ({ studentId, slotId }) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('shadowing-v2-local', 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.result.createObjectStore('shadowing-recordings', { keyPath: 'id' });
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('shadowing-recordings', 'readwrite');
          tx.objectStore('shadowing-recordings').put({
            id: crypto.randomUUID(), studentId, slotId, reviewMode: false,
            repetition: 1, durationLabel: '2s', createdAt: new Date().toISOString(),
            mimeType: 'audio/webm', blob: new Blob(['private-audio-marker'], { type: 'audio/webm' })
          });
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        };
      });
    }, { studentId: process.env.DEMO_A_ID, slotId: slot });
    await page.reload();
    await page.getByText('التسجيلات المحفوظة').waitFor();
    if (await page.locator('audio[src^="blob:"]').count() !== 1)
      throw Error('A recording did not restore');
    await page.goto(`${base}/student/recordings`);
    await page.getByText('عندك 1 تسجيل على الجهاز ده.').waitFor();
    if (await page.locator('audio[src^="blob:"]').count() !== 1)
      throw Error('A recording missing from recordings page');
    console.log('A recording restored for A: PASS');
    await page.goto(`${base}/logout`);
    await page.waitForURL(/\/login/, { timeout: 20000 });
    const signedOut = await page.evaluate(async () =>
      (await fetch('/api/auth/session', { cache: 'no-store' })).json());
    if (signedOut.authenticated) throw Error('A session remained authenticated');
    await login('B');
    await page.goto(shadowing);
    await page.locator('.shadowing-mobile-ui').waitFor({ state: 'attached' });
    await page.waitForTimeout(600);
    if (await page.getByText('التسجيلات المحفوظة').count())
      throw Error('A recording visible to B');
    if (await page.locator('audio[src^="blob:"]').count())
      throw Error('A local audio blob visible to B');
    const owner = await page.evaluate(async slotId =>
      (await (await fetch(`/api/student/learning/slots/${slotId}`, { cache: 'no-store' })).json()).studentId, slot);
    if (owner.toLowerCase() !== process.env.DEMO_B_ID.toLowerCase())
      throw Error('B received A overview');
    await page.goto(`${base}/student/recordings`);
    await page.getByText('لسه ما عندكش تسجيلات على الجهاز ده').waitFor();
    if (await page.locator('audio[src^="blob:"]').count())
      throw Error('A recording visible to B on recordings page');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      '/student/dashboard', '/student/curriculum', '/student/progress',
      '/student/recordings', '/student/knowledge-bank', '/student/messages',
      `/student/lessons/${slot}/overview`, `/student/lessons/${slot}/shadowing`
    ]) {
      await page.goto(base + path, { waitUntil: 'domcontentloaded' });
      await page.locator('main, section').first().waitFor();
      if (page.url().includes('/login')) throw Error(`Unexpected login redirect at ${path}`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 392) throw Error(`Mobile horizontal overflow at ${path}: ${width}px`);
    }
    console.log('Student main pages at 390px without horizontal overflow: PASS');
    if (failures.length) throw Error(`Server errors: ${failures.join(', ')}`);
    console.log('Same-browser account switch and recording isolation: PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
