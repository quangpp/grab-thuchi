/* Sổ Thu Chi Grab — giao diện. Toàn bộ dữ liệu lưu trên máy (localStorage), có sao lưu ra file JSON. */
(function () {
  'use strict';
  const L = window.Logic;
  const V = window.Vault;
  const KEY = 'grab-tracker-v1';          // dữ liệu thô (khi chưa đặt mật khẩu)
  const KEY_ENC = 'grab-tracker-enc-v1';  // dữ liệu đã mã hoá (khi đã đặt mật khẩu)
  const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const TITLES = { overview: 'Tổng quan', ledger: 'Giao dịch', accounts: 'Tài khoản & nợ', plan: 'Kế hoạch', grab: 'Grab', settings: 'Cài đặt' };
  const GRAB = L.GRAB_ACCT; // tài khoản ảo "Tiền Grab"

  // Trạng thái khoá: khi đã đặt mật khẩu, khoá giải mã chỉ nằm trong bộ nhớ lúc đang mở khoá
  let vaultKey = null, vaultHeader = null, locked = false;
  let saveChain = Promise.resolve();
  let hiddenAt = 0, failCount = 0, lockedUntil = 0, pendingImport = null, pendingData = null;

  let S = load();
  let tab = 'overview';
  let gsub = 'shift';                 // tab con trong mục Grab: shift | report | pot | car
  let monthOff = 0;                   // tháng đang xem, dùng chung cho Tổng quan và Giao dịch (0 = tháng này)
  let ledFilter = 'all', txType = 'expense';
  let txCtx = null;                   // ngữ cảnh khi ghi giao dịch từ "Sắp đến hạn" (để đánh dấu đã xử lý)
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
            <div class="metric"><div class="k">Hao mòn (ước tính)</div><div class="v">${fmtMoney(td.wear)}</div></div>
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
        <div class="ln"><span class="muted">− Hao mòn xe (ước tính)</span><span>${fmtMoney(c.wear)}</span></div>
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

  // ---- Tiền đang cầm, kiểm kê
  const WALLETS = [['cash', 'Tiền mặt đang cầm'], ['income', 'Ví thu nhập Grab'], ['topup', 'Ví nạp Grab'], ['bank', 'Tài khoản ngân hàng']];

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
      : ex.n > (cap.ack || 0) ? `<div class="alert bad"><div>⚠️ <b>${ex.n} ca (thu ${fmtMoney(ex.income)}) không được cộng</b> vì nằm ${cap.when === 'start' ? 'trước' : 'từ'} ngày chốt vốn (${cd}${cap.when === 'start' ? '' : ' trở về trước'}): app coi chúng đã nằm trong vốn. Nếu chưa tính vào vốn, hãy lùi ngày chốt vốn lên sớm hơn ca đầu tiên (hoặc chọn "Đầu ngày"), hoặc xoá vốn để tính từ 0.</div><div style="display:flex;flex-direction:column;gap:6px;margin-left:auto;flex:none"><button class="btn sm" data-act="set-capital" style="margin:0">Sửa vốn</button><button class="btn sm" data-act="ack-excluded" style="margin:0">Đã hiểu</button></div></div>` : '';
    return `${warn}<section class="card flow"><div class="eyebrow">Tiền Grab đang cầm (theo app)</div>
        <div class="ln" style="margin-top:6px"><span>Vốn ban đầu <span class="muted small">(${implicit ? 'chưa nhập, tính từ 0' : 'chốt ' + cd + ', ' + whenLabel(cap.when)})</span></span><span>${fmtMoney(p.cap)}</span></div>
        <div class="ln"><span>+ Thu nhập các ca <span class="muted small">(thu ròng + tip)</span></span><span>${fmtMoney(p.income)}</span></div>
        <div class="ln"><span>− Xăng đổ bằng Tiền Grab</span><span>${fmtMoney(p.fuelPaid)}</span></div>
        <div class="ln"><span>− Bảo dưỡng, sửa xe đã trả</span><span>${fmtMoney(p.repairPaid)}</span></div>
        <div class="ln"><span>− Chi chạy xe khác</span><span>${fmtMoney(p.rideExp)}</span></div>
        <div class="ln"><span>− Chi cá nhân</span><span>${fmtMoney(p.personal)}</span></div>
        ${p.adjust ? `<div class="ln"><span>± Điều chỉnh sau kiểm kê</span><span>${fmtSigned(p.adjust)}</span></div>` : ''}
        <div class="ln sum"><span>Tiền đang cầm</span><span>${fmtMoney(p.expected)}</span></div>
      </section>
      <section class="card">
        ${p.saved > 0 ? `<div class="kv"><span>🏦 Để dành</span><b>${fmtMoney(p.saved)}</b></div>
        <div class="kv" style="border-top:1.5px solid var(--text);margin-top:6px;padding-top:10px"><span style="color:var(--text);font-weight:700">✅ Tiền tiêu được</span><b class="${sgn(p.spendable)}" style="font-size:18px">${fmtMoney(p.spendable)}</b></div>` : ''}
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" data-act="check-money">Kiểm kê tiền thật</button><button class="btn" data-act="set-capital">${implicit ? 'Nhập vốn' : 'Sửa vốn đầu'}</button></div>
        ${last.length ? `<div class="group-h" style="padding-left:0;margin-top:8px">Các lần kiểm kê gần đây</div>${last.map(c => `<div class="kv"><span>${fmtDM(c.at)} ${fmtTime(c.at)} · thực tế ${fmtMoney(c.total)}</span><b class="${c.diff === 0 ? 'pos' : sgn(c.diff)}">${c.diff === 0 ? 'khớp' : fmtSigned(c.diff)}</b></div>`).join('')}` : ''}
      </section>`;
  }

  // Chọn con số/ngày này là lúc ĐẦU NGÀY hay CUỐI NGÀY (đầu ngày: các khoản của chính ngày đó được cộng thêm)
  function whenSeg(sel) {
    const st = sel === 'start';
    return `<div class="seg" id="whenseg">
        <button type="button" class="${st ? 'on' : ''}" data-act="pick-when" data-w="start">Đầu ngày</button>
        <button type="button" class="${st ? '' : 'on'}" data-act="pick-when" data-w="end">Cuối ngày</button></div>
      <input type="hidden" id="f-when" value="${st ? 'start' : 'end'}">
      <div class="hint" style="margin:-6px 0 12px"><b>Đầu ngày:</b> con số lúc bạn chưa chạy hay ghi gì trong ngày đó, nên các ca và khoản của <b>chính ngày đó sẽ được cộng thêm</b>. <b>Cuối ngày:</b> con số đã gồm mọi thứ của ngày đó, chỉ tính từ ngày hôm sau.</div>`;
  }
  const whenLabel = w => (w === 'start' ? 'đầu ngày' : 'cuối ngày');

  function capitalSheet() {
    const c = S.capital;
    openSheet(c ? 'Sửa vốn ban đầu' : 'Vốn ban đầu', `
      <p class="muted small" style="margin:0 0 12px">Số tiền bạn đang có từ trước (ví dụ lợi nhuận tháng vừa rồi). Không tính là thu nhập. Chỉ các ca, khoản chi, đổ xăng, bảo dưỡng <b>sau ngày chốt</b> mới được cộng hoặc trừ vào.</p>
      ${dateField('f-date', 'Ngày của con số này', c ? c.date : L.lastDayOfPrevMonth())}
      ${whenSeg(c ? c.when : 'end')}
      ${moneyField('f-cap', 'Tổng tiền Grab bạn đang có', c ? c.total : '', { focus: true })}
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

    const oilCard = `<section class="card"><div class="eyebrow">Bảo dưỡng định kỳ</div>
      ${L.PARTS.map(p => {
        const st = L.partStatus(S, p.item);
        if (!st.has) return `<div class="part"><div class="kv" style="margin:0"><span>${p.icon} ${esc(p.item)}</span><button class="btn sm" data-act="add-maint" data-item="${esc(p.item)}" style="margin:0">Ghi mốc</button></div>
          <div class="hint" style="margin:2px 0 8px">Chưa có mốc. Ghi lần thay gần nhất (odo, chi phí nhập 0 nếu không nhớ) để đếm km, chu kỳ ${fmtInt(st.iv)} km.</div></div>`;
        const cls = st.remaining < 0 ? 'over' : L.partDueSoon(st) ? 'warn' : '';
        return `<div class="part"><div class="kv" style="margin:0"><span>${p.icon} ${esc(p.item)}</span><b class="${st.remaining < 0 ? 'neg' : ''}">${st.remaining >= 0 ? 'còn ' + fmtInt(st.remaining) + ' km' : 'quá hạn ' + fmtInt(-st.remaining) + ' km'}</b></div>
          <div class="progress ${cls}"><i style="width:${Math.round(st.pct * 100)}%"></i></div>
          <div class="muted small">Đã đi ${fmtInt(st.since)}/${fmtInt(st.iv)} km kể từ lần thay (odo ${fmtInt(st.lastOdo)})</div>
          <button class="link" data-act="add-maint" data-item="${esc(p.item)}" style="margin:2px 0 12px">Ghi lần thay mới ›</button></div>`;
      }).join('')}
      <div class="hint" style="margin:0">Chu kỳ chỉnh ở Grab → Thông số. Số km ban đầu chỉ là ước tính, hãy chỉnh theo sổ bảo dưỡng và thực tế của bạn.</div></section>`;

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
      return `<button class="row" data-act="edit-fill" data-id="${f.id}"><div class="l"><b>${keyLabel(f.date)}</b><span class="muted">${f.odo > 0 ? 'odo ' + fmtInt(f.odo) : 'chưa có odo'} · ${f.pricePerL ? fmtInt(f.pricePerL) + 'đ/lít' : 'chưa có giá/lít'} · ${L.litersOf(f, S).toFixed(2).replace('.', ',')} lít${f.full === false ? ' · chưa đầy' : ''} · ${esc(acctName(L.fillAcct(f)))}${st ? ` · ${fmtInt(st.km)} km · ${st.l100.toFixed(2).replace('.', ',')} L/100km` : ''}</span></div><div class="amt">${fmtMoney(f.amount)}</div></button>`;
    }).join('')}</section>` : '';

    const maint = sortedDesc(S.maint, m => m.odo).slice(0, 15);
    const maintList = maint.length ? `<section class="card tight"><div class="group-h">Lịch sử bảo dưỡng</div>${maint.map(m =>
      `<button class="row" data-act="edit-maint" data-id="${m.id}"><div class="l"><b>${esc(m.item)}</b><span class="muted">${keyLabel(m.date)} · odo ${fmtInt(m.odo)}${m.noMoney ? ' · không trừ Tiền Grab' : ''}${m.note ? ' · ' + esc(m.note) : ''}</span></div><div class="amt">${fmtMoney(m.cost)}</div></button>`).join('')}</section>` : '';

    // Km Grab và km ngoài Grab (đi làm, việc riêng) theo mốc đổ xăng
    // Mốc thống kê: lần đầu lấy theo lần đổ xăng có odo gần nhất, sau đó giữ nguyên (bấm "Đặt lại mốc" để đổi)
    if (!S.settings.splitAnchor) {
      const lf = S.fills.filter(f => f.odo > 0 && f.amount > 0).sort((a, b) => b.odo - a.odo)[0];
      if (lf) { S.settings.splitAnchor = { odo: lf.odo, date: lf.date }; save(); }
    }
    const sp = L.fuelSplit(S);
    let splitCard = '';
    if (sp.since || sp.intervals.length) {
      const pc = (a, b) => b > 0 ? Math.round(a / b * 100) + '%' : '0%';
      splitCard = `<section class="card"><div class="eyebrow">Km Grab và km đi làm</div>
        ${sp.since ? `<div class="group-h" style="margin-top:6px">Cộng dồn từ mốc ${dmOf(sp.since.date)} (odo ${fmtInt(sp.since.odo)})</div>
          <div class="kv"><span>Tổng km đã đi (tới odo ${fmtInt(sp.since.cur)})</span><b>${fmtInt(sp.since.km)} km</b></div>
          <div class="kv"><span>Chạy Grab</span><b>${fmtInt(sp.since.grab)} km (${pc(sp.since.grab, sp.since.km)})</b></div>
          <div class="kv"><span>Ngoài Grab (đi làm, việc riêng)</span><b>${fmtInt(sp.since.other)} km</b></div>
          ${sp.done ? `<div class="kv" style="font-size:13.5px"><span class="muted">Xăng thật đã tính xong (${sp.done.n} khoảng đổ đầy)</span><span>Grab ≈ ${fmtMoney(Math.round(sp.done.costGrab))} · ngoài Grab ≈ ${fmtMoney(Math.round(sp.done.costOther))}</span></div>` : ''}
          <button class="link" data-act="reset-split" style="margin:2px 0 0">Đặt lại mốc về lần đổ xăng gần nhất</button>` : ''}
        ${sp.intervals.length ? `<div class="group-h" style="margin-top:10px">Giữa các lần đổ đầy bình (xăng thật)</div>
          ${sp.intervals.slice(-3).reverse().map(i => `<div style="padding:8px 0;border-top:1px solid var(--line)">
            <div class="kv" style="margin:0"><span>${dmOf(i.from)} → ${dmOf(i.to)} · ${fmtInt(i.km)} km</span><b>${fmtMoney(Math.round(i.cost))}</b></div>
            <div class="kv" style="margin:0;font-size:13.5px"><span class="muted">Grab ${fmtInt(i.grab)} km</span><span>≈ ${fmtMoney(Math.round(i.costGrab))} <span class="muted">(app ước tính ${fmtMoney(Math.round(i.estGrab))})</span></span></div>
            <div class="kv" style="margin:0;font-size:13.5px"><span class="muted">Ngoài Grab ${fmtInt(i.other)} km</span><span>≈ ${fmtMoney(Math.round(i.costOther))}</span></div></div>`).join('')}` : ''}
        <div class="hint" style="margin:6px 0 0">Km ngoài Grab = km xe đi (theo odo) − km các ca. Tiền xăng mỗi khoảng chia theo tỉ lệ km, nên là ước tính; ca nhập bù chỉ có km được xếp theo ngày. Mốc chỉ đặt một lần, đổ xăng thêm không làm số cộng dồn bị reset; con số cập nhật mỗi khi bạn nhập odo mới.</div></section>`;
    }
    return head + oilCard + splitCard + rates + fillList + maintList;
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
    // Không mặc định Tiền Grab: nhớ lựa chọn lần trước, lần đầu phải tự chọn (trừ khi chỉ có một nơi để chọn)
    const opts = acctOptions(true);
    if (!opts.some(o => o.id === GRAB)) opts.push({ id: GRAB, name: 'Tiền Grab' });
    const want = f ? L.fillAcct(f) : S.settings.fillAcct;
    const sel = opts.some(o => o.id === want) ? want : (opts.length === 1 ? opts[0].id : (f && f.acct === 'none' ? 'none' : ''));
    if (sel === 'none') opts.push({ id: 'none', name: 'Không trừ tài khoản nào' });
    openSheet(f ? 'Sửa lần đổ xăng' : 'Đổ xăng', `
      ${moneyField('f-amt', 'Số tiền đổ', f ? f.amount : '', { focus: !f })}
      <label class="l">Trả bằng</label>
      <div class="chips" id="ch-fpay">${opts.map(o => `<button type="button" class="chip ${o.id === sel ? 'on' : ''}" data-act="pick-acct" data-role="fpay" data-id="${o.id}">${esc(o.name)}</button>`).join('')}</div>
      <input type="hidden" id="f-fpay" value="${esc(sel)}">
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
      <label class="check"><input type="checkbox" id="f-nomoney" ${m && m.noMoney ? 'checked' : ''}> Không trừ vào Tiền Grab (chi phí đã ghi ở nơi khác, vd quẹt thẻ)</label>
      <div class="hint" style="margin:-4px 0 8px">Chỉ lưu làm mốc bảo dưỡng và để tham khảo hao mòn; không vào Tiền Grab và báo cáo thu chi, nên không bị tính hai lần.</div>
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
    if (capAll) { const d = L.keyToDate(capAll.date); if (capAll.when !== 'start') d.setDate(d.getDate() + 1); from = L.dateKey(d); }
    const m = L.summarize(S, from, r.to);
    const ser = L.series(r, m.byDay);
    m.income += capAmt; m.profit += capAmt; m.remain += capAmt; // perKm/perHour đã tính riêng từ các ca nên không bị ảnh hưởng

    let html = '';
    // banner nhắc nhớt / sao lưu
    const oil = L.oilStatus(S);
    L.PARTS.map(p => L.partStatus(S, p.item)).filter(L.partDueSoon).forEach(st => {
      const nm = st.item === 'Nhớt' ? 'nhớt' : st.item.toLowerCase();
      html += `<div class="alert ${st.remaining < 0 ? 'bad' : ''}"><div>${st.icon} <b>${st.remaining < 0 ? 'Quá hạn thay ' + nm + ' ' + fmtInt(-st.remaining) + ' km' : 'Sắp tới hạn thay ' + nm + ' (còn ' + fmtInt(st.remaining) + ' km)'}.</b></div></div>`;
    });
    if (!oil.has) {
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
      html += `<div class="hint" style="margin:-4px 0 12px">Tính từ ${capAll.when === 'start' ? 'đầu' : 'sau'} ngày chốt vốn (${cd}) và đã cộng vốn ban đầu ${fmtMoney(capAmt)} vào tổng thu. Các khoản ghi trước ngày chốt không tính (đã nằm trong vốn).</div>`;
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
        <div class="tile"><div class="k">HAO MÒN ƯỚC TÍNH</div>${tv('', tileMoney(m.wear))}</div></div>`;

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
      <div class="ln"><span>− Hao mòn xe <span class="muted small">(ước tính theo km)</span></span><span>${fmtMoney(m.wear)}</span></div>
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
  const debtOf = id => S.debts.find(d => d.id === id);
  const debtLabel = d => (d.kind === 'card' ? 'Thẻ ' : '') + d.name;
  const acctName = id => (id === GRAB ? 'Tiền Grab' : id === 'none' ? 'Không trừ tài khoản nào' : debtOf(id) ? debtLabel(debtOf(id)) : ((S.accounts.find(a => a.id === id) || {}).name || '(đã xoá)'));
  const dmOf = k => k.slice(8) + '/' + k.slice(5, 7);
  const tileNum = n => (Math.abs(n) >= 1e7 ? fmtShort(n) + 'đ' : fmtMoney(n));
  const tileHtml = (cls, text) => `<div class="v ${cls}" style="font-size:${text.length > 9 ? 14 : 17}px">${text}</div>`;

  function monthNavHtml(off, prevAct, nextAct) {
    const r = L.monthRange(off);
    return `<div class="nav-period"><button data-act="${prevAct}" aria-label="Tháng trước">‹</button><b>${r.label}</b><button data-act="${nextAct}" aria-label="Tháng sau" ${off >= 0 ? 'disabled' : ''}>›</button></div>`;
  }
  // Ghi chú dưới các ô THU/CHI: giải thích những dòng nhìn như tiền ra nhưng không tính là chi, để các màn hình không bị "lệch" khi cộng tay
  function reportNotes(rep, r) {
    let h = '';
    if (rep.transfers > 0) h += `<p class="hint center">Chuyển tiền giữa các tài khoản (${fmtMoney(rep.transfers)}) không tính là thu hay chi.</p>`;
    if (rep.debtPrincipal > 0) h += `<p class="hint center">Đã trả gốc nợ ${fmtMoney(rep.debtPrincipal)}: làm giảm dư nợ nên không tính là chi, chỉ phần lãi/phí tính là chi.</p>`;
    const refOnly = S.tx.filter(t => t.date >= r.from && t.date <= r.to && !t.adj && S.ledger.start && !L.ledgerCounts(S, t.date)).length;
    if (refOnly) h += `<p class="hint center">${refOnly} giao dịch nằm trước ngày bắt đầu sổ: có trong báo cáo thu chi nhưng không cộng vào số dư tài khoản.</p>`;
    return h;
  }
  function backupAlert() {
    if ((S.shifts.length + S.expenses.length + S.tx.length) === 0) return '';
    const last = S.lastBackup ? new Date(S.lastBackup) : null;
    const days = last ? (Date.now() - last) / 864e5 : Infinity;
    if (days <= 3) return '';
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
    else if (e.type === 'debtpay') {
      const d = debtOf(e.debt);
      title = 'Trả nợ · ' + (d ? debtLabel(d) : '(đã xoá)');
      sub = acctName(e.acct) + ' · trả gốc ' + fmtMoney(e.amount - (e.interest || 0)) + (e.interest ? ' + lãi/phí ' + fmtMoney(e.interest) + ' (tính là chi)' : '');
      amt = fmtMoney(e.amount); // trung tính: không phải toàn bộ là chi (chỉ lãi/phí là chi)
    } else {
      title = e.adj ? 'Điều chỉnh số dư' : (e.cat || 'Khác');
      sub = [acctName(e.acct), e.note].filter(Boolean).join(' · ');
      amt = (e.type === 'income' ? '+' : '−') + fmtMoney(e.amount); cls = e.type === 'income' ? 'pos' : 'neg';
    }
    if ((e.src === 'tx' || (e.src === 'fill' && e.acct !== GRAB && e.acct !== 'none')) && S.ledger.start && !L.ledgerCounts(S, e.date)) sub += (sub ? ' · ' : '') + 'chỉ tham khảo, không tính vào số dư';
    return `<button class="row" data-act="${act}" data-id="${e.id}"><div class="l"><b>${esc(title)}</b><span class="muted">${esc(sub)}</span></div><div class="amt ${cls}">${amt}</div></button>`;
  }

  function viewFinance() {
    const ready = L.ledgerReady(S);
    const r = L.monthRange(monthOff);
    const rep = L.periodReport(S, r.from, r.to);
    let html = reminderAlerts() + backupAlert();
    if (!ready) {
      html += `<section class="card"><div class="eyebrow">Sổ tài chính</div>
        <h2 style="margin-top:6px">Bắt đầu sổ tài chính</h2>
        <p class="muted small" style="margin:0 0 4px">Chọn ngày bắt đầu sổ và nhập số dư hiện có của các tài khoản (ví, ngân hàng...). Từ đó lương, chi tiêu, chuyển khoản và thu nhập Grab đều tự liên thông với nhau, dùng được lâu dài.</p>
        <button class="btn primary lg" data-act="tab" data-tab="accounts">Thiết lập ngay</button></section>`;
    } else {
      const b = L.accountBalances(S);
      const rows = S.accounts.map(a => ({ id: a.id, name: a.name, v: b.byId[a.id] })).concat(b.grab == null ? [] : [{ id: GRAB, name: 'Tiền Grab', v: b.grab }]);
      const hasDebt = S.debts.length > 0;
      html += `<section class="card"><div class="eyebrow">${hasDebt ? 'Tài sản ròng (tài sản − nợ)' : 'Tổng tài sản'}</div>
        <div class="big ${(hasDebt ? b.net : b.total) < 0 ? 'neg' : ''}">${fmtMoney(hasDebt ? b.net : b.total)}</div>
        ${rows.map(a => `<div class="kv"><span>${esc(a.name)}</span><b class="${a.v < 0 ? 'neg' : ''}">${fmtMoney(a.v)}</b></div>`).join('')}
        ${hasDebt ? `<div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px"><span>Tổng tài sản</span><b>${fmtMoney(b.total)}</b></div>
          <div class="kv"><span>Nợ phải trả</span><b class="neg">−${fmtMoney(b.debtTotal)}</b></div>` : ''}
        <button class="link left" data-act="tab" data-tab="accounts">Quản lý tài khoản và nợ ›</button></section>`;
    }
    html += monthNavHtml(monthOff, 'fin-prev', 'fin-next');
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
    html += reportNotes(rep, r);
    return html;
  }

  function viewLedger() {
    const r = L.monthRange(monthOff);
    const rep = L.periodReport(S, r.from, r.to);
    let items = L.unifiedEntries(S, r.from, r.to);
    if (ledFilter !== 'all') items = items.filter(e => e.type === ledFilter);
    let html = L.ledgerReady(S) ? `<button class="btn primary lg" data-act="add-tx" style="margin:0 0 14px">＋ Thêm giao dịch</button>`
      : `<div class="alert"><div>Hãy thiết lập sổ tài chính ở tab <b>Tài khoản</b> trước khi thêm giao dịch.</div><button class="btn sm" data-act="tab" data-tab="accounts">Thiết lập</button></div>`;
    html += monthNavHtml(monthOff, 'led-prev', 'led-next');
    html += `<div class="tiles">
      <div class="tile in"><div class="k">THU</div>${tileHtml('', tileNum(rep.income))}</div>
      <div class="tile out"><div class="k">CHI</div>${tileHtml('', tileNum(rep.expense))}</div>
      <div class="tile"><div class="k">CHÊNH LỆCH</div>${tileHtml(sgn(rep.net), (rep.net > 0 ? '+' : '') + tileNum(rep.net))}</div></div>`;
    html += reportNotes(rep, r);
    html += `<div class="seg" style="margin-bottom:12px">${[['all', 'Tất cả'], ['income', 'Thu'], ['expense', 'Chi'], ['transfer', 'Chuyển'], ['debtpay', 'Trả nợ']].map(f =>
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
        ${whenSeg(S.capital ? S.capital.when : 'end')}
        <div class="err" id="err"></div>
        <button class="btn primary lg" data-act="ledger-start">Bắt đầu</button></section>`;
    }
    const b = L.accountBalances(S);
    const list = S.accounts.map(a => `<button class="row" data-act="edit-account" data-id="${a.id}"><div class="l"><b>${esc(a.name)}</b><span class="muted">${L.ACCT_KINDS[a.kind] || 'Khác'}</span></div><div class="amt ${b.byId[a.id] < 0 ? 'neg' : ''}">${fmtMoney(b.byId[a.id])}</div></button>`).join('');
    const grabRow = `<button class="row" data-act="goto-pot"><div class="l"><b>Tiền Grab</b><span class="muted">${b.grab == null ? 'Chưa có dữ liệu Grab nào' : b.grabImplicit ? 'Chưa nhập vốn Grab: đang tính từ 0 kể từ bản ghi Grab đầu tiên. Bấm để nhập vốn.' : L.grabExcluded(S).n > ((S.capital || {}).ack || 0) ? `⚠️ ${L.grabExcluded(S).n} ca nằm trong phần đã tính vào vốn Grab nên chưa được cộng. Bấm để xem.` : 'Lấy từ mục Grab, bấm để xem chi tiết'}</span></div><div class="amt">${b.grab == null ? '—' : fmtMoney(b.grab)}</div></button>`;
    const hasDebt = S.debts.length > 0;
    const debtRows = S.debts.map(d => {
      const bal = b.debts[d.id];
      let sub;
      if (d.kind === 'loan') {
        const rows = L.loanSchedule(S, d);
        sub = rows.length ? `Kỳ tới ${dmOf(rows[0].cut)} · còn ${rows.length} kỳ · lãi ${String(d.rate).replace('.', ',')}%/năm` : 'Đã trả hết';
      } else {
        sub = `Hạn mức ${fmtMoney(d.limit || 0)} · còn khả dụng ${fmtMoney(Math.max(0, (d.limit || 0) - bal))}${d.dueDay ? ' · đến hạn ngày ' + d.dueDay : ''}`;
      }
      return `<button class="row" data-act="debt-detail" data-id="${d.id}"><div class="l"><b>${esc(debtLabel(d))}</b><span class="muted">${sub}</span></div><div class="amt neg">${fmtMoney(bal)}</div></button>`;
    }).join('');
    return `<section class="card"><div class="eyebrow">${hasDebt ? 'Tài sản ròng (tài sản − nợ)' : 'Tổng tài sản'}</div><div class="big ${(hasDebt ? b.net : b.total) < 0 ? 'neg' : ''}">${fmtMoney(hasDebt ? b.net : b.total)}</div>
        ${hasDebt ? `<div class="kv"><span>Tổng tài sản</span><b>${fmtMoney(b.total)}</b></div><div class="kv"><span>Nợ phải trả</span><b class="neg">−${fmtMoney(b.debtTotal)}</b></div>` : ''}
        <div class="muted small">Sổ bắt đầu từ ${whenLabel(S.ledger.when)} ${dmOf(S.ledger.start)}, chạy tiếp lâu dài.</div>
        <button class="btn primary lg" data-act="add-account">＋ Thêm tài khoản</button></section>
      <section class="card tight"><div class="group-h">Tài khoản</div>${list || '<div class="empty">Chưa có tài khoản nào. Thêm ví tiền mặt, tài khoản ngân hàng...</div>'}${grabRow}</section>
      <section class="card tight"><div class="group-h">Nợ (khoản vay, thẻ tín dụng)</div>${debtRows || '<div class="empty">Chưa có khoản nợ nào.</div>'}
        <div style="padding:6px 12px 10px"><button class="btn" data-act="add-debt">＋ Thêm khoản nợ</button></div></section>
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
      ${moneyField('f-open', `Số dư tại ${whenLabel(S.ledger.when)} ${dmOf(S.ledger.start)} (ngày bắt đầu sổ)`, a ? a.opening : '', { focus: !a })}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-account" data-id="${a ? a.id : ''}">${a ? 'Lưu thay đổi' : 'Thêm tài khoản'}</button>
      ${a ? `<div class="card" style="margin:14px 0 0;background:var(--bg);box-shadow:none">
          <div class="kv"><span>Số dư hiện tại theo app</span><b>${fmtMoney(bal)}</b></div>
          ${moneyField('f-actual', 'Số dư thực tế bạn đang có', '', { hint: 'Nếu lệch, app ghi một giao dịch "Điều chỉnh số dư" để khớp lại.' })}
          <button class="btn" data-act="adjust-account" data-id="${a.id}">Ghi điều chỉnh số dư</button></div>
        <button class="link danger" data-act="del-account" data-id="${a.id}">Xoá tài khoản</button>` : ''}`);
  }

  // ---- Sheet: giao dịch (Chi / Thu / Chuyển)
  const acctOptions = withCards => S.accounts.map(a => ({ id: a.id, name: a.name })).concat(L.grabPot(S) ? [{ id: GRAB, name: 'Tiền Grab' }] : [])
    .concat(withCards ? S.debts.filter(d => d.kind === 'card').map(d => ({ id: d.id, name: 'Thẻ ' + d.name })) : []); // chi bằng thẻ tín dụng
  // Tài khoản đã chọn nếu còn tồn tại, không thì tài khoản dùng gần nhất / đầu tiên (tránh ghi giao dịch vào tài khoản đã xoá)
  const validAcct = (id, withCards) => (acctOptions(withCards).some(o => o.id === id) ? id : defaultAcct());
  const defaultAcct = () => { const o = acctOptions(); return (o.find(x => x.id === S.ledger.lastAcct) || o[0] || {}).id || ''; };
  function acctChips(role, selected, withCards) {
    return `<div class="chips" id="ch-${role}">${acctOptions(withCards).map(o => `<button type="button" class="chip ${o.id === selected ? 'on' : ''}" data-act="pick-acct" data-role="${role}" data-id="${o.id}">${esc(o.name)}</button>`).join('')}</div><input type="hidden" id="f-${role}" value="${esc(selected || '')}">`;
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
    let body = moneyField('f-amt', type === 'debtpay' ? 'Tổng số tiền trả' : 'Số tiền', amt, { focus: !t });
    if (type === 'transfer') {
      const from = v.from || (t ? t.acct : defaultAcct());
      const to = v.to || (t ? t.to : ((acctOptions().find(o => o.id !== from) || {}).id || ''));
      body += `<label class="l">Từ tài khoản</label>${acctChips('from', from)}<label class="l">Đến tài khoản</label>${acctChips('to', to)}`;
    } else if (type === 'debtpay') {
      const debt = v.debt || (t ? t.debt : ((S.debts[0] || {}).id || ''));
      const acct = validAcct(v.acct || (t ? t.acct : ''), false);
      const intr = v.interest != null ? v.interest : (t ? t.interest : '');
      body += `<label class="l">Khoản nợ</label>
        <div class="chips" id="ch-debt">${S.debts.map(d => `<button type="button" class="chip ${d.id === debt ? 'on' : ''}" data-act="pick-debt" data-id="${d.id}">${esc(debtLabel(d))}</button>`).join('')}</div>
        <input type="hidden" id="f-debt" value="${esc(debt)}">
        <label class="l">Trả từ tài khoản</label>${acctChips('acct', acct)}
        ${moneyField('f-int', 'Trong đó lãi / phí', intr === undefined ? '' : intr, { hint: 'Phần lãi và phí tính là chi; phần còn lại là trả gốc, làm giảm dư nợ.' })}
        <div class="hint" id="int-pct" style="margin:-6px 0 10px"></div>`;
    } else {
      const acct = validAcct(v.acct || (t ? t.acct : ''), type === 'expense');
      const sel = v.cat || (t ? t.cat : L.TX_CATS[type][0]);
      body += `<label class="l">${type === 'income' ? 'Vào tài khoản' : 'Trả từ tài khoản'}</label>${acctChips('acct', acct, type === 'expense')}
        <label class="l">Danh mục</label><div class="chips" id="txchips">${txCatChips(type, sel)}</div>
        <input type="hidden" id="f-cat" value="${esc(sel)}">
        ${textField('f-cat2', 'Hoặc gõ danh mục khác', '', 'vd: Học phí, Sửa nhà...')}`;
    }
    return body + textField('f-note', 'Ghi chú (tuỳ chọn)', note, '') + dateField('f-date', 'Ngày', date)
      + `<div class="hint" style="margin:-6px 0 10px">Ngày ${S.ledger.when === 'start' ? 'trước' : 'từ'} ${dmOf(S.ledger.start)}${S.ledger.when === 'start' ? '' : ' trở về trước'} (ngày bắt đầu sổ) chỉ để tham khảo, không cộng vào số dư.</div>`;
  }
  // t: giao dịch đang sửa; pre: giá trị điền sẵn; ctx: ngữ cảnh từ "Sắp đến hạn" (khoản định kỳ cần đánh dấu đã xử lý)
  function txSheet(t, pre, ctx) {
    if (!L.ledgerReady(S)) { toast('Hãy thiết lập sổ tài chính trước'); tab = 'accounts'; render(true); return; }
    if (!acctOptions().length) { toast('Hãy thêm ít nhất một tài khoản trước'); tab = 'accounts'; render(true); return; }
    txCtx = ctx || null;
    txType = t ? t.type : ((pre && pre.type) || 'expense'); // ghi mới mặc định "Chi" (loại hay dùng nhất)
    openSheet(t ? 'Sửa giao dịch' : 'Thêm giao dịch', `
      <div class="seg" id="txseg">${[['expense', 'Chi'], ['income', 'Thu'], ['transfer', 'Chuyển'], ['debtpay', 'Trả nợ']].map(x => `<button type="button" class="${x[0] === txType ? 'on' : ''}" data-act="tx-type" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div id="txf">${txFields(txType, t, pre)}</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-tx" data-id="${t ? t.id : ''}">${t ? 'Lưu thay đổi' : 'Lưu'}</button>
      ${t ? `<button class="link danger" data-act="del-tx" data-id="${t.id}">Xoá giao dịch</button>` : ''}`);
    updateIntPct();
  }

  // ---------------------------------------------------------------- nợ, khoản định kỳ, nhắc hẹn
  const relDays = (k, today) => { const n = L.daysBetween(today, k); return n < 0 ? `quá hạn ${-n} ngày` : n === 0 ? 'hôm nay' : `còn ${n} ngày`; };
  const actionLabel = u => (u.kind === 'recurring' ? (u.type === 'income' ? 'Đã nhận' : 'Đã chi') : 'Đã trả');
  const dataOf = u => `data-kind="${u.kind}" data-id="${u.id}" data-date="${u.date}"`;

  // Nhắc ở Tổng quan: các khoản đến hạn trong vòng N ngày tới (hoặc đã quá hạn chưa xử lý)
  function reminderAlerts() {
    const today = L.todayKey(), rd = Number(S.settings.remindDays) || 3;
    const items = L.upcoming(S, today, rd);
    if (!items.length) return '';
    return items.slice(0, 3).map(u => `<div class="alert ${u.overdue ? 'bad' : ''}"><div>⏰ <b>${esc(u.title)}</b> · ${dmOf(u.date)} (${relDays(u.date, today)})${u.amount ? ' · ' + fmtMoney(u.amount) : ''}</div><button class="btn sm" data-act="do-upcoming" ${dataOf(u)} style="margin:0">${actionLabel(u)}</button></div>`).join('')
      + (items.length > 3 ? `<button class="link" data-act="tab" data-tab="plan">+${items.length - 3} khoản khác sắp đến hạn ›</button>` : '');
  }

  function upcomingRow(u, today) {
    const inc = u.kind === 'recurring' && u.type === 'income';
    const extra = u.kind === 'loan' && u.row ? ` · gốc ${fmtMoney(u.row.principal)} + lãi ${fmtMoney(u.row.interest)}` : '';
    return `<div class="row div"><div class="l"><b>${esc(u.title)}</b><span class="muted ${u.overdue ? 'neg' : ''}">${keyLabel(u.date)} · ${relDays(u.date, today)}${extra}</span></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none"><b class="${u.overdue ? 'neg' : inc ? 'pos' : ''}">${u.amount ? (inc ? '+' : '') + fmtMoney(u.amount) : ''}</b>
      <button class="btn xs" data-act="do-upcoming" ${dataOf(u)}>${actionLabel(u)}</button></div></div>`;
  }

  function viewPlan() {
    const today = L.todayKey(), rd = Number(S.settings.remindDays) || 3;
    const items = L.upcoming(S, today, 30);
    const recRows = S.recurring.map(r => `<button class="row" data-act="edit-rec" data-id="${r.id}"><div class="l"><b>${esc(r.name)}</b><span class="muted">${r.type === 'income' ? 'Thu' : 'Chi'} · ngày ${(r.days || []).join(', ')} hằng tháng${r.active === false ? ' · tạm dừng' : ''}</span></div><div class="amt ${r.type === 'income' ? 'pos' : ''}">${r.amount ? (r.type === 'income' ? '+' : '') + fmtMoney(r.amount) : ''}</div></button>`).join('');
    return `<section class="card"><div class="eyebrow">Nhắc hẹn</div>
        <p class="muted small" style="margin:6px 0 10px">App nhắc trước <b>${rd} ngày</b> ở màn Tổng quan mỗi khi bạn mở app (đổi ở Cài đặt). Muốn iPhone tự báo thức kể cả khi chưa mở app, hãy thêm các khoản vào Lịch.</p>
        <button class="btn primary" data-act="export-ics">📅 Thêm vào Lịch iPhone</button></section>
      <section class="card tight"><div class="group-h">Sắp đến hạn · 30 ngày tới</div>${items.length ? items.map(u => upcomingRow(u, today)).join('') : '<div class="empty">Chưa có khoản nào. Hãy thêm khoản định kỳ (lương, tiền nhà...) hoặc khoản nợ.</div>'}</section>
      <section class="card tight"><div class="group-h">Khoản định kỳ (lương, chuyển cho vợ, tiền nhà...)</div>${recRows || '<div class="empty">Chưa có khoản định kỳ nào.</div>'}
        <div style="padding:6px 12px 10px"><button class="btn" data-act="add-rec">＋ Thêm khoản định kỳ</button></div></section>`;
  }

  // ---- Sheet: khoản định kỳ
  let recType = 'income';
  function recFields(type, r, v) {
    v = v || {};
    const name = v.name != null ? v.name : (r ? r.name : '');
    const amt = v.amt != null ? v.amt : (r ? r.amount : '');
    const days = v.days != null ? v.days : (r ? (r.days || []).join(', ') : '');
    const acct = v.acct || (r ? r.acct : defaultAcct());
    const sel = v.cat || (r ? r.cat : L.TX_CATS[type][0]);
    const done = v.done || (r && r.doneUpTo) || L.todayKey();
    return textField('f-name', 'Tên khoản', name, type === 'income' ? 'vd Lương kỳ 1' : 'vd Chuyển cho vợ')
      + moneyField('f-amt', type === 'income' ? 'Số tiền dự kiến (số thực nhận nhập khi nhận)' : 'Số tiền', amt)
      + `<div class="fld"><label for="f-days">Ngày trong tháng</label><input id="f-days" inputmode="numeric" autocomplete="off" value="${esc(days)}" placeholder="vd 15  hoặc  5, 15"><div class="hint">Lặp lại mỗi tháng vào các ngày này (nhiều ngày thì cách nhau dấu phẩy).</div></div>`
      + `<label class="l">${type === 'income' ? 'Vào tài khoản' : 'Trả từ tài khoản'}</label>${acctChips('acct', acct, type === 'expense')}`
      + `<label class="l">Danh mục</label><div class="chips" id="txchips">${txCatChips(type, sel)}</div><input type="hidden" id="f-cat" value="${esc(sel)}">${textField('f-cat2', 'Hoặc gõ danh mục khác', '', '')}`
      + dateField('f-done', 'Đã xử lý tới ngày', done) + `<div class="hint" style="margin:-6px 0 10px">Chỉ các ngày <b>sau</b> ngày này mới hiện ở "Sắp đến hạn".</div>`;
  }
  function recSheet(r) {
    if (!acctOptions().length) { toast('Hãy thêm ít nhất một tài khoản trước'); tab = 'accounts'; render(true); return; }
    recType = r ? r.type : 'income';
    openSheet(r ? 'Sửa khoản định kỳ' : 'Thêm khoản định kỳ', `
      <div class="seg" id="recseg">${[['income', 'Thu (lương...)'], ['expense', 'Chi (cố định)']].map(x => `<button type="button" class="${x[0] === recType ? 'on' : ''}" data-act="rec-type" data-t="${x[0]}">${x[1]}</button>`).join('')}</div>
      <div id="recf">${recFields(recType, r)}</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-rec" data-id="${r ? r.id : ''}">${r ? 'Lưu thay đổi' : 'Thêm'}</button>
      ${r ? `<button class="link danger" data-act="del-rec" data-id="${r.id}">Xoá khoản định kỳ</button>` : ''}`);
  }

  // ---- Sheet: khoản nợ (vay trả góp / thẻ tín dụng)
  let dKind = 'loan';
  function debtFields(kind, d, v) {
    v = v || {};
    const g = (k, dv) => (v[k] != null ? v[k] : (d && d[k] != null ? d[k] : dv));
    let h = textField('f-name', kind === 'card' ? 'Tên thẻ' : 'Tên khoản vay', g('name', ''), kind === 'card' ? 'vd Vietcombank' : 'vd Vay ngân hàng')
      + moneyField('f-bal', kind === 'card' ? 'Dư nợ hiện tại của thẻ' : 'Dư nợ gốc còn lại', g('opening', ''), { focus: !d })
      + dateField('f-asof', 'Dư nợ này tính tại ngày', g('asOf', L.todayKey())) + whenSeg(g('when', 'start'));
    if (kind === 'loan') {
      h += decField('f-rate', 'Lãi suất (%/năm, tính theo dư nợ giảm dần)', g('rate', ''), { suf: '%' })
        + moneyField('f-pay', 'Số tiền trả mỗi kỳ (gốc + lãi)', g('payment', ''))
        + intField('f-dueday', 'Ngày trả hằng tháng', g('dueDay', ''), { suf: 'ngày', hint: 'Ngày ghi trong hợp đồng, ví dụ 6. Rơi vào Thứ 7/CN thì ngân hàng cắt tiền thứ Hai.' })
        + dateField('f-nextdue', 'Ngày trả kỳ tới (để trống: tự tính)', g('nextDue', ''))
        + dateField('f-lastpaid', 'Ngày cắt tiền kỳ vừa rồi (để trống: tự tính)', g('lastPaid', ''))
        + decField('f-fee', 'Phí trả trước hạn (% dư nợ gốc còn lại)', g('feePct', ''), { suf: '%' })
        + `<label class="check"><input type="checkbox" id="f-weekend" ${d && d.weekend === false ? '' : 'checked'}> Ngày trả rơi vào Thứ 7/CN thì cắt tiền thứ Hai</label>`;
    } else {
      h += moneyField('f-limit', 'Hạn mức thẻ', g('limit', ''))
        + intField('f-dueday', 'Ngày đến hạn thanh toán (tuỳ chọn)', g('dueDay', ''), { suf: 'ngày' })
        + intField('f-stmt', 'Ngày sao kê (tuỳ chọn)', g('stmtDay', ''), { suf: 'ngày' });
    }
    return h;
  }
  function debtSheet(d) {
    dKind = d ? d.kind : 'loan';
    openSheet(d ? 'Sửa khoản nợ' : 'Thêm khoản nợ', `
      ${d ? '' : `<div class="seg" id="dkseg">${[['loan', 'Vay trả góp'], ['card', 'Thẻ tín dụng']].map(x => `<button type="button" class="${x[0] === dKind ? 'on' : ''}" data-act="pick-dkind" data-k="${x[0]}">${x[1]}</button>`).join('')}</div>`}
      <div id="dbf">${debtFields(dKind, d)}</div>
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-debt" data-id="${d ? d.id : ''}">${d ? 'Lưu thay đổi' : 'Thêm khoản nợ'}</button>
      ${d ? `<button class="link danger" data-act="del-debt" data-id="${d.id}">Xoá khoản nợ</button>` : ''}`);
  }

  function debtDetail(id) {
    const d = debtOf(id); if (!d) return;
    const bal = L.debtBalance(S, d), today = L.todayKey();
    let body;
    if (d.kind === 'loan') {
      const rows = L.loanSchedule(S, d), next = rows[0];
      const totalInterest = rows.reduce((a, r) => a + r.interest, 0);
      const po = L.loanPayoff(S, d, today);
      body = `<div class="big neg" style="font-size:30px">${fmtMoney(bal)}</div><div class="muted small" style="margin-bottom:10px">dư nợ gốc còn lại</div>
        <div class="kv"><span>Lãi suất</span><b>${String(d.rate).replace('.', ',')}%/năm (theo dư nợ giảm dần)</b></div>
        <div class="kv"><span>Trả mỗi kỳ</span><b>${fmtMoney(d.payment)}</b></div>
        <div class="kv"><span>Ngày trả</span><b>ngày ${d.dueDay} hằng tháng</b></div>
        ${next ? `<div class="kv"><span>Kỳ tới</span><b>${keyLabel(next.cut)} (${relDays(next.cut, today)})</b></div>
          <div class="kv"><span>— trong đó gốc / lãi</span><b>${fmtMoney(next.principal)} / ${fmtMoney(next.interest)}</b></div>` : ''}
        <div class="kv"><span>Số kỳ còn lại</span><b>${rows.length}</b></div>
        ${rows.length ? `<div class="kv"><span>Dự kiến trả hết</span><b>${dmOf(rows[rows.length - 1].cut)}/${rows[rows.length - 1].cut.slice(0, 4)}</b></div>` : ''}
        <div class="kv"><span>Tổng lãi còn phải trả</span><b>${fmtMoney(totalInterest)}</b></div>
        <div class="kv"><span>Tất toán hôm nay</span><b>${fmtMoney(po.total)}</b></div>
        <div class="hint" style="margin:-2px 0 10px">= dư nợ ${fmtMoney(po.balance)} + lãi tới hôm nay ${fmtMoney(po.interest)}${po.fee ? ' + phí trả trước hạn ' + fmtMoney(po.fee) : ''}. Số ngân hàng báo có thể lệch nhẹ.</div>
        <button class="btn primary lg" data-act="pay-debt" data-id="${d.id}">Ghi trả kỳ này</button>
        <details style="margin-top:12px"><summary>Xem lịch trả (${rows.length} kỳ)</summary>
          <div style="margin-top:6px">${rows.map(r => `<div class="kv" style="font-size:13.5px"><span>${keyLabel(r.cut)}</span><span class="muted">lãi ${L.fmtInt(r.interest)} · gốc ${L.fmtInt(r.principal)}</span><b>${L.fmtInt(r.balance)}</b></div>`).join('')}</div></details>`;
    } else {
      const avail = Math.max(0, (d.limit || 0) - bal), pct = d.limit ? Math.min(100, Math.round(bal / d.limit * 100)) : 0;
      body = `<div class="big neg" style="font-size:30px">${fmtMoney(bal)}</div><div class="muted small">dư nợ hiện tại</div>
        <div class="progress ${pct >= 90 ? 'over' : pct >= 70 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
        <div class="kv"><span>Hạn mức</span><b>${fmtMoney(d.limit || 0)}</b></div>
        <div class="kv"><span>Còn khả dụng</span><b>${fmtMoney(avail)} (đã dùng ${pct}%)</b></div>
        ${d.stmtDay ? `<div class="kv"><span>Ngày sao kê</span><b>ngày ${d.stmtDay}</b></div>` : ''}
        ${d.dueDay ? `<div class="kv"><span>Đến hạn thanh toán</span><b>ngày ${d.dueDay} hằng tháng</b></div>` : ''}
        ${cardInterestBlock(d, bal)}
        <div class="hint" style="margin:6px 0 10px">Quẹt thẻ: ghi giao dịch Chi và chọn "Thẻ ${esc(d.name)}" làm tài khoản. Trả thẻ: dùng nút bên dưới.</div>
        <button class="btn primary lg" data-act="pay-debt" data-id="${d.id}">Ghi trả thẻ</button>`;
    }
    openSheet(debtLabel(d), body + `<button class="link" data-act="edit-debt" data-id="${d.id}">Sửa thông tin khoản nợ</button>`);
  }

  // Lãi thực tế của thẻ, tính từ những lần trả có nhập lãi/phí
  function cardInterestBlock(d, bal) {
    const h = L.cardInterestHistory(S, d);
    if (!h.length) return '<div class="hint" style="margin:6px 0 4px">Mỗi lần trả thẻ, nhập số lãi/phí ngân hàng tính ở ô "Trong đó lãi / phí". App sẽ tự cho biết đó là bao nhiêu % dư nợ.</div>';
    const last = h[h.length - 1], recent = h.slice(-3).reverse();
    return `<div class="kv" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px"><span>Lãi gần nhất</span><b>${pctStr(last.pct)}% dư nợ ≈ ${pctStr(L.cardPctPerYear(last.pct))}%/năm</b></div>
      ${recent.map(r => `<div class="kv" style="font-size:13.5px"><span>${dmOf(r.date)} · lãi/phí ${fmtMoney(r.interest)}</span><span class="muted">trên dư nợ ${fmtMoney(r.base)} = ${pctStr(r.pct)}%</span></div>`).join('')}
      ${bal > 0 ? `<div class="kv"><span>Nếu để nguyên dư nợ hiện tại</span><b>lãi kỳ tới ≈ ${fmtMoney(Math.round(bal * last.pct / 100))}</b></div>` : ''}
      <div class="hint" style="margin:0 0 6px">Ước tính theo % của lần gần nhất; số thật theo sao kê. Quy ra năm là gần đúng (kỳ ~30 ngày, và khoản lãi có thể gồm cả phí).</div>`;
  }

  // ---------------------------------------------------------------- kiểm tra dữ liệu
  function integrityCard() {
    if (!L.ledgerReady(S) && !S.tx.length && !S.debts.length) return '';
    const issues = L.checkIntegrity(S);
    const errors = issues.filter(i => i.sev === 'error'), warns = issues.filter(i => i.sev !== 'error');
    const b = L.accountBalances(S);
    const refOnly = S.tx.filter(t => S.ledger.start && !t.adj && !L.ledgerCounts(S, t.date)).length;
    const rowOf = (i, cls) => `<button class="row" ${i.kind === 'tx' ? `data-act="edit-tx" data-id="${i.id}"` : i.kind === 'rec' ? `data-act="edit-rec" data-id="${i.id}"` : i.kind === 'fill' ? `data-act="edit-fill" data-id="${i.id}"` : 'data-act="tab" data-tab="plan"'}><div class="l"><b class="${cls}">${cls === 'neg' ? '⚠️' : 'ℹ️'} ${esc(i.msg)}</b><span class="muted">Bấm để xem và sửa</span></div></button>`;
    return `<section class="card"><h2>Kiểm tra dữ liệu</h2>
      ${errors.length ? `<div class="alert bad" style="margin:0 0 8px"><div><b>${errors.length} chỗ lệch:</b> số tiền của các giao dịch này không được tính ở đâu cả.</div></div><div class="card tight" style="box-shadow:none;margin:0 0 10px">${errors.map(i => rowOf(i, 'neg')).join('')}</div>` : ''}
      ${warns.length ? `<div class="alert" style="margin:0 0 8px"><div><b>${warns.length} điểm cần xem:</b> số liệu vẫn được tính nhưng có thể chưa đúng ý bạn.</div></div><div class="card tight" style="box-shadow:none;margin:0 0 10px">${warns.map(i => rowOf(i, '')).join('')}</div>` : ''}
      ${!issues.length ? '<div class="alert ok" style="margin:0 0 8px"><div>✅ Dữ liệu nhất quán: không có tham chiếu hỏng, giao dịch ngày tương lai hay nhập trùng.</div></div>' : ''}
      <div class="kv"><span>Tài khoản + Tiền Grab</span><b>${fmtMoney(b.total)}</b></div>
      <div class="kv"><span>Tổng dư nợ (${S.debts.length} khoản)</span><b class="neg">−${fmtMoney(b.debtTotal)}</b></div>
      <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px"><span>Tài sản ròng</span><b>${fmtMoney(b.net)}</b></div>
      <div class="kv"><span>Giao dịch</span><b>${S.tx.length}${refOnly ? ` (${refOnly} chỉ tham khảo)` : ''}</b></div>
      <p class="hint" style="margin:6px 0 0">Tài sản ròng = tài khoản + Tiền Grab − dư nợ. Giao dịch "chỉ tham khảo" nằm trước ngày bắt đầu sổ nên không cộng vào số dư.</p></section>`;
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
        ${nField('tireInterval', 'Chu kỳ thay lốp', st.tireInterval, 'km', 'int', 'Các chu kỳ lốp, phanh, sên, bugi là số ước tính; chỉnh theo sổ bảo dưỡng xe của bạn.')}
        ${nField('brakeInterval', 'Chu kỳ thay má phanh', st.brakeInterval, 'km', 'int')}
        ${nField('chainInterval', 'Chu kỳ thay sên nhông dĩa', st.chainInterval, 'km', 'int')}
        ${nField('plugInterval', 'Chu kỳ thay bugi / lọc gió', st.plugInterval, 'km', 'int')}
      </section>
      <section class="card"><h2>Cách tính</h2><div class="muted small" style="line-height:1.55">
        <b>Xăng của ca</b> = km × mức tiêu hao (lít/100km) × giá xăng của ngày chạy.<br>
        <b>Hao mòn</b> = km × đơn giá hao mòn (chỉ để ước tính lãi, không phải tiền cần tách riêng).<br>
        <b>Lãi ca</b> = thu ròng app + tip/thưởng − xăng − hao mòn.<br>
        Hóa đơn xăng và bảo dưỡng không cộng thẳng vào chi phí lãi (đã tính theo km); chúng dùng để học mức tiêu hao và là tiền thật ra khỏi túi ở "Tiền Grab" và sổ tài chính.</div></section>`;
  }

  function viewSettings() {
    const last = S.lastBackup ? new Date(S.lastBackup).toLocaleString('vi-VN') : 'chưa có';
    const rd = Number(S.settings.remindDays) || 3;
    return `${themeCard()}
      ${integrityCard()}
      <section class="card"><h2>Nhắc hẹn</h2>
        <div class="fld"><label for="remindSel">Nhắc trước khi đến hạn</label>
          <select id="remindSel" data-setting="remindDays">${[1, 2, 3, 5, 7].map(n => `<option value="${n}" ${n === rd ? 'selected' : ''}>${n} ngày</option>`).join('')}</select></div>
        <p class="hint" style="margin:0">Áp dụng cho khoản định kỳ, khoản vay và thẻ tín dụng: hiện ở màn Tổng quan khi mở app và làm giờ báo thức trong file Lịch (tab Kế hoạch).</p></section>
      ${securityCard()}
      <section class="card"><h2>Sao lưu dữ liệu</h2>
        <p class="muted small" style="margin:0 0 10px">Dữ liệu chỉ lưu trên điện thoại này. Hãy sao lưu thường xuyên (lưu file vào Files/iCloud). Lần cuối: <b>${last}</b>.${vaultKey ? ' File xuất ra được <b>mã hoá bằng mật khẩu hiện tại</b>; muốn mở lại phải nhớ mật khẩu đó.' : ''}</p>
        <div class="btn-row"><button class="btn" data-act="export">⬆︎ Xuất file</button><button class="btn" data-act="import">⬇︎ Nhập file</button></div>
        ${vaultKey ? '<button class="link" data-act="export-plain">Xuất file không mã hoá (không khuyến nghị)</button>' : ''}
        <button class="link danger" data-act="reset-ledger">Làm lại sổ tài chính (giữ dữ liệu Grab)</button>
        <button class="link danger" data-act="wipe">Xoá toàn bộ dữ liệu</button></section>`;
  }

  // ---------------------------------------------------------------- dựng màn hình
  function render(scrollTop) {
    if (locked) return;
    $('#view').innerHTML = ({ overview: viewFinance, ledger: viewLedger, accounts: viewAccounts, plan: viewPlan, grab: viewGrab, settings: viewSettings })[tab]();
    $('#title').textContent = TITLES[tab];
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.body.classList.toggle('on-settings', tab === 'settings');
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

  // ---- Nợ
  A['add-debt'] = () => debtSheet(null);
  A['edit-debt'] = el => { const d = debtOf(el.dataset.id); if (d) debtSheet(d); };
  A['debt-detail'] = el => debtDetail(el.dataset.id);
  A['pick-dkind'] = el => {
    dKind = el.dataset.k;
    $('#dkseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
    $('#dbf').innerHTML = debtFields(dKind, null, { name: val('f-name') || undefined });
  };
  A['save-debt'] = el => {
    const kind = el.dataset.id ? debtOf(el.dataset.id).kind : dKind;
    const name = val('f-name'), bal = getInt('f-bal'), asOf = val('f-asof');
    if (!name) return setErr('Nhập tên khoản nợ.');
    if (isNaN(bal)) return setErr('Nhập dư nợ hiện tại (nhập 0 nếu đã hết nợ).');
    if (!asOf) return setErr('Chọn ngày tính dư nợ.');
    const data = { kind, name, opening: bal, asOf, when: val('f-when') === 'start' ? 'start' : 'end' };
    if (kind === 'loan') {
      const rate = getDec('f-rate'), payment = getInt('f-pay'), dueDay = getInt('f-dueday');
      if (isNaN(rate) || rate < 0) return setErr('Nhập lãi suất %/năm (ví dụ 15,99).');
      if (isNaN(payment) || payment <= 0) return setErr('Nhập số tiền trả mỗi kỳ.');
      if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) return setErr('Nhập ngày trả hằng tháng (1–31).');
      const fee = getDec('f-fee');
      Object.assign(data, {
        rate, payment, dueDay,
        nextDue: val('f-nextdue') || L.nextMonthly(L.addDays(asOf, 1), dueDay),
        feePct: isNaN(fee) ? 0 : fee, weekend: $('#f-weekend').checked,
      });
      const lp = val('f-lastpaid'); if (lp) data.lastPaid = lp; else delete data.lastPaid;
    } else {
      const limit = getInt('f-limit'), dueDay = getInt('f-dueday'), stmt = getInt('f-stmt');
      if (isNaN(limit) || limit <= 0) return setErr('Nhập hạn mức thẻ.');
      Object.assign(data, { limit, dueDay: isNaN(dueDay) ? null : dueDay, stmtDay: isNaN(stmt) ? null : stmt });
    }
    if (el.dataset.id) { const d = debtOf(el.dataset.id); Object.assign(d, data); if (kind === 'loan' && !data.lastPaid) delete d.lastPaid; }
    else S.debts.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu khoản nợ');
  };
  A['del-debt'] = el => {
    const id = el.dataset.id;
    const n = S.tx.filter(t => t.debt === id || t.acct === id).length;
    const nf = S.fills.filter(x => x.acct === id).length;
    if (nf) { toast(`Thẻ đang dùng cho ${nf} lần đổ xăng, hãy đổi tài khoản ở các lần đó trước`); return; }
    if (n) { toast(`Khoản nợ đang có ${n} giao dịch, hãy xoá chúng trước`); return; }
    if (!confirm('Xoá khoản nợ này?')) return;
    S.debts = S.debts.filter(d => d.id !== id); save(); closeSheet(); render(); toast('Đã xoá khoản nợ');
  };
  A['pay-debt'] = el => {
    const d = debtOf(el.dataset.id); if (!d) return;
    const today = L.todayKey();
    closeSheet();
    if (d.kind === 'loan') {
      const row = L.loanSchedule(S, d, 1)[0];
      const date = row && row.cut <= today ? row.cut : today; // ngân hàng tự cắt tiền vào ngày cắt
      const np = L.loanNextPayment(S, d, date);
      txSheet(null, { type: 'debtpay', debt: d.id, amt: np.amount, interest: np.interest, date });
    } else txSheet(null, { type: 'debtpay', debt: d.id, date: today });
  };

  // ---- Khoản định kỳ và "Sắp đến hạn"
  A['add-rec'] = () => recSheet(null);
  A['edit-rec'] = el => { const r = S.recurring.find(x => x.id === el.dataset.id); if (r) recSheet(r); };
  A['rec-type'] = el => {
    const num = id => { const x = getInt(id); return isNaN(x) ? '' : x; };
    const v = { name: val('f-name'), amt: num('f-amt'), days: val('f-days'), acct: val('f-acct') || undefined, done: val('f-done') };
    recType = el.dataset.t;
    $('#recseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === recType));
    $('#recf').innerHTML = recFields(recType, null, v);
  };
  A['save-rec'] = el => {
    const name = val('f-name'), amount = getInt('f-amt');
    const days = Array.from(new Set(val('f-days').split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n >= 1 && n <= 31))).sort((a, b) => a - b);
    if (!name) return setErr('Nhập tên khoản.');
    if (!days.length) return setErr('Nhập ít nhất một ngày trong tháng (1–31), ví dụ 15 hoặc 5, 15.');
    const data = { name, type: recType, amount: isNaN(amount) ? 0 : amount, days, acct: val('f-acct') || '', cat: val('f-cat2') || val('f-cat') || 'Khác', doneUpTo: val('f-done') || L.todayKey(), active: true };
    if (el.dataset.id) Object.assign(S.recurring.find(x => x.id === el.dataset.id), data);
    else S.recurring.push(Object.assign({ id: uid() }, data));
    save(); closeSheet(); render(); toast('Đã lưu khoản định kỳ');
  };
  A['del-rec'] = el => {
    if (!confirm('Xoá khoản định kỳ này? Các giao dịch đã ghi vẫn được giữ.')) return;
    S.recurring = S.recurring.filter(x => x.id !== el.dataset.id); save(); closeSheet(); render(); toast('Đã xoá');
  };
  A['do-upcoming'] = el => {
    const kind = el.dataset.kind, id = el.dataset.id, date = el.dataset.date, today = L.todayKey();
    if (!L.ledgerReady(S)) { toast('Hãy thiết lập sổ tài chính trước'); tab = 'accounts'; render(true); return; }
    if (kind === 'recurring') {
      const r = S.recurring.find(x => x.id === id); if (!r) return;
      // Ghi nhận vào HÔM NAY (tiền thật di chuyển lúc bạn bấm), không bao giờ ghi vào ngày chưa tới; kỳ định kỳ vẫn được đánh dấu theo ngày của kỳ đó
      txSheet(null, { type: r.type, amt: r.amount || '', acct: r.acct || undefined, cat: r.cat, note: r.name, date: today }, { recur: r.id, date });
    } else { el.dataset.id = id; A['pay-debt'](el); }
  };

  // ---- Xuất file Lịch (.ics): sự kiện lặp hằng tháng kèm báo thức trước N ngày
  A['export-ics'] = async () => {
    const text = L.buildIcs(S, L.todayKey(), Number(S.settings.remindDays) || 3);
    const blob = new Blob([text], { type: 'text/calendar' }), name = 'so-tai-chinh-nhac-han.ics';
    try {
      const file = new File([blob], name, { type: 'text/calendar' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Mở file vừa tải để thêm các nhắc hẹn vào Lịch');
  };
  A['ack-excluded'] = () => {
    if (!S.capital) return;
    S.capital.ack = L.grabExcluded(S).n; // đã hiểu: không nhắc nữa cho tới khi có thêm ca bị loại
    save(); render(); toast('Ok, mình sẽ không nhắc lại');
  };
  A['pick-when'] = el => {
    $('#f-when').value = el.dataset.w;
    $('#whenseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
  };

  // ---- Sổ tài chính: điều hướng
  A.gsub = el => { gsub = el.dataset.s; render(true); };
  A['goto-pot'] = () => { tab = 'grab'; gsub = 'pot'; render(true); };
  A['fin-prev'] = () => { monthOff--; render(); };
  A['fin-next'] = () => { if (monthOff < 0) { monthOff++; render(); } };
  A['led-prev'] = () => { monthOff--; render(); };
  A['led-next'] = () => { if (monthOff < 0) { monthOff++; render(); } };
  A['led-filter'] = el => { ledFilter = el.dataset.f; render(); };

  // ---- Sổ tài chính: ngày bắt đầu sổ
  A['ledger-start'] = () => {
    const date = val('f-date');
    if (!date) return setErr('Chọn ngày bắt đầu sổ.');
    if (date > L.todayKey()) return setErr('Ngày bắt đầu không được ở tương lai.');
    S.ledger.start = date; S.ledger.when = val('f-when') === 'start' ? 'start' : 'end';
    save(); render(); toast('Đã bắt đầu sổ tài chính. Giờ hãy thêm các tài khoản của bạn.');
  };
  A['edit-start'] = () => {
    openSheet('Sửa ngày bắt đầu sổ', `
      <div class="alert bad" style="margin:0 0 12px"><div>⚠️ Chỉ các giao dịch <b>sau</b> ngày bắt đầu được cộng vào số dư; giao dịch từ ngày này trở về trước chỉ để tham khảo. Số dư đầu kỳ của từng tài khoản phải là số dư <b>tại ngày bắt đầu</b>. Đổi ngày sẽ làm số dư các tài khoản thay đổi theo.</div></div>
      ${dateField('f-date', 'Ngày bắt đầu sổ', S.ledger.start)}
      ${whenSeg(S.ledger.when)}
      <div class="err" id="err"></div>
      <button class="btn primary lg" data-act="save-start">Lưu</button>`);
  };
  A['save-start'] = () => {
    const date = val('f-date');
    if (!date || date > L.todayKey()) return setErr('Ngày bắt đầu không hợp lệ.');
    S.ledger.start = date; S.ledger.when = val('f-when') === 'start' ? 'start' : 'end';
    save(); closeSheet(); render(); toast('Đã đổi ngày bắt đầu sổ');
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
    const nf = S.fills.filter(x => x.acct === id).length;
    if (nf) { toast(`Tài khoản đang dùng cho ${nf} lần đổ xăng, hãy đổi tài khoản ở các lần đó trước`); return; }
    if (n) { toast(`Tài khoản đang có ${n} giao dịch, hãy xoá hoặc chuyển chúng trước`); return; }
    if (!confirm('Xoá tài khoản này?')) return;
    S.accounts = S.accounts.filter(a => a.id !== id);
    S.recurring.forEach(r => { if (r.acct === id) r.acct = ''; });   // khoản định kỳ đang dùng tài khoản này
    if (S.ledger.lastAcct === id) S.ledger.lastAcct = null;
    save(); closeSheet(); render(); toast('Đã xoá tài khoản');
  };
  A['adjust-account'] = el => {
    const a = S.accounts.find(x => x.id === el.dataset.id), actual = getInt('f-actual');
    if (!a) return;
    if (isNaN(actual)) return setErr('Nhập số dư thực tế.');
    const today = L.todayKey();
    if (!L.ledgerCounts(S, today)) return setErr('Hôm nay chưa nằm trong phần sổ được tính (hãy sửa ngày bắt đầu sổ hoặc chọn "Đầu ngày").');
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
    v.debt = val('f-debt') || undefined;
    txType = el.dataset.t;
    if (txType === 'debtpay' && !S.debts.length) { toast('Hãy thêm khoản nợ ở tab Tài khoản trước'); return; }
    $('#txseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === txType));
    $('#txf').innerHTML = txFields(txType, null, v);
    if (txType === 'debtpay') refreshDebtPay();
  };
  // Khoản vay: điền sẵn số tiền trả và phần lãi theo số ngày thực tế tới ngày chọn
  const setMoneyField = (id, v) => { const e = $('#' + id); if (e) e.value = v ? L.fmtInt(v) : ''; };
  const pctStr = n => n.toFixed(2).replace('.', ',');
  // Thẻ: nhập lãi/phí thì hiện luôn bằng bao nhiêu % dư nợ (và quy ra năm)
  function updateIntPct() {
    const box = $('#int-pct'); if (!box) return;
    const d = debtOf(val('f-debt')), intr = getInt('f-int');
    if (!d || d.kind !== 'card' || isNaN(intr) || intr <= 0) { box.textContent = ''; return; }
    const sv = $('[data-act="save-tx"]'), base = L.cardInterestBase(S, d, val('f-date') || L.todayKey(), sv && sv.dataset.id);
    if (base <= 0) { box.textContent = 'Thẻ chưa có dư nợ tại ngày này nên chưa tính được %.'; return; }
    const pct = intr / base * 100;
    box.innerHTML = `Lãi/phí này = <b>${pctStr(pct)}%</b> dư nợ thẻ trước khi trả (${fmtMoney(base)}) ≈ <b>${pctStr(L.cardPctPerYear(pct))}%/năm</b> nếu kỳ tính lãi khoảng 30 ngày.`;
  }
  function refreshDebtPay() {
    updateIntPct();
    const d = debtOf(val('f-debt'));
    if (!d || d.kind !== 'loan') return;
    const np = L.loanNextPayment(S, d, val('f-date') || L.todayKey());
    setMoneyField('f-amt', np.amount); setMoneyField('f-int', np.interest);
  }
  A['pick-debt'] = el => {
    $('#f-debt').value = el.dataset.id;
    $('#ch-debt').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
    refreshDebtPay();
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
    } else if (type === 'debtpay') {
      const debt = val('f-debt'), acct = val('f-acct'), interest = getInt('f-int') || 0;
      if (!debt) return setErr('Chọn khoản nợ.');
      if (!acct) return setErr('Chọn tài khoản dùng để trả.');
      if (interest > amount) return setErr('Phần lãi/phí không thể lớn hơn tổng số tiền trả.');
      rec = { type, amount, acct, debt, interest, principal: amount - interest, cat: 'Trả nợ', note, date };
      S.ledger.lastAcct = acct;
    } else {
      const acct = val('f-acct');
      if (!acct) return setErr('Chọn tài khoản.');
      rec = { type, amount, acct, cat: val('f-cat2') || val('f-cat') || 'Khác', note, date };
      S.ledger.lastAcct = acct;
    }
    // Tiền Grab có mốc riêng (ngày chốt vốn Grab): giao dịch dính Tiền Grab phải sau mốc đó mới tính được
    if (S.capital && L.ledgerCounts(S, date) && !L.countsAfter(S.capital.date, S.capital.when, date) && (rec.acct === GRAB || rec.to === GRAB)) {
      return setErr(`Giao dịch dùng "Tiền Grab" phải nằm sau mốc vốn Grab (${dmOf(S.capital.date)}, ${whenLabel(S.capital.when)}).`);
    }
    if (el.dataset.id) {
      const t = S.tx.find(x => x.id === el.dataset.id); Object.assign(t, rec);
      if (type !== 'transfer') delete t.to;
      if (type !== 'debtpay') { delete t.debt; delete t.principal; delete t.interest; }
    } else {
      const id = uid();
      // Trả khoản vay đúng kỳ (gần hoặc sau ngày cắt tiền): dời kỳ tới sang tháng sau và ghi nhận ngày cắt tiền
      let adv = null;
      if (type === 'debtpay') { const d = debtOf(rec.debt); if (d && d.kind === 'loan') { const row = L.loanSchedule(S, d, 1)[0]; if (row && date >= L.addDays(row.cut, -10)) adv = d; } }
      const tx = Object.assign({ id }, rec);
      if (adv) { (adv.adv = adv.adv || []).push({ tx: id, nextDue: adv.nextDue, lastPaid: adv.lastPaid || null }); adv.lastPaid = date; adv.nextDue = L.loanDue(adv, 1); }
      // Trả thẻ (dù một phần) lúc nào trong kỳ, tới 3 ngày sau ngày đến hạn: coi là đã trả kỳ đó, hết nhắc; kỳ sau nhắc lại
      if (type === 'debtpay') {
        const cd = debtOf(rec.debt);
        if (cd && cd.kind === 'card' && cd.dueDay) {
          const k = L.nextMonthly(L.addDays(date, -3), cd.dueDay); // hạn gần nhất tính từ 3 ngày trước ngày trả
          (cd.paidStack = cd.paidStack || []).push({ tx: id, prev: cd.paidDue || null }); cd.paidDue = k;
        }
      }
      // Ghi từ "Sắp đến hạn" cho khoản định kỳ: đánh dấu đã xử lý tới ngày đó
      if (txCtx && txCtx.recur) { const r = S.recurring.find(x => x.id === txCtx.recur); if (r) { tx.rec = r.id; tx.recDate = txCtx.date; tx.recPrev = r.doneUpTo || null; r.doneUpTo = txCtx.date; } }
      S.tx.push(tx);
    }
    txCtx = null;
    save(); closeSheet(); render(); toast('Đã lưu giao dịch');
  };
  A['del-tx'] = el => {
    if (!confirm('Xoá giao dịch này?')) return;
    const t = S.tx.find(x => x.id === el.dataset.id);
    if (t) { // hoàn lại kỳ trả nợ / mốc định kỳ nếu giao dịch này là cái vừa làm các mốc đó dời đi
      if (t.type === 'debtpay') { const cd = debtOf(t.debt); if (cd && cd.paidStack) { const i = cd.paidStack.findIndex(a => a.tx === t.id); if (i >= 0 && i === cd.paidStack.length - 1) { const a = cd.paidStack.pop(); if (a.prev) cd.paidDue = a.prev; else delete cd.paidDue; } } }
      if (t.type === 'debtpay') { const d = debtOf(t.debt); if (d && d.adv) { const i = d.adv.findIndex(a => a.tx === t.id); if (i >= 0 && i === d.adv.length - 1) { const a = d.adv.pop(); d.nextDue = a.nextDue; if (a.lastPaid) d.lastPaid = a.lastPaid; else delete d.lastPaid; } } }
      if (t.rec) { const r = S.recurring.find(x => x.id === t.rec); if (r && r.doneUpTo === t.recDate) r.doneUpTo = t.recPrev || undefined; }
    }
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

  // Vốn ban đầu, kiểm kê
  A['set-capital'] = () => capitalSheet();
  A['save-capital'] = () => {
    const total = getInt('f-cap'), date = val('f-date');
    if (!date) return setErr('Chọn ngày chốt.');
    if (isNaN(total)) return setErr('Nhập tổng vốn ban đầu.');
    S.capital = { date, total, when: val('f-when') === 'start' ? 'start' : 'end' };
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
    const acct = val('f-fpay');
    if (!acct) return setErr('Chọn tài khoản trả tiền xăng.');
    if (acct !== 'none') S.settings.fillAcct = acct;
    const data = {
      acct,
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
  A['reset-split'] = () => {
    const lf = S.fills.filter(f => f.odo > 0 && f.amount > 0).sort((a, b) => b.odo - a.odo)[0];
    if (!lf) return;
    if (!confirm('Đặt lại mốc về lần đổ xăng gần nhất (' + dmOf(lf.date) + ', odo ' + fmtInt(lf.odo) + ')? Số cộng dồn sẽ bắt đầu đếm lại từ đây.')) return;
    S.settings.splitAnchor = { odo: lf.odo, date: lf.date }; save(); render(); toast('Đã đặt lại mốc');
  };
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
    const data = { item: val('f-item') || 'Khác', cost, odo, note: val('f-note'), date: val('f-date') || L.todayKey(), noMoney: $('#f-nomoney').checked };
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
  // Chỉ xoá phần sổ tài chính (tài khoản, giao dịch, nợ, định kỳ, ngày bắt đầu sổ); ca chạy, xăng, bảo dưỡng, vốn Grab giữ nguyên
  A['reset-ledger'] = () => {
    if (!confirm('Làm lại sổ tài chính?\n\nSẽ xoá: ' + S.accounts.length + ' tài khoản, ' + S.tx.length + ' giao dịch, ' + S.debts.length + ' khoản nợ, ' + S.recurring.length + ' khoản định kỳ và ngày bắt đầu sổ.\nGIỮ NGUYÊN: ca chạy, đổ xăng, bảo dưỡng, vốn Grab.\n\nKhông thể hoàn tác (hãy xuất file sao lưu trước).')) return;
    if (!confirm('Chắc chắn xoá sổ tài chính để nhập lại?')) return;
    S.accounts = []; S.tx = []; S.debts = []; S.recurring = [];
    S.fills.forEach(f => { if (f.acct && f.acct !== GRAB) f.acct = 'none'; });
    delete S.settings.fillAcct;
    S.ledger = { start: null, lastAcct: null };
    save(); render(true); toast('Đã xoá sổ tài chính. Hãy thêm tài khoản và đặt ngày bắt đầu sổ.');
  };
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
      if (t.id === 'f-int') updateIntPct();
    }
  });

  // Cài đặt: lưu khi đổi
  document.addEventListener('change', e => {
    const t = e.target;
    // Chọn ngày là hôm nay thì gợi ý "Đầu ngày" (sắp chạy/ghi tiếp trong ngày), ngày khác thì "Cuối ngày"
    if (t.id === 'f-date' && $('#f-debt')) refreshDebtPay(); // trả khoản vay: tính lại lãi theo số ngày tới ngày mới chọn
    if (t.id === 'f-date' && $('#whenseg')) {
      const w = t.value === L.todayKey() ? 'start' : 'end';
      $('#f-when').value = w;
      $('#whenseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.w === w));
    }
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
