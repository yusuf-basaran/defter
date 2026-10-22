import { db, functions, storage, auth } from './firebase.js';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import { calcTotals } from './totals.js';
import { fromInvoice, toDraft, businessProfile } from './model.js';

export async function call(name, data) {
  return (await httpsCallable(functions, name)(data)).data;
}
export async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const fullName = (user.displayName || user.email.split('@')[0]).slice(0, 120);
  const cached = await getDoc(ref);
  if (cached.exists() && (!user.displayName || cached.data().fullName === fullName)) return;
  // Kayıt ve doğrulama olayları yarışsa da createdAt yalnızca ilk yazmada atanır.
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (!existing.exists()) tx.set(ref, { fullName, phone: '', createdAt: serverTimestamp() });
    else if (user.displayName && existing.data().fullName !== fullName) tx.update(ref, { fullName });
  });
}
export async function listBusinesses(after = null) {
  const constraints = [where('uid', '==', auth.currentUser.uid), orderBy('businessId'), limit(50)];
  if (after) constraints.push(startAfter(after));
  const memberships = await getDocs(query(collectionGroup(db, 'members'), ...constraints));
  const values = await Promise.all(
    memberships.docs.map(async (membership) => {
      const business = await getDoc(doc(db, 'businesses', membership.data().businessId));
      return { id: business.id, ...business.data(), role: membership.data().role };
    })
  );
  return { values, after: memberships.size === 50 ? memberships.docs.at(-1) : null };
}
export function subscribePlan(bid, callback, error) {
  return onSnapshot(
    doc(db, 'businesses', bid, 'subscription', 'current'),
    (snapshot) => callback(snapshot.data()),
    error
  );
}
export async function getBusiness(bid) {
  const snapshot = await getDoc(doc(db, 'businesses', bid));
  return { id: snapshot.id, ...snapshot.data() };
}
export async function updateBusiness(bid, input) {
  await updateDoc(doc(db, 'businesses', bid), businessProfile(input));
}
export async function listInvoices(bid, options = {}) {
  const constraints = [];
  if (options.status && options.status !== 'all') constraints.push(where('status', '==', options.status));
  const search = (options.search || '').trim().toLocaleLowerCase('tr-TR');
  if (search)
    constraints.push(
      where('clientNameLower', '>=', search),
      where('clientNameLower', '<=', `${search}\uf8ff`),
      orderBy('clientNameLower')
    );
  constraints.push(orderBy('issueDate', options.direction || 'desc'), limit(50));
  if (options.after) constraints.push(startAfter(options.after));
  const snapshot = await getDocs(query(collection(db, 'businesses', bid, 'invoices'), ...constraints));
  return {
    invoices: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    after: snapshot.size === 50 ? snapshot.docs.at(-1) : null,
    cached: snapshot.metadata.fromCache
  };
}
export const invoiceExists = async (bid, invoiceId) =>
  (await getDocFromServer(doc(db, 'businesses', bid, 'invoices', invoiceId))).exists();
