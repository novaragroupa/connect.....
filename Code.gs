/**
 * CONNECT — نظام إدارة محل موبايلات وإكسسوارات
 * الباك اند: Google Apps Script فوق Google Sheets
 *
 * طريقة التركيب:
 * 1) افتح Google Sheet جديد فاضي.
 * 2) من القائمة: Extensions > Apps Script.
 * 3) امسح أي كود موجود، والصق هذا الملف كامل.
 * 4) نفّذ (Run) الدالة setupSheets() مرة واحدة فقط (هتطلب صلاحيات، وافق عليها).
 *    هي هتنشئ كل الشيتات المطلوبة + مستخدم مدير افتراضي + مفتاح التوقيع الخاص بجلسات الدخول.
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

let SS_ = null; // نفس الـ Spreadsheet طول فترة تنفيذ الطلب (فتحه كل مرة بطيء)
function getSpreadsheet_() {
  if (SS_) return SS_;
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PASTE_') !== 0) {
    SS_ = SpreadsheetApp.openById(SPREADSHEET_ID);
    return SS_;
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { SS_ = active; return SS_; }
  throw new Error('محتاج تحط SPREADSHEET_ID في أول الكود، أو تفتح هذا السكريبت من جوه الشيت نفسه عن طريق Extensions > Apps Script');
}

const SHEETS = {
  USERS: 'Users',
  MAINTENANCE: 'Maintenance',
  ACC_CATEGORIES: 'AccessoryCategories',
  ACC_MODELS: 'AccessoryModels',
  ACC_ITEMS: 'AccessoryItems',
  ACC_SALES: 'AccessorySales',
  DEVICES: 'Devices',
  DEVICE_SALES: 'DeviceSales',
  CASH: 'CashTransfers',
  RETURNS: 'Returns',
  FAILED: 'FailedOps'
};

const SCHEMAS = {
  Users: ['id', 'username', 'password', 'role', 'name', 'createdAt'],
  Maintenance: ['id', 'date', 'deviceCategory', 'caseType', 'deviceType', 'faultType',
    'customerName', 'customerPhone', 'wholesaleCost', 'profitCost', 'total', 'notes', 'employee'],
  AccessoryCategories: ['id', 'name', 'createdAt'],
  AccessoryModels: ['id', 'categoryId', 'categoryName', 'name', 'createdAt'],
  AccessoryItems: ['id', 'code', 'categoryId', 'categoryName', 'name', 'wholesalePrice',
    'profitPrice', 'totalPrice', 'quantity', 'dateAdded', 'modelId', 'modelName', 'warranty', 'warrantyPeriod'],
  AccessorySales: ['id', 'code', 'itemId', 'itemName', 'categoryName', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date', 'warranty', 'warrantyPeriod'],
  Devices: ['id', 'code', 'deviceType', 'condition', 'name', 'wholesalePrice', 'profitPrice', 'totalPrice',
    'warranty', 'quantity', 'dateAdded', 'warrantyPeriod'],
  DeviceSales: ['id', 'code', 'deviceId', 'deviceName', 'deviceType', 'condition', 'warranty', 'customerName',
    'customerPhone', 'quantity', 'wholesalePrice', 'profitPrice', 'unitPrice', 'totalPrice', 'notes', 'employee', 'date', 'warrantyPeriod'],
  CashTransfers: ['id', 'type', 'customerName', 'customerPhone', 'amount', 'notes', 'employee', 'date'],
  Returns: ['id', 'date', 'saleType', 'saleId', 'itemId', 'itemName', 'code', 'customerName', 'customerPhone',
    'quantity', 'wholesalePrice', 'profitPrice', 'refundAmount', 'restock', 'reason', 'employee'],
  FailedOps: ['id', 'date', 'action', 'error', 'payload']
};

// أعمدة لازم ترجع دايمًا نص (الباركود والتليفون بيبدأوا بأصفار، والشيت كان بيحوّلهم لأرقام ويشيل الصفر)
const TEXT_COLS_ = { code: 1, customerPhone: 1 };

const ROLE_ADMIN = 'مدير النظام';
const ROLE_ACCOUNTS = 'حسابات';

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

  getSecret_(true); // مفتاح توقيع جلسات الدخول

  // أضف مستخدم مدير افتراضي لو مفيش يوزرز
  const usersSheet = getSheet_(SHEETS.USERS);
  if (usersSheet.getLastRow() < 2) {
    appendObject_(usersSheet, SCHEMAS.Users, {
      id: Utilities.getUuid(), username: 'admin', password: hashPw_('admin123'), role: ROLE_ADMIN,
      name: 'المدير العام', createdAt: nowStr_()
    });
  }
}

/* ============ أدوات عامة ============ */

const HEADERS_CACHE_ = {};
const TABLE_CACHE_ = {};

function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh && SCHEMAS[name]) sh = ss.insertSheet(name);
  if (!sh) throw new Error('الشيت غير موجود: ' + name);
  if (SCHEMAS[name]) ensureHeaders_(sh, SCHEMAS[name]); // مرة واحدة لكل طلب
  return sh;
}

let TZ_ = null;
function tz_() {
  if (!TZ_) {
    try { TZ_ = getSpreadsheet_().getSpreadsheetTimeZone(); } catch (e) { TZ_ = null; }
    TZ_ = TZ_ || Session.getScriptTimeZone() || 'Africa/Cairo';
  }
  return TZ_;
}

