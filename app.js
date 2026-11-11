/* ============ حالة عامة ============ */
let CURRENT_USER = null;
try { CURRENT_USER = JSON.parse(localStorage.getItem('connect_user') || 'null'); } catch (e) { CURRENT_USER = null; }
// جلسة قديمة من غير توقيع من السيرفر: لازم تسجيل دخول جديد (العمليات المحفوظة على الجهاز مش بتتأثر)
if (CURRENT_USER && !CURRENT_USER.token) { CURRENT_USER = null; try { localStorage.removeItem('connect_user'); } catch (e) { /* تجاهل */ } }
let CURRENT_SECTION = 'dashboard';
let CACHE = {};
const ROLE_VIEWER = 'مدير (عرض فقط)';
const ROLE_ACCOUNTS = 'حسابات';
function isViewer() { return !!CURRENT_USER && CURRENT_USER.role === ROLE_VIEWER; }
function isAccounts() { return !!CURRENT_USER && CURRENT_USER.role === ROLE_ACCOUNTS; }
// بيشوف من غير سعر الجملة/المكسب: المدير (عرض فقط) وحساب الحسابات
function hideCosts() { return isViewer() || isAccounts(); }
// تعديل/إضافة أصناف وأجهزة: مش متاح للمدير (عرض فقط) ولا للحسابات
function canEdit() { return !!CURRENT_USER && !isViewer() && !isAccounts(); }
//  // كاش بسيط للبيانات المجلوبة من الشيت

const root = document.getElementById('root');

/* ============ اتصال بالـ API ============ */

async function api(action, payload, timeoutMs) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
    throw new Error('لسه مظبطتش رابط الـ Apps Script في ملف config.js');
  }
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, timeoutMs || 20000);
  let data;
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action, uid: CURRENT_USER ? CURRENT_USER.id : undefined, token: CURRENT_USER ? CURRENT_USER.token : undefined }, payload || {})),
      signal: ctl.signal
    });
    data = await res.json();
  } catch (e) {
    clearTimeout(timer);
    markNetDown();
    const ne = new Error('مفيش اتصال بالإنترنت');
    ne.isNetwork = true;
    throw ne;
  }
  clearTimeout(timer);
  markNetUp();
  if (data && data.authError) {
    handleAuthExpired(data.error);
    const ae = new Error(data.error || 'انتهت الجلسة، سجّل الدخول من جديد');
    ae.isAuth = true;
    throw ae;
  }
  if (data && data.busy) { // السيرفر مشغول بعملية تانية: نعامله زي انقطاع مؤقت (العملية بتتحفظ وتتعاد)
    const be = new Error(data.error || 'السيرفر مشغول');
    be.isNetwork = true; be.busy = true;
    throw be;
  }
  if (!data.ok || data.error) throw new Error(data.error || 'حصل خطأ غير معروف');
  return data;
}

// الجلسة انتهت أو اتغيرت صلاحيتها: نرجّع لشاشة الدخول من غير ما نمسح العمليات المحفوظة على الجهاز
function handleAuthExpired(msg) {
  if (!CURRENT_USER) return;
  try { localStorage.removeItem('connect_user'); } catch (e) { /* تجاهل */ }
  CURRENT_USER = null;
  PREFETCHED = false;
  closeModals();
  renderLogin(msg || 'انتهت الجلسة، سجّل الدخول من جديد');
}

// نظام كاش بسيط: أول مرة بيجيب البيانات من الشيت، وبعد كده بيرجعها فورًا من الذاكرة
// من غير ما ينتظر السيرفر تاني، لحد ما البيانات تتغير فعليًا (عملية إضافة/بيع/تعديل)
// أو يعدي وقت الصلاحية (60 ثانية) كحماية إضافية لو حد تاني غيّر حاجة من مكان تاني.
const CACHE_TTL_MS = 60000;
// مؤشر "جاري تحديث البيانات..." تحت في الجنب: بيظهر لما نجيب بيانات من الشيت، وبيتحول لـ "تم تحديث البيانات" بعد ما تخلص
let ACTIVE_READS = 0, READ_FAILED = false, refreshToast = null, refreshTimer = null;
function readStarted() {
  ACTIVE_READS++;
  if (ACTIVE_READS === 1 && !refreshToast && !refreshTimer) {
    // تأخير بسيط عشان الطلبات السريعة جدًا متعملش وميض
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshToast = toast('جاري تحديث البيانات...', 'loading', true);
    }, 250);
  }
}
function readFinished() {
  ACTIVE_READS = Math.max(0, ACTIVE_READS - 1);
  if (ACTIVE_READS > 0) return;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; READ_FAILED = false; return; }
  if (refreshToast) {
    refreshToast.update(READ_FAILED ? 'تعذر تحديث البيانات' : 'تم تحديث البيانات', READ_FAILED ? 'error' : 'success');
    refreshToast = null;
  }
  READ_FAILED = false;
}
// تحميل مسبق لأهم القوائم بعد الدخول، عشان التنقل بين الصفحات يبقى فوري
let PREFETCHED = false;
function prefetchAll() {
  if (PREFETCHED || !CURRENT_USER) return;
  PREFETCHED = true;
  ['listMaintenance', 'listAccessorySales', 'listDeviceSales', 'listAccessoryItems', 'listReturns',
   'listDevices', 'listAccessoryCategories', 'listAccessoryModels', 'listCashTransfers'].forEach(function (a) {
    cachedApi(a).catch(function () {});
  });
}

// إشعار في الجنب تحت. بيرجع كائن فيه update() عشان نغيّر الرسالة (من "جاري..." لـ "تم")
function toast(msg, type, sticky) {
  let box = document.getElementById('side-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'side-toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  box.appendChild(el);
  let timer = null;
  function set(m, t, keep) {
    el.className = 'side-toast ' + (t || '');
    el.innerHTML = (t === 'loading' ? '<span class="spin"></span>' : '') + '<span></span>';
    el.lastChild.textContent = m;
    clearTimeout(timer);
    if (!keep) timer = setTimeout(function () { el.remove(); }, t === 'error' ? 5000 : 3000);
  }
  set(msg, type, sticky);
  return { update: set, close: function () { clearTimeout(timer); el.remove(); } };
}

// بيقفل شاشة الإضافة فورًا، بيكتب "يتم إضافة البيانات..." في الجنب، ويكمل الحفظ في الخلفية.
// لو الحفظ فشل بيرجّع الشاشة بنفس البيانات اللي اتكتبت عشان متضيعش.
async function saveInBackground(overlay, work, opts) {
  opts = opts || {};
  if (overlay._saving) return;
  overlay._saving = true;
  overlay.style.display = 'none';
  const t = toast('يتم إضافة البيانات...', 'loading', true);
  let result;
  try {
    result = await work();
  } catch (err) {
    overlay._saving = false;
    overlay.style.display = '';
    t.update(err.message, 'error');
    return;
  }
  overlay.remove();
  t.update(savedMsg(opts.successMsg || 'تمت إضافة البيانات بنجاح'), 'success');
  if (opts.onDone) opts.onDone(result);
}

/* ============ تسجيل الدخول ============ */

function renderLogin(errorMsg) {
  document.body.classList.remove('viewer');
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="logo-icon.webp" class="logo-mark" alt="Connect" />
        <h1>${SHOP_NAME}</h1>
        <p class="subtitle">نظام إدارة المحل — سجّل دخولك للمتابعة</p>
        ${errorMsg ? `<div class="error-msg">${escHtml(errorMsg)}</div>` : ''}
        <form id="login-form">
          <div class="field">
            <label>اسم المستخدم</label>
            <input type="text" name="username" required autocomplete="username" />
          </div>
          <div class="field">
            <label>كلمة المرور</label>
            <input type="password" name="password" required autocomplete="current-password" />
          </div>
          <button class="btn btn-primary btn-block" type="submit">دخول</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'جاري الدخول...';
    try {
      const data = await api('login', { username: fd.get('username'), password: fd.get('password') });
      CURRENT_USER = Object.assign({}, data.user, { token: data.token });
      localStorage.setItem('connect_user', JSON.stringify(CURRENT_USER));
      prefetchAll();
      renderApp();
    } catch (err) {
      renderLogin(err.isNetwork ? 'أول تسجيل دخول على الجهاز محتاج إنترنت. اتصل بالنت وجرّب تاني.' : err.message);
    }
  });
}

function logout() {
  if (QUEUE.length && !confirm('فيه ' + QUEUE.length + ' عملية لسه متترفعتش للسيرفر. هتفضل محفوظة على الجهاز وهتترفع أول ما النت يرجع. تسجيل الخروج؟')) return;
  localStorage.removeItem('connect_user');
  CURRENT_USER = null;
  PREFETCHED = false;
  CACHE = {};
  renderLogin();
}

/* ============ الهيكل الرئيسي ============ */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'الرئيسية', icon: '🏠' },
  { id: 'scan', label: 'فاتورة بيع', icon: '🧾', noViewer: true },
  { id: 'maintenance', label: 'الصيانة', icon: '🛠️' },
  { id: 'accessories', label: 'الإكسسوارات', icon: '🎧' },
  { id: 'devices', label: 'الأجهزة', icon: '📱' },
  { id: 'cash', label: 'تحويلات الكاش', icon: '💵' },
  { id: 'inventory', label: 'المخزون', icon: '📦', noViewer: true, noAccounts: true },
  { id: 'returns', label: 'المسترجع', icon: '↩️' },
  { id: 'debts', label: 'الآجل', icon: '⏳' },
  { id: 'accounting', label: 'الحسابات', icon: '📊' },
  { id: 'hr', label: 'الحضور والمرتبات', icon: '🧑‍💼', adminOnly: true },
  { id: 'users', label: 'الموظفين', icon: '👤', adminOnly: true }
];

function renderApp() {
  if (!CURRENT_USER) return renderLogin();
  document.body.classList.toggle('viewer', isViewer());
  if (isAccounts() && CURRENT_SECTION === 'inventory') CURRENT_SECTION = 'dashboard';
  if (isViewer() && (CURRENT_SECTION === 'scan' || CURRENT_SECTION === 'inventory' || CURRENT_SECTION === 'users')) CURRENT_SECTION = 'dashboard';

  const navHtml = NAV_ITEMS
    .filter(function (item) { return (!item.adminOnly || CURRENT_USER.role === 'مدير النظام') && !(item.noViewer && isViewer()) && !(item.noAccounts && isAccounts()); })
    .map(function (item) {
      return `<li><button class="nav-btn ${item.id === CURRENT_SECTION ? 'active' : ''}" data-nav="${escHtml(item.id)}">
        <span>${item.icon}</span><span class="label">${item.label}</span>
      </button></li>`;
    }).join('');

  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="logo-icon.webp" class="logo-mark" alt="Connect" />
          <div><strong>${SHOP_NAME}</strong><span>موبايلات واكسسوارات</span></div>
        </div>
        <div class="gsearch-box"><input type="search" id="gsearch-input" placeholder="🔍 ابحث عن أي حاجة..." autocomplete="off" /></div>
        <ul class="nav-list">${navHtml}</ul>
        <div class="user-box">
          <div class="name">${escHtml(CURRENT_USER.name)}</div>
          <div class="role">${escHtml(CURRENT_USER.role)}</div>
          <button class="btn btn-outline btn-sm btn-block" id="logout-btn">تسجيل الخروج</button>
        </div>
      </aside>
      <div class="main-area">
        <div class="topbar">
          <div>
            <h2 id="page-title"></h2>
            <div class="breadcrumb" id="page-breadcrumb"></div>
          </div>
          <div id="net-status" class="net-status"></div>
        </div>
        <div class="content" id="page-content"></div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      CURRENT_SECTION = btn.getAttribute('data-nav');
      renderApp();
    });
  });
  document.getElementById('logout-btn').addEventListener('click', logout);
  initGlobalSearch();

  const titleMap = {};
  NAV_ITEMS.forEach(function (i) { titleMap[i.id] = i.label; });
  document.getElementById('page-title').textContent = titleMap[CURRENT_SECTION] || '';

  const renderers = {
    dashboard: renderDashboard,
    scan: renderScan,
    returns: renderReturns,
    debts: renderDebts,
    maintenance: renderMaintenance,
    accessories: renderAccessories,
    devices: renderDevices,
    cash: renderCash,
    inventory: renderInventory,
    accounting: renderAccounting,
    users: renderUsers,
    hr: renderHr
  };
  updateNetStatus();
  (renderers[CURRENT_SECTION] || renderDashboard)();
}

function content() { return document.getElementById('page-content'); }

function setBreadcrumb(text) {
  document.getElementById('page-breadcrumb').textContent = text || '';
}

/* ============ مودال عام ============ */

function openModal(title, bodyHtml, onMount) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h3>${escHtml(title)}</h3><div id="modal-body">${bodyHtml}</div></div>`;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
  return overlay;
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(function (m) { m.remove(); });
}

/* ============ الرئيسية (Dashboard) ============ */

async function renderDashboard() {
  setBreadcrumb('نظرة عامة سريعة');
  content().innerHTML = `<div class="empty-state">جاري تحميل البيانات...</div>`;
  try {
    const [maint, accSales, devSales, accItems, devices] = await Promise.all([
      cachedApi('listMaintenance'), cachedApi('listAccessorySales'), cachedApi('listDeviceSales'),
      cachedApi('listAccessoryItems'), cachedApi('listDevices')
    ]);
    const today = localNowStr().substring(0, 10); // تاريخ الجهاز المحلي (toISOString كان بيدّي تاريخ UTC: يوم غلط بعد منتصف الليل)
    const todaySales = [].concat(maint.items, accSales.items, devSales.items)
      .filter(function (r) { return String(r.date).substring(0, 10) === today; });
    const todayTotal = todaySales.reduce(function (s, r) { return s + Number(r.total || r.totalPrice || 0); }, 0);
    const todayProfit = todaySales.reduce(function (s, r) { return s + Number(r.profitCost || r.profitPrice || 0); }, 0);
    let retToday = [];
    try { retToday = ((await cachedApi('listReturns')).items || []).filter(function (r) { return String(r.date).substring(0, 10) === today; }); } catch (e) { /* ignore */ }
    const retTotal = retToday.reduce(function (t, r) { return t + Number(r.refundAmount || 0); }, 0);
    // الربح اللي ضاع بسبب المسترجع: لو القطعة رجعت المخزون بنخسر (المرتجع - الجملة)، ولو لأ بنخسر المبلغ كله (نفس منطق الحسابات)
    const retProfit = retToday.reduce(function (t, r) {
      const refund = Number(r.refundAmount || 0);
      return t + (r.restock === 'نعم' ? refund - Number(r.wholesalePrice || 0) : refund);
    }, 0);
    // تحويلات الكاش: بتظهر لوحدها (مش جوه المبيعات والأرباح) عشان مبلغ التحويل مش بيع
    let cashToday = [];
    try { cashToday = ((await cachedApi('listCashTransfers')).items || []).filter(function (r) { return String(r.date).substring(0, 10) === today; }); } catch (e) { /* ignore */ }
    const cashTotal = cashToday.reduce(function (t, r) { return t + Number(r.amount || 0); }, 0);
    const lowStock = accItems.items.filter(function (i) { return Number(i.quantity) <= 2; }).length
      + devices.items.filter(function (i) { return Number(i.quantity) <= 2; }).length;

    content().innerHTML = `
      <div class="grid grid-4">
        <div class="card stat-card"><div class="stat-label">مبيعات اليوم</div><div class="stat-value brown">${(todayTotal - retTotal).toLocaleString()} ج.م</div></div>
        ${hideCosts() ? '' : `<div class="card stat-card"><div class="stat-label">أرباح اليوم</div><div class="stat-value dark">${(todayProfit - retProfit).toLocaleString()} ج.م</div></div>`}
        <div class="card stat-card"><div class="stat-label">عمليات اليوم</div><div class="stat-value dark">${todaySales.length}</div></div>
        ${isViewer() ? '' : `<div class="card stat-card"><div class="stat-label">أصناف على وشك النفاذ</div><div class="stat-value brown">${lowStock}</div></div>`}
        <div class="card stat-card"><div class="stat-label">تحويلات كاش اليوم (المبلغ)</div><div class="stat-value dark">${cashTotal.toLocaleString()} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">عدد تحويلات الكاش اليوم</div><div class="stat-value dark">${cashToday.length}</div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">آخر العمليات اليوم</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الوقت</th><th>النوع</th><th>العميل</th><th>الإجمالي</th><th>الموظف</th></tr></thead>
            <tbody>
              ${todaySales.concat(cashToday).slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).slice(-10).reverse().map(function (r) {
                const type = r.deviceCategory ? 'صيانة' : (r.categoryName ? 'اكسسوار' : (r.amount !== undefined && r.type ? 'كاش — ' + r.type : 'جهاز'));
                return `<tr><td>${String(r.date).substring(11)}</td><td>${type}</td><td>${escHtml(r.customerName || '-')}</td>
                <td>${Number(r.total || r.totalPrice || r.amount || 0).toLocaleString()} ج.م</td><td>${escHtml(r.employee || '-')}</td></tr>`;
              }).join('') || `<tr><td colspan="5" class="empty-state">لا توجد عمليات اليوم بعد</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    content().innerHTML = `<div class="empty-state">تعذر تحميل البيانات: ${escHtml(err.message)}</div>`;
  }
}

/* ============ بيع بالباركود / الكود ============ */

let scanCustomer = { name: '', phone: '' };

let scanCart = []; // [{ type: 'accessory'|'device', item, qty }]
let scanDiscount = '';       // خصم على الفاتورة كلها (ج.م)
let scanPayMode = 'full';    // full | credit
let scanPaid = '';           // المدفوع الآن لو آجل
let scanDue = '';            // ميعاد سداد الباقي (YYYY-MM-DD)
let scanProducts = []; // كل الأصناف والأجهزة للبحث بالاسم أو الكود

async function loadScanProducts() {
  try {
    const r = await Promise.all([cachedApi('listAccessoryItems'), cachedApi('listDevices')]);
    scanProducts = [];
    (r[0].items || []).forEach(function (i) { scanProducts.push({ type: 'accessory', item: i }); });
    (r[1].items || []).forEach(function (i) { scanProducts.push({ type: 'device', item: i }); });
  } catch (e) { /* نكمل بالموجود */ }
}

function scanProductLabel(p) {
  const i = p.item;
  return p.type === 'accessory'
    ? dispCat(i.categoryName || '') + (i.modelName ? ' / ' + i.modelName : '')
    : [i.deviceType, i.condition].filter(Boolean).join(' - ');
}

async function renderScan() {
  setBreadcrumb('فاتورة بيع: ابحث بالاسم أو الكود وضيف أكتر من صنف');
  content().innerHTML = `
    <div class="grid grid-2" style="align-items:start">
      <div>
        <div class="card">
          <h3 style="margin-top:0">بيانات العميل</h3>
          <div class="grid grid-2">
            <div class="field"><label>اسم العميل</label><input type="text" id="scan-customer-name" value="${escHtml(scanCustomer.name)}" /></div>
            <div class="field"><label>رقم العميل</label><input type="text" id="scan-customer-phone" value="${escHtml(scanCustomer.phone)}" /></div>
          </div>
        </div>
        <div class="card" style="margin-top:16px">
          <h3 style="margin-top:0">إضافة صنف للفاتورة</h3>
          <div class="field">
            <label>اكتب اسم المنتج أو الكود (Enter لو الكود مظبوط)</label>
            <input type="text" id="scan-code-input" placeholder="مثال: شاحن، أو 123456" autocomplete="off" />
          </div>
          <div id="scan-suggestions"></div>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">الفاتورة</h3>
        <div id="scan-cart"></div>
      </div>
    </div>
    <div id="scan-result" style="max-width:520px;margin-top:16px"></div>
  `;
  renderScanCart();
  const input = document.getElementById('scan-code-input');
  input.focus();
  input.addEventListener('input', function () { showScanSuggestions(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doScanSearch(); }
  });
  await loadScanProducts();
  if (input.value) showScanSuggestions(input.value);
}

function readScanCustomer() {
  const n = document.getElementById('scan-customer-name');
  const p = document.getElementById('scan-customer-phone');
  if (n) scanCustomer.name = n.value.trim();
  if (p) scanCustomer.phone = p.value.trim();
}

function showScanSuggestions(q) {
  const box = document.getElementById('scan-suggestions');
  if (!box) return;
  q = String(q || '').trim().toLowerCase();
  if (!q) { box.innerHTML = ''; return; }
  const found = scanProducts.filter(function (p) {
    return String(p.item.name || '').toLowerCase().indexOf(q) !== -1 || String(p.item.code || '').toLowerCase().indexOf(q) !== -1;
  }).slice(0, 8);
  if (!found.length) { box.innerHTML = '<div class="empty-state" style="padding:12px">مفيش نتائج. لو الصنف جديد اضغط Enter وتقدر تضيفه.</div>'; return; }
  box.innerHTML = found.map(function (p, idx) {
    const out = Number(p.item.quantity) <= 0;
    return '<button type="button" class="btn btn-dark btn-block" style="justify-content:space-between;margin-bottom:6px;' + (out ? 'opacity:.5' : '') + '" data-idx="' + scanProducts.indexOf(p) + '">' +
      '<span>' + escHtml(p.item.name) + ' <small style="color:var(--text-muted)">' + escHtml(scanProductLabel(p)) + ' — ' + escHtml(p.item.code) + '</small></span>' +
      '<span>' + Number(p.item.totalPrice).toLocaleString() + ' ج.م · متاح ' + p.item.quantity + '</span></button>';
  }).join('');
  box.querySelectorAll('button[data-idx]').forEach(function (btn) {
    btn.addEventListener('click', function () { addToScanCart(scanProducts[Number(btn.getAttribute('data-idx'))]); });
  });
}

async function doScanSearch() {
  readScanCustomer();
  const input = document.getElementById('scan-code-input');
  const q = (input && input.value || '').trim();
  const resultBox = document.getElementById('scan-result');
  if (!q) { toast('اكتب اسم المنتج أو الكود الأول', 'error'); return; }
  if (resultBox) resultBox.innerHTML = '';
  await loadScanProducts();
  const exact = scanProducts.filter(function (p) { return String(p.item.code) === q; })[0];
  if (exact) { addToScanCart(exact); return; }
  const lower = q.toLowerCase();
  const matches = scanProducts.filter(function (p) { return String(p.item.name || '').toLowerCase().indexOf(lower) !== -1; });
  if (matches.length === 1) { addToScanCart(matches[0]); return; }
  if (matches.length > 1) { showScanSuggestions(q); toast('في أكتر من نتيجة، اختار الصنف من القايمة', 'error'); return; }
  renderScanNotFound(q);
}

function addToScanCart(p) {
  if (!p) return;
  if (Number(p.item.quantity) <= 0) { toast('الصنف ده غير متاح في المخزون', 'error'); return; }
  const ex = scanCart.filter(function (c) { return c.type === p.type && String(c.item.id) === String(p.item.id); })[0];
  if (ex) {
    if (ex.qty + 1 > Number(p.item.quantity)) { toast('وصلت لأقصى كمية متاحة (' + p.item.quantity + ')', 'error'); return; }
    ex.qty += 1;
  } else {
    scanCart.push({ type: p.type, item: p.item, qty: 1 });
  }
  const input = document.getElementById('scan-code-input');
  if (input) { input.value = ''; input.focus(); }
  const sg = document.getElementById('scan-suggestions'); if (sg) sg.innerHTML = '';
  const rb = document.getElementById('scan-result'); if (rb) rb.innerHTML = '';
  renderScanCart();
}

function scanCartTotal() {
  return scanCart.reduce(function (t, c) { return t + Number(c.item.totalPrice) * c.qty; }, 0);
}

function renderScanCart() {
  const box = document.getElementById('scan-cart');
  if (!box) return;
  if (!scanCart.length) { box.innerHTML = '<div class="empty-state">الفاتورة فاضية، ضيف صنف من البحث</div>'; return; }
  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th></th></tr></thead>
      <tbody>
        ${scanCart.map(function (c, i) {
          return '<tr><td>' + escHtml(c.item.name) + '</td>' +
            '<td>' + Number(c.item.totalPrice).toLocaleString() + '</td>' +
            '<td><input type="number" min="1" max="' + c.item.quantity + '" value="' + c.qty + '" data-qty="' + i + '" style="width:64px;padding:6px;border-radius:6px;border:1px solid var(--border);background:var(--charcoal-3);color:var(--text)" /></td>' +
            '<td>' + (Number(c.item.totalPrice) * c.qty).toLocaleString() + '</td>' +
            '<td><button type="button" class="link-btn" data-del="' + i + '">حذف</button></td></tr>';
        }).join('')}
      </tbody>
    </table></div>
    <div style="margin:14px 0;display:grid;gap:10px">
      <div style="display:flex;justify-content:space-between"><span>الإجمالي قبل الخصم</span><span>${scanCartTotal().toLocaleString()} ج.م</span></div>
      <div class="field" style="margin:0"><label>خصم على الفاتورة (ج.م)</label><input type="number" min="0" step="any" id="scan-discount" value="${escHtml(scanDiscount)}" placeholder="0" /></div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800"><span>الصافي المطلوب</span><span class="stat-value brown" id="scan-net" style="font-size:20px"></span></div>
      <div class="field" style="margin:0"><label>طريقة الدفع</label>
        <select id="scan-paymode"><option value="full">دفع كامل</option><option value="credit">آجل (يدفع جزء والباقي بعدين)</option></select>
      </div>
      <div id="scan-credit-box" style="display:none;gap:10px">
        <div class="field" style="margin:0"><label>المدفوع دلوقتي (ج.م)</label><input type="number" min="0" step="any" id="scan-paid" value="${escHtml(scanPaid)}" placeholder="0" /></div>
        <div style="display:flex;justify-content:space-between;font-weight:800"><span>المتبقي على العميل</span><span id="scan-remaining" style="color:#e0a060"></span></div>
        <div class="field" style="margin:0"><label>ميعاد سداد الباقي</label><input type="date" id="scan-due" value="${escHtml(scanDue)}" /></div>
      </div>
    </div>
    <div class="grid grid-2">
      <button class="btn btn-primary" id="scan-checkout">تأكيد البيع وطباعة</button>
      <button class="btn btn-outline" id="scan-clear">مسح الفاتورة</button>
    </div>
  `;
  box.querySelectorAll('input[data-qty]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const c = scanCart[Number(inp.getAttribute('data-qty'))];
      let v = Math.floor(Number(inp.value) || 1);
      v = Math.max(1, Math.min(v, Number(c.item.quantity)));
      c.qty = v;
      renderScanCart();
    });
  });
  box.querySelectorAll('button[data-del]').forEach(function (btn) {
    btn.addEventListener('click', function () { scanCart.splice(Number(btn.getAttribute('data-del')), 1); renderScanCart(); });
  });
  document.getElementById('scan-clear').addEventListener('click', function () { scanCart = []; renderScanCart(); });
  document.getElementById('scan-checkout').addEventListener('click', checkoutScanCart);
  document.getElementById('scan-paymode').value = scanPayMode;
  document.getElementById('scan-discount').addEventListener('input', function (e) { scanDiscount = e.target.value; updateScanTotals(); });
  document.getElementById('scan-paymode').addEventListener('change', function (e) { scanPayMode = e.target.value; updateScanTotals(); });
  document.getElementById('scan-paid').addEventListener('input', function (e) { scanPaid = e.target.value; updateScanTotals(); });
  document.getElementById('scan-due').addEventListener('input', function (e) { scanDue = e.target.value; });
  updateScanTotals();
}

