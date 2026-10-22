// Oranlar yıllık Katma Değer Vergisi Oranları Tüzüğü ile belirlenir; güncel tüzüğü kontrol edin.
export const vatRatesByYear = {
  2025: [0, 5, 10, 16],
  2026: [0, 5, 10, 16, 20]
};

export const defaultVatRate = 16;

export function getVatTable(issueDate, overrides = {}) {
  const year = Number(issueDate.slice(0, 4));
  const table = { ...vatRatesByYear, ...overrides };
  const selected = Object.keys(table)
    .map(Number)
    .filter((value) => value <= year)
    .sort((a, b) => b - a)[0];
  return selected
    ? { year: selected, rates: [...table[selected]].sort((a, b) => a - b) }
    : { year: null, rates: [] };
}
