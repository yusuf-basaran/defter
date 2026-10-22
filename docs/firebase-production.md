# Üretim Firebase kurulumu

22 Ekim 2026 tarihinde kontrol edilen proje `defterr-prod-2026-da392`, web adresi `https://defterr.vercel.app/`. Aynı görünen proje adı yerine bu tam kimlik kullanılmalı.

## Tamamlananlar

- Web uygulaması kaydedildi; istemciye yalnızca herkese açık Firebase yapılandırması ve reCAPTCHA site anahtarı eklendi.
- Email/Password açık, anonim giriş kapalı. Sunucu şifre politikası en az 8 karakteri zorunlu kılıyor.
- Auth alan adları `defterr.vercel.app`, `defterr-prod-2026-da392.firebaseapp.com` ve `defterr-prod-2026-da392.web.app` ile sınırlı.
- Firestore `(default)` veritabanı Standard / Native olarak `europe-west1` bölgesinde oluşturuldu. Kurallar ve indeksler dağıtıldı.
- reCAPTCHA Enterprise SCORE anahtarı yalnızca `defterr.vercel.app` alanına izin veriyor. App Check token süresi bir saat, asgari skor 0,5.
- Firestore ve Storage için App Check enforcement açık. Üretim Functions kodu da App Check zorunlu olacak şekilde hazır; henüz dağıtılamadı.

`firebase.json` içindeki Auth sağlayıcıları CLI ile dağıtılabilir. Alan adı ve şifre politikası ayrıca Auth yapılandırma API’sinden uygulandı ve geri okunarak doğrulandı; bir sonraki dağıtımda yalnızca CLI çıktısına bakarak bu ayarların uygulandığı varsayılmamalı.

Canlı sitede giriş ekranı doğru projeyle ve JavaScript hatası olmadan açıldı. On indeksin tamamı `READY`; anonim Firestore isteği 403 ile reddedildi. Otomatik Chromium kontrolünde App Check token değişimi ise `App attestation failed` yanıtı aldı. Nedeni henüz doğrulanmadı; gerçek cihazda doğrulama bekliyor. Enforcement veya skor eşiği bu kontrolü geçirmek için düşürülmedi.

## Kalan engel

Faturalandırma hesabı API’de kapalı görünüyor (`open: false`). Projede `billingEnabled: false`. Functions dağıtımı Blaze gerekliliği nedeniyle durdu; Storage bucket oluşturma isteği de reddedildi. Fatura düzenleme, işletme kurulumu, davet ve abonelik işlemleri henüz üretimde çalışmaz.

Hesap sahibi Google Cloud Billing’den ödeme hesabını etkinleştirip bu projeye bağlamalı. Kart bilgileri, giriş kodları veya service account anahtarları repoya eklenmemeli. Blaze’i açmak tek başına aşağıdaki dağıtımları tamamlamaz.

1. Firebase Storage’ın varsayılan bucket’ını `europe-west1` konumunda oluştur. Beklenen yol `defterr-prod-2026-da392.firebasestorage.app`; uygulama URL yerine nesne yolu saklar.
2. Sunucu kodunu ve Storage kurallarını dağıt:

   ```sh
   npx -y firebase-tools@latest deploy --project defterr-prod-2026-da392 --only storage,functions
   ```

3. Artifact Registry’de eski Functions imajları için temizleme politikası ayarla. Bütçe alarmı henüz oluşturulmadı; projeye özel aylık 250 TL ve %50, %90, %100 eşikleriyle bildirim kur. Bu bildirim harcamayı durdurmaz.
4. KDV başlangıç oranlarını güncel tüzükten doğrula. Sistem tabloları üretime henüz yüklenmedi; doğrulamadan `--rates-reviewed` seçeneğini kullanma. İşletme sahibi oranları uygulama ayarlarından da yönetebilir.
5. Uygulamada hesap açıp gelen doğrulama bağlantısını tamamla. Doğrulanmış kullanıcıya gerekiyorsa `scripts/set-admin.js` ile platform yöneticiliği ver; CLI’de Google hesabıyla oturum açılması uygulamada kullanıcı kaydı oluşturmaz.
6. Gerçek tarayıcıda App Check token değişimini, işletme kurulumunu, taslak kaydını ve belge düzenlemeyi dene. İki ayrı test işletmesiyle çapraz erişimin reddedildiğini doğrula. Üretimde debug token veya `FUNCTIONS_EMULATOR` kullanma.

Üretim devreye alınana kadar fatura işlemlerinin çalıştığı kabul edilmemeli. Emülatör testleri gerçek e-posta teslimini, ödeme profilini veya üretim App Check attestation akışını doğrulamaz.
