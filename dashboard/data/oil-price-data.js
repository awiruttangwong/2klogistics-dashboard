/* ─── PTTOR Oil Price Cache (Fallback) ──────────────────────────────
   แหล่งที่มา: PTTOR (ปตท. น้ำมันและการค้าปลีก)
   ผลิตภัณฑ์: ดีเซล 
   หน่วย: บาท/ลิตร
   อัปเดตล่าสุด: 2026-06-01
   หมายเหตุ: ข้อมูลหลักอยู่ใน oil-price.csv ไฟล์นี้เป็น fallback
   ──────────────────────────────────────────────────────────────── */
const OIL_PRICE_DATA = {
  source: 'PTTOR',
  sourceUrl: 'https://www.pttor.com/news/oil-price',
  product: 'ดีเซล ',
  productLabel: 'ดีเซล(ราคาขายปลีกหน้าปั๊ม PTT)',
  unit: 'บาท/ลิตร',
  lastFetch: '2026-05-08T00:00:00.000Z',
  csvFile: 'oil-price.csv',
  note: 'ข้อมูลรายวันจาก PTTOR ผ่าน CSV (คุณอัปเดตเองในไฟล์ oil-price.csv)',
  prices: [
    { period_no: '20260109', period_name: '2026-01-09', year_en: 2026, update_date: '2026-01-09T00:00:00.000Z', price: 29.94 },
    { period_no: '20260218', period_name: '2026-02-18', year_en: 2026, update_date: '2026-02-18T00:00:00.000Z', price: 29.94 },
    { period_no: '20260310', period_name: '2026-03-10', year_en: 2026, update_date: '2026-03-10T00:00:00.000Z', price: 29.94 },
    { period_no: '20260318', period_name: '2026-03-18', year_en: 2026, update_date: '2026-03-18T00:00:00.000Z', price: 30.44 },
    { period_no: '20260321', period_name: '2026-03-21', year_en: 2026, update_date: '2026-03-21T00:00:00.000Z', price: 31.14 },
    { period_no: '20260324', period_name: '2026-03-24', year_en: 2026, update_date: '2026-03-24T00:00:00.000Z', price: 32.94 },
    { period_no: '20260326', period_name: '2026-03-26', year_en: 2026, update_date: '2026-03-26T00:00:00.000Z', price: 38.94 },
    { period_no: '20260331', period_name: '2026-03-31', year_en: 2026, update_date: '2026-03-31T00:00:00.000Z', price: 40.74 },
    { period_no: '20260402', period_name: '2026-04-02', year_en: 2026, update_date: '2026-04-02T00:00:00.000Z', price: 44.24 },
    { period_no: '20260403', period_name: '2026-04-03', year_en: 2026, update_date: '2026-04-03T00:00:00.000Z', price: 47.74 },
    { period_no: '20260404', period_name: '2026-04-04', year_en: 2026, update_date: '2026-04-04T00:00:00.000Z', price: 47.74 },
    { period_no: '20260405', period_name: '2026-04-05', year_en: 2026, update_date: '2026-04-05T00:00:00.000Z', price: 50.54 },
    { period_no: '20260409', period_name: '2026-04-09', year_en: 2026, update_date: '2026-04-09T00:00:00.000Z', price: 48.40 },
    { period_no: '20260411', period_name: '2026-04-11', year_en: 2026, update_date: '2026-04-11T00:00:00.000Z', price: 44.40 },
    { period_no: '20260417', period_name: '2026-04-17', year_en: 2026, update_date: '2026-04-17T00:00:00.000Z', price: 42.90 },
    { period_no: '20260421', period_name: '2026-04-21', year_en: 2026, update_date: '2026-04-21T00:00:00.000Z', price: 41.70 },
    { period_no: '20260424', period_name: '2026-04-24', year_en: 2026, update_date: '2026-04-24T00:00:00.000Z', price: 40.20 },
    { period_no: '20260501', period_name: '2026-05-01', year_en: 2026, update_date: '2026-05-01T00:00:00.000Z', price: 40.80 },
    { period_no: '20260508', period_name: '2026-05-08', year_en: 2026, update_date: '2026-05-08T00:00:00.000Z', price: 39.95 }
  ]
};
