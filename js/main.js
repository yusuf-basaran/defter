import('./ui.js')
  .then((module) => module.init())
  .catch((error) => {
    document.querySelector('#auth-status').textContent =
      error.message || 'Uygulama yüklenemedi. Bağlantıyı ve Firebase yapılandırmasını kontrol edin.';
    document.querySelector('#auth-submit').disabled = true;
  });
