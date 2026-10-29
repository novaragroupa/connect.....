/**
 * CONNECT — نظام إدارة محل موبايلات وإكسسوارات
 * الباك اند: Google Apps Script فوق Google Sheets
 *
 * طريقة التركيب:
 * 1) افتح Google Sheet جديد فاضي.
 * 2) من القائمة: Extensions > Apps Script.
 * 3) امسح أي كود موجود، والصق هذا الملف كامل.
 * 4) نفّذ (Run) الدالة setupSheets() مرة واحدة فقط (هتطلب صلاحيات، وافق عليها).
 *    هي هتنشئ كل الشيتات المطلوبة + مستخدم مدير افتراضي.
 * 5) من Deploy > New deployment > اختر Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6) انسخ الرابط (Web app URL) وحطه في ملف web/config.js عندك في الموقع.
 *
 * أول يوزر بعد setupSheets():
 *   Username: admin
 *   Password: admin123
 * (غيّره فورًا من داخل النظام)
 */

// لو السكريبت "غير مربوط" بشيت (يعني عملته من script.google.com مباشرة ومش من
// جوه الشيت عن طريق Extensions > Apps Script)، لازم تحط رقم الشيت هنا.
// الرقم موجود في رابط الشيت نفسه بين /d/ و /edit، مثال:
// https://docs.google.com/spreadsheets/d/‎هذا_هو_الرقم‎/edit
const SPREADSHEET_ID = '1-MSLdTIkjpDS-v0QPDsTY4ymlkdNFH6WKjN4UvrD1yo';

function getSpreadsheet_() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PASTE_') !== 0) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error('محتاج تحط SPREADSHEET_ID في أول الكود، أو تفتح هذا السكريبت من جوه الشيت نفسه عن طريق Extensions > Apps Script');
}

const SHEETS = {
  USERS: 'Users',
  MAINTENANCE: 'Maintenance',
  ACC_CATEGORIES: 'AccessoryCategories',
  ACC_ITEMS: 'AccessoryItems',
  ACC_SALES: 'AccessorySales',
  DEVICES: 'Devices',
  DEVICE_SALES: 'DeviceSales',
  CASH: 'CashTransfers'
};

const SCHEMAS = {
  Users: ['id', 'username', 'password', 'role', 'name', 'createdAt'],
  Maintenance: ['id', 'date', 'deviceCategory', 'caseType', 'deviceType', 'faultType',
    'customerName', 'customerPhone', 'wholesaleCost', 'profitCost', 'total', 'notes', 'employee'],
  AccessoryCategories: ['id', 'name', 'createdAt'],
  AccessoryItems: ['id', 'code', 'categoryId', 'categoryName', 'name', 'wholesalePrice',
    'profitPrice', 'totalPrice', 'quantity', 'dateAdded'],
  AccessorySales: ['id', 'code', 'itemId', 'itemName', 'categoryName', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date'],
  Devices: ['id', 'code', 'deviceType', 'condition', 'name', 'wholesalePrice', 'profitPrice', 'totalPrice',
    'warranty', 'quantity', 'dateAdded'],
  DeviceSales: ['id', 'code', 'deviceId', 'deviceName', 'deviceType', 'condition', 'warranty', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date'],
  CashTransfers: ['id', 'type', 'customerName', 'customerPhone', 'amount', 'notes', 'employee', 'date']
};

function setupSheets() {
  const ss = getSpreadsheet_();
  Object.keys(SCHEMAS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ensureHeaders_(sh, SCHEMAS[name]); // بيضيف أي عمود جديد ناقص حتى لو الشيت فيه بيانات بالفعل
  });
  // امسح شيت "Sheet1" الافتراضي لو موجود وفاضي
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);

  // أضف مستخدم مدير افتراضي لو مفيش يوزرز
  const usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow([Utilities.getUuid(), 'admin', 'admin123', 'مدير النظام', 'المدير العام', new Date()]);
  }
}

/* ============ أدوات عامة ============ */

