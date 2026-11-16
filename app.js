/* Sổ Thu Chi Grab — giao diện. Toàn bộ dữ liệu lưu trên máy (localStorage), có sao lưu ra file JSON. */
(function () {
  'use strict';
  const L = window.Logic;
  const V = window.Vault;
  const KEY = 'grab-tracker-v1';          // dữ liệu thô (khi chưa đặt mật khẩu)
  const KEY_ENC = 'grab-tracker-enc-v1';  // dữ liệu đã mã hoá (khi đã đặt mật khẩu)
  const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const TITLES = { overview: 'Tổng quan', ledger: 'Giao dịch', accounts: 'Tài khoản', grab: 'Grab', settings: 'Cài đặt' };
  const GRAB = L.GRAB_ACCT; // tài khoản ảo "Tiền Grab"

  // Trạng thái khoá: khi đã đặt mật khẩu, khoá giải mã chỉ nằm trong bộ nhớ lúc đang mở khoá
  let vaultKey = null, vaultHeader = null, locked = false;
  let saveChain = Promise.resolve();
  let hiddenAt = 0, failCount = 0, lockedUntil = 0, pendingImport = null, pendingData = null;

  let S = load();
  let tab = 'overview';
  let gsub = 'shift';                 // tab con trong mục Grab: shift | report | pot | car
  let finOff = 0, ledOff = 0;         // tháng đang xem ở Tổng quan / Giao dịch (0 = tháng này)
  let ledFilter = 'all', txType = 'expense';
  let period = { kind: 'week', off: 0 };
  let expType = 'ride';

  // ---------------------------------------------------------------- lưu trữ
  function load() {
    try {
      if (localStorage.getItem(KEY_ENC)) { locked = true; return L.emptyState(); } // có mật khẩu: chưa đọc dữ liệu, chờ mở khoá
      const raw = localStorage.getItem(KEY);
      if (raw) return L.migrate(JSON.parse(raw));
    } catch (e) { /* dùng dữ liệu rỗng */ }
    return L.emptyState();
  }
  function save() {
    if (locked) return false; // đang khoá: tuyệt đối không ghi gì
    if (vaultKey) {
      // Có mật khẩu: mã hoá rồi mới ghi (xếp hàng để các lần lưu không đè nhau)
      const key = vaultKey, header = vaultHeader, text = JSON.stringify(S);
      saveChain = saveChain
        .then(() => V.encryptText(key, text))
        .then(rec => { localStorage.setItem(KEY_ENC, JSON.stringify(Object.assign({}, header, rec))); })
        .catch(() => toast('⚠️ Không lưu được dữ liệu trên máy này!'));
      return true;
    }
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch (e) { toast('⚠️ Không lưu được dữ liệu trên máy này!'); return false; }
  }

  // ---------------------------------------------------------------- tiện ích
  const $ = (s, r) => (r || document).querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtKm = L.fmtKm;
  const fmtInt = L.fmtInt, fmtMoney = L.fmtMoney, fmtSigned = L.fmtSigned, fmtShort = L.fmtShort, fmtDur = L.fmtDur;
  const fmtTime = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const dayLabel = d => DAYS[d.getDay()] + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
  const keyLabel = k => dayLabel(L.keyToDate(k));
  const toLocalInput = iso => { const d = new Date(iso); return L.dateKey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fromLocalInput = v => (v ? new Date(v).toISOString() : null);
  const sgn = n => (Math.round(n) >= 0 ? 'pos' : 'neg');
  const val = id => { const e = $('#' + id); return e ? e.value.trim() : ''; };
  const getInt = id => { const t = val(id).replace(/\D/g, ''); return t ? Number(t) : NaN; };
  const getDec = id => { const t = val(id).replace(',', '.'); const v = parseFloat(t); return isFinite(v) ? v : NaN; };
  const sortedDesc = (arr, f) => arr.slice().sort((a, b) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0));

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------------------------------------------------------------- ô nhập
  const moneyField = (id, label, v, opt) => {
    opt = opt || {};
    return `<div class="fld"><label for="${id}">${label}</label><div class="inwrap"><input id="${id}" class="money" inputmode="numeric" autocomplete="off" placeholder="${opt.ph || '0'}" value="${v != null && v !== '' ? fmtInt(v) : ''}" ${opt.focus ? 'data-focus' : ''}><span class="suf" style="right:${opt.noZeros ? 12 : 76}px">đ</span>${opt.noZeros ? '' : `<button type="button" class="k" data-act="zeros" data-t="${id}">000</button>`}</div>${opt.hint ? `<div class="hint">${opt.hint}</div>` : ''}</div>`;
  };
  const intField = (id, label, v, opt) => {
    opt = opt || {};
    return `<div class="fld"><label for="${id}">${label}</label><div class="inwrap noK"><input id="${id}" class="int" inputmode="numeric" autocomplete="off" placeholder="${opt.ph || ''}" value="${v != null && v !== '' ? fmtInt(v) : ''}" ${opt.focus ? 'data-focus' : ''}><span class="suf">${opt.suf || ''}</span></div>${opt.hint ? `<div class="hint">${opt.hint}</div>` : ''}</div>`;
  };
  // Ô số thập phân (ví dụ 43,2 km): không tự thêm dấu chấm ngăn cách
  const decField = (id, label, v, opt) => {
    opt = opt || {};
    return `<div class="fld"><label for="${id}">${label}</label><div class="inwrap noK"><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="${opt.ph || ''}" value="${v != null && v !== '' ? String(v).replace('.', ',') : ''}" ${opt.focus ? 'data-focus' : ''}><span class="suf">${opt.suf || ''}</span></div>${opt.hint ? `<div class="hint">${opt.hint}</div>` : ''}</div>`;
  };
  const textField = (id, label, v, ph) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="text" autocomplete="off" placeholder="${esc(ph || '')}" value="${esc(v || '')}"></div>`;
  const dateField = (id, label, v) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="date" value="${v}"></div>`;

  // ---------------------------------------------------------------- bottom sheet
  function openSheet(title, body) {
    closeSheet();
    const root = document.createElement('div');
    root.id = 'sheet-root';
    root.innerHTML = `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-act="close-sheet" aria-label="Đóng">✕</button></div><div class="sheet-body">${body}</div></div>`;
    document.body.appendChild(root);
    document.body.classList.add('noscroll');
    const f = root.querySelector('[data-focus]'); if (f) setTimeout(() => f.focus(), 60);
  }
  function closeSheet() {
    const r = $('#sheet-root'); if (r) r.remove();
    document.body.classList.remove('noscroll');
  }
  function setErr(msg) { const e = $('#err'); if (e) { e.textContent = msg || ''; if (msg) e.scrollIntoView({ block: 'nearest' }); } return false; }

  // ---------------------------------------------------------------- màn hình: CA CHẠY
  function elapsed(startIso) {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(startIso)) / 60000));
    return Math.floor(mins / 60) + ':' + pad(mins % 60);
  }

  // Nhắc cập nhật giá xăng (chỉ hiện khi giá còn ảnh hưởng tới ước tính và đã cũ hơn 7 ngày)
  function priceAlert() {
    const st = L.fuelPriceStatus(S);
    if (!st.show) return '';
    const msg = st.date ? `Giá xăng đã ${st.days} ngày chưa cập nhật` : 'Bạn chưa xác nhận giá xăng';
    return `<div class="alert"><div>⛽ <b>${msg}</b> (đang dùng ${fmtInt(L.priceOn(S, L.todayKey()))}đ/lít). Giá chỉ ảnh hưởng các ca từ hôm nay trở đi.</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-left:auto;flex:none">
        <button class="btn sm" data-act="price-sheet" style="margin:0">Cập nhật</button>
        <button class="btn sm" data-act="price-same" style="margin:0">Chưa đổi</button></div></div>`;
  }

  function shiftRow(sh) {
    const c = L.shiftCalc(sh, S);
    const d = new Date(sh.start);
    return `<button class="row" data-act="edit-shift" data-id="${sh.id}">
      <div class="l"><b>${dayLabel(d)}</b><span class="muted">${sh.noClock ? (c.hours > 0 ? fmtDur(c.hours) : 'không rõ giờ') : fmtTime(sh.start) + '–' + fmtTime(sh.end) + ' · ' + fmtDur(c.hours)} · ${fmtKm(c.km)} km${sh.trips ? ' · ' + sh.trips + ' chuyến' : ''}</span>${c.bonus ? `<span class="muted">gồm tip/thưởng ${fmtMoney(c.bonus)}</span>` : ''}</div>
      <div class="amt ${sgn(c.profit)}">${fmtSigned(c.profit)}<span class="muted small" style="display:block;font-weight:500">thu ${fmtMoney(c.income)}</span></div></button>`;
  }

  function viewShift() {
    const cur = L.lastKnownOdo(S);
    let top;
    if (S.active) {
      const a = S.active;
      top = `<section class="card run"><div class="eyebrow">Đang chạy</div>
        <div class="big" id="timer">${elapsed(a.start)}</div>
        <div class="muted">Bắt đầu ${fmtTime(a.start)} · odo đầu ${fmtInt(a.odoStart)} km</div>
        <button class="btn primary lg" data-act="end-shift">Kết thúc ca</button>
        <button class="link danger" data-act="cancel-shift">Huỷ ca này</button></section>`;
    } else {
      top = `<section class="card"><h2>Bắt đầu ca</h2>
        ${intField('startOdo', 'Odo hiện tại', '', { ph: cur ? fmtInt(cur) : 'vd 12.345', suf: 'km', hint: cur ? `Nhìn đồng hồ xe rồi nhập. Odo gần nhất đã ghi: ${fmtInt(cur)} km.` : 'Nhìn đồng hồ xe rồi nhập. Lần đầu dùng: số này sẽ làm mốc khởi đầu.' })}
        <button class="btn primary lg" data-act="start-shift">Bắt đầu ca</button>
        <button class="link" data-act="manual-shift">Quên bấm? Thêm ca đã chạy</button></section>`;
    }

    const t = L.todayKey();
    const td = L.summarize(S, t, t);
    const today = td.nShifts
      ? `<section class="card"><div class="eyebrow">Hôm nay</div>
          <div class="metrics" style="margin-top:8px">
            <div class="metric"><div class="k">Tổng thu</div><div class="v">${fmtMoney(td.income)}</div></div>
            <div class="metric"><div class="k">Lãi chưa trừ hao mòn</div><div class="v ${sgn(td.profit + td.wear)}">${fmtSigned(td.profit + td.wear)}</div></div>
            <div class="metric"><div class="k">Hao mòn (bỏ quỹ bảo trì)</div><div class="v">${fmtMoney(td.wear)}</div></div>
            <div class="metric"><div class="k">Lãi sau hao mòn</div><div class="v ${sgn(td.profit)}">${fmtSigned(td.profit)}</div></div>
            <div class="metric"><div class="k">Km / giờ</div><div class="v">${fmtKm(td.km)} km ·${fmtDur(td.hours)}</div></div>
            <div class="metric"><div class="k">Lãi / giờ</div><div class="v">${fmtMoney(td.perHour)}</div></div>
          </div></section>` : '';

    const recent = sortedDesc(S.shifts, x => x.start).slice(0, 12);
    const list = recent.length
      ? `<section class="card tight"><div class="group-h">Các ca gần đây</div>${recent.map(shiftRow).join('')}</section>`
      : `<div class="empty">Chưa có ca nào.<br>Bấm "Bắt đầu ca" trước khi chạy, và "Kết thúc ca" khi xong.</div>`;
    const extraBtn = S.shifts.length
      ? `<button class="btn" data-act="add-extra" style="margin:0 0 14px">＋ Thêm tip / thưởng cho một ca đã chạy</button>` : '';
    return top + priceAlert() + extraBtn + today + list;
  }

  // ---- Sheet: kết thúc / thêm / sửa ca
  function shiftSheet(mode, sh) {
    const now = new Date();
    let start, end, oS = '', oE = '', net = '', bonus = '', trips = '';
    if (mode === 'end') { start = S.active.start; end = now.toISOString(); oS = S.active.odoStart; }
    else if (mode === 'edit') { start = sh.start; end = sh.end; oS = sh.odoStart; oE = sh.odoEnd; net = sh.net; bonus = sh.bonus || ''; trips = sh.trips || ''; }
    else { end = now.toISOString(); start = new Date(now - 2 * 3600e3).toISOString(); }
    const title = mode === 'end' ? 'Kết thúc ca' : mode === 'edit' ? 'Sửa ca' : 'Thêm ca đã chạy';
    const ctx = mode === 'end' ? `Odo đầu ca: <b>${fmtInt(oS)} km</b>` : '';
    const timeBlock = `<div>
        <div class="fld"><label for="f-start">Bắt đầu</label><input id="f-start" type="datetime-local" value="${toLocalInput(start)}"></div>
        <div class="fld"><label for="f-end">Kết thúc</label><input id="f-end" type="datetime-local" value="${toLocalInput(end)}"></div></div>`;
    const extrasBlock = mode === 'edit' ? extrasHtml(sh) : '';
    const body = `${ctx ? `<p class="muted" style="margin:0 0 10px">${ctx}</p>` : ''}
      ${mode === 'end' ? '' : intField('f-oS', 'Odo đầu ca', oS, { suf: 'km' })}
      ${intField('f-oE', 'Odo cuối ca', oE, { suf: 'km', focus: mode !== 'edit', ph: mode === 'end' ? '' : '' })}
      ${moneyField('f-net', 'Thu nhập ròng trên app Grab', net, { hint: 'Số app đã trừ phí sàn.' })}
      ${moneyField('f-bonus', 'Tip tiền mặt / thưởng đã biết (nếu có)', bonus, { hint: 'Tip qua app hoặc thưởng về sau thì thêm sau bằng nút "Thêm tip / thưởng cho một ca đã chạy".' })}
      ${intField('f-trips', 'Số chuyến (tuỳ chọn)', trips, { suf: 'chuyến' })}
      ${mode === 'end' ? `<details><summary>Sửa giờ hoặc odo đầu ca</summary>${timeBlock}${intField('f-oS', 'Odo đầu ca', oS, { suf: 'km' })}</details>` : timeBlock}
      ${extrasBlock}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-shift" data-mode="${mode}" data-id="${sh ? sh.id : ''}">${mode === 'edit' ? 'Lưu thay đổi' : 'Lưu ca'}</button>
      ${mode === 'edit' ? `<button class="link danger" data-act="del-shift" data-id="${sh.id}">Xoá ca này</button>` : ''}`;
    openSheet(title, body);
  }

  const XTYPE = { tipcash: 'Tip tiền mặt', tipapp: 'Tip qua app', bonus: 'Thưởng' };
  const fmtDM = iso => { const d = new Date(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); };
  const shiftChipLabel = sh => dayLabel(new Date(sh.start)) + (sh.noClock ? '' : ' · ' + fmtTime(sh.start));

  function extrasHtml(sh) {
    return `<div class="group-h" style="padding-left:0">Tip / thưởng thêm sau</div>
      ${(sh.extras || []).map(x => `<div class="kv"><span>${XTYPE[x.type] || 'Khác'} · thêm ${fmtDM(x.at)}</span><span><b>${fmtMoney(x.amount)}</b> <button type="button" class="chip" data-act="del-extra" data-shift="${sh.id}" data-id="${x.id}">Xoá</button></span></div>`).join('') || '<div class="hint" style="margin:0 0 6px">Chưa có.</div>'}
      <button type="button" class="btn sm" data-act="add-extra" data-shift="${sh.id}" style="margin:6px 0 12px">＋ Thêm tip / thưởng</button>`;
  }

  // ---- Sheet "nhập bù": chọn ngày, ghi km (có thể không có odo) và giờ (có thể không nhớ)
  function simpleSheet(sh, preset) {
    const edit = !!sh;
    const dKey = edit ? L.dateKey(new Date(sh.start)) : ((preset && preset.date) || L.todayKey());
    const useOdo = edit ? (sh.km == null && sh.odoStart > 0) : !!(preset && preset.useOdo);
    const hrs = edit ? (new Date(sh.end) - new Date(sh.start)) / 3600e3 : 0;
    const km = edit ? L.shiftCalc(sh, S).km : '';
    openSheet(edit ? 'Sửa ca' : 'Nhập ca đã chạy', `
      ${dateField('f-date', 'Ngày chạy', dKey)}
      <label class="l">Cách ghi quãng đường</label>
      <div class="seg" id="kmseg">
        <button type="button" class="${useOdo ? '' : 'on'}" data-act="km-mode" data-m="km">Chỉ biết số km</button>
        <button type="button" class="${useOdo ? 'on' : ''}" data-act="km-mode" data-m="odo">Có số odo</button></div>
      <div id="box-km" ${useOdo ? 'hidden' : ''}>${decField('f-km', 'Số km đã chạy Grab', useOdo ? '' : (km === '' ? '' : Math.round(km * 10) / 10), { suf: 'km', focus: !edit, ph: 'vd 43,2' })}</div>
      <div id="box-odo" ${useOdo ? '' : 'hidden'}>
        ${intField('f-oS', 'Odo đầu ca', edit && useOdo ? sh.odoStart : '', { suf: 'km' })}
        ${intField('f-oE', 'Odo cuối ca', edit && useOdo ? sh.odoEnd : '', { suf: 'km' })}</div>
      <div class="fld"><label for="f-hours">Số giờ chạy (tuỳ chọn)</label>
        <div class="inwrap noK"><input id="f-hours" inputmode="decimal" autocomplete="off" placeholder="vd 2,5" value="${hrs > 0 ? String(Math.round(hrs * 100) / 100).replace('.', ',') : ''}"><span class="suf">giờ</span></div>
        <div class="hint">Bỏ trống nếu không nhớ: ca này sẽ không được tính vào lãi/giờ.</div></div>
      ${moneyField('f-net', 'Thu nhập ròng trên app Grab', edit ? sh.net : '')}
      ${moneyField('f-bonus', 'Tip / thưởng (nếu có)', edit ? (sh.bonus || '') : '')}
      ${intField('f-trips', 'Số chuyến (tuỳ chọn)', edit ? (sh.trips || '') : '', { suf: 'chuyến' })}
      ${edit ? extrasHtml(sh) : ''}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-shift2" data-id="${edit ? sh.id : ''}">${edit ? 'Lưu thay đổi' : 'Lưu ca'}</button>
      ${edit ? `<button class="link danger" data-act="del-shift" data-id="${sh.id}">Xoá ca này</button>`
        : `<button class="btn" style="margin-top:10px" data-act="save-shift2" data-next="1">Lưu và nhập ngày kế tiếp</button>`}`);
  }

  // ---- Sheet: thêm tip / thưởng đến sau cho một ca (cộng vào đúng ngày chạy của ca đó)

  function extraSheet(shiftId) {
    let list = sortedDesc(S.shifts, x => x.start).slice(0, 7);
    if (!list.length) { toast('Chưa có ca nào để thêm tip/thưởng'); return; }
    if (shiftId && !list.some(x => x.id === shiftId)) {
      const s = S.shifts.find(x => x.id === shiftId); if (s) list = [s].concat(list);
    }
    const sel = shiftId || list[0].id;
    openSheet('Thêm tip / thưởng cho ca', `
      <label class="l">Cho ca nào? <span class="muted small">(tiền được tính vào đúng ngày chạy ca đó)</span></label>
      <div class="chips" id="xshifts">${list.map(s => `<button type="button" class="chip ${s.id === sel ? 'on' : ''}" data-act="pick-xshift" data-id="${s.id}">${shiftChipLabel(s)}</button>`).join('')}</div>
      <input type="hidden" id="f-xshift" value="${sel}">
      <label class="l">Loại</label>
      <div class="chips" id="xtypes">${Object.keys(XTYPE).map((k, i) => `<button type="button" class="chip ${i === 1 ? 'on' : ''}" data-act="pick-xtype" data-k="${k}">${XTYPE[k]}</button>`).join('')}</div>
      <input type="hidden" id="f-xtype" value="tipapp">
      ${moneyField('f-amt', 'Số tiền', '', { focus: true })}
      <div class="hint" style="margin:-6px 0 10px">Chỉ nhập khoản chưa có trong "thu nhập ròng" bạn đã ghi cho ca đó, để không bị cộng trùng.</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-extra">Cộng vào ca</button>`);
  }

  function showShiftResult(sh) {
    const c = L.shiftCalc(sh, S);
    openSheet('Kết quả ca vừa chạy', `
      <div class="center" style="margin:6px 0 14px">
        <div class="eyebrow">Lãi ca này</div>
        <div class="big ${sgn(c.profit)}">${fmtSigned(c.profit)}</div>
        <div class="muted">${fmtKm(c.km)} km · ${fmtDur(c.hours)}</div></div>
      <div class="flow">
        <div class="ln"><span>Thu (app${c.bonus ? ' + thưởng/tip' : ''})</span><b>${fmtMoney(c.income)}</b></div>
        <div class="ln"><span class="muted">− Xăng (ước theo km)</span><span>${fmtMoney(c.fuel)}</span></div>
        <div class="ln mid"><span>Lãi chưa trừ hao mòn</span><span class="${sgn(c.profit + c.wear)}">${fmtSigned(c.profit + c.wear)}</span></div>
        <div class="ln"><span class="muted">− Hao mòn xe (bỏ vào quỹ bảo trì)</span><span>${fmtMoney(c.wear)}</span></div>
        <div class="ln sum"><span>Lãi sau hao mòn</span><span class="${sgn(c.profit)}">${fmtSigned(c.profit)}</span></div>
      </div>
      <div class="metrics" style="margin:14px 0">
        <div class="metric"><div class="k">Lãi / km</div><div class="v">${fmtMoney(c.perKm)}</div></div>
        <div class="metric"><div class="k">Lãi / giờ</div><div class="v">${fmtMoney(c.perHour)}</div></div></div>
      <button class="btn primary" data-act="close-sheet">Xong</button>`);
  }

  // ---------------------------------------------------------------- màn hình: CHI
  function viewSpend() {
    const m = L.monthRange(0);
    const sum = L.summarize(S, m.from, m.to);
    const head = `<section class="card">
      <div class="eyebrow">${m.label}</div>
      <div class="metrics" style="margin-top:8px">
        <div class="metric"><div class="k"><span class="badge ride">Chạy xe</span></div><div class="v">${fmtMoney(sum.rideExp)}</div><div class="muted small">chưa gồm xăng, hao mòn</div></div>
        <div class="metric"><div class="k"><span class="badge personal">Cá nhân</span></div><div class="v">${fmtMoney(sum.personal)}</div><div class="muted small">lấy từ tiền Grab</div></div>
        <div class="metric"><div class="k"><span class="badge saving">Để dành</span></div><div class="v">${fmtMoney(sum.saving)}</div></div>
        <div class="metric"><div class="k">Lợi nhuận chạy xe</div><div class="v ${sgn(sum.profit)}">${fmtSigned(sum.profit)}</div></div>
      </div>
      <button class="btn primary lg" data-act="add-expense">+ Thêm khoản chi</button></section>`;
    const items = sortedDesc(S.expenses, e => e.date + e.id).slice(0, 80);
    const money = cashCards();
    if (!items.length) return money + head + `<div class="empty">Chưa có khoản chi nào.<br>Ghi cả khoản chạy xe (rửa xe, gửi xe...) lẫn tiền bạn lấy từ thu nhập Grab để dùng riêng.</div>`;
    const groups = {};
    items.forEach(e => (groups[e.date] = groups[e.date] || []).push(e));
    const html = Object.keys(groups).sort().reverse().map(k =>
      `<div class="group-h">${keyLabel(k)}</div>` + groups[k].map(e =>
        `<button class="row" data-act="edit-expense" data-id="${e.id}"><div class="l"><span class="badge ${e.type}">${L.TYPE_LABEL[e.type]}</span><b>${esc(e.category)}</b>${e.note ? `<span class="muted">${esc(e.note)}</span>` : ''}</div><div class="amt">${fmtMoney(e.amount)}</div></button>`).join('')
    ).join('');
    return money + head + `<section class="card tight">${html}</section>`;
  }

  // ---- Tiền đang cầm, kiểm kê, quỹ sửa xe
  const WALLETS = [['cash', 'Tiền mặt đang cầm'], ['income', 'Ví thu nhập Grab'], ['topup', 'Ví nạp Grab'], ['bank', 'Tài khoản ngân hàng'], ['fund', 'Quỹ bảo trì để riêng']];

  function cashCards() {
    const p = L.grabPot(S);                              // chạy được cả khi chưa nhập vốn (coi vốn = 0)
    const cap = S.capital || L.implicitCapital(S) || {};
    const implicit = !S.capital;
    if (!p) {
      return `<section class="card"><div class="eyebrow">Tiền Grab đang cầm</div>
        <h2 style="margin-top:6px">Thiết lập vốn ban đầu</h2>
        <p class="muted small" style="margin:0 0 4px">Nhập một lần số tiền bạn đang có từ trước (ví dụ lợi nhuận tháng vừa rồi). Số này <b>không tính là thu nhập</b>, chỉ là mốc để app đối soát với tiền thật.</p>
        <button class="btn primary lg" data-act="set-capital">Nhập vốn ban đầu</button></section>`;
    }
    const cd = cap.date.slice(8) + '/' + cap.date.slice(5, 7);
    const last = sortedDesc(S.checks, c => c.at).slice(0, 3);
    const ex = L.grabExcluded(S);
    const warn = implicit
      ? `<div class="alert"><div>ℹ️ <b>Bạn chưa nhập vốn ban đầu</b> nên app tính Tiền Grab từ 0 kể từ ${cd}, mọi ca đã nhập đều được cộng. Nếu bạn có sẵn một số tiền Grab từ trước, bấm "Nhập vốn" bên dưới.</div></div>`
      : ex.n ? `<div class="alert bad"><div>⚠️ <b>${ex.n} ca (thu ${fmtMoney(ex.income)}) không được cộng</b> vì nằm từ ngày chốt vốn (${cd}) trở về trước: app coi chúng đã nằm trong vốn. Nếu chưa tính vào vốn, hãy lùi ngày chốt vốn lên sớm hơn ca đầu tiên, hoặc xoá vốn để tính từ 0.</div><button class="btn sm" data-act="set-capital">Sửa vốn</button></div>` : '';
    return `${warn}<section class="card flow"><div class="eyebrow">Tiền Grab đang cầm (theo app)</div>
        <div class="ln" style="margin-top:6px"><span>Vốn ban đầu <span class="muted small">(${implicit ? 'chưa nhập, tính từ 0' : 'chốt ' + cd})</span></span><span>${fmtMoney(p.cap)}</span></div>
        <div class="ln"><span>+ Thu nhập các ca <span class="muted small">(thu ròng + tip)</span></span><span>${fmtMoney(p.income)}</span></div>
        <div class="ln"><span>− Xăng đã đổ</span><span>${fmtMoney(p.fuelPaid)}</span></div>
        ${p.fuelPaid > 0 ? `<div class="ln sub"><span>trong đó xăng đi làm / chênh tồn bình</span><span>${fmtMoney(p.commuteFuel)}</span></div>` : ''}
        <div class="ln"><span>− Bảo dưỡng, sửa xe đã trả</span><span>${fmtMoney(p.repairPaid)}</span></div>
        <div class="ln"><span>− Chi chạy xe khác</span><span>${fmtMoney(p.rideExp)}</span></div>
        <div class="ln"><span>− Chi cá nhân</span><span>${fmtMoney(p.personal)}</span></div>
        ${p.adjust ? `<div class="ln"><span>± Điều chỉnh sau kiểm kê</span><span>${fmtSigned(p.adjust)}</span></div>` : ''}
        <div class="ln sum"><span>Tiền đang cầm</span><span>${fmtMoney(p.expected)}</span></div>
      </section>
      <section class="card flow"><div class="eyebrow">Quỹ bảo trì (hao mòn xe)</div>
        <div class="ln" style="margin-top:6px"><span>Đã trích <span class="muted small">(km Grab × ${fmtInt(S.settings.wearPerKm)}đ${cap.fund ? ', gồm quỹ đầu ' + fmtMoney(cap.fund) : ''})</span></span><span>${fmtMoney((cap.fund || 0) + p.wearAccr)}</span></div>
        <div class="ln"><span>− Đã trả bảo dưỡng, sửa xe</span><span>${fmtMoney(p.repairPaid)}</span></div>
        <div class="ln sum"><span>Cần có trong quỹ</span><span class="${p.fund < 0 ? 'neg' : ''}">${fmtMoney(p.fund)}</span></div>
        <div class="ln"><span>Đang tách riêng <span class="muted small">(bên ngoài)</span></span><span>${fmtMoney(p.envelope)}</span></div>
        ${p.toSetAside > 0.5
        ? `<div class="alert" style="margin:8px 0 10px"><div>👉 <b>Cần tách thêm ${fmtMoney(p.toSetAside)}</b> ra để riêng cho bảo trì.</div></div>`
        : p.toSetAside < -0.5
          ? `<div class="alert ok" style="margin:8px 0 10px"><div>✅ Đã tách dư ${fmtMoney(-p.toSetAside)} so với cần có.</div></div>`
          : `<div class="alert ok" style="margin:8px 0 10px"><div>✅ Quỹ đã đủ, không cần tách thêm.</div></div>`}
        ${p.fund < 0 ? '<div class="hint" style="margin:-4px 0 8px">Quỹ đang âm: đã chi sửa xe vượt phần trích (phần thiếu lấy từ tiền khác, thường là phần đi làm). Có thể tăng hao mòn/km trong Cài đặt.</div>' : ''}
        <button class="btn primary" data-act="put-fund">Đã tách tiền vào quỹ</button>
        ${S.fundPuts.length ? `<div class="group-h" style="padding-left:0;margin-top:8px">Các lần đã tách gần đây</div>${sortedDesc(S.fundPuts, f => f.date + f.id).slice(0, 4).map(f => `<div class="kv"><span>${keyLabel(f.date)}</span><span><b>${fmtMoney(f.amount)}</b> <button type="button" class="chip" data-act="del-put" data-id="${f.id}">Xoá</button></span></div>`).join('')}` : ''}
      </section>
      <section class="card"><div class="eyebrow">Chia ra</div>
        <div class="kv" style="margin-top:6px"><span>🔧 Quỹ bảo trì (cần giữ)</span><b>${fmtMoney(Math.max(0, p.fund))}</b></div>
        <div class="kv"><span>🏦 Để dành</span><b>${fmtMoney(p.saved)}</b></div>
        <div class="kv" style="border-top:1.5px solid var(--text);margin-top:6px;padding-top:10px"><span style="color:var(--text);font-weight:700">✅ Tiền tiêu được</span><b class="${sgn(p.spendable)}" style="font-size:18px">${fmtMoney(p.spendable)}</b></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="check-money">Kiểm kê tiền thật</button><button class="btn" data-act="set-capital">${implicit ? 'Nhập vốn' : 'Sửa vốn đầu'}</button></div>
        ${last.length ? `<div class="group-h" style="padding-left:0;margin-top:8px">Các lần kiểm kê gần đây</div>${last.map(c => `<div class="kv"><span>${fmtDM(c.at)} ${fmtTime(c.at)} · thực tế ${fmtMoney(c.total)}</span><b class="${c.diff === 0 ? 'pos' : sgn(c.diff)}">${c.diff === 0 ? 'khớp' : fmtSigned(c.diff)}</b></div>`).join('')}` : ''}
      </section>`;
  }

  function capitalSheet() {
    const c = S.capital;
    openSheet(c ? 'Sửa vốn ban đầu' : 'Vốn ban đầu', `
      <p class="muted small" style="margin:0 0 12px">Số tiền bạn đang có từ trước (ví dụ lợi nhuận tháng vừa rồi). Không tính là thu nhập. Chỉ các ca, khoản chi, đổ xăng, bảo dưỡng <b>sau ngày chốt</b> mới được cộng hoặc trừ vào.</p>
      ${dateField('f-date', 'Ngày chốt (tiền tính tới hết ngày này)', c ? c.date : L.lastDayOfPrevMonth())}
      ${moneyField('f-cap', 'Tổng vốn ban đầu', c ? c.total : '', { focus: true })}
      ${moneyField('f-capfund', 'Trong đó đã để dành cho sửa xe (tuỳ chọn)', c && c.fund ? c.fund : '', { hint: 'Bỏ trống nếu quỹ sửa xe bắt đầu từ 0.' })}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-capital">Lưu</button>
      ${c ? '<button class="link danger" data-act="del-capital">Xoá vốn ban đầu</button>' : ''}`);
  }

  function checkTotal() {
    let t = 0, any = false;
    WALLETS.forEach(w => { const v = getInt('f-w-' + w[0]); if (!isNaN(v)) { t += v; any = true; } });
    return any ? t : null;
  }
  function updateCheckSummary() {
    const el = $('#chk-sum'); if (!el) return;
    const exp = Number(el.dataset.expected), t = checkTotal();
    const d = t == null ? 0 : t - exp;
    el.innerHTML = `<div class="kv"><span>Tổng thực tế</span><b>${t == null ? '—' : fmtMoney(t)}</b></div>
      <div class="kv"><span>Theo app</span><b>${fmtMoney(exp)}</b></div>` + (t == null ? '' :
      `<div class="kv"><span>Chênh lệch</span><b class="${d === 0 ? 'pos' : sgn(d)}">${d === 0 ? 'Khớp' : fmtSigned(d)}</b></div>
       <div class="hint">${d > 0 ? 'Thực tế nhiều hơn app: có thể quên ghi một khoản thu/tip, hoặc ghi dư một khoản chi.' : d < 0 ? 'Thực tế ít hơn app: có thể quên ghi một khoản chi (xăng, ăn uống...) hoặc ghi dư thu nhập.' : 'Số liệu khớp với tiền thật.'}</div>`);
  }
  function checkSheet() {
    const p = L.grabPot(S);
    if (!p) { toast('Hãy nhập vốn ban đầu trước'); return; }
    openSheet('Kiểm kê tiền thật', `
      <p class="muted small" style="margin:0 0 12px">Nhập số dư thật ở từng nơi đang giữ tiền Grab (bỏ trống nếu không có).</p>
      ${WALLETS.map((w, i) => moneyField('f-w-' + w[0], w[1], '', { focus: i === 0 })).join('')}
      <div class="card" id="chk-sum" data-expected="${Math.round(p.expected)}" style="margin:0 0 12px;background:var(--bg);box-shadow:none"></div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-check">Lưu kiểm kê</button>
      <button class="btn" style="margin-top:10px" data-act="save-check" data-adjust="1">Lưu và ghi điều chỉnh chênh lệch</button>
      <div class="hint">"Ghi điều chỉnh" làm số theo app khớp lại với tiền thật, để các lần kiểm kê sau không bị lệch tiếp.</div>`);
    updateCheckSummary();
  }

  function catsFor(type) {
    const used = S.expenses.filter(e => e.type === type).map(e => e.category);
    return Array.from(new Set(L.CATS[type].concat(used)));
  }
  function chipsHtml(type, selected) {
    return catsFor(type).map(c => `<button type="button" class="chip ${c === selected ? 'on' : ''}" data-act="pick-cat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  }
  function expenseSheet(e) {
    expType = e ? e.type : (expType || 'ride');
    const sel = e ? e.category : catsFor(expType)[0];
    const body = `
      ${moneyField('f-amt', 'Số tiền', e ? e.amount : '', { focus: !e })}
      <label class="l">Loại khoản chi</label>
      <div class="seg t-${expType}" id="seg">${['ride', 'personal', 'saving'].map(t => `<button type="button" class="${t === expType ? 'on' : ''}" data-act="exp-type" data-t="${t}">${L.TYPE_LABEL[t]}</button>`).join('')}</div>
      <div class="hint" id="type-hint" style="margin:-6px 0 10px">${typeHint(expType)}</div>
      <label class="l">Danh mục</label>
      <div class="chips" id="chips">${chipsHtml(expType, sel)}</div>
      <input type="hidden" id="f-cat" value="${esc(sel)}">
      ${textField('f-cat2', 'Hoặc gõ danh mục khác', '', 'ví dụ: Thuốc, Học phí...')}
      ${textField('f-note', 'Ghi chú (tuỳ chọn)', e ? e.note : '', '')}
      ${dateField('f-date', 'Ngày', e ? e.date : L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-expense" data-id="${e ? e.id : ''}">${e ? 'Lưu thay đổi' : 'Lưu khoản chi'}</button>
      ${e ? `<button class="link danger" data-act="del-expense" data-id="${e.id}">Xoá khoản này</button>` : ''}`;
    openSheet(e ? 'Sửa khoản chi' : 'Thêm khoản chi', body);
  }
  function typeHint(t) {
    return t === 'ride' ? 'Chi phí để chạy xe: trừ vào lợi nhuận. (Xăng và hao mòn đã tự tính theo km, đừng nhập lại.)'
      : t === 'personal' ? 'Tiền lấy từ thu nhập Grab để dùng riêng. Khoản chi cá nhân mới nên ghi ở tab Giao dịch (chọn tài khoản "Tiền Grab") để liên thông với sổ tài chính.'
        : 'Tiền bạn tách ra để dành từ thu nhập Grab.';
  }

  // ---------------------------------------------------------------- màn hình: XE
  function viewCar() {
    const cur = L.lastKnownOdo(S);
    const oil = L.oilStatus(S);
    const fr = L.fuelRate(S);
    const legacyShifts = S.shifts.filter(sh => sh.fuelPrice == null).length;
    const sug = L.wearSuggestion(S);

    let oilCard;
    if (!oil.has) {
      oilCard = `<div class="alert"><div>🛢️ <b>Chưa có mốc thay nhớt.</b> Sau khi thay, bấm "Ghi thay nhớt" để bắt đầu đếm km (nhắc sau mỗi ${fmtInt(oil.iv)} km).</div></div>`;
    } else {
      const cls = oil.remaining < 0 ? 'over' : oil.remaining <= 300 ? 'warn' : '';
      oilCard = `<section class="card"><div class="eyebrow">Thay nhớt</div>
        <div class="progress ${cls}"><i style="width:${Math.round(oil.pct * 100)}%"></i></div>
        <div class="kv"><span>Đã đi từ lần thay (odo ${fmtInt(oil.lastOdo)})</span><b>${fmtInt(oil.since)} km</b></div>
        <div class="kv"><span>${oil.remaining >= 0 ? 'Còn lại tới hạn' : 'Quá hạn'}</span><b class="${oil.remaining < 0 ? 'neg' : ''}">${fmtInt(Math.abs(oil.remaining))} km</b></div></section>`;
    }

    const head = `<section class="card"><div class="eyebrow">Odo gần nhất</div>
      <div class="big">${fmtInt(cur)} <span class="muted" style="font-size:18px">km</span></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-act="add-odo">Cập nhật odo</button>
        <button class="btn" data-act="add-fill">⛽ Đổ xăng</button></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-act="add-maint" data-item="Nhớt">🛢️ Ghi thay nhớt</button>
        <button class="btn" data-act="add-maint">🔧 Bảo dưỡng khác</button></div></section>`;

    const rates = `<section class="card"><div class="eyebrow">Đơn giá đang dùng để tính lãi</div>
      <div class="kv" style="margin-top:6px"><span>Mức tiêu hao</span><b>${fr.l100.toFixed(2).replace('.', ',')} lít/100km</b></div>
      <div class="hint" style="margin:-2px 0 6px">${fr.source === 'learned' ? `Học từ ${fr.n} khoảng đổ đầy bình (${fmtInt(fr.dist)} km, ${fr.liters.toFixed(1).replace('.', ',')} lít), không phụ thuộc giá xăng.` : 'Đang dùng số ước tính ở Cài đặt. Đổ đầy bình ≥ 2 lần kèm odo (tổng ≥ 100 km) thì app tự học số thật.'}</div>
      <div class="kv"><span>Giá xăng hôm nay</span><b>${fmtInt(fr.price)}đ/lít</b></div>
      <div class="hint" style="margin:-2px 0 6px">Xăng mỗi ca = km × mức tiêu hao × giá xăng của ngày chạy. Giá đổi chỉ ảnh hưởng các ca từ ngày đó trở đi.</div>
      <div class="kv"><span>→ Xăng hiện tại</span><b>${fmtInt(fr.rate)}đ/km</b></div>
      ${legacyShifts ? `<div class="alert" style="margin:10px 0"><div><b>${legacyShifts} ca</b> đang dùng đơn giá xăng/km cũ đã lưu. Bấm để tính lại theo mức tiêu hao mới và giá xăng đúng ngày chạy.</div><button class="btn sm" data-act="recalc-fuel" style="margin:0">Tính lại</button></div>` : ''}
      <div class="kv"><span>Hao mòn xe</span><b>${fmtInt(S.settings.wearPerKm)}đ/km</b></div>
      ${sug ? `<div class="alert ok" style="margin:8px 0 0"><div>Chi bảo dưỡng thật ≈ <b>${fmtInt(sug.perKm)}đ/km</b> (${fmtMoney(sug.cost)} / ${fmtInt(sug.km)} km). Bạn có thể chỉnh trong Cài đặt.</div></div>` : `<div class="hint">Sau vài lần bảo dưỡng (≥ 3.000 km) tool sẽ gợi ý chỉnh lại số này.</div>`}</section>`;

    // đổ xăng
    // Đơn giá giữa hai lần đổ đầy liên tiếp (chỉ tính khi cả hai có odo và không có lần đổ thiếu odo ở giữa)
    const odoFills = S.fills.filter(f => f.odo > 0).sort((a, b) => a.odo - b.odo);
    const stat = {};
    odoFills.forEach((f, i) => {
      const prev = odoFills.slice(0, i).reverse().find(p => p.full !== false);
      if (!prev || f.full === false) return;
      const gap = S.fills.some(x => !(x.odo > 0) && x.date > prev.date && x.date <= f.date);
      const km = f.odo - prev.odo;
      if (km > 0 && !gap) stat[f.id] = { km, l100: L.litersOf(f, S) / km * 100 };
    });
    const shownFills = sortedDesc(S.fills, f => f.date + String(f.odo || 0).padStart(8, '0')).slice(0, 15);
    const fillList = shownFills.length ? `<section class="card tight"><div class="group-h">Lịch sử đổ xăng</div>${shownFills.map(f => {
      const st = stat[f.id];
      return `<button class="row" data-act="edit-fill" data-id="${f.id}"><div class="l"><b>${keyLabel(f.date)}</b><span class="muted">${f.odo > 0 ? 'odo ' + fmtInt(f.odo) : 'chưa có odo'} · ${f.pricePerL ? fmtInt(f.pricePerL) + 'đ/lít' : 'chưa có giá/lít'} · ${L.litersOf(f, S).toFixed(2).replace('.', ',')} lít${f.full === false ? ' · chưa đầy' : ''}${st ? ` · ${fmtInt(st.km)} km · ${st.l100.toFixed(2).replace('.', ',')} L/100km` : ''}</span></div><div class="amt">${fmtMoney(f.amount)}</div></button>`;
    }).join('')}</section>` : '';

    const maint = sortedDesc(S.maint, m => m.odo).slice(0, 15);
    const maintList = maint.length ? `<section class="card tight"><div class="group-h">Lịch sử bảo dưỡng</div>${maint.map(m =>
      `<button class="row" data-act="edit-maint" data-id="${m.id}"><div class="l"><b>${esc(m.item)}</b><span class="muted">${keyLabel(m.date)} · odo ${fmtInt(m.odo)}${m.note ? ' · ' + esc(m.note) : ''}</span></div><div class="amt">${fmtMoney(m.cost)}</div></button>`).join('')}</section>` : '';

    return head + oilCard + rates + fillList + maintList;
  }

  function odoSheet() {
    openSheet('Cập nhật odo', `
      ${intField('f-odo', 'Số odo hiện tại', '', { suf: 'km', focus: true, ph: fmtInt(L.lastKnownOdo(S)) })}
      <div class="hint" style="margin:-6px 0 10px">Dùng khi bạn muốn ghi lại odo thật (ví dụ ngày không chạy Grab) để nhắc bảo dưỡng chính xác.</div>
      ${dateField('f-date', 'Ngày', L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-odo">Lưu odo</button>`);
  }

  function fillSheet(f) {
    openSheet(f ? 'Sửa lần đổ xăng' : 'Đổ xăng', `
      ${moneyField('f-amt', 'Số tiền đổ', f ? f.amount : '', { focus: !f })}
      ${moneyField('f-ppl', 'Giá xăng trên máy bơm (đ/lít)', f ? (f.pricePerL || (f.liters > 0 ? Math.round(f.amount / f.liters) : '')) : L.priceOn(S, L.todayKey()), { noZeros: true })}
      <div class="hint" id="fill-liters" style="margin:-6px 0 12px"></div>
      ${intField('f-odo', 'Odo lúc đổ', f && f.odo > 0 ? f.odo : '', { suf: 'km', ph: fmtInt(L.lastKnownOdo(S)), hint: 'Nên nhập mỗi lần để app học mức tiêu hao. Không nhớ thì để trống: khoản này vẫn tính vào tiền xăng đã đổ.' })}
      <label class="check"><input type="checkbox" id="f-full" ${!f || f.full !== false ? 'checked' : ''}> Đã đổ đầy bình</label>
      <div class="hint" style="margin:-6px 0 10px">Đổ đầy bình mỗi lần thì app tính được mức tiêu hao lít/100km chính xác.</div>
      ${dateField('f-date', 'Ngày', f ? f.date : L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-fill" data-id="${f ? f.id : ''}">${f ? 'Lưu thay đổi' : 'Lưu'}</button>
      ${f ? `<button class="link danger" data-act="del-fill" data-id="${f.id}">Xoá</button>` : ''}`);
    updateFillLiters();
  }
  // Hiện số lít ước tính ngay khi nhập tiền và giá/lít
  function updateFillLiters() {
    const el = $('#fill-liters'); if (!el) return;
    const a = getInt('f-amt'), p = getInt('f-ppl');
    el.textContent = (!isNaN(a) && !isNaN(p) && p > 0) ? `≈ ${(a / p).toFixed(2).replace('.', ',')} lít` : 'Nhập số tiền và giá/lít để app tự tính số lít.';
  }

  function maintSheet(m, preset) {
    const item = m ? m.item : (preset || 'Nhớt');
    openSheet(m ? 'Sửa bảo dưỡng' : 'Ghi bảo dưỡng', `
      <label class="l">Hạng mục</label>
      <div class="chips" id="chips">${L.MAINT_ITEMS.map(i => `<button type="button" class="chip ${i === item ? 'on' : ''}" data-act="pick-item" data-c="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      <input type="hidden" id="f-item" value="${esc(item)}">
      ${moneyField('f-amt', 'Chi phí (gồm công)', m ? m.cost : '', { focus: !m })}
      ${intField('f-odo', 'Odo lúc làm', m ? m.odo : L.lastKnownOdo(S), { suf: 'km' })}
      <label class="check"><input type="checkbox" id="f-fromfund" ${!m || m.fromFund !== false ? 'checked' : ''}> Trả từ quỹ bảo trì để riêng</label>
      ${textField('f-note', 'Ghi chú (tuỳ chọn)', m ? m.note : '', 'loại nhớt, tiệm...')}
      ${dateField('f-date', 'Ngày', m ? m.date : L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-maint" data-id="${m ? m.id : ''}">${m ? 'Lưu thay đổi' : 'Lưu'}</button>
      ${m ? `<button class="link danger" data-act="del-maint" data-id="${m.id}">Xoá</button>` : ''}`);
  }

  // ---------------------------------------------------------------- màn hình: TỔNG QUAN
  function chartSVG(items, kind) {
    const W = 320, H = 132, padT = 16, padB = 18;
    const vals = items.map(i => i.value);
    const mx = Math.max(0, ...vals), mn = Math.min(0, ...vals);
    const span = (mx - mn) || 1, plotH = H - padT - padB;
    const y0 = padT + (mx / span) * plotH;
    const bw = W / items.length;
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lợi nhuận theo ${kind === 'all' ? 'tháng' : 'ngày'}"><line x1="0" x2="${W}" y1="${y0}" y2="${y0}"/>`;
    items.forEach((it, i) => {
      const h = Math.max(it.value === 0 ? 0 : 1.5, Math.abs(it.value) / span * plotH);
      const x = i * bw + bw * 0.16, w = bw * 0.68;
      const y = it.value >= 0 ? y0 - h : y0;
      out += `<rect class="${it.value >= 0 ? 'pos' : 'neg'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      let lab = '';
      if (kind === 'week') lab = DAYS[L.keyToDate(it.key).getDay()];
      else if (kind === 'month') { const d = Number(it.key.slice(8)); lab = (d === 1 || d % 5 === 0) ? d : ''; }
      else lab = 'T' + Number(it.key.slice(5));
      if (lab !== '') out += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}">${lab}</text>`;
      if (kind === 'week' && it.value !== 0) out += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(it.value >= 0 ? y - 3 : y + h + 9).toFixed(1)}">${fmtShort(it.value)}</text>`;
    });
    return out + '</svg>';
  }

  const periodLabel = r => (r.kind === 'day'
    ? (r.off === 0 ? 'Hôm nay · ' : r.off === -1 ? 'Hôm qua · ' : '') + keyLabel(r.from)
    : r.label);

  // Chi tiết trong một ngày: các ca và khoản chi (bấm để sửa)
  function dayDetail(k) {
    const shifts = sortedDesc(S.shifts.filter(sh => L.dateKey(new Date(sh.start)) === k), x => x.start);
    const exps = S.expenses.filter(e => e.date === k);
    if (!shifts.length && !exps.length) return '';
    return `<section class="card tight"><div class="group-h">Trong ngày</div>${shifts.map(shiftRow).join('')}${exps.map(e =>
      `<button class="row" data-act="edit-expense" data-id="${e.id}"><div class="l"><span class="badge ${e.type}">${L.TYPE_LABEL[e.type]}</span><b>${esc(e.category)}</b>${e.note ? `<span class="muted">${esc(e.note)}</span>` : ''}</div><div class="amt">${fmtMoney(e.amount)}</div></button>`).join('')}</section>`;
  }

  function viewGrabReport() {
    const r = L.rangeFor(S, period.kind, period.off);
    // Kỳ "Tất cả" + có vốn ban đầu: vốn là thu nhập/lợi nhuận của giai đoạn trước, nên được cộng vào tổng;
    // chỉ tính các khoản SAU ngày chốt (trước đó đã nằm trong vốn). Các kỳ Ngày/Tuần/Tháng không cộng vốn.
    const capAll = period.kind === 'all' && S.capital ? S.capital : null;
    const capAmt = capAll ? (capAll.total || 0) : 0;
    let from = r.from;
    if (capAll) { const d = L.keyToDate(capAll.date); d.setDate(d.getDate() + 1); from = L.dateKey(d); }
    const m = L.summarize(S, from, r.to);
    const ser = L.series(r, m.byDay);
    m.income += capAmt; m.profit += capAmt; m.remain += capAmt; // perKm/perHour đã tính riêng từ các ca nên không bị ảnh hưởng

    let html = '';
    // banner nhắc nhớt / sao lưu
    const oil = L.oilStatus(S);
    if (oil.has && oil.remaining <= 300) {
      html += `<div class="alert ${oil.remaining < 0 ? 'bad' : ''}"><div>🛢️ <b>${oil.remaining < 0 ? 'Quá hạn thay nhớt ' + fmtInt(-oil.remaining) + ' km' : 'Sắp tới hạn thay nhớt (còn ' + fmtInt(oil.remaining) + ' km)'}.</b></div></div>`;
    } else if (!oil.has) {
      html += `<div class="alert"><div>🛢️ <b>Chưa có mốc thay nhớt.</b> Khi thay, ghi ở Grab → Xe để app nhắc lần sau.</div></div>`;
    }
    if ((S.shifts.length + S.expenses.length) > 0) {
      const last = S.lastBackup ? new Date(S.lastBackup) : null;
      const days = last ? (Date.now() - last) / 864e5 : Infinity;
      if (days > 7) html += `<div class="alert bad"><div>💾 <b>${last ? 'Đã ' + Math.floor(days) + ' ngày chưa sao lưu.' : 'Bạn chưa sao lưu lần nào.'}</b> Dữ liệu chỉ nằm trên máy này.</div><button class="btn sm" data-act="export">Sao lưu</button></div>`;
    }

    html += priceAlert();
    html += `<div class="period"><div class="seg">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['all', 'Tất cả']].map(p =>
      `<button class="${period.kind === p[0] ? 'on' : ''}" data-act="period" data-k="${p[0]}">${p[1]}</button>`).join('')}</div></div>`;
    if (period.kind !== 'all') {
      html += `<div class="nav-period"><button data-act="prev" aria-label="Kỳ trước">‹</button><b>${periodLabel(r)}</b><button data-act="next" aria-label="Kỳ sau" ${period.off >= 0 ? 'disabled' : ''}>›</button></div>`;
    }

    if (capAll) {
      const cd = capAll.date.slice(8) + '/' + capAll.date.slice(5, 7);
      html += `<div class="hint" style="margin:-4px 0 12px">Tính từ sau ngày chốt vốn (${cd}) và đã cộng vốn ban đầu ${fmtMoney(capAmt)} vào tổng thu. Các khoản ghi trước ngày chốt không tính (đã nằm trong vốn).</div>`;
    }

    if (!m.nShifts && !m.nExpenses && !capAmt) {
      return html + `<div class="empty">Chưa có dữ liệu trong khoảng này.<br>Ghi ca chạy ở Grab → Ca chạy.</div>`;
    }

    const tileMoney = n => (Math.abs(n) >= 1e7 ? fmtShort(n) + 'đ' : fmtMoney(n));
    const tv = (cls, text) => `<div class="v ${cls}" style="font-size:${text.length > 9 ? 14 : 17}px">${text}</div>`; // số dài thì thu nhỏ chữ cho vừa ô
    html += `<div class="tiles">
      <div class="tile in"><div class="k">TỔNG THU</div>${tv('', tileMoney(m.income))}</div>
      <div class="tile out"><div class="k">TỔNG CHI</div>${tv('', tileMoney(m.totalSpend))}</div>
      <div class="tile"><div class="k">CÒN LẠI</div>${tv(sgn(m.remain), (m.remain > 0 ? '+' : '') + tileMoney(m.remain))}</div></div>
      <div class="tiles two">
        <div class="tile"><div class="k">LÃI CHƯA TRỪ HAO MÒN</div>${tv(sgn(m.profit + m.wear), (m.profit + m.wear > 0 ? '+' : '') + tileMoney(m.profit + m.wear))}</div>
        <div class="tile"><div class="k">HAO MÒN → QUỸ BẢO TRÌ</div>${tv('', tileMoney(m.wear))}</div></div>`;

    // Tầng 1
    const segs = [['Xăng', m.fuel, '#e0a030'], ['Hao mòn xe', m.wear, '#8e7cc3'], ['Chi chạy xe khác', m.rideExp, '#4a90d9'], ['Lợi nhuận', Math.max(0, m.profit), 'var(--pos)']];
    const tot = segs.reduce((a, s) => a + s[1], 0) || 1;
    const catLines = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a]).map(k => `<div class="ln sub"><span>${esc(k)}</span><span>${fmtMoney(obj[k])}</span></div>`).join('');
    html += `<section class="card flow"><div class="eyebrow">Chạy xe có lời không?</div>
      <div class="stack" style="margin-top:10px">${segs.map(s => `<i style="width:${(s[1] / tot * 100).toFixed(1)}%;background:${s[2]}"></i>`).join('')}</div>
      <div class="legend">${segs.map(s => `<span style="--c:${s[2]}">${s[0]}</span>`).join('')}</div>
      <div class="ln"><span>Tổng thu <span class="muted small">(thu ròng app${m.bonus ? ' + thưởng/tip' : ''})</span></span><b>${fmtMoney(m.income)}</b></div>
      ${capAmt ? `<div class="ln sub"><span>Thu nhập các ca đã ghi</span><span>${fmtMoney(m.income - capAmt)}</span></div><div class="ln sub"><span>Vốn ban đầu (thu nhập trước ngày chốt)</span><span>${fmtMoney(capAmt)}</span></div>` : ''}
      <div class="ln"><span>− Xăng <span class="muted small">(ước theo km)</span></span><span>${fmtMoney(m.fuel)}</span></div>
      <div class="ln"><span>− Chi phí chạy xe khác</span><span>${fmtMoney(m.rideExp)}</span></div>
      ${catLines(m.rideCats)}
      <div class="ln mid"><span>Lãi chưa trừ hao mòn</span><span class="${sgn(m.profit + m.wear)}">${fmtSigned(m.profit + m.wear)}</span></div>
      <div class="ln"><span>− Hao mòn xe <span class="muted small">(bỏ riêng vào quỹ bảo trì)</span></span><span>${fmtMoney(m.wear)}</span></div>
      <div class="ln sum"><span>Lợi nhuận sau hao mòn</span><span class="${sgn(m.profit)}">${fmtSigned(m.profit)}</span></div></section>`;

    // Tầng 2
    html += `<section class="card flow"><div class="eyebrow">Tiền Grab đi đâu?</div>
      <div class="ln" style="margin-top:6px"><span>Lợi nhuận chạy xe</span><b>${fmtSigned(m.profit)}</b></div>
      <div class="ln"><span>− Chi tiêu cá nhân</span><span>${fmtMoney(m.personal)}</span></div>
      ${catLines(m.personalCats)}
      <div class="ln"><span>− Để dành</span><span>${fmtMoney(m.saving)}</span></div>
      ${catLines(m.savingCats)}
      <div class="ln sum"><span>Còn lại chưa phân bổ</span><span class="${sgn(m.remain)}">${fmtSigned(m.remain)}</span></div></section>`;

    html += `<section class="card"><div class="eyebrow" style="margin-bottom:10px">Hiệu quả</div><div class="metrics">
      <div class="metric"><div class="k">Lãi / km</div><div class="v">${fmtMoney(m.perKm)}</div></div>
      <div class="metric"><div class="k">Lãi / giờ</div><div class="v">${fmtMoney(m.perHour)}</div></div>
      <div class="metric"><div class="k">Km chạy Grab</div><div class="v">${fmtKm(m.km)} km</div></div>
      <div class="metric"><div class="k">Thời gian chạy</div><div class="v">${fmtDur(m.hours)}</div></div>
      <div class="metric"><div class="k">Số ca</div><div class="v">${m.nShifts}</div></div>
      <div class="metric"><div class="k">Số chuyến</div><div class="v">${m.trips || '—'}</div></div></div></section>`;

    html += period.kind === 'day'
      ? dayDetail(r.from)
      : `<section class="card"><div class="eyebrow" style="margin-bottom:8px">Lợi nhuận theo ${period.kind === 'all' ? 'tháng' : 'ngày'}</div>${chartSVG(ser, period.kind)}</section>`;
    return html;
  }

  // ---------------------------------------------------------------- sổ tài chính (Tổng quan, Giao dịch, Tài khoản)
  const acctName = id => (id === GRAB ? 'Tiền Grab' : ((S.accounts.find(a => a.id === id) || {}).name || '(đã xoá)'));
  const dmOf = k => k.slice(8) + '/' + k.slice(5, 7);
  const tileNum = n => (Math.abs(n) >= 1e7 ? fmtShort(n) + 'đ' : fmtMoney(n));
  const tileHtml = (cls, text) => `<div class="v ${cls}" style="font-size:${text.length > 9 ? 14 : 17}px">${text}</div>`;

  function monthNavHtml(off, prevAct, nextAct) {
    const r = L.monthRange(off);
    return `<div class="nav-period"><button data-act="${prevAct}" aria-label="Tháng trước">‹</button><b>${r.label}</b><button data-act="${nextAct}" aria-label="Tháng sau" ${off >= 0 ? 'disabled' : ''}>›</button></div>`;
  }
  function backupAlert() {
    if ((S.shifts.length + S.expenses.length + S.tx.length) === 0) return '';
    const last = S.lastBackup ? new Date(S.lastBackup) : null;
    const days = last ? (Date.now() - last) / 864e5 : Infinity;
    if (days <= 7) return '';
    return `<div class="alert bad"><div>💾 <b>${last ? 'Đã ' + Math.floor(days) + ' ngày chưa sao lưu.' : 'Bạn chưa sao lưu lần nào.'}</b> Dữ liệu chỉ nằm trên máy này.</div><button class="btn sm" data-act="export">Sao lưu</button></div>`;
  }
  function catBars(obj, cls) {
    const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
    const total = keys.reduce((a, k) => a + obj[k], 0) || 1;
    return keys.map(k => `<div class="catrow"><div class="cr-top"><span>${esc(k)}</span><b>${fmtMoney(obj[k])}</b></div><div class="bar"><i class="${cls}" style="width:${(obj[k] / total * 100).toFixed(1)}%"></i></div></div>`).join('');
  }

  // Một dòng giao dịch (của sổ hoặc dòng tiền từ mục Grab); bấm vào để sửa
  function entryRow(e) {
    const act = { tx: 'edit-tx', shift: 'edit-shift', fill: 'edit-fill', maint: 'edit-maint', exp: 'edit-expense' }[e.src];
    let title, sub, amt, cls = '';
    if (e.type === 'transfer') { title = 'Chuyển tiền'; sub = acctName(e.acct) + ' → ' + acctName(e.to); amt = fmtMoney(e.amount); }
    else {
      title = e.adj ? 'Điều chỉnh số dư' : (e.cat || 'Khác');
      sub = [acctName(e.acct), e.note].filter(Boolean).join(' · ');
      amt = (e.type === 'income' ? '+' : '−') + fmtMoney(e.amount); cls = e.type === 'income' ? 'pos' : 'neg';
    }
    if (e.src === 'tx' && S.ledger.start && e.date <= S.ledger.start) sub += (sub ? ' · ' : '') + 'chỉ tham khảo, không tính vào số dư';
    return `<button class="row" data-act="${act}" data-id="${e.id}"><div class="l"><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></div><div class="amt ${cls}">${amt}</div></button>`;
  }

  function viewFinance() {
    const ready = L.ledgerReady(S);
    const r = L.monthRange(finOff);
    const rep = L.periodReport(S, r.from, r.to);
    let html = backupAlert();
    if (!ready) {
      html += `<section class="card"><div class="eyebrow">Sổ tài chính</div>
        <h2 style="margin-top:6px">Bắt đầu sổ tài chính</h2>
        <p class="muted small" style="margin:0 0 4px">Chọn ngày bắt đầu sổ và nhập số dư hiện có của các tài khoản (ví, ngân hàng...). Từ đó lương, chi tiêu, chuyển khoản và thu nhập Grab đều tự liên thông với nhau, dùng được lâu dài.</p>
        <button class="btn primary lg" data-act="tab" data-tab="accounts">Thiết lập ngay</button></section>`;
    } else {
      const b = L.accountBalances(S);
      const rows = S.accounts.map(a => ({ id: a.id, name: a.name, v: b.byId[a.id] })).concat(b.grab == null ? [] : [{ id: GRAB, name: 'Tiền Grab', v: b.grab }]);
      html += `<section class="card"><div class="eyebrow">Tổng tài sản</div>
        <div class="big ${b.total < 0 ? 'neg' : ''}">${fmtMoney(b.total)}</div>
        ${rows.map(a => `<div class="kv"><span>${esc(a.name)}</span><b class="${a.v < 0 ? 'neg' : ''}">${fmtMoney(a.v)}</b></div>`).join('')}
        <button class="link left" data-act="tab" data-tab="accounts">Quản lý tài khoản ›</button></section>`;
    }
    html += monthNavHtml(finOff, 'fin-prev', 'fin-next');
    html += `<div class="tiles">
      <div class="tile in"><div class="k">THU</div>${tileHtml('', tileNum(rep.income))}</div>
      <div class="tile out"><div class="k">CHI</div>${tileHtml('', tileNum(rep.expense))}</div>
      <div class="tile"><div class="k">CHÊNH LỆCH</div>${tileHtml(sgn(rep.net), (rep.net > 0 ? '+' : '') + tileNum(rep.net))}</div></div>`;
    if (ready) html += `<button class="btn primary" data-act="add-tx" style="margin:0 0 14px">＋ Thêm giao dịch</button>`;
    if (rep.expense > 0) html += `<section class="card"><div class="eyebrow" style="margin-bottom:10px">Chi theo danh mục</div>${catBars(rep.expenseCats, '')}</section>`;
    if (rep.income > 0) html += `<section class="card"><div class="eyebrow" style="margin-bottom:10px">Thu theo nguồn</div>${catBars(rep.incomeCats, 'in')}</section>`;
    const recent = L.unifiedEntries(S, r.from, r.to).slice(0, 6);
    if (recent.length) {
      html += `<section class="card tight"><div class="group-h">Giao dịch gần đây</div>${recent.map(entryRow).join('')}<button class="link" data-act="tab" data-tab="ledger">Xem tất cả ›</button></section>`;
    } else if (ready) {
      html += `<div class="empty">Chưa có giao dịch nào trong tháng này.</div>`;
    }
    if (rep.transfers > 0) html += `<p class="hint center">Chuyển tiền giữa các tài khoản (${fmtMoney(rep.transfers)}) không tính là thu hay chi.</p>`;
    return html;
  }

  function viewLedger() {
    const r = L.monthRange(ledOff);
    const rep = L.periodReport(S, r.from, r.to);
    let items = L.unifiedEntries(S, r.from, r.to);
    if (ledFilter !== 'all') items = items.filter(e => e.type === ledFilter);
    let html = L.ledgerReady(S) ? `<button class="btn primary lg" data-act="add-tx" style="margin:0 0 14px">＋ Thêm giao dịch</button>`
      : `<div class="alert"><div>Hãy thiết lập sổ tài chính ở tab <b>Tài khoản</b> trước khi thêm giao dịch.</div><button class="btn sm" data-act="tab" data-tab="accounts">Thiết lập</button></div>`;
    html += monthNavHtml(ledOff, 'led-prev', 'led-next');
    html += `<div class="tiles">
      <div class="tile in"><div class="k">THU</div>${tileHtml('', tileNum(rep.income))}</div>
      <div class="tile out"><div class="k">CHI</div>${tileHtml('', tileNum(rep.expense))}</div>
      <div class="tile"><div class="k">CHÊNH LỆCH</div>${tileHtml(sgn(rep.net), (rep.net > 0 ? '+' : '') + tileNum(rep.net))}</div></div>`;
    html += `<div class="seg" style="margin-bottom:12px">${[['all', 'Tất cả'], ['income', 'Thu'], ['expense', 'Chi'], ['transfer', 'Chuyển']].map(f =>
      `<button class="${ledFilter === f[0] ? 'on' : ''}" data-act="led-filter" data-f="${f[0]}">${f[1]}</button>`).join('')}</div>`;
    if (!items.length) return html + `<div class="empty">Không có giao dịch nào.</div>`;
    const groups = {};
    items.forEach(e => (groups[e.date] = groups[e.date] || []).push(e));
    return html + `<section class="card tight">${Object.keys(groups).sort().reverse().map(k =>
      `<div class="group-h">${keyLabel(k)}</div>` + groups[k].map(entryRow).join('')).join('')}</section>`;
  }

  function viewAccounts() {
    if (!L.ledgerReady(S)) {
      const def = S.capital ? S.capital.date : L.lastDayOfPrevMonth();
      return `<section class="card"><div class="eyebrow">Sổ tài chính</div>
        <h2 style="margin-top:6px">Bước 1: chọn ngày bắt đầu sổ</h2>
        <p class="muted small" style="margin:0 0 10px">Đây là <b>điểm bắt đầu</b>, không phải ngày kết thúc: sổ chạy tiếp mãi từ ngày này, bạn chỉ đặt một lần. Số dư bạn nhập cho từng tài khoản là số dư <b>tại ngày này</b>; các giao dịch từ ngày hôm sau được cộng hoặc trừ dần. Bạn không cần nhập lại dữ liệu cũ hơn.</p>
        ${dateField('f-date', 'Ngày bắt đầu sổ', def)}
        <div class="err" id="err"></div>
        <button class="btn primary lg" data-act="ledger-start">Bắt đầu</button></section>`;
    }
    const b = L.accountBalances(S);
    const list = S.accounts.map(a => `<button class="row" data-act="edit-account" data-id="${a.id}"><div class="l"><b>${esc(a.name)}</b><span class="muted">${L.ACCT_KINDS[a.kind] || 'Khác'}</span></div><div class="amt ${b.byId[a.id] < 0 ? 'neg' : ''}">${fmtMoney(b.byId[a.id])}</div></button>`).join('');
    const grabRow = `<button class="row" data-act="goto-pot"><div class="l"><b>Tiền Grab</b><span class="muted">${b.grab == null ? 'Chưa có dữ liệu Grab nào' : b.grabImplicit ? 'Chưa nhập vốn Grab: đang tính từ 0 kể từ bản ghi Grab đầu tiên. Bấm để nhập vốn.' : L.grabExcluded(S).n ? `⚠️ ${L.grabExcluded(S).n} ca nằm từ ngày chốt vốn Grab trở về trước nên chưa được cộng. Bấm để xem.` : 'Lấy từ mục Grab, bấm để xem chi tiết'}</span></div><div class="amt">${b.grab == null ? '—' : fmtMoney(b.grab)}</div></button>`;
    return `<section class="card"><div class="eyebrow">Tổng tài sản</div><div class="big ${b.total < 0 ? 'neg' : ''}">${fmtMoney(b.total)}</div>
        <div class="muted small">Sổ bắt đầu từ ngày ${dmOf(S.ledger.start)}, chạy tiếp lâu dài.</div>
        <button class="btn primary lg" data-act="add-account">＋ Thêm tài khoản</button></section>
      <section class="card tight"><div class="group-h">Tài khoản</div>${list || '<div class="empty">Chưa có tài khoản nào. Thêm ví tiền mặt, tài khoản ngân hàng...</div>'}${grabRow}</section>
      <button class="link" data-act="edit-start">Sửa ngày bắt đầu sổ</button>`;
  }

  const GSUBS = [['shift', 'Ca chạy'], ['report', 'Báo cáo'], ['pot', 'Tiền Grab'], ['car', 'Xe'], ['settings', 'Thông số']];
  function viewGrab() {
    const nav = `<div class="seg gseg" style="margin-bottom:14px">${GSUBS.map(g => `<button class="${gsub === g[0] ? 'on' : ''}" data-act="gsub" data-s="${g[0]}">${g[1]}</button>`).join('')}</div>`;
    return nav + ({ shift: viewShift, report: viewGrabReport, pot: viewSpend, car: viewCar, settings: viewGrabSettings })[gsub]();
  }

  // ---- Sheet: tài khoản
  function accountSheet(a) {
    const kind = a ? a.kind : 'bank';
    const bal = a ? L.accountBalances(S).byId[a.id] : null;
    openSheet(a ? 'Sửa tài khoản' : 'Thêm tài khoản', `
      ${textField('f-name', 'Tên tài khoản', a ? a.name : '', 'vd Ví tiền mặt, Techcombank, MoMo')}
      <label class="l">Loại</label>
      <div class="chips" id="kchips">${Object.keys(L.ACCT_KINDS).map(k => `<button type="button" class="chip ${k === kind ? 'on' : ''}" data-act="pick-kind" data-k="${k}">${L.ACCT_KINDS[k]}</button>`).join('')}</div>
      <input type="hidden" id="f-kind" value="${kind}">
      ${moneyField('f-open', `Số dư tại ngày bắt đầu sổ (${dmOf(S.ledger.start)})`, a ? a.opening : '', { focus: !a })}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-account" data-id="${a ? a.id : ''}">${a ? 'Lưu thay đổi' : 'Thêm tài khoản'}</button>
      ${a ? `<div class="card" style="margin:14px 0 0;background:var(--bg);box-shadow:none">
          <div class="kv"><span>Số dư hiện tại theo app</span><b>${fmtMoney(bal)}</b></div>
          ${moneyField('f-actual', 'Số dư thực tế bạn đang có', '', { hint: 'Nếu lệch, app ghi một giao dịch "Điều chỉnh số dư" để khớp lại.' })}
          <button class="btn" data-act="adjust-account" data-id="${a.id}">Ghi điều chỉnh số dư</button></div>
        <button class="link danger" data-act="del-account" data-id="${a.id}">Xoá tài khoản</button>` : ''}`);
  }

  // ---- Sheet: giao dịch (Chi / Thu / Chuyển)
  const acctOptions = () => S.accounts.map(a => ({ id: a.id, name: a.name })).concat(L.grabPot(S) ? [{ id: GRAB, name: 'Tiền Grab' }] : []);
  const defaultAcct = () => { const o = acctOptions(); return (o.find(x => x.id === S.ledger.lastAcct) || o[0] || {}).id || ''; };
  function acctChips(role, selected) {
    return `<div class="chips" id="ch-${role}">${acctOptions().map(o => `<button type="button" class="chip ${o.id === selected ? 'on' : ''}" data-act="pick-acct" data-role="${role}" data-id="${o.id}">${esc(o.name)}</button>`).join('')}</div><input type="hidden" id="f-${role}" value="${esc(selected || '')}">`;
  }
  function txCatChips(type, selected) {
    const used = S.tx.filter(t => t.type === type && !t.adj).map(t => t.cat).filter(Boolean);
    return Array.from(new Set(L.TX_CATS[type].concat(used))).map(c => `<button type="button" class="chip ${c === selected ? 'on' : ''}" data-act="pick-txcat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  }
  function txFields(type, t, v) {
    v = v || {};
    const amt = v.amt != null ? v.amt : (t ? t.amount : '');
    const date = v.date || (t ? t.date : L.todayKey());
    const note = v.note != null ? v.note : (t ? t.note : '');
    let body = moneyField('f-amt', 'Số tiền', amt, { focus: !t });
    if (type === 'transfer') {
      const from = v.from || (t ? t.acct : defaultAcct());
      const to = v.to || (t ? t.to : ((acctOptions().find(o => o.id !== from) || {}).id || ''));
      body += `<label class="l">Từ tài khoản</label>${acctChips('from', from)}<label class="l">Đến tài khoản</label>${acctChips('to', to)}`;
    } else {
      const acct = v.acct || (t ? t.acct : defaultAcct());
      const sel = v.cat || (t ? t.cat : L.TX_CATS[type][0]);
      body += `<label class="l">${type === 'income' ? 'Vào tài khoản' : 'Trả từ tài khoản'}</label>${acctChips('acct', acct)}
        <label class="l">Danh mục</label><div class="chips" id="txchips">${txCatChips(type, sel)}</div>
        <input type="hidden" id="f-cat" value="${esc(sel)}">
        ${textField('f-cat2', 'Hoặc gõ danh mục khác', '', 'vd: Học phí, Sửa nhà...')}`;
    }
    return body + textField('f-note', 'Ghi chú (tuỳ chọn)', note, '') + dateField('f-date', 'Ngày', date)
      + `<div class="hint" style="margin:-6px 0 10px">Ngày từ ${dmOf(S.ledger.start)} trở về trước (ngày bắt đầu sổ) chỉ để tham khảo, không cộng vào số dư.</div>`;
  }
  function txSheet(t) {
    if (!L.ledgerReady(S)) { toast('Hãy thiết lập sổ tài chính trước'); tab = 'accounts'; render(true); return; }
    if (!acctOptions().length) { toast('Hãy thêm ít nhất một tài khoản trước'); tab = 'accounts'; render(true); return; }
    txType = t ? t.type : 'expense'; // ghi mới luôn mở ở "Chi" (loại hay dùng nhất)
    openSheet(t ? 'Sửa giao dịch' : 'Thêm giao dịch', `
      <div class="seg" id="txseg">${[['expense', 'Chi'], ['income', 'Thu'], ['transfer', 'Chuyển']].map(x => `<button type="button" class="${x[0] === txType ? 'on' : ''}" data-act="tx-type" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div id="txf">${txFields(txType, t)}</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-tx" data-id="${t ? t.id : ''}">${t ? 'Lưu thay đổi' : 'Lưu'}</button>
      ${t ? `<button class="link danger" data-act="del-tx" data-id="${t.id}">Xoá giao dịch</button>` : ''}`);
  }

  // ---------------------------------------------------------------- giao diện (màu chủ đạo)
  const THEMES = [['blue', 'Xanh dương', '#3563e9'], ['violet', 'Tím', '#6d4ae0'], ['terra', 'Cam đất', '#d2582a'], ['slate', 'Than xám', '#3f4f63']];
  function currentTheme() { try { return localStorage.getItem('grab-theme') || 'blue'; } catch (e) { return 'blue'; } }
  function applyTheme(t) {
    if (t === 'blue') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('grab-theme', t); } catch (e) { /* bỏ qua */ }
    const meta = document.querySelector('meta[name="theme-color"]'), sw = THEMES.find(x => x[0] === t);
    if (meta && sw) meta.setAttribute('content', sw[2]);
  }
  function themeCard() {
    const cur = currentTheme();
    return `<section class="card"><h2>Giao diện</h2>
      <div class="themes">${THEMES.map(t => `<button class="theme ${t[0] === cur ? 'on' : ''}" data-act="set-theme" data-t="${t[0]}"><i style="background:${t[2]}"></i><span>${t[1]}</span></button>`).join('')}</div>
      <p class="hint">Màu xanh lá chỉ còn dùng cho số tiền dương (thu, lãi). Chế độ sáng/tối theo cài đặt của iPhone.</p></section>`;
  }

  // ---------------------------------------------------------------- bảo mật: khoá bằng mật khẩu
  function securityCard() {
    if (!V || !V.available()) {
      return `<section class="card"><h2>Bảo mật</h2><p class="muted small" style="margin:0">Trình duyệt này không hỗ trợ mã hoá (cần mở app qua địa chỉ https).</p></section>`;
    }
    if (!vaultKey) {
      return `<section class="card"><h2>Bảo mật</h2>
        <p class="muted small" style="margin:0 0 10px">Chưa đặt mật khẩu: ai cầm điện thoại đã mở khoá đều xem được số liệu. Đặt mật khẩu để <b>mã hoá dữ liệu</b> và phải mở khoá mỗi lần vào app.</p>
        <button class="btn primary" data-act="set-password">🔒 Đặt mật khẩu</button></section>`;
    }
    const lm = S.settings.lockMinutes == null ? 5 : Number(S.settings.lockMinutes);
    const opts = [[0, 'Ngay khi thoát app'], [1, 'Sau 1 phút'], [5, 'Sau 5 phút'], [15, 'Sau 15 phút'], [60, 'Sau 1 giờ']];
    return `<section class="card"><h2>Bảo mật</h2>
      <div class="alert ok" style="margin:0 0 12px"><div>🔒 <b>Đã bật mật khẩu.</b> Dữ liệu trên máy được mã hoá.</div></div>
      <div class="fld"><label for="lockSel">Tự khoá khi rời app</label>
        <select id="lockSel" data-lock>${opts.map(o => `<option value="${o[0]}" ${o[0] === lm ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
      <div class="btn-row"><button class="btn" data-act="lock-now">Khoá ngay</button><button class="btn" data-act="change-password">Đổi mật khẩu</button></div>
      <button class="link danger" data-act="disable-password">Tắt mật khẩu</button>
      <p class="hint">Quên mật khẩu thì không khôi phục được dữ liệu (chỉ còn cách xoá rồi nhập lại từ file sao lưu). App không dùng được Face ID; nếu iPhone đề nghị lưu mật khẩu vào Chuỗi khoá iCloud, bạn có thể điền tự động bằng Face ID khi mở khoá.</p></section>`;
  }

  function showLock() {
    $('#view').innerHTML = ''; closeSheet();
    $('#lock').hidden = false; document.body.classList.add('noscroll');
    $('#lockPw').value = ''; $('#lockErr').textContent = '';
    setTimeout(() => $('#lockPw').focus(), 60);
  }
  function hideLock() { $('#lock').hidden = true; document.body.classList.remove('noscroll'); }

  // Khoá ngay: che màn hình tức thì, chờ lưu xong rồi xoá dữ liệu và khoá giải mã khỏi bộ nhớ
  function lockApp() {
    if (!vaultKey || locked) return;
    locked = true; showLock();
    const wipeMem = () => { vaultKey = null; vaultHeader = null; S = L.emptyState(); $('#view').innerHTML = ''; };
    saveChain.then(wipeMem, wipeMem);
  }

  async function tryUnlock(pw) {
    const wait = lockedUntil - Date.now();
    if (wait > 0) return `Thử lại sau ${Math.ceil(wait / 1000)} giây.`;
    try {
      const r = await V.open(pw, JSON.parse(localStorage.getItem(KEY_ENC)));
      S = L.migrate(JSON.parse(r.text)); vaultKey = r.key; vaultHeader = r.header; locked = false; failCount = 0;
      try { localStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ }
      hideLock(); render(true);
      return '';
    } catch (e) {
      failCount++;
      if (failCount >= 3) lockedUntil = Date.now() + Math.min(60, 3 * Math.pow(2, failCount - 3)) * 1000;
      return 'Mật khẩu không đúng.' + (failCount >= 3 ? ' Chờ vài giây rồi thử lại.' : '');
    }
  }

  const pwField = (id, label, auto) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="password" autocomplete="${auto}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>`;
  function passwordSheet(mode) {
    const title = mode === 'set' ? 'Đặt mật khẩu' : mode === 'change' ? 'Đổi mật khẩu' : 'Tắt mật khẩu';
    openSheet(title, `
      ${mode === 'disable' ? '<p class="muted small" style="margin:0 0 12px">Tắt mật khẩu sẽ lưu lại dữ liệu <b>không mã hoá</b> trên máy này.</p>'
        : '<div class="alert bad" style="margin:0 0 12px"><div>⚠️ <b>Quên mật khẩu là mất dữ liệu</b>, không ai khôi phục được (kể cả mình). Hãy <b>xuất file sao lưu</b> trước và nhớ kỹ mật khẩu.</div></div>'}
      ${mode !== 'set' ? pwField('f-pw0', 'Mật khẩu hiện tại', 'current-password') : ''}
      ${mode !== 'disable' ? pwField('f-pw1', 'Mật khẩu mới (từ 8 ký tự)', 'new-password') + pwField('f-pw2', 'Nhập lại mật khẩu mới', 'new-password') : ''}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-password" data-mode="${mode}">${title}</button>`);
    const f = $('#f-pw0') || $('#f-pw1'); if (f) setTimeout(() => f.focus(), 60);
  }

  // ---------------------------------------------------------------- màn hình: CÀI ĐẶT
  // Thông số riêng cho Grab (nằm trong mục Grab → Thông số)
  function viewGrabSettings() {
    const st = S.settings;
    const nField = (key, label, v, suf, cls, hint) => `<div class="fld"><label>${label}</label><div class="inwrap noK"><input class="${cls}" data-setting="${key}" inputmode="${cls === 'dec' ? 'decimal' : 'numeric'}" value="${cls === 'dec' ? String(v).replace('.', ',') : fmtInt(v)}"><span class="suf">${suf}</span></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    return `<section class="card"><h2>Thông số xe</h2>
        ${nField('baseOdo', 'Odo ban đầu', st.baseOdo, 'km', 'int', 'Mốc khởi đầu, nhập odo hiện tại của xe nếu chưa có. Các lần nhập odo sau sẽ thay thế.')}
        ${nField('fuelPrice', 'Giá xăng hiện tại', st.fuelPrice, 'đ/lít', 'int', st.fuelPriceDate ? 'Cập nhật lần cuối: ' + st.fuelPriceDate.slice(8) + '/' + st.fuelPriceDate.slice(5, 7) + '. Giá chỉ ảnh hưởng các ca từ ngày cập nhật trở đi.' : 'Chưa xác nhận lần nào. Giá chỉ ảnh hưởng các ca từ ngày cập nhật trở đi.')}
        ${nField('fuelL100', 'Mức tiêu hao ước tính', st.fuelL100, 'lít/100km', 'dec', 'Chỉ dùng tới khi tool học được số thật từ các lần đổ xăng.')}
        ${nField('wearPerKm', 'Hao mòn xe', st.wearPerKm, 'đ/km', 'int', 'Nhớt + lốp + phanh + sên nhông... Mặc định 240đ/km, chỉnh theo thực tế (giá nhớt, lốp... ở tiệm của bạn).')}
        ${nField('oilInterval', 'Chu kỳ thay nhớt', st.oilInterval, 'km', 'int')}
      </section>
      <section class="card"><h2>Cách tính</h2><div class="muted small" style="line-height:1.55">
        <b>Xăng của ca</b> = km × mức tiêu hao (lít/100km) × giá xăng của ngày chạy.<br>
        <b>Hao mòn</b> = km × đơn giá hao mòn, bỏ vào quỹ bảo trì.<br>
        <b>Lãi ca</b> = thu ròng app + tip/thưởng − xăng − hao mòn.<br>
        Hóa đơn xăng và bảo dưỡng không cộng thẳng vào chi phí lãi (đã tính theo km); chúng dùng để học mức tiêu hao và là tiền thật ra khỏi túi ở "Tiền Grab" và sổ tài chính.</div></section>`;
  }

  function viewSettings() {
    const last = S.lastBackup ? new Date(S.lastBackup).toLocaleString('vi-VN') : 'chưa có';
    return `${themeCard()}
      ${securityCard()}
      <section class="card"><h2>Sao lưu dữ liệu</h2>
        <p class="muted small" style="margin:0 0 10px">Dữ liệu chỉ lưu trên điện thoại này. Hãy sao lưu thường xuyên (lưu file vào Files/iCloud). Lần cuối: <b>${last}</b>.${vaultKey ? ' File xuất ra được <b>mã hoá bằng mật khẩu hiện tại</b>; muốn mở lại phải nhớ mật khẩu đó.' : ''}</p>
        <div class="btn-row"><button class="btn" data-act="export">⬆︎ Xuất file</button><button class="btn" data-act="import">⬇︎ Nhập file</button></div>
        ${vaultKey ? '<button class="link" data-act="export-plain">Xuất file không mã hoá (không khuyến nghị)</button>' : ''}
        <button class="link danger" data-act="wipe">Xoá toàn bộ dữ liệu</button></section>`;
  }

  // ---------------------------------------------------------------- dựng màn hình
  function render(scrollTop) {
    if (locked) return;
    $('#view').innerHTML = ({ overview: viewFinance, ledger: viewLedger, accounts: viewAccounts, grab: viewGrab, settings: viewSettings })[tab]();
    $('#title').textContent = TITLES[tab];
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (scrollTop) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- hành động
  const A = {};

  A.tab = el => { tab = el.dataset.tab; render(true); };
  A['close-sheet'] = () => closeSheet();
  A.zeros = el => { const i = $('#' + el.dataset.t); if (!i) return; const d = i.value.replace(/\D/g, '') || '0'; i.value = L.fmtInt(Number(d + '000')); i.focus(); updateCheckSummary(); updateFillLiters(); };

  // Ca
  A['start-shift'] = () => {
    const odo = getInt('startOdo');
    if (isNaN(odo) || odo <= 0) { toast('Nhập số odo hiện tại'); const i = $('#startOdo'); if (i) i.focus(); return; }
    const cur = L.lastKnownOdo(S);
    if (odo < cur && !confirm(`Odo bạn nhập (${fmtInt(odo)}) nhỏ hơn số đã ghi gần nhất (${fmtInt(cur)}). Vẫn bắt đầu ca?`)) return;
    S.active = { start: new Date().toISOString(), odoStart: odo };
    save(); render(); toast('Đã bắt đầu ca. Chúc chạy thuận lợi!');
  };
  A['cancel-shift'] = () => { if (confirm('Huỷ ca đang chạy? Ca này sẽ không được lưu.')) { S.active = null; save(); render(); } };
  A['end-shift'] = () => shiftSheet('end');
  A['manual-shift'] = () => simpleSheet(null);
  A['edit-shift'] = el => { const sh = S.shifts.find(x => x.id === el.dataset.id); if (sh) (sh.noClock ? simpleSheet(sh) : shiftSheet('edit', sh)); };
  A['km-mode'] = el => {
    const odo = el.dataset.m === 'odo';
    $('#kmseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
    $('#box-km').hidden = odo; $('#box-odo').hidden = !odo;
  };
  A['save-shift2'] = el => {
    const date = val('f-date');
    if (!date) return setErr('Chọn ngày chạy.');
    const useOdo = $('#kmseg .on').dataset.m === 'odo';
    let km = null, oS = null, oE = null, kmv;
    if (useOdo) {
      oS = getInt('f-oS'); oE = getInt('f-oE');
      if (isNaN(oS) || isNaN(oE) || oS <= 0) return setErr('Nhập odo đầu và odo cuối.');
      if (oE <= oS) return setErr('Odo cuối phải lớn hơn odo đầu.');
      kmv = oE - oS;
    } else {
      km = getDec('f-km');
      if (isNaN(km) || km <= 0) return setErr('Nhập số km đã chạy (có thể là số lẻ, ví dụ 43,2).');
      km = Math.round(km * 10) / 10;
      kmv = km;
    }
    const net = getInt('f-net');
    if (isNaN(net)) return setErr('Nhập thu nhập ròng trên app (nhập 0 nếu không có).');
    const hrs = val('f-hours') ? getDec('f-hours') : 0;
    if (isNaN(hrs) || hrs < 0 || hrs > 24) return setErr('Số giờ không hợp lệ (0–24).');
    if (kmv > 400 && !confirm(`Ca này chạy ${fmtKm(kmv)} km. Đúng không?`)) return;
    const start = new Date(date + 'T12:00:00');
    const data = {
      start: start.toISOString(), end: new Date(start.getTime() + hrs * 3600e3).toISOString(), noClock: true,
      km, odoStart: oS, odoEnd: oE, net, bonus: getInt('f-bonus') || 0, trips: getInt('f-trips') || 0,
    };
    if (el.dataset.id) Object.assign(S.shifts.find(x => x.id === el.dataset.id), data);
    else S.shifts.push(Object.assign({ id: uid(), fuelPrice: L.priceOn(S, date), wearRate: Number(S.settings.wearPerKm) || 0 }, data));
    save(); closeSheet(); render();
    if (el.dataset.next) {
      const nd = L.keyToDate(date); nd.setDate(nd.getDate() + 1);
      simpleSheet(null, { date: L.dateKey(nd), useOdo });
      toast('Đã lưu ' + dayLabel(L.keyToDate(date)) + '. Nhập ngày kế tiếp.');
    } else toast('Đã lưu ca');
  };
  A['del-shift'] = el => { if (confirm('Xoá ca này?')) { S.shifts = S.shifts.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); toast('Đã xoá ca'); } };
  A['save-shift'] = el => {
    const mode = el.dataset.mode;
    const oS = getInt('f-oS'), oE = getInt('f-oE'), net = getInt('f-net');
    const bonus = getInt('f-bonus') || 0, trips = getInt('f-trips') || 0;
    const start = fromLocalInput(val('f-start')) || (S.active && S.active.start);
    const end = fromLocalInput(val('f-end'));
    if (isNaN(oS) || oS <= 0) return setErr('Nhập odo đầu ca.');
    if (isNaN(oE) || oE <= 0) return setErr('Nhập odo cuối ca.');
    if (oE <= oS) return setErr('Odo cuối phải lớn hơn odo đầu.');
    if (isNaN(net)) return setErr('Nhập thu nhập ròng trên app (nhập 0 nếu chưa có chuyến nào).');
    if (!start || !end || new Date(end) < new Date(start)) return setErr('Giờ kết thúc phải sau giờ bắt đầu.');
    if (oE - oS > 400 && !confirm(`Ca này chạy ${fmtInt(oE - oS)} km. Đúng không?`)) return;
    if (new Date(end) - new Date(start) > 16 * 3600e3 && !confirm('Ca này dài hơn 16 giờ. Đúng không?')) return;
    if (mode === 'edit') {
      const sh = S.shifts.find(x => x.id === el.dataset.id);
      Object.assign(sh, { start, end, odoStart: oS, odoEnd: oE, net, bonus, trips });
      save(); closeSheet(); render(); toast('Đã lưu');
    } else {
      const sh = { id: uid(), start, end, odoStart: oS, odoEnd: oE, net, bonus, trips, fuelPrice: L.priceOn(S, L.dateKey(new Date(start))), wearRate: Number(S.settings.wearPerKm) || 0 };
      S.shifts.push(sh);
      if (mode === 'end') S.active = null;
      save(); closeSheet(); render(); showShiftResult(sh);
    }
  };

  // Tip / thưởng thêm sau cho ca
  A['add-extra'] = el => extraSheet(el.dataset.shift);
  A['pick-xshift'] = el => {
    $('#f-xshift').value = el.dataset.id;
    $('#xshifts').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['pick-xtype'] = el => {
    $('#f-xtype').value = el.dataset.k;
    $('#xtypes').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['save-extra'] = () => {
    const amount = getInt('f-amt');
    if (isNaN(amount) || amount <= 0) return setErr('Nhập số tiền.');
    const sh = S.shifts.find(x => x.id === val('f-xshift'));
    if (!sh) return setErr('Chọn ca.');
    (sh.extras = sh.extras || []).push({ id: uid(), type: val('f-xtype') || 'tipapp', amount, at: new Date().toISOString() });
    save(); closeSheet(); render();
    toast(`Đã cộng ${fmtMoney(amount)} vào ca ${shiftChipLabel(sh)}`);
  };
  A['del-extra'] = el => {
    const sh = S.shifts.find(x => x.id === el.dataset.shift); if (!sh) return;
    sh.extras = (sh.extras || []).filter(x => x.id !== el.dataset.id);
    save(); render(); if (sh.noClock) simpleSheet(sh); else shiftSheet('edit', sh);
  };

  A['set-theme'] = el => { applyTheme(el.dataset.t); render(); };

  // ---- Sổ tài chính: điều hướng
  A.gsub = el => { gsub = el.dataset.s; render(true); };
  A['goto-pot'] = () => { tab = 'grab'; gsub = 'pot'; render(true); };
  A['fin-prev'] = () => { finOff--; render(); };
  A['fin-next'] = () => { if (finOff < 0) { finOff++; render(); } };
  A['led-prev'] = () => { ledOff--; render(); };
  A['led-next'] = () => { if (ledOff < 0) { ledOff++; render(); } };
  A['led-filter'] = el => { ledFilter = el.dataset.f; render(); };

  // ---- Sổ tài chính: ngày bắt đầu sổ
  A['ledger-start'] = () => {
    const date = val('f-date');
    if (!date) return setErr('Chọn ngày bắt đầu sổ.');
    if (date > L.todayKey()) return setErr('Ngày bắt đầu không được ở tương lai.');
    S.ledger.start = date; save(); render(); toast('Đã bắt đầu sổ tài chính. Giờ hãy thêm các tài khoản của bạn.');
  };
  A['edit-start'] = () => {
    openSheet('Sửa ngày bắt đầu sổ', `
      <div class="alert bad" style="margin:0 0 12px"><div>⚠️ Chỉ các giao dịch <b>sau</b> ngày bắt đầu được cộng vào số dư; giao dịch từ ngày này trở về trước chỉ để tham khảo. Số dư đầu kỳ của từng tài khoản phải là số dư <b>tại ngày bắt đầu</b>. Đổi ngày sẽ làm số dư các tài khoản thay đổi theo.</div></div>
      ${dateField('f-date', 'Ngày bắt đầu sổ', S.ledger.start)}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-start">Lưu</button>`);
  };
  A['save-start'] = () => {
    const date = val('f-date');
    if (!date || date > L.todayKey()) return setErr('Ngày bắt đầu không hợp lệ.');
    S.ledger.start = date; save(); closeSheet(); render(); toast('Đã đổi ngày bắt đầu sổ');
  };

  // ---- Sổ tài chính: tài khoản
  A['add-account'] = () => accountSheet(null);
  A['edit-account'] = el => { const a = S.accounts.find(x => x.id === el.dataset.id); if (a) accountSheet(a); };
  A['pick-kind'] = el => {
    $('#f-kind').value = el.dataset.k;
    $('#kchips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['save-account'] = el => {
    const name = val('f-name'), opening = getInt('f-open');
    if (!name) return setErr('Nhập tên tài khoản.');
    if (isNaN(opening)) return setErr('Nhập số dư tại ngày bắt đầu sổ (nhập 0 nếu chưa có tiền).');
    if (S.accounts.some(a => a.name.toLowerCase() === name.toLowerCase() && a.id !== el.dataset.id)) return setErr('Đã có tài khoản trùng tên.');
    const data = { name, kind: val('f-kind') || 'other', opening };
    if (el.dataset.id) Object.assign(S.accounts.find(x => x.id === el.dataset.id), data);
    else S.accounts.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu tài khoản');
  };
  A['del-account'] = el => {
    const id = el.dataset.id;
    const n = S.tx.filter(t => t.acct === id || t.to === id).length;
    if (n) { toast(`Tài khoản đang có ${n} giao dịch, hãy xoá hoặc chuyển chúng trước`); return; }
    if (!confirm('Xoá tài khoản này?')) return;
    S.accounts = S.accounts.filter(a => a.id !== id); save(); closeSheet(); render(); toast('Đã xoá tài khoản');
  };
  A['adjust-account'] = el => {
    const a = S.accounts.find(x => x.id === el.dataset.id), actual = getInt('f-actual');
    if (!a) return;
    if (isNaN(actual)) return setErr('Nhập số dư thực tế.');
    const today = L.todayKey();
    if (today <= S.ledger.start) return setErr('Ngày hôm nay phải sau ngày bắt đầu sổ.');
    const diff = actual - L.accountBalances(S).byId[a.id];
    if (diff === 0) { closeSheet(); toast('Số dư đã khớp'); return; }
    S.tx.push({ id: uid(), date: today, type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), acct: a.id, cat: 'Điều chỉnh số dư', note: '', adj: true });
    save(); closeSheet(); render(); toast('Đã ghi điều chỉnh ' + fmtSigned(diff));
  };

  // ---- Sổ tài chính: giao dịch
  A['add-tx'] = () => txSheet(null);
  A['edit-tx'] = el => { const t = S.tx.find(x => x.id === el.dataset.id); if (t) txSheet(t); };
  A['tx-type'] = el => {
    const num = id => { const x = getInt(id); return isNaN(x) ? '' : x; };
    const v = { amt: num('f-amt'), note: val('f-note'), date: val('f-date') };
    v.acct = val('f-acct') || val('f-from') || undefined;
    v.from = val('f-from') || val('f-acct') || undefined;
    v.to = val('f-to') || undefined;
    txType = el.dataset.t;
    $('#txseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === txType));
    $('#txf').innerHTML = txFields(txType, null, v);
  };
  A['pick-acct'] = el => {
    const role = el.dataset.role;
    $('#f-' + role).value = el.dataset.id;
    $('#ch-' + role).querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['pick-txcat'] = el => {
    $('#f-cat').value = el.dataset.c; $('#f-cat2').value = '';
    $('#txchips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['save-tx'] = el => {
    const type = txType, amount = getInt('f-amt'), date = val('f-date') || L.todayKey(), note = val('f-note');
    if (isNaN(amount) || amount <= 0) return setErr('Nhập số tiền.');
    // Ngày trước hoặc đúng ngày bắt đầu sổ vẫn được ghi (để tham khảo) nhưng không cộng vào số dư
    let rec;
    if (type === 'transfer') {
      const from = val('f-from'), to = val('f-to');
      if (!from || !to) return setErr('Chọn tài khoản chuyển đi và nhận.');
      if (from === to) return setErr('Hai tài khoản phải khác nhau.');
      rec = { type, amount, acct: from, to, cat: '', note, date };
    } else {
      const acct = val('f-acct');
      if (!acct) return setErr('Chọn tài khoản.');
      rec = { type, amount, acct, cat: val('f-cat2') || val('f-cat') || 'Khác', note, date };
      S.ledger.lastAcct = acct;
    }
    // Tiền Grab có mốc riêng (ngày chốt vốn Grab): giao dịch dính Tiền Grab phải sau mốc đó mới tính được
    if (S.capital && date > S.ledger.start && date <= S.capital.date && (rec.acct === GRAB || rec.to === GRAB)) {
      return setErr(`Giao dịch dùng "Tiền Grab" phải sau ngày chốt vốn Grab (${dmOf(S.capital.date)}).`);
    }
    if (el.dataset.id) { const t = S.tx.find(x => x.id === el.dataset.id); Object.assign(t, rec); if (type !== 'transfer') delete t.to; }
    else S.tx.push(Object.assign({ id: uid() }, rec));
    save(); closeSheet(); render(); toast('Đã lưu giao dịch');
  };
  A['del-tx'] = el => {
    if (!confirm('Xoá giao dịch này?')) return;
    S.tx = S.tx.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); toast('Đã xoá giao dịch');
  };

  // Tính lại xăng cho các ca cũ (còn dùng đơn giá đ/km đã lưu) theo mô hình mới
  A['recalc-fuel'] = () => {
    const legacy = S.shifts.filter(sh => sh.fuelPrice == null);
    if (!legacy.length) return;
    if (!confirm(`Tính lại xăng cho ${legacy.length} ca cũ theo mức tiêu hao hiện tại và giá xăng đúng ngày chạy? Số liệu các ca này sẽ thay đổi.`)) return;
    legacy.forEach(sh => { sh.fuelPrice = L.priceOn(S, L.dateKey(new Date(sh.start))); delete sh.fuelRate; });
    save(); render(); toast('Đã tính lại ' + legacy.length + ' ca');
  };

  // Giá xăng: nhắc và nhập nhanh
  A['price-sheet'] = () => {
    openSheet('Cập nhật giá xăng', `
      ${moneyField('f-price', 'Giá xăng bạn đổ (đ/lít)', L.priceOn(S, L.todayKey()), { focus: true })}
      <div class="hint" style="margin:-6px 0 10px">Giá chỉ dùng để ước tính xăng/km cho tới khi app học được số thật từ các lần đổ đầy bình kèm odo.</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-price">Lưu giá mới</button>
      <button class="link" data-act="price-same">Giá chưa đổi, đừng nhắc nữa</button>`);
  };
  A['save-price'] = () => {
    const v = getInt('f-price');
    if (isNaN(v) || v < 5000 || v > 100000) return setErr('Nhập giá xăng hợp lệ (đ/lít), ví dụ 20.890.');
    S.settings.fuelPrice = v; S.settings.fuelPriceDate = L.todayKey();
    S.priceLog.push({ id: uid(), date: L.todayKey(), price: v });
    save(); closeSheet(); render(); toast('Đã cập nhật giá xăng ' + fmtInt(v) + 'đ/lít');
  };
  A['price-same'] = () => {
    S.settings.fuelPriceDate = L.todayKey();
    save(); closeSheet(); render(); toast('Ok, 7 ngày nữa mình nhắc lại');
  };

  // Quỹ bảo trì: ghi lần tách tiền ra để riêng (chuyển tiền, không phải khoản chi)
  A['put-fund'] = () => {
    const p = L.grabPot(S);
    const sug = p ? Math.max(0, Math.round(p.toSetAside)) : '';
    openSheet('Đã tách tiền vào quỹ bảo trì', `
      ${moneyField('f-amt', 'Số tiền đã tách riêng', sug || '', { focus: true, hint: 'Gợi ý là số cần tách thêm. Đây chỉ là chuyển tiền sang chỗ để riêng, không phải khoản chi.' })}
      ${dateField('f-date', 'Ngày', L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-put">Lưu</button>`);
  };
  A['save-put'] = () => {
    const amount = getInt('f-amt');
    if (isNaN(amount) || amount <= 0) return setErr('Nhập số tiền đã tách.');
    S.fundPuts.push({ id: uid(), date: val('f-date') || L.todayKey(), amount });
    save(); closeSheet(); render(); toast('Đã ghi ' + fmtMoney(amount) + ' vào quỹ bảo trì');
  };
  A['del-put'] = el => {
    if (!confirm('Xoá lần tách tiền này?')) return;
    S.fundPuts = S.fundPuts.filter(x => x.id !== el.dataset.id); save(); render();
  };

  // Vốn ban đầu, kiểm kê
  A['set-capital'] = () => capitalSheet();
  A['save-capital'] = () => {
    const total = getInt('f-cap'), fund = getInt('f-capfund') || 0, date = val('f-date');
    if (!date) return setErr('Chọn ngày chốt.');
    if (isNaN(total)) return setErr('Nhập tổng vốn ban đầu.');
    if (fund > total) return setErr('Phần để dành cho sửa xe không thể lớn hơn tổng vốn.');
    S.capital = { date, total, fund };
    save(); closeSheet(); render(); toast('Đã lưu vốn ban đầu');
  };
  A['del-capital'] = () => {
    if (!confirm('Xoá vốn ban đầu? Tiền Grab sẽ tính lại từ 0 kể từ bản ghi Grab đầu tiên (mọi ca đã nhập đều được cộng). Các lần kiểm kê và điều chỉnh gắn với vốn cũng sẽ bị xoá.')) return;
    S.capital = null; S.checks = []; S.adjusts = [];
    save(); closeSheet(); render(); toast('Đã xoá');
  };
  A['check-money'] = () => checkSheet();
  A['save-check'] = el => {
    const p = L.grabPot(S), total = checkTotal();
    if (total == null) return setErr('Nhập ít nhất một số dư.');
    const wallets = {};
    WALLETS.forEach(w => { const v = getInt('f-w-' + w[0]); wallets[w[0]] = isNaN(v) ? 0 : v; });
    const expected = Math.round(p.expected), diff = total - expected;
    S.checks.push({ id: uid(), at: new Date().toISOString(), wallets, total, expected, diff });
    const adjust = el.dataset.adjust && diff !== 0;
    if (adjust) S.adjusts.push({ id: uid(), date: L.todayKey(), amount: diff, note: 'Điều chỉnh sau kiểm kê' });
    save(); closeSheet(); render();
    toast(diff === 0 ? 'Khớp hoàn toàn!' : adjust ? 'Đã ghi điều chỉnh ' + fmtSigned(diff) : 'Đã lưu kiểm kê, chênh ' + fmtSigned(diff));
  };

  // Chi
  A['add-expense'] = () => expenseSheet(null);
  A['edit-expense'] = el => { const e = S.expenses.find(x => x.id === el.dataset.id); if (e) expenseSheet(e); };
  A['exp-type'] = el => {
    expType = el.dataset.t;
    $('#seg').className = 'seg t-' + expType;
    $('#seg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === expType));
    const first = catsFor(expType)[0];
    $('#f-cat').value = first; $('#chips').innerHTML = chipsHtml(expType, first);
    $('#type-hint').textContent = typeHint(expType);
  };
  A['pick-cat'] = el => {
    $('#f-cat').value = el.dataset.c; $('#f-cat2').value = '';
    $('#chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['save-expense'] = el => {
    const amt = getInt('f-amt');
    if (isNaN(amt) || amt <= 0) return setErr('Nhập số tiền.');
    const cat = val('f-cat2') || val('f-cat') || L.TYPE_LABEL[expType];
    const date = val('f-date') || L.todayKey();
    const data = { amount: amt, type: expType, category: cat, note: val('f-note'), date };
    if (el.dataset.id) Object.assign(S.expenses.find(x => x.id === el.dataset.id), data);
    else S.expenses.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu khoản chi');
  };
  A['del-expense'] = el => { if (confirm('Xoá khoản chi này?')) { S.expenses = S.expenses.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); } };

  // Xe
  A['add-odo'] = () => odoSheet();
  A['save-odo'] = () => {
    const odo = getInt('f-odo');
    if (isNaN(odo) || odo <= 0) return setErr('Nhập số odo.');
    const cur = L.lastKnownOdo(S);
    if (odo < cur && !confirm(`Odo (${fmtInt(odo)}) nhỏ hơn số đã ghi gần nhất (${fmtInt(cur)}). Vẫn lưu?`)) return;
    S.odoLog.push({ id: uid(), date: val('f-date') || L.todayKey(), odo });
    save(); closeSheet(); render(); toast('Đã cập nhật odo');
  };
  A['add-fill'] = () => fillSheet(null);
  A['edit-fill'] = el => { const f = S.fills.find(x => x.id === el.dataset.id); if (f) fillSheet(f); };
  A['save-fill'] = el => {
    const amount = getInt('f-amt'), odo = getInt('f-odo'), ppl = getInt('f-ppl');
    if (isNaN(amount) || amount <= 0) return setErr('Nhập số tiền đổ xăng.');
    if (!isNaN(ppl) && (ppl < 5000 || ppl > 100000)) return setErr('Giá/lít không hợp lệ (ví dụ 20.890).');
    const date = val('f-date') || L.todayKey();
    const pricePerL = isNaN(ppl) ? null : ppl;
    const data = {
      amount, odo: isNaN(odo) || odo <= 0 ? null : odo, pricePerL,
      liters: pricePerL ? Math.round(amount / pricePerL * 100) / 100 : null, // số lít = tiền ÷ giá/lít
      full: $('#f-full').checked, date,
    };
    if (el.dataset.id) Object.assign(S.fills.find(x => x.id === el.dataset.id), data);
    else S.fills.push(Object.assign({ id: uid() }, data));
    // Giá/lít vừa ghi cũng là giá xăng hiện tại nếu mới hơn lần xác nhận trước
    if (pricePerL && (!S.settings.fuelPriceDate || date >= S.settings.fuelPriceDate)) {
      S.settings.fuelPrice = pricePerL; S.settings.fuelPriceDate = date;
    }
    save(); closeSheet(); render(); toast('Đã lưu lần đổ xăng');
  };
  A['del-fill'] = el => { if (confirm('Xoá lần đổ xăng này?')) { S.fills = S.fills.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); } };
  A['add-maint'] = el => maintSheet(null, el.dataset.item);
  A['edit-maint'] = el => { const m = S.maint.find(x => x.id === el.dataset.id); if (m) maintSheet(m); };
  A['pick-item'] = el => {
    $('#f-item').value = el.dataset.c;
    $('#chips').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
  };
  A['save-maint'] = el => {
    const cost = getInt('f-amt'), odo = getInt('f-odo');
    if (isNaN(cost) || cost < 0) return setErr('Nhập chi phí.');
    if (isNaN(odo) || odo <= 0) return setErr('Nhập odo lúc làm.');
    const data = { item: val('f-item') || 'Khác', cost, odo, note: val('f-note'), date: val('f-date') || L.todayKey(), fromFund: $('#f-fromfund').checked };
    if (el.dataset.id) Object.assign(S.maint.find(x => x.id === el.dataset.id), data);
    else S.maint.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu bảo dưỡng');
  };
  A['del-maint'] = el => { if (confirm('Xoá mục bảo dưỡng này?')) { S.maint = S.maint.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); } };

  // Tổng quan
  A.period = el => { period = { kind: el.dataset.k, off: 0 }; render(); };
  A.prev = () => { period.off--; render(); };
  A.next = () => { if (period.off < 0) { period.off++; render(); } };

  // Mật khẩu
  A['set-password'] = () => passwordSheet('set');
  A['change-password'] = () => passwordSheet('change');
  A['disable-password'] = () => passwordSheet('disable');
  A['lock-now'] = () => lockApp();
  A['save-password'] = async el => {
    const mode = el.dataset.mode, label = el.textContent;
    const p0 = $('#f-pw0') ? $('#f-pw0').value : '', p1 = $('#f-pw1') ? $('#f-pw1').value : '', p2 = $('#f-pw2') ? $('#f-pw2').value : '';
    if (mode !== 'disable') {
      if (p1.length < 8) return setErr('Mật khẩu cần ít nhất 8 ký tự.');
      if (p1 !== p2) return setErr('Hai lần nhập chưa giống nhau.');
    }
    el.disabled = true; el.textContent = 'Đang xử lý…'; setErr('');
    const fail = msg => { el.disabled = false; el.textContent = label; setErr(msg); };
    try {
      if (mode !== 'set') { // phải đúng mật khẩu hiện tại
        try { await V.open(p0, JSON.parse(localStorage.getItem(KEY_ENC))); } catch (e) { return fail('Mật khẩu hiện tại không đúng.'); }
      }
      await saveChain; // chờ các lần lưu đang dở
      if (mode === 'disable') {
        localStorage.setItem(KEY, JSON.stringify(S));   // ghi bản thô trước
        localStorage.removeItem(KEY_ENC);               // rồi mới bỏ bản mã
        vaultKey = null; vaultHeader = null;
        closeSheet(); render(); toast('Đã tắt mật khẩu');
        return;
      }
      const text = JSON.stringify(S);
      const c = await V.create(p1, text);
      if ((await V.decryptText(c.key, c.pkg)) !== text) throw new Error('verify'); // đọc lại được thì mới bỏ bản thô
      localStorage.setItem(KEY_ENC, JSON.stringify(c.pkg));
      localStorage.removeItem(KEY);
      vaultKey = c.key; vaultHeader = c.header;
      closeSheet(); render(); toast(mode === 'set' ? '🔒 Đã đặt mật khẩu, dữ liệu đã được mã hoá' : 'Đã đổi mật khẩu');
    } catch (e) {
      fail('Không xử lý được. Dữ liệu của bạn vẫn nguyên vẹn, hãy thử lại.');
    }
  };
  A['forgot-pw'] = () => {
    if (!confirm('Xoá toàn bộ dữ liệu trên máy này để đặt lại? Bạn chỉ khôi phục được bằng file sao lưu (cần nhớ mật khẩu của file đó). Dữ liệu chưa sao lưu sẽ MẤT.')) return;
    if (!confirm('Chắc chắn xoá hết?')) return;
    try { localStorage.removeItem(KEY_ENC); localStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ }
    vaultKey = null; vaultHeader = null; locked = false; S = L.emptyState(); failCount = 0; lockedUntil = 0;
    hideLock(); render(true); toast('Đã xoá dữ liệu. Bạn có thể Nhập file sao lưu ở Cài đặt.');
  };
  A['import-enc'] = async el => {
    const pw = $('#f-pwimp') ? $('#f-pwimp').value : '';
    el.disabled = true; el.textContent = 'Đang mở…';
    try {
      const r = await V.open(pw, pendingImport);
      pendingImport = null; closeSheet();
      applyImport(JSON.parse(r.text));
    } catch (e) { el.disabled = false; el.textContent = 'Mở file'; setErr('Mật khẩu của file sao lưu không đúng.'); }
  };

  // Nhập file: gộp hoặc thay thế
  A['import-merge'] = () => {
    if (!pendingData) return;
    const r = L.mergeState(S, pendingData);
    pendingData = null; S = r.state; save(); closeSheet(); render(true);
    const a = r.added, parts = [['shifts', 'ca'], ['tx', 'giao dịch'], ['accounts', 'tài khoản'], ['fills', 'lần đổ xăng'], ['expenses', 'khoản chi'], ['maint', 'bảo dưỡng']]
      .filter(p => a[p[0]]).map(p => a[p[0]] + ' ' + p[1]);
    toast(parts.length ? 'Đã gộp thêm: ' + parts.join(', ') : 'Không có mục mới để gộp');
  };
  A['import-replace'] = () => {
    if (!pendingData) return;
    const hadLedger = S.accounts.length || S.tx.length;
    const fileHas = (pendingData.accounts || []).length || (pendingData.tx || []).length;
    if (hadLedger && !fileHas && !confirm(`File này không có sổ tài chính. Thay thế sẽ XOÁ ${S.accounts.length} tài khoản và ${S.tx.length} giao dịch hiện có. Vẫn thay thế?`)) return;
    S = L.migrate(pendingData); pendingData = null; save(); closeSheet(); render(true); toast('Đã thay thế dữ liệu');
  };

  // Sao lưu
  A['export-plain'] = () => {
    if (confirm('File không mã hoá chứa toàn bộ số liệu của bạn, ai có file đều đọc được. Vẫn xuất?')) doExport(true);
  };
  A.export = () => doExport(false);
  async function doExport(plain) {
    let name = `grab-thuchi-${L.todayKey()}.json`;
    S.lastBackup = new Date().toISOString(); save();
    let text;
    if (vaultKey && !plain) { // có mật khẩu: file xuất ra cũng được mã hoá (cùng muối, IV mới)
      const rec = await V.encryptText(vaultKey, JSON.stringify(S));
      text = JSON.stringify(Object.assign({}, vaultHeader, rec), null, 2);
      name = `grab-thuchi-${L.todayKey()}.mahoa.json`;
    } else text = JSON.stringify(S, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); render(); return; }
    } catch (e) { if (e && e.name === 'AbortError') { render(); return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    render(); toast('Đã xuất file sao lưu');
  }
  A.import = () => $('#importFile').click();
  A.wipe = () => {
    if (!confirm('Xoá TOÀN BỘ dữ liệu trên máy này? Không thể hoàn tác (hãy sao lưu trước).')) return;
    if (!confirm('Chắc chắn xoá hết?')) return;
    try { localStorage.removeItem(KEY_ENC); } catch (e) { /* bỏ qua */ }
    vaultKey = null; vaultHeader = null; // xoá xong thì không còn mật khẩu
    S = L.emptyState(); save(); render(true); toast('Đã xoá dữ liệu');
  };

  // Áp dụng dữ liệu nhập từ file (đã giải mã nếu cần)
  function applyImport(o) {
    if (!o || typeof o !== 'object' || !o.settings || !Array.isArray(o.shifts)) { toast('File không đúng định dạng'); return; }
    pendingData = o;
    const n = (x, k) => (Array.isArray(x[k]) ? x[k].length : 0);
    const line = (x, who) => `<div class="kv"><span>${who}</span><b>${n(x, 'shifts')} ca · ${n(x, 'tx')} giao dịch · ${n(x, 'accounts')} tài khoản</b></div>`;
    const lose = S.accounts.length || S.tx.length;
    openSheet('Nhập dữ liệu từ file', `
      ${line(o, 'Trong file')}${line(S, 'Đang có trên máy')}
      <button class="btn primary lg" data-act="import-merge">Gộp vào dữ liệu hiện tại</button>
      <p class="hint" style="margin:6px 0 14px">Khuyến nghị. Giữ nguyên tài khoản, giao dịch và cài đặt hiện có; chỉ thêm các ca chạy, xăng, chi phí... chưa có (mục trùng sẽ bỏ qua).</p>
      <button class="btn danger" data-act="import-replace">Thay thế toàn bộ</button>
      <p class="hint" style="margin:6px 0 0">Xoá hết dữ liệu đang có và dùng đúng nội dung file.${lose ? ` <b>Sổ tài chính hiện tại (${S.accounts.length} tài khoản, ${S.tx.length} giao dịch) sẽ mất nếu file không có.</b>` : ''}</p>`);
  }

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = A[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  // Định dạng số có dấu chấm khi gõ
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches && t.matches('input.money, input.int')) {
      const d = t.value.replace(/\D/g, '');
      t.value = d ? L.fmtInt(Number(d)) : '';
      if (t.id && t.id.indexOf('f-w-') === 0) updateCheckSummary();
      if (t.id === 'f-amt' || t.id === 'f-ppl') updateFillLiters();
    }
  });

  // Cài đặt: lưu khi đổi
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.lock !== undefined) { // thời gian tự khoá
      S.settings.lockMinutes = Number(t.value); save(); toast('Đã lưu cài đặt');
      return;
    }
    if (t.dataset && t.dataset.setting) {
      const key = t.dataset.setting;
      const v = key === 'fuelL100' ? parseFloat(t.value.replace(',', '.')) : Number(t.value.replace(/\D/g, ''));
      if (!isFinite(v) || v <= 0) { toast('Giá trị không hợp lệ'); render(); return; }
      S.settings[key] = v;
      if (key === 'fuelPrice') { S.settings.fuelPriceDate = L.todayKey(); S.priceLog.push({ id: uid(), date: L.todayKey(), price: v }); }
      save(); toast('Đã lưu cài đặt');
    }
  });

  $('#importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let o;
      try { o = JSON.parse(rd.result); } catch (err) { toast('File không đúng định dạng'); return; }
      if (V && V.isPackage(o)) { // file sao lưu đã mã hoá: hỏi mật khẩu của file
        pendingImport = o;
        openSheet('Mở file sao lưu đã mã hoá', `
          <p class="muted small" style="margin:0 0 12px">Nhập mật khẩu đã dùng khi xuất file này.</p>
          ${pwField('f-pwimp', 'Mật khẩu của file', 'off')}
          <div class="err" id="err"></div>
          <button class="btn primary lg" data-act="import-enc">Mở file</button>`);
        setTimeout(() => { const f = $('#f-pwimp'); if (f) f.focus(); }, 60);
        return;
      }
      applyImport(o);
    };
    rd.readAsText(f);
  });

  setInterval(() => { const t = $('#timer'); if (t && S.active) t.textContent = elapsed(S.active.start); }, 20000);
  // Tự khoá khi rời app đủ lâu (đặt ở Cài đặt → Bảo mật)
  document.addEventListener('visibilitychange', () => {
    const lm = S.settings.lockMinutes == null ? 5 : Number(S.settings.lockMinutes);
    if (document.hidden) {
      hiddenAt = Date.now();
      if (vaultKey && !locked && lm === 0) lockApp();
    } else if (vaultKey && !locked && hiddenAt && lm > 0 && Date.now() - hiddenAt >= lm * 60000) {
      lockApp();
    } else if (!locked && tab === 'grab' && gsub === 'shift' && !$('#sheet-root')) render();
  });

  // Màn khoá
  $('#lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#lockBtn'), pw = $('#lockPw').value;
    if (!pw) return;
    btn.disabled = true; btn.textContent = 'Đang mở…'; $('#lockErr').textContent = '';
    const msg = await tryUnlock(pw);
    btn.disabled = false; btn.textContent = 'Mở khoá';
    if (msg) { $('#lockErr').textContent = msg; $('#lockPw').select(); } else $('#lockPw').value = '';
  });
  $('#lockForgot').addEventListener('click', () => A['forgot-pw']());

  // ---------------------------------------------------------------- khởi động
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  applyTheme(currentTheme());
  if (locked) showLock(); else render(true);

  window.__app = { get S() { return S; }, render, A };
})();
