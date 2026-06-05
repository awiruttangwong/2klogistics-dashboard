# Dashboard Optimization Audit - No Code Changes

วันที่ตรวจ: 2026-06-03  
ขอบเขต: วิเคราะห์ `Dashboard` และโฟลเดอร์ `skills` เพื่อหาแนวทาง optimize ระบบให้ลื่นขึ้น โดยไม่แก้ logic การดึงข้อมูลหรือการประมวลผลในรอบนี้

## สถานะสำคัญ

เอกสารนี้เริ่มต้นเป็นรายงานตรวจสอบเท่านั้น โดยไม่ได้แก้ไฟล์ runtime, config, data, API หรือสูตรคำนวณใด ๆ ในวันที่จัดทำรายงานเดิม ส่วนสถานะด้านล่างใช้ติดตามงานที่นำไปทำต่อหลังรายงานนี้

Baseline ที่ตรวจแล้ว:

- `node --check Dashboard\scripts\app.js` ผ่าน ไม่มี syntax error
- ก่อนสร้างรายงาน `git status --short` ไม่มีรายการเปลี่ยนแปลง
- ไฟล์หลักมีขนาดใหญ่และมีผลต่อ startup/render cost:
- `Dashboard/scripts/app.js` ประมาณ 450 KB, 8,443 บรรทัด
- `Dashboard/assets/css/styles.css` ประมาณ 197 KB, 9,088 บรรทัด
- `Dashboard/API/Code.gs` ประมาณ 126 KB, 3,593 บรรทัด
- static fallback `Dashboard/data/fraud_data.js` ประมาณ 2.88 MB
- static fallback `Dashboard/data/data.js` ประมาณ 625 KB

## สถานะการดำเนินงานล่าสุด (2026-06-05)

### ทำแล้ว

- [x] แก้ export XLSX ของมุมมองเปรียบเทียบเฉพาะส่วน compare: เพิ่มชีท `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ` โดยยังใช้รูปแบบคอลัมน์ของมุมมองเปรียบเทียบเอง
- [x] ปรับ logic tag/status ของมุมมองเปรียบเทียบให้ reuse logic เดียวกับมุมมองปกติผ่าน `dcQaTripStatuses()` เพื่อลดโอกาสผลลัพธ์เพี้ยนระหว่าง 2 มุมมอง
- [x] ปรับกรอบข้อความ, alignment คอลัมน์ M, สีคอลัมน์ L, สีเทาอ่อนของค่าไม่เปลี่ยนแปลงใน H-I-J-K-L และความกว้างคอลัมน์ M เฉพาะ XLSX มุมมองเปรียบเทียบ
- [x] เพิ่ม timeout/retry/fallback guard สำหรับ summary API และข้อความ fallback ที่อ่านง่ายขึ้น เช่น `summary API timeout หลังรอ ... วินาที`
- [x] เพิ่ม performance telemetry แบบไม่เปลี่ยน business logic ใน `Dashboard/scripts/app.js`: เก็บเวลาโหลด `summary/trips/oil`, `alignDashboardData`, `showPage`, และ `dcRunCompare` ใน `window.DASHBOARD_PERF_MARKS`
- [x] เพิ่ม cache ให้ `getOilPriceByDate()` ใน Daily Compare เพื่อลด repeated sort ของ `OIL_PRICE_DATA.prices` โดยยังใช้ sort key และเงื่อนไขเลือกราคาเดิม
- [x] Phase 0 baseline 3 รอบด้วย Playwright/Chromium ผ่านแล้ว: static trips 7,919 rows, compare export 6 sheets, XLSX 327,844 bytes, ไม่มี page/console error
- [x] Phase 1 lazy-load `xlsx-js-style` สำเร็จ: หน้า startup ไม่โหลด XLSX, export โหลด XLSX 1 ครั้งเมื่อกดใช้งาน และ compare workbook อ่านกลับได้ 6 sheets ครบ
- [x] Phase 1 lazy-load `flatpickr` สำเร็จ: หน้า startup ไม่โหลด flatpickr, เปิด Daily Compare แล้วโหลด main/locale/CSS ตามต้องการ, date inputs ถูกผูก `_flatpickr`, และ export compare ยังผ่านครบ
- [x] Hotfix startup loading ค้างที่ `http://127.0.0.1:5529/Dashboard/index.html`: ปรับ loader ให้รอ live API ได้ครบ 38,007 trips พร้อม progress ระหว่าง pagination และยังคง fallback เป็น safety net เฉพาะกรณี API ล้มจริง
- [x] Phase 2 รอบแรกใน Daily Compare สำเร็จ: เพิ่ม `rowsByDate`, `allDatesSet`, route identity cache, `rangeStats()` memo และ route-row map สำหรับ single-mode render โดยไม่แตะ startup live API loader, สูตรคำนวณ, schema หรือ XLSX sheet logic
- [x] Phase 2 ต่อเนื่องใน Daily Compare สำเร็จ: เปลี่ยน driver matching ใน compare/unmatched cards จาก `findIndex()` ซ้ำ เป็น driver bucket queue โดยยัง match driver ตามลำดับเดิมและไม่เปลี่ยน status/tag logic
- [x] Phase 2 filter panel DOM diff สำเร็จ: `buildMsOptions()` ข้ามการ rebuild เฉพาะเมื่อ option set/selected set เหมือนเดิมและไม่มี search ค้าง โดยยัง rebuild เมื่อ search ต้องถูก clear หรือ filter state เปลี่ยน
- [x] Phase 2 local metrics guard สำเร็จ: ลด CLS/INP local จาก F12 report โดย preload desktop auto-sidebar ก่อน first paint, ปรับ skeleton ให้ขนาดใกล้ nav/topbar จริง และ defer heavy `showPage()` หลัง nav click เพื่อให้ active state paint ก่อน
- [x] Phase 2 skeleton polish สำเร็จ: ปรับ loading skeleton สำหรับ desktop collapsed sidebar ให้แสดง skeleton block แทนโลโก้จริง, ซ่อน brand/meta skeleton ที่ถูกบีบ, จัด nav skeleton เป็น icon blocks และเปลี่ยน topbar skeleton เป็น icon + text line ที่สมดุลขึ้น
- [x] Phase 2 sidebar hover polish สำเร็จ: หน้า Daily Compare คลิก nav แล้วยุบ auto-sidebar เพื่อไม่ให้ดูค้างเปิด, ขยับเมาส์ใน sidebar แล้วเปิดกลับได้, mouse leave แล้วยุบกลับ 94px และข้อความ nav หลัง hover ไม่ fade ช้าจนเหมือนค้าง
- [x] Phase 2 sidebar timing follow-up สำเร็จ: ลด auto-sidebar transition เป็น 280ms และลด mouse-leave delay เพื่อให้หน้า Daily Compare ยุบกลับไวขึ้น โดยทดสอบ live API/hover/leave แล้วไม่พบ fallback หรือ console/page error

