/* ============================================================
   طبقة الأوفلاين — Connect
   - البيانات بتتخزن على الجهاز (IndexedDB) وبتتعرض حتى لو مفيش نت
   - أي عملية (بيع/إضافة/تعديل) بتتسجل فورًا على الجهاز وبتتحط في طابور
   - لما النت يرجع الطابور بيترفع لـ Google Sheets أوتوماتيك (على دفعات، ومن غير تكرار)
   ============================================================ */

const LIST_ACTIONS = ['listMaintenance', 'listAccessoryCategories', 'listAccessoryModels', 'listAccessoryItems', 'listAccessorySales',
  'listDevices', 'listDeviceSales', 'listCashTransfers', 'listReturns', 'listUsers'];
const MAIN_LISTS = LIST_ACTIONS.filter(function (a) { return a !== 'listUsers'; });

const LISTS = {};        // action -> { items: [...] }  (آخر نسخة معروفة + العمليات المحلية)
const LIST_TIME = {};    // action -> وقت آخر تحميل ناجح من السيرفر
const INFLIGHT_READS = {};
let QUEUE = [];          // عمليات متسجلة محليًا وما اترفعتش
let FAILED = [];         // عمليات السيرفر رفضها (مخزون مش كفاية مثلًا)
let NET_DOWN_UNTIL = 0;  // مش هنحاول نتصل قبل الوقت ده (عشان متعطلش الشاشة)
let NET_LAST_OK = null;  // آخر حالة اتصال معروفة
let LAST_WRITE_QUEUED = false;
let LAST_WRITE_DONE = 0;
let FLUSH_PROMISE = null;

/* ---------- أدوات صغيرة ---------- */

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function localNowStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function num(v) { return Number(v) || 0; }
function findIn(listName, id) {
  return ((LISTS[listName] || {}).items || []).find(function (x) { return String(x.id) === String(id); });
}

/* ---------- التخزين على الجهاز (IndexedDB) ---------- */

let _idb = null;
function idb() {
  if (_idb) return _idb;
  _idb = new Promise(function (resolve) {
    try {
      const req = indexedDB.open('connect-offline-v1', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    } catch (e) { resolve(null); }
  });
  return _idb;
}
function idbGet(key) {
  return idb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        r.onsuccess = function () { resolve(r.result === undefined ? null : r.result); };
        r.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
  });
}
function idbSet(key, val) {
  return idb().then(function (db) {
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = tx.onabort = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  });
}

const _persistTimers = {};
function persistList(a) {
  clearTimeout(_persistTimers[a]);
  _persistTimers[a] = setTimeout(function () { idbSet('list:' + a, LISTS[a]); }, 300);
}
function saveQueue() { return idbSet('queue', QUEUE); }
function saveFailed() { return idbSet('failed', FAILED); }

async function offlineInit() {
  await Promise.all(LIST_ACTIONS.map(function (a) {
    return idbGet('list:' + a).then(function (v) { if (v && Array.isArray(v.items)) LISTS[a] = v; });
  }));
  QUEUE = (await idbGet('queue')) || [];
  FAILED = (await idbGet('failed')) || [];
}

/* ---------- حالة الاتصال ---------- */

function canTryNetwork() { return navigator.onLine !== false && Date.now() >= NET_DOWN_UNTIL; }
function isOnlineNow() { return navigator.onLine !== false && NET_LAST_OK !== false; }
function markNetDown() {
  NET_DOWN_UNTIL = Date.now() + 15000;
  NET_LAST_OK = false;
  updateNetStatus();
}
function markNetUp() {
  const was = NET_LAST_OK === false;
  NET_DOWN_UNTIL = 0;
  NET_LAST_OK = true;
  if (was) {
    updateNetStatus();
    if (QUEUE.length) setTimeout(flushQueue, 0);
  }
}

const OP_LABELS = {
  addMaintenance: 'إضافة صيانة', addAccessoryCategory: 'إضافة نوع إكسسوار', addAccessoryModel: 'إضافة موديل', addAccessoryItem: 'إضافة صنف',
  addDevice: 'إضافة جهاز', addCashTransfer: 'تحويل كاش', sellAccessoryItem: 'بيع إكسسوار', sellDevice: 'بيع جهاز',
  updateAccessoryItem: 'تعديل صنف', updateDevice: 'تعديل جهاز', moveAccessoryCategory: 'نقل نوع', addReturn: 'مسترجع'
};
function describeOp(op) {
  const p = op.payload || {};
  const extra = p.name || p.customerName || p.deviceType || '';
  return (OP_LABELS[op.action] || op.action) + (extra ? ' — ' + extra : '');
}

