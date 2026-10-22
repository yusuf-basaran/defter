import { newInvoice } from './state.js';

export function businessProfile(input) {
  const result = {};
  for (const key of [
    'name',
    'legalName',
    'address',
    'phone',
    'email',
    'taxOffice',
    'taxNumber',
    'logoPath',
    'bankName',
    'bankBranch',
    'bankIban',
    'bankHolder'
  ])
    result[key] = String(input[key] || '').trim();
  result.defaultCurrency = input.defaultCurrency || 'TRY';
  result.showAmountWords = input.showAmountWords !== false;
  return result;
}
export function toDraft(invoice, business) {
  return {
    kind: invoice.type,
    seriesPrefix: invoice.series,
    clientId: invoice.client.id || '',
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    deliveryDate: invoice.deliveryDate,
    waybillNo: invoice.dispatchNumber,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
    priceMode: invoice.priceMode,
    discountType: invoice.discount.type,
    discountValue: invoice.discount.value || 0,
    note: invoice.note,
    exemptionNote: '',
    items: invoice.items.map((item) => ({
      description: item.desc,
      quantity: item.qty || 0,
      unitPriceCents: item.unitPrice || 0,
      vatRate: item.vatRate,
      exemptionNote: item.exemption
    })),
    sellerSnapshot: {
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
    },
    clientSnapshot: {
      name: invoice.client.name,
      address: invoice.client.address,
      email: invoice.client.email,
      phone: invoice.client.phone || '',
      taxOffice: invoice.client.taxOffice,
      taxNumber: invoice.client.taxNumber
    },
    template: invoice.template,
    accent: invoice.accent,
    showAmountWords: invoice.showAmountWords,
    paymentTerms: invoice.bankInfo.paymentTerms
  };
}
export function fromInvoice(raw) {
  const invoice = newInvoice(raw.kind);
  const stamp = (value) =>
    value?.toDate ? value.toDate().toISOString() : typeof value === 'string' ? value : null;
  Object.assign(invoice, {
    id: raw.id,
    remoteId: raw.id,
    remoteCreatedAt: raw.createdAt,
    remoteCreatedBy: raw.createdBy,
    cloudStatus: raw.status,
    status: { draft: 'draft', issued: 'sent', paid: 'paid', cancelled: 'cancelled' }[raw.status],
    type: raw.kind,
    series: raw.seriesPrefix,
    sequence: raw.number,
    number: raw.number === null ? 'Taslak' : `${raw.seriesPrefix}-${String(raw.number).padStart(6, '0')}`,
    issueDate: raw.issueDate,
    dueDate: raw.dueDate,
    deliveryDate: raw.deliveryDate,
    dispatchNumber: raw.waybillNo,
    currency: raw.currency,
    exchangeRate: raw.exchangeRate,
    priceMode: raw.priceMode,
    discount: { type: raw.discountType, value: raw.discountValue },
    note: raw.note,
    seller: { ...raw.sellerSnapshot, logo: null },
    client: { ...raw.clientSnapshot, id: raw.clientId },
    items: raw.items.map((item) => ({
      id: crypto.randomUUID(),
      desc: item.description,
      qty: item.quantity,
      unitPrice: item.unitPriceCents,
      vatRate: item.vatRate,
      exemption: item.exemptionNote || ''
    })),
    bankInfo: {
      accountHolder: raw.sellerSnapshot.bankHolder || '',
      bankName: raw.sellerSnapshot.bankName || '',
      branch: raw.sellerSnapshot.bankBranch || '',
      iban: raw.sellerSnapshot.bankIban || '',
      paymentTerms: raw.paymentTerms || ''
    },
    template: raw.template,
    accent: raw.accent,
    showAmountWords: raw.showAmountWords,
    savedAt: stamp(raw.issuedAt),
    cancelledAt: stamp(raw.cancelledAt),
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
    vatRates: [...new Set(raw.items.map((item) => item.vatRate))],
    legacyNumber: raw.legacyNumber || ''
  });
  return invoice;
}
