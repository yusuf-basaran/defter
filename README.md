# Defter

Defter, KKTC’deki küçük işletmeler için fatura, proforma ve KDV takibi üzerinde çalıştığım bir proje. Arayüz saf HTML, CSS ve ES modüllerinden oluşuyor. Firebase Authentication, Firestore, Cloud Functions ve Storage kullanıyor; statik dosyalar Vercel’de barındırılabiliyor. Frontend için derleme adımı yok.

> Bu uygulama bir portfolyo/öğrenme projesidir. Resmî fatura düzeni, matbu belge ve ödeme kaydedici cihaz zorunlulukları ile belge saklama süreleri için Gelir ve Vergi Dairesi veya mali müşavirinize danışın.

## Yerelde çalıştırma

Node.js 22 ve Java 21 kurulu olmalı. İlk kurulum:

```sh
npm ci
npm --prefix functions ci
npm run dev
```

Başka bir terminalde başlangıç KDV tablolarını ekle:

```sh
node scripts/seed-vat.js --project demo-defter --emulator
```

Uygulamayı `http://127.0.0.1:5000`, Emulator Suite’i `http://127.0.0.1:4000` adresinde aç. Auth, Firestore, Functions ve Storage bağlantıları yalnızca localhost / 127.0.0.1 üzerinde emülatöre gider. `demo-defter` gerçek bir bulut projesine bağlanmaz. Verileri yerelde kalıcı tutmak istersen CLI’ye `--import=emulator-data --export-on-exit=emulator-data` ekle; bu klasör repoya alınmaz.

Hesap oluşturduktan sonra doğrulama bağlantısı Auth emülatörünün terminalinde görünür. Bağlantıyı aç ve uygulamada “Doğruladım” seç. Gerçek sistemde bağlantı e-posta ile gelir. İşletme kurulumunda unvan, adres, vergi dairesi ve vergi numarası gerekir. Kurulum 14 günlük deneme başlatır.

## İşletme ve belge akışı

Bir hesap birden fazla işletmeye üye olabilir. İşletme seçici kendi üyeliklerini 50’şer getirir. Bir işletmedeki rol diğerinde yetki vermez.

- Owner işletme profilini, KDV oranlarını, serileri ve üyeleri yönetir.
- Owner, accountant ve staff müşteri ve taslak oluşturabilir, taslak düzenleyebilir ve belge düzenleyebilir.
- Ödeme işaretleme ve iptal owner/accountant içindir.
- Düzenlenmiş içerik değişmez. Düzeltme için belgeyi kopyalayıp yeni taslak oluştur; gerekiyorsa eski belgeyi gerekçeyle iptal et.
- Proforma P, fatura A serisiyle başlar. Başka seri owner tarafından eklenir. Seriler türle birlikte tekildir; örneğin `invoice-A` ve `proforma-A` ayrı sayaçlardır.

“Taslağı kaydet” numara tüketmez. Geçerli sayısal alanlar varsa değişiklikler 1,2 saniye sonra da taslak olarak sunucuya gönderilir. Manuel kaydet ve `Ctrl+S` alıcıyı da kaydeder. “Düzenle” sunucuda doğrulama ve transaction çalıştırır: güncel satıcı/alıcı bilgileri kopyalanır, hesap yeniden yapılır, sıra numarası verilir, taslak silinir ve değişmez belge oluşturulur. Tekrar gönderilen aynı düzenleme isteği ikinci numara almaz.

İptal belgenin numarası, içeriği ve gerekçesi korunur; çıktıda İPTAL damgası görünür. Asıl, Suret veya Asıl + Suret seçilebilir. İkili çıktıda her nüshanın sayfa numarası yeniden başlar. Yalnızca taslak silinebilir.

Abonelik sona erdiğinde veya askıya alındığında ticari yazma işlemleri kapanır. Fatura/müşteri okuma, PDF, yazdırma ve verileri dışa aktarma açık kalır. Kullanıcı verisi abonelik nedeniyle rehin tutulmaz. Arayüzdeki engel tek güvenlik katmanı değildir; kurallar ve callable işlemler aynı denetimi yapar.

