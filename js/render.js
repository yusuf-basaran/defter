import {
  state,
  currencies,
  taxOffices,
  statusOf,
  statusLabels,
  typeLabels,
  savedInvoice,
  legalNotice,
  timeZone
} from './state.js';
import { calcTotals, decimalInput, formatMoney, amountToWords, tlEquivalent } from './money.js';
import { getVatTable } from './vat-rates.js';
import { buildPages, removePrintPages } from './pdf.js';

export function escapeHtml(value = '') {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}

export function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}
export const groupIban = (value) => value.replace(/(.{4})/g, '$1 ').trim();

function field(label, path, value, options = {}) {
  const e = escapeHtml;
  const id = `field-${path.replaceAll('.', '-')}`;
  const max =
    options.max ||
    (path.endsWith('address') || path.endsWith('.desc')
      ? 2000
      : path.endsWith('email')
        ? 254
        : path.endsWith('.exemption') || path === 'bankInfo.paymentTerms'
          ? 1000
          : path === 'note'
            ? 5000
            : 200);
  const attrs = `id="${id}" data-field="${path}" aria-describedby="${id}-error" ${options.required ? 'required' : ''} ${options.readonly ? 'readonly' : ''}`;
  const element = options.textarea
    ? `<textarea ${attrs} rows="2" maxlength="${max}" placeholder="${e(options.placeholder || '')}">${e(value)}</textarea>`
    : options.choices
      ? `<select ${attrs}>${options.choices.map(([key, text]) => `<option value="${e(key)}" ${String(value) === String(key) ? 'selected' : ''}>${e(text)}</option>`).join('')}</select>`
      : `<input ${attrs} type="${options.type || 'text'}" value="${e(value)}" ${options.numeric ? 'inputmode="decimal"' : ''} ${options.list ? `list="${options.list}" autocomplete="off"` : ''} maxlength="${max}" placeholder="${e(options.placeholder || '')}">`;
  return `<div class="field ${options.full ? 'full' : ''} ${options.numeric ? 'numeric' : ''}"><label for="${id}">${label}${options.required ? ' <span aria-hidden="true">*</span>' : ''}</label>${element}<span class="field-error" id="${id}-error" hidden></span>${options.note ? `<span class="field-note">${options.note}</span>` : ''}</div>`;
}

function section(number, title, hint, content) {
  return `<section class="form-section"><div class="section-heading"><span class="section-number">${number}</span><h2>${title}</h2>${hint ? `<span class="section-hint">${hint}</span>` : ''}</div>${content}</section>`;
}

export function renderItems() {
  const { items, issueDate } = state.invoice;
  const rates = savedInvoice()
    ? state.invoice.vatRates
    : getVatTable(issueDate, state.settings.vatRates).rates;
  const locked = Boolean(savedInvoice());
  document.querySelector('#item-rows').innerHTML = items
    .map((item, index) => {
      const choices = [...rates];
      if (!choices.includes(item.vatRate)) choices.push(item.vatRate);
      return `<div class="item-row" data-item="${escapeHtml(item.id)}">
      <button type="button" class="drag-handle" draggable="${!locked}" aria-label="${index + 1}. kalemi sırala; klavyede ok düğmelerini kullan" ${locked ? 'disabled' : ''}><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M3 5h.1M8 5h.1M3 10h.1M8 10h.1M3 15h.1M8 15h.1"/></svg></button>
      ${field('Mal / hizmet cinsi', `items.${item.id}.desc`, item.desc, { required: true, placeholder: 'Ürün veya hizmet' })}
      ${field('Miktar', `items.${item.id}.qty`, decimalInput(item.qty, 3).replace(/,000$/, ''), { numeric: true, required: true })}
      ${field('Birim fiyat', `items.${item.id}.unitPrice`, decimalInput(item.unitPrice), { numeric: true, required: true })}
      ${field('KDV', `items.${item.id}.vatRate`, item.vatRate, { choices: choices.map((rate) => [rate, `%${rate}${rates.includes(rate) ? '' : ' · bu yıl yok'}`]) })}
      <div class="row-tools"><button type="button" class="icon-button" data-action="remove-item" data-id="${escapeHtml(item.id)}" aria-label="${index + 1}. kalemi sil" ${items.length === 1 || locked ? 'disabled' : ''}>×</button><button type="button" class="icon-button move-button" data-action="move-up" data-id="${escapeHtml(item.id)}" aria-label="${index + 1}. kalemi yukarı taşı" ${index === 0 || locked ? 'disabled' : ''}>↑</button><button type="button" class="icon-button move-button" data-action="move-down" data-id="${escapeHtml(item.id)}" aria-label="${index + 1}. kalemi aşağı taşı" ${index === items.length - 1 || locked ? 'disabled' : ''}>↓</button></div>
      ${item.vatRate === 0 ? field('İstisna / muafiyet açıklaması', `items.${item.id}.exemption`, item.exemption, { required: true, full: true, textarea: true }) : ''}
    </div>`;
    })
    .join('');
  if (locked)
    document.querySelectorAll('#item-rows input, #item-rows select, #item-rows textarea').forEach((input) => {
      input.disabled = true;
    });
}