function scanDiscountVal() { return Math.min(Math.max(0, Number(scanDiscount) || 0), scanCartTotal()); }
function scanNetTotal() { return Math.round((scanCartTotal() - scanDiscountVal()) * 100) / 100; }
function scanPaidVal() {
  const n = scanNetTotal();
  return scanPayMode === 'credit' ? Math.max(0, Math.min(Number(scanPaid) || 0, n)) : n;
}
function updateScanTotals() {
  const net = document.getElementById('scan-net'); if (!net) return;
  net.textContent = scanNetTotal().toLocaleString() + ' ج.م';
  const box = document.getElementById('scan-credit-box');
  box.style.display = scanPayMode === 'credit' ? 'grid' : 'none';
  const rem = document.getElementById('scan-remaining');
  if (rem) rem.textContent = (Math.round((scanNetTotal() - scanPaidVal()) * 100) / 100).toLocaleString() + ' ج.م';
  const dis = document.getElementById('scan-discount');
  if (dis && Number(scanDiscount) > scanCartTotal()) dis.style.borderColor = '#e55'; else if (dis) dis.style.borderColor = '';
}

let SCAN_CHECKOUT_BUSY = false;
async function checkoutScanCart() {
  if (SCAN_CHECKOUT_BUSY) return;
  readScanCustomer();
  if (!scanCart.length) { toast('الفاتورة فاضية', 'error'); return; }
  if (!scanCustomer.name || !scanCustomer.phone) { toast('محتاج اسم العميل ورقمه الأول', 'error'); return; }
  const subtotal = scanCartTotal();
  if (Number(scanDiscount) > subtotal) { toast('الخصم أكبر من إجمالي الفاتورة', 'error'); return; }
  const disc = scanDiscountVal();
  const net = scanNetTotal();
  const credit = scanPayMode === 'credit';
  const paidNow = scanPaidVal();
  const dueDate = scanDue;
  if (credit) {
    if (paidNow >= net) { toast('المدفوع لازم يكون أقل من الصافي، أو اختار "دفع كامل"', 'error'); return; }
    if (!dueDate) { toast('حدد ميعاد سداد الباقي', 'error'); return; }
  }
  SCAN_CHECKOUT_BUSY = true;
  const btn = document.getElementById('scan-checkout');
  if (btn) { btn.disabled = true; btn.textContent = 'جاري التسجيل...'; }
  const sold = [];
  let failure = null;
  const lines = scanCart.slice();
  // توزيع الخصم على الأصناف بنسبة سعر كل سطر (والأخير ياخد الباقي)
  const lineTotals = lines.map(function (c) { return Number(c.item.totalPrice) * c.qty; });
  let discLeft = disc;
  const alloc = lineTotals.map(function (lt, i) {
    if (i === lines.length - 1) return Math.max(0, Math.min(discLeft, lt));
    const d = Math.max(0, Math.min(Math.round(disc * lt / subtotal * 100) / 100, lt, discLeft));
    discLeft = Math.round((discLeft - d) * 100) / 100;
    return d;
  });
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i];
    try {
      const base = { customerName: scanCustomer.name, customerPhone: scanCustomer.phone, quantity: c.qty, notes: '', employee: CURRENT_USER.name, discount: alloc[i] };
      const result = c.type === 'accessory'
        ? await apiWrite('sellAccessoryItem', Object.assign({ itemId: c.item.id }, base))
        : await apiWrite('sellDevice', Object.assign({ deviceId: c.item.id }, base));
      sold.push({ name: c.item.name, qty: c.qty, unit: Number(c.item.totalPrice), total: Number(result.sale.totalPrice), discount: Number(result.sale.discount) || 0, warranty: result.sale.warranty === 'له ضمان' ? warrantyLabel(result.sale) : '' });
      scanCart = scanCart.filter(function (x) { return x !== c; });
    } catch (err) {
      failure = { name: c.item.name, message: err.message };
      break;
    }
  }
  SCAN_CHECKOUT_BUSY = false;
  invalidateProductCaches();
  if (sold.length) {
    const soldNet = sold.reduce(function (t, x) { return t + x.total; }, 0);
    let debt = null;
    if (credit) {
      const paidSold = Math.min(paidNow, soldNet);
      if (paidSold < soldNet) {
        try {
          await apiWrite('addDebt', {
            customerName: scanCustomer.name, customerPhone: scanCustomer.phone, total: soldNet, paid: paidSold, dueDate: dueDate,
            items: sold.map(function (x) { return x.name + ' ×' + x.qty; }).join('، '), notes: '', employee: CURRENT_USER.name
          });
          debt = { paid: paidSold, remaining: Math.round((soldNet - paidSold) * 100) / 100, dueDate: dueDate };
        } catch (err) {
          toast('اتسجلت الفاتورة بس فشل تسجيل الآجل: ' + err.message + ' — سجّله يدويًا', 'error');
        }
      }
    }
    toast(savedMsg(failure ? 'اتسجل جزء من الفاتورة' : 'تم تسجيل الفاتورة'), failure ? 'error' : 'success');
    printReceipt({
      customerName: scanCustomer.name, customerPhone: scanCustomer.phone, employee: CURRENT_USER.name,
      items: sold, total: soldNet,
      subtotal: sold.reduce(function (t, x) { return t + x.unit * x.qty; }, 0),
      discount: sold.reduce(function (t, x) { return t + x.discount; }, 0), debt: debt
    });
    scanDiscount = ''; scanPayMode = 'full'; scanPaid = ''; scanDue = '';
  }
  if (failure) toast('فشل بيع "' + failure.name + '": ' + failure.message + '. باقي الأصناف لسه في الفاتورة.', 'error');
  await loadScanProducts();
  // نحدّث الكميات المتاحة في السلة بعد البيع
  scanCart.forEach(function (c) {
    const p = scanProducts.filter(function (x) { return x.type === c.type && String(x.item.id) === String(c.item.id); })[0];
    if (p) { c.item = p.item; c.qty = Math.min(c.qty, Math.max(1, Number(p.item.quantity))); }
  });
  if (!failure) { scanCustomer = { name: '', phone: '' }; }
  renderScan();
}

function renderScanNotFound(code) {
  const resultBox = document.getElementById('scan-result');
  resultBox.innerHTML = `
    <div class="card">
      <div class="badge badge-danger">مفيش منتج بالاسم أو الكود ده</div>
      <p style="color:#888"><strong>${escHtml(code)}</strong> مش مسجل في النظام. تقدر تضيفه دلوقتي كمنتج جديد.</p>
      <div class="grid grid-2">
        <button class="btn btn-dark" id="scan-add-accessory">إضافة كإكسسوار</button>
        <button class="btn btn-dark" id="scan-add-device">إضافة كجهاز</button>
      </div>
    </div>
  `;
  document.getElementById('scan-add-accessory').addEventListener('click', function () {
    openScanAddAccessoryForm(code, function () { toast('تمت إضافة المنتج', 'success'); addScannedByCode(code); });
  });
  document.getElementById('scan-add-device').addEventListener('click', function () {
    openScanAddDeviceForm(code, function () { toast('تمت إضافة الجهاز', 'success'); addScannedByCode(code); });
  });
}

async function addScannedByCode(code) {
  await loadScanProducts();
  const p = scanProducts.filter(function (x) { return String(x.item.code) === String(code); })[0];
  if (p) addToScanCart(p); else renderScan();
}

async function openScanAddAccessoryForm(code, onSaved) {
  readScanCustomer();
  let categories = [];
  let allModels = [];
  try { categories = (await cachedApi('listAccessoryCategories')).items; } catch (e) { /* ignore */ }
  try { allModels = (await cachedApi('listAccessoryModels')).items; } catch (e) { /* ignore */ }
  const overlay = openModal(code ? ('إضافة منتج جديد — كود ' + code) : 'إضافة منتج إكسسوار جديد', `
    <form id="scan-item-form">
      <div class="field">
        <label>النوع</label>
        <select name="categoryId" required>
          <option value="">اختر النوع...</option>
          <optgroup label="📱 إكسسوارات الموبايل">
            ${categories.filter(function (c) { return !catIsPc(c); }).map(function (c) { return `<option value="${escHtml(c.id)}" data-name="${escHtml(c.name)}">${escHtml(c.name)}</option>`; }).join('')}
          </optgroup>
          <optgroup label="💻 إكسسوارات الكمبيوتر">
            ${categories.filter(catIsPc).map(function (c) { return `<option value="${escHtml(c.id)}" data-name="${escHtml(c.name)}">${escHtml(dispCat(c.name))}</option>`; }).join('')}
          </optgroup>
          <option value="__new__">+ نوع جديد (موبايل)</option>
          <option value="__new_pc__">+ نوع جديد (كمبيوتر)</option>
        </select>
      </div>
      <div class="field hidden" id="new-cat-field"><label>اسم النوع الجديد</label><input name="newCategoryName" /></div>
      <div class="field"><label>الموديل (اختياري)</label>
        <select name="modelId"><option value="">بدون موديل</option></select>
      </div>
      <div class="field"><label>اسم الصنف</label><input name="name" required /></div>
      ${code ? '' : '<div class="field"><label>كود المنتج (اختياري)</label><input name="code" placeholder="اختياري - يتولد تلقائي" /></div>'}
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="0" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="0" required /></div>
      </div>
      ${warrantyFieldsHtml('بدون ضمان', '')}
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="1" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ المنتج</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    const catSelect = el.querySelector('[name=categoryId]');
    const modelSelect = el.querySelector('[name=modelId]');
    catSelect.addEventListener('change', function () {
      el.querySelector('#new-cat-field').classList.toggle('hidden', catSelect.value.indexOf('__new') !== 0);
      modelSelect.innerHTML = '<option value="">بدون موديل</option>' + allModels.filter(function (m) {
        return String(m.categoryId) === String(catSelect.value);
      }).map(function (m) { return '<option value="' + escHtml(m.id) + '">' + escHtml(m.name) + '</option>'; }).join('');
    });
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=name]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#scan-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      let wr; try { wr = readWarranty(fd); } catch (err) { toast(err.message, 'error'); return; }
      saveInBackground(overlay, async function () {
        let categoryId = fd.get('categoryId');
        let categoryName;
        if (categoryId === '__new__' || categoryId === '__new_pc__') {
          const rawName = String(fd.get('newCategoryName') || '').trim();
          if (!rawName) throw new Error('اكتب اسم النوع الجديد');
          const newName = (categoryId === '__new_pc__' ? PC_MARK : '') + rawName;
          const sameCat = ((LISTS.listAccessoryCategories || {}).items || []).filter(function (c) { return c.name === newName; })[0];
          if (sameCat) { categoryId = sameCat.id; categoryName = sameCat.name; }
          else {
            const newCat = await apiWrite('addAccessoryCategory', { name: newName });
            categoryId = newCat.item.id; categoryName = newCat.item.name;
            patchCacheAdd('listAccessoryCategories', newCat.item);
          }
        } else {
          categoryName = catSelect.options[catSelect.selectedIndex].getAttribute('data-name');
        }
        const res = await apiWrite('addAccessoryItem', {
          code: code || fd.get('code'), categoryId: categoryId, categoryName: categoryName, name: fd.get('name'),
          modelId: fd.get('modelId') || '', modelName: accModelName(fd.get('modelId')),
          warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod,
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listAccessoryItems', res.item);
      }, { successMsg: 'تمت إضافة المنتج بنجاح', onDone: function () { if (onSaved) onSaved(); } });
    });
  });
}

function openScanAddDeviceForm(code, onSaved) {
  readScanCustomer();
  const overlay = openModal(code ? ('إضافة جهاز جديد — كود ' + code) : 'إضافة جهاز جديد', `
    <form id="scan-device-form">
      <div class="field">
        <label>نوع الجهاز</label>
        <select name="deviceType" required>
          ${DEVICE_TYPE_PRESETS.map(function (t) { return `<option value="${escHtml(t)}">${escHtml(t)}</option>`; }).join('')}
          <option value="__new__">+ نوع جديد</option>
        </select>
      </div>
      <div class="field hidden" id="new-type-field"><label>اسم النوع الجديد</label><input name="newDeviceType" /></div>
      <div class="field">
        <label>الحالة</label>
        <select name="condition" required>
          <option value="جديد">جديد</option>
          <option value="مستعمل">مستعمل</option>
        </select>
      </div>
      <div class="field"><label>اسم الجهاز</label><input name="name" required /></div>
      ${code ? '' : '<div class="field"><label>كود المنتج (اختياري)</label><input name="code" placeholder="اختياري - يتولد تلقائي" /></div>'}
      ${warrantyFieldsHtml('بدون ضمان', '')}
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="0" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="0" required /></div>
      </div>
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="1" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ الجهاز</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    const typeSelect = el.querySelector('[name=deviceType]');
    typeSelect.addEventListener('change', function () {
      el.querySelector('#new-type-field').classList.toggle('hidden', typeSelect.value !== '__new__');
    });
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=name]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#scan-device-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const deviceType = fd.get('deviceType') === '__new__' ? fd.get('newDeviceType') : fd.get('deviceType');
      let wr; try { wr = readWarranty(fd); } catch (err) { toast(err.message, 'error'); return; }
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addDevice', {
          code: code || fd.get('code'), condition: fd.get('condition'), name: fd.get('name'), warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod,
          deviceType: deviceType,
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listDevices', res.item);
      }, { successMsg: 'تمت إضافة الجهاز بنجاح', onDone: function () { if (onSaved) onSaved(); } });
    });
  });
}

/* ============ الصيانة ============ */

let maintenanceTab = 'هاردوير';

async function renderMaintenance() {
  setBreadcrumb('عمليات صيانة اليوم — هاردوير وسوفتوير (كل العمليات القديمة في الحسابات)');
  content().innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${maintenanceTab === 'هاردوير' ? 'active' : ''}" data-tab="هاردوير">هاردوير</button>
      <button class="tab-btn ${maintenanceTab === 'سوفتوير' ? 'active' : ''}" data-tab="سوفتوير">سوفتوير</button>
    </div>
    <div class="section-header">
      <div class="toolbar">
        <input type="text" id="maint-search" placeholder="بحث باسم العميل أو الجهاز..." />
        <select id="maint-filter-case">
          <option value="">كل الحالات</option>
          <option value="كشف اعطال">كشف أعطال</option>
          <option value="عطل معروف">عطل معروف</option>
        </select>
      </div>
      <button class="btn btn-primary" id="add-maint-btn">+ إضافة عملية صيانة</button>
    </div>
    <div id="maint-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;

  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { maintenanceTab = b.getAttribute('data-tab'); renderMaintenance(); });
  });
  document.getElementById('add-maint-btn').addEventListener('click', openMaintenanceForm);
  document.getElementById('maint-search').addEventListener('input', loadMaintenanceTable);
  document.getElementById('maint-filter-case').addEventListener('change', loadMaintenanceTable);

  await loadMaintenanceTable();
}