## Hesaplama ve tarihler

Para tam sayı kuruş olarak saklanır. `125030`, 1.250,30 TL demektir. Miktar da tam sayıdır: `1500`, 1,5 birimdir. Yüzde iskontosunda `1000`, %10,00; sabit iskontoda değer kuruştur. Kur altı ondalık ölçeğinde tutulur: `42500000`, 42,5 TL demektir.

`1250,30` ve `1250.30` girişleri kabul edilir; binlik ayraç girilmez. Para iki, miktar üç, kur altı ondalık kabul eder. Ara çarpımlar BigInt ile yapılır, güvenli aralığı aşan sonuçlar reddedilir.

KDV hariç modda iskonto matrahtan düşer. Dahil modda iskonto dahil tutardan düşer; matrah geriye doğru hesaplanır, KDV kalan farktan bulunur. Kalan iskonto kuruşları en büyük kesre göre dağıtılır. Matrah + KDV her satırda satır toplamına eşittir. Sabit iskontonun anlamı seçilen fiyat moduna bağlıdır. Mod değişince girilmiş birim fiyat korunur ve yeniden yorumlanır.

`functions/lib/totals.js` ile `js/totals.js` dağıtım sınırı nedeniyle ayrı dosyalardır. Kaynak eşitliği ve 12 hesap senaryosu test edilir; `money.js` aynı çekirdeği önizleme modeline uyarlar. İstemci toplamları düzenlemede güvenilir kabul edilmez.

Tarihler `yyyy-mm-dd` saklanır, `gg.aa.yyyy` gösterilir. “Bugün” Europe/Nicosia zaman dilimindedir. Gelecek tarihli belge düzenlenemez, vade düzenleme tarihinden önce olamaz. %0 kalem için istisna/muafiyet açıklaması gerekir.

Sistem KDV tabloları `vatRates/{year}` içinde `rates` ve sorgu için sayısal `year` taşır. En yakın önceki tablo kullanılır. İşletmenin o yıl veya daha yeni bir yıldaki yerel oran kayıtları sistem tablosuna ekleme/çıkarma yapar; `enabled: false` devralınan oranı kapatır. Yeni bir sistem yılı, daha eski işletme değişikliklerini devralmaz. Kayıtlı belgenin oranı ve tutarı sonradan değişmez.

## Aylık özet ve yedek

Aylık özet düzenleme/iptal transaction’ında güncellenir. Taslak, proforma ve iptal belgeler özete dahil değildir. Para birimleri ayrı tutulur; kur girilmesi yabancı para faturalarını kendiliğinden TL muhasebesine dönüştürmez. CSV bir beyanname değildir.

“Tüm verilerimi indir” müşteri ve faturaları 50’şer kayıtla sunucudan okuyup JSON, fatura CSV ve alıcı CSV dosyaları indirir. Tarayıcı birden fazla indirme için izin isteyebilir. CSV hücrelerinde formül başlatabilecek metinler etkisizleştirilir. JSON, para alanlarını kuruş olarak ve Firestore zamanlarını seconds/nanoseconds olarak içerir. Bu işlem veri okuma maliyeti oluşturur; abonelik bitince de çalışır.

## Eski yerel veriler

Eski `defter.data.v1` / `defter.data.v2` kayıtları varsa aktarım bildirimi görünür. “Eski verileri aktar” ile mevcut tarayıcı verisini veya JSON dosyasını incele. Önce kaynak yedeğini ayrıca sakla.

Eski `sent` durumu `issued`, `paid` ve `cancelled` kendi karşılıklarına dönüşür. Taslaklar numara verilmeden bulut taslağı olarak kaydedilir. Para zaten tam sayı kuruşsa korunur; ondalık metin saf dönüştürücüden geçer. Anlamı belirsiz para değerleri, eksik zorunlu bilgiler ve 100 kalemi aşan belgeler otomatik tahmin edilmez.

