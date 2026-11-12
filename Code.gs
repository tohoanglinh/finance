/**
 * QUẢN LÝ TÀI CHÍNH CÁ NHÂN - Google Apps Script
 * - Tiết kiệm: không kỳ hạn / có kỳ hạn lãi cuối kỳ / có kỳ hạn lãi hàng tháng
 * - Đầu tư: cổ phiếu, chứng chỉ quỹ, ETF, khác (giá vốn bình quân gia quyền)
 * - Lương: gross -> net, bảo hiểm, thuế TNCN lũy tiến từng phần (5 bậc)
 * Dữ liệu lưu trong Google Sheets (tự tạo khi chạy lần đầu).
 */

// ===================== CẤU TRÚC DỮ LIỆU =====================
const SCHEMA = {
  savings: {
    sheet: 'TietKiem',
    cols: [['id', 'ID'], ['name', 'Ngân hàng / Tên sổ'], ['type', 'Loại'], ['principal', 'Số tiền gốc'],
           ['rate', 'Lãi suất %/năm'], ['startDate', 'Ngày gửi'], ['termMonths', 'Kỳ hạn (tháng)'],
           ['status', 'Trạng thái'], ['note', 'Ghi chú'], ['schedule', 'Lịch trả lãi thực tế']],
    text: ['id', 'startDate', 'schedule']
  },
  tx: {
    sheet: 'GiaoDichDauTu',
    cols: [['id', 'ID'], ['date', 'Ngày'], ['symbol', 'Mã'], ['assetType', 'Loại tài sản'], ['side', 'Mua/Bán'],
           ['qty', 'Số lượng'], ['price', 'Giá'], ['fee', 'Phí'], ['note', 'Ghi chú'],
           ['currency', 'Tiền tệ (trống = VND)'], ['fxRate', 'Tỷ giá sang VND']],
    text: ['id', 'date', 'currency']
  },
  price: {
    sheet: 'GiaHienTai',
    cols: [['symbol', 'Mã'], ['price', 'Giá hiện tại'], ['updated', 'Cập nhật'],
           ['auto', 'Mã Google Finance (trống = nhập tay)'], ['fx', 'Tiền tệ gốc (trống = VND)'],
           ['fxNow', 'Tỷ giá hiện tại sang VND (tự động)']],
    key: 'symbol',
    text: ['updated', 'auto', 'fx']
  },
  salary: {
    sheet: 'Luong',
    cols: [['id', 'ID'], ['month', 'Tháng'], ['base', 'Lương HĐ (+PC tính BH)'], ['allowance', 'Phụ cấp chịu thuế'],
           ['bonus', 'Thưởng'], ['exempt', 'Thu nhập miễn thuế'], ['dependents', 'Số người phụ thuộc'],
           ['otherDeduction', 'Giảm trừ khác'], ['insBase', 'Lương đóng BH (trống = lương HĐ)'], ['note', 'Ghi chú']],
    text: ['id', 'month']
  },
  // Chi tiêu ước tính hàng tháng (đối chiếu với số dư tiết kiệm không kỳ hạn)
  expense: {
    sheet: 'ChiTieu',
    cols: [['id', 'ID'], ['name', 'Khoản chi'], ['amount', 'Ngân sách / tháng'], ['status', 'Trạng thái (active/paused)'], ['note', 'Ghi chú'],
           ['from', 'Áp dụng từ tháng (trống = từ đầu)'], ['to', 'Đến hết tháng (trống = không giới hạn)']],
    text: ['id', 'from', 'to']
  },
  // Chi tiêu thực tế: mỗi khoản mỗi tháng một dòng
  spend: {
    sheet: 'ThucChi',
    cols: [['id', 'ID'], ['month', 'Tháng'], ['name', 'Khoản chi'], ['amount', 'Thực chi'], ['note', 'Ghi chú']],
    text: ['id', 'month', 'name']
  },
  // Giai đoạn áp dụng: từ tháng "from" đến hết tháng "to" (trống = không giới hạn), tham số "key" (trong CauHinh) đổi sang "value"
  // Cột "to" đặt cuối cùng để sheet GiaiDoan tạo từ phiên bản cũ tự được bổ sung cột mới
  period: {
    sheet: 'GiaiDoan',
    cols: [['id', 'ID'], ['from', 'Áp dụng từ tháng'], ['key', 'Tham số'], ['value', 'Giá trị mới'], ['note', 'Ghi chú'],
           ['to', 'Đến hết tháng (trống = không giới hạn)']],
    text: ['id', 'from', 'key', 'value', 'to']
  }
};

// Các cột số: luôn ghi vào Sheet dưới dạng số (không để Sheets tự đoán theo locale)
const NUMERIC = {
  savings: ['principal', 'rate', 'termMonths'],
  tx: ['qty', 'price', 'fee', 'fxRate'],
  price: ['price', 'fxNow'],
  expense: ['amount'],
  spend: ['amount'],
  salary: ['base', 'allowance', 'bonus', 'exempt', 'dependents', 'otherDeduction', 'insBase']
};

// Giai đoạn mẫu tạo sẵn lần đầu: [từ tháng, tham số, giá trị, ghi chú]
const DEFAULT_PERIODS = [
  ['2026-07', 'capSocial', '50600000', 'Trần BHXH/BHYT từ 07/2026 (20 x mức tham chiếu 2,53 triệu)']
];
// Các tham số dạng chữ (không phải số)
const TEXT_KEYS = ['taxBrackets', 'regionMin', 'sellTaxTypes', 'excludeSymbols'];

// Tiền tố ID dễ đọc theo từng loại bản ghi: TK-001, DT-001, LG-001, AD-001
const ID_PREFIX = { savings: 'TK', tx: 'DT', salary: 'LG', period: 'AD', expense: 'CT', spend: 'TC' };

const CONFIG_SHEET = 'CauHinh';
// [key, value, mô tả]
const DEFAULT_CONFIG = [
  ['personalDeduction', '15500000', 'Giảm trừ gia cảnh bản thân (đ/tháng) - từ kỳ tính thuế 2026'],
  ['dependentDeduction', '6200000', 'Giảm trừ mỗi người phụ thuộc (đ/tháng) - từ kỳ tính thuế 2026'],
  ['defaultDependents', '0', 'Số người phụ thuộc mặc định khi nhập lương'],
  ['bhxhRate', '8', 'BHXH người lao động (%)'],
  ['bhytRate', '1.5', 'BHYT người lao động (%)'],
  ['bhtnRate', '1', 'BHTN người lao động (%)'],
  ['capSocial', '46800000', 'Trần lương đóng BHXH/BHYT gốc (20 x mức tham chiếu 2,34 triệu). Từ 07/2026 đã đổi bằng mục Giai đoạn áp dụng'],
  ['region', '1', 'Vùng lương tối thiểu (1-4) để tính trần BHTN'],
  ['regionMin', '1:5310000,2:4730000,3:4140000,4:3700000', 'Lương tối thiểu vùng 2026 (vùng:số tiền)'],
  ['unempCapMultiplier', '20', 'Trần BHTN = số lần lương tối thiểu vùng'],
  ['taxBrackets', '10000000:5,30000000:10,60000000:20,100000000:30,inf:35',
    'Biểu thuế lũy tiến THÁNG: giới hạn trên:thuế suất %. Phân tách bằng dấu phẩy'],
  ['sellTaxRate', '0.1', 'Thuế bán chứng khoán (% trên giá trị bán)'],
  ['sellTaxTypes', 'STOCK,ETF,FUND', 'Các loại tài sản chịu thuế bán (STOCK, ETF, FUND, OTHER)'],
  ['excludeSymbols', 'NXPI', 'Các mã KHÔNG tính vào giá trị danh mục / tổng tài sản (VD cổ phiếu RSU), cách nhau bằng dấu phẩy. Vẫn hiện trong bảng danh mục, chỉ không cộng vào các tổng'],
  ['savingsTaxRate', '5', 'Thuế khấu trừ (%) trên lãi tiết kiệm có kỳ hạn, dùng cho thẻ "Lãi tiết kiệm sắp nhận" ở Tổng quan']
];

// ===================== ĐIỂM VÀO WEB APP =====================
function doGet() {
  ensureSetup_(true);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Tài chính cá nhân')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Tài chính').addItem('Khởi tạo các sheet', 'setup_').addItem('Đánh lại ID dễ đọc', 'migrateIdsUi_').addToUi();
  } catch (e) { /* không chạy trong Sheet */ }
}

