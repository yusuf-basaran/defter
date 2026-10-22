import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calcTotals as server } from '../functions/lib/totals.js';
import { calcTotals as client } from '../js/totals.js';
import { calcTotals as preview, parseMoney, numberToWords, amountToWords } from '../js/money.js';
const row = (price, rate = 16, quantity = 1000) => ({
  description: 'Hizmet',
  quantity,
  unitPriceCents: price,
  vatRate: rate,
  exemptionNote: ''
});
const examples = [
  ['exclusive', [row(10000)], 'percent', 0],
  ['inclusive', [row(11600)], 'percent', 0],
  ['exclusive', [row(10, 0), row(20, 0)], 'fixed', 1],
  ['inclusive', [row(1), row(1)], 'fixed', 1],
  ['exclusive', [row(125099, 5, 1500), row(249999, 10), row(399999, 16)], 'percent', 1234],
  ['inclusive', [row(125099, 5, 1500), row(249999, 10), row(399999, 16)], 'percent', 1234],
  ['exclusive', [row(0)], 'percent', 0],
  ['inclusive', [row(100)], 'percent', 10000],
  ['exclusive', [row(101, 20, 500)], 'percent', 0],
  ['inclusive', [row(111, 16, 1125)], 'fixed', 3],
  [
    'exclusive',
    Array.from({ length: 100 }, (_, i) => row(101 + i, [0, 5, 10, 16, 20][i % 5], 1001 + i)),
    'percent',
    3333
  ],
  ['inclusive', [row(999999999999, 20, 1000)], 'percent', 1]
];
for (const [index, [priceMode, items, discountType, discountValue]] of examples.entries())
  test(`istemci / sunucu eşitliği ve kuruş korunumu ${index + 1}`, () => {
    const input = { priceMode, items, discountType, discountValue };
    const expected = server(input);
    assert.deepEqual(client(input), expected);
    const ui = preview({
      priceMode,
      items: items.map((item) => ({
        qty: item.quantity,
        unitPrice: item.unitPriceCents,
        vatRate: item.vatRate
      })),
      discount: { type: discountType, value: discountValue }
    });
    assert.equal(ui.total, expected.totalCents);
    assert.equal(
      expected.items.reduce((sum, item) => sum + item.lineTotalCents, 0),
      expected.totalCents
    );
    assert.equal(
      expected.vatBreakdown.reduce((sum, item) => sum + item.baseCents + item.vatCents, 0),
      expected.totalCents
    );
    for (const item of expected.items)
      assert.equal(item.lineBaseCents + item.lineVatCents, item.lineTotalCents);
  });
test('ortak hesaplama dosyaları birebir aynıdır', async () =>
  assert.equal(await readFile('js/totals.js', 'utf8'), await readFile('functions/lib/totals.js', 'utf8')));
test('para girişleri ve yazıyla tutar', () => {
  assert.equal(parseMoney('0,1') + parseMoney('0.2'), 30);
  assert.equal(amountToWords(125030), 'Bin iki yüz elli TL, otuz kuruş');
  for (const [value, text] of [
    [0, 'sıfır'],
    [1, 'bir'],
    [100, 'yüz'],
    [1000, 'bin'],
    [1000000, 'bir milyon'],
    [1000000000, 'bir milyar'],
    [
      9999999999,
      'dokuz milyar dokuz yüz doksan dokuz milyon dokuz yüz doksan dokuz bin dokuz yüz doksan dokuz'
    ]
  ])
    assert.equal(numberToWords(value), text);
});
test('fazla iskonto ve güvenli aralık dışı tutar reddedilir', () => {
  assert.throws(() =>
    server({ priceMode: 'exclusive', items: [row(1)], discountType: 'fixed', discountValue: 2 })
  );
  assert.throws(() =>
    server({
      priceMode: 'exclusive',
      items: [row(1000000000000, 16, 1000000000)],
      discountType: 'fixed',
      discountValue: 0
    })
  );
});
