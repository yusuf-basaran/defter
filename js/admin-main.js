import('./admin.js')
  .then((module) => module.init())
  .catch((error) => {
    document.querySelector('#admin-status').textContent = error.message || 'Yönetim paneli açılamadı.';
  });
