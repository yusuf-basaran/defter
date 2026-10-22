import { before, after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { business, client, draft } from './fixtures.js';

let env;
const db = (uid = 'owner', extra = {}) =>
  env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true, ...extra }).firestore();
const save = (store, bid = 'one', changes = {}) =>
  setDoc(doc(store, `businesses/${bid}/invoices/draft`), {
    ...draft(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...changes
  });
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-defter',
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') }
  });
});
after(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const store = ctx.firestore();
    for (const bid of ['one', 'two']) {
      await setDoc(doc(store, `businesses/${bid}`), {
        ...business(),
        createdBy: 'owner',
        createdAt: Timestamp.now(),
        invoiceCount: 1,
        memberCount: 3
      });
      for (const [uid, role] of [
        [bid === 'one' ? 'owner' : 'other', 'owner'],
        ['staff', 'staff'],
        ['accountant', 'accountant']
      ]) {
        if (bid === 'two' && uid !== 'other') continue;
        await setDoc(doc(store, `businesses/${bid}/members/${uid}`), {
          uid,
          businessId: bid,
          role,
          email: `${uid}@example.com`,
          addedAt: Timestamp.now()
        });
      }
      await setDoc(doc(store, `businesses/${bid}/subscription/current`), {
        plan: 'trial',
        status: 'active',
        currentPeriodEnd: Timestamp.fromMillis(Date.now() + 86400000),
        note: ''
      });
      await setDoc(doc(store, `businesses/${bid}/invoices/issued`), {
        ...draft(),
        status: 'issued',
        number: 1,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      await setDoc(doc(store, `businesses/${bid}/clients/client`), {
        ...client(),
        createdAt: Timestamp.now()
      });
    }
  });
});
test('başka işletmenin faturası okunamaz; admin claim de içerik erişimi vermez', async () => {
  await assertFails(getDoc(doc(db(), 'businesses/two/invoices/issued')));
  await assertFails(getDoc(doc(db('platform', { platformAdmin: true }), 'businesses/one/invoices/issued')));
  await assertFails(
    getDocs(query(collection(env.unauthenticatedContext().firestore(), 'businesses/one/invoices'), limit(50)))
  );
});
test('abonelik bitince yazma kapanır; belge ve dışa aktarım okuması açık kalır', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), 'businesses/one/subscription/current'), {
      currentPeriodEnd: Timestamp.fromMillis(Date.now() - 1000)
    })
  );
  await assertFails(save(db()));
  await assertFails(updateDoc(doc(db(), 'businesses/one/clients/client'), { name: 'Değişiklik' }));
  await assertSucceeds(getDoc(doc(db(), 'businesses/one/invoices/issued')));
  await assertSucceeds(getDocs(query(collection(db(), 'businesses/one/invoices'), limit(50))));
});
test('issued belgenin içeriği, durumu ve silinmesi istemciye kapalıdır', async () => {
  for (const change of [{ totalCents: 0 }, { status: 'paid' }, { note: 'değişti' }])
    await assertFails(updateDoc(doc(db(), 'businesses/one/invoices/issued'), change));
  await assertFails(deleteDoc(doc(db(), 'businesses/one/invoices/issued')));
});
test('staff işletme profilini değiştiremez; owner sayaçları değiştiremez', async () => {
  await assertFails(updateDoc(doc(db('staff'), 'businesses/one'), { name: 'Yeni ad' }));
  await assertFails(updateDoc(doc(db(), 'businesses/one'), { invoiceCount: 999 }));
  await assertFails(updateDoc(doc(db(), 'businesses/one'), { createdBy: 'staff' }));
  await assertSucceeds(updateDoc(doc(db(), 'businesses/one'), { name: 'Kurgusal Yeni Atölye' }));
});
test('geçerli taslak yazılır; durum, sahiplik, zaman ve şema atlatılamaz', async () => {
  await assertSucceeds(save(db()));
  await assertSucceeds(
    updateDoc(doc(db(), 'businesses/one/invoices/draft'), { note: 'Yeni not', updatedAt: serverTimestamp() })
  );
  for (const change of [
    { status: 'issued' },
    { number: 1 },
    { createdBy: 'staff' },
    { createdAt: Timestamp.fromMillis(1) },
    { extra: 'alan' },
    { note: 'x'.repeat(5001) },
    { items: Array(101).fill(draft().items[0]) }
  ])
    await assertFails(
      updateDoc(doc(db(), 'businesses/one/invoices/draft'), { ...change, updatedAt: serverTimestamp() })
    );
  await assertFails(save(db(), 'one', { createdBy: 'other' }));
  await assertSucceeds(deleteDoc(doc(db(), 'businesses/one/invoices/draft')));
});
test('müşteri güncellemesi tür, boyut, ek alan ve zaman kontrollerinden geçer', async () => {
  await assertSucceeds(
    updateDoc(doc(db('staff'), 'businesses/one/clients/client'), { note: 'Teslim adresi teyit edildi.' })
  );
  for (const change of [
    { name: 42 },
    { note: 'x'.repeat(2001) },
    { createdAt: Timestamp.fromMillis(1) },
    { role: 'owner' }
  ])
    await assertFails(updateDoc(doc(db(), 'businesses/one/clients/client'), change));
});
test('üyelik, davet, abonelik, sayaç ve audit yazma kapalıdır', async () => {
  for (const path of [
    'businesses/one/members/owner',
    'businesses/one/subscription/current',
    'businesses/one/series/invoice-A',
    'businesses/one/auditLog/fake',
    'businesses/one/monthlySummaries/2026-01-TRY',
    'businesses/one/operations/fake',
    'invites/token',
    'platformAdmins/owner'
  ])
    await assertFails(setDoc(doc(db(), path), { role: 'owner' }));
  await assertFails(getDoc(doc(db(), 'invites/token')));
});
test('üyelik collectionGroup sorgusu yalnızca kendi kayıtlarını bulur', async () => {
  const result = await assertSucceeds(
    getDocs(
      query(collectionGroup(db(), 'members'), where('uid', '==', 'owner'), orderBy('businessId'), limit(50))
    )
  );
  if (result.size !== 1) throw new Error('Yanlış üyelik sonucu.');
  await assertFails(getDocs(query(collectionGroup(db(), 'members'), limit(50))));
});
test('listeler 50 ile sınırlıdır, doğrulanmamış hesap üye verisine erişemez', async () => {
  await assertFails(getDocs(collection(db(), 'businesses/one/invoices')));
  await assertFails(getDocs(query(collection(db(), 'businesses/one/invoices'), limit(51))));
  await assertFails(getDoc(doc(db('owner', { email_verified: false }), 'businesses/one/invoices/issued')));
});
test('kullanıcı profiline admin alanı veya başka kullanıcı kimliği yazılamaz', async () => {
  const profile = { fullName: 'Deniz Kaya', phone: '', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db(), 'users/owner'), profile));
  await assertFails(updateDoc(doc(db(), 'users/owner'), { platformAdmin: true }));
  await assertFails(setDoc(doc(db(), 'users/other'), profile));
});
test('KDV oranını yalnızca owner; sistem tablosunu yalnızca claim sahibi yazar', async () => {
  const data = { year: 2026, rate: 17, label: '%17', enabled: true };
  await assertSucceeds(setDoc(doc(db(), 'businesses/one/vatRates/2026-17'), data));
  await assertFails(setDoc(doc(db('staff'), 'businesses/one/vatRates/2026-17'), data));
  await assertFails(setDoc(doc(db(), 'vatRates/2026'), { rates: [16] }));
  await assertSucceeds(
    setDoc(doc(db('platform', { platformAdmin: true }), 'vatRates/2026'), {
      year: 2026,
      rates: [0, 5, 10, 16, 20]
    })
  );
});
