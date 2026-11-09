# Sổ Thu Chi Grab

Web app (PWA) cá nhân để ghi ca chạy Grab, chi phí và tính lãi/km, lãi/giờ. Dữ liệu lưu ngay trên điện thoại (localStorage), không gửi đi đâu.

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

## Sao lưu

Cài đặt → **Xuất file**, lưu vào Files/iCloud. Nên làm mỗi tuần. Đổi điện thoại thì **Nhập file**.

## Cấu trúc

- `logic.js` — toàn bộ phép tính (xăng/km học từ lần đổ xăng, hao mòn, lãi ca, tổng hợp tuần/tháng)
- `app.js`, `styles.css`, `index.html` — giao diện
- `sw.js`, `manifest.webmanifest`, `icons/` — cài lên màn hình chính, chạy offline
