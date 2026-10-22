import { auth } from './firebase.js';
import {
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  onIdTokenChanged,
  reload,
  signOut,
  getIdTokenResult
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const ready = setPersistence(auth, browserLocalPersistence);
export function authMessage(error) {
  const messages = {
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/wrong-password': 'E-posta veya şifre hatalı.',
    'auth/user-not-found': 'E-posta veya şifre hatalı.',
    'auth/email-already-in-use': 'Bu e-posta adresiyle bir hesap var.',
    'auth/invalid-email': 'E-posta adresini kontrol edin.',
    'auth/weak-password': 'Şifre en az 8 karakter olmalı.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra yeniden deneyin.',
    'auth/network-request-failed': 'Bağlantı kurulamadı. Bilgilerinizi koruyup yeniden deneyin.',
    'auth/user-disabled': 'Bu hesap devre dışı.',
    'auth/unauthorized-domain': 'Bu alan adı Firebase Auth ayarlarında yetkilendirilmemiş.',
    'permission-denied': 'Bu işlem için yetkiniz yok veya aboneliğiniz aktif değil.',
    unavailable: 'Sunucuya ulaşılamıyor. Formunuz korunuyor.',
    'failed-precondition':
      'İşlem şu anda tamamlanamıyor. Bağlantıyı ve tarayıcı depolama iznini kontrol edin.'
  };
  return (
    messages[error.code] ||
    (error.code?.startsWith('functions/')
      ? error.message
      : error.message || 'İşlem tamamlanamadı. Yeniden deneyin.')
  );
}
export async function login(email, password) {
  await ready;
  return signInWithEmailAndPassword(auth, email, password);
}
export async function register(fullName, email, password) {
  if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
  if (!fullName.trim() || fullName.length > 120)
    throw new Error('Adınızı girin; en fazla 120 karakter olabilir.');
  await ready;
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: fullName.trim() });
  await sendEmailVerification(user);
  return user;
}
export async function resetPassword(email) {
  await ready;
  await sendPasswordResetEmail(auth, email);
}
export const verifyEmail = () => sendEmailVerification(auth.currentUser);
export async function refreshUser() {
  await reload(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}
export const observeAuth = (callback) => onIdTokenChanged(auth, callback);
export const logout = () => signOut(auth);
export const claims = () => getIdTokenResult(auth.currentUser);
