const { chromium } = require('playwright');
const { createRequire } = require('node:module');
const { mkdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

process.env.GCLOUD_PROJECT = 'demo-defter';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const sdk = createRequire(resolve('functions/package.json'));
const { initializeApp } = sdk('firebase-admin/app');
const { getAuth } = sdk('firebase-admin/auth');
const { getFirestore } = sdk('firebase-admin/firestore');
const directory = resolve('docs/screenshots');
const origin = 'http://127.0.0.1:5000';

async function capture(page, name, options = {}) {
  const notice = page.locator('[data-action="accept-notice"]');
  if (await notice.isVisible()) await notice.click();
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.activeElement?.blur();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
  await page.screenshot({ path: resolve(directory, `${name}.png`), animations: 'disabled', ...options });
  process.stdout.write(`${name}.png\n`);
}

async function main() {
  mkdirSync(directory, { recursive: true });
  initializeApp({ projectId: 'demo-defter' });
  const admin = getAuth();
  const db = getFirestore();
  const previous = await db.doc('screenshotFixtures/current').get();
  if (previous.exists) {
    for (const id of previous.data().businessIds) await db.recursiveDelete(db.doc(`businesses/${id}`));
    await db.doc(`users/${previous.data().uid}`).delete();
    await admin.deleteUser(previous.data().uid);
  }
  await db.doc('vatRates/2026').set({ year: 2026, rates: [0, 5, 10, 16, 20] });
  const email = `deniz.${Date.now()}@sedircizgi.example`;
  const password = 'Sedir-yerel-gorseller-2026';
  const user = await admin.createUser({ email, password, emailVerified: true, displayName: 'Deniz Kaya' });
  await admin.setCustomUserClaims(user.uid, { platformAdmin: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 1180 },
    locale: 'tr-TR',
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  page.setDefaultTimeout(30000);
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    const notice = page.locator('[data-action="accept-notice"]');
    if (await notice.isVisible()) await notice.click();
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(password);
    await page.locator('#auth-submit').click();
    await page.locator('#setup-view').waitFor({ state: 'visible' });
    const fixture = await page.evaluate(async () => {
      const api = await import('./js/api.js');
      const { businessProfile } = await import('./js/model.js');
      const { newInvoice, today, addDays } = await import('./js/state.js');
      const profile = businessProfile({
        name: 'Sedir Çizgi',
        legalName: 'Sedir Çizgi Tasarım Atölyesi',
        address: 'Sedir Sokak No: 12, Girne',
        phone: '+90 533 000 12 34',
        email: 'merhaba@sedircizgi.example',
        taxOffice: 'Girne',
        taxNumber: '10428763',
        defaultCurrency: 'TRY',
        showAmountWords: true
      });
      const primary = await api.call('createBusiness', { business: profile, requestId: crypto.randomUUID() });
      const secondary = await api.call('createBusiness', {
        business: businessProfile({
          ...profile,
          name: 'Ada İzgi Yayın',
          legalName: 'Ada İzgi Yayın Atölyesi',
          address: 'Defne Sokak No: 8, Gazimağusa',
          taxOffice: 'Gazimağusa',
          taxNumber: '20846319',
          email: 'merhaba@adaizgi.example'
        }),
        requestId: crypto.randomUUID()
      });
      const clients = [
        ['Limon Dalı Mutfak', 'Zeytin Sokak No: 6, Girne', 'Girne'],
        ['Duru İz Eğitim Atölyesi', 'Menekşe Sokak No: 14, Lefkoşa', 'Lefkoşa'],
        ['Kıyı Rota Konaklama', 'Portakal Sokak No: 3, Gazimağusa', 'Gazimağusa'],
        ['Yelken Yaprak Kitabevi', 'Çınar Sokak No: 9, Lefkoşa', 'Lefkoşa']
      ].map(([name, address, taxOffice], index) => ({
        name,
        address,
        taxOffice,
        taxNumber: String(30285710 + index),
        email: `muhasebe${index + 1}@alici.example`,
        phone: '',
        note: ''
      }));
      for (const client of clients) client.id = await api.saveClient(primary.businessId, client);
      const items = [
        { desc: 'Kurumsal kimlik tasarımı', qty: 1000, unitPrice: 950000, vatRate: 16 },
        { desc: 'Menü ve baskı tasarımı', qty: 2000, unitPrice: 125000, vatRate: 10 },
        { desc: 'Ekip tasarım atölyesi', qty: 4000, unitPrice: 65000, vatRate: 5 }
      ];
      const specifications = [
        { template: 'classic', client: 0, age: 18, paid: true },
        { template: 'plain', client: 1, age: 12 },
        { template: 'stripe', client: 2, age: 9, overdue: true },
        { template: 'classic', client: 3, age: 7, cancelled: true },
        { template: 'plain', client: 1, age: 5, proforma: true },
        { template: 'classic', client: 2, age: 2, currency: 'GBP', paid: true },
        { template: 'stripe', client: 0, age: 0, draft: true }
      ];
      const ids = [];
      for (const spec of specifications) {
        const invoice = newInvoice(spec.proforma ? 'proforma' : 'invoice');
        Object.assign(invoice, {
          client: clients[spec.client],
          template: spec.template,
          issueDate: addDays(today(), -spec.age),
          dueDate: addDays(today(), spec.overdue ? -2 : 14),
          currency: spec.currency || 'TRY',
          exchangeRate: spec.currency ? 56000000 : null,
          discount: { type: 'percent', value: spec.currency ? 0 : 500 },
          note: spec.cancelled ? 'Alıcı talebiyle proje kapsamı değiştirilmiştir.' : '',
          items: (spec.currency
            ? [{ desc: 'Dijital tasarım danışmanlığı', qty: 1000, unitPrice: 45000, vatRate: 16 }]
            : items
          ).map((item) => ({ ...item, id: crypto.randomUUID(), exemption: '' }))
        });
        invoice.bankInfo.paymentTerms = '';
        const saved = await api.saveDraft(primary.businessId, invoice, profile);
        let invoiceId = saved.id;
        if (!spec.draft) {
          const issued = await api.call('issueInvoice', { businessId: primary.businessId, invoiceId });
          invoiceId = issued.invoiceId;
          if (spec.paid) await api.call('markInvoicePaid', { businessId: primary.businessId, invoiceId });
          if (spec.cancelled)
            await api.call('cancelInvoice', {
              businessId: primary.businessId,
              invoiceId,
              reason: 'Alıcının talebiyle proje kapsamı değişti.'
            });
        }
        ids.push(invoiceId);
      }
      return { businessId: primary.businessId, businessIds: [primary.businessId, secondary.businessId], ids };
    });
    await db.doc('screenshotFixtures/current').set({ uid: user.uid, businessIds: fixture.businessIds });

    async function openInvoice(id) {
      await page.goto(`${origin}/?business=${fixture.businessId}&invoice=${id}`, {
        waitUntil: 'domcontentloaded'
      });
      await page.locator('#invoice-preview .invoice-paper').first().waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-field="client.name"]')?.value === 'Limon Dalı Mutfak' ||
          document.querySelector('#document-number')?.textContent.startsWith('A-')
      );
      await page.evaluate(() => document.fonts.ready);
      const notice = page.locator('[data-action="accept-notice"]');
      if (await notice.isVisible()) await notice.click();
      await page.locator('.nav-link[data-action="history"]').click();
      await page.locator('.history-table tbody tr').nth(6).waitFor();
      await page.locator('.nav-link[data-action="monthly"]').click();
      await page.locator('.monthly-group').nth(1).waitFor();
      await page.locator('.nav-link[data-action="editor"]').click();
      await page.evaluate(() => scrollTo(0, 0));
    }

    await openInvoice(fixture.ids.at(-1));
    assert.equal(
      await page.evaluate(async () => {
        const { state } = await import('./js/state.js');
        const { calcTotals } = await import('./js/money.js');
        return calcTotals(state.invoice).total;
      }),
      1567500
    );
    await capture(page, 'fatura-olusturucu');
    await page.evaluate(() => {
      const section = [...document.querySelectorAll('.form-section')].find(
        (section) => section.querySelector('h2').textContent === 'Kalemler'
      );
      scrollTo(0, section.getBoundingClientRect().top + scrollY - 24);
    });
    await capture(page, 'kalemler-ve-canli-onizleme');
    await page.locator('[data-action="history"]').click();
    await page.locator('.history-table tbody tr').nth(6).waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await capture(page, 'fatura-gecmisi');
    await page.locator('[data-action="monthly"]').click();
    await page.locator('.monthly-group').nth(1).waitFor();
    await capture(page, 'aylik-kdv-ozeti', { fullPage: true });

    await openInvoice(fixture.ids.at(-1));
    await page.locator('#theme').selectOption('dark');
    await page.evaluate(() => scrollTo(0, 0));
    await capture(page, 'koyu-tema');
    await page.locator('#theme').selectOption('light');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-action="tab-preview"]').click();
    await page.evaluate(() => {
      const tabs = document.querySelector('.mobile-tabs');
      scrollTo(0, tabs.getBoundingClientRect().top + scrollY - 16);
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await capture(page, 'mobil-onizleme');
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1536, height: 1180 });

    for (const [index, template] of ['klasik', 'duz', 'serit'].entries()) {
      await openInvoice(fixture.ids[index]);
      await page.locator('#copies').selectOption('original');
      await page.locator('#invoice-preview .invoice-paper').screenshot({
        path: resolve(directory, `sablon-${template}.png`),
        animations: 'disabled'
      });
      process.stdout.write(`sablon-${template}.png\n`);
    }
    const panel = await context.newPage();
    await panel.goto(`${origin}/admin.html`, { waitUntil: 'networkidle' });
    await panel.locator('.admin-business').nth(1).waitFor();
    await capture(panel, 'yonetim-paneli');
    await panel.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
