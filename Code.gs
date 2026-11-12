// ============================================================
// Code.gs — Google Apps Script Backend
// RAKPAA & PUREHIVE Sales Dashboard
// Deploy as Web App: Execute as "Me", Access "Anyone"
// ============================================================

const SHEET_NAMES = {
  RAW:     'Raw_FlowAccount',
  MASTER:  'Master_Sales',
  MAPPING: 'Channel_Mapping',
  CONFIG:  'Config'
};

const MASTER_COLS = [
  'row_key', 'doc_no', 'date', 'customer', 'product_code', 'product_name',
  'category', 'qty', 'unit', 'unit_price', 'discount_amount',
  'amount_before_discount', 'net_amount', 'status',
  'is_cancelled', 'is_refunded', 'warehouse', 'channel',
  'upload_batch_id', 'uploaded_at'
];

// FlowAccount Thai column → internal field name
const FA_COL_MAP = {
  'เลขที่เอกสาร': 'doc_no', 'เลขที่': 'doc_no', 'เลขที่ใบสั่งขาย': 'doc_no',
  'วันที่เอกสาร': 'date', 'วันที่': 'date',
  'ชื่อลูกค้า': 'customer', 'ลูกค้า': 'customer', 'ชื่อผู้ซื้อ': 'customer',
  'รหัสสินค้า': 'product_code', 'รหัส': 'product_code',
  'ชื่อสินค้า': 'product_name', 'สินค้า': 'product_name', 'รายการ': 'product_name',
  'หมวดหมู่สินค้า': 'category', 'หมวดหมู่': 'category', 'ประเภทสินค้า': 'category',
  'จำนวน': 'qty', 'ปริมาณ': 'qty',
  'หน่วย': 'unit',
  'ราคาต่อหน่วย': 'unit_price', 'ราคา': 'unit_price',
  'ส่วนลด': 'discount_amount', 'ส่วนลด (บาท)': 'discount_amount',
  'มูลค่าก่อนภาษี': 'amount_before_discount', 'มูลค่าก่อนส่วนลด': 'amount_before_discount',
  'ยอดรวมก่อนหักส่วนลด': 'amount_before_discount',
  'มูลค่ารวม': 'net_amount', 'ยอดสุทธิ': 'net_amount', 'ยอดรวมสุทธิ': 'net_amount',
  'ราคารวม': 'net_amount',
  'สถานะ': 'status', 'สถานะเอกสาร': 'status',
  'คลังสินค้า': 'warehouse', 'คลัง': 'warehouse',
  'หมายเหตุ': 'remark'
};

const STATUS_CANCELLED = ['ยกเลิก', 'cancelled', 'cancel', 'void', 'voided'];
const STATUS_REFUNDED  = ['คืนเงินแล้ว', 'refunded', 'refund', 'คืนสินค้า', 'ใบลดหนี้'];

// ─── HTTP Entry Points ────────────────────────────────────────

