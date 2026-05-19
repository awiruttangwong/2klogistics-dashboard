/**
 * ============================================
 * GAS Dashboard Backend
 * - Data Import & Sync (M1-M12)
 * - Pre-calculate: MASTER, SUMMARY_CACHE, TRIPS_CACHE
 * - API: doGet() for frontend
 * - Daily Batch Job (Trigger 08:30, Asia/Bangkok)
 * ============================================
 */

// Include config (GAS will run all .gs files in the same project)
// Constants are in config.gs: SHEET_SOURCES, SOURCE_SHEET_NAMES, SELECT_COLS, NOT_NULL_COLS, etc.

// HTML Service include helper (used by Index.html)
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================
// MENU
// ============================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Dashboard Data Tools')
    .addItem('1. Refresh Full Dashboard', 'dailyBatchJob')
    .addSeparator()
    .addItem('2. Create Daily Trigger', 'createDailyTrigger')
    .addItem('3. Remove All Triggers', 'removeAllTriggers')
    .addSeparator()
    .addItem('4. Sync DATA(M1-M12)', 'importAllConfiguredSheets')
    .addSeparator()
    .addItem('5. Usage Guide', 'showHelpV2')
    .addToUi();
}

function showHelp() {
  showHelpV2();
}

// ============================================
// SOURCE IMPORT FUNCTIONS
// ============================================

function showHelpV2() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];
  lines.push('=== GAS Dashboard Backend: Usage Guide ===');
  lines.push('');
  lines.push('--- Quick Start ---');
  lines.push('1. Configure SHEET_SOURCES in config.gs for the months you want to use.');
  lines.push('2. Verify SOURCE_SHEET_NAMES match your source tab names.');
  lines.push('3. Run menu "4. Sync DATA(M1-M12)" to import raw rows.');
  lines.push('4. Run menu "1. Refresh Full Dashboard" to rebuild MASTER, caches, and normalize oil sheet data.');
  lines.push('5. If needed, run menu "2. Create Daily Trigger" for auto-refresh at 08:30 (UTC+7).');
  lines.push('');
  lines.push('--- Menu Actions ---');
  lines.push('- Refresh Full Dashboard: sync + rebuild MASTER + SUMMARY_CACHE + TRIPS_CACHE + oil sheet normalization');
  lines.push('- Create Daily Trigger: create a time trigger for dailyBatchJob at 08:30 (UTC+7)');
  lines.push('- Remove All Triggers: remove all project triggers');
  lines.push('- Sync DATA(M1-M12): import source sheets only, without cache rebuild');
  lines.push('');
  lines.push('--- API Endpoints (Web App) ---');
  lines.push('?action=meta      -> API status and configured months');
  lines.push('?action=health    -> API health/status (alias of meta + contract)');
  lines.push('?action=summary   -> KPI summary payload');
  lines.push('?action=trips     -> trip rows (supports page/limit/fields)');
  lines.push('?action=compare   -> period A vs period B comparison');
  lines.push('?action=oil       -> diesel price payload');
  lines.push('?action=routes    -> route list');
  lines.push('?action=customers -> customer list');
  lines.push('');
  lines.push('--- Notes ---');
  lines.push('- Raw monthly data: DATA(M1)-DATA(M12)');
  lines.push('- MASTER is the merged table across configured months');
  lines.push('- SUMMARY_CACHE and TRIPS_CACHE are API read models for frontend');
  lines.push('- OIL_DIESEL_DATA is auto-refreshed for PTTOR Diesel price (with safe fallback)');
  lines.push('- SYNC_AUDIT_LOG and SYNC_AUDIT_DETAIL store before/after diff every Refresh Full Dashboard run');
  lines.push('- Frontend must set scripts/api-config.js to your GAS Web App URL');
  ui.alert(lines.join('\n'));
}

function fetchSourceData(sourceUrl, sourceSheetName) {
  var sourceSS;
  try {
    sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
  } catch (e) {
    throw new Error('ไม่สามารถเปิดไฟล์ต้นทางได้ กรุณาตรวจสอบว่าลิงก์ถูกต้อง และคุณมีสิทธิ์เข้าถึงไฟล์นั้น');
  }

  var sourceSheet = sourceSS.getSheetByName(sourceSheetName);
  if (!sourceSheet) {
    throw new Error('ไม่พบหน้าชีทที่ชื่อ: ' + sourceSheetName + ' ในไฟล์ต้นทาง');
  }

  var lastRow = sourceSheet.getLastRow();
  var lastCol = sourceSheet.getLastColumn();

  if (lastRow < 2 || lastCol === 0) {
    return [];
  }

  var range = sourceSheet.getRange(1, 1, lastRow, lastCol);
  var values = range.getDisplayValues();

  var result = [];
  var header = [];
  for (var i = 0; i < SELECT_COLS.length; i++) {
    var colIdx = SELECT_COLS[i];
    header.push(values[0][colIdx] || 'Col' + (colIdx + 1));
  }
  result.push(header);

  for (var r = 1; r < values.length; r++) {
    var row = values[r];

    // STEP 2: คอลัมน์ที่กำหนดใน NOT_NULL_COLS ต้องมีข้อมูลครบ
    var passAnd = true;
    for (var n = 0; n < NOT_NULL_COLS.length; n++) {
      var checkIdx = NOT_NULL_COLS[n];
      if (checkIdx >= row.length) {
        passAnd = false;
        break;
      }
      var val = row[checkIdx];
      if (val === null || val === undefined || String(val).trim() === '') {
        passAnd = false;
        break;
      }
    }
    if (!passAnd) {
      continue;
    }

    var newRow = [];
    for (var s = 0; s < SELECT_COLS.length; s++) {
      var selectIdx = SELECT_COLS[s];
      newRow.push(selectIdx < row.length ? row[selectIdx] : '');
    }
    result.push(newRow);
  }

  return result;
}

function writeDataToSheet(sheet, data) {
  if (!data || data.length === 0) return;

  var numRows = data.length;
  var numCols = data[0].length;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow > 0 && lastCol > 0) {
    sheet.getRange(1, 1, lastRow, lastCol).clearContent();
  }

  if (numRows > 0 && numCols > 0) {
    sheet.getRange(1, 1, numRows, numCols).setValues(data);
  }
}

function processSheetData(sheet) {
  var report = {
    rowsRead: 0,
    rowsDeleted: 0,
    rowsMapped: 0,
    customers: {},
    errors: []
  };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return report;

  var numRows = lastRow - 1;
  var range = sheet.getRange(2, 1, numRows, lastCol);
  var values = range.getDisplayValues();

  report.rowsRead = values.length;

  // Check for #REF! errors in first 5 rows
  for (var r = 0; r < Math.min(values.length, 5); r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).indexOf('#REF!') !== -1) {
        throw new Error('พบ #REF! ในข้อมูล กรุณาตรวจสอบสูตร QUERY/IMPORTRANGE');
      }
    }
  }

  var hasCheckColumns = (lastCol >= 12);
  var filteredData = [];
  var deletedCount = 0;

  for (var i = 0; i < values.length; i++) {
    var rowValues = values[i];

    // Check R,S,T columns (index 9,10,11) - skip if all empty or only R with empty S,T
    if (hasCheckColumns) {
      var valR = rowValues[9];
      var valS = rowValues[10];
      var valT = rowValues[11];

      var rEmpty = isZeroOrBlank(valR);
      var sEmpty = isZeroOrBlank(valS);
      var tEmpty = isZeroOrBlank(valT);

      if ((rEmpty && sEmpty && tEmpty) || (!rEmpty && sEmpty && tEmpty)) {
        deletedCount++;
        continue;
      }
    }

    // Map customer names in column B (index 1)
    if (lastCol >= 2) {
      var original = rowValues[1];
      var mapped = mapCustomer(original);
      if (mapped !== original) {
        rowValues[1] = mapped;
        report.rowsMapped++;
      }
      var countName = mapped || original;
      if (countName) {
        var trimmed = String(countName).trim();
        if (trimmed) report.customers[trimmed] = (report.customers[trimmed] || 0) + 1;
      }
    }

    filteredData.push(rowValues);
  }

  report.rowsDeleted = deletedCount;

  // Clear old data and rewrite filtered data
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  if (filteredData.length > 0) {
    sheet.getRange(2, 1, filteredData.length, lastCol).setValues(filteredData);
  }

  return report;
}

function importAllConfiguredSheets() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var fullReport = {
    totalRead: 0,
    totalDeleted: 0,
    totalMapped: 0,
    customers: {},
    errors: []
  };
  var processedCount = 0;
  var skippedCount = 0;

  var months = ['DATA(M1)', 'DATA(M2)', 'DATA(M3)', 'DATA(M4)', 'DATA(M5)', 'DATA(M6)',
                'DATA(M7)', 'DATA(M8)', 'DATA(M9)', 'DATA(M10)', 'DATA(M11)', 'DATA(M12)'];

  for (var i = 0; i < months.length; i++) {
    var sheetName = months[i];
    var sourceUrl = SHEET_SOURCES[sheetName];

    if (!sourceUrl || sourceUrl.trim() === '' || sourceUrl.indexOf('http') === -1) {
      skippedCount++;
      continue;
    }

    var sheet = getOrCreateSheet(ss, sheetName);
    if (!sheet) {
      fullReport.errors.push('[' + sheetName + '] ไม่พบชีทในเวิร์กบุ๊ก');
      skippedCount++;
      continue;
    }

    try {
      ss.toast('กำลังดึงข้อมูลสำหรับ ' + sheetName + '...', 'Sync หลายชีท (' + (i + 1) + '/12)', 5);
      var sourceSheetName = SOURCE_SHEET_NAMES[sheetName] || 'SUMDATA';
      var data = fetchSourceData(sourceUrl, sourceSheetName);

      if (data.length === 0) {
        fullReport.errors.push('[' + sheetName + '] ไม่พบข้อมูลในไฟล์ต้นทาง');
        skippedCount++;
        continue;
      }

      writeDataToSheet(sheet, data);
      var report = processSheetData(sheet);

      fullReport.totalRead += report.rowsRead;
      fullReport.totalDeleted += report.rowsDeleted;
      fullReport.totalMapped += report.rowsMapped;

      for (var name in report.customers) {
        fullReport.customers[name] = (fullReport.customers[name] || 0) + report.customers[name];
      }
      for (var e = 0; e < report.errors.length; e++) {
        fullReport.errors.push('[' + sheetName + '] ' + report.errors[e]);
      }
      processedCount++;
    } catch (err) {
      fullReport.errors.push('[' + sheetName + '] ' + err.message);
      skippedCount++;
    }
  }

  ss.toast('ประมวลผลเสร็จสิ้น (' + processedCount + ' ชีท)', 'เสร็จสมบูรณ์', 5);

  var lines = [];
  lines.push('=== รายงาน Sync ทุกชีทที่มีลิงก์ ===');
  lines.push('ชีทที่ประมวลผล: ' + processedCount + ' ชีท');
  lines.push('ชีทที่ข้าม (ไม่มีลิงก์): ' + skippedCount + ' ชีท');
  lines.push('');
  lines.push('แถวที่อ่าน: ' + fullReport.totalRead + ' แถว');
  lines.push('ลบแถวที่ค่าเป็น 0/ว่าง: ' + fullReport.totalDeleted + ' แถว');
  lines.push('แปลงชื่อขนส่ง: ' + fullReport.totalMapped + ' แถว');

  var names = Object.keys(fullReport.customers).sort();
  if (names.length > 0) {
    lines.push('');
    lines.push('=== รายชื่อขนส่งที่พบ (' + names.length + ' ราย) ===');
    for (var i = 0; i < names.length; i++) {
      lines.push('- ' + names[i] + ': ' + fullReport.customers[names[i]] + ' แถว');
    }
  }

  if (fullReport.errors.length > 0) {
    lines.push('');
    lines.push('=== ข้อผิดพลาด (' + fullReport.errors.length + ' รายการ) ===');
    var limit = Math.min(fullReport.errors.length, 10);
    for (var j = 0; j < limit; j++) {
      lines.push('- ' + fullReport.errors[j]);
    }
    if (fullReport.errors.length > 10) {
      lines.push('... และอีก ' + (fullReport.errors.length - 10) + ' รายการ');
    }
  }

  lines.push('');
  lines.push('=== ประมวลผลเสร็จสิ้น ===');
  ui.alert(lines.join('\n'));
}

// ============================================
// TRIGGERS
// ============================================

function createDailyTrigger() {
  // Keep the original function name for menus/triggers, but route to the safe core implementation.
  return createDailyTriggerCore_();
}

function removeAllTriggers() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ui.alert('ลบ Trigger ทั้งหมดแล้ว (' + triggers.length + ' รายการ)');
}

// ============================================
// DAILY BATCH JOB (NEW)
// ============================================

function dailyBatchJob() {
  // Keep the original function name for menus/triggers, but route to the safe core implementation.
  return dailyBatchJobCore_();
}

function importAllConfiguredSheetsSilent() {
  importAllConfiguredSheetsSilentWithReport();
}

function createDailyTriggerCore_() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyBatchJob') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  ScriptApp.newTrigger('dailyBatchJob')
    .timeBased()
    .everyDays(1)
    .inTimezone('Asia/Bangkok')
    .atHour(8)
    .nearMinute(30)
    .create();

  ui.alert(
    'Trigger configured.\n\n' +
    '- Removed old dailyBatchJob triggers: ' + removed + '\n' +
    '- Created new trigger: dailyBatchJob at 08:30 (UTC+7, Asia/Bangkok)\n\n' +
    'Note: Apps Script may run a few minutes around this time window.'
  );
}

function getOilServiceMeta_() {
  return {
    url: 'https://orapiweb.pttor.com/oilservice/OilPrice.asmx',
    namespace: 'http://www.pttor.com',
    actionBase: 'https://orapiweb.pttor.com/',
    sourceName: 'PTTOR',
    sourceUrl: 'https://www.pttor.com/news/oil-price'
  };
}

function refreshOilDataForApi_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, SHEET_OIL_DIESEL);
  var header = [['date', 'diesel_b7', 'source', 'note']];
  var existing = readOilRowsMap_(sheet);
  var fetchResult = null;
  var fetchError = '';

  try {
    fetchResult = fetchOrDieselRows_();
  } catch (e) {
    fetchError = e && e.message ? e.message : String(e);
    Logger.log('[refreshOilDataForApi_] OR fetch error: ' + fetchError);
  }

  if (fetchResult && fetchResult.rows && fetchResult.rows.length) {
    for (var i = 0; i < fetchResult.rows.length; i++) {
      var row = fetchResult.rows[i];
      if (!row || !row.date || row.price === null || row.price === undefined) continue;
      existing[row.date] = [
        row.date,
        row.price,
        row.source || 'PTTOR',
        row.note || ''
      ];
    }
  }

  var rows = [];
  for (var k in existing) {
    if (!existing.hasOwnProperty(k)) continue;
    rows.push(existing[k]);
  }
  rows.sort(function(a, b) { return String(a[0]).localeCompare(String(b[0])); });

  var clearRows = Math.max(sheet.getLastRow(), rows.length + 1, 1);
  sheet.getRange(1, 1, clearRows, 4).clearContent();
  sheet.getRange(1, 1, 1, 4).setValues(header);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }

  var payload = getOilPriceData();
  return {
    rows: (payload && payload.prices && payload.prices.length) || 0,
    source: (payload && payload.source) || '-',
    latestDate: (payload && payload.prices && payload.prices.length)
      ? payload.prices[payload.prices.length - 1].period_name
      : null,
    updatedRows: (fetchResult && fetchResult.rows && fetchResult.rows.length) || 0,
    fetchError: fetchError || ''
  };
}