export function renderForm() {
  const invoice = state.invoice;
  const { seller, client, bankInfo } = invoice;
  const e = escapeHtml;
  const offices = `<datalist id="tax-offices">${taxOffices.map((office) => `<option value="${office}"></option>`).join('')}</datalist>`;
  const dateNote = 'gg.aa.yyyy';
  const content =
    section(
      '01',
      'Belge bilgileri',
      '* Zorunlu alan',
      `<div class="fields">
    ${field('Belge türü', 'type', invoice.type, { choices: Object.entries(typeLabels) })}
    ${field('Para birimi', 'currency', invoice.currency, { choices: currencies.map((currency) => [currency, currency === 'TRY' ? 'TL' : currency]) })}
    ${field('Seri', 'series', invoice.series, { required: true, max: 20 })}
    ${field('Sıra no', 'sequence', invoice.sequence === null ? 'Düzenlenince verilir' : String(invoice.sequence).padStart(6, '0'), { readonly: true, note: 'Düzenle işleminde sunucu verir; elle değişmez.' })}
    ${field('Düzenleme tarihi', 'issueDate', formatDate(invoice.issueDate).replace('—', ''), { required: true, placeholder: dateNote, max: 10 })}
    ${field('Vade tarihi', 'dueDate', formatDate(invoice.dueDate).replace('—', ''), { required: true, placeholder: dateNote, max: 10 })}
    ${field('Teslim tarihi', 'deliveryDate', formatDate(invoice.deliveryDate).replace('—', ''), { placeholder: dateNote, max: 10 })}
    ${field('Sevk irsaliyesi no', 'dispatchNumber', invoice.dispatchNumber, { max: 100 })}
    ${invoice.currency !== 'TRY' ? field(`Kur · 1 ${invoice.currency} kaç TL?`, 'exchangeRate', invoice.exchangeRate === null ? '' : decimalInput(invoice.exchangeRate, 6), { numeric: true, full: true, note: 'İsteğe bağlı; elle girilir. En fazla 6 ondalık.' }) : ''}
    </div>`
    ) +
    section(
      '02',
      'Satıcı',
      'Yeni belgeler için hatırlanır',
      `<div class="logo-control">${seller.logo ? `<img class="logo-preview" src="${e(seller.logo)}" alt="Firma logosu">` : ''}<div class="field"><label for="logo-file">Firma logosu</label><input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="logo-hint"><span class="field-note" id="logo-hint">PNG, JPG veya WebP · En fazla 500 KB</span></div>${seller.logo ? '<button type="button" class="text-button" data-action="remove-logo">Kaldır</button>' : ''}</div><div class="fields">
    ${field('Ad / unvan', 'seller.name', seller.name, { required: true, full: true })}
    ${field('Adres', 'seller.address', seller.address, { required: true, textarea: true, full: true })}
    ${field('Telefon', 'seller.phone', seller.phone, { type: 'tel' })}${field('E-posta', 'seller.email', seller.email, { type: 'email' })}
    ${field('Vergi dairesi', 'seller.taxOffice', seller.taxOffice, { required: true, list: 'tax-offices', max: 100 })}
    ${field('Vergi numarası', 'seller.taxNumber', seller.taxNumber, { required: true, max: 40 })}${offices}</div>`
    ) +
    section(
      '03',
      'Alıcı',
      'Önceki alıcılardan seçebilirsin',
      `<div class="fields">
    ${field('Ad / unvan', 'client.name', client.name, { required: true, full: true, list: 'client-list' })}
    <datalist id="client-list">${[...new Set(state.clients.map((row) => row.name))].map((name) => `<option value="${e(name)}"></option>`).join('')}</datalist>
    ${field('Adres', 'client.address', client.address, { required: true, textarea: true, full: true })}
    ${field('E-posta', 'client.email', client.email, { type: 'email', full: true })}
    ${field('Vergi dairesi · varsa', 'client.taxOffice', client.taxOffice, { list: 'tax-offices', max: 100 })}
    ${field('Vergi numarası · varsa', 'client.taxNumber', client.taxNumber, { max: 40 })}</div>`
    ) +
    section(
      '04',
      'Kalemler',
      '',
      `<div class="fields price-options">${field('Fiyat girişi', 'priceMode', invoice.priceMode, {
        full: true,
        choices: [
          ['exclusive', 'KDV hariç'],
          ['inclusive', 'KDV dahil']
        ]
      })}</div><p class="field-note" id="vat-year-note"></p><div class="item-labels"><span>Mal / hizmet cinsi</span><span>Miktar</span><span>Birim fiyat</span><span>KDV</span><span></span></div><div id="item-rows"></div><button type="button" class="add-row" data-action="add-item"><span aria-hidden="true">+</span>Kalem ekle</button><div class="discount-row">${field(
        'İskonto türü',
        'discount.type',
        invoice.discount.type,
        {
          choices: [
            ['percent', 'Yüzde (%)'],
            ['fixed', 'Sabit tutar']
          ]
        }
      )}${field('İskonto', 'discount.value', decimalInput(invoice.discount.value), { numeric: true })}</div><p class="field-note">Fiyat modu değişince girdiğin fiyat korunur; yeni moda göre yeniden hesaplanır.</p><div id="form-totals" class="form-totals"></div>`
    ) +
    section(
      '05',
      'Not ve ödeme',
      '',
      `<div class="fields">${field('Belge notu', 'note', invoice.note, { textarea: true, full: true })}${field('Ödeme koşulları', 'bankInfo.paymentTerms', bankInfo.paymentTerms, { textarea: true, full: true })}${field('Banka adı', 'bankInfo.bankName', bankInfo.bankName)}${field('Şube', 'bankInfo.branch', bankInfo.branch)}${field('Hesap sahibi', 'bankInfo.accountHolder', bankInfo.accountHolder, { full: true })}${field('IBAN', 'bankInfo.iban', groupIban(bankInfo.iban), { full: true, max: 48, note: 'İsteğe bağlı. Ülke kodu kısıtlanmaz; kontrol sonucu yalnızca uyarıdır.' })}<p class="iban-warning full" id="iban-warning" role="status" hidden></p></div>`
    ) +
    section(
      '06',
      'Belge görünümü',
      '',
      `<fieldset class="template-options"><legend>Şablon</legend>${[
        ['classic', 'Klasik'],
        ['plain', 'Düz'],
        ['stripe', 'Şerit']
      ]
        .map(
          ([value, name]) =>
            `<label class="template-choice"><input type="radio" name="template" data-field="template" value="${value}" ${invoice.template === value ? 'checked' : ''}>${name}</label>`
        )
        .join(
          ''
        )}</fieldset><div class="accent-field"><label for="field-accent">Vurgu rengi</label><input type="color" id="field-accent" data-field="accent" value="${invoice.accent}"></div>`
    );
  document.querySelector('#invoice-form').innerHTML =
    `<fieldset class="document-fields" ${savedInvoice() ? 'disabled' : ''}><legend class="sr-only">Belge alanları</legend>${content}</fieldset>`;
  renderItems();
  const saved = savedInvoice();
  document.querySelector('[data-action="save"]').hidden = Boolean(saved);
  document.querySelector('[data-action="issue"]').hidden = Boolean(saved);
  document.querySelector('[data-action="paid"]').hidden = !saved || invoice.cloudStatus !== 'issued';
  document.querySelector('[data-action="cancel-current"]').hidden =
    !saved || invoice.cloudStatus === 'cancelled';
  document.querySelectorAll('[data-field^="seller."], [data-field^="bankInfo."]').forEach((input) => {
    if (input.dataset.field !== 'bankInfo.paymentTerms') input.disabled = true;
  });
  document.querySelector('#logo-file').disabled = true;
  document.querySelector('[data-action="discard"]').hidden = Boolean(saved);
  document.querySelector('#archive-state').textContent = saved
    ? `Suret saklanıyor · ${formatDate(saved.savedAt.slice(0, 10))} · İçerik kilitli`
    : 'Numara henüz kesinleşmedi.';
  document.querySelector('#editor-view h1').textContent = saved ? 'Kayıtlı belge' : 'Yeni fatura';
}