### ยังไม่ทำในรอบนี้

- [ ] Summary-first แล้ว background-load trips: ยังไม่ทำ เพราะอาจกระทบ stable behavior ที่หน้า compare ต้องมี trips พร้อมก่อน render
- [ ] Browser/API payload cache ด้วย version key: ยังไม่ทำ เพราะต้องยืนยัน cache invalidation กับ batch/API version ก่อน เพื่อกันข้อมูลเก่าค้าง
- [ ] CSS/animation polish ส่วนอื่นๆ: ยังไม่ทำ เพราะเป็นงาน visual/perf กว้างกว่าส่วน sidebar hover ที่แก้เฉพาะจุดแล้ว และควรทำหลังมี baseline telemetry เพิ่มเติม
- [x] Phase 2 filter panel DOM diff: ทำแล้วและทดสอบ interaction ของ route filter panel ผ่าน

Guardrail ของรอบล่าสุด: ไม่เปลี่ยนสูตรคำนวณ margin, pct, oil ratio, route identity, schema ข้อมูล, fallback data, startup live API loader, XLSX sheet logic, หรือ labels ของมุมมองปกติ

### Baseline ล่าสุดหลังเพิ่ม telemetry (2026-06-04)

ทดสอบด้วย Playwright Chromium `148.0.7778.96` ผ่าน local server, บังคับ `DASHBOARD_API_CONFIG.baseUrl = ''` เฉพาะ test เพื่อใช้ static fallback เดิม และรัน 3 รอบด้วย dataset เดิม:

- `loadSummarySource`: 62.2 ms median (50.3, 62.2, 72.7)
- `loadTripsSource`: 102.4 ms median (100.7, 102.4, 118.7), trips 7,919 rows
- `loadOilSource`: 5.9 ms median (4.3, 5.9, 6.5)
- `alignDashboardData`: 63.2 ms median (56.9, 63.2, 66.9)
- `showPage(daily)`: 67.3 ms median (64.6, 67.3, 98.1)
- `dcRunCompare`: 180.2 ms median (180.1, 180.2, 222.0), routesA 61, routesB 47
- `dcExportXls`: 146 ms median wall time (131, 146, 172), workbook 6 sheets, 327,844 bytes

Acceptance ที่ยืนยันแล้ว: `node --check Dashboard\scripts\app.js` ผ่าน, export XLSX ยังทำงาน, workbook compare มีชีท `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ` ครบ

### Phase 1 ล่าสุด: Lazy-load XLSX (2026-06-04)

เปลี่ยน `Dashboard/index.html` ให้ไม่โหลด `xlsx-js-style` ตอน startup และเพิ่ม `ensureXlsxLibrary()` ใน `Dashboard/scripts/app.js` ให้ export path โหลดไลบรารีเฉพาะเมื่อใช้งาน:

- startup Playwright test: `window.XLSX` ยังไม่มี และ request ไป `xlsx-js-style` = 0
- compare export test: request ไป `xlsx-js-style` = 1, workbook 327,844 bytes
- อ่านไฟล์ `C:\tmp\dashboard_lazy_xlsx_compare_export.xlsx` กลับด้วย `xlsx` ได้ 6 sheets ครบ
- no page error / no console error
- normal audit export path ถูกครอบด้วย `ensureXlsxLibrary()` ด้วย เพื่อไม่ให้ export ฝั่งอื่นพังหลังถอด script จาก startup

### Phase 1 ล่าสุด: Lazy-load Flatpickr (2026-06-04)

เปลี่ยน `Dashboard/index.html` ให้ไม่โหลด `flatpickr` และ theme CSS ตอน startup และเพิ่ม `ensureFlatpickrLibrary()` ใน `Dashboard/scripts/app.js` ให้หน้า Daily Compare โหลด date picker เฉพาะเมื่อ mount input ช่วงวันที่:

- startup Playwright test: `window.flatpickr` ยังไม่มี, `window.XLSX` ยังไม่มี, request ไป flatpickr = 0 และ request ไป XLSX = 0
- เปิด Daily Compare แล้วโหลด flatpickr ตามต้องการ: main script = 1, locale script = 1, CSS/theme = 2
- input `dc_rangeA` และ `dc_rangeB` มี `_flatpickr` พร้อม `selectedDates` ค่าเริ่มต้น (`2026-04-27`, `2026-04-26`)
- ก่อน export ยังไม่โหลด XLSX; เมื่อ export จึงโหลด XLSX = 1 และ workbook 327,844 bytes
- อ่านไฟล์ `C:\tmp\dashboard_lazy_flatpickr_xlsx_export.xlsx` กลับด้วย `xlsx` ได้ 6 sheets ครบ: `สรุปผลดำเนินงาน`, `รายเส้นทางที่เปรียบเทียบ`, `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ`
- `dcRunCompare` ใน test ล่าสุดใช้เวลา 116.3 ms, routesA 61, routesB 47, tripsA 90, tripsB 54
- no page error / no console error / no console warning
- alert 1 ครั้งเป็น fallback เดิมเมื่อ test stub ไม่ใส่ JSZip: `ส่งออกสำเร็จ แต่ไม่พบ JSZip จึงไม่ได้ฝังค่า Page Setup สำหรับการพิมพ์`

### Hotfix ล่าสุด: Startup Live API Full Load (2026-06-04)

ตรวจพบจาก Playwright repro ที่ URL จริง `http://127.0.0.1:5529/Dashboard/index.html` ว่าหน้าไม่ได้ค้างจาก Phase 1 lazy-load แต่ค้างใน startup data path:

- `summary` API บางรอบตอบช้าจน fallback ใช้เวลาสูงสุดเดิมประมาณ 42 วินาที
- `trips` API pagination ยังไล่หน้า API ต่อเนื่องเกิน 110 วินาทีในบางรอบ (`page=4` เคยใช้ ~30 วินาที, `page=5` ~22 วินาที)
- ก่อนแก้ หน้าอยู่ที่ `โหลดข้อมูลเที่ยววิ่ง...` ต่อเนื่อง, skeleton ยังเหลือ 7 จุด, ไม่มี page error แต่ `dashboardInit` ไม่จบ
- API probe โดยตรงยืนยันว่า live API ไม่ได้เสีย: `summary` ใช้ 4.4s, `oil` ใช้ 2.7s, `trips` โหลดครบ 38,007 rows จาก 8 pages รวมประมาณ 59s

สิ่งที่แก้ใน `Dashboard/scripts/app.js`:

- ตั้ง default `summaryTimeoutMs` 30 วินาที และ `summaryRetryTimeoutMs` 12 วินาที เพื่อให้ summary API มีเวลาพอโหลดจริง
- ตั้ง `tripsTotalTimeoutMs` default 120 วินาทีสำหรับ pagination รวมของ trips API เพื่อให้ live API โหลดครบ 8 pages / 38,007 rows
- ตั้ง `oilTimeoutMs` default 20 วินาทีสำหรับ oil API
- เพิ่ม progress ระหว่างโหลด trips เช่น `โหลดข้อมูลเที่ยววิ่ง... 5,000 / 38,007 รายการ` เพื่อไม่ให้หน้าดูเหมือนค้าง
- เพิ่ม HTTP status metadata และไม่ retry HTTP 4xx ที่ retry แล้วไม่ช่วย

ผลทดสอบหลังแก้:

- `node --check Dashboard\scripts\app.js` ผ่าน
- `git diff --check` ผ่าน มีเฉพาะ LF/CRLF warning ของ Git
- Playwright full live-load ที่ URL จริงโหลด dashboard สำเร็จ: `dashboardInit` 50.89s, `summary=api`, `trips=api`, `oil=api`, trips 38,007 rows, ไม่มีข้อความ fallback/timeout
- Daily Compare full live smoke ผ่าน: `dcRunCompare` 404.6ms, routesA 193, routesB 195, tripsA 277, tripsB 281
- Export XLSX จากข้อมูล live ครบผ่าน: workbook 848,847 bytes, 6 sheets ครบ (`สรุปผลดำเนินงาน`, `รายเส้นทางที่เปรียบเทียบ`, `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ`)
- รอบ export full live: `dashboardInit` 61.83s, `summary=api`, `trips=api`, `oil=api`, trips 38,007 rows, ไม่มี fallback visible, ไม่มี page error / console error
- ยืนยันว่า Phase 1 lazy-load ยังไม่เสีย: หลังเข้า Daily Compare `flatpickr` โหลดแล้ว และ `XLSX` ยังไม่โหลดก่อน export จากนั้น export จึงโหลด XLSX 1 ครั้ง

### Phase 2 ล่าสุด: Daily Compare Index/Memoization รอบแรก (2026-06-05)

ขอบเขตที่ทำเฉพาะ `buildDailyCompare()` ใน `Dashboard/scripts/app.js`:

- เพิ่ม `allDatesSet` สำหรับ lookup วันอ้างอิงแทน `allDates.includes(...)`
- เพิ่ม `rowsByDate` และ `rowsForDateRange()` ให้ `rangeStats()` ดึงเฉพาะ rows ในช่วงวันที่ที่เลือก แทนสแกน `validFd` ทั้งก้อนทุกครั้ง
- เพิ่ม `routeIdentityCache`/`dcCachedRouteIdentityKey()` เพื่อลดการคำนวณ route identity ซ้ำกับ row object เดิม
- เพิ่ม memo ของ `rangeStats(dateStart,dateEnd,custF,routeF,vtypeF)` ด้วย stable filter key
- ปรับ `dcUpdateFilters()` ให้ใช้ rows จากช่วงวันที่ A/B ผ่าน index เดียวกัน
- ปรับ single-mode `renderSingleTable(stA, stRef, labelRef)` ให้สร้าง `currentRouteRows` ครั้งเดียว แทน filter `stA.rows` ซ้ำต่อ route

Guardrail รอบนี้:

- ไม่แตะ `loadSummarySource()`, `loadTripsSource()`, `loadOilSource()`, timeout/retry config หรือ progress loader
- ไม่เปลี่ยน `dcQaTripStatuses()`, `dcQaCompareStatuses()`, `dcQaPairNotes()`, route grouping formula, XLSX sheet names, XLSX column format หรือ normal view export
- ไม่ตัด rows ในหน้า, modal หรือ export

ผลทดสอบหลังแก้:

- `node --check Dashboard\scripts\app.js` ผ่าน
- Playwright live single-mode + export ที่ URL จริงผ่าน: `dashboardInit` 56.38s, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น, ไม่มี page/console error
- Single-mode baseline ก่อนแก้ `dcRunCompare` 692.8ms, หลังแก้ 359.8ms โดยจำนวนเท่าเดิม: routesA 196, routesB 187, tripsA 286, tripsB 267
- Export XLSX หลังแก้ยังครบ 6 sheets และขนาด workbook เท่า baseline รอบเดียวกัน 819,101 bytes: `สรุปผลดำเนินงาน`, `รายเส้นทางที่เปรียบเทียบ`, `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ`
- Playwright live compare-mode ผ่าน: `dcRunCompare` 230.6ms, `mode=compare`, routesA 196, routesB 187, tripsA 286, tripsB 267, fallback ไม่ขึ้น, ไม่มี page/console error
- หมายเหตุ: live API วันที่ 2026-06-05 ส่งกลับ 38,246 trips ซึ่งมากกว่า baseline hotfix วันที่ 2026-06-04 ที่ 38,007 trips ตามข้อมูลจริงที่เปลี่ยนเพิ่ม ไม่ใช่ผลจาก Phase 2

### Phase 2 ล่าสุด: Driver Bucket Matching ต่อเนื่อง (2026-06-05)

ขอบเขตที่ทำเฉพาะ Daily Compare card matching:

- เพิ่ม `dcQaBuildDriverBuckets()` เพื่อสร้าง queue ของ trips ตาม driver key จาก rows ฝั่งอ้างอิง
- เพิ่ม `dcQaConsumeDriverMatch()` เพื่อดึง match แรกของ driver เดียวกันตามลำดับเดิม แทน `findIndex()` + `used Set`
- ปรับ `dcQaBuildAnomalyCards()` และ `dcQaBuildUnmatchedCards()` ให้ใช้ driver bucket queue
- ไม่เปลี่ยน `dcQaTripStatuses()`, `dcQaCompareStatuses()`, `dcQaPairNotes()`, route grouping, export workbook หรือ startup live API loader

