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
 * Hiển thị thông báo lỗi trên thanh trạng thái của popup.
 * @param {string} msg
 */
function showStatusBanner(msg) {
  if (!statusBannerEl) return;
  statusBannerEl.textContent = msg;
  statusBannerEl.hidden = false;
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
 * Kích hoạt chế độ kéo chọn vùng QR trên tab đang mở khi bấm nút "Quét ngay".
 */
async function triggerScanOnActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      showStatusBanner('Không tìm thấy tab đang hoạt động.');
      return;
    }

    if (isRestrictedUrl(tab.url)) {
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
      showStatusBanner('Trang web này không cho phép tiện ích chạy chế độ quét màn hình.');
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