function api(action, p) {
  const dispatch = function () {
    switch (action) {
      case 'bootstrap': return { ok: true, data: bootstrap_() };
      case 'save': return { ok: true, data: save_(p.entity, p.record) };
      case 'saveSalaryRange': return { ok: true, data: saveSalaryRange_(p.record, p.endMonth) };
      case 'savePeriodBatch': return { ok: true, data: savePeriodBatch_(p) };
      case 'remove': return { ok: true, data: remove_(p.entity, p.key) };
      case 'refreshPrices': return { ok: true, data: refreshPrices_(p && p.symbol, p && p.background) };
      case 'saveConfig': return { ok: true, data: saveConfig_(p) };
      case 'aiAnalyze': return { ok: true, data: aiAnalyze_() };
      case 'aiChat': return { ok: true, data: aiChat_(p) };
      case 'calcSalary': return { ok: true, data: calcSalary_(p, cfgForMonth_(p.month)) };
      case 'grossFromNet': return { ok: true, data: grossFromNet_(p, cfgForMonth_(p.month)) };
      default: return { ok: false, error: 'Hành động không hợp lệ: ' + action };
    }
  };
  try {
    ensureSetup_(false);
    try {
      return dispatch();
    } catch (e) {
      // Có thể một sheet vừa bị xóa/đổi tên khi cờ khởi tạo còn hiệu lực: khởi tạo lại rồi thử lại đúng một lần
      if (/null|undefined/i.test(String(e && e.message)) && /Cannot read|reading|of null|of undefined/i.test(String(e && e.message))) {
        ensureSetup_(true);
        return dispatch();
      }
      throw e;
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// ===================== SHEETS =====================
var SS_CACHE_ = null;   // mỗi lần chạy chỉ mở bảng tính một lần
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return (SS_CACHE_ = ss);
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SS_ID');
  if (id) return (SS_CACHE_ = SpreadsheetApp.openById(id));
  ss = SpreadsheetApp.create('Tài chính cá nhân - dữ liệu');
  props.setProperty('SS_ID', ss.getId());
  return (SS_CACHE_ = ss);
}

/**
 * Kiểm tra/khởi tạo các sheet tốn nhiều lệnh gọi Google Sheets, nên chỉ làm khi mở trang hoặc khi cấu trúc dữ liệu đổi.
 * Cờ nhớ trong 10 phút; chữ ký lấy từ cấu trúc nên bản mã mới (thêm cột/sheet) tự chạy lại.
 */
function schemaSig_() {
  const s = JSON.stringify(SCHEMA) + JSON.stringify(DEFAULT_CONFIG);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'SETUP_' + h;
}
function ensureSetup_(force) {
  const cache = CacheService.getScriptCache(), key = schemaSig_();
  if (!force && cache.get(key)) return;
  setup_();
  cache.put(key, '1', 600);
}

function setup_() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (ent) {
    const sc = SCHEMA[ent];
    let sh = ss.getSheetByName(sc.sheet);
    if (!sh) {
      sh = ss.insertSheet(sc.sheet);
      sh.getRange(1, 1, 1, sc.cols.length).setValues([sc.cols.map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#e8f0fe');
      sh.setFrozenRows(1);
      (sc.text || []).forEach(function (k) {
        const idx = sc.cols.findIndex(function (c) { return c[0] === k; }) + 1;
        sh.getRange(2, idx, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
      if (ent === 'period') {
        const seed = DEFAULT_PERIODS.map(function (p) { return [Utilities.getUuid().slice(0, 8), p[0], p[1], p[2], p[3]]; });
        sh.getRange(2, 1, seed.length, 5).setValues(seed);
      }
    } else if (sh.getLastColumn() < sc.cols.length) {
      // Sheet tạo từ phiên bản cũ: bổ sung tiêu đề cho các cột mới
      const from = sh.getLastColumn() + 1;
      sh.getRange(1, from, 1, sc.cols.length - from + 1)
        .setValues([sc.cols.slice(from - 1).map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#e8f0fe');
      (sc.text || []).forEach(function (k) {
        const idx = sc.cols.findIndex(function (c) { return c[0] === k; }) + 1;
        if (idx >= from) sh.getRange(2, idx, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    }
  });
  let cs = ss.getSheetByName(CONFIG_SHEET);
  if (!cs) {
    cs = ss.insertSheet(CONFIG_SHEET);
    cs.getRange(1, 1, 1, 3).setValues([['Khóa', 'Giá trị', 'Mô tả']]).setFontWeight('bold').setBackground('#e8f0fe');
    cs.getRange(2, 2, DEFAULT_CONFIG.length + 50, 1).setNumberFormat('@');
    cs.getRange(2, 1, DEFAULT_CONFIG.length, 3).setValues(DEFAULT_CONFIG);
    cs.setFrozenRows(1);
    cs.setColumnWidth(2, 320); cs.setColumnWidth(3, 480);
  }
  // Bổ sung các tham số mới (nếu sheet CauHinh được tạo từ phiên bản cũ)
  const cLast = cs.getLastRow();
  const have = cLast >= 2 ? cs.getRange(2, 1, cLast - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  const missing = DEFAULT_CONFIG.filter(function (d) { return have.indexOf(d[0]) < 0; });
  if (missing.length) {
    const r0 = cs.getLastRow() + 1;
    cs.getRange(r0, 2, missing.length, 1).setNumberFormat('@');
    cs.getRange(r0, 1, missing.length, 3).setValues(missing);
  }
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
}

function tz_() { return ss_().getSpreadsheetTimeZone() || 'Asia/Ho_Chi_Minh'; }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function norm_(key, v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz_(), (key === 'month' || key === 'from' || key === 'to') ? 'yyyy-MM' : 'yyyy-MM-dd');
  }
  return v;
}

function readAll_(ent) {
  const sc = SCHEMA[ent];
  const sh = ss_().getSheetByName(sc.sheet);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, sc.cols.length).getValues();
  return vals.filter(function (r) { return r.some(function (c) { return c !== ''; }); })
    .map(function (r) {
      const o = {};
      sc.cols.forEach(function (c, i) { o[c[0]] = c[0] === 'id' ? String(r[i]) : norm_(c[0], r[i]); });
      return o;
    });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Hệ thống đang bận, hãy thử lại sau vài giây');
  try { return fn(); } finally { lock.releaseLock(); }
}

function findRow_(sh, sc, keyName, keyVal) {
  const kIdx = sc.cols.findIndex(function (c) { return c[0] === keyName; });
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const keys = sh.getRange(2, kIdx + 1, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).toUpperCase() === String(keyVal).toUpperCase()) return i + 2;
  }
  return -1;
}

function save_(ent, rec) {
  const sc = SCHEMA[ent];
  if (!sc) throw new Error('Thực thể không hợp lệ');
  return withLock_(function () {
    const sh = ss_().getSheetByName(sc.sheet);
    const keyName = sc.key || 'id';
    if (ent === 'price') {
      rec.symbol = String(rec.symbol || '').toUpperCase().trim();
      rec.auto = String(rec.auto || '').trim();
      rec.fx = String(rec.fx || '').trim().toUpperCase();
      rec.updated = (rec.price === '' || rec.price === null || rec.price === undefined) ? '' : today_();
    }
    if (ent === 'tx') {
      rec.symbol = String(rec.symbol || '').toUpperCase().trim();
      rec.currency = String(rec.currency || 'VND').toUpperCase().trim();
      if (rec.currency === 'VND') { rec.currency = ''; rec.fxRate = ''; }
    }
    // Thực chi: mỗi khoản mỗi tháng chỉ có 1 dòng, nhập lại thì ghi đè
    if (ent === 'spend') {
      rec.name = String(rec.name || '').trim();
      const low = function (x) { return String(x).trim().toLowerCase(); };
      const ex = readAll_('spend').filter(function (r) { return r.month === rec.month && low(r.name) === low(rec.name); })[0];
      if (ex) rec.id = ex.id;
    }
    // Lương: mỗi tháng chỉ có 1 dòng. Nhập lại cùng tháng thì ghi đè dòng cũ.
    if (ent === 'salary') {
      const all = readAll_('salary');
      if (!rec.id) {
        const ex = all.filter(function (r) { return r.month === rec.month; })[0];
        if (ex) rec.id = ex.id;
      } else {
        // Đang sửa một dòng: không cho đổi sang tháng đã có dòng khác (tránh hai dòng cùng tháng, Tổng quan sẽ đếm đôi)
        const same = function (a, b) { return String(a).toUpperCase() === String(b).toUpperCase(); };
        const cur = all.filter(function (r) { return same(r.id, rec.id); })[0];
        if (!cur || cur.month !== rec.month) {
          const dup = all.filter(function (r) { return r.month === rec.month && !same(r.id, rec.id); })[0];
          if (dup) throw new Error('Tháng ' + rec.month + ' đã có dữ liệu lương (' + dup.id + '). Hãy sửa dòng của tháng đó, hoặc xóa nó trước rồi đổi tháng.');
        }
      }
    }
    if (!rec[keyName]) {
      if (keyName === 'id') rec.id = nextId_(ent, sh);
      else throw new Error('Thiếu ' + keyName);
    }
    validate_(ent, rec);
    if (ent === 'tx') {
      const before = readAll_('tx');
      const same = function (a, b) { return String(a).toUpperCase() === String(b).toUpperCase(); };
      const old = before.filter(function (r) { return same(r.id, rec.id); })[0];
      const after = old ? before.map(function (r) { return same(r.id, rec.id) ? rec : r; }) : before.concat([rec]);
      const syms = [rec.symbol];
      if (old && txSym_(old) !== rec.symbol) syms.push(txSym_(old));   // đổi mã: kiểm tra cả mã cũ
      checkTxOversell_(before, after, syms, '');
    }
    const numCols = NUMERIC[ent] || [];
    const row = sc.cols.map(function (c) {
      const v = rec[c[0]];
      if (v === undefined || v === null) return '';
      if (numCols.indexOf(c[0]) >= 0 && v !== '' && !isNaN(Number(v))) return Number(v);
      return v;
    });
    const idx = findRow_(sh, sc, keyName, rec[keyName]);
    const target = idx > 0 ? idx : sh.getLastRow() + 1;
    // Đặt định dạng TRƯỚC khi ghi để Sheets không tự biến "4.7" thành ngày
    (sc.text || []).forEach(function (k) {
      const ci = sc.cols.findIndex(function (c) { return c[0] === k; }) + 1;
      sh.getRange(target, ci).setNumberFormat('@');
    });
    numCols.forEach(function (k) {
      const ci = sc.cols.findIndex(function (c) { return c[0] === k; }) + 1;
      sh.getRange(target, ci).setNumberFormat('0.########');
    });
    sh.getRange(target, 1, 1, row.length).setValues([row]);
    return rec;
  });
}

function idFmt_(pre, n) { return pre + '-' + (n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n))); }

/** ID kế tiếp = số lớn nhất đang có theo dạng TIỀN_TỐ-số, cộng 1 (ID cũ kiểu ngẫu nhiên được bỏ qua) */
function nextId_(ent, sh) {
  const pre = ID_PREFIX[ent];
  const re = new RegExp('^' + pre + '-(\\d+)$');
  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      const m = re.exec(String(r[0]));
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return idFmt_(pre, max + 1);
}

/**
 * Đổi các ID cũ (ngẫu nhiên) sang dạng dễ đọc, giữ nguyên ID đã đúng dạng.
 * Chạy từ menu "Tài chính" trong Google Sheet, hoặc chọn hàm migrateIds trong Apps Script rồi bấm Chạy.
 */
function migrateIds() {
  return withLock_(function () {
    const result = {};
    Object.keys(ID_PREFIX).forEach(function (ent) {
      const pre = ID_PREFIX[ent];
      const re = new RegExp('^' + pre + '-(\\d+)$');
      const sh = ss_().getSheetByName(SCHEMA[ent].sheet);
      const last = sh.getLastRow();
      result[ent] = 0;
      if (last < 2) return;
      const rng = sh.getRange(2, 1, last - 1, 1);
      const ids = rng.getValues().map(function (r) { return String(r[0]); });
      let max = 0;
      ids.forEach(function (id) { const m = re.exec(id); if (m) max = Math.max(max, Number(m[1])); });
      const out = ids.map(function (id) {
        if (id === '' || re.test(id)) return [id];
        max++; result[ent]++;
        return [idFmt_(pre, max)];
      });
      rng.setNumberFormat('@');
      rng.setValues(out);
    });
    return result;
  });
}

function migrateIdsUi_() {
  const r = migrateIds();
  SpreadsheetApp.getUi().alert('Đã đổi ID: tiết kiệm ' + r.savings + ', giao dịch ' + r.tx + ', lương ' + r.salary + ', giai đoạn ' + r.period + '.\nTải lại trang ứng dụng web để thấy thay đổi.');
}

// ===================== GIÁ TỰ ĐỘNG (GOOGLEFINANCE) =====================
const AUTO_SHEET = 'GiaTuDong';

/**
 * Lấy giá hiện tại cho các mã có "Mã Google Finance" bằng hàm GOOGLEFINANCE của Google Sheets
 * (qua một sheet ẩn). Mã nước ngoài có tiền tệ gốc khác VND sẽ được nhân tỷ giá GOOGLEFINANCE("CURRENCY:USDVND").
 * Mã không lấy được giá thì giữ nguyên giá nhập tay.
 */
function refreshPrices_(onlySymbol, background) {
  const props = PropertiesService.getScriptProperties();
  // Tự lấy giá ở nền (mở app) chỉ chạy tối đa 1 lần / 30 phút, tránh chạy lặp khi Google không trả giá
  if (background) {
    const last = Number(props.getProperty('LAST_BG_REFRESH')) || 0;
    if (Date.now() - last < 30 * 60 * 1000) return { updated: 0, results: [], skipped: true };
  }
  // Khóa riêng của người dùng, KHÔNG phải khóa lưu dữ liệu: trong lúc chờ Google tính giá thì vẫn lưu/sửa/xóa bình thường
  const rl = LockService.getUserLock();
  if (!rl.tryLock(1000)) return { updated: 0, results: [], busy: true };
  try {
    if (background) props.setProperty('LAST_BG_REFRESH', String(Date.now()));
    return refreshPricesRun_(onlySymbol);
  } finally { rl.releaseLock(); }
}

function refreshPricesRun_(onlySymbol) {
  return (function () {
    const only = String(onlySymbol || '').toUpperCase().trim();
    const rows = readAll_('price').filter(function (r) {
      return String(r.auto || '').trim() !== '' && (!only || String(r.symbol).toUpperCase() === only);
    });
    if (!rows.length) return { updated: 0, results: [] };
    const ss = ss_();
    let tmp = ss.getSheetByName(AUTO_SHEET);
    if (!tmp) tmp = ss.insertSheet(AUTO_SHEET);
    try { if (tmp.isSheetHidden()) tmp.showSheet(); } catch (e) {}
    tmp.clear();
    const n = rows.length;
    // Sheet này để Google tính công thức; để hiện sẵn cho bạn xem Google trả về gì (cột Giá, Tỷ giá)
    tmp.getRange(1, 1, 1, 4).setValues([['Mã', 'Mã Google Finance', 'Giá (tiền tệ gốc)', 'Tỷ giá sang VND']])
      .setFontWeight('bold').setBackground('#e8f0fe');
    const labels = rows.map(function (r) { return [r.symbol, String(r.auto).trim()]; });
    tmp.getRange(2, 1, n, 2).setNumberFormat('@').setValues(labels);
    const formulas = rows.map(function (r) {
      const tk = String(r.auto).trim().replace(/"/g, '');
      const cur = String(r.fx || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
      return ['=GOOGLEFINANCE("' + tk + '")',
              (cur && cur !== 'VND') ? '=GOOGLEFINANCE("CURRENCY:' + cur + 'VND")' : '=1'];
    });
    tmp.getRange(2, 3, n, 2).setFormulas(formulas);
    let vals = [];
    // GOOGLEFINANCE trả "Loading..." một lúc rồi mới có số: chờ tối đa ~12 giây
    for (let k = 0; k < 6; k++) {
      Utilities.sleep(k === 0 ? 1000 : 2000);
      SpreadsheetApp.flush();
      vals = tmp.getRange(2, 3, n, 2).getValues();
      const loading = vals.some(function (v) { return String(v[0]) === 'Loading...' || String(v[1]) === 'Loading...' || v[0] === '' || v[1] === ''; });
      if (!loading) break;
    }
    const sc = SCHEMA.price;
    const sh = ss.getSheetByName(sc.sheet);
    const colOf = function (key) { return sc.cols.findIndex(function (c) { return c[0] === key; }) + 1; };
    const today = today_();
    const results = [];
    let updated = 0;
    withLock_(function () {   // chỉ giữ khóa lưu dữ liệu trong lúc ghi kết quả (rất nhanh)
    rows.forEach(function (r, i) {
      const px = vals[i][0], fx = vals[i][1];
      if (typeof px === 'number' && px > 0 && typeof fx === 'number' && fx > 0) {
        const vnd = Math.round(px * fx);
        const idx = findRow_(sh, sc, 'symbol', r.symbol);
        if (idx > 0) {
          sh.getRange(idx, colOf('price')).setNumberFormat('0.########').setValue(vnd);
          sh.getRange(idx, colOf('updated')).setNumberFormat('@').setValue(today);
          sh.getRange(idx, colOf('fxNow')).setNumberFormat('0.########').setValue(fx === 1 ? '' : fx);
          updated++;
          results.push({ symbol: r.symbol, ok: true, price: vnd });
        }
      } else {
        const why = (typeof px !== 'number' || !(px > 0)) ? 'giá: ' + String(px === '' ? '(trống)' : px) : 'tỷ giá ' + String(r.fx) + '/VND: ' + String(fx === '' ? '(trống)' : fx);
        results.push({ symbol: r.symbol, ok: false, error: 'Google Finance không trả về giá cho "' + r.auto + '" (' + why + ')' });
      }
    });
    });
    return { updated: updated, results: results };
  })();
}

function validate_(ent, r) {
  const num = function (v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); };
  if (ent === 'expense') {
    if (!String(r.name || '').trim()) throw new Error('Nhập tên khoản chi');
    if (!num(r.amount) || Number(r.amount) <= 0) throw new Error('Số tiền chi mỗi tháng phải lớn hơn 0');
    if (r.status !== 'active' && r.status !== 'paused') throw new Error('Trạng thái không hợp lệ');
    const mre = /^\d{4}-\d{2}$/;
    if (String(r.from || '').trim() && !mre.test(String(r.from))) throw new Error('"Áp dụng từ tháng" phải có dạng yyyy-MM');
    if (String(r.to || '').trim() && !mre.test(String(r.to))) throw new Error('"Đến hết tháng" phải có dạng yyyy-MM');
    if (String(r.from || '').trim() && String(r.to || '').trim() && String(r.to) < String(r.from)) throw new Error('"Đến hết tháng" phải sau hoặc bằng "Áp dụng từ tháng"');
    return;
  }
  if (ent === 'spend') {
    if (!/^\d{4}-\d{2}$/.test(String(r.month || ''))) throw new Error('Tháng phải có dạng yyyy-MM');
    if (!String(r.name || '').trim()) throw new Error('Thiếu tên khoản chi');
    if (r.amount === '' || r.amount === null || isNaN(Number(r.amount)) || Number(r.amount) < 0) throw new Error('Số tiền thực chi phải là số từ 0 trở lên');
    return;
  }
  if (ent === 'savings') {
    if (!r.name) throw new Error('Nhập tên sổ/ngân hàng');
    const demand = r.type === 'DEMAND';   // không kỳ hạn: "gốc" là số dư (được bằng 0), lãi suất tùy chọn
    if (!num(r.principal) || (demand ? Number(r.principal) < 0 : Number(r.principal) <= 0)) throw new Error(demand ? 'Số dư không hợp lệ' : 'Số tiền gốc không hợp lệ');
    if (!(demand && (r.rate === '' || r.rate === null || r.rate === undefined)) && (!num(r.rate) || Number(r.rate) < 0)) throw new Error('Lãi suất không hợp lệ');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.startDate))) throw new Error('Ngày gửi không hợp lệ');
    if (r.type !== 'DEMAND' && (!num(r.termMonths) || Number(r.termMonths) < 1)) throw new Error('Kỳ hạn (tháng) không hợp lệ');
    if (r.type === 'TERM_MONTHLY' && String(r.schedule || '').trim()) parseSchedule_(r.schedule); // báo lỗi nếu dòng nào sai
  } else if (ent === 'tx') {
    if (!r.symbol) throw new Error('Nhập mã');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) throw new Error('Ngày không hợp lệ');
    if (!num(r.qty) || Number(r.qty) <= 0) throw new Error('Số lượng không hợp lệ');
    if (!num(r.price) || Number(r.price) < 0) throw new Error('Giá không hợp lệ');
    if (String(r.currency || '').trim() && String(r.currency).toUpperCase() !== 'VND') {
      if (!/^[A-Za-z]{3}$/.test(String(r.currency).trim())) throw new Error('Tiền tệ gồm 3 chữ cái (VD: USD)');
      if (!num(r.fxRate) || Number(r.fxRate) <= 0) throw new Error('Nhập tỷ giá sang VND (VD: 1 USD = 26000 ₫)');
    }
  } else if (ent === 'salary') {
    if (!/^\d{4}-\d{2}$/.test(String(r.month))) throw new Error('Tháng không hợp lệ (yyyy-MM)');
    if (!num(r.base) || Number(r.base) < 0) throw new Error('Lương không hợp lệ');
  } else if (ent === 'period') {
    if (!/^\d{4}-\d{2}$/.test(String(r.from))) throw new Error('Tháng áp dụng không hợp lệ (yyyy-MM)');
    if (String(r.to || '').trim() !== '') {
      if (!/^\d{4}-\d{2}$/.test(String(r.to))) throw new Error('Tháng kết thúc không hợp lệ (yyyy-MM), hoặc để trống nếu không giới hạn');
      if (String(r.to) < String(r.from)) throw new Error('Tháng kết thúc phải sau hoặc bằng tháng bắt đầu');
    }
    const keys = DEFAULT_CONFIG.map(function (d) { return d[0]; });
    if (keys.indexOf(r.key) < 0) throw new Error('Tham số không hợp lệ');
    if (r.value === '' || r.value === undefined || r.value === null) throw new Error('Nhập giá trị mới');
    if (TEXT_KEYS.indexOf(r.key) < 0 && !num(r.value)) throw new Error('Giá trị phải là số');
    checkConfigValue_(r.key, r.value);
  } else if (ent === 'price') {
    const hasAuto = String(r.auto || '').trim() !== '';
    const hasPrice = !(r.price === '' || r.price === null || r.price === undefined);
    if (!hasAuto && (!num(r.price) || Number(r.price) < 0)) throw new Error('Giá không hợp lệ');
    if (hasAuto && hasPrice && (!num(r.price) || Number(r.price) < 0)) throw new Error('Giá không hợp lệ');
    if (hasAuto && !/^[A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+$|^[A-Za-z0-9_.\-]+$/.test(String(r.auto).trim())) throw new Error('Mã Google Finance không hợp lệ (VD: NASDAQ:NXPI)');
    if (String(r.fx || '').trim() && !/^[A-Za-z]{3}$/.test(String(r.fx).trim())) throw new Error('Tiền tệ gốc gồm 3 chữ cái (VD: USD)');
  }
}

function txSym_(t) { return String(t.symbol || '').toUpperCase().trim(); }

/** Tìm giao dịch bán đầu tiên vượt số lượng đang nắm của mã `sym` (theo thứ tự ngày, cùng ngày theo thứ tự trong sheet, giống calcPortfolio_) */
function oversellAt_(txs, sym) {
  const list = txs.map(function (t, i) { return { t: t, i: i }; })
    .filter(function (x) { return txSym_(x.t) === sym; })
    .sort(function (a, b) { return String(a.t.date).localeCompare(String(b.t.date)) || a.i - b.i; });
  let held = 0;
  for (let k = 0; k < list.length; k++) {
    const t = list[k].t, q = Number(t.qty) || 0;
    if (t.side === 'SELL') {
      if (q > held + 1e-9) return { date: t.date, sell: q, held: held };
      held -= q;
    } else held += q;
  }
  return null;
}

/** Chỉ báo lỗi khi thay đổi MỚI gây ra bán quá số lượng (dữ liệu cũ đã sai sẵn thì không chặn các thay đổi khác) */
function checkTxOversell_(before, after, syms, prefix) {
  const r8 = function (x) { return String(Math.round(x * 1e8) / 1e8); };
  syms.forEach(function (sym) {
    const a = oversellAt_(after, sym);
    if (a && !oversellAt_(before, sym)) {
      throw new Error((prefix || '') + 'Giao dịch bán ' + sym + ' ngày ' + a.date + ': bán ' + r8(a.sell) + ' nhưng chỉ đang nắm ' + r8(a.held) +
        '. Kiểm tra lại số lượng, hoặc nhập giao dịch mua trước (cùng ngày thì mua phải được nhập trước bán).');
    }
  });
}

function remove_(ent, keyVal) {
  const sc = SCHEMA[ent];
  return withLock_(function () {
    const sh = ss_().getSheetByName(sc.sheet);
    if (ent === 'tx') {
      // Xóa một giao dịch mua có thể làm các giao dịch bán sau đó vượt số lượng nắm giữ
      const before = readAll_('tx');
      const target = before.filter(function (r) { return String(r.id).toUpperCase() === String(keyVal).toUpperCase(); })[0];
      if (target) {
        const after = before.filter(function (r) { return r !== target; });
        checkTxOversell_(before, after, [txSym_(target)], 'Không thể xóa. ');
      }
    }
    const idx = findRow_(sh, sc, sc.key || 'id', keyVal);
    if (idx > 0) sh.deleteRow(idx);
    return true;
  });
}

/** Danh sách các tháng yyyy-MM từ a đến b (gồm cả hai đầu) */
function monthsBetween_(a, b) {
  const out = [];
  let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  const ey = Number(b.slice(0, 4)), em = Number(b.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length <= 120) {
    out.push(y + '-' + (m < 10 ? '0' + m : m));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Áp dụng cùng một mức lương cho nhiều tháng liên tiếp (tháng đã có thì ghi đè) */
function saveSalaryRange_(rec, endMonth) {
  const re = /^\d{4}-\d{2}$/;
  if (!re.test(String(rec.month))) throw new Error('Tháng bắt đầu không hợp lệ');
  if (!re.test(String(endMonth))) throw new Error('Tháng kết thúc không hợp lệ');
  if (String(endMonth) < String(rec.month)) throw new Error('Tháng kết thúc phải sau hoặc bằng tháng bắt đầu');
  const months = monthsBetween_(rec.month, endMonth);
  if (months.length > 120) throw new Error('Tối đa 120 tháng mỗi lần');
  const existing = {};
  readAll_('salary').forEach(function (r) { existing[r.month] = true; });
  let created = 0, updated = 0;
  months.forEach(function (mo) {
    const r = JSON.parse(JSON.stringify(rec));
    delete r.id;
    r.month = mo;
    if (existing[mo]) updated++; else created++;
    save_('salary', r);
  });
  return { created: created, updated: updated, total: months.length };
}

/**
 * Thêm một giai đoạn cho NHIỀU tham số cùng lúc. Nhận {from, to, note, values: {tham số: giá trị}}.
 * Chỉ tham số có giá trị KHÁC giá trị đang hiệu lực tại tháng `from` mới được lưu (mỗi tham số một dòng trong GiaiDoan);
 * ô để trống = giữ nguyên. Kiểm tra toàn bộ trước khi ghi: một giá trị sai thì không lưu dòng nào.
 */
function savePeriodBatch_(p) {
  const re = /^\d{4}-\d{2}$/;
  const from = String((p && p.from) || '').trim(), to = String((p && p.to) || '').trim();
  if (!re.test(from)) throw new Error('Tháng áp dụng không hợp lệ (yyyy-MM)');
  if (to !== '') {
    if (!re.test(to)) throw new Error('Tháng kết thúc không hợp lệ (yyyy-MM), hoặc để trống nếu không giới hạn');
    if (to < from) throw new Error('Tháng kết thúc phải sau hoặc bằng tháng bắt đầu');
  }
  const known = DEFAULT_CONFIG.map(function (d) { return d[0]; });
  const base = cfgForMonth_(from);          // giá trị đang hiệu lực tại tháng bắt đầu
  const vals = (p && p.values) || {};
  const sameVal = function (k, a, b) {
    a = String(a === null || a === undefined ? '' : a).trim();
    b = String(b === null || b === undefined ? '' : b).trim();
    if (a === b) return true;
    if (TEXT_KEYS.indexOf(k) >= 0) return false;
    return a !== '' && b !== '' && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b);
  };
  const changes = [];
  known.forEach(function (k) {
    if (vals[k] === undefined || vals[k] === null) return;
    const v = String(vals[k]).trim();
    if (v === '') return;
    checkConfigValue_(k, v);
    if (!sameVal(k, v, base[k])) changes.push({ key: k, value: v });
  });
  if (!changes.length) throw new Error('Chưa có tham số nào khác với giá trị đang áp dụng tại tháng ' + from + '. Hãy sửa ít nhất một ô.');
  // Vùng lương tối thiểu phải nằm trong danh sách regionMin sau khi áp dụng các thay đổi
  const merged = {};
  Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
  changes.forEach(function (c) { merged[c.key] = c.value; });
  const rm = {};
  String(merged.regionMin).split(',').forEach(function (x) { rm[x.split(':')[0].trim()] = true; });
  if (!rm[String(merged.region).trim()]) throw new Error('Vùng lương tối thiểu "' + merged.region + '" không có trong danh sách regionMin');
  changes.forEach(function (c) {
    save_('period', { from: from, to: to, key: c.key, value: c.value, note: String((p && p.note) || '').trim() });
  });
  return { created: changes.length, keys: changes.map(function (c) { return c.key; }) };
}

// ===================== CẤU HÌNH =====================
function getConfig_() {
  const cs = ss_().getSheetByName(CONFIG_SHEET);
  const cfg = {};
  DEFAULT_CONFIG.forEach(function (d) { cfg[d[0]] = d[1]; });
  const last = cs.getLastRow();
  if (last >= 2) {
    cs.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      if (r[0] !== '') cfg[String(r[0])] = norm_('cfg', r[1]) === '' ? cfg[String(r[0])] : String(norm_('cfg', r[1]));
    });
  }
  return cfg;
}

/** Kiểm tra biểu thuế: "giới hạn:thuế suất%" phân tách bằng dấu phẩy, giới hạn tăng dần, bậc cuối là inf */
function checkBrackets_(str) {
  const parts = String(str).split(',');
  let prev = 0;
  parts.forEach(function (part, i) {
    const x = part.split(':');
    if (x.length !== 2) throw new Error('Biểu thuế: "' + part.trim() + '" phải có dạng giới hạn:thuế suất (VD 10000000:5). Các bậc cách nhau bằng dấu phẩy');
    const lim = x[0].trim().toLowerCase(), rs = x[1].trim(), rate = Number(rs);
    if (rs === '' || isNaN(rate) || rate < 0 || rate > 100) throw new Error('Biểu thuế: thuế suất "' + rs + '" không hợp lệ (0-100)');
    const isInf = lim === 'inf' || lim === 'infinity';
    const limit = isInf ? Infinity : Number(lim);
    if (!isInf && (lim === '' || isNaN(limit) || limit <= 0)) throw new Error('Biểu thuế: giới hạn "' + x[0].trim() + '" không hợp lệ');
    if (limit <= prev) throw new Error('Biểu thuế: giới hạn các bậc phải tăng dần, và "inf" chỉ dùng cho bậc cuối');
    prev = limit;
    if (i === parts.length - 1 && !isInf) throw new Error('Biểu thuế: bậc cuối phải là "inf" (VD ...,inf:35), nếu không phần thu nhập vượt bậc cuối sẽ không bị tính thuế');
  });
}

/** Kiểm tra một giá trị tham số trước khi lưu vào CauHinh / GiaiDoan. Giá trị trống = dùng mặc định (chỉ CauHinh) */
function checkConfigValue_(key, value) {
  const v = String(value === null || value === undefined ? '' : value).trim();
  if (v === '') return;
  if (TEXT_KEYS.indexOf(key) < 0) {
    if (isNaN(Number(v)) || Number(v) < 0) {
      throw new Error('"' + key + '" phải là số không âm (đang nhập: ' + v + '). Số thập phân dùng dấu chấm (VD 1.5), không nhập ký hiệu % hay dấu phẩy ngăn cách nghìn');
    }
  } else if (key === 'taxBrackets') {
    checkBrackets_(v);
  } else if (key === 'regionMin') {
    v.split(',').forEach(function (p) {
      const x = p.split(':');
      if (x.length !== 2 || x[0].trim() === '' || isNaN(Number(x[1])) || x[1].trim() === '' || Number(x[1]) <= 0) {
        throw new Error('Lương tối thiểu vùng: "' + p.trim() + '" phải có dạng vùng:số tiền (VD 1:5310000)');
      }
    });
  } else if (key === 'sellTaxTypes') {
    v.split(',').forEach(function (t) {
      if (['STOCK', 'ETF', 'FUND', 'OTHER'].indexOf(t.trim().toUpperCase()) < 0) throw new Error('Loại tài sản chịu thuế bán "' + t.trim() + '" không hợp lệ (chỉ STOCK, ETF, FUND, OTHER)');
    });
  }
}

function saveConfig_(obj) {
  // Kiểm tra TẤT CẢ trước khi ghi: một giá trị sai thì không lưu gì cả
  const known = DEFAULT_CONFIG.map(function (d) { return d[0]; });
  Object.keys(obj).forEach(function (k) { if (known.indexOf(k) >= 0) checkConfigValue_(k, obj[k]); });
  return withLock_(function () {
    const merged = getConfig_();
    Object.keys(obj).forEach(function (k) { if (known.indexOf(k) >= 0 && String(obj[k]).trim() !== '') merged[k] = String(obj[k]).trim(); });
    const rm = {};
    String(merged.regionMin).split(',').forEach(function (p) { rm[p.split(':')[0].trim()] = true; });
    if (!rm[String(merged.region).trim()]) throw new Error('Vùng lương tối thiểu "' + merged.region + '" không có trong danh sách regionMin');
    const cs = ss_().getSheetByName(CONFIG_SHEET);
    const last = cs.getLastRow();
    const keys = last >= 2 ? cs.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    Object.keys(obj).forEach(function (k) {
      const i = keys.indexOf(k);
      if (i >= 0) cs.getRange(i + 2, 2).setNumberFormat('@').setValue(String(obj[k]));
    });
    return getConfig_();
  });
}

// ===================== HÀM TÍNH TOÁN (thuần, không phụ thuộc Google) =====================
function parseDate_(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function fmtDate_(d) { return d.toISOString().slice(0, 10); }
function addMonths_(d, n) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}
function daysBetween_(a, b) { return Math.round((b - a) / 86400000); }

/**
 * Đọc lịch trả lãi thực tế. Mỗi dòng: một ngày (dd/mm/yyyy hoặc yyyy-mm-dd), có thể kèm số tiền
 * (cho phép dấu chấm/phẩy ngăn cách và chữ "đ"). Trả về [{date:'yyyy-MM-dd', amount:number|null}] đã sắp theo ngày.
 */
function parseSchedule_(text) {
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  const rows = [];
  String(text || '').split(/\r?\n/).forEach(function (line, idx) {
    const t = line.trim();
    if (!t) return;
    const dm = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!dm) throw new Error('Lịch trả lãi, dòng ' + (idx + 1) + ': không thấy ngày (dd/mm/yyyy hoặc yyyy-mm-dd)');
    const y = Number(dm[3] || dm[4]), m = Number(dm[2] || dm[5]), d = Number(dm[1] || dm[6]);
    if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error('Lịch trả lãi, dòng ' + (idx + 1) + ': ngày không hợp lệ');
    const digits = t.replace(dm[0], '').replace(/[^\d]/g, '');
    rows.push({ date: y + '-' + pad(m) + '-' + pad(d), amount: digits ? Number(digits) : null });
  });
  rows.sort(function (a, b) { return a.date.localeCompare(b.date); });
  return rows;
}

