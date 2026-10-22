import { HttpsError } from 'firebase-functions/v2/https';

export const currencies = ['TRY', 'GBP', 'EUR', 'USD'];
export const roles = ['owner', 'accountant', 'staff'];
export const businessFields = [
  'name',
  'legalName',
  'address',
  'phone',
  'email',
  'taxOffice',
  'taxNumber',
  'logoPath',
  'defaultCurrency',
  'bankName',
  'bankBranch',
  'bankIban',
  'bankHolder',
  'showAmountWords'
];
export function fail(message, code = 'invalid-argument') {
  throw new HttpsError(code, message);
}
export function object(value, label = 'Veri') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} geçersiz.`);
  return value;
}
export function text(value, label, max = 200, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail(`${label} boş bırakılamaz ve en fazla ${max} karakter olabilir.`);
  return value.trim();
}
export function id(value, label = 'Kimlik') {
  const result = text(value, label, 150);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) fail(`${label} geçersiz.`);
  return result;
}
export function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(`${label}, ${min}–${max} arasında tam sayı olmalı.`);
  return value;
}
export function email(value) {
  const result = text(value, 'E-posta', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('E-posta adresini kontrol edin.');
  return result;
}
export function oneOf(value, values, label) {
  if (!values.includes(value)) fail(`${label} geçersiz.`);
  return value;
}
export function today(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Nicosia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function date(value, label, optional = false) {
  if (optional && value === '') return '';
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail(`${label} geçersiz.`);
  return value;
}
export function prefix(value) {
  const result = text(value, 'Seri', 20).toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(result)) fail('Seri yalnızca A–Z, rakam ve alt çizgi içerebilir.');
  return result;
}
export function businessInput(input) {
  object(input);
  const result = {};
  for (const field of businessFields) {
    if (field === 'showAmountWords') result[field] = input[field] !== false;
    else if (field === 'defaultCurrency')
      result[field] = oneOf(input[field] || 'TRY', currencies, 'Para birimi');
    else
      result[field] = text(
        input[field] ?? '',
        field,
        field === 'address' ? 2000 : field === 'email' ? 254 : field === 'taxNumber' ? 40 : 200,
        ['name', 'legalName', 'address', 'taxOffice', 'taxNumber'].includes(field)
      );
  }
  if (result.email) result.email = email(result.email);
  result.logoPath = '';
  return result;
}
export function draftInput(input, rates) {
  object(input, 'Fatura');
  oneOf(input.kind, ['invoice', 'proforma'], 'Belge türü');
  oneOf(input.currency, currencies, 'Para birimi');
  oneOf(input.priceMode, ['exclusive', 'inclusive'], 'Fiyat modu');
  oneOf(input.discountType, ['percent', 'fixed'], 'İskonto türü');
  date(input.issueDate, 'Düzenleme tarihi');
  date(input.dueDate, 'Vade tarihi');
  date(input.deliveryDate, 'Teslim tarihi', true);
  if (input.issueDate > today()) fail('Düzenleme tarihi gelecekte olamaz.');
  if (input.dueDate < input.issueDate) fail('Vade, düzenleme tarihinden önce olamaz.');
  const result = {
    kind: input.kind,
    seriesPrefix: prefix(input.seriesPrefix),
    clientId: id(input.clientId, 'Alıcı'),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    deliveryDate: input.deliveryDate,
    waybillNo: text(input.waybillNo, 'Sevk irsaliyesi no', 100, false),
    currency: input.currency,
    exchangeRate: input.exchangeRate === null ? null : integer(input.exchangeRate, 'Kur', 1, 1000000000000),
    priceMode: input.priceMode,
    discountType: input.discountType,
    discountValue: integer(
      input.discountValue,
      'İskonto',
      0,
      input.discountType === 'percent' ? 10000 : Number.MAX_SAFE_INTEGER
    ),
    note: text(input.note, 'Not', 5000, false),
    exemptionNote: text(input.exemptionNote || '', 'İstisna açıklaması', 1000, false),
    template: oneOf(input.template, ['classic', 'plain', 'stripe'], 'Şablon'),
    accent: text(input.accent, 'Vurgu rengi', 7),
    showAmountWords: input.showAmountWords !== false,
    paymentTerms: text(input.paymentTerms || '', 'Ödeme koşulları', 1000, false)
  };
  if (!/^#[0-9a-f]{6}$/i.test(result.accent)) fail('Vurgu rengi geçersiz.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100)
    fail('Bir faturada 1–100 kalem olmalı.');
  result.items = input.items.map((item, index) => {
    object(item, 'Kalem');
    const vatRate = integer(item.vatRate, 'KDV oranı', 0, 100);
    if (!rates.includes(vatRate)) fail(`${index + 1}. kalemin KDV oranı seçilen yıl için tanımlı değil.`);
    const exemptionNote = text(
      item.exemptionNote || result.exemptionNote,
      'İstisna açıklaması',
      1000,
      vatRate === 0
    );
    return {
      description: text(item.description, 'Mal / hizmet cinsi', 2000),
      quantity: integer(item.quantity, 'Miktar', 1, 1000000000),
      unitPriceCents: integer(item.unitPriceCents, 'Birim fiyat', 0, 1000000000000),
      vatRate,
      exemptionNote
    };
  });
  return result;
}
export function clientSnapshot(data) {
  object(data, 'Alıcı');
  const result = {};
  for (const field of ['name', 'address', 'email', 'phone', 'taxOffice', 'taxNumber'])
    result[field] = text(
      data[field] || '',
      `Alıcı ${field}`,
      field === 'address' ? 2000 : field === 'email' ? 254 : field === 'taxNumber' ? 40 : 200,
      ['name', 'address'].includes(field)
    );
  return result;
}
