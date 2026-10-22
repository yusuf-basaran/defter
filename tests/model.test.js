import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, validIban, newInvoice, savedInvoice, state } from '../js/state.js';
import { toDraft, fromInvoice } from '../js/model.js';
import { business } from './fixtures.js';
test('Nicosia günü UTC gün sınırında doğru belirlenir', () =>
  assert.equal(today(new Date('2026-01-01T22:30:00Z')), '2026-01-02'));
test('genel IBAN ülke koduna kilitlenmez', () => {
  assert.equal(validIban('GB82 WEST 1234 5698 7654 32'), true);
  assert.equal(validIban('DE89370400440532013000'), true);
  assert.equal(validIban('GB82WEST12345698765431'), false);
});
test('taslak numara üretmez ve bulut modeli kuruş değerini korur', () => {
  const invoice = newInvoice();
  assert.equal(invoice.sequence, null);
  const data = toDraft(invoice, business());
  assert.equal(data.items[0].unitPriceCents, 0);
  const restored = fromInvoice({
    ...data,
    id: 'draft',
    number: null,
    status: 'draft',
    createdAt: null,
    updatedAt: null
  });
  assert.equal(restored.number, 'Taslak');
  state.invoice = restored;
  assert.equal(savedInvoice(), null);
});

test('eski belgeler ve taslaklar ayrı, numaraları korunarak dönüştürülür', async () => {
  const { convertLegacy } = await import('../js/migrate.js');
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile('docs/example-legacy.json', 'utf8'));
  const result = convertLegacy(data);
  assert.equal(result.invoices.length, 3);
  assert.deepEqual(result.errors, []);
  assert.equal(result.invoices[0].status, 'issued');
  assert.equal(result.invoices[0].number, 1);
  assert.equal(result.invoices[0].items[0].unitPriceCents, 125000);
  const drafts = convertLegacy({ invoices: [{ ...data.invoices[0], status: 'draft' }] });
  assert.equal(drafts.drafts.length, 1);
  assert.equal(drafts.invoices.length, 0);
  assert.equal(drafts.drafts[0].sequence, null);
});