async function loadMaintenanceTable() {
  const search = (document.getElementById('maint-search') || {}).value || '';
  const caseFilter = (document.getElementById('maint-filter-case') || {}).value || '';
  try {
    const data = await cachedApi('listMaintenance');
    const today = localNowStr().substring(0, 10); // صفحة الصيانة بتعرض عمليات اليوم بس (الحسابات بتعرض كل اللي فات)
    let rows = data.items.filter(function (r) { return r.deviceCategory === maintenanceTab && String(r.date).substring(0, 10) === today; });
    if (caseFilter) rows = rows.filter(function (r) { return r.caseType === caseFilter; });
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.customerName || '').toLowerCase().includes(q) || (r.deviceType || '').toLowerCase().includes(q);
      });
    }
    rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    document.getElementById('maint-table').innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th>التاريخ</th><th>الحالة</th><th>نوع الجهاز</th><th>العطل</th><th>العميل</th><th>الهاتف</th>
          ${hideCosts() ? '' : '<th>سعر الجملة</th><th>المكسب</th>'}<th>الإجمالي</th><th>ملاحظات</th><th>الموظف</th>
        </tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return `<tr>
              <td>${escHtml(r.date)}</td>
              <td><span class="badge ${r.caseType === 'كشف اعطال' ? 'badge-slate' : 'badge-brown'}">${escHtml(r.caseType)}</span></td>
              <td>${escHtml(r.deviceType || '-')}</td><td>${escHtml(r.faultType || '-')}</td>
              <td>${escHtml(r.customerName || '-')}</td><td>${escHtml(r.customerPhone || '-')}</td>
              ${hideCosts() ? '' : '<td>' + Number(r.wholesaleCost).toLocaleString() + '</td>'}
              ${hideCosts() ? '' : '<td>' + Number(r.profitCost).toLocaleString() + '</td>'}
              <td><strong>${Number(r.total).toLocaleString()}</strong></td>
              <td>${escHtml(r.notes || '-')}</td>
              <td>${escHtml(r.employee || '-')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد عمليات صيانة اليوم</div>`;
  } catch (err) {
    document.getElementById('maint-table').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openMaintenanceForm() {
  const body = `
    <form id="maint-form">
      <div class="field">
        <label>نوع الحالة</label>
        <select name="caseType" required>
          <option value="كشف اعطال">كشف أعطال</option>
          <option value="عطل معروف">عطل معروف</option>
        </select>
      </div>
      <div class="field"><label>نوع الجهاز</label><input name="deviceType" required /></div>
      <div class="field hidden" id="fault-field"><label>اسم العطل</label><input name="faultType" /></div>
      <div class="field"><label>اسم العميل</label><input name="customerName" /></div>
      <div class="field hidden" id="phone-field"><label>رقم العميل</label><input name="customerPhone" /></div>
      <div class="grid grid-2">
        <div class="field"><label>التكلفة (سعر الجملة)</label><input type="number" name="wholesaleCost" value="0" required /></div>
        <div class="field"><label>تكلفة المكسب</label><input type="number" name="profitCost" value="0" required /></div>
      </div>
      <div class="field"><label>طريقة الدفع</label>
        <select name="payMode">
          <option value="full">دفع كامل</option>
          <option value="credit">آجل (يدفع جزء والباقي عند الاستلام)</option>
        </select>
      </div>
      <div id="maint-credit-box" class="hidden">
        <div class="field"><label>المدفوع دلوقتي (ج.م)</label><input type="number" name="paid" min="0" step="any" value="0" /></div>
        <div class="field"><label>ميعاد سداد الباقي</label><input type="date" name="dueDate" /></div>
      </div>
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="3" placeholder="أي تفاصيل إضافية عن الصيانة..."></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `;
  const overlay = openModal('إضافة عملية صيانة — ' + maintenanceTab, body, function (el) {
    const caseSelect = el.querySelector('[name=caseType]');
    function toggleFields() {
      const known = caseSelect.value === 'عطل معروف';
      el.querySelector('#fault-field').classList.toggle('hidden', !known);
      const credit = el.querySelector('[name=payMode]').value === 'credit';
      el.querySelector('#phone-field').classList.toggle('hidden', !known && !credit);
      el.querySelector('#maint-credit-box').classList.toggle('hidden', !credit);
    }
    caseSelect.addEventListener('change', toggleFields);
    el.querySelector('[name=payMode]').addEventListener('change', toggleFields);
    toggleFields();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#maint-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tabAtSubmit = maintenanceTab;
      const mTotal = (Number(fd.get('wholesaleCost')) || 0) + (Number(fd.get('profitCost')) || 0);
      const mCredit = fd.get('payMode') === 'credit';
      const mPaid = Math.max(0, Number(fd.get('paid')) || 0);
      const mDue = String(fd.get('dueDate') || '');
      if (mCredit) {
        if (!String(fd.get('customerName') || '').trim() || !String(fd.get('customerPhone') || '').trim()) { toast('الآجل محتاج اسم العميل ورقمه', 'error'); return; }
        if (mPaid >= mTotal) { toast('المدفوع لازم يكون أقل من الإجمالي، أو اختار "دفع كامل"', 'error'); return; }
        if (!mDue) { toast('حدد ميعاد سداد الباقي', 'error'); return; }
      }
      saveInBackground(overlay, async function () {
        const result = await apiWrite('addMaintenance', {
          deviceCategory: tabAtSubmit,
          caseType: fd.get('caseType'),
          deviceType: fd.get('deviceType'),
          faultType: fd.get('faultType'),
          customerName: fd.get('customerName'),
          customerPhone: fd.get('customerPhone'),
          wholesaleCost: fd.get('wholesaleCost'),
          profitCost: fd.get('profitCost'),
          notes: fd.get('notes'),
          employee: CURRENT_USER.name
        });
        invalidateCache('accountingSummary');
        patchCacheAdd('listMaintenance', result.item);
        // الدفع الجزئي: بيتسجل في الآجل، وبعدين تسدده من صفحة "الآجل" لما العميل يجي يستلم
        if (mCredit) {
          try {
            await apiWrite('addDebt', {
              customerName: result.item.customerName, customerPhone: result.item.customerPhone,
              total: Number(result.item.total), paid: mPaid, dueDate: mDue,
              items: 'صيانة — ' + (result.item.deviceType || '') + (result.item.faultType ? ' — ' + result.item.faultType : ''),
              notes: '', employee: CURRENT_USER.name
            });
            result.debt = { paid: mPaid, remaining: Math.round((Number(result.item.total) - mPaid) * 100) / 100, dueDate: mDue };
          } catch (err) {
            toast('اتسجلت الصيانة بس فشل تسجيل الآجل: ' + err.message + ' — سجّله يدويًا', 'error');
          }
        }
        return result;
      }, {
        successMsg: 'تمت إضافة عملية الصيانة',
        onDone: function (result) {
          printReceipt({
            customerName: result.item.customerName, customerPhone: result.item.customerPhone,
            productName: (result.item.deviceType || '') + ' (صيانة ' + tabAtSubmit + ')',
            faultType: result.item.faultType || result.item.caseType || 'صيانة',
            employee: result.item.employee, total: result.item.total, debt: result.debt || null
          });
          loadMaintenanceTable();
        }
      });
    });
  });
}

/* ============ الإكسسوارات ============ */

let currentAccCategory = null;
let currentModelFilter = null; // null = صفحة الموديلات، '' = أصناف بدون موديل، غير كده id الموديل
let currentModelName = '';

// الموديل الفعلي للصنف: لو الـ modelId بتاعه مش موجود في قايمة الموديلات (مثلًا موديل اتضاف أوفلاين واتكرر)
// بندوّر بنفس الاسم في نفس النوع، ولو مفيش بنعتبره "بدون موديل" عشان الصنف ميختفيش من الشاشة
function effModelId(i) {
  const id = String(i.modelId || '');
  if (!id) return '';
  const models = (LISTS.listAccessoryModels || {}).items || [];
  if (models.some(function (m) { return String(m.id) === id; })) return id;
  const nm = String(i.modelName || '').trim().toLowerCase();
  if (nm) {
    const m = models.find(function (x) {
      return String(x.categoryId) === String(i.categoryId) && String(x.name).trim().toLowerCase() === nm;
    });
    if (m) return String(m.id);
  }
  return '';
}

function accModelName(id) {
  const m = ((LISTS.listAccessoryModels || {}).items || []).find(function (x) { return String(x.id) === String(id); });
  return m ? m.name : '';
}

// تقسيم الإكسسوارات: موبايل / كمبيوتر. نوع الكمبيوتر بيتحفظ في الشيت باسمه مسبوق بعلامة،
// والعلامة دي بتتشال دايمًا عند العرض، فمش هتظهر في أي شاشة.
const PC_MARK = '[كمبيوتر] ';
let accGroup = 'mobile';
function catIsPc(c) { return String((c && c.name) || '').indexOf(PC_MARK) === 0; }
function dispCat(name) { return String(name || '').replace(PC_MARK, ''); }

function categoryIcon_(name, isPc) {
  const n = (name || '');
  const map = [
    [/سماع/, '🎧'],
    [/شاحن|شواحن|كابل|كوابل/, '🔌'],
    [/جراب|كفر|كفرات|كفر ات/, '📱'],
    [/باور|بنك|بطاري/, '🔋'],
    [/ميمور|ذاكرة|فلاش/, '💾'],
    [/حماي|سكرين|لاصق|زجاج/, '🛡️'],
    [/ساعة|ساعات/, '⌚'],
    [/طبله|سبيكر|صوت/, '🔊'],
    [/كاميرا|كام/, '📷'],
    [/ماوس/, '🖱️'],
    [/كيبورد|كيبورت/, '⌨️'],
    [/لاب|كمبيوتر|بي سي/, '💻'],
    [/هارد|ssd|اس اس دي/i, '💽'],
    [/رام|ram/i, '🧠'],
    [/شاشة|شاشات|مونيتور/, '🖥️'],
    [/ويب كام|ويبكام/, '📹'],
    [/ماوس باد|ستاند|حامل/, '🗂️'],
    [/شنطة|حقيبة/, '👜']
  ];
  for (let i = 0; i < map.length; i++) { if (map[i][0].test(n)) return map[i][1]; }
  return isPc ? '🖥️' : '📦';
}

async function renderAccessories() {
  currentAccCategory = null;
  setBreadcrumb('اختر نوع الإكسسوار');
  content().innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    const [catData, itemData] = await Promise.all([cachedApi('listAccessoryCategories'), cachedApi('listAccessoryItems')]);
    const isPc = accGroup === 'pc';
    const cats = catData.items.filter(function (c) { return catIsPc(c) === isPc; });
    content().innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${!isPc ? 'active' : ''}" data-acc-group="mobile">📱 إكسسوارات الموبايل</button>
        <button class="tab-btn ${isPc ? 'active' : ''}" data-acc-group="pc">💻 إكسسوارات الكمبيوتر</button>
      </div>
      <div class="section-header">
        <div></div>
        <button class="btn btn-primary" id="add-cat-btn">+ إضافة نوع جديد</button>
      </div>
      <div class="grid grid-4" id="cat-grid">
        ${cats.map(function (c) {
          const count = itemData.items.filter(function (i) { return String(i.categoryId) === String(c.id); }).length;
          return `<div class="category-box" data-cat-id="${escHtml(c.id)}" data-cat-name="${escHtml(c.name)}">
            <div class="icon">${categoryIcon_(dispCat(c.name), isPc)}</div><div class="name">${escHtml(dispCat(c.name))}</div><div class="count">${count} صنف</div>
            <button class="link-btn" data-move-cat="${escHtml(c.id)}" style="margin-top:10px;font-size:12px">↔ نقل لـ ${isPc ? 'إكسسوارات الموبايل' : 'إكسسوارات الكمبيوتر'}</button>
          </div>`;
        }).join('') || '<div class="empty-state">لا توجد أنواع بعد، أضف أول نوع</div>'}
      </div>
    `;
    document.querySelectorAll('[data-acc-group]').forEach(function (b) {
      b.addEventListener('click', function () { accGroup = b.getAttribute('data-acc-group'); renderAccessories(); });
    });
    document.getElementById('add-cat-btn').addEventListener('click', openAddCategoryForm);
    document.querySelectorAll('[data-cat-id]').forEach(function (box) {
      box.addEventListener('click', function () {
        renderAccessoryItems(box.getAttribute('data-cat-id'), box.getAttribute('data-cat-name'));
      });
    });
    document.querySelectorAll('[data-move-cat]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const box = btn.closest('[data-cat-id]');
        moveAccessoryCategory(box.getAttribute('data-cat-id'), box.getAttribute('data-cat-name'), renderAccessories);
      });
    });
  } catch (err) {
    content().innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

// نقل نوع كامل (بكل أصنافه) بين إكسسوارات الموبايل والكمبيوتر.
// الأصناف مربوطة بالنوع بالـ id، فالنقل هو تغيير اسم النوع (إضافة/إزالة علامة الكمبيوتر) وبس.
function moveAccessoryCategory(catId, catName, onDone) {
  const toPc = !catIsPc({ name: catName });
  const pure = dispCat(catName).trim();
  const newName = (toPc ? PC_MARK : '') + pure;
  const label = toPc ? 'إكسسوارات الكمبيوتر' : 'إكسسوارات الموبايل';
  const overlay = openModal('نقل النوع', `
    <p style="line-height:1.8">هتنقل نوع <strong>${escHtml(pure)}</strong> بكل أصنافه وبياناته (الأسعار، الكميات، الأكواد، المبيعات) إلى <strong>${escHtml(label)}</strong>.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="confirm-move">نقل</button>
      <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
    </div>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#confirm-move').addEventListener('click', function () {
      saveInBackground(overlay, async function () {
        const cats = (await cachedApi('listAccessoryCategories')).items;
        if (cats.some(function (c) { return String(c.id) !== String(catId) && c.name === newName; })) {
          throw new Error('فيه نوع بنفس الاسم في ' + label);
        }
        await apiWrite('moveAccessoryCategory', { id: catId, name: newName });
        Object.keys(CACHE).forEach(function (k) {
          if (k.indexOf('listAccessoryCategories:') !== 0) return;
          const d = CACHE[k].data;
          if (d && Array.isArray(d.items)) d.items.forEach(function (c) { if (String(c.id) === String(catId)) c.name = newName; });
        });
        invalidateCache('listAccessoryItems');
      }, { successMsg: 'تم نقل النوع إلى ' + label, onDone: function () { if (onDone) onDone(); } });
    });
  });
}

function openAddCategoryForm() {
  const isPc = accGroup === 'pc';
  const overlay = openModal(isPc ? 'إضافة نوع إكسسوار كمبيوتر جديد' : 'إضافة نوع إكسسوار جديد', `
    <form id="cat-form">
      <div class="field"><label>${isPc ? 'اسم النوع (مثال: ماوس، كيبورد، هارد، رامات)' : 'اسم النوع (مثال: سماعات، شواحن)'}</label><input name="name" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#cat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addAccessoryCategory', { name: (isPc ? PC_MARK : '') + String(fd.get('name')).trim() });
        patchCacheAdd('listAccessoryCategories', res.item);
      }, { successMsg: 'تمت إضافة النوع', onDone: function () { renderAccessories(); } });
    });
  });
}

async function renderAccessoryItems(catId, catName) {
  currentModelFilter = null; currentModelName = '';
  const isPc = catIsPc({ name: catName });
  setBreadcrumb((isPc ? 'إكسسوارات الكمبيوتر / ' : 'الإكسسوارات / ') + dispCat(catName));
  content().innerHTML = `
    <div class="section-header">
      <button class="link-btn" id="back-cats">→ رجوع لكل الأنواع</button>
      <div class="toolbar">
        <button class="btn btn-primary btn-sm" id="add-model-btn">+ إضافة موديل</button>
        <button class="btn btn-outline btn-sm" id="move-cat-btn">↔ نقل لـ ${isPc ? 'إكسسوارات الموبايل' : 'إكسسوارات الكمبيوتر'}</button>
      </div>
    </div>
    <div class="grid grid-4" id="model-grid"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('back-cats').addEventListener('click', renderAccessories);
  document.getElementById('add-model-btn').addEventListener('click', function () { openAddModelForm(catId, catName); });
  document.getElementById('move-cat-btn').addEventListener('click', function () { moveAccessoryCategory(catId, catName, renderAccessories); });
  try {
    const res = await Promise.all([cachedApi('listAccessoryModels'), cachedApi('listAccessoryItems')]);
    const models = res[0].items.filter(function (m) { return String(m.categoryId) === String(catId); });
    const items = res[1].items.filter(function (i) { return String(i.categoryId) === String(catId); });
    const noModel = items.filter(function (i) { return !effModelId(i); }).length;
    const cards = models.map(function (m) {
      const count = items.filter(function (i) { return effModelId(i) === String(m.id); }).length;
      return `<div class="category-box" data-model-id="${escHtml(m.id)}">
        <div class="icon">📲</div><div class="name">${escHtml(m.name)}</div><div class="count">${count} صنف</div></div>`;
    });
    if (noModel) {
      cards.push(`<div class="category-box" data-model-id="">
        <div class="icon">📦</div><div class="name">بدون موديل</div><div class="count">${noModel} صنف</div></div>`);
    }
    document.getElementById('model-grid').innerHTML = cards.join('') ||
      '<div class="empty-state">لا توجد موديلات بعد، اضغط "إضافة موديل" وابدأ</div>';
    document.querySelectorAll('[data-model-id]').forEach(function (box) {
      box.addEventListener('click', function () {
        const id = box.getAttribute('data-model-id');
        renderModelItems(catId, catName, id, id ? accModelName(id) : '');
      });
    });
  } catch (err) {
    document.getElementById('model-grid').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openAddModelForm(catId, catName) {
  const overlay = openModal('إضافة موديل — ' + dispCat(catName), `
    <form id="model-form">
      <div class="field"><label>اسم الموديل (مثال: iPhone 15 أو Galaxy S24)</label><input name="name" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('[name=name]').focus();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#model-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const name = String(new FormData(e.target).get('name')).trim();
      saveInBackground(overlay, async function () {
        await apiWrite('addAccessoryModel', { categoryId: catId, categoryName: catName, name: name });
      }, { successMsg: 'تمت إضافة الموديل', onDone: function () { renderAccessoryItems(catId, catName); } });
    });
  });
}

async function renderModelItems(catId, catName, modelId, modelName) {
  currentModelFilter = modelId || '';
  currentModelName = modelName || '';
  setBreadcrumb((catIsPc({ name: catName }) ? 'إكسسوارات الكمبيوتر / ' : 'الإكسسوارات / ') + dispCat(catName) + ' / ' + (modelName || 'بدون موديل'));
  content().innerHTML = `
    <div class="section-header">
      <button class="link-btn" id="back-models">→ رجوع لموديلات ${escHtml(dispCat(catName))}</button>
      <div class="toolbar">
        <input type="text" id="item-search" placeholder="بحث باسم الصنف..." />
        <button class="btn btn-dark btn-sm" id="scan-add-btn"${canEdit() ? '' : ' style="display:none"'}>🔍 إضافة/تعديل بالباركود</button>
        <button class="btn btn-outline btn-sm" id="add-item-btn"${canEdit() ? '' : ' style="display:none"'}>+ إضافة صنف يدوي</button>
      </div>
    </div>
    <div id="items-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('back-models').addEventListener('click', function () { renderAccessoryItems(catId, catName); });
  document.getElementById('add-item-btn').addEventListener('click', function () { openAddItemForm(catId, catName); });
  document.getElementById('scan-add-btn').addEventListener('click', function () { openQuickBarcodeForCategory(catId, catName); });
  document.getElementById('item-search').addEventListener('input', function () { loadItemsTable(catId); });
  await loadItemsTable(catId);
}

function openQuickBarcodeForCategory(catId, catName) {
  const overlay = openModal('إضافة أو تحديث بالباركود — ' + dispCat(catName), `
    <div class="field">
      <label>امسح الباركود أو اكتب الكود واضغط Enter</label>
      <input type="text" id="quick-code-input" placeholder="امسح الباركود هنا..." autocomplete="off" />
    </div>
    <p style="color:#888;font-size:13px">لو الكود موجود بالفعل هيفتحلك تعديل السعر والكمية فورًا. لو كود جديد هيفتحلك إضافة صنف جديد بنفس الكود.</p>
  `, function (el) {
    const input = el.querySelector('#quick-code-input');
    input.focus();
    async function doSearch() {
      const code = input.value.trim();
      if (!code) return;
      try {
        const data = await findProduct(code);
        overlay.remove();
        if (data.found && data.type === 'accessory') {
          openEditAccessoryForm(data.item, function () { loadItemsTable(catId); });
        } else if (data.found && data.type === 'device') {
          toast('الكود ده متسجل لجهاز مش إكسسوار', 'error');
        } else {
          openAddItemForm(catId, catName, code);
        }
      } catch (err) { toast(err.message, 'error'); }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  });
}

async function loadItemsTable(catId) {
  const search = (document.getElementById('item-search') || {}).value || '';
  try {
    const data = await cachedApi('listAccessoryItems');
    let rows = data.items.filter(function (i) { return String(i.categoryId) === String(catId); });
    if (currentModelFilter !== null) rows = rows.filter(function (i) { return effModelId(i) === currentModelFilter; });
    if (search) rows = rows.filter(function (i) { return i.name.toLowerCase().includes(search.toLowerCase()); });
    document.getElementById('items-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>الضمان</th>${hideCosts() ? '' : '<th>سعر الجملة</th><th>سعر المكسب</th>'}<th>الإجمالي</th><th>الكمية</th><th>تاريخ الإضافة</th><th></th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (i) {
            return `<tr>
              <td><span class="badge badge-slate">${escHtml(i.code || '-')}</span></td>
              <td>${escHtml(i.name)}</td><td><span class="badge ${i.warranty === 'له ضمان' ? 'badge-success' : 'badge-slate'}">${escHtml(warrantyLabel(i))}</span></td>${hideCosts() ? '' : '<td>' + Number(i.wholesalePrice).toLocaleString() + '</td>'}
              ${hideCosts() ? '' : '<td>' + Number(i.profitPrice).toLocaleString() + '</td>'}<td><strong>${Number(i.totalPrice).toLocaleString()}</strong></td>
              <td>${i.quantity <= 2 ? '<span class="badge badge-danger">' + i.quantity + '</span>' : i.quantity}</td>
              <td>${escHtml(i.dateAdded)}</td>
              <td><button class="btn btn-primary btn-sm" data-sell-id="${escHtml(i.id)}">بيع للعميل</button></td>
              <td>${canEdit() ? '<button class="link-btn" data-edit-id="' + escHtml(i.id) + '">تعديل</button>' : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد أصناف في هذا الموديل بعد</div>`;

    document.querySelectorAll('[data-sell-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const row = rows.find(function (r) { return String(r.id) === btn.getAttribute('data-sell-id'); });
        openSellAccessoryForm(row, catId);
      });
    });
    document.querySelectorAll('[data-edit-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const row = rows.find(function (r) { return String(r.id) === btn.getAttribute('data-edit-id'); });
        openEditAccessoryForm(row, function () { loadItemsTable(catId); });
      });
    });
  } catch (err) {
    document.getElementById('items-table').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openAddItemForm(catId, catName, prefillCode) {
  if (!canEdit()) { toast('مش مسموح لك بالإضافة أو التعديل', 'error'); return; }
  const overlay = openModal('إضافة صنف جديد — ' + dispCat(catName) + (currentModelName ? ' / ' + escHtml(currentModelName) : ''), `
    <form id="item-form">
      <div class="field"><label>اسم الصنف</label><input name="name" required /></div>
      <div class="field"><label>كود المنتج (اختياري — سيبه فاضي عشان يتولد تلقائي)</label><input name="code" placeholder="اختياري" value="${escHtml(prefillCode || '')}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="0" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="0" required /></div>
      </div>
      ${warrantyFieldsHtml('بدون ضمان', '')}
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="1" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=wholesalePrice]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      let wr; try { wr = readWarranty(fd); } catch (err) { toast(err.message, 'error'); return; }
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addAccessoryItem', {
          warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod, categoryId: catId, categoryName: catName, name: fd.get('name'), code: fd.get('code'),
          modelId: currentModelFilter || '', modelName: currentModelName || '',
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listAccessoryItems', res.item);
      }, { successMsg: 'تمت إضافة الصنف', onDone: function () { loadItemsTable(catId); } });
    });
  });
}

function openSellAccessoryForm(item, catId) {
  const overlay = openModal('بيع للعميل — ' + item.name, `
    <form id="sell-form">
      <div class="field"><label>اسم العميل</label><input name="customerName" required /></div>
      <div class="field"><label>رقم العميل</label><input name="customerPhone" required /></div>
      <div class="field">
        <label>الكمية (المتاح: ${item.quantity})</label>
        <input type="number" name="quantity" value="1" min="1" max="${item.quantity}" required />
      </div>
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="3" placeholder="أي ملاحظات عن العملية..."></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">تأكيد البيع</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#sell-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (overlay._busy) return; // منع الضغط مرتين (كان بيسجل البيع/التعديل مرتين)
      overlay._busy = true;
      const fd = new FormData(e.target);
      try {
        const result = await apiWrite('sellAccessoryItem', {
          itemId: item.id, customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'),
          quantity: fd.get('quantity'), notes: fd.get('notes'), employee: CURRENT_USER.name
        });
        invalidateProductCaches();
        overlay.remove();
        toast(savedMsg('تم تسجيل عملية البيع'), 'success');
        printReceipt({
          customerName: result.sale.customerName, customerPhone: result.sale.customerPhone,
          productName: result.sale.itemName + (result.sale.quantity > 1 ? ' × ' + result.sale.quantity : ''),
          employee: result.sale.employee, total: result.sale.totalPrice
        });
        loadItemsTable(catId);
      } catch (err) { overlay._busy = false; toast(err.message, 'error'); }
    });
  });
}

