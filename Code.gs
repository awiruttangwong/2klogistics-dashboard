/**
 * ============================================
 * Customer Data Cleaner & Mapper (Multi-Source Version)
 * Description: ดึงข้อมูลจากไฟล์ต้นทางมาวางตามชื่อชีท (M1-M12) และประมวลผลอัตโนมัติ
 * ============================================
 */

// -------------------------------------------------------------------------
// ลิ้งก์ต้นทางสำหรับแต่ละชีท 
// -------------------------------------------------------------------------
var SHEET_SOURCES = {
  'DATA(M1)': 'https://docs.google.com/spreadsheets/d/1sWGuoZaxyxfVhGsiA6NqG9noEK6nCvbpABVo792W5Sw/edit?gid=1824601668#gid=1824601668',
  'DATA(M2)': 'https://docs.google.com/spreadsheets/d/1l2ijjyLOvxIqixNTs0UWmV7U9Iu3rQmGGoy-Sazt3aQ/edit?gid=1824601668#gid=1824601668',
  'DATA(M3)': 'https://docs.google.com/spreadsheets/d/1ohmQjk77j2HFvW9em9l_cflt8jbePlFDpA25oAFOjsE/edit?gid=1824601668#gid=1824601668',
  'DATA(M4)': 'https://docs.google.com/spreadsheets/d/1RW7EQyzgYjPREZsxyBs3_EbZ8tKOHbBeSxPDxJ3G3yU/edit?gid=1824601668#gid=1824601668',
  'DATA(M5)': 'https://docs.google.com/spreadsheets/d/1wt8x2XsfvT-gSOmrI0HnNFcS27w-OuvzEYItGP3xn48/edit?gid=1824601668#gid=1824601668',
  'DATA(M6)': '',
  'DATA(M7)': '',
  'DATA(M8)': '',
  'DATA(M9)': '',
  'DATA(M10)': '',
  'DATA(M11)': '',
  'DATA(M12)': ''
};

// ชื่อชีทต้นทางในแต่ละไฟล์ (ถ้าไม่ระบุจะใช้ค่าเริ่มต้น SUMDATA)
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

var SELECT_COLS = [0, 1, 4, 7, 8, 9, 10, 12, 13, 17, 18, 19, 20];
// STEP 2: คอลัมน์ A,B,E,H,I,J,K ต้องมีข้อมูลทุกอัน (AND logic)
var NOT_NULL_COLS = [0, 1, 4, 7, 8, 9, 10];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('จัดการข้อมูล')
    .addItem('1. ดึงข้อมูลชีทปัจจุบัน', 'importFromSourceAndProcess')
    .addItem('2. Sync ทุกชีทที่มีลิ้งก์ (M1-M12)', 'importAllConfiguredSheets')
    .addSeparator()
    .addItem('3. ตั้ง Trigger อัตโนมัติ (08:00 ทุกวัน)', 'createDailyTrigger')
    .addItem('4. ลบ Trigger ทั้งหมด', 'removeAllTriggers')
    .addSeparator()
    .addItem('วิธีใช้งาน', 'showHelp')
    .addToUi();
}

