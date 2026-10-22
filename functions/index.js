import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldPath } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { error as logError } from 'firebase-functions/logger';
import { randomBytes, createHash } from 'node:crypto';
import { calcTotals } from './lib/totals.js';
import {
  fail,
  object,
  text,
  id,
  integer,
  email,
  oneOf,
  prefix,
  businessInput,
  draftInput,
  clientSnapshot,
  date,
  roles
} from './lib/validate.js';

if (!getApps().length) initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });
// Emülatör gerçek cihaz doğrulaması yapamaz; bu ortam değişkenini üretimde tanımlamayın.
const callable = (handler) =>
  onCall({ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true' }, async (request) => {
    if (!request.auth) fail('Önce giriş yapın.', 'unauthenticated');
    if (request.auth.token.email_verified !== true)
      fail('Önce e-posta adresinizi doğrulayın.', 'permission-denied');
    object(request.data);
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof RangeError) fail(error.message);
      if (error.code === 6) fail('Bu kayıt veya numara zaten kullanılıyor.', 'already-exists');
      if (error.code === 10) fail('Eşzamanlı bir değişiklik oldu. Aynı işlemi yeniden deneyin.', 'aborted');
      logError('İşlem beklenmeyen bir hatayla durdu.', { code: error.code || '', cause: error.message });
      throw new HttpsError('internal', 'İşlem tamamlanamadı. Formunuzu koruyup yeniden deneyin.');
    }
  });

function admin(request) {
  if (request.auth.token.platformAdmin !== true)
    fail('Platform yöneticisi yetkisi gerekiyor.', 'permission-denied');
}
async function access(request, tx, allowed = roles, subscription = true) {
  const bid = id(request.data.businessId, 'İşletme');
  const ref = db.doc(`businesses/${bid}`);
  const [business, member, plan] = await tx.getAll(
    ref,
    ref.collection('members').doc(request.auth.uid),
    ref.collection('subscription').doc('current')
  );
  if (!business.exists || !member.exists || !allowed.includes(member.data().role))
    fail('Bu işletmede işlem yetkiniz yok.', 'permission-denied');
  if (
    subscription &&
    (!plan.exists || plan.data().status !== 'active' || plan.data().currentPeriodEnd.toMillis() <= Date.now())
  )
    fail('Abonelik aktif değil. Belgelerinizi görüntüleyebilir ve indirebilirsiniz.', 'failed-precondition');
  return { bid, ref, business: business.data(), member: member.data(), subscription: plan.data() };
}
function audit(tx, ctx, request, action, entity, entityId, detail = {}) {
  tx.create(ctx.ref.collection('auditLog').doc(), {
    userId: request.auth.uid,
    action,
    entity,
    entityId,
    detail,
    createdAt: Timestamp.now()
  });
}
async function ratesFor(tx, ctx, issueDate) {
  date(issueDate, 'Düzenleme tarihi');
  const year = Number(issueDate.slice(0, 4));
  const [global, local] = await Promise.all([
    tx.get(db.collection('vatRates').where('year', '<=', year).orderBy('year', 'desc').limit(1)),
    tx.get(ctx.ref.collection('vatRates').where('year', '<=', year).orderBy('year', 'desc').limit(101))
  ]);
  const globalYear = global.empty ? 0 : Number(global.docs[0].id);
  const rates = new Set(global.empty ? [] : global.docs[0].data().rates);
  const localYear = local.empty ? 0 : local.docs[0].data().year;
  if (localYear >= globalYear)
    for (const doc of local.docs) {
      const item = doc.data();
      if (item.year === localYear) {
        if (item.enabled === false) rates.delete(item.rate);
        else rates.add(item.rate);
      }
    }
  if (!rates.size)
    fail(
      'Bu tarih için KDV tablosu tanımlı değil. Oranları işletme ayarlarından ekleyin.',
      'failed-precondition'
    );
  return [...rates];
}
function sellerSnapshot(business) {
  return {
    name: business.legalName,
    address: business.address,
    phone: business.phone,
    email: business.email,
    taxOffice: business.taxOffice,
    taxNumber: business.taxNumber,
    logoPath: business.logoPath,
    bankName: business.bankName,
    bankBranch: business.bankBranch || '',
    bankIban: business.bankIban,
    bankHolder: business.bankHolder
  };
}
function summaryKey(invoice) {
  return `${invoice.issueDate.slice(0, 7)}-${invoice.currency}`;
}
function adjustSummary(current, invoice, sign) {
  const result = current
    ? structuredClone(current)
    : {
        month: invoice.issueDate.slice(0, 7),
        currency: invoice.currency,
        count: 0,
        baseCents: 0,
        vatCents: 0,
        totalCents: 0,
        paidCents: 0,
        vatBreakdown: []
      };
  const add = (a, b) => {
    const value = a + sign * b;
    if (!Number.isSafeInteger(value) || value < 0) fail('Aylık özet sınırı aşılıyor.', 'failed-precondition');
    return value;
  };
  result.count = add(result.count, 1);
  result.baseCents = add(result.baseCents, invoice.totalCents - invoice.vatCents);
  result.vatCents = add(result.vatCents, invoice.vatCents);
  result.totalCents = add(result.totalCents, invoice.totalCents);
  if (invoice.status === 'paid') result.paidCents = add(result.paidCents, invoice.totalCents);
  for (const vat of invoice.vatBreakdown) {
    let group = result.vatBreakdown.find((item) => item.rate === vat.rate);
    if (!group) {
      group = { rate: vat.rate, baseCents: 0, vatCents: 0 };
      result.vatBreakdown.push(group);
    }
    group.baseCents = add(group.baseCents, vat.baseCents);
    group.vatCents = add(group.vatCents, vat.vatCents);
  }
  result.vatBreakdown.sort((a, b) => a.rate - b.rate);
  return result;
}

