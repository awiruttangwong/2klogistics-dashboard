/**
 * ============================================
 * GAS Dashboard Backend
 * - Data Import & Sync (M1-M12)
 * - Pre-calculate: MASTER, SUMMARY_CACHE, TRIPS_CACHE
 * - API: doGet() for frontend
 * - Daily Batch Job (Trigger 08:00)
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
    .createMenu('จัดการข้อมูล')
    .addItem('1. อัปเดท Dashboard ทั้งหมด', 'dailyBatchJob')
    .addSeparator()
    .addItem('2. ตั้ง Trigger อัตโนมัติ', 'createDailyTrigger')
    .addItem('3. ลบ Trigger ทั้งหมด', 'removeAllTriggers')
    .addSeparator()
    .addItem('4. Sync เฉพาะ M1-M12 ', 'importAllConfiguredSheets')
    .addSeparator()
    .addItem('5. วิธีใช้งาน', 'showHelp')
    .addToUi();
}

function showHelp() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];
  lines.push('=== วิธีใช้งาน GAS Dashboard Backend ===');
  lines.push('');
  lines.push('--- การใช้งานเบื้องต้น ---');
  lines.push('1. Sync ข้อมูล: เมนู "จัดการข้อมูล" > "Sync ทุกชีทที่มีลิ้งก์"');
  lines.push('2. คำนวณ MASTER + CACHE: "คำนวณ MASTER + CACHE ทั้งหมด"');
  lines.push('3. ตั้ง Trigger: "ตั้ง Trigger อัตโนมัติ" (รันทุกเช้า 08:00)');
  lines.push('');
  lines.push('--- API Endpoints (Web App) ---');
  lines.push('?action=summary     -> ข้อมูลสรุป KPI');
  lines.push('?action=trips       -> รายเที่ยว + Anomaly');
  lines.push('?action=compare     -> เปรียบเทียบช่วง A vs B');
  lines.push('?action=oil         -> ราคาน้ำมันดีเซล');
  lines.push('?action=routes      -> รายชื่อเส้นทาง');
  lines.push('?action=customers   -> รายชื่อลูกค้า');
  lines.push('');
  lines.push('=== หมายเหตุ ===');
  lines.push('- ข้อมูลดิบอยู่ที่ชีท DATA(M1)-DATA(M12)');
  lines.push('- MASTER รวมข้อมูลทุกเดือนไว้ในชีทเดียว');
  lines.push('- SUMMARY_CACHE คำนวณ KPI ไว้ล่วงหน้า');
  lines.push('- TRIPS_CACHE คำนวณ Anomaly ไว้ล่วงหน้า');
  lines.push('- OIL_DIESEL_DATA อัปเดตราคาน้ำมันมือ');
  ui.alert(lines.join('\n'));
}

// ============================================
// SOURCE IMPORT FUNCTIONS
// ============================================

function fetchSourceData(sourceUrl, sourceSheetName) {
  var sourceSS;
  try {
    sourceSS = SpreadsheetApp.openByUrl(sourceUrl);
  } catch (e) {
    throw new Error('ไม่สามารถเปิดไฟล์ต้นทางได้ กรุณาตรวจสอบว่าลิ้งก์ถูกต้อง และคุณมีสิทธิ์เข้าถึงไฟล์นั้น');
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

    // STEP 2: A,B,E,H,I,J,K ต้องมีข้อมูลทุกอัน
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

    // Check R,S,T columns (index 9,10,11) — skip if all empty or only R with empty S,T
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

    var sheet = ss.getSheetByName(sheetName);
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
  lines.push('=== รายงาน Sync ทุกชีทที่มีลิ้งก์ ===');
  lines.push('ชีทที่ประมวลผล: ' + processedCount + ' ชีท');
  lines.push('ชีทที่ข้าม (ไม่มีลิ้งก์): ' + skippedCount + ' ชีท');
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
    .atHour(8)
    .create();

  ui.alert('ตั้งค่าสำเร็จ!\n\n- ลบ Trigger เก่า: ' + removed + ' รายการ\n- สร้าง Trigger ใหม่: dailyBatchJob เวลา 08:00 น. ทุกวัน\n\nหมายเหตุ: ต้องบันทึกโปรเจกต์ (Save project) และรอประมาณ 1 นาทีก่อน Trigger จะทำงานครั้งแรก');
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('[dailyBatchJob] === START ===');
  var t0 = new Date().getTime();
  ss.toast('เริ่ม Daily Batch Job...', 'กำลังทำงาน', 5);

  var stepErrors = [];

  // 1. Sync ข้อมูลจากต้นทาง M1-M12 (พร้อมรายงานการอัปเดท)
  var t1 = new Date().getTime();
  var syncReport = [];
  try {
    syncReport = importAllConfiguredSheetsSilentWithReport();
    Logger.log('[dailyBatchJob] Step 1 importAllConfiguredSheetsSilentWithReport done in ' + (new Date().getTime() - t1) + 'ms');
  } catch (e) {
    stepErrors.push('Step 1 (Sync): ' + e.message);
    Logger.log('[dailyBatchJob] Step 1 ERROR: ' + e.message);
  }

  // 2. รวมเป็น MASTER
  var t2 = new Date().getTime();
  try {
    rebuildMasterSheet();
    Logger.log('[dailyBatchJob] Step 2 rebuildMasterSheet done in ' + (new Date().getTime() - t2) + 'ms');
  } catch (e) {
    stepErrors.push('Step 2 (MASTER): ' + e.message);
    Logger.log('[dailyBatchJob] Step 2 ERROR: ' + e.message);
  }

  // 3+4. Pre-calculate KPI + Trips -> SUMMARY_CACHE + TRIPS_CACHE (single pass)
  var t3 = new Date().getTime();
  try {
    rebuildCaches();
    Logger.log('[dailyBatchJob] Step 3+4 rebuildCaches done in ' + (new Date().getTime() - t3) + 'ms');
  } catch (e) {
    stepErrors.push('Step 3+4 (Cache): ' + e.message);
    Logger.log('[dailyBatchJob] Step 3+4 ERROR: ' + e.message);
  }

  Logger.log('[dailyBatchJob] === END === Total time: ' + (new Date().getTime() - t0) + 'ms');

  // รายงานผลสรุป
  var reportLines = [];
  reportLines.push('รายงานการอัปเดทข้อมูล:');
  reportLines.push('');
  var totalNewRows = 0;
  var updatedSheets = [];
  for (var i = 0; i < syncReport.length; i++) {
    var r = syncReport[i];
    if (r.newRows > 0) {
      reportLines.push(r.sheet + ': เดิม ' + r.oldRows + ' แถว, ใหม่ ' + r.newRows + ' แถว (รวม ' + r.totalRows + ')');
      totalNewRows += r.newRows;
      updatedSheets.push(r.sheet);
    }
  }
  if (updatedSheets.length === 0) {
    reportLines.push('ไม่มีข้อมูลใหม่จากต้นทาง');
  } else {
    reportLines.push('');
    reportLines.push('รวมข้อมูลใหม่ทั้งหมด: ' + totalNewRows + ' แถว จาก ' + updatedSheets.length + ' ชีท');
  }

  // แจ้งเตือนถ้ามีข้อผิดพลาด (แต่ระบบยังทำงานได้บางส่วน)
  if (stepErrors.length > 0) {
    reportLines.push('');
    reportLines.push('ข้อผิดพลาดที่เกิดขึ้น:');
    for (var j = 0; j < stepErrors.length; j++) {
      reportLines.push('- ' + stepErrors[j]);
    }
    reportLines.push('ระบบยังทำงานบางส่วนได้');
  }

  var summaryText = reportLines.join('\n');
  Logger.log(summaryText);
  ss.toast(summaryText, 'รายงานการอัปเดท', 15);
}

function importAllConfiguredSheetsSilent() {
  importAllConfiguredSheetsSilentWithReport();
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

    var sheet = ss.getSheetByName(sheetName);
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
  var sourceSheet = ss.getSheetByName('DATA(M1)') || ss.getSheetByName('DATA(M2)');
  var headers = ['วันที่', 'ลูกค้า', 'ประเภทรถ', 'ชื่อเส้นทาง', 'เส้นทาง (Route)',
                 'ชื่อพขร', 'ทะเบียน', 'จ่ายสำรองน้ำมัน', 'ชื่อผู้รับโอน', 'ราคารับ',
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
    if (!date) { failReasons.noDate++; parseFailCount++; continue; }
    if (!route) { failReasons.noRoute++; parseFailCount++; continue; }
    if (recv === null) { failReasons.noRecv++; parseFailCount++; continue; }
    if (pay === null) { failReasons.noPay++; parseFailCount++; continue; }
    var trip = parseTripRow(row);
    if (trip) trips.push(trip);
  }
  Logger.log('[rebuildCaches] Parse results: total=' + values.length + ' success=' + trips.length + ' fail=' + parseFailCount);
  if (values.length > 0 && trips.length === 0) {
    Logger.log('[rebuildCaches] SAMPLE ROW[0]: ' + JSON.stringify(values[0]));
  }

  // Pre-compute anomaly groups once (O(n) instead of O(n²) per trip)
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
  //  5:ชื่อพขร, 6:ทะเบียน, 7:จ่ายสำรองน้ำมัน, 8:ชื่อผู้รับโอน,
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
  // Try DD/MM/YYYY
  var match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    var year = parseInt(match[3], 10);
    if (year > 2500) year -= 543; // Buddhist to Gregorian
    return year + '-' + pad2(match[2]) + '-' + pad2(match[1]);
  }
  // Try YYYY-MM-DD
  match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return str;
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

function parseMoney(val) {
  if (val === null || val === undefined) return null;
  var str = String(val).trim().replace(/,/g, '').replace(/฿/g, '').replace(/\u0E3F/g, '');
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

// Pre-compute group stats once per batch (O(n) instead of O(n²))
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
    if (!routeData[t.route]) {
      routeData[t.route] = { route: t.route, customer: t.customer, desc: t.routeDesc, margin: 0, trips: 0, recv: 0, loss: 0 };
    }
    routeData[t.route].margin += (t.margin || 0);
    routeData[t.route].trips++;
    routeData[t.route].recv += (t.recv || 0);
    if ((t.margin || 0) < 0) routeData[t.route].loss++;
  }

  var list = Object.values(routeData);
  list.forEach(function(r) {
    r.avgMargin = r.trips > 0 ? r.margin / r.trips : 0;
    r.pct = r.recv > 0 ? (r.margin / r.recv * 100) : 0;
  });
  list.sort(function(a, b) { return b.margin - a.margin; });

  var profitRoutes = list.filter(function(r) { return r.margin > 0; });
  var lossRoutes = list.filter(function(r) { return r.margin < 0; });
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
    var isCompany = t.payee === t.driver || t.payee.indexOf('บริษัท') !== -1 || t.payee === '-' || !t.payee;
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

  // Read all data rows (skip header and metadata)
  // Metadata starts with 'LastUpdated:' - find it
  var allValues = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  var chunks = [];

  for (var r = 0; r < allValues.length; r++) {
    var row = allValues[r];
    var isMeta = false;
    for (var c = 0; c < row.length; c++) {
      var val = row[c];
      if (!val) continue;
      var str = String(val);
      if (str.indexOf('LastUpdated:') !== -1 || str.indexOf(sheetName) !== -1) {
        isMeta = true;
        break;
      }
      chunks.push(str);
    }
    if (isMeta) break;
  }

  var jsonStr = chunks.join('');
  if (!jsonStr) return null;
  return jsonStr;
}

// ============================================
// API ENDPOINTS (doGet)
// ============================================

function doGet(e) {
  // Security: check domain
  try {
    var userEmail = Session.getActiveUser().getEmail();
    if (!userEmail || userEmail.indexOf('@2klogistics.co.th') === -1) {
      return HtmlService.createHtmlOutput('<h1>403 Forbidden</h1><p>This app is restricted to @2klogistics.co.th users only.</p>')
        .setTitle('Access Denied');
    }
  } catch (secErr) {
    // If running as web app with execute as me, this might fail - proceed with caution
    Logger.log('Security check note: ' + secErr.message);
  }

  // If requesting HTML (no action param or action=view), serve the dashboard
  var action = e.parameter.action || 'view';

  if (action === 'view') {
    var template = HtmlService.createTemplateFromFile('Index');
    return template.evaluate()
      .setTitle('Logistics Analytics Dashboard')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // JSON API endpoints
  try {
    var result;
    switch(action) {
      case 'summary':
        result = getSummaryCache();
        break;
      case 'trips':
        result = getTripsCache(e.parameter.start, e.parameter.end, e.parameter.route);
        break;
      case 'compare':
        result = getCompareData(e.parameter.startA, e.parameter.endA, e.parameter.startB, e.parameter.endB);
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

function getTripsCache(start, end, route) {
  var jsonStr = readLargeJsonFromSheet(SHEET_TRIPS_CACHE);
  if (!jsonStr) return { error: 'TRIPS_CACHE not found or empty. Run dailyBatchJob first.' };

  var trips;
  try {
    trips = JSON.parse(jsonStr);
  } catch(e) {
    return { error: 'Failed to parse TRIPS_CACHE: ' + e.message };
  }

  // Filter by date range and route
  if (start || end || route) {
    trips = trips.filter(function(t) {
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (route && t.route !== route) return false;
      return true;
    });
  }

  // Pagination metadata
  return {
    trips: trips,
    total: trips.length,
    start: start,
    end: end,
    route: route
  };
}

function getCompareData(startA, endA, startB, endB) {
  try {
    // Get trips in range A and B, calculate comparison stats
    var tripsA = getTripsCache(startA, endA, null).trips || [];
    var tripsB = getTripsCache(startB, endB, null).trips || [];

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
  if (!sheet) {
    return {
      source: 'PTTOR',
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
    source: 'PTTOR',
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
    'writeLargeJsonToSheet', 'readLargeJsonFromSheet'
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

  // 2. Test include() function with HTML files
  var htmlFiles = ['Index', 'Styles', 'App'];
  for (var i = 0; i < htmlFiles.length; i++) {
    var file = htmlFiles[i];
    try {
      var content = include(file);
      if (!content || content.length === 0) {
        errors.push('HTML file empty or not found: ' + file + '.html');
      } else {
        Logger.log('HTML OK: ' + file + '.html (' + content.length + ' chars)');
        // Check if content contains template tags (indicates it was loaded)
        if (content.indexOf('<') === -1) {
          warnings.push('HTML file may not be valid: ' + file + '.html');
        }
      }
    } catch(e) {
      errors.push('Failed to load ' + file + '.html: ' + e.message);
    }
  }

  // 3. Test template processing
  try {
    var template = HtmlService.createTemplateFromFile('Index');
    if (!template) {
      errors.push('Cannot create template from Index.html');
    } else {
      Logger.log('Template creation OK');
    }
  } catch(e) {
    errors.push('Template processing failed: ' + e.message);
  }

  // 4. Test jsonOut function
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

  // 5. Verify sheet names exist
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

  // 6. Test cache functions (without running full batch)
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

  // Summary
  Logger.log('=== INTEGRITY TEST SUMMARY ===');
  Logger.log('Errors: ' + errors.length);
  Logger.log('Warnings: ' + warnings.length);

  if (errors.length > 0) {
    Logger.log('=== ERRORS ===');
    for (var i = 0; i < errors.length; i++) {
      Logger.log('❌ ' + errors[i]);
    }
  }

  if (warnings.length > 0) {
    Logger.log('=== WARNINGS ===');
    for (var i = 0; i < warnings.length; i++) {
      Logger.log('⚠️ ' + warnings[i]);
    }
  }

  if (errors.length === 0) {
    Logger.log('=== SYSTEM READY FOR DEPLOYMENT ===');
    SpreadsheetApp.getActiveSpreadsheet().toast('✅ System integrity check passed', 'Ready to Deploy', 5);
  } else {
    Logger.log('=== FIX ERRORS BEFORE DEPLOYING ===');
    SpreadsheetApp.getActiveSpreadsheet().toast('❌ Found ' + errors.length + ' errors', 'Fix before Deploy', 10);
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
    SpreadsheetApp.getActiveSpreadsheet().toast('✅ Optimization test passed in ' + totalTime + 'ms', 'Regression Test', 5);
  } else {
    Logger.log('=== TEST FAILURES ===');
    for (var i = 0; i < errors.length; i++) {
      Logger.log('FAIL: ' + errors[i]);
    }
    SpreadsheetApp.getActiveSpreadsheet().toast('❌ Test failed: ' + errors.length + ' errors', 'Regression Test', 10);
  }

  return { passed: errors.length === 0, errors: errors, timeMs: totalTime };
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
          Logger.log('[' + sheetName + '] Date parse test: "' + firstDateStr + '" -> ' + (parsedDate ? parsedDate.toISOString() : 'FAILED'));
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
