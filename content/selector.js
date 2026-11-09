/**
 * QR Snap Scanner — Giao diện kéo chọn vùng & Bộ giải mã QR (Selector & Decoder Engine)
 *
 * Chức năng:
 * 1. Hiển thị lớp phủ (overlay) tối 40% trong Shadow DOM với con trỏ crosshair.
 * 2. Hiển thị thanh hướng dẫn ở trên cùng: "Kéo chuột để chọn vùng chứa mã QR — Nhấn Esc để hủy".
 * 3. Vẽ khung chữ nhật vùng chọn rõ nét (không bị làm mờ) kèm nhãn kích thước W × H.
 * 4. Hủy bỏ sạch sẽ khi nhấn Esc, nhấn chuột phải, hoặc chọn vùng quá nhỏ (< 10px).
 * 5. Ẩn overlay và đợi 2 frame (requestAnimationFrame) trước khi chụp màn hình tab.
 * 6. Cắt ảnh theo tọa độ nhân với window.devicePixelRatio (tương thích màn hình Retina / Zoom).
 * 7. Giải mã QR đa tầng:
 *    - Ưu tiên BarcodeDetector API (nếu trình duyệt hỗ trợ).
 *    - Dự phòng sang thư viện jsQR.
 *    - Nếu lần đầu không đọc được: tự động phóng to 2x, chuyển ảnh xám và tăng tương phản để thử lại.
 * 8. Hỗ trợ quét trực tiếp từ ảnh ("Quét mã QR trong ảnh này") thông qua proxy tránh lỗi CORS.
 */

