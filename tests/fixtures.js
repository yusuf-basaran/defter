export function business(name = 'Kurgusal Çınar Atölyesi') {
  return {
    name,
    legalName: name,
    address: 'Çınar Sokak No: 12, Girne',
    phone: '',
    email: 'ofis@cinar.example',
    taxOffice: 'Girne',
    taxNumber: 'KURGU-318',
    logoPath: '',
    defaultCurrency: 'TRY',
    bankName: '',
    bankBranch: '',
    bankIban: '',
    bankHolder: '',
    showAmountWords: true
  };
}
export function client() {
  return {
    name: 'Kurgusal Nar Eğitim Evi',
    nameLower: 'kurgusal nar eğitim evi',
    address: 'Lale Sokak No: 8, Lefkoşa',
    email: 'ofis@nar.example',
    phone: '',
    taxOffice: 'Lefkoşa',
    taxNumber: 'KURGU-817',
    note: ''
  };
}
export function draft(uid = 'owner') {
  const seller = business();
  return {
    kind: 'invoice',
    status: 'draft',
    seriesPrefix: 'A',
    number: null,
    clientId: 'client',
    clientNameLower: 'kurgusal nar eğitim evi',
    issueDate: '2026-01-10',
    dueDate: '2026-01-24',
    deliveryDate: '',
    waybillNo: '',
    currency: 'TRY',
    exchangeRate: null,
    priceMode: 'exclusive',
    discountType: 'percent',
    discountValue: 0,
    note: '',
    exemptionNote: '',
    items: [
      {
        description: 'Yazılım hizmeti',
        quantity: 1000,
        unitPriceCents: 10000,
        vatRate: 16,
        exemptionNote: '',
        lineTotalCents: 999999
      }
    ],
    sellerSnapshot: {
      name: seller.legalName,
      address: seller.address,
      phone: '',
      email: seller.email,
      taxOffice: seller.taxOffice,
      taxNumber: seller.taxNumber,
      logoPath: ''
    },
    clientSnapshot: {
      name: client().name,
      address: client().address,
      email: client().email,
      phone: '',
      taxOffice: client().taxOffice,
      taxNumber: client().taxNumber
    },
    subtotalCents: 1,
    discountCents: 0,
    baseCents: 1,
    vatBreakdown: [],
    vatCents: 0,
    totalCents: 1,
    createdBy: uid,
    template: 'classic',
    accent: '#315b46',
    showAmountWords: true,
    paymentTerms: ''
  };
}
