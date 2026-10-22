import { calcTotals, tlEquivalent } from './money.js';
import { getVatTable, defaultVatRate } from './vat-rates.js';

export const timeZone = 'Europe/Nicosia';
export const legalNotice =
  'Bu uygulama bir portfolyo/öğrenme projesidir. Resmî fatura düzeni, matbu belge ve ödeme kaydedici cihaz zorunlulukları ile belge saklama süreleri için Gelir ve Vergi Dairesi veya mali müşavirinize danışın.';
export const currencies = ['TRY', 'GBP', 'EUR', 'USD'];
export const taxOffices = ['Lefkoşa', 'Girne', 'Gazimağusa', 'Güzelyurt', 'İskele', 'Lefke'];
export const blankSeller = () => ({
  name: '',
  address: '',
  phone: '',
  email: '',
  taxOffice: '',
  taxNumber: '',
  logo: null
});
export const state = {
  user: null,
  business: null,
  businesses: [],
  businessAfter: null,
  subscription: null,
  role: null,
  invoices: [],
  clients: [],
  series: [],
  monthly: [],
  members: [],
  audit: [],
  auditAfter: null,
  settings: {
    theme: 'system',
    defaultSeller: blankSeller(),
    defaultCurrency: 'TRY',
    series: { invoice: 'A', proforma: 'P' },
    vatRates: {},
    showAmountWords: true
  },
  invoice: null,
  dirty: false,
  view: 'editor',
  mobileTab: 'edit',
  query: '',
  filter: 'all',
  sort: 'date-desc',
  month: '',
  settingsYear: '',
  copies: 'original',
  pageAfter: null,
  pageCursors: [null],
  pageIndex: 0,
  cached: false
};
export function today(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function addDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const savedInvoice = () =>
  state.invoice?.cloudStatus && state.invoice.cloudStatus !== 'draft' ? state.invoice : null;
export const normalizeSeries = (value) => value.trim().toUpperCase();
export function activeSubscription() {
  return (
    state.subscription?.status === 'active' && state.subscription.currentPeriodEnd.toMillis() > Date.now()
  );
}
export function newItem(issueDate = today()) {
  const rates = getVatTable(issueDate, state.settings.vatRates).rates;
  return {
    id: crypto.randomUUID(),
    desc: '',
    qty: 1000,
    unitPrice: 0,
    vatRate: rates.includes(defaultVatRate) ? defaultVatRate : (rates[0] ?? defaultVatRate),
    exemption: ''
  };
}
export function newInvoice(type = 'invoice') {
  const issueDate = today();
  const bank = state.business || {};
  return {
    id: crypto.randomUUID(),
    remoteId: null,
    remoteCreatedAt: null,
    remoteCreatedBy: null,
    cloudStatus: 'draft',
    number: 'Taslak',
    series: state.settings.series[type],
    sequence: null,
    type,
    status: 'draft',
    issueDate,
    dueDate: addDays(issueDate, 14),
    deliveryDate: '',
    dispatchNumber: '',
    currency: state.settings.defaultCurrency,
    exchangeRate: null,
    priceMode: 'exclusive',
    seller: structuredClone(state.settings.defaultSeller),
    client: { name: '', address: '', email: '', phone: '', taxOffice: '', taxNumber: '' },
    items: [newItem(issueDate)],
    discount: { type: 'percent', value: 0 },
    note: '',
    bankInfo: {
      accountHolder: bank.bankHolder || '',
      bankName: bank.bankName || '',
      branch: bank.bankBranch || '',
      iban: bank.bankIban || '',
      paymentTerms: 'Fatura tarihinden itibaren 14 gün.'
    },
    template: 'classic',
    accent: '#315b46',
    showAmountWords: state.settings.showAmountWords,
    vatRates: getVatTable(issueDate, state.settings.vatRates).rates,
    savedAt: null,
    cancelledAt: null,
    legacyNumber: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
export function statusOf(invoice) {
  return invoice.status === 'sent' && invoice.dueDate < today() ? 'overdue' : invoice.status;
}
export const statusLabels = {
  draft: 'Taslak',
  sent: 'Düzenlendi',
  paid: 'Ödendi',
  overdue: 'Gecikmiş',
  cancelled: 'İptal'
};
export const typeLabels = { invoice: 'Fatura', proforma: 'Proforma fatura' };
export function validIban(value) {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (char) =>
    String(char.charCodeAt(0) - 55)
  );
  let remainder = 0;
  for (const digit of rearranged) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function validateInvoice(invoice) {
  const errors = {};
  const required = (key, value, message) => {
    if (!value?.trim()) errors[key] = message;
  };
  if (!/^[A-Z0-9_]{1,20}$/.test(invoice.series))
    errors.series = 'Tanımlı bir seri seçin (A–Z, rakam, alt çizgi).';
  if (!validDate(invoice.issueDate) || invoice.issueDate > today())
    errors.issueDate = 'Düzenleme tarihi geçerli olmalı ve gelecekte olamaz.';
  if (!validDate(invoice.dueDate) || invoice.dueDate < invoice.issueDate)
    errors.dueDate = 'Vade, düzenleme tarihinden önce olamaz.';
  if (invoice.deliveryDate && !validDate(invoice.deliveryDate))
    errors.deliveryDate = 'Geçerli teslim tarihi girin.';
  for (const party of ['seller', 'client']) {
    required(`${party}.name`, invoice[party].name, 'Ad / unvan girin.');
    required(`${party}.address`, invoice[party].address, 'Adres girin.');
    if (invoice[party].email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoice[party].email))
      errors[`${party}.email`] = 'E-posta adresini kontrol edin.';
    if (invoice[party].taxNumber.length > 40)
      errors[`${party}.taxNumber`] = 'Vergi numarası en fazla 40 karakter olabilir.';
  }
  required(
    'seller.taxOffice',
    invoice.seller.taxOffice,
    'Satıcı vergi dairesi işletme ayarlarında zorunludur.'
  );
  required(
    'seller.taxNumber',
    invoice.seller.taxNumber,
    'Satıcı vergi numarası işletme ayarlarında zorunludur.'
  );
  const rates = savedInvoice()
    ? invoice.vatRates
    : getVatTable(invoice.issueDate, state.settings.vatRates).rates;
  for (const item of invoice.items) {
    required(`items.${item.id}.desc`, item.desc, 'Mal / hizmet cinsini girin.');
    if (!Number.isSafeInteger(item.qty) || item.qty <= 0 || item.qty > 1000000000)
      errors[`items.${item.id}.qty`] = 'Pozitif miktar girin; en çok 3 ondalık.';
    if (!Number.isSafeInteger(item.unitPrice) || item.unitPrice < 0 || item.unitPrice > 1000000000000)
      errors[`items.${item.id}.unitPrice`] = 'Geçerli fiyat girin; en çok 2 ondalık.';
    if (!rates.includes(item.vatRate))
      errors[`items.${item.id}.vatRate`] = 'Bu tarih için oran tanımlı değil.';
    if (item.vatRate === 0)
      required(`items.${item.id}.exemption`, item.exemption, 'İstisna / muafiyet açıklaması girin.');
  }
  if (
    !Number.isSafeInteger(invoice.discount.value) ||
    invoice.discount.value < 0 ||
    (invoice.discount.type === 'percent' && invoice.discount.value > 10000)
  )
    errors['discount.value'] = 'Geçerli iskonto girin.';
  if (
    invoice.exchangeRate !== null &&
    (!Number.isSafeInteger(invoice.exchangeRate) || invoice.exchangeRate <= 0)
  )
    errors.exchangeRate = 'Pozitif kur girin; en çok 6 ondalık.';
  if (
    !Object.keys(errors).some(
      (key) => key.startsWith('items.') || ['discount.value', 'exchangeRate'].includes(key)
    )
  ) {
    try {
      const totals = calcTotals(invoice);
      if (invoice.exchangeRate) tlEquivalent(totals.total, invoice.exchangeRate);
    } catch (error) {
      errors['discount.value'] = error.message;
    }
  }
  return errors;
}
