# คู่มือ Deploy GAS Dashboard — ฉบับละเอียดทุกขั้นตอน

> อัปเดตล่าสุด: 8 พฤษภาคม 2026
> โปรเจกต์: Logistics Analytics Dashboard (Google Apps Script)
> จำกัดการเข้าถึง: `@2klogistics.co.th` เท่านั้น

---

## สารบัญ

1. [สิ่งที่ต้องเตรียมก่อนเริ่ม](#1-สิ่งที่ต้องเตรียมก่อนเริ่ม)
2. [ขั้นตอนที่ 1: สร้าง Google Sheets หลัก](#2-ขั้นตอนที่-1-สร้าง-google-sheets-หลัก)
3. [ขั้นตอนที่ 2: สร้างชีทย่อยทั้งหมด](#3-ขั้นตอนที่-2-สร้างชีทย่อยทั้งหมด)
4. [ขั้นตอนที่ 3: เปิด Apps Script Project](#4-ขั้นตอนที่-3-เปิด-apps-script-project)
5. [ขั้นตอนที่ 4: ลบไฟล์เก่าทิ้งทั้งหมด](#5-ขั้นตอนที่-4-ลบไฟล์เก่าทิ้งทั้งหมด)
6. [ขั้นตอนที่ 5: สร้างไฟล์ใหม่ 5 ไฟล์](#6-ขั้นตอนที่-5-สร้างไฟล์ใหม่-5-ไฟล์)
7. [ขั้นตอนที่ 6: แก้ไข URL ต้นทาง M6-M12](#7-ขั้นตอนที่-6-แก้ไข-url-ต้นทาง-m6-m12)
8. [ขั้นตอนที่ 7: รัน dailyBatchJob ครั้งแรก](#8-ขั้นตอนที่-7-รัน-dailybatchjob-ครั้งแรก)
9. [ขั้นตอนที่ 8: Deploy Web App](#9-ขั้นตอนที่-8-deploy-web-app)
10. [ขั้นตอนที่ 9: ตั้ง Trigger อัตโนมัติ](#10-ขั้นตอนที่-9-ตั้ง-trigger-อัตโนมัติ)
11. [ขั้นตอนที่ 10: ทดสอบ Dashboard](#11-ขั้นตอนที่-10-ทดสอบ-dashboard)
12. [การใช้งานประจำวัน](#12-การใช้งานประจำวัน)
13. [แก้ไขปัญหาเบื้องต้น](#13-แก้ไขปัญหาเบื้องต้น)
14. [ตารางสรุปชื่อชีทและ Header](#14-ตารางสรุปชื่อชีทและ-header)

---

## 1. สิ่งที่ต้องเตรียมก่อนเริ่ม

### 1.1 บัญชี Google
- ต้องใช้บัญชี Gmail ที่ลงท้ายด้วย `@2klogistics.co.th`
- บัญชีนี้ต้องเป็นเจ้าของ (Owner) ของ Google Sheets ต้นทางทั้งหมด

### 1.2 ไฟล์ต้นทางที่ต้องมีในเครื่อง

จากโฟลเดอร์ `gas-dashboard/` ต้องมีไฟล์ครบ 5 ไฟล์นี้:

| # | ชื่อไฟล์ | ประเภท | หน้าที่ |
|---|---------|--------|---------|
| 1 | `Code.gs` | Google Apps Script | Backend logic, API, KPI calculators |
| 2 | `config.gs` | Google Apps Script | ค่าคงที่, URL ต้นทาง, helper functions |
| 3 | `Index.html` | HTML | หน้าแรกของ Dashboard, โหลด CSS/JS |
| 4 | `Styles.html` | HTML | CSS styles ทั้งหมด |
| 5 | `App.html` | HTML | JavaScript frontend, เรียก API, วาดกราฟ |

### 1.3 Google Sheets ต้นทาง (M1-M12)
- ต้องมี Google Sheets แยก 5 ไฟล์สำหรับ M1-M5 (มี URL แล้ว)
- ถ้ามี M6-M12 ต้องเตรียม URL ให้พร้อม

---

## 2. ขั้นตอนที่ 1: สร้าง Google Sheets หลัก

1. เปิด [Google Sheets](https://sheets.google.com)
2. คลิก **+ สเปรดชีทว่างเปล่า**
3. ตั้งชื่อไฟล์: `Logistics Analytics Dashboard`
4. คลิก **แชร์** (มุมขวาบน) → ตั้งค่า:
   - ผู้ที่มีลิงก์: `ไม่สามารถเข้าถึงได้`
   - เฉพาะผู้ใช้ `@2klogistics.co.th`: `เป็นผู้ดู`
5. จด ID ของไฟล์ (อยู่ใน URL หลัง `/d/`)

---

## 3. ขั้นตอนที่ 2: สร้างชีทย่อยทั้งหมด

ใน Google Sheets หลัก สร้างชีทย่อก (Sheet Tab) ตามนี้ **ตามลำดับ**:

### ชีท A: DATA(M1) ถึง DATA(M12)

สร้างชีทตามชื่อนี้ **พอดี** (ตัวพิมพ์เล็ก/ใหญ่ต้องตรง):

```
DATA(M1)
DATA(M2)
DATA(M3)
DATA(M4)
DATA(M5)
DATA(M6)
DATA(M7)
DATA(M8)
DATA(M9)
DATA(M10)
DATA(M11)
DATA(M12)
```

**Header ของทุกชีท DATA(Mx) ต้องเป็นคอลัมน์ต่อเนื่อง 13 คอลัมน์:**

| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| วันที่ | ลูกค้า | ประเภทรถ | ชื่อเส้นทาง | เส้นทาง (Route) | ชื่อพขร | ทะเบียน | จ่ายสำรองน้ำมัน | ชื่อผู้รับโอน | ราคารับ | ราคาจ่าย | ส่วนต่าง | กำไร % |

**ข้อควรระวัง:**
- ห้ามมีคอลัมน์ว่างคั่นระหว่างข้อมูล
- แถวที่ 1 ต้องเป็น Header ตามตารางด้านบน
- ข้อมูลเริ่มตั้งแต่แถว 2
- รูปแบบวันที่: `DD/MM/YYYY` หรือ `YYYY-MM-DD`

### ชีท B: MASTER

สร้างชีทว่างเปล่าชื่อ `MASTER`
- ไม่ต้องใส่ header เอง (ระบบจะสร้างให้)
- ชีทนี้จะถูกเติมข้อมูลอัตโนมัติจาก `dailyBatchJob()`

### ชีท C: SUMMARY_CACHE

สร้างชีทว่างเปล่าชื่อ `SUMMARY_CACHE`
- ไม่ต้องใส่ข้อมูล
- ระบบจะเขียน JSON ของ KPI ทั้งหมดลงที่นี่

### ชีท D: TRIPS_CACHE

สร้างชีทว่างเปล่าชื่อ `TRIPS_CACHE`
- ไม่ต้องใส่ข้อมูล
- ระบบจะเขียน JSON ของรายเที่ยว + Anomaly ลงที่นี่

### ชีท E: OIL_DIESEL_DATA

สร้างชีทชื่อ `OIL_DIESEL_DATA`

**Header (แถวที่ 1):**

| A | B | C | D |
|---|---|---|---|
| วันที่ | ราคาน้ำมัน | แหล่งข้อมูล | หมายเหตุ |

**ตัวอย่างข้อมูล (แถว 2 เป็นต้นไป):**

| วันที่ | ราคาน้ำมัน | แหล่งข้อมูล | หมายเหตุ |
|--------|-----------|------------|---------|
| 2025-01-01 | 32.50 | PTTOR | ราคาประจำวัน |
| 2025-01-15 | 33.00 | PTTOR | ปรับขึ้น |

**หมายเหตุ:**
- ระบบอ่านเฉพาะคอลัมน์ A (วันที่) และ B (ราคาน้ำมัน)
- รูปแบบวันที่: `YYYY-MM-DD`
- ราคาเป็นตัวเลข (มีจุดทศนิยมได้)

---

## 4. ขั้นตอนที่ 3: เปิด Apps Script Project

1. ใน Google Sheets หลัก คลิก **Extensions** → **Apps Script**
2. หน้าต่าง Apps Script Editor จะเปิดขึ้น
3. โปรเจกต์จะมีชื่อเริ่มต้น เช่น `Untitled project`
4. คลิกที่ชื่อโปรเจกต์ (มุมบนซ้าย) → ตั้งชื่อใหม่: `Logistics Dashboard GAS`
5. บันทึก (Ctrl+S หรือคลิกรูปดิสก์)

---

## 5. ขั้นตอนที่ 4: ลบไฟล์เก่าทิ้งทั้งหมด

**สำคัญมาก:** ถ้าโปรเจกต์นี้เคยมีไฟล์เก่าอยู่ ต้องลบทิ้งให้หมดก่อน

### วิธีลบไฟล์เก่า:

1. ดูที่แถบ **Files** (ด้านซ้ายของ Editor)
2. คลิกลูกศรลงหลังชื่อไฟล์ → คลิก **Delete**
3. ลบทั้งหมดจนเหลือ 0 ไฟล์

**ตรวจสอบ:** ต้องไม่มีไฟล์ `Code.gs` เก่า, `Index.html` เก่า, หรือไฟล์อื่นใดเหลืออยู่

---

## 6. ขั้นตอนที่ 5: สร้างไฟล์ใหม่ 5 ไฟล์

### ไฟล์ที่ 1: Code.gs

1. คลิก **+** ข้าง Files → **Script**
2. ตั้งชื่อ: `Code`
3. เปิดไฟล์ `Code.gs` จากเครื่อง → Copy ทั้งหมด → Paste ลง Editor
4. กด **Ctrl+S** (บันทึก)

### ไฟล์ที่ 2: config.gs

1. คลิก **+** → **Script**
2. ตั้งชื่อ: `config`
3. เปิดไฟล์ `config.gs` จากเครื่อง → Copy ทั้งหมด → Paste
4. กด **Ctrl+S**

### ไฟล์ที่ 3: Index.html

1. คลิก **+** → **HTML**
2. ตั้งชื่อ: `Index`
3. เปิดไฟล์ `Index.html` จากเครื่อง → Copy ทั้งหมด → Paste
4. กด **Ctrl+S**

### ไฟล์ที่ 4: Styles.html

1. คลิก **+** → **HTML**
2. ตั้งชื่อ: `Styles`
3. เปิดไฟล์ `Styles.html` จากเครื่อง → Copy ทั้งหมด → Paste
4. กด **Ctrl+S**

### ไฟล์ที่ 5: App.html

1. คลิก **+** → **HTML**
2. ตั้งชื่อ: `App`
3. เปิดไฟล์ `App.html` จากเครื่อง → Copy ทั้งหมด → Paste
4. กด **Ctrl+S**

**ตรวจสอบ:** ในแถบ Files ต้องมีครบ 5 ไฟล์:

```
▼ Files
  Code.gs
  config.gs
  Index.html
  Styles.html
  App.html
```

---

## 7. ขั้นตอนที่ 6: แก้ไข URL ต้นทาง M6-M12

### วิธีหา URL ของ Google Sheets ต้นทาง

1. เปิด Google Sheets ต้นทาง (เช่น ไฟล์ของ M6)
2. คัดลอก URL จาก Address Bar
3. URL จะมีรูปแบบ:
   ```
   https://docs.google.com/spreadsheets/d/XXXXXXXXXX/edit?gid=...#gid=...
   ```
4. นำ URL ทั้งหมดไปใส่

### แก้ไขใน config.gs

1. คลิกเปิดไฟล์ `config.gs` ใน Apps Script Editor
2. หาส่วน `SHEET_SOURCES`
3. ใส่ URL สำหรับ M6-M12:

```javascript
var SHEET_SOURCES = {
  'DATA(M1)': 'https://docs.google.com/spreadsheets/d/1sWGuoZaxyxfVhGsiA6NqG9noEK6nCvbpABVo792W5Sw/edit?gid=1824601668#gid=1824601668',
  'DATA(M2)': 'https://docs.google.com/spreadsheets/d/1l2ijjyLOvxIqixNTs0UWmV7U9Iu3rQmGGoy-Sazt3aQ/edit?gid=1824601668#gid=1824601668',
  'DATA(M3)': 'https://docs.google.com/spreadsheets/d/1ohmQjk77j2HFvW9em9l_cflt8jbePlFDpA25oAFOjsE/edit?gid=1824601668#gid=1824601668',
  'DATA(M4)': 'https://docs.google.com/spreadsheets/d/1RW7EQyzgYjPREZsxyBs3_EbZ8tKOHbBeSxPDxJ3G3yU/edit?gid=1824601668#gid=1824601668',
  'DATA(M5)': 'https://docs.google.com/spreadsheets/d/1wt8x2XsfvT-gSOmrI0HnNFcS27w-OuvzEYItGP3xn48/edit?gid=1824601668#gid=1824601668',
  'DATA(M6)': 'ใส่ URL ที่นี่',
  'DATA(M7)': '',
  'DATA(M8)': '',
  'DATA(M9)': '',
  'DATA(M10)': '',
  'DATA(M11)': '',
  'DATA(M12)': ''
};
```

**หมายเหตุ:** ถ้ายังไม่มีข้อมูลบางเดือน ปล่อยเป็น `''` (ว่าง) ได้ ระบบจะข้ามเดือนนั้นไป

### แก้ไขชื่อชีทต้นทาง (ถ้าจำเป็น)

```javascript
var SOURCE_SHEET_NAMES = {
  'DATA(M1)': 'SUM',      // ถ้าชีทต้นทางชื่อ SUM
  'DATA(M2)': 'SUMDATA',  // ถ้าชีทต้นทางชื่อ SUMDATA
  // ...
};
```

4. กด **Ctrl+S** บันทึก

---

## 8. ขั้นตอนที่ 7: รัน dailyBatchJob ครั้งแรก

รอบแรกต้องรันด้วยตนเองเพื่อสร้างข้อมูลพื้นฐาน

### วิธีรัน:

1. ใน Apps Script Editor เลือกฟังก์ชัน: คลิกที่ช่องแถบด้านบน (ข้างรูป Play ▶)
2. เลือก `dailyBatchJob`
3. กด **Run** (รูป ▶)
4. ถ้าขึ้นขอ **Authorization** (อนุญาต):
   - คลิก **Review Permissions**
   - เลือกบัญชี `@2klogistics.co.th`
   - คลิก **Advanced** → **Go to... (unsafe)**
   - คลิก **Allow** ทั้งหมด
5. รอประมาณ 30-120 วินาที
6. ดูที่ **Execution log** (View → Execution log)

### ตรวจสอบผล:

- เปิด Google Sheets หลัก
- ตรวจสอบว่าชีท `MASTER` มีข้อมูล
- ตรวจสอบว่าชีท `SUMMARY_CACHE` มีข้อมูล (เซลล์ A2 จะมี JSON)
- ตรวจสอบว่าชีท `TRIPS_CACHE` มีข้อมูล

**ถ้าข้อมูลไม่ขึ้น:** ดู Execution log หาข้อผิดพลาด

---

## 9. ขั้นตอนที่ 8: Deploy Web App

### วิธี Deploy:

1. ใน Apps Script Editor คลิก **Deploy** (มุมขวาบน) → **New deployment**
2. คลิกลูกศรลงหลัง **Select type** → เลือก **Web app**
3. ใส่ค่าตามนี้:

| ฟิลด์ | ค่าที่ใส่ |
|-------|----------|
| Description | `Dashboard v1.0` |
| Execute as | **Me** (เจ้าของบัญชี) |
| Who has access | **Anyone** หรือ **Anyone within 2klogistics.co.th** |

4. ถ้าใช้ **Anyone**: ระบบจะตรวจสอบ domain ในโค้ดเอง (`@2klogistics.co.th`)
5. คลิก **Deploy**
6. ถ้าขอ Authorization อีกครั้ง → คลิก **Authorize access** → เลือกบัญชี → **Allow**
7. จะได้ **Web App URL** (จดไว้ให้ดี):
   ```
   https://script.google.com/macros/s/XXXXXXXX/exec
   ```
8. คลิก **Copy URL** → เก็บไว้

### ตรวจสอบ Deploy:

1. เปิด URL ใน Browser ใหม่ (Incognito/Private window)
2. ถ้าเข้าด้วยบัญชี `@2klogistics.co.th` → ต้องเห็นหน้า Dashboard
3. ถ้าเข้าด้วยบัญชีอื่น → ต้องขึ้น `403 Forbidden`

---

## 10. ขั้นตอนที่ 9: ตั้ง Trigger อัตโนมัติ

Trigger จะรันทุกวันเวลา 08:00 เพื่ออัปเดตข้อมูลใหม่

### วิธีตั้งค่า (2 ทาง):

**ทางที่ 1: ผ่าน Menu ใน Google Sheets**

1. เปิด Google Sheets หลัก
2. รอแป๊บนึงให้ Menu `จัดการข้อมูล` โหลด (หรือรีเฟรชหน้า)
3. คลิก **จัดการข้อมูล** → **3. ตั้ง Trigger อัตโนมัติ (08:00 ทุกวัน)**
4. คลิก **OK**

**ทางที่ 2: ผ่าน Apps Script Editor**

1. คลิกที่ช่องเลือกฟังก์ชัน → เลือก `createDailyTrigger`
2. กด **Run**
3. คลิก **Review Permissions** → Allow

### ตรวจสอบ Trigger:

1. คลิกไอคอน **Triggers** (รูปนาฬิกา) ด้านซ้ายของ Editor
2. ต้องเห็น:
   ```
   dailyBatchJob | Time-driven | Day timer | 8:00 AM to 9:00 AM
   ```

---

## 11. ขั้นตอนที่ 10: ทดสอบ Dashboard

### ทดสอบหน้าแรก (ภาพรวมผลประกอบการ)

1. เปิด Web App URL
2. ต้องเห็น:
   - Sidebar ซ้ายมี 3 เมนู
   - หน้าแรกแสดงการ์ด 6 ใบ (Overview, Ranking, Customer, Own/Out, Loss, Vehicle)
   - ตัวเลข KPI ต่างๆ
3. คลิก **View All** บนการ์ดใดการ์ดหนึ่ง → ต้องขึ้น Modal รายละเอียด

### ทดสอบหน้าที่ 2 (วิเคราะห์และเปรียบเทียบ)

1. คลิก **วิเคราะห์และเปรียบเทียบผลการดำเนินงาน**
2. เลือกช่วงวันที่ A และ B
3. คลิก **ตรวจสอบ**
4. ต้องเห็น:
   - เปรียบเทียบเดือน A กับ B
   - รายการเส้นทางพร้อม Anomaly tags
   - สามารถ Export เป็น Excel ได้

### ทดสอบหน้าที่ 3 (ราคาน้ำมัน)

1. คลิก **ตรวจสอบราคาน้ำมันดีเซล**
2. ต้องเห็นกราฟราคาน้ำมัน (ถ้ามีข้อมูลใน OIL_DIESEL_DATA)

### ทดสอบสิทธิ์เข้าถึง

1. ส่ง URL ให้เพื่อนที่ใช้ `@2klogistics.co.th` → ต้องเข้าได้
2. ส่ง URL ให้คนนอก domain → ต้องขึ้น `403 Forbidden`

---

## 12. การใช้งานประจำวัน

### อัปเดตข้อมูลใหม่ (Manual)

ถ้ามีข้อมูลใหม่ในเดือนปัจจุบัน มี 2 วิธี:

**วิธี A: รอ Trigger อัตโนมัติ**
- ข้อมูลจะอัปเดตเองตอน 08:00 ทุกวัน

**วิธี B: รันด้วยตนเอง**
1. เปิด Google Sheets หลัก
2. คลิก **จัดการข้อมูล** → **5. คำนวณ MASTER + CACHE ทั้งหมด**
3. รอ 1-2 นาที
4. รีเฟรชหน้า Dashboard (F5)

### อัปเดตราคาน้ำมัน

1. เปิดชีท `OIL_DIESEL_DATA`
2. เพิ่มแถวใหม่: วันที่ + ราคา
3. รัน `dailyBatchJob()` หรือรอ 08:00

---

## 13. แก้ไขปัญหาเบื้องต้น

### ปัญหา: Dashboard ขึ้น `กำลังโหลดข้อมูล...` นาน

**สาเหตุ:** Cache ยังไม่มีข้อมูล
**แก้ไข:**
1. เปิด Google Sheets → รัน `dailyBatchJob()`
2. รอ 2 นาที
3. รีเฟรชหน้า Dashboard

### ปัญหา: ขึ้น `403 Forbidden`

**สาเหตุ:** บัญชีที่ใช้ไม่ใช่ `@2klogistics.co.th`
**แก้ไข:** ใช้บัญชีที่ถูก domain หรือตรวจสอบใน `Code.gs` ว่า domain ถูกต้อง

### ปัญหา: ข้อมูลใน Dashboard ไม่ตรง

**สาเหตุ:** ชีทต้นทางอาจมีคอลัมน์ว่างคั่น
**แก้ไข:** ตรวจสอบว่า DATA(Mx) มี header ต่อเนื่อง 13 คอลัมน์โดยไม่มีคอลัมน์ว่าง

### ปัญหา: `dailyBatchJob` รันแล้ว Error

**ตรวจสอบ:**
1. เปิด Apps Script → **Executions** (ไอคอนรูปนาฬิกาด้านซ้าย)
2. หาการรันล่าสุด ดู error message
3. ส่วนใหญ่เกิดจาก:
   - ไม่มีชีท `DATA(M1)`-`DATA(M12)`
   - URL ต้นทางผิด
   - ไม่มีสิทธิ์เข้าถึง Sheets ต้นทาง

### ปัญหา: Trigger ไม่ทำงาน

**แก้ไข:**
1. เปิด Apps Script → **Triggers**
2. ถ้าไม่มี Trigger → สร้างใหม่ (เลือก `createDailyTrigger` แล้ว Run)
3. ถ้ามีแต่ไม่ทำงาน → ลบทั้งหมด → สร้างใหม่

---

## 14. ตารางสรุปชื่อชีทและ Header

### ชีทต้นทาง (DATA M1-M12)

| คอลัมน์ | ชื่อ (Header แถว 1) | ตัวอย่างข้อมูล | จำเป็นต้องมี |
|--------|---------------------|---------------|------------|
| A | วันที่ | 01/01/2025 | ✅ |
| B | ลูกค้า | BEST Express | ✅ |
| C | ประเภทรถ | 6W | ✅ |
| D | ชื่อเส้นทาง | BKK-CNX | ✅ |
| E | เส้นทาง (Route) | BKK-CNX | ✅ |
| F | ชื่อพขร | สมชาย | ✅ |
| G | ทะเบียน | กข1234 | ✅ |
| H | จ่ายสำรองน้ำมัน | 5000 | ไม่บังคับ |
| I | ชื่อผู้รับโอน | บริษัท เอ | ไม่บังคับ |
| J | ราคารับ | 15000 | ✅ |
| K | ราคาจ่าย | 12000 | ✅ |
| L | ส่วนต่าง | 3000 | ไม่บังคับ |
| M | กำไร % | 20 | ไม่บังคับ |

### ชีทน้ำมัน (OIL_DIESEL_DATA)

| คอลัมน์ | ชื่อ (Header แถว 1) | ตัวอย่างข้อมูล |
|--------|---------------------|---------------|
| A | วันที่ | 2025-01-01 |
| B | ราคาน้ำมัน | 32.50 |
| C | แหล่งข้อมูล | PTTOR |
| D | หมายเหตุ | ราคาประจำวัน |

### ชีทระบบ (ไม่ต้องใส่ข้อมูลเอง)

| ชื่อชีท | หน้าที่ |
|---------|---------|
| MASTER | รวมข้อมูลทุกเดือน (สร้างอัตโนมัติ) |
| SUMMARY_CACHE | เก็บ JSON ของ KPI (สร้างอัตโนมัติ) |
| TRIPS_CACHE | เก็บ JSON ของรายเที่ยว + Anomaly (สร้างอัตโนมัติ) |

---

## สรุปขั้นตอนทั้งหมด (Checklist)

- [ ] สร้าง Google Sheets หลัก + แชร์ให้ `@2klogistics.co.th`
- [ ] สร้างชีท `DATA(M1)` ถึง `DATA(M12)` พร้อม Header 13 คอลัมน์
- [ ] สร้างชีท `MASTER`, `SUMMARY_CACHE`, `TRIPS_CACHE`, `OIL_DIESEL_DATA`
- [ ] เปิด Apps Script จาก Sheets หลัก
- [ ] ลบไฟล์เก่าทั้งหมดใน Apps Script
- [ ] สร้างไฟล์ใหม่ 5 ไฟล์ (`Code.gs`, `config.gs`, `Index.html`, `Styles.html`, `App.html`)
- [ ] แก้ไข URL M6-M12 ใน `config.gs`
- [ ] รัน `dailyBatchJob()` ครั้งแรก + อนุญาตสิทธิ์
- [ ] ตรวจสอบชีท `MASTER`, `SUMMARY_CACHE`, `TRIPS_CACHE` มีข้อมูล
- [ ] Deploy Web App (Execute as Me)
- [ ] ตั้ง Trigger รัน 08:00 ทุกวัน
- [ ] ทดสอบ Dashboard ทั้ง 3 หน้า
- [ ] ทดสอบสิทธิ์เข้าถึง (domain restriction)

---

**จัดทำโดย:** GAS Dashboard Migration Project
**เวอร์ชัน:** 2.3
**สถานะ:** พร้อม Deploy