/** Tiết kiệm: trả về lãi đã tích lũy, lãi dự kiến, ngày đáo hạn... */
function calcSaving_(s, today) {
  const P = Number(s.principal) || 0;
  const r = (Number(s.rate) || 0) / 100;
  const term = Number(s.termMonths) || 0;
  const out = { maturityDate: '', daysToMaturity: null, accrued: 0, totalInterest: 0, received: 0,
                monthlyInterest: 0, nextPayout: '', nextPayoutAmount: 0, valueNow: P, matured: false,
                schedule: null, warning: '' };
  if (s.status === 'closed') { out.valueNow = 0; return out; }
  const start = parseDate_(s.startDate), t = parseDate_(today);
  const elapsed = Math.max(0, daysBetween_(start, t));
  if (s.type === 'DEMAND') {
    // Không kỳ hạn: số dư do bạn cập nhật tay; lãi chỉ là ước tính từ lần cập nhật gần nhất, không cộng vào số dư
    out.accrued = Math.round(P * r * elapsed / 365);
    out.valueNow = P;
    return out;
  }
  // Lịch trả lãi thực tế (VD: sản phẩm trả lãi theo số ngày thực tế, ngày trả và ngày đáo hạn do ngân hàng ấn định)
  if (s.type === 'TERM_MONTHLY' && String(s.schedule || '').trim()) {
    let rows = null;
    try { rows = parseSchedule_(s.schedule); } catch (e) { out.warning = e.message; }
    if (rows && rows.length) {
      let prev = start, mism = 0;
      out.schedule = rows.map(function (row, i) {
        const dt = parseDate_(row.date);
        const calc = Math.round(P * r * daysBetween_(prev, dt) / 365);
        let interest = calc;
        if (row.amount !== null) {
          // Dòng cuối thường gồm cả gốc: số tiền >= gốc thì tách gốc ra
          interest = (i === rows.length - 1 && row.amount >= P) ? row.amount - P : row.amount;
          if (Math.abs(interest - calc) > 2) mism++;
        }
        prev = dt;
        return { date: row.date, interest: interest, paid: dt <= t };
      });
      const lastRow = out.schedule[out.schedule.length - 1];
      out.maturityDate = lastRow.date;
      out.daysToMaturity = daysBetween_(t, parseDate_(lastRow.date));
      out.matured = out.daysToMaturity <= 0;
      out.totalInterest = out.schedule.reduce(function (a, x) { return a + x.interest; }, 0);
      out.received = out.schedule.reduce(function (a, x) { return a + (x.paid ? x.interest : 0); }, 0);
      out.monthlyInterest = Math.round(out.totalInterest / out.schedule.length);
      const ni = out.schedule.findIndex(function (x) { return !x.paid; });
      if (ni >= 0) {
        const nx = out.schedule[ni];
        const pd = ni > 0 ? parseDate_(out.schedule[ni - 1].date) : start;
        const period = Math.max(1, daysBetween_(pd, parseDate_(nx.date)));
        out.nextPayout = nx.date;
        out.nextPayoutAmount = nx.interest;
        out.accrued = Math.round(nx.interest * Math.min(1, Math.max(0, daysBetween_(pd, t)) / period));
      }
      out.valueNow = P + out.accrued;
      if (mism) out.warning = 'Có ' + mism + ' dòng lịch lãi không khớp công thức gốc × lãi suất × số ngày / 365. Kiểm tra lại số tiền gốc và lãi suất.';
      return out;
    }
  }
  const mat = addMonths_(start, term);
  const termDays = Math.max(1, daysBetween_(start, mat));
  out.maturityDate = fmtDate_(mat);
  out.daysToMaturity = daysBetween_(t, mat);
  out.matured = out.daysToMaturity <= 0;
  if (s.type === 'TERM_END') {
    out.totalInterest = Math.round(P * r * term / 12);
    out.accrued = Math.round(out.totalInterest * Math.min(1, elapsed / termDays));
    out.valueNow = P + out.accrued;
  } else { // TERM_MONTHLY
    const mi = Math.round(P * r / 12);
    let k = 0;
    while (k < term && addMonths_(start, k + 1) <= t) k++;
    out.monthlyInterest = mi;
    out.received = mi * k;
    out.totalInterest = mi * term;
    if (k < term) {
      const prev = addMonths_(start, k), next = addMonths_(start, k + 1);
      out.nextPayout = fmtDate_(next);
      out.nextPayoutAmount = mi;
      out.accrued = Math.round(mi * daysBetween_(prev, t) / Math.max(1, daysBetween_(prev, next)));
    }
    out.valueNow = P + out.accrued;
  }
  return out;
}