function updateNetStatus() {
  const el = document.getElementById('net-status');
  if (!el) return;
  const pending = QUEUE.length, failed = FAILED.length;
  let html;
  if (FLUSH_PROMISE) {
    html = '<button class="net-chip sync" data-net-act="sync">⏳ بيرفع ' + pending + ' عملية...</button>';
  } else if (!isOnlineNow()) {
    html = '<button class="net-chip off" data-net-act="sync">🔴 بدون إنترنت' +
      (pending ? ' — ' + pending + ' عملية محفوظة على الجهاز' : ' (الشغل عادي)') + '</button>';
  } else if (pending) {
    html = '<button class="net-chip wait" data-net-act="sync">🟡 ' + pending + ' عملية محفوظة — اضغط للرفع</button>';
  } else {
    html = '<button class="net-chip on" data-net-act="sync">🟢 متصل</button>';
  }
  if (failed) html += '<button class="net-chip bad" data-net-act="failed">⚠ ' + failed + ' عملية فشلت</button>';
  el.innerHTML = html;
}

function savedMsg(defaultMsg) {
  return LAST_WRITE_QUEUED ? 'اتحفظ على الجهاز وهيترفع أول ما النت يرجع' : defaultMsg;
}

/* ---------- القراءة (كاش دائم) ---------- */

function listFallback(action) {
  if (LISTS[action]) return LISTS[action];
  if (action === 'listAccessoryModels' || action === 'listReturns') return { items: [] }; // ميزة جديدة: لسه ممكن تكون فاضية على الجهاز
  throw new Error('البيانات دي لسه متحملتش على الجهاز. افتح النظام مرة واحدة والنت شغال.');
}

function cachedApi(action, payload, force) {
  if (action === 'accountingSummary') return accountingFromLists();
  if (LIST_ACTIONS.indexOf(action) === -1) return api(action, payload);

  const fresh = LISTS[action] && LIST_TIME[action] && (Date.now() - LIST_TIME[action]) < CACHE_TTL_MS;
  if (!force && fresh) return Promise.resolve(LISTS[action]);
  if (INFLIGHT_READS[action]) return INFLIGHT_READS[action];
  if (!canTryNetwork()) {
    try { return Promise.resolve(listFallback(action)); } catch (e) { return Promise.reject(e); }
  }

  const p = (async function () {
    // مبنقراش من السيرفر وفيه عمليات لسه متترفعتش، عشان منمسحش شغل محلي
    if (QUEUE.length) await flushQueue();
    if (QUEUE.length) return listFallback(action);
    const startedAt = Date.now();
    readStarted();
    try {
      const data = await api(action);
      if (LAST_WRITE_DONE > startedAt && LISTS[action]) return LISTS[action]; // حصلت كتابة أثناء القراءة، النسخة دي قديمة
      LISTS[action] = { items: data.items || [] };
      LIST_TIME[action] = Date.now();
      persistList(action);
      return LISTS[action];
    } catch (err) {
      if (err.isNetwork) return listFallback(action);
      READ_FAILED = true;
      throw err;
    } finally {
      readFinished();
    }
  })();
  INFLIGHT_READS[action] = p;
  const clear = function () { if (INFLIGHT_READS[action] === p) delete INFLIGHT_READS[action]; };
  p.then(clear, clear);
  return p;
}

function invalidateCache(action) { delete LIST_TIME[action]; }
function patchCacheAdd() { /* الكتابة بتحدّث الكاش لوحدها عن طريق apiWrite */ }
function invalidateProductCaches() { /* نفس السبب */ }

function refreshAllLists() {
  MAIN_LISTS.forEach(function (a) { cachedApi(a, null, true).catch(function () {}); });
}

