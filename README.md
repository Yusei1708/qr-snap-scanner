<div align="center">
  <img src="icons/icon128.png" alt="QR Snap Scanner Logo" width="88" height="88" />
  <h1>QR Snap Scanner</h1>
  <p><strong>Tiện ích mở rộng Chrome (Manifest V3) giúp quét và giải mã mã QR nhanh chóng ngay trên màn hình trình duyệt</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Manifest-V3-2563EB?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3" />
    <img src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript ES2022" />
    <img src="https://img.shields.io/badge/Offline-100%25%20Local-16A34A?style=flat-square" alt="100% Offline" />
    <img src="https://img.shields.io/badge/License-MIT-slate?style=flat-square" alt="MIT License" />
  </p>
</div>

---

## 📖 Giới thiệu

**QR Snap Scanner** là tiện ích mở rộng trên Google Chrome cho phép bạn quét mã QR xuất hiện ở bất kỳ đâu trên trang web (trong ảnh, video, canvas, tài liệu nhúng...) chỉ bằng thao tác **kéo chuột chọn vùng** hoặc **click chuột phải trực tiếp vào hình ảnh**.

Toàn bộ quá trình xử lý hình ảnh và giải mã diễn ra **100% cục bộ (offline)** ngay trên trình duyệt, không gửi dữ liệu ra máy chủ bên ngoài, đảm bảo tốc độ tức thì và quyền riêng tư tuyệt đối.

---

## ✨ Tính năng nổi bật

- 🎯 **Kéo chọn vùng màn hình trực quan (`📷 Quét mã QR`)**:
  - Kích hoạt nhanh từ menu chuột phải hoặc phím tắt `Alt + Shift + Q`.
  - Lớp phủ (overlay) làm mờ trang web, hiển thị khung chọn sắc nét kèm kích thước thực `W × H` theo thời gian thực.
  - Tự động nhân hệ số `window.devicePixelRatio`, cắt ảnh chính xác tuyệt đối trên màn hình **Retina / HiDPI** và mọi mức **Zoom (125%, 150%...)**.
- 🖼️ **Quét trực tiếp từ hình ảnh (`Quét mã QR trong ảnh này`)**:
  - Click chuột phải vào bất kỳ thẻ `<img>` nào trên trang để giải mã tức thì mà không cần kéo chọn.
  - Tích hợp cơ chế proxy qua Service Worker giúp vượt rào cản CORS khi quét ảnh từ tên miền khác.
- 🧠 **Giải mã QR đa tầng (Multi-Pass Decoding Engine)**:
  - **Tầng 1**: Ưu tiên sử dụng API phần cứng gốc `BarcodeDetector` của trình duyệt.
  - **Tầng 2**: Tự động chuyển đổi dự phòng sang thư viện `jsQR` đóng gói sẵn cục bộ.
  - **Tầng 3 (Tự động phục hồi QR mờ/nhỏ)**: Nếu lần đầu chưa đọc được, hệ thống tự động phóng đại `2x`, bổ sung viền trắng (*quiet zone*), chuyển sang ảnh xám (*grayscale*) và tăng cường độ tương phản để giải mã lại.
- 🛡️ **Cô lập giao diện bằng Shadow DOM**:
  - Toàn bộ lớp phủ chọn vùng và hộp kết quả được đóng gói trong `ShadowRoot` (`z-index: 2147483647`), giữ giao diện luôn đồng nhất, không bị phá vỡ bởi CSS của trang web đích.
- 🕘 **Quản lý lịch sử quét thông minh**:
  - Lưu trữ tối đa **20 lần quét gần nhất** trong `chrome.storage.local` (tự động khử trùng lặp).
  - Cho phép sao chép nhanh, mở liên kết trực tiếp, xóa từng mục hoặc xóa toàn bộ lịch sử ngay trong Popup.
- 🌗 **Giao diện Sáng / Tối tự động**:
  - Tự động đồng bộ bảng màu theo thiết lập hệ điều hành (`prefers-color-scheme: light / dark`).

---

## 🖥️ Cách sử dụng

### Cách 1: Kéo chọn vùng chứa mã QR
1. Nhấn **chuột phải** ở bất kỳ đâu trên trang web và chọn **"📷 Quét mã QR"** (hoặc nhấn tổ hợp phím `Alt + Shift + Q`).
2. Nhấn giữ chuột trái và kéo khung hình chữ nhật bao quanh mã QR rồi thả chuột.
   *(Nhấn phím `Esc` hoặc click chuột phải nếu muốn hủy chọn).*