function totalsHtml(totals, invoice) {
  const currency = invoice.currency;
  const converted =
    currency !== 'TRY' && invoice.exchangeRate > 0 ? tlEquivalent(totals.total, invoice.exchangeRate) : null;
  return `<div class="total-line"><span>Ara toplam · ${invoice.priceMode === 'inclusive' ? 'KDV dahil' : 'KDV hariç'}</span><span>${formatMoney(totals.subtotal, currency)}</span></div>
    ${totals.discount ? `<div class="total-line"><span>İskonto</span><span>−${formatMoney(totals.discount, currency)}</span></div>` : ''}
    ${totals.vats.map((vat) => `<div class="total-line"><span>KDV %${vat.rate} matrahı</span><span>${formatMoney(vat.base, currency)}</span></div><div class="total-line"><span>KDV %${vat.rate} tutarı</span><span>${formatMoney(vat.amount, currency)}</span></div>`).join('')}
    <div class="total-line grand"><span>Genel toplam</span><span>${formatMoney(totals.total, currency)}</span></div>
    ${converted !== null ? `<div class="total-line"><span>TL karşılığı</span><span>${formatMoney(converted)}</span></div><p class="field-note">Kur: 1 ${currency} = ${decimalInput(invoice.exchangeRate, 6)} TL</p>` : ''}`;
}

