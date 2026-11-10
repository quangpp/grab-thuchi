/* Sổ Thu Chi Grab — giao diện. Toàn bộ dữ liệu lưu trên máy (localStorage), có sao lưu ra file JSON. */
(function () {
  'use strict';
  const L = window.Logic;
  const KEY = 'grab-tracker-v1';
  const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const TITLES = { overview: 'Tổng quan', shift: 'Ca chạy', spend: 'Tiền', car: 'Xe', settings: 'Cài đặt' };

  let S = load();
  let tab = 'shift';
  let period = { kind: 'week', off: 0 };
  let expType = 'ride';

  // ---------------------------------------------------------------- lưu trữ
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return L.migrate(JSON.parse(raw));
    } catch (e) { /* dùng dữ liệu rỗng */ }
    return L.emptyState();
  }
  function save() {
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
    return `<div class="alert"><div>⛽ <b>${msg}</b> (đang dùng ${fmtInt(S.settings.fuelPrice)}đ/lít). Giá đổi thì ước tính xăng/km sẽ lệch.</div>
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
            <div class="metric"><div class="k">Lãi ca chạy</div><div class="v ${sgn(td.profit)}">${fmtSigned(td.profit)}</div></div>
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
        <div class="ln"><span class="muted">− Hao mòn xe (ước theo km)</span><span>${fmtMoney(c.wear)}</span></div>
        <div class="ln sum"><span>Lãi</span><span class="${sgn(c.profit)}">${fmtSigned(c.profit)}</span></div>
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
  const WALLETS = [['cash', 'Tiền mặt đang cầm'], ['income', 'Ví thu nhập Grab'], ['topup', 'Ví nạp Grab'], ['bank', 'Tài khoản ngân hàng']];

  function cashCards() {
    const p = L.cashPosition(S);
    if (!p) {
      return `<section class="card"><div class="eyebrow">Tiền Grab đang cầm</div>
        <h2 style="margin-top:6px">Thiết lập vốn ban đầu</h2>
        <p class="muted small" style="margin:0 0 4px">Nhập một lần số tiền bạn đang có từ trước (ví dụ lợi nhuận tháng vừa rồi). Số này <b>không tính là thu nhập</b>, chỉ là mốc để app đối soát với tiền thật.</p>
        <button class="btn primary lg" data-act="set-capital">Nhập vốn ban đầu</button></section>`;
    }
    const cd = S.capital.date.slice(8) + '/' + S.capital.date.slice(5, 7);
    const last = sortedDesc(S.checks, c => c.at).slice(0, 3);
    return `<section class="card flow"><div class="eyebrow">Tiền Grab đang cầm (theo app)</div>
        <div class="ln" style="margin-top:6px"><span>Vốn ban đầu <span class="muted small">(chốt ${cd})</span></span><span>${fmtMoney(p.cap)}</span></div>
        <div class="ln"><span>+ Thu nhập các ca <span class="muted small">(thu ròng + tip)</span></span><span>${fmtMoney(p.income)}</span></div>
        <div class="ln"><span>− Xăng đã đổ</span><span>${fmtMoney(p.fuelPaid)}</span></div>
        ${p.fuelPaid > 0 ? `<div class="ln sub"><span>trong đó xăng đi làm / chênh tồn bình</span><span>${fmtMoney(p.commuteFuel)}</span></div>` : ''}
        <div class="ln"><span>− Bảo dưỡng, sửa xe đã trả</span><span>${fmtMoney(p.repairPaid)}</span></div>
        <div class="ln"><span>− Chi chạy xe khác</span><span>${fmtMoney(p.rideExp)}</span></div>
        <div class="ln"><span>− Chi cá nhân</span><span>${fmtMoney(p.personal)}</span></div>
        ${p.adjust ? `<div class="ln"><span>± Điều chỉnh sau kiểm kê</span><span>${fmtSigned(p.adjust)}</span></div>` : ''}
        <div class="ln sum"><span>Tiền đang cầm</span><span>${fmtMoney(p.expected)}</span></div>
      </section>
      <section class="card"><div class="eyebrow">Chia ra</div>
        <div class="kv" style="margin-top:6px"><span>🔧 Quỹ sửa xe</span><b class="${p.fund < 0 ? 'neg' : ''}">${fmtMoney(p.fund)}</b></div>
        <div class="hint" style="margin:-2px 0 6px">Đã trích ${fmtMoney((S.capital.fund || 0) + p.wearAccr)} (km Grab × hao mòn), đã trả sửa xe ${fmtMoney(p.repairPaid)}.${p.fund < 0 ? ' Âm nghĩa là đã chi vượt phần trích (phần thiếu lấy từ tiền tiêu được).' : ''}</div>
        <div class="kv"><span>🏦 Để dành</span><b>${fmtMoney(p.saved)}</b></div>
        <div class="kv" style="border-top:1.5px solid var(--text);margin-top:6px;padding-top:10px"><span style="color:var(--text);font-weight:700">✅ Tiền tiêu được</span><b class="${sgn(p.spendable)}" style="font-size:18px">${fmtMoney(p.spendable)}</b></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="check-money">Kiểm kê tiền thật</button><button class="btn" data-act="set-capital">Sửa vốn đầu</button></div>
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
    const p = L.cashPosition(S);
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
      : t === 'personal' ? 'Tiền lấy từ thu nhập Grab để dùng riêng. Không làm giảm lợi nhuận chạy xe, chỉ giảm số còn lại.'
        : 'Tiền bạn tách ra để dành từ thu nhập Grab.';
  }

  // ---------------------------------------------------------------- màn hình: XE
  function viewCar() {
    const cur = L.lastKnownOdo(S);
    const oil = L.oilStatus(S);
    const fr = L.fuelRate(S);
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
      <div class="kv" style="margin-top:6px"><span>Xăng</span><b>${fmtInt(fr.rate)}đ/km</b></div>
      <div class="hint" style="margin:-2px 0 8px">${fr.source === 'learned' ? `Học từ ${fr.n} lần đổ đầy bình (${fmtInt(fr.dist)} km).` : `Ước tính: ${S.settings.fuelL100} lít/100km × ${fmtInt(S.settings.fuelPrice)}đ/lít. Đổ đầy bình ≥ 2 lần (kèm odo) thì tool tự tính số thật.`}</div>
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
      if (km > 0 && !gap) stat[f.id] = { km, per: f.amount / km };
    });
    const shownFills = sortedDesc(S.fills, f => f.date + String(f.odo || 0).padStart(8, '0')).slice(0, 15);
    const fillList = shownFills.length ? `<section class="card tight"><div class="group-h">Lịch sử đổ xăng</div>${shownFills.map(f => {
      const st = stat[f.id];
      return `<button class="row" data-act="edit-fill" data-id="${f.id}"><div class="l"><b>${keyLabel(f.date)}</b><span class="muted">${f.odo > 0 ? 'odo ' + fmtInt(f.odo) : 'chưa có odo'}${f.liters ? ' · ' + String(f.liters).replace('.', ',') + ' lít' : ''}${f.full === false ? ' · chưa đầy' : ''}${st ? ` · ${fmtInt(st.km)} km · ${fmtInt(st.per)}đ/km` : ''}</span></div><div class="amt">${fmtMoney(f.amount)}</div></button>`;
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
      ${intField('f-odo', 'Odo lúc đổ (tuỳ chọn)', f && f.odo > 0 ? f.odo : '', { suf: 'km', ph: fmtInt(L.lastKnownOdo(S)), hint: 'Không nhớ thì để trống: khoản này vẫn tính vào tiền xăng đã đổ (đối soát tiền), chỉ chưa dùng để học đơn giá xăng/km.' })}
      <div class="fld"><label for="f-liters">Số lít (tuỳ chọn)</label><input id="f-liters" inputmode="decimal" class="dec" placeholder="vd 2,8" value="${f && f.liters ? String(f.liters).replace('.', ',') : ''}"></div>
      <label class="check"><input type="checkbox" id="f-full" ${!f || f.full !== false ? 'checked' : ''}> Đã đổ đầy bình</label>
      <div class="hint" style="margin:-6px 0 10px">Đổ đầy bình mỗi lần thì tool tính được đơn giá xăng/km chính xác.</div>
      ${dateField('f-date', 'Ngày', f ? f.date : L.todayKey())}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-fill" data-id="${f ? f.id : ''}">${f ? 'Lưu thay đổi' : 'Lưu'}</button>
      ${f ? `<button class="link danger" data-act="del-fill" data-id="${f.id}">Xoá</button>` : ''}`);
  }

  function maintSheet(m, preset) {
    const item = m ? m.item : (preset || 'Nhớt');
    openSheet(m ? 'Sửa bảo dưỡng' : 'Ghi bảo dưỡng', `
      <label class="l">Hạng mục</label>
      <div class="chips" id="chips">${L.MAINT_ITEMS.map(i => `<button type="button" class="chip ${i === item ? 'on' : ''}" data-act="pick-item" data-c="${esc(i)}">${esc(i)}</button>`).join('')}</div>
      <input type="hidden" id="f-item" value="${esc(item)}">
      ${moneyField('f-amt', 'Chi phí (gồm công)', m ? m.cost : '', { focus: !m })}
      ${intField('f-odo', 'Odo lúc làm', m ? m.odo : L.lastKnownOdo(S), { suf: 'km' })}
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

  function viewOverview() {
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
      html += `<div class="alert"><div>🛢️ <b>Chưa có mốc thay nhớt.</b> Khi thay, ghi ở tab Xe để tool nhắc lần sau.</div></div>`;
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
      return html + `<div class="empty">Chưa có dữ liệu trong khoảng này.<br>Ghi ca chạy ở tab "Ca chạy" và các khoản chi ở tab "Chi".</div>`;
    }

    const tileMoney = n => (Math.abs(n) >= 1e7 ? fmtShort(n) + 'đ' : fmtMoney(n));
    const tv = (cls, text) => `<div class="v ${cls}" style="font-size:${text.length > 9 ? 14 : 17}px">${text}</div>`; // số dài thì thu nhỏ chữ cho vừa ô
    html += `<div class="tiles">
      <div class="tile in"><div class="k">TỔNG THU</div>${tv('', tileMoney(m.income))}</div>
      <div class="tile out"><div class="k">TỔNG CHI</div>${tv('', tileMoney(m.totalSpend))}</div>
      <div class="tile"><div class="k">CÒN LẠI</div>${tv(sgn(m.remain), (m.remain > 0 ? '+' : '') + tileMoney(m.remain))}</div></div>`;

    // Tầng 1
    const segs = [['Xăng', m.fuel, '#e0a030'], ['Hao mòn xe', m.wear, '#8e7cc3'], ['Chi chạy xe khác', m.rideExp, '#4a90d9'], ['Lợi nhuận', Math.max(0, m.profit), '#0b8f5a']];
    const tot = segs.reduce((a, s) => a + s[1], 0) || 1;
    const catLines = (obj) => Object.keys(obj).sort((a, b) => obj[b] - obj[a]).map(k => `<div class="ln sub"><span>${esc(k)}</span><span>${fmtMoney(obj[k])}</span></div>`).join('');
    html += `<section class="card flow"><div class="eyebrow">Chạy xe có lời không?</div>
      <div class="stack" style="margin-top:10px">${segs.map(s => `<i style="width:${(s[1] / tot * 100).toFixed(1)}%;background:${s[2]}"></i>`).join('')}</div>
      <div class="legend">${segs.map(s => `<span style="--c:${s[2]}">${s[0]}</span>`).join('')}</div>
      <div class="ln"><span>Tổng thu <span class="muted small">(thu ròng app${m.bonus ? ' + thưởng/tip' : ''})</span></span><b>${fmtMoney(m.income)}</b></div>
      ${capAmt ? `<div class="ln sub"><span>Thu nhập các ca đã ghi</span><span>${fmtMoney(m.income - capAmt)}</span></div><div class="ln sub"><span>Vốn ban đầu (thu nhập trước ngày chốt)</span><span>${fmtMoney(capAmt)}</span></div>` : ''}
      <div class="ln"><span>− Xăng <span class="muted small">(ước theo km)</span></span><span>${fmtMoney(m.fuel)}</span></div>
      <div class="ln"><span>− Hao mòn xe <span class="muted small">(ước theo km)</span></span><span>${fmtMoney(m.wear)}</span></div>
      <div class="ln"><span>− Chi phí chạy xe khác</span><span>${fmtMoney(m.rideExp)}</span></div>
      ${catLines(m.rideCats)}
      <div class="ln sum"><span>Lợi nhuận chạy xe</span><span class="${sgn(m.profit)}">${fmtSigned(m.profit)}</span></div></section>`;

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

  // ---------------------------------------------------------------- màn hình: CÀI ĐẶT
  function viewSettings() {
    const st = S.settings;
    const last = S.lastBackup ? new Date(S.lastBackup).toLocaleString('vi-VN') : 'chưa có';
    const nField = (key, label, v, suf, cls, hint) => `<div class="fld"><label>${label}</label><div class="inwrap noK"><input class="${cls}" data-setting="${key}" inputmode="${cls === 'dec' ? 'decimal' : 'numeric'}" value="${cls === 'dec' ? String(v).replace('.', ',') : fmtInt(v)}"><span class="suf">${suf}</span></div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    return `<section class="card"><h2>Thông số xe</h2>
        ${nField('baseOdo', 'Odo ban đầu', st.baseOdo, 'km', 'int', 'Mốc khởi đầu, nhập odo hiện tại của xe nếu chưa có. Các lần nhập odo sau sẽ thay thế.')}
        ${nField('fuelPrice', 'Giá xăng hiện tại', st.fuelPrice, 'đ/lít', 'int', st.fuelPriceDate ? 'Cập nhật lần cuối: ' + st.fuelPriceDate.slice(8) + '/' + st.fuelPriceDate.slice(5, 7) + '. Giá chỉ dùng để ước tính cho tới khi app học được xăng/km thật.' : 'Chưa xác nhận lần nào. Giá chỉ dùng để ước tính cho tới khi app học được xăng/km thật.')}
        ${nField('fuelL100', 'Mức tiêu hao ước tính', st.fuelL100, 'lít/100km', 'dec', 'Chỉ dùng tới khi tool học được số thật từ các lần đổ xăng.')}
        ${nField('wearPerKm', 'Hao mòn xe', st.wearPerKm, 'đ/km', 'int', 'Nhớt + lốp + phanh + sên nhông... Mặc định 240đ/km, chỉnh theo thực tế (giá nhớt, lốp... ở tiệm của bạn).')}
        ${nField('oilInterval', 'Chu kỳ thay nhớt', st.oilInterval, 'km', 'int')}
      </section>
      <section class="card"><h2>Sao lưu dữ liệu</h2>
        <p class="muted small" style="margin:0 0 10px">Dữ liệu chỉ lưu trên điện thoại này. Hãy sao lưu thường xuyên (lưu file vào Files/iCloud). Lần cuối: <b>${last}</b>.</p>
        <div class="btn-row"><button class="btn" data-act="export">⬆︎ Xuất file</button><button class="btn" data-act="import">⬇︎ Nhập file</button></div>
        <button class="link danger" data-act="wipe">Xoá toàn bộ dữ liệu</button></section>
      <section class="card"><h2>Cách tính</h2><div class="muted small" style="line-height:1.55">
        <b>Lãi ca</b> = thu ròng app + thưởng/tip − km × (xăng/km + hao mòn/km).<br>
        <b>Lợi nhuận chạy xe</b> = tổng lãi các ca − chi phí chạy xe khác.<br>
        <b>Còn lại</b> = lợi nhuận − chi tiêu cá nhân − để dành.<br>
        Hóa đơn xăng và bảo dưỡng không cộng thẳng vào chi phí (đã tính theo km) — chỉ dùng để tool học đơn giá chính xác.</div></section>`;
  }

  // ---------------------------------------------------------------- dựng màn hình
  function render(scrollTop) {
    $('#view').innerHTML = ({ overview: viewOverview, shift: viewShift, spend: viewSpend, car: viewCar, settings: viewSettings })[tab]();
    $('#title').textContent = TITLES[tab];
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (scrollTop) window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- hành động
  const A = {};

  A.tab = el => { tab = el.dataset.tab; render(true); };
  A['close-sheet'] = () => closeSheet();
  A.zeros = el => { const i = $('#' + el.dataset.t); if (!i) return; const d = i.value.replace(/\D/g, '') || '0'; i.value = L.fmtInt(Number(d + '000')); i.focus(); updateCheckSummary(); };

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
    else S.shifts.push(Object.assign({ id: uid(), fuelRate: L.fuelRate(S).rate, wearRate: Number(S.settings.wearPerKm) || 0 }, data));
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
      const sh = { id: uid(), start, end, odoStart: oS, odoEnd: oE, net, bonus, trips, fuelRate: L.fuelRate(S).rate, wearRate: Number(S.settings.wearPerKm) || 0 };
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

  // Giá xăng: nhắc và nhập nhanh
  A['price-sheet'] = () => {
    openSheet('Cập nhật giá xăng', `
      ${moneyField('f-price', 'Giá xăng bạn đổ (đ/lít)', S.settings.fuelPrice, { focus: true })}
      <div class="hint" style="margin:-6px 0 10px">Giá chỉ dùng để ước tính xăng/km cho tới khi app học được số thật từ các lần đổ đầy bình kèm odo.</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-price">Lưu giá mới</button>
      <button class="link" data-act="price-same">Giá chưa đổi, đừng nhắc nữa</button>`);
  };
  A['save-price'] = () => {
    const v = getInt('f-price');
    if (isNaN(v) || v < 5000 || v > 100000) return setErr('Nhập giá xăng hợp lệ (đ/lít), ví dụ 20.890.');
    S.settings.fuelPrice = v; S.settings.fuelPriceDate = L.todayKey();
    save(); closeSheet(); render(); toast('Đã cập nhật giá xăng ' + fmtInt(v) + 'đ/lít');
  };
  A['price-same'] = () => {
    S.settings.fuelPriceDate = L.todayKey();
    save(); closeSheet(); render(); toast('Ok, 7 ngày nữa mình nhắc lại');
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
    if (!confirm('Xoá vốn ban đầu? Các lần kiểm kê và điều chỉnh cũng sẽ bị xoá.')) return;
    S.capital = null; S.checks = []; S.adjusts = [];
    save(); closeSheet(); render(); toast('Đã xoá');
  };
  A['check-money'] = () => checkSheet();
  A['save-check'] = el => {
    const p = L.cashPosition(S), total = checkTotal();
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
    const amount = getInt('f-amt'), odo = getInt('f-odo'), liters = getDec('f-liters');
    if (isNaN(amount) || amount <= 0) return setErr('Nhập số tiền đổ xăng.');
    const data = { amount, odo: isNaN(odo) || odo <= 0 ? null : odo, liters: isNaN(liters) ? null : liters, full: $('#f-full').checked, date: val('f-date') || L.todayKey() };
    if (el.dataset.id) Object.assign(S.fills.find(x => x.id === el.dataset.id), data);
    else S.fills.push(Object.assign({ id: uid() }, data));
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
    const data = { item: val('f-item') || 'Khác', cost, odo, note: val('f-note'), date: val('f-date') || L.todayKey() };
    if (el.dataset.id) Object.assign(S.maint.find(x => x.id === el.dataset.id), data);
    else S.maint.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu bảo dưỡng');
  };
  A['del-maint'] = el => { if (confirm('Xoá mục bảo dưỡng này?')) { S.maint = S.maint.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); } };

  // Tổng quan
  A.period = el => { period = { kind: el.dataset.k, off: 0 }; render(); };
  A.prev = () => { period.off--; render(); };
  A.next = () => { if (period.off < 0) { period.off++; render(); } };

  // Sao lưu
  A.export = async () => {
    const name = `grab-thuchi-${L.todayKey()}.json`;
    S.lastBackup = new Date().toISOString(); save();
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); render(); return; }
    } catch (e) { if (e && e.name === 'AbortError') { render(); return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    render(); toast('Đã xuất file sao lưu');
  };
  A.import = () => $('#importFile').click();
  A.wipe = () => {
    if (!confirm('Xoá TOÀN BỘ dữ liệu trên máy này? Không thể hoàn tác (hãy sao lưu trước).')) return;
    if (!confirm('Chắc chắn xoá hết?')) return;
    S = L.emptyState(); save(); render(true); toast('Đã xoá dữ liệu');
  };

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
    }
  });

  // Cài đặt: lưu khi đổi
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.setting) {
      const key = t.dataset.setting;
      const v = key === 'fuelL100' ? parseFloat(t.value.replace(',', '.')) : Number(t.value.replace(/\D/g, ''));
      if (!isFinite(v) || v <= 0) { toast('Giá trị không hợp lệ'); render(); return; }
      S.settings[key] = v;
      if (key === 'fuelPrice') S.settings.fuelPriceDate = L.todayKey();
      save(); toast('Đã lưu cài đặt');
    }
  });

  $('#importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const o = JSON.parse(rd.result);
        if (!o || typeof o !== 'object' || !o.settings || !Array.isArray(o.shifts)) throw new Error('bad');
        if (!confirm(`Nhập file này sẽ THAY THẾ dữ liệu hiện tại.\nFile có ${o.shifts.length} ca, ${(o.expenses || []).length} khoản chi. Tiếp tục?`)) return;
        S = L.migrate(o); save(); render(true); toast('Đã nhập dữ liệu');
      } catch (err) { toast('File không đúng định dạng'); }
    };
    rd.readAsText(f);
  });

  setInterval(() => { const t = $('#timer'); if (t && S.active) t.textContent = elapsed(S.active.start); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'shift' && !$('#sheet-root')) render(); });

  // ---------------------------------------------------------------- khởi động
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  render(true);

  window.__app = { get S() { return S; }, render, A };
})();
