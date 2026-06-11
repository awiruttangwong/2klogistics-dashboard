# Code.gs Import And Query Logic

Last updated: 2026-06-10

## Purpose

This document explains the backend logic in `Dashboard/API/Code.gs` for:

- importing source data into the system
- reading and shaping source headers
- building `MASTER`, `SUMMARY_CACHE`, and `TRIPS_CACHE`
- handling API query/filter parameters from the frontend

Related files:

- `Dashboard/API/Code.gs`
- `Dashboard/API/config.gs`

## High-level flow

The data flow is:

1. read monthly source sheets from URLs in `SHEET_SOURCES`
2. pick only required source columns using `SELECT_COLS`
3. drop rows that fail required-field checks from `NOT_NULL_COLS`
4. write cleaned monthly data into `DATA(M1)` to `DATA(M12)`
5. merge all monthly sheets into `MASTER`
6. parse `MASTER` rows into normalized trip objects
7. write read-model caches into `SUMMARY_CACHE` and `TRIPS_CACHE`
8. frontend reads only from API/cache, not directly from monthly sheets

## Important note about `QUERY`

`Code.gs` does not run Google Sheets `QUERY()` itself during import.

What it does instead:

- open the configured source spreadsheet by URL
- open the configured source tab by name
- read the tab with `getDisplayValues()`
- treat whatever is visible in that source tab as the import input

That means:

- if the source tab is built with `QUERY()`, `IMPORTRANGE()`, or a combined formula, `Code.gs` reads the formula result only
- if the source tab has formula errors such as `#REF!`, import can fail

There is an explicit guard for this in `processSheetData()`:

- if `#REF!` is found in early rows, the script throws:
  `พบ #REF! ในข้อมูล กรุณาตรวจสอบสูตร QUERY/IMPORTRANGE`

So in practice:

- `QUERY` logic belongs to the source spreadsheet
- `Code.gs` is the importer and normalizer of the source result

## Configuration used during import

Main constants are in `Dashboard/API/config.gs`.

### 1) Source file mapping

`SHEET_SOURCES` maps each monthly destination sheet to a source spreadsheet URL.

Example shape:

```js
var SHEET_SOURCES = {
  'DATA(M1)': 'https://docs.google.com/spreadsheets/d/...',
  'DATA(M2)': 'https://docs.google.com/spreadsheets/d/...',
  ...
};
```

Meaning:

- `DATA(M1)` in this workbook is loaded from the source file URL assigned to `DATA(M1)`
- same pattern for `M2` to `M12`

### 2) Source tab mapping

`SOURCE_SHEET_NAMES` defines which tab to read inside each source spreadsheet.

Example:

```js
var SOURCE_SHEET_NAMES = {
  'DATA(M1)': 'SUM',
  'DATA(M2)': 'SUMDATA',
  ...
};
```

If a month is not explicitly configured, `Code.gs` falls back to:

```js
'SUMDATA'
```

### 3) Column selection

`SELECT_COLS` is the most important import setting.

Current value:

```js
var SELECT_COLS = [0, 1, 4, 7, 8, 9, 10, 12, 13, 17, 18, 19, 20];
```

This means the source tab is not imported column-by-column in full.
Only these source indexes are pulled out and reordered into the local monthly sheet.

### 4) Required source columns

`NOT_NULL_COLS` defines which source columns must contain data before a row is accepted.

Current value:

```js
var NOT_NULL_COLS = [0, 1, 8];
```

Meaning:

- source column `0` must exist and not be blank
- source column `1` must exist and not be blank
- source column `8` must exist and not be blank

If any of these fail, the row is skipped during import.

## Header logic when importing source data

Header logic lives in `fetchSourceData()`.

Behavior:

1. open source file by URL
2. open source tab by name
3. read the full used range with `getDisplayValues()`
4. build a new local header row by taking only the columns listed in `SELECT_COLS`

Pseudo flow:

```js
for each colIdx in SELECT_COLS:
  header.push(values[0][colIdx] || 'Col' + (colIdx + 1))
```

So the imported monthly sheet header is:

- taken from the real source header row
- reduced to only selected columns
- kept in the same order as `SELECT_COLS`
- filled with a fallback name like `Col18` if the source header cell is empty

## Source-to-monthly column mapping

From `config.gs`, the selected source columns currently mean:

| Source index | Meaning in source | Local position after import |
| --- | --- | --- |
| 0 | วันที่ | 0 |
| 1 | ลูกค้า | 1 |
| 4 | ประเภทรถ | 2 |
| 7 | ชื่อเส้นทาง | 3 |
| 8 | เส้นทาง (Route) | 4 |
| 9 | ชื่อพขร. | 5 |
| 10 | ทะเบียน | 6 |
| 12 | จ่ายสำรองน้ำมัน | 7 |
| 13 | ชื่อผู้รับโอน | 8 |
| 17 | ราคารับ | 9 |
| 18 | ราคาจ่าย | 10 |
| 19 | ส่วนต่าง | 11 |
| 20 | กำไร % | 12 |

After import, each monthly `DATA(Mx)` sheet becomes a contiguous 13-column layout.

## Row filtering logic during source import

There are 2 filtering stages.

### Stage 1: Required source fields

Inside `fetchSourceData()`:

- each source row is checked against `NOT_NULL_COLS`
- if any required source column is blank, the row is skipped immediately

This is the first gate before monthly data is written.

### Stage 2: Post-write cleanup in monthly sheet

Inside `processSheetData()`:

- the script reads the imported monthly sheet again
- if columns `R/S/T` logic indicates an empty or invalid cost pattern, the row is deleted from the usable result

Current rule:

- skip row if `R`, `S`, `T` are all blank/zero
- skip row if `R` has value but `S` and `T` are blank/zero