/** Danh mục đầu tư: giá vốn bình quân gia quyền, lãi/lỗ đã chốt và chưa chốt */
function calcPortfolio_(txs, prices, cfg) {
  const sorted = txs.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  const sellTax = (Number(cfg.sellTaxRate) || 0) / 100;
  const taxed = String(cfg.sellTaxTypes || '').split(',').map(function (x) { return x.trim().toUpperCase(); });
  const pos = {};
  sorted.forEach(function (t) {
    const sym = String(t.symbol || '').toUpperCase().trim();
    if (!sym) return;
    const p = pos[sym] || (pos[sym] = { symbol: sym, assetType: t.assetType || 'STOCK', qty: 0, cost: 0, costN: 0, realized: 0, lastPrice: 0, lastPriceN: 0, lastRate: 1, curs: {}, fees: 0 });
    // Giao dịch bằng ngoại tệ: quy đổi giá và phí sang VND theo tỷ giá nhập tại thời điểm giao dịch
    const cur = String(t.currency || '').toUpperCase().trim();
    const rate = (cur && cur !== 'VND') ? (Number(t.fxRate) || 1) : 1;
    const q = Number(t.qty) || 0, pr = (Number(t.price) || 0) * rate, fee = (Number(t.fee) || 0) * rate;
    p.assetType = t.assetType || p.assetType;
    p.lastPrice = pr;
    const curKey = cur || 'VND';
    p.curs[curKey] = true; p.cur = curKey; p.lastRate = rate; p.lastPriceN = Number(t.price) || 0;
    const prN = Number(t.price) || 0, feeN = Number(t.fee) || 0;
    if (t.side === 'SELL') {
      const sq = Math.min(q, p.qty);
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const tax = taxed.indexOf(String(p.assetType).toUpperCase()) >= 0 ? sq * pr * sellTax : 0;
      p.realized += sq * pr - fee - tax - avg * sq;
      p.fees += fee + tax;
      const avgN = p.qty > 0 ? p.costN / p.qty : 0;
      p.costN -= avgN * sq;
      p.cost -= avg * sq;
      p.qty -= sq;
    } else {
      p.qty += q; p.cost += q * pr + fee; p.costN += q * prN + feeN; p.fees += fee;
    }
  });
  const pmap = {}, amap = {}, umap = {}, fmap = {}, nmap = {};
  (prices || []).forEach(function (x) {
    const k = String(x.symbol).toUpperCase();
    if (x.price === '' || x.price === null || x.price === undefined || isNaN(Number(x.price))) return;   // chưa có giá: dùng giá giao dịch gần nhất
    pmap[k] = Number(x.price);
    amap[k] = String(x.auto || '').trim() !== '';
    umap[k] = String(x.updated || '');
    fmap[k] = String(x.fx || '').toUpperCase().trim();
    nmap[k] = Number(x.fxNow) > 0 ? Number(x.fxNow) : 0;
  });
  const positions = [];
  let tCost = 0, tValue = 0, tRealized = 0, exValue = 0, exCost = 0;
  const exSet = {};
  String(cfg.excludeSymbols || '').split(',').forEach(function (x) { x = x.trim().toUpperCase(); if (x) exSet[x] = true; });
  Object.keys(pos).forEach(function (sym) {
    const p = pos[sym];
    const isEx = !!exSet[sym];   // mã loại trừ (VD RSU): vẫn hiện trong danh mục nhưng không cộng vào các tổng
    if (!isEx) tRealized += p.realized;
    if (p.qty > 1e-9) {
      const hasPrice = pmap[sym] !== undefined && !isNaN(pmap[sym]);
      const price = hasPrice ? pmap[sym] : p.lastPrice;
      const value = p.qty * price;
      positions.push({
        symbol: sym, assetType: p.assetType, qty: p.qty, avgCost: p.cost / p.qty, cost: p.cost,
        price: price, priceSource: hasPrice ? (amap[sym] ? 'auto' : 'manual') : 'lastTrade', priceUpdated: hasPrice ? umap[sym] : '', value: value,
        unrealized: value - p.cost, unrealizedPct: p.cost > 0 ? (value - p.cost) / p.cost * 100 : 0,
        realized: p.realized
      });
      // Hiển thị theo tiền tệ gốc (USD...) nếu cổ phiếu được giao dịch/định giá bằng ngoại tệ
      const pc = positions[positions.length - 1];
      pc.excluded = isEx;
      const curOut = (fmap[sym] && fmap[sym] !== 'VND') ? fmap[sym] : (p.cur && p.cur !== 'VND' ? p.cur : '');
      if (curOut) {
        // Tỷ giá dự phòng (lần giao dịch gần nhất) chỉ dùng được khi giao dịch đó cùng loại tiền với tiền hiển thị
        const rate = (hasPrice && nmap[sym] > 0) ? nmap[sym] : (p.cur === curOut && p.lastRate > 1 ? p.lastRate : 0);
        const sameCur = Object.keys(p.curs).length === 1 && p.curs[curOut];
        pc.mixedCurrency = !sameCur;
        pc.currency = curOut;
        if (rate > 0) {
          pc.fxRate = rate;
          pc.fxSource = (hasPrice && nmap[sym] > 0) ? 'auto' : 'trade';
          pc.fxUpdated = (hasPrice && nmap[sym] > 0) ? umap[sym] : '';
          pc.priceN = hasPrice ? price / rate : (p.cur === curOut ? p.lastPriceN : price / rate);
          pc.valueN = p.qty * pc.priceN;
          if (sameCur) { pc.avgCostN = p.costN / p.qty; pc.costN = p.costN; pc.unrealizedN = pc.valueN - p.costN; }
        }
      }
      if (isEx) { exCost += p.cost; exValue += value; } else { tCost += p.cost; tValue += value; }
    }
  });
  positions.sort(function (a, b) { return b.value - a.value; });
  return { positions: positions,
           totals: { cost: tCost, value: tValue, unrealized: tValue - tCost, realized: tRealized,
                     unrealizedPct: tCost > 0 ? (tValue - tCost) / tCost * 100 : 0,
                     excludedValue: exValue, excludedCost: exCost } };
}

