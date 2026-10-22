import { newInvoice } from './state.js';
import { parseMoney } from './money.js';

export function readLegacy(text = null) {
  let value;
  try {
    value = text || localStorage.getItem('defter.data.v2') || localStorage.getItem('defter.data.v1');
    if (!value) return null;
    const data = JSON.parse(value);
    if (![1, 2].includes(data.schemaVersion) || !Array.isArray(data.invoices) || data.invoices.length > 10000)
      throw new Error();
    return data;
  } catch {
    throw new Error('Eski kayıtlar okunamadı. Geçerli bir Defter v1/v2 JSON yedeği seçin.');
  }
}
export function hasLegacy() {
  try {
    return Boolean(localStorage.getItem('defter.data.v2') || localStorage.getItem('defter.data.v1'));
  } catch {
    return false;
  }
}
export function convertLegacy(data) {
  const errors = [];
  const invoices = [];
  const drafts = [];
  for (const [index, source] of data.invoices.entries()) {
    try {
      if (!source || !Array.isArray(source.items) || !source.items.length || source.items.length > 100)
        throw new Error('Kalem sayısı 1–100 olmalı.');
      if (!source.seller || !source.client) throw new Error('Satıcı veya alıcı bilgileri eksik.');
      if (source.status === 'draft') {
        const invoice = {
          ...newInvoice(source.type || 'invoice'),
          ...source,
          remoteId: null,
          remoteCreatedAt: null,
          remoteCreatedBy: null,
          cloudStatus: 'draft',
          status: 'draft',
          number: 'Taslak',
          sequence: null,
          savedAt: null,
          cancelledAt: null,
          client: { phone: '', taxOffice: '', ...source.client },
          items: source.items.map((item) => ({ exemption: '', ...item }))
        };
        drafts.push(invoice);
        continue;
      }
      const parsed = (source.number || '').match(/^(?:FTR-\d{4}-)?([A-Z0-9_]+)?-?(\d+)$/i);
      const seriesPrefix = source.series || (parsed?.[1] && !/^\d+$/.test(parsed[1]) ? parsed[1] : 'ESKI');
      const number = source.sequence || Number((source.number || '').match(/(\d+)$/)?.[1]);
      if (!/^[A-Z0-9_]{1,20}$/.test(seriesPrefix) || !Number.isSafeInteger(number) || number < 1)
        throw new Error('Seri-sıra numarası açık değil. Kaynak yedekte geçerli seri ve sıra tanımlayın.');
      if (!['sent', 'issued', 'paid', 'cancelled'].includes(source.status))
        throw new Error('Belge durumu tanınmıyor.');
      const money = (value) => {
        if (Number.isSafeInteger(value) && value >= 0) return value;
        const cents = typeof value === 'string' ? parseMoney(value) : null;
        if (cents === null) throw new Error('Para alanı geçersiz.');
        return cents;
      };
      const party = (value) => ({
        name: value.name || '',
        address: value.address || '',
        email: value.email || '',
        phone: value.phone || '',
        taxOffice: value.taxOffice || '',
        taxNumber: value.taxNumber || ''
      });
      invoices.push({
        kind: source.type || 'invoice',
        status: source.status === 'sent' ? 'issued' : source.status,
        seriesPrefix,
        number,
        clientId: 'legacy',
        issueDate: source.issueDate,
        dueDate: source.dueDate,
        deliveryDate: source.deliveryDate || '',
        waybillNo: source.dispatchNumber || '',
        currency: source.currency || 'TRY',
        exchangeRate: source.exchangeRate || null,
        priceMode: source.priceMode || 'exclusive',
        discountType: source.discount?.type || 'percent',
        discountValue: money(source.discount?.value || 0),
        note: source.note || '',
        exemptionNote: '',
        items: source.items.map((item) => ({
          description: item.desc,
          quantity: item.qty,
          unitPriceCents: money(item.unitPrice),
          vatRate: item.vatRate,
          exemptionNote: item.exemption || ''
        })),
        sellerSnapshot: party(source.seller),
        clientSnapshot: party(source.client),
        template: source.template || 'classic',
        accent: source.accent || '#315b46',
        showAmountWords: source.showAmountWords !== false,
        paymentTerms: source.bankInfo?.paymentTerms || '',
        cancelReason: source.cancelReason || '',
        legacyNumber: source.legacyNumber || source.number,
        ...(source.totalCents === undefined ? {} : { totalCents: money(source.totalCents) })
      });
    } catch (error) {
      errors.push(`${index + 1}. kayıt: ${error.message}`);
    }
  }
  return { invoices, drafts, errors };
}
export async function importLegacy(businessId, source, progress) {
  const api = await import('./api.js');
  const result = convertLegacy(source);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  let count = 0;
  for (let index = 0; index < result.invoices.length; index += 10) {
    const batch = result.invoices.slice(index, index + 10);
    await api.call('importLegacyInvoices', { businessId, requestId: `${hash}_${index}`, invoices: batch });
    count += batch.length;
    progress(count);
  }
  const business = await api.getBusiness(businessId);
  for (const [index, invoice] of result.drafts.entries()) {
    invoice.remoteId = `legacy-draft-${hash.slice(0, 32)}-${index}`;
    if (!(await api.invoiceExists(businessId, invoice.remoteId))) {
      if (invoice.client.name?.trim() && invoice.client.address?.trim())
        invoice.client.id = await api.saveClient(businessId, invoice.client);
      await api.saveDraft(businessId, invoice, business);
    }
    count++;
    progress(count);
  }
  return count;
}
