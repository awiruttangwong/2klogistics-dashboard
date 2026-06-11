# DATA(M1) Query Flow

Last updated: 2026-06-10

## จุดประสงค์

เอกสารนี้อธิบายแบบตรงประเด็นว่า กว่าระบบจะได้ข้อมูลมาอยู่ในชีท `DATA(M1)` มีขั้นตอนอะไรบ้าง โดยเน้น:

- ต้นทางของข้อมูล
- บทบาทของ `QUERY`
- การดึง `header`
- การคัดคอลัมน์
- การคัดแถว
- การเขียนลง `DATA(M1)`

ไฟล์อ้างอิง:

- `Dashboard/API/config.gs`
- `Dashboard/API/Code.gs`

## สรุปสั้นที่สุด

`DATA(M1)` ไม่ได้ถูกสร้างจาก `QUERY()` ใน `Code.gs`

ลำดับจริงคือ:

1. `config.gs` บอกว่า `DATA(M1)` ต้องไปอ่านไฟล์ Google Sheets ไหน
2. `config.gs` บอกว่าภายในไฟล์ต้นทางต้องอ่าน tab ไหน
3. ถ้า tab ต้นทางนั้นมีสูตร `QUERY()` หรือ `IMPORTRANGE()` อยู่แล้ว สูตรนั้นจะทำงานใน Google Sheet ต้นทางก่อน
4. `Code.gs` ไปอ่าน “ผลลัพธ์ที่แสดงอยู่ใน tab ต้นทาง” ด้วย `getDisplayValues()`
5. `Code.gs` คัดเฉพาะคอลัมน์ที่กำหนดไว้ใน `SELECT_COLS`
6. `Code.gs` ตัดแถวที่ไม่ผ่านเงื่อนไข `NOT_NULL_COLS`
7. `Code.gs` เขียนข้อมูลชุดนั้นลงชีท `DATA(M1)`
8. `Code.gs` cleanup ซ้ำอีกรอบด้วย `processSheetData()`

ดังนั้นคำว่า `QUERY` อยู่ที่ “ชีทต้นทาง” ไม่ได้อยู่ในฝั่ง Apps Script import logic

## 1) ระบบรู้ได้อย่างไรว่า `DATA(M1)` ต้องไปดึงจากไหน

ใน `Dashboard/API/config.gs` มี 2 ตัวแปรหลัก

### 1.1 `SHEET_SOURCES`

ตัวนี้เก็บ URL ของไฟล์ต้นทาง

สำหรับ `DATA(M1)` ตอนนี้คือ:

```js
SHEET_SOURCES['DATA(M1)']
```

ค่าที่ได้คือ URL ของ Google Spreadsheet ต้นทาง

## 1.2 `SOURCE_SHEET_NAMES`

ตัวนี้เก็บชื่อ tab ที่ต้องอ่านภายในไฟล์ต้นทาง

สำหรับ `DATA(M1)` ตอนนี้คือ:

```js
SOURCE_SHEET_NAMES['DATA(M1)'] === 'SUM'
```

หมายความว่า:

- ระบบจะเปิดไฟล์จาก URL ของ `DATA(M1)`
- แล้วไปอ่าน tab ชื่อ `SUM`

## 2) `QUERY` อยู่ตรงไหน

จุดนี้สำคัญมาก

ฝั่ง `Code.gs` ไม่มีโค้ดแบบนี้:

```js
=QUERY(...)
```

หรือไม่มีการ compose SQL-like query string เพื่อไป query source sheet โดยตรง

สิ่งที่เกิดขึ้นจริงคือ:

- tab ต้นทาง เช่น `SUM`
- อาจเป็น tab ที่มีสูตร `QUERY()` อยู่แล้ว
- หรืออาจมี `IMPORTRANGE()` + `QUERY()`
- หรืออาจเป็นข้อมูลดิบธรรมดา

จากนั้น `Code.gs` จะอ่านค่าที่แสดงอยู่ใน tab นั้นออกมา

พูดง่าย ๆ:

- Google Sheets ต้นทางทำ `QUERY`
- `Code.gs` ทำ `import + filter + normalize`

## 3) ขั้นตอนตั้งแต่เริ่มจนได้ `DATA(M1)`

Flow จริงตอนรัน `importAllConfiguredSheets()` หรือ `dailyBatchJob()` มีแบบนี้

### Step 1: วนลูปรายชื่อเดือน

ใน `Code.gs` ฟังก์ชัน `importAllConfiguredSheets()` จะวนรายการ:

```js
'DATA(M1)' ... 'DATA(M12)'
```

เมื่อถึงรอบของ `DATA(M1)`:

- ตั้ง `sheetName = 'DATA(M1)'`
- อ่าน `sourceUrl = SHEET_SOURCES[sheetName]`

ถ้า URL ว่างหรือไม่ใช่ลิงก์ `http`:

- ชีทนั้นจะถูก skip ทันที

### Step 2: สร้างหรือหา destination sheet

