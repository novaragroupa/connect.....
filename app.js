/* ============ حالة عامة ============ */
let CURRENT_USER = null;
try { CURRENT_USER = JSON.parse(localStorage.getItem('connect_user') || 'null'); } catch (e) { CURRENT_USER = null; }
let CURRENT_SECTION = 'dashboard';
let CACHE = {}; // كاش بسيط للبيانات المجلوبة من الشيت

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
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
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
  if (!data.ok || data.error) throw new Error(data.error || 'حصل خطأ غير معروف');
  return data;
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
  ['listMaintenance', 'listAccessorySales', 'listDeviceSales', 'listAccessoryItems',
   'listDevices', 'listAccessoryCategories', 'listCashTransfers'].forEach(function (a) {
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
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="logo-icon.webp" class="logo-mark" alt="Connect" />
        <h1>${SHOP_NAME}</h1>
        <p class="subtitle">نظام إدارة المحل — سجّل دخولك للمتابعة</p>
        ${errorMsg ? `<div class="error-msg">${errorMsg}</div>` : ''}
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
      CURRENT_USER = data.user;
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
  { id: 'scan', label: 'بيع بالباركود', icon: '🔍' },
  { id: 'maintenance', label: 'الصيانة', icon: '🛠️' },
  { id: 'accessories', label: 'الإكسسوارات', icon: '🎧' },
  { id: 'devices', label: 'الأجهزة', icon: '📱' },
  { id: 'cash', label: 'تحويلات الكاش', icon: '💵' },
  { id: 'inventory', label: 'المخزون', icon: '📦' },
  { id: 'accounting', label: 'الحسابات', icon: '📊' },
  { id: 'users', label: 'الموظفين', icon: '👤', adminOnly: true }
];

function renderApp() {
  if (!CURRENT_USER) return renderLogin();

  const navHtml = NAV_ITEMS
    .filter(function (item) { return !item.adminOnly || CURRENT_USER.role === 'مدير النظام'; })
    .map(function (item) {
      return `<li><button class="nav-btn ${item.id === CURRENT_SECTION ? 'active' : ''}" data-nav="${item.id}">
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
        <ul class="nav-list">${navHtml}</ul>
        <div class="user-box">
          <div class="name">${CURRENT_USER.name}</div>
          <div class="role">${CURRENT_USER.role}</div>
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

  const titleMap = {};
  NAV_ITEMS.forEach(function (i) { titleMap[i.id] = i.label; });
  document.getElementById('page-title').textContent = titleMap[CURRENT_SECTION] || '';

  const renderers = {
    dashboard: renderDashboard,
    scan: renderScan,
    maintenance: renderMaintenance,
    accessories: renderAccessories,
    devices: renderDevices,
    cash: renderCash,
    inventory: renderInventory,
    accounting: renderAccounting,
    users: renderUsers
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
  overlay.innerHTML = `<div class="modal"><h3>${title}</h3><div id="modal-body">${bodyHtml}</div></div>`;
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
    const today = new Date().toISOString().substring(0, 10);
    const todaySales = [].concat(maint.items, accSales.items, devSales.items)
      .filter(function (r) { return String(r.date).substring(0, 10) === today; });
    const todayTotal = todaySales.reduce(function (s, r) { return s + Number(r.total || r.totalPrice || 0); }, 0);
    const todayProfit = todaySales.reduce(function (s, r) { return s + Number(r.profitCost || r.profitPrice || 0); }, 0);
    const lowStock = accItems.items.filter(function (i) { return Number(i.quantity) <= 2; }).length
      + devices.items.filter(function (i) { return Number(i.quantity) <= 2; }).length;

    content().innerHTML = `
      <div class="grid grid-4">
        <div class="card stat-card"><div class="stat-label">مبيعات اليوم</div><div class="stat-value brown">${todayTotal.toLocaleString()} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">أرباح اليوم</div><div class="stat-value dark">${todayProfit.toLocaleString()} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">عمليات اليوم</div><div class="stat-value dark">${todaySales.length}</div></div>
        <div class="card stat-card"><div class="stat-label">أصناف على وشك النفاذ</div><div class="stat-value brown">${lowStock}</div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">آخر العمليات اليوم</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الوقت</th><th>النوع</th><th>العميل</th><th>الإجمالي</th><th>الموظف</th></tr></thead>
            <tbody>
              ${todaySales.slice(-10).reverse().map(function (r) {
                const type = r.deviceCategory ? 'صيانة' : (r.categoryName ? 'اكسسوار' : 'جهاز');
                return `<tr><td>${String(r.date).substring(11)}</td><td>${type}</td><td>${r.customerName || '-'}</td>
                <td>${Number(r.total || r.totalPrice || 0).toLocaleString()} ج.م</td><td>${r.employee || '-'}</td></tr>`;
              }).join('') || `<tr><td colspan="5" class="empty-state">لا توجد عمليات اليوم بعد</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    content().innerHTML = `<div class="empty-state">تعذر تحميل البيانات: ${err.message}</div>`;
  }
}

/* ============ بيع بالباركود / الكود ============ */

let scanCustomer = { name: '', phone: '' };

async function renderScan() {
  setBreadcrumb('اكتب كود المنتج أو امسحه بالباركود');
  content().innerHTML = `
    <div class="card" style="max-width:520px">
      <h3 style="margin-top:0">بيانات العميل</h3>
      <div class="grid grid-2">
        <div class="field"><label>اسم العميل</label><input type="text" id="scan-customer-name" value="${scanCustomer.name}" /></div>
        <div class="field"><label>رقم العميل</label><input type="text" id="scan-customer-phone" value="${scanCustomer.phone}" /></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <h3 style="margin-top:0">كود المنتج</h3>
      <div class="field">
        <label>امسح الباركود بالسكانر أو اكتب الكود يدويًا واضغط Enter</label>
        <input type="text" id="scan-code-input" placeholder="مثال: 123456" autocomplete="off" />
      </div>
      <button class="btn btn-primary btn-block" id="scan-search-btn">بحث عن المنتج</button>
    </div>
    <div id="scan-result" style="max-width:520px;margin-top:16px"></div>
  `;

  const codeInput = document.getElementById('scan-code-input');
  codeInput.focus();
  codeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doScanSearch(); }
  });
  document.getElementById('scan-search-btn').addEventListener('click', doScanSearch);
}

function readScanCustomer() {
  scanCustomer.name = document.getElementById('scan-customer-name').value.trim();
  scanCustomer.phone = document.getElementById('scan-customer-phone').value.trim();
}

async function doScanSearch() {
  readScanCustomer();
  const code = document.getElementById('scan-code-input').value.trim();
  const resultBox = document.getElementById('scan-result');
  if (!code) { toast('اكتب أو امسح كود المنتج الأول', 'error'); return; }
  resultBox.innerHTML = `<div class="empty-state">جاري البحث...</div>`;
  try {
    const data = await findProduct(code);
    if (data.found) {
      renderScanFoundProduct(data, code);
    } else {
      renderScanNotFound(code);
    }
  } catch (err) {
    resultBox.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function renderScanFoundProduct(data, code) {
  const item = data.item;
  const label = data.type === 'accessory' ? dispCat(item.categoryName) : (item.deviceType + ' - ' + item.condition + ' - ' + item.warranty);
  const resultBox = document.getElementById('scan-result');
  const outOfStock = Number(item.quantity) <= 0;
  resultBox.innerHTML = `
    <div class="card">
      <div class="badge badge-success">تم إيجاد المنتج</div>
      <h3>${item.name}</h3>
      <p style="color:#888;margin:4px 0">${label} — الكود: ${item.code}</p>
      <div class="row" style="display:flex;justify-content:space-between;font-size:15px;margin:10px 0">
        <span>سعر القطعة</span><strong>${Number(item.totalPrice).toLocaleString()} ج.م</strong>
      </div>
      <div class="row" style="display:flex;justify-content:space-between;font-size:14px;color:#888;margin-bottom:10px">
        <span>الكمية المتاحة</span><span>${item.quantity}</span>
      </div>
      ${outOfStock
        ? `<div class="error-msg">الكمية غير متاحة في المخزون</div>`
        : `<div class="field"><label>الكمية المطلوبة</label>
             <input type="number" id="scan-sell-qty" value="1" min="1" max="${item.quantity}" /></div>
           <div class="field"><label>ملاحظات (اختياري)</label><textarea id="scan-sell-notes" rows="2" placeholder="أي ملاحظات عن العملية..."></textarea></div>
           <button class="btn btn-primary btn-block" id="confirm-scan-sell">تأكيد البيع للعميل</button>`}
    </div>
  `;
  if (!outOfStock) {
    document.getElementById('confirm-scan-sell').addEventListener('click', async function () {
      readScanCustomer();
      if (!scanCustomer.name || !scanCustomer.phone) {
        toast('محتاج اسم العميل ورقمه الأول', 'error'); return;
      }
      const qty = document.getElementById('scan-sell-qty').value;
      const notesEl = document.getElementById('scan-sell-notes');
      try {
        const result = await sellByCode(code, {
          code: code, customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
          quantity: qty, notes: notesEl ? notesEl.value : '', employee: CURRENT_USER.name
        });
        invalidateProductCaches();
        toast(savedMsg('تم تسجيل عملية البيع'), 'success');
        printReceipt({
          customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
          productName: (result.sale.itemName || result.sale.deviceName) + (result.sale.quantity > 1 ? ' × ' + result.sale.quantity : ''),
          employee: CURRENT_USER.name, total: result.sale.totalPrice
        });
        document.getElementById('scan-code-input').value = '';
        document.getElementById('scan-result').innerHTML = '';
        document.getElementById('scan-code-input').focus();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
}

function renderScanNotFound(code) {
  const resultBox = document.getElementById('scan-result');
  resultBox.innerHTML = `
    <div class="card">
      <div class="badge badge-danger">مفيش منتج بالكود ده</div>
      <p style="color:#888">الكود <strong>${code}</strong> مش مسجل في النظام. تقدر تضيفه دلوقتي كمنتج جديد وهيتباع فورًا للعميل.</p>
      <div class="grid grid-2">
        <button class="btn btn-dark" id="scan-add-accessory">إضافة كإكسسوار</button>
        <button class="btn btn-dark" id="scan-add-device">إضافة كجهاز</button>
      </div>
    </div>
  `;
  document.getElementById('scan-add-accessory').addEventListener('click', function () {
    openScanAddAccessoryForm(code, function () { toast('تمت إضافة المنتج، جاري البيع...', 'success'); sellScannedProductNow(code); });
  });
  document.getElementById('scan-add-device').addEventListener('click', function () {
    openScanAddDeviceForm(code, function () { toast('تمت إضافة الجهاز، جاري البيع...', 'success'); sellScannedProductNow(code); });
  });
}

async function openScanAddAccessoryForm(code, onSaved) {
  readScanCustomer();
  let categories = [];
  try { categories = (await cachedApi('listAccessoryCategories')).items; } catch (e) { /* ignore */ }
  const overlay = openModal(code ? ('إضافة منتج جديد — كود ' + code) : 'إضافة منتج إكسسوار جديد', `
    <form id="scan-item-form">
      <div class="field">
        <label>النوع</label>
        <select name="categoryId" required>
          <option value="">اختر النوع...</option>
          <optgroup label="📱 إكسسوارات الموبايل">
            ${categories.filter(function (c) { return !catIsPc(c); }).map(function (c) { return `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`; }).join('')}
          </optgroup>
          <optgroup label="💻 إكسسوارات الكمبيوتر">
            ${categories.filter(catIsPc).map(function (c) { return `<option value="${c.id}" data-name="${c.name}">${dispCat(c.name)}</option>`; }).join('')}
          </optgroup>
          <option value="__new__">+ نوع جديد (موبايل)</option>
          <option value="__new_pc__">+ نوع جديد (كمبيوتر)</option>
        </select>
      </div>
      <div class="field hidden" id="new-cat-field"><label>اسم النوع الجديد</label><input name="newCategoryName" /></div>
      <div class="field"><label>اسم الصنف</label><input name="name" required /></div>
      ${code ? '' : '<div class="field"><label>كود المنتج (اختياري)</label><input name="code" placeholder="اختياري - يتولد تلقائي" /></div>'}
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="0" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="0" required /></div>
      </div>
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="1" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ المنتج</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    const catSelect = el.querySelector('[name=categoryId]');
    catSelect.addEventListener('change', function () {
      el.querySelector('#new-cat-field').classList.toggle('hidden', catSelect.value.indexOf('__new') !== 0);
    });
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=name]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#scan-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        let categoryId = fd.get('categoryId');
        let categoryName;
        if (categoryId === '__new__' || categoryId === '__new_pc__') {
          const newName = (categoryId === '__new_pc__' ? PC_MARK : '') + String(fd.get('newCategoryName')).trim();
          const newCat = await apiWrite('addAccessoryCategory', { name: newName });
          categoryId = newCat.item.id; categoryName = newCat.item.name;
          patchCacheAdd('listAccessoryCategories', newCat.item);
        } else {
          categoryName = catSelect.options[catSelect.selectedIndex].getAttribute('data-name');
        }
        const res = await apiWrite('addAccessoryItem', {
          code: code || fd.get('code'), categoryId: categoryId, categoryName: categoryName, name: fd.get('name'),
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
          ${DEVICE_TYPE_PRESETS.map(function (t) { return `<option value="${t}">${t}</option>`; }).join('')}
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
      <div class="field">
        <label>الضمان</label>
        <select name="warranty" required>
          <option value="له ضمان">له ضمان</option>
          <option value="بدون ضمان">بدون ضمان</option>
        </select>
      </div>
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
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addDevice', {
          code: code || fd.get('code'), condition: fd.get('condition'), name: fd.get('name'), warranty: fd.get('warranty'),
          deviceType: deviceType,
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listDevices', res.item);
      }, { successMsg: 'تمت إضافة الجهاز بنجاح', onDone: function () { if (onSaved) onSaved(); } });
    });
  });
}