// الحسابات بتتحسب من القوائم المحلية، فبتشتغل أوفلاين وبتشمل العمليات اللي لسه متترفعتش
async function accountingFromLists() {
  const r = await Promise.all([cachedApi('listMaintenance'), cachedApi('listAccessorySales'), cachedApi('listDeviceSales'), cachedApi('listReturns')]);
  function rec(date, w, p, t, cat) {
    return { date: String(date).substring(0, 10), wholesale: num(w), profit: num(p), total: num(t), category: cat };
  }
  const records = [];
  r[0].items.forEach(function (m) { records.push(rec(m.date, m.wholesaleCost, m.profitCost, m.total, 'صيانة')); });
  r[1].items.forEach(function (s) { records.push(rec(s.date, s.wholesalePrice, s.profitPrice, s.totalPrice, 'اكسسوارات')); });
  r[2].items.forEach(function (s) { records.push(rec(s.date, s.wholesalePrice, s.profitPrice, s.totalPrice, 'اجهزة')); });
  ((r[3] || {}).items || []).forEach(function (x) {
    const w = x.restock === 'نعم' ? -num(x.wholesalePrice) : 0;
    const t = -num(x.refundAmount);
    records.push(rec(x.date, w, t - w, t, x.saleType === 'device' ? 'اجهزة' : 'اكسسوارات'));
  });
  return { ok: true, records: records };
}

/* ---------- البحث بالكود ---------- */

function findLocal(code) {
  const a = ((LISTS.listAccessoryItems || {}).items || []).find(function (i) { return String(i.code) === code; });
  if (a) return { found: true, type: 'accessory', item: a };
  const d = ((LISTS.listDevices || {}).items || []).find(function (i) { return String(i.code) === code; });
  if (d) return { found: true, type: 'device', item: d };
  return null;
}

async function findProduct(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('محتاج تدخل كود أو تمسح باركود المنتج');
  if (canTryNetwork()) {
    // بيحدّث القوائم لو عدّى أكتر من دقيقة، غير كده بيرجع فورًا من الجهاز
    try { await Promise.all([cachedApi('listAccessoryItems'), cachedApi('listDevices')]); } catch (e) { /* نكمل بالمحلي */ }
  }
  return findLocal(code) || { found: false };
}

async function sellByCode(code, payload) {
  const f = await findProduct(code);
  if (!f.found) throw new Error('مفيش منتج بالكود ده في النظام');
  if (f.type === 'accessory') return apiWrite('sellAccessoryItem', Object.assign({}, payload, { itemId: f.item.id }));
  return apiWrite('sellDevice', Object.assign({}, payload, { deviceId: f.item.id }));
}

/* ---------- الكتابة (طابور + تنفيذ محلي) ---------- */

const ONLINE_ONLY = { addUser: 1 };
const NEW_ID_ACTIONS = {
  addMaintenance: 1, addAccessoryCategory: 1, addAccessoryModel: 1, addAccessoryItem: 1, addDevice: 1, addCashTransfer: 1,
  sellAccessoryItem: 1, sellDevice: 1, addReturn: 1
};

function codeExistsLocal(code, exceptId) {
  const same = function (i) { return String(i.code) === String(code) && String(i.id) !== String(exceptId); };
  return ((LISTS.listAccessoryItems || {}).items || []).some(same) || ((LISTS.listDevices || {}).items || []).some(same);
}
function genLocalCode() {
  let c;
  do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (codeExistsLocal(c));
  return c;
}

// بنولّد id وتاريخ العملية من عند الجهاز، عشان السيرفر يقدر يتجاهل أي عملية اتبعتت مرتين
function prepareOp(op) {
  const p = op.payload;
  if (NEW_ID_ACTIONS[op.action]) { p.id = uuid(); p.date = localNowStr(); }
  if (op.action === 'addAccessoryItem' || op.action === 'addDevice') {
    p.code = String(p.code == null ? '' : p.code).trim();
    if (!p.code) { p.code = genLocalCode(); p.autoCode = true; }
  }
}

