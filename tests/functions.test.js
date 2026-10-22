import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { business, client, draft } from './fixtures.js';
process.env.GCLOUD_PROJECT = 'demo-defter';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
let functions;
let db;
let bid;
const owner = { uid: 'fn-owner', token: { email: 'owner@example.com', email_verified: true } };
const request = (data, actor = owner) => ({ data, auth: actor });
const run = (name, data, actor = owner) => functions[name].run(request(data, actor));
const createDraft = async (name = 'draft', changes = {}) => {
  await db
    .doc(`businesses/${bid}/invoices/${name}`)
    .set({ ...draft(owner.uid), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...changes });
  return name;
};
before(async () => {
  functions = await import('../functions/index.js');
  db = getFirestore();
  await db.doc('vatRates/2026').set({ year: 2026, rates: [0, 5, 10, 16, 20] });
});
beforeEach(async () => {
  bid = (await run('createBusiness', { business: business(), requestId: crypto.randomUUID() })).businessId;
  await db.doc(`businesses/${bid}/clients/client`).set({ ...client(), createdAt: Timestamp.now() });
});
test('işletme kurulumu tek seferliktir ve trial, üyelik, seriler oluşturulur', async () => {
  const key = crypto.randomUUID();
  const first = await run('createBusiness', { business: business(), requestId: key });
  const second = await run('createBusiness', { business: business(), requestId: key });
  assert.equal(first.businessId, second.businessId);
  const plan = (await db.doc(`businesses/${first.businessId}/subscription/current`).get()).data();
  assert.equal(plan.plan, 'trial');
  assert.ok(plan.currentPeriodEnd.toMillis() > Date.now() + 13 * 86400000);
});
test('istemci toplamı ve snapshot iddiası düzenlemede yok sayılır', async () => {
  const id = await createDraft('draft', {
    totalCents: 1,
    sellerSnapshot: { name: 'sahte' },
    clientSnapshot: { name: 'sahte' }
  });
  const result = await run('issueInvoice', { businessId: bid, invoiceId: id });
  const invoice = (await db.doc(`businesses/${bid}/invoices/${result.invoiceId}`).get()).data();
  assert.equal(result.invoiceId, 'invoice-A-000001');
  assert.equal(invoice.totalCents, 11600);
  assert.equal(invoice.sellerSnapshot.name, business().legalName);
  assert.equal(invoice.clientSnapshot.name, client().name);
  assert.equal((await db.doc(`businesses/${bid}/invoices/${id}`).get()).exists, false);
});
test('aynı isteğin tekrarı ikinci numara tüketmez', async () => {
  await createDraft();
  const first = await run('issueInvoice', { businessId: bid, invoiceId: 'draft' });
  const second = await run('issueInvoice', { businessId: bid, invoiceId: 'draft' });
  assert.deepEqual(first, second);
  assert.equal((await db.doc(`businesses/${bid}/series/invoice-A`).get()).data().nextNumber, 2);
});
test('eşzamanlı iki belge benzersiz ve ardışık numara alır', async () => {
  await createDraft('one');
  await createDraft('two');
  const results = await Promise.all(
    ['one', 'two'].map((invoiceId) => run('issueInvoice', { businessId: bid, invoiceId }))
  );
  assert.deepEqual(results.map((r) => r.invoiceId).sort(), ['invoice-A-000001', 'invoice-A-000002']);
  assert.equal((await db.doc(`businesses/${bid}/series/invoice-A`).get()).data().nextNumber, 3);
});
test('tanımsız oran, negatif miktar ve gelecek tarih numara harcamaz', async () => {
  for (const changes of [
    { items: [{ ...draft().items[0], vatRate: 99 }] },
    { items: [{ ...draft().items[0], quantity: -1 }] },
    { issueDate: '2999-01-01', dueDate: '2999-01-02' },
    { dueDate: '2025-01-01' }
  ]) {
    await createDraft('bad', changes);
    await assert.rejects(
      run('issueInvoice', { businessId: bid, invoiceId: 'bad' }),
      (e) => e.code === 'invalid-argument'
    );
  }
  assert.equal((await db.doc(`businesses/${bid}/series/invoice-A`).get()).data().nextNumber, 1);
});
test('tarihsel KDV tablosu ve yüzde sıfır açıklaması doğrulanır', async () => {
  await createDraft('zero', { items: [{ ...draft().items[0], vatRate: 0 }] });
  await assert.rejects(
    run('issueInvoice', { businessId: bid, invoiceId: 'zero' }),
    (e) => e.code === 'invalid-argument'
  );
  await db
    .doc(`businesses/${bid}/invoices/zero`)
    .update({ items: [{ ...draft().items[0], vatRate: 0, exemptionNote: 'Muafiyet açıklaması' }] });
  const r = await run('issueInvoice', { businessId: bid, invoiceId: 'zero' });
  assert.equal((await db.doc(`businesses/${bid}/invoices/${r.invoiceId}`).get()).data().vatCents, 0);
});
test('ödeme, iptal ve aylık toplamlar tutarlı; iptal numarası korunur', async () => {
  await createDraft();
  const r = await run('issueInvoice', { businessId: bid, invoiceId: 'draft' });
  await run('markInvoicePaid', { businessId: bid, invoiceId: r.invoiceId });
  await run('cancelInvoice', { businessId: bid, invoiceId: r.invoiceId, reason: 'Alıcı isteği ile iptal' });
  const i = (await db.doc(`businesses/${bid}/invoices/${r.invoiceId}`).get()).data();
  assert.equal(i.number, 1);
  assert.equal(i.status, 'cancelled');
  const summary = (await db.doc(`businesses/${bid}/monthlySummaries/2026-01-TRY`).get()).data();
  assert.equal(summary.totalCents, 0);
  assert.equal(summary.paidCents, 0);
  assert.equal(summary.count, 0);
  await assert.rejects(
    run('markInvoicePaid', { businessId: bid, invoiceId: r.invoiceId }),
    (e) => e.code === 'failed-precondition'
  );
});
test('işletme ve alıcı değişikliği eski snapshotları değiştirmez', async () => {
  await createDraft();
  const r = await run('issueInvoice', { businessId: bid, invoiceId: 'draft' });
  await db.doc(`businesses/${bid}`).update({ legalName: 'Yeni ad' });
  await db.doc(`businesses/${bid}/clients/client`).update({ name: 'Yeni alıcı' });
  const i = (await db.doc(`businesses/${bid}/invoices/${r.invoiceId}`).get()).data();
  assert.equal(i.sellerSnapshot.name, business().legalName);
  assert.equal(i.clientSnapshot.name, client().name);
});
test('başka işletme üyesi, doğrulanmamış hesap ve bitmiş abonelik reddedilir', async () => {
  await createDraft();
  for (const actor of [
    { uid: 'stranger', token: { email: 'x@example.com', email_verified: true } },
    { ...owner, token: { ...owner.token, email_verified: false } }
  ])
    await assert.rejects(
      run('issueInvoice', { businessId: bid, invoiceId: 'draft' }, actor),
      (e) => e.code === 'permission-denied'
    );
  await db
    .doc(`businesses/${bid}/subscription/current`)
    .update({ currentPeriodEnd: Timestamp.fromMillis(Date.now() - 1) });
  await assert.rejects(
    run('issueInvoice', { businessId: bid, invoiceId: 'draft' }),
    (e) => e.code === 'failed-precondition'
  );
});
test('davet yalnızca aynı doğrulanmış e-postaya aittir ve tek kullanımlıktır', async () => {
  const invite = await run('createInvite', { businessId: bid, email: 'Invite@Example.com', role: 'staff' });
  const actor = { uid: 'fn-invite', token: { email: 'invite@example.com', email_verified: true } };
  await assert.rejects(
    run('acceptInvite', { token: invite.token }, owner),
    (e) => e.code === 'permission-denied'
  );
  await run('acceptInvite', { token: invite.token }, actor);
  await assert.rejects(
    run('acceptInvite', { token: invite.token }, actor),
    (e) => e.code === 'failed-precondition'
  );
  assert.equal((await db.doc(`businesses/${bid}/members/fn-invite`).get()).data().role, 'staff');
});
test('son owner silinemez ve staff ödeme/iptal yetkisi alamaz', async () => {
  await assert.rejects(
    run('removeMember', { businessId: bid, uid: owner.uid }),
    (e) => e.code === 'failed-precondition'
  );
  await db.doc(`businesses/${bid}/members/staff`).set({ role: 'staff' });
  await assert.rejects(
    run(
      'markInvoicePaid',
      { businessId: bid, invoiceId: 'any' },
      { uid: 'staff', token: { email: 'staff@example.com', email_verified: true } }
    ),
    (e) => e.code === 'permission-denied'
  );
});
test('admin yetkisi, süre uzatma, askıya alma ve meta veri sınırı', async () => {
  const data = { businessId: bid, plan: 'monthly', days: 30, note: 'Havale alındı' };
  await assert.rejects(run('adminExtendSubscription', data), (e) => e.code === 'permission-denied');
  const actor = {
    uid: 'admin',
    token: { email: 'admin@example.com', email_verified: true, platformAdmin: true }
  };
  await run('adminExtendSubscription', data, actor);
  await run('adminSuspend', { businessId: bid, note: 'Kontrol' }, actor);
  assert.equal((await db.doc(`businesses/${bid}/subscription/current`).get()).data().status, 'suspended');
  await run('adminReactivate', { businessId: bid }, actor);
  const r = await run('adminListBusinesses', { limit: 50 }, actor);
  assert.ok(r.businesses.length <= 50);
  for (const b of r.businesses) {
    assert.equal('invoices' in b, false);
    assert.equal('taxNumber' in b, false);
  }
});
test('eski belge aktarımı numarayı korur, sayacı ilerletir ve çakışmada durur', async () => {
  const raw = {
    ...draft(),
    totalCents: 11600,
    status: 'issued',
    number: 123,
    sellerSnapshot: { ...client(), name: business().legalName },
    clientSnapshot: client(),
    legacyNumber: 'A-000123'
  };
  const data = { businessId: bid, requestId: 'legacy1', invoices: [raw] };
  const result = await run('importLegacyInvoices', data);
  assert.equal(result.invoiceIds[0], 'invoice-A-000123');
  assert.equal((await db.doc(`businesses/${bid}/series/invoice-A`).get()).data().nextNumber, 124);
  assert.deepEqual(await run('importLegacyInvoices', data), result);
  await assert.rejects(
    run('importLegacyInvoices', { ...data, requestId: 'legacy2' }),
    (e) => e.code === 'already-exists'
  );
});
