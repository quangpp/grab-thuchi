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
    splitAnchor: null,  // { odo, date }: mốc bắt đầu thống kê km Grab / km ngoài Grab (đặt lần đầu theo lần đổ xăng gần nhất)
    tireInterval: 15000, // km giữa hai lần thay lốp (ước tính, chỉnh theo thực tế)
    brakeInterval: 10000, // km giữa hai lần thay má phanh (ước tính)
    chainInterval: 15000, // km giữa hai lần thay sên nhông dĩa (ước tính)
    plugInterval: 10000, // km giữa hai lần thay bugi / lọc gió (ước tính)
    remindDays: 3,      // nhắc trước bao nhiêu ngày khi khoản nợ/định kỳ đến hạn
    lockMinutes: 5,     // tự khoá khi rời app quá số phút này (0 = khoá ngay khi thoát app); chỉ có tác dụng khi đã đặt mật khẩu
  };

  const CATS = {
    ride: ['Rửa xe', 'Gửi xe', 'Nước / ăn trong ca', 'Vá xe / lặt vặt'],
    personal: ['Ăn uống', 'Cà phê', 'Gia đình', 'Nhà cửa', 'Khác'],
    saving: ['Tiết kiệm', 'Quỹ dự phòng'],
  };
  const TYPE_LABEL = { ride: 'Chạy xe', personal: 'Cá nhân', saving: 'Để dành' };
  const TX_CATS = {
    expense: ['Ăn uống', 'Nhà ở', 'Điện nước', 'Internet / điện thoại', 'Đi lại', 'Gia đình', 'Y tế', 'Giáo dục', 'Giải trí', 'Mua sắm', 'Bảo hiểm', 'Khác'],
    income: ['Lương', 'Thưởng lớn', 'Freelance', 'Hoàn tiền', 'Khác'],
  };
  const ACCT_KINDS = { cash: 'Tiền mặt', bank: 'Ngân hàng', wallet: 'Ví điện tử', other: 'Khác' };
  const GRAB_ACCT = 'grab'; // tài khoản ảo "Tiền Grab": số dư lấy từ mục Grab (tab Tiền Grab)
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
      // Sổ tài chính cá nhân
      ledger: { start: null, lastAcct: null }, // start = ngày chốt (số dư đầu kỳ tính tới hết ngày này)
      accounts: [],      // { id,name,kind,opening } — kind: cash | bank | wallet | other
      tx: [],            // { id,date,type:'income'|'expense'|'transfer'|'debtpay',amount,acct,to,cat,note,adj,debt,principal,interest }
      debts: [],         // khoản nợ: kind 'loan' (vay trả góp) | 'card' (thẻ tín dụng), xem tạo ở debtSheet
      recurring: [],     // khoản định kỳ hằng tháng: { id,name,type:'income'|'expense',amount,days:[5,15],acct,cat,note,active,doneUpTo }
      lastBackup: null,
    };
  }

  function migrate(o) {
    const s = Object.assign(emptyState(), o || {});
    s.settings = Object.assign({}, DEFAULT_SETTINGS, (o && o.settings) || {});
    ['shifts', 'fills', 'expenses', 'maint', 'odoLog', 'checks', 'adjusts', 'fundPuts', 'priceLog', 'accounts', 'tx', 'debts', 'recurring'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    if (!s.ledger || typeof s.ledger !== 'object') s.ledger = { start: null, lastAcct: null };
    // Dữ liệu cũ: giá xăng đã xác nhận trước đây trở thành mốc đầu tiên của nhật ký giá
    if (!s.priceLog.length && s.settings.fuelPriceDate && s.settings.fuelPrice > 0) {
      s.priceLog.push({ id: 'seed', date: s.settings.fuelPriceDate, price: s.settings.fuelPrice });
    }
    repairIntegrity(s); // dọn các tham chiếu hỏng vô hại (định kỳ trỏ tới tài khoản đã xoá...)
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

  // Tách km Grab / km ngoài Grab (đi làm, việc riêng) theo các mốc đổ xăng có odo.
  // Ca có odo đầu thì xếp theo odo; ca nhập bù chỉ có km thì xếp theo ngày (ca nhập bù cùng ngày với lần đổ nằm ở khoảng sau).
  function shiftKmOf(sh) { return sh.km != null ? Math.max(0, sh.km) : Math.max(0, (sh.odoEnd || 0) - (sh.odoStart || 0)); }
  function shiftsIn(s, oA, oB, dA, dB) {
    return s.shifts.filter(sh => {
      if (sh.km == null && sh.odoStart > 0) return sh.odoStart >= oA && sh.odoStart < oB;
      const d = dateKey(new Date(sh.start));
      return d > dA && d <= dB;
    });
  }
  function fuelSplit(s) {
    const model = fuelModel(s);
    const odoFills = s.fills.filter(f => f.odo > 0 && f.amount > 0).sort((a, b) => a.odo - b.odo);
    const out = { since: null, intervals: [] };
    if (!odoFills.length) return out;
    // Tính cộng dồn từ MỐC (đặt lần đầu theo lần đổ xăng gần nhất, sau đó giữ nguyên dù đổ thêm) tới odo mới nhất app biết
    const lf = odoFills[odoFills.length - 1], cur = lastKnownOdo(s);
    const anchor = s.settings.splitAnchor && s.settings.splitAnchor.odo > 0 ? s.settings.splitAnchor : { odo: lf.odo, date: lf.date };
    out.anchor = anchor;
    if (cur > anchor.odo) {
      const sh = shiftsIn(s, anchor.odo, Infinity, anchor.date, '9999-12-31');
      const grab = Math.min(cur - anchor.odo, sh.reduce((a, x) => a + shiftKmOf(x), 0));
      out.since = { odo: anchor.odo, date: anchor.date, cur, km: cur - anchor.odo, grab, other: cur - anchor.odo - grab };
    }
    // Giữa hai lần đổ ĐẦY liên tiếp: xăng thật của khoảng đó chia theo tỉ lệ km
    const full = odoFills.filter(f => f.full !== false);
    for (let i = 1; i < full.length; i++) {
      const A = full[i - 1], B = full[i], km = B.odo - A.odo;
      if (!(km > 0)) continue;
      const sh = shiftsIn(s, A.odo, B.odo, A.date, B.date);
      const grab = Math.min(km, sh.reduce((a, x) => a + shiftKmOf(x), 0));
      let cost = 0, liters = 0;
      s.fills.forEach(f => {
        if (!(f.amount > 0)) return;
        const inside = f.odo > 0 ? (f.odo > A.odo && f.odo <= B.odo) : (f.date > A.date && f.date <= B.date);
        if (inside) { cost += f.amount; liters += litersOf(f, s); }
      });
      out.intervals.push({
        fromOdo: A.odo, toOdo: B.odo, from: A.date, to: B.date, km, grab, other: km - grab, cost, liters,
        costGrab: cost * grab / km, costOther: cost * (km - grab) / km,
        estGrab: sh.reduce((a, x) => a + shiftCalc(x, s, model).fuel, 0), // xăng app ước tính cho các ca trong khoảng này
      });
    }
    // Xăng thật đã tính xong của các khoảng đủ (đổ đầy tới đổ đầy) nằm sau mốc
    const done = out.intervals.filter(i => i.fromOdo >= anchor.odo);
    if (done.length) out.done = done.reduce((a, i) => ({ km: a.km + i.km, grab: a.grab + i.grab, other: a.other + i.other, cost: a.cost + i.cost, costGrab: a.costGrab + i.costGrab, costOther: a.costOther + i.costOther, n: a.n + 1 }), { km: 0, grab: 0, other: 0, cost: 0, costGrab: 0, costOther: 0, n: 0 });
    return out;
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
  // Các hạng mục có chu kỳ theo km (cài ở Thông số xe); mỗi lần ghi bảo dưỡng đúng hạng mục là một mốc mới
  const PARTS = [
    { item: 'Nhớt', key: 'oilInterval', icon: '🛢️', def: 2000 },
    { item: 'Lốp', key: 'tireInterval', icon: '🛞', def: 15000 },
    { item: 'Má phanh', key: 'brakeInterval', icon: '🛑', def: 10000 },
    { item: 'Sên nhông dĩa', key: 'chainInterval', icon: '⛓️', def: 15000 },
    { item: 'Bugi / lọc gió', key: 'plugInterval', icon: '🔧', def: 10000 },
  ];
  function partStatus(s, item) {
    const p = PARTS.find(x => x.item === item) || PARTS[0];
    const iv = Number(s.settings[p.key]) || p.def;
    const cur = lastKnownOdo(s);
    const last = s.maint.filter(m => m.item === p.item).sort((a, b) => b.odo - a.odo)[0];
    if (!last) return { has: false, iv, cur, item: p.item, icon: p.icon };
    const since = Math.max(0, cur - last.odo);
    return { has: true, iv, cur, item: p.item, icon: p.icon, since, remaining: iv - since, lastOdo: last.odo, lastDate: last.date, pct: Math.max(0, Math.min(1, since / iv)) };
  }
  const oilStatus = s => partStatus(s, 'Nhớt');
  // Sắp tới hạn: còn ≤ 300 km với nhớt, ≤ 10% chu kỳ với các hạng mục khác
  const partDueSoon = st => st.has && st.remaining <= (st.item === 'Nhớt' ? 300 : Math.round(st.iv * 0.1));

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
    const after = k => countsAfter(cap.date, cap.when, k);
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
      if (!after(m.date) || m.noMoney) return; // noMoney: chi phí đã ghi ở nơi khác (vd quẹt thẻ), chỉ lưu để làm mốc/tham khảo
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
    // Giao dịch ở sổ tài chính có dính "Tiền Grab" (chi từ tiền Grab, rút về ngân hàng, nạp thêm...)
    p.ledgerNet = 0;
    s.tx.forEach(t => {
      // Giao dịch trước hoặc đúng ngày bắt đầu sổ chỉ để tham khảo, không cộng vào số dư (nhất quán với các tài khoản khác)
      if (!after(t.date) || (s.ledger && s.ledger.start && !countsAfter(s.ledger.start, s.ledger.when, t.date))) return;
      if (t.type === 'income' && t.acct === GRAB_ACCT) p.ledgerNet += t.amount;
      else if (t.type === 'expense' && t.acct === GRAB_ACCT) p.ledgerNet -= t.amount;
      else if (t.type === 'debtpay' && t.acct === GRAB_ACCT) p.ledgerNet -= t.amount;
      else if (t.type === 'transfer') {
        if (t.acct === GRAB_ACCT) p.ledgerNet -= t.amount;
        if (t.to === GRAB_ACCT) p.ledgerNet += t.amount;
      }
    });
    p.expected = p.cap + p.income - p.fuelPaid - p.repairPaid - p.rideExp - p.personal + p.adjust + p.ledgerNet;
    // Quỹ sửa xe: khấu hao trích theo km Grab − tiền bảo dưỡng/sửa xe đã trả (âm = đã chi vượt phần trích)
    p.fund = (cap.fund || 0) + p.wearAccr - p.repairPaid;
    // Tiền đang tách riêng (bên ngoài) cho quỹ bảo trì, và số cần tách thêm (>0) hoặc đã tách dư (<0)
    p.envelope = (cap.fund || 0) + p.putIn - p.repairFromFund;
    p.toSetAside = p.fund - p.envelope;
    p.spendable = p.expected - Math.max(0, p.fund) - p.saved;
    p.commuteFuel = p.fuelPaid - p.fuelAccr; // xăng đi làm + chênh lệch lượng xăng còn trong bình
    return p;
  }

  // ---------- Sổ tài chính: tài khoản, số dư, giao dịch ----------
  function ledgerReady(s) { return !!(s.ledger && s.ledger.start); }
  // Mốc ngày có hai kiểu: "cuối ngày" (mặc định: số dư đã gồm mọi thứ của ngày đó, chỉ tính các khoản SAU ngày đó) và
  // "đầu ngày" (số dư là lúc chưa phát sinh gì trong ngày đó, nên các khoản của CHÍNH ngày đó cũng được cộng).
  function countsAfter(date, when, k) { return when === 'start' ? k >= date : k > date; }
  function ledgerCounts(s, k) { return ledgerReady(s) && countsAfter(s.ledger.start, s.ledger.when, k); }

  // "Tiền Grab" khi CHƯA nhập vốn Grab: coi như vốn 0 tại ngày trước bản ghi Grab đầu tiên (ca, xăng, bảo dưỡng, chi phí,
  // giao dịch dính Tiền Grab), để thu nhập Grab đã nhập vẫn được cộng vào tổng tài sản.
  function implicitCapital(s) {
    const keys = [];
    s.shifts.forEach(x => keys.push(dateKey(new Date(x.start))));
    s.fills.forEach(x => keys.push(x.date));
    s.maint.forEach(x => keys.push(x.date));
    s.expenses.forEach(x => keys.push(x.date));
    s.tx.forEach(t => { if (t.acct === GRAB_ACCT || t.to === GRAB_ACCT) keys.push(t.date); });
    if (!keys.length) return null;
    keys.sort();
    const d = keyToDate(keys[0]); d.setDate(d.getDate() - 1);
    return { date: dateKey(d), total: 0, fund: 0 };
  }
  // Các ca đã nhập nhưng nằm từ ngày chốt vốn Grab trở về trước: không được cộng vào Tiền Grab (đã coi là nằm trong vốn)
  function grabExcluded(s) {
    const cap = s.capital;
    const r = { n: 0, income: 0, date: cap ? cap.date : null };
    if (!cap) return r;
    const model = fuelModel(s);
    s.shifts.forEach(sh => {
      if (!countsAfter(cap.date, cap.when, dateKey(new Date(sh.start)))) { r.n++; r.income += shiftCalc(sh, s, model).income; }
    });
    return r;
  }
  // Số liệu "Tiền Grab": dùng vốn thật nếu đã nhập, không thì vốn ngầm định ở trên (null nếu chưa có dữ liệu Grab nào)
  function grabPot(s) {
    if (s.capital) return cashPosition(s);
    const cap = implicitCapital(s);
    return cap ? cashPosition(Object.assign({}, s, { capital: cap })) : null;
  }

  // Gộp dữ liệu từ file vào dữ liệu hiện tại: giữ nguyên mọi thứ đang có, chỉ thêm các mục chưa có (theo id)
  const MERGE_KEYS = ['shifts', 'fills', 'expenses', 'maint', 'odoLog', 'checks', 'adjusts', 'fundPuts', 'priceLog', 'accounts', 'tx', 'debts', 'recurring'];
  function mergeState(cur, inc) {
    const a = migrate(JSON.parse(JSON.stringify(cur))), b = migrate(JSON.parse(JSON.stringify(inc)));
    const added = {};
    MERGE_KEYS.forEach(k => {
      const ids = new Set(a[k].map(x => x.id));
      added[k] = 0;
      b[k].forEach(x => { if (!ids.has(x.id)) { a[k].push(x); added[k]++; } });
    });
    if (!a.capital && b.capital) a.capital = b.capital;
    if (!(a.ledger && a.ledger.start) && b.ledger && b.ledger.start) a.ledger = b.ledger;
    return { state: a, added };
  }

  // Số dư từng tài khoản = số dư đầu kỳ + giao dịch sau ngày chốt. "Tiền Grab" là tài khoản ảo lấy từ mục Grab.
  function accountBalances(s) {
    const start = s.ledger && s.ledger.start;
    const byId = {};
    s.accounts.forEach(a => { byId[a.id] = Number(a.opening) || 0; });
    s.tx.forEach(t => {
      if (start && !countsAfter(start, s.ledger.when, t.date)) return;
      if (t.type === 'income') { if (t.acct in byId) byId[t.acct] += t.amount; }
      else if (t.type === 'expense') { if (t.acct in byId) byId[t.acct] -= t.amount; }
      else if (t.type === 'debtpay') { if (t.acct in byId) byId[t.acct] -= t.amount; }
      else if (t.type === 'transfer') {
        if (t.acct in byId) byId[t.acct] -= t.amount;
        if (t.to in byId) byId[t.to] += t.amount;
      }
    });
    const pos = grabPot(s);
    const grab = pos ? pos.expected : null;
    const total = Object.keys(byId).reduce((a, k) => a + byId[k], 0) + (grab || 0);
    // Nợ: tổng dư nợ các khoản vay và thẻ. Tài sản ròng = tài sản − nợ.
    const debts = {};
    let debtTotal = 0;
    s.debts.forEach(d => { debts[d.id] = debtBalance(s, d); debtTotal += debts[d.id]; });
    return { byId, grab, total, debts, debtTotal, net: total - debtTotal, grabImplicit: !s.capital && grab != null };
  }

  // ---------- Kiểm tra toàn vẹn dữ liệu ----------
  // Tìm các bản ghi trỏ tới tài khoản/khoản nợ không còn tồn tại (số tiền của chúng sẽ không được tính ở đâu cả).
  function checkIntegrity(s) {
    const issues = [];
    const acc = new Set(s.accounts.map(a => a.id)), debts = new Set(s.debts.map(d => d.id));
    const isAcct = id => id === GRAB_ACCT || acc.has(id);
    const isPayer = id => isAcct(id) || debts.has(id); // thẻ tín dụng cũng dùng để chi
    s.tx.forEach(t => {
      if (t.type === 'debtpay') {
        if (!debts.has(t.debt)) issues.push({ kind: 'tx', id: t.id, msg: 'Trả nợ cho khoản nợ đã bị xoá' });
        else if (!isAcct(t.acct)) issues.push({ kind: 'tx', id: t.id, msg: 'Trả nợ từ tài khoản không còn tồn tại' });
      } else if (t.type === 'transfer') {
        if (!isAcct(t.acct) || !isAcct(t.to)) issues.push({ kind: 'tx', id: t.id, msg: 'Chuyển tiền có tài khoản không còn tồn tại' });
      } else if (!isPayer(t.acct)) issues.push({ kind: 'tx', id: t.id, msg: 'Giao dịch thuộc tài khoản không còn tồn tại' });
    });
    s.recurring.forEach(r => { if (r.acct && !isPayer(r.acct)) issues.push({ kind: 'rec', id: r.id, msg: 'Khoản định kỳ "' + r.name + '" trỏ tới tài khoản không còn tồn tại' }); });
    if (s.ledger && s.ledger.lastAcct && !isPayer(s.ledger.lastAcct)) issues.push({ kind: 'last', id: 'last', msg: 'Tài khoản dùng gần nhất không còn tồn tại' });
    issues.forEach(i => { i.sev = 'error'; });

    // Cảnh báo (số tiền vẫn được tính, nhưng có thể không đúng ý bạn)
    const today = todayKey(), dm = k => k.slice(8) + '/' + k.slice(5, 7);
    const seen = {};
    s.tx.forEach(t => {
      if (!t.adj && t.date > today) issues.push({ kind: 'tx', id: t.id, sev: 'warn', msg: 'Giao dịch ngày ' + dm(t.date) + ' (chưa tới) đang được cộng vào số dư hiện tại' });
      const key = [t.date, t.type, t.amount, t.acct, t.to, t.debt, t.cat].join('|');
      if (seen[key]) issues.push({ kind: 'tx', id: t.id, sev: 'warn', msg: 'Có thể nhập trùng: ' + dm(t.date) + ' ' + (t.type === 'income' ? 'thu' : t.type === 'expense' ? 'chi' : t.type === 'debtpay' ? 'trả nợ' : 'chuyển') + ' ' + fmtMoney(t.amount) });
      seen[key] = true;
    });
    s.recurring.forEach(r => {
      if (r.doneUpTo && r.doneUpTo > today && !s.tx.some(t => t.rec === r.id && t.recDate === r.doneUpTo)) issues.push({ kind: 'rec', id: r.id, sev: 'warn', msg: 'Khoản định kỳ "' + r.name + '" đang đánh dấu đã xử lý tới ' + dm(r.doneUpTo) + ', nên không hiện ở "Sắp đến hạn"' });
    });
    return issues;
  }
  // Sửa tự động các tham chiếu hỏng vô hại (không đụng tới giao dịch, vì cần bạn chọn lại tài khoản)
  function repairIntegrity(s) {
    let n = 0;
    const acc = new Set(s.accounts.map(a => a.id)), debts = new Set(s.debts.map(d => d.id));
    const ok = id => id === GRAB_ACCT || acc.has(id) || debts.has(id);
    s.recurring.forEach(r => { if (r.acct && !ok(r.acct)) { r.acct = ''; n++; } });
    if (s.ledger && s.ledger.lastAcct && !ok(s.ledger.lastAcct)) { s.ledger.lastAcct = null; n++; }
    return n;
  }

  // ---------- Nợ: khoản vay trả góp và thẻ tín dụng ----------
  // Dư nợ hiện tại = dư nợ đầu kỳ (tại ngày/mốc của khoản nợ) ± các giao dịch sau mốc đó:
  // trả nợ (giảm phần gốc), quẹt thẻ (tăng), hoàn tiền về thẻ (giảm).
  function debtBalance(s, d) {
    let b = Number(d.opening) || 0;
    s.tx.forEach(t => {
      if (!countsAfter(d.asOf, d.when, t.date)) return;
      if (t.type === 'debtpay' && t.debt === d.id) b -= (t.principal != null ? t.principal : t.amount);
      else if (t.type === 'expense' && t.acct === d.id) b += t.amount;
      else if (t.type === 'income' && t.acct === d.id) b -= t.amount;
    });
    return b;
  }

  // Lãi thực tế của thẻ: mỗi lần trả có nhập "lãi/phí" cho ra % trên dư nợ ngay trước lần trả đó.
  // Tính lại từ giao dịch mỗi lần nên sửa/xoá giao dịch là số tự khớp.
  function cardInterestBase(s, d, date, excludeId) {
    let b = Number(d.opening) || 0;
    s.tx.forEach(t => {
      if (t.id === excludeId || t.date > date || !countsAfter(d.asOf, d.when, t.date)) return;
      if (t.type === 'debtpay' && t.debt === d.id) b -= (t.principal != null ? t.principal : t.amount);
      else if (t.type === 'expense' && t.acct === d.id) b += t.amount;
      else if (t.type === 'income' && t.acct === d.id) b -= t.amount;
    });
    return b;
  }
  function cardInterestHistory(s, d) {
    const out = [];
    s.tx.forEach(t => {
      if (t.type !== 'debtpay' || t.debt !== d.id || !(t.interest > 0) || !countsAfter(d.asOf, d.when, t.date)) return;
      const base = cardInterestBase(s, d, t.date, t.id);
      if (base > 0) out.push({ id: t.id, date: t.date, interest: t.interest, base, pct: t.interest / base * 100 });
    });
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  // % trên một kỳ → quy ra năm, giả định một kỳ tính lãi khoảng 30 ngày
  const CARD_PERIOD_DAYS = 30;
  function cardPctPerYear(pct) { return pct * 365 / CARD_PERIOD_DAYS; }

  // Tiện ích ngày
  function addDays(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dateKey(d); }
  function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 864e5); }
  function monthDay(y, m0, day) { // ngày `day` của tháng m0 (tự dời nếu tháng ngắn hơn)
    const last = new Date(y, m0 + 1, 0).getDate();
    return dateKey(new Date(y, m0, Math.min(day, last), 12));
  }
  function shiftWeekend(k) { // ngân hàng cắt tiền vào thứ Hai nếu ngày trả rơi vào thứ Bảy/Chủ nhật
    const d = keyToDate(k), w = d.getDay();
    if (w === 6) d.setDate(d.getDate() + 2); else if (w === 0) d.setDate(d.getDate() + 1);
    return dateKey(d);
  }
  function nextMonthly(from, day) { // ngày `day` gần nhất từ `from` trở đi (cùng tháng hoặc tháng sau)
    const f = keyToDate(from);
    let k = monthDay(f.getFullYear(), f.getMonth(), day);
    if (k < from) k = monthDay(f.getFullYear(), f.getMonth() + 1, day);
    return k;
  }

  // Khoản vay: nextDue = ngày trả kỳ tới (chưa dời cuối tuần), dueDay = ngày trả hằng tháng, lastPaid = ngày cắt tiền kỳ trước.
  function loanDue(d, n) {
    const x = keyToDate(d.nextDue);
    return monthDay(x.getFullYear(), x.getMonth() + n, d.dueDay || x.getDate());
  }
  function loanLastCut(d) {
    if (d.lastPaid) return d.lastPaid;
    const x = keyToDate(d.nextDue);
    return shiftWeekend(monthDay(x.getFullYear(), x.getMonth() - 1, d.dueDay || x.getDate()));
  }
  // Lãi một kỳ = dư nợ × lãi suất năm × số ngày thực tế / 365 (đúng cách ngân hàng tính ở bảng của bạn)
  function loanInterest(balance, ratePct, days) { return Math.round(balance * (ratePct / 100) * days / 365); }

  // Lịch trả từ dư nợ hiện tại. Kỳ cuối tự giảm cho vừa hết gốc.
  function loanSchedule(s, d, maxRows) {
    const rows = [];
    let B = debtBalance(s, d), prev = loanLastCut(d);
    const pay = Number(d.payment) || 0, rate = Number(d.rate) || 0;
    for (let i = 0; B > 0.5 && i < (maxRows || 480); i++) {
      const due = loanDue(d, i);
      const cut = d.weekend === false ? due : shiftWeekend(due);
      const days = Math.max(0, daysBetween(prev, cut));
      const interest = loanInterest(B, rate, days);
      let pmt = pay;
      if (B + interest <= pmt) pmt = B + interest;
      const principal = pmt - interest;
      if (principal <= 0) { rows.push({ i, due, cut, days, interest, principal: 0, payment: pmt, balance: B, stuck: true }); break; }
      B -= principal;
      rows.push({ i, due, cut, days, interest, principal, payment: pmt, balance: Math.max(0, Math.round(B)) });
      prev = cut;
    }
    return rows;
  }
  // Gợi ý khi ghi một lần trả nợ vào ngày `k` (lãi theo số ngày từ lần trả gần nhất)
  function loanNextPayment(s, d, k) {
    const B = debtBalance(s, d);
    const days = Math.max(0, daysBetween(loanLastCut(d), k));
    const interest = loanInterest(B, Number(d.rate) || 0, days);
    let amount = Number(d.payment) || 0;
    if (B + interest <= amount) amount = B + interest;
    return { amount, interest, principal: amount - interest, days, balance: B };
  }
  // Tất toán ngay: dư nợ + lãi tới ngày đó + phí trả trước hạn
  function loanPayoff(s, d, k) {
    const B = debtBalance(s, d);
    const interest = loanInterest(B, Number(d.rate) || 0, Math.max(0, daysBetween(loanLastCut(d), k)));
    const fee = Math.round(B * (Number(d.feePct) || 0) / 100);
    return { balance: B, interest, fee, total: B + interest + fee };
  }

  // ---------- Khoản định kỳ, sắp đến hạn, file lịch ----------
  // Các ngày của khoản định kỳ trong khoảng [from, to]
  function recurringDates(r, from, to) {
    const out = [], f = keyToDate(from), t = keyToDate(to);
    for (let i = 0; i < 600; i++) {
      const first = new Date(f.getFullYear(), f.getMonth() + i, 1, 12);
      if (first > t) break;
      (r.days || []).forEach(day => {
        const k = monthDay(first.getFullYear(), first.getMonth(), day);
        if (k >= from && k <= to) out.push(k);
      });
    }
    return out.sort();
  }

  // Danh sách sắp đến hạn trong `horizon` ngày (kèm các khoản đã quá hạn chưa xử lý, tối đa 45 ngày trước)
  function upcoming(s, today, horizon) {
    const to = addDays(today, horizon), floor = addDays(today, -45), items = [];
    s.recurring.filter(r => r.active !== false).forEach(r => {
      let from = addDays(r.doneUpTo || today, 1);
      if (from < floor) from = floor;
      recurringDates(r, from, to).forEach(k => items.push({ kind: 'recurring', id: r.id, date: k, title: r.name, amount: r.amount, type: r.type, overdue: k < today }));
    });
    s.debts.forEach(d => {
      if (d.kind === 'loan') {
        loanSchedule(s, d, 4).forEach(row => {
          if (row.cut <= to && row.cut >= floor) items.push({ kind: 'loan', id: d.id, date: row.cut, title: 'Trả khoản vay ' + d.name, amount: row.payment, overdue: row.cut < today, row });
        });
      } else if (d.kind === 'card' && d.dueDay) {
        const bal = debtBalance(s, d);
        if (bal > 0) {
          const k = nextMonthly(today, d.dueDay);
          // Đã trả thẻ cho kỳ đến hạn này rồi thì không nhắc nữa (xem paidDue)
          if (k <= to && !(d.paidDue && d.paidDue >= k)) items.push({ kind: 'card', id: d.id, date: k, title: 'Thanh toán thẻ ' + d.name, amount: bal, overdue: false });
        }
      }
    });
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // File lịch .ics: mỗi khoản định kỳ/khoản vay/thẻ là một sự kiện lặp hằng tháng kèm báo thức trước `remind` ngày
  function icsEscape(t) { return String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function buildIcs(s, today, remind) {
    const compact = k => k.replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//So Tai Chinh//VI', 'CALSCALE:GREGORIAN'];
    const add = (uid, title, desc, firstKey, days, count) => {
      lines.push('BEGIN:VEVENT', 'UID:' + uid + '@so-tai-chinh', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + compact(firstKey),
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + days.join(',') + (count ? ';COUNT=' + count : ''),
        'SUMMARY:' + icsEscape(title), 'DESCRIPTION:' + icsEscape(desc),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(title), 'TRIGGER:-P' + Math.max(0, remind) + 'D', 'END:VALARM', 'END:VEVENT');
    };
    s.recurring.filter(r => r.active !== false && (r.days || []).length).forEach(r => {
      const first = recurringDates(r, today, addDays(today, 62))[0] || today;
      add('rec-' + r.id, (r.type === 'income' ? 'Nhận ' : 'Chi ') + r.name, (r.amount ? 'Khoảng ' + fmtMoney(r.amount) : ''), first, r.days.slice().sort((a, b) => a - b));
    });
    s.debts.forEach(d => {
      if (d.kind === 'loan' && d.dueDay) {
        const rows = loanSchedule(s, d);
        if (rows.length) add('loan-' + d.id, 'Trả khoản vay ' + d.name, 'Khoảng ' + fmtMoney(d.payment) + ' mỗi kỳ', rows[0].cut, [d.dueDay], rows.length);
      } else if (d.kind === 'card' && d.dueDay) {
        add('card-' + d.id, 'Thanh toán thẻ ' + d.name, 'Dư nợ hiện tại ' + fmtMoney(debtBalance(s, d)), nextMonthly(today, d.dueDay), [d.dueDay]);
      }
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // Gộp giao dịch của sổ và các dòng tiền từ mục Grab (thu nhập ca, xăng đổ thật, bảo dưỡng, chi khác) thành một danh sách
  function unifiedEntries(s, from, to) {
    const out = [];
    const inR = k => k >= from && k <= to;
    s.tx.forEach(t => {
      if (inR(t.date)) out.push({ src: 'tx', id: t.id, date: t.date, type: t.type, amount: t.amount, cat: t.cat || '', note: t.note || '', acct: t.acct, to: t.to, adj: !!t.adj, debt: t.debt, principal: t.principal, interest: t.interest });
    });
    const model = fuelModel(s);
    s.shifts.forEach(sh => {
      const k = dateKey(new Date(sh.start));
      if (!inR(k)) return;
      const c = shiftCalc(sh, s, model);
      out.push({ src: 'shift', id: sh.id, date: k, type: 'income', amount: c.income, cat: 'Grab · thu nhập ca', note: '', acct: GRAB_ACCT, at: sh.start });
    });
    s.fills.forEach(f => { if (inR(f.date)) out.push({ src: 'fill', id: f.id, date: f.date, type: 'expense', amount: f.amount, cat: 'Grab · Xăng', note: '', acct: GRAB_ACCT }); });
    s.maint.forEach(m => { if (inR(m.date) && !m.noMoney) out.push({ src: 'maint', id: m.id, date: m.date, type: 'expense', amount: m.cost, cat: 'Grab · Bảo dưỡng xe', note: m.item, acct: GRAB_ACCT }); });
    s.expenses.forEach(e => {
      if (!inR(e.date) || e.type === 'saving') return;
      out.push({
        src: 'exp', id: e.id, date: e.date, type: 'expense', amount: e.amount, note: e.note || '', acct: GRAB_ACCT,
        cat: e.type === 'ride' ? 'Grab · ' + e.category : e.category,
      });
    });
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  // Báo cáo thu/chi theo danh mục trong khoảng ngày. Chuyển khoản và điều chỉnh số dư không tính là thu/chi.
  function periodReport(s, from, to) {
    const r = { income: 0, expense: 0, incomeCats: {}, expenseCats: {}, transfers: 0, debtPrincipal: 0 };
    unifiedEntries(s, from, to).forEach(e => {
      if (e.type === 'transfer') { r.transfers += e.amount; return; }
      if (e.type === 'debtpay') { // trả nợ: phần gốc không phải chi (chỉ là giảm nợ), phần lãi/phí mới là chi
        const interest = e.interest || 0;
        r.debtPrincipal += e.amount - interest;
        if (interest > 0) { r.expense += interest; addTo(r.expenseCats, 'Lãi vay & phí', interest); }
        return;
      }
      if (e.adj) return;
      if (e.type === 'income') { r.income += e.amount; addTo(r.incomeCats, e.cat || 'Khác', e.amount); }
      else { r.expense += e.amount; addTo(r.expenseCats, e.cat || 'Khác', e.amount); }
    });
    r.net = r.income - r.expense;
    return r;
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
    DEFAULT_SETTINGS, CATS, TYPE_LABEL, MAINT_ITEMS, TX_CATS, ACCT_KINDS, GRAB_ACCT,
    checkIntegrity, repairIntegrity,
    debtBalance, cardInterestBase, cardInterestHistory, cardPctPerYear, loanSchedule, loanNextPayment, loanPayoff, loanDue, loanLastCut, loanInterest,
    addDays, daysBetween, monthDay, shiftWeekend, nextMonthly, recurringDates, upcoming, buildIcs,
    ledgerReady, countsAfter, ledgerCounts, accountBalances, unifiedEntries, periodReport, grabPot, grabExcluded, implicitCapital, mergeState,
    emptyState, migrate, dateKey, keyToDate, todayKey,
    lastKnownOdo, fuelModel, fuelSplit, fuelRate, priceOn, litersOf, fuelPriceStatus, shiftCalc,
    dayRange, weekRange, monthRange, allRange, rangeFor, summarize, series,
    oilStatus, partStatus, partDueSoon, PARTS, wearSuggestion, lastDayOfPrevMonth, cashPosition,
    fmtInt, fmtKm, fmtMoney, fmtSigned, fmtShort, fmtDur, parseMoney,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
