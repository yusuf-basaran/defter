# Veri ve işlem sınırları

İstemci işletme kimliğini seçer; yetkiyi sunucu, belge yolundaki işletmenin `members/{uid}` kaydından okur. Kullanıcı profilindeki alanlar yönetici yetkisi vermez. Platform yöneticiliği yalnızca Firebase custom claim’idir. Admin SDK işlemleri kuralları atladığı için callable katmanı bütün denetimleri yeniden yapar.

## Koleksiyonlar

- `users/{uid}`: fullName, phone, createdAt.
- `businesses/{bid}`: name, legalName, address, phone, email, taxOffice, taxNumber, logoPath, defaultCurrency, bankName, bankBranch, bankIban, bankHolder, showAmountWords, createdBy, createdAt, invoiceCount, memberCount.
- `businesses/{bid}/members/{uid}`: uid, businessId, role, email, addedAt. Kendi üyeliklerini bulmak için uid koşullu collectionGroup sorgusu kullanılır.
- `businesses/{bid}/clients/{clientId}`: name, nameLower, address, email, phone, taxOffice, taxNumber, note, createdAt.
- `businesses/{bid}/series/{kind-prefix}`: prefix, kind, nextNumber.
- `businesses/{bid}/invoices/{invoiceId}`: kind, status, seriesPrefix, number, clientId, clientNameLower, issueDate, dueDate, deliveryDate, waybillNo, currency, exchangeRate, priceMode, discountType, discountValue, note, exemptionNote, items, sellerSnapshot, clientSnapshot, subtotalCents, discountCents, baseCents, vatBreakdown, vatCents, totalCents, createdBy, createdAt, updatedAt, issuedAt, paidAt, cancelledAt, cancelReason, template, accent, showAmountWords, paymentTerms, source, legacyNumber. Son işlem alanları taslakta bulunmaz.
- Kalem: description, quantity, unitPriceCents, vatRate, exemptionNote, lineBaseCents, lineVatCents, lineDiscountCents, lineTotalCents. En fazla 100 kalem.
- `businesses/{bid}/subscription/current`: plan, status, currentPeriodEnd, note.
- `businesses/{bid}/vatRates/{year-rate}`: year, rate, label, enabled.
- `businesses/{bid}/auditLog/{id}`: userId, action, entity, entityId, detail, createdAt.
- `businesses/{bid}/monthlySummaries/{month-currency}`: month, currency, count, baseCents, vatCents, totalCents, paidCents, vatBreakdown. Proforma/iptal/taslak bu tutarlara eklenmez.
- `businesses/{bid}/operations/{id}`: tekrar isteklerin sonucu; istemciye kapalı.
- `vatRates/{year}`: rates, year. Yıl alanı en yakın önceki tabloyu tek sorguyla bulmak içindir.
- `invites/{token}`: businessId, email, role, expiresAt, acceptedAt, createdBy.
- `businessCreations/{uid-requestId}`: işletme kurulumunun tekrar gönderimine karşı businessId ve createdAt; istemciye kapalı.

## Düzenleme transaction’ı

Kimlik/doğrulanmış e-posta → üyelik/rol/abonelik → tekrar işlem kaydı → taslak → tarihsel oranlar → kalem doğrulaması ve hesap → alıcı/seri → hedef belge ve aylık özet okunur. Bütün okumalar yazmalardan önce tamamlanır. Ardından belge oluşturma, sayaç artışı, aylık özet, taslak silme, tekrar işlem sonucu ve audit tek commit ile yapılır.

Snapshot satıcı ve alıcının düzenleme anındaki sunucu kayıtlarından üretilir. Taslaktaki snapshot’a, satır toplamına veya genel toplama güvenilmez. İptal ve ödeme içerik alanlarını değiştirmez. `invoiceCount` tüm zamanlarda düzenlenmiş belgelerin sayısıdır; iptal edilince azalmaz. Aylık tutarlar iptal edilince düşer.

İşlem idempotency kayıtları ve faturalar aynı işletme altında tutulur. Böylece başarılı bir düzenlemeden sonra yanıt kaybolsa da aynı taslak kimliğiyle tekrar çağrı aynı sonucu verir. İstemcinin localStorage kaydı numara kaynağı değildir.

## Dosya sınırları

`firebase.js` SDK/attestation/emülatör başlangıcı; `auth.js` oturum; `api.js` bütün Firestore/Functions/Storage erişimleri; `model.js` UI/bulut dönüşümü; `state.js` geçici ekran durumu; `render.js` güvenli HTML; `ui.js` akış; `pdf.js` A4 sayfalama; `migrate.js` yalnızca eski yerel verilerin aktarımı. Eski storage.js kaldırılmıştır.
