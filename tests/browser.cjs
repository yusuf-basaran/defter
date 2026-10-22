const { chromium } = require('playwright');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.GCLOUD_PROJECT = 'demo-defter';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const sdk = createRequire(require('node:path').resolve('functions/package.json'));
const { initializeApp } = sdk('firebase-admin/app');
const { getAuth } = sdk('firebase-admin/auth');
const { getFirestore, Timestamp } = sdk('firebase-admin/firestore');
(async () => {
  initializeApp({ projectId: 'demo-defter' });
  const admin = getAuth();
  const db = getFirestore();
  await db.doc('vatRates/2026').set({ year: 2026, rates: [0, 5, 10, 16, 20] });
  const email = `browser-${Date.now()}@example.com`;
  const password = 'Defter-uzun-sifre-42';
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1000 },
    locale: 'tr-TR',
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto('http://127.0.0.1:5000', { waitUntil: 'networkidle' });
    await page.locator('[data-action="accept-notice"]').click();
    await page.locator('[data-action="toggle-register"]').click();
    await page.locator('#full-name').fill('Deniz Kaya');
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(password);
    await page.locator('#auth-submit').click();
    await page.locator('#verify-panel').waitFor({ state: 'visible' });
    const user = await admin.getUserByEmail(email);
    await admin.updateUser(user.uid, { emailVerified: true });
    await page.locator('[data-action="check-verification"]').click();
    console.info('verified');
    await page.locator('#setup-form').waitFor({ state: 'visible' });
    for (const [key, value] of Object.entries({
      name: 'Kurgusal Çınar Atölyesi',
      legalName: 'Kurgusal Çınar Tasarım Atölyesi',
      address: 'Çınar Sokak No: 12, Girne',
      taxOffice: 'Girne',
      taxNumber: 'KURGU-319'
    }))
      await page.locator(`#setup-${key}`).fill(value);
    await page.locator('#setup-form button').click();
    console.info('setup submitted');
    await page.locator('[data-field="client.name"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-field="client.name"]').fill('Kurgusal Nar Eğitim Evi');
    await page.locator('[data-field="client.address"]').fill('Lale Sokak No: 8, Lefkoşa');
    await page.locator('.item-row [data-field$=".desc"]').fill('Yazılım hizmeti — ğ ş ı İ ö ç ü');
    await page.locator('.item-row [data-field$=".unitPrice"]').fill('1250,00');
    console.info('form filled');
    await page.locator('[data-action="save"]').click();
    await page.waitForFunction(
      () => document.querySelector('#save-indicator').textContent === 'Taslak sunucuda saklandı',
      { timeout: 30000 }
    );
    console.info('draft saved');
    await page.locator('[data-action="issue"]').click();
    await page.locator('#confirm-button').click();
    await page.waitForFunction(
      () => document.querySelector('#document-number').textContent === 'A-000001',
      null,
      { timeout: 30000 }
    );
    console.info('invoice issued');
    const pagination = await page.evaluate(async () => {
      const { buildPages, removePrintPages } = await import('./js/pdf.js');
      const source = document.querySelector('#invoice-source .invoice-paper').cloneNode(true);
      const body = source.querySelector('tbody');
      const row = body.rows[0];
      body.replaceChildren(...Array.from({ length: 65 }, () => row.cloneNode(true)));
      const pages = buildPages(source, 'both');
      const result = {
        pages: pages.length,
        rows: pages.reduce((sum, page) => sum + page.querySelectorAll('tbody tr').length, 0),
        headers: pages.every((page) => page.querySelector('thead')),
        overflow: pages.some(
          (page) =>
            page.children[page.children.length - 2].getBoundingClientRect().bottom >
            page.querySelector('footer').getBoundingClientRect().top - 15
        )
      };
      removePrintPages();
      return result;
    });
    assert.equal(pagination.rows, 130);
    assert.ok(pagination.pages >= 4);
    assert.equal(pagination.headers, true);
    assert.equal(pagination.overflow, false);
    console.info('65-row copies pagination', pagination);

    assert.equal(await page.locator('[data-field="client.name"]').isDisabled(), true);
    await page.locator('#copies').selectOption('both');
    assert.equal(await page.locator('#invoice-preview .copy-label').count(), 2);
    console.info('copies rendered');
    const download = page.waitForEvent('download', { timeout: 90000 });
    await page.locator('[data-action="pdf"]').click();
    const pdf = await download;
    await pdf.saveAs('/tmp/defter-cloud.pdf');
    console.info('pdf downloaded');
    await page.locator('[data-action="paid"]').click();
    await page.waitForFunction(() => document.querySelector('#editor-status').textContent === 'Ödendi');
    const bid = new URL(page.url()).searchParams.get('business');
    assert.ok(bid);
    await db
      .doc(`businesses/${bid}/subscription/current`)
      .update({ currentPeriodEnd: Timestamp.fromMillis(Date.now() - 1000) });
    await page.waitForFunction(() => document.querySelector('[data-action="new"]').disabled === true);
    assert.equal(await page.locator('[data-action="pdf"]').isDisabled(), false);
    await page.locator('[data-action="history"]').click();
    await page.locator('.history-table').waitFor();
    assert.equal(await page.locator('.history-table tbody tr').count(), 1);
    const exported = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const backup = await exported;
    const payload = JSON.parse(fs.readFileSync(await backup.path(), 'utf8'));
    assert.equal(payload.schemaVersion, 3);
    assert.equal(payload.invoices.length, 1);
    console.info('expired export passed');
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: '/tmp/defter-cloud-mobile.png', fullPage: true });
    await db
      .doc(`businesses/${bid}/subscription/current`)
      .update({ currentPeriodEnd: Timestamp.fromMillis(Date.now() + 86400000) });
    await page.locator('[data-action="edit"]').first().click();
    await page.locator('[data-action="cancel-current"]').click();
    await page.locator('#cancel-reason').fill('Alıcı isteği ile iptal');
    await page.locator('#confirm-button').click();
    await page.waitForFunction(() => document.querySelector('#editor-status').textContent === 'İptal');
    assert.equal(await page.locator('#invoice-preview .cancel-stamp').count(), 2);
    await page.setViewportSize({ width: 1512, height: 1000 });
    const { draft: draftFixture } = await import('./fixtures.js');
    const batch = db.batch();
    for (let index = 0; index < 55; index++)
      batch.set(db.doc(`businesses/${bid}/invoices/page-${index}`), {
        ...draftFixture(user.uid),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    await batch.commit();
    await page.locator('[data-action="history"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-table tbody tr').length === 50);
    await page.locator('[data-action="page-next"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-table tbody tr').length === 6);
    await page.locator('[data-action="page-prev"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-table tbody tr').length === 50);
    console.info('50-record pagination passed');
    await page.locator('[data-action="monthly"]').click();
    await page.screenshot({ path: '/tmp/defter-cloud-desktop.png', fullPage: true });
    const adminPage = await context.newPage();
    await adminPage.goto('http://127.0.0.1:5000/admin.html', { waitUntil: 'networkidle' });
    await adminPage.waitForFunction(() =>
      document.querySelector('#admin-status').textContent.includes('Erişim reddedildi')
    );
    await adminPage.close();
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    for (const theme of ['light', 'dark']) {
      await page.locator('#theme').selectOption(theme);
      const violations = await page.evaluate(async () =>
        (
          await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
          })
        ).violations.map((item) => ({ id: item.id, targets: item.nodes.map((node) => node.target) }))
      );
      assert.deepEqual(violations, [], theme);
    }
    await admin.setCustomUserClaims(user.uid, { platformAdmin: true });
    await page.evaluate(async () => {
      const auth = await import('./js/auth.js');
      await auth.refreshUser();
    });
    const allowed = await context.newPage();
    await allowed.goto('http://127.0.0.1:5000/admin.html', { waitUntil: 'networkidle' });
    await allowed.locator('.admin-business').first().waitFor();
    assert.equal(await allowed.locator('#admin-panel').isVisible(), true);
    await allowed.close();
    console.info('accessibility and admin allow passed');
    assert.deepEqual(errors, []);
    console.info(
      JSON.stringify({
        browser:
          'signup, verify, setup, draft, issue, PDF Asıl+Suret, paid, expiry-read, cancel, mobile, admin-deny',
        businessId: bid,
        errors
      })
    );
  } catch (error) {
    await page.screenshot({ path: '/tmp/defter-cloud-failure.png', fullPage: true });
    console.error(
      'UI status:',
      await page.locator('#auth-status').textContent(),
      await page.locator('#notifications').innerText(),
      errors
    );
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