// التواريخ: الشيت بيحوّل نص "2026-10-31 17:00:00" لتاريخ حقيقي، وساعتها JSON كان بيطلّعه بتوقيت UTC
// (يوم غلط بعد منتصف الليل وتنسيق مختلف عن الأوفلاين). بنرجّعه دايمًا نص بتوقيت الشيت.
function normCell_(h, v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  if (TEXT_COLS_[h] && v !== '' && v !== null && v !== undefined) return String(v);
  return v;
}

// قراءة الشيت مرة واحدة لكل طلب (وبتتمسح من الذاكرة مع أي كتابة على نفس الشيت)
function readTable_(sh) {
  const name = sh.getName();
  if (TABLE_CACHE_[name]) return TABLE_CACHE_[name];
  const values = sh.getDataRange().getValues();
  const t = { headers: values.length ? values[0] : [], objs: [], byId: {} };
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const obj = {};
    for (let c = 0; c < t.headers.length; c++) obj[t.headers[c]] = normCell_(t.headers[c], row[c]);
    if (obj.id === '' || obj.id === undefined || obj.id === null) continue;
    const key = String(obj.id);
    if (!t.byId[key]) t.byId[key] = { obj: obj, row: r + 1 };
    t.objs.push(obj);
  }
  TABLE_CACHE_[name] = t;
  return t;
}

function invalidate_(sh) { delete TABLE_CACHE_[sh.getName()]; }

function sheetToObjects_(sh) { return readTable_(sh).objs; }

// بيرجّع { obj, row } أو null
function findById_(sh, id) {
  if (id === undefined || id === null || id === '') return null;
  return readTable_(sh).byId[String(id)] || null;
}

function findObjById_(sh, id) {
  const f = findById_(sh, id);
  return f ? f.obj : null;
}

function ensureHeaders_(sh, desiredHeaders) {
  const name = sh.getName();
  if (HEADERS_CACHE_[name]) {
    const missingCached = desiredHeaders.filter(function (h) { return HEADERS_CACHE_[name].indexOf(h) === -1; });
    if (!missingCached.length) return HEADERS_CACHE_[name];
  }
  const lastCol = sh.getLastColumn();
  let currentHeaders = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const isBlank = currentHeaders.length === 0 || (currentHeaders.length === 1 && currentHeaders[0] === '');
  if (isBlank) {
    sh.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
    sh.setFrozenRows(1);
    HEADERS_CACHE_[name] = desiredHeaders.slice();
    invalidate_(sh);
    return HEADERS_CACHE_[name];
  }
  // لو فيه أعمدة جديدة في الكود مش موجودة في الشيت، ضيفها آخر الشيت تلقائي
  const missing = desiredHeaders.filter(function (h) { return currentHeaders.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    currentHeaders = currentHeaders.concat(missing);
    invalidate_(sh);
  }
  HEADERS_CACHE_[name] = currentHeaders;
  return currentHeaders;
}

// بيكتب صف كامل: كل خلية نصية بتتحفظ بتنسيق "نص" (@) عشان الشيت ميحوّلهاش لرقم/تاريخ/معادلة
// (الصفر اللي في أول التليفون والباركود، وحماية من أي نص بيبدأ بـ = ).
function writeRow_(sh, rowNum, liveHeaders, values, changedIdx) {
  const rng = sh.getRange(rowNum, 1, 1, liveHeaders.length);
  const fmts = rng.getNumberFormats();
  for (let i = 0; i < liveHeaders.length; i++) {
    if (changedIdx && changedIdx.indexOf(i) === -1) continue;
    const v = values[i];
    if (typeof v === 'string' && v !== '') fmts[0][i] = '@';
    else if (fmts[0][i] === '@') fmts[0][i] = 'General';
  }
  rng.setNumberFormats(fmts);
  rng.setValues([values]);
}

function appendObject_(sh, headers, obj) {
  const liveHeaders = ensureHeaders_(sh, headers);
  const row = liveHeaders.map(function (h) { return obj[h] !== undefined && obj[h] !== null ? obj[h] : ''; });
  const rowNum = sh.getLastRow() + 1;
  if (rowNum > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  writeRow_(sh, rowNum, liveHeaders, row, null);
  invalidate_(sh);
}

// تعديل أكتر من حقل في صف واحد بطلبين بدل طلب لكل خلية
function updateFields_(sh, headers, id, fields) {
  const f = findById_(sh, id);
  if (!f) throw new Error('السجل غير موجود');
  const live = ensureHeaders_(sh, headers);
  const raw = sh.getRange(f.row, 1, 1, live.length).getValues()[0];
  const changed = [];
  Object.keys(fields).forEach(function (h) {
    const i = live.indexOf(h);
    if (i === -1) return;
    raw[i] = fields[h] === undefined || fields[h] === null ? '' : fields[h];
    changed.push(i);
  });
  writeRow_(sh, f.row, live, raw, changed);
  invalidate_(sh);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

// الواجهة (وهي أوفلاين) بتولّد id وتاريخ العملية من عندها. السيرفر بيستخدمهم،
// ولو نفس الـ id وصل تاني (مثلًا الإنترنت قطع بعد ما العملية اتسجلت) بيرجّع العملية القديمة من غير تكرار.
function clientId_(body) {
  const id = body && body.id ? String(body.id).trim() : '';
  if (id && id.length > 80) throw new Error('رقم العملية غير صحيح');
  return id || Utilities.getUuid();
}

function clientDate_(body) {
  const d = body && body.date ? String(body.date) : '';
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d) ? d : nowStr_();
}

/* ============ التحقق من البيانات ============ */

function has_(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

function fail_(msg) { throw new Error(msg); }

function numIn_(v, label, o) {
  o = o || {};
  if (v === undefined || v === null || v === '') {
    if (o.def !== undefined) return o.def;
    fail_(label + ' مطلوب');
  }
  const n = Number(v);
  if (!isFinite(n)) fail_(label + ' لازم يكون رقم صحيح');
  if (o.min !== undefined && n < o.min) fail_(label + ' لازم يكون ' + (o.min === 0 ? 'صفر أو أكتر' : 'أكبر من أو يساوي ' + o.min));
  if (o.gt !== undefined && n <= o.gt) fail_(label + ' لازم يكون أكبر من ' + o.gt);
  if (o.int && Math.floor(n) !== n) fail_(label + ' لازم يكون عدد صحيح');
  if (Math.abs(n) > 1e9) fail_(label + ' كبير بشكل غير منطقي');
  return n;
}

function strIn_(v, label, o) {
  o = o || {};
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (o.required && !s) fail_(label + ' مطلوب');
  if (s.length > (o.max || 300)) fail_(label + ' طويل جدًا');
  return s;
}

function oneOf_(v, list, label) {
  if (list.indexOf(v) === -1) fail_(label + ' غير صحيح');
  return v;
}

/* ============ المصادقة (جلسات موقّعة) ============ */

function getSecret_(create) {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s && create) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function toHex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b < 0 ? b + 256 : b) & 255).toString(16)).slice(-2); }).join('');
}