/* ============ الأجهزة ============ */

let deviceTab = 'جديد';
let currentDeviceType = null;
const DEVICE_TYPE_PRESETS = ['موبايل', 'PC', 'لابتوب', 'شاشة'];

function deviceTypeIcon_(type) {
  const map = { 'موبايل': '📱', 'PC': '🖥️', 'لابتوب': '💻', 'شاشة': '🖼️' };
  return map[type] || '📦';
}

async function renderDevices() {
  currentDeviceType = null;
  setBreadcrumb('اختر نوع الجهاز');
  content().innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    const data = await cachedApi('listDevices');
    const existingTypes = Array.from(new Set(data.items.map(function (d) { return d.deviceType || 'أخرى'; })));
    const allTypes = Array.from(new Set(DEVICE_TYPE_PRESETS.concat(existingTypes)));
    content().innerHTML = `
      <div class="section-header">
        <div></div>
        <button class="btn btn-primary" id="add-device-type-btn">+ نوع جهاز جديد</button>
      </div>
      <div class="grid grid-4" id="device-type-grid">
        ${allTypes.map(function (t) {
          const count = data.items.filter(function (d) { return (d.deviceType || 'أخرى') === t; }).length;
          return `<div class="category-box" data-type="${escHtml(t)}">
            <div class="icon">${deviceTypeIcon_(t)}</div><div class="name">${escHtml(t)}</div><div class="count">${count} جهاز</div>
          </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('add-device-type-btn').addEventListener('click', function () {
      const name = prompt('اكتب اسم نوع الجهاز الجديد (مثال: تابلت):');
      if (name && name.trim()) renderDeviceTypeItems(name.trim());
    });
    document.querySelectorAll('[data-type]').forEach(function (box) {
      box.addEventListener('click', function () { renderDeviceTypeItems(box.getAttribute('data-type')); });
    });
  } catch (err) {
    content().innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

async function renderDeviceTypeItems(type) {
  currentDeviceType = type;
  setBreadcrumb('الأجهزة / ' + type);
  content().innerHTML = `
    <button class="link-btn" id="back-device-types">→ رجوع لكل الأنواع</button>
    <div class="tabs" style="margin-top:10px">
      <button class="tab-btn ${deviceTab === 'جديد' ? 'active' : ''}" data-tab="جديد">جديد</button>
      <button class="tab-btn ${deviceTab === 'مستعمل' ? 'active' : ''}" data-tab="مستعمل">مستعمل</button>
    </div>
    <div class="section-header">
      <input type="text" id="device-search" placeholder="بحث باسم الجهاز..." />
      <button class="btn btn-dark" id="scan-add-device-btn"${canEdit() ? '' : ' style="display:none"'}>🔍 إضافة/تعديل بالباركود</button>
      <button class="btn btn-primary" id="add-device-btn"${canEdit() ? '' : ' style="display:none"'}>+ إضافة جهاز يدوي</button>
    </div>
    <div id="devices-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('back-device-types').addEventListener('click', renderDevices);
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { deviceTab = b.getAttribute('data-tab'); renderDeviceTypeItems(type); });
  });
  document.getElementById('add-device-btn').addEventListener('click', function () { openAddDeviceForm(type); });
  document.getElementById('scan-add-device-btn').addEventListener('click', function () { openQuickBarcodeForDeviceType(type); });
  document.getElementById('device-search').addEventListener('input', loadDevicesTable);
  await loadDevicesTable();
}

function openQuickBarcodeForDeviceType(type) {
  const overlay = openModal('إضافة أو تحديث بالباركود — ' + type, `
    <div class="field">
      <label>امسح الباركود أو اكتب الكود واضغط Enter</label>
      <input type="text" id="quick-dev-code-input" placeholder="امسح الباركود هنا..." autocomplete="off" />
    </div>
    <p style="color:#888;font-size:13px">لو الكود موجود بالفعل هيفتحلك تعديل السعر والكمية فورًا. لو كود جديد هيفتحلك إضافة جهاز جديد بنفس الكود.</p>
  `, function (el) {
    const input = el.querySelector('#quick-dev-code-input');
    input.focus();
    async function doSearch() {
      const code = input.value.trim();
      if (!code) return;
      try {
        const data = await findProduct(code);
        overlay.remove();
        if (data.found && data.type === 'device') {
          openEditDeviceForm(data.item, function () { loadDevicesTable(); });
        } else if (data.found && data.type === 'accessory') {
          toast('الكود ده متسجل لإكسسوار مش جهاز', 'error');
        } else {
          openAddDeviceForm(type, code);
        }
      } catch (err) { toast(err.message, 'error'); }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  });
}

async function loadDevicesTable() {
  const search = (document.getElementById('device-search') || {}).value || '';
  try {
    const data = await cachedApi('listDevices');
    let rows = data.items.filter(function (d) {
      return d.condition === deviceTab && (d.deviceType || 'أخرى') === currentDeviceType;
    });
    if (search) rows = rows.filter(function (d) { return d.name.toLowerCase().includes(search.toLowerCase()); });
    document.getElementById('devices-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>الضمان</th>${hideCosts() ? '' : '<th>سعر الجملة</th><th>سعر المكسب</th>'}<th>الإجمالي</th><th>الكمية</th><th></th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (d) {
            return `<tr>
              <td><span class="badge badge-slate">${escHtml(d.code || '-')}</span></td>
              <td>${escHtml(d.name)}</td>
              <td><span class="badge ${d.warranty === 'له ضمان' ? 'badge-success' : 'badge-slate'}">${escHtml(warrantyLabel(d))}</span></td>
              ${hideCosts() ? '' : '<td>' + Number(d.wholesalePrice).toLocaleString() + '</td>'}${hideCosts() ? '' : '<td>' + Number(d.profitPrice).toLocaleString() + '</td>'}
              <td><strong>${Number(d.totalPrice).toLocaleString()}</strong></td>
              <td>${d.quantity <= 2 ? '<span class="badge badge-danger">' + d.quantity + '</span>' : d.quantity}</td>
              <td><button class="btn btn-primary btn-sm" data-sell-device="${escHtml(d.id)}">بيع للعميل</button></td>
              <td>${canEdit() ? '<button class="link-btn" data-edit-device="' + escHtml(d.id) + '">تعديل</button>' : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد أجهزة ${escHtml(deviceTab)} من نوع ${escHtml(currentDeviceType)} بعد</div>`;
    document.querySelectorAll('[data-edit-device]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const dev = rows.find(function (r) { return String(r.id) === btn.getAttribute('data-edit-device'); });
        openEditDeviceForm(dev, function () { loadDevicesTable(); });
      });
    });
    document.querySelectorAll('[data-sell-device]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const dev = rows.find(function (r) { return String(r.id) === btn.getAttribute('data-sell-device'); });
        openSellDeviceForm(dev);
      });
    });
  } catch (err) {
    document.getElementById('devices-table').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openAddDeviceForm(presetType, prefillCode) {
  if (!canEdit()) { toast('مش مسموح لك بالإضافة أو التعديل', 'error'); return; }
  const overlay = openModal('إضافة جهاز — ' + deviceTab, `
    <form id="device-form">
      <div class="field"><label>اسم الجهاز</label><input name="name" required /></div>
      <div class="field"><label>كود المنتج (اختياري — سيبه فاضي عشان يتولد تلقائي)</label><input name="code" placeholder="اختياري" value="${escHtml(prefillCode || '')}" /></div>
      <div class="field">
        <label>نوع الجهاز</label>
        <select name="deviceType" required>
          ${DEVICE_TYPE_PRESETS.concat(presetType && DEVICE_TYPE_PRESETS.indexOf(presetType) === -1 ? [presetType] : [])
            .map(function (t) { return `<option value="${escHtml(t)}" ${t === presetType ? 'selected' : ''}>${escHtml(t)}</option>`; }).join('')}
          <option value="__new__">+ نوع جديد</option>
        </select>
      </div>
      <div class="field hidden" id="new-type-field"><label>اسم النوع الجديد</label><input name="newDeviceType" /></div>
      ${warrantyFieldsHtml('بدون ضمان', '')}
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="0" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="0" required /></div>
      </div>
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="1" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    const typeSelect = el.querySelector('[name=deviceType]');
    typeSelect.addEventListener('change', function () {
      el.querySelector('#new-type-field').classList.toggle('hidden', typeSelect.value !== '__new__');
    });
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=warranty]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#device-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const deviceType = fd.get('deviceType') === '__new__' ? fd.get('newDeviceType') : fd.get('deviceType');
      const conditionAtSubmit = deviceTab;
      let wr; try { wr = readWarranty(fd); } catch (err) { toast(err.message, 'error'); return; }
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addDevice', {
          condition: conditionAtSubmit, name: fd.get('name'), warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod, code: fd.get('code'),
          deviceType: deviceType,
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listDevices', res.item);
      }, {
        successMsg: 'تمت إضافة الجهاز',
        onDone: function () { currentDeviceType = deviceType; renderDeviceTypeItems(deviceType); }
      });
    });
  });
}

function openSellDeviceForm(device) {
  const overlay = openModal('بيع جهاز للعميل — ' + device.name, `
    <form id="sell-device-form">
      <div class="field"><label>اسم العميل</label><input name="customerName" required /></div>
      <div class="field"><label>رقم العميل</label><input name="customerPhone" required /></div>
      <div class="field">
        <label>عدد الأجهزة (المتاح: ${device.quantity})</label>
        <input type="number" name="quantity" value="1" min="1" max="${device.quantity}" required />
      </div>
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="3" placeholder="أي ملاحظات عن الجهاز أو العملية..."></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">تأكيد البيع</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#sell-device-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (overlay._busy) return; // منع الضغط مرتين (كان بيسجل البيع/التعديل مرتين)
      overlay._busy = true;
      const fd = new FormData(e.target);
      try {
        const result = await apiWrite('sellDevice', {
          deviceId: device.id, customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'),
          quantity: fd.get('quantity'), notes: fd.get('notes'), employee: CURRENT_USER.name
        });
        invalidateProductCaches();
        overlay.remove();
        toast(savedMsg('تم تسجيل بيع الجهاز'), 'success');
        printReceipt({
          customerName: result.sale.customerName, customerPhone: result.sale.customerPhone,
          productName: result.sale.deviceName + (result.sale.quantity > 1 ? ' × ' + result.sale.quantity : ''),
          employee: result.sale.employee, total: result.sale.totalPrice
        });
        loadDevicesTable();
      } catch (err) { overlay._busy = false; toast(err.message, 'error'); }
    });
  });
}

/* ============ تحويلات الكاش ============ */

async function renderCash() {
  setBreadcrumb('سحب وإيداع');
  content().innerHTML = `
    <div class="section-header">
      <input type="text" id="cash-search" placeholder="بحث باسم العميل..." />
      <button class="btn btn-primary" id="add-cash-btn">+ عملية جديدة</button>
    </div>
    <div id="cash-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('add-cash-btn').addEventListener('click', openCashForm);
  document.getElementById('cash-search').addEventListener('input', loadCashTable);
  await loadCashTable();
}

async function loadCashTable() {
  const search = (document.getElementById('cash-search') || {}).value || '';
  try {
    const data = await cachedApi('listCashTransfers');
    let rows = data.items;
    if (search) rows = rows.filter(function (r) { return (r.customerName || '').toLowerCase().includes(search.toLowerCase()); });
    rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    document.getElementById('cash-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>العميل</th><th>الهاتف</th><th>المبلغ</th><th>ملاحظات</th><th>الموظف</th></tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return `<tr>
              <td>${escHtml(r.date)}</td>
              <td><span class="badge ${r.type === 'ايداع' ? 'badge-success' : 'badge-brown'}">${escHtml(r.type)}</span></td>
              <td>${escHtml(r.customerName)}</td><td>${escHtml(r.customerPhone)}</td>
              <td><strong>${Number(r.amount).toLocaleString()}</strong></td>
              <td>${escHtml(r.notes || '-')}</td><td>${escHtml(r.employee)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد عمليات بعد</div>`;
  } catch (err) {
    document.getElementById('cash-table').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openCashForm() {
  const overlay = openModal('عملية تحويل كاش', `
    <form id="cash-form">
      <div class="field">
        <label>نوع العملية</label>
        <select name="type" required>
          <option value="ايداع">إيداع</option>
          <option value="سحب">سحب</option>
        </select>
      </div>
      <div class="field"><label>اسم العميل</label><input name="customerName" required /></div>
      <div class="field"><label>رقم العميل</label><input name="customerPhone" required /></div>
      <div class="field"><label>المبلغ</label><input type="number" name="amount" required /></div>
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="3" placeholder="أي تفاصيل إضافية عن العملية..."></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#cash-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addCashTransfer', {
          type: fd.get('type'), customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'),
          amount: fd.get('amount'), notes: fd.get('notes'), employee: CURRENT_USER.name
        });
        patchCacheAdd('listCashTransfers', res.item);
        return res;
      }, {
        successMsg: 'تم تسجيل العملية',
        onDone: function (result) {
          if (result && result.item) {
            printReceipt({
              customerName: result.item.customerName, customerPhone: result.item.customerPhone,
              productName: 'تحويل كاش — ' + (result.item.type === 'سحب' ? 'سحب' : 'إيداع'),
              employee: result.item.employee, total: result.item.amount
            });
          }
          loadCashTable();
        }
      });
    });
  });
}

/* ============ المخزون ============ */

let inventoryMode = 'accessories';

async function renderInventory() {
  if (isAccounts()) { content().innerHTML = '<div class="empty-state">مش مسموح لك بالدخول هنا</div>'; return; }
  setBreadcrumb('كل المنتجات المتاحة بالمحل');
  content().innerHTML = `
    <div class="section-header">
      <div class="tabs" style="margin-bottom:0">
        <button class="tab-btn active" data-inv-tab="accessories">الإكسسوارات</button>
        <button class="tab-btn" data-inv-tab="devices">الأجهزة</button>
      </div>
      <button class="btn btn-primary" id="inv-add-btn">+ إضافة منتج للمخزون</button>
    </div>
    <div id="inventory-body"></div>
  `;
  document.querySelectorAll('[data-inv-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-inv-tab]').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      inventoryMode = b.getAttribute('data-inv-tab');
      loadInventoryBody(inventoryMode);
    });
  });
  document.getElementById('inv-add-btn').addEventListener('click', openInventoryAddChooser);
  await loadInventoryBody('accessories');
}

function openInventoryAddChooser() {
  const overlay = openModal('إضافة منتج جديد للمخزون', `
    <div class="field">
      <label>كود الباركود (اختياري — امسحه بالسكانر أو اكتبه، أو سيبه فاضي عشان يتولد تلقائي)</label>
      <input type="text" id="inv-add-code" placeholder="امسح الباركود هنا..." autocomplete="off" />
    </div>
    <p style="color:#888">اختر نوع المنتج اللي هتضيفه — هيظهر تلقائيًا في قسمه الصح، ويبقى جاهز للبيع بالباركود بنفس الكود.</p>
    <div class="grid grid-2">
      <button class="btn btn-dark" id="inv-choose-accessory">إكسسوار</button>
      <button class="btn btn-dark" id="inv-choose-device">جهاز</button>
    </div>
  `, function (el) {
    const codeInput = el.querySelector('#inv-add-code');
    codeInput.focus();
    codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    el.querySelector('#inv-choose-accessory').addEventListener('click', function () {
      const code = codeInput.value.trim() || null;
      overlay.remove();
      openScanAddAccessoryForm(code, function () {
        toast('تمت إضافة المنتج للمخزون', 'success');
        loadInventoryBody(inventoryMode);
      });
    });
    el.querySelector('#inv-choose-device').addEventListener('click', function () {
      const code = codeInput.value.trim() || null;
      overlay.remove();
      openScanAddDeviceForm(code, function () {
        toast('تمت إضافة الجهاز للمخزون', 'success');
        loadInventoryBody(inventoryMode);
      });
    });
  });
}