Düzenlenmiş belgeler yalnızca owner yetkili import fonksiyonuyla, en fazla 10 belge/2 MB gruplarla aktarılır. Her grup atomiktir; önceki başarılı gruplar sonraki bir çakışmada geri alınmaz. İlerleme ekranda belirtilir. Aynı kaynak ve grup tekrarında sunucu işlem kaydı kullanılır. Numara çakışması hata verir; üzerine yazılmaz. Seri sayacı en büyük aktarılan numaranın bir fazlasına ilerler. Geçmiş kaynakta numara boşlukları bulunabilir; uygulama geçmiş belgeleri yeniden numaralamaz.

Kurgusal Girne, Lefkoşa ve Gazimağusa belgeleri için `docs/example-legacy.json` kullanılabilir. İçindeki %5/%10/%16 oranları hesaplama örneğidir.

Özgün numara `legacyNumber` içinde korunur. Numara ayrıştırılamıyorsa veya eski vergi oranı sunucuda tarih için tanımlı değilse kaynak/işletme ayarları incelenmelidir. Kayıtlı eski toplam mevcutsa sunucu hesaplamasıyla eşleşmesi gerekir. Kaynak localStorage ve dosya silinmez. Bu akış genel amaçlı Firestore yedeğini geri yükleme aracı değildir.

## Firebase üretim kurulumu

Bu repoda gerçek Firebase projesi veya üretim anahtarı tanımlı değildir. Varsayılan `.firebaserc` yalnızca emülatör projesidir. Gerçek proje oluşturma, Blaze onayı ve konsol ayarları hesap sahibinin hesabında yapılmalıdır.

1. Geliştirme ve üretim için ayrı Firebase projeleri oluştur. Bu model Firestore Standard / Native veritabanı ve standart modüler SDK sorguları kullanır. Firestore ve Storage konumunu Functions’ın `europe-west1` bölgesiyle birlikte değerlendir; veri konumunu bilinçli seç.
2. Authentication’da Email/Password sağlayıcısını aç. Şifre politikasını **en az 8 karakter zorunlu** yap. İstemcideki kontrol tek başına sunucu şifre politikasının yerine geçmez.
3. Bir web uygulaması kaydet. Herkese açık web config değerlerini `js/firebase-config.js` içindeki `firebaseConfig` nesnesine ekle. Bu dosya bilerek gizli değildir. Service account dosyası burada kullanılmaz.
4. reCAPTCHA Enterprise (veya v3) site anahtarını kaydet; aynı dosyada site anahtarı ve sağlayıcıyı belirt. App Check’i Firestore ve Storage için konsoldan enforcement ile aç. Callable işlemlerde üretimde `enforceAppCheck` zorunludur. Gerçek projede debug token kullanma.
5. Blaze planını ve faturalandırmayı etkinleştir. Node.js 22 Functions kodu dağıt:

   ```sh
   npx firebase-tools login
   npx firebase-tools deploy --project URETIM_PROJE_KIMLIGI --only firestore:rules,firestore:indexes,storage,functions
   ```

6. Sistem oranlarını güncel tüzükten doğrula. Gerekirse `js/vat-rates.js` başlangıç tablosunu düzelt. Yerelde güvenli biçimde yapılandırılmış Admin SDK kimliğiyle `node scripts/seed-vat.js --project URETIM_PROJE_KIMLIGI --rates-reviewed` çalıştır. Script mevcut tabloların oranlarını değiştirmez.
7. `scripts/set-admin.js --project URETIM_PROJE_KIMLIGI --email HESABIN` ile kendi doğrulanmış hesabına claim ver. Mevcut diğer claim’ler korunur. Kaldırmak için `--revoke` kullan. Claim değişince çıkış/giriş yap.

Admin SDK için yerel Application Default Credentials veya `GOOGLE_APPLICATION_CREDENTIALS` kullanılabilir. **Service account JSON dosyasını repoya, web dizinine veya istemci koduna koyma.** `secrets/`, bilinen anahtar dosyası adları ve ortam dosyaları `.gitignore` / `.vercelignore` içinde dışlanır. Dosyayı web kökünün dışında tutmak en güvenlisidir. Scripts anahtar değerlerini yazdırmaz.