export async function getInvoice(bid, invoiceId) {
  const snapshot = await getDoc(doc(db, 'businesses', bid, 'invoices', invoiceId));
  if (!snapshot.exists()) throw new Error('Belge bulunamadı.');
  return fromInvoice({ id: snapshot.id, ...snapshot.data() });
}
export async function saveDraft(bid, invoice, business) {
  const ref = invoice.remoteId
    ? doc(db, 'businesses', bid, 'invoices', invoice.remoteId)
    : doc(collection(db, 'businesses', bid, 'invoices'));
  if (invoice.remoteId && !invoice.remoteCreatedAt) {
    const previous = await getDocFromServer(ref);
    if (previous.exists()) {
      if (previous.data().status !== 'draft')
        throw new Error('Bu belge zaten düzenlenmiş. Belgeyi listeden yeniden açın.');
      invoice.remoteCreatedAt = previous.data().createdAt;
      invoice.remoteCreatedBy = previous.data().createdBy;
    }
  }
  const input = toDraft(invoice, business);
  const totals = calcTotals(input);
  const data = {
    ...input,
    ...totals,
    status: 'draft',
    number: null,
    clientNameLower: invoice.client.name.toLocaleLowerCase('tr-TR'),
    sellerSnapshot: input.sellerSnapshot,
    clientSnapshot: input.clientSnapshot,
    createdBy: invoice.remoteCreatedBy || auth.currentUser.uid,
    createdAt: invoice.remoteCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  invoice.remoteId = ref.id;
  await setDoc(ref, data);
  const saved = await getDocFromServer(ref);
  return { id: ref.id, createdAt: saved.data().createdAt, createdBy: saved.data().createdBy };
}
export const deleteDraft = (bid, invoiceId) => deleteDoc(doc(db, 'businesses', bid, 'invoices', invoiceId));
export async function listClients(bid, search = '', after = null) {
  const value = search.trim().toLocaleLowerCase('tr-TR');
  const constraints = [orderBy('nameLower'), limit(50)];
  if (value) constraints.push(where('nameLower', '>=', value), where('nameLower', '<=', `${value}\uf8ff`));
  if (after) constraints.push(startAfter(after));
  const snapshot = await getDocs(query(collection(db, 'businesses', bid, 'clients'), ...constraints));
  return {
    clients: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    after: snapshot.size === 50 ? snapshot.docs.at(-1) : null
  };
}
export async function saveClient(bid, client) {
  const ref = client.id
    ? doc(db, 'businesses', bid, 'clients', client.id)
    : doc(collection(db, 'businesses', bid, 'clients'));
  const data = {
    name: client.name.trim(),
    nameLower: client.name.trim().toLocaleLowerCase('tr-TR'),
    address: client.address.trim(),
    email: client.email.trim(),
    phone: client.phone || '',
    taxOffice: client.taxOffice.trim(),
    taxNumber: client.taxNumber.trim(),
    note: client.note || ''
  };
  const existing = client.id ? await getDoc(ref) : null;
  client.id = ref.id;
  if (existing?.exists()) await updateDoc(ref, data);
  else await setDoc(ref, { ...data, createdAt: serverTimestamp() });
  return ref.id;
}
export async function listSeries(bid) {
  const snapshot = await getDocs(
    query(collection(db, 'businesses', bid, 'series'), orderBy('prefix'), limit(50))
  );
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
export async function vatTable(bid, year) {
  const base = await getDocs(
    query(collection(db, 'vatRates'), where('year', '<=', year), orderBy('year', 'desc'), limit(1))
  );
  const latest = await getDocs(
    query(
      collection(db, 'businesses', bid, 'vatRates'),
      where('year', '<=', year),
      orderBy('year', 'desc'),
      limit(1)
    )
  );
  const overrides = [];
  let cursor;
  if (!latest.empty)
    do {
      const constraints = [where('year', '==', latest.docs[0].data().year), orderBy('rate'), limit(50)];
      if (cursor) constraints.push(startAfter(cursor));
      const page = await getDocs(query(collection(db, 'businesses', bid, 'vatRates'), ...constraints));
      overrides.push(...page.docs);
      cursor = page.size === 50 ? page.docs.at(-1) : null;
    } while (cursor);
  const rates = new Set(base.empty ? [] : base.docs[0].data().rates);
  const globalYear = base.empty ? 0 : Number(base.docs[0].id);
  const localYear = overrides.length ? overrides[0].data().year : 0;
  if (localYear >= globalYear)
    for (const doc of overrides) {
      const item = doc.data();
      if (item.year === localYear) {
        if (item.enabled === false) rates.delete(item.rate);
        else rates.add(item.rate);
      }
    }
  return { year: Math.max(globalYear, localYear), rates: [...rates].sort((a, b) => a - b) };
}
export const saveVatRate = (bid, year, rate, enabled) =>
  setDoc(doc(db, 'businesses', bid, 'vatRates', `${year}-${rate}`), {
    year,
    rate,
    label: `%${rate}`,
    enabled
  });
export async function getMonthly(bid, month) {
  return (
    await Promise.all(
      ['TRY', 'GBP', 'EUR', 'USD'].map(async (currency) => {
        const snapshot = await getDoc(doc(db, 'businesses', bid, 'monthlySummaries', `${month}-${currency}`));
        return snapshot.exists() ? snapshot.data() : null;
      })
    )
  ).filter(Boolean);
}
export async function listMembers(bid) {
  const snapshot = await getDocs(
    query(collection(db, 'businesses', bid, 'members'), orderBy('addedAt'), limit(50))
  );
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
export async function listAudit(bid, after = null) {
  const constraints = [orderBy('createdAt', 'desc'), limit(50)];
  if (after) constraints.push(startAfter(after));
  const snapshot = await getDocs(query(collection(db, 'businesses', bid, 'auditLog'), ...constraints));
  return {
    entries: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    after: snapshot.size === 50 ? snapshot.docs.at(-1) : null
  };
}
export async function uploadLogo(bid, file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 600 / image.width, 600 / image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob.size > 500 * 1024)
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
  if (!blob || blob.size > 500 * 1024)
    throw new Error('Logo 500 KB’a küçültülemedi. Daha sade bir görsel seçin.');
  const path = `businesses/${bid}/logo/${crypto.randomUUID()}`;
  await uploadBytes(ref(storage, path), blob, { contentType: blob.type });
  await updateDoc(doc(db, 'businesses', bid), { logoPath: path });
  return path;
}
export const logoUrl = (path) => (path ? getDownloadURL(ref(storage, path)) : Promise.resolve(null));
export async function exportBusiness(bid, progress) {
  const result = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    business: await getBusiness(bid),
    clients: [],
    invoices: []
  };
  for (const name of ['clients', 'invoices']) {
    let after;
    do {
      const constraints = [orderBy('__name__'), limit(50)];
      if (after) constraints.push(startAfter(after));
      const snapshot = await getDocsFromServer(
        query(collection(db, 'businesses', bid, name), ...constraints)
      );
      result[name].push(...snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      progress(result.clients.length + result.invoices.length);
      after = snapshot.size === 50 ? snapshot.docs.at(-1) : null;
    } while (after);
  }
  return result;
}