// الباسورد بيتخزن مشفّر (SHA-256 + salt). الباسوردات القديمة (نص عادي) لسه بتشتغل وبتتحوّل أول ما صاحبها يدخل.
function hashPw_(pw, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(pw), Utilities.Charset.UTF_8);
  return 'sha256$' + salt + '$' + toHex_(d);
}

function pwMatches_(stored, given) {
  stored = String(stored);
  if (stored.indexOf('sha256$') === 0) {
    const parts = stored.split('$');
    return safeEq_(hashPw_(given, parts[1]), stored);
  }
  return safeEq_(stored, String(given));
}

function safeEq_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function makeToken_(u) {
  const secret = getSecret_(false);
  if (!secret) return null;
  const sig = Utilities.computeHmacSha256Signature(String(u.id) + '|' + String(u.password) + '|' + String(u.role), secret);
  return Utilities.base64EncodeWebSafe(sig);
}

function authUser_(body) {
  const uid = body && body.uid ? String(body.uid) : '';
  const tok = body && body.token ? String(body.token) : '';
  if (!uid || !tok) return null;
  const f = findById_(getSheet_(SHEETS.USERS), uid);
  if (!f) return null;
  const expect = makeToken_(f.obj);
  return expect && safeEq_(expect, tok) ? f.obj : null;
}

/* ============ نقطة الدخول ============ */

function doGet(e) {
  return jsonOut_({ ok: true, message: 'CONNECT API شغال' });
}

// العمليات المسموح بيها جوه الرفع الجماعي (الطابور اللي اتسجل أوفلاين)
const BATCH_ALLOWED = {
  addMaintenance: 1, addAccessoryCategory: 1, addAccessoryModel: 1, addAccessoryItem: 1, sellAccessoryItem: 1,
  addDevice: 1, sellDevice: 1, addCashTransfer: 1, moveAccessoryCategory: 1,
  updateAccessoryItem: 1, updateDevice: 1, addReturn: 1
};
const PUBLIC_ACTIONS = { ping: 1, login: 1 };
const ADMIN_ACTIONS = { addUser: 1, listUsers: 1 };

function doPost(e) {
  let lock = null;
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonOut_({ ok: false, error: 'طلب غير صحيح' });
    const body = JSON.parse(e.postData.contents);
    const action = String(body.action || '');

    if (!has_(PUBLIC_ACTIONS, action)) {
      const user = authUser_(body);
      if (!user) return jsonOut_({ ok: false, authError: true, error: 'انتهت الجلسة، سجّل الدخول من جديد' });
      if (has_(ADMIN_ACTIONS, action) && user.role !== ROLE_ADMIN) return jsonOut_({ ok: false, error: 'مش مسموح لك بالعملية دي' });
    }

    // قفل: عشان لو جهازين رفعوا في نفس اللحظة العمليات متتداخلش وتبوّظ المخزون
    if (action === 'batch' || /^(add|sell|update|move)/.test(action)) {
      lock = LockService.getScriptLock();
      try { lock.waitLock(30000); }
      catch (le) { lock = null; return jsonOut_({ ok: false, busy: true, error: 'السيرفر مشغول دلوقتي، هنحاول تاني تلقائي' }); }
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

    case 'addAccessoryModel': return addAccessoryModel_(body);
    case 'listAccessoryModels': return { items: sheetToObjects_(getSheet_(SHEETS.ACC_MODELS)) };

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
    case 'addReturn': return addReturn_(body);
    case 'listReturns': return { items: sheetToObjects_(getSheet_(SHEETS.RETURNS)) };

    default: return { error: 'إجراء غير معروف: ' + action };
  }
}