export const createBusiness = callable(async (request) => {
  const input = businessInput(request.data.business);
  const requestId = id(request.data.requestId, 'İstek');
  const operationRef = db.doc(`businessCreations/${request.auth.uid}_${requestId}`);
  const ref = db.collection('businesses').doc();
  return db.runTransaction(async (tx) => {
    const operation = await tx.get(operationRef);
    if (operation.exists) return { businessId: operation.data().businessId };
    const now = Timestamp.now();
    tx.create(ref, {
      ...input,
      createdBy: request.auth.uid,
      createdAt: now,
      invoiceCount: 0,
      memberCount: 1
    });
    tx.create(ref.collection('members').doc(request.auth.uid), {
      uid: request.auth.uid,
      businessId: ref.id,
      role: 'owner',
      email: email(request.auth.token.email),
      addedAt: now
    });
    tx.create(ref.collection('series').doc('invoice-A'), { kind: 'invoice', prefix: 'A', nextNumber: 1 });
    tx.create(ref.collection('series').doc('proforma-P'), { kind: 'proforma', prefix: 'P', nextNumber: 1 });
    tx.create(ref.collection('subscription').doc('current'), {
      plan: 'trial',
      status: 'active',
      currentPeriodEnd: Timestamp.fromMillis(now.toMillis() + 14 * 86400000),
      note: ''
    });
    tx.create(operationRef, { businessId: ref.id, createdAt: now });
    audit(tx, { ref }, request, 'business.created', 'business', ref.id);
    return { businessId: ref.id };
  });
});

export const createSeries = callable(async (request) =>
  db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner']);
    const kind = oneOf(request.data.kind, ['invoice', 'proforma'], 'Belge türü');
    const value = prefix(request.data.prefix);
    const ref = ctx.ref.collection('series').doc(`${kind}-${value}`);
    const existing = await tx.get(ref);
    if (existing.exists) fail('Bu seri zaten var.', 'already-exists');
    tx.create(ref, { kind, prefix: value, nextNumber: 1 });
    audit(tx, ctx, request, 'series.created', 'series', ref.id);
    return { id: ref.id };
  })
);