function readOilRowsMap_(sheet) {
  var out = {};
  if (!sheet || sheet.getLastRow() <= 1) return out;
  var values = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var date = parseDate(row[0]);
    var price = parseMoney(row[1]);
    if (!date || price === null) continue;
    out[date] = [
      date,
      price,
      String(row[2] || 'PTTOR').trim() || 'PTTOR',
      String(row[3] || '').trim()
    ];
  }
  return out;
}

function fetchOrDieselRows_() {
  var meta = getOilServiceMeta_();
  var attempts = buildOilSoapAttempts_();
  var errors = [];
  for (var i = 0; i < attempts.length; i++) {
    var a = attempts[i];
    try {
      var xmlText = callOilSoap_(a.action, a.paramsXml);
      var records = parseOilSoapRecords_(xmlText, a.resultTag);
      var rows = selectDieselRows_(records, meta.sourceName);
      if (rows.length > 0) {
        return {
          rows: rows,
          source: meta.sourceName,
          sourceUrl: meta.sourceUrl
        };
      }
      errors.push(a.action + ': no diesel row');
    } catch (e) {
      errors.push(a.action + ': ' + (e && e.message ? e.message : String(e)));
    }
  }
  throw new Error('OR oil service unavailable (' + errors.join(' | ') + ')');
}

function buildOilSoapAttempts_() {
  var now = new Date();
  var dd = String(now.getDate());
  var mm = String(now.getMonth() + 1);
  var yyyy = String(now.getFullYear());
  return [
    {
      action: 'CurrentOilPrice',
      resultTag: 'CurrentOilPriceResult',
      paramsXml: '<Language>TH</Language>'
    },
    {
      action: 'CurrentOilPrice',
      resultTag: 'CurrentOilPriceResult',
      paramsXml: '<Language>EN</Language>'
    },
    {
      action: 'GetOilPrice',
      resultTag: 'GetOilPriceResult',
      paramsXml: '<Language>TH</Language><DD>' + dd + '</DD><MM>' + mm + '</MM><YYYY>' + yyyy + '</YYYY>'
    },
    {
      action: 'GetOilPrice',
      resultTag: 'GetOilPriceResult',
      paramsXml: '<Language>EN</Language><DD>' + dd + '</DD><MM>' + mm + '</MM><YYYY>' + yyyy + '</YYYY>'
    }
  ];
}

function callOilSoap_(action, paramsXml) {
  var meta = getOilServiceMeta_();
  var envelope =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body>' +
    '<' + action + ' xmlns="' + meta.namespace + '">' +
    paramsXml +
    '</' + action + '>' +
    '</soap:Body>' +
    '</soap:Envelope>';

  var res = UrlFetchApp.fetch(meta.url, {
    method: 'post',
    contentType: 'text/xml; charset=utf-8',
    headers: {
      SOAPAction: '"' + meta.actionBase + action + '"'
    },
    payload: envelope,
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code >= 400) {
    throw new Error('HTTP ' + code + ' ' + trimForLog_(body));
  }
  if (!body || body.indexOf('<') === -1) {
    throw new Error('invalid SOAP response');
  }
  if (body.indexOf('Object reference not set') !== -1) {
    throw new Error('upstream null-reference error');
  }
  return body;
}

function parseOilSoapRecords_(soapXmlText, resultTagName) {
  var doc = XmlService.parse(soapXmlText);
  var root = doc.getRootElement();
  var resultNode = findElementByLocalName_(root, resultTagName);
  if (!resultNode) return [];
  var raw = resultNode.getText() || '';
  if (!raw) return [];

  var innerXml = raw;
  if (raw.indexOf('&lt;') !== -1) {
    innerXml = raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  if (innerXml.indexOf('<') === -1) {
    var parsedJson = tryParseJson_(innerXml);
    if (!parsedJson) return [];
    var jsonRecords = [];
    collectObjectRecords_(parsedJson, jsonRecords);
    return jsonRecords;
  }

  var innerDoc = XmlService.parse(innerXml);
  var records = [];
  collectRecordElements_(innerDoc.getRootElement(), records);
  return records;
}

function tryParseJson_(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch (e) {
    return null;
  }
}

function collectObjectRecords_(obj, out) {
  if (!obj) return;
  if (Object.prototype.toString.call(obj) === '[object Array]') {
    for (var i = 0; i < obj.length; i++) {
      collectObjectRecords_(obj[i], out);
    }
    return;
  }
  if (typeof obj !== 'object') return;

  var keys = Object.keys(obj);
  var scalarCount = 0;
  var row = {};
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    var val = obj[key];
    if (val === null || val === undefined) continue;
    if (typeof val === 'object') continue;
    row[String(key).toUpperCase()] = String(val).trim();
    scalarCount++;
  }
  if (scalarCount >= 2) {
    out.push(row);
  }
  for (var k = 0; k < keys.length; k++) {
    collectObjectRecords_(obj[keys[k]], out);
  }
}

function collectRecordElements_(el, out) {
  var children = el.getChildren();
  if (!children || children.length === 0) return;

  var hasLeaf = false;
  for (var i = 0; i < children.length; i++) {
    if ((children[i].getChildren() || []).length === 0) {
      hasLeaf = true;
      break;
    }
  }
  if (hasLeaf) {
    var row = {};
    for (var j = 0; j < children.length; j++) {
      var c = children[j];
      if ((c.getChildren() || []).length > 0) continue;
      var key = String(c.getName() || '').toUpperCase();
      row[key] = String(c.getText() || '').trim();
    }
    if (Object.keys(row).length > 0) out.push(row);
  }

  for (var k = 0; k < children.length; k++) {
    collectRecordElements_(children[k], out);
  }
}

function selectDieselRows_(records, sourceName) {
  var byDate = {};
  var byDateScore = {};
  for (var i = 0; i < records.length; i++) {
    var row = records[i] || {};
    var score = getDieselRecordScore_(row);
    if (score <= 0) continue;
    var price = pickFirstNumber_(row, [
      'PRICE', 'OIL_PRICE', 'CURRENTPRICE', 'SELLPRICE', 'PRICEB7', 'RETAIL'
    ]);
    if (price === null) continue;
    var date = pickFirstDate_(row, [
      'PRICE_DATE', 'UPDATEDATE', 'UPDATE_DATE', 'EFFECTIVE_DATE', 'DATE', 'PRICE_DATE_EN'
    ]);
    if (!date) {
      date = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    }
    if (byDateScore[date] !== undefined && byDateScore[date] > score) continue;
    byDateScore[date] = score;
    byDate[date] = {
      date: date,
      price: price,
      source: sourceName,
      note: 'PTTOR Oil Price (Diesel)'
    };
  }

  var out = [];
  for (var d in byDate) {
    if (byDate.hasOwnProperty(d)) out.push(byDate[d]);
  }
  out.sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });
  return out;
}

function getDieselRecordScore_(row) {
  var txt = '';
  for (var k in row) {
    if (!row.hasOwnProperty(k)) continue;
    txt += ' ' + String(row[k] || '').toLowerCase();
  }
  txt = txt.replace(/\s+/g, ' ').trim();
  if (!txt) return 0;

  // Exclude products that are not the main Diesel price shown on PTTOR page.
  if (txt.indexOf('premium diesel') !== -1) return 0;
  if (txt.indexOf('b20') !== -1) return 0;
  if (txt.indexOf('gasohol') !== -1) return 0;
  if (txt.indexOf('เบนซิน') !== -1) return 0;
  if (txt.indexOf('benz') !== -1) return 0;
  if (txt.indexOf('e20') !== -1 || txt.indexOf('e85') !== -1) return 0;
  if (txt.indexOf('ซุปเปอร์พาวเวอร์') !== -1) return 0;

  if (txt === 'diesel' || txt === 'ดีเซล') return 100;
  if (txt.indexOf(' diesel ') !== -1 || txt.indexOf('ดีเซล ') !== -1) return 95;
  if (txt.indexOf('diesel') !== -1 || txt.indexOf('ดีเซล') !== -1) return 90;
  if (txt.indexOf('diesel b7') !== -1 || txt.indexOf('b7') !== -1) return 70;
  return 0;
}

function pickFirstNumber_(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!row.hasOwnProperty(key)) continue;
    var n = parseMoney(row[key]);
    if (n !== null) return n;
  }
  for (var k in row) {
    if (!row.hasOwnProperty(k)) continue;
    if (k.indexOf('PRICE') === -1) continue;
    var x = parseMoney(row[k]);
    if (x !== null) return x;
  }
  return null;
}

function pickFirstDate_(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!row.hasOwnProperty(key)) continue;
    var d = parseDate(row[key]);
    if (d) return d;
  }
  for (var k in row) {
    if (!row.hasOwnProperty(k)) continue;
    if (k.indexOf('DATE') === -1) continue;
    var x = parseDate(row[k]);
    if (x) return x;
  }
  return null;
}

function findElementByLocalName_(el, localName) {
  if (!el) return null;
  if (String(el.getName()) === String(localName)) return el;
  var children = el.getChildren();
  for (var i = 0; i < children.length; i++) {
    var found = findElementByLocalName_(children[i], localName);
    if (found) return found;
  }
  return null;
}

function trimForLog_(s) {
  var txt = String(s || '').replace(/\s+/g, ' ').trim();
  if (txt.length <= 200) return txt;
  return txt.substring(0, 200) + '...';
}

function buildMasterSnapshotForAudit_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(SHEET_MASTER);
  if (!master || master.getLastRow() < 2) {
    return {
      rows: 0,
      totals: { recv: 0, pay: 0, oil: 0, margin: 0 },
      byKey: {}
    };
  }

  var rowCount = master.getLastRow() - 1;
  var colCount = Math.min(master.getLastColumn(), 14);
  var values = master.getRange(2, 1, rowCount, colCount).getDisplayValues();
  var byKey = {};
  var dupCount = {};
  var totals = { recv: 0, pay: 0, oil: 0, margin: 0 };
  var kept = 0;

  for (var i = 0; i < values.length; i++) {
    var rec = normalizeMasterRowForAudit_(values[i]);
    if (!rec) continue;
    kept++;
    totals.recv += rec.recv;
    totals.pay += rec.pay;
    totals.oil += rec.oil;
    totals.margin += rec.margin;

    var baseKey = buildAuditBaseKey_(rec);
    var n = (dupCount[baseKey] || 0) + 1;
    dupCount[baseKey] = n;
    var finalKey = baseKey + '#' + n;
    rec._key = finalKey;
    byKey[finalKey] = rec;
  }

  return {
    rows: kept,
    totals: totals,
    byKey: byKey
  };
}

function normalizeMasterRowForAudit_(row) {
  if (!row || row.length < 13) return null;
  var date = parseDate(row[0]);
  if (!date) return null;
  return {
    date: date,
    customer: String(row[1] || '').trim(),
    vtype: String(row[2] || '').trim(),
    routeDesc: String(row[3] || '').trim(),
    route: String(row[4] || '').trim(),
    driver: String(row[5] || '').trim(),
    plate: String(row[6] || '').trim(),
    oil: parseMoney(row[7]) || 0,
    payee: String(row[8] || '').trim(),
    recv: parseMoney(row[9]) || 0,
    pay: parseMoney(row[10]) || 0,
    margin: parseMoney(row[11]) || 0,
    pct: parsePercent(row[12]) || 0,
    sourceMonth: String(row[13] || '').trim()
  };
}

function buildAuditBaseKey_(rec) {
  return [
    rec.date,
    rec.customer.toUpperCase(),
    rec.route.toUpperCase(),
    rec.driver.toUpperCase(),
    rec.plate.toUpperCase(),
    rec.vtype.toUpperCase(),
    rec.payee.toUpperCase()
  ].join('|');
}

function diffAuditSnapshots_(beforeSnap, afterSnap, maxDetailRows) {
  var beforeMap = (beforeSnap && beforeSnap.byKey) ? beforeSnap.byKey : {};
  var afterMap = (afterSnap && afterSnap.byKey) ? afterSnap.byKey : {};
  var maxRows = Math.max(50, maxDetailRows || AUDIT_MAX_DETAIL_ROWS);
  var details = [];
  var added = 0;
  var removed = 0;
  var changed = 0;

  for (var key in beforeMap) {
    if (!beforeMap.hasOwnProperty(key)) continue;
    if (!afterMap.hasOwnProperty(key)) {
      removed++;
      if (details.length < maxRows) {
        details.push(makeAuditDetailRow_('REMOVED', key, beforeMap[key], null, 'row_removed'));
      }
      continue;
    }
    var cmp = compareAuditRecord_(beforeMap[key], afterMap[key]);
    if (cmp.changed) {
      changed++;
      if (details.length < maxRows) {
        details.push(makeAuditDetailRow_('CHANGED', key, beforeMap[key], afterMap[key], cmp.fields.join(',')));
      }
    }
  }

  for (var key2 in afterMap) {
    if (!afterMap.hasOwnProperty(key2)) continue;
    if (!beforeMap.hasOwnProperty(key2)) {
      added++;
      if (details.length < maxRows) {
        details.push(makeAuditDetailRow_('ADDED', key2, null, afterMap[key2], 'row_added'));
      }
    }
  }

  return {
    added: added,
    removed: removed,
    changed: changed,
    details: details
  };
}

function compareAuditRecord_(a, b) {
  var out = { changed: false, fields: [] };
  var textFields = ['date', 'customer', 'vtype', 'route', 'driver', 'plate', 'payee', 'sourceMonth'];
  var numFields = ['recv', 'pay', 'oil', 'margin', 'pct'];

  for (var i = 0; i < textFields.length; i++) {
    var tf = textFields[i];
    if (String(a[tf] || '') !== String(b[tf] || '')) {
      out.changed = true;
      out.fields.push(tf);
    }
  }
  for (var j = 0; j < numFields.length; j++) {
    var nf = numFields[j];
    var av = Number(a[nf] || 0);
    var bv = Number(b[nf] || 0);
    if (Math.abs(av - bv) > 0.000001) {
      out.changed = true;
      out.fields.push(nf);
    }
  }
  return out;
}

function makeAuditDetailRow_(changeType, key, beforeRec, afterRec, changedFields) {
  var src = afterRec || beforeRec || {};
  return {
    changeType: changeType,
    recordKey: key,
    date: src.date || '',
    customer: src.customer || '',
    route: src.route || '',
    driver: src.driver || '',
    plate: src.plate || '',
    vtype: src.vtype || '',
    changedFields: changedFields || '',
    beforeRecv: beforeRec ? beforeRec.recv : null,
    afterRecv: afterRec ? afterRec.recv : null,
    beforePay: beforeRec ? beforeRec.pay : null,
    afterPay: afterRec ? afterRec.pay : null,
    beforeOil: beforeRec ? beforeRec.oil : null,
    afterOil: afterRec ? afterRec.oil : null,
    beforeMargin: beforeRec ? beforeRec.margin : null,
    afterMargin: afterRec ? afterRec.margin : null,
    beforePct: beforeRec ? beforeRec.pct : null,
    afterPct: afterRec ? afterRec.pct : null
  };
}