// نفس منطق السيرفر بالظبط، بيستخدم لما النت يكون مقطوع (وبيتأكد من صحة العملية قبل ما نحفظها)
function localResult(op) {
  const p = op.payload;
  switch (op.action) {
    case 'addMaintenance': {
      const w = num(p.wholesaleCost), pr = num(p.profitCost);
      return { item: { id: p.id, date: p.date, deviceCategory: p.deviceCategory, caseType: p.caseType,
        deviceType: p.deviceType || '', faultType: p.faultType || '', customerName: p.customerName || '',
        customerPhone: p.customerPhone || '', wholesaleCost: w, profitCost: pr, total: w + pr,
        notes: p.notes || '', employee: p.employee || '' } };
    }
    case 'addAccessoryCategory':
      return { item: { id: p.id, name: p.name, createdAt: p.date } };
    case 'addAccessoryModel': {
      const nm = String(p.name || '').trim();
      if (!p.categoryId || !nm) throw new Error('بيانات الموديل ناقصة');
      const exists = ((LISTS.listAccessoryModels || {}).items || []).some(function (m) {
        return String(m.categoryId) === String(p.categoryId) && String(m.name).trim().toLowerCase() === nm.toLowerCase();
      });
      if (exists) throw new Error('الموديل ده موجود بالفعل في النوع ده');
      return { item: { id: p.id, categoryId: p.categoryId, categoryName: p.categoryName || '', name: nm, createdAt: p.date } };
    }
    case 'addAccessoryItem': {
      if (codeExistsLocal(p.code)) throw new Error('الكود ده مستخدم بالفعل لمنتج تاني');
      const w = num(p.wholesalePrice), pr = num(p.profitPrice);
      return { item: { id: p.id, code: p.code, categoryId: p.categoryId, categoryName: p.categoryName, modelId: p.modelId || '', modelName: p.modelName || '', name: p.name,
        wholesalePrice: w, profitPrice: pr, totalPrice: w + pr, quantity: num(p.quantity), dateAdded: p.date,
        warranty: p.warranty || 'بدون ضمان', warrantyPeriod: p.warranty === 'له ضمان' ? (p.warrantyPeriod || '') : '' } };
    }
    case 'addDevice': {
      if (codeExistsLocal(p.code)) throw new Error('الكود ده مستخدم بالفعل لمنتج تاني');
      const w = num(p.wholesalePrice), pr = num(p.profitPrice);
      return { item: { id: p.id, code: p.code, deviceType: p.deviceType || 'أخرى', condition: p.condition, name: p.name,
        wholesalePrice: w, profitPrice: pr, totalPrice: w + pr, warranty: p.warranty, warrantyPeriod: p.warranty === 'له ضمان' ? (p.warrantyPeriod || '') : '', quantity: num(p.quantity),
        dateAdded: p.date } };
    }
    case 'addCashTransfer':
      return { item: { id: p.id, type: p.type, customerName: p.customerName || '', customerPhone: p.customerPhone || '',
        amount: num(p.amount), notes: p.notes || '', employee: p.employee || '', date: p.date } };
    case 'sellAccessoryItem': {
      const item = findIn('listAccessoryItems', p.itemId);
      if (!item) throw new Error('الصنف غير موجود');
      const qty = num(item.quantity), sq = Math.max(1, num(p.quantity) || 1);
      if (sq > qty) throw new Error('الكمية المطلوبة (' + sq + ') أكبر من المتاح بالمخزون (' + qty + ')');
      return { sale: { id: p.id, code: item.code || '', itemId: item.id, itemName: item.name, categoryName: item.categoryName,
        customerName: p.customerName || '', customerPhone: p.customerPhone || '', quantity: sq,
        wholesalePrice: num(item.wholesalePrice) * sq, profitPrice: num(item.profitPrice) * sq,
        unitPrice: item.totalPrice, totalPrice: num(item.totalPrice) * sq, notes: p.notes || '',
        employee: p.employee || '', date: p.date, warranty: item.warranty || 'بدون ضمان', warrantyPeriod: item.warrantyPeriod || '' }, remainingQuantity: qty - sq };
    }
    case 'sellDevice': {
      const dev = findIn('listDevices', p.deviceId);
      if (!dev) throw new Error('الجهاز غير موجود');
      const qty = num(dev.quantity), sq = Math.max(1, num(p.quantity) || 1);
      if (sq > qty) throw new Error('الكمية المطلوبة (' + sq + ') أكبر من المتاح بالمخزون (' + qty + ')');
      return { sale: { id: p.id, code: dev.code || '', deviceId: dev.id, deviceName: dev.name, deviceType: dev.deviceType || '',
        condition: dev.condition, warranty: dev.warranty, customerName: p.customerName || '',
        customerPhone: p.customerPhone || '', quantity: sq, wholesalePrice: num(dev.wholesalePrice) * sq,
        profitPrice: num(dev.profitPrice) * sq, unitPrice: dev.totalPrice, totalPrice: num(dev.totalPrice) * sq,
        notes: p.notes || '', employee: p.employee || '', date: p.date, warrantyPeriod: dev.warrantyPeriod || '' }, remainingQuantity: qty - sq };
    }
    case 'addReturn': {
      const isDevR = p.saleType === 'device';
      const sale = findIn(isDevR ? 'listDeviceSales' : 'listAccessorySales', p.saleId);
      if (!sale) throw new Error('عملية البيع الأصلية مش موجودة');
      const sold = num(sale.quantity) || 1;
      const already = ((LISTS.listReturns || {}).items || []).filter(function (x) {
        return String(x.saleId) === String(p.saleId) && x.saleType === (isDevR ? 'device' : 'accessory');
      }).reduce(function (t, x) { return t + num(x.quantity); }, 0);
      const q = Math.max(1, num(p.quantity) || 1);
      if (q > sold - already) throw new Error('الكمية المسترجعة (' + q + ') أكبر من المتاح للاسترجاع (' + (sold - already) + ')');
      const wh = (num(sale.wholesalePrice) / sold) * q;
      const refund = p.refundAmount !== undefined && p.refundAmount !== '' ? num(p.refundAmount) : num(sale.unitPrice) * q;
      const restock = (p.restock === false || p.restock === 'false' || p.restock === 'لا') ? 'لا' : 'نعم';
      const itemId = isDevR ? sale.deviceId : sale.itemId;
      const cur = findIn(isDevR ? 'listDevices' : 'listAccessoryItems', itemId);
      return { item: { id: p.id, date: p.date, saleType: isDevR ? 'device' : 'accessory', saleId: sale.id, itemId: itemId,
        itemName: isDevR ? sale.deviceName : sale.itemName, code: sale.code || '', customerName: sale.customerName || '',
        customerPhone: sale.customerPhone || '', quantity: q, wholesalePrice: wh, profitPrice: refund - wh, refundAmount: refund,
        restock: restock, reason: p.reason || '', employee: p.employee || '' },
        newQuantity: (restock === 'نعم' && cur) ? num(cur.quantity) + q : undefined };
    }
    case 'updateAccessoryItem':
    case 'updateDevice': {
      const isDev = op.action === 'updateDevice';
      const cur = findIn(isDev ? 'listDevices' : 'listAccessoryItems', p.id);
      if (!cur) throw new Error(isDev ? 'الجهاز غير موجود' : 'الصنف غير موجود');
      const newCode = String(p.code || '').trim();
      if (newCode && newCode !== String(cur.code) && codeExistsLocal(newCode, cur.id)) {
        throw new Error('الكود ده مستخدم بالفعل لمنتج تاني');
      }
      const w = p.wholesalePrice !== undefined ? num(p.wholesalePrice) : num(cur.wholesalePrice);
      const pr = p.profitPrice !== undefined ? num(p.profitPrice) : num(cur.profitPrice);
      const q = p.quantity !== undefined ? num(p.quantity) : num(cur.quantity);
      const merged = Object.assign({}, cur, { name: p.name ? p.name : cur.name, code: newCode || cur.code,
        wholesalePrice: w, profitPrice: pr, totalPrice: w + pr, quantity: q });
      if (p.warranty) { merged.warranty = p.warranty; merged.warrantyPeriod = p.warranty === 'له ضمان' ? (p.warrantyPeriod || '') : ''; }
      if (isDev) { merged.warranty = p.warranty || cur.warranty; merged.deviceType = p.deviceType || cur.deviceType; }
      else if (p.modelId !== undefined) { merged.modelId = String(p.modelId || ''); merged.modelName = String(p.modelName || ''); }
      return { item: merged };
    }
    case 'moveAccessoryCategory': {
      const newName = String(p.name || '').trim();
      if (!p.id || !newName) throw new Error('بيانات النقل ناقصة');
      if (!findIn('listAccessoryCategories', p.id)) throw new Error('النوع غير موجود');
      const dup = LISTS.listAccessoryCategories.items.some(function (c) {
        return String(c.id) !== String(p.id) && String(c.name) === newName;
      });
      if (dup) throw new Error('فيه نوع بنفس الاسم في القسم التاني');
      return { item: { id: p.id, name: newName } };
    }
    default:
      throw new Error('عملية غير مدعومة أوفلاين: ' + op.action);
  }
}