async function sellScannedProductNow(code) {
  if (!scanCustomer.name || !scanCustomer.phone) {
    toast('المنتج اتضاف بنجاح، ادخل بيانات العميل وابحث بنفس الكود تاني عشان تكمل البيع', 'success');
    renderScan();
    return;
  }
  try {
    const result = await sellByCode(code, {
      code: code, customerName: scanCustomer.name, customerPhone: scanCustomer.phone, employee: CURRENT_USER.name
    });
    invalidateProductCaches();
    toast(savedMsg('تم البيع بنجاح'), 'success');
    printReceipt({
      customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
      productName: result.sale.itemName || result.sale.deviceName,
      employee: CURRENT_USER.name, total: result.sale.totalPrice
    });
    renderScan();
  } catch (err) { toast(err.message, 'error'); }
}

/* ============ الصيانة ============ */

let maintenanceTab = 'هاردوير';

async function renderMaintenance() {
  setBreadcrumb('هاردوير وسوفتوير — كشف أعطال أو عطل معروف');
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
    let rows = data.items.filter(function (r) { return r.deviceCategory === maintenanceTab; });
    if (caseFilter) rows = rows.filter(function (r) { return r.caseType === caseFilter; });
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(function (r) {
        return (r.customerName || '').toLowerCase().includes(q) || (r.deviceType || '').toLowerCase().includes(q);
      });
    }
    rows.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

    document.getElementById('maint-table').innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th>التاريخ</th><th>الحالة</th><th>نوع الجهاز</th><th>العطل</th><th>العميل</th><th>الهاتف</th>
          <th>سعر الجملة</th><th>المكسب</th><th>الإجمالي</th><th>ملاحظات</th><th>الموظف</th>
        </tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return `<tr>
              <td>${r.date}</td>
              <td><span class="badge ${r.caseType === 'كشف اعطال' ? 'badge-slate' : 'badge-brown'}">${r.caseType}</span></td>
              <td>${r.deviceType || '-'}</td><td>${r.faultType || '-'}</td>
              <td>${r.customerName || '-'}</td><td>${r.customerPhone || '-'}</td>
              <td>${Number(r.wholesaleCost).toLocaleString()}</td>
              <td>${Number(r.profitCost).toLocaleString()}</td>
              <td><strong>${Number(r.total).toLocaleString()}</strong></td>
              <td>${r.notes || '-'}</td>
              <td>${r.employee || '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد عمليات مطابقة</div>`;
  } catch (err) {
    document.getElementById('maint-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
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
      el.querySelector('#phone-field').classList.toggle('hidden', !known);
    }
    caseSelect.addEventListener('change', toggleFields);
    toggleFields();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#maint-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tabAtSubmit = maintenanceTab;
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
        return result;
      }, {
        successMsg: 'تمت إضافة عملية الصيانة',
        onDone: function (result) {
          printReceipt({
            customerName: result.item.customerName, customerPhone: result.item.customerPhone,
            productName: (result.item.deviceType || '') + ' - صيانة ' + tabAtSubmit,
            employee: result.item.employee, total: result.item.total
          });
          loadMaintenanceTable();
        }
      });
    });
  });
}