export const issueInvoice = callable(async (request) =>
  db.runTransaction(async (tx) => {
    const ctx = await access(request, tx);
    const draftId = id(request.data.invoiceId, 'Taslak');
    const operationRef = ctx.ref.collection('operations').doc(`issue-${draftId}`);
    const operation = await tx.get(operationRef);
    if (operation.exists) return { invoiceId: operation.data().invoiceId };
    const draftRef = ctx.ref.collection('invoices').doc(draftId);
    const snapshot = await tx.get(draftRef);
    if (!snapshot.exists) fail('Taslak bulunamadı.', 'not-found');
    const raw = snapshot.data();
    if (raw.status !== 'draft' || raw.number !== null)
      fail('Yalnızca taslak düzenlenebilir.', 'failed-precondition');
    const input = draftInput(raw, await ratesFor(tx, ctx, raw.issueDate));
    const totals = calcTotals(input);
    const seriesRef = ctx.ref.collection('series').doc(`${input.kind}-${input.seriesPrefix}`);
    const clientRef = ctx.ref.collection('clients').doc(input.clientId);
    const [series, client] = await tx.getAll(seriesRef, clientRef);
    if (!series.exists || series.data().kind !== input.kind || series.data().prefix !== input.seriesPrefix)
      fail('Seçilen seri tanımlı değil.', 'failed-precondition');
    if (!client.exists) fail('Alıcı bulunamadı.', 'not-found');
    const number = integer(series.data().nextNumber, 'Sıra numarası', 1, 999999999);
    const invoiceId = `${input.kind}-${input.seriesPrefix}-${String(number).padStart(6, '0')}`;
    const invoiceRef = ctx.ref.collection('invoices').doc(invoiceId);
    const summaryRef = ctx.ref.collection('monthlySummaries').doc(summaryKey(input));
    const [existing, summary] = await tx.getAll(invoiceRef, summaryRef);
    if (existing.exists) fail('Bu seri-sıra numarası zaten kullanılıyor.', 'already-exists');
    const now = Timestamp.now();
    const invoice = {
      ...input,
      ...totals,
      status: 'issued',
      number,
      sellerSnapshot: sellerSnapshot(ctx.business),
      clientSnapshot: clientSnapshot(client.data()),
      clientNameLower: client.data().name.toLocaleLowerCase('tr-TR'),
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      updatedAt: now,
      issuedAt: now,
      paidAt: null,
      cancelledAt: null,
      cancelReason: '',
      source: 'native',
      legacyNumber: ''
    };
    tx.create(invoiceRef, invoice);
    tx.update(seriesRef, { nextNumber: number + 1 });
    tx.update(ctx.ref, { invoiceCount: ctx.business.invoiceCount + 1 });
    if (input.kind === 'invoice') tx.set(summaryRef, adjustSummary(summary.data(), invoice, 1));
    tx.delete(draftRef);
    tx.create(operationRef, { invoiceId, createdAt: now });
    audit(tx, ctx, request, 'invoice.issued', 'invoice', invoiceId, { number, kind: input.kind });
    return { invoiceId };
  })
);

export const markInvoicePaid = callable(async (request) =>
  db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner', 'accountant']);
    const invoiceId = id(request.data.invoiceId, 'Fatura');
    const ref = ctx.ref.collection('invoices').doc(invoiceId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail('Fatura bulunamadı.', 'not-found');
    const invoice = snapshot.data();
    if (invoice.status === 'paid') return { invoiceId };
    if (invoice.status !== 'issued')
      fail('Yalnızca düzenlenmiş belge ödendi işaretlenebilir.', 'failed-precondition');
    const summaryRef = ctx.ref.collection('monthlySummaries').doc(summaryKey(invoice));
    const summary = await tx.get(summaryRef);
    if (invoice.kind === 'invoice') {
      const paidCents = (summary.data()?.paidCents || 0) + invoice.totalCents;
      integer(paidCents, 'Tahsilat toplamı');
      tx.update(summaryRef, { paidCents });
    }
    tx.update(ref, { status: 'paid', paidAt: Timestamp.now(), updatedAt: Timestamp.now() });
    audit(tx, ctx, request, 'invoice.paid', 'invoice', invoiceId);
    return { invoiceId };
  })
);

export const cancelInvoice = callable(async (request) =>
  db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner', 'accountant']);
    const invoiceId = id(request.data.invoiceId, 'Fatura');
    const reason = text(request.data.reason, 'İptal nedeni', 1000);
    if (reason.length < 5) fail('İptal nedeni en az 5 karakter olmalı.');
    const ref = ctx.ref.collection('invoices').doc(invoiceId);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail('Fatura bulunamadı.', 'not-found');
    const invoice = snapshot.data();
    if (invoice.status === 'cancelled') return { invoiceId };
    if (!['issued', 'paid'].includes(invoice.status))
      fail('Taslak iptal edilemez; taslağı silebilirsiniz.', 'failed-precondition');
    const summaryRef = ctx.ref.collection('monthlySummaries').doc(summaryKey(invoice));
    const summary = await tx.get(summaryRef);
    if (invoice.kind === 'invoice') tx.set(summaryRef, adjustSummary(summary.data(), invoice, -1));
    tx.update(ref, {
      status: 'cancelled',
      cancelledAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      cancelReason: reason
    });
    audit(tx, ctx, request, 'invoice.cancelled', 'invoice', invoiceId, { reason });
    return { invoiceId };
  })
);