function writeSyncAuditReport_(runId, beforeSnap, afterSnap, context) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = getOrCreateSheet(ss, SHEET_SYNC_AUDIT_LOG);
  var detailSheet = getOrCreateSheet(ss, SHEET_SYNC_AUDIT_DETAIL);
  var diff = diffAuditSnapshots_(beforeSnap, afterSnap, AUDIT_MAX_DETAIL_ROWS);
  var nowIso = new Date().toISOString();

  var hasErrors = context && context.stepErrors && context.stepErrors.length > 0;
  var hasSyncErrors = context && context.syncErrors && context.syncErrors.length > 0;
  var status = hasErrors ? 'FAILED' : (hasSyncErrors ? 'PARTIAL' : 'SUCCESS');

  ensureAuditLogHeader_(logSheet);
  ensureAuditDetailHeader_(detailSheet);

  logSheet.appendRow([
    nowIso,
    runId,
    status,
    (context && context.durationMs) || 0,
    (beforeSnap && beforeSnap.rows) || 0,
    (afterSnap && afterSnap.rows) || 0,
    ((afterSnap && afterSnap.rows) || 0) - ((beforeSnap && beforeSnap.rows) || 0),
    diff.added,
    diff.removed,
    diff.changed,
    (beforeSnap && beforeSnap.totals ? beforeSnap.totals.recv : 0),
    (afterSnap && afterSnap.totals ? afterSnap.totals.recv : 0),
    ((afterSnap && afterSnap.totals ? afterSnap.totals.recv : 0) - (beforeSnap && beforeSnap.totals ? beforeSnap.totals.recv : 0)),
    (beforeSnap && beforeSnap.totals ? beforeSnap.totals.pay : 0),
    (afterSnap && afterSnap.totals ? afterSnap.totals.pay : 0),
    ((afterSnap && afterSnap.totals ? afterSnap.totals.pay : 0) - (beforeSnap && beforeSnap.totals ? beforeSnap.totals.pay : 0)),
    (beforeSnap && beforeSnap.totals ? beforeSnap.totals.oil : 0),
    (afterSnap && afterSnap.totals ? afterSnap.totals.oil : 0),
    ((afterSnap && afterSnap.totals ? afterSnap.totals.oil : 0) - (beforeSnap && beforeSnap.totals ? beforeSnap.totals.oil : 0)),
    (beforeSnap && beforeSnap.totals ? beforeSnap.totals.margin : 0),
    (afterSnap && afterSnap.totals ? afterSnap.totals.margin : 0),
    ((afterSnap && afterSnap.totals ? afterSnap.totals.margin : 0) - (beforeSnap && beforeSnap.totals ? beforeSnap.totals.margin : 0)),
    (context && context.stepErrors ? context.stepErrors.join(' | ') : ''),
    (context && context.syncErrors ? context.syncErrors.map(function(x){ return x.sheet + ':' + x.error; }).join(' | ') : '')
  ]);

  formatLastAuditLogRow_(logSheet);

  var detailRowsWritten = 0;
  if (diff.details.length > 0) {
    var rows = [];
    for (var i = 0; i < diff.details.length; i++) {
      var d = diff.details[i];
      rows.push([
        nowIso,
        runId,
        status,
        d.changeType,
        d.recordKey,
        d.date,
        d.customer,
        d.route,
        d.vtype,
        d.driver,
        d.plate,
        d.changedFields,
        d.beforeRecv,
        d.afterRecv,
        d.beforePay,
        d.afterPay,
        d.beforeOil,
        d.afterOil,
        d.beforeMargin,
        d.afterMargin,
        d.beforePct,
        d.afterPct
      ]);
    }
    var startRow = detailSheet.getLastRow() + 1;
    detailSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    formatAuditDetailRows_(detailSheet, startRow, rows.length);
    detailRowsWritten = rows.length;
  }

  return {
    runId: runId,
    status: status,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    detailRowsWritten: detailRowsWritten
  };
}

function ensureAuditLogHeader_(sheet) {
  var headers = [[
    'Timestamp', 'Run ID', 'Status', 'Duration (ms)',
    'Before Rows', 'After Rows', 'Delta Rows',
    'Added', 'Removed', 'Changed',
    'Before Recv', 'After Recv', 'Delta Recv',
    'Before Pay', 'After Pay', 'Delta Pay',
    'Before Oil', 'After Oil', 'Delta Oil',
    'Before Margin', 'After Margin', 'Delta Margin',
    'Step Errors', 'Sync Errors'
  ]];
  var current = sheet.getRange(1, 1, 1, headers[0].length).getDisplayValues()[0];
  var changed = false;
  for (var i = 0; i < headers[0].length; i++) {
    if (String(current[i] || '') !== headers[0][i]) {
      changed = true;
      break;
    }
  }
  if (changed || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }
  var hr = sheet.getRange(1, 1, 1, headers[0].length);
  hr.setFontWeight('bold')
    .setBackground('#0f172a')
    .setFontColor('#f8fafc')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  if (sheet.getLastColumn() < headers[0].length) {
    sheet.insertColumnsAfter(sheet.getLastColumn(), headers[0].length - sheet.getLastColumn());
  }
  if (changed || sheet.getLastRow() <= 1) {
    var widthMap = [180, 130, 90, 110, 100, 100, 100, 90, 90, 90, 110, 110, 110, 110, 110, 110, 110, 110, 110, 120, 120, 120, 260, 260];
    for (var w = 0; w < widthMap.length; w++) {
      sheet.setColumnWidth(w + 1, widthMap[w]);
    }
  }
}

function ensureAuditDetailHeader_(sheet) {
  var headers = [[
    'Timestamp', 'Run ID', 'Status', 'Change Type', 'Record Key',
    'Date', 'Customer', 'Route', 'Vehicle Type', 'Driver', 'Plate',
    'Changed Fields',
    'Before Recv', 'After Recv',
    'Before Pay', 'After Pay',
    'Before Oil', 'After Oil',
    'Before Margin', 'After Margin',
    'Before Pct', 'After Pct'
  ]];
  var current = sheet.getRange(1, 1, 1, headers[0].length).getDisplayValues()[0];
  var changed = false;
  for (var i = 0; i < headers[0].length; i++) {
    if (String(current[i] || '') !== headers[0][i]) {
      changed = true;
      break;
    }
  }
  if (changed || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }
  var hr = sheet.getRange(1, 1, 1, headers[0].length);
  hr.setFontWeight('bold')
    .setBackground('#111827')
    .setFontColor('#f9fafb')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  if (changed || sheet.getLastRow() <= 1) {
    var widthMap = [180, 130, 90, 100, 260, 100, 130, 180, 110, 150, 120, 180, 110, 110, 110, 110, 110, 110, 110, 110, 100, 100];
    for (var w = 0; w < widthMap.length; w++) {
      sheet.setColumnWidth(w + 1, widthMap[w]);
    }
  }
}

function formatLastAuditLogRow_(sheet) {
  var r = sheet.getLastRow();
  if (r < 2) return;
  var rowRange = sheet.getRange(r, 1, 1, sheet.getLastColumn());
  rowRange.setFontWeight('normal').setFontColor('#0f172a').setBackground('#ffffff');
  sheet.getRange(r, 3).setFontWeight('bold');
  var status = String(sheet.getRange(r, 3).getDisplayValue() || '');
  var color = status === 'SUCCESS' ? '#166534' : (status === 'PARTIAL' ? '#9a3412' : '#991b1b');
  sheet.getRange(r, 3).setFontColor(color);
  sheet.getRange(r, 4, 1, 18).setNumberFormat('#,##0.00');
}

function formatAuditDetailRows_(sheet, startRow, rowCount) {
  if (rowCount <= 0) return;
  var colCount = 22;
  var range = sheet.getRange(startRow, 1, rowCount, colCount);
  range.setFontWeight('normal').setFontColor('#0f172a').setBackground('#ffffff');
  sheet.getRange(startRow, 13, rowCount, 10).setNumberFormat('#,##0.00');
  var typeValues = sheet.getRange(startRow, 4, rowCount, 1).getDisplayValues();
  for (var i = 0; i < rowCount; i++) {
    var type = String(typeValues[i][0] || '');
    var bg = type === 'ADDED' ? '#ecfdf5' : (type === 'REMOVED' ? '#fef2f2' : '#eff6ff');
    sheet.getRange(startRow + i, 1, 1, colCount).setBackground(bg);
    var typeCell = sheet.getRange(startRow + i, 4);
    typeCell.setFontWeight('bold');
    if (type === 'ADDED') typeCell.setFontColor('#166534');
    else if (type === 'REMOVED') typeCell.setFontColor('#b91c1c');
    else typeCell.setFontColor('#1d4ed8');
  }
}

function systemStatusReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'dailyBatchJob';
  });

  function sheetRowCount(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return null;
    return Math.max(0, sh.getLastRow() - 1);
  }

  var contract = validateFrontendApiContract();
  return {
    trigger: {
      dailyBatchJobCount: triggers.length
    },
    sheets: {
      masterRows: sheetRowCount(SHEET_MASTER),
      summaryCacheRows: sheetRowCount(SHEET_SUMMARY_CACHE),
      tripsCacheRows: sheetRowCount(SHEET_TRIPS_CACHE),
      oilRows: sheetRowCount(SHEET_OIL_DIESEL)
    },
    contract: {
      passed: contract.passed,
      errors: contract.errors.length,
      warnings: contract.warnings.length
    },
    checkedAt: new Date().toISOString()
  };
}

var SHEET_SYNC_AUDIT_LOG = 'SYNC_AUDIT_LOG';
var SHEET_SYNC_AUDIT_DETAIL = 'SYNC_AUDIT_DETAIL';
var AUDIT_MAX_DETAIL_ROWS = 400;

function dailyBatchJobCore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('[dailyBatchJob] === START ===');
  var t0 = new Date().getTime();
  ss.toast('Starting daily batch...', 'Running', 5);

  var stepErrors = [];
  var syncReport = [];
  var oilReport = { rows: 0, source: '-', latestDate: null };
  var syncErrors = [];
  var auditWarnings = [];
  var auditResult = null;
  var beforeSnapshot = null;
  var runId = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss');

  try {
    beforeSnapshot = buildMasterSnapshotForAudit_();
  } catch (auditBeforeErr) {
    auditWarnings.push('audit before-snapshot failed: ' + auditBeforeErr.message);
    Logger.log('[dailyBatchJob] Audit before-snapshot ERROR: ' + auditBeforeErr.message);
  }

  try {
    syncReport = importAllConfiguredSheetsSilentWithReport();
    syncErrors = syncReport.filter(function(item) {
      return item && item.error;
    });
    if (syncErrors.length > 0) {
      stepErrors.push('Step 1 (Sync): ' + syncErrors.length + ' source month(s) failed');
    }
  } catch (e1) {
    stepErrors.push('Step 1 (Sync): ' + e1.message);
    Logger.log('[dailyBatchJob] Step 1 ERROR: ' + e1.message);
  }

  if (syncErrors.length === 0) {
    try {
      rebuildMasterSheet();
    } catch (e2) {
      stepErrors.push('Step 2 (MASTER): ' + e2.message);
      Logger.log('[dailyBatchJob] Step 2 ERROR: ' + e2.message);
    }

    try {
      rebuildCaches();
    } catch (e3) {
      stepErrors.push('Step 3 (Cache): ' + e3.message);
      Logger.log('[dailyBatchJob] Step 3 ERROR: ' + e3.message);
    }
  } else {
    Logger.log('[dailyBatchJob] Step 2/3 skipped due to sync source errors');
  }

  try {
    oilReport = refreshOilDataForApi_();
  } catch (e4) {
    stepErrors.push('Step 4 (Oil): ' + e4.message);
    Logger.log('[dailyBatchJob] Step 4 ERROR: ' + e4.message);
  }

  var totalNewRows = 0;
  var updatedSheets = 0;
  for (var i = 0; i < syncReport.length; i++) {
    var item = syncReport[i];
    if (item && item.newRows > 0) {
      totalNewRows += item.newRows;
      updatedSheets++;
    }
  }

  try {
    var afterSnapshot = buildMasterSnapshotForAudit_();
    auditResult = writeSyncAuditReport_(runId, beforeSnapshot, afterSnapshot, {
      durationMs: new Date().getTime() - t0,
      syncErrors: syncErrors,
      stepErrors: stepErrors,
      oilReport: oilReport
    });
  } catch (auditErr) {
    auditWarnings.push('audit report failed: ' + auditErr.message);
    Logger.log('[dailyBatchJob] Audit report ERROR: ' + auditErr.message);
  }

  var status = systemStatusReport();
  var totalMs = new Date().getTime() - t0;
  var lines = [];
  lines.push('Daily batch completed');
  lines.push('Duration: ' + totalMs + ' ms');
  lines.push('Updated month sheets: ' + updatedSheets);
  lines.push('New rows imported: ' + totalNewRows);
  lines.push(
    'Oil rows available: ' + oilReport.rows + ' (' + oilReport.source + ')' +
    (oilReport.latestDate ? ' latest=' + oilReport.latestDate : '')
  );
  lines.push('Trigger count (dailyBatchJob): ' + status.trigger.dailyBatchJobCount);
  lines.push(
    'Contract check: ' +
    (status.contract.passed ? 'PASS' : 'FAIL') +
    ' (errors=' + status.contract.errors + ', warnings=' + status.contract.warnings + ')'
  );

  if (stepErrors.length > 0) {
    lines.push('Errors:');
    for (var j = 0; j < stepErrors.length; j++) {
      lines.push('- ' + stepErrors[j]);
    }
  }
  if (syncErrors.length > 0) {
    lines.push('Sync source failures:');
    for (var k = 0; k < syncErrors.length; k++) {
      lines.push('- ' + syncErrors[k].sheet + ': ' + syncErrors[k].error);
    }
  }
  if (auditResult) {
    lines.push(
      'Sync audit: added=' + auditResult.added +
      ', removed=' + auditResult.removed +
      ', changed=' + auditResult.changed
    );
  }
  if (auditWarnings.length > 0) {
    lines.push('Sync audit warnings: ' + auditWarnings.join(' | '));
  }

  var summaryText = lines.join('\n');
  if (auditResult) {
    Logger.log(
      '[dailyBatchJob] Audit summary: added=' + auditResult.added +
      ' removed=' + auditResult.removed +
      ' changed=' + auditResult.changed +
      ' detailRows=' + auditResult.detailRowsWritten
    );
  }
  if (auditWarnings.length > 0) {
    for (var aw = 0; aw < auditWarnings.length; aw++) {
      Logger.log('[dailyBatchJob] Audit warning: ' + auditWarnings[aw]);
    }
  }
  Logger.log('[dailyBatchJob] === END === Total time: ' + totalMs + 'ms');
  Logger.log(summaryText);
  ss.toast(summaryText, 'Batch Report', 20);
  return {
    ok: stepErrors.length === 0,
    durationMs: totalMs,
    updatedSheets: updatedSheets,
    newRows: totalNewRows,
    oilRows: oilReport.rows,
    syncErrors: syncErrors,
    errors: stepErrors,
    status: status,
    audit: auditResult,
    auditWarnings: auditWarnings
  };
}

function importAllConfiguredSheetsSilentWithReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var months = ['DATA(M1)', 'DATA(M2)', 'DATA(M3)', 'DATA(M4)', 'DATA(M5)', 'DATA(M6)',
                'DATA(M7)', 'DATA(M8)', 'DATA(M9)', 'DATA(M10)', 'DATA(M11)', 'DATA(M12)'];
  var report = [];

  for (var i = 0; i < months.length; i++) {
    var sheetName = months[i];
    var sourceUrl = SHEET_SOURCES[sheetName];

    if (!sourceUrl || sourceUrl.trim() === '' || sourceUrl.indexOf('http') === -1) {
      report.push({ sheet: sheetName, oldRows: 0, newRows: 0, totalRows: 0, skipped: true });
      continue;
    }

    var sheet = getOrCreateSheet(ss, sheetName);
    if (!sheet) {
      report.push({ sheet: sheetName, oldRows: 0, newRows: 0, totalRows: 0, skipped: true });
      continue;
    }

    var oldRows = sheet.getLastRow() > 0 ? sheet.getLastRow() - 1 : 0;

    try {
      ss.toast('กำลังดึงข้อมูลสำหรับ ' + sheetName + '...', 'Sync (' + (i + 1) + '/12)', 3);
      var sourceSheetName = SOURCE_SHEET_NAMES[sheetName] || 'SUMDATA';
      Logger.log('[' + sheetName + '] Fetching from: ' + sourceUrl + ' sheet=' + sourceSheetName);
      var data = fetchSourceData(sourceUrl, sourceSheetName);
      Logger.log('[' + sheetName + '] Fetched ' + data.length + ' rows');
      if (data.length > 0) {
        writeDataToSheet(sheet, data);
        Logger.log('[' + sheetName + '] Written to sheet. LastRow before process=' + sheet.getLastRow());
        processSheetData(sheet);
        Logger.log('[' + sheetName + '] After process. LastRow=' + sheet.getLastRow());
      } else {
        Logger.log('[' + sheetName + '] Skipped: data.length=0');
      }
      var totalRows = sheet.getLastRow() > 0 ? sheet.getLastRow() - 1 : 0;
      var newRows = totalRows - oldRows;
      report.push({ sheet: sheetName, oldRows: oldRows, newRows: newRows, totalRows: totalRows, skipped: false });
    } catch (err) {
      Logger.log('[' + sheetName + '] Error: ' + err.message);
      report.push({ sheet: sheetName, oldRows: oldRows, newRows: 0, totalRows: oldRows, error: err.message });
    }
  }
  return report;
}

// ============================================
// PRE-CALCULATE: MASTER SHEET (NEW)
// ============================================

function rebuildMasterSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = getOrCreateSheet(ss, SHEET_MASTER);
  Logger.log('[rebuildMasterSheet] Start building MASTER...');

  // Clear existing
  var lastRow = masterSheet.getLastRow();
  var lastCol = masterSheet.getLastColumn();
  if (lastRow > 0 && lastCol > 0) {
    masterSheet.getRange(1, 1, lastRow, lastCol).clearContent();
  }

  // Write headers
  var sourceSheet = null;
  var headerProbeMonths = ['DATA(M1)', 'DATA(M2)', 'DATA(M3)', 'DATA(M4)', 'DATA(M5)', 'DATA(M6)', 'DATA(M7)', 'DATA(M8)', 'DATA(M9)', 'DATA(M10)', 'DATA(M11)', 'DATA(M12)'];
  for (var hp = 0; hp < headerProbeMonths.length; hp++) {
    var candidateSheet = ss.getSheetByName(headerProbeMonths[hp]);
    if (candidateSheet && candidateSheet.getLastRow() > 0) {
      sourceSheet = candidateSheet;
      break;
    }
  }
  var headers = ['วันที่', 'ลูกค้า', 'ประเภทรถ', 'ชื่อเส้นทาง', 'เส้นทาง (Route)',
                 'ชื่อพขร.', 'ทะเบียน', 'จ่ายสำรองน้ำมัน', 'ชื่อผู้รับโอน', 'ราคารับ',
                 'ราคาจ่าย', 'ส่วนต่าง', 'กำไร %', 'SourceMonth'];
  if (sourceSheet) {
    var srcHeaders = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getDisplayValues()[0];
    if (srcHeaders.length >= 13) headers = srcHeaders.concat(['SourceMonth']);
  }
  masterSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var months = ['DATA(M1)', 'DATA(M2)', 'DATA(M3)', 'DATA(M4)', 'DATA(M5)', 'DATA(M6)',
                'DATA(M7)', 'DATA(M8)', 'DATA(M9)', 'DATA(M10)', 'DATA(M11)', 'DATA(M12)'];

  var totalRows = 0;
  var currentRow = 2;
  var BATCH_SIZE = 5000; // Append in chunks to avoid huge array in RAM

  for (var i = 0; i < months.length; i++) {
    var sheet = ss.getSheetByName(months[i]);
    if (!sheet) {
      Logger.log('[rebuildMasterSheet] ' + months[i] + ' not found');
      continue;
    }

    var mLastRow = sheet.getLastRow();
    if (mLastRow < 2) {
      Logger.log('[rebuildMasterSheet] ' + months[i] + ' empty (lastRow=' + mLastRow + ')');
      continue;
    }

    var values = sheet.getRange(2, 1, mLastRow - 1, sheet.getLastColumn()).getDisplayValues();
    Logger.log('[rebuildMasterSheet] ' + months[i] + ' contributing ' + values.length + ' rows');

    var batch = [];
    for (var r = 0; r < values.length; r++) {
      var row = values[r].slice();
      row.push(months[i]);
      batch.push(row);

      if (batch.length >= BATCH_SIZE) {
        masterSheet.getRange(currentRow, 1, batch.length, batch[0].length).setValues(batch);
        currentRow += batch.length;
        totalRows += batch.length;
        batch = [];
      }
    }

    // Flush remaining batch
    if (batch.length > 0) {
      masterSheet.getRange(currentRow, 1, batch.length, batch[0].length).setValues(batch);
      currentRow += batch.length;
      totalRows += batch.length;
    }
  }

  Logger.log('[rebuildMasterSheet] Written ' + totalRows + ' rows total');
  Logger.log('MASTER rebuilt: ' + totalRows + ' rows');
}

// ============================================
// PRE-CALCULATE: SUMMARY + TRIPS CACHE (OPTIMIZED - SINGLE PASS)
// ============================================

function rebuildCaches() {
  var t0 = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName(SHEET_MASTER);
  if (!masterSheet || masterSheet.getLastRow() < 2) {
    Logger.log('MASTER sheet not found or empty');
    return;
  }

  var values = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, masterSheet.getLastColumn()).getDisplayValues();
  Logger.log('[rebuildCaches] MASTER rows=' + values.length + ' cols=' + (values[0] ? values[0].length : 0));

  // Parse once
  var trips = [];
  var parseFailCount = 0;
  var failReasons = { noDate: 0, noRoute: 0, noRecv: 0, noPay: 0, shortRow: 0 };
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row || row.length < 13) { failReasons.shortRow++; parseFailCount++; continue; }
    var date = parseDate(String(row[0] || ''));
    var route = String(row[4] || '');
    var recv = parseMoney(row[9]);
    var pay = parseMoney(row[10]);
    if (pay === null && isCompanyTrip_(String(row[8] || ''), String(row[5] || ''), String(row[6] || ''), String(row[2] || ''))) {
      pay = 0;
    }
    if (!date) { failReasons.noDate++; parseFailCount++; continue; }
    if (!route) { failReasons.noRoute++; parseFailCount++; continue; }
    if (recv === null) { failReasons.noRecv++; parseFailCount++; continue; }
    if (pay === null) { failReasons.noPay++; parseFailCount++; continue; }
    var trip = parseTripRow(row);
    if (trip) trips.push(trip);
  }
  Logger.log('[rebuildCaches] Parse results: total=' + values.length + ' success=' + trips.length + ' fail=' + parseFailCount);
  Logger.log('[rebuildCaches] Fail reasons: ' + JSON.stringify(failReasons));
  if (values.length > 0 && trips.length === 0) {
    Logger.log('[rebuildCaches] SAMPLE ROW[0]: ' + JSON.stringify(values[0]));
  }

  // Pre-compute anomaly groups once (O(n) instead of O(n^2) per trip)
  Logger.log('[rebuildCaches] Building anomaly group stats...');
  var groupStats = buildAnomalyGroupStats(trips);

  // Build SUMMARY_CACHE with per-KPI try/catch (partial success)
  Logger.log('[rebuildCaches] Calculating KPIs...');
  var calcErrors = [];
  function safeCalc(name, fn) {
    try { return fn(); } catch (e) {
      Logger.log('[rebuildCaches] KPI ERROR: ' + name + ' -> ' + e.message);
      calcErrors.push(name + ': ' + e.message);
      return null;
    }
  }
  var summary = {
    _timestamp: new Date().toISOString(),
    summary: safeCalc('summary', function() { return calculateSummary(trips); }),
    routeTrend: safeCalc('routeTrend', function() { return calculateRouteTrend(trips); }),
    routeRanking: safeCalc('routeRanking', function() { return calculateRouteRanking(trips); }),
    driverPerf: safeCalc('driverPerf', function() { return calculateDriverPerf(trips); }),
    customerProfit: safeCalc('customerProfit', function() { return calculateCustomerProfit(trips); }),
    ownVsOutsource: safeCalc('ownVsOutsource', function() { return calculateOwnVsOutsource(trips); }),
    vehicleType: safeCalc('vehicleType', function() { return calculateVehicleType(trips); }),
    lossTrip: safeCalc('lossTrip', function() { return calculateLossTrip(trips); }),
    subcontractor: safeCalc('subcontractor', function() { return calculateSubcontractor(trips); }),
    revenueConcentration: safeCalc('revenueConcentration', function() { return calculateRevenueConcentration(trips); })
  };
  if (calcErrors.length > 0) {
    summary._calcErrors = calcErrors;
    Logger.log('[rebuildCaches] Partial KPI failures: ' + calcErrors.join('; '));
  }
  var summaryJson = JSON.stringify(summary);
  writeLargeJsonToSheet(SHEET_SUMMARY_CACHE, summaryJson, 'SUMMARY_CACHE');
  Logger.log('SUMMARY_CACHE rebuilt: ' + summaryJson.length + ' chars, ' + trips.length + ' trips');

  // Build TRIPS_CACHE with pre-computed anomalies
  Logger.log('[rebuildCaches] Calculating anomalies...');
  var tripsWithAnomalies = [];
  for (var i = 0; i < trips.length; i++) {
    var trip = trips[i];
    var anomalies = getAnomalies(trip, trips, groupStats);
    tripsWithAnomalies.push({
      pay: trip.pay,
      oil: trip.oil,
      routeDesc: trip.routeDesc,
      margin: trip.margin,
      driver: trip.driver,
      plate: trip.plate,
      vtype: trip.vtype,
      reason: anomalies.map(function(a) { return a.text; }).join(','),
      recv: trip.recv,
      customer: trip.customer,
      date: trip.date,
      payee: trip.payee,
      route: trip.route,
      anomalies: anomalies
    });
  }
  var tripsJson = JSON.stringify(tripsWithAnomalies);
  writeLargeJsonToSheet(SHEET_TRIPS_CACHE, tripsJson, 'TRIPS_CACHE');
  Logger.log('TRIPS_CACHE rebuilt: ' + tripsJson.length + ' chars, ' + trips.length + ' trips');

  Logger.log('[rebuildCaches] Total cache time: ' + (new Date().getTime() - t0) + 'ms');
}

// Keep legacy wrappers for backward compatibility (called by test/triggers)
function rebuildSummaryCache() { rebuildCaches(); }
function rebuildTripsCache() { rebuildCaches(); }

// ============================================
// TRIP PARSER (Helper)
// ============================================

function parseTripRow(row) {
  if (!row || row.length < 13) return null;

  // Column mapping for 13-column contiguous layout:
  // [0:วันที่, 1:ลูกค้า, 2:ประเภทรถ, 3:ชื่อเส้นทาง, 4:เส้นทาง(Route),
  //  5:ชื่อพขร., 6:ทะเบียน, 7:จ่ายสำรองน้ำมัน, 8:ชื่อผู้รับโอน,
  //  9:ราคารับ, 10:ราคาจ่าย, 11:ส่วนต่าง, 12:กำไร%]

  var date = parseDate(String(row[0] || ''));
  var customer = mapCustomer(String(row[1] || ''));
  var vtype = String(row[2] || '');
  var routeDesc = String(row[3] || '');
  var route = String(row[4] || '');
  var driver = String(row[5] || '');
  var plate = String(row[6] || '');
  var oil = parseMoney(row[7]);
  var payee = String(row[8] || '');
  var recv = parseMoney(row[9]);
  var pay = parseMoney(row[10]);
  if (pay === null && isCompanyTrip_(payee, driver, plate, vtype)) {
    pay = 0;
  }
  var margin = parseMoney(row[11]);
  var pct = parsePercent(row[12]);

  // Skip if essential fields are missing
  if (!date || !route || recv === null || pay === null) return null;

  return {
    date: date,
    customer: customer,
    vtype: vtype,
    routeDesc: routeDesc,
    route: route,
    driver: driver,
    plate: plate,
    oil: oil,
    payee: payee,
    recv: recv,
    pay: pay,
    margin: margin !== null ? margin : ((recv || 0) - (pay || 0) - (oil || 0)),
    pct: pct
  };
}

function parseDate(str) {
  if (!str) return null;

  // Handle Date objects from Google Sheets getValues()
  if (str instanceof Date) {
    return str.getFullYear() + '-' + pad2(str.getMonth() + 1) + '-' + pad2(str.getDate());
  }

  str = String(str).trim();

  // Try DD/MM/YYYY (allow trailing time)
  var match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (match) {
    var year = parseInt(match[3], 10);
    if (year > 2500) year -= 543; // Buddhist to Gregorian
    return year + '-' + pad2(match[2]) + '-' + pad2(match[1]);
  }

  // Try YYYY-MM-DD and ISO datetime (e.g. 2026-05-19T05:00)
  match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) return match[1] + '-' + pad2(match[2]) + '-' + pad2(match[3]);

  // Try YYYY/MM/DD and datetime variant
  match = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[T\s].*)?$/);
  if (match) return match[1] + '-' + pad2(match[2]) + '-' + pad2(match[3]);

  // Try Google Sheets date object (serialized as number)
  if (!isNaN(parseFloat(str))) {
    var d = new Date((parseFloat(str) - 25569) * 86400 * 1000);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }
  return null;
}

function pad2(n) {
  var s = String(n).trim();
  if (s.length === 1) return '0' + s;
  return s;
}