function upsert(listName, obj) {
  if (!LISTS[listName] && (listName === 'listAccessoryModels' || listName === 'listReturns')) LISTS[listName] = { items: [] };
  if (!LISTS[listName] || !obj) return;
  const arr = LISTS[listName].items;
  const i = arr.findIndex(function (x) { return String(x.id) === String(obj.id); });
  if (i > -1) arr[i] = Object.assign({}, arr[i], obj); else arr.push(obj);
  persistList(listName);
}

// بيطبّق أثر العملية على القوائم اللي على الجهاز (عشان الشاشة تتحدث فورًا)
function applyOp(op, result) {
  const p = op.payload, r = result || {};
  switch (op.action) {
    case 'addMaintenance': upsert('listMaintenance', r.item); break;
    case 'addAccessoryCategory': upsert('listAccessoryCategories', r.item); break;
    case 'addAccessoryModel': upsert('listAccessoryModels', r.item); break;
    case 'addAccessoryItem': upsert('listAccessoryItems', r.item); break;
    case 'addDevice': upsert('listDevices', r.item); break;
    case 'addCashTransfer': upsert('listCashTransfers', r.item); break;
    case 'updateAccessoryItem': upsert('listAccessoryItems', r.item); break;
    case 'updateDevice': upsert('listDevices', r.item); break;
    case 'sellAccessoryItem':
    case 'sellDevice': {
      const isDev = op.action === 'sellDevice';
      if (!r.sale) break;
      upsert(isDev ? 'listDeviceSales' : 'listAccessorySales', r.sale);
      const it = findIn(isDev ? 'listDevices' : 'listAccessoryItems', isDev ? p.deviceId : p.itemId);
      if (it && r.remainingQuantity !== undefined) {
        it.quantity = r.remainingQuantity;
        persistList(isDev ? 'listDevices' : 'listAccessoryItems');
      }
      break;
    }
    case 'addReturn': {
      if (!r.item) break;
      upsert('listReturns', r.item);
      if (r.newQuantity !== undefined) {
        const isDevR = r.item.saleType === 'device';
        const it = findIn(isDevR ? 'listDevices' : 'listAccessoryItems', r.item.itemId);
        if (it) { it.quantity = r.newQuantity; persistList(isDevR ? 'listDevices' : 'listAccessoryItems'); }
      }
      break;
    }
    case 'moveAccessoryCategory': {
      const newName = String(p.name || '').trim();
      const cat = findIn('listAccessoryCategories', p.id);
      if (cat) { cat.name = newName; persistList('listAccessoryCategories'); }
      ((LISTS.listAccessoryItems || {}).items || []).forEach(function (i) {
        if (String(i.categoryId) === String(p.id)) i.categoryName = newName;
      });
      persistList('listAccessoryItems');
      break;
    }
  }
}

