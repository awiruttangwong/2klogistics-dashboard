# Supabase V3 Workflow And Risk Analysis

Last updated: 2026-06-23

## Purpose

เอกสารนี้เป็น workflow การเริ่มงาน `Data sum Daily express 4 month V3` สำหรับย้าย database จาก Google Sheets + Apps Script ไปใช้ Supabase โดยมีเงื่อนไขสำคัญ:

- ห้ามกระทบ production เดิม
- ห้ามกระทบ repo เดิม `awiruttangwong/2klogistics-dashboard`
- งาน migration ทั้งหมดต้องทำใน repo ใหม่ `awiruttangwong/2klogistics-dashboard-v2.0`
- โฟลเดอร์ทำงานใหม่ควรแยกจาก `Data sum Daily express 4 month V2.3 base`
- ระบบเดิมต้องยังเป็น rollback/fallback ได้จนกว่า Supabase จะผ่าน parity test ครบ

## One Sentence Goal

ย้าย read model และ query workload จาก Google Sheets cache ไป Supabase โดยยังให้ Google Sheet ต้นทางเป็น source เดิมในช่วงแรก และให้ API ใหม่ตอบ payload ได้เหมือน `Code.gs` เดิมก่อนเปลี่ยน frontend จริง

## Simpler Alternative Check

ก่อนย้ายจริง มีทางเลือกที่เล็กกว่า:

1. เพิ่ม `CacheService` ใน Apps Script
2. เพิ่ม paging ให้ `TRIPS_CACHE`
3. แยก JSON cache ออกเป็นรายเดือนหรือรายวัน

แต่ทางเลือกเหล่านี้แก้ได้แค่ performance บางส่วน ยังติดข้อจำกัดเดิม:

- Apps Script ยังต้องอ่าน/parse JSON ก้อนใหญ่
- audit/diff ยังพึ่ง sheet log
- query ซับซ้อนตาม date/route/customer ยังไม่ใช่ database จริง
- ข้อมูลโตขึ้นจะชน timeout และ quota ง่ายขึ้น

ดังนั้น Supabase มีเหตุผลถ้าเป้าหมายคือยกระบบเป็น database จริง แต่ต้องทำแบบ shadow mode ก่อนเท่านั้น

## Existing System Trace

ระบบเดิมทำงานแบบนี้:

```text
Dashboard/API/config.gs
  -> SHEET_SOURCES
  -> SOURCE_SHEET_NAMES
  -> SELECT_COLS
  -> NOT_NULL_COLS

Dashboard/API/Code.gs
  -> dailyBatchJob()
  -> importAllConfiguredSheetsSilentWithReport()
  -> fetchSourceData()
  -> writeDataToSheet(DATA(Mx))
  -> processSheetData(DATA(Mx))
  -> rebuildMasterSheet()
  -> rebuildCaches()
  -> writeLargeJsonToSheet(SUMMARY_CACHE)
  -> writeLargeJsonToSheet(TRIPS_CACHE)
  -> doGet()
```

Frontend ใช้งานผ่าน:

```text
Dashboard/scripts/api-config.js
  -> baseUrl = Apps Script Web App URL

Dashboard/scripts/app.js
  -> apiGet(action, params)
  -> action=summary/trips/compare/oil/routes/customers
```

จุดที่ Supabase ต้องแทนให้ได้คือผลลัพธ์ปลายทางของ `doGet()` ไม่ใช่แค่ตารางดิบ

## Critical Risk Matrix

### 1) Data mismatch

Severity: Blocker

ความเสี่ยง:

- Supabase มีจำนวนเที่ยวไม่ตรงกับ `TRIPS_CACHE`
- ยอด `recv/pay/oil/margin` ไม่ตรง
- frontend/export XLSX แสดงผลเพี้ยน

สาเหตุที่เป็นไปได้:

- port logic `parseTripRow()` ไม่ครบ
- parse date/number คนละแบบ
- route key FLASH/SPX คนละสูตร
- missing vehicle type / BTS normalization คนละจุด
- company trip logic `pay = 0` ไม่เหมือนเดิม

การป้องกัน:

- ช่วงแรกให้ `Code.gs` เป็นตัว normalize เหมือนเดิม แล้วค่อยส่ง normalized object เข้า Supabase
- ห้ามให้ Supabase คิด route key เองใน phase แรก
- ทำ parity report ทุก sync