async function loadInventoryBody(mode) {
  const wrap = document.getElementById('inventory-body');
  wrap.innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    if (mode === 'accessories') {
      const [cats, items] = await Promise.all([cachedApi('listAccessoryCategories'), cachedApi('listAccessoryItems')]);
      wrap.innerHTML = `
        <div class="grid grid-3">
          ${cats.items.map(function (c) {
            const list = items.items.filter(function (i) { return String(i.categoryId) === String(c.id); });
            const totalQty = list.reduce(function (s, i) { return s + Number(i.quantity); }, 0);
            return `<div class="card">
              <h3 style="margin-top:0">${catIsPc(c) ? '💻 ' : ''}${escHtml(dispCat(c.name))} <span class="badge badge-brown">${totalQty} قطعة</span></h3>
              ${list.length ? list.map(function (i) {
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong>${escHtml(i.name)}</strong>
                    <span>${i.quantity <= 2 ? '<span class="badge badge-danger">' + i.quantity + '</span>' : i.quantity}
                    <button class="link-btn" style="margin-right:8px" data-edit-acc-id="${escHtml(i.id)}">تعديل</button></span>
                  </div>
                  <div style="color:#888">كود: ${escHtml(i.code || '-')}${i.modelName ? ' — موديل: ' + escHtml(i.modelName) : ''} — إجمالي السعر: ${Number(i.totalPrice).toLocaleString()} ج.م — أُضيف: ${escHtml(i.dateAdded)}</div>
                </div>`;
              }).join('') : '<div class="empty-state" style="padding:12px">لا توجد أصناف</div>'}
            </div>`;
          }).join('') || '<div class="empty-state">لا توجد أنواع إكسسوارات بعد</div>'}
        </div>
      `;
      document.querySelectorAll('[data-edit-acc-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const found = items.items.find(function (i) { return String(i.id) === btn.getAttribute('data-edit-acc-id'); });
          if (found) openEditAccessoryForm(found);
        });
      });
    } else {
      const data = await cachedApi('listDevices');
      wrap.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead><tr><th>الكود</th><th>النوع</th><th>الاسم</th><th>الحالة</th><th>الضمان</th><th>الإجمالي</th><th>الكمية</th><th>تاريخ الإضافة</th><th></th></tr></thead>
            <tbody>
              ${data.items.map(function (d) {
                return `<tr><td><span class="badge badge-slate">${escHtml(d.code || '-')}</span></td><td>${escHtml(d.deviceType || '-')}</td><td>${escHtml(d.name)}</td><td>${escHtml(d.condition)}</td><td>${escHtml(warrantyLabel(d))}</td>
                <td>${Number(d.totalPrice).toLocaleString()}</td>
                <td>${d.quantity <= 2 ? '<span class="badge badge-danger">' + d.quantity + '</span>' : d.quantity}</td>
                <td>${escHtml(d.dateAdded)}</td>
                <td><button class="link-btn" data-edit-dev-id="${escHtml(d.id)}">تعديل</button></td></tr>`;
              }).join('') || '<tr><td colspan="9" class="empty-state">لا توجد أجهزة</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      document.querySelectorAll('[data-edit-dev-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const found = data.items.find(function (d) { return String(d.id) === btn.getAttribute('data-edit-dev-id'); });
          if (found) openEditDeviceForm(found);
        });
      });
    }
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

/* ============ الحسابات ============ */

function openEditAccessoryForm(item, onSaved) {
  if (!canEdit()) { toast('مش مسموح لك بالإضافة أو التعديل', 'error'); return; }
  const overlay = openModal('تعديل الصنف', `
    <form id="edit-acc-form">
      <div class="field"><label>اسم الصنف</label><input name="name" value="${escHtml(item.name)}" required /></div>
      <div class="field"><label>كود المنتج</label><input name="code" value="${escHtml(item.code || '')}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="${item.wholesalePrice}" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="${item.profitPrice}" required /></div>
      </div>
      ${(function () {
        const ms = ((LISTS.listAccessoryModels || {}).items || []).filter(function (m) { return String(m.categoryId) === String(item.categoryId); });
        if (!ms.length) return '';
        return '<div class="field"><label>الموديل</label><select name="modelId"><option value="">بدون موديل</option>' +
          ms.map(function (m) { return '<option value="' + escHtml(m.id) + '"' + (String(m.id) === effModelId(item) ? ' selected' : '') + '>' + escHtml(m.name) + '</option>'; }).join('') +
          '</select></div>';
      })()}
      ${warrantyFieldsHtml(item.warranty, item.warrantyPeriod)}
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="${item.quantity}" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#edit-acc-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (overlay._busy) return; // منع الضغط مرتين (كان بيسجل البيع/التعديل مرتين)
      overlay._busy = true;
      const fd = new FormData(e.target);
      try {
        const wr = readWarranty(fd);
        await apiWrite('updateAccessoryItem', {
          warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod, id: item.id, name: fd.get('name'), code: codeIfChanged(fd, item.code),
          modelId: fd.get('modelId') === null ? undefined : fd.get('modelId'),
          modelName: fd.get('modelId') === null ? undefined : accModelName(fd.get('modelId')),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: numIfChanged(fd, 'quantity', item.quantity)
        });
        invalidateCache('listAccessoryItems');
        overlay.remove();
        toast('تم تعديل الصنف بنجاح', 'success');
        if (onSaved) onSaved(); else loadInventoryBody('accessories');
      } catch (err) { overlay._busy = false; toast(err.message, 'error'); }
    });
  });
}

function openEditDeviceForm(device, onSaved) {
  if (!canEdit()) { toast('مش مسموح لك بالإضافة أو التعديل', 'error'); return; }
  const overlay = openModal('تعديل الجهاز', `
    <form id="edit-dev-form">
      <div class="field"><label>اسم الجهاز</label><input name="name" value="${escHtml(device.name)}" required /></div>
      <div class="field"><label>كود المنتج</label><input name="code" value="${escHtml(device.code || '')}" /></div>
      <div class="field">
        <label>نوع الجهاز</label>
        <select name="deviceType" required>
          ${Array.from(new Set(DEVICE_TYPE_PRESETS.concat([device.deviceType])))
            .map(function (t) { return `<option value="${escHtml(t)}" ${t === device.deviceType ? 'selected' : ''}>${escHtml(t)}</option>`; }).join('')}
        </select>
      </div>
      ${warrantyFieldsHtml(device.warranty, device.warrantyPeriod)}
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="${device.wholesalePrice}" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="${device.profitPrice}" required /></div>
      </div>
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="${device.quantity}" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    bindWarrantyFields(el);
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#edit-dev-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (overlay._busy) return; // منع الضغط مرتين (كان بيسجل البيع/التعديل مرتين)
      overlay._busy = true;
      const fd = new FormData(e.target);
      try {
        const wr = readWarranty(fd);
        await apiWrite('updateDevice', {
          id: device.id, name: fd.get('name'), code: codeIfChanged(fd, device.code), deviceType: fd.get('deviceType'), warranty: wr.warranty, warrantyPeriod: wr.warrantyPeriod,
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: numIfChanged(fd, 'quantity', device.quantity)
        });
        invalidateCache('listDevices');
        overlay.remove();
        toast('تم تعديل الجهاز بنجاح', 'success');
        if (onSaved) onSaved(); else loadInventoryBody('devices');
      } catch (err) { overlay._busy = false; toast(err.message, 'error'); }
    });
  });
}

let accountingRecordsCache = null;

async function renderAccounting() {
  setBreadcrumb('تقارير يومية / شهرية / سنوية، وملخص كل قسم');
  content().innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    const data = await cachedApi('accountingSummary');
    accountingRecordsCache = data.records;
  } catch (err) {
    content().innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
    return;
  }

  content().innerHTML = `
    <div class="grid grid-3" id="acc-summary-cards"></div>
    <div class="tabs" style="margin-top:20px">
      <button class="tab-btn active" data-acc-view="daily">يومي</button>
      <button class="tab-btn" data-acc-view="monthly">شهري</button>
      <button class="tab-btn" data-acc-view="yearly">سنوي</button>
      <button class="tab-btn" data-acc-view="category">حسب القسم</button>
    </div>
    <div id="accounting-body"></div>
  `;
  renderAccountingSummaryCards();
  document.querySelectorAll('[data-acc-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-acc-view]').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderAccountingTable(b.getAttribute('data-acc-view')); // بدون طلب شبكة، فورية
    });
  });
  renderAccountingTable('daily');
}

function renderAccountingSummaryCards() {
  const byCategory = { 'صيانة': { total: 0, profit: 0 }, 'اكسسوارات': { total: 0, profit: 0 }, 'اجهزة': { total: 0, profit: 0 }, 'تحويلات كاش': { total: 0, profit: 0 } };
  accountingRecordsCache.forEach(function (r) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, profit: 0 };
    byCategory[r.category].total += r.total;
    byCategory[r.category].profit += r.profit;
    byCategory[r.category].qty = (byCategory[r.category].qty || 0) + (r.qty || 0);
  });
  const icons = { 'صيانة': '🛠️', 'اكسسوارات': '🎧', 'اجهزة': '📱', 'تحويلات كاش': '💵' };
  document.getElementById('acc-summary-cards').innerHTML = Object.keys(byCategory).map(function (cat) {
    const v = byCategory[cat];
    if (cat === 'تحويلات كاش') {
      return `<div class="card">
      <div style="font-size:22px;margin-bottom:6px">${icons[cat]}</div>
      <h3 style="margin:0 0 10px">${escHtml(cat)}</h3>
      <div class="stat-label">إجمالي مبالغ التحويلات (إيداع + سحب)</div>
      <div class="stat-value brown" style="font-size:20px">${v.total.toLocaleString()} ج.م</div>
    </div>`;
    }
    return `<div class="card">
      <div style="font-size:22px;margin-bottom:6px">${icons[cat] || '📦'}</div>
      <h3 style="margin:0 0 10px">${escHtml(cat)}</h3>
      <div class="stat-label">بعت بإجمالي</div>
      <div class="stat-value brown" style="font-size:20px;margin-bottom:8px">${v.total.toLocaleString()} ج.م</div>
      ${hideCosts() ? '<div class="stat-label">العدد</div><div class="stat-value dark" style="font-size:20px">' + (v.qty || 0).toLocaleString() + '</div>' : '<div class="stat-label">كسبت (المكسب)</div><div class="stat-value dark" style="font-size:20px">' + v.profit.toLocaleString() + ' ج.م</div>'}
    </div>`;
  }).join('');
}

function renderAccountingTable(view) {
  const wrap = document.getElementById('accounting-body');
  const records = accountingRecordsCache || [];

  function groupBy(keyFn) {
    const map = {};
    records.forEach(function (r) {
      const key = keyFn(r);
      if (!map[key]) map[key] = { wholesale: 0, profit: 0, total: 0, cash: 0, qty: 0, maint: 0, acc: 0, dev: 0 };
      if (r.category === 'تحويلات كاش' && view !== 'category') { map[key].cash += r.total; return; } // مبلغ التحويل مش بيع: عمود لوحده
      map[key].qty += (r.qty || 0);
      map[key].wholesale += r.wholesale;
      map[key].profit += r.profit;
      map[key].total += r.total;
      if (r.category === 'صيانة') map[key].maint += r.total;
      else if (r.category === 'اكسسوارات') map[key].acc += r.total;
      else if (r.category === 'اجهزة') map[key].dev += r.total;
    });
    return map;
  }

  let map, headLabel;
  if (view === 'daily') { map = groupBy(function (r) { return r.date; }); headLabel = 'اليوم'; }
  else if (view === 'monthly') { map = groupBy(function (r) { return r.date.substring(0, 7); }); headLabel = 'الشهر'; }
  else if (view === 'yearly') { map = groupBy(function (r) { return r.date.substring(0, 4); }); headLabel = 'السنة'; }
  else { map = groupBy(function (r) { return r.category; }); headLabel = 'القسم'; }

  const keys = Object.keys(map).sort().reverse();
  const byCat = view !== 'category'; // في الأيام/الشهور/السنين: عمود لكل قسم + الإجمالي
  const fmt = function (n) { return n ? n.toLocaleString() + ' ج.م' : '-'; };
  const tot = { wholesale: 0, profit: 0, total: 0, cash: 0, qty: 0, maint: 0, acc: 0, dev: 0 };
  keys.forEach(function (k) { Object.keys(tot).forEach(function (f) { tot[f] += map[k][f] || 0; }); });

  function cells(v) {
    return (hideCosts() ? (byCat ? '' : '<td>' + (v.qty || 0).toLocaleString() + '</td>') : '<td>' + v.wholesale.toLocaleString() + ' ج.م</td><td>' + v.profit.toLocaleString() + ' ج.م</td>') +
      (byCat ? '<td>' + fmt(v.maint) + '</td><td>' + fmt(v.acc) + '</td><td>' + fmt(v.dev) + '</td>' : '') +
      '<td><strong>' + v.total.toLocaleString() + ' ج.م</strong></td><td>' + fmt(v.cash) + '</td>';
  }
  const head = '<th>' + headLabel + '</th>' +
    (hideCosts() ? (byCat ? '' : '<th>العدد</th>') : '<th>سعر الجملة</th><th>المكسب</th>') +
    (byCat ? '<th>🛠️ صيانة</th><th>🎧 إكسسوارات</th><th>📱 أجهزة</th>' : '') +
    '<th>' + (byCat ? 'إجمالي كل الأقسام' : 'الإجمالي (اللي بعته)') + '</th><th>تحويلات كاش</th>';
  const colspan = (hideCosts() ? (byCat ? 0 : 1) : 2) + (byCat ? 3 : 0) + 3;

  wrap.innerHTML = `
    ${view === 'daily' ? '<div class="stat-label" style="margin-bottom:8px">اضغط على أي يوم لعرض كل اللي اتباع فيه بالتفاصيل</div>' : ''}
    <div class="table-wrap">
      <table>
        <thead><tr>${head}</tr></thead>
        <tbody>
          ${keys.map(function (k) { return '<tr' + (view === 'daily' ? ' data-day="' + escHtml(k) + '" style="cursor:pointer" title="اضغط لعرض تفاصيل اليوم"' : '') + '><td>' + escHtml(k) + (view === 'daily' ? ' <span style="opacity:.5">◂</span>' : '') + '</td>' + cells(map[k]) + '</tr>'; }).join('') || '<tr><td colspan="' + colspan + '" class="empty-state">لا توجد بيانات بعد</td></tr>'}
        </tbody>
        ${keys.length > 1 ? '<tfoot><tr style="font-weight:800;background:rgba(255,255,255,.04)"><td>المجموع</td>' + cells(tot) + '</tr></tfoot>' : ''}
      </table>
    </div>
  `;
  if (view === 'daily') {
    wrap.querySelectorAll('[data-day]').forEach(function (tr) {
      tr.addEventListener('click', function () { openDayDetails(tr.getAttribute('data-day')); });
    });
  }
}

/* ---------- تفاصيل اليوم (بتفتح لما تدوس على يوم في الحسابات اليومية) ---------- */

// بيجمع كل اللي اتباع/اتسجل في اليوم ده من القوائم المحلية (فبيشتغل أوفلاين كمان)
async function loadDayRecords(day) {
  const r = await Promise.all([cachedApi('listMaintenance'), cachedApi('listAccessorySales'), cachedApi('listDeviceSales'), cachedApi('listReturns'), cachedApi('listCashTransfers')]);
  const inDay = function (x) { return String(x.date || '').substring(0, 10) === day; };
  const timeOf = function (x) { const s = String(x.date || ''); return s.length >= 16 ? s.substring(11, 16) : ''; };
  const out = { maint: [], acc: [], dev: [], cash: [] };

  ((r[0] || {}).items || []).filter(inDay).forEach(function (m) {
    out.maint.push({
      key: String(m.date || ''), time: timeOf(m),
      name: [m.deviceType, m.faultType || m.caseType].filter(Boolean).join(' - ') || 'صيانة',
      sub: [m.deviceCategory, m.notes].filter(Boolean).join(' • '),
      customer: m.customerName, phone: m.customerPhone, employee: m.employee,
      qty: 1, wholesale: num(m.wholesaleCost), profit: num(m.profitCost), total: num(m.total)
    });
  });
  ((r[1] || {}).items || []).filter(inDay).forEach(function (s) {
    out.acc.push({
      key: String(s.date || ''), time: timeOf(s), name: s.itemName,
      sub: [s.categoryName, num(s.discount) > 0 ? 'خصم ' + num(s.discount).toLocaleString() + ' ج.م' : '', s.notes].filter(Boolean).join(' • '),
      customer: s.customerName, phone: s.customerPhone, employee: s.employee,
      qty: num(s.quantity) || 1, wholesale: num(s.wholesalePrice), profit: num(s.profitPrice), total: num(s.totalPrice)
    });
  });
  ((r[2] || {}).items || []).filter(inDay).forEach(function (s) {
    out.dev.push({
      key: String(s.date || ''), time: timeOf(s), name: s.deviceName,
      sub: [s.deviceType, s.condition, num(s.discount) > 0 ? 'خصم ' + num(s.discount).toLocaleString() + ' ج.م' : '', s.notes].filter(Boolean).join(' • '),
      customer: s.customerName, phone: s.customerPhone, employee: s.employee,
      qty: num(s.quantity) || 1, wholesale: num(s.wholesalePrice), profit: num(s.profitPrice), total: num(s.totalPrice)
    });
  });
  // المرتجع بيتحسب في قسمه بالسالب (نفس منطق الحسابات)
  ((r[3] || {}).items || []).filter(inDay).forEach(function (x) {
    const w = x.restock === 'نعم' ? -num(x.wholesalePrice) : 0;
    const t = -num(x.refundAmount);
    (x.saleType === 'device' ? out.dev : out.acc).push({
      key: String(x.date || ''), time: timeOf(x), name: 'مرتجع: ' + (x.itemName || ''),
      sub: x.reason || '', customer: x.customerName, phone: x.customerPhone, employee: x.employee,
      qty: -num(x.quantity), wholesale: w, profit: t - w, total: t, isReturn: true
    });
  });
  ((r[4] || {}).items || []).filter(inDay).forEach(function (c) {
    out.cash.push({
      key: String(c.date || ''), time: timeOf(c), name: c.type || 'تحويل',
      sub: c.notes || '', customer: c.customerName, phone: c.customerPhone, employee: c.employee,
      qty: 1, wholesale: 0, profit: 0, total: num(c.amount)
    });
  });
  Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }); });
  return out;
}

function dayDetailsHtml(day, d) {
  const costs = !hideCosts(); // المدير (الأدمن) بيشوف الجملة والمكسب، الباقي الإجمالي بس
  const money = function (n) { return num(n).toLocaleString() + ' ج.م'; };
  const sections = [
    { id: 'maint', title: '🛠️ صيانة', cash: false },
    { id: 'acc', title: '🎧 إكسسوارات', cash: false },
    { id: 'dev', title: '📱 أجهزة', cash: false },
    { id: 'cash', title: '💵 تحويلات كاش', cash: true }
  ];
  const sum = function (rows, f) { return rows.reduce(function (t, x) { return t + num(x[f]); }, 0); };

  let allW = 0, allP = 0, allT = 0, cashT = 0, count = 0;
  let html = '';
  sections.forEach(function (sec) {
    const rows = d[sec.id];
    if (!rows.length) return;
    if (sec.cash) cashT += sum(rows, 'total');
    else { allW += sum(rows, 'wholesale'); allP += sum(rows, 'profit'); allT += sum(rows, 'total'); count += rows.length; }
    const showCosts = costs && !sec.cash;
    const head = '<th>الوقت</th><th>' + (sec.cash ? 'النوع' : 'البيان') + '</th><th>العميل</th><th>الموظف</th>' +
      (sec.cash ? '' : '<th>الكمية</th>') +
      (showCosts ? '<th>الجملة</th><th>المكسب</th>' : '') +
      '<th>' + (sec.cash ? 'المبلغ' : 'الإجمالي') + '</th>';
    const body = rows.map(function (x) {
      return '<tr' + (x.isReturn ? ' style="color:#f0a89f"' : '') + '><td>' + escHtml(x.time || '-') + '</td>' +
        '<td>' + escHtml(x.name || '-') + (x.sub ? '<div class="muted-sub" style="font-size:11.5px;opacity:.7">' + escHtml(x.sub) + '</div>' : '') + '</td>' +
        '<td>' + escHtml(x.customer || '-') + (x.phone ? '<div class="muted-sub" style="font-size:11.5px;opacity:.7">' + escHtml(x.phone) + '</div>' : '') + '</td>' +
        '<td>' + escHtml(x.employee || '-') + '</td>' +
        (sec.cash ? '' : '<td>' + x.qty.toLocaleString() + '</td>') +
        (showCosts ? '<td>' + money(x.wholesale) + '</td><td>' + money(x.profit) + '</td>' : '') +
        '<td><strong>' + money(x.total) + '</strong></td></tr>';
    }).join('');
    const foot = '<tr style="font-weight:800"><td colspan="' + (sec.cash ? 4 : 5) + '">إجمالي ' + sec.title.replace(/^\S+\s/, '') + '</td>' +
      (showCosts ? '<td>' + money(sum(rows, 'wholesale')) + '</td><td>' + money(sum(rows, 'profit')) + '</td>' : '') +
      '<td>' + money(sum(rows, 'total')) + '</td></tr>';
    html += '<h4 class="day-sec-title" style="margin:18px 0 8px">' + sec.title + ' <span style="font-weight:400;opacity:.7">(' + rows.length + ')</span></h4>' +
      '<div class="table-wrap"><table class="day-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  });

  if (!html) return '<div class="empty-state">مفيش عمليات في اليوم ده</div>';

  const summary = '<div class="grid grid-' + (costs ? '4' : '2') + ' day-summary" style="margin-bottom:6px">' +
    '<div class="card stat-card"><div class="stat-label">إجمالي المبيعات</div><div class="stat-value brown" style="font-size:20px">' + money(allT) + '</div></div>' +
    (costs ? '<div class="card stat-card"><div class="stat-label">سعر الجملة</div><div class="stat-value dark" style="font-size:20px">' + money(allW) + '</div></div>' +
      '<div class="card stat-card"><div class="stat-label">المكسب</div><div class="stat-value dark" style="font-size:20px">' + money(allP) + '</div></div>' : '') +
    '<div class="card stat-card"><div class="stat-label">تحويلات كاش</div><div class="stat-value dark" style="font-size:20px">' + money(cashT) + '</div></div>' +
    '</div>';
  return summary + html;
}

function printHtmlDoc(title, bodyHtml) {
  const html = '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>' + escHtml(title) + '</title><style>' +
    '@page { size: A4; margin: 10mm; }' +
    '* { box-sizing: border-box; }' +
    'body { font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size: 12px; color: #000; background: #fff; margin: 0; }' +
    'h2 { margin: 0 0 2px; } h4 { margin: 14px 0 6px; font-size: 14px; }' +
    '.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }' +
    '.grid { display: flex; gap: 8px; margin-bottom: 6px; } .card { border: 1px solid #000; padding: 6px 10px; flex: 1; }' +
    '.stat-label { font-size: 11px; } .stat-value { font-size: 15px; font-weight: bold; }' +
    'table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #555; padding: 4px 6px; text-align: right; vertical-align: top; }' +
    'thead th { background: #eee; } tfoot td { background: #f5f5f5; }' +
    'tr { page-break-inside: avoid; }' +
    '</style></head><body>' + bodyHtml + '</body></html>';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(function () {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { toast('تعذرت الطباعة: ' + e.message, 'error'); }
    setTimeout(function () { frame.remove(); }, 60000);
  }, 300);
}

async function openDayDetails(day) {
  const overlay = openModal('تفاصيل يوم ' + day, '<div class="empty-state">جاري التحميل...</div>', null);
  overlay.querySelector('.modal').style.maxWidth = 'min(1000px, 100%)';
  try {
    const d = await loadDayRecords(day);
    const inner = dayDetailsHtml(day, d);
    const hasData = inner.indexOf('empty-state') === -1;
    overlay.querySelector('#modal-body').innerHTML = inner +
      '<div class="modal-actions" style="align-items:center">' +
      (hasData ? '<button type="button" class="link-btn" id="day-print-btn">🖨️ طباعة</button>' : '') +
      '<button type="button" class="btn btn-outline" id="day-close-btn" style="margin-right:auto">إغلاق</button></div>';
    overlay.querySelector('#day-close-btn').addEventListener('click', function () { overlay.remove(); });
    const pb = overlay.querySelector('#day-print-btn');
    if (pb) pb.addEventListener('click', function () {
      const printBody = '<div class="head"><div><h2>' + escHtml(SHOP_NAME) + '</h2><div>تقرير مبيعات يوم ' + escHtml(day) + '</div></div>' +
        '<div>' + new Date().toLocaleString('en-GB') + '</div></div>' + inner;
      printHtmlDoc('تقرير يوم ' + day, printBody);
    });
  } catch (err) {
    overlay.querySelector('#modal-body').innerHTML = '<div class="empty-state">' + escHtml(err.message) + '</div>';
  }
}

/* ============ الآجل (ديون العملاء) ============ */

let debtsFilter = 'open';

function debtDue(d) { return String(d.dueDate || '').substring(0, 10); }
function todayStr() { return localNowStr().substring(0, 10); }
function debtOverdue(d) { const due = debtDue(d); return d.status !== 'مسدد' && Number(d.remaining) > 0 && due && due < todayStr(); }

async function renderDebts() {
  setBreadcrumb('فواتير الآجل: اللي اتدفع واللي لسه على العملاء وميعاد السداد');
  content().innerHTML = '<div class="empty-state">جاري التحميل...</div>';
  let items;
  try { items = (await cachedApi('listDebts')).items || []; }
  catch (err) { content().innerHTML = '<div class="empty-state">' + escHtml(err.message) + '</div>'; return; }

  const open = items.filter(function (d) { return d.status !== 'مسدد' && Number(d.remaining) > 0; });
  const late = open.filter(debtOverdue);
  const sum = function (arr) { return arr.reduce(function (t, d) { return t + (Number(d.remaining) || 0); }, 0); };

  const view = debtsFilter === 'open' ? open : debtsFilter === 'late' ? late
    : debtsFilter === 'paid' ? items.filter(function (d) { return !(d.status !== 'مسدد' && Number(d.remaining) > 0); }) : items;
  view.sort(function (a, b) {
    if (debtsFilter === 'open' || debtsFilter === 'late') return (debtDue(a) || '9999').localeCompare(debtDue(b) || '9999');
    return String(b.date).localeCompare(String(a.date));
  });

  const tab = function (id, label) { return '<button class="tab-btn ' + (debtsFilter === id ? 'active' : '') + '" data-debt-filter="' + id + '">' + label + '</button>'; };
  content().innerHTML = `
    <div class="grid grid-3">
      <div class="card"><div class="stat-label">إجمالي المتبقي عند العملاء</div><div class="stat-value brown">${sum(open).toLocaleString()} ج.م</div></div>
      <div class="card"><div class="stat-label">عدد الفواتير المفتوحة</div><div class="stat-value dark">${open.length.toLocaleString()}</div></div>
      <div class="card"><div class="stat-label">متأخر عن ميعاده</div><div class="stat-value" style="color:#e55">${late.length.toLocaleString()} — ${sum(late).toLocaleString()} ج.م</div></div>
    </div>
    <div class="tabs" style="margin-top:20px">
      ${tab('open', 'مفتوح (' + open.length + ')')}${tab('late', 'متأخر (' + late.length + ')')}${tab('paid', 'مسدد')}${tab('all', 'الكل')}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>التاريخ</th><th>العميل</th><th>الهاتف</th><th>الأصناف</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>ميعاد السداد</th><th></th></tr></thead>
      <tbody>
        ${view.map(function (d) {
          const isOpen = d.status !== 'مسدد' && Number(d.remaining) > 0;
          const late1 = debtOverdue(d);
          return '<tr><td>' + escHtml(String(d.date).substring(0, 10)) + '</td><td>' + escHtml(d.customerName) + '</td><td>' + escHtml(d.customerPhone) + '</td>' +
            '<td style="max-width:220px">' + escHtml(d.items) + '</td>' +
            '<td>' + Number(d.total).toLocaleString() + '</td><td>' + Number(d.paid).toLocaleString() + '</td>' +
            '<td><strong>' + Number(d.remaining).toLocaleString() + '</strong></td>' +
            '<td' + (late1 ? ' style="color:#e55;font-weight:800"' : '') + '>' + escHtml(isOpen ? (debtDue(d) || '-') : 'مسدد ✓') + (late1 ? ' (متأخر)' : '') + '</td>' +
            '<td>' + (isOpen && !isViewer() ? '<button class="btn btn-primary btn-sm" data-pay-debt="' + escHtml(d.id) + '">تسديد</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="9" class="empty-state">مفيش فواتير آجل هنا</td></tr>'}
      </tbody>
    </table></div>
  `;
  content().querySelectorAll('[data-debt-filter]').forEach(function (b) {
    b.addEventListener('click', function () { debtsFilter = b.getAttribute('data-debt-filter'); renderDebts(); });
  });
  content().querySelectorAll('[data-pay-debt]').forEach(function (b) {
    b.addEventListener('click', function () {
      const d = items.filter(function (x) { return String(x.id) === b.getAttribute('data-pay-debt'); })[0];
      if (d) openPayDebtForm(d);
    });
  });
}

function openPayDebtForm(d) {
  const rem = Number(d.remaining) || 0;
  const overlay = openModal('تسديد آجل — ' + d.customerName, `
    <form id="pay-debt-form">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px"><span>المتبقي حاليًا</span><strong>${rem.toLocaleString()} ج.م</strong></div>
      <div class="field"><label>المبلغ اللي هيسدده دلوقتي</label><input type="number" name="amount" min="0.01" max="${rem}" step="any" value="${rem}" required /></div>
      <div class="field" id="pd-due-wrap" style="display:none"><label>ميعاد سداد الباقي</label><input type="date" name="dueDate" value="${escHtml(debtDue(d))}" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">تأكيد السداد</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    const amountInp = el.querySelector('[name=amount]');
    const dueWrap = el.querySelector('#pd-due-wrap');
    amountInp.addEventListener('input', function () { dueWrap.style.display = (Number(amountInp.value) || 0) < rem ? '' : 'none'; });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#pay-debt-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = Number(fd.get('amount')) || 0;
      if (amount <= 0 || amount > rem) { toast('المبلغ لازم يكون أكبر من صفر وميزيدش عن المتبقي', 'error'); return; }
      saveInBackground(overlay, function () {
        return apiWrite('payDebt', { debtId: d.id, amount: amount, dueDate: amount < rem ? fd.get('dueDate') : '', employee: CURRENT_USER.name });
      }, {
        successMsg: 'تم تسجيل السداد',
        onDone: function (result) {
          const left = result && result.item ? Number(result.item.remaining) : Math.max(0, rem - amount);
          printReceipt({
            customerName: d.customerName, productName: 'سداد آجل' + (d.items ? ' — ' + d.items : ''), employee: CURRENT_USER.name,
            total: Number(d.total) || amount,
            payment: { paid: amount, remaining: left, dueDate: left > 0 ? (fd.get('dueDate') || debtDue(d)) : '' }
          });
          if (CURRENT_SECTION === 'debts') renderDebts();
        }
      });
    });
  });
}