function getSheet_(name) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('الشيت غير موجود: ' + name);
  return sh;
}

function sheetToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1);
  return rows
    .map(function (row) {
      const obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    })
    .filter(function (obj) { return obj.id !== '' && obj.id !== undefined && obj.id !== null; });
}

function ensureHeaders_(sh, desiredHeaders) {
  const lastCol = sh.getLastColumn();
  let currentHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const isBlank = currentHeaders.length === 0 || (currentHeaders.length === 1 && currentHeaders[0] === '');
  if (isBlank) {
    sh.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    sh.setFrozenRows(1);
    return desiredHeaders.slice();
  }
  // لو فيه أعمدة جديدة في الكود مش موجودة في الشيت (زي كود المنتج أو الملاحظات)، ضيفها آخر الشيت تلقائي
  const missing = desiredHeaders.filter(function (h) { return currentHeaders.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    currentHeaders = currentHeaders.concat(missing);
  }
  return currentHeaders;
}

function appendObject_(sh, headers, obj) {
  const liveHeaders = ensureHeaders_(sh, headers);
  const row = liveHeaders.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sh.appendRow(row);
}

function findRowIndexById_(sh, id) {
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('id');
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) return r + 1; // 1-based row number
  }
  return -1;
}

function updateCellByHeader_(sh, rowNum, headers, header, value) {
  const liveHeaders = ensureHeaders_(sh, headers);
  const col = liveHeaders.indexOf(header) + 1;
  if (col > 0) sh.getRange(rowNum, col).setValue(value);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Africa/Cairo', 'yyyy-MM-dd HH:mm:ss');
}

// الواجهة (وهي أوفلاين) بتولّد id وتاريخ العملية من عندها. السيرفر بيستخدمهم،
// ولو نفس الـ id وصل تاني (مثلًا الإنترنت قطع بعد ما العملية اتسجلت) بيرجّع العملية القديمة من غير تكرار.
function clientId_(body) {
  const id = body && body.id ? String(body.id).trim() : '';
  return id || Utilities.getUuid();
}

function clientDate_(body) {
  const d = body && body.date ? String(body.date) : '';
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d) ? d : nowStr_();
}

function findObjById_(sh, id) {
  const all = sheetToObjects_(sh);
  for (let i = 0; i < all.length; i++) {
    if (String(all[i].id) === String(id)) return all[i];
  }
  return null;
}

/* ============ نقطة الدخول ============ */

function doGet(e) {
  return jsonOut_({ ok: true, message: 'CONNECT API شغال' });
}

// العمليات المسموح بيها جوه الرفع الجماعي (الطابور اللي اتسجل أوفلاين)
const BATCH_ALLOWED = {
  addMaintenance: 1, addAccessoryCategory: 1, addAccessoryItem: 1, sellAccessoryItem: 1,
  addDevice: 1, sellDevice: 1, addCashTransfer: 1, moveAccessoryCategory: 1,
  updateAccessoryItem: 1, updateDevice: 1
};

function doPost(e) {
  let lock = null;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // قفل: عشان لو جهازين رفعوا في نفس اللحظة العمليات متتداخلش وتبوّظ المخزون
    if (action === 'batch' || /^(add|sell|update|move)/.test(String(action))) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }

    const result = action === 'batch' ? runBatch_(body) : dispatch_(action, body);
    if (result && result.error) return jsonOut_({ ok: false, error: result.error });
    return jsonOut_(Object.assign({ ok: true }, result));
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) { /* تجاهل */ } }
  }
}

