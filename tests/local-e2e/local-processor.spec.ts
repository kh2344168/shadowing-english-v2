import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ORIGIN = 'http://127.0.0.1:4206';
const LINK = { schemaVersion: 1, protocolVersion: 1, origin: ORIGIN, userId: 'test-admin',
  token: 'a'.repeat(64), settings: { profile: 'shadowing-v2-1', leadingMs: 150, trailingMs: 100 } };

function wav(): Buffer {
  const bytes = Buffer.alloc(128044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

async function siteApi(page: Page, role = 'Admin'): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') writes.push(url.pathname);
    let value: unknown;
    if (url.pathname === '/api/auth/session') value = { authenticated: true,
      userId: role === 'Admin' ? 'test-admin' : 'test-student', roles: [role] };
    else if (url.pathname === '/api/auth/csrf') value = null;
    else if (url.pathname === '/api/admin/shadowing/groups') value = { items: [{ id: 'test-group', name: 'Test group', currentVersionId: null }], hasMore: false };
    else if (url.pathname === '/api/admin/shadowing/lessons' && request.method() === 'GET') value = { items: [], hasMore: false };
    else if (url.pathname === '/api/admin/shadowing/lessons') {
      expect(request.headers()['content-type']).toContain('multipart/form-data');
      expect(request.postDataBuffer()?.includes(Buffer.from('segment-01.wav'))).toBe(true);
      value = { id: 'test-lesson', versionId: 'test-version', title: 'Browser lesson', description: '', segmentCount: 2 };
    } else if (url.pathname === '/api/admin/shadowing/publish') value = { groupId: 'test-group', versionId: 'test-published', slotId: 'test-slot' };
    else if (url.pathname === '/api/student/learning/curriculum') value = { groupName: null, curriculumTitle: null, items: [], hasMore: false };
    else throw new Error('Unexpected site API request: ' + request.method() + ' ' + url.pathname);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  });
  return writes;
}

async function connect(page: Page): Promise<void> {
  await page.addInitScript((link) => {
    localStorage.setItem('shadowing.local-processor.test-admin', JSON.stringify(link));
  }, LINK);
  await page.goto('/admin/ai-processing');
  await expect(page.locator('.tool-status')).toContainText('WhisperX جاهز');
}

test('local processing, recut, review, transfer, save and publish remain separate', async ({ page, context }) => {
  const writes = await siteApi(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addCookies([{ name: 'V2Session', value: 'fixture-cookie', domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const localHeaders: Promise<Record<string, string>>[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:43127/')) localHeaders.push(request.allHeaders());
  });
  await connect(page);
  await page.locator('#processor-lesson-title').fill('Browser lesson');
  await page.locator('#processor-media').setInputFiles({ name: 'teacher.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.locator('#processor-script-file').setInputFiles({ name: 'lesson.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello there.\nGood morning.') });
  await page.getByRole('button', { name: 'ابدأ معالجة Shadowing', exact: true }).click();
  await expect(page.locator('#review-title')).toBeVisible();
  expect(writes).toEqual([]);
  const transfer = page.getByRole('button', { name: 'اعتماد Shadowing والانتقال للحفظ', exact: true });
  await expect(transfer).toBeDisabled();
  await page.locator('#clip-end-0').fill('1.5');
  await expect(page.locator('#processor-reviewed')).toBeDisabled();
  await page.getByRole('button', { name: 'طبّق التعديلات وأعد التقطيع' }).click();
  await expect(page.locator('#processor-reviewed')).toBeEnabled();
  await page.locator('#processor-reviewed').check();
  await transfer.click();
  await expect(page).toHaveURL(/\/admin\/lesson-builder$/);
  await expect(page.locator('#lesson-title')).toHaveValue('Browser lesson');
  await expect(page.locator('.segment audio')).toHaveCount(2);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'احفظ الدرس', exact: true }).click();
  await expect(page.locator('.notice.success')).toContainText('اتحفظ الدرس');
  expect(writes).toEqual(['/api/admin/shadowing/lessons']);
  await page.locator('#target-group').selectOption('test-group');
  await page.getByRole('button', { name: 'انشر الدرس للمجموعة', exact: true }).click();
  await expect(page.locator('.notice.success')).toContainText('تم نشر');
  expect(writes).toEqual(['/api/admin/shadowing/lessons', '/api/admin/shadowing/publish']);
  expect(localHeaders.length).toBeGreaterThan(0);
  expect((await Promise.all(localHeaders)).every((headers) => !headers['cookie'] && !headers['x-csrf'] && !headers['x-xsrf-token'])).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('builder.png'), fullPage: true });
});

test('an existing installation can reconnect and downloaded packages contain only local source and pairing', async ({ page }) => {
  const writes = await siteApi(page);
  await page.goto('/admin/ai-tools');
  await expect(page.locator('.tool-card')).toContainText('WhisperX');
  await page.locator('#ai-tool-link').setInputFiles({ name: 'shadowing-link.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(LINK)) });
  await expect(page.locator('.status-card')).toContainText('تم التثبيت بنجاح');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'نزّل حزمة WhisperX' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('Shadowing-V2-Local-Processor.zip');
  const path = await file.path();
  const check = "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); c=json.loads(z.read('shadowing-link.json')); print(json.dumps({'count':len(z.namelist()),'valid':z.testzip() is None,'origin':c['origin'],'userId':c['userId'],'tokenLength':len(c['token'])}))";
  const python = process.platform === 'win32' ? 'py' : 'python';
  const args = process.platform === 'win32' ? ['-3.12', '-c', check, path!] : ['-c', check, path!];
  const inspected = JSON.parse(execFileSync(python, args, { encoding: 'utf-8' }));
  expect(inspected).toEqual({ count: 13, valid: true, origin: ORIGIN, userId: 'test-admin', tokenLength: 64 });
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('local-processing.png'), fullPage: true });
});

test('an exported ZIP imports without a processor connection and still requires review', async ({ page }) => {
  const writes = await siteApi(page);
  await connect(page);
  await page.locator('#processor-lesson-title').fill('Browser lesson');
  await page.locator('#processor-media').setInputFiles({ name: 'teacher.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.locator('#processor-script-file').setInputFiles({ name: 'lesson.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello there.\nGood morning.') });
  await page.getByRole('button', { name: 'ابدأ معالجة Shadowing', exact: true }).click();
  await expect(page.locator('#review-title')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تنزيل نسخة ZIP' }).click();
  const zip = await downloading;
  await page.goto('/admin/lesson-builder');
  await page.locator('#lesson-result').setInputFiles({ name: zip.suggestedFilename(), mimeType: 'application/zip', buffer: readFileSync((await zip.path())!) });
  await expect(page.locator('#lesson-title')).toHaveValue('Browser lesson');
  await expect(page.getByRole('button', { name: 'احفظ الدرس', exact: true })).toBeDisabled();
  await page.locator('#import-reviewed').check();
  await expect(page.getByRole('button', { name: 'احفظ الدرس', exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
});

test('student pages never contact the processor or download its package', async ({ page }) => {
  await siteApi(page, 'Student');
  const unwanted: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(':43127/') || url.includes('local-processor-package') || url.includes('ai-processing-page')) unwanted.push(url);
  });
  await page.goto('/student/dashboard');
  await expect(page.locator('h1')).toBeVisible();
  await page.goto('/admin/ai-processing');
  await expect(page).toHaveURL(/\/student\/dashboard$/);
  expect(unwanted).toEqual([]);
});