function showHelp() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];
  lines.push('=== วิธีใช้งาน Customer Data Cleaner (Multi-Source) ===');
  lines.push('');
  lines.push('--- การใช้งานเบื้องต้น ---');
  lines.push('1. คลิกแท็บชีทที่ต้องการ (เช่น DATA(M1))');
  lines.push('2. คลิกเมนู "จัดการข้อมูล" > "1. ดึงข้อมูลชีทปัจจุบัน"');
  lines.push('3. ระบบจะดึงข้อมูลจากลิ้งก์ต้นทางตามชื่อชีทนั้นๆ');
  lines.push('4. หลังดึงเสร็จจะลบแถว 0/ว่าง + แมปชื่อขนส่งอัตโนมัติ');
  lines.push('');
  lines.push('--- Sync หลายชีทพร้อมกัน ---');
  lines.push('- "2. Sync ทุกชีทที่มีลิ้งก์ (M1-M12)" จะดึงข้อมูลทุกเดือนที่ใส่ลิ้งก์แล้วในครั้งเดียว');
  lines.push('- ชีทที่ยังไม่ได้ใส่ลิ้งก์จะถูกข้ามโดยอัตโนมัติ');
  lines.push('');
  lines.push('--- ตั้งค่าอัตโนมัติ (สำหรับเดือนที่ข้อมูลอัพเดททุกวัน) ---');
  lines.push('- "3. ตั้ง Trigger อัตโนมัติ" จะให้ระบบ Sync ทุกชีท เวลา 08:00 น. ทุกวัน');
  lines.push('- เหมาะสำหรับเดือนปัจจุบันที่ต้นทางมีข้อมูลอัพเดทรายวัน (เช่น M5 เป็นต้นไป)');
  lines.push('- "4. ลบ Trigger ทั้งหมด" ใช้เมื่อต้องการหยุดการ Sync อัตโนมัติ');
  lines.push('');
  lines.push('=== หมายเหตุ ===');
  lines.push('- ระบบไม่แตะต้องไฟล์ต้นทาง (Source Sheet)');
  lines.push('- แต่ละชีท DATA(M1)-DATA(M12) ดึงจากลิ้งก์ต้นทางของตัวเอง');
  lines.push('- ถ้ายังไม่ได้ใส่ลิ้งก์ ระบบจะข้ามไปโดยอัตโนมัติ (ไม่แจ้งเตือนในโหมด Sync ทุกชีท)');
  lines.push('- ถ้าพบ #REF! ในข้อมูลต้นทาง ระบบจะหยุดและแจ้งเตือน');
  lines.push('');
  lines.push('=== วิธีเพิ่มลิ้งก์ต้นทางเดือนใหม่ในอนาคต (Manual) ===');
  lines.push('1. เปิด Extensions > Apps Script');
  lines.push('2. หา SHEET_SOURCES → เพิ่ม URL ในบรรทัด \'DATA(M5)\': \'\'');
  lines.push('   ตัวอย่าง: \'DATA(M5)\': \'https://docs.google.com/spreadsheets/d/XXXXX/edit#gid=...\'');
  lines.push('3. หา SOURCE_SHEET_NAMES → ใส่ชื่อชีทต้นทาง (ถ้าไม่เหมือนเดือนอื่น)');
  lines.push('   ตัวอย่าง: \'DATA(M5)\': \'SUMDATA\'');
  lines.push('4. บันทึก (Ctrl+S) แล้วรีเฟรชหน้า Sheets');
  lines.push('');
  lines.push('ไม่ต้องแก้ logic, column, หรือฟังก์ชันอื่น — ระบบจะ auto-detect เอง');
  ui.alert(lines.join('\n'));
}

// ============================================
// CORE PROCESSING ENGINE
// ============================================