Emülatörde App Check attestation zorunluluğu kapalıdır; kimlik, doğrulanmış e-posta, rol ve abonelik kontrolleri devam eder. Bu ayrım Firebase’in `FUNCTIONS_EMULATOR` ortam değişkenine bağlıdır. Bu değişkeni üretimde asla tanımlama. App Check gerçek proje olmadan yerelde doğrulanmış sayılmaz.

## Vercel

Repoyu Vercel’e bağla, framework olarak Other seç; build ve install adımları kapalı, output klasörü `.`. `vercel.json` ve `.vercelignore`, sunucu dosyalarını statik dağıtım dışında tutar. Finansal işlemler Vercel Function’da çalışmaz; Firebase callable Functions’a gider.

Vercel’de kullanacağın gerçek alan adını Firebase Authentication → Settings → Authorized domains listesine ekle. Protokol ve port yazma. App Check sağlayıcısında da aynı alanı tanımla. Gereksiz preview alanlarını yetkilendirme. Üretimde `firebase-config.js` eksikse uygulama açık bir yapılandırma hatasıyla durur; demo projesine geçmez.

## Admin paneli

`admin.html` yalnızca doğrulanmış `platformAdmin` claim’iyle açılır. Owner olmak platform yöneticiliği vermez. Sunucu her yönetim çağrısında claim’i yeniden kontrol eder.

Liste en fazla 50 işletme getirir: ad, oluşturulma tarihi, üye/fatura sayıları ve abonelik bilgisi. Fatura içerikleri veya alıcı bilgileri admin liste yanıtına eklenmez. Platform claim’i Firestore kurallarında işletme faturalarına okuma yetkisi vermez.

“Havale geldi, 1 ay uzat” 30 gün ekler; başlangıç olarak mevcut bitiş ve şimdinin daha ileri olanını kullanır. Askıya alma süreyi değiştirmez. Yeniden etkinleştirme, bitiş tarihi geçmişse önce uzatma ister. İşlemler audit kaydı bırakır. E-posta veya ödeme sağlayıcısı entegrasyonu yoktur.

## Testler

```sh
npm test
npm run test:emulators
```

İkinci komutu çalıştırırken aynı portlarda başka emülatör açık olmamalı. Tarayıcı akışı için ayrı terminalde `npm run dev` açıkken:

```sh
npx playwright install chromium
npm run test:browser
```

Linux’ta mevcut Chromium’u kullanmak için `CHROMIUM_PATH=/usr/bin/chromium` verilebilir. Tarayıcı testi yalnızca demo emülatöründe kullanıcı ve kurgusal işletme oluşturur. Gerçek bir Firebase projesinde çalıştırılmamalıdır.

Kurallar testlerinde çapraz işletme erişimi, bitmiş abonelikte yazma/okuma ayrımı, issued belge değişikliği, rol yükseltme, zaman değiştirme, ek alan, aşırı metin, davet erişimi, 50 kayıt sınırı ve collectionGroup sorgusu sınanır. Functions testleri eşzamanlı numaralama, tekrar istek, sahte istemci toplamı, snapshot, ödeme/iptal, davet e-postası, son owner, admin ve aktarımı kapsar. Ayrıntılı model ve saldırı kontrolleri `docs/architecture.md` ve `docs/security-review.md` içindedir.

## Bütçe ve sınırlar

Google Cloud Console → Billing → Budgets & alerts → Create budget adımlarından projeyi seç. Küçük bir aylık bütçe ve %50 / %90 / %100 e-posta eşikleri oluştur. Fatura hesabının bildirim alıcılarını kontrol et. Bütçe alarmı harcamayı durduran bir kota değildir. Functions `maxInstances: 10` ile sınırlandırılmıştır; bu da toplam harcama garantisi vermez.

Firestore listeleri 50’şer okunur. Büyük listelerde onSnapshot kullanılmaz; yalnızca seçili işletmenin abonelik belgesi dinlenir. Aylık özetler transaction içinde tutulan sayaç belgelerinden okunur. Tam dışa aktarma yine bütün belgeleri sayfalayarak okur ve buna göre ücretlenir.