function parseBrackets_(s) {
  return String(s).split(',').map(function (part) {
    const x = part.split(':');
    const lim = x[0].trim().toLowerCase();
    return { limit: (lim === 'inf' || lim === 'infinity') ? Infinity : Number(lim), rate: Number(x[1]) / 100 };
  });
}

function progressiveTax_(taxable, brackets) {
  let prev = 0, tax = 0;
  const detail = [];
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (taxable <= prev) break;
    const upper = Math.min(taxable, b.limit);
    const part = upper - prev;
    const t = part * b.rate;
    // Bậc cuối có giới hạn Infinity: không gửi được về trình duyệt qua google.script.run, nên đổi thành null
    detail.push({ level: i + 1, from: prev, to: isFinite(b.limit) ? b.limit : null, rate: b.rate, income: part, tax: Math.round(t) });
    tax += t;
    prev = b.limit;
  }
  return { tax: Math.round(tax), detail: detail };
}

function regionMin_(cfg) {
  const m = {};
  String(cfg.regionMin).split(',').forEach(function (p) { const x = p.split(':'); m[x[0].trim()] = Number(x[1]); });
  return m[String(cfg.region).trim()] || 0;
}

/**
 * Tham số có hiệu lực tại tháng `month`: cấu hình gốc, chồng thêm các giai đoạn có from <= month <= to
 * (to trống = không giới hạn; giai đoạn bắt đầu sau thắng). Không truyền month = tính tại thời điểm hiện tại, nên giai đoạn đã có "to" không áp dụng.
 */