// رفع مجموعة عمليات بالترتيب في طلب واحد. كل عملية ليها نتيجتها (نجحت/فشلت) وفشل واحدة مبيوقفش الباقي.
function runBatch_(body) {
  const ops = body.ops || [];
  if (ops.length > 50) return { error: 'عدد العمليات في الدفعة كبير' };
  const results = [];
  const modelAlias = {}; // لو نفس الموديل اتضاف من جهازين أوفلاين، العمليات اللي بعده بتتربط بالموديل الأصلي
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] || {};
    try {
      if (!has_(BATCH_ALLOWED, op.action)) {
        results.push({ ok: false, error: 'عملية غير مسموحة في الرفع الجماعي: ' + op.action });
        continue;
      }
      const payload = Object.assign({}, op.payload || {});
      if (payload.modelId && modelAlias[payload.modelId]) payload.modelId = modelAlias[payload.modelId];
      // fromBatch: العملية اتعملت فعلًا في المحل (أوفلاين)، فبنسجلها حتى لو المخزون/الكود مش مظبوط
      const r = dispatch_(op.action, Object.assign(payload, { action: op.action, fromBatch: true }));
      if (r && r.error) { logFailed_(op, r.error); results.push({ ok: false, error: r.error }); }
      else {
        if (op.action === 'addAccessoryModel' && r && r.duplicate && r.item && op.payload && op.payload.id &&
            String(r.item.id) !== String(op.payload.id)) {
          modelAlias[op.payload.id] = r.item.id;
        }
        results.push(Object.assign({ ok: true }, r));
      }
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      logFailed_(op, msg);
      results.push({ ok: false, error: msg });
    }
  }
  return { results: results };
}

// أي عملية فشلت بيتسجل سببها في شيت FailedOps عشان متضيعش
function logFailed_(op, error) {
  try {
    appendObject_(getSheet_(SHEETS.FAILED), SCHEMAS.FailedOps, {
      id: Utilities.getUuid(), date: nowStr_(), action: op.action, error: error,
      payload: JSON.stringify(op.payload || {}).substring(0, 40000)
    });
  } catch (e) { /* التسجيل مش لازم يوقف الرفع */ }
}

function stripPassword_(u) {
  const copy = Object.assign({}, u);
  delete copy.password;
  return copy;
}

/* ============ المستخدمين ============ */

function login_(body) {
  const username = String(body.username || '').trim();
  const cache = CacheService.getScriptCache();
  const failKey = 'lf_' + username.toLowerCase().substring(0, 60);
  const fails = Number(cache.get(failKey)) || 0;
  if (fails >= 8) return { error: 'محاولات دخول كتير غلط، استنى 10 دقايق وجرّب تاني' };

  const sh = getSheet_(SHEETS.USERS);
  const found = sheetToObjects_(sh).find(function (u) {
    return String(u.username) === username && pwMatches_(u.password, body.password);
  });
  if (!found) {
    try { cache.put(failKey, String(fails + 1), 600); } catch (e) { /* تجاهل */ }
    return { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  }
  try { cache.remove(failKey); } catch (e) { /* تجاهل */ }

  getSecret_(true);
  let user = found;
  // ترقية الباسورد القديم (نص عادي) لنسخة مشفّرة
  if (String(found.password).indexOf('sha256$') !== 0) {
    const lock = LockService.getScriptLock();
    try {
      if (lock.tryLock(5000)) {
        try {
          updateFields_(sh, SCHEMAS.Users, found.id, { password: hashPw_(body.password) });
          user = findObjById_(sh, found.id) || found;
        } finally { lock.releaseLock(); }
      }
    } catch (e) { /* لو فشلت الترقية نكمل بالباسورد القديم */ }
  }
  return { user: stripPassword_(user), token: makeToken_(user) };
}

function addUser_(body) {
  const sh = getSheet_(SHEETS.USERS);
  const users = sheetToObjects_(sh);
  const username = strIn_(body.username, 'اسم المستخدم', { required: true, max: 60 });
  const name = strIn_(body.name, 'اسم الموظف', { required: true, max: 100 });
  const password = String(body.password === undefined || body.password === null ? '' : body.password);
  if (password.length < 4) return { error: 'كلمة المرور لازم تكون 4 حروف أو أكتر' };
  const role = oneOf_(body.role, [ROLE_ADMIN, ROLE_ACCOUNTS], 'الصلاحية');
  if (users.some(function (u) { return String(u.username).toLowerCase() === username.toLowerCase(); })) {
    return { error: 'اسم المستخدم موجود بالفعل' };
  }
  const obj = {
    id: Utilities.getUuid(),
    username: username,
    password: hashPw_(password),
    role: role,
    name: name,
    createdAt: nowStr_()
  };
  appendObject_(sh, SCHEMAS.Users, obj);
  return { user: stripPassword_(obj) };
}

/* ============ الصيانة ============ */

function addMaintenance_(body) {
  const sh = getSheet_(SHEETS.MAINTENANCE);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const wholesale = numIn_(body.wholesaleCost, 'التكلفة', { def: 0, min: 0 });
  const profit = numIn_(body.profitCost, 'المكسب', { def: 0, min: 0 });
  const obj = {
    id: clientId_(body),
    date: clientDate_(body),
    deviceCategory: oneOf_(body.deviceCategory, ['هاردوير', 'سوفتوير'], 'نوع الصيانة'), // هاردوير / سوفتوير
    caseType: oneOf_(body.caseType, ['كشف اعطال', 'عطل معروف'], 'نوع الحالة'), // كشف اعطال / عطل معروف
    deviceType: strIn_(body.deviceType, 'نوع الجهاز', { required: true }),
    faultType: strIn_(body.faultType, 'اسم العطل'),
    customerName: strIn_(body.customerName, 'اسم العميل'),
    customerPhone: strIn_(body.customerPhone, 'رقم العميل', { max: 40 }),
    wholesaleCost: wholesale,
    profitCost: profit,
    total: wholesale + profit,
    notes: strIn_(body.notes, 'الملاحظات', { max: 2000 }),
    employee: strIn_(body.employee, 'الموظف', { max: 100 })
  };
  appendObject_(sh, SCHEMAS.Maintenance, obj);
  invalidateAccountingCache_();
  return { item: obj };
}

/* ============ الإكسسوارات ============ */

function addAccessoryCategory_(body) {
  const sh = getSheet_(SHEETS.ACC_CATEGORIES);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const name = strIn_(body.name, 'اسم النوع', { required: true, max: 100 });
  if (name.replace('[كمبيوتر]', '').trim() === '') fail_('اسم النوع مطلوب');
  const obj = { id: clientId_(body), name: name, createdAt: clientDate_(body) };
  appendObject_(sh, SCHEMAS.AccessoryCategories, obj);
  return { item: obj };
}

// موديل جوه نوع إكسسوار (مثلًا: كفرات > iPhone 15). الأصناف بتتربط بيه عن طريق modelId.
function addAccessoryModel_(body) {
  const sh = getSheet_(SHEETS.ACC_MODELS);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const name = strIn_(body.name, 'اسم الموديل', { max: 100 });
  if (!body.categoryId || !name) return { error: 'بيانات الموديل ناقصة' };
  const ex = sheetToObjects_(sh).filter(function (m) {
    return String(m.categoryId) === String(body.categoryId) && String(m.name).trim().toLowerCase() === name.toLowerCase();
  })[0];
  if (ex) {
    if (body.fromBatch) return { item: ex, duplicate: true };
    return { error: 'الموديل ده موجود بالفعل في النوع ده' };
  }
  const obj = { id: clientId_(body), categoryId: body.categoryId, categoryName: strIn_(body.categoryName, 'اسم النوع', { max: 100 }), name: name, createdAt: clientDate_(body) };
  appendObject_(sh, SCHEMAS.AccessoryModels, obj);
  return { item: obj };
}

// نقل نوع بين إكسسوارات الموبايل والكمبيوتر: بنغيّر اسم النوع (علامة [كمبيوتر] في أوله)
// وبنحدّث categoryName في كل أصناف النوع. الأصناف نفسها مربوطة بالـ id فمش بتتأثر.
function moveAccessoryCategory_(body) {
  const newName = strIn_(body.name, 'اسم النوع', { max: 100 });
  if (!body.id || !newName) throw new Error('بيانات النقل ناقصة');

  const catSh = getSheet_(SHEETS.ACC_CATEGORIES);
  if (!findById_(catSh, body.id)) throw new Error('النوع غير موجود');

  const dup = sheetToObjects_(catSh).some(function (c) {
    return String(c.id) !== String(body.id) && String(c.name) === newName;
  });
  if (dup) throw new Error('فيه نوع بنفس الاسم في القسم التاني');

  updateFields_(catSh, SCHEMAS.AccessoryCategories, body.id, { name: newName });

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
        const rng = itemSh.getRange(2, catNameCol + 1, col.length, 1);
        rng.setNumberFormat('@');
        rng.setValues(col);
        invalidate_(itemSh);
      }
    }
  }
  return { item: { id: body.id, name: newName } };
}

