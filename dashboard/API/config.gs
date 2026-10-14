/**
 * ============================================
 * Configuration & Constants
 * Shared between backend (Code.gs) and frontend reference
 * ============================================
 */

// -------------------------------------------------------------------------
// ลิ้งก์ต้นทางสำหรับแต่ละชีท (M1-M12)
// -------------------------------------------------------------------------
var SHEET_SOURCES = {
  'DATA(M1)': 'https://docs.google.com/spreadsheets/d/1sWGuoZaxyxfVhGsiA6NqG9noEK6nCvbpABVo792W5Sw/edit?gid=1824601668#gid=1824601668',
  'DATA(M2)': 'https://docs.google.com/spreadsheets/d/1l2ijjyLOvxIqixNTs0UWmV7U9Iu3rQmGGoy-Sazt3aQ/edit?gid=1824601668#gid=1824601668',
  'DATA(M3)': 'https://docs.google.com/spreadsheets/d/1ohmQjk77j2HFvW9em9l_cflt8jbePlFDpA25oAFOjsE/edit?gid=1824601668#gid=1824601668',
  'DATA(M4)': 'https://docs.google.com/spreadsheets/d/1RW7EQyzgYjPREZsxyBs3_EbZ8tKOHbBeSxPDxJ3G3yU/edit?gid=1824601668#gid=1824601668',
  'DATA(M5)': 'https://docs.google.com/spreadsheets/d/1wt8x2XsfvT-gSOmrI0HnNFcS27w-OuvzEYItGP3xn48/edit?gid=1824601668#gid=1824601668',
  'DATA(M6)': 'https://docs.google.com/spreadsheets/d/11xnRv1OFciOQtpAIMEL8tqMvsf1tm5NuOkVAb7vb-0c/edit?gid=1824601668#gid=1824601668',
  
  'DATA(M7)': 'https://docs.google.com/spreadsheets/d/1sMshl7_b-dvrtnDYcl-WQt467gSnfdLw0o35rgRFJMU/edit?gid=1824601668#gid=1824601668',
  'DATA(M8)': 'https://docs.google.com/spreadsheets/d/16hkvexRI5zdo9vMNmvIjfD6sOGve-hgov9m45f3zAv0/edit?gid=1824601668#gid=1824601668',
  'DATA(M9)': 'https://docs.google.com/spreadsheets/d/1f1VtHFlDe5GeFX_Ilhzb1kdICgZ5Bwnhx3oa5SbkjaM/edit?gid=1700114109#gid=1700114109',
  'DATA(M10)': 'https://docs.google.com/spreadsheets/d/18CIDwYJT8dKAzqxhF-zRC4RDJQFpFvmI9bPHBQbPTiU/edit?gid=1824601668#gid=1824601668',
  'DATA(M11)': '',
  'DATA(M12)': ''
};


// ชื่อชีทต้นทางในแต่ละไฟล์
var SOURCE_SHEET_NAMES = {
  'DATA(M1)': 'SUM',
  'DATA(M2)': 'SUMDATA',
  'DATA(M3)': 'SUMDATA',
  'DATA(M4)': 'SUMDATA',
  'DATA(M5)': 'SUMDATA',
  'DATA(M6)': 'SUMDATA',
  'DATA(M7)': 'SUMDATA',
  'DATA(M8)': 'SUMDATA',
  'DATA(M9)': 'SUMDATA',
  'DATA(M10)': 'SUMDATA',
  'DATA(M11)': 'SUMDATA',
  'DATA(M12)': 'SUMDATA'
};

// -------------------------------------------------------------------------
// Column Selection (0-indexed from source sheets)
// ข้อมูลต้นทางไม่ได้เรียงติดกัน — ใช้ค่าตามของเดิมที่ทำงานได้
// Source layout: [0:วันที่, 1:ลูกค้า, 4:ประเภทรถ, 7:ชื่อเส้นทาง, 8:เส้นทาง,
//                 9:ชื่อพขร, 10:ทะเบียน, 12:จ่ายสำรองน้ำมัน, 13:ชื่อผู้รับโอน,
//                 17:ราคารับ, 18:ราคาจ่าย, 19:ส่วนต่าง, 20:กำไร%]
// After fetch, written sheet layout becomes contiguous [0..12]
// -------------------------------------------------------------------------
var SELECT_COLS = [0, 1, 4, 7, 8, 9, 10, 12, 13, 17, 18, 19, 20];

// Required columns in SOURCE sheet: วันที่, ลูกค้า, เส้นทาง (เฉพาะที่แน่นอนว่ามีทุกแถว)
// ถ้าตรวจสอบมากเกินไป ข้อมูลที่มีคอลัมน์บางอันว่างจะโดนตัดทิ้งหมด
var NOT_NULL_COLS = [0, 1, 8];

// -------------------------------------------------------------------------
// Month Constants
// -------------------------------------------------------------------------
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'];

var MTH = {
  January: 'ม.ค.', February: 'ก.พ.', March: 'มี.ค.', April: 'เม.ย.',
  May: 'พ.ค.', June: 'มิ.ย.', July: 'ก.ค.', August: 'ส.ค.',
  September: 'ก.ย.', October: 'ต.ค.', November: 'พ.ย.', December: 'ธ.ค.'
};