export function renderPreview() {
  const invoice = state.invoice;
  const { seller, client, bankInfo } = invoice;
  const e = escapeHtml;
  let totals;
  try {
    totals = calcTotals(invoice);
  } catch {
    totals = { subtotal: 0, discount: 0, base: 0, tax: 0, total: 0, vats: [], rows: [] };
  }
  let summary;
  try {
    summary = totalsHtml(totals, invoice);
  } catch {
    summary = '<p class="field-error">Tutar veya kur hesaplama sınırını aşıyor.</p>';
  }
  document.querySelector('#form-totals').innerHTML = summary;
  const table = getVatTable(invoice.issueDate, state.settings.vatRates);
  document.querySelector('#vat-year-note').textContent = savedInvoice()
    ? 'Kaydedildiği tarihteki oranlar korunuyor.'
    : table.year
      ? `${table.year} yılı tablosu kullanılıyor. Güncel tüzüğü kontrol edin.`
      : 'Bu yıl veya öncesi için KDV tablosu yok; Ayarlar’dan ekleyin.';
  document.querySelector('#invoice-preview').innerHTML =
    `<article class="invoice-paper ${invoice.template}" style="--doc-accent: ${invoice.accent}" aria-label="Fatura belgesi">
    <header class="invoice-header"><div class="invoice-seller">${seller.logo ? `<img class="invoice-logo" src="${e(seller.logo)}" alt="Firma logosu">` : ''}<h2>${e(seller.name || 'Satıcı adı / unvanı')}</h2><p class="invoice-address">${e(seller.address)}${seller.phone || seller.email ? `\n${e([seller.phone, seller.email].filter(Boolean).join(' · '))}` : ''}\nVergi dairesi: ${e(seller.taxOffice)}\nVergi numarası: ${e(seller.taxNumber)}</p></div><div class="invoice-heading"><div class="copy-label">ASIL</div><div class="invoice-title">${typeLabels[invoice.type]}</div><div class="invoice-number">Seri: ${e(invoice.series)} · Sıra: ${invoice.sequence === null ? 'Düzenlenince verilir' : String(invoice.sequence).padStart(6, '0')}</div>${invoice.legacyNumber ? `<p class="legacy-number">Önceki kayıt: ${e(invoice.legacyNumber)}</p>` : ''}${!invoice.savedAt ? '<p class="document-draft">KAYDEDİLMEMİŞ TASLAK</p>' : ''}${invoice.status === 'cancelled' ? '<span class="cancel-stamp">İPTAL</span>' : ''}</div></header>
    <div class="invoice-parties"><div><div class="invoice-kicker">ALICI</div><p class="invoice-client-name">${e(client.name || 'Alıcı adı / unvanı')}</p><p class="invoice-address">${e([client.address, client.email, client.taxOffice ? `Vergi dairesi: ${client.taxOffice}` : '', client.taxNumber ? `Vergi numarası: ${client.taxNumber}` : ''].filter(Boolean).join('\n'))}</p></div><dl class="invoice-dates"><div><dt>Düzenleme tarihi</dt><dd>${formatDate(invoice.issueDate)}</dd></div><div><dt>Vade tarihi</dt><dd>${formatDate(invoice.dueDate)}</dd></div>${invoice.deliveryDate ? `<div><dt>Teslim tarihi</dt><dd>${formatDate(invoice.deliveryDate)}</dd></div>` : ''}${invoice.dispatchNumber ? `<div><dt>Sevk irsaliyesi no</dt><dd>${e(invoice.dispatchNumber)}</dd></div>` : ''}<div><dt>Para birimi</dt><dd>${invoice.currency === 'TRY' ? 'TL' : invoice.currency}</dd></div></dl></div>
    <table class="invoice-table"><colgroup><col><col><col><col><col><col><col></colgroup><thead><tr><th scope="col">MAL / HİZMET CİNSİ</th><th scope="col">MİKTAR</th><th scope="col">BİRİM FİYAT<br>${invoice.priceMode === 'inclusive' ? 'KDV DAHİL' : 'KDV HARİÇ'}</th><th scope="col">MATRAH</th><th scope="col">KDV</th><th scope="col">KDV TUTARI</th><th scope="col">TOPLAM</th></tr></thead><tbody>${invoice.items
      .map((item, index) => {
        const row = totals.rows[index] || { net: 0, vat: 0, total: 0 };
        return `<tr><td class="desc">${e(item.desc || 'Mal / hizmet cinsi')}${item.vatRate === 0 ? `\nİstisna / muafiyet: ${e(item.exemption || 'Açıklama girilmedi')}` : ''}</td><td>${decimalInput(item.qty, 3).replace(/,?0+$/, '') || '0'}</td><td>${formatMoney(item.unitPrice || 0, invoice.currency)}</td><td>${formatMoney(row.net, invoice.currency)}</td><td>%${item.vatRate}</td><td>${formatMoney(row.vat, invoice.currency)}</td><td>${formatMoney(row.total, invoice.currency)}</td></tr>`;
      })
      .join('')}</tbody></table>
    <div class="invoice-totals">${summary}</div>
    ${invoice.showAmountWords ? `<section class="invoice-notes amount-words"><h3>YALNIZ</h3><p>${e(amountToWords(totals.total, invoice.currency))}</p></section>` : ''}
    ${invoice.note ? `<section class="invoice-notes"><h3>NOT</h3><p>${e(invoice.note)}</p></section>` : ''}
    ${Object.values(bankInfo).some(Boolean) ? `<section class="invoice-notes"><h3>ÖDEME BİLGİLERİ</h3>${bankInfo.paymentTerms ? `<p>${e(bankInfo.paymentTerms)}</p>` : ''}<p>${e([bankInfo.bankName, bankInfo.branch, bankInfo.accountHolder].filter(Boolean).join(' · '))}</p>${bankInfo.iban ? `<p class="invoice-bank">${e(groupIban(bankInfo.iban))}</p>` : ''}</section>` : ''}
    <footer class="invoice-footer"><span>${e(seller.name || 'Defter')} · ${e(invoice.number)}${invoice.type === 'proforma' ? '<br>Mali değeri yoktur, proforma faturadır' : ''}</span><span>1 / 1</span></footer></article>`;
  document.querySelector('#document-number').textContent = invoice.number;
  document.querySelector('#editor-status').textContent = statusLabels[statusOf(invoice)];
  document.querySelector('#editor-status').className = `status-tag ${statusOf(invoice)}`;
  document.querySelector('#total-announcement').textContent =
    `Genel toplam ${formatMoney(totals.total, invoice.currency)}`;
  const article = document.querySelector('#invoice-preview .invoice-paper');
  let source = document.querySelector('#invoice-source');
  if (!source) {
    source = document.createElement('div');
    source.id = 'invoice-source';
    source.className = 'pdf-host';
    source.setAttribute('aria-hidden', 'true');
    document.body.append(source);
  }
  source.replaceChildren(article);
  try {
    document.querySelector('#invoice-preview').replaceChildren(...buildPages(article));
  } catch {
    document.querySelector('#invoice-preview').append(article.cloneNode(true));
  } finally {
    removePrintPages();
  }
  scalePreview();
}