function cfgFor_(cfg, periods, month) {
  const m = month || '9999-12';
  const out = {};
  Object.keys(cfg).forEach(function (k) { out[k] = cfg[k]; });
  (periods || [])
    .filter(function (p) { return p.key && String(p.from) <= m && (!String(p.to || '').trim() || m <= String(p.to)); })
    .sort(function (a, b) { return String(a.from).localeCompare(String(b.from)); })
    .forEach(function (p) { out[String(p.key)] = String(p.value); });
  return out;
}
function cfgForMonth_(month) { return cfgFor_(getConfig_(), readAll_('period'), month); }

/** Lương: gross -> bảo hiểm -> thuế TNCN -> net */
function calcSalary_(inp, cfg) {
  const n = function (v) { return Number(v) || 0; };
  const base = n(inp.base), allow = n(inp.allowance), bonus = n(inp.bonus), exempt = n(inp.exempt);
  const dep = Math.max(0, Math.floor(n(inp.dependents)));
  const other = n(inp.otherDeduction);
  const insBase = n(inp.insBase) > 0 ? n(inp.insBase) : base;
  const month = inp.month || '';
  const capS = n(cfg.capSocial);
  const capU = n(cfg.unempCapMultiplier) * regionMin_(cfg);
  const sBase = Math.min(insBase, capS), uBase = Math.min(insBase, capU || capS);
  const bhxh = Math.round(sBase * n(cfg.bhxhRate) / 100);
  const bhyt = Math.round(sBase * n(cfg.bhytRate) / 100);
  const bhtn = Math.round(uBase * n(cfg.bhtnRate) / 100);
  const insurance = bhxh + bhyt + bhtn;
  const gross = base + allow + bonus + exempt;
  const taxableIncome = gross - exempt;
  const personal = n(cfg.personalDeduction);
  const depDed = dep * n(cfg.dependentDeduction);
  const taxBase = Math.max(0, taxableIncome - insurance - personal - depDed - other);
  const pt = progressiveTax_(taxBase, parseBrackets_(cfg.taxBrackets));
  const net = gross - insurance - pt.tax;
  return { gross: gross, exempt: exempt, insBase: insBase, bhxh: bhxh, bhyt: bhyt, bhtn: bhtn, insurance: insurance,
           personal: personal, depDed: depDed, other: other, taxableIncome: taxableIncome, taxBase: taxBase,
           tax: pt.tax, detail: pt.detail, net: net,
           effectiveRate: gross > 0 ? pt.tax / gross * 100 : 0 };
}

/** Từ net mong muốn -> gross (giả định toàn bộ gross là lương đóng bảo hiểm) */
function grossFromNet_(inp, cfg) {
  const target = Number(inp.net) || 0;
  const mk = function (g) {
    return calcSalary_({ base: g, dependents: inp.dependents, otherDeduction: inp.otherDeduction, month: inp.month }, cfg);
  };
  let lo = target, hi = target * 3 + 10000000;
  for (let i = 0; i < 80 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (mk(mid).net >= target) hi = mid; else lo = mid;
  }
  const g = Math.ceil(hi);
  return { gross: g, calc: mk(g) };
}

// ===================== TỔNG HỢP =====================
function bootstrap_() {
  const cfg = getConfig_();
  const today = today_();
  const savings = readAll_('savings').map(function (s) { s.calc = calcSaving_(s, today); return s; });
  const tx = readAll_('tx').sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  const prices = readAll_('price');
  const portfolio = calcPortfolio_(tx, prices, cfg);
  const periods = readAll_('period').sort(function (a, b) { return String(a.from).localeCompare(String(b.from)); });
  const salary = readAll_('salary').sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); })
    .map(function (s) { s.calc = calcSalary_(s, cfgFor_(cfg, periods, s.month)); return s; });
  return { today: today, aiReady: aiReady_(), config: cfg, periods: periods,
           configInfo: DEFAULT_CONFIG.map(function (d) { return { key: d[0], desc: d[2] }; }),
           savings: savings, tx: tx, prices: prices, portfolio: portfolio, salary: salary,
           expenses: readAll_('expense'), spends: readAll_('spend'),
           dashboard: buildDashboard_(savings, portfolio, salary, today, cfg) };
}

/**
 * Kỳ nhận lãi tiết kiệm có kỳ hạn gần nhất (cả lãi hàng tháng lẫn lãi cuối kỳ).
 * Số tiền lãi đã nhân (1 - thuế%) với thuế mặc định 5%. Gốc (nếu hoàn trả đúng ngày đó) tách riêng, không bị trừ thuế.
 */