function normalizePlateKey_(plate) {
  return String(plate || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function normalizeVtypeKey_(vtype) {
  return String(vtype || '').trim().toUpperCase();
}

function isCompanyByPlateVtype_(plate, vtype) {
  var p = normalizePlateKey_(plate);
  var v = normalizeVtypeKey_(vtype);
  if (!p || !v) return false;

  var companyPairs = {
    '3บท2757|4W': true,
    '3ฒท2757|4W': true,
    '3บย7931|4WJ': true,
    '3ฒย7931|4WJ': true,
    '3บย7928|4WJ': true,
    '3ฒย7928|4WJ': true,
    '707616|6W': true,
    '707613|6W': true,
    '717486|6W': true,
    '3บท2758|4W': true,
    '3ฒท2758|4W': true,
    '73-2203/73-2204|เทรลเลอร์': true
  };

  return !!companyPairs[p + '|' + v];
}

function isCompanyByPayeeDriver_(payee, driver) {
  var p = String(payee || '').trim();
  var d = String(driver || '').trim();
  return p === d || p.indexOf('บริษัท') !== -1 || p === '-' || p === '';
}

function isCompanyTrip_(payee, driver, plate, vtype) {
  return isCompanyByPayeeDriver_(payee, driver) || isCompanyByPlateVtype_(plate, vtype);
}

function parseMoney(val) {
  if (val === null || val === undefined) return null;
  var str = String(val).trim().replace(/,/g, '').replace(/บาท/g, '').replace(/\u0E3F/g, '');
  var num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function parsePercent(val) {
  if (val === null || val === undefined) return null;
  var str = String(val).trim().replace(/,/g, '').replace(/%/g, '');
  var num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// ============================================
// ANOMALY DETECTION (OPTIMIZED)
// ============================================

// Pre-compute group stats once per batch (O(n) instead of O(n^2))
function buildAnomalyGroupStats(trips) {
  var groups = {};
  var tripStats = {};
  
  // Single pass O(n): build groups + track trip indices for each group
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    var key = t.route + '|' + t.customer + '|' + t.vtype;
    if (!groups[key]) {
      groups[key] = { route: t.route, customer: t.customer, vtype: t.vtype, count: 0, paySum: 0, oilSum: 0, recvSum: 0, tripIndices: [] };
    }
    var g = groups[key];
    g.count++;
    g.paySum += (t.pay || 0);
    g.oilSum += (t.oil || 0);
    g.recvSum += (t.recv || 0);
    g.tripIndices.push(i);
  }

  // Compute averages and flag outliers using stored indices (no nested loop over all trips)
  for (var key in groups) {
    var g = groups[key];
    if (g.count > 1) {
      var aPay = g.paySum / g.count;
      var aOil = g.oilSum / g.count;
      var aRecv = g.recvSum / g.count;
      // Check only trips in this group using stored indices
      for (var j = 0; j < g.tripIndices.length; j++) {
        var idx = g.tripIndices[j];
        var t = trips[idx];
        if (aPay > 0 && (t.pay || 0) > aPay * 1.05) g.hasHighPay = true;
        if (aOil > 0 && (t.oil || 0) > aOil * 1.10) g.hasHighOil = true;
        if (aRecv > 0 && (t.recv || 0) < aRecv * 0.95) g.hasLowRecv = true;
      }
      // Build tripStats for this group
      for (var j = 0; j < g.tripIndices.length; j++) {
        var idx = g.tripIndices[j];
        tripStats[String(idx)] = {
          avgPay: aPay, avgOil: aOil, avgRecv: aRecv,
          hasHighPay: g.hasHighPay, hasHighOil: g.hasHighOil, hasLowRecv: g.hasLowRecv
        };
      }
    }
  }

  return { groups: groups, tripStats: tripStats };
}

function getAnomalies(trip, allTrips, groupStats) {
  var causes = [];
  var mg = trip.margin || 0;

  // 1. Loss
  if (mg < 0) {
    var lp = trip.recv > 0 ? Math.abs(mg / trip.recv * 100) : 0;
    causes.push({ text: 'ขาดทุน ' + Math.round(lp) + '%', color: 'red' });
  }

  // 2. High oil reserve > 50% of pay
  if ((trip.oil || 0) > (trip.pay || 0) * 0.5 && (trip.pay || 0) > 0) {
    causes.push({ text: 'สำรองน้ำมัน>50%', color: 'orange' });
  }

  // 3-5. Use pre-computed group stats (O(1) lookup instead of O(n) filter)
  if (groupStats && groupStats.tripStats) {
    var idx = String(allTrips.indexOf(trip));
    var stats = groupStats.tripStats[idx];
    if (stats) {
      var tp = trip.pay || 0;
      var to = trip.oil || 0;
      var tr = trip.recv || 0;
      if (stats.avgPay > 0 && tp > stats.avgPay * 1.05 && stats.hasHighPay) {
        causes.push({ text: 'ราคาจ่ายแพงกว่าค่าเฉลี่ย', color: 'purple' });
      }
      if (stats.avgOil > 0 && to > stats.avgOil * 1.10 && stats.hasHighOil) {
        causes.push({ text: 'สำรองน้ำมันแพงกว่าค่าเฉลี่ย', color: 'orange' });
      }
      if (stats.avgRecv > 0 && tr < stats.avgRecv * 0.95 && stats.hasLowRecv) {
        causes.push({ text: 'ราคารับต่ำกว่าค่าเฉลี่ย', color: 'blue' });
      }
    }
  }

  var priority = { red: 1, orange: 2, purple: 3, blue: 4 };
  causes.sort(function(a, b) {
    return (priority[a.color] || 99) - (priority[b.color] || 99);
  });

  return causes;
}

// ============================================
// KPI CALCULATORS
// ============================================

function calculateSummary(trips) {
  var totalTrips = trips.length;
  var totalMargin = trips.reduce(function(s, t) { return s + (t.margin || 0); }, 0);
  var totalRevenue = trips.reduce(function(s, t) { return s + (t.recv || 0); }, 0);
  var avgMargin = totalTrips > 0 ? totalMargin / totalTrips : 0;
  var avgMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0;
  var lossCount = trips.filter(function(t) { return (t.margin || 0) < 0; }).length;
  var zeroCount = trips.filter(function(t) { return (t.margin || 0) === 0; }).length;

  // Find top and worst routes by margin
  var routeMargins = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!routeMargins[t.route]) routeMargins[t.route] = { margin: 0, trips: 0 };
    routeMargins[t.route].margin += (t.margin || 0);
    routeMargins[t.route].trips++;
  }

  var routeList = Object.keys(routeMargins).map(function(r) {
    return { route: r, margin: routeMargins[r].margin, trips: routeMargins[r].trips };
  });
  routeList.sort(function(a, b) { return b.margin - a.margin; });

  return {
    totalTrips: totalTrips,
    totalRevenue: totalRevenue,
    totalMargin: totalMargin,
    avgMargin: avgMargin,
    avgMarginPct: avgMarginPct,
    lossCount: lossCount,
    zeroCount: zeroCount,
    topRoute: routeList.length > 0 ? routeList[0] : null,
    worstRoute: routeList.length > 0 ? routeList[routeList.length - 1] : null
  };
}

function calculateRouteTrend(trips) {
  // Group by route, then by month
  var routeData = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!routeData[t.route]) {
      routeData[t.route] = { customer: t.customer, vtype: t.vtype, desc: t.routeDesc, months: {} };
    }
    var month = getMonthFromDate(t.date);
    if (!routeData[t.route].months[month]) {
      routeData[t.route].months[month] = { trips: 0, margin: 0, loss: 0, recv: 0 };
    }
    routeData[t.route].months[month].trips++;
    routeData[t.route].months[month].margin += (t.margin || 0);
    routeData[t.route].months[month].recv += (t.recv || 0);
    if ((t.margin || 0) < 0) routeData[t.route].months[month].loss++;
  }

  var result = [];
  var routes = Object.keys(routeData);
  for (var i = 0; i < routes.length; i++) {
    var rd = routeData[routes[i]];
    var months = {};
    var totalTrips = 0, totalMargin = 0, totalRecv = 0, totalLoss = 0;
    for (var m = 0; m < MONTHS.length; m++) {
      var month = MONTHS[m];
      if (rd.months[month]) {
        months[month] = rd.months[month];
        totalTrips += rd.months[month].trips;
        totalMargin += rd.months[month].margin;
        totalRecv += rd.months[month].recv;
        totalLoss += rd.months[month].loss;
      }
    }
    result.push({
      route: routes[i],
      customer: rd.customer || '-',
      vtype: rd.vtype || '-',
      desc: rd.desc || '-',
      months: months,
      trips: totalTrips,
      margin: totalMargin,
      avgMargin: totalTrips > 0 ? totalMargin / totalTrips : 0,
      pct: totalRecv > 0 ? (totalMargin / totalRecv * 100) : 0,
      loss: totalLoss
    });
  }

  return result;
}

function calculateRouteRanking(trips) {
  var routeData = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    var route = String(t.route || '').trim();
    var customer = String(t.customer || '').trim();
    var vtype = String(t.vtype || '').trim();
    var key = customer + '|' + route + '|' + vtype;
    if (!routeData[key]) {
      routeData[key] = { route: route, customer: customer, vtype: vtype, desc: t.routeDesc, margin: 0, trips: 0, recv: 0, loss: 0 };
    }
    routeData[key].margin += (t.margin || 0);
    routeData[key].trips++;
    routeData[key].recv += (t.recv || 0);
    if ((t.margin || 0) < 0) routeData[key].loss++;
  }

  var list = Object.values(routeData);
  list.forEach(function(r) {
    r.avgMargin = r.trips > 0 ? r.margin / r.trips : 0;
    r.pct = r.recv > 0 ? (r.margin / r.recv * 100) : 0;
  });

  var profitRoutes = list
    .filter(function(r) { return r.margin > 0; })
    .sort(function(a, b) { return b.margin - a.margin; });
  var lossRoutes = list
    .filter(function(r) { return r.margin < 0; })
    .sort(function(a, b) { return a.margin - b.margin; });
  var zeroRoutes = list.filter(function(r) { return r.margin === 0; });
  return {
    top: profitRoutes,
    bottom: lossRoutes,
    zero: zeroRoutes
  };
}

function calculateDriverPerf(trips) {
  var driverData = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!t.driver || t.driver === '-') continue;
    if (!driverData[t.driver]) {
      driverData[t.driver] = { name: t.driver, trips: 0, margin: 0, loss: 0, lossMargin: 0, isCompany: false };
    }
    driverData[t.driver].trips++;
    driverData[t.driver].margin += (t.margin || 0);
    if ((t.margin || 0) < 0) {
      driverData[t.driver].loss++;
      driverData[t.driver].lossMargin += (t.margin || 0);
    }
  }

  // Calculate pct and find main route
  var result = [];
  var drivers = Object.keys(driverData);
  for (var i = 0; i < drivers.length; i++) {
    var d = driverData[drivers[i]];
    d.pct = d.margin > 0 ? (d.margin / (d.margin + Math.abs(d.lossMargin || 0))) * 100 : 0;

    // Find main route
    var routeCounts = {};
    for (var j = 0; j < trips.length; j++) {
      if (trips[j].driver === d.name) {
        routeCounts[trips[j].route] = (routeCounts[trips[j].route] || 0) + 1;
      }
    }
    var mainRoute = Object.keys(routeCounts).sort(function(a, b) {
      return routeCounts[b] - routeCounts[a];
    })[0] || '';
    d.mainRoute = mainRoute;

    result.push(d);
  }

  result.sort(function(a, b) { return b.margin - a.margin; });
  return result;
}

function calculateCustomerProfit(trips) {
  var custData = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!custData[t.customer]) {
      custData[t.customer] = { name: t.customer, margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, loss: 0, months: {} };
    }
    var month = getMonthFromDate(t.date);
    custData[t.customer].margin += (t.margin || 0);
    custData[t.customer].trips++;
    custData[t.customer].recv += (t.recv || 0);
    custData[t.customer].pay += (t.pay || 0);
    custData[t.customer].oil += (t.oil || 0);
    if ((t.margin || 0) < 0) custData[t.customer].loss++;
    if (month) {
      if (!custData[t.customer].months[month]) {
        custData[t.customer].months[month] = { trips: 0, margin: 0, recv: 0, pay: 0, oil: 0, loss: 0 };
      }
      custData[t.customer].months[month].trips++;
      custData[t.customer].months[month].margin += (t.margin || 0);
      custData[t.customer].months[month].recv += (t.recv || 0);
      custData[t.customer].months[month].pay += (t.pay || 0);
      custData[t.customer].months[month].oil += (t.oil || 0);
      if ((t.margin || 0) < 0) custData[t.customer].months[month].loss++;
    }
  }

  var result = Object.values(custData);
  result.forEach(function(c) {
    c.avgMargin = c.trips > 0 ? c.margin / c.trips : 0;
    c.pct = c.recv > 0 ? (c.margin / c.recv * 100) : 0;
  });
  result.sort(function(a, b) { return b.margin - a.margin; });
  return result;
}

function calculateOwnVsOutsource(trips) {
  var company = { margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, pct: 0, topRoutes: [] };
  var outsource = { margin: 0, trips: 0, recv: 0, pay: 0, oil: 0, pct: 0, topRoutes: [] };
  var companyRoutes = {};
  var outsourceRoutes = {};

  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    // Heuristic: if payee is same as driver or contains company name, it's company
    var isCompany = isCompanyTrip_(t.payee, t.driver, t.plate, t.vtype);
    if (isCompany) {
      company.margin += (t.margin || 0);
      company.trips++;
      company.recv += (t.recv || 0);
      company.pay += (t.pay || 0);
      company.oil += (t.oil || 0);
      if (!companyRoutes[t.route]) companyRoutes[t.route] = { route: t.route, trips: 0, margin: 0, recv: 0 };
      companyRoutes[t.route].trips++;
      companyRoutes[t.route].margin += (t.margin || 0);
      companyRoutes[t.route].recv += (t.recv || 0);
    } else {
      outsource.margin += (t.margin || 0);
      outsource.trips++;
      outsource.recv += (t.recv || 0);
      outsource.pay += (t.pay || 0);
      outsource.oil += (t.oil || 0);
      if (!outsourceRoutes[t.route]) outsourceRoutes[t.route] = { route: t.route, trips: 0, margin: 0, recv: 0 };
      outsourceRoutes[t.route].trips++;
      outsourceRoutes[t.route].margin += (t.margin || 0);
      outsourceRoutes[t.route].recv += (t.recv || 0);
    }
  }

  company.pct = company.recv > 0 ? (company.margin / company.recv * 100) : 0;
  outsource.pct = outsource.recv > 0 ? (outsource.margin / outsource.recv * 100) : 0;
  company.topRoutes = Object.values(companyRoutes).map(function(route) {
    route.pct = route.recv > 0 ? (route.margin / route.recv * 100) : 0;
    return route;
  }).sort(function(a, b) { return b.trips - a.trips; }).slice(0, 10);
  outsource.topRoutes = Object.values(outsourceRoutes).map(function(route) {
    route.pct = route.recv > 0 ? (route.margin / route.recv * 100) : 0;
    return route;
  }).sort(function(a, b) { return b.trips - a.trips; }).slice(0, 10);

  return { company: company, outsource: outsource };
}

function calculateVehicleType(trips) {
  var typeData = {};
  var totalTrips = trips.length;
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    var vt = t.vtype || '-';
    if (!typeData[vt]) {
      typeData[vt] = { type: vt, vtype: vt, trips: 0, margin: 0, recv: 0, loss: 0 };
    }
    typeData[vt].trips++;
    typeData[vt].margin += (t.margin || 0);
    typeData[vt].recv += (t.recv || 0);
    if ((t.margin || 0) < 0) typeData[vt].loss++;
  }

  var result = Object.values(typeData);
  result.forEach(function(v) {
    v.share = totalTrips > 0 ? (v.trips / totalTrips * 100) : 0;
    v.avgMargin = v.trips > 0 ? v.margin / v.trips : 0;
    v.avgRecv = v.trips > 0 ? v.recv / v.trips : 0;
    v.pct = v.recv > 0 ? (v.margin / v.recv * 100) : 0;
  });
  result.sort(function(a, b) { return b.margin - a.margin; });
  return result;
}

