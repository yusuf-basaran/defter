import {
  state,
  newInvoice,
  newItem,
  validateInvoice,
  today,
  savedInvoice,
  normalizeSeries,
  validIban,
  legalNotice,
  activeSubscription
} from './state.js';
import { parseMoney, parseScaled } from './money.js';
import {
  renderForm,
  renderItems,
  renderPreview,
  renderHistory,
  renderSummary,
  renderMonthly,
  renderSettings,
  monthlyCsv,
  csvRows,
  scalePreview,
  escapeHtml
} from './render.js';
import { fromInvoice } from './model.js';
import { downloadPdf, printInvoice, removePrintPages, buildPages } from './pdf.js';
import * as api from './api.js';
import * as auth from './auth.js';
import { clearCache } from './firebase.js';
import { hasLegacy, readLegacy, convertLegacy, importLegacy } from './migrate.js';

let draftTimer;
let listTimer;
let unsubscribe;
let saveInFlight;
let generation = 0;
let activation = 0;
let revision = 0;
let busy = false;
let registering = false;
let draggedId;
let legacySource;
let settingsRequest;
let userKey;
let userJob;
const touched = new Set();
const scheme = window.matchMedia('(prefers-color-scheme: dark)');
const setupRequestId = crypto.randomUUID();

export function notify(message, error = false) {
  const notice = document.createElement('div');
  notice.className = `notice${error ? ' error' : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.textContent = 'Kapat';
  close.type = 'button';
  close.addEventListener('click', () => notice.remove(), { once: true });
  notice.append(text, close);
  const host = document.querySelector('#notifications');
  host.append(notice);
  document.querySelector('#notice-announcement').textContent = message;
  while (host.children.length > 3) host.firstElementChild.remove();
  window.setTimeout(() => notice.remove(), 10000);
}
function indicator(text) {
  document.querySelector('#save-indicator').textContent = text;
}
function theme() {
  document.documentElement.dataset.theme =
    state.settings.theme === 'system' ? (scheme.matches ? 'dark' : 'light') : state.settings.theme;
}
function confirmAction(title, message, label, reason = false) {
  const dialog = document.querySelector('#confirm-dialog');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-message').textContent = message;
  document.querySelector('#confirm-button').textContent = label;
  document.querySelector('#reason-field').hidden = !reason;
  const input = document.querySelector('#cancel-reason');
  input.required = reason;
  input.value = '';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => resolve(dialog.returnValue === 'confirm' ? (reason ? input.value.trim() : true) : false),
      { once: true }
    )
  );
}
function mayReplace() {
  return (
    !state.dirty ||
    confirmAction(
      'Çalışma değiştirilsin mi?',
      'Sunucuda saklanmamış değişikliklerin varsa bu çalışmada kalıp taslağı kaydedebilirsin.',
      'Devam et'
    )
  );
}
function setTab(tab) {
  state.mobileTab = tab;
  document.querySelector('.editor-layout').dataset.tab = tab;
  for (const name of ['edit', 'preview'])
    document.querySelector(`[data-action="tab-${name}"]`).setAttribute('aria-pressed', String(tab === name));
  scalePreview();
}
export function permissions() {
  document.querySelectorAll('[data-action="pdf"], [data-action="print"]').forEach((button) => {
    button.disabled = busy;
  });
  const active = activeSubscription();
  const plan = state.subscription;
  const days = plan ? Math.max(0, Math.ceil((plan.currentPeriodEnd.toMillis() - Date.now()) / 86400000)) : 0;
  document.querySelector('#subscription-banner').textContent = !plan
    ? 'Abonelik bilgisi yükleniyor…'
    : active
      ? plan.plan === 'trial'
        ? `Deneme: ${days} gün kaldı`
        : `Abonelik aktif · ${days} gün kaldı`
      : 'Aboneliğiniz bitti veya askıya alındı: faturalarınızı görüntüleyebilir ve indirebilirsiniz. Yeni fatura için yenileyin.';
  document.querySelectorAll('[data-write]').forEach((button) => {
    button.disabled = !active || busy;
    button.title = active ? '' : 'Bu işlem için aktif abonelik gerekiyor.';
  });
  document
    .querySelector('#invoice-form .document-fields')
    ?.toggleAttribute('disabled', !active || Boolean(savedInvoice()));
  document.querySelectorAll('#settings-form fieldset').forEach((fieldset) => {
    fieldset.disabled = !active || state.role !== 'owner';
  });
  for (const action of ['paid', 'cancel-current'])
    document.querySelector(`[data-action="${action}"]`).disabled =
      !active || busy || !['owner', 'accountant'].includes(state.role);
}
function validate(showAll = false) {
  const errors = savedInvoice() ? {} : validateInvoice(state.invoice);
  for (const input of document.querySelectorAll('#invoice-form [data-field]')) {
    const message = errors[input.dataset.field];
    const show = message && (showAll || touched.has(input.dataset.field));
    if (show) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    const error = document.getElementById(`${input.id}-error`);
    if (error) {
      error.textContent = message || '';
      error.hidden = !show;
    }
  }
  const warning = document.querySelector('#iban-warning');
  warning.hidden = !state.invoice.bankInfo.iban || validIban(state.invoice.bankInfo.iban);
  warning.textContent = 'IBAN biçimi doğrulanamadı, kontrol edin';
  return errors;
}
function allowOutput() {
  if (savedInvoice()) return true;
  if (!Object.keys(validate(true)).length) return true;
  showView('editor');
  setTab('edit');
  document.querySelector('#invoice-form [aria-invalid="true"]')?.focus();
  notify(
    'Önce işaretli alanları düzeltin. Satıcı bilgilerini işletme ayarlarında değiştirebilirsiniz.',
    true
  );
  return false;
}
function changed() {
  revision++;
  state.dirty = true;
  renderPreview();
  validate();
  indicator('Değişiklikler sunucuya kaydedilmedi');
  clearTimeout(draftTimer);
  if (activeSubscription() && navigator.onLine)
    draftTimer = window.setTimeout(
      () =>
        saveCurrent(false).catch((error) => {
          indicator('Taslak saklanamadı; form korunuyor');
          notify(auth.authMessage(error), true);
        }),
      1200
    );
}
async function saveCurrent(saveBuyer = true) {
  if (savedInvoice()) return;
  if (!activeSubscription()) throw new Error('Taslak kaydetmek için aktif abonelik gerekiyor.');
  if (!navigator.onLine) throw new Error('Çevrimdışısınız. Form korunuyor; sunucuya bağlanınca kaydedin.');
  if (saveInFlight) {
    await saveInFlight;
    if (!saveBuyer) return;
  }
  const invoice = state.invoice;
  const currentRevision = revision;
  const bid = state.business.id;
  const business = state.business;
  saveInFlight = (async () => {
    if (saveBuyer && invoice.client.name.trim() && invoice.client.address.trim())
      invoice.client.id = await api.saveClient(bid, invoice.client);
    indicator('Taslak sunucuya kaydediliyor…');
    const result = await api.saveDraft(bid, invoice, business);
    invoice.remoteId = result.id;
    invoice.remoteCreatedAt = result.createdAt;
    invoice.remoteCreatedBy = result.createdBy;
    if (invoice === state.invoice && bid === state.business?.id) {
      if (currentRevision === revision) state.dirty = false;
      indicator(state.dirty ? 'Yeni değişiklikler bekliyor' : 'Taslak sunucuda saklandı');
      document.querySelector('#archive-state').textContent =
        'Taslak sunucuda · Numara düzenleme sırasında verilir.';
    }
  })();
  try {
    await saveInFlight;
  } finally {
    saveInFlight = null;
    if (state.invoice === invoice && state.dirty && revision !== currentRevision) {
      clearTimeout(draftTimer);
      draftTimer = window.setTimeout(
        () => saveCurrent(false).catch((error) => notify(auth.authMessage(error), true)),
        1200
      );
    }
  }
}
async function replaceEditor(invoice, dirty = false) {
  clearTimeout(draftTimer);
  state.invoice = invoice;
  state.dirty = dirty;
  revision++;
  touched.clear();
  const current = invoice;
  if (invoice.seller.logoPath) {
    try {
      invoice.seller.logo = await api.logoUrl(invoice.seller.logoPath);
    } catch {
      invoice.seller.logo = null;
    }
  }
  if (current !== state.invoice) return;
  renderForm();
  renderPreview();
  validate();
  permissions();
  setTab('edit');
  indicator(
    savedInvoice() ? 'Suret sunucuda saklanıyor' : invoice.remoteId ? 'Kayıtlı taslak' : 'Yeni çalışma'
  );
  const url = new URL(location.href);
  url.searchParams.set('business', state.business.id);
  if (invoice.remoteId) url.searchParams.set('invoice', invoice.remoteId);
  else url.searchParams.delete('invoice');
  history.replaceState(null, '', url);
  await showView('editor');
}
async function loadList(reset = true) {
  const bid = state.business.id;
  if (reset) {
    state.pageIndex = 0;
    state.pageCursors = [null];
  }
  const stamp = ++generation;
  document.querySelector('#list-loading').hidden = false;
  try {
    const result = await api.listInvoices(bid, {
      status: state.filter,
      search: state.query,
      direction: state.sort === 'date-asc' ? 'asc' : 'desc',
      after: state.pageCursors[state.pageIndex]
    });
    if (stamp !== generation || state.business.id !== bid) return;
    state.invoices = result.invoices.map(fromInvoice);
    state.pageAfter = result.after;
    state.cached = result.cached;
    renderHistory();
    permissions();
  } finally {
    if (stamp === generation) document.querySelector('#list-loading').hidden = true;
  }
}
async function refreshMonthly() {
  const bid = state.business.id;
  const month = state.month;
  const groups = await api.getMonthly(bid, month);
  if (state.business?.id !== bid || state.month !== month) return;
  state.monthly = groups;
  renderMonthly();
  renderSummary();
}
async function loadSettings() {
  const request = {};
  settingsRequest = request;
  const [members, audit] = await Promise.all([
    api.listMembers(state.business.id),
    state.role === 'owner' ? api.listAudit(state.business.id) : Promise.resolve({ entries: [], after: null })
  ]);
  if (settingsRequest !== request) return;
  state.members = members;
  state.audit = audit.entries;
  state.auditAfter = audit.after;
  renderSettings();
  permissions();
}
async function showView(view) {
  state.view = view;
  for (const name of ['editor', 'history', 'monthly', 'settings'])
    document.querySelector(`#${name}-view`).hidden = view !== name;
  for (const button of document.querySelectorAll('.nav-link')) {
    const active = button.dataset.action === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  document.querySelector('#page-label').textContent = {
    editor: 'Belge',
    history: 'Faturalarım',
    monthly: 'Aylık KDV özeti',
    settings: 'Ayarlar'
  }[view];
  if (view === 'history') await loadList();
  if (view === 'monthly') await refreshMonthly();
  if (view === 'settings') await loadSettings();
  if (view === 'editor') scalePreview();
}
async function refreshRates(year = Number(state.invoice.issueDate.slice(0, 4))) {
  if (!Number.isInteger(year) || year < 1900) return;
  const bid = state.business.id;
  const table = await api.vatTable(bid, year);
  if (state.business.id !== bid) return;
  state.settings.vatRates[String(year)] = table.rates;
  if (!savedInvoice()) {
    state.invoice.vatRates = table.rates;
    renderItems();
    renderPreview();
    validate();
  }
}
async function activateBusiness(bid) {
  const ticket = ++activation;
  state.invoice = null;
  document.querySelector('#workspace-content').hidden = true;
  clearTimeout(draftTimer);
  unsubscribe?.();
  settingsRequest = null;
  generation++;
  document.querySelector('#setup-view').hidden = true;
  state.business = state.businesses.find((business) => business.id === bid);
  state.role = state.business.role;
  state.subscription = null;
  state.month = today().slice(0, 7);
  state.settingsYear = today().slice(0, 4);
  state.invoices = [];
  state.monthly = [];
  document.querySelector('#business-switcher').value = bid;
  const business = state.business;
  state.settings.defaultSeller = {
    name: business.legalName,
    address: business.address,
    phone: business.phone,
    email: business.email,
    taxOffice: business.taxOffice,
    taxNumber: business.taxNumber,
    logoPath: business.logoPath,
    logo: null
  };
  state.settings.defaultCurrency = business.defaultCurrency;
  state.settings.showAmountWords = business.showAmountWords;
  state.settings.vatRates = {};
  const [clients, series, table] = await Promise.all([
    api.listClients(bid),
    api.listSeries(bid),
    api.vatTable(bid, Number(today().slice(0, 4)))
  ]);
  if (state.business?.id !== bid || ticket !== activation) return;
  document.querySelector('#workspace-content').hidden = false;
  state.clients = clients.clients;
  state.series = series;
  state.settings.vatRates[today().slice(0, 4)] = table.rates;
  state.settings.series = {
    invoice: series.find((item) => item.kind === 'invoice')?.prefix || 'A',
    proforma: series.find((item) => item.kind === 'proforma')?.prefix || 'P'
  };
  state.invoice = newInvoice();
  unsubscribe = api.subscribePlan(
    bid,
    (plan) => {
      if (state.business.id === bid) {
        state.subscription = plan;
        permissions();
      }
    },
    (error) => notify(auth.authMessage(error), true)
  );
  await replaceEditor(state.invoice);
  await refreshMonthly();
  document.querySelector('#migration-banner').hidden = !hasLegacy() || state.role !== 'owner';
}
async function loadBusinesses(more = false) {
  const result = await api.listBusinesses(more ? state.businessAfter : null);
  state.businesses = more ? [...state.businesses, ...result.values] : result.values;
  state.businessAfter = result.after;
  document.querySelector('#business-switcher').innerHTML = state.businesses
    .map((business) => `<option value="${escapeHtml(business.id)}">${escapeHtml(business.name)}</option>`)
    .join('');
  document.querySelector('[data-action="more-businesses"]').hidden = !result.after;
  if (!state.businesses.length) {
    document.querySelector('#setup-view').hidden = false;
    document.querySelector('#workspace-content').hidden = true;
  } else if (!more) {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('invoice');
    const business =
      state.businesses.find((item) => item.id === params.get('business')) || state.businesses[0];
    await activateBusiness(business.id);
    if (wanted) await replaceEditor(await api.getInvoice(business.id, wanted));
  }
}
// Token yenilemesi açık formu sıfırlayan yeni bir oturum başlatmamalı.
function handleUser(user) {
  const key = user ? `${user.uid}:${user.emailVerified}` : 'signed-out';
  if (key === userKey) return userJob;
  userKey = key;
  userJob = loadUser(user);
  return userJob;
}
async function loadUser(user) {
  state.user = user;
  unsubscribe?.();
  clearTimeout(draftTimer);
  const verified = Boolean(user?.emailVerified);
  document.body.classList.toggle('signed-out', !verified);
  document.querySelector('#auth-view').hidden = verified;
  document.querySelector('#auth-form').hidden = Boolean(user);
  document.querySelector('#verify-panel').hidden = !user || verified;
  document.querySelector('#setup-view').hidden = true;
  document.querySelector('#workspace-content').hidden = true;
  document.querySelector('#auth-status').textContent =
    user && !verified
      ? `${user.email} adresine doğrulama bağlantısı gönderildi.`
      : 'E-posta ve şifrenle giriş yap.';
  if (!user) {
    activation++;
    state.invoice = null;
    state.business = null;
    state.invoices = [];
    return;
  }
  await api.ensureProfile(user);
  if (!verified) return;
  document.querySelector('#admin-link').hidden = (await auth.claims()).claims.platformAdmin !== true;
  const invite = new URLSearchParams(location.search).get('invite');
  if (
    invite &&
    (await confirmAction(
      'Daveti kabul et',
      `${user.email} hesabıyla bağlantıdaki işletme daveti kabul edilsin mi?`,
      'Kabul et'
    ))
  ) {
    try {
      await api.call('acceptInvite', { token: invite });
      history.replaceState(null, '', location.pathname);
    } catch (error) {
      notify(auth.authMessage(error), true);
    }
  }
  await loadBusinesses();
}
function download(text, type, filename) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportAll() {
  const data = await api.exportBusiness(state.business.id, (count) => {
    document.querySelector('#connection-status').textContent = `${count} kayıt indirilmeye hazırlanıyor…`;
  });
  download(
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8',
    `defter-${state.business.id}-${today()}.json`
  );
  download(
    csvRows([
      [
        'Tür',
        'Seri',
        'Numara',
        'Durum',
        'Tarih',
        'Alıcı',
        'Para birimi',
        'Matrah (kuruş)',
        'KDV (kuruş)',
        'Toplam (kuruş)'
      ],
      ...data.invoices.map((item) => [
        item.kind,
        item.seriesPrefix,
        item.number,
        item.status,
        item.issueDate,
        item.clientSnapshot.name,
        item.currency,
        item.baseCents,
        item.vatCents,
        item.totalCents
      ])
    ]),
    'text/csv;charset=utf-8',
    `defter-faturalar-${today()}.csv`
  );
  download(
    csvRows([
      ['Ad', 'Adres', 'E-posta', 'Telefon', 'Vergi dairesi', 'Vergi numarası'],
      ...data.clients.map((item) => [
        item.name,
        item.address,
        item.email,
        item.phone,
        item.taxOffice,
        item.taxNumber
      ])
    ]),
    'text/csv;charset=utf-8',
    `defter-alicilar-${today()}.csv`
  );
  document.querySelector('#connection-status').textContent =
    'JSON ve CSV dosyaları hazır. Tarayıcı isterse birden fazla indirmeye izin verin.';
}
function updateInput(input) {
  if (savedInvoice() || !activeSubscription()) return;
  const path = input.dataset.field;
  if (!path || path === 'sequence' || path.startsWith('seller.')) return;
  const parts = path.split('.');
  let value = input.value;
  if (parts[0] === 'items') {
    const item = state.invoice.items.find((item) => item.id === parts[1]);
    item[parts[2]] =
      parts[2] === 'qty'
        ? parseScaled(value, 3)
        : parts[2] === 'unitPrice'
          ? parseMoney(value)
          : parts[2] === 'vatRate'
            ? Number(value)
            : value;
    if (parts[2] === 'vatRate') renderItems();
  } else {
    if (path === 'discount.value') value = parseMoney(value);
    if (path === 'exchangeRate') value = value.trim() ? (parseScaled(value, 6) ?? -1) : null;
    if (path === 'series') value = normalizeSeries(value);
    if (['issueDate', 'dueDate', 'deliveryDate'].includes(path)) {
      const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      value = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
    }
    if (parts.length === 2) state.invoice[parts[0]][parts[1]] = value;
    else state.invoice[path] = value;
    if (path === 'discount.type') {
      state.invoice.discount.value = 0;
      document.querySelector('[data-field="discount.value"]').value = '0,00';
    }
    if (path === 'currency' || path === 'type') {
      if (path === 'type') state.invoice.series = state.settings.series[value];
      if (path === 'currency') state.invoice.exchangeRate = null;
      renderForm();
      permissions();
    }
    if (path === 'issueDate' && value)
      refreshRates(Number(value.slice(0, 4))).catch((error) => notify(auth.authMessage(error), true));
    if (path === 'client.name') {
      const client = state.clients.find((client) => client.name === value);
      if (client) {
        state.invoice.client = { ...client };
        for (const key of ['address', 'email', 'taxOffice', 'taxNumber'])
          document.querySelector(`[data-field="client.${key}"]`).value = client[key];
      } else {
        delete state.invoice.client.id;
        clearTimeout(listTimer);
        listTimer = window.setTimeout(
          () =>
            api
              .listClients(state.business.id, value)
              .then((result) => {
                state.clients = result.clients;
                document.querySelector('#client-list').innerHTML = result.clients
                  .map((client) => `<option value="${escapeHtml(client.name)}"></option>`)
                  .join('');
              })
              .catch((error) => notify(auth.authMessage(error), true)),
          400
        );
      }
    }
  }
  changed();
}
async function act(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (busy) return;
  if (button.hasAttribute('data-write') && !activeSubscription())
    throw new Error('Bu işlem için aktif abonelik gerekiyor.');
  if (['editor', 'history', 'monthly', 'settings'].includes(action)) return showView(action);
  if (action === 'toggle-register') {
    registering = !registering;
    document.querySelector('#full-name-field').hidden = !registering;
    document.querySelector('#full-name').required = registering;
    document.querySelector('#auth-submit').textContent = registering ? 'Hesap oluştur' : 'Giriş yap';
    button.textContent = registering ? 'Girişe dön' : 'Hesap oluştur';
    document.querySelector('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
    return;
  }
  if (action === 'reset-password') {
    await auth.resetPassword(document.querySelector('#auth-email').value);
    return notify('Hesap varsa şifre sıfırlama bağlantısı gönderildi.');
  }
  if (action === 'resend-verification') {
    await auth.verifyEmail();
    return notify('Doğrulama bağlantısı yeniden gönderildi.');
  }
  if (action === 'check-verification') {
    const user = await auth.refreshUser();
    if (!user.emailVerified) notify('E-posta henüz doğrulanmamış.', true);
    return handleUser(user);
  }
  if (action === 'logout') {
    if (!(await mayReplace())) return;
    clearTimeout(draftTimer);
    await auth.logout();
    try {
      await clearCache();
    } finally {
      location.reload();
    }
    return;
  }
  if (action === 'accept-notice') return document.querySelector('#legal-dialog').close();
  if (action === 'tab-edit' || action === 'tab-preview')
    return setTab(action === 'tab-edit' ? 'edit' : 'preview');
  if (action === 'new-business') {
    if (!state.user?.emailVerified || !(await mayReplace())) return;
    document.querySelector('#workspace-content').hidden = true;
    document.querySelector('#setup-view').hidden = false;
    return;
  }
  if (action === 'more-businesses') return loadBusinesses(true);
  if (action === 'new') {
    if (await mayReplace()) await replaceEditor(newInvoice());
    return;
  }
  if (action === 'save') {
    await saveCurrent();
    notify('Taslak sunucuda saklandı.');
    return;
  }
  if (action === 'issue') {
    if (!allowOutput()) return;
    if (
      !(await confirmAction(
        'Fatura düzenlensin mi?',
        'Sunucu toplamları yeniden hesaplayacak ve sıradaki numarayı verecek. Düzenlendikten sonra içerik değiştirilemez.',
        'Düzenle'
      ))
    )
      return;
    clearTimeout(draftTimer);
    busy = true;
    permissions();
    document.querySelector('#invoice-form').inert = true;
    try {
      await saveCurrent();
      const result = await api.call('issueInvoice', {
        businessId: state.business.id,
        invoiceId: state.invoice.remoteId
      });
      await replaceEditor(await api.getInvoice(state.business.id, result.invoiceId));
      state.business.invoiceCount++;
      await refreshMonthly();
      notify('Belge düzenlendi. Sureti arşivde saklanıyor.');
    } finally {
      busy = false;
      document.querySelector('#invoice-form').inert = false;
      permissions();
    }
    return;
  }
  if (action === 'edit' || action === 'copy') {
    if (!(await mayReplace())) return;
    const original = await api.getInvoice(state.business.id, id);
    if (action === 'edit') return replaceEditor(original);
    const invoice = {
      ...original,
      ...newInvoice(original.type),
      client: original.client,
      items: original.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
      discount: original.discount,
      note: original.note,
      currency: original.currency,
      exchangeRate: original.exchangeRate,
      priceMode: original.priceMode,
      template: original.template,
      accent: original.accent
    };
    await replaceEditor(invoice, true);
    return;
  }
  if (action === 'paid') {
    await api.call('markInvoicePaid', { businessId: state.business.id, invoiceId: state.invoice.remoteId });
    await replaceEditor(await api.getInvoice(state.business.id, state.invoice.remoteId));
    await refreshMonthly();
    return;
  }
  if (action === 'cancel-current') {
    const reason = await confirmAction(
      'Belge iptal edilsin mi?',
      'Numara ve içerik korunacak. İptal geri alınamaz.',
      'İptal et',
      true
    );
    if (!reason) return;
    await api.call('cancelInvoice', {
      businessId: state.business.id,
      invoiceId: state.invoice.remoteId,
      reason
    });
    await replaceEditor(await api.getInvoice(state.business.id, state.invoice.remoteId));
    await refreshMonthly();
    return;
  }
  if (action === 'discard' || action === 'delete-draft') {
    if (action === 'discard' && savedInvoice()) return;
    if (
      !(await confirmAction(
        'Taslak silinsin mi?',
        'Yalnızca düzenlenmemiş taslak silinir. Bir numara harcanmaz.',
        'Taslağı sil'
      ))
    )
      return;
    const draftId = id || state.invoice.remoteId;
    if (draftId) await api.deleteDraft(state.business.id, draftId);
    if (action === 'discard' || state.invoice.remoteId === draftId) await replaceEditor(newInvoice());
    if (action === 'delete-draft') await showView('history');
    return;
  }
  if (action === 'add-item') {
    if (savedInvoice() || state.invoice.items.length >= 100) return;
    const item = newItem(state.invoice.issueDate);
    state.invoice.items.push(item);
    renderItems();
    document.querySelector(`[data-item="${CSS.escape(item.id)}"] input`).focus();
    changed();
    return;
  }
  if (['remove-item', 'move-up', 'move-down'].includes(action)) {
    if (savedInvoice()) return;
    const items = state.invoice.items;
    const index = items.findIndex((item) => item.id === id);
    if (action === 'remove-item' && items.length > 1) items.splice(index, 1);
    if (action !== 'remove-item') {
      const to = index + (action === 'move-up' ? -1 : 1);
      if (to >= 0 && to < items.length) items.splice(to, 0, items.splice(index, 1)[0]);
    }
    renderItems();
    changed();
    document.querySelector(`[data-item="${CSS.escape(id)}"] .drag-handle`)?.focus();
    return;
  }
  if (action === 'page-next') {
    state.pageIndex++;
    state.pageCursors[state.pageIndex] = state.pageAfter;
    return loadList(false);
  }
  if (action === 'page-prev') {
    state.pageIndex--;
    return loadList(false);
  }
  if (action === 'csv')
    return download(monthlyCsv(), 'text/csv;charset=utf-8', `defter-aylik-kdv-${state.month}.csv`);
  if (action === 'export') return exportAll();
  if (action === 'save-business') {
    const input = { ...state.business };
    document.querySelectorAll('[data-business]').forEach((field) => {
      input[field.dataset.business] = field.value;
    });
    input.defaultCurrency = document.querySelector('#default-currency').value;
    input.showAmountWords = document.querySelector('#amount-words').checked;
    await api.updateBusiness(state.business.id, input);
    Object.assign(state.business, input);
    state.settings.showAmountWords = input.showAmountWords;
    state.settings.defaultCurrency = input.defaultCurrency;
    state.settings.defaultSeller = {
      ...state.settings.defaultSeller,
      name: input.legalName,
      address: input.address,
      phone: input.phone,
      email: input.email,
      taxOffice: input.taxOffice,
      taxNumber: input.taxNumber
    };
    if (!savedInvoice()) {
      state.invoice.showAmountWords = input.showAmountWords;
      state.invoice.seller = {
        ...state.invoice.seller,
        name: input.legalName,
        address: input.address,
        phone: input.phone,
        email: input.email,
        taxOffice: input.taxOffice,
        taxNumber: input.taxNumber
      };
      renderForm();
      renderPreview();
      permissions();
    }
    notify('İşletme bilgileri kaydedildi.');
    return;
  }
  if (action === 'create-series') {
    await api.call('createSeries', {
      businessId: state.business.id,
      kind: document.querySelector('#series-kind').value,
      prefix: document.querySelector('#new-series').value
    });
    state.series = await api.listSeries(state.business.id);
    renderSettings();
    permissions();
    return;
  }
  if (action === 'add-rate' || action === 'remove-rate') {
    const year = Number(document.querySelector('#vat-year').value);
    const value = action === 'add-rate' ? document.querySelector('#new-rate').value : button.dataset.rate;
    const rate = Number(value);
    if (
      !value ||
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 9999 ||
      !Number.isInteger(rate) ||
      rate < 0 ||
      rate > 100
    )
      throw new Error('Geçerli yıl ve 0–100 arasında oran girin.');
    await api.saveVatRate(state.business.id, year, rate, action === 'add-rate');
    state.settingsYear = String(year);
    await refreshRates(year);
    renderSettings();
    permissions();
    return;
  }
  if (action === 'invite') {
    const result = await api.call('createInvite', {
      businessId: state.business.id,
      email: document.querySelector('#invite-email').value,
      role: document.querySelector('#invite-role').value
    });
    const url = new URL('index.html', location.href);
    url.searchParams.set('invite', result.token);
    document.querySelector('#invite-link').value = url.href;
    return;
  }
  if (action === 'remove-member') {
    if (
      !(await confirmAction(
        'Üye kaldırılsın mı?',
        'Bu kullanıcının işletmeye erişimi kaldırılacak.',
        'Kaldır'
      ))
    )
      return;
    await api.call('removeMember', { businessId: state.business.id, uid: id });
    return loadSettings();
  }
  if (action === 'audit-next') {
    const result = await api.listAudit(state.business.id, state.auditAfter);
    state.audit = result.entries;
    state.auditAfter = result.after;
    renderSettings();
    permissions();
    return;
  }
  if (action === 'import') {
    if (state.role !== 'owner') throw new Error('Aktarımı yalnızca işletme sahibi yapabilir.');
    legacySource = readLegacy();
    if (!legacySource) return document.querySelector('#import-file').click();
    return showImport();
  }
  if (action === 'close-import') return document.querySelector('#import-dialog').close();
  if (action === 'confirm-import') {
    const count = await importLegacy(state.business.id, legacySource, (count) => {
      document.querySelector('#import-report').textContent =
        `${count} belge aktarıldı. Bu noktaya kadar olan gruplar sunucuda saklandı.`;
    });
    document.querySelector('#import-dialog').close();
    document.querySelector('#migration-banner').hidden = true;
    state.business = { ...state.business, ...(await api.getBusiness(state.business.id)) };
    await refreshMonthly();
    notify(`${count} eski belge aktarıldı. Kaynak kayıtlar korundu.`);
    return;
  }
  if (action === 'pdf' || action === 'print') {
    if (!allowOutput()) return;
    busy = true;
    document.querySelector('#invoice-form').inert = true;
    button.disabled = true;
    try {
      await document.fonts.ready;
      if (action === 'pdf') notify(`${await downloadPdf()} sayfalık PDF indirildi.`);
      else await printInvoice();
    } finally {
      busy = false;
      button.disabled = false;
      document.querySelector('#invoice-form').inert = false;
      permissions();
    }
    return;
  }
}
function showImport() {
  const result = convertLegacy(legacySource);
  document.querySelector('#import-report').textContent =
    `${result.invoices.length} düzenlenmiş belge ve ${result.drafts.length} taslak aktarılabilir. ${result.errors.join('\n')}`;
  document.querySelector('[data-action="confirm-import"]').disabled = Boolean(
    result.errors.length || !(result.invoices.length || result.drafts.length)
  );
  document.querySelector('#import-dialog').showModal();
}
export function init() {
  document.querySelector('#auth-status').textContent = 'E-posta ve şifrenle giriş yap.';
  state.month = today().slice(0, 7);
  state.settingsYear = today().slice(0, 4);
  theme();
  document.querySelector('#header-date').textContent = today().split('-').reverse().join('.');
  document.querySelector('#footer-year').textContent = today().slice(0, 4);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) {
      event.preventDefault();
      act(button).catch((error) => notify(auth.authMessage(error), true));
    }
  });
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#auth-submit');
    button.disabled = true;
    try {
      const email = document.querySelector('#auth-email').value;
      const password = document.querySelector('#auth-password').value;
      if (registering) await auth.register(document.querySelector('#full-name').value, email, password);
      else await auth.login(email, password);
      document.querySelector('#auth-password').value = '';
    } catch (error) {
      document.querySelector('#auth-status').textContent = auth.authMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelector('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const business = {};
      for (const key of ['name', 'legalName', 'address', 'taxOffice', 'taxNumber'])
        business[key] = document.querySelector(`#setup-${key}`).value;
      await api.call('createBusiness', { business, requestId: setupRequestId });
      await loadBusinesses();
    } catch (error) {
      document.querySelector('#setup-status').textContent = auth.authMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  for (const name of ['invoice', 'settings'])
    document.querySelector(`#${name}-form`).addEventListener('submit', (event) => event.preventDefault());
  document.addEventListener('input', (event) => {
    const input = event.target;
    if (input.dataset.field && input.tagName !== 'SELECT' && input.type !== 'radio') updateInput(input);
    if (input.id === 'search') {
      state.query = input.value;
      clearTimeout(listTimer);
      listTimer = window.setTimeout(
        () => loadList().catch((error) => notify(auth.authMessage(error), true)),
        350
      );
    }
  });
  document.addEventListener('change', (event) =>
    change(event.target).catch((error) => notify(auth.authMessage(error), true))
  );
  document.addEventListener('focusout', (event) => {
    if (event.target.dataset.field && state.invoice) {
      touched.add(event.target.dataset.field);
      validate();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 's' &&
      state.business &&
      state.invoice
    ) {
      event.preventDefault();
      saveCurrent().catch((error) => notify(auth.authMessage(error), true));
    }
    if (event.key === 'Enter' && event.target.matches('.item-row input') && !savedInvoice()) {
      event.preventDefault();
      const next = event.target.closest('.item-row').nextElementSibling;
      if (next) next.querySelector('input').focus();
      else
        act(document.querySelector('[data-action="add-item"]')).catch((error) =>
          notify(auth.authMessage(error), true)
        );
    }
  });
  document.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('.drag-handle');
    if (handle && !savedInvoice()) {
      draggedId = handle.closest('.item-row').dataset.item;
      event.dataTransfer.setData('text/plain', draggedId);
    }
  });
  document.addEventListener('dragover', (event) => {
    if (draggedId && event.target.closest('.item-row')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    const row = event.target.closest('.item-row');
    if (row && draggedId && !savedInvoice()) {
      event.preventDefault();
      const items = state.invoice.items;
      const from = items.findIndex((item) => item.id === draggedId);
      const to = items.findIndex((item) => item.id === row.dataset.item);
      items.splice(to, 0, items.splice(from, 1)[0]);
      renderItems();
      changed();
    }
    draggedId = null;
  });
  document.addEventListener('dragend', () => {
    draggedId = null;
  });
  new ResizeObserver(scalePreview).observe(document.querySelector('#preview-stage'));
  scheme.addEventListener('change', theme);
  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('beforeprint', () => {
    if (state.invoice && !document.querySelector('#print-pages')) buildPages();
  });
  window.addEventListener('afterprint', removePrintPages);
  const connection = () => {
    document.querySelector('#connection-status').textContent = navigator.onLine
      ? ''
      : 'Çevrimdışısınız. Form korunuyor; düzenleme ve sunucu onayı için bağlantı gerekiyor.';
  };
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  connection();
  window.setInterval(() => {
    if (state.business) permissions();
  }, 30000);
  document.fonts.ready.then(() => {
    if (state.invoice) renderPreview();
  });
  document.querySelector('#legal-message').textContent = legalNotice;
  document.querySelector('#legal-dialog').showModal();
  auth.observeAuth((user) =>
    handleUser(user).catch((error) => {
      notify(auth.authMessage(error), true);
      document.querySelector('#auth-status').textContent = auth.authMessage(error);
    })
  );
}
async function change(input) {
  if (input.dataset.field && (input.tagName === 'SELECT' || input.type === 'radio')) updateInput(input);
  if (input.id === 'business-switcher') {
    if (await mayReplace()) await activateBusiness(input.value);
    else input.value = state.business.id;
  }
  if (input.id === 'theme') {
    state.settings.theme = input.value;
    theme();
  }
  if (input.id === 'copies') {
    state.copies = input.value;
    renderPreview();
  }
  if (input.id === 'status-filter' || input.id === 'sort') {
    if (input.id === 'status-filter') state.filter = input.value;
    else state.sort = input.value;
    await loadList();
  }
  if (input.id === 'summary-month') {
    state.month = input.value || today().slice(0, 7);
    await refreshMonthly();
  }
  if (input.id === 'vat-year') {
    state.settingsYear = input.value;
    await refreshRates(Number(input.value));
    renderSettings();
    permissions();
  }
  if (input.id === 'business-logo' && input.files[0]) {
    if (input.files[0].size > 10 * 1024 * 1024) throw new Error('Logo kaynağı en fazla 10 MB olabilir.');
    state.business.logoPath = await api.uploadLogo(state.business.id, input.files[0]);
    state.settings.defaultSeller.logoPath = state.business.logoPath;
    state.settings.defaultSeller.logo = await api.logoUrl(state.business.logoPath);
    if (!savedInvoice()) {
      state.invoice.seller.logoPath = state.business.logoPath;
      state.invoice.seller.logo = state.settings.defaultSeller.logo;
      renderPreview();
    }
    notify('Logo yüklendi. Eski belgelerin logoları korundu.');
  }
  if (input.dataset.memberRole) {
    await api.call('setMemberRole', {
      businessId: state.business.id,
      uid: input.dataset.memberRole,
      role: input.value
    });
    await loadSettings();
  }
  if (input.id === 'import-file' && input.files[0]) {
    if (input.files[0].size > 20 * 1024 * 1024) throw new Error('Yedek en fazla 20 MB olabilir.');
    legacySource = readLegacy(await input.files[0].text());
    input.value = '';
    showImport();
  }
}