function nextSavingsPayout_(active, today, cfg) {
  const tr = Number(cfg && cfg.savingsTaxRate);
  const taxRate = isNaN(tr) ? 5 : tr;
  const keep = 1 - taxRate / 100;
  const events = [];
  active.forEach(function (s) {
    const c = s.calc, P = Number(s.principal) || 0;
    let date = '', interest = 0;
    if (s.type === 'TERM_MONTHLY' && c.nextPayout) {
      date = c.nextPayout; interest = Number(c.nextPayoutAmount) || 0;
    } else if (s.type === 'TERM_END' && c.maturityDate && c.daysToMaturity !== null && c.daysToMaturity >= 0) {
      date = c.maturityDate; interest = Number(c.totalInterest) || 0;
    }
    if (!date) return;
    events.push({ name: s.name, type: s.type, date: date, gross: interest, net: Math.round(interest * keep),
                  principal: date === c.maturityDate ? P : 0 });
  });
  if (!events.length) return null;
  events.sort(function (a, b) { return a.date.localeCompare(b.date); });
  const t = parseDate_(today);
  const byDate = {}, order = [];
  events.forEach(function (e) {
    if (!byDate[e.date]) { byDate[e.date] = { date: e.date, days: daysBetween_(t, parseDate_(e.date)), gross: 0, net: 0, principal: 0, items: [] }; order.push(e.date); }
    const g = byDate[e.date];
    g.gross += e.gross; g.net += e.net; g.principal += e.principal; g.items.push(e);
  });
  const first = byDate[order[0]];
  first.taxRate = taxRate;
  first.following = order.slice(1, 4).map(function (d) { return { date: d, days: byDate[d].days, net: byDate[d].net }; });
  return first;
}

function buildDashboard_(savings, portfolio, salary, today, cfg) {
  const active = savings.filter(function (s) { return s.status !== 'closed'; });
  const sPrincipal = active.reduce(function (a, s) { return a + Number(s.principal); }, 0);
  const sValue = active.reduce(function (a, s) { return a + s.calc.valueNow; }, 0);
  const monthlyIncome = active.filter(function (s) { return s.type === 'TERM_MONTHLY' && !s.calc.matured; })
    .reduce(function (a, s) { return a + s.calc.monthlyInterest; }, 0);
  const byType = { DEMAND: 0, TERM_END: 0, TERM_MONTHLY: 0 };
  active.forEach(function (s) { byType[s.type] = (byType[s.type] || 0) + s.calc.valueNow; });
  const termList = active.filter(function (s) { return s.type !== 'DEMAND'; });
  const demandList = active.filter(function (s) { return s.type === 'DEMAND'; });
  const termPrincipal = termList.reduce(function (a, s) { return a + Number(s.principal); }, 0);
  const termValue = termList.reduce(function (a, s) { return a + s.calc.valueNow; }, 0);
  const demandBalance = demandList.reduce(function (a, s) { return a + (Number(s.principal) || 0); }, 0);
  const demandAccounts = demandList.map(function (s) { return { name: s.name, balance: Number(s.principal) || 0, updated: s.startDate }; });
  const upcoming = active.filter(function (s) { return s.type !== 'DEMAND' && s.calc.daysToMaturity !== null && s.calc.daysToMaturity <= 60; })
    .sort(function (a, b) { return a.calc.daysToMaturity - b.calc.daysToMaturity; })
    .map(function (s) { return { name: s.name, maturityDate: s.calc.maturityDate, days: s.calc.daysToMaturity, amount: Number(s.principal) + (s.type === 'TERM_END' ? s.calc.totalInterest : 0) }; });
  // Chỉ tính các tháng đã tới (<= tháng hiện tại); các tháng nhập trước cho tương lai tách riêng thành "dự kiến cả năm"
  const tm = today.slice(0, 7), year = today.slice(0, 4);
  const inYear = function (s) { return String(s.month).slice(0, 4) === year; };
  const sum = function (list) {
    return list.reduce(function (a, s) { a.gross += s.calc.gross; a.net += s.calc.net; a.tax += s.calc.tax; a.ins += s.calc.insurance; return a; },
                       { gross: 0, net: 0, tax: 0, ins: 0 });
  };
  const past = salary.filter(function (s) { return String(s.month) <= tm; });   // salary đã sắp giảm dần theo tháng
  const ytd = sum(past.filter(inYear));
  const yearAll = salary.filter(inYear);
  const plan = sum(yearAll);
  plan.future = yearAll.length - past.filter(inYear).length;
  const series = past.slice(0, 12).reverse().map(function (s) { return { month: s.month, net: s.calc.net, tax: s.calc.tax, ins: s.calc.insurance }; });
  return { savingsPrincipal: sPrincipal, savingsValue: sValue, termPrincipal: termPrincipal, termValue: termValue,
           demandBalance: demandBalance, demandAccounts: demandAccounts, monthlyInterestIncome: monthlyIncome, savingsByType: byType,
           investValue: portfolio.totals.value, investCost: portfolio.totals.cost, investUnrealized: portfolio.totals.unrealized,
           investRealized: portfolio.totals.realized, totalAssets: sValue + portfolio.totals.value, upcoming: upcoming, nextSavingsPayout: nextSavingsPayout_(active, today, cfg),
           latestSalary: past.length ? { month: past[0].month, net: past[0].calc.net, gross: past[0].calc.gross, tax: past[0].calc.tax } : null,
           ytd: ytd, yearPlan: plan, salarySeries: series };
}


// ===================== PHÂN TÍCH SỨC KHỎE TÀI CHÍNH BẰNG AI =====================
// Khóa API và tên model nằm trong Thuộc tính tập lệnh (Script Properties), KHÔNG nằm trong code hay trình duyệt:
//   AI_PROVIDER    = gemini (mặc định) hoặc anthropic
//   GEMINI_API_KEY / ANTHROPIC_API_KEY = khóa tương ứng
//   AI_MODEL       = (tùy chọn) tên model, để trống thì dùng mặc định bên dưới
const AI_DEFAULT_MODEL = { gemini: 'gemini-3.5-flash-lite', anthropic: 'claude-haiku-5-5' };

const AI_SYSTEM = [
  'Bạn là chuyên gia phân tích tài chính cá nhân, trả lời bằng tiếng Việt, giọng thân thiện và thẳng thắn.',
  'Bạn được cung cấp số liệu TỔNG HỢP từ một ứng dụng quản lý tài chính cá nhân (VND). Chỉ dùng số liệu được cung cấp, tuyệt đối không bịa thêm số.',
  'Chi tiêu hằng tháng gồm ngân sách do người dùng đặt và số thực chi do người dùng tự nhập (nếu có trong số liệu), không phải dữ liệu ngân hàng. Ứng dụng KHÔNG có dữ liệu về nợ, bảo hiểm nhân thọ, tài sản khác (nhà, xe...). Nếu cần những thứ đó để kết luận thì nói rõ là chưa đủ dữ liệu, đừng đoán.',
  'Trình bày bằng Markdown đơn giản với đúng 4 phần (tiêu đề ##): "Đánh giá chung" (1 câu kết luận: Tốt / Ổn / Cần chú ý, kèm 2-3 câu lý do), "Điểm mạnh", "Rủi ro và điều cần lưu ý", "Gợi ý hành động" (3-5 gạch đầu dòng, cụ thể, có con số khi có thể).',
  'Các góc nhìn nên cân nhắc nếu có dữ liệu: mức tiền khả dụng so với thu nhập, mức độ tập trung (một sổ tiết kiệm hay một mã đầu tư chiếm tỷ trọng lớn), tỷ trọng đầu tư rủi ro, lãi suất bình quân, các khoản sắp đáo hạn cần quyết định tái tục, độ ổn định thu nhập.',
  'Không khuyên mua hoặc bán một mã cụ thể. Không cần lời chào hay lời rào đón dài. Tối đa khoảng 350 từ.'
].join('\n');