function genCode_() {
  // كود عددي فريد من 6 أرقام لو الموظف مكتبش كود يدوي أو من الماسح
  return String(Math.floor(100000 + Math.random() * 900000));
}

// exceptId: عشان الصنف ميتعارضش مع نفسه (الكود في الشيت ممكن يكون رقم، فالمقارنة لازم تبقى بالنص ومن غير الصنف نفسه)
function codeExists_(code, exceptId) {
  const c = String(code);
  const except = exceptId === undefined || exceptId === null ? '' : String(exceptId);
  const same = function (i) { return String(i.code) === c && String(i.id) !== except; };
  return sheetToObjects_(getSheet_(SHEETS.ACC_ITEMS)).some(same) ||
    sheetToObjects_(getSheet_(SHEETS.DEVICES)).some(same);
}

function resolveCode_(body) {
  let code = strIn_(body.code, 'كود المنتج', { max: 64 });
  if (!code) { do { code = genCode_(); } while (codeExists_(code)); }
  else if (codeExists_(code)) {
    // لو الكود اتولّد تلقائي من الجهاز وطلع مكرر، نولّد غيره بدل ما نرفض العملية
    if (body.autoCode || body.fromBatch) { do { code = genCode_(); } while (codeExists_(code)); }
    else fail_('الكود ده مستخدم بالفعل لمنتج تاني');
  }
  return code;
}

function warrantyIn_(body) {
  const w = body.warranty === 'له ضمان' ? 'له ضمان' : 'بدون ضمان';
  return { warranty: w, warrantyPeriod: w === 'له ضمان' ? strIn_(body.warrantyPeriod, 'مدة الضمان', { max: 40 }) : '' };
}