function dispatch_(action, body) {
  switch (action) {
    case 'ping': return { pong: true };

    case 'login': return login_(body);
    case 'addUser': return addUser_(body);
    case 'listUsers': return { items: sheetToObjects_(getSheet_(SHEETS.USERS)).map(stripPassword_) };

    case 'addMaintenance': return addMaintenance_(body);
    case 'listMaintenance': return { items: sheetToObjects_(getSheet_(SHEETS.MAINTENANCE)) };

    case 'addAccessoryCategory': return addAccessoryCategory_(body);
    case 'listAccessoryCategories': return { items: sheetToObjects_(getSheet_(SHEETS.ACC_CATEGORIES)) };

    case 'addAccessoryItem': return addAccessoryItem_(body);
    case 'listAccessoryItems': return { items: sheetToObjects_(getSheet_(SHEETS.ACC_ITEMS)) };
    case 'sellAccessoryItem': return sellAccessoryItem_(body);
    case 'listAccessorySales': return { items: sheetToObjects_(getSheet_(SHEETS.ACC_SALES)) };

    case 'addDevice': return addDevice_(body);
    case 'listDevices': return { items: sheetToObjects_(getSheet_(SHEETS.DEVICES)) };
    case 'sellDevice': return sellDevice_(body);
    case 'listDeviceSales': return { items: sheetToObjects_(getSheet_(SHEETS.DEVICE_SALES)) };

    case 'addCashTransfer': return addCashTransfer_(body);
    case 'listCashTransfers': return { items: sheetToObjects_(getSheet_(SHEETS.CASH)) };

    case 'accountingSummary': return accountingSummary_();

    case 'findProductByCode': return findProductByCode_(body);
    case 'sellByCode': return sellByCode_(body);

    case 'moveAccessoryCategory': return moveAccessoryCategory_(body);
    case 'updateAccessoryItem': return updateAccessoryItem_(body);
    case 'updateDevice': return updateDevice_(body);

    default: return { error: 'إجراء غير معروف: ' + action };
  }
}