Bilinen sınırlar:

- Firestore tam metin araması yapmaz. Alıcı adının ön eki aranır; arama sırasında ad öncelikli sıralama kullanılır.
- Eşzamanlı değişiklikler sırasında sayfalı liste/dışa aktarma tek bir donmuş veritabanı snapshot’ı değildir. Denetim amaçlı tam yedek için yönetilen Firestore export ayrıca değerlendirilmelidir.
- Taslakların kalem dizisi kurallarda sayı sınırıyla kontrol edilir; her kalemin türü, uzunluğu, oranı ve hesapları düzenleme fonksiyonunda yeniden doğrulanır. Taslak tutarlarına güvenilmez. Firestore belge boyutu sınırı geçerlidir.
- Kalıcı Firestore önbelleği şifreli bir işletme kasası değildir. Çıkışta önbelleği temizleme denenir; başka sekmeler açıksa tarayıcı engelleyebilir. Ortak cihazlarda tarayıcı oturumunu da kapat.
- Logo yalnızca PNG/JPEG/WebP kabul eder; yükleme sırasında canvas ile yeniden kodlanır. Eski logo nesneleri kayıtlı suretlerde kullanıldığı için üzerine yazılmaz veya silinmez. `getDownloadURL` bağlantıları erişim token’ı taşır; bunları halka açık yerde paylaşma.
- PDF html2pdf.js ile görüntü olarak üretilir. Türkçe karakterler görünür; metin seçilemez. Font ve PDF CDN’lerinin ilk yüklemesi internet gerektirir.
- KDV istisnalarının hukuki uygunluğu, vergi numarasının gerçek biçimi, KKTC banka/IBAN biçimleri, yazıyla tutarın zorunluluğu ve 2026 oranları doğrulanmamıştır. IBAN kontrolü genel mod-97 uyarısıdır, kaydı engellemez.
- Uygulama mevzuata uygunluğu belgelendirilmiş bir muhasebe ürünü değildir. Çevrimiçi ödeme, otomatik kur, banka eşleştirme ve e-posta davet gönderimi yoktur.

Blaze kullanılamıyorsa Spark üzerinde istemci transaction’ı + `getAfter()` kurallarıyla seri ve belge oluşturmayı birlikte doğrulayan ayrı bir mimari kurulabilir. Ancak Admin SDK ile merkezi hesaplama, güvenilir snapshot üretimi, yönetilen abonelik/davet ve sunucu audit akışı kaybedilir; istemciye açık hesap mantığını kurallarda eksiksiz ifade etmek özellikle 100 kalemde zordur. Bu repo güvenlik modelini sessizce düşürmez ve Spark alternatifiyle çalışıyormuş gibi davranmaz.

## Yayın öncesi kontrol

- [x] Repoda service account anahtarı yok; dışlama kuralları mevcut.
- [x] 19 saf/model testi ve 27 emülatör testi geçti.
- [x] Emülatörde iki işletme arasında çapraz erişim reddedildi.
- [x] Tarayıcıda Auth, düzenleme, PDF, ödeme/iptal, abonelik sonrası okuma ve yedek indirme denendi.
- [x] Kurallarda açık `if true` yok; koleksiyonlar tanımlı, diğer yollar kapalı.
- [ ] Üretim projesinde kurallar ve indeksler dağıtıldı.
- [ ] Üretim App Check sağlayıcısı ve enforcement doğrulandı.
- [ ] Firebase Auth şifre politikası en az 8 karakter olarak zorunlu kılındı.
- [ ] Gerçek e-posta doğrulama teslimi denendi.
- [ ] Authorized domains yalnızca kullanılan alan adlarıyla sınırlandı.
- [ ] Google Cloud bütçe alarmı ve bildirim alıcıları kuruldu.
- [ ] Gerçek projede iki ayrı işletmeyle çapraz erişim denendi.

Bu konsol adımları, yerel emülatör testlerinin geçmesiyle tamamlanmış olmaz.
