/**
 * QR Snap Scanner — Logic Popup (Quản lý lịch sử 20 lần quét gần nhất & Kích hoạt quét nhanh)
 *
 * Tính năng:
 * 1. Đọc danh sách lịch sử từ chrome.storage.local (key: 'qr_history', tối đa 20 mục).
 * 2. Hiển thị nội dung QR, thời gian quét, nút Copy (kèm phản hồi "✅ Đã copy!") và nút Xóa từng mục.
 * 3. Nút "Xóa tất cả" để dọn sạch lịch sử.
 * 4. Nút "Quét ngay" để kích hoạt chế độ kéo chọn vùng QR ngay trên tab hiện tại.
 */

'use strict';

const STORAGE_HISTORY_KEY = 'qr_history';
const MAX_HISTORY_ITEMS = 20;

const historyListEl = document.getElementById('historyList');
const emptyStateEl = document.getElementById('emptyState');
const historyCountEl = document.getElementById('historyCount');
const clearAllBtn = document.getElementById('clearAllBtn');
const scanNowBtn = document.getElementById('scanNowBtn');
const statusBannerEl = document.getElementById('statusBanner');

/**
 * Kiểm tra trang có bị Chrome chặn inject script hay không.
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();

  const restrictedSchemes = [
    'chrome://',
    'chrome-extension://',
    'chrome-search://',
    'chrome-untrusted://',
    'devtools://',
    'edge://',
    'about:',
    'view-source:',
    'data:',
    'javascript:'
  ];
  if (restrictedSchemes.some((scheme) => lower.startsWith(scheme))) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'chromewebstore.google.com' ||
      (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
    ) {
      return true;
    }
    if (parsed.pathname.toLowerCase().endsWith('.pdf')) {
      return true;
    }
  } catch (_) {
    return true;
  }

  return false;
}

/**
 * Kiểm tra chuỗi có phải là URL HTTP/HTTPS hợp lệ hay không.
 * @param {string} text
 * @returns {boolean}
 */