function aiConfig_() {
  const p = PropertiesService.getScriptProperties();
  const provider = String(p.getProperty('AI_PROVIDER') || 'gemini').trim().toLowerCase();
  if (provider !== 'gemini' && provider !== 'anthropic') throw new Error('AI_PROVIDER phải là "gemini" hoặc "anthropic" (đang là "' + provider + '")');
  const key = String(p.getProperty(provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY') || '').trim();
  const model = String(p.getProperty('AI_MODEL') || AI_DEFAULT_MODEL[provider]).trim();
  return { provider: provider, key: key, model: model };
}

function aiReady_() {
  try { return !!aiConfig_().key; } catch (e) { return false; }
}

/** Số liệu tổng hợp gửi cho AI: KHÔNG có tên sổ, mã cổ phiếu, ghi chú */
function aiSummary_() {
  const b = bootstrap_(), d = b.dashboard;
  const round = function (x) { return Math.round(Number(x) || 0); };
  const pctOf = function (v, t) { return t > 0 ? Math.round(v / t * 1000) / 10 : 0; };
  const total = d.totalAssets || 0;
  const active = b.savings.filter(function (s) { return s.status !== 'closed'; });
  const term = active.filter(function (s) { return s.type !== 'DEMAND'; });
  const termP = term.reduce(function (a, s) { return a + (Number(s.principal) || 0); }, 0);
  const wRate = termP > 0 ? term.reduce(function (a, s) { return a + (Number(s.principal) || 0) * (Number(s.rate) || 0); }, 0) / termP : 0;
  const maxTerm = term.reduce(function (m, s) { return Math.max(m, Number(s.principal) || 0); }, 0);
  const maturing = term.filter(function (s) { return s.calc.daysToMaturity !== null && s.calc.daysToMaturity <= 90; })
    .sort(function (x, y) { return x.calc.daysToMaturity - y.calc.daysToMaturity; }).slice(0, 8)
    .map(function (s) { return { con_ngay: s.calc.daysToMaturity, so_tien: round(Number(s.principal) + (s.type === 'TERM_END' ? s.calc.totalInterest : 0)) }; });
  const pos = b.portfolio.positions.filter(function (p) { return !p.excluded; }), invTotal = b.portfolio.totals.value || 0;
  const maxPos = pos.reduce(function (m, p) { return Math.max(m, p.value); }, 0);
  const series = (d.salarySeries || []).slice(-6);
  const avgNet = series.length ? series.reduce(function (a, s) { return a + s.net; }, 0) / series.length : 0;
  const ls = d.latestSalary;
  const spend = (b.expenses || []).filter(function (x) { return x.status !== 'paused'; })
    .reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0);
  // Chi tiêu: ngân sách tháng này so với thực chi, và tổng thực chi các tháng gần đây
  const curM = b.today.slice(0, 7), lowN = function (x) { return String(x || '').trim().toLowerCase(); };
  const budgetOf = function (m) {
    const out = {}, order = [];
    (b.expenses || []).filter(function (x) { return x.status !== 'paused' && (!x.from || String(x.from) <= m) && (!x.to || m <= String(x.to)); })
      .sort(function (a, c) { return String(a.from || '').localeCompare(String(c.from || '')); })
      .forEach(function (x) { const k = lowN(x.name); if (!(k in out)) order.push(k); out[k] = { name: String(x.name).trim(), amount: Number(x.amount) || 0 }; });
    return { out: out, order: order };
  };
  const spendIn = function (m) { return (b.spends || []).filter(function (r) { return r.month === m; }); };
  const bm = budgetOf(curM), spCur = spendIn(curM);
  const byKhoan = bm.order.map(function (k) {
    const r = spCur.filter(function (x) { return lowN(x.name) === k; })[0];
    return { khoan: bm.out[k].name, ngan_sach: round(bm.out[k].amount), thuc_chi: r ? round(r.amount) : null };
  });
  const recent = [1, 2, 3].map(function (i) {
    const d0 = new Date(Date.UTC(Number(curM.slice(0, 4)), Number(curM.slice(5, 7)) - 1 - i, 1));
    const m = d0.getUTCFullYear() + '-' + ('0' + (d0.getUTCMonth() + 1)).slice(-2), rows = spendIn(m);
    if (!rows.length) return null;
    return { thang: m, tong_thuc_chi: round(rows.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0)),
             theo_khoan: rows.map(function (r) { return { khoan: String(r.name), so_tien: round(r.amount) }; }) };
  }).filter(function (x) { return x; });
  const chiTieu = (byKhoan.length || recent.length) ? {
    thang_nay: { thang: curM, tong_ngan_sach: round(byKhoan.reduce(function (a, x) { return a + x.ngan_sach; }, 0)),
                 tong_thuc_chi_da_nhap: round(spCur.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0)), theo_khoan: byKhoan },
    cac_thang_truoc: recent } : null;
  return {
    ngay: b.today,
    tong_tai_san: round(total),
    ty_trong_phan_bo_pct: { tien_khong_ky_han: pctOf(d.demandBalance, total), tiet_kiem_co_ky_han: pctOf(d.termValue, total), dau_tu: pctOf(d.investValue, total) },
    tien_khong_ky_han: { so_du: round(d.demandBalance), so_tai_khoan: (d.demandAccounts || []).length,
                         du_cho_bao_nhieu_thang_luong_net: avgNet > 0 ? Math.round(d.demandBalance / avgNet * 10) / 10 : null },
    tiet_kiem_co_ky_han: { gia_tri_hien_tai: round(d.termValue), tong_goc: round(d.termPrincipal), so_so: term.length,
                           lai_suat_binh_quan_theo_goc_pct: Math.round(wRate * 100) / 100,
                           so_lon_nhat_pct_tong_tai_san: pctOf(maxTerm, total),
                           lai_nhan_trung_binh_moi_thang: round(d.monthlyInterestIncome),
                           sap_den_han_trong_90_ngay: maturing },
    dau_tu: { gia_tri: round(d.investValue), von: round(d.investCost),
              lai_lo_chua_chot_pct: d.investCost > 0 ? Math.round(d.investUnrealized / d.investCost * 1000) / 10 : 0,
              lai_lo_da_chot: round(d.investRealized), so_ma_dang_giu: pos.length,
              ma_lon_nhat_pct_danh_muc: pctOf(maxPos, invTotal) },
    chi_tieu: chiTieu,
    chi_tieu_hang_thang_uoc_tinh: spend > 0 ? { tong: round(spend),
      tien_khong_ky_han_du_cho_bao_nhieu_thang_chi_tieu: Math.round(d.demandBalance / spend * 10) / 10 } : null,
    luong: ls ? { thang_gan_nhat: ls.month, net_gan_nhat: round(ls.net), gross_gan_nhat: round(ls.gross), thue_gan_nhat: round(ls.tax),
                  net_trung_binh_6_thang: round(avgNet), luy_ke_nam_net: round(d.ytd.net), luy_ke_nam_thue: round(d.ytd.tax) } : null,
    khong_co_trong_du_lieu: ['no / khoan vay', 'bao hiem nhan tho', 'tai san khac (nha, xe...)']
  };
}

function aiCall_(cfg, system, user) {
  // user: một chuỗi (1 lượt) hoặc mảng [{role:'user'|'assistant', text}] (hội thoại)
  const msgs = typeof user === 'string' ? [{ role: 'user', text: user }] : user;
  let url, headers, payload;
  if (cfg.provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(cfg.model) + ':generateContent';
    headers = { 'x-goog-api-key': cfg.key };
    payload = { systemInstruction: { parts: [{ text: system }] }, contents: msgs.map(function (m) { return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }; }),
                generationConfig: { maxOutputTokens: 4000 } };   // không đặt temperature: các model Gemini 3.x từ chối tham số này
  } else {
    url = 'https://api.anthropic.com/v1/messages';
    headers = { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' };
    payload = { model: cfg.model, max_tokens: 1500, system: system, messages: msgs.map(function (m) { return { role: m.role, content: m.text }; }) };
  }
  const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(payload), muteHttpExceptions: true });
  const code = res.getResponseCode(), body = res.getContentText();
  let j = null;
  try { j = JSON.parse(body); } catch (e) { /* không phải JSON */ }
  if (code < 200 || code >= 300) {
    const em = j && j.error ? (j.error.message || JSON.stringify(j.error)) : body;
    const hint = (code === 400 || code === 404) ? ' Kiểm tra lại khóa API và tên model (thuộc tính AI_MODEL).' : (code === 401 || code === 403) ? ' Khóa API không đúng hoặc chưa được cấp quyền.' : (code === 429 ? ' Đã vượt giới hạn gọi, thử lại sau.' : '');
    throw new Error('AI (' + cfg.provider + ') báo lỗi ' + code + ': ' + String(em).slice(0, 300) + '.' + hint);
  }
  let text = '', cut = false;
  if (cfg.provider === 'gemini') {
    const c = j && j.candidates && j.candidates[0];
    if (!c || !c.content || !c.content.parts) throw new Error('AI không trả về nội dung' + (j && j.promptFeedback && j.promptFeedback.blockReason ? ' (bị chặn: ' + j.promptFeedback.blockReason + ')' : ''));
    text = c.content.parts.filter(function (x) { return x.text && !x.thought; }).map(function (x) { return x.text; }).join('');
    cut = c.finishReason === 'MAX_TOKENS';
  } else {
    text = ((j && j.content) || []).filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join('');
    cut = j && j.stop_reason === 'max_tokens';
  }
  text = text.trim();
  if (!text) throw new Error('AI trả về nội dung trống, hãy thử lại');
  return cut ? text + '\n\n(Câu trả lời bị cắt do giới hạn độ dài.)' : text;
}

function aiAnalyze_() {
  const cfg = aiConfig_();
  if (!cfg.key) throw new Error('Chưa cấu hình khóa API. Xem mục "Phân tích bằng AI" trong README (Cài đặt dự án → Thuộc tính tập lệnh).');
  // Chống bấm liên tục: mỗi lần gọi tốn tiền / hạn mức
  const cache = CacheService.getUserCache();
  if (cache.get('AI_BUSY')) throw new Error('Vừa gọi AI xong, hãy đợi khoảng 20 giây rồi thử lại');
  cache.put('AI_BUSY', '1', 20);
  try {
    const summary = aiSummary_();
    const user = 'Số liệu tài chính tổng hợp (JSON, đơn vị VND):\n' + JSON.stringify(summary, null, 1) + '\n\nHãy phân tích sức khỏe tài chính hiện tại theo đúng yêu cầu.';
    const text = aiCall_(cfg, AI_SYSTEM, user);
    return { text: text, summary: summary, provider: cfg.provider, model: cfg.model };
  } catch (e) {
    cache.remove('AI_BUSY');
    throw e;
  }
}


// ===================== CHAT VỚI AI =====================
const AI_CHAT_SYSTEM = [
  'Bạn là trợ lý tài chính cá nhân trong một ứng dụng quản lý tài chính (đơn vị VND), trả lời bằng tiếng Việt, ngắn gọn, thân thiện, thẳng thắn.',
  'Dưới đây là SỐ LIỆU TỔNG HỢP mới nhất của người dùng (JSON). Chỉ dùng số liệu này để trả lời về tình hình của họ; không bịa số. Nếu câu hỏi cần dữ liệu không có (nợ, bảo hiểm, tài sản khác, tên sổ, mã cổ phiếu cụ thể...) thì nói rõ là ứng dụng không có, và hỏi lại hoặc trả lời ở mức nguyên tắc chung.',
  'Có thể tính toán, so sánh, giải thích các khái niệm (lãi suất, thuế thu nhập cá nhân, quỹ dự phòng...). Khi trả lời có con số, nêu cách tính ngắn gọn.',
  'Không khuyên mua hoặc bán một mã cụ thể; với quyết định lớn, nhắc đây chỉ là tham khảo, không thay thế tư vấn chuyên nghiệp.',
  'Mặc định trả lời dưới 150 từ, dùng gạch đầu dòng khi liệt kê, có thể dùng **in đậm** cho ý chính. Không chào hỏi dài dòng.'
].join('\n');

/** p.messages: [{role:'user'|'assistant', text}] - lịch sử hội thoại do trình duyệt giữ, tối đa 12 lượt gần nhất */
function aiChat_(p) {
  const cfg = aiConfig_();
  if (!cfg.key) throw new Error('Chưa cấu hình khóa API. Xem mục "Phân tích bằng AI" trong README (Cài đặt dự án → Thuộc tính tập lệnh).');
  let msgs = (p && p.messages ? p.messages : []).slice(-12).map(function (m) {
    return { role: m && m.role === 'assistant' ? 'assistant' : 'user', text: String(m && m.text || '').trim().slice(0, 2000) };
  }).filter(function (m) { return m.text; });
  // Hội thoại phải bắt đầu bằng lượt của người dùng, xen kẽ và kết thúc bằng câu hỏi
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const merged = [];
  msgs.forEach(function (m) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.text += '\n' + m.text; else merged.push({ role: m.role, text: m.text });
  });
  if (!merged.length || merged[merged.length - 1].role !== 'user') throw new Error('Hãy nhập câu hỏi');
  // Chống bấm gửi liên tiếp
  const cache = CacheService.getUserCache();
  if (cache.get('AI_CHAT_BUSY')) throw new Error('AI đang xử lý câu trước, đợi vài giây rồi gửi lại');
  cache.put('AI_CHAT_BUSY', '1', 4);
  try {
    const summary = aiSummary_();
    const system = AI_CHAT_SYSTEM + '\n\nSố liệu tổng hợp (JSON):\n' + JSON.stringify(summary);
    const text = aiCall_(cfg, system, merged);
    return { text: text, provider: cfg.provider, model: cfg.model };
  } finally {
    cache.remove('AI_CHAT_BUSY');
  }
}