function addAccessoryItem_(body) {
  const sh = getSheet_(SHEETS.ACC_ITEMS);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const name = strIn_(body.name, 'اسم الصنف', { required: true, max: 200 });
  if (!body.categoryId) fail_('النوع مطلوب');
  const wholesale = numIn_(body.wholesalePrice, 'سعر الجملة', { def: 0, min: 0 });
  const profit = numIn_(body.profitPrice, 'سعر المكسب', { def: 0, min: 0 });
  const quantity = numIn_(body.quantity, 'الكمية', { def: 0, min: 0, int: true });
  const code = resolveCode_(body);
  const w = warrantyIn_(body);
  const obj = {
    id: clientId_(body),
    code: code,
    categoryId: body.categoryId,
    categoryName: strIn_(body.categoryName, 'اسم النوع', { max: 100 }),
    modelId: body.modelId || '',
    modelName: strIn_(body.modelName, 'اسم الموديل', { max: 100 }),
    name: name,
    wholesalePrice: wholesale,
    profitPrice: profit,
    totalPrice: wholesale + profit,
    quantity: quantity,
    dateAdded: clientDate_(body),
    warranty: w.warranty,
    warrantyPeriod: w.warrantyPeriod
  };
  appendObject_(sh, SCHEMAS.AccessoryItems, obj);
  return { item: obj };
}

function updateAccessoryItem_(body) {
  const sh = getSheet_(SHEETS.ACC_ITEMS);
  const f = findById_(sh, body.id);
  if (!f) return { error: 'الصنف غير موجود' };
  const item = f.obj;
  const fields = {};

  const newCode = strIn_(body.code, 'كود المنتج', { max: 64 });
  if (newCode && newCode !== String(item.code)) {
    if (!codeExists_(newCode, item.id)) fields.code = newCode;
    else if (!body.fromBatch) return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
    // لو العملية جاية من الطابور (اتعملت أوفلاين): نطبّق باقي التعديل ونسيب الكود زي ما هو
  }
  const name = body.name !== undefined && body.name !== '' ? strIn_(body.name, 'اسم الصنف', { required: true, max: 200 }) : item.name;
  const wholesale = body.wholesalePrice !== undefined ? numIn_(body.wholesalePrice, 'سعر الجملة', { min: 0 }) : Number(item.wholesalePrice);
  const profit = body.profitPrice !== undefined ? numIn_(body.profitPrice, 'سعر المكسب', { min: 0 }) : Number(item.profitPrice);
  const quantity = body.quantity !== undefined ? numIn_(body.quantity, 'الكمية', { min: 0, int: true }) : Number(item.quantity);
  const accWarranty = body.warranty ? (body.warranty === 'له ضمان' ? 'له ضمان' : 'بدون ضمان') : (item.warranty || 'بدون ضمان');
  const accPeriod = accWarranty === 'له ضمان' ? (body.warranty ? strIn_(body.warrantyPeriod, 'مدة الضمان', { max: 40 }) : (item.warrantyPeriod || '')) : '';

  Object.assign(fields, { name: name, wholesalePrice: wholesale, profitPrice: profit, totalPrice: wholesale + profit,
    quantity: quantity, warranty: accWarranty, warrantyPeriod: accPeriod });

  // الموديل: لو الواجهة بعتته نحدّثه، غير كده نسيبه زي ما هو
  const hasModel = body.modelId !== undefined;
  const modelId = hasModel ? String(body.modelId || '') : String(item.modelId || '');
  const modelName = hasModel ? strIn_(body.modelName, 'اسم الموديل', { max: 100 }) : String(item.modelName || '');
  if (hasModel) { fields.modelId = modelId; fields.modelName = modelName; }

  updateFields_(sh, SCHEMAS.AccessoryItems, item.id, fields);
  return { item: Object.assign({}, item, fields, { modelId: modelId, modelName: modelName }) };
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
  const f = findById_(sh, body.itemId);
  if (!f) return { error: 'الصنف غير موجود' };
  const item = f.obj;
  const qty = Number(item.quantity) || 0;
  const sellQty = numIn_(body.quantity, 'الكمية', { def: 1, min: 1, int: true });
  let overNote = '';
  if (sellQty > qty) {
    if (!body.fromBatch) return { error: 'الكمية المطلوبة (' + sellQty + ') أكبر من المتاح بالمخزون (' + qty + ')' };
    overNote = ' [تنبيه: المخزون وقت الرفع كان ' + qty + ' فقط]';
  }
  const sale = {
    id: clientId_(body),
    code: item.code || '',
    itemId: item.id,
    itemName: item.name,
    categoryName: item.categoryName,
    customerName: strIn_(body.customerName, 'اسم العميل'),
    customerPhone: strIn_(body.customerPhone, 'رقم العميل', { max: 40 }),
    quantity: sellQty,
    wholesalePrice: Number(item.wholesalePrice) * sellQty,
    profitPrice: Number(item.profitPrice) * sellQty,
    unitPrice: item.totalPrice,
    totalPrice: Number(item.totalPrice) * sellQty,
    notes: strIn_(body.notes, 'الملاحظات', { max: 2000 }) + overNote,
    employee: strIn_(body.employee, 'الموظف', { max: 100 }),
    date: clientDate_(body),
    warranty: item.warranty || 'بدون ضمان',
    warrantyPeriod: item.warrantyPeriod || ''
  };
  // سجل البيع الأول، وبعدين خصم المخزون: لو حصل خطأ في النص مفيش مخزون بيتخصم من غير فاتورة
  appendObject_(salesSh, SCHEMAS.AccessorySales, sale);
  updateFields_(sh, SCHEMAS.AccessoryItems, item.id, { quantity: Math.max(0, qty - sellQty) });
  invalidateAccountingCache_();
  return { sale: sale, remainingQuantity: Math.max(0, qty - sellQty) };
}