function isValidHttpUrl(text) {
  if (!text || typeof text !== 'string') return false;
  try {
    const parsed = new URL(text.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Định dạng mốc thời gian sang chuỗi tương đối tiếng Việt ngắn gọn.
 * @param {number} timestamp
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
function formatTimestamp(timestamp, now = Date.now()) {
  if (!timestamp || typeof timestamp !== 'number') return 'vừa xong';
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ngày trước`;
}

/**
 * Sao chép văn bản vào clipboard (ưu tiên navigator.clipboard.writeText, dự phòng execCommand('copy')).
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Chuyển sang fallback bên dưới
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}

/**
 * Hiển thị thông báo trên thanh trạng thái của popup.
 * @param {string} msg
 * @param {{ isSuccess?: boolean, actionLabel?: string, onAction?: () => void }} [options]
 */
function showStatusBanner(msg, options = {}) {
  if (!statusBannerEl) return;
  statusBannerEl.textContent = '';
  statusBannerEl.classList.toggle('is-success', Boolean(options.isSuccess));

  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  statusBannerEl.appendChild(textSpan);

  if (options.actionLabel && typeof options.onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn status-banner-btn';
    btn.textContent = options.actionLabel;
    btn.addEventListener('click', options.onAction);
    statusBannerEl.appendChild(btn);
  }

  statusBannerEl.hidden = false;
}

/**
 * Tạo bản sao Canvas có thêm viền trắng (quiet zone) xung quanh ảnh gốc.
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number} [quietZone=20]
 * @returns {HTMLCanvasElement}
 */
function createQuietZoneCanvas(sourceCanvas, quietZone = 20) {
  const targetWidth = sourceCanvas.width + quietZone * 2;
  const targetHeight = sourceCanvas.height + quietZone * 2;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(sourceCanvas, quietZone, quietZone);
  return canvas;
}

/**
 * Tạo bản sao Canvas được co giãn về kích thước mục tiêu kèm viền trắng (quiet zone).
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number} targetMaxDim
 * @param {number} [quietZone=16]
 * @returns {HTMLCanvasElement}
 */
function createScaledCanvas(sourceCanvas, targetMaxDim, quietZone = 16) {
  const maxSide = Math.max(sourceCanvas.width, sourceCanvas.height, 1);
  const ratio = targetMaxDim / maxSide;
  const scaledWidth = Math.max(1, Math.round(sourceCanvas.width * ratio));
  const scaledHeight = Math.max(1, Math.round(sourceCanvas.height * ratio));
  const targetWidth = scaledWidth + quietZone * 2;
  const targetHeight = scaledHeight + quietZone * 2;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
    quietZone,
    quietZone,
    scaledWidth,
    scaledHeight
  );
  return canvas;
}

/**
 * Tạo bản sao Canvas được phóng to 2x, thêm viền trắng, chuyển ảnh xám và tăng độ tương phản.
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
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
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
 * Thực hiện phép đóng hình thái học (Morphological Closing) để nối các chấm tròn
 * trong mã QR kiểu Chrome Dino / QR nghệ thuật.
 * @param {HTMLCanvasElement} sourceCanvas
 * @param {number} [radius=2]
 * @param {number} [maxDim=450]
 * @param {{ erodeRadius?: number, invertInput?: boolean }} [options]
 * @returns {HTMLCanvasElement}
 */
function createMorphClosedCanvas(sourceCanvas, radius = 2, maxDim = 450, options = {}) {
  const erodeRadius =
    options && typeof options.erodeRadius === 'number' ? options.erodeRadius : radius;
  const invertInput = Boolean(options && options.invertInput);

  const maxSide = Math.max(sourceCanvas.width, sourceCanvas.height, 1);
  const scale = maxSide > maxDim ? maxDim / maxSide : 1;
  const scaledW = Math.max(1, Math.round(sourceCanvas.width * scale));
  const scaledH = Math.max(1, Math.round(sourceCanvas.height * scale));
  const quietZone = 20;
  const w = scaledW + quietZone * 2;
  const h = scaledH + quietZone * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = invertInput ? '#000000' : '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, quietZone, quietZone, scaledW, scaledH);

  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;
  const totalPixels = w * h;

  const gray = new Uint8Array(totalPixels);
  let minLum = 255;
  let maxLum = 0;
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    let lum;
    if (rgba[i + 3] < 128) {
      lum = 255;
    } else {
      lum = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
      if (invertInput) {
        lum = 255 - lum;
      }
    }
    gray[p] = lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  const temp = new Uint8Array(totalPixels);
  const dilated = new Uint8Array(totalPixels);

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      const xStart = Math.max(0, x - radius);
      const xEnd = Math.min(w - 1, x + radius);
      for (let kx = xStart; kx <= xEnd; kx++) {
        if (gray[rowOffset + kx] < minVal) minVal = gray[rowOffset + kx];
      }
      temp[rowOffset + x] = minVal;
    }
  }
  for (let y = 0; y < h; y++) {
    const yStart = Math.max(0, y - radius);
    const yEnd = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      let minVal = 255;
      for (let ky = yStart; ky <= yEnd; ky++) {
        if (temp[ky * w + x] < minVal) minVal = temp[ky * w + x];
      }
      dilated[y * w + x] = minVal;
    }
  }

  const closed = new Uint8Array(totalPixels);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      const xStart = Math.max(0, x - erodeRadius);
      const xEnd = Math.min(w - 1, x + erodeRadius);
      for (let kx = xStart; kx <= xEnd; kx++) {
        if (dilated[rowOffset + kx] > maxVal) maxVal = dilated[rowOffset + kx];
      }
      temp[rowOffset + x] = maxVal;
    }
  }
  for (let y = 0; y < h; y++) {
    const yStart = Math.max(0, y - erodeRadius);
    const yEnd = Math.min(h - 1, y + erodeRadius);
    for (let x = 0; x < w; x++) {
      let maxVal = 0;
      for (let ky = yStart; ky <= yEnd; ky++) {
        if (temp[ky * w + x] > maxVal) maxVal = temp[ky * w + x];
      }
      closed[y * w + x] = maxVal;
    }
  }

  const lumRange = maxLum - minLum;
  const threshold = lumRange > 20 ? Math.round(minLum + lumRange * 0.65) : 165;

  for (let p = 0, i = 0; p < totalPixels; p++, i += 4) {
    const v = closed[p] < threshold ? 0 : 255;
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Giải mã một Canvas trong popup bằng BarcodeDetector hoặc jsQR.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<string|null>}
 */
async function tryDecodeCanvasInPopup(canvas) {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

  if (typeof window.BarcodeDetector === 'function') {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(canvas);
      if (Array.isArray(barcodes) && barcodes.length > 0) {
        const found = barcodes.find((b) => b && typeof b.rawValue === 'string' && b.rawValue.trim() !== '');
        if (found) return found.rawValue;
      }
    } catch (_) {}
  }

  const jsQRFunc = window.jsQR || (typeof jsQR === 'function' ? jsQR : null);
  if (typeof jsQRFunc === 'function') {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRFunc(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (code && typeof code.data === 'string' && code.data.trim() !== '') {
        return code.data;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Giải mã đa tầng cho một Canvas trong Popup (đồng bộ với decodeCanvasWithRetry của selector.js).
 * @param {HTMLCanvasElement} baseCanvas
 * @returns {Promise<string|null>}
 */
async function decodeCanvasInPopupWithRetry(baseCanvas) {
  const firstPass = await tryDecodeCanvasInPopup(baseCanvas);
  if (firstPass) return firstPass;

  const paddedPass = await tryDecodeCanvasInPopup(createQuietZoneCanvas(baseCanvas, 20));
  if (paddedPass) return paddedPass;

  for (const radius of [2, 1, 3, 4]) {
    const morphPass = await tryDecodeCanvasInPopup(createMorphClosedCanvas(baseCanvas, radius, 450));
    if (morphPass) return morphPass;
  }

  const tinyDotPass = await tryDecodeCanvasInPopup(
    createMorphClosedCanvas(baseCanvas, 4, 450, { erodeRadius: 3 })
  );
  if (tinyDotPass) return tinyDotPass;

  for (const radius of [2, 3]) {
    const invMorphPass = await tryDecodeCanvasInPopup(
      createMorphClosedCanvas(baseCanvas, radius, 450, { invertInput: true })
    );
    if (invMorphPass) return invMorphPass;
  }

  if (Math.max(baseCanvas.width, baseCanvas.height) > 700) {
    for (const radius of [2, 1, 3]) {
      const hiResPass = await tryDecodeCanvasInPopup(createMorphClosedCanvas(baseCanvas, radius, 900));
      if (hiResPass) return hiResPass;
    }
  }

  for (const targetDim of [240, 300]) {
    const scaledPass = await tryDecodeCanvasInPopup(createScaledCanvas(baseCanvas, targetDim, 16));
    if (scaledPass) return scaledPass;
  }

  const enhancedPass = await tryDecodeCanvasInPopup(createEnhancedCanvas(baseCanvas, 2, 1.65));
  if (enhancedPass) return enhancedPass;

  return tryDecodeCanvasInPopup(createEnhancedCanvas(baseCanvas, 2, 2.5));
}

/**
 * Giải mã file ảnh QR được chọn hoặc kéo thả vào popup.
 * @param {File|Blob} file
 */
async function handleLocalQrFile(file) {
  if (!file) return;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Định dạng ảnh không hợp lệ'));
      image.src = dataUrl;
    });

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = img.naturalWidth || img.width;
    baseCanvas.height = img.naturalHeight || img.height;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    baseCtx.drawImage(img, 0, 0);

    const decoded = await decodeCanvasInPopupWithRetry(baseCanvas);

    if (decoded) {
      const trimmed = decoded.trim();
      await copyText(trimmed);
      chrome.runtime.sendMessage({ action: 'SAVE_HISTORY', text: trimmed, source: 'image' }, () => {
        loadAndRenderHistory();
      });
      showStatusBanner(`✅ Đã quét & copy: ${trimmed}`, { isSuccess: true });
    } else {
      showStatusBanner('Không tìm thấy mã QR trong file ảnh đã chọn.');
    }
  } catch (err) {
    showStatusBanner('Không thể giải mã file ảnh này.');
  }
}

/**
 * Tải danh sách lịch sử từ chrome.storage.local và cập nhật giao diện.
 */
function loadAndRenderHistory() {
  chrome.storage.local.get(STORAGE_HISTORY_KEY, (result) => {
    const rawList = Array.isArray(result && result[STORAGE_HISTORY_KEY])
      ? result[STORAGE_HISTORY_KEY]
      : [];
    const items = rawList.slice(0, MAX_HISTORY_ITEMS);
    renderHistoryList(items);
  });
}

/**
 * Vẽ danh sách lịch sử quét ra DOM.
 * @param {Array<{id: string, text: string, timestamp: number, isUrl?: boolean, source?: string}>} items
 */
function renderHistoryList(items) {
  historyListEl.textContent = '';
  const count = items.length;
  historyCountEl.textContent = `Lịch sử quét gần đây (${count}/${MAX_HISTORY_ITEMS})`;

  if (count === 0) {
    emptyStateEl.hidden = false;
    clearAllBtn.hidden = true;
    return;
  }

  emptyStateEl.hidden = true;
  clearAllBtn.hidden = false;

  items.forEach((item) => {
    if (!item || typeof item.text !== 'string') return;

    const li = document.createElement('li');
    li.className = 'history-item';

    // Phần nội dung
    const contentDiv = document.createElement('div');
    contentDiv.className = 'history-content';

    const urlValid = item.isUrl !== undefined ? item.isUrl : isValidHttpUrl(item.text);
    if (urlValid && isValidHttpUrl(item.text)) {
      const link = document.createElement('a');
      link.href = item.text.trim();
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.text;
      link.title = 'Mở liên kết trong tab mới';
      contentDiv.appendChild(link);
    } else {
      contentDiv.textContent = item.text;
    }

    // Phần chân mỗi dòng: thời gian + các nút thao tác
    const footerDiv = document.createElement('div');
    footerDiv.className = 'history-footer';

    const metaSpan = document.createElement('span');
    metaSpan.className = 'history-meta';
    const sourceLabel = item.source === 'image' ? '🖼️ Ảnh' : '📐 Vùng chọn';
    const timeLabel = formatTimestamp(item.timestamp);
    metaSpan.textContent = timeLabel ? `${sourceLabel} • ${timeLabel}` : sourceLabel;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'history-actions';

    // Nút Copy
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-sm';
    copyBtn.textContent = '📋 Copy';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(item.text);
      if (!ok) return;
      copyBtn.textContent = '✅ Đã copy!';
      copyBtn.classList.add('is-copied');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
        copyBtn.classList.remove('is-copied');
      }, 2000);
    });

    // Nút Xóa 1 mục
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-sm btn-sm-danger';
    deleteBtn.textContent = '🗑 Xóa';
    deleteBtn.title = 'Xóa mục này khỏi lịch sử';
    deleteBtn.addEventListener('click', () => {
      deleteHistoryItem(item.id, item.text);
    });

    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(deleteBtn);

    footerDiv.appendChild(metaSpan);
    footerDiv.appendChild(actionsDiv);

    li.appendChild(contentDiv);
    li.appendChild(footerDiv);
    historyListEl.appendChild(li);
  });
}

/**
 * Xóa một mục cụ thể khỏi lịch sử trong chrome.storage.local.
 * @param {string} id
 * @param {string} fallbackText
 */
function deleteHistoryItem(id, fallbackText) {
  chrome.storage.local.get(STORAGE_HISTORY_KEY, (result) => {
    const list = Array.isArray(result && result[STORAGE_HISTORY_KEY])
      ? result[STORAGE_HISTORY_KEY]
      : [];

    const filtered = list.filter((entry) => {
      if (!entry) return false;
      if (id && entry.id) {
        return entry.id !== id;
      }
      return entry.text !== fallbackText;
    });

    chrome.storage.local.set({ [STORAGE_HISTORY_KEY]: filtered }, () => {
      renderHistoryList(filtered);
    });
  });
}

/**
 * Xóa toàn bộ lịch sử quét.
 */
function clearAllHistory() {
  chrome.storage.local.set({ [STORAGE_HISTORY_KEY]: [] }, () => {
    renderHistoryList([]);
  });
}

/**
 * Mở trang cài đặt chi tiết của tiện ích để người dùng bật "Allow access to file URLs".
 */
function openExtensionSettings() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime && chrome.runtime.id) {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  }
}

/**
 * Kích hoạt chế độ kéo chọn vùng QR trên tab đang mở khi bấm nút "Quét ngay".
 */
async function triggerScanOnActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      showStatusBanner('Không tìm thấy tab đang hoạt động.');
      return;
    }

    const tabUrl = String(tab.url || '').trim();
    if (tabUrl && isRestrictedUrl(tabUrl)) {
      chrome.runtime.sendMessage({ action: 'SHOW_RESTRICTED_BADGE', tabId: tab.id });
      showStatusBanner(
        'Không thể quét trên trang hệ thống (chrome://), Chrome Web Store hoặc trình xem PDF.'
      );
      return;
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content/styles.css']
      });
    } catch (_) {
      // Bỏ qua nếu CSS đã được chèn
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['lib/jsQR.js', 'content/result-ui.js', 'content/selector.js']
      });

      chrome.tabs.sendMessage(tab.id, { action: 'START_SELECTION' }, () => {
        window.close();
      });
    } catch (err) {
      chrome.runtime.sendMessage({ action: 'SHOW_RESTRICTED_BADGE', tabId: tab.id });
      const errMsg = String((err && err.message) || '');
      const isFileTab =
        tabUrl.toLowerCase().startsWith('file://') || errMsg.toLowerCase().includes('file://');

      if (isFileTab) {
        showStatusBanner(
          'Để quét trực tiếp trên tab file://, hãy bật "Cho phép truy cập vào các URL của tệp" (Allow access to file URLs) trong cài đặt tiện ích — hoặc bấm nút "📁 Chọn ảnh" ở trên để quét ngay file ảnh.',
          {
            actionLabel: '⚙️ Bật quyền truy cập file://',
            onAction: openExtensionSettings
          }
        );
      } else {
        showStatusBanner('Trang web này không cho phép tiện ích chạy chế độ quét màn hình.');
      }
    }
  });
}

// Gắn sự kiện khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
  loadAndRenderHistory();

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', clearAllHistory);
  }

  if (scanNowBtn) {
    scanNowBtn.addEventListener('click', triggerScanOnActiveTab);
  }

  const scanFileBtn = document.getElementById('scanFileBtn');
  const qrFileInput = document.getElementById('qrFileInput');

  if (scanFileBtn && qrFileInput) {
    scanFileBtn.addEventListener('click', () => {
      qrFileInput.value = '';
      qrFileInput.click();
    });

    qrFileInput.addEventListener('change', (e) => {
      const file = e.target && e.target.files && e.target.files[0];
      if (file) {
        handleLocalQrFile(file);
      }
    });
  }

  // Hỗ trợ kéo thả (drag & drop) hoặc dán (Ctrl+V) ảnh trực tiếp vào popup
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleLocalQrFile(file);
    }
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          handleLocalQrFile(blob);
          break;
        }
      }
    }
  });
});

// Tự động cập nhật danh sách nếu storage thay đổi khi popup đang mở
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_HISTORY_KEY]) {
      const updated = Array.isArray(changes[STORAGE_HISTORY_KEY].newValue)
        ? changes[STORAGE_HISTORY_KEY].newValue
        : [];
      renderHistoryList(updated.slice(0, MAX_HISTORY_ITEMS));
    }
  });
}