export const createInvite = callable(async (request) => {
  const token = randomBytes(32).toString('hex');
  return db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner']);
    const inviteEmail = email(request.data.email);
    const role = oneOf(request.data.role, roles, 'Rol');
    tx.create(db.doc(`invites/${token}`), {
      businessId: ctx.bid,
      email: inviteEmail,
      role,
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
      acceptedAt: null,
      createdBy: request.auth.uid
    });
    audit(tx, ctx, request, 'invite.created', 'invite', token, { email: inviteEmail, role });
    return { token };
  });
});

export const acceptInvite = callable(async (request) =>
  db.runTransaction(async (tx) => {
    const token = text(request.data.token, 'Davet', 64);
    if (!/^[a-f0-9]{64}$/.test(token)) fail('Davet bağlantısı geçersiz.');
    const ref = db.doc(`invites/${token}`);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) fail('Davet bulunamadı.', 'not-found');
    const invite = snapshot.data();
    if (invite.acceptedAt || invite.expiresAt.toMillis() <= Date.now())
      fail('Davet kullanılmış veya süresi dolmuş.', 'failed-precondition');
    if (email(request.auth.token.email) !== invite.email)
      fail('Bu davet başka bir e-posta adresine ait.', 'permission-denied');
    const businessRef = db.doc(`businesses/${invite.businessId}`);
    const [business, member, subscription] = await tx.getAll(
      businessRef,
      businessRef.collection('members').doc(request.auth.uid),
      businessRef.collection('subscription').doc('current')
    );
    if (!business.exists) fail('İşletme bulunamadı.', 'not-found');
    if (member.exists) fail('Bu işletmenin zaten üyesisiniz.', 'already-exists');
    if (
      subscription.data()?.status !== 'active' ||
      subscription.data().currentPeriodEnd.toMillis() <= Date.now()
    )
      fail('İşletmenin aboneliği aktif değil.', 'failed-precondition');
    tx.create(businessRef.collection('members').doc(request.auth.uid), {
      uid: request.auth.uid,
      businessId: businessRef.id,
      role: invite.role,
      email: invite.email,
      addedAt: Timestamp.now()
    });
    tx.update(ref, { acceptedAt: Timestamp.now() });
    tx.update(businessRef, { memberCount: business.data().memberCount + 1 });
    audit(tx, { ref: businessRef }, request, 'invite.accepted', 'member', request.auth.uid, {
      role: invite.role
    });
    return { businessId: businessRef.id };
  })
);

async function changeMember(request, remove) {
  return db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner']);
    const uid = id(request.data.uid, 'Üye');
    const ref = ctx.ref.collection('members').doc(uid);
    const [member, owners] = await Promise.all([
      tx.get(ref),
      tx.get(ctx.ref.collection('members').where('role', '==', 'owner').limit(2))
    ]);
    if (!member.exists) fail('Üye bulunamadı.', 'not-found');
    const role = remove ? null : oneOf(request.data.role, roles, 'Rol');
    if (member.data().role === 'owner' && role !== 'owner' && owners.size < 2)
      fail('İşletmenin son owner üyesi kaldırılamaz.', 'failed-precondition');
    if (remove) {
      tx.delete(ref);
      tx.update(ctx.ref, { memberCount: ctx.business.memberCount - 1 });
    } else tx.update(ref, { role });
    audit(tx, ctx, request, remove ? 'member.removed' : 'member.roleChanged', 'member', uid, { role });
    return { uid };
  });
}
export const setMemberRole = callable((request) => changeMember(request, false));
export const removeMember = callable((request) => changeMember(request, true));