(() => {
  'use strict';

  // Ngăn đăng ký trùng lặp listener khi chrome.scripting.executeScript chạy nhiều lần
  if (window.__QR_SNAP_SELECTOR_LOADED__) {
    return;
  }
  window.__QR_SNAP_SELECTOR_LOADED__ = true;

  const SELECTOR_HOST_ID = 'qr-snap-selector-host';
  const MIN_SELECTION_SIZE = 10;

  let activeHost = null;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentRect = { left: 0, top: 0, width: 0, height: 0 };

  let keyDownListener = null;
  let mouseMoveListener = null;
  let mouseUpListener = null;

  /**
   * Trả về CSS cô lập trong Shadow DOM cho lớp phủ chọn vùng.
   * @returns {string}
   */
  function getSelectorStyles() {
    return `
      :host {
        all: initial;
      }

      * {
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .qr-overlay {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        cursor: crosshair;
        pointer-events: auto;
        background: rgba(0, 0, 0, 0.42);
      }

      /* Khi bắt đầu kéo, nền chung chuyển sang trong suốt vì bóng mờ 4 phía của .qr-selection-box sẽ đảm nhận làm tối phần ngoài vùng chọn */
      .qr-overlay.is-selecting {
        background: transparent;
      }

      .qr-banner {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        color: #F8FAFC;
        padding: 10px 18px;
        border-radius: 9999px;
        font-size: 13.5px;
        font-weight: 500;
        letter-spacing: 0.1px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.12);
        pointer-events: none;
        white-space: nowrap;
        z-index: 2;
        backdrop-filter: blur(4px);
      }

      .qr-selection-box {
        display: none;
        position: fixed;
        border: 2px solid #2563EB;
        border-radius: 4px;
        background: transparent;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.65) inset;
        pointer-events: none;
        z-index: 1;
      }

      .qr-size-badge {
        position: absolute;
        left: -2px;
        bottom: -28px;
        background: #2563EB;
        color: #FFFFFF;
        font-size: 11.5px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
        pointer-events: none;
      }

      .qr-size-badge.is-inside {
        bottom: 6px;
        left: 6px;
      }
    `;
  }

  /**
   * Dọn dẹp hoàn toàn lớp phủ chọn vùng và các sự kiện bàn phím, chuột.
   */
  function cleanupSelection() {
    isDragging = false;
    window.__qrSnapActive = false;

    if (keyDownListener) {
      window.removeEventListener('keydown', keyDownListener, true);
      keyDownListener = null;
    }

    if (mouseMoveListener) {
      window.removeEventListener('mousemove', mouseMoveListener, true);
      mouseMoveListener = null;
    }

    if (mouseUpListener) {
      window.removeEventListener('mouseup', mouseUpListener, true);
      mouseUpListener = null;
    }

    if (activeHost && activeHost.parentNode) {
      activeHost.parentNode.removeChild(activeHost);
    }
    activeHost = null;

    const existing = document.getElementById(SELECTOR_HOST_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  /**
   * Đợi một số frame hiển thị (requestAnimationFrame) để đảm bảo trình duyệt đã vẽ xong việc ẩn overlay.
   * @param {number} [frames=2]
   * @returns {Promise<void>}
   */
  function waitAnimationFrames(frames = 2) {
    return new Promise((resolve) => {
      const step = (remaining) => {
        if (remaining <= 0) {
          resolve();
        } else {
          requestAnimationFrame(() => step(remaining - 1));
        }
      };
      step(frames);
    });
  }

  /**
   * Tải một chuỗi Data URL hoặc URL thành đối tượng HTMLImageElement.
   * @param {string} src
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không thể tải dữ liệu hình ảnh'));
      img.src = src;
    });
  }

  /**
   * Cắt vùng đã chọn từ ảnh chụp toàn màn hình, nhân tọa độ với window.devicePixelRatio.
   * @param {string} dataUrl - Ảnh chụp màn hình dạng PNG Data URL
   * @param {{ left: number, top: number, width: number, height: number }} rect - Tọa độ CSS
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function cropCapturedScreenshot(dataUrl, rect) {
    const img = await loadImage(dataUrl);
    const dpr = window.devicePixelRatio || 1;

    const sx = Math.max(0, Math.round(rect.left * dpr));
    const sy = Math.max(0, Math.round(rect.top * dpr));
    const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(rect.width * dpr)));
    const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(rect.height * dpr)));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas;
  }

  /**
   * Tạo bản sao Canvas được phóng to 2x, thêm viền trắng (quiet zone),
   * chuyển sang ảnh xám (grayscale) và tăng độ tương phản để cứu các mã QR nhỏ hoặc mờ.
   *
   * @param {HTMLCanvasElement} sourceCanvas
   * @param {number} [scale=2]
   * @param {number} [contrast=1.6]
   * @returns {HTMLCanvasElement}
   */
  function createEnhancedCanvas(sourceCanvas, scale = 2, contrast = 1.6) {
    const quietZone = 16 * scale;
    const targetWidth = Math.round(sourceCanvas.width * scale) + quietZone * 2;
    const targetHeight = Math.round(sourceCanvas.height * scale) + quietZone * 2;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Đổ nền trắng tạo khoảng lặng (quiet zone) giúp bộ giải mã dễ nhận diện góc QR
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      quietZone,
      quietZone,
      Math.round(sourceCanvas.width * scale),
      Math.round(sourceCanvas.height * scale)
    );

    const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imageData.data;
    const intercept = 128 * (1 - contrast);

    for (let i = 0; i < data.length; i += 4) {
      // Công thức độ chói chuẩn (Luminance)
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Tăng độ tương phản
      const enhanced = Math.min(255, Math.max(0, gray * contrast + intercept));
      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Thử giải mã một Canvas duy nhất bằng BarcodeDetector trước, sau đó fallback sang jsQR.
   * @param {HTMLCanvasElement} canvas
   * @returns {Promise<string|null>}
   */
  async function tryDecodeSingleCanvas(canvas) {
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      return null;
    }

    // 1. Ưu tiên dùng API có sẵn BarcodeDetector nếu trình duyệt hỗ trợ
    if (typeof window.BarcodeDetector === 'function') {
      try {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(canvas);
        if (Array.isArray(barcodes) && barcodes.length > 0) {
          const found = barcodes.find((b) => b && typeof b.rawValue === 'string' && b.rawValue.trim() !== '');
          if (found) {
            return found.rawValue;
          }
        }
      } catch (_) {
        // Bỏ qua lỗi và chuyển sang jsQR
      }
    }

    // 2. Fallback sang thư viện jsQR local
    const jsQRFunc = window.jsQR || (typeof jsQR === 'function' ? jsQR : null);
    if (typeof jsQRFunc === 'function') {
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQRFunc(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && typeof code.data === 'string' && code.data.trim() !== '') {
          return code.data;
        }
      } catch (err) {
        console.warn('[QR Snap] Lỗi khi giải mã với jsQR:', err);
      }
    }

    return null;
  }

  /**
   * Giải mã QR từ một Canvas với cơ chế thử lại:
   * - Lần 1: Ảnh gốc đã cắt.
   * - Lần 2: Ảnh phóng to 2x + chuyển sang ảnh xám + tăng tương phản (1.6x).
   * - Lần 3: Ảnh phóng to 2x + ngưỡng nhị phân tương phản cao (2.4x) cho mã QR mờ.
   *
   * @param {HTMLCanvasElement} baseCanvas
   * @returns {Promise<string|null>}
   */
  async function decodeCanvasWithRetry(baseCanvas) {
    // Lần 1: Thử trực tiếp trên ảnh gốc
    const firstPass = await tryDecodeSingleCanvas(baseCanvas);
    if (firstPass) {
      return firstPass;
    }

    // Lần 2: Phóng to 2x + ảnh xám + tăng tương phản vừa phải
    const enhancedCanvas = createEnhancedCanvas(baseCanvas, 2, 1.65);
    const secondPass = await tryDecodeSingleCanvas(enhancedCanvas);
    if (secondPass) {
      return secondPass;
    }

    // Lần 3: Phóng to 2x + tăng tương phản mạnh kèm viền trắng cho các mã QR rất nhỏ hoặc thiếu viền
    const highContrastCanvas = createEnhancedCanvas(baseCanvas, 2, 2.5);
    return tryDecodeSingleCanvas(highContrastCanvas);
  }

  /**
   * Lưu kết quả quét thành công vào lịch sử thông qua service worker.
   * @param {string} text
   * @param {'selection'|'image'} source
   */
  function saveToHistory(text, source) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'SAVE_HISTORY', text, source }, () => {
        if (chrome.runtime.lastError) {
          // Không làm gián đoạn giao diện nếu lưu lịch sử thất bại
        }
      });
    }
  }

  /**
   * Yêu cầu background service worker chụp màn hình tab hiện tại.
   * @returns {Promise<string>} PNG Data URL
   */
  function requestScreenCapture() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || response.error || !response.dataUrl) {
          reject(new Error((response && response.error) || 'Không thể chụp màn hình tab hiện tại'));
          return;
        }
        resolve(response.dataUrl);
      });
    });
  }

  /**
   * Xử lý sau khi người dùng thả chuột kết thúc chọn vùng.
   * @param {{ left: number, top: number, width: number, height: number }} rect
   */
  async function handleRegionSelected(rect) {
    // 1. Ẩn và gỡ bỏ hoàn toàn overlay trước khi chụp
    cleanupSelection();

    // 2. Đợi 2 frame bằng requestAnimationFrame để đảm bảo overlay không bị dính vào ảnh chụp
    await waitAnimationFrames(2);

    try {
      const screenshotDataUrl = await requestScreenCapture();
      const croppedCanvas = await cropCapturedScreenshot(screenshotDataUrl, rect);
      const decodedText = await decodeCanvasWithRetry(croppedCanvas);

      if (decodedText) {
        saveToHistory(decodedText, 'selection');
        if (window.QRSnapResultUI) {
          window.QRSnapResultUI.showSuccess(decodedText, {
            onRescan: () => startSelectionMode()
          });
        }
      } else if (window.QRSnapResultUI) {
        window.QRSnapResultUI.showError('Không tìm thấy mã QR trong vùng đã chọn', {
          onRetry: () => startSelectionMode()
        });
      }
    } catch (err) {
      console.warn('[QR Snap] Lỗi khi chụp và giải mã vùng chọn:', err);
      if (window.QRSnapResultUI) {
        window.QRSnapResultUI.showError('Không tìm thấy mã QR trong vùng đã chọn', {
          onRetry: () => startSelectionMode()
        });
      }
    }
  }

  /**
   * Khởi chạy chế độ phủ màn hình và kéo chọn vùng chứa mã QR.
   * Đảm bảo nếu bấm menu nhiều lần cũng không tạo nhiều overlay chồng lên nhau.
   */
  function startSelectionMode() {
    // Đóng hộp kết quả cũ (nếu đang mở) và dọn sạch overlay cũ
    if (window.QRSnapResultUI && typeof window.QRSnapResultUI.closeModal === 'function') {
      window.QRSnapResultUI.closeModal();
    }
    cleanupSelection();

    const host = document.createElement('div');
    host.id = SELECTOR_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getSelectorStyles();

    const overlay = document.createElement('div');
    overlay.className = 'qr-overlay';

    const banner = document.createElement('div');
    banner.className = 'qr-banner';
    banner.textContent = 'Kéo chuột để chọn vùng chứa mã QR — Nhấn Esc để hủy';

    const selectionBox = document.createElement('div');
    selectionBox.className = 'qr-selection-box';

    const sizeBadge = document.createElement('div');
    sizeBadge.className = 'qr-size-badge';
    selectionBox.appendChild(sizeBadge);

    overlay.appendChild(banner);
    overlay.appendChild(selectionBox);
    shadow.appendChild(styleEl);
    shadow.appendChild(overlay);

    (document.documentElement || document.body).appendChild(host);
    activeHost = host;
    window.__qrSnapActive = true;

    // Cập nhật vị trí và kích thước W×H của khung chọn
    const updateSelectionUI = (x1, y1, x2, y2) => {
      const left = Math.max(0, Math.min(x1, x2));
      const top = Math.max(0, Math.min(y1, y2));
      const right = Math.min(window.innerWidth, Math.max(x1, x2));
      const bottom = Math.min(window.innerHeight, Math.max(y1, y2));
      const width = Math.round(right - left);
      const height = Math.round(bottom - top);

      currentRect = { left, top, width, height };

      selectionBox.style.display = 'block';
      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;

      sizeBadge.textContent = `${width} × ${height}`;
      if (bottom + 32 > window.innerHeight) {
        sizeBadge.classList.add('is-inside');
      } else {
        sizeBadge.classList.remove('is-inside');
      }
    };

    overlay.addEventListener('mousedown', (e) => {
      // Nếu nhấn chuột phải (button === 2) -> hủy chế độ chọn ngay lập tức
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        cleanupSelection();
        return;
      }

      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      overlay.classList.add('is-selecting');
      updateSelectionUI(startX, startY, startX, startY);
    });

    mouseMoveListener = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      updateSelectionUI(startX, startY, e.clientX, e.clientY);
    };
    window.addEventListener('mousemove', mouseMoveListener, true);

    mouseUpListener = (e) => {
      if (!isDragging || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = false;
      const finalRect = { ...currentRect };

      // Nếu vùng chọn quá nhỏ (< 10px) -> bỏ qua, đóng overlay và không quét
      if (finalRect.width < MIN_SELECTION_SIZE || finalRect.height < MIN_SELECTION_SIZE) {
        cleanupSelection();
        return;
      }

      handleRegionSelected(finalRect);
    };
    window.addEventListener('mouseup', mouseUpListener, true);

    // Chặn menu chuột phải mặc định khi đang trong chế độ chọn và hủy chọn
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cleanupSelection();
    });

    // Nhấn phím Esc để hủy
    keyDownListener = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanupSelection();
      }
    };
    window.addEventListener('keydown', keyDownListener, true);
  }

  /**
   * Tải ảnh từ URL bất kỳ (dùng proxy ở background nếu bị chặn CORS) và vẽ lên Canvas.
   * @param {string} srcUrl
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function loadImageUrlToCanvas(srcUrl) {
    let img;
    let canvas;

    // Thử tải trực tiếp trước, nếu bị lỗi CORS hoặc tainted canvas thì nhờ background fetch về dạng Data URL
    try {
      img = await loadImage(srcUrl);
      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      // Kiểm tra thử xem canvas có bị tainted bởi CORS không
      ctx.getImageData(0, 0, 1, 1);
      return canvas;
    } catch (_) {
      // Fallback sang FETCH_IMAGE_DATA_URL qua service worker
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_DATA_URL', url: srcUrl }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!res || !res.success || !res.dataUrl) {
            reject(new Error((res && res.error) || 'Không thể tải ảnh từ đường dẫn này'));
            return;
          }
          resolve(res.dataUrl);
        });
      });

      img = await loadImage(dataUrl);
      canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return canvas;
    }
  }

  /**
   * Dự phòng: Tìm thẻ <img> tương ứng trên DOM và chụp màn hình vùng chứa ảnh đó.
   * Hữu ích khi ảnh dùng blob: URL hoặc bị chặn tải lại từ phía máy chủ.
   * @param {string} srcUrl
   * @returns {Promise<HTMLCanvasElement|null>}
   */
  async function fallbackCaptureDomImageToCanvas(srcUrl) {
    try {
      const images = Array.from(document.querySelectorAll('img'));
      const targetImg = images.find(
        (el) => el.currentSrc === srcUrl || el.src === srcUrl || el.getAttribute('src') === srcUrl
      );
      if (!targetImg) return null;

      const rawRect = targetImg.getBoundingClientRect();
      const left = Math.max(0, Math.round(rawRect.left));
      const top = Math.max(0, Math.round(rawRect.top));
      const right = Math.min(window.innerWidth, Math.round(rawRect.right));
      const bottom = Math.min(window.innerHeight, Math.round(rawRect.bottom));
      const width = right - left;
      const height = bottom - top;

      if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
        return null;
      }

      await waitAnimationFrames(2);
      const screenshotDataUrl = await requestScreenCapture();
      return await cropCapturedScreenshot(screenshotDataUrl, { left, top, width, height });
    } catch (_) {
      return null;
    }
  }

  /**
   * Giải mã trực tiếp mã QR từ một hình ảnh khi người dùng chuột phải chọn "Quét mã QR trong ảnh này".
   * @param {string} srcUrl
   */
  async function handleScanImageUrl(srcUrl) {
    cleanupSelection();

    let decodedText = null;

    try {
      const canvas = await loadImageUrlToCanvas(srcUrl);
      decodedText = await decodeCanvasWithRetry(canvas);
    } catch (err) {
      console.warn('[QR Snap] Chuyển sang chụp vùng ảnh DOM do không tải trực tiếp được:', err);
    }

    // Nếu tải ảnh trực tiếp thất bại hoặc chưa giải mã được, thử chụp theo tọa độ thẻ <img> trên màn hình
    if (!decodedText) {
      const domCanvas = await fallbackCaptureDomImageToCanvas(srcUrl);
      if (domCanvas) {
        decodedText = await decodeCanvasWithRetry(domCanvas);
      }
    }

    if (decodedText) {
      saveToHistory(decodedText, 'image');
      if (window.QRSnapResultUI) {
        window.QRSnapResultUI.showSuccess(decodedText, {
          onRescan: () => startSelectionMode()
        });
      }
    } else if (window.QRSnapResultUI) {
      window.QRSnapResultUI.showError('Không tìm thấy mã QR trong vùng đã chọn', {
        onRetry: () => startSelectionMode()
      });
    }
  }

  // Lắng nghe tin nhắn điều khiển từ background.js
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (message.action === 'START_SELECTION') {
        startSelectionMode();
        sendResponse({ ok: true });
        return false;
      }

      if (message.action === 'SCAN_IMAGE_URL' && message.srcUrl) {
        handleScanImageUrl(message.srcUrl);
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  }

  window.QRSnapSelector = {
    start: startSelectionMode,
    cleanup: cleanupSelection,
    startSelectionMode,
    cleanupSelection,
    handleScanImageUrl
  };
})();