// رفع مجموعة عمليات بالترتيب في طلب واحد. كل عملية ليها نتيجتها (نجحت/فشلت) وفشل واحدة مبيوقفش الباقي.
function runBatch_(body) {
  const ops = body.ops || [];
  const results = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] || {};
    try {
      if (!BATCH_ALLOWED[op.action]) {
        results.push({ ok: false, error: 'عملية غير مسموحة في الرفع الجماعي: ' + op.action });
        continue;
      }
      const r = dispatch_(op.action, Object.assign({}, op.payload || {}, { action: op.action }));
      if (r && r.error) results.push({ ok: false, error: r.error });
      else results.push(Object.assign({ ok: true }, r));
    } catch (err) {
      results.push({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  }
  return { results: results };
}

function stripPassword_(u) {
  const copy = Object.assign({}, u);
  delete copy.password;
  return copy;
}

/* ============ المستخدمين ============ */

function login_(body) {
  const users = sheetToObjects_(getSheet_(SHEETS.USERS));
  const found = users.find(function (u) {
    return String(u.username) === String(body.username) && String(u.password) === String(body.password);
  });
  if (!found) return { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  return { user: stripPassword_(found) };
}

function addUser_(body) {
  const sh = getSheet_(SHEETS.USERS);
  const users = sheetToObjects_(sh);
  if (users.some(function (u) { return u.username === body.username; })) {
    return { error: 'اسم المستخدم موجود بالفعل' };
  }
  const obj = {
    id: Utilities.getUuid(),
    username: body.username,
    password: body.password,
    role: body.role, // 'مدير النظام' أو 'حسابات'
    name: body.name,
    createdAt: nowStr_()
  };
  appendObject_(sh, SCHEMAS.Users, obj);
  return { user: stripPassword_(obj) };
}

/* ============ الصيانة ============ */

function addMaintenance_(body) {
  const sh = getSheet_(SHEETS.MAINTENANCE);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const wholesale = Number(body.wholesaleCost) || 0;
  const profit = Number(body.profitCost) || 0;
  const obj = {
    id: clientId_(body),
    date: clientDate_(body),
    deviceCategory: body.deviceCategory, // هاردوير / سوفتوير
    caseType: body.caseType, // كشف اعطال / عطل معروف
    deviceType: body.deviceType || '',
    faultType: body.faultType || '',
    customerName: body.customerName || '',
    customerPhone: body.customerPhone || '',
    wholesaleCost: wholesale,
    profitCost: profit,
    total: wholesale + profit,
    notes: body.notes || '',
    employee: body.employee || ''
  };
  appendObject_(sh, SCHEMAS.Maintenance, obj);
  invalidateAccountingCache_();
  return { item: obj };
}

/* ============ الإكسسوارات ============ */

function addAccessoryCategory_(body) {
  const sh = getSheet_(SHEETS.ACC_CATEGORIES);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const obj = { id: clientId_(body), name: body.name, createdAt: clientDate_(body) };
  appendObject_(sh, SCHEMAS.AccessoryCategories, obj);
  return { item: obj };
}

// نقل نوع بين إكسسوارات الموبايل والكمبيوتر: بنغيّر اسم النوع (علامة [كمبيوتر] في أوله)
// وبنحدّث categoryName في كل أصناف النوع. الأصناف نفسها مربوطة بالـ id فمش بتتأثر.
function moveAccessoryCategory_(body) {
  const newName = String(body.name || '').trim();
  if (!body.id || !newName) throw new Error('بيانات النقل ناقصة');

  const catSh = getSheet_(SHEETS.ACC_CATEGORIES);
  const rowNum = findRowIndexById_(catSh, body.id);
  if (rowNum === -1) throw new Error('النوع غير موجود');

  const dup = sheetToObjects_(catSh).some(function (c) {
    return String(c.id) !== String(body.id) && String(c.name) === newName;
  });
  if (dup) throw new Error('فيه نوع بنفس الاسم في القسم التاني');

  updateCellByHeader_(catSh, rowNum, SCHEMAS.AccessoryCategories, 'name', newName);

  // تحديث اسم النوع المخزّن جنب كل صنف (دفعة واحدة بدل خلية خلية)
  const itemSh = getSheet_(SHEETS.ACC_ITEMS);
  const values = itemSh.getDataRange().getValues();
  if (values.length > 1) {
    const headers = values[0];
    const catIdCol = headers.indexOf('categoryId');
    const catNameCol = headers.indexOf('categoryName');
    if (catIdCol > -1 && catNameCol > -1) {
      let changed = false;
      for (let r = 1; r < values.length; r++) {
        if (String(values[r][catIdCol]) === String(body.id)) {
          values[r][catNameCol] = newName;
          changed = true;
        }
      }
      if (changed) {
        const col = values.slice(1).map(function (row) { return [row[catNameCol]]; });
        itemSh.getRange(2, catNameCol + 1, col.length, 1).setValues(col);
      }
    }
  }
  return { item: { id: body.id, name: newName } };
}

function genCode_() {
  // كود عددي فريد من 6 أرقام لو الموظف مكتبش كود يدوي أو من الماسح
  return String(Math.floor(100000 + Math.random() * 900000));
}

function codeExists_(code) {
  const accItems = sheetToObjects_(getSheet_(SHEETS.ACC_ITEMS));
  const devices = sheetToObjects_(getSheet_(SHEETS.DEVICES));
  return accItems.some(function (i) { return String(i.code) === String(code); }) ||
    devices.some(function (d) { return String(d.code) === String(code); });
}

function addAccessoryItem_(body) {
  const sh = getSheet_(SHEETS.ACC_ITEMS);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const wholesale = Number(body.wholesalePrice) || 0;
  const profit = Number(body.profitPrice) || 0;
  let code = (body.code || '').toString().trim();
  if (!code) { do { code = genCode_(); } while (codeExists_(code)); }
  else if (codeExists_(code)) {
    // لو الكود اتولّد تلقائي من الجهاز وطلع مكرر، نولّد غيره بدل ما نرفض العملية
    if (body.autoCode) { do { code = genCode_(); } while (codeExists_(code)); }
    else return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
  }
  const obj = {
    id: clientId_(body),
    code: code,
    categoryId: body.categoryId,
    categoryName: body.categoryName,
    name: body.name,
    wholesalePrice: wholesale,
    profitPrice: profit,
    totalPrice: wholesale + profit,
    quantity: Number(body.quantity) || 0,
    dateAdded: clientDate_(body)
  };
  appendObject_(sh, SCHEMAS.AccessoryItems, obj);
  return { item: obj };
}

function updateAccessoryItem_(body) {
  const sh = getSheet_(SHEETS.ACC_ITEMS);
  const rowNum = findRowIndexById_(sh, body.id);
  if (rowNum === -1) return { error: 'الصنف غير موجود' };
  const items = sheetToObjects_(sh);
  const item = items.find(function (i) { return String(i.id) === String(body.id); });

  let newCode = (body.code || '').toString().trim();
  if (newCode && newCode !== item.code) {
    if (codeExists_(newCode)) return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
    updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'code', newCode);
  }
  const name = body.name !== undefined && body.name !== '' ? body.name : item.name;
  const wholesale = body.wholesalePrice !== undefined ? Number(body.wholesalePrice) : Number(item.wholesalePrice);
  const profit = body.profitPrice !== undefined ? Number(body.profitPrice) : Number(item.profitPrice);
  const quantity = body.quantity !== undefined ? Number(body.quantity) : Number(item.quantity);

  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'name', name);
  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'wholesalePrice', wholesale);
  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'profitPrice', profit);
  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'totalPrice', wholesale + profit);
  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'quantity', quantity);

  return { item: Object.assign({}, item, { name: name, wholesalePrice: wholesale, profitPrice: profit, totalPrice: wholesale + profit, quantity: quantity, code: newCode || item.code }) };
}

