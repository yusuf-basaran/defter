import { state } from './state.js';

export function pdfFilename(invoice = state.invoice) {
  const simplify = (text) =>
    text
      .replace(
        /[çÇğĞıİöÖşŞüÜ]/g,
        (char) =>
          ({
            ç: 'c',
            Ç: 'C',
            ğ: 'g',
            Ğ: 'G',
            ı: 'i',
            İ: 'I',
            ö: 'o',
            Ö: 'O',
            ş: 's',
            Ş: 'S',
            ü: 'u',
            Ü: 'U'
          })[char]
      )
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  const number = invoice.number.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return `${number}_${simplify(invoice.client.name) || 'musteri'}.pdf`;
}

export function removePrintPages() {
  document.querySelector('#print-pages')?.remove();
}

export function buildPages(
  source = document.querySelector('#invoice-source .invoice-paper'),
  copies = state.copies
) {
  removePrintPages();
  const host = document.createElement('div');
  host.id = 'print-pages';
  host.className = 'pdf-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  let page;
  let table;
  let body;
  const fits = () => {
    const footer = page.querySelector('.invoice-footer');
    const last = page.children[page.children.length - 2];
    return last.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top - 16;
  };
  const startPage = () => {
    page = source.cloneNode(false);
    page.classList.add('pdf-page');
    page.style.minHeight = '';
    page.append(source.querySelector('.invoice-header').cloneNode(true));
    if (!host.children.length) page.append(source.querySelector('.invoice-parties').cloneNode(true));
    table = source.querySelector('.invoice-table').cloneNode(true);
    table.querySelector('tbody').replaceChildren();
    page.append(table);
    body = table.querySelector('tbody');
    page.append(source.querySelector('.invoice-footer').cloneNode(true));
    host.append(page);
    if (!fits())
      throw new Error('Gönderen veya müşteri bilgileri bir sayfaya sığmıyor. Adres metnini kısaltın.');
  };
  const insert = (node) => page.insertBefore(node, page.querySelector('.invoice-footer'));
  startPage();
  for (const original of source.querySelectorAll('tbody tr')) {
    let row = original.cloneNode(true);
    body.append(row);
    if (fits()) continue;
    row.remove();
    if (body.children.length) startPage();
    body.append(row);
    if (fits()) continue;
    // Çok uzun açıklamalar devam satırına taşınır; parasal değer yalnızca ilkinde kalır.
    const text = row.cells[0].textContent;
    row.cells[0].textContent = '';
    let offset = 0;
    while (offset < text.length) {
      let low = 1;
      let high = text.length - offset;
      let accepted = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        row.cells[0].textContent = text.slice(offset, offset + middle);
        if (fits()) {
          accepted = middle;
          low = middle + 1;
        } else high = middle - 1;
      }
      if (!accepted)
        throw new Error('Bu kalem sayfaya yerleşemedi. Firma bilgilerini veya açıklamayı kısaltın.');
      const part = text.slice(offset, offset + accepted);
      const boundary = part.lastIndexOf(' ');
      if (accepted < text.length - offset && boundary > accepted / 2) accepted = boundary + 1;
      row.cells[0].textContent = text.slice(offset, offset + accepted);
      offset += accepted;
      if (offset < text.length) {
        startPage();
        row = original.cloneNode(true);
        for (const cell of [...row.cells].slice(1)) cell.textContent = '';
        row.cells[0].textContent = '';
        row.cells[0].classList.add('continuation');
        body.append(row);
      }
    }
  }
  const originalTotals = source.querySelector('.invoice-totals');
  let totals = originalTotals.cloneNode(false);
  insert(totals);
  for (const original of originalTotals.children) {
    const row = original.cloneNode(true);
    totals.append(row);
    if (!fits()) {
      row.remove();
      if (!totals.children.length) totals.remove();
      startPage();
      totals = originalTotals.cloneNode(false);
      insert(totals);
      totals.append(row);
      if (!fits()) throw new Error('Toplam satırı sayfaya sığmıyor.');
    }
  }
  for (const note of source.querySelectorAll('.invoice-notes')) {
    let block = note.cloneNode(false);
    block.append(note.querySelector('h3').cloneNode(true));
    insert(block);
    for (const paragraph of note.querySelectorAll('p')) {
      let remaining = paragraph.textContent;
      if (!remaining) continue;
      let current = block;
      while (remaining.length) {
        const part = paragraph.cloneNode(false);
        current.append(part);
        let low = 1;
        let high = remaining.length;
        let accepted = 0;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          part.textContent = remaining.slice(0, middle);
          if (fits()) {
            accepted = middle;
            low = middle + 1;
          } else high = middle - 1;
        }
        if (!accepted) {
          part.remove();
          if (current.children.length === 1) current.remove();
          startPage();
          current = note.cloneNode(false);
          current.append(note.querySelector('h3').cloneNode(true));
          insert(current);
          continue;
        }
        const boundary = remaining.slice(0, accepted).lastIndexOf(' ');
        if (accepted < remaining.length && boundary > accepted / 2) accepted = boundary + 1;
        part.textContent = remaining.slice(0, accepted);
        remaining = remaining.slice(accepted);
        if (remaining) {
          startPage();
          current = note.cloneNode(false);
          current.append(note.querySelector('h3').cloneNode(true));
          insert(current);
        }
      }
      block = current;
    }
  }
  const pages = [...host.children];
  const labels = copies === 'both' ? ['ASIL', 'SURET'] : [copies === 'copy' ? 'SURET' : 'ASIL'];
  const output = [];
  for (const label of labels) {
    for (const [index, original] of pages.entries()) {
      const paper = original.cloneNode(true);
      paper.querySelector('.copy-label').textContent = label;
      paper.querySelector('.invoice-footer span:last-child').textContent = `${index + 1} / ${pages.length}`;
      output.push(paper);
    }
  }
  host.replaceChildren(...output);
  return output;
}

async function preparePages() {
  await document.fonts.ready;
  const images = [...document.querySelectorAll('#invoice-preview img')];
  await Promise.all(images.map((img) => img.decode().catch(() => {})));
  return buildPages();
}

export async function downloadPdf() {
  if (!window.html2pdf)
    throw new Error(
      'PDF aracı yüklenemedi. İnternet bağlantısını kontrol edin veya Yazdır ile PDF olarak kaydedin.'
    );
  const pages = await preparePages();
  try {
    const options = {
      margin: 0,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 1.5, useCORS: true, backgroundColor: '#fffdf8', logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    const first = window.html2pdf().set(options).from(pages[0]).toPdf();
    const pdf = await first.get('pdf');
    for (const page of pages.slice(1)) {
      const canvas = await window.html2pdf().set(options).from(page).toCanvas().get('canvas');
      pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, 210, 297);
    }
    await pdf.save(pdfFilename(), { returnPromise: true });
    return pages.length;
  } finally {
    removePrintPages();
  }
}

export async function printInvoice() {
  await preparePages();
  window.print();
}
