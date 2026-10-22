import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  terminate,
  clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {
  getFunctions,
  connectFunctionsEmulator
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {
  getStorage,
  connectStorageEmulator
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js';
import { firebaseConfig, appCheckSiteKey, appCheckProvider } from './firebase-config.js';

export const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const config = isLocal
  ? {
      apiKey: 'demo-defter-key',
      projectId: 'demo-defter',
      authDomain: 'localhost',
      storageBucket: 'demo-defter.appspot.com',
      appId: '1:000000000000:web:demo'
    }
  : firebaseConfig;
if (!config?.projectId || (!isLocal && (!config.apiKey || !appCheckSiteKey)))
  throw new Error(
    'Üretim Firebase ayarları eksik. js/firebase-config.js dosyasına web uygulaması bilgilerini ve App Check site anahtarını ekleyin.'
  );
export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const functions = getFunctions(app, 'europe-west1');
export const storage = getStorage(app);
if (isLocal) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
} else {
  initializeAppCheck(app, {
    provider:
      appCheckProvider === 'v3'
        ? new ReCaptchaV3Provider(appCheckSiteKey)
        : new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
  });
}
export async function clearCache() {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}