export function scalePreview() {
  const stage = document.querySelector('#preview-stage');
  const preview = document.querySelector('#invoice-preview');
  if (!stage.clientWidth || !preview.firstElementChild) return;
  const scale = Math.min(1, stage.clientWidth / 794);
  preview.style.transform = `scale(${scale})`;
  stage.style.height = `${Math.ceil(preview.offsetHeight * scale)}px`;
  document.querySelector('#preview-page-count').textContent = `${preview.children.length} sayfa`;
}

export function renderSummary() {
  const sums = { base: 0n, vat: 0n, total: 0n };
  const currency = state.business?.defaultCurrency || 'TRY';
  for (const group of state.monthly)
    if (group.currency === currency) {
      sums.base += BigInt(group.baseCents);
      sums.vat += BigInt(group.vatCents);
      sums.total += BigInt(group.totalCents);
    }
  document.querySelector('#summary').innerHTML =
    `<div class="summary-cell"><span class="summary-label">Düzenlenmiş belge · tüm zamanlar</span><span class="summary-value">${state.business?.invoiceCount || 0}<span class="small muted"> adet</span></span></div><div class="summary-cell"><span class="summary-label">${escapeHtml(state.month)} · Matrah</span><span class="summary-value">${formatMoney(sums.base, currency)}</span></div><div class="summary-cell"><span class="summary-label">${escapeHtml(state.month)} · KDV</span><span class="summary-value">${formatMoney(sums.vat, currency)}</span></div><div class="summary-cell paid"><span class="summary-label">${escapeHtml(state.month)} · Genel toplam</span><span class="summary-value">${formatMoney(sums.total, currency)}</span></div>`;
  document.querySelector('#history-count').textContent = state.invoices.length;
}