ต้องผ่าน:

```text
TRIPS_CACHE.total == Supabase trips count
sum(recv) ตรงกัน
sum(pay) ตรงกัน
sum(oil) ตรงกัน
sum(margin) ตรงกัน
count by date ตรงกัน
count by route_key ตรงกัน
```

### 2) Duplicate rows

Severity: Blocker

ความเสี่ยง:

- `dailyBatchJob` รันซ้ำแล้ว insert แถวเดิมซ้ำ
- KPI เพิ่มผิด
- XLSX summary เพี้ยน

การป้องกัน:

- ต้องมี `row_hash unique`
- ใช้ upsert แทน insert
- hash จาก normalized identity ไม่ใช่จาก raw display text ที่เปลี่ยนง่าย

แนะนำ hash fields:

```text
date
customer
vtype
route_key
route
route_desc
driver
plate
payee
oil
recv
pay
margin
source_month
```

### 3) API contract drift

Severity: Blocker

ความเสี่ยง:

- frontend โหลดได้แต่บางหน้าพัง
- compare/export ใช้ field ที่ API ใหม่ไม่ได้ส่ง
- route filter ใช้ `routeKey` แต่ Supabase ส่งชื่ออื่น

การป้องกัน:

- API ใหม่ต้องคืน field เดิมทั้งหมดก่อน
- มี contract test เทียบกับ `validateFrontendApiContract()`
- ห้าม rename field ใน phase แรก

ต้องรักษา field สำคัญ:

```text
date, customer, route, routeDesc, routeKey, routeCore, routeVehicle,
routePrefix, routeGroup, isFlashRoute, vtype, driver, plate, payee,
recv, pay, oil, margin, reason, anomalies
```

### 4) Query behavior mismatch

Severity: Major

ความเสี่ยง:

- `action=trips&route=...` คืนไม่เหมือนเดิม
- route display/key matching ผิด

ระบบเดิม match route ด้วย:

```text
t.route
getTripRouteKey_(t)
getTripRouteDisplay_(t)
```

Supabase API ใหม่ต้อง match:

```text
route
route_key
route_group
```

### 5) Source formula errors

Severity: Major

ความเสี่ยง:

- source sheet มี `#REF!`, `QUERY`, `IMPORTRANGE` พัง
- Apps Script import ไม่ผ่าน
- Supabase ไม่ได้ data ล่าสุด

การป้องกัน:

- เก็บ source import status ลง `source_month_imports`
- ถ้า source เดือนไหน fail ห้ามลบข้อมูล Supabase เดิมทิ้งทันที
- sync run ต้องมี status `partial_failed`

### 6) Partial sync

Severity: Major

ความเสี่ยง:

- sync ได้บางเดือน
- frontend เห็นข้อมูลผสมเก่า/ใหม่

การป้องกัน:

- ใช้ `sync_run_id`
- import เข้า staging ก่อน
- เมื่อครบและผ่าน validation ค่อย mark เป็น active

แนวทางที่ปลอดภัย:

```text
trips_staging(sync_run_id)
  -> validate
  -> promote to trips_active
```

หรือใช้ column:

```text
is_active boolean
sync_run_id
```

แต่ phase แรกอาจเริ่มด้วย direct upsert ได้ ถ้ายังไม่ให้ frontend อ่าน Supabase จริง

### 7) Security/key leakage

Severity: Blocker

ความเสี่ยง:

- Supabase service role key หลุดใน frontend
- ใครก็เขียน/ลบข้อมูลได้

การป้องกัน:

- ห้ามใส่ service role key ใน `Dashboard/scripts/*.js`
- key เขียนข้อมูลต้องอยู่ใน server-side เท่านั้น
- เปิด RLS ทุก table
- frontend phase แรกอ่านผ่าน API layer ไม่อ่าน Supabase ตรง

### 8) Performance and timeout

Severity: Major

ความเสี่ยง:

- Apps Script ส่งข้อมูลเข้า Supabase ทีละแถวจน timeout
- daily job ล้มกลางทาง

การป้องกัน:

- batch upsert เช่น 500-1000 rows ต่อ request
- retry เฉพาะ batch ที่ fail
- log batch number และ error
- ถ้า Apps Script ช้า ให้ย้าย sync write ไป Netlify Function ใน phase ถัดไป

### 9) Frontend fallback confusion

Severity: Major

ความเสี่ยง:

- บาง endpoint อ่าน Apps Script บาง endpoint อ่าน Supabase โดยไม่รู้ตัว
- ตัวเลขหน้า UI กับ export ไม่ตรง

การป้องกัน:

- เพิ่ม `apiMode`
- แสดง source mode ใน debug/meta
- ใน phase test ต้องเลือก source ชัดเจน

```js
apiMode: 'apps-script' | 'supabase-with-fallback' | 'supabase'
```

### 10) Repo/workspace contamination

Severity: Blocker

ความเสี่ยง:

- เผลอ push งาน Supabase เข้า repo เดิม
- production เดิม deploy โค้ดทดลอง
- remote สลับผิด

การป้องกัน:

- ทำงานในโฟลเดอร์ใหม่ `Data sum Daily express 4 month V3`
- repo ใหม่ต้องชี้ `origin` ไปที่ `2klogistics-dashboard-v2.0`
- repo เดิมห้าม deploy จากงาน V3
- production เดิมยังอยู่ Netlify/site เดิมจนกว่าจะตั้ง site ใหม่หรือ cutover

## V3 Workspace Workflow

### Preferred method: clone repo v2 directly

วิธีนี้ปลอดภัยกว่า copy folder เพราะ remote จะถูกต้องตั้งแต่แรก

```powershell
cd "C:\Users\ADMIN\Desktop"
git clone https://github.com/awiruttangwong/2klogistics-dashboard-v2.0.git "Data sum Daily express 4 month V3"
cd "Data sum Daily express 4 month V3"
git status --short --branch
git remote -v
```

Expected:

```text
## main...origin/main
origin  https://github.com/awiruttangwong/2klogistics-dashboard-v2.0.git
```

### Alternative method: copy folder manually

ใช้ได้ แต่ต้องระวัง `.git`

ถ้า copy จาก `Data sum Daily express 4 month V2.3 base` ไปเป็น `Data sum Daily express 4 month V3`:

1. ห้ามใช้ `.git` เดิมโดยไม่ตรวจ
2. ตรวจ remote ทันที
3. ถ้า remote ยังเป็น repo เดิม ต้องเปลี่ยนเป็น v2

คำสั่งตรวจ:

```powershell
git remote -v
git branch -vv
```

ถ้าต้องตั้ง repo ใหม่:

```powershell
git remote remove origin
git remote add origin https://github.com/awiruttangwong/2klogistics-dashboard-v2.0.git
git branch -M main
git pull --ff-only origin main
```

ถ้าไม่แน่ใจ ห้าม push

## Chat Session Workflow

เมื่อเริ่มแชทใหม่สำหรับ V3 ให้บอกบริบทนี้:

```text
เรากำลังทำงานในโฟลเดอร์ Data sum Daily express 4 month V3
repo คือ awiruttangwong/2klogistics-dashboard-v2.0
ห้ามแตะ repo เดิม awiruttangwong/2klogistics-dashboard
ห้าม deploy production เดิม
อ่าน docs:
- Dashboard/docs/SUPABASE_DATABASE_MIGRATION_PLAN.md
- Dashboard/docs/SUPABASE_V3_WORKFLOW_AND_RISK_ANALYSIS.md
- Dashboard/docs/CODE_GS_IMPORT_AND_QUERY_LOGIC.md
- Dashboard/docs/DATA_M1_QUERY_FLOW.md
เป้าหมายคือทำ Supabase shadow migration ก่อน
```

## Development Branch Workflow

แนะนำอย่าทำบน `main` ตลอด

```powershell
git checkout -b supabase-shadow-sync
```

branch ตาม phase:

```text
supabase-schema
supabase-shadow-sync
supabase-parity-report
supabase-api-compat
frontend-dual-api
```

merge เข้า `main` เฉพาะเมื่อ:

- syntax/test ผ่าน
- ไม่มี secret ติด git
- ไม่มีการเปลี่ยน production config เดิมโดยไม่ตั้งใจ

## Supabase Migration Execution Order