function sellAccessoryItem_(body) {
  const sh = getSheet_(SHEETS.ACC_ITEMS);
  const salesSh = getSheet_(SHEETS.ACC_SALES);
  if (body.id) {
    // نفس عملية البيع وصلت قبل كده (مثلًا النت قطع قبل الرد): منخصمش المخزون تاني
    const dupSale = findObjById_(salesSh, body.id);
    if (dupSale) {
      const cur = findObjById_(sh, dupSale.itemId);
      return { sale: dupSale, remainingQuantity: cur ? Number(cur.quantity) : 0, duplicate: true };
    }
  }
  const rowNum = findRowIndexById_(sh, body.itemId);
  if (rowNum === -1) return { error: 'الصنف غير موجود' };
  const items = sheetToObjects_(sh);
  const item = items.find(function (i) { return String(i.id) === String(body.itemId); });
  const qty = Number(item.quantity) || 0;
  const sellQty = Math.max(1, Number(body.quantity) || 1);
  if (sellQty > qty) return { error: 'الكمية المطلوبة (' + sellQty + ') أكبر من المتاح بالمخزون (' + qty + ')' };

  updateCellByHeader_(sh, rowNum, SCHEMAS.AccessoryItems, 'quantity', qty - sellQty);

  const sale = {
    id: clientId_(body),
    code: item.code || '',
    itemId: item.id,
    itemName: item.name,
    categoryName: item.categoryName,
    customerName: body.customerName || '',
    customerPhone: body.customerPhone || '',
    quantity: sellQty,
    wholesalePrice: Number(item.wholesalePrice) * sellQty,
    profitPrice: Number(item.profitPrice) * sellQty,
    unitPrice: item.totalPrice,
    totalPrice: Number(item.totalPrice) * sellQty,
    notes: body.notes || '',
    employee: body.employee || '',
    date: clientDate_(body)
  };
  appendObject_(salesSh, SCHEMAS.AccessorySales, sale);
  invalidateAccountingCache_();
  return { sale: sale, remainingQuantity: qty - sellQty };
}

/* ============ الأجهزة ============ */

