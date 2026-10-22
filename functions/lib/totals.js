export function calcTotals(invoice) {
  const inclusive = invoice.priceMode === 'inclusive';
  const rows = invoice.items.map((item) => ({
    amount: (BigInt(item.quantity) * BigInt(item.unitPriceCents) + 500n) / 1000n,
    rate: item.vatRate
  }));
  const subtotal = rows.reduce((sum, row) => sum + row.amount, 0n);
  const discount =
    invoice.discountType === 'percent'
      ? (subtotal * BigInt(invoice.discountValue) + 5000n) / 10000n
      : BigInt(invoice.discountValue);
  if (discount < 0n || discount > subtotal) throw new RangeError('İskonto ara toplamı aşamaz.');
  let allocated = 0n;
  const shares = rows.map((row, index) => {
    const product = row.amount * discount;
    const share = subtotal ? product / subtotal : 0n;
    allocated += share;
    return { index, share, remainder: subtotal ? product % subtotal : 0n };
  });
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
  );
  for (let index = 0; allocated < discount; index++, allocated++) ranked[index].share++;
  const groups = new Map();
  const calculated = rows.map((row, index) => {
    const amount = row.amount - shares[index].share;
    const divisor = 100n + BigInt(row.rate);
    const base = inclusive ? (amount * 100n + divisor / 2n) / divisor : amount;
    const vat = inclusive ? amount - base : (base * BigInt(row.rate) + 50n) / 100n;
    const group = groups.get(row.rate) || { base: 0n, vat: 0n };
    group.base += base;
    group.vat += vat;
    groups.set(row.rate, group);
    return {
      lineBaseCents: checked(base),
      lineVatCents: checked(vat),
      lineDiscountCents: checked(shares[index].share),
      lineTotalCents: checked(base + vat)
    };
  });
  const vat = [...groups.values()].reduce((sum, group) => sum + group.vat, 0n);
  const base = [...groups.values()].reduce((sum, group) => sum + group.base, 0n);
  return {
    subtotalCents: checked(subtotal),
    discountCents: checked(discount),
    baseCents: checked(base),
    vatCents: checked(vat),
    totalCents: checked(base + vat),
    vatBreakdown: [...groups]
      .sort(([a], [b]) => a - b)
      .map(([rate, group]) => ({ rate, baseCents: checked(group.base), vatCents: checked(group.vat) })),
    items: invoice.items.map((item, index) => ({ ...item, ...calculated[index] }))
  };
}

function checked(value) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Tutar hesaplama sınırını aşıyor.');
  return Number(value);
}