function processSheetData(sheet) {
  var startRow = 2;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  var report = {
    rowsRead: 0,
    rowsDeleted: 0,
    rowsMapped: 0,
    customers: {},
    errors: []
  };

  if (lastRow < startRow) {
    return report;
  }

  var numRows = lastRow - startRow + 1;
  var numCols = lastCol;
  var range = sheet.getRange(startRow, 1, numRows, numCols);
  var values = range.getDisplayValues();

  report.rowsRead = values.length;

  // Check for #REF! errors in first 5 rows
  var hasRefError = false;
  for (var r = 0; r < Math.min(values.length, 5); r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).indexOf('#REF!') !== -1) {
        hasRefError = true;
        break;
      }
    }
    if (hasRefError) break;
  }
  if (hasRefError) {
    throw new Error('พบ #REF! ในข้อมูล กรุณาตรวจสอบสูตร QUERY/IMPORTRANGE ให้ถูกต้อง');
  }

  var hasCheckColumns = (numCols >= 12);
  var rowsToDelete = [];

  // Get current column B values for batch update
  var colBRange = sheet.getRange(startRow, 2, numRows, 1);
  var colBValues = colBRange.getValues();

  for (var i = 0; i < values.length; i++) {
    var rowValues = values[i];
    var sheetRow = startRow + i;

    // STEP 3: ลบแถวเมื่อ R,S,T เป็น 0/ว่างทั้ง 3 อัน, หรือมีแค่ R แต่ S,T ว่าง
    if (hasCheckColumns) {
      var valR = rowValues[9];
      var valS = rowValues[10];
      var valT = rowValues[11];

      var rEmpty = isZeroOrBlank(valR);
      var sEmpty = isZeroOrBlank(valS);
      var tEmpty = isZeroOrBlank(valT);

      // ลบถ้าทั้ง 3 ว่าง, หรือมีแค่ R แต่ S และ T ว่าง (ข้อมูลไม่สมบูรณ์)
      // แต่เก็บถ้า R มีค่า + S ว่าง + T มีค่า (รถบริษัท)
      if ((rEmpty && sEmpty && tEmpty) || (!rEmpty && sEmpty && tEmpty)) {
        rowsToDelete.push(sheetRow);
        continue;
      }
    }

    // STEP 4: Map customer names in column B (index 1)
    if (numCols >= 2) {
      var original = rowValues[1];
      var mapped = getMappedName(original);

      if (mapped !== original) {
        colBValues[i][0] = mapped;
        report.rowsMapped++;
      }

      var countName = (mapped !== original) ? mapped : original;
      if (countName) {
        var trimmed = String(countName).trim();
        if (trimmed) {
          report.customers[trimmed] = (report.customers[trimmed] || 0) + 1;
        }
      }
    }
  }

  // Apply batch updates to column B before deleting rows
  if (report.rowsMapped > 0) {
    try {
      colBRange.setValues(colBValues);
    } catch (err) {
      report.errors.push('ไม่สามารถอัปเดตชื่อขนส่ง: ' + err.message);
    }
  }

  // Delete rows from bottom to top using batch delete for consecutive rows
  if (rowsToDelete.length > 0) {
    rowsToDelete.sort(function(a, b) { return b - a; });
    var deleteGroups = groupConsecutiveRows(rowsToDelete);

    for (var k = 0; k < deleteGroups.length; k++) {
      var group = deleteGroups[k];
      var rowStart = group[group.length - 1];
      var count = group.length;
      try {
        sheet.deleteRows(rowStart, count);
        report.rowsDeleted += count;
      } catch (err) {
        report.errors.push('ไม่สามารถลบแถว ' + rowStart + ' จำนวน ' + count + ' แถว: ' + err.message);
      }
    }
  }

  return report;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function groupConsecutiveRows(rows) {
  if (rows.length === 0) return [];

  var groups = [];
  var currentGroup = [rows[0]];

  for (var i = 1; i < rows.length; i++) {
    if (rows[i] === rows[i - 1] - 1) {
      currentGroup.push(rows[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [rows[i]];
    }
  }
  groups.push(currentGroup);
  return groups;
}

function isZeroOrBlank(val) {
  if (val === null || val === undefined) return true;

  var str = String(val).trim();
  if (str === '') return true;

  var clean = str.replace(/[^0-9.\-]/g, '');
  if (clean === '' || clean === '.' || clean === '-') return true;

  var num = parseFloat(clean);
  return !isNaN(num) && num === 0;
}

function getMappedName(text) {
  if (!text) return text;

  var check = String(text).toUpperCase().trim();

  var rules = [
    { keyword: 'FLASH B/C', result: 'FLASH B/C' },
    { keyword: 'FLASH CPU', result: 'FLASH CPU' },
    { keyword: 'FLASH NE', result: 'FLASH NE' },
    { keyword: 'FLASH N', result: 'FLASH N' },
    { keyword: 'FLASH S', result: 'FLASH S' },
    { keyword: 'BEST EXPRESS', result: 'BEST Express' },
    { keyword: 'BEST', result: 'BEST Express' },
    { keyword: 'KEX KERRY', result: 'KEX' },
    { keyword: 'KERRY', result: 'KEX' },
    { keyword: 'KEX', result: 'KEX' },
    { keyword: 'SPX-FSOC', result: 'SPX-FSOC' },
    { keyword: 'SPX', result: 'SPX-FSOC' },
    { keyword: 'J&T', result: 'J&T' },
    { keyword: 'SGT', result: 'SGT' }
  ];

  for (var i = 0; i < rules.length; i++) {
    if (check.indexOf(rules[i].keyword) !== -1) {
      return rules[i].result;
    }
  }

  return text;
}

// ============================================
// REPORTING FUNCTIONS
// ============================================

function showFullReport(ui, fullReport) {
  var lines = [];
  lines.push('=== รายงานการประมวลผล ===');
  lines.push('');

  lines.push('=== สรุปผลรวม ===');
  lines.push('แถวที่อ่าน: ' + fullReport.totalRead + ' แถว');
  lines.push('ลบแถวที่ค่าเป็น 0/ว่าง: ' + fullReport.totalDeleted + ' แถว');
  lines.push('แปลงชื่อขนส่ง: ' + fullReport.totalMapped + ' แถว');
  lines.push('');

  var names = Object.keys(fullReport.customers).sort();
  if (names.length > 0) {
    lines.push('=== รายชื่อขนส่งที่พบ (' + names.length + ' ราย) ===');
    for (var i = 0; i < names.length; i++) {
      lines.push('- ' + names[i] + ': ' + fullReport.customers[names[i]] + ' แถว');
    }
  } else {
    lines.push('=== ไม่พบรายชื่อขนส่ง ===');
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
// DIRECT SOURCE IMPORT FUNCTIONS
// ============================================

function importFromSourceAndProcess() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  if (!sheet) {
    ui.alert('ไม่พบชีทที่ใช้งาน');
    return;
  }

  var sheetName = sheet.getName();

  if (!SHEET_SOURCES.hasOwnProperty(sheetName)) {
    ui.alert('ผิดพลาด: ไม่รองรับการทำงานในหน้าชีท "' + sheetName + '"\nกรุณาใช้งานในชีท DATA(M1) ถึง DATA(M12) เท่านั้น');
    return;
  }

  var sourceUrl = SHEET_SOURCES[sheetName];
  var sourceSheetName = SOURCE_SHEET_NAMES[sheetName] || 'SUMDATA';

  if (!sourceUrl || sourceUrl.trim() === '' || sourceUrl.indexOf('http') === -1) {
    ui.alert('ยังไม่ได้ใส่ลิ้งก์ไฟล์ต้นทางสำหรับเดือนนี้!\n\nกรุณาไปที่ Extensions > Apps Script แล้วนำลิ้งก์มาใส่ตรงบรรทัด \'' + sheetName + '\' ก่อนครับ');
    return;
  }

  try {
    ss.toast('กำลังดึงข้อมูลสำหรับ ' + sheetName + '...', 'กำลังทำงาน', 5);
    var data = fetchSourceData(sourceUrl, sourceSheetName);

    if (data.length === 0) {
      ui.alert('ไม่พบข้อมูลในไฟล์ต้นทาง หรือข้อมูลไม่ผ่านเงื่อนไข');
      return;
    }

    ss.toast('เขียนข้อมูลลงชีท...', 'กำลังทำงาน', 5);
    writeDataToSheet(sheet, data);

    ss.toast('ดึงข้อมูลเสร็จ กำลังประมวลผล...', 'กำลังทำงาน', 5);
    var report = processSheetData(sheet);

    var fullReport = {
      totalRead: report.rowsRead,
      totalDeleted: report.rowsDeleted,
      totalMapped: report.rowsMapped,
      customers: report.customers,
      errors: report.errors
    };

    ss.toast('ประมวลผลเสร็จสิ้น', 'เสร็จสมบูรณ์', 5);
    showFullReport(ui, fullReport);
  } catch (e) {
    ui.alert('เกิดข้อผิดพลาด: ' + e.message);
  }
}

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

// ============================================
// BATCH & AUTOMATION FUNCTIONS (Future-Proof)
// ============================================

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

function createDailyTrigger() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importAllConfiguredSheets') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  ScriptApp.newTrigger('importAllConfiguredSheets')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  ui.alert('ตั้งค่าสำเร็จ!\n\n- ลบ Trigger เก่า: ' + removed + ' รายการ\n- สร้าง Trigger ใหม่: Sync ทุกชีทอัตโนมัติ เวลา 08:00 น. ทุกวัน\n\nหมายเหตุ: ต้องบันทึกโปรเจกต์ (Save project) และรอประมาณ 1 นาทีก่อน Trigger จะทำงานครั้งแรก');
}

function removeAllTriggers() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ui.alert('ลบ Trigger ทั้งหมดแล้ว (' + triggers.length + ' รายการ)');
}