function addDevice_(body) {
  const sh = getSheet_(SHEETS.DEVICES);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const wholesale = Number(body.wholesalePrice) || 0;
  const profit = Number(body.profitPrice) || 0;
  let code = (body.code || '').toString().trim();
  if (!code) { do { code = genCode_(); } while (codeExists_(code)); }
  else if (codeExists_(code)) {
    // لو الكود اتولّد تلقائي من الجهاز وطلع مكرر، نولّد غيره بدل ما نرفض العملية
    if (body.autoCode) { do { code = genCode_(); } while (codeExists_(code)); }
    else return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
  }
  const obj = {
    id: clientId_(body),
    code: code,
    deviceType: body.deviceType || 'أخرى',
    condition: body.condition, // جديد / مستعمل
    name: body.name,
    wholesalePrice: wholesale,
    profitPrice: profit,
    totalPrice: wholesale + profit,
    warranty: body.warranty, // له ضمان / بدون ضمان
    quantity: Number(body.quantity) || 0,
    dateAdded: clientDate_(body)
  };
  appendObject_(sh, SCHEMAS.Devices, obj);
  return { item: obj };
}

function updateDevice_(body) {
  const sh = getSheet_(SHEETS.DEVICES);
  const rowNum = findRowIndexById_(sh, body.id);
  if (rowNum === -1) return { error: 'الجهاز غير موجود' };
  const items = sheetToObjects_(sh);
  const dev = items.find(function (i) { return String(i.id) === String(body.id); });

  let newCode = (body.code || '').toString().trim();
  if (newCode && newCode !== dev.code) {
    if (codeExists_(newCode)) return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
    updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'code', newCode);
  }
  const name = body.name !== undefined && body.name !== '' ? body.name : dev.name;
  const wholesale = body.wholesalePrice !== undefined ? Number(body.wholesalePrice) : Number(dev.wholesalePrice);
  const profit = body.profitPrice !== undefined ? Number(body.profitPrice) : Number(dev.profitPrice);
  const quantity = body.quantity !== undefined ? Number(body.quantity) : Number(dev.quantity);
  const warranty = body.warranty || dev.warranty;
  const deviceType = body.deviceType || dev.deviceType;

  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'name', name);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'wholesalePrice', wholesale);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'profitPrice', profit);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'totalPrice', wholesale + profit);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'quantity', quantity);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'warranty', warranty);
  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'deviceType', deviceType);

  return { item: Object.assign({}, dev, { name: name, wholesalePrice: wholesale, profitPrice: profit, totalPrice: wholesale + profit, quantity: quantity, warranty: warranty, deviceType: deviceType, code: newCode || dev.code }) };
}

function sellDevice_(body) {
  const sh = getSheet_(SHEETS.DEVICES);
  const salesSh = getSheet_(SHEETS.DEVICE_SALES);
  if (body.id) {
    const dupSale = findObjById_(salesSh, body.id);
    if (dupSale) {
      const cur = findObjById_(sh, dupSale.deviceId);
      return { sale: dupSale, remainingQuantity: cur ? Number(cur.quantity) : 0, duplicate: true };
    }
  }
  const rowNum = findRowIndexById_(sh, body.deviceId);
  if (rowNum === -1) return { error: 'الجهاز غير موجود' };
  const items = sheetToObjects_(sh);
  const dev = items.find(function (i) { return String(i.id) === String(body.deviceId); });
  const qty = Number(dev.quantity) || 0;
  const sellQty = Math.max(1, Number(body.quantity) || 1);
  if (sellQty > qty) return { error: 'الكمية المطلوبة (' + sellQty + ') أكبر من المتاح بالمخزون (' + qty + ')' };

  updateCellByHeader_(sh, rowNum, SCHEMAS.Devices, 'quantity', qty - sellQty);

  const sale = {
    id: clientId_(body),
    code: dev.code || '',
    deviceId: dev.id,
    deviceName: dev.name,
    deviceType: dev.deviceType || '',
    condition: dev.condition,
    warranty: dev.warranty,
    customerName: body.customerName || '',
    customerPhone: body.customerPhone || '',
    quantity: sellQty,
    wholesalePrice: Number(dev.wholesalePrice) * sellQty,
    profitPrice: Number(dev.profitPrice) * sellQty,
    unitPrice: dev.totalPrice,
    totalPrice: Number(dev.totalPrice) * sellQty,
    notes: body.notes || '',
    employee: body.employee || '',
    date: clientDate_(body)
  };
  appendObject_(salesSh, SCHEMAS.DeviceSales, sale);
  invalidateAccountingCache_();
  return { sale: sale, remainingQuantity: qty - sellQty };
}