export const adminListBusinesses = callable(async (request) => {
  admin(request);
  const size = integer(request.data.limit ?? 50, 'Sayfa boyutu', 1, 50);
  let query = db
    .collection('businesses')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
    .limit(size);
  if (request.data.after) {
    object(request.data.after);
    const seconds = integer(request.data.after.seconds, 'İmleç zamanı');
    const nanoseconds = integer(request.data.after.nanoseconds, 'İmleç zamanı', 0, 999999999);
    query = query.startAfter(new Timestamp(seconds, nanoseconds), id(request.data.after.id));
  }
  const snapshot = await query.get();
  const plans = snapshot.empty
    ? []
    : await db.getAll(...snapshot.docs.map((doc) => doc.ref.collection('subscription').doc('current')));
  return {
    businesses: snapshot.docs.map((doc, index) => ({
      id: doc.id,
      name: doc.data().name,
      createdAt: doc.data().createdAt.toDate().toISOString(),
      memberCount: doc.data().memberCount,
      invoiceCount: doc.data().invoiceCount,
      subscription: plans[index].exists
        ? {
            plan: plans[index].data().plan,
            status:
              plans[index].data().status === 'active' &&
              plans[index].data().currentPeriodEnd.toMillis() <= Date.now()
                ? 'expired'
                : plans[index].data().status,
            currentPeriodEnd: plans[index].data().currentPeriodEnd.toDate().toISOString()
          }
        : null
    })),
    next:
      snapshot.size === size
        ? {
            id: snapshot.docs.at(-1).id,
            seconds: snapshot.docs.at(-1).data().createdAt.seconds,
            nanoseconds: snapshot.docs.at(-1).data().createdAt.nanoseconds
          }
        : null
  };
});

async function adminSubscription(request, action) {
  admin(request);
  const bid = id(request.data.businessId, 'İşletme');
  const ref = db.doc(`businesses/${bid}`);
  return db.runTransaction(async (tx) => {
    const [business, current] = await tx.getAll(ref, ref.collection('subscription').doc('current'));
    if (!business.exists || !current.exists) fail('İşletme veya abonelik bulunamadı.', 'not-found');
    const note = text(request.data.note || '', 'Not', 1000, false);
    const plan = current.data();
    if (action === 'extend') {
      plan.plan = oneOf(request.data.plan, ['trial', 'monthly', 'yearly'], 'Plan');
      const days = integer(request.data.days, 'Gün', 1, 3660);
      plan.currentPeriodEnd = Timestamp.fromMillis(
        Math.max(Date.now(), plan.currentPeriodEnd.toMillis()) + days * 86400000
      );
      plan.status = 'active';
    } else if (action === 'suspend') plan.status = 'suspended';
    else {
      if (plan.currentPeriodEnd.toMillis() <= Date.now())
        fail('Önce abonelik süresini uzatın.', 'failed-precondition');
      plan.status = 'active';
    }
    plan.note = note;
    tx.set(ref.collection('subscription').doc('current'), plan);
    audit(tx, { ref }, request, `subscription.${action}`, 'subscription', 'current', {
      plan: plan.plan,
      note,
      currentPeriodEnd: plan.currentPeriodEnd.toDate().toISOString()
    });
    return { businessId: bid };
  });
}
export const adminExtendSubscription = callable((request) => adminSubscription(request, 'extend'));
export const adminSuspend = callable((request) => adminSubscription(request, 'suspend'));
export const adminReactivate = callable((request) => adminSubscription(request, 'reactivate'));