/* ============ الأجهزة ============ */

function addDevice_(body) {
  const sh = getSheet_(SHEETS.DEVICES);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const name = strIn_(body.name, 'اسم الجهاز', { required: true, max: 200 });
  const condition = oneOf_(body.condition, ['جديد', 'مستعمل'], 'الحالة');
  const wholesale = numIn_(body.wholesalePrice, 'سعر الجملة', { def: 0, min: 0 });
  const profit = numIn_(body.profitPrice, 'سعر المكسب', { def: 0, min: 0 });
  const quantity = numIn_(body.quantity, 'الكمية', { def: 0, min: 0, int: true });
  const code = resolveCode_(body);
  const w = warrantyIn_(body);
  const obj = {
    id: clientId_(body),
    code: code,
    deviceType: strIn_(body.deviceType, 'نوع الجهاز', { max: 60 }) || 'أخرى',
    condition: condition, // جديد / مستعمل
    name: name,
    wholesalePrice: wholesale,
    profitPrice: profit,
    totalPrice: wholesale + profit,
    warranty: w.warranty, // له ضمان / بدون ضمان
    warrantyPeriod: w.warrantyPeriod,
    quantity: quantity,
    dateAdded: clientDate_(body)
  };
  appendObject_(sh, SCHEMAS.Devices, obj);
  return { item: obj };
}

function updateDevice_(body) {
  const sh = getSheet_(SHEETS.DEVICES);
  const f = findById_(sh, body.id);
  if (!f) return { error: 'الجهاز غير موجود' };
  const dev = f.obj;
  const fields = {};

  const newCode = strIn_(body.code, 'كود المنتج', { max: 64 });
  if (newCode && newCode !== String(dev.code)) {
    if (!codeExists_(newCode, dev.id)) fields.code = newCode;
    else if (!body.fromBatch) return { error: 'الكود ده مستخدم بالفعل لمنتج تاني' };
  }
  const name = body.name !== undefined && body.name !== '' ? strIn_(body.name, 'اسم الجهاز', { required: true, max: 200 }) : dev.name;
  const wholesale = body.wholesalePrice !== undefined ? numIn_(body.wholesalePrice, 'سعر الجملة', { min: 0 }) : Number(dev.wholesalePrice);
  const profit = body.profitPrice !== undefined ? numIn_(body.profitPrice, 'سعر المكسب', { min: 0 }) : Number(dev.profitPrice);
  const quantity = body.quantity !== undefined ? numIn_(body.quantity, 'الكمية', { min: 0, int: true }) : Number(dev.quantity);
  const warranty = body.warranty ? (body.warranty === 'له ضمان' ? 'له ضمان' : 'بدون ضمان') : (dev.warranty || 'بدون ضمان');
  const deviceType = body.deviceType ? strIn_(body.deviceType, 'نوع الجهاز', { max: 60 }) : dev.deviceType;
  const devPeriod = warranty === 'له ضمان' ? (body.warranty ? strIn_(body.warrantyPeriod, 'مدة الضمان', { max: 40 }) : (dev.warrantyPeriod || '')) : '';

  Object.assign(fields, { name: name, wholesalePrice: wholesale, profitPrice: profit, totalPrice: wholesale + profit,
    quantity: quantity, warranty: warranty, warrantyPeriod: devPeriod, deviceType: deviceType });
  updateFields_(sh, SCHEMAS.Devices, dev.id, fields);
  return { item: Object.assign({}, dev, fields) };
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
  const f = findById_(sh, body.deviceId);
  if (!f) return { error: 'الجهاز غير موجود' };
  const dev = f.obj;
  const qty = Number(dev.quantity) || 0;
  const sellQty = numIn_(body.quantity, 'الكمية', { def: 1, min: 1, int: true });
  let overNote = '';
  if (sellQty > qty) {
    if (!body.fromBatch) return { error: 'الكمية المطلوبة (' + sellQty + ') أكبر من المتاح بالمخزون (' + qty + ')' };
    overNote = ' [تنبيه: المخزون وقت الرفع كان ' + qty + ' فقط]';
  }
  const sale = {
    id: clientId_(body),
    code: dev.code || '',
    deviceId: dev.id,
    deviceName: dev.name,
    deviceType: dev.deviceType || '',
    condition: dev.condition,
    warranty: dev.warranty,
    customerName: strIn_(body.customerName, 'اسم العميل'),
    customerPhone: strIn_(body.customerPhone, 'رقم العميل', { max: 40 }),
    quantity: sellQty,
    wholesalePrice: Number(dev.wholesalePrice) * sellQty,
    profitPrice: Number(dev.profitPrice) * sellQty,
    unitPrice: dev.totalPrice,
    totalPrice: Number(dev.totalPrice) * sellQty,
    notes: strIn_(body.notes, 'الملاحظات', { max: 2000 }) + overNote,
    employee: strIn_(body.employee, 'الموظف', { max: 100 }),
    date: clientDate_(body),
    warrantyPeriod: dev.warrantyPeriod || ''
  };
  appendObject_(salesSh, SCHEMAS.DeviceSales, sale);
  updateFields_(sh, SCHEMAS.Devices, dev.id, { quantity: Math.max(0, qty - sellQty) });
  invalidateAccountingCache_();
  return { sale: sale, remainingQuantity: Math.max(0, qty - sellQty) };
}

/* ============ تحويلات الكاش ============ */

