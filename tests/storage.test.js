import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
let env;
const objectPath = `businesses/logo/logo/file-${Date.now()}`;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-defter',
    firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: await readFile('storage.rules', 'utf8') }
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [uid, role] of [
      ['logo-owner', 'owner'],
      ['logo-staff', 'staff']
    ])
      await setDoc(doc(ctx.firestore(), `businesses/logo/members/${uid}`), { uid, businessId: 'logo', role });
    await setDoc(doc(ctx.firestore(), 'businesses/logo/subscription/current'), {
      status: 'active',
      currentPeriodEnd: Timestamp.fromMillis(Date.now() + 86400000)
    });
  });
});
after(() => env.cleanup());
const store = (uid) =>
  env.authenticatedContext(uid, { email_verified: true }).storage('gs://demo-defter.appspot.com');
test('owner logo yükler; üye okur; yabancı kullanıcı okuyamaz', async () => {
  await assertSucceeds(
    uploadBytes(ref(store('logo-owner'), objectPath), new Uint8Array([1, 2]), { contentType: 'image/png' })
  );
  await assertSucceeds(getBytes(ref(store('logo-staff'), objectPath)));
  await assertFails(getBytes(ref(store('stranger'), objectPath)));
});
test('staff yazamaz; SVG ve 500 KB üzeri dosya yüklenemez', async () => {
  await assertFails(
    uploadBytes(ref(store('logo-staff'), 'businesses/logo/logo/staff'), new Uint8Array([1]), {
      contentType: 'image/png'
    })
  );
  await assertFails(
    uploadBytes(ref(store('logo-owner'), 'businesses/logo/logo/svg'), new Uint8Array([1]), {
      contentType: 'image/svg+xml'
    })
  );
  await assertFails(
    uploadBytes(ref(store('logo-owner'), 'businesses/logo/logo/large'), new Uint8Array(512001), {
      contentType: 'image/png'
    })
  );
});
test('eski suretlerin logosu üzerine yazılamaz ve silinemez', async () => {
  await assertFails(
    uploadBytes(ref(store('logo-owner'), objectPath), new Uint8Array([3]), { contentType: 'image/png' })
  );
  await assertFails(deleteObject(ref(store('logo-owner'), objectPath)));
});