function calculateLossTrip(trips) {
  var totalTrips = trips.length;
  var lossTrips = trips.filter(function(t) { return (t.margin || 0) < 0; });
  var totalLoss = lossTrips.reduce(function(s, t) { return s + (t.margin || 0); }, 0);
  var total = lossTrips.length;
  var lossPct = totalTrips > 0 ? (total / totalTrips * 100) : 0;

  var byMonth = {};
  var byRoute = {};
  var byCustomer = {};
  for (var i = 0; i < lossTrips.length; i++) {
    var t = lossTrips[i];
    var month = getMonthFromDate(t.date);
    if (!byMonth[month]) byMonth[month] = { count: 0, loss: 0 };
    byMonth[month].count++;
    byMonth[month].loss += (t.margin || 0);

    if (!byRoute[t.route]) byRoute[t.route] = { name: t.route, count: 0, loss: 0 };
    byRoute[t.route].count++;
    byRoute[t.route].loss += (t.margin || 0);

    var cust = mapCustomer(t.customer || '-');
    if (!byCustomer[cust]) byCustomer[cust] = { name: cust, count: 0, loss: 0 };
    byCustomer[cust].count++;
    byCustomer[cust].loss += (t.margin || 0);
  }

  // Worst routes
  var worstRoutes = Object.values(byRoute).sort(function(a, b) { return a.loss - b.loss; }).slice(0, 10);

  return {
    total: total,
    totalTrips: totalTrips,
    lossPct: lossPct,
    totalLoss: totalLoss,
    byMonth: byMonth,
    byRoute: Object.values(byRoute).sort(function(a, b) { return a.loss - b.loss; }),
    byCustomer: Object.values(byCustomer).sort(function(a, b) { return a.loss - b.loss; }),
    worstRoutes: worstRoutes
  };
}

function calculateSubcontractor(trips) {
  var subData = {};
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!subData[t.payee]) {
      subData[t.payee] = { name: t.payee, trips: 0, margin: 0, recv: 0 };
    }
    subData[t.payee].trips++;
    subData[t.payee].margin += (t.margin || 0);
    subData[t.payee].recv += (t.recv || 0);
  }

  var result = Object.values(subData);
  result.sort(function(a, b) { return b.margin - a.margin; });
  return result;
}

function calculateRevenueConcentration(trips) {
  var custRecv = {};
  var totalRecv = 0;
  for (var i = 0; i < trips.length; i++) {
    var t = trips[i];
    if (!custRecv[t.customer]) custRecv[t.customer] = 0;
    custRecv[t.customer] += (t.recv || 0);
    totalRecv += (t.recv || 0);
  }

  var list = Object.keys(custRecv).map(function(c) {
    return { name: c, recv: custRecv[c], pct: totalRecv > 0 ? (custRecv[c] / totalRecv * 100) : 0 };
  });
  list.sort(function(a, b) { return b.recv - a.recv; });

  return {
    totalRecv: totalRecv,
    customers: list,
    top3Share: list.slice(0, 3).reduce(function(s, c) { return s + c.pct; }, 0)
  };
}

var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function getMonthFromDate(dateStr) {
  if (!dateStr) return 'January';
  var match = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 'January';
  var monthIdx = parseInt(match[2], 10) - 1;
  return MONTHS[Math.max(0, Math.min(11, monthIdx))] || 'January';
}

// ============================================
// SHEET HELPERS
// ============================================

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// ============================================
// LARGE JSON CACHE HELPERS
// ============================================

function writeLargeJsonToSheet(sheetName, jsonStr, label) {
  var MAX_CELL = 20000;
  var COLS = 10; // 10 columns per row = 200,000 chars per row (very scalable)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, sheetName);

  sheet.clearContents();
  sheet.getRange(1, 1).setValue(label);

  var totalCellsNeeded = Math.ceil(jsonStr.length / MAX_CELL);
  var totalRowsNeeded = Math.ceil(totalCellsNeeded / COLS);

  // Build 2D array for batch write
  var rows = [];
  var idx = 0;
  for (var r = 0; r < totalRowsNeeded; r++) {
    var row = [];
    for (var c = 0; c < COLS; c++) {
      if (idx < jsonStr.length) {
        row.push(jsonStr.substring(idx, Math.min(idx + MAX_CELL, jsonStr.length)));
        idx += MAX_CELL;
      } else {
        row.push('');
      }
    }
    rows.push(row);
  }

  // Batch write all chunks at once (much faster than setValue loop)
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, COLS).setValues(rows);
  }

  // Metadata row
  var metaRow = totalRowsNeeded + 2;
  sheet.getRange(metaRow, 1).setValue('LastUpdated: ' + new Date().toISOString() + ' | Chars: ' + jsonStr.length + ' | Chunks: ' + totalCellsNeeded);
}

function readLargeJsonFromSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // Fast path: metadata is expected at the last row, column A.
  var metaCell = String(sheet.getRange(lastRow, 1).getDisplayValue() || '');
  var chunkCount = null;
  var chunkMatch = metaCell.match(/Chunks:\s*(\d+)/i);
  if (chunkMatch) {
    chunkCount = parseInt(chunkMatch[1], 10);
  }

  var COLS = 10;
  var chunks = [];

  if (chunkCount && chunkCount > 0) {
    // Read only the exact cell window that can contain chunks.
    var dataRows = Math.ceil(chunkCount / COLS);
    if (dataRows > 0) {
      var values = sheet.getRange(2, 1, dataRows, COLS).getDisplayValues();
      for (var r = 0; r < values.length; r++) {
        for (var c = 0; c < values[r].length; c++) {
          var val = values[r][c];
          if (val !== '') chunks.push(String(val));
          if (chunks.length >= chunkCount) break;
        }
        if (chunks.length >= chunkCount) break;
      }
    }
  } else {
    // Fallback for legacy cache layout without metadata.
    var scan = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    for (var rr = 0; rr < scan.length; rr++) {
      var row = scan[rr];
      var isMeta = false;
      for (var cc = 0; cc < row.length; cc++) {
        var raw = row[cc];
        if (!raw) continue;
        var str = String(raw);
        if (str.indexOf('LastUpdated:') !== -1 || str.indexOf(sheetName) !== -1) {
          isMeta = true;
          break;
        }
        chunks.push(str);
      }
      if (isMeta) break;
    }
  }

  var jsonStr = chunks.join('');
  return jsonStr || null;
}

// ============================================
// API ENDPOINTS (doGet)
// ============================================

function doGet(e) {
  // Security: check domain
  if (ENFORCE_DOMAIN_RESTRICTION) {
    try {
      var userEmail = Session.getActiveUser().getEmail();
      if (!userEmail || userEmail.indexOf('@' + ALLOWED_DOMAIN) === -1) {
        return jsonOut({
          error: 'forbidden',
          message: 'This API is restricted to @' + ALLOWED_DOMAIN + ' users only.'
        });
      }
    } catch (secErr) {
      Logger.log('Security check note: ' + secErr.message);
      return jsonOut({
        error: 'forbidden',
        message: 'Cannot verify current user for restricted API access.'
      });
    }
  }

  // API-first mode for GitHub Pages frontend
  var action = e.parameter.action || 'meta';

  // JSON API endpoints
  try {
    var result;
    switch(action) {
      case 'meta':
      case 'view':
        result = getApiInfo();
        break;
      case 'health':
        result = systemStatusReport();
        break;
      case 'summary':
        result = getSummaryCache();
        break;
      case 'trips':
        result = getTripsCache(
          e.parameter.start,
          e.parameter.end,
          e.parameter.route,
          e.parameter.page,
          e.parameter.limit,
          e.parameter.fields
        );
        break;
      case 'compare':
        result = getCompareData(
          e.parameter.startA || e.parameter.a_start,
          e.parameter.endA || e.parameter.a_end,
          e.parameter.startB || e.parameter.b_start,
          e.parameter.endB || e.parameter.b_end
        );
        break;
      case 'oil':
        result = getOilPriceData();
        break;
      case 'routes':
        result = getRoutesList();
        break;
      case 'customers':
        result = getCustomersList();
        break;
      default:
        result = { error: 'Invalid action: ' + action };
    }

    return jsonOut(result);
  } catch(err) {
    return jsonOut({
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
}

function getApiInfo() {
  var configured = [];
  var missing = [];
  for (var key in SHEET_SOURCES) {
    if (!SHEET_SOURCES.hasOwnProperty(key)) continue;
    if (SHEET_SOURCES[key]) configured.push(key);
    else missing.push(key);
  }
  return {
    ok: true,
    mode: 'api',
    endpoints: ['meta', 'health', 'summary', 'trips', 'compare', 'oil', 'routes', 'customers'],
    configuredMonths: configured,
    missingMonths: missing,
    enforceDomainRestriction: ENFORCE_DOMAIN_RESTRICTION,
    timestamp: new Date().toISOString()
  };
}

// jsonOut ถูกประกาศไว้ใน config.gs พร้อม CORS headers แล้ว

function getSummaryCache() {
  var jsonStr = readLargeJsonFromSheet(SHEET_SUMMARY_CACHE);
  if (!jsonStr) return { error: 'SUMMARY_CACHE not found or empty. Run dailyBatchJob first.' };

  try {
    return JSON.parse(jsonStr);
  } catch(e) {
    return { error: 'Failed to parse SUMMARY_CACHE: ' + e.message };
  }
}

function getTripsArrayFromCache_() {
  var jsonStr = readLargeJsonFromSheet(SHEET_TRIPS_CACHE);
  if (!jsonStr) return { error: 'TRIPS_CACHE not found or empty. Run dailyBatchJob first.' };
  try {
    var trips = JSON.parse(jsonStr);
    if (!Array.isArray(trips)) return { error: 'TRIPS_CACHE has invalid shape (expected array).' };
    return { trips: trips };
  } catch (e) {
    return { error: 'Failed to parse TRIPS_CACHE: ' + e.message };
  }
}

function filterTrips_(trips, start, end, route) {
  if (!start && !end && !route) return trips;
  return trips.filter(function(t) {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (route && t.route !== route) return false;
    return true;
  });
}

function projectTripFields_(trips, fields) {
  if (!fields) return trips;
  var keys = String(fields)
    .split(',')
    .map(function(k) { return String(k || '').trim(); })
    .filter(function(k) { return !!k; });
  if (keys.length === 0) return trips;
  return trips.map(function(t) {
    var o = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      o[k] = t[k];
    }
    return o;
  });
}

function getTripsCache(start, end, route, page, limit, fields) {
  var parsed = getTripsArrayFromCache_();
  if (parsed.error) return { error: parsed.error };

  var filtered = filterTrips_(parsed.trips, start, end, route);
  var total = filtered.length;

  var p = parseInt(page, 10);
  if (isNaN(p) || p < 0) p = 0;

  var l = parseInt(limit, 10);
  if (isNaN(l) || l <= 0) l = 0;
  if (l > 5000) l = 5000;

  var rows = filtered;
  var hasMore = false;
  if (l > 0) {
    var offset = p * l;
    rows = filtered.slice(offset, offset + l);
    hasMore = (offset + rows.length) < total;
  }

  rows = projectTripFields_(rows, fields);

  return {
    trips: rows,
    total: total,
    page: p,
    limit: l || null,
    hasMore: hasMore,
    start: start || null,
    end: end || null,
    route: route || null
  };
}

function getCompareData(startA, endA, startB, endB) {
  try {
    var parsed = getTripsArrayFromCache_();
    if (parsed.error) return { error: parsed.error };

    var allTrips = parsed.trips || [];
    var tripsA = filterTrips_(allTrips, startA, endA, null);
    var tripsB = filterTrips_(allTrips, startB, endB, null);

    var statsA = calculateSummary(tripsA);
    var statsB = calculateSummary(tripsB);

    return {
      rangeA: { start: startA, end: endA, stats: statsA },
      rangeB: { start: startB, end: endB, stats: statsB },
      comparison: {
        marginDiff: (statsB.totalMargin || 0) - (statsA.totalMargin || 0),
        tripDiff: (statsB.totalTrips || 0) - (statsA.totalTrips || 0)
      }
    };
  } catch (e) {
    Logger.log('[getCompareData] ERROR: ' + e.message);
    return { error: 'Compare calculation failed: ' + e.message };
  }
}

function getOilPriceData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_OIL_DIESEL);
  var meta = getOilServiceMeta_();
  if (!sheet) {
    return {
      source: meta.sourceName,
      sourceUrl: meta.sourceUrl,
      product: 'ดีเซล',
      productLabel: 'ดีเซล (ราคาขายปลีก กทม. และปริมณฑล)',
      unit: 'บาท/ลิตร',
      lastFetch: new Date().toISOString(),
      prices: []
    };
  }

  var values = sheet.getDataRange().getDisplayValues();
  var prices = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0] || row[1] === '' || row[1] === null) continue;

    // Parse date: handle both Date objects and formatted strings
    var parsedDate = parseDate(row[0]);
    if (!parsedDate) continue;

    var price = parseFloat(String(row[1]).replace(/,/g, ''));
    if (isNaN(price)) continue;

    var periodNo = parsedDate.replace(/-/g, '');

    prices.push({
      period_no: periodNo,
      period_name: parsedDate,
      year_en: parseInt(parsedDate.substring(0, 4), 10) || new Date().getFullYear(),
      update_date: parsedDate + 'T00:00:00.000Z',
      price: price
    });
  }

  // Sort by date ascending (oldest first) so last element is latest
  prices.sort(function(a, b) {
    return String(a.period_no).localeCompare(String(b.period_no));
  });

  return {
    source: meta.sourceName,
    sourceUrl: meta.sourceUrl,
    product: 'ดีเซล',
    productLabel: 'ดีเซล (ราคาขายปลีก กทม. และปริมณฑล)',
    unit: 'บาท/ลิตร',
    lastFetch: new Date().toISOString(),
    prices: prices
  };
}

function getRoutesList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(SHEET_MASTER);
  if (!master || master.getLastRow() < 2) return { routes: [] };

  var values = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getDisplayValues();
  var routes = {};
  for (var i = 0; i < values.length; i++) {
    var route = String(values[i][4] || ''); // Route column (index 4 = เส้นทาง)
    var customer = mapCustomer(String(values[i][1] || ''));
    if (route) {
      routes[route] = routes[route] || { route: route, customers: {} };
      routes[route].customers[customer] = true;
    }
  }

  var result = Object.values(routes).map(function(r) {
    return { route: r.route, customers: Object.keys(r.customers) };
  });
  result.sort(function(a, b) { return a.route.localeCompare(b.route); });

  return { routes: result };
}

function getCustomersList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(SHEET_MASTER);
  if (!master || master.getLastRow() < 2) return { customers: [] };

  var values = master.getRange(2, 1, master.getLastRow() - 1, master.getLastColumn()).getDisplayValues();
  var customers = {};
  for (var i = 0; i < values.length; i++) {
    var c = mapCustomer(String(values[i][1] || ''));
    if (c) customers[c] = (customers[c] || 0) + 1;
  }

  var result = Object.keys(customers).map(function(c) {
    return { name: c, trips: customers[c] };
  });
  result.sort(function(a, b) { return b.trips - a.trips; });

  return { customers: result };
}