async function apiWrite(action, payload) {
  if (ONLINE_ONLY[action]) {
    const d = await api(action, payload);
    LAST_WRITE_QUEUED = false;
    return d;
  }
  const op = { opId: uuid(), action: action, payload: Object.assign({}, payload || {}) };
  prepareOp(op);

  // لو النت شغال ومفيش حاجة مستنية: ابعت للسيرفر على طول (وتظهر أي أخطاء فورًا)
  if (!QUEUE.length && canTryNetwork()) {
    try {
      const data = await api(action, op.payload);
      applyOp(op, data);
      LAST_WRITE_DONE = Date.now();
      LAST_WRITE_QUEUED = false;
      return data;
    } catch (err) {
      if (!err.isNetwork) throw err; // رفض من السيرفر (مثلًا مخزون مش كفاية)
    }
  }

  // مفيش نت (أو فيه عمليات سابقة مستنية): احفظ على الجهاز وارفع بعدين
  const result = localResult(op);
  QUEUE.push(op);
  const saved = await saveQueue();
  if (!saved) toast('تحذير: المتصفح مش بيسمح بالتخزين، العملية هتضيع لو قفلت الصفحة قبل الرفع', 'error');
  applyOp(op, result);
  LAST_WRITE_DONE = Date.now();
  LAST_WRITE_QUEUED = true;
  updateNetStatus();
  setTimeout(function () { if (canTryNetwork()) flushQueue(); }, 2000);
  return result;
}

/* ---------- رفع الطابور ---------- */

function flushQueue() {
  if (FLUSH_PROMISE) return FLUSH_PROMISE;
  if (!QUEUE.length || !canTryNetwork()) return Promise.resolve();
  FLUSH_PROMISE = doFlush().then(null, function () {}).then(function () {
    FLUSH_PROMISE = null;
    updateNetStatus();
  });
  updateNetStatus();
  return FLUSH_PROMISE;
}

