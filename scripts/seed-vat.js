import { createRequire } from 'node:module';
import { vatRatesByYear } from '../js/vat-rates.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const args = process.argv.slice(2);
const projectId = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !projectId)
  throw new Error('Kullanım: node scripts/seed-vat.js --project PROJE [--emulator]');
if (args.includes('--emulator')) {
  if (!projectId.startsWith('demo-')) throw new Error('Emülatör modu demo- projesi gerektirir.');
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
} else if (!args.includes('--rates-reviewed'))
  throw new Error('Oranları güncel tüzükten doğruladıktan sonra --rates-reviewed kullanın.');
initializeApp({ projectId, ...(args.includes('--emulator') ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
await db.runTransaction(async (tx) => {
  const refs = Object.keys(vatRatesByYear).map((year) => db.doc(`vatRates/${year}`));
  const existing = await tx.getAll(...refs);
  existing.forEach((doc, index) => {
    if (!doc.exists)
      tx.create(refs[index], { rates: vatRatesByYear[refs[index].id], year: Number(refs[index].id) });
    else if (doc.data().year === undefined) tx.update(refs[index], { year: Number(refs[index].id) });
  });
});
process.stdout.write('Eksik KDV tabloları eklendi. Mevcut tablolar değiştirilmedi.\n');