function doGet(e) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };
  let result;
  try {
    const action = (e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData')    result = getMasterData();
    else if (action === 'getMapping') result = getChannelMapping();
    else result = { error: 'Unknown action: ' + action };
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action === 'upload')        result = processUpload(payload);
    else if (payload.action === 'updateMapping') result = updateChannelMapping(payload.mapping);
    else result = { error: 'Unknown action: ' + payload.action };
  } catch (err) {
    result = { error: err.message, stack: err.stack };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Upload & Processing ──────────────────────────────────────

function processUpload(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsExist(ss);

  // Save original file to Drive folder "Sales_Reports_Raw"
  const fileName  = payload.fileName || ('upload_' + new Date().toISOString() + '.xlsx');
  const blob      = Utilities.newBlob(
    Utilities.base64Decode(payload.fileData),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName
  );

  let folder;
  try { folder = DriveApp.getFoldersByName('Sales_Reports_Raw').next(); }
  catch (_) { folder = DriveApp.createFolder('Sales_Reports_Raw'); }
  const driveFile = folder.createFile(blob);

  // Convert xlsx → Google Sheet to read data
  const tempFile = Drive.Files.copy(
    { mimeType: 'application/vnd.google-apps.spreadsheet', name: 'tmp_' + fileName },
    driveFile.getId()
  );
  const tempSs   = SpreadsheetApp.openById(tempFile.id);
  const rawRows  = readLargestSheet(tempSs);
  DriveApp.getFileById(tempFile.id).setTrashed(true); // clean up temp

  if (!rawRows || rawRows.length < 2) {
    return { error: 'ไฟล์ไม่มีข้อมูล หรือโครงสร้างไม่ถูกต้อง กรุณาตรวจสอบไฟล์' };
  }

  const batchId  = Utilities.getUuid();
  const processed = processFlowAccountData(rawRows, batchId);
  if (processed.error) return processed;

  const updateResult = updateMasterData(ss, processed.rows);
  updateConfig(ss, batchId, fileName, processed.rows.length);

  return {
    success:      true,
    batchId:      batchId,
    rowsProcessed: processed.rows.length,
    newRows:      updateResult.newRows,
    duplicates:   updateResult.duplicates,
    driveFileId:  driveFile.getId()
  };
}

function readLargestSheet(ss) {
  const sheets = ss.getSheets();
  let best = sheets[0];
  sheets.forEach(s => { if (s.getLastRow() > best.getLastRow()) best = s; });
  const lr = best.getLastRow(), lc = best.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  return best.getRange(1, 1, lr, lc).getValues();
}

function processFlowAccountData(rawRows, batchId) {
  const headers    = rawRows[0].map(h => String(h).trim());
  const colIdx     = {};

  // Map headers → internal names (exact + partial)
  headers.forEach((h, i) => {
    const direct = FA_COL_MAP[h];
    if (direct) { colIdx[direct] = i; return; }
    for (const [thai, name] of Object.entries(FA_COL_MAP)) {
      if (h.includes(thai) && colIdx[name] === undefined) colIdx[name] = i;
    }
  });

  if (colIdx['doc_no'] === undefined && colIdx['net_amount'] === undefined) {
    return { error: `ไม่พบคอลัมน์ที่จำเป็น\nพบคอลัมน์: ${headers.slice(0,10).join(', ')}` };
  }

  const mapping = getChannelMappingDict();
  const rows    = [];

  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r.some(c => c !== '' && c !== null && c !== undefined)) continue;

    const get = f => colIdx[f] !== undefined ? r[colIdx[f]] : '';

    const docNo = String(get('doc_no') || '').trim();
    if (!docNo) continue;

    const dateStr        = parseFlowDate(get('date'));
    const customer       = String(get('customer') || '').trim();
    const productCode    = String(get('product_code') || '').trim();
    const productName    = String(get('product_name') || productCode).trim();
    const category       = String(get('category') || '').trim();
    const qty            = parseNum(get('qty'));
    const unit           = String(get('unit') || '').trim();
    const unitPrice      = parseNum(get('unit_price'));
    const discountAmt    = parseNum(get('discount_amount'));
    let   amtBefore      = parseNum(get('amount_before_discount'));
    let   netAmount      = parseNum(get('net_amount'));
    const statusRaw      = String(get('status') || '').trim();
    const warehouse      = String(get('warehouse') || '').trim();

    const statusLower  = statusRaw.toLowerCase();
    const isCancelled  = STATUS_CANCELLED.some(s => statusLower.includes(s.toLowerCase()));
    const isRefunded   = STATUS_REFUNDED.some(s => statusLower.includes(s.toLowerCase()));

    // Refunded items → negative net amount
    if (isRefunded && netAmount > 0) netAmount = -netAmount;

    // Fallback: compute amount_before_discount
    if (!amtBefore && qty && unitPrice) amtBefore = qty * unitPrice;

    const channel = mapping[customer] || mapping[customer.toLowerCase()] || 'Unmapped';
    const rowKey  = `${docNo}__${productCode || i}__${dateStr}`;

    rows.push({
      row_key: rowKey, doc_no: docNo, date: dateStr, customer,
      product_code: productCode, product_name: productName, category,
      qty, unit, unit_price: unitPrice, discount_amount: discountAmt,
      amount_before_discount: amtBefore, net_amount: netAmount,
      status: statusRaw, is_cancelled: isCancelled, is_refunded: isRefunded,
      warehouse, channel, upload_batch_id: batchId,
      uploaded_at: new Date().toISOString()
    });
  }

  return { rows };
}