ระบบจะเรียก `getOrCreateSheet(ss, sheetName)`

ผลคือ:

- ถ้ามีชีท `DATA(M1)` อยู่แล้ว จะใช้ชีทเดิม
- ถ้ายังไม่มี จะสร้างชีทใหม่ชื่อ `DATA(M1)`

### Step 3: หา source tab

ระบบจะอ่าน:

```js
var sourceSheetName = SOURCE_SHEET_NAMES[sheetName] || 'SUMDATA';
```

สำหรับ `DATA(M1)` ตอนนี้ได้ค่า:

```js
'SUM'
```

### Step 4: เปิดไฟล์ต้นทาง

ฟังก์ชัน `fetchSourceData(sourceUrl, sourceSheetName)` ทำงานต่อ

ภายในฟังก์ชันนี้:

1. `SpreadsheetApp.openByUrl(sourceUrl)`
2. `getSheetByName(sourceSheetName)`

ถ้าเปิดไฟล์ไม่ได้:

- โยน error ว่าไม่มีสิทธิ์หรือ URL ไม่ถูกต้อง

ถ้าไม่พบ tab:

- โยน error ว่าไม่พบหน้าชีทที่ชื่อกำหนด

### Step 5: อ่านค่าทั้ง tab ต้นทาง

จากนั้นระบบอ่านทั้งช่วงข้อมูลด้วย:

```js
var range = sourceSheet.getRange(1, 1, lastRow, lastCol);
var values = range.getDisplayValues();
```

คำว่า `getDisplayValues()` สำคัญมาก เพราะหมายความว่า:

- ถ้า cell มีสูตร `QUERY()`
- ระบบจะอ่าน “ค่าที่แสดงผลแล้ว”
- ไม่ได้อ่านสูตรดิบ

ดังนั้นถ้า tab `SUM` เป็นผลลัพธ์จาก `QUERY`
ระบบก็จะได้ผลลัพธ์ของ `QUERY` มาใช้งานเลย

## 4) ระบบดึง `header` ยังไง

หลังอ่าน source tab แล้ว `fetchSourceData()` จะเอาแถวแรกมาเป็น source header

จากนั้นสร้าง header ใหม่ด้วย `SELECT_COLS`

Pseudo flow:

```js
for each colIdx in SELECT_COLS:
  header.push(values[0][colIdx] || 'Col' + (colIdx + 1))
```

ความหมายคือ:

- ไม่ได้ยก header มาทั้งแถว
- ยกมาเฉพาะคอลัมน์ที่อยู่ใน `SELECT_COLS`
- เรียงตามลำดับที่ `SELECT_COLS` กำหนด
- ถ้าหัวคอลัมน์ต้นทางช่องนั้นว่าง จะตั้งชื่อ fallback เช่น `Col18`

## 5) ระบบคัดคอลัมน์อะไรบ้าง

ใน `config.gs` ตอนนี้มี:

```js
var SELECT_COLS = [0, 1, 4, 7, 8, 9, 10, 12, 13, 17, 18, 19, 20];
```

แปลว่า source row 1 แถว จะถูกย่อเหลือ 13 คอลัมน์นี้:

| Source index | ความหมาย |
| --- | --- |
| 0 | วันที่ |
| 1 | ลูกค้า |
| 4 | ประเภทรถ |
| 7 | ชื่อเส้นทาง |
| 8 | เส้นทาง (Route) |
| 9 | ชื่อพขร. |
| 10 | ทะเบียน |
| 12 | จ่ายสำรองน้ำมัน |
| 13 | ชื่อผู้รับโอน |
| 17 | ราคารับ |
| 18 | ราคาจ่าย |
| 19 | ส่วนต่าง |
| 20 | กำไร % |

ดังนั้น `DATA(M1)` หลัง import จะเป็น layout ต่อเนื่อง 13 คอลัมน์เสมอ

## 6) ระบบคัดแถวก่อนเขียนลง `DATA(M1)` ยังไง

ยังอยู่ใน `fetchSourceData()`

ก่อนจะ push row ลง result ระบบจะตรวจ `NOT_NULL_COLS`

ค่าปัจจุบัน:

```js
var NOT_NULL_COLS = [0, 1, 8];
```

ความหมาย:

- source col `0` ต้องไม่ว่าง
- source col `1` ต้องไม่ว่าง
- source col `8` ต้องไม่ว่าง

ถ้าแถวไหนไม่ผ่าน:

- จะไม่ถูก import เข้ามาเลย

## 7) เขียนข้อมูลลง `DATA(M1)` ยังไง

เมื่อ `fetchSourceData()` คืนค่า `data`

ระบบจะเรียก:

```js
writeDataToSheet(sheet, data)
```

ฟังก์ชันนี้ทำ 2 อย่าง:

1. ล้าง content เก่าทั้งชีท
2. เขียน `data` ใหม่ลงตั้งแต่ cell `A1`

ดังนั้น `DATA(M1)` จะถูก replace ทั้งก้อนทุกครั้งที่ sync