/* ============ البحث العام (فوق الرئيسية) ============ */

const GS_SOURCES = ['listAccessoryItems', 'listDevices', 'listMaintenance', 'listAccessorySales', 'listDeviceSales', 'listCashTransfers', 'listDebts', 'listReturns'];
const GS_D = function (r) { return String(r.date || '').substring(0, 10); };
const GS_M = function (n) { return Number(n || 0).toLocaleString() + ' ج.م'; };
const GS_TYPES = [
  { key: 'listAccessoryItems', label: '🎧 إكسسوار', go: 'accessories', fields: ['name', 'code', 'categoryName', 'modelName'],
    title: function (r) { return r.name; }, sub: function (r) { return [r.categoryName, r.code ? 'كود ' + r.code : '', 'متاح ' + r.quantity, GS_M(r.totalPrice)]; },
    detail: [['الاسم', 'name'], ['الكود', 'code'], ['النوع', 'categoryName'], ['الموديل', 'modelName'], ['السعر', function (r) { return GS_M(r.totalPrice); }], ['المتاح', 'quantity'], ['الضمان', function (r) { return r.warranty === 'له ضمان' ? 'له ضمان ' + (r.warrantyPeriod || '') : 'بدون ضمان'; }], ['تاريخ الإضافة', GS_D]] },
  { key: 'listDevices', label: '📱 جهاز', go: 'devices', fields: ['name', 'code', 'deviceType', 'condition'],
    title: function (r) { return r.name; }, sub: function (r) { return [r.deviceType, r.condition, r.code ? 'كود ' + r.code : '', 'متاح ' + r.quantity, GS_M(r.totalPrice)]; },
    detail: [['الاسم', 'name'], ['الكود', 'code'], ['النوع', 'deviceType'], ['الحالة', 'condition'], ['السعر', function (r) { return GS_M(r.totalPrice); }], ['المتاح', 'quantity'], ['الضمان', function (r) { return r.warranty === 'له ضمان' ? 'له ضمان ' + (r.warrantyPeriod || '') : 'بدون ضمان'; }], ['تاريخ الإضافة', GS_D]] },
  { key: 'listMaintenance', label: '🛠️ صيانة', go: 'maintenance', fields: ['customerName', 'customerPhone', 'deviceType', 'faultType', 'deviceCategory', 'notes'],
    title: function (r) { return (r.customerName || '-') + ' — ' + (r.deviceType || ''); }, sub: function (r) { return [r.faultType, r.customerPhone, GS_D(r), GS_M(r.total)]; },
    detail: [['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['نوع الجهاز', 'deviceType'], ['نوع الصيانة', 'deviceCategory'], ['الحالة', 'caseType'], ['العطل', 'faultType'], ['الإجمالي', function (r) { return GS_M(r.total); }], ['ملاحظات', 'notes'], ['الموظف', 'employee'], ['التاريخ', GS_D]] },
  { key: 'listAccessorySales', label: '🧾 بيع إكسسوار', go: null, fields: ['itemName', 'code', 'customerName', 'customerPhone', 'notes'],
    title: function (r) { return r.itemName; }, sub: function (r) { return [r.customerName, r.customerPhone, GS_D(r), GS_M(r.totalPrice)]; },
    detail: [['الصنف', 'itemName'], ['الكود', 'code'], ['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['الكمية', 'quantity'], ['الإجمالي', function (r) { return GS_M(r.totalPrice); }], ['الخصم', function (r) { return Number(r.discount) ? GS_M(r.discount) : ''; }], ['الضمان', function (r) { return r.warranty === 'له ضمان' ? 'له ضمان ' + (r.warrantyPeriod || '') : 'بدون ضمان'; }], ['الموظف', 'employee'], ['التاريخ', GS_D]] },
  { key: 'listDeviceSales', label: '🧾 بيع جهاز', go: null, fields: ['deviceName', 'code', 'customerName', 'customerPhone', 'notes'],
    title: function (r) { return r.deviceName; }, sub: function (r) { return [r.customerName, r.customerPhone, GS_D(r), GS_M(r.totalPrice)]; },
    detail: [['الجهاز', 'deviceName'], ['الكود', 'code'], ['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['الكمية', 'quantity'], ['الإجمالي', function (r) { return GS_M(r.totalPrice); }], ['الخصم', function (r) { return Number(r.discount) ? GS_M(r.discount) : ''; }], ['الضمان', function (r) { return r.warranty === 'له ضمان' ? 'له ضمان ' + (r.warrantyPeriod || '') : 'بدون ضمان'; }], ['الموظف', 'employee'], ['التاريخ', GS_D]] },
  { key: 'listCashTransfers', label: '💵 تحويل كاش', go: 'cash', fields: ['customerName', 'customerPhone', 'type', 'notes'],
    title: function (r) { return (r.customerName || '-') + ' — ' + r.type; }, sub: function (r) { return [r.customerPhone, GS_D(r), GS_M(r.amount)]; },
    detail: [['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['العملية', 'type'], ['المبلغ', function (r) { return GS_M(r.amount); }], ['ملاحظات', 'notes'], ['الموظف', 'employee'], ['التاريخ', GS_D]] },
  { key: 'listDebts', label: '⏳ آجل', go: 'debts', fields: ['customerName', 'customerPhone', 'items', 'notes'],
    title: function (r) { return (r.customerName || '-') + ' — متبقي ' + GS_M(r.remaining); }, sub: function (r) { return [r.customerPhone, r.status === 'مسدد' ? 'مسدد' : 'سداد ' + (debtDue(r) || '-'), r.items]; },
    detail: [['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['الأصناف', 'items'], ['الإجمالي', function (r) { return GS_M(r.total); }], ['المدفوع', function (r) { return GS_M(r.paid); }], ['المتبقي', function (r) { return GS_M(r.remaining); }], ['ميعاد السداد', debtDue], ['الحالة', 'status'], ['التاريخ', GS_D]] },
  { key: 'listReturns', label: '↩️ مسترجع', go: 'returns', fields: ['itemName', 'code', 'customerName', 'customerPhone', 'reason'],
    title: function (r) { return r.itemName; }, sub: function (r) { return [r.customerName, GS_D(r), GS_M(r.refundAmount)]; },
    detail: [['الصنف', 'itemName'], ['الكود', 'code'], ['العميل', 'customerName'], ['الهاتف', 'customerPhone'], ['الكمية', 'quantity'], ['المبلغ المرجّع', function (r) { return GS_M(r.refundAmount); }], ['السبب', 'reason'], ['التاريخ', GS_D]] }
];

function gsNorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
}

function gsInjectStyle() {
  if (document.getElementById('gs-style')) return;
  const st = document.createElement('style');
  st.id = 'gs-style';
  st.textContent =
    '.gsearch-box{padding:12px 16px 4px}' +
    '#gsearch-input{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#333);background:var(--charcoal-3,#26262b);color:var(--text,#eee);font:inherit;font-size:14px}' +
    '#gsearch-input:focus{outline:none;border-color:#c9824a}' +
    '.gs-panel{position:fixed;z-index:9999;max-height:70vh;overflow:auto;background:var(--charcoal-2,#1f1f23);border:1px solid var(--border,#333);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:6px}' +
    '.gs-group{font-size:12px;color:#c9824a;font-weight:800;padding:8px 10px 4px}' +
    '.gs-item{display:block;width:100%;text-align:right;background:none;border:0;color:var(--text,#eee);font:inherit;padding:8px 10px;border-radius:8px;cursor:pointer}' +
    '.gs-item:hover,.gs-item:focus{background:rgba(255,255,255,.07);outline:none}' +
    '.gs-item .t{font-weight:700;font-size:14px}.gs-item .s{font-size:12px;opacity:.7;margin-top:2px}' +
    '.gs-empty{padding:16px;text-align:center;opacity:.7;font-size:14px}';
  document.head.appendChild(st);
}

let gsRequest = 0;
function initGlobalSearch() {
  gsInjectStyle();
  const old = document.getElementById('gs-panel'); if (old) old.remove();
  const input = document.getElementById('gsearch-input');
  if (!input) return;
  let panel = null, timer = null;

  function closePanel() { if (panel) { panel.remove(); panel = null; } }
  function place() {
    const r = input.getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 16);
    panel.style.width = w + 'px';
    panel.style.top = (r.bottom + 6) + 'px';
    panel.style.right = Math.max(8, Math.min(window.innerWidth - r.right, window.innerWidth - w - 8)) + 'px';
  }
  function showHtml(html) {
    if (!panel) { panel = document.createElement('div'); panel.id = 'gs-panel'; panel.className = 'gs-panel'; document.body.appendChild(panel); }
    panel.innerHTML = html; place();
  }

  async function run() {
    const q = gsNorm(input.value).trim();
    if (q.length < 2) { closePanel(); return; }
    const my = ++gsRequest;
    showHtml('<div class="gs-empty">جاري البحث...</div>');
    const data = {};
    await Promise.all(GS_SOURCES.map(function (a) {
      return cachedApi(a).then(function (r) { data[a] = (r && r.items) || []; }).catch(function () { data[a] = ((LISTS[a] || {}).items) || []; });
    }));
    if (my !== gsRequest) return; // بحث أحدث بدأ
    const tokens = q.split(/\s+/);
    const hits = [];
    GS_TYPES.forEach(function (t) {
      const found = (data[t.key] || []).filter(function (r) {
        const hay = gsNorm(t.fields.map(function (f) { return r[f]; }).join(' '));
        return tokens.every(function (tk) { return hay.indexOf(tk) !== -1; });
      }).sort(function (a, b) { return String(b.date || b.dateAdded || '').localeCompare(String(a.date || a.dateAdded || '')); });
      if (found.length) hits.push({ t: t, rows: found });
    });
    if (!hits.length) { showHtml('<div class="gs-empty">مفيش نتائج لـ "' + escHtml(input.value) + '"</div>'); return; }
    let idx = 0; const flat = [];
    showHtml(hits.map(function (h) {
      return '<div class="gs-group">' + h.t.label + ' (' + h.rows.length + ')</div>' + h.rows.slice(0, 6).map(function (r) {
        flat.push({ t: h.t, r: r });
        return '<button type="button" class="gs-item" data-gs="' + (idx++) + '"><div class="t">' + escHtml(h.t.title(r)) + '</div><div class="s">' +
          escHtml(h.t.sub(r).filter(Boolean).join(' • ')) + '</div></button>';
      }).join('') + (h.rows.length > 6 ? '<div class="gs-empty" style="padding:4px;font-size:12px">+' + (h.rows.length - 6) + ' نتيجة تانية، دقّق في البحث</div>' : '');
    }).join(''));
    panel.querySelectorAll('[data-gs]').forEach(function (b) {
      b.addEventListener('click', function () { const x = flat[Number(b.getAttribute('data-gs'))]; closePanel(); gsOpenDetail(x.t, x.r); });
    });
  }

  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 180); });
  input.addEventListener('focus', function () { if (gsNorm(input.value).trim().length >= 2) run(); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePanel(); input.blur(); } });
  document.addEventListener('click', function (e) {
    if (panel && e.target !== input && !panel.contains(e.target)) closePanel();
  });
}

function gsOpenDetail(t, r) {
  const rows = t.detail.map(function (d) {
    const v = typeof d[1] === 'function' ? d[1](r) : r[d[1]];
    return (v === undefined || v === null || v === '') ? '' :
      '<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border,#333)"><span style="opacity:.7">' + escHtml(d[0]) + '</span><strong style="text-align:left">' + escHtml(v) + '</strong></div>';
  }).join('');
  const canGo = t.go && !(t.go === 'inventory' && isAccounts());
  const overlay = openModal(t.label + ' — ' + t.title(r), rows + `
    <div class="modal-actions" style="margin-top:14px">
      ${canGo ? '<button type="button" class="btn btn-primary" id="gs-go">فتح القسم</button>' : ''}
      <button type="button" class="btn btn-outline" id="gs-close">إغلاق</button>
    </div>`, function (el) {
    el.querySelector('#gs-close').addEventListener('click', function () { overlay.remove(); });
    const go = el.querySelector('#gs-go');
    if (go) go.addEventListener('click', function () { overlay.remove(); CURRENT_SECTION = t.go; renderApp(); });
  });
}

/* ============ الحضور والمرتبات (مدير النظام فقط) ============ */

let hrTab = 'payroll';
let hrMonth = '';
let hrAttDate = '';
let HR = { emps: [], att: [], adj: [] };
const HR_STATUSES = ['حاضر', 'غائب', 'متأخر', 'إجازة'];
const HR_MONTH_DAYS = 30; // المرتب اليومي = المرتب الأساسي ÷ 30
const HR_INP = 'padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--charcoal-3);color:var(--text)';

function hrCurMonth() { if (!hrMonth) hrMonth = localNowStr().substring(0, 7); return hrMonth; }
function hrCurDate() { if (!hrAttDate) hrAttDate = localNowStr().substring(0, 10); return hrAttDate; }
function hrD(r) { return String(r.date || '').substring(0, 10); }
function hrMoney(n) { return (Math.round(num(n) * 100) / 100).toLocaleString() + ' ج.م'; }
function hrActive() { return HR.emps.filter(function (e) { return e.active !== 'لا'; }); }
function hrEmp(id) { return HR.emps.filter(function (e) { return String(e.id) === String(id); })[0]; }
function hrAttRec(empId, date) {
  return HR.att.filter(function (a) { return String(a.employeeId) === String(empId) && hrD(a) === date; })[0];
}
function hrAttApply(empId, date, status, notes) {
  HR.att = HR.att.filter(function (a) { return !(String(a.employeeId) === String(empId) && hrD(a) === date); });
  if (status) HR.att.push({ employeeId: empId, employeeName: (hrEmp(empId) || {}).name || '', date: date, status: status, notes: notes || '' });
}

async function hrFetch() {
  const r = await Promise.all([api('listEmployees'), api('listAttendance'), api('listAdjustments')]);
  HR = { emps: r[0].items || [], att: r[1].items || [], adj: r[2].items || [] };
}

async function renderHr() {
  if (!CURRENT_USER || CURRENT_USER.role !== 'مدير النظام') { content().innerHTML = '<div class="empty-state">هذا القسم لمدير النظام فقط</div>'; return; }
  setBreadcrumb('أسماء الموظفين والحضور والغياب والمرتبات والخصومات والمكافآت');
  content().innerHTML = '<div class="empty-state">جاري التحميل...</div>';
  try { await hrFetch(); }
  catch (err) {
    const hint = err.message.indexOf('غير معروف') > -1 ? ' — لازم تحدّث Code.gs وتنشر نسخة جديدة' : (err.isNetwork ? ' — القسم ده محتاج إنترنت' : '');
    content().innerHTML = '<div class="empty-state">' + escHtml(err.message + hint) + '</div>';
    return;
  }
  drawHr();
}

async function hrReload() {
  try { await hrFetch(); } catch (err) { toast(err.message, 'error'); }
  if (CURRENT_SECTION === 'hr') drawHr();
}

function drawHr() {
  const tab = function (id, label) { return '<button class="tab-btn ' + (hrTab === id ? 'active' : '') + '" data-hr-tab="' + id + '">' + label + '</button>'; };
  content().innerHTML = '<div class="tabs">' + tab('payroll', '💰 المرتبات') + tab('attendance', '📅 الحضور والغياب') + tab('employees', '👥 الموظفين') + '</div><div id="hr-body"></div>';
  content().querySelectorAll('[data-hr-tab]').forEach(function (b) {
    b.addEventListener('click', function () { hrTab = b.getAttribute('data-hr-tab'); drawHr(); });
  });
  if (hrTab === 'employees') drawHrEmployees();
  else if (hrTab === 'attendance') drawHrAttendance();
  else drawHrPayroll();
}

/* ---------- الموظفين ---------- */

function drawHrEmployees() {
  const body = document.getElementById('hr-body');
  body.innerHTML = '<div class="section-header"><div></div><button class="btn btn-primary" id="hr-add-emp">+ إضافة موظف</button></div>' +
    '<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الوظيفة</th><th>الهاتف</th><th>المرتب الأساسي</th><th>تاريخ التعيين</th><th>الحالة</th><th></th></tr></thead><tbody>' +
    (HR.emps.map(function (e) {
      return '<tr><td><strong>' + escHtml(e.name) + '</strong></td><td>' + escHtml(e.jobTitle || '-') + '</td><td>' + escHtml(e.phone || '-') + '</td>' +
        '<td>' + hrMoney(e.baseSalary) + '</td><td>' + escHtml(String(e.hireDate || '-').substring(0, 10)) + '</td>' +
        '<td><span class="badge ' + (e.active === 'لا' ? 'badge-danger' : 'badge-success') + '">' + (e.active === 'لا' ? 'متوقف' : 'شغال') + '</span></td>' +
        '<td><button class="link-btn" data-hr-edit="' + escHtml(e.id) + '">تعديل</button></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty-state">لسه مفيش موظفين، ضيف أول موظف</td></tr>') +
    '</tbody></table></div>';
  document.getElementById('hr-add-emp').addEventListener('click', function () { openHrEmployeeForm(null); });
  body.querySelectorAll('[data-hr-edit]').forEach(function (b) {
    b.addEventListener('click', function () { openHrEmployeeForm(hrEmp(b.getAttribute('data-hr-edit'))); });
  });
}

function openHrEmployeeForm(emp) {
  const isEdit = !!emp;
  emp = emp || {};
  const overlay = openModal(isEdit ? 'تعديل موظف' : 'إضافة موظف', `
    <form id="hr-emp-form">
      <div class="field"><label>اسم الموظف</label><input name="name" value="${escHtml(emp.name || '')}" required /></div>
      <div class="field"><label>الوظيفة</label><input name="jobTitle" value="${escHtml(emp.jobTitle || '')}" placeholder="مثال: فني صيانة، بائع" /></div>
      <div class="field"><label>رقم الموبايل</label><input name="phone" value="${escHtml(emp.phone || '')}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>المرتب الأساسي (شهري)</label><input type="number" name="baseSalary" min="0" step="any" value="${escHtml(emp.baseSalary === undefined ? 0 : emp.baseSalary)}" required /></div>
        <div class="field"><label>تاريخ التعيين</label><input type="date" name="hireDate" value="${escHtml(String(emp.hireDate || '').substring(0, 10))}" /></div>
      </div>
      ${isEdit ? `<div class="field"><label>الحالة</label><select name="active">
        <option value="نعم" ${emp.active === 'لا' ? '' : 'selected'}>شغال</option>
        <option value="لا" ${emp.active === 'لا' ? 'selected' : ''}>متوقف (مش هيظهر في الحضور والمرتبات)</option></select></div>` : ''}
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="2">${escHtml(emp.notes || '')}</textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#hr-emp-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { name: fd.get('name'), jobTitle: fd.get('jobTitle'), phone: fd.get('phone'), baseSalary: fd.get('baseSalary'), hireDate: fd.get('hireDate'), notes: fd.get('notes') };
      if (isEdit) { payload.id = emp.id; payload.active = fd.get('active'); }
      saveInBackground(overlay, async function () {
        await apiWrite(isEdit ? 'updateEmployee' : 'addEmployee', payload);
      }, { successMsg: isEdit ? 'تم تعديل الموظف' : 'تمت إضافة الموظف', onDone: hrReload });
    });
  });
}

/* ---------- الحضور والغياب ---------- */

function hrAttSummaryHtml(month) {
  const emps = hrActive();
  if (!emps.length) return '';
  return '<h4 style="margin:22px 0 8px">ملخص شهر ' + escHtml(month) + '</h4><div class="table-wrap"><table><thead><tr><th>الموظف</th>' +
    HR_STATUSES.map(function (s) { return '<th>' + s + '</th>'; }).join('') + '</tr></thead><tbody>' +
    emps.map(function (e) {
      const c = hrCalc(e, month).cnt;
      return '<tr><td>' + escHtml(e.name) + '</td>' + HR_STATUSES.map(function (s) { return '<td>' + c[s] + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
}

function drawHrAttendance() {
  const body = document.getElementById('hr-body');
  const date = hrCurDate();
  const emps = hrActive();
  body.innerHTML = '<div class="toolbar"><div class="field" style="margin:0"><label>اليوم</label><input type="date" id="hr-att-date" value="' + escHtml(date) + '" style="' + HR_INP + '" /></div></div>' +
    '<div class="stat-label" style="margin-bottom:8px">اختار حالة كل موظف وهتتسجل فورًا. الملاحظة بتتحفظ بعد ما تختار الحالة.</div>' +
    '<div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>' +
    (emps.map(function (e) {
      const rec = hrAttRec(e.id, date);
      return '<tr data-att-row="' + escHtml(e.id) + '"><td><strong>' + escHtml(e.name) + '</strong></td>' +
        '<td><select data-att-status style="' + HR_INP + '"><option value="">— لسه ما اتسجلش —</option>' +
        HR_STATUSES.map(function (s) { return '<option value="' + s + '"' + (rec && rec.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
        '<td><input type="text" data-att-notes value="' + escHtml(rec ? rec.notes || '' : '') + '" placeholder="اختياري" style="width:100%;' + HR_INP + '" /></td></tr>';
    }).join('') || '<tr><td colspan="3" class="empty-state">ضيف موظفين الأول من تبويب "الموظفين"</td></tr>') +
    '</tbody></table></div><div id="hr-att-summary">' + hrAttSummaryHtml(date.substring(0, 7)) + '</div>';

  document.getElementById('hr-att-date').addEventListener('change', function (e) {
    if (e.target.value) { hrAttDate = e.target.value; drawHrAttendance(); }
  });
  body.querySelectorAll('[data-att-row]').forEach(function (tr) {
    const id = tr.getAttribute('data-att-row');
    const sel = tr.querySelector('[data-att-status]');
    const nt = tr.querySelector('[data-att-notes]');
    async function save() {
      const d = hrCurDate();
      sel.disabled = true;
      try {
        await apiWrite('setAttendance', { employeeId: id, date: d, status: sel.value, notes: nt.value });
        hrAttApply(id, d, sel.value, nt.value);
        toast(sel.value ? (hrEmp(id) || {}).name + ' — ' + sel.value : 'اتمسح التسجيل', 'success');
        document.getElementById('hr-att-summary').innerHTML = hrAttSummaryHtml(d.substring(0, 7));
      } catch (err) {
        toast(err.message, 'error');
        drawHrAttendance();
        return;
      }
      sel.disabled = false;
    }
    sel.addEventListener('change', save);
    nt.addEventListener('change', function () { if (sel.value) save(); });
  });
}

/* ---------- المرتبات ---------- */

function hrCalc(emp, month) {
  const base = num(emp.baseSalary);
  const day = base / HR_MONTH_DAYS;
  const cnt = { 'حاضر': 0, 'غائب': 0, 'متأخر': 0, 'إجازة': 0 };
  HR.att.forEach(function (a) {
    if (String(a.employeeId) === String(emp.id) && hrD(a).substring(0, 7) === month && cnt[a.status] !== undefined) cnt[a.status]++;
  });
  const adj = HR.adj.filter(function (a) { return String(a.employeeId) === String(emp.id) && hrD(a).substring(0, 7) === month; });
  const sumType = function (t) { return adj.filter(function (a) { return a.type === t; }).reduce(function (s, a) { return s + num(a.amount); }, 0); };
  const absentDed = Math.round(cnt['غائب'] * day * 100) / 100;
  const ded = sumType('خصم'), adv = sumType('سلفة'), bonus = sumType('مكافأة');
  const net = Math.round((base - absentDed - ded - adv + bonus) * 100) / 100;
  return { base: base, day: day, cnt: cnt, adj: adj, absentDed: absentDed, ded: ded, adv: adv, bonus: bonus, net: net };
}

function drawHrPayroll() {
  const body = document.getElementById('hr-body');
  const month = hrCurMonth();
  const rows = hrActive().map(function (e) { return { e: e, c: hrCalc(e, month) }; });
  const T = { base: 0, absent: 0, absentDed: 0, ded: 0, adv: 0, bonus: 0, net: 0 };
  rows.forEach(function (r) {
    T.base += r.c.base; T.absent += r.c.cnt['غائب']; T.absentDed += r.c.absentDed;
    T.ded += r.c.ded; T.adv += r.c.adv; T.bonus += r.c.bonus; T.net += r.c.net;
  });
  body.innerHTML = '<div class="section-header"><div class="toolbar"><div class="field" style="margin:0"><label>الشهر</label>' +
    '<input type="month" id="hr-month" value="' + escHtml(month) + '" style="' + HR_INP + '" /></div></div>' +
    '<button class="btn btn-primary" id="hr-add-adj">+ خصم / مكافأة / سلفة</button></div>' +
    '<div class="stat-label" style="margin-bottom:8px">خصم الغياب = أيام الغياب × (المرتب الأساسي ÷ 30). المتأخر والإجازة مفيهمش خصم تلقائي، لو عايز تخصم عنهم سجّل خصم يدوي.</div>' +
    '<div class="table-wrap"><table><thead><tr><th>الموظف</th><th>الأساسي</th><th>أيام الغياب</th><th>خصم الغياب</th><th>خصومات</th><th>سلف</th><th>مكافآت</th><th>الصافي</th><th></th></tr></thead><tbody>' +
    (rows.map(function (r) {
      return '<tr><td><strong>' + escHtml(r.e.name) + '</strong></td><td>' + hrMoney(r.c.base) + '</td><td>' + r.c.cnt['غائب'] + '</td>' +
        '<td>' + hrMoney(r.c.absentDed) + '</td><td>' + hrMoney(r.c.ded) + '</td><td>' + hrMoney(r.c.adv) + '</td><td>' + hrMoney(r.c.bonus) + '</td>' +
        '<td><strong>' + hrMoney(r.c.net) + '</strong></td><td><button class="link-btn" data-hr-detail="' + escHtml(r.e.id) + '">تفاصيل</button></td></tr>';
    }).join('') || '<tr><td colspan="9" class="empty-state">ضيف موظفين الأول من تبويب "الموظفين"</td></tr>') +
    '</tbody>' + (rows.length > 1 ? '<tfoot><tr style="font-weight:800;background:rgba(255,255,255,.04)"><td>المجموع</td><td>' + hrMoney(T.base) + '</td><td>' + T.absent + '</td><td>' + hrMoney(T.absentDed) + '</td><td>' + hrMoney(T.ded) + '</td><td>' + hrMoney(T.adv) + '</td><td>' + hrMoney(T.bonus) + '</td><td>' + hrMoney(T.net) + '</td><td></td></tr></tfoot>' : '') +
    '</table></div>';
  document.getElementById('hr-month').addEventListener('change', function (e) {
    if (e.target.value) { hrMonth = e.target.value; drawHrPayroll(); }
  });
  document.getElementById('hr-add-adj').addEventListener('click', function () { openHrAdjForm(''); });
  body.querySelectorAll('[data-hr-detail]').forEach(function (b) {
    b.addEventListener('click', function () { openHrDetail(b.getAttribute('data-hr-detail')); });
  });
}

function openHrAdjForm(presetEmpId) {
  const emps = hrActive();
  if (!emps.length) { toast('ضيف موظفين الأول', 'error'); return; }
  const month = hrCurMonth();
  const today = localNowStr().substring(0, 10);
  const defDate = today.substring(0, 7) === month ? today : month + '-01';
  const overlay = openModal('خصم / مكافأة / سلفة', `
    <form id="hr-adj-form">
      <div class="field"><label>الموظف</label><select name="employeeId" required>
        ${emps.map(function (e) { return '<option value="' + escHtml(e.id) + '"' + (String(e.id) === String(presetEmpId) ? ' selected' : '') + '>' + escHtml(e.name) + '</option>'; }).join('')}
      </select></div>
      <div class="field"><label>النوع</label><select name="type" required>
        <option value="خصم">خصم</option><option value="مكافأة">مكافأة</option><option value="سلفة">سلفة (تتخصم من المرتب)</option>
      </select></div>
      <div class="grid grid-2">
        <div class="field"><label>المبلغ (ج.م)</label><input type="number" name="amount" min="0.01" step="any" required /></div>
        <div class="field"><label>التاريخ</label><input type="date" name="date" value="${defDate}" required /></div>
      </div>
      <div class="field"><label>السبب (اختياري)</label><input name="reason" placeholder="مثال: تأخير متكرر، مكافأة شغل ممتاز" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#hr-adj-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const d = String(fd.get('date'));
      saveInBackground(overlay, async function () {
        await apiWrite('addAdjustment', { employeeId: fd.get('employeeId'), type: fd.get('type'), amount: fd.get('amount'), date: d, reason: fd.get('reason') });
      }, { successMsg: 'تم التسجيل', onDone: function () { hrMonth = d.substring(0, 7); hrTab = 'payroll'; hrReload(); } });
    });
  });
}

function hrSlipHtml(emp, month, c, withDel) {
  const line = function (l, v) {
    return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #8884"><span>' + l + '</span><strong>' + v + '</strong></div>';
  };
  const adj = c.adj.slice().sort(function (a, b) { return hrD(a).localeCompare(hrD(b)); });
  return '<h4 style="margin:0 0 8px">' + escHtml(emp.name) + (emp.jobTitle ? ' — ' + escHtml(emp.jobTitle) : '') +
    ' <span style="font-weight:400;opacity:.7">(شهر ' + escHtml(month) + ')</span></h4>' +
    line('المرتب الأساسي', hrMoney(c.base)) +
    line('أيام: حضور / غياب / تأخير / إجازة', c.cnt['حاضر'] + ' / ' + c.cnt['غائب'] + ' / ' + c.cnt['متأخر'] + ' / ' + c.cnt['إجازة']) +
    line('خصم الغياب (' + c.cnt['غائب'] + ' يوم × ' + hrMoney(c.day) + ')', '- ' + hrMoney(c.absentDed)) +
    line('خصومات أخرى', '- ' + hrMoney(c.ded)) +
    line('سلف', '- ' + hrMoney(c.adv)) +
    line('مكافآت', '+ ' + hrMoney(c.bonus)) +
    '<div style="display:flex;justify-content:space-between;padding:10px 0;font-size:17px"><span>صافي المرتب</span><strong>' + hrMoney(c.net) + '</strong></div>' +
    (adj.length ? '<h4 style="margin:14px 0 6px">تفاصيل الخصومات والمكافآت والسلف</h4><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>السبب</th>' + (withDel ? '<th></th>' : '') + '</tr></thead><tbody>' +
      adj.map(function (a) {
        return '<tr><td>' + escHtml(hrD(a)) + '</td><td>' + escHtml(a.type) + '</td><td>' + hrMoney(a.amount) + '</td><td>' + escHtml(a.reason || '-') + '</td>' +
          (withDel ? '<td><button class="link-btn" data-hr-del="' + escHtml(a.id) + '">حذف</button></td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>' : '');
}

function openHrDetail(empId) {
  const emp = hrEmp(empId);
  if (!emp) return;
  const month = hrCurMonth();
  const c = hrCalc(emp, month);
  const overlay = openModal('تفاصيل المرتب', hrSlipHtml(emp, month, c, true) + `
    <div class="modal-actions" style="align-items:center">
      <button type="button" class="btn btn-primary" id="hr-slip-add">+ خصم / مكافأة</button>
      <button type="button" class="link-btn" id="hr-slip-print">🖨️ طباعة</button>
      <button type="button" class="btn btn-outline" id="hr-slip-close" style="margin-right:auto">إغلاق</button>
    </div>`, function (el) {
    el.querySelector('#hr-slip-close').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#hr-slip-add').addEventListener('click', function () { overlay.remove(); openHrAdjForm(emp.id); });
    el.querySelector('#hr-slip-print').addEventListener('click', function () {
      printHtmlDoc('كشف مرتب ' + emp.name,
        '<div class="head"><div><h2>' + escHtml(SHOP_NAME) + '</h2><div>كشف مرتب شهر ' + escHtml(month) + '</div></div><div>' + new Date().toLocaleDateString('en-GB') + '</div></div>' + hrSlipHtml(emp, month, c, false));
    });
    el.querySelectorAll('[data-hr-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('تحذف السجل ده؟')) return;
        try {
          await apiWrite('deleteAdjustment', { id: b.getAttribute('data-hr-del') });
          overlay.remove();
          await hrReload();
          openHrDetail(empId);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
  overlay.querySelector('.modal').style.maxWidth = '620px';
}

/* ============ الموظفين ============ */

async function renderUsers() {
  if (CURRENT_USER.role !== 'مدير النظام') {
    content().innerHTML = `<div class="empty-state">هذا القسم لمدير النظام فقط</div>`;
    return;
  }
  setBreadcrumb('إدارة حسابات الموظفين');
  content().innerHTML = `
    <div class="section-header"><div></div><button class="btn btn-primary" id="add-user-btn">+ إضافة موظف</button></div>
    <div id="users-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('add-user-btn').addEventListener('click', openAddUserForm);
  await loadUsersTable();
}

async function loadUsersTable() {
  try {
    const data = await cachedApi('listUsers');
    document.getElementById('users-table').innerHTML = `
      <table>
        <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>تاريخ الإنشاء</th></tr></thead>
        <tbody>
          ${data.items.map(function (u) {
            return `<tr><td>${escHtml(u.name)}</td><td>${escHtml(u.username)}</td>
            <td><span class="badge ${u.role === 'مدير النظام' ? 'badge-brown' : 'badge-slate'}">${escHtml(u.role)}</span></td>
            <td>${escHtml(u.createdAt)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('users-table').innerHTML = `<div class="empty-state">${escHtml(err.message)}</div>`;
  }
}

function openAddUserForm() {
  const overlay = openModal('إضافة موظف جديد', `
    <form id="user-form">
      <div class="field"><label>اسم الموظف</label><input name="name" required /></div>
      <div class="field"><label>اسم المستخدم (يوزر نيم)</label><input name="username" required /></div>
      <div class="field"><label>كلمة المرور</label><input type="password" name="password" required /></div>
      <div class="field">
        <label>الصلاحية</label>
        <select name="role" required>
          <option value="حسابات">حسابات</option>
          <option value="مدير النظام">مدير النظام</option>
          <option value="مدير (عرض فقط)">مدير (عرض فقط)</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#user-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        await apiWrite('addUser', {
          name: fd.get('name'), username: fd.get('username'), password: fd.get('password'), role: fd.get('role')
        });
        invalidateCache('listUsers');
      }, { successMsg: 'تمت إضافة الموظف', onDone: function () { loadUsersTable(); } });
    });
  });
}

// الكود بيتبعت بس لو الموظف غيّره فعلًا، عشان تعديل السعر/الاسم أوفلاين ميتعارضش مع كود اتغير على السيرفر
function codeIfChanged(fd, original) {
  const v = String(fd.get('code') == null ? '' : fd.get('code')).trim();
  return v === String(original == null ? '' : original).trim() ? undefined : v;
}

// بنبعت الكمية للسيرفر بس لو الموظف غيّرها فعلًا، عشان تعديل السعر أو الاسم ميرجّعش مخزون قديم فوق بيع حصل من جهاز تاني
function numIfChanged(fd, key, original) {
  const v = fd.get(key);
  if (v !== null && String(v).trim() !== '' && Number(v) === Number(original)) return undefined;
  return v;
}

/* ============ الضمان (مشترك بين كل فورمات المنتجات) ============ */

const WARRANTY_UNITS = ['يوم', 'شهر', 'سنة'];

function parseWarrantyPeriod(txt) {
  const m = String(txt || '').trim().match(/^(\d+)\s*(\S+)$/);
  return m ? { n: m[1], u: m[2] } : { n: '', u: 'شهر' };
}

function warrantyFieldsHtml(warranty, period) {
  const has = warranty === 'له ضمان';
  const p = parseWarrantyPeriod(period);
  return `<div class="field">
      <label>الضمان</label>
      <select name="warranty" data-warranty-select>
        <option value="بدون ضمان" ${has ? '' : 'selected'}>بدون ضمان</option>
        <option value="له ضمان" ${has ? 'selected' : ''}>بضمان</option>
      </select>
    </div>
    <div class="field ${has ? '' : 'hidden'}" data-warranty-period>
      <label>مدة الضمان</label>
      <div class="grid grid-2">
        <input type="number" name="warrantyNum" min="1" value="${escHtml(p.n)}" placeholder="مثال: 6" />
        <select name="warrantyUnit">${WARRANTY_UNITS.map(function (u) { return '<option value="' + u + '"' + (u === p.u ? ' selected' : '') + '>' + u + '</option>'; }).join('')}</select>
      </div>
    </div>`;
}

function bindWarrantyFields(el) {
  const sel = el.querySelector('[data-warranty-select]');
  const box = el.querySelector('[data-warranty-period]');
  if (!sel || !box) return;
  sel.addEventListener('change', function () {
    box.classList.toggle('hidden', sel.value !== 'له ضمان');
    if (sel.value === 'له ضمان') { const n = box.querySelector('[name=warrantyNum]'); if (n) n.focus(); }
  });
}

// بيرجّع { warranty, warrantyPeriod } من الفورم، أو بيرمي خطأ لو اخترت "بضمان" وماكتبتش المدة
function readWarranty(fd) {
  const w = fd.get('warranty') === 'له ضمان' ? 'له ضمان' : 'بدون ضمان';
  if (w !== 'له ضمان') return { warranty: w, warrantyPeriod: '' };
  const n = Math.floor(Number(fd.get('warrantyNum')));
  if (!n || n < 1) throw new Error('اكتب مدة الضمان (رقم أكبر من صفر)');
  return { warranty: w, warrantyPeriod: n + ' ' + (fd.get('warrantyUnit') || 'شهر') };
}

function warrantyLabel(o) {
  return o && o.warranty === 'له ضمان' ? ('بضمان' + (o.warrantyPeriod ? ' ' + o.warrantyPeriod : '')) : 'بدون ضمان';
}

/* ============ المسترجع ============ */

let returnsSearch = '';

async function renderReturns() {
  setBreadcrumb('استرجاع منتج اتباع وإرجاعه للمخزون');
  content().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">ابحث عن عملية البيع</h3>
      <div class="field" style="margin-bottom:0">
        <label>اسم العميل أو رقمه أو اسم المنتج أو الكود</label>
        <input type="text" id="returns-search" value="${escHtml(returnsSearch)}" placeholder="مثال: أحمد، أو 0100..، أو شاحن" autocomplete="off" />
      </div>
      <div id="returns-sales" style="margin-top:14px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-top:0">سجل المسترجع</h3>
      <div id="returns-log"></div>
    </div>`;
  const input = document.getElementById('returns-search');
  input.focus();
  input.addEventListener('input', function () { returnsSearch = input.value; drawReturnsSales(); });
  await Promise.all([cachedApi('listAccessorySales'), cachedApi('listDeviceSales'), cachedApi('listReturns')].map(function (p) { return p.catch(function () {}); }));
  drawReturnsSales();
  drawReturnsLog();
}

function returnedQtyForSale(type, saleId) {
  return ((LISTS.listReturns || {}).items || []).filter(function (r) {
    return r.saleType === type && String(r.saleId) === String(saleId);
  }).reduce(function (t, r) { return t + (Number(r.quantity) || 0); }, 0);
}

function drawReturnsSales() {
  const box = document.getElementById('returns-sales');
  if (!box) return;
  const q = returnsSearch.trim().toLowerCase();
  if (!q) { box.innerHTML = '<div class="empty-state" style="padding:14px">اكتب في خانة البحث عشان تظهر عمليات البيع</div>'; return; }
  const all = []
    .concat(((LISTS.listAccessorySales || {}).items || []).map(function (s) { return { type: 'accessory', sale: s, name: s.itemName }; }))
    .concat(((LISTS.listDeviceSales || {}).items || []).map(function (s) { return { type: 'device', sale: s, name: s.deviceName }; }));
  const found = all.filter(function (x) {
    const s = x.sale;
    return [x.name, s.customerName, s.customerPhone, s.code].some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
  }).sort(function (a, b) { return String(b.sale.date).localeCompare(String(a.sale.date)); }).slice(0, 30);
  if (!found.length) { box.innerHTML = '<div class="empty-state" style="padding:14px">مفيش عمليات بيع مطابقة</div>'; return; }
  box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>العميل</th><th>الكمية</th><th>الإجمالي</th><th>الضمان</th><th></th></tr></thead><tbody>' +
    found.map(function (x, i) {
      const s = x.sale, left = (Number(s.quantity) || 1) - returnedQtyForSale(x.type, s.id);
      return '<tr><td>' + escHtml(String(s.date).substring(0, 16)) + '</td><td>' + escHtml(x.name) + '</td><td>' + escHtml(s.customerName || '-') + '<br><small style="color:var(--text-muted)">' + escHtml(s.customerPhone || '') + '</small></td>' +
        '<td>' + s.quantity + (left < s.quantity ? ' <span class="badge badge-danger">اترجع ' + (s.quantity - left) + '</span>' : '') + '</td>' +
        '<td>' + Number(s.totalPrice).toLocaleString() + '</td><td>' + escHtml(warrantyLabel(s)) + '</td>' +
        '<td>' + (left > 0 ? '<button class="btn btn-primary btn-sm" data-ret="' + i + '">استرجاع</button>' : '<span class="badge badge-slate">اترجع بالكامل</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  box.querySelectorAll('[data-ret]').forEach(function (b) {
    b.addEventListener('click', function () { openReturnForm(found[Number(b.getAttribute('data-ret'))]); });
  });
}

function drawReturnsLog() {
  const box = document.getElementById('returns-log');
  if (!box) return;
  const rows = ((LISTS.listReturns || {}).items || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 50);
  if (!rows.length) { box.innerHTML = '<div class="empty-state" style="padding:14px">لسه مفيش مسترجع</div>'; return; }
  box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المنتج</th><th>العميل</th><th>الكمية</th><th>المبلغ المرجّع</th><th>رجع للمخزون؟</th><th>السبب</th><th>الموظف</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td>' + escHtml(String(r.date).substring(0, 16)) + '</td><td>' + escHtml(r.itemName) + '</td><td>' + escHtml(r.customerName || '-') + '</td><td>' + r.quantity + '</td>' +
        '<td>' + Number(r.refundAmount).toLocaleString() + ' ج.م</td><td>' + (r.restock === 'نعم' ? '<span class="badge badge-success">نعم</span>' : '<span class="badge badge-danger">لا</span>') + '</td>' +
        '<td>' + escHtml(r.reason || '-') + '</td><td>' + escHtml(r.employee || '-') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function openReturnForm(x) {
  const s = x.sale, left = (Number(s.quantity) || 1) - returnedQtyForSale(x.type, s.id);
  const unit = Number(s.unitPrice) || (Number(s.totalPrice) / (Number(s.quantity) || 1));
  const overlay = openModal('استرجاع — ' + x.name, `
    <form id="return-form">
      <p style="color:var(--text-muted);margin-top:0">العميل: ${escHtml(s.customerName || '-')} — اتباع بتاريخ ${escHtml(String(s.date).substring(0, 10))} — ${escHtml(warrantyLabel(s))}</p>
      <div class="field"><label>الكمية المسترجعة (المتاح للاسترجاع: ${left})</label>
        <input type="number" name="quantity" value="1" min="1" max="${left}" required /></div>
      <div class="field"><label>المبلغ اللي هتدفعه للعميل (ج.م)</label>
        <input type="number" name="refundAmount" value="${unit}" min="0" required /></div>
      <div class="field"><label>سبب الاسترجاع (اختياري)</label><textarea name="reason" rows="2" placeholder="مثال: عيب في المنتج / غيّر رأيه"></textarea></div>
      <label style="display:flex;gap:8px;align-items:center;margin:10px 0">
        <input type="checkbox" name="restock" checked /> رجّع القطعة للمخزون <small style="color:var(--text-muted)">(شيل العلامة لو القطعة تالفة)</small>
      </label>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">تأكيد الاسترجاع</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>`, function (el) {
    const qtyInput = el.querySelector('[name=quantity]');
    const refundInput = el.querySelector('[name=refundAmount]');
    qtyInput.addEventListener('input', function () {
      const q = Math.max(1, Math.min(left, Math.floor(Number(qtyInput.value) || 1)));
      refundInput.value = unit * q;
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#return-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (overlay._busy) return;
      overlay._busy = true;
      const fd = new FormData(e.target);
      try {
        await apiWrite('addReturn', {
          saleType: x.type, saleId: s.id, quantity: fd.get('quantity'), refundAmount: fd.get('refundAmount'),
          reason: fd.get('reason'), restock: fd.get('restock') ? true : false, employee: CURRENT_USER.name
        });
        invalidateProductCaches();
        overlay.remove();
        toast(savedMsg('تم تسجيل المسترجع'), 'success');
        drawReturnsSales();
        drawReturnsLog();
      } catch (err) { overlay._busy = false; toast(err.message, 'error'); }
    });
  });
}

/* ============ طباعة الإيصال ============ */

function printReceipt(data) {
  // مقاس ورق الطابعة بالملي: 80 (XP-80 وأغلب موديلات Xprinter) أو 58 (XP-58). بيتغير من config.js
  const width = (typeof RECEIPT_WIDTH_MM !== 'undefined' && Number(RECEIPT_WIDTH_MM)) || 80;
  const shopPhone = (typeof SHOP_PHONE !== 'undefined' && SHOP_PHONE) || '';
  const logoUrl = new URL('logo-icon.webp', location.href).href;
  const showLogo = (typeof RECEIPT_SHOW_LOGO !== 'undefined') ? !!RECEIPT_SHOW_LOGO : false;
  const now = new Date();
  const when = now.toLocaleDateString('en-GB') + '  ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const row = function (label, value) {
    return '<div class="row"><span class="l">' + label + '</span><span class="v">' + escHtml(value || '-') + '</span></div>';
  };
  const html = '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال</title><style>' +
    '@page { size: ' + width + 'mm 297mm; margin: 0; }' +
    '* { box-sizing: border-box; }' +
    'html, body { margin: 0; padding: 0; background: #fff; color: #000; overflow: hidden; }' +
    'body { width: 100%; max-width: ' + width + 'mm; margin: 0 auto; padding: 3mm 3mm 6mm; font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size: 12px; line-height: 1.55; }' +
    '.center { text-align: center; }' +
    '.logo { display: block; margin: 0 auto 4px; width: ' + (width <= 58 ? 16 : 22) + 'mm; height: auto; filter: grayscale(1) contrast(1.3); }' +
    'h2 { margin: 0 0 2px; font-size: 20px; }' +
    '.muted { font-size: 11px; }' +
    'hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }' +
    '.row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }' +
    '.row .l { white-space: nowrap; }' +
    '.row .v { text-align: left; font-weight: bold; word-break: break-word; }' +
    '.total { font-size: 16px; font-weight: bold; }' +
    '.item { margin: 4px 0; } .iname { font-weight: bold; }' +
    '</style></head><body>' +
    '<div class="center">' + (showLogo ? '<img class="logo" src="' + escHtml(logoUrl) + '" alt="" />' : '') + '<h2>' + escHtml(SHOP_NAME) + '</h2><div class="muted">' + when + '</div></div><hr />' +
    row('العميل:', data.customerName) + row('الموظف:', data.employee) + '<hr />' +
    (data.items && data.items.length
      ? data.items.map(function (it) {
          return '<div class="item"><div class="iname">' + escHtml(it.name) + '</div>' +
            '<div class="row"><span class="l">' + it.qty + ' × ' + Number(it.unit).toLocaleString() + '</span><span class="v">' + Number(it.total).toLocaleString() + '</span></div>' +
            (it.warranty ? '<div class="muted">الضمان: ' + escHtml(it.warranty) + '</div>' : '') + '</div>';
        }).join('') + '<hr />'
      : (data.faultType ? row('نوع العطل:', data.faultType) : '') + (data.productName ? row(data.faultType ? 'الجهاز:' : 'المنتج:', data.productName) : '') + '<hr />') +
    (data.discount > 0 ? row('الإجمالي قبل الخصم:', Number(data.subtotal || 0).toLocaleString() + ' ج.م') + row('الخصم:', '- ' + Number(data.discount).toLocaleString() + ' ج.م') : '') +
    '<div class=\"row total\"><span class=\"l\">الإجمالي:</span><span class=\"v\">' + Number(data.total || 0).toLocaleString() + ' ج.م</span></div>' +
    (data.debt ? row('المدفوع:', Number(data.debt.paid).toLocaleString() + ' ج.م') + row('المتبقي (آجل):', Number(data.debt.remaining).toLocaleString() + ' ج.م') + row('ميعاد السداد:', data.debt.dueDate) : '') +
    (data.payment ? row('المسدد الآن:', Number(data.payment.paid).toLocaleString() + ' ج.م') +
      (Number(data.payment.remaining) > 0
        ? row('المتبقي:', Number(data.payment.remaining).toLocaleString() + ' ج.م') + (data.payment.dueDate ? row('ميعاد السداد:', data.payment.dueDate) : '')
        : '<div class="center total">تم السداد بالكامل ✓</div>') : '') + '<hr />' +
    '<div class="center">شكرًا لتعاملكم معنا</div>' +
    (shopPhone ? '<div class="center" style="margin-top:3px">للاستفسار: <b dir="ltr">' + escHtml(shopPhone) + '</b></div>' : '') +
    '</body></html>';

  // بنطبع من iframe مخفي بدل نافذة جديدة، عشان المتصفح ميحجبش النافذة وتشتغل حتى بعد عمليات أوفلاين
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + width + 'mm;height:1200px;border:0;background:#fff';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  // نستنى اللوجو يحمّل قبل الطباعة (بحد أقصى ثانيتين، ولو فشل نطبع من غيره)
  let printed = false;
  function doPrint() {
    if (printed) return;
    printed = true;
    // الطابعات الحرارية بتتلغبط مع "auto"، فبنقيس طول الإيصال الفعلي ونثبّته كارتفاع صفحة
    try {
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      const mm = Math.min(Math.max(Math.ceil(h * 25.4 / 96) + 8, 60), 1000);
      const st = doc.createElement('style');
      st.textContent = '@page { size: ' + width + 'mm ' + mm + 'mm; margin: 0; }';
      doc.head.appendChild(st);
    } catch (e) { /* نكمل بالارتفاع الافتراضي */ }
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { toast('تعذرت الطباعة: ' + e.message, 'error'); }
    setTimeout(function () { frame.remove(); }, 60000);
  }
  const logo = doc.querySelector('.logo');
  if (logo && !logo.complete) {
    logo.addEventListener('load', function () { setTimeout(doPrint, 100); });
    logo.addEventListener('error', function () { logo.remove(); doPrint(); });
    setTimeout(doPrint, 2000);
  } else {
    setTimeout(doPrint, 300);
  }
}

/* ============ السكانر العام (يشتغل من أي مكان في النظام) ============ */

let globalScanBuffer = '';
let globalScanLastTime = 0;
let globalScanTimer = null;

function flushGlobalScan() {
  clearTimeout(globalScanTimer);
  const code = globalScanBuffer.trim();
  globalScanBuffer = '';
  if (code.length >= 4) handleGlobalScan(code);
}

document.addEventListener('keydown', function (e) {
  // لو المستخدم بيكتب فعليًا في أي خانة، سيبها تتصرف عادي
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!CURRENT_USER || isViewer()) return;
  if (document.querySelector('.modal-overlay')) return;

  const now = Date.now();
  // السكانر بيكتب بسرعة؛ نسمح بفاصل لحد 150ms (بدل 60) عشان السكانرات الأبطأ
  if (now - globalScanLastTime > 150) globalScanBuffer = '';
  globalScanLastTime = now;

  if (e.key === 'Enter') {
    if (globalScanBuffer.trim().length >= 4) e.preventDefault();
    flushGlobalScan();
    return;
  }
  if (e.key.length === 1) {
    globalScanBuffer += e.key;
    // لو السكانر مبيبعتش Enter: ننفذ البحث لوحدنا بعد ما الكتابة تقف 200ms
    clearTimeout(globalScanTimer);
    globalScanTimer = setTimeout(flushGlobalScan, 200);
  }
});

function handleGlobalScan(code) {
  if (document.querySelector('.modal-overlay')) return; // فيه نافذة مفتوحة: متسيبش السكانر يقفلها
  if (CURRENT_SECTION === 'scan') readScanCustomer(); // نحفظ اسم/رقم العميل المكتوب قبل إعادة الرسم
  CURRENT_SECTION = 'scan';
  renderApp();
  setTimeout(function () {
    const input = document.getElementById('scan-code-input');
    if (input) {
      input.value = code;
      doScanSearch();
    }
  }, 30);
}

/* ============ بدء التشغيل ============ */

offlineInit().then(function () {
  if (CURRENT_USER) { prefetchAll(); renderApp(); } else renderLogin();
  if (QUEUE.length) setTimeout(flushQueue, 1500);
});
