# Güvenlik doğrulaması

Bu dosya uygulamanın güvenlik sınırlarını ve emülatörde tekrarlanabilir kontrollerini açıklar. Gerçek üretim yapılandırmasının yerini tutmaz.

| Deneme                                                        | Beklenen sonuç                            | Test               |
| ------------------------------------------------------------- | ----------------------------------------- | ------------------ |
| Kimliksiz özel liste okuma                                    | Reddedilir                                | rules              |
| Başka işletmenin faturasını okuma                             | Reddedilir                                | rules              |
| Platform claim’iyle üyelik olmadan içerik okuma               | Reddedilir                                | rules              |
| Başka kullanıcı profili yazma                                 | Reddedilir                                | rules              |
| Profil üzerinden platformAdmin ekleme                         | Reddedilir                                | rules              |
| İşletme createdBy/sayaç değiştirme                            | Reddedilir                                | rules              |
| staff ile işletme güncelleme                                  | Reddedilir                                | rules              |
| Taslak oluştururken başkasını createdBy yapma                 | Reddedilir                                | rules              |
| Taslakta createdBy/createdAt değiştirme                       | Reddedilir                                | rules              |
| Taslaktan doğrudan issued/paid geçişi                         | Reddedilir                                | rules              |
| Düzenlenmiş belgenin tutar/not/durumunu istemciden değiştirme | Reddedilir                                | rules              |
| Düzenlenmiş belge silme                                       | Reddedilir                                | rules              |
| Abonelik bitince yazma                                        | Reddedilir                                | rules, functions   |
| Abonelik bitince okuma                                        | İzin verilir                              | rules, browser     |
| Ek alan, yanlış tür, aşırı metin, 101 kalem                   | Reddedilir                                | rules              |
| Üyelik/davet/abonelik/audit doğrudan yazma                    | Reddedilir                                | rules              |
| Koşulsuz üyelik collectionGroup tarama                        | Reddedilir                                | rules              |
| 50’den büyük veya limitsiz belge listesi                      | Reddedilir                                | rules              |
| Yanlış e-postayla davet kabulü ve tekrar kullanım             | Reddedilir                                | functions          |
| Son owner’ı kaldırma                                          | Reddedilir                                | functions          |
| Sahte istemci toplamı/snapshot                                | Sunucuda yeniden oluşturulur              | functions          |
| Eşzamanlı düzenleme ve aynı isteğin tekrarı                   | Tekil, ardışık numara; tekrar tüketim yok | functions          |
| Gelecek tarih, tanımsız oran, negatif miktar                  | Reddedilir; numara harcanmaz              | functions          |
| Üretim olmayan admin çağrısı                                  | Claim yoksa reddedilir                    | functions, browser |
| Başka işletmenin logosunu okuma, staff logo yazma             | Reddedilir                                | storage            |
| Logo boyutu ve SVG yükleme                                    | Reddedilir                                | storage            |
| Eski logo üzerine yazma/silme                                 | Reddedilir                                | storage            |
| Eski belge numarası çakışması                                 | Reddedilir; mevcut belge değişmez         | functions          |

Taslak kalemleri istemciden yazılabilir ve yetkili finansal veri değildir. Kurallar üst düzey şemayı, metinleri, toplam türlerini, sahibi, zamanı ve kalem sayısını sınırlar. Callable düzenleme her kalemi yeniden denetler; sunucu girişinde uzunluk, tür, oran ve güvenli tam sayı aralığı kontrolleri vardır.

Storage indirme token’ları paylaşılabilir bağlantılardır. Uygulama bunları veri modelinde veya genel listelerde saklamaz. Arşivdeki logo yolları başka işletmeye yönlendirilemez.

Üretimde ayrıca gerçek App Check enforcement, Auth şifre politikası, yetkili alan adları, faturalandırma uyarıları ve gerçek projede çapraz işletme erişimi doğrulanmalıdır. Henüz yapılmayan konsol işleri README’de açık bırakılmıştır.