async function doFlush() {
  const t = toast('جاري رفع العمليات المحفوظة (' + QUEUE.length + ')...', 'loading', true);
  let synced = 0, failedNow = 0, stopped = false, errMsg = '';

  while (QUEUE.length) {
    const batch = QUEUE.slice(0, 10);
    let data;
    try {
      data = await api('batch', { ops: batch.map(function (o) { return { action: o.action, payload: o.payload }; }) }, 90000);
    } catch (err) {
      stopped = true;
      if (!err.isNetwork) errMsg = err.message;
      break;
    }
    const results = data.results || [];
    const done = {};
    batch.forEach(function (op, i) {
      const r = results[i];
      if (!r) return;
      done[op.opId] = true;
      if (r.ok) synced++;
      else { failedNow++; FAILED.push({ op: op, error: r.error || 'خطأ غير معروف', time: localNowStr() }); }
    });
    QUEUE = QUEUE.filter(function (o) { return !done[o.opId]; });
    await saveQueue();
    await saveFailed();
    updateNetStatus();
    if (Object.keys(done).length < batch.length) { stopped = true; break; }
  }

  if (stopped && errMsg) {
    const hint = errMsg.indexOf('غير معروف') > -1 ? ' — لازم تحدّث Code.gs وتنشر نسخة جديدة' : '';
    t.update('تعذر رفع العمليات: ' + errMsg + hint, 'error');
  } else if (stopped) {
    t.update('الاتصال ضعيف — العمليات لسه محفوظة وهتترفع تلقائي', 'error');
  } else if (failedNow) {
    t.update('اترفع ' + synced + ' وفشل ' + failedNow + ' — اضغط على "عملية فشلت" فوق للتفاصيل', 'error');
  } else {
    t.update('تم رفع ' + synced + ' عملية بنجاح', 'success');
  }

  if (!stopped) {
    Object.keys(LIST_TIME).forEach(function (k) { delete LIST_TIME[k]; });
    refreshAllLists(); // نسحب النسخة الرسمية من الشيت
  }
}

/* ---------- العمليات اللي فشلت ---------- */

function openFailedOps() {
  const rows = FAILED.map(function (f, i) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">' +
      '<div><strong>' + escHtml(describeOp(f.op)) + '</strong> — <span style="color:var(--danger)">' + escHtml(f.error) + '</span></div>' +
      '<button class="link-btn" data-failed-del="' + i + '" style="flex:none">حذف</button></div>';
  }).join('') || '<div class="empty-state">لا توجد عمليات فاشلة</div>';

  const overlay = openModal('عمليات فشلت',
    rows +
    '<div class="modal-actions"><button type="button" class="btn btn-outline" id="close-failed">إغلاق</button></div>',
    function (el) {
      el.querySelector('#close-failed').addEventListener('click', function () { overlay.remove(); });
      el.querySelectorAll('[data-failed-del]').forEach(function (b) {
        b.addEventListener('click', async function () {
          FAILED.splice(Number(b.getAttribute('data-failed-del')), 1);
          await saveFailed();
          overlay.remove();
          updateNetStatus();
          if (FAILED.length) openFailedOps();
          refreshAllLists();
        });
      });
    });
}

/* ---------- ربط الأحداث ---------- */

document.addEventListener('click', function (e) {
  const b = e.target.closest ? e.target.closest('[data-net-act]') : null;
  if (!b) return;
  if (b.getAttribute('data-net-act') === 'failed') { openFailedOps(); return; }
  NET_DOWN_UNTIL = 0;
  if (QUEUE.length) flushQueue(); else refreshAllLists();
});

window.addEventListener('online', function () {
  NET_DOWN_UNTIL = 0; NET_LAST_OK = null;
  updateNetStatus();
  if (QUEUE.length) flushQueue();
});
window.addEventListener('offline', function () { NET_LAST_OK = false; updateNetStatus(); });

setInterval(function () {
  if (QUEUE.length && canTryNetwork()) flushQueue();
  else if (NET_LAST_OK === false && canTryNetwork()) api('ping').catch(function () {}); // اختبار رجوع النت
  updateNetStatus();
}, 20000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () { /* مش مشكلة لو المتصفح رفض */ });
  });
}