export function renderHistory() {
  const e = escapeHtml;
  document.querySelector('#history-list').innerHTML = state.invoices.length
    ? `<table class="history-table"><caption class="sr-only">Kayıtlı belgeler · sayfa ${state.pageIndex + 1}</caption><thead><tr><th scope="col">Seri-sıra / tarih</th><th scope="col">Alıcı</th><th scope="col">Durum</th><th scope="col" class="amount">Tutar</th><th scope="col">İşlemler</th></tr></thead><tbody>${state.invoices.map((invoice) => `<tr><td data-label="Belge"><button class="history-number" data-action="edit" data-id="${e(invoice.remoteId)}">${e(invoice.number)}</button><span class="history-date">${formatDate(invoice.issueDate)} · ${typeLabels[invoice.type]}</span></td><td data-label="Alıcı">${e(invoice.client.name)}</td><td data-label="Durum"><span class="status-tag ${statusOf(invoice)}">${statusLabels[statusOf(invoice)]}</span></td><td data-label="Tutar" class="amount">${formatMoney(calcTotals(invoice).total, invoice.currency)}</td><td><div class="history-actions"><button data-action="edit" data-id="${e(invoice.remoteId)}">${invoice.cloudStatus === 'draft' ? 'Taslağı aç' : 'Sureti aç'}</button><button data-action="copy" data-id="${e(invoice.remoteId)}" data-write>Kopyala</button>${invoice.cloudStatus === 'draft' ? `<button data-action="delete-draft" data-id="${e(invoice.remoteId)}" data-write>Taslağı sil</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty-state"><h2>Bu görünümde belge yok.</h2><p>Aramayı değiştirebilir veya yeni bir taslak oluşturabilirsin.</p><button class="button secondary" data-action="new" data-write>Fatura oluştur</button></div>';
  document.querySelector('#page-count').textContent =
    `${state.pageIndex + 1}. sayfa · ${state.invoices.length} belge${state.cached ? ' · önbellek' : ''}`;
  document.querySelector('[data-action="page-prev"]').disabled = state.pageIndex === 0;
  document.querySelector('[data-action="page-next"]').disabled = !state.pageAfter;
}

export function renderMonthly() {
  document.querySelector('#summary-month').value = state.month;
  document.querySelector('#monthly-summary').innerHTML = state.monthly.length
    ? state.monthly
        .map(
          (group) =>
            `<section class="monthly-group"><h2>${group.currency === 'TRY' ? 'TL' : group.currency}<span class="small muted"> · ${group.count} fatura</span></h2><dl class="monthly-totals"><div><dt>Matrah toplamı</dt><dd>${formatMoney(group.baseCents, group.currency)}</dd></div><div><dt>KDV toplamı</dt><dd>${formatMoney(group.vatCents, group.currency)}</dd></div><div><dt>Genel toplam</dt><dd>${formatMoney(group.totalCents, group.currency)}</dd></div></dl><table class="monthly-table"><caption class="sr-only">${group.currency} KDV özeti</caption><thead><tr><th scope="col">Oran</th><th scope="col">Matrah</th><th scope="col">KDV tutarı</th></tr></thead><tbody>${group.vatBreakdown.map((vat) => `<tr><th scope="row">%${vat.rate}</th><td>${formatMoney(vat.baseCents, group.currency)}</td><td>${formatMoney(vat.vatCents, group.currency)}</td></tr>`).join('')}</tbody></table></section>`
        )
        .join('')
    : '<div class="empty-state"><h2>Bu ay için düzenlenmiş fatura yok.</h2><p>Proforma, iptal ve taslak belgeler özete dahil edilmez.</p></div>';
}
export function monthlyCsv() {
  const amount = (value) => `${BigInt(value) / 100n},${String(BigInt(value) % 100n).padStart(2, '0')}`;
  const rows = [['Dönem', 'Para birimi', 'Satır', 'KDV oranı', 'Matrah', 'KDV tutarı', 'Genel toplam']];
  for (const group of state.monthly) {
    for (const vat of group.vatBreakdown)
      rows.push([
        state.month,
        group.currency,
        'Oran',
        vat.rate,
        amount(vat.baseCents),
        amount(vat.vatCents),
        ''
      ]);
    rows.push([
      state.month,
      group.currency,
      'Toplam',
      '',
      amount(group.baseCents),
      amount(group.vatCents),
      amount(group.totalCents)
    ]);
  }
  return csvRows(rows);
}
export function csvRows(rows) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value ?? '');
            return `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
          })
          .join(';')
      )
      .join('\r\n')
  );
}

