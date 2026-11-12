/* Logic tính toán thu chi cho tài xế Grab — không phụ thuộc giao diện (chạy được cả trên Node để test). */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    baseOdo: 0,         // odo ban đầu (km) — nhập trong Cài đặt hoặc ở lần bắt đầu ca đầu tiên
    fuelPrice: 22000,   // đ/lít
    fuelPriceDate: null, // ngày cập nhật giá xăng gần nhất (YYYY-MM-DD)
    fuelL100: 2.2,      // lít / 100 km (mặc định cho tới khi học được từ các lần đổ xăng)
    wearPerKm: 240,     // đ/km hao mòn (nhớt, lốp, phanh, sên nhông...)
    oilInterval: 2000,  // km giữa hai lần thay nhớt
  };

  const CATS = {
    ride: ['Rửa xe', 'Gửi xe', 'Nước / ăn trong ca', 'Vá xe / lặt vặt'],
    personal: ['Ăn uống', 'Cà phê', 'Gia đình', 'Nhà cửa', 'Khác'],
    saving: ['Tiết kiệm', 'Quỹ dự phòng'],
  };
  const TYPE_LABEL = { ride: 'Chạy xe', personal: 'Cá nhân', saving: 'Để dành' };
  const MAINT_ITEMS = ['Nhớt', 'Lốp', 'Má phanh', 'Sên nhông dĩa', 'Bugi / lọc gió', 'Nước mát', 'Khác'];

  function emptyState() {
    return {
      v: 1,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      active: null,      // { start: ISO, odoStart: number }
      shifts: [],        // { id,start,end,odoStart,odoEnd,net,bonus,trips,fuelRate,wearRate }
      fills: [],         // { id,date,amount,odo,liters,full }
      expenses: [],      // { id,date,amount,type,category,note }
      maint: [],         // { id,date,odo,item,cost,note }
      odoLog: [],        // { id,date,odo }
      capital: null,     // { date: 'YYYY-MM-DD', total, fund } — vốn ban đầu (không tính là thu nhập)
      checks: [],        // { id,at,wallets,total,expected,diff } — các lần kiểm kê tiền thật
      adjusts: [],       // { id,date,amount,note } — điều chỉnh sau kiểm kê
      fundPuts: [],      // { id,date,amount } — các lần tách tiền ra để riêng cho quỹ bảo trì
      priceLog: [],      // { id,date,price } — các lần cập nhật giá xăng thủ công (giá/lít)
      lastBackup: null,
    };
  }

  function migrate(o) {
    const s = Object.assign(emptyState(), o || {});
    s.settings = Object.assign({}, DEFAULT_SETTINGS, (o && o.settings) || {});
    ['shifts', 'fills', 'expenses', 'maint', 'odoLog', 'checks', 'adjusts', 'fundPuts', 'priceLog'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    // Dữ liệu cũ: giá xăng đã xác nhận trước đây trở thành mốc đầu tiên của nhật ký giá
    if (!s.priceLog.length && s.settings.fuelPriceDate && s.settings.fuelPrice > 0) {
      s.priceLog.push({ id: 'seed', date: s.settings.fuelPriceDate, price: s.settings.fuelPrice });
    }
    return s;
  }

  const pad = n => String(n).padStart(2, '0');
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyToDate(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function todayKey() { return dateKey(new Date()); }

  // ---------- Odo ----------
  function lastKnownOdo(s) {
    let m = Number(s.settings.baseOdo) || 0;
    const take = v => { v = Number(v); if (isFinite(v) && v > m) m = v; };
    s.shifts.forEach(x => { take(x.odoStart); take(x.odoEnd); });
    s.fills.forEach(x => take(x.odo));
    s.maint.forEach(x => take(x.odo));
    s.odoLog.forEach(x => take(x.odo));
    if (s.active) take(s.active.odoStart);
    return m;
  }

  // ---------- Giá xăng theo ngày (nhật ký giá) ----------
  // Nhật ký giá = giá/lít ghi ở mỗi lần đổ xăng + các lần cập nhật giá thủ công. Giá của một ngày = lần ghi gần nhất
  // trước hoặc đúng ngày đó (ngày quá sớm thì lấy mốc giá đầu tiên). Đổi giá hôm nay không làm đổi các ca cũ.
  function priceEvents(s) {
    const ev = [];
    s.fills.forEach(f => { if (f.pricePerL > 0) ev.push({ date: f.date, price: f.pricePerL }); });
    (s.priceLog || []).forEach(p => { if (p.price > 0) ev.push({ date: p.date, price: p.price }); });
    return ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  function priceOn(s, k) {
    const ev = priceEvents(s);
    if (!ev.length) return Number(s.settings.fuelPrice) || 0;
    let best = null;
    ev.forEach(e => { if (e.date <= k) best = e; });
    return (best || ev[0]).price;
  }
  function latestPriceDate(s) {
    let d = s.settings.fuelPriceDate || null;
    priceEvents(s).forEach(e => { if (!d || e.date > d) d = e.date; });
    return d;
  }

  // Số lít của một lần đổ: ưu tiên số lít đã có, không thì tiền ÷ giá/lít (giá của lần đó, hoặc giá của ngày đó)
  function litersOf(f, s) {
    if (f.liters > 0) return f.liters;
    const p = f.pricePerL > 0 ? f.pricePerL : priceOn(s, f.date);
    return p > 0 ? f.amount / p : 0;
  }

  // ---------- Mức tiêu hao (lít/100km): học từ số LÍT, không phụ thuộc giá xăng ----------
  function fuelModel(s) {
    const def = Number(s.settings.fuelL100) || 0;
    // Mốc đo: các lần đổ ĐẦY BÌNH có odo. Xăng tiêu thụ giữa mốc đầu và mốc cuối = mọi lần đổ nằm trong khoảng đó
    // (kể cả lần đổ chưa đầy hoặc không nhớ odo, những lần này xếp theo ngày).
    const full = s.fills
      .filter(f => f.full !== false && f.odo > 0 && f.amount > 0)
      .sort((a, b) => a.odo - b.odo);
    if (full.length >= 2) {
      const last = full[full.length - 1];
      // Lấy tối đa 6 mốc gần nhất; nếu quãng đường còn ngắn (đổ dồn dập) thì lùi thêm tới tối đa 10 mốc để bớt nhiễu
      let start = Math.max(0, full.length - 6);
      while (start > 0 && last.odo - full[start].odo < 100 && full.length - start < 10) start--;
      const first = full[start];
      const dist = last.odo - first.odo;
      if (dist >= 100) {
        const liters = s.fills.reduce((a, f) => {
          if (!(f.amount > 0)) return a;
          const inside = f.odo > 0 ? (f.odo > first.odo && f.odo <= last.odo) : (f.date > first.date && f.date <= last.date);
          return inside ? a + litersOf(f, s) : a;
        }, 0);
        return { l100: liters / dist * 100, source: 'learned', n: full.length - start - 1, dist, liters, def };
      }
    }
    return { l100: def, source: 'default', n: 0, def };
  }

  // Đơn giá xăng/km HIỆN TẠI (để hiển thị): mức tiêu hao × giá xăng hôm nay
  function fuelRate(s) {
    const m = fuelModel(s);
    const price = priceOn(s, todayKey());
    return Object.assign({}, m, { price, rate: m.l100 / 100 * price });
  }

  // Nhắc cập nhật giá xăng khi lần ghi giá gần nhất (cập nhật, đổ xăng có giá/lít, hoặc "chưa đổi") đã quá 7 ngày
  function fuelPriceStatus(s) {
    const d = latestPriceDate(s);
    const days = d ? Math.floor((Date.now() - keyToDate(d).getTime()) / 864e5) : null;
    return { show: d == null || days > 7, date: d, days };
  }

  // ---------- Một ca ----------
  // model: kết quả fuelModel(s) (truyền vào để khỏi tính lại nhiều lần)
  function shiftCalc(sh, s, model) {
    // Ca nhập bù có thể chỉ có số km (không có odo)
    const km = sh.km != null ? Math.max(0, sh.km) : Math.max(0, (sh.odoEnd || 0) - (sh.odoStart || 0));
    const hours = Math.max(0, (new Date(sh.end) - new Date(sh.start)) / 3600000);
    // Xăng của ca = km × lít/100km (mức tiêu hao hiện tốt nhất) × giá xăng của ngày chạy.
    // Ca cũ chưa có giá xăng riêng (sh.fuelPrice) vẫn giữ đơn giá đ/km đã lưu cho tới khi bạn bấm "Tính lại".
    let frPerKm;
    if (sh.fuelPrice != null) frPerKm = (model || fuelModel(s)).l100 / 100 * sh.fuelPrice;
    else if (sh.fuelRate != null) frPerKm = sh.fuelRate;
    else frPerKm = (model || fuelModel(s)).l100 / 100 * priceOn(s, dateKey(new Date(sh.start)));
    const wr = sh.wearRate != null ? sh.wearRate : (Number(s.settings.wearPerKm) || 0);
    // Tip/thưởng = số nhập lúc kết thúc ca + các khoản thêm sau (tip qua app, thưởng về sau 24h...)
    const extras = (sh.extras || []).reduce((a, e) => a + (e.amount || 0), 0);
    const net = sh.net || 0, bonus = (sh.bonus || 0) + extras;
    const income = net + bonus;
    const fuel = km * frPerKm, wear = km * wr;
    const profit = income - fuel - wear;
    return {
      km, hours, net, bonus, income, fuel, wear, profit,
      perKm: km > 0 ? profit / km : 0,
      perHour: hours > 0 ? profit / hours : 0,
    };
  }

  // ---------- Khoảng thời gian ----------
  function dayRange(off) {
    const t = new Date(); t.setHours(12, 0, 0, 0); t.setDate(t.getDate() + off);
    const k = dateKey(t);
    return { kind: 'day', off, from: k, to: k, buckets: [k], label: pad(t.getDate()) + '/' + pad(t.getMonth() + 1) + '/' + t.getFullYear() };
  }
  function weekRange(off) {
    const t = new Date(); t.setHours(12, 0, 0, 0);
    const dow = (t.getDay() + 6) % 7; // T2 = 0
    const mon = new Date(t); mon.setDate(t.getDate() - dow + off * 7);
    const buckets = [];
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); buckets.push(dateKey(d)); }
    const a = keyToDate(buckets[0]), b = keyToDate(buckets[6]);
    return {
      kind: 'week', off, from: buckets[0], to: buckets[6], buckets,
      label: pad(a.getDate()) + '/' + pad(a.getMonth() + 1) + ' – ' + pad(b.getDate()) + '/' + pad(b.getMonth() + 1),
    };
  }
  function monthRange(off) {
    const t = new Date();
    const first = new Date(t.getFullYear(), t.getMonth() + off, 1, 12);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
    const buckets = [];
    for (let d = 1; d <= last.getDate(); d++) buckets.push(dateKey(new Date(first.getFullYear(), first.getMonth(), d, 12)));
    return {
      kind: 'month', off, from: buckets[0], to: buckets[buckets.length - 1], buckets,
      label: 'Tháng ' + (first.getMonth() + 1) + '/' + first.getFullYear(),
    };
  }
  function allRange(s) {
    const keys = [];
    s.shifts.forEach(x => keys.push(dateKey(new Date(x.start))));
    s.expenses.forEach(x => keys.push(x.date));
    const today = todayKey();
    keys.sort();
    const first = keys.length ? keys[0] : today;
    const buckets = [];
    let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
    const ty = Number(today.slice(0, 4)), tm = Number(today.slice(5, 7));
    while (y < ty || (y === ty && m <= tm)) {
      buckets.push(y + '-' + pad(m));
      m++; if (m > 12) { m = 1; y++; }
    }
    return { kind: 'all', off: 0, from: first < today ? first : today, to: '9999-12-31', buckets, label: 'Tất cả' };
  }
  function rangeFor(s, kind, off) {
    if (kind === 'day') return dayRange(off);
    if (kind === 'month') return monthRange(off);
    if (kind === 'all') return allRange(s);
    return weekRange(off);
  }

  // ---------- Tổng hợp ----------
  function addTo(map, k, v) { map[k] = (map[k] || 0) + v; }

  function summarize(s, from, to) {
    const inR = k => k >= from && k <= to;
    const r = {
      income: 0, net: 0, bonus: 0, fuel: 0, wear: 0, rideExp: 0, personal: 0, saving: 0,
      km: 0, hours: 0, trips: 0, nShifts: 0, nExpenses: 0, untimedProfit: 0,
      byDay: {}, rideCats: {}, personalCats: {}, savingCats: {},
    };
    const cur = fuelModel(s);
    s.shifts.forEach(sh => {
      const k = dateKey(new Date(sh.start));
      if (!inR(k)) return;
      const c = shiftCalc(sh, s, cur);
      r.income += c.income; r.net += c.net; r.bonus += c.bonus;
      r.fuel += c.fuel; r.wear += c.wear; r.km += c.km; r.hours += c.hours;
      r.trips += sh.trips || 0; r.nShifts++;
      if (c.hours <= 0) r.untimedProfit += c.profit; // ca không rõ giờ: không tính vào lãi/giờ
      addTo(r.byDay, k, c.profit);
    });
    s.expenses.forEach(e => {
      if (!inR(e.date)) return;
      r.nExpenses++;
      if (e.type === 'ride') { r.rideExp += e.amount; addTo(r.rideCats, e.category, e.amount); addTo(r.byDay, e.date, -e.amount); }
      else if (e.type === 'saving') { r.saving += e.amount; addTo(r.savingCats, e.category, e.amount); }
      else { r.personal += e.amount; addTo(r.personalCats, e.category, e.amount); }
    });
    r.cost = r.fuel + r.wear + r.rideExp;          // chi phí chạy xe
    r.profit = r.income - r.cost;                  // lợi nhuận chạy xe
    r.totalSpend = r.cost + r.personal;            // tổng chi (chạy xe + cá nhân)
    r.remain = r.profit - r.personal - r.saving;   // còn lại chưa phân bổ
    r.perKm = r.km > 0 ? r.profit / r.km : 0;
    r.perHour = r.hours > 0 ? (r.profit - r.untimedProfit) / r.hours : 0;
    return r;
  }

  function series(range, byDay) {
    if (range.kind === 'all') {
      const m = {};
      Object.keys(byDay).forEach(k => addTo(m, k.slice(0, 7), byDay[k]));
      return range.buckets.map(b => ({ key: b, value: m[b] || 0 }));
    }
    return range.buckets.map(k => ({ key: k, value: byDay[k] || 0 }));
  }

  // ---------- Bảo dưỡng ----------
  function oilStatus(s) {
    const iv = Number(s.settings.oilInterval) || 2000;
    const cur = lastKnownOdo(s);
    const last = s.maint.filter(m => m.item === 'Nhớt').sort((a, b) => b.odo - a.odo)[0];
    if (!last) return { has: false, iv, cur };
    const since = cur - last.odo;
    return { has: true, iv, cur, since, remaining: iv - since, lastOdo: last.odo, pct: Math.max(0, Math.min(1, since / iv)) };
  }

  // Gợi ý hiệu chỉnh đơn giá hao mòn: tổng tiền bảo dưỡng thật / tổng km xe đi (kể từ mốc bảo dưỡng đầu tiên)
  function wearSuggestion(s) {
    const m = s.maint.slice().sort((a, b) => a.odo - b.odo);
    if (m.length < 2) return null;
    const km = lastKnownOdo(s) - m[0].odo;
    if (km < 3000) return null;
    const cost = m.slice(1).reduce((a, x) => a + x.cost, 0);
    return { perKm: cost / km, km, cost };
  }

  // ---------- Tiền thật đang cầm & quỹ sửa xe ----------
  function lastDayOfPrevMonth() {
    const t = new Date();
    return dateKey(new Date(t.getFullYear(), t.getMonth(), 0, 12));
  }

  // Số dư kỳ vọng = vốn ban đầu + thu nhập − tiền thật đã chi (xăng đổ, sửa xe, chi khác, chi cá nhân) ± điều chỉnh.
  // Chỉ tính các khoản SAU ngày chốt vốn. "Để dành" vẫn là tiền đang cầm nên không trừ.
  function cashPosition(s) {
    const cap = s.capital;
    if (!cap) return null;
    const after = k => k > cap.date;
    const p = {
      cap: cap.total || 0, income: 0, fuelAccr: 0, wearAccr: 0,
      fuelPaid: 0, repairPaid: 0, repairFromFund: 0, putIn: 0, rideExp: 0, personal: 0, saved: 0, adjust: 0,
    };
    const cur = fuelModel(s);
    s.shifts.forEach(sh => {
      if (!after(dateKey(new Date(sh.start)))) return;
      const c = shiftCalc(sh, s, cur);
      p.income += c.income; p.fuelAccr += c.fuel; p.wearAccr += c.wear;
    });
    s.fills.forEach(f => { if (after(f.date)) p.fuelPaid += f.amount; });
    s.maint.forEach(m => {
      if (!after(m.date)) return;
      p.repairPaid += m.cost;
      if (m.fromFund !== false) p.repairFromFund += m.cost; // mặc định trả từ quỹ để riêng
    });
    s.fundPuts.forEach(f => { if (after(f.date)) p.putIn += f.amount; });
    s.expenses.forEach(e => {
      if (!after(e.date)) return;
      if (e.type === 'ride') p.rideExp += e.amount;
      else if (e.type === 'personal') p.personal += e.amount;
      else p.saved += e.amount;
    });
    s.adjusts.forEach(a => { p.adjust += a.amount; });
    p.expected = p.cap + p.income - p.fuelPaid - p.repairPaid - p.rideExp - p.personal + p.adjust;
    // Quỹ sửa xe: khấu hao trích theo km Grab − tiền bảo dưỡng/sửa xe đã trả (âm = đã chi vượt phần trích)
    p.fund = (cap.fund || 0) + p.wearAccr - p.repairPaid;
    // Tiền đang tách riêng (bên ngoài) cho quỹ bảo trì, và số cần tách thêm (>0) hoặc đã tách dư (<0)
    p.envelope = (cap.fund || 0) + p.putIn - p.repairFromFund;
    p.toSetAside = p.fund - p.envelope;
    p.spendable = p.expected - Math.max(0, p.fund) - p.saved;
    p.commuteFuel = p.fuelPaid - p.fuelAccr; // xăng đi làm + chênh lệch lượng xăng còn trong bình
    return p;
  }

  // ---------- Định dạng ----------
  function fmtInt(n) {
    n = Math.round(Number(n) || 0);
    const sign = n < 0 ? '-' : '';
    return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  // Km có thể lẻ: 43 → "43", 43.2 → "43,2"
  function fmtKm(n) {
    n = Math.round((Number(n) || 0) * 10) / 10;
    if (Number.isInteger(n)) return fmtInt(n);
    const sign = n < 0 ? '-' : '', a = Math.abs(n);
    return sign + fmtInt(Math.trunc(a)) + ',' + Math.round((a - Math.trunc(a)) * 10);
  }
  function fmtMoney(n) { return fmtInt(n) + 'đ'; }
  function fmtSigned(n) {
    const r = Math.round(n);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + fmtInt(Math.abs(r)) + 'đ';
  }
  function fmtShort(n) {
    const a = Math.abs(n), sign = n < 0 ? '−' : '';
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + 'tr';
    if (a >= 1000) return sign + Math.round(a / 1000) + 'k';
    return sign + Math.round(a);
  }
  function fmtDur(h) {
    const mins = Math.round(h * 60);
    if (mins < 60) return mins + ' phút';
    return Math.floor(mins / 60) + 'g' + pad(mins % 60);
  }

  // Chấp nhận "150000", "150.000", "150k", "1,5tr"
  function parseMoney(str) {
    if (str == null) return NaN;
    let t = String(str).trim().toLowerCase().replace(/[đ₫\s]/g, '');
    if (!t) return NaN;
    let mult = 1;
    if (/tr$/.test(t)) { mult = 1e6; t = t.slice(0, -2); }
    else if (/k$/.test(t)) { mult = 1e3; t = t.slice(0, -1); }
    if (mult > 1) t = t.replace(',', '.'); else t = t.replace(/[.,]/g, '');
    const v = parseFloat(t);
    return isFinite(v) ? Math.round(v * mult) : NaN;
  }

  const api = {
    DEFAULT_SETTINGS, CATS, TYPE_LABEL, MAINT_ITEMS,
    emptyState, migrate, dateKey, keyToDate, todayKey,
    lastKnownOdo, fuelModel, fuelRate, priceOn, litersOf, fuelPriceStatus, shiftCalc,
    dayRange, weekRange, monthRange, allRange, rangeFor, summarize, series,
    oilStatus, wearSuggestion, lastDayOfPrevMonth, cashPosition,
    fmtInt, fmtKm, fmtMoney, fmtSigned, fmtShort, fmtDur, parseMoney,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
