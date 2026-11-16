/* Mã hoá dữ liệu bằng mật khẩu (WebCrypto): PBKDF2-SHA256 sinh khoá, AES-256-GCM mã hoá.
   Mật khẩu không bao giờ được lưu; chỉ giữ khoá (không xuất ra được) trong bộ nhớ khi đã mở khoá.
   Chạy được cả trên trình duyệt và Node (để test). */
(function (root) {
  'use strict';
  const subtle = (root.crypto || {}).subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const ITER = 600000; // số vòng PBKDF2 (làm chậm việc dò mật khẩu)

  function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  async function deriveKey(password, salt, iter) {
    const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Mã hoá một chuỗi bằng khoá đã có; mỗi lần dùng IV ngẫu nhiên mới
  async function encryptText(key, text) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
    return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
  }
  async function decryptText(key, rec) {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, key, fromB64(rec.ct));
    return td.decode(pt);
  }

  // Tạo gói mã hoá mới từ mật khẩu (salt mới). Trả về khoá + gói đầy đủ + phần đầu gói (để lần lưu sau dùng lại)
  async function create(password, text) {
    const salt = root.crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt, ITER);
    const header = { v: 2, kdf: 'PBKDF2-SHA256', iter: ITER, salt: toB64(salt) };
    const rec = await encryptText(key, text);
    return { key, header, pkg: Object.assign({}, header, rec) };
  }

  // Mở gói bằng mật khẩu. Sai mật khẩu hoặc dữ liệu hỏng thì ném lỗi (GCM tự kiểm tra)
  async function open(password, pkg) {
    const key = await deriveKey(password, fromB64(pkg.salt), pkg.iter);
    const text = await decryptText(key, pkg);
    return { key, text, header: { v: pkg.v, kdf: pkg.kdf, iter: pkg.iter, salt: pkg.salt } };
  }

  function isPackage(o) { return !!(o && typeof o === 'object' && o.ct && o.iv && o.salt && o.iter); }
  function available() { return !!subtle; }

  const api = { ITER, create, open, encryptText, decryptText, isPackage, available };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Vault = api;
})(typeof window !== 'undefined' ? window : globalThis);