function validateFrontendApiContract() {
  var errors = [];
  var warnings = [];
  var summaryPayload = getSummaryCache();
  var tripsPayload = getTripsCache();

  if (summaryPayload && summaryPayload.error) {
    errors.push('summary endpoint not ready: ' + summaryPayload.error);
  } else {
    var summaryKeys = ['summary', 'routeTrend', 'routeRanking', 'customerProfit', 'ownVsOutsource', 'vehicleType', 'lossTrip', 'revenueConcentration'];
    for (var i = 0; i < summaryKeys.length; i++) {
      if (!summaryPayload || !summaryPayload.hasOwnProperty(summaryKeys[i])) {
        errors.push('summary payload missing key: ' + summaryKeys[i]);
      }
    }

    var s = summaryPayload.summary || {};
    ['totalTrips', 'totalRevenue', 'totalMargin', 'avgMargin', 'avgMarginPct'].forEach(function(key) {
      if (typeof s[key] !== 'number') errors.push('summary.summary missing numeric field: ' + key);
    });

    var customerRow = (summaryPayload.customerProfit || [])[0];
    if (customerRow) {
      ['name', 'margin', 'trips', 'recv', 'pay', 'oil', 'loss', 'avgMargin', 'pct', 'months'].forEach(function(key) {
        if (!customerRow.hasOwnProperty(key)) errors.push('customerProfit row missing field: ' + key);
      });
    } else {
      warnings.push('customerProfit is empty');
    }

    var own = summaryPayload.ownVsOutsource || {};
    ['company', 'outsource'].forEach(function(sideKey) {
      var side = own[sideKey];
      if (!side) {
        errors.push('ownVsOutsource missing side: ' + sideKey);
        return;
      }
      ['margin', 'trips', 'recv', 'pay', 'oil', 'pct', 'topRoutes'].forEach(function(key) {
        if (!side.hasOwnProperty(key)) errors.push('ownVsOutsource.' + sideKey + ' missing field: ' + key);
      });
    });

    var lossTrip = summaryPayload.lossTrip || {};
    ['total', 'totalTrips', 'lossPct', 'totalLoss', 'byMonth', 'byRoute', 'byCustomer', 'worstRoutes'].forEach(function(key) {
      if (!lossTrip.hasOwnProperty(key)) errors.push('lossTrip missing field: ' + key);
    });
  }

  if (tripsPayload && tripsPayload.error) {
    errors.push('trips endpoint not ready: ' + tripsPayload.error);
  } else {
    if (!tripsPayload || !tripsPayload.hasOwnProperty('trips')) errors.push('trips payload missing trips');
    if (!tripsPayload || !tripsPayload.hasOwnProperty('total')) errors.push('trips payload missing total');
    var trip = tripsPayload && tripsPayload.trips && tripsPayload.trips[0];
    if (trip) {
      ['date', 'customer', 'route', 'vtype', 'driver', 'plate', 'payee', 'recv', 'pay', 'oil', 'margin'].forEach(function(key) {
        if (!trip.hasOwnProperty(key)) errors.push('trip row missing field: ' + key);
      });
    } else {
      warnings.push('trips payload has no rows');
    }
  }

  var meta = getApiInfo();
  if (meta.missingMonths && meta.missingMonths.length > 0) {
    warnings.push('Source months not configured: ' + meta.missingMonths.join(', '));
  }

  return {
    passed: errors.length === 0,
    errors: errors,
    warnings: warnings,
    checkedAt: new Date().toISOString()
  };
}

// ============================================
// REGRESSION TEST (Verify optimization correctness)
// ============================================

function testSystemIntegrity() {
  Logger.log('=== SYSTEM INTEGRITY TEST ===');
  var errors = [];
  var warnings = [];

  // 1. Check critical functions exist
  var requiredFunctions = [
    'doGet', 'include', 'jsonOut',
    'dailyBatchJob', 'rebuildMasterSheet', 'rebuildCaches',
    'getSummaryCache', 'getTripsCache', 'getAnomalies',
    'buildAnomalyGroupStats', 'parseDate', 'parseMoney',
    'writeLargeJsonToSheet', 'readLargeJsonFromSheet',
    'validateFrontendApiContract'
  ];

  for (var i = 0; i < requiredFunctions.length; i++) {
    var fn = requiredFunctions[i];
    if (typeof this[fn] !== 'function') {
      errors.push('Missing function: ' + fn);
    }
  }
  Logger.log('Functions check: ' + (requiredFunctions.length - errors.length) + '/' + requiredFunctions.length + ' OK');

  // 1.1 Check 12-month source configuration
  var configuredSources = 0;
  var missingSources = [];
  for (var sheetName in SHEET_SOURCES) {
    if (!SHEET_SOURCES.hasOwnProperty(sheetName)) continue;
    if (SHEET_SOURCES[sheetName]) configuredSources++;
    else missingSources.push(sheetName);
  }
  if (missingSources.length > 0) {
    warnings.push('Missing source URLs: ' + missingSources.join(', '));
  }
  Logger.log('Source config: ' + configuredSources + '/' + Object.keys(SHEET_SOURCES).length + ' configured');

  // 2. API-only deployment does not require HTML files
  warnings.push('API-only deployment mode: HTML file validation skipped');

  // 3. Test jsonOut function
  try {
    var testObj = { test: 'value', num: 123 };
    var jsonResult = jsonOut(testObj);
    if (!jsonResult) {
      errors.push('jsonOut returned null/undefined');
    } else {
      Logger.log('jsonOut OK');
    }
  } catch(e) {
    errors.push('jsonOut test failed: ' + e.message);
  }

  // 4. Verify sheet names exist
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var requiredSheets = [SHEET_MASTER, SHEET_SUMMARY_CACHE, SHEET_TRIPS_CACHE];
  for (var i = 0; i < requiredSheets.length; i++) {
    var sheet = ss.getSheetByName(requiredSheets[i]);
    if (!sheet) {
      warnings.push('Sheet not found (will be created): ' + requiredSheets[i]);
    } else {
      Logger.log('Sheet OK: ' + requiredSheets[i]);
    }
  }

  // 5. Test cache functions (without running full batch)
  try {
    var summary = getSummaryCache();
    if (summary && summary.error) {
      warnings.push('SUMMARY_CACHE not built yet (run dailyBatchJob): ' + summary.error);
    } else if (summary && summary.summary) {
      Logger.log('Cache OK: SUMMARY_CACHE has data');
    }
  } catch(e) {
    warnings.push('SUMMARY_CACHE test skipped: ' + e.message);
  }

  // 6. Validate frontend contract against API payloads
  try {
    var contractCheck = validateFrontendApiContract();
    for (var ce = 0; ce < contractCheck.errors.length; ce++) {
      errors.push(contractCheck.errors[ce]);
    }
    for (var cw = 0; cw < contractCheck.warnings.length; cw++) {
      warnings.push(contractCheck.warnings[cw]);
    }
    Logger.log('Frontend contract check: ' + (contractCheck.passed ? 'PASS' : 'FAIL'));
  } catch (contractErr) {
    errors.push('Frontend contract validation failed: ' + contractErr.message);
  }

  // Summary
  Logger.log('=== INTEGRITY TEST SUMMARY ===');
  Logger.log('Errors: ' + errors.length);
  Logger.log('Warnings: ' + warnings.length);

  if (errors.length > 0) {
    Logger.log('=== ERRORS ===');
    for (var i = 0; i < errors.length; i++) {
      Logger.log('ERROR: ' + errors[i]);
    }
  }

  if (warnings.length > 0) {
    Logger.log('=== WARNINGS ===');
    for (var i = 0; i < warnings.length; i++) {
      Logger.log('WARNING: ' + warnings[i]);
    }
  }

  if (errors.length === 0) {
    Logger.log('=== SYSTEM READY FOR DEPLOYMENT ===');
    SpreadsheetApp.getActiveSpreadsheet().toast('System integrity check passed', 'Ready to Deploy', 5);
  } else {
    Logger.log('=== FIX ERRORS BEFORE DEPLOYING ===');
    SpreadsheetApp.getActiveSpreadsheet().toast('Found ' + errors.length + ' errors', 'Fix before Deploy', 10);
  }

  return { passed: errors.length === 0, errors: errors, warnings: warnings };
}

function testOptimization() {
  Logger.log('=== OPTIMIZATION REGRESSION TEST ===');
  var t0 = new Date().getTime();

  // 1. Run full pipeline
  dailyBatchJob();

  // 2. Verify caches exist and parseable
  var summary = getSummaryCache();
  var trips = getTripsCache();

  var errors = [];

  if (summary.error) errors.push('SUMMARY_CACHE: ' + summary.error);
  if (trips.error) errors.push('TRIPS_CACHE: ' + trips.error);

  // 3. Verify summary KPIs
  if (!summary.error) {
    var s = summary.summary || {};
    if (s.totalTrips === undefined || s.totalTrips === 0) {
      errors.push('totalTrips is 0 or undefined');
    }
    if (s.totalRevenue === undefined || s.totalRevenue === 0) {
      errors.push('totalRevenue is 0 or undefined');
    }
    if (s.totalMargin === undefined) {
      errors.push('totalMargin is undefined');
    }
    Logger.log('Summary OK: trips=' + s.totalTrips + ' revenue=' + s.totalRevenue + ' margin=' + s.totalMargin);
  }

  // 4. Verify trips data
  if (!trips.error && trips.trips) {
    if (trips.trips.length === 0) {
      errors.push('TRIPS_CACHE has 0 trips');
    } else {
      var sample = trips.trips[0];
      if (!sample.date || !sample.route || sample.recv === undefined || sample.pay === undefined) {
        errors.push('TRIPS_CACHE missing required fields');
      }
      Logger.log('Trips OK: count=' + trips.trips.length + ' sample=' + JSON.stringify(sample).substring(0, 120));
    }
  }

  // 5. Verify MASTER has data
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(SHEET_MASTER);
  if (!master || master.getLastRow() < 2) {
    errors.push('MASTER is empty');
  } else {
    Logger.log('MASTER OK: rows=' + (master.getLastRow() - 1));
  }

  // 6. Performance log
  var totalTime = new Date().getTime() - t0;
  Logger.log('Total test time: ' + totalTime + 'ms');

  if (errors.length === 0) {
    Logger.log('=== ALL TESTS PASSED ===');
    SpreadsheetApp.getActiveSpreadsheet().toast('Optimization test passed in ' + totalTime + 'ms', 'Regression Test', 5);
  } else {
    Logger.log('=== TEST FAILURES ===');
    for (var i = 0; i < errors.length; i++) {
      Logger.log('FAIL: ' + errors[i]);
    }
    SpreadsheetApp.getActiveSpreadsheet().toast('Test failed: ' + errors.length + ' errors', 'Regression Test', 10);
  }

  return { passed: errors.length === 0, errors: errors, timeMs: totalTime };
}

/**
 * Full backend QA suite (read-only checks; no rebuild/write side effects).
 * Run this before deployment to verify data contract, payload shapes, and timing.
 */
function runBackendQaSuite() {
  var startedAt = new Date();
  var report = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: 0,
    errors: [],
    warnings: [],
    checks: [],
    timingsMs: {}
  };

  qaStep_(report, 'apiInfo', function() {
    var info = getApiInfo();
    var configured = (info.configuredMonths || []).length;
    var missing = (info.missingMonths || []).length;
    if (!info.ok) throw new Error('apiInfo.ok is false');
    if (configured === 0) {
      report.warnings.push('No source month is configured in SHEET_SOURCES.');
    }
    return { configuredMonths: configured, missingMonths: missing };
  });

  qaStep_(report, 'systemStatusReport', function() {
    var status = systemStatusReport();
    if (!status || !status.sheets) throw new Error('systemStatusReport shape invalid');
    return {
      masterRows: status.sheets.masterRows,
      summaryRows: status.sheets.summaryCacheRows,
      tripsRows: status.sheets.tripsCacheRows,
      oilRows: status.sheets.oilRows,
      contractPassed: status.contract && status.contract.passed
    };
  });

  qaStep_(report, 'summaryCache', function() {
    var summary = getSummaryCache();
    if (summary && summary.error) throw new Error(summary.error);
    if (!summary || !summary.summary) throw new Error('summary payload missing summary');
    var s = summary.summary;
    if (typeof s.totalTrips !== 'number') throw new Error('summary.totalTrips is not numeric');
    if (typeof s.totalRevenue !== 'number') throw new Error('summary.totalRevenue is not numeric');
    if (typeof s.totalMargin !== 'number') throw new Error('summary.totalMargin is not numeric');
    return {
      totalTrips: s.totalTrips,
      totalRevenue: s.totalRevenue,
      totalMargin: s.totalMargin,
      avgMarginPct: s.avgMarginPct
    };
  });

  qaStep_(report, 'tripsCache', function() {
    var tripsPayload = getTripsCache(null, null, null, 0, 5000);
    if (tripsPayload && tripsPayload.error) throw new Error(tripsPayload.error);
    var trips = tripsPayload.trips || [];
    if (trips.length === 0) {
      report.warnings.push('TRIPS_CACHE has 0 rows in first page.');
      return { rows: 0, sampleDate: null };
    }
    var sample = trips[0];
    var required = ['date', 'customer', 'route', 'vtype', 'driver', 'plate', 'recv', 'pay', 'oil', 'margin'];
    for (var i = 0; i < required.length; i++) {
      if (!sample.hasOwnProperty(required[i])) {
        throw new Error('trip sample missing field: ' + required[i]);
      }
    }
    return {
      rows: trips.length,
      total: tripsPayload.total || trips.length,
      sampleDate: sample.date
    };
  });

  qaStep_(report, 'oilPayload', function() {
    var oil = getOilPriceData();
    if (!oil || !oil.prices) throw new Error('oil payload missing prices');
    var prices = oil.prices || [];
    if (prices.length === 0) {
      report.warnings.push('Oil payload has no price rows.');
      return { rows: 0, latestDate: null };
    }
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!p.period_name) throw new Error('oil row missing period_name at index ' + i);
      if (typeof p.price !== 'number' || !isFinite(p.price)) {
        throw new Error('oil row price is invalid at index ' + i);
      }
      if (i > 0 && String(prices[i - 1].period_no) > String(p.period_no)) {
        throw new Error('oil rows are not sorted ascending by period_no');
      }
    }
    var latest = prices[prices.length - 1].period_name;
    return {
      rows: prices.length,
      latestDate: latest,
      source: oil.source || '-'
    };
  });

  qaStep_(report, 'compareSmoke', function() {
    var parsed = getTripsArrayFromCache_();
    if (parsed.error) throw new Error(parsed.error);
    var all = parsed.trips || [];
    if (all.length < 2) {
      report.warnings.push('Compare smoke skipped: not enough trips.');
      return { skipped: true };
    }
    var a = all[0].date;
    var b = all[all.length - 1].date;
    var cmp = getCompareData(a, a, b, b);
    if (cmp && cmp.error) throw new Error(cmp.error);
    if (!cmp || !cmp.rangeA || !cmp.rangeB || !cmp.comparison) {
      throw new Error('compare payload shape invalid');
    }
    return {
      rangeA: a,
      rangeB: b,
      tripDiff: cmp.comparison.tripDiff,
      marginDiff: cmp.comparison.marginDiff
    };
  });

  qaStep_(report, 'contractValidation', function() {
    var contract = validateFrontendApiContract();
    if (!contract) throw new Error('contract validation returned empty');
    if (!contract.passed) {
      for (var i = 0; i < contract.errors.length; i++) {
        report.errors.push('contract: ' + contract.errors[i]);
      }
    }
    for (var j = 0; j < contract.warnings.length; j++) {
      report.warnings.push('contract: ' + contract.warnings[j]);
    }
    return {
      passed: contract.passed,
      errorCount: contract.errors.length,
      warningCount: contract.warnings.length
    };
  });

  qaStep_(report, 'performance', function() {
    var perf = {
      summaryMs: measureCallMs_(function() { getSummaryCache(); }),
      tripsMs: measureCallMs_(function() { getTripsCache(null, null, null, 0, 5000); }),
      oilMs: measureCallMs_(function() { getOilPriceData(); }),
      contractMs: measureCallMs_(function() { validateFrontendApiContract(); })
    };
    report.timingsMs = perf;
    if (perf.tripsMs > 5000) {
      report.warnings.push('Trips read is slow (>5000ms). Consider cache refresh or payload paging.');
    }
    return perf;
  });

  report.ok = report.errors.length === 0;
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date().getTime() - startedAt.getTime();

  Logger.log('=== BACKEND QA SUITE ===');
  Logger.log(JSON.stringify(report));
  SpreadsheetApp.getActiveSpreadsheet().toast(
    report.ok ? 'Backend QA: PASS' : ('Backend QA: FAIL (' + report.errors.length + ' errors)'),
    'QA Suite',
    report.ok ? 5 : 10
  );
  return report;
}

