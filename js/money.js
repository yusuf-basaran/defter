import { calcTotals as calculate } from './totals.js';
export function parseScaled(value, places = 2) {
  const match = String(value)
    .trim()
    .match(new RegExp(`^(\\d+)(?:[,.](\\d{1,${places}}))?$`));
  if (!match) return null;
  const result = BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] || '').padEnd(places, '0'));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

export const parseMoney = (value) => parseScaled(value, 2);

export function decimalInput(value, places = 2) {
  if (!Number.isSafeInteger(value)) return '';
  const digits = String(value).padStart(places + 1, '0');
  return `${digits.slice(0, -places)},${digits.slice(-places)}`;
}

export function roundRatio(value, divisor) {
  return (value + divisor / 2n) / divisor;
}

export function calcTotals(invoice) {
  const result = calculate({
    priceMode: invoice.priceMode || 'exclusive',
    discountType: invoice.discount.type,
    discountValue: invoice.discount.value || 0,
    items: invoice.items.map((item) => ({
      quantity: item.qty || 0,
      unitPriceCents: item.unitPrice || 0,
      vatRate: item.vatRate
    }))
  });
  return {
    subtotal: result.subtotalCents,
    discount: result.discountCents,
    base: result.baseCents,
    tax: result.vatCents,
    total: result.totalCents,
    vats: result.vatBreakdown.map((vat) => ({ rate: vat.rate, base: vat.baseCents, amount: vat.vatCents })),
    rows: result.items.map((item, index) => ({
      id: invoice.items[index].id,
      net: item.lineBaseCents,
      vat: item.lineVatCents,
      total: item.lineTotalCents
    }))
  };
}

export function formatMoney(value, currency = 'TRY') {
  const amount = BigInt(value);
  const whole = new Intl.NumberFormat('tr-TR').format(amount / 100n);
  return `${whole},${String(amount % 100n).padStart(2, '0')} ${currency === 'TRY' ? 'TL' : currency}`;
}

export function numberToWords(value) {
  const number = BigInt(value);
  if (number < 0n || number > 999999999999999n) throw new RangeError('Yazıyla sayı sınırı aşıldı.');
  if (number === 0n) return 'sıfır';
  const ones = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
  const tens = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
  const groupWords = (group) => {
    const hundred = Math.floor(group / 100);
    return [
      hundred ? `${hundred === 1 ? '' : `${ones[hundred]} `}yüz` : '',
      tens[Math.floor(group / 10) % 10],
      ones[group % 10]
    ]
      .filter(Boolean)
      .join(' ');
  };
  const units = ['', 'bin', 'milyon', 'milyar', 'trilyon'];
  const parts = [];
  let rest = number;
  for (let index = 0; rest; index++, rest /= 1000n) {
    const group = Number(rest % 1000n);
    if (group)
      parts.unshift(
        index === 1 && group === 1 ? 'bin' : [groupWords(group), units[index]].filter(Boolean).join(' ')
      );
  }
  return parts.join(' ');
}

export function amountToWords(value, currency = 'TRY') {
  const amount = BigInt(value);
  const text = numberToWords(amount / 100n);
  const minor = { TRY: 'kuruş', GBP: 'peni', EUR: 'sent', USD: 'sent' }[currency];
  return `${text[0].toLocaleUpperCase('tr-TR')}${text.slice(1)} ${currency === 'TRY' ? 'TL' : currency}, ${numberToWords(amount % 100n)} ${minor}`;
}

export function tlEquivalent(amount, exchangeRate) {
  if (!Number.isSafeInteger(exchangeRate) || exchangeRate <= 0) return null;
  const value = roundRatio(BigInt(amount) * BigInt(exchangeRate), 1000000n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('TL karşılığı hesaplama sınırını aşıyor.');
  return Number(value);
}

const checkInvoice = (items, priceMode = 'exclusive', discount = { type: 'percent', value: 0 }) => ({
  items,
  priceMode,
  discount
});
const checkItem = (unitPrice, vatRate = 0, qty = 1000) => ({ id: 'a', qty, unitPrice, vatRate });
console.assert(parseMoney('0,1') + parseMoney('0.2') === 30, 'Ondalık girişler kuruşa çevrilir.');
console.assert(parseMoney('1250,99') === 125099 && parseMoney('1250.99') === 125099, 'İki ondalık ayraç.');
console.assert(
  parseMoney('1,234') === null && parseMoney('-1') === null && parseMoney('') === null,
  'Geçersiz tutar.'
);
console.assert(parseScaled('1,125', 3) === 1125, 'Kesirli miktar.');
console.assert(calcTotals(checkInvoice([checkItem(101, 0, 500)])).total === 51, 'Yarım kuruş yuvarlama.');
console.assert(
  calcTotals(checkInvoice([checkItem(10000, 16)], 'exclusive', { type: 'percent', value: 1000 })).total ===
    10440,
  'İskonto sonrası KDV.'
);
console.assert(
  calcTotals(checkInvoice([checkItem(11600, 16)], 'inclusive')).tax === 1600,
  'Dahil fiyattan KDV.'
);
console.assert(
  calcTotals(checkInvoice([checkItem(1, 16)], 'inclusive')).rows[0].total === 1,
  'Kalan kuruş korunur.'
);
console.assert(formatMoney(125030) === '1.250,30 TL', 'TL eki.');
console.assert(amountToWords(125030) === 'Bin iki yüz elli TL, otuz kuruş', 'Yazıyla tutar.');
console.assert(
  numberToWords(0) === 'sıfır' && numberToWords(100) === 'yüz' && numberToWords(1000) === 'bin',
  'Sıfır, yüz ve bin.'
);
console.assert(
  numberToWords(1000000000) === 'bir milyar' &&
    numberToWords(2147483647) === 'iki milyar yüz kırk yedi milyon dört yüz seksen üç bin altı yüz kırk yedi',
  'Milyarlık sayılar.'
);
