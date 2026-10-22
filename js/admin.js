import * as auth from './auth.js';
import { call } from './api.js';
import { escapeHtml } from './render.js';

let cursor = null;
let authorized = false;
async function load() {
  document.querySelector('#admin-status').textContent = 'İşletmeler yükleniyor…';
  const result = await call('adminListBusinesses', { after: cursor, limit: 50 });
  cursor = result.next;
  const e = escapeHtml;
  document.querySelector('#admin-list').innerHTML = result.businesses.length
    ? result.businesses
        .map(
          (business) =>
            `<article class="admin-business" data-business="${e(business.id)}"><h2>${e(business.name)}</h2><p>Kayıt: ${e(new Date(business.createdAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Nicosia' }))} · ${business.memberCount} üye · ${business.invoiceCount} düzenlenmiş belge</p><p>Abonelik: ${e(business.subscription?.plan || 'yok')} / ${e(business.subscription?.status || 'yok')} · Bitiş: ${business.subscription ? e(new Date(business.subscription.currentPeriodEnd).toLocaleDateString('tr-TR', { timeZone: 'Europe/Nicosia' })) : '—'}</p><div class="field"><label for="note-${e(business.id)}">İşlem notu</label><input id="note-${e(business.id)}" maxlength="1000" placeholder="Havale / işlem açıklaması"></div><div class="admin-actions"><button class="button primary" data-action="extend">Havale geldi, 1 ay uzat</button><button class="button secondary" data-action="suspend">Askıya al</button><button class="button secondary" data-action="reactivate">Yeniden etkinleştir</button></div></article>`
        )
        .join('')
    : '<p>Bu sayfada işletme yok.</p>';
  document.querySelector('#admin-next').disabled = !cursor;
  document.querySelector('#admin-status').textContent = `${result.businesses.length} işletme gösteriliyor.`;
}
export function init() {
  document.querySelector('#admin-login').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await auth.login(
        document.querySelector('#admin-email').value,
        document.querySelector('#admin-password').value
      );
      document.querySelector('#admin-password').value = '';
    } catch (error) {
      document.querySelector('#admin-status').textContent = auth.authMessage(error);
    }
  });
  document.querySelector('#admin-logout').addEventListener('click', () => auth.logout());
  document.querySelector('#admin-next').addEventListener('click', () =>
    load().catch((error) => {
      document.querySelector('#admin-status').textContent = auth.authMessage(error);
    })
  );
  document.querySelector('#admin-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !authorized) return;
    const business = button.closest('[data-business]');
    const businessId = business.dataset.business;
    const data = { businessId, note: document.getElementById(`note-${businessId}`).value };
    const name = {
      extend: 'adminExtendSubscription',
      suspend: 'adminSuspend',
      reactivate: 'adminReactivate'
    }[button.dataset.action];
    if (button.dataset.action === 'extend') Object.assign(data, { plan: 'monthly', days: 30 });
    button.disabled = true;
    try {
      await call(name, data);
      cursor = null;
      await load();
    } catch (error) {
      document.querySelector('#admin-status').textContent = auth.authMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  auth.observeAuth(async (user) => {
    authorized = false;
    document.querySelector('#admin-panel').hidden = true;
    document.querySelector('#admin-login').hidden = Boolean(user);
    document.querySelector('#admin-logout').hidden = !user;
    if (!user) {
      document.querySelector('#admin-status').textContent = 'Platform yöneticisi hesabıyla giriş yap.';
      return;
    }
    try {
      const token = await auth.claims();
      if (!user.emailVerified || token.claims.platformAdmin !== true) {
        document.querySelector('#admin-status').textContent =
          'Erişim reddedildi. Doğrulanmış platform yöneticisi hesabı gerekiyor.';
        return;
      }
      authorized = true;
      cursor = null;
      document.querySelector('#admin-panel').hidden = false;
      await load();
    } catch (error) {
      document.querySelector('#admin-status').textContent = auth.authMessage(error);
    }
  });
}