function withSpreadsheetRetry_(fn, label, maxRetries) {
  var retries = Math.max(1, maxRetries || 3);
  var lastErr = null;
  for (var i = 0; i < retries; i++) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      var msg = String((e && e.message) || e || '');
      var timeoutLike = msg.indexOf('timed out while accessing document') !== -1 ||
                        msg.indexOf('Service Spreadsheets timed out') !== -1;
      if (!timeoutLike || i === retries - 1) break;
      Utilities.sleep(400 * (i + 1));
      Logger.log('[withSpreadsheetRetry_] retry ' + (i + 1) + '/' + retries + ' for ' + label + ' due to timeout');
    }
  }
  throw lastErr;
}

/**
 * Audit-focused readiness test.
 * - Safe test: no sync, no rebuild, no source fetch
 * - Verifies snapshot/diff/audit-sheet pipeline is ready
 */
function testSyncAuditReadiness() {
  var startedAt = new Date();
  var report = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: 0,
    errors: [],
    warnings: [],
    details: {}
  };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var includeContract = false; // keep this readiness test lightweight and stable

    // 1) Build snapshot from current MASTER
    var snap = withSpreadsheetRetry_(function() {
      return buildMasterSnapshotForAudit_();
    }, 'buildMasterSnapshotForAudit_', 3);
    report.details.snapshotRows = snap.rows || 0;
    report.details.snapshotTotals = snap.totals || { recv: 0, pay: 0, oil: 0, margin: 0 };

    // 2) Diff same snapshot should be zero
    var sameDiff = diffAuditSnapshots_(snap, snap, 50);
    if (sameDiff.added !== 0 || sameDiff.removed !== 0 || sameDiff.changed !== 0) {
      report.errors.push('Self diff is not zero (unexpected).');
    }
    report.details.selfDiff = {
      added: sameDiff.added,
      removed: sameDiff.removed,
      changed: sameDiff.changed
    };

    // 3) Ensure audit sheets + styled headers exist
    var logSheet = withSpreadsheetRetry_(function() {
      return getOrCreateSheet(ss, SHEET_SYNC_AUDIT_LOG);
    }, 'getOrCreateSheet(LOG)', 3);
    var detailSheet = withSpreadsheetRetry_(function() {
      return getOrCreateSheet(ss, SHEET_SYNC_AUDIT_DETAIL);
    }, 'getOrCreateSheet(DETAIL)', 3);
    withSpreadsheetRetry_(function() {
      ensureAuditLogHeader_(logSheet);
      ensureAuditDetailHeader_(detailSheet);
      return true;
    }, 'ensureAuditHeaders', 3);
    report.details.auditSheets = {
      logSheet: SHEET_SYNC_AUDIT_LOG,
      detailSheet: SHEET_SYNC_AUDIT_DETAIL,
      logLastRow: logSheet.getLastRow(),
      detailLastRow: detailSheet.getLastRow()
    };

    // 4) Optional contract check (heavier)
    if (includeContract) {
      var contract = withSpreadsheetRetry_(function() {
        return validateFrontendApiContract();
      }, 'validateFrontendApiContract', 2);
      report.details.contract = {
        passed: contract.passed,
        errors: contract.errors.length,
        warnings: contract.warnings.length
      };
      if (!contract.passed) {
        for (var i = 0; i < contract.errors.length; i++) {
          report.errors.push('contract: ' + contract.errors[i]);
        }
      }
      for (var j = 0; j < contract.warnings.length; j++) {
        report.warnings.push('contract: ' + contract.warnings[j]);
      }
    } else {
      report.details.contract = { skipped: true, reason: 'lightweight mode' };
    }

  } catch (e) {
    report.errors.push((e && e.message ? e.message : String(e)) + (e && e.stack ? (' | ' + e.stack) : ''));
  }

  report.ok = report.errors.length === 0;
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date().getTime() - startedAt.getTime();

  Logger.log('=== SYNC AUDIT READINESS TEST ===');
  Logger.log(JSON.stringify(report));
  SpreadsheetApp.getActiveSpreadsheet().toast(
    report.ok ? 'Sync Audit Readiness: PASS' : ('Sync Audit Readiness: FAIL (' + report.errors.length + ')'),
    'Audit Test',
    report.ok ? 5 : 10
  );
  return report;
}

function testSyncAuditReadinessFull() {
  var report = testSyncAuditReadiness();
  if (!report.ok) return report;

  try {
    var contract = withSpreadsheetRetry_(function() {
      return validateFrontendApiContract();
    }, 'validateFrontendApiContract(full)', 2);
    report.details.contract = {
      passed: contract.passed,
      errors: contract.errors.length,
      warnings: contract.warnings.length
    };
    if (!contract.passed) {
      for (var i = 0; i < contract.errors.length; i++) {
        report.errors.push('contract: ' + contract.errors[i]);
      }
    }
    for (var j = 0; j < contract.warnings.length; j++) {
      report.warnings.push('contract: ' + contract.warnings[j]);
    }
  } catch (e) {
    report.errors.push('contract(full): ' + (e && e.message ? e.message : String(e)));
  }

  report.ok = report.errors.length === 0;
  report.finishedAt = new Date().toISOString();
  Logger.log('=== SYNC AUDIT READINESS FULL TEST ===');
  Logger.log(JSON.stringify(report));
  SpreadsheetApp.getActiveSpreadsheet().toast(
    report.ok ? 'Sync Audit Full: PASS' : ('Sync Audit Full: FAIL (' + report.errors.length + ')'),
    'Audit Test',
    report.ok ? 5 : 10
  );
  return report;
}

function testPttorDieselSource() {
  var report = {
    ok: true,
    timestamp: new Date().toISOString(),
    sourceName: null,
    sourceUrl: null,
    fetchedRows: 0,
    latestFetched: null,
    latestSheet: null,
    sampleFetched: [],
    error: null
  };

  try {
    var meta = getOilServiceMeta_();
    report.sourceName = meta.sourceName;
    report.sourceUrl = meta.sourceUrl;

    var fetched = fetchOrDieselRows_();
    var rows = fetched && fetched.rows ? fetched.rows : [];
    report.fetchedRows = rows.length;
    if (rows.length > 0) {
      report.latestFetched = rows[rows.length - 1];
      report.sampleFetched = rows.slice(Math.max(0, rows.length - 5));
    }

    var oil = getOilPriceData();
    var prices = oil && oil.prices ? oil.prices : [];
    if (prices.length > 0) {
      report.latestSheet = prices[prices.length - 1];
    }
  } catch (e) {
    report.ok = false;
    report.error = e && e.message ? e.message : String(e);
  }

  Logger.log('=== TEST PTTOR DIESEL SOURCE ===');
  Logger.log(JSON.stringify(report));
  SpreadsheetApp.getActiveSpreadsheet().toast(
    report.ok ? 'PTTOR Diesel Source: PASS' : 'PTTOR Diesel Source: FAIL',
    'Oil Source Test',
    report.ok ? 5 : 10
  );
  return report;
}

/**
 * Public runner: refresh diesel rows from PTTOR source into OIL_DIESEL_DATA.
 * Use this from Apps Script Run menu.
 */
function refreshOilDataNow() {
  var started = new Date();
  var result = refreshOilDataForApi_();
  var report = {
    ok: true,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    rows: (result && result.rows) || 0,
    updatedRows: (result && result.updatedRows) || 0,
    source: (result && result.source) || 'PTTOR',
    latestDate: (result && result.latestDate) || null,
    fetchError: (result && result.fetchError) || ''
  };
  Logger.log('=== REFRESH OIL DATA NOW ===');
  Logger.log(JSON.stringify(report));
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Oil refresh done: rows=' + report.rows + ', updated=' + report.updatedRows,
    'Oil Refresh',
    5
  );
  return report;
}

/**
 * Public runner: refresh oil data and then verify fetched vs sheet value.
 */
function refreshOilAndTestPttorDiesel() {
  var refresh = refreshOilDataNow();
  var verify = testPttorDieselSource();
  var report = {
    ok: !!(refresh && refresh.ok) && !!(verify && verify.ok),
    refresh: refresh,
    verify: verify
  };
  Logger.log('=== REFRESH + TEST PTTOR DIESEL ===');
  Logger.log(JSON.stringify(report));
  return report;
}

function qaStep_(report, name, fn) {
  var t0 = new Date().getTime();
  try {
    var details = fn();
    report.checks.push({
      name: name,
      ok: true,
      durationMs: new Date().getTime() - t0,
      details: details || null
    });
  } catch (e) {
    report.errors.push(name + ': ' + (e && e.message ? e.message : String(e)));
    report.checks.push({
      name: name,
      ok: false,
      durationMs: new Date().getTime() - t0,
      details: null
    });
  }
}

function measureCallMs_(fn) {
  var t0 = new Date().getTime();
  fn();
  return new Date().getTime() - t0;
}

// ============================================
// DEBUG: Inspect source data from each configured sheet
// ============================================
function debugSourceData() {
  var months = ['DATA(M1)', 'DATA(M2)', 'DATA(M3)', 'DATA(M4)', 'DATA(M5)', 'DATA(M6)',
                'DATA(M7)', 'DATA(M8)', 'DATA(M9)', 'DATA(M10)', 'DATA(M11)', 'DATA(M12)'];
  var totalFetched = 0;
  for (var i = 0; i < months.length; i++) {
    var sheetName = months[i];
    var sourceUrl = SHEET_SOURCES[sheetName];
    if (!sourceUrl) {
      Logger.log('[' + sheetName + '] No URL configured, SKIPPED');
      continue;
    }
    var sourceSheetName = SOURCE_SHEET_NAMES[sheetName];
    try {
      var sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
      var allSheets = sourceSS.getSheets();
      var sheetNames = allSheets.map(function(s) { return s.getName(); });
      Logger.log('[' + sheetName + '] Available sheets: ' + sheetNames.join(', '));
      
      var sourceSheet = sourceSS.getSheetByName(sourceSheetName);
      if (!sourceSheet) {
        Logger.log('[' + sheetName + '] ERROR: Sheet "' + sourceSheetName + '" NOT FOUND in this file!');
        continue;
      }
      var lastRow = sourceSheet.getLastRow();
      Logger.log('[' + sheetName + '] Sheet "' + sourceSheetName + '" has ' + lastRow + ' rows');
      
      if (lastRow > 0) {
        var header = sourceSheet.getRange(1, 1, 1, 21).getDisplayValues()[0];
        Logger.log('[' + sheetName + '] Header cols 0-20: ' + header.map(function(h, idx) { return idx + ':' + h; }).join(' | '));
        
        var sampleRows = Math.min(3, lastRow - 1);
        if (sampleRows > 0) {
          var sample = sourceSheet.getRange(2, 1, sampleRows, 21).getDisplayValues();
          for (var r = 0; r < sample.length; r++) {
            Logger.log('[' + sheetName + '] Row ' + (r + 2) + ' (display): ' + sample[r].map(function(v, idx) { return idx + ':' + v; }).join(' | '));
          }
          // Show parsed date from first sample row
          var firstDateStr = sample[0][0];
          var parsedDate = parseDate(firstDateStr);
          Logger.log('[' + sheetName + '] Date parse test: "' + firstDateStr + '" -> ' + (parsedDate ? parsedDate : 'FAILED'));
        }
      }
    } catch (e) {
      Logger.log('[' + sheetName + '] ERROR: ' + e.message);
    }
  }
  Logger.log('=== debugSourceData COMPLETE ===');
}

function debugMasterData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var master = ss.getSheetByName(SHEET_MASTER);
  if (!master) {
    Logger.log('MASTER sheet not found!');
    return;
  }
  var lastRow = master.getLastRow();
  Logger.log('MASTER has ' + lastRow + ' rows');
  if (lastRow <= 1) {
    Logger.log('MASTER is empty (only header or less)');
    return;
  }
  // Show header
  var header = master.getRange(1, 1, 1, 13).getDisplayValues()[0];
  Logger.log('MASTER header: ' + header.map(function(h, i) { return i + ':' + h; }).join(' | '));
  // Show first 3 data rows
  var sample = master.getRange(2, 1, Math.min(3, lastRow - 1), 13).getDisplayValues();
  for (var i = 0; i < sample.length; i++) {
    Logger.log('MASTER row ' + (i + 2) + ': ' + sample[i].map(function(v, idx) { return idx + ':' + v; }).join(' | '));
  }
  // Show date range
  var allDates = master.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  var firstDate = allDates[0][0];
  var lastDate = allDates[allDates.length - 1][0];
  Logger.log('MASTER date range: ' + firstDate + ' to ' + lastDate);
  Logger.log('=== debugMasterData COMPLETE ===');
}

function debugCacheData() {
  // Check SUMMARY_CACHE
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summaryCache = ss.getSheetByName(SHEET_SUMMARY_CACHE);
  if (summaryCache) {
    var lastRow = summaryCache.getLastRow();
    Logger.log('SUMMARY_CACHE has ' + lastRow + ' rows');
    if (lastRow >= 2) {
      var jsonStr = readLargeJsonFromSheet(SHEET_SUMMARY_CACHE);
      if (jsonStr) {
        try {
          var data = JSON.parse(jsonStr);
          Logger.log('SUMMARY_CACHE parsed OK. Keys: ' + Object.keys(data).join(', '));
          if (data.summary) {
            Logger.log('Summary stats: totalTrips=' + data.summary.totalTrips +
              ', totalRevenue=' + data.summary.totalRevenue +
              ', totalMargin=' + data.summary.totalMargin +
              ', avgMarginPct=' + data.summary.avgMarginPct);
          }
          if (data.routeTrend) {
            Logger.log('routeTrend count: ' + data.routeTrend.length);
            if (data.routeTrend.length > 0) {
              var first = data.routeTrend[0];
              Logger.log('First routeTrend: ' + JSON.stringify(first).substring(0, 200));
            }
          }
          if (data.driverPerf) {
            Logger.log('driverPerf count: ' + data.driverPerf.length);
          }
        } catch (e) {
          Logger.log('SUMMARY_CACHE parse ERROR: ' + e.message);
        }
      } else {
        Logger.log('SUMMARY_CACHE readLargeJson returned empty');
      }
    }
  } else {
    Logger.log('SUMMARY_CACHE sheet not found');
  }

  // Check TRIPS_CACHE
  var tripsCache = ss.getSheetByName(SHEET_TRIPS_CACHE);
  if (tripsCache) {
    var lastRow2 = tripsCache.getLastRow();
    Logger.log('TRIPS_CACHE has ' + lastRow2 + ' rows');
    if (lastRow2 >= 2) {
      var jsonStr2 = readLargeJsonFromSheet(SHEET_TRIPS_CACHE);
      if (jsonStr2) {
        try {
          var trips = JSON.parse(jsonStr2);
          Logger.log('TRIPS_CACHE parsed OK. Trip count: ' + trips.length);
          if (trips.length > 0) {
            var firstTrip = trips[0];
            Logger.log('First trip: ' + JSON.stringify(firstTrip));
            var lastTrip = trips[trips.length - 1];
            Logger.log('Last trip: ' + JSON.stringify(lastTrip));
          }
        } catch (e) {
          Logger.log('TRIPS_CACHE parse ERROR: ' + e.message);
        }
      } else {
        Logger.log('TRIPS_CACHE readLargeJson returned empty');
      }
    }
  } else {
    Logger.log('TRIPS_CACHE sheet not found');
  }

  Logger.log('=== debugCacheData COMPLETE ===');
}

