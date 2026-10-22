import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const projectId = args.includes('--project') ? arg('--project') : '';
const email = args.includes('--email') ? arg('--email') : '';
if (!projectId || !email)
  throw new Error(
    'Kullanım: node scripts/set-admin.js --project PROJE --email HESAP [--emulator] [--revoke]'
  );
if (args.includes('--emulator')) {
  if (!projectId.startsWith('demo-')) throw new Error('Emülatör modu demo- projesi gerektirir.');
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}
initializeApp({ projectId, ...(args.includes('--emulator') ? {} : { credential: applicationDefault() }) });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
if (!user.emailVerified) throw new Error('Önce hesabın e-posta adresini doğrulayın.');
const claims = { ...user.customClaims };
if (args.includes('--revoke')) delete claims.platformAdmin;
else claims.platformAdmin = true;
await auth.setCustomUserClaims(user.uid, claims);
process.stdout.write(
  'Yönetici claim’i güncellendi. Hesapta çıkış/giriş yapın veya kimlik belirtecini yenileyin.\n'
);