export const importLegacyInvoices = callable(async (request) => {
  if (
    !Array.isArray(request.data.invoices) ||
    !request.data.invoices.length ||
    request.data.invoices.length > 10 ||
    JSON.stringify(request.data.invoices).length > 2000000
  )
    fail('Her aktarım isteği en fazla 10 belge ve 2 MB olabilir.');
  const requestId = id(request.data.requestId, 'Aktarım isteği');
  return db.runTransaction(async (tx) => {
    const ctx = await access(request, tx, ['owner']);
    const operationRef = ctx.ref.collection('operations').doc(`import-${requestId}`);
    const operation = await tx.get(operationRef);
    if (operation.exists) return { invoiceIds: operation.data().invoiceIds };
    const prepared = [];
    for (const raw of request.data.invoices) {
      object(raw);
      const input = draftInput(raw, await ratesFor(tx, ctx, raw.issueDate));
      const status = oneOf(raw.status, ['issued', 'paid', 'cancelled'], 'Eski durum');
      const number = integer(raw.number, 'Eski sıra numarası', 1, 999999999);
      const invoiceId = `${input.kind}-${input.seriesPrefix}-${String(number).padStart(6, '0')}`;
      const totals = calcTotals(input);
      if (raw.totalCents !== undefined && raw.totalCents !== totals.totalCents)
        fail(
          `${invoiceId}: eski toplam ile yeniden hesaplanan toplam farklı. Aktarım durdu.`,
          'failed-precondition'
        );
      const client = clientSnapshot(raw.clientSnapshot);
      const seller = clientSnapshot(raw.sellerSnapshot);
      text(seller.taxOffice, 'Eski satıcı vergi dairesi');
      text(seller.taxNumber, 'Eski satıcı vergi numarası', 40);
      const clientId = `legacy-${createHash('sha256').update(JSON.stringify(client)).digest('hex').slice(0, 24)}`;
      const clientRef = ctx.ref.collection('clients').doc(clientId);
      const invoice = {
        ...input,
        ...totals,
        status,
        number,
        clientId,
        clientNameLower: client.name.toLocaleLowerCase('tr-TR'),
        sellerSnapshot: {
          ...seller,
          logoPath: '',
          bankName: '',
          bankBranch: '',
          bankIban: '',
          bankHolder: ''
        },
        clientSnapshot: client,
        createdBy: request.auth.uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        issuedAt: Timestamp.now(),
        paidAt: status === 'paid' ? Timestamp.now() : null,
        cancelledAt: status === 'cancelled' ? Timestamp.now() : null,
        cancelReason:
          status === 'cancelled'
            ? text(raw.cancelReason || 'Önceki uygulamada iptal edilmiş belge', 'İptal nedeni', 1000)
            : '',
        source: 'legacy',
        legacyNumber: text(raw.legacyNumber || String(number), 'Eski numara', 100)
      };
      prepared.push({ invoice, invoiceId, client, clientRef });
    }
    const ids = prepared.map((item) => item.invoiceId);
    if (new Set(ids).size !== ids.length) fail('Aktarımda aynı seri-sıra iki kez kullanılıyor.');
    const refs = new Map();
    for (const item of prepared)
      for (const ref of [
        ctx.ref.collection('invoices').doc(item.invoiceId),
        ctx.ref.collection('series').doc(`${item.invoice.kind}-${item.invoice.seriesPrefix}`),
        ctx.ref.collection('monthlySummaries').doc(summaryKey(item.invoice)),
        item.clientRef
      ])
        refs.set(ref.path, ref);
    const snapshots = await tx.getAll(...refs.values());
    const existing = new Map(snapshots.map((doc) => [doc.ref.path, doc]));
    const series = new Map();
    const summaries = new Map();
    const clients = new Map();
    for (const item of prepared) {
      const invoiceRef = ctx.ref.collection('invoices').doc(item.invoiceId);
      if (existing.get(invoiceRef.path).exists)
        fail(`${item.invoiceId} zaten var. Hiçbir belge değiştirilmedi.`, 'already-exists');
      const seriesRef = ctx.ref.collection('series').doc(`${item.invoice.kind}-${item.invoice.seriesPrefix}`);
      const prior = series.get(seriesRef.path)?.data ||
        existing.get(seriesRef.path).data() || {
          kind: item.invoice.kind,
          prefix: item.invoice.seriesPrefix,
          nextNumber: 1
        };
      series.set(seriesRef.path, {
        ref: seriesRef,
        data: { ...prior, nextNumber: Math.max(prior.nextNumber, item.invoice.number + 1) }
      });
      if (!existing.get(item.clientRef.path).exists) clients.set(item.clientRef.path, item);
      if (item.invoice.status !== 'cancelled' && item.invoice.kind === 'invoice') {
        const ref = ctx.ref.collection('monthlySummaries').doc(summaryKey(item.invoice));
        const current = summaries.get(ref.path)?.data || existing.get(ref.path).data();
        summaries.set(ref.path, { ref, data: adjustSummary(current, item.invoice, 1) });
      }
    }
    for (const item of prepared) tx.create(ctx.ref.collection('invoices').doc(item.invoiceId), item.invoice);
    for (const item of series.values()) tx.set(item.ref, item.data);
    for (const item of summaries.values()) tx.set(item.ref, item.data);
    for (const item of clients.values())
      tx.create(item.clientRef, {
        ...item.client,
        nameLower: item.client.name.toLocaleLowerCase('tr-TR'),
        note: '',
        createdAt: Timestamp.now()
      });
    tx.update(ctx.ref, { invoiceCount: ctx.business.invoiceCount + prepared.length });
    tx.create(operationRef, { invoiceIds: ids, createdAt: Timestamp.now() });
    audit(tx, ctx, request, 'legacy.imported', 'invoice', requestId, { count: prepared.length });
    return { invoiceIds: ids };
  });
});
