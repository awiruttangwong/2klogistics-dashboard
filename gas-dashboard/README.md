# GAS Dashboard Deployment Guide

## ไฟล์ในโปรเจกต์นี้

| ไฟล์ | บทบาท |
|------|--------|
| `Code.gs` | Backend: Sync M1-M12, คำนวณ MASTER, SUMMARY_CACHE, TRIPS_CACHE, API endpoints |
| `config.gs` | ค่าคงที่: SELECT_COLS, NOT_NULL_COLS, MONTHS, COLORS, CUSTOMER_ALIAS |
| `Index.html` | หน้าแรก (GAS HTML Service) — รวม Styles + App |
| `Styles.html` | CSS ทั้งหมดจาก dashboard เดิม |
| `App.html` | JavaScript ทั้งหมดจาก dashboard เดิม — แก้ init() ให้โหลดจาก API |

---

## ขั้นตอน Deploy บน Google Apps Script

### 1. สร้างโปรเจกต์ GAS ใหม่
1. เปิด [script.google.com](https://script.google.com)
2. สร้างโปรเจกต์ใหม่ (หรือใช้โปรเจกต์เดิมที่มี Code.gs อยู่แล้ว)
3. **ลบไฟล์เดิมทั้งหมด** (Code.gs, ไฟล์ HTML ที่มีอยู่)

### 2. อัปโหลดไฟล์
สร้างไฟล์ใหม่ตามชื่อนี้ใน GAS และ copy-paste เนื้อหาจากโฟลเดอร์ `gas-dashboard/`:

- `Code.gs`
- `config.gs`
- `Index.html`
- `Styles.html`
- `App.html`

> **สำคัญ**: GAS ใช้ `<?!= include('Styles') ?>` และ `<?!= include('App') ?>` โดยอ้างอิงชื่อไฟล์ **ไม่รวม .html**

### 3. สร้างชีทใน Google Sheets

เปิด Spreadsheet ที่ต้องการใช้ แล้วสร้างชีทตามนี้:

| ชีท | หน้าที่ |
|------|--------|
| `DATA(M1)` ~ `DATA(M12)` | มีอยู่แล้ว (ดึงจากต้นทาง) |
| `MASTER` | รวมข้อมูลทุกเดือน (สร้างใหม่) |
| `SUMMARY_CACHE` | เก็บ JSON สรุป KPI (สร้างใหม่) |
| `TRIPS_CACHE` | เก็บ JSON รายเที่ยว + Anomaly (สร้างใหม่) |
| `OIL_DIESEL_DATA` | ราคาน้ำมัน (สร้างใหม่) |
| `CONFIG` | ค่าตั้งต้น (สร้างใหม่) |

#### ชีท `OIL_DIESEL_DATA` — โครงสร้าง
```
| วันที่       | ราคาน้ำมัน | แหล่งข้อมูล | หมายเหตุ      |
| 2026-05-01  | 40.8      | PTTOR       | 1 May 2569    |
| 2026-04-24  | 40.2      | PTTOR       | 24 Apr 2569   |
| ...         | ...       | ...         | ...           |
```

### 4. ใส่ URL ต้นทางใน `config.gs`
แก้ไข `SHEET_SOURCES` ใน `config.gs` ให้มีลิ้งก์ครบ M1-M12

### 5. Deploy Web App
1. ใน GAS: **Deploy > New deployment**
2. เลือก **Type: Web app**
3. **Execute as: Me**
4. **Who has access: Anyone within 2klogistics.co.th**
5. กด Deploy → ได้ URL

URL จะอยู่ในรูป: `https://script.google.com/a/macros/2klogistics.co.th/...`

### 6. ตั้ง Trigger อัตโนมัติ
1. เปิด Google Sheets → **Extensions > Apps Script**
2. รัน `dailyBatchJob()` ครั้งแรกด้วยตนเอง (เพื่อสร้าง MASTER + CACHE)
3. หรือใช้เมนูใน Sheets: **จัดการข้อมูล > ตั้ง Trigger อัตโนมัติ**

---

## API Endpoints

| Endpoint | ตัวอย่าง | คำอธิบาย |
|----------|---------|---------|
| `?action=summary` | — | ข้อมูลสรุป KPI ทั้งหมด |
| `?action=trips&start=2026-01-01&end=2026-01-31` | — | รายเที่ยวในช่วงวัน |
| `?action=compare` | `?startA=...&endA=...` | เปรียบเทียบ 2 ช่วง |
| `?action=oil` | — | ราคาน้ำมันดีเซล |
| `?action=routes` | — | รายชื่อเส้นทาง |
| `?action=customers` | — | รายชื่อลูกค้า |

---

## หมายเหตุ

- **ไม่ต้องแตะไฟล์เดิม** ในโฟลเดอร์ `dashboard/` — ระบบใหม่อยู่ใน `gas-dashboard/` แยกกัน
- Frontend โหลดข้อมูลจาก API แทนการใช้ `data.js`, `fraud_data.js`, `oil-price-data.js`
- Cache ฝั่ง Frontend TTL = 5 นาที
- Pre-calculate ฝั่ง Backend รันทุกเช้า 08:00 (Trigger)
