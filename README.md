# Sổ Tài Chính

Web app (PWA) quản lý tài chính cá nhân: tài khoản (ví, ngân hàng), giao dịch thu/chi/chuyển, báo cáo theo tháng và danh mục; kèm mục **Grab** (ca chạy, lãi/km, xe, quỹ bảo trì) tự liên thông vào sổ. Dữ liệu lưu ngay trên điện thoại (localStorage), không gửi đi đâu.

## Chạy thử trên máy tính

```bash
python3 -m http.server 8765
```
Mở http://localhost:8765

## Đưa lên GitHub Pages (để mở trên iPhone)

1. Tạo repo **public** trên GitHub (ví dụ `grab-thuchi`) và đẩy thư mục này lên (không cần thư mục `.claude`).
2. Repo → Settings → Pages → Source: `Deploy from a branch` → branch `main`, thư mục `/ (root)`.
3. Mở link `https://<tên-github>.github.io/grab-thuchi/` bằng **Safari** trên iPhone.
4. Nút Chia sẻ → **Thêm vào Màn hình chính**. Từ đó dùng như một app, chạy được cả khi mất mạng.

Chỉ code nằm công khai; số liệu thu chi của bạn vẫn chỉ ở trên iPhone.

## Mật khẩu (khoá dữ liệu)

Cài đặt → **Bảo mật → Đặt mật khẩu**. Khi bật, dữ liệu trên máy được **mã hoá AES-256-GCM** (khoá sinh từ mật khẩu bằng PBKDF2-SHA256, 600.000 vòng) và phải mở khoá mỗi lần vào app; có tuỳ chọn tự khoá khi rời app. File sao lưu xuất ra cũng được mã hoá. **Quên mật khẩu thì không khôi phục được dữ liệu** (chỉ còn cách xoá và nhập lại từ file sao lưu). Mật khẩu không được lưu ở đâu cả. App không dùng được Face ID.

## Sao lưu

Cài đặt → **Xuất file**, lưu vào Files/iCloud. Nên làm mỗi tuần. Đổi điện thoại thì **Nhập file**.

## Cấu trúc

- `vault.js` — mã hoá/giải mã bằng mật khẩu (WebCrypto)
- `logic.js` — toàn bộ phép tính (sổ tài chính, Grab) (xăng/km học từ lần đổ xăng, hao mòn, lãi ca, tổng hợp tuần/tháng)
- `app.js`, `styles.css`, `index.html` — giao diện
- `sw.js`, `manifest.webmanifest`, `icons/` — cài lên màn hình chính, chạy offline