export function renderSettings() {
  const business = state.business;
  const e = escapeHtml;
  const field = (key, label, full = false) =>
    `<div class="field ${full ? 'full' : ''}"><label for="business-${key}">${label}</label><input id="business-${key}" data-business="${key}" value="${e(business[key] || '')}" maxlength="${key === 'address' ? 2000 : key === 'taxNumber' ? 40 : key === 'email' ? 254 : 200}"></div>`;
  const table = getVatTable(`${state.settingsYear}-01-01`, state.settings.vatRates);
  document.querySelector('#settings-form').innerHTML =
    `<fieldset class="document-fields" ${state.role !== 'owner' ? 'disabled' : ''}><legend class="sr-only">İşletme ayarları</legend><section class="settings-section"><h2>İşletme bilgileri</h2><div class="fields">${field('name', 'İşletme kısa adı')}${field('legalName', 'Resmî ad / unvan')}${field('address', 'Adres', true)}${field('phone', 'Telefon')}${field('email', 'E-posta')}${field('taxOffice', 'Vergi dairesi')}${field('taxNumber', 'Vergi numarası')}${field('bankName', 'Banka')}${field('bankBranch', 'Şube')}${field('bankHolder', 'Hesap sahibi')}${field('bankIban', 'IBAN')}<div class="field"><label for="default-currency">Varsayılan para birimi</label><select id="default-currency">${currencies.map((currency) => `<option value="${currency}" ${business.defaultCurrency === currency ? 'selected' : ''}>${currency === 'TRY' ? 'TL' : currency}</option>`).join('')}</select></div><label class="check-setting" for="amount-words"><input id="amount-words" type="checkbox" ${business.showAmountWords ? 'checked' : ''}>Toplamı yazıyla göster</label><div class="field full"><label for="business-logo">İşletme logosu</label><input id="business-logo" type="file" accept="image/png,image/jpeg,image/webp"><span class="field-note">Görsel yeniden kodlanır ve 500 KB’a küçültülür. Eski logolar, suretler için korunur.</span></div></div><button type="button" class="button secondary" data-action="save-business" data-write>İşletmeyi kaydet</button></section>
    <section class="settings-section"><h2>Seriler</h2><p class="small muted">${state.series.map((series) => `${e(series.kind)} / ${e(series.prefix)} · sonraki ${series.nextNumber}`).join('<br>')}</p><div class="fields"><div class="field"><label for="new-series">Yeni seri</label><input id="new-series" maxlength="20" pattern="[A-Z0-9_]+"></div><div class="field"><label for="series-kind">Belge türü</label><select id="series-kind"><option value="invoice">Fatura</option><option value="proforma">Proforma</option></select></div></div><button type="button" class="button secondary" data-action="create-series" data-write>Seri ekle</button></section>
    <section class="settings-section"><h2>KDV oranları</h2><p class="muted small">Güncel Katma Değer Vergisi Oranları Tüzüğü’nü kontrol edin. Bu ayarlar yasal doğrulama sayılmaz.</p><div class="field vat-year-field"><label for="vat-year">Tablo yılı</label><input id="vat-year" type="number" min="1900" max="9999" value="${e(state.settingsYear)}"></div><ul class="rate-list">${table.rates.map((rate) => `<li><span>%${rate}</span><button type="button" data-action="remove-rate" data-rate="${rate}" data-write aria-label="%${rate} oranını kaldır">Sil</button></li>`).join('')}</ul><div class="add-rate-row"><div class="field"><label for="new-rate">Yeni oran (%)</label><input id="new-rate" type="number" min="0" max="100"></div><button type="button" class="button secondary" data-action="add-rate" data-write>Oran ekle</button></div></section></fieldset>
    <section class="settings-section"><h2>Üyeler ve davet</h2><div id="members-list">${state.members.map((member) => `<p>${e(member.email)} · ${e(member.role)}${state.role === 'owner' ? ` <button type="button" class="text-button" data-action="remove-member" data-id="${e(member.uid)}" data-write>Üyeyi kaldır</button><label class="sr-only" for="role-${e(member.uid)}">${e(member.email)} rolü</label><select id="role-${e(member.uid)}" data-member-role="${e(member.uid)}" data-write>${['owner', 'accountant', 'staff'].map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role}</option>`).join('')}</select>` : ''}</p>`).join('')}</div>${state.role === 'owner' ? '<div class="fields"><div class="field"><label for="invite-email">Davet e-postası</label><input id="invite-email" type="email" maxlength="254"></div><div class="field"><label for="invite-role">Rol</label><select id="invite-role"><option value="staff">Personel</option><option value="accountant">Muhasebeci</option><option value="owner">İşletme sahibi</option></select></div></div><button type="button" class="button secondary" data-action="invite" data-write>Davet bağlantısı oluştur</button><div class="field"><label for="invite-link">Davet bağlantısı</label><input id="invite-link" readonly><span class="field-note">Bağlantıyı kendiniz iletin. Uygulama e-posta göndermez.</span></div>' : ''}</section>
    ${state.role === 'owner' ? `<section class="settings-section"><h2>İşlem kayıtları</h2><div id="audit-list">${state.audit.map((entry) => `<p class="small">${e(entry.action)} · ${e(entry.entityId)} · ${e(entry.createdAt?.toDate().toLocaleString('tr-TR', { timeZone }))}</p>`).join('')}</div><button type="button" class="button quiet" data-action="audit-next" ${state.auditAfter ? '' : 'disabled'}>Sonraki 50 kayıt</button></section>` : ''}
    <section class="settings-section legal-note"><h2>Kullanım notu</h2><p>${legalNotice}</p><p class="small muted">Zaman dilimi: ${timeZone}. Düzenlenmiş belgelerin içeriği değiştirilemez. Yetkili kullanıcı ödeme veya iptal durumunu güncelleyebilir.</p></section>`;
}