function addCashTransfer_(body) {
  const sh = getSheet_(SHEETS.CASH);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const obj = {
    id: clientId_(body),
    type: oneOf_(body.type, ['ايداع', 'سحب'], 'نوع العملية'), // سحب / ايداع
    customerName: strIn_(body.customerName, 'اسم العميل', { required: true }),
    customerPhone: strIn_(body.customerPhone, 'رقم العميل', { max: 40 }),
    amount: numIn_(body.amount, 'المبلغ', { gt: 0 }),
    notes: strIn_(body.notes, 'الملاحظات', { max: 2000 }),
    employee: strIn_(body.employee, 'الموظف', { max: 100 }),
    date: clientDate_(body)
  };
  appendObject_(sh, SCHEMAS.CashTransfers, obj);
  return { item: obj };
}

/* ============ البحث بالكود / البيع بالباركود ============ */

function findProductByCode_(body) {
  const code = String(body.code || '').trim();
  if (!code) return { error: 'محتاج تدخل كود أو تمسح باركود المنتج' };

  const accMatch = sheetToObjects_(getSheet_(SHEETS.ACC_ITEMS)).find(function (i) { return String(i.code) === code; });
  if (accMatch) return { found: true, type: 'accessory', item: accMatch };

  const devMatch = sheetToObjects_(getSheet_(SHEETS.DEVICES)).find(function (d) { return String(d.code) === code; });
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


/* ============ المسترجع ============ */

function addReturn_(body) {
  const sh = getSheet_(SHEETS.RETURNS);
  if (body.id) { const dup = findObjById_(sh, body.id); if (dup) return { item: dup, duplicate: true }; }
  const isDev = body.saleType === 'device';
  const salesSh = getSheet_(isDev ? SHEETS.DEVICE_SALES : SHEETS.ACC_SALES);
  const sale = findObjById_(salesSh, body.saleId);
  if (!sale) return { error: 'عملية البيع الأصلية مش موجودة' };

  const soldQty = Number(sale.quantity) || 1;
  const already = sheetToObjects_(sh).filter(function (r) {
    return String(r.saleId) === String(body.saleId) && r.saleType === (isDev ? 'device' : 'accessory');
  }).reduce(function (t, r) { return t + (Number(r.quantity) || 0); }, 0);
  const qty = numIn_(body.quantity, 'الكمية', { def: 1, min: 1, int: true });
  if (qty > soldQty - already) return { error: 'الكمية المسترجعة (' + qty + ') أكبر من المتاح للاسترجاع (' + (soldQty - already) + ')' };

  const unitW = (Number(sale.wholesalePrice) || 0) / soldQty;
  const wholesale = unitW * qty;
  const refund = body.refundAmount !== undefined && body.refundAmount !== ''
    ? numIn_(body.refundAmount, 'المبلغ المرجّع', { min: 0 })
    : (Number(sale.unitPrice) || 0) * qty;
  const restock = body.restock === false || body.restock === 'false' || body.restock === 'لا' ? 'لا' : 'نعم';

  const obj = {
    id: clientId_(body),
    date: clientDate_(body),
    saleType: isDev ? 'device' : 'accessory',
    saleId: sale.id,
    itemId: isDev ? sale.deviceId : sale.itemId,
    itemName: isDev ? sale.deviceName : sale.itemName,
    code: sale.code || '',
    customerName: sale.customerName || '',
    customerPhone: sale.customerPhone || '',
    quantity: qty,
    wholesalePrice: wholesale,
    profitPrice: refund - wholesale,
    refundAmount: refund,
    restock: restock,
    reason: strIn_(body.reason, 'السبب', { max: 1000 }),
    employee: strIn_(body.employee, 'الموظف', { max: 100 })
  };
  appendObject_(sh, SCHEMAS.Returns, obj);

  let newQuantity;
  if (restock === 'نعم') {
    const itemSh = getSheet_(isDev ? SHEETS.DEVICES : SHEETS.ACC_ITEMS);
    const cur = findById_(itemSh, isDev ? sale.deviceId : sale.itemId);
    if (cur) {
      newQuantity = (Number(cur.obj.quantity) || 0) + qty;
      updateFields_(itemSh, isDev ? SCHEMAS.Devices : SCHEMAS.AccessoryItems, cur.obj.id, { quantity: newQuantity });
    }
  }
  invalidateAccountingCache_();
  return { item: obj, newQuantity: newQuantity };
}

/* ============ الحسابات ============ */

function accountingSummary_() {
  const scriptCache = CacheService.getScriptCache();
  const cacheKey = 'accountingSummary_v3';
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

  // المسترجع بيتخصم من قسمه (اكسسوارات / اجهزة): الإجمالي بالسالب، والجملة بترجع لو القطعة رجعت المخزون
  sheetToObjects_(getSheet_(SHEETS.RETURNS)).forEach(function (r) {
    const w = r.restock === 'نعم' ? -(Number(r.wholesalePrice) || 0) : 0;
    const t = -(Number(r.refundAmount) || 0);
    records.push(toRecord(r.date, w, t - w, t, r.saleType === 'device' ? 'اجهزة' : 'اكسسوارات'));
  });

  const result = { records: records };
  try { scriptCache.put(cacheKey, JSON.stringify(result), 30); } catch (e) { /* البيانات كبيرة جدًا على الكاش، مش مشكلة */ }
  return result;
}

function invalidateAccountingCache_() {
  try { CacheService.getScriptCache().remove('accountingSummary_v3'); } catch (e) { /* تجاهل */ }
}