## 8) หลังเขียนแล้ว cleanup อะไรอีก

หลังเขียนลง `DATA(M1)` แล้ว ระบบยังเรียก:

```js
processSheetData(sheet)
```

ตรงนี้มี cleanup รอบสอง

### 8.1 ตรวจ `#REF!`

ระบบเช็ค 5 แถวแรกของข้อมูลที่ import มา

ถ้าพบ `#REF!`:

- จะ throw error ทันที
- ข้อความคือให้กลับไปตรวจ `QUERY/IMPORTRANGE` ฝั่ง source

ความหมายในทางปฏิบัติ:

- ถ้า source tab ที่ใช้ทำ `QUERY()` พัง
- `DATA(M1)` จะ sync ไม่ผ่าน

### 8.2 คัดแถวตามกลุ่มคอลัมน์มูลค่า

ระบบจะดูคอลัมน์ local index `9,10,11`

หลัง import แล้วคอลัมน์พวกนี้คือ:

- `ราคารับ`
- `ราคาจ่าย`
- `ส่วนต่าง`

กฎตอนนี้คือ:

- ถ้า 3 ช่องนี้ว่าง/ศูนย์หมด ให้ตัดแถวทิ้ง
- ถ้า `ราคารับ` มีค่า แต่ `ราคาจ่าย` และ `ส่วนต่าง` ว่าง/ศูนย์ ให้ตัดทิ้ง

### 8.3 map ชื่อลูกค้า

ในคอลัมน์ลูกค้า ระบบเรียก `mapCustomer()`

ตัวอย่าง:

- ขึ้นต้นด้วย `FLASH` จะ normalize เป็น `FLASH`
- `kerry` จะ map เป็น `KEX`

## 9) สุดท้าย `DATA(M1)` คืออะไรแน่

`DATA(M1)` คือ “ข้อมูล intermediate ที่ผ่านการ import และคัดแถวแล้ว”

มันยังไม่ใช่ payload API โดยตรง

หลังจากนั้นระบบจะ:

1. เอา `DATA(M1)` ถึง `DATA(M12)` มารวมเป็น `MASTER`
2. parse `MASTER` เป็น trip object
3. สร้าง `TRIPS_CACHE` และ `SUMMARY_CACHE`
4. frontend query จาก cache พวกนี้อีกที

## 10) ภาพ flow แบบสั้น

```text
Source Spreadsheet URL
  -> Source Tab (SUM)
  -> สูตร QUERY/IMPORTRANGE ใน source ทำงานก่อน
  -> Code.gs openByUrl()
  -> getSheetByName('SUM')
  -> getDisplayValues()
  -> build header from SELECT_COLS
  -> filter rows by NOT_NULL_COLS
  -> writeDataToSheet(DATA(M1))
  -> processSheetData(DATA(M1))
  -> DATA(M1) พร้อมใช้งาน
```

## 11) ถ้าจะ debug ว่า `DATA(M1)` มาผิดจากไหน ให้ดูอะไรบ้าง

ลำดับตรวจที่เร็วที่สุด:

1. เช็ค `SHEET_SOURCES['DATA(M1)']` ว่าชี้ไฟล์ถูกไหม
2. เช็ค `SOURCE_SHEET_NAMES['DATA(M1)']` ว่า tab ถูกไหม
3. เปิด tab ต้นทางดูว่ามี `QUERY()` หรือ `IMPORTRANGE()` พังหรือไม่
4. เช็คว่าคอลัมน์ที่ต้องใช้ยังอยู่ index เดิมตาม `SELECT_COLS` ไหม
5. เช็คว่าข้อมูลที่จำเป็นใน `NOT_NULL_COLS` ไม่ว่าง
6. เช็คว่าหลัง import แล้วค่า `ราคารับ/ราคาจ่าย/ส่วนต่าง` ไม่โดน cleanup ทิ้ง

## 12) ข้อสรุปสำคัญ

ถ้าถามว่า “กว่าจะได้ `DATA(M1)` มามีขั้นตอนอะไรบ้าง”

คำตอบคือ:

1. config ระบุ source file
2. config ระบุ source tab
3. source tab อาจใช้ `QUERY()` อยู่แล้ว
4. `Code.gs` อ่านผลลัพธ์ที่แสดงจาก source tab
5. ดึง header เฉพาะคอลัมน์ใน `SELECT_COLS`
6. ดึง row เฉพาะแถวที่ผ่าน `NOT_NULL_COLS`
7. เขียนทับลง `DATA(M1)`
8. cleanup ข้อมูลใน `DATA(M1)` อีกรอบ

และถ้าถามว่า “`QUERY` อยู่ตรงไหน”

คำตอบที่แม่นที่สุดคือ:

- `QUERY` อยู่ที่ source sheet
- `Code.gs` ไม่ได้สร้าง `QUERY`
- `Code.gs` อ่านผล `QUERY` แล้วเอามาจัดรูปต่อ