/* ============ تحويلات الكاش ============ */

function addCashTransfer_(body) {
  const sh = getSheet_(SHEETS.CASH);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const obj = {
    id: clientId_(body),
    type: body.type, // سحب / ايداع
    customerName: body.customerName || '',
    customerPhone: body.customerPhone || '',
    amount: Number(body.amount) || 0,
    notes: body.notes || '',
    employee: body.employee || '',
    date: clientDate_(body)
  };
  appendObject_(sh, SCHEMAS.CashTransfers, obj);
  return { item: obj };
}

/* ============ البحث بالكود / البيع بالباركود ============ */

function findProductByCode_(body) {
  const code = String(body.code || '').trim();
  if (!code) return { error: 'محتاج تدخل كود أو تمسح باركود المنتج' };

  const accItems = sheetToObjects_(getSheet_(SHEETS.ACC_ITEMS));
  const accMatch = accItems.find(function (i) { return String(i.code) === code; });
  if (accMatch) return { found: true, type: 'accessory', item: accMatch };

  const devices = sheetToObjects_(getSheet_(SHEETS.DEVICES));
  const devMatch = devices.find(function (d) { return String(d.code) === code; });
  if (devMatch) return { found: true, type: 'device', item: devMatch };

  return { found: false };
}

function sellByCode_(body) {
  const code = String(body.code || '').trim();
  const lookup = findProductByCode_({ code: code });
  if (lookup.error) return lookup;
  if (!lookup.found) return { error: 'مفيش منتج بالكود ده في النظام' };

  if (lookup.type === 'accessory') {
    return sellAccessoryItem_({
      itemId: lookup.item.id, customerName: body.customerName,
      customerPhone: body.customerPhone, employee: body.employee, quantity: body.quantity, notes: body.notes
    });
  }
  return sellDevice_({
    deviceId: lookup.item.id, customerName: body.customerName,
    customerPhone: body.customerPhone, employee: body.employee, quantity: body.quantity, notes: body.notes
  });
}

/* ============ الحسابات ============ */

function accountingSummary_() {
  const scriptCache = CacheService.getScriptCache();
  const cacheKey = 'accountingSummary_v1';
  const cached = scriptCache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const maintenance = sheetToObjects_(getSheet_(SHEETS.MAINTENANCE));
  const accSales = sheetToObjects_(getSheet_(SHEETS.ACC_SALES));
  const devSales = sheetToObjects_(getSheet_(SHEETS.DEVICE_SALES));

  function toRecord(date, wholesale, profit, total, category) {
    return { date: String(date).substring(0, 10), wholesale: Number(wholesale) || 0,
      profit: Number(profit) || 0, total: Number(total) || 0, category: category };
  }

  const records = [];
  maintenance.forEach(function (m) {
    records.push(toRecord(m.date, m.wholesaleCost, m.profitCost, m.total, 'صيانة'));
  });
  accSales.forEach(function (s) {
    records.push(toRecord(s.date, s.wholesalePrice, s.profitPrice, s.totalPrice, 'اكسسوارات'));
  });
  devSales.forEach(function (s) {
    records.push(toRecord(s.date, s.wholesalePrice, s.profitPrice, s.totalPrice, 'اجهزة'));
  });

  const result = { records: records };
  try { scriptCache.put(cacheKey, JSON.stringify(result), 30); } catch (e) { /* البيانات كبيرة جدًا على الكاش، مش مشكلة */ }
  return result;
}

function invalidateAccountingCache_() {
  try { CacheService.getScriptCache().remove('accountingSummary_v1'); } catch (e) { /* تجاهل */ }
}