// -------------------------------------------------------------------------
// Colors for charts
// -------------------------------------------------------------------------
var COLORS = [
  '#3b82f6', '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'
];

// -------------------------------------------------------------------------
// Customer Alias Mapping
// -------------------------------------------------------------------------
var CUSTOMER_ALIAS = {
  'kerry': 'KEX',
  'fash': 'FLASH'
};

function mapCustomer(name) {
  if (!name) return name;
  var raw = String(name).trim();
  // ชื่อที่ขึ้นต้นด้วย FLASH → แสดงเป็น FLASH เดี่ยว
  if (raw.toUpperCase().indexOf('FLASH') === 0) return 'FLASH';
  return CUSTOMER_ALIAS[raw] || CUSTOMER_ALIAS[raw.toLowerCase()] || raw;
}

// -------------------------------------------------------------------------
// Format Helpers
// -------------------------------------------------------------------------
function fmt(n) {
  if (n === null || n === undefined || isNaN(n) || n === Infinity || n === -Infinity) return '-';
  return Number(n).toLocaleString('th-TH');
}

function fmtB(n) {
  if (n === null || n === undefined || isNaN(n) || n === Infinity || n === -Infinity) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 0 });
}

function fmtP(n) {
  if (n === null || n === undefined || isNaN(n) || n === Infinity || n === -Infinity) return '-';
  return Number(n).toFixed(2) + '%';
}

// -------------------------------------------------------------------------
// Data Validation Helpers
// -------------------------------------------------------------------------
function isZeroOrBlank(val) {
  if (val === null || val === undefined) return true;
  var str = String(val).trim();
  if (str === '') return true;
  var clean = str.replace(/[^0-9.\-]/g, '');
  if (clean === '' || clean === '.' || clean === '-') return true;
  var num = parseFloat(clean);
  return !isNaN(num) && num === 0;
}

// -------------------------------------------------------------------------
// Sheet Names Constants
// -------------------------------------------------------------------------
var SHEET_MASTER = 'MASTER';
var SHEET_SUMMARY_CACHE = 'SUMMARY_CACHE';
var SHEET_TRIPS_CACHE = 'TRIPS_CACHE';
var SHEET_OIL_DIESEL = 'OIL_DIESEL_DATA';
var SHEET_CONFIG = 'CONFIG';
var ENFORCE_DOMAIN_RESTRICTION = false;
var ALLOWED_DOMAIN = '2klogistics.co.th';
var API_DEBUG_ERRORS = false;

// Migration guardrails for the new Google account/project.
// This spreadsheet is the bound "Database Daily EXPRESS" dashboard workbook.
var EXPECTED_DASHBOARD_SPREADSHEET_ID = '1gjrRvgNrU6_hB4XaeHC1Z6MoLK0X11ci3LzYQDRa8Pw';
var APPS_SCRIPT_PROJECT_ID = '1FGsRlFbWgI_rzRRVoXXF-TpGUKlhvl6kXlcH8lUit2PfEsb9bayayZ7e';

// Daily source refresh schedule.
// Code.gs refreshes Google Sheet/GAS caches first; Supabase sync should run after
// this window so it reads the freshly rebuilt SUMMARY_CACHE/TRIPS_CACHE.
var DAILY_BATCH_TRIGGER_TIMEZONE = 'Asia/Bangkok';
var DAILY_BATCH_TRIGGER_HOUR = 8;
var DAILY_BATCH_TRIGGER_NEAR_MINUTE = 0;
var DAILY_BATCH_RECOVERY_NEAR_MINUTE = 30; // kept for backward-compat reporting; first entry of DAILY_BATCH_RECOVERY_WINDOWS below

// Recovery keeps retrying every 30 min after the 08:00 primary run until 10:00.
// Each attempt no-ops if a successful batch already ran today (see isSuccessfulDailyBatchToday_),
// so widening this window is safe and only helps transient failures (Apps Script/network/contract
// errors) recover without a human running the runbook by hand.
var DAILY_BATCH_RECOVERY_WINDOWS = [
  { hour: 8, minute: 30 },
  { hour: 9, minute: 0 },
  { hour: 9, minute: 30 },
  { hour: 10, minute: 0 }
];

// Event-driven Supabase sync. The secret value belongs in Script Properties
// under SUPABASE_SYNC_WEBHOOK_SECRET_PROPERTY and must never be committed.
// Cloudflare migration (2026-08-10): dispatches the "Supabase Shadow Sync"
// GitHub Actions workflow instead of a Netlify background function.
var SUPABASE_SYNC_WEBHOOK_URL = 'https://api.github.com/repos/awiruttangwong/2klogistics-dashboard-v2.0/actions/workflows/supabase-sync.yml/dispatches';
var SUPABASE_SYNC_WEBHOOK_SECRET_PROPERTY = 'GITHUB_SYNC_DISPATCH_TOKEN';

// -------------------------------------------------------------------------
// API Response Helper
// -------------------------------------------------------------------------
function jsonOut(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  if (typeof output.setHeaders === 'function') {
    output.setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET'
    });
  }
  return output;
}