/* ============ الإكسسوارات ============ */

let currentAccCategory = null;

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
          const count = itemData.items.filter(function (i) { return i.categoryId === c.id; }).length;
          return `<div class="category-box" data-cat-id="${c.id}" data-cat-name="${c.name}">
            <div class="icon">${categoryIcon_(dispCat(c.name), isPc)}</div><div class="name">${dispCat(c.name)}</div><div class="count">${count} صنف</div>
            <button class="link-btn" data-move-cat="${c.id}" style="margin-top:10px;font-size:12px">↔ نقل لـ ${isPc ? 'إكسسوارات الموبايل' : 'إكسسوارات الكمبيوتر'}</button>
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
    content().innerHTML = `<div class="empty-state">${err.message}</div>`;
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
    <p style="line-height:1.8">هتنقل نوع <strong>${pure}</strong> بكل أصنافه وبياناته (الأسعار، الكميات، الأكواد، المبيعات) إلى <strong>${label}</strong>.</p>
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
  setBreadcrumb((catIsPc({ name: catName }) ? 'إكسسوارات الكمبيوتر / ' : 'الإكسسوارات / ') + dispCat(catName));
  content().innerHTML = `
    <div class="section-header">
      <button class="link-btn" id="back-cats">→ رجوع لكل الأنواع</button>
      <div class="toolbar">
        <input type="text" id="item-search" placeholder="بحث باسم الصنف..." />
        <button class="btn btn-dark btn-sm" id="scan-add-btn">🔍 إضافة/تعديل بالباركود</button>
        <button class="btn btn-outline btn-sm" id="add-item-btn">+ إضافة صنف يدوي</button>
        <button class="btn btn-outline btn-sm" id="move-cat-btn">↔ نقل لـ ${catIsPc({ name: catName }) ? 'إكسسوارات الموبايل' : 'إكسسوارات الكمبيوتر'}</button>
      </div>
    </div>
    <div id="items-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('back-cats').addEventListener('click', renderAccessories);
  document.getElementById('add-item-btn').addEventListener('click', function () { openAddItemForm(catId, catName); });
  document.getElementById('scan-add-btn').addEventListener('click', function () { openQuickBarcodeForCategory(catId, catName); });
  document.getElementById('move-cat-btn').addEventListener('click', function () { moveAccessoryCategory(catId, catName, renderAccessories); });
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
    let rows = data.items.filter(function (i) { return i.categoryId === catId; });
    if (search) rows = rows.filter(function (i) { return i.name.toLowerCase().includes(search.toLowerCase()); });
    document.getElementById('items-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>سعر الجملة</th><th>سعر المكسب</th><th>الإجمالي</th><th>الكمية</th><th>تاريخ الإضافة</th><th></th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (i) {
            return `<tr>
              <td><span class="badge badge-slate">${i.code || '-'}</span></td>
              <td>${i.name}</td><td>${Number(i.wholesalePrice).toLocaleString()}</td>
              <td>${Number(i.profitPrice).toLocaleString()}</td><td><strong>${Number(i.totalPrice).toLocaleString()}</strong></td>
              <td>${i.quantity <= 2 ? '<span class="badge badge-danger">' + i.quantity + '</span>' : i.quantity}</td>
              <td>${i.dateAdded}</td>
              <td><button class="btn btn-primary btn-sm" data-sell-id="${i.id}">بيع للعميل</button></td>
              <td><button class="link-btn" data-edit-id="${i.id}">تعديل</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد أصناف في هذا النوع بعد</div>`;

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
    document.getElementById('items-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function openAddItemForm(catId, catName, prefillCode) {
  const overlay = openModal('إضافة صنف جديد — ' + dispCat(catName), `
    <form id="item-form">
      <div class="field"><label>اسم الصنف</label><input name="name" required /></div>
      <div class="field"><label>كود المنتج (اختياري — سيبه فاضي عشان يتولد تلقائي)</label><input name="code" placeholder="اختياري" value="${prefillCode || ''}" /></div>
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
    const codeField = el.querySelector('[name=code]');
    if (codeField) codeField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[name=wholesalePrice]').focus(); }
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addAccessoryItem', {
          categoryId: catId, categoryName: catName, name: fd.get('name'), code: fd.get('code'),
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
      } catch (err) { toast(err.message, 'error'); }
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
          return `<div class="category-box" data-type="${t}">
            <div class="icon">${deviceTypeIcon_(t)}</div><div class="name">${t}</div><div class="count">${count} جهاز</div>
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
    content().innerHTML = `<div class="empty-state">${err.message}</div>`;
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
      <button class="btn btn-dark" id="scan-add-device-btn">🔍 إضافة/تعديل بالباركود</button>
      <button class="btn btn-primary" id="add-device-btn">+ إضافة جهاز يدوي</button>
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
        <thead><tr><th>الكود</th><th>الاسم</th><th>الضمان</th><th>سعر الجملة</th><th>سعر المكسب</th><th>الإجمالي</th><th>الكمية</th><th></th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (d) {
            return `<tr>
              <td><span class="badge badge-slate">${d.code || '-'}</span></td>
              <td>${d.name}</td>
              <td><span class="badge ${d.warranty === 'له ضمان' ? 'badge-success' : 'badge-slate'}">${d.warranty}</span></td>
              <td>${Number(d.wholesalePrice).toLocaleString()}</td><td>${Number(d.profitPrice).toLocaleString()}</td>
              <td><strong>${Number(d.totalPrice).toLocaleString()}</strong></td>
              <td>${d.quantity <= 2 ? '<span class="badge badge-danger">' + d.quantity + '</span>' : d.quantity}</td>
              <td><button class="btn btn-primary btn-sm" data-sell-device="${d.id}">بيع للعميل</button></td>
              <td><button class="link-btn" data-edit-device="${d.id}">تعديل</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد أجهزة ${deviceTab} من نوع ${currentDeviceType} بعد</div>`;
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
    document.getElementById('devices-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function openAddDeviceForm(presetType, prefillCode) {
  const overlay = openModal('إضافة جهاز — ' + deviceTab, `
    <form id="device-form">
      <div class="field"><label>اسم الجهاز</label><input name="name" required /></div>
      <div class="field"><label>كود المنتج (اختياري — سيبه فاضي عشان يتولد تلقائي)</label><input name="code" placeholder="اختياري" value="${prefillCode || ''}" /></div>
      <div class="field">
        <label>نوع الجهاز</label>
        <select name="deviceType" required>
          ${DEVICE_TYPE_PRESETS.concat(presetType && DEVICE_TYPE_PRESETS.indexOf(presetType) === -1 ? [presetType] : [])
            .map(function (t) { return `<option value="${t}" ${t === presetType ? 'selected' : ''}>${t}</option>`; }).join('')}
          <option value="__new__">+ نوع جديد</option>
        </select>
      </div>
      <div class="field hidden" id="new-type-field"><label>اسم النوع الجديد</label><input name="newDeviceType" /></div>
      <div class="field">
        <label>الضمان</label>
        <select name="warranty" required>
          <option value="له ضمان">له ضمان</option>
          <option value="بدون ضمان">بدون ضمان</option>
        </select>
      </div>
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
      saveInBackground(overlay, async function () {
        const res = await apiWrite('addDevice', {
          condition: conditionAtSubmit, name: fd.get('name'), warranty: fd.get('warranty'), code: fd.get('code'),
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
      } catch (err) { toast(err.message, 'error'); }
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
    rows.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    document.getElementById('cash-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>العميل</th><th>الهاتف</th><th>المبلغ</th><th>ملاحظات</th><th>الموظف</th></tr></thead>
        <tbody>
          ${rows.map(function (r) {
            return `<tr>
              <td>${r.date}</td>
              <td><span class="badge ${r.type === 'ايداع' ? 'badge-success' : 'badge-brown'}">${r.type}</span></td>
              <td>${r.customerName}</td><td>${r.customerPhone}</td>
              <td><strong>${Number(r.amount).toLocaleString()}</strong></td>
              <td>${r.notes || '-'}</td><td>${r.employee}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد عمليات بعد</div>`;
  } catch (err) {
    document.getElementById('cash-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
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
      }, { successMsg: 'تم تسجيل العملية', onDone: function () { loadCashTable(); } });
    });
  });
}

/* ============ المخزون ============ */

let inventoryMode = 'accessories';

async function renderInventory() {
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
            const list = items.items.filter(function (i) { return i.categoryId === c.id; });
            const totalQty = list.reduce(function (s, i) { return s + Number(i.quantity); }, 0);
            return `<div class="card">
              <h3 style="margin-top:0">${catIsPc(c) ? '💻 ' : ''}${dispCat(c.name)} <span class="badge badge-brown">${totalQty} قطعة</span></h3>
              ${list.length ? list.map(function (i) {
                return `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong>${i.name}</strong>
                    <span>${i.quantity <= 2 ? '<span class="badge badge-danger">' + i.quantity + '</span>' : i.quantity}
                    <button class="link-btn" style="margin-right:8px" data-edit-acc-id="${i.id}">تعديل</button></span>
                  </div>
                  <div style="color:#888">كود: ${i.code || '-'} — إجمالي السعر: ${Number(i.totalPrice).toLocaleString()} ج.م — أُضيف: ${i.dateAdded}</div>
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
                return `<tr><td><span class="badge badge-slate">${d.code || '-'}</span></td><td>${d.deviceType || '-'}</td><td>${d.name}</td><td>${d.condition}</td><td>${d.warranty}</td>
                <td>${Number(d.totalPrice).toLocaleString()}</td>
                <td>${d.quantity <= 2 ? '<span class="badge badge-danger">' + d.quantity + '</span>' : d.quantity}</td>
                <td>${d.dateAdded}</td>
                <td><button class="link-btn" data-edit-dev-id="${d.id}">تعديل</button></td></tr>`;
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
    wrap.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

/* ============ الحسابات ============ */

function openEditAccessoryForm(item, onSaved) {
  const overlay = openModal('تعديل الصنف', `
    <form id="edit-acc-form">
      <div class="field"><label>اسم الصنف</label><input name="name" value="${item.name}" required /></div>
      <div class="field"><label>كود المنتج</label><input name="code" value="${item.code || ''}" /></div>
      <div class="grid grid-2">
        <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="${item.wholesalePrice}" required /></div>
        <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="${item.profitPrice}" required /></div>
      </div>
      <div class="field"><label>الكمية</label><input type="number" name="quantity" value="${item.quantity}" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#edit-acc-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiWrite('updateAccessoryItem', {
          id: item.id, name: fd.get('name'), code: fd.get('code'),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        invalidateCache('listAccessoryItems');
        overlay.remove();
        toast('تم تعديل الصنف بنجاح', 'success');
        if (onSaved) onSaved(); else loadInventoryBody('accessories');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openEditDeviceForm(device, onSaved) {
  const overlay = openModal('تعديل الجهاز', `
    <form id="edit-dev-form">
      <div class="field"><label>اسم الجهاز</label><input name="name" value="${device.name}" required /></div>
      <div class="field"><label>كود المنتج</label><input name="code" value="${device.code || ''}" /></div>
      <div class="field">
        <label>نوع الجهاز</label>
        <select name="deviceType" required>
          ${Array.from(new Set(DEVICE_TYPE_PRESETS.concat([device.deviceType])))
            .map(function (t) { return `<option value="${t}" ${t === device.deviceType ? 'selected' : ''}>${t}</option>`; }).join('')}
        </select>
      </div>
      <div class="field">
        <label>الضمان</label>
        <select name="warranty" required>
          <option value="له ضمان" ${device.warranty === 'له ضمان' ? 'selected' : ''}>له ضمان</option>
          <option value="بدون ضمان" ${device.warranty === 'بدون ضمان' ? 'selected' : ''}>بدون ضمان</option>
        </select>
      </div>
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
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#edit-dev-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiWrite('updateDevice', {
          id: device.id, name: fd.get('name'), code: fd.get('code'), deviceType: fd.get('deviceType'), warranty: fd.get('warranty'),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        invalidateCache('listDevices');
        overlay.remove();
        toast('تم تعديل الجهاز بنجاح', 'success');
        if (onSaved) onSaved(); else loadInventoryBody('devices');
      } catch (err) { toast(err.message, 'error'); }
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
    content().innerHTML = `<div class="empty-state">${err.message}</div>`;
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
  const byCategory = { 'صيانة': { total: 0, profit: 0 }, 'اكسسوارات': { total: 0, profit: 0 }, 'اجهزة': { total: 0, profit: 0 } };
  accountingRecordsCache.forEach(function (r) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, profit: 0 };
    byCategory[r.category].total += r.total;
    byCategory[r.category].profit += r.profit;
  });
  const icons = { 'صيانة': '🛠️', 'اكسسوارات': '🎧', 'اجهزة': '📱' };
  document.getElementById('acc-summary-cards').innerHTML = Object.keys(byCategory).map(function (cat) {
    const v = byCategory[cat];
    return `<div class="card">
      <div style="font-size:22px;margin-bottom:6px">${icons[cat] || '📦'}</div>
      <h3 style="margin:0 0 10px">${cat}</h3>
      <div class="stat-label">بعت بإجمالي</div>
      <div class="stat-value brown" style="font-size:20px;margin-bottom:8px">${v.total.toLocaleString()} ج.م</div>
      <div class="stat-label">كسبت (المكسب)</div>
      <div class="stat-value dark" style="font-size:20px">${v.profit.toLocaleString()} ج.م</div>
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
      if (!map[key]) map[key] = { wholesale: 0, profit: 0, total: 0 };
      map[key].wholesale += r.wholesale;
      map[key].profit += r.profit;
      map[key].total += r.total;
    });
    return map;
  }

  let map, headLabel;
  if (view === 'daily') { map = groupBy(function (r) { return r.date; }); headLabel = 'اليوم'; }
  else if (view === 'monthly') { map = groupBy(function (r) { return r.date.substring(0, 7); }); headLabel = 'الشهر'; }
  else if (view === 'yearly') { map = groupBy(function (r) { return r.date.substring(0, 4); }); headLabel = 'السنة'; }
  else { map = groupBy(function (r) { return r.category; }); headLabel = 'القسم'; }

  const keys = Object.keys(map).sort().reverse();
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>${headLabel}</th><th>سعر الجملة</th><th>المكسب</th><th>الإجمالي (اللي بعته)</th></tr></thead>
        <tbody>
          ${keys.map(function (k) {
            const v = map[k];
            return `<tr><td>${k}</td><td>${v.wholesale.toLocaleString()} ج.م</td>
            <td>${v.profit.toLocaleString()} ج.م</td><td><strong>${v.total.toLocaleString()} ج.م</strong></td></tr>`;
          }).join('') || '<tr><td colspan="4" class="empty-state">لا توجد بيانات بعد</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
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
            return `<tr><td>${u.name}</td><td>${u.username}</td>
            <td><span class="badge ${u.role === 'مدير النظام' ? 'badge-brown' : 'badge-slate'}">${u.role}</span></td>
            <td>${u.createdAt}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('users-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
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

/* ============ طباعة الإيصال ============ */

function printReceipt(data) {
  // مقاس ورق الطابعة بالملي: 80 (XP-80 وأغلب موديلات Xprinter) أو 58 (XP-58). بيتغير من config.js
  const width = (typeof RECEIPT_WIDTH_MM !== 'undefined' && Number(RECEIPT_WIDTH_MM)) || 80;
  const printable = width <= 58 ? 48 : 72;
  const now = new Date();
  const when = now.toLocaleDateString('en-GB') + '  ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const row = function (label, value) {
    return '<div class="row"><span class="l">' + label + '</span><span class="v">' + escHtml(value || '-') + '</span></div>';
  };
  const html = '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال</title><style>' +
    '@page { size: ' + width + 'mm auto; margin: 0; }' +
    '* { box-sizing: border-box; }' +
    'html, body { margin: 0; padding: 0; background: #fff; color: #000; }' +
    'body { width: ' + printable + 'mm; margin: 0 auto; padding: 3mm 0 6mm; font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size: 12px; line-height: 1.55; }' +
    '.center { text-align: center; }' +
    'h2 { margin: 0 0 2px; font-size: 20px; }' +
    '.muted { font-size: 11px; }' +
    'hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }' +
    '.row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }' +
    '.row .l { white-space: nowrap; }' +
    '.row .v { text-align: left; font-weight: bold; word-break: break-word; }' +
    '.total { font-size: 16px; font-weight: bold; }' +
    '</style></head><body>' +
    '<div class="center"><h2>' + escHtml(SHOP_NAME) + '</h2><div class="muted">' + when + '</div></div><hr />' +
    row('العميل:', data.customerName) + row('الهاتف:', data.customerPhone) +
    row('المنتج:', data.productName) + row('الموظف:', data.employee) + '<hr />' +
    '<div class="row total"><span class="l">الإجمالي:</span><span class="v">' + Number(data.total || 0).toLocaleString() + ' ج.م</span></div><hr />' +
    '<div class="center">شكرًا لتعاملكم معنا</div>' +
    '</body></html>';

  // بنطبع من iframe مخفي بدل نافذة جديدة، عشان المتصفح ميحجبش النافذة وتشتغل حتى بعد عمليات أوفلاين
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

/* ============ السكانر العام (يشتغل من أي مكان في النظام) ============ */

let globalScanBuffer = '';
let globalScanLastTime = 0;

document.addEventListener('keydown', function (e) {
  // لو المستخدم بيكتب فعليًا في أي خانة نص/تيكست إريا/قايمة (زي فورم إضافة أو تسجيل دخول)
  // سيبها تتصرف عادي، ومتتدخلش خالص
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isTyping) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!CURRENT_USER) return; // قبل تسجيل الدخول متعملش حاجة

  const now = Date.now();
  // ماسحات الباركود بتكتب الأرقام بسرعة جدًا (أسرع من أي كتابة بشرية)
  // لو الفاصل بين الضغطات كبير، يبقى ده كتابة عادية أو ضغطة عرضية، ابدأ بافر جديد
  if (now - globalScanLastTime > 60) globalScanBuffer = '';
  globalScanLastTime = now;

  if (e.key === 'Enter') {
    const code = globalScanBuffer.trim();
    globalScanBuffer = '';
    if (code.length >= 3) {
      e.preventDefault();
      handleGlobalScan(code);
    }
    return;
  }
  if (e.key.length === 1) {
    globalScanBuffer += e.key;
  }
});

function handleGlobalScan(code) {
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