3. Hộp kết quả sẽ xuất hiện ở giữa màn hình:
   - Nhấn **📋 Copy** để sao chép nội dung vào clipboard.
   - Nhấn **🔗 Mở link** (nếu nội dung là URL `http/https` hợp lệ) để mở trong tab mới.
   - Nhấn **🔄 Quét lại** để chọn vùng khác hoặc **✖ Đóng** để thoát.

### Cách 2: Quét nhanh từ hình ảnh
1. Nhấn **chuột phải trực tiếp vào hình ảnh** chứa mã QR trên trang web.
2. Chọn **"Quét mã QR trong ảnh này"** để nhận kết quả ngay lập tức.

### Cách 3: Xem lại lịch sử & Quét từ thanh công cụ
- Nhấn vào biểu tượng **QR Snap Scanner** trên thanh công cụ Chrome (hoặc `Ctrl + Shift + Y`) để mở **Popup**:
  - Bấm nút **Quét ngay** để kích hoạt chế độ chọn vùng trên tab hiện tại.
  - Xem danh sách 20 lần quét gần nhất, sao chép lại hoặc xóa lịch sử.

---

## 🚀 Hướng dẫn cài đặt (Load Unpacked)

1. Tải xuống hoặc clone kho lưu trữ này về máy tính:
   ```bash
   git clone https://github.com/Yusei1708/qr-snap-scanner.git
   ```
2. Mở trình duyệt **Google Chrome** và truy cập địa chỉ:
   ```text
   chrome://extensions/
   ```
3. Bật công tắc **Developer mode** (*Chế độ dành cho nhà phát triển*) ở góc trên bên phải.
4. Nhấn nút **Load unpacked** (*Tải tiện ích đã giải nén*) ở góc trên bên trái.
5. Chọn thư mục **`qr-snap-scanner`** (thư mục chứa file `manifest.json`).

---

## 📁 Cấu trúc dự án

```text
qr-snap-scanner/
├── manifest.json          # Cấu hình Chrome Extension Manifest V3
├── background.js          # Service Worker: Context Menus, chụp màn hình, CORS proxy & lưu lịch sử
├── content/
│   ├── selector.js        # Giao diện kéo chọn vùng (Shadow DOM), cắt ảnh chuẩn DPI & bộ giải mã QR
│   ├── result-ui.js       # Hộp thoại hiển thị kết quả (Shadow DOM), Copy clipboard & mở URL
│   └── styles.css         # CSS cô lập cho phần tử host trên trang
├── lib/
│   └── jsQR.js            # Thư viện giải mã mã QR hoạt động hoàn toàn offline (v1.4.0)
├── popup/
│   ├── popup.html         # Giao diện Popup quản lý lịch sử 20 lần quét gần nhất
│   ├── popup.js           # Xử lý dữ liệu lịch sử & kích hoạt quét nhanh từ thanh công cụ
│   └── popup.css          # Thiết kế giao diện Popup hỗ trợ Light/Dark mode
├── icons/
│   ├── icon16.png         # Biểu tượng 16×16 px
│   ├── icon32.png         # Biểu tượng 32×32 px
│   ├── icon48.png         # Biểu tượng 48×48 px
│   └── icon128.png        # Biểu tượng 128×128 px
└── README.md              # Tài liệu hướng dẫn sử dụng & cài đặt
```

---

## 🔒 Quyền hạn sử dụng (Permissions)

Tiện ích tuân thủ nguyên tắc **quyền tối thiểu (Least Privilege)** của Manifest V3 và chỉ kích hoạt khi có thao tác của người dùng:

| Quyền (`permission`) | Mục đích sử dụng |
| :--- | :--- |
| `contextMenus` | Tạo mục *"📷 Quét mã QR"* và *"Quét mã QR trong ảnh này"* trong menu chuột phải. |
| `activeTab` | Chụp ảnh vùng hiển thị của tab hiện tại và chèn giao diện chọn vùng khi người dùng yêu cầu. |
| `scripting` | Nạp động script chọn vùng và hộp kết quả vào tab đang mở (không chạy ngầm trên mọi trang). |
| `storage` | Lưu trữ cục bộ tối đa 20 mục lịch sử quét gần nhất trong `chrome.storage.local`. |

> **Lưu ý về giới hạn của trình duyệt:** Theo chính sách bảo mật của Google Chrome, mọi tiện ích mở rộng đều không được phép chạy script trên các trang nội bộ hệ thống như `chrome://`, `chrome-extension://`, `Chrome Web Store` hoặc trình xem PDF mặc định. Khi kích hoạt trên các trang này, tiện ích sẽ hiển thị biểu tượng cảnh báo `!` trên thanh công cụ.

---

## 📄 Giấy phép (License)

Dự án được phân phối dưới giấy phép **MIT License**.