### Step 1: Prepare project

- สร้าง Supabase project
- สร้าง tables ตาม `SUPABASE_DATABASE_MIGRATION_PLAN.md`
- เปิด RLS
- ตั้ง indexes
- เก็บ keys ใน server-side env เท่านั้น

### Step 2: Add shadow sync

เพิ่มใน `Code.gs` หรือ service แยก:

```text
syncSupabaseStartRun_()
syncSupabaseTrips_(tripsWithAnomalies)
syncSupabaseSummary_(summary)
syncSupabaseOil_(oilPayload)
syncSupabaseFinishRun_()
```

ยังไม่เปลี่ยน frontend

### Step 3: Add parity reports

สร้าง report เทียบ:

```text
Apps Script TRIPS_CACHE vs Supabase trips
Apps Script SUMMARY_CACHE vs Supabase summary snapshot
```

ต้องมี output:

```text
ok
tripCountDiff
recvDiff
payDiff
oilDiff
marginDiff
dailyDiff[]
routeDiff[]
missingRows[]
extraRows[]
```

### Step 4: API compatibility layer

ทำ endpoint ใหม่ที่คืน shape เดิม:

```text
/meta
/health
/summary
/trips
/compare
/oil
/routes
/customers
```

### Step 5: Frontend dual API

เพิ่ม config:

```js
apiMode: 'apps-script'
supabaseApiUrl: ''
```

ยัง default เป็น `apps-script`

### Step 6: Smoke test

ต้องผ่าน:

- หน้าโหลดสำเร็จ
- dashboard overview ถูก
- normal compare ถูก
- compare mode ถูก
- 7D vs Previous ถูก
- filter ถูก
- export XLSX ถูก
- route identity FLASH/SPX ถูก
- QA checkbox/export ไม่พัง

### Step 7: Cutover

หลัง parity ผ่านต่อเนื่องหลายรอบ:

```text
apiMode = supabase-with-fallback
```

หลังมั่นใจ:

```text
apiMode = supabase
```

## Required Definition Of Done

ห้ามถือว่า migration สำเร็จจนกว่าจะผ่านทั้งหมด:

- Supabase data count ตรงกับ Apps Script
- financial totals ตรงกัน
- API contract เดิมครบ
- frontend ทุกโหมดทำงาน
- export XLSX ทำงาน
- ไม่มี secret ใน git
- rollback กลับ Apps Script ได้
- repo เดิมไม่ถูกแตะ
- production เดิมไม่ถูก deploy จาก V3

## Work That Must Not Happen In V3 Early Phase

ห้ามทำสิ่งเหล่านี้ในช่วงแรก:

- ห้ามลบ Apps Script API เดิม
- ห้ามเปลี่ยน production Netlify เดิม
- ห้ามให้ frontend อ่าน Supabase ตรงด้วย service role
- ห้าม rewrite route logic ใหม่ทั้งหมดตั้งแต่ต้น
- ห้ามย้าย anomaly/export logic พร้อมกันกับ database migration
- ห้าม force push ไป repo เดิม
- ห้ามเอาไฟล์ `.env` หรือ key เข้า git

## Recommended First V3 Task

งานแรกใน V3 ควรเป็นงานที่ไม่กระทบ production:

```text
Create Supabase schema SQL + local documentation only
```

งานที่สอง:

```text
Add shadow sync writer behind feature flag
```

งานที่สาม:

```text
Run parity report without changing frontend
```

## Final Verdict

แผนย้ายไป Supabase ทำได้และมีเหตุผล แต่ต้องถือว่าเป็น database migration ที่มีความเสี่ยงสูงต่อความถูกต้องของตัวเลข ไม่ใช่แค่เปลี่ยน API URL

แนวทางที่ควรใช้คือ:

```text
repo ใหม่
โฟลเดอร์ใหม่
shadow sync
parity report
API compatibility
frontend fallback
cutover ทีหลัง
```

ถ้าทำตามลำดับนี้ ความเสี่ยงต่อระบบเดิมต่ำมาก เพราะ production เดิมและ repo เดิมจะไม่ถูกแตะจนกว่า Supabase จะพิสูจน์ได้ว่าคืนข้อมูลตรงกับ `Code.gs` เดิมทุกส่วน