In code comments this is checked using local indexes `9,10,11` after import.

Those correspond to:

- `ราคารับ`
- `ราคาจ่าย`
- `ส่วนต่าง`

### Customer mapping

Still inside `processSheetData()`:

- column `B` is normalized with `mapCustomer()`
- example: names starting with `FLASH` are normalized to `FLASH`
- aliases like `kerry` become `KEX`

## How `MASTER` header is built

`rebuildMasterSheet()` clears `MASTER` and recreates it from all monthly sheets.

Header logic:

1. try to find the first non-empty monthly sheet among `DATA(M1)` to `DATA(M12)`
2. if found, read its header row
3. append one extra field: `SourceMonth`
4. if no monthly sheet is available, use a hardcoded fallback header

Fallback header is:

```text
วันที่, ลูกค้า, ประเภทรถ, ชื่อเส้นทาง, เส้นทาง (Route),
ชื่อพขร., ทะเบียน, จ่ายสำรองน้ำมัน, ชื่อผู้รับโอน, ราคารับ,
ราคาจ่าย, ส่วนต่าง, กำไร %, SourceMonth
```

Then every monthly row is copied into `MASTER` with one extra final column:

- `DATA(M1)` rows get `SourceMonth = DATA(M1)`
- `DATA(M2)` rows get `SourceMonth = DATA(M2)`
- and so on

## How rows are normalized after `MASTER`

`rebuildCaches()` reads `MASTER` and converts rows into normalized trip objects.

Core parser:

- `parseTripRow(row)`

Expected contiguous `MASTER` row layout:

```text
0  วันที่
1  ลูกค้า
2  ประเภทรถ
3  ชื่อเส้นทาง
4  เส้นทาง (Route)
5  ชื่อพขร.
6  ทะเบียน
7  จ่ายสำรองน้ำมัน
8  ชื่อผู้รับโอน
9  ราคารับ
10 ราคาจ่าย
11 ส่วนต่าง
12 กำไร %
```

Normalization done here includes:

- `date` parsed with `parseDate()`
- `customer` normalized with `mapCustomer()`
- `oil`, `recv`, `pay`, `margin` parsed with `parseMoney()`
- `pct` parsed with `parsePercent()`
- route identity fields derived with `getRouteIdentity_()`

Row is rejected if any essential field is missing:

- `date`
- `route`
- `recv`
- `pay`

## API query logic in `doGet`

Frontend talks to the Apps Script web app through `doGet(e)`.

Main dispatch parameter:

```text
action
```

Supported actions:

- `meta`
- `health`
- `summary`
- `trips`
- `compare`
- `oil`
- `routes`
- `customers`

## Query logic for `action=trips`

Request path:

1. `doGet(e)` sees `action=trips`
2. it calls `getTripsCache(start, end, route, page, limit, fields)`
3. this reads `TRIPS_CACHE`
4. filter/paging/projection are applied in memory

Supported query parameters:

- `start`
- `end`
- `route`
- `page`
- `limit`
- `fields`

### Filtering

`filterTrips_()` applies:

- `start`: keep only rows where `t.date >= start`
- `end`: keep only rows where `t.date <= end`
- `route`: match if any of these equals the supplied route value
  - `t.route`
  - `getTripRouteKey_(t)`
  - `getTripRouteDisplay_(t)`

### Paging

`getTripsCache()` does:

- `page` default = `0`
- `limit` default = `0` meaning no paging
- max `limit` = `5000`

When `limit > 0`:

- offset = `page * limit`
- response contains only that slice
- `hasMore` tells frontend if more rows exist

### Field projection

If `fields` is provided, `projectTripFields_()` keeps only those keys.

Example:

```text
?action=trips&start=2026-06-01&end=2026-06-09&route=CPU-6W7.2-...&page=0&limit=500&fields=date,customer,route,recv,pay,margin
```

Meaning:

- read from `TRIPS_CACHE`
- filter by date range
- filter by route
- return only page 0, 500 rows max
- include only listed fields in each trip object

## Query logic for `action=compare`

Request path:

1. `doGet(e)` sees `action=compare`
2. it calls `getCompareData(startA, endA, startB, endB)`
3. this reads all trips from `TRIPS_CACHE`
4. filters range A and range B separately
5. computes summary stats for each side

Accepted parameter names:

- `startA` or `a_start`
- `endA` or `a_end`
- `startB` or `b_start`
- `endB` or `b_end`

Current compare output is summary-style, not row pairing logic.
The row-pairing/anomaly logic used by the frontend lives in frontend code after this payload is loaded.

## What the frontend is actually querying

In day-to-day usage, frontend is not querying raw monthly sheets directly.

It queries these read models:

- `SUMMARY_CACHE`
- `TRIPS_CACHE`
- `OIL_DIESEL_DATA`

This is why performance is acceptable:

- import and normalization happen earlier in batch steps
- API serves prebuilt cache payloads

## Practical summary

If you want to understand “ข้อมูลเข้าระบบยังไง”:

1. source spreadsheet/tab is defined in `config.gs`
2. `fetchSourceData()` reads visible source results
3. header is rebuilt from `SELECT_COLS`
4. rows are filtered by `NOT_NULL_COLS`
5. monthly sheet is cleaned again in `processSheetData()`
6. all monthly sheets are merged into `MASTER`
7. `MASTER` is parsed into normalized trips
8. frontend queries `TRIPS_CACHE` and `SUMMARY_CACHE`, not raw sheets

If you want to understand “QUERY อยู่ตรงไหน”:

- `QUERY()` is expected to exist in the source spreadsheet if used
- `Code.gs` does not compose or execute that formula
- `Code.gs` only reads the source tab output, then applies JavaScript filtering and API query parameters