ผลทดสอบหลังแก้:

- `node --check Dashboard\scripts\app.js` ผ่าน
- Playwright live startup + Daily Compare + export + compare-mode ที่ URL จริงผ่าน: `dashboardInit` 58.03s, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น
- Single-mode หลัง driver bucket: `dcRunCompare` 348.0ms, routesA 196, routesB 187, tripsA 286, tripsB 267
- Compare-mode หลัง driver bucket: `dcRunCompare` 222.9ms, `mode=compare`, routesA 196, routesB 187, tripsA 286, tripsB 267
- Export XLSX หลัง driver bucket ยังอ่าน workbook ได้ 6 sheets ครบและขนาด 819,101 bytes: `สรุปผลดำเนินงาน`, `รายเส้นทางที่เปรียบเทียบ`, `ขาดทุน`, `สำรองน้ำมัน > 50%`, `ราคาจ่ายผิดปกติ`, `ราคารับผิดปกติ`
- ไม่มี page error / console error

### Phase 2 ล่าสุด: Filter Panel DOM Diff (2026-06-05)

ขอบเขตที่ทำเฉพาะ filter panel ของ Daily Compare:

- เพิ่ม `_msOptionRenderKeys` ใน `buildDailyCompare()` เพื่อจำ signature ของ option set และ selected set ของ multiselect แต่ละตัว
- `buildMsOptions()` จะข้าม `pnl.innerHTML = ...` เฉพาะเมื่อ options เดิม, selection เดิม, panel เคย render แล้ว และ search input ไม่มีค่า
- ถ้า search input มีค่า จะ rebuild เพื่อ clear search เหมือนพฤติกรรมเดิม
- ถ้า filter state หรือ option set เปลี่ยน จะ rebuild ตามเดิม

ผลทดสอบหลังแก้:

- `node --check Dashboard\scripts\app.js` ผ่าน
- Playwright live filter probe ผ่าน: route options 199 รายการก่อน/หลัง, no-change update preserve DOM node, search ค้างถูก rebuild และ clear
- Playwright live compare-mode หลัง filter DOM diff ผ่าน: `dashboardInit` 54.87s, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น, `dcRunCompare` 403.6ms, `mode=compare`, routesA 196, routesB 187, tripsA 286, tripsB 267
- Playwright live export หลัง filter DOM diff ผ่าน: `dashboardInit` 76.73s, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น, workbook 819,101 bytes, 6 sheets ครบ
- ไม่มี page error / console error

### Phase 2 ล่าสุด: Local Metrics Guard สำหรับ LCP/CLS/INP (2026-06-05)

สัญญาณจาก F12 local metrics:

- LCP 184.26s poor และ Chrome เตือนว่าอาจ inflated เพราะหน้าเริ่มโหลดใน background
- CLS 0.32 poor, worst cluster 32 shifts
- INP 240ms needs improvement โดย interaction อยู่ที่ pointer บน `span.nav-label` / `button.nav-item`

สิ่งที่แก้โดยไม่แตะ data/API:

- เพิ่ม preload class `sidebar-auto-preload` ใน `Dashboard/index.html` ก่อนโหลด CSS เพื่อให้ desktop auto-sidebar layout ใช้ตั้งแต่ first paint ไม่รอ `initNav()` หลัง API โหลดเสร็จ
- เพิ่ม CSS สำหรับ `html.sidebar-auto-preload .sidebar/.main` ให้ `.main` เริ่มที่ `margin-left:94px` ตั้งแต่ต้น ลดการกระโดดจาก sidebar full width ไป auto-sidebar หลังโหลดข้อมูล
- ปรับ skeleton nav/topbar ให้ขนาดใกล้ UI จริงขึ้น: nav skeleton สูง 66px และ topbar skeleton สูง 64px
- ปรับ nav click ใน `initNav()` ให้ update active state และปิด mobile sidebar ก่อน แล้ว defer `showPage()` ไปหลัง paint ถัดไป เพื่อลด pointer event blocking / INP
- เพิ่ม guard ไม่ rerender ถ้ากด nav item หน้าเดิม

ผล recheck หลังแก้:

- `node --check Dashboard\scripts\app.js` ผ่าน
- `git diff --check` ผ่าน มีเฉพาะ LF/CRLF warning
- Playwright local metrics probe หลังแก้: `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น
- CLS probe ลดเหลือ 0.0155, shift ใหญ่จาก `.main` หายไป; worst shift หลังแก้เหลือ 0.0087 จาก card content ย่อย
- Event Timing proxy หลัง nav click: max event duration 32ms, eventCount 3
- Nav click ไป Daily Compare ทำงาน: activeIdx `1`, `showPage(daily)` 212.2ms
- Compare-mode หลังแก้ผ่าน: `dcRunCompare` 287.9ms, routesA 196, routesB 187, tripsA 286, tripsB 267
- LCP probe ใน headless อยู่ที่ 54.16s ใกล้ `dashboardInit` 53.67s; ยังผูกกับ live API full-load แต่ต่ำกว่า local report 184.26s ที่ Chrome ระบุว่าอาจ inflated จาก background load
- Export XLSX หลัง local metrics guard ผ่าน: `dashboardInit` 62.60s, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น, `dcRunCompare` 96.1ms, workbook 819,101 bytes, 6 sheets ครบ
- ไม่มี page error / console error

### Phase 2 ล่าสุด: Loading Skeleton Polish (2026-06-05)

สาเหตุที่พบจาก screenshot/F12:

- หลังเพิ่ม `sidebar-auto-preload` หน้า loading ใช้ sidebar collapsed width 94px ตั้งแต่แรก แต่ skeleton ภายใน sidebar ยังเป็นรูปแบบ sidebar เต็ม ทำให้ brand/meta skeleton ถูกบีบและดูไม่สมดุล
- topbar skeleton เดิมเป็นกล่องใหญ่โล่ง ๆ แม้ช่วยเรื่อง CLS แต่ดูไม่เหมือน page title จริง

สิ่งที่แก้:

- เพิ่ม CSS เฉพาะ `html.sidebar-auto-preload` ให้ sidebar loading ใช้ layout collapsed จริง: แสดง skeleton block ขนาดเดียวกับ compact logo, ซ่อนรูปโลโก้จริงเฉพาะตอน preload, ซ่อน brand row/meta, จัด nav skeleton เป็น 58x58 icon blocks
- ปรับ `.shell-skeleton-topbar` เป็นโครง icon 56x56 + text line แทนกล่องใหญ่
- ให้ `syncSidebarAutoMode()` ถอด `sidebar-auto-preload` หลัง `body.sidebar-auto` ถูกตั้งแล้ว เพื่อไม่ให้ preload CSS ไปกระทบ hover/expanded sidebar หลังโหลดเสร็จ

ผลทดสอบ:

- loading screenshot recheck ผ่าน: sidebar 94px, main x=94, logo area เป็น skeleton block, รูปโลโก้จริง opacity 0 เฉพาะตอน preload, brand skeleton ซ่อน, nav skeleton 3 ชิ้นตามจำนวนหน้า
- full live recheck หลังปรับโลโก้ skeleton ผ่าน: เมื่อโหลดเสร็จ `sidebar-auto-preload` ถูกถอด, logo image กลับมา opacity 1, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น, compare-mode ผ่าน
- full live recheck ผ่าน: preload class ถูกถอดหลังโหลด, `body.sidebar-auto` ยังทำงาน, `summary=api`, `trips=api`, `oil=api`, trips 38,246 rows, fallback ไม่ขึ้น
- nav ไป Daily Compare และ compare-mode ผ่าน: `dcRunCompare` 395.3ms, routesA 196, routesB 187, tripsA 286, tripsB 267
- CLS local probe หลัง polish = 0.053, ยังอยู่ในเกณฑ์ดี (<0.1)
- ไม่มี page error / console error

## Skills ที่ตรวจและนำมาใช้เป็นกรอบคิด

ไฟล์ใน `skills` ที่เกี่ยวข้อง:

- `skills/engineering/scrutinize/SKILL.md`: ใช้แนวคิด trace end-to-end จาก entry point ไปถึง side effect จริง ไม่ดูเฉพาะจุดที่เหมือนช้า
- `skills/engineering/debug-mantra/SKILL.md`: ใช้แนวคิดต้องมี baseline/repro/measurement ก่อนแก้ เพื่อไม่ optimize จากสมมติฐาน
- `skills/engineering/post-mortem/SKILL.md`: ใช้โครง root cause -> mechanism -> validation -> follow-up เพื่อจัดกลุ่มสาเหตุ
- `skills/productivity/management-talk/SKILL.md`: ใช้ช่วยจัดสรุปให้แยก impact, owner/action, risk และ next step อ่านง่าย
- `skills/misc/README.md`: ไม่มี skill เพิ่มเติม

ข้อสรุปจาก skills: ควรเริ่มจากวัดผลและ trace path จริงก่อนแก้ เพราะระบบนี้มี logic ด้าน route identity, anomaly status, export, และ fallback data ที่เปลี่ยนผิดจุดแล้วผลลัพธ์ธุรกิจอาจเพี้ยนได้

## สาเหตุหลัก 1: Startup payload และ dependency โหลดหนักเกินจำเป็น

### อาการที่คาดว่าจะเห็น

- เปิดหน้าแรกช้า โดยเฉพาะครั้งแรกหรือ network ช้า
- UI แสดง loading นาน เพราะโหลด summary, trips, oil แล้วจึง build dashboard
- ถ้า API ช้า ระบบ fallback ไป static data ซึ่งมี payload ใหญ่มาก
- Browser ต้อง parse JS/CSS/third-party libs จำนวนมากก่อน interactive เต็มที่

### หลักฐานจากโค้ด

- `Dashboard/index.html:12` โหลด CSS หลักทั้งก้อนทันที
- `Dashboard/index.html:55-56` โหลด `flatpickr` และ locale ตั้งแต่เริ่ม แม้ใช้งานหลักในหน้า date range
- `Dashboard/index.html:59` โหลด `xlsx-js-style` ตั้งแต่เริ่ม ทั้งที่ใช้เมื่อ export เท่านั้น
- `Dashboard/index.html:60-61` โหลด `api-config.js` และ `app.js` แบบ script ปกติ
- `Dashboard/scripts/app.js:184-199` ใช้ `fetch(..., cache: 'no-store')` ทำให้ browser cache ไม่ช่วย endpoint API
- `Dashboard/scripts/app.js:8215-8253` โหลด trips แบบ pagination จนครบทุกหน้า แล้วค่อย cache ใน memory
- `Dashboard/scripts/app.js:8390-8442` startup path โหลด summary, trips, oil, align data แล้วจึง init nav และ show page
- `Dashboard/scripts/app.js:855-870` static fallback ยังโหลด `data/data.js`, `data/fraud_data.js`, `data/oil-price-data.js`

### กลไกที่ทำให้ระบบไม่ลื่น

หน้าแรกไม่ได้ต้องใช้ทุก dependency พร้อมกัน แต่ตอนนี้ browser ต้องโหลดและ parse หลายส่วนที่ใช้เฉพาะบาง action เช่น export XLSX หรือ date picker หน้า compare. เมื่อรวมกับ `app.js` และ CSS ขนาดใหญ่ ทำให้ main thread ใช้เวลากับ parse/execute/style calculation ก่อนผู้ใช้เริ่มโต้ตอบได้

ฝั่ง data path โหลด trips ทั้งหมดตั้งแต่ init เพื่อความเสถียรของหน้า compare ตาม checklist เดิม แต่ต้นทุนคือ startup ต้องรอข้อมูลก้อนใหญ่ก่อน. ถ้า API ช้าหรือ timeout ระบบ fallback ไป static data ขนาด 2.88 MB ซึ่งยิ่งเพิ่ม parse cost

### แนวทาง optimize แบบไม่กระทบ logic

- Lazy-load `xlsx-js-style` เฉพาะตอนกด export โดยคง function export เดิมไว้ และแสดง loading/disable button ระหว่างโหลด library
- Lazy-load `flatpickr` เฉพาะเมื่อเปิดหน้า Daily Compare หรือเมื่อ element date range ถูก mount
- แยก bundle ตามหน้าในระยะถัดไป เช่น master, daily compare, oil price โดยให้ shared helpers อยู่กลาง แต่ยังคง function output เดิม
- เปลี่ยน startup เป็น summary-first แล้ว background-load trips โดยต้องมี guard ว่าหน้า compare จะรอ `ensureTripsReady()` ก่อน render
- เก็บ API payload ใน `sessionStorage` หรือ `IndexedDB` ด้วย cache key จาก `meta/version/lastUpdated` เพื่อหลีกเลี่ยงโหลด trips ซ้ำทุก refresh
- หลีกเลี่ยงการเปลี่ยน schema ของ trips, summary, oil ในเฟสนี้ ให้ cache เก็บ payload เดิมแบบ read-only

### สิ่งที่ห้ามแก้ทันทีถ้ายังไม่มี regression guard

- ห้ามตัดการโหลด trips ตอน startup แบบทันทีโดยไม่แก้ flow หน้า compare เพราะเอกสาร release checklist ระบุว่า eager-load trips เป็น stable behavior
- ห้ามลบ static fallback เพราะยังเป็น safety net เมื่อ API ล่ม
- ห้ามเปลี่ยน `fields` ของ trips API โดยไม่ตรวจว่า export/modal/filter ยังใช้ field ครบ

## สาเหตุหลัก 2: Daily Compare มี repeated computation และ DOM rebuild หนัก

### อาการที่คาดว่าจะเห็น

- เข้า/สลับหน้า Daily Compare แล้วกระตุก
- กด filter/date แล้วหน่วง
- เปิด route card หรือ modal ที่มีหลายแถวแล้ว scroll ไม่ลื่น
- CPU สูงจาก loop ซ้ำและ string HTML ขนาดใหญ่

### หลักฐานจากโค้ด

- `Dashboard/scripts/app.js:3898-3909` `buildDailyCompare()` ยัง `.map(canonicalizeTripRow)` ทุกครั้งที่ build หน้า แม้ init path canonicalize แล้วที่ `Dashboard/scripts/app.js:8267-8271`
- `Dashboard/scripts/app.js:4021-4051` `rangeStats()` filter rows แล้ว reduce หลายรอบ และสร้าง routeMap ใหม่ทุก run
- `Dashboard/scripts/app.js:4061-4066` `findRefDate()` ใช้ `allDates.includes()` ใน loop ซึ่งเป็น linear lookup
- `Dashboard/scripts/app.js:4071-4080` `getOilPriceByDate()` sort `op.prices` ทุกครั้งที่เรียก
- `Dashboard/scripts/app.js:4622-4658` `buildMsOptions()` rebuild `innerHTML` ของ filter options ทั้ง panel
- `Dashboard/scripts/app.js:4666-4698` `dcUpdateFilters()` filter all rows และ rebuild route/vtype options เมื่อ filter เปลี่ยน
- `Dashboard/scripts/app.js:7213-7280` `renderSingleTable()` loop routes แล้ว filter `stA.rows` ต่อ route ทำให้เกิดรูปแบบ O(routes * rows)
- `Dashboard/scripts/app.js:7241-7243` filter rows ต่อ route ด้วย `routeIdentityKey()` ซ้ำ
- `Dashboard/scripts/app.js:7300-7358` สร้าง HTML row-by-row สำหรับ ref และ current rows
- `Dashboard/scripts/app.js:7380-7429` render card และ table HTML ทั้งหมดลง string ก่อน `innerHTML`
- `Dashboard/scripts/app.js:7106-7112` และ `Dashboard/scripts/app.js:7161-7164` ใช้ `findIndex()` เพื่อจับคู่ driver ซึ่งกลายเป็น O(n^2) ในกลุ่มที่มี trips มาก
- `Dashboard/scripts/app.js:7204-7208` มี memo เทียบ HTML แล้ว แต่ถ้า state เปลี่ยนจริงยัง replace `innerHTML` ทั้ง `dc_result`
- `Dashboard/scripts/app.js:8115-8150` `showPage()` rebuild content ทั้งหน้าเมื่อเปลี่ยนหน้า

### กลไกที่ทำให้ระบบไม่ลื่น

หน้า Daily Compare ทำงานหลายชั้นใน main thread: filter data, group route, match trips, calculate statuses, generate HTML string, replace DOM, แล้ว browser ต้อง style/layout/paint ใหม่. จุดที่หนักที่สุดไม่ใช่สูตรคำนวณเดี่ยว ๆ แต่เป็นการทำซ้ำบนข้อมูลชุดเดียวกันหลายรอบ

ตัวอย่างที่ชัดคือ `renderSingleTable()` มี `stA.routes.map(...)` แล้วข้างใน filter `stA.rows` ทุก route. ถ้ามี 300 routes และ 2,000 rows จะตรวจ row ประมาณ 600,000 ครั้งต่อ render ก่อนรวมงาน sort/status/HTML. อีกจุดคือ `getOilPriceByDate()` sort oil price ทุก call ทั้งที่ราคาน้ำมันเป็นข้อมูล reference ที่ควร sort/index ครั้งเดียว

### แนวทาง optimize แบบไม่กระทบ logic

- สร้าง derived index หลัง `validFd` พร้อมแล้ว เช่น:
- `rowsByDate`
- `rowsByDateRange` แบบ cache ตาม range key
- `rowsByRouteKey`
- `rowsByRouteKeyAndVtype`
- `rowsByDriverInRoute`
- `allDatesSet` สำหรับ lookup O(1)
- สร้าง `oilPriceIndex` หรือ sorted oil list ครั้งเดียว แล้วให้ `getOilPriceByDate()` ใช้ binary search/cache แทน sort ทุก call
- แยก `rangeStats()` เป็นสองชั้น: ชั้นแรก filter rows ตาม range/filter key, ชั้นสอง aggregate route summary จาก rows ที่ได้
- Memoize `rangeStats(a1,a2,custF,routeF,vtypeF)` ด้วย stable key แล้ว clear เมื่อ trips source เปลี่ยน
- เปลี่ยน driver matching จาก `findIndex()` เป็น bucket map ตาม normalized driver เช่น `Map<driver, queue>`
- ใน `renderSingleTable()` ใช้ `rowsByRoute` จาก `stA.rows` ครั้งเดียว แทน filter rows ซ้ำต่อ route
- ใช้ event delegation แทน inline `onclick`/`onchange` ใน HTML ที่ rebuild บ่อย เพื่อไม่สร้าง handler string ซ้ำ
- สำหรับ card/table ที่มีหลายแถวมาก ให้ใช้ preview limit + modal full list หรือ virtualization เฉพาะ DOM display โดยห้ามตัดข้อมูลที่ใช้ export/modal
- ใช้ `content-visibility: auto` กับ card section ที่อยู่ไกล viewport ถ้าทดสอบแล้วไม่กระทบ sticky/header/table layout

### สิ่งที่ห้ามแก้ทันทีถ้ายังไม่มี regression guard

- ห้ามเปลี่ยน logic ของ `dcQaTripStatuses()`, `dcQaCompareStatuses()`, `dcQaPairNotes()` หรือ label ความผิดปกติ
- ห้ามเปลี่ยน route identity key โดยไม่เทียบผล route grouping เดิม
- ห้าม limit แถวจริงใน export หรือ modal ถ้าใช้ virtualization ต้องเป็นแค่ presentation layer
- ห้ามเปลี่ยนลำดับ fallback ref day 3 วันย้อนหลัง เพราะมีผลกับการตีความหน้า single mode

## สาเหตุหลัก 3: Backend/API cache ยังทำงานหนักต่อ request และยังไม่มี performance contract ชัด

### อาการที่คาดว่าจะเห็น

- API `trips` หรือ `summary` ช้าขึ้นเมื่อ TRIPS_CACHE โต
- Refresh หน้าหรือเปิดหลาย client พร้อมกันทำให้ Apps Script ต้อง parse JSON จาก Sheet ซ้ำ
- Response time แปรผันตามขนาด cache และจำนวน request
- Frontend ต้องมี timeout/retry/fallback เพราะ API latency ยังไม่นิ่ง

### หลักฐานจากโค้ด

- `Dashboard/API/Code.gs:2412-2490` `doGet()` dispatch ทุก action ใน Apps Script runtime
- `Dashboard/API/Code.gs:2514-2522` `getSummaryCache()` อ่าน JSON string จาก Sheet แล้ว `JSON.parse()` ต่อ request
- `Dashboard/API/Code.gs:2525-2534` `getTripsArrayFromCache_()` อ่าน `TRIPS_CACHE` แล้ว `JSON.parse()` ต่อ request
- `Dashboard/API/Code.gs:2537-2545` `filterTrips_()` filter array ต่อ request
- `Dashboard/API/Code.gs:2547-2561` `projectTripFields_()` map field projection ต่อ request
- `Dashboard/API/Code.gs:2564-2598` `getTripsCache()` filter, slice, apply route identity, project fields แล้ว return payload
- `Dashboard/API/Code.gs:2601-2624` `getCompareData()` parse trips แล้ว filter A/B และ calculate summary ต่อ request
- `Dashboard/API/config.gs:139-148` `jsonOut()` ตั้ง CORS แต่ยังไม่มี explicit cache headers/version headers
- `Dashboard/scripts/app.js:188` frontend ใช้ `cache: 'no-store'` ทำให้ทุก reload ต้องยิง API ใหม่

### กลไกที่ทำให้ระบบไม่ลื่น

แม้มี `SUMMARY_CACHE` และ `TRIPS_CACHE` ใน Google Sheets แล้ว แต่ endpoint ยังต้องอ่าน string ขนาดใหญ่จาก Sheet และ parse เป็น object ทุก request. การ parse JSON ก้อนใหญ่ใน Apps Script เป็นงาน CPU/memory ที่แพง และมี latency สูงกว่า serving cache จาก memory/CDN/browser

Frontend เองก็ไม่ใช้ browser cache เพราะกำหนด `no-store`. ดังนั้นการ refresh หน้าหรือเปิดซ้ำจะทำงานเหมือน cold fetch เกือบทุกครั้ง เว้นแต่ memory cache ใน session เดิมยังอยู่

### แนวทาง optimize แบบไม่กระทบ logic

- เพิ่ม `cacheVersion` หรือ `lastBuiltAt` ใน API `meta/summary/trips` เพื่อให้ frontend รู้ว่า payload เปลี่ยนหรือยัง
- ใช้ `CacheService` สำหรับ JSON string ของ `SUMMARY_CACHE`, `TRIPS_CACHE`, `oil` ใน Apps Script โดย cache เป็น string ไม่ใช่ object เพื่อเลี่ยง shape drift
- เพิ่ม endpoint metadata เบา ๆ เช่น `?action=meta` ให้ระบุจำนวน trips, last build, cache version, source status
- ให้ frontend ใช้ `sessionStorage`/`IndexedDB` เก็บ trips ตาม `cacheVersion` แล้ว revalidate เบา ๆ ผ่าน `meta`
- Precompute route identity ใน `TRIPS_CACHE` ให้ครบตั้งแต่ `rebuildCaches()` เพื่อลด `ensureTripRouteIdentity_()` ตอน request
- ถ้าต้อง optimize API trips เพิ่ม ให้ทำ server-side pagination ต่อไป แต่ frontend ไม่ควรโหลดทุก page ถ้า current page ยังไม่ต้องใช้ทั้งหมด
- เพิ่ม timing telemetry ใน response หรือ console เช่น `summaryMs`, `tripsMs`, `renderMs`, `compareMs` เพื่อวัดก่อน/หลัง

### สิ่งที่ห้ามแก้ทันทีถ้ายังไม่มี regression guard

- ห้ามเปลี่ยน `TRIPS_CACHE` schema โดยไม่ version และไม่รองรับ frontend เก่า
- ห้ามเปลี่ยนสูตร `calculateSummary()` หรือ anomaly calculation เพื่อความเร็ว
- ห้าม cache response โดยไม่มี invalidation จาก `dailyBatchJob` เพราะข้อมูลรายวันอาจ stale
- ห้ามเปิด domain restriction หรือ CORS change ระหว่าง optimize performance ถ้ายังไม่ได้ทดสอบ deploy URL

## จุดบอดเพิ่มเติมที่ควรจัดการ

1. เอกสาร optimization เดิมมีข้อเสนอหลายจุด แต่บางข้อถูก implement ไปแล้วบางส่วน เช่น `loadLegacyTripsData()` return `FRAUD_DATA` ตรง และ modal builder ถูก lazy แล้ว จึงไม่ควร copy patch เดิมซ้ำโดยไม่ trace โค้ดปัจจุบัน

2. `Dashboard/docs/optimizations.md` และ `Dashboard/docs/qa_status_spec.md` แสดงผลใน terminal เป็น mojibake บางส่วน น่าจะเป็น encoding/display mismatch. ไม่ได้แปลว่าไฟล์เสียแน่นอน แต่ควรตรวจ encoding ก่อนแก้เอกสารภาษาไทย

3. CSS มี `backdrop-filter`, box-shadow, animation และ transition จำนวนมาก โดยเฉพาะ modal/table/card section. สิ่งนี้ทำให้ UI ดูดี แต่ต้องควบคุมเฉพาะช่วงที่จำเป็น ไม่ควร animate ทุก card ที่มี table ยาว

4. มี inline style/inline event จำนวนมากใน HTML string. ระยะสั้นยังใช้ได้ แต่ระยะยาวทำให้ cache/reuse DOM ยาก และเสี่ยง regression เมื่อ refactor

5. ไม่มี performance budget ชัด เช่น target startup, compare render, export generation, API response. ถ้าไม่มี budget จะไม่รู้ว่า optimize สำเร็จหรือแค่ย้าย bottleneck

## แผน optimize ที่ปลอดภัย

### Phase 0: วัดผลก่อนแก้

ทำก่อนทุกอย่าง เพราะไม่กระทบ logic:

- เพิ่ม checklist วัด `DOMContentLoaded`, `init total`, `loadSummarySource`, `loadTripsSource`, `alignDashboardData`, `showPage(0)`, `showPage(1)`, `dcRunCompare`, `renderAll`
- เก็บตัวเลขก่อน/หลังทุก PR
- ใช้ dataset เดิมและ filter/date เดิมเพื่อเทียบผล
- เก็บจำนวน rows/routes/cards ที่ render เพื่ออธิบาย performance

Acceptance:

- มี baseline ตัวเลขอย่างน้อย 3 run
- `node --check Dashboard\scripts\app.js` ผ่าน
- export XLSX ยังทำงาน
- ค่า KPI และจำนวน anomaly เท่าเดิม

### Phase 1: ลดของที่โหลดก่อนจำเป็น

ความเสี่ยงต่ำถ้าทำเป็น lazy load library:

- Lazy-load XLSX เมื่อกด export
- Lazy-load flatpickr เมื่อเปิดหน้า Daily Compare
- คง fallback static data ไว้
- คง `ensureTripsReady()` ก่อนใช้ compare
- ไม่เปลี่ยน data schema

Acceptance:

- หน้า master เปิดได้โดยไม่ต้องโหลด XLSX
- กด export ครั้งแรกโหลด library แล้ว export สำเร็จ
- เปิด Daily Compare แล้ว date picker ใช้ได้

### Phase 2: Index และ memoization ใน Daily Compare

ความเสี่ยงกลาง ต้องมี regression test/manual compare:

- [x] สร้าง date index จาก `validFd` ผ่าน `rowsByDate` และ `allDatesSet`
- [x] Memoize `rangeStats()`
- [x] Cache `oilPriceByDate`
- [x] ลด repeated route row filtering ใน single-mode `renderSingleTable()` ด้วย `currentRouteRows`
- [x] สร้าง driver bucket map สำหรับ matching ที่เคยใช้ `findIndex()`
- [x] ลด `innerHTML` rebuild ของ filter panel เมื่อ option set ไม่เปลี่ยน

Acceptance:

- จำนวน routes, trips, anomaly, unmatched A/B เท่าเดิมกับ baseline
- ลำดับ display หลักไม่เปลี่ยน ยกเว้นกำหนดไว้ชัด
- Modal และ export ใช้ข้อมูลครบเหมือนเดิม

### Phase 3: API/browser cache

ความเสี่ยงกลางถึงสูง เพราะเกี่ยวกับ stale data:

- เพิ่ม `cacheVersion/lastBuiltAt`
- Cache payload ใน browser ตาม version
- ใช้ Apps Script `CacheService` สำหรับ JSON string
- Invalidate cache หลัง `dailyBatchJob`

Acceptance:

- หลัง daily batch ใหม่ frontend เห็นข้อมูล version ใหม่
- ถ้า API ล่ม fallback ยังทำงาน
- ไม่มีข้อมูลเก่าค้างหลัง refresh เมื่อ version เปลี่ยน

### Phase 4: UI/UX polish ที่ไม่แตะข้อมูล

ทำหลัง performance path หลักนิ่ง:

- ลด animation/shadow ใน table/card จำนวนมาก
- เพิ่ม `prefers-reduced-motion`
- ใช้ `content-visibility` เฉพาะ section ที่ทดสอบแล้วไม่พัง
- ทำ modal/table ให้ scroll นิ่งขึ้น โดยไม่ตัดข้อมูล
- แยก CSS critical/non-critical ในระยะยาว

## Guardrails เพื่อไม่ให้ระบบเสีย

- ห้ามเปลี่ยนสูตรคำนวณ margin, pct, oil ratio, anomaly status
- ห้ามเปลี่ยน route identity โดยไม่มี snapshot compare
- ห้ามเปลี่ยน column/export labels โดยไม่ตรวจ checklist
- ห้ามลบ fallback data ใน PR performance แรก
- ห้ามรวม refactor ใหญ่กับ visual polish ใน PR เดียว
- ทุก optimization ต้องมี before/after metric และ rollback ง่าย

## ลำดับความสำคัญ

1. ทำ measurement baseline ก่อน เพราะตอนนี้ยังไม่มีตัวเลขยืนยัน bottleneck
2. Lazy-load XLSX และ flatpickr เพราะลด startup cost โดยแทบไม่แตะ data logic
3. ทำ index/memo ใน Daily Compare เพราะเป็น hot path ที่มี repeated computation ชัดที่สุด
4. เพิ่ม cache version + browser cache เพื่อแก้ reload/API latency
5. ค่อย polish CSS animation/paint หลัง loop และ payload ดีขึ้นแล้ว

## สรุปสั้น

ระบบไม่ได้ช้าเพราะสูตรคำนวณใดสูตรหนึ่ง แต่ช้าจาก 3 สาเหตุรวมกัน: โหลดของหนักตั้งแต่เริ่ม, หน้า Daily Compare คำนวณและ rebuild DOM ซ้ำหลายรอบ, และ API/cache ยัง parse/filter payload ใหญ่ต่อ request. แนวทางที่ปลอดภัยที่สุดคือวัดผลก่อน แล้วลดงานที่ไม่จำเป็นโดยไม่เปลี่ยน shape ของข้อมูลหรือ business logic จากนั้นค่อยทำ index/cache พร้อม regression guard.