function parseFlowDate(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  // dd/mm/yyyy or dd-mm-yyyy (Thai BE or CE)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = '25' + y; // e.g. 67 → 2567
    const yr = parseInt(y) > 2500 ? parseInt(y) - 543 : parseInt(y);
    return `${yr}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return s;
}

function parseNum(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v || '0').replace(/,/g, '').replace(/[^\d.\-]/g, '')) || 0;
}

// ─── Master Data ──────────────────────────────────────────────

function updateMasterData(ss, newRows) {
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  const existing = new Set();
  const lr = sheet.getLastRow();
  if (lr > 1) {
    sheet.getRange(2, 1, lr - 1, 1).getValues().forEach(r => existing.add(r[0]));
  }

  let newCount = 0, dupCount = 0;
  const toAppend = [];
  for (const row of newRows) {
    if (existing.has(row.row_key)) { dupCount++; continue; }
    toAppend.push(MASTER_COLS.map(col => {
      const v = row[col];
      if (v === true) return 'TRUE';
      if (v === false) return 'FALSE';
      return v !== undefined ? v : '';
    }));
    existing.add(row.row_key);
    newCount++;
  }

  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, MASTER_COLS.length)
      .setValues(toAppend);
  }
  return { newRows: newCount, duplicates: dupCount };
}

function getMasterData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsExist(ss);
  const sheet = ss.getSheetByName(SHEET_NAMES.MASTER);
  const lr    = sheet.getLastRow();

  if (lr < 2) {
    return { rows: [], columns: MASTER_COLS, mapping: getChannelMappingDict(), lastUpdated: getLastUpdated(ss) };
  }

  const data    = sheet.getRange(1, 1, lr, MASTER_COLS.length).getValues();
  const headers = data[0];
  const rows    = data.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i]; });
    return obj;
  });

  return { rows, columns: MASTER_COLS, mapping: getChannelMappingDict(), lastUpdated: getLastUpdated(ss) };
}

// ─── Channel Mapping ──────────────────────────────────────────

function getChannelMapping() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsExist(ss);
  const sheet = ss.getSheetByName(SHEET_NAMES.MAPPING);
  const lr    = sheet.getLastRow();
  if (lr < 2) return { mapping: [] };
  const data  = sheet.getRange(2, 1, lr - 1, 2).getValues();
  return { mapping: data.map(r => ({ customer: r[0], channel: r[1] })) };
}

function getChannelMappingDict() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.MAPPING);
  if (!sheet) return {};
  const lr = sheet.getLastRow();
  if (lr < 2) return {};
  const dict = {};
  sheet.getRange(2, 1, lr - 1, 2).getValues()
    .forEach(r => { if (r[0]) dict[String(r[0]).trim()] = String(r[1]).trim(); });
  return dict;
}

function updateChannelMapping(mapping) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsExist(ss);
  const sheet = ss.getSheetByName(SHEET_NAMES.MAPPING);

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).clearContent();
  }
  if (mapping && mapping.length > 0) {
    sheet.getRange(2, 1, mapping.length, 2)
      .setValues(mapping.map(m => [m.customer, m.channel]));
  }

  reapplyChannelMapping(ss);
  return { success: true };
}

function reapplyChannelMapping(ss) {
  const mapping = getChannelMappingDict();
  const sheet   = ss.getSheetByName(SHEET_NAMES.MASTER);
  const lr      = sheet.getLastRow();
  if (lr < 2) return;

  const custCol = MASTER_COLS.indexOf('customer') + 1;
  const chanCol = MASTER_COLS.indexOf('channel') + 1;
  const customers = sheet.getRange(2, custCol, lr - 1, 1).getValues();
  const updated   = customers.map(r => [mapping[String(r[0]).trim()] || 'Unmapped']);
  sheet.getRange(2, chanCol, lr - 1, 1).setValues(updated);
}

// ─── Helpers ──────────────────────────────────────────────────

function ensureSheetsExist(ss) {
  const defs = [
    { name: SHEET_NAMES.RAW,     headers: ['batch_id','filename','uploaded_at','rows_count'] },
    { name: SHEET_NAMES.MASTER,  headers: MASTER_COLS },
    { name: SHEET_NAMES.MAPPING, headers: ['customer_name','channel'] },
    { name: SHEET_NAMES.CONFIG,  headers: ['key','value'] }
  ];
  defs.forEach(({ name, headers }) => {
    if (!ss.getSheetByName(name)) {
      const s = ss.insertSheet(name);
      s.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#E8F0FE');
      s.setFrozenRows(1);
    }
  });
}

function updateConfig(ss, batchId, fileName, rowCount) {
  ss.getSheetByName(SHEET_NAMES.RAW)
    .appendRow([batchId, fileName, new Date().toISOString(), rowCount]);

  const cfg   = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const data  = cfg.getDataRange().getValues();
  const idx   = data.findIndex(r => r[0] === 'last_updated');
  const now   = new Date().toISOString();
  if (idx > 0) cfg.getRange(idx + 1, 2).setValue(now);
  else cfg.appendRow(['last_updated', now]);
}

function getLastUpdated(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) return null;
  const row = sheet.getDataRange().getValues().find(r => r[0] === 'last_updated');
  return row ? row[1] : null;
}
