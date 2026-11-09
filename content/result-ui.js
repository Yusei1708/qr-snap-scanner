/**
 * QR Snap Scanner — Hộp kết quả (Result Modal UI)
 *
 * Hiển thị kết quả giải mã QR hoặc thông báo lỗi bên trong Shadow DOM cô lập.
 * Hỗ trợ:
 * - Chế độ sáng/tối tự động theo prefers-color-scheme
 * - Copy vào clipboard (navigator.clipboard.writeText + fallback execCommand('copy'))
 * - Mở link an toàn nếu nội dung là URL http/https hợp lệ
 * - Nút Quét lại (hoặc Thử lại) và Đóng (hoặc nhấn phím Esc / click nền mờ)
 */

(() => {
  'use strict';

  // Ngăn khởi tạo trùng lặp khi chrome.scripting.executeScript chạy nhiều lần
  if (window.__QR_SNAP_RESULT_UI_LOADED__) {
    return;
  }
  window.__QR_SNAP_RESULT_UI_LOADED__ = true;

  const HOST_ID = 'qr-snap-result-host';

  let currentHost = null;
  let currentKeyDownHandler = null;
  let copyResetTimer = null;

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
   * Sao chép văn bản vào clipboard với cơ chế fallback an toàn.
   * Ưu tiên navigator.clipboard.writeText, dự phòng bằng textarea + execCommand('copy').
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Chuyển sang fallback bên dưới nếu Clipboard API bị chặn
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return Boolean(ok);
    } catch (err) {
      console.warn('[QR Snap] Không thể copy vào clipboard:', err);
      return false;
    }
  }

  /**
   * Đóng và gỡ bỏ hoàn toàn hộp kết quả khỏi DOM, dọn sạch các event listener.
   */
  function closeModal() {
    if (copyResetTimer) {
      clearTimeout(copyResetTimer);
      copyResetTimer = null;
    }

    if (currentKeyDownHandler) {
      window.removeEventListener('keydown', currentKeyDownHandler, true);
      currentKeyDownHandler = null;
    }

    if (currentHost && currentHost.parentNode) {
      currentHost.parentNode.removeChild(currentHost);
    }
    currentHost = null;

    const strayHost = document.getElementById(HOST_ID);
    if (strayHost && strayHost.parentNode) {
      strayHost.parentNode.removeChild(strayHost);
    }
  }

  /**
   * Tạo CSS cô lập bên trong Shadow DOM cho hộp kết quả.
   * @returns {string}
   */
  function getModalStyles() {
    return `
      :host {
        all: initial;
        --qr-primary: #2563EB;
        --qr-primary-hover: #1D4ED8;
        --qr-success: #16A34A;
        --qr-danger: #DC2626;
        --qr-bg: #FFFFFF;
        --qr-surface: #F8FAFC;
        --qr-border: #E2E8F0;
        --qr-text: #0F172A;
        --qr-text-muted: #64748B;
        --qr-backdrop: rgba(15, 23, 42, 0.45);
        --qr-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --qr-bg: #1E293B;
          --qr-surface: #0F172A;
          --qr-border: #334155;
          --qr-text: #F8FAFC;
          --qr-text-muted: #94A3B8;
          --qr-backdrop: rgba(2, 6, 23, 0.65);
          --qr-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
        }
      }

      * {
        box-sizing: border-box;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .qr-backdrop {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: var(--qr-backdrop);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        z-index: 2147483647;
        pointer-events: auto;
        animation: qrFadeIn 160ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      .qr-card {
        width: 100%;
        max-width: 440px;
        background: var(--qr-bg);
        color: var(--qr-text);
        border: 1px solid var(--qr-border);
        border-radius: 12px;
        box-shadow: var(--qr-shadow);
        padding: 20px;
        animation: qrScaleIn 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes qrFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes qrScaleIn {
        from {
          opacity: 0;
          transform: scale(0.95) translateY(6px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .qr-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }

      .qr-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .qr-badge-icon {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        background: rgba(37, 99, 235, 0.12);
        color: var(--qr-primary);
      }

      .qr-badge-icon.is-error {
        background: rgba(220, 38, 38, 0.12);
        color: var(--qr-danger);
      }

      .qr-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.3;
        color: var(--qr-text);
      }

      .qr-close-icon-btn {
        background: transparent;
        border: none;
        color: var(--qr-text-muted);
        cursor: pointer;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        transition: background-color 120ms ease, color 120ms ease;
      }

      .qr-close-icon-btn:hover {
        background: var(--qr-surface);
        color: var(--qr-text);
      }

      .qr-body {
        margin-bottom: 16px;
      }

      .qr-textarea {
        width: 100%;
        min-height: 88px;
        max-height: 200px;
        resize: vertical;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid var(--qr-border);
        background: var(--qr-surface);
        color: var(--qr-text);
        font-size: 14px;
        line-height: 1.5;
        word-break: break-word;
        white-space: pre-wrap;
        outline: none;
      }

      .qr-textarea:focus {
        border-color: var(--qr-primary);
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
      }

      .qr-error-msg {
        margin: 0;
        padding: 14px 12px;
        border-radius: 8px;
        background: var(--qr-surface);
        border: 1px solid var(--qr-border);
        color: var(--qr-text);
        font-size: 14px;
        line-height: 1.5;
      }

      .qr-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }

      .qr-btn {
        appearance: none;
        border: 1px solid var(--qr-border);
        background: var(--qr-surface);
        color: var(--qr-text);
        font-size: 13px;
        font-weight: 500;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background-color 140ms ease, border-color 140ms ease, transform 80ms ease;
        user-select: none;
      }

      .qr-btn:hover {
        border-color: var(--qr-text-muted);
      }

      .qr-btn:active {
        transform: scale(0.98);
      }

      .qr-btn-primary {
        background: var(--qr-primary);
        border-color: var(--qr-primary);
        color: #FFFFFF;
      }

      .qr-btn-primary:hover {
        background: var(--qr-primary-hover);
        border-color: var(--qr-primary-hover);
      }

      .qr-btn-success {
        background: var(--qr-success) !important;
        border-color: var(--qr-success) !important;
        color: #FFFFFF !important;
      }
    `;
  }

  /**
   * Khởi tạo khung Shadow DOM chung cho hộp thoại.
   * @returns {{ shadow: ShadowRoot, backdrop: HTMLElement, card: HTMLElement }}
   */
  function createBaseModal() {
    closeModal();

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = getModalStyles();

    const backdrop = document.createElement('div');
    backdrop.className = 'qr-backdrop';

    const card = document.createElement('div');
    card.className = 'qr-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    // Click ra ngoài vùng card sẽ đóng hộp kết quả
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeModal();
      }
    });

    backdrop.appendChild(card);
    shadow.appendChild(styleEl);
    shadow.appendChild(backdrop);

    (document.documentElement || document.body).appendChild(host);
    currentHost = host;

    currentKeyDownHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };
    window.addEventListener('keydown', currentKeyDownHandler, true);

    return { shadow, backdrop, card };
  }

  /**
   * Hiển thị hộp kết quả khi giải mã QR thành công.
   * @param {string} decodedText - Nội dung mã QR
   * @param {{ onRescan?: () => void }} [options]
   */
  function showSuccess(decodedText, options = {}) {
    const text = String(decodedText || '').trim();
    const isUrl = isValidHttpUrl(text);
    const { card } = createBaseModal();

    // Header
    const header = document.createElement('div');
    header.className = 'qr-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'qr-title-wrap';

    const badgeIcon = document.createElement('span');
    badgeIcon.className = 'qr-badge-icon';
    badgeIcon.textContent = '📷';

    const title = document.createElement('h2');
    title.className = 'qr-title';
    title.textContent = 'Kết quả quét mã QR';

    titleWrap.appendChild(badgeIcon);
    titleWrap.appendChild(title);

    const topCloseBtn = document.createElement('button');
    topCloseBtn.type = 'button';
    topCloseBtn.className = 'qr-close-icon-btn';
    topCloseBtn.title = 'Đóng (Esc)';
    topCloseBtn.textContent = '✖';
    topCloseBtn.addEventListener('click', closeModal);

    header.appendChild(titleWrap);
    header.appendChild(topCloseBtn);

    // Body: ô chỉ đọc hiển thị nội dung đã giải mã
    const body = document.createElement('div');
    body.className = 'qr-body';

    const textarea = document.createElement('textarea');
    textarea.className = 'qr-textarea';
    textarea.readOnly = true;
    textarea.value = text;
    textarea.addEventListener('click', () => {
      textarea.select();
    });

    body.appendChild(textarea);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'qr-actions';

    // Nút Copy
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'qr-btn qr-btn-primary';
    copyBtn.textContent = '📋 Copy';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(text);
      if (!ok) return;

      copyBtn.textContent = '✅ Đã copy!';
      copyBtn.classList.add('qr-btn-success');

      if (copyResetTimer) {
        clearTimeout(copyResetTimer);
      }
      copyResetTimer = setTimeout(() => {
        copyBtn.textContent = '📋 Copy';
        copyBtn.classList.remove('qr-btn-success');
        copyResetTimer = null;
      }, 2000);
    });
    actions.appendChild(copyBtn);

    // Nếu là URL hợp lệ: thêm nút "🔗 Mở link"
    if (isUrl) {
      const openLinkBtn = document.createElement('button');
      openLinkBtn.type = 'button';
      openLinkBtn.className = 'qr-btn';
      openLinkBtn.textContent = '🔗 Mở link';
      openLinkBtn.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'OPEN_TAB', url: text }, (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              window.open(text, '_blank', 'noopener,noreferrer');
            }
          });
        } else {
          window.open(text, '_blank', 'noopener,noreferrer');
        }
      });
      actions.appendChild(openLinkBtn);
    }

    // Nút Quét lại
    const rescanBtn = document.createElement('button');
    rescanBtn.type = 'button';
    rescanBtn.className = 'qr-btn';
    rescanBtn.textContent = '🔄 Quét lại';
    rescanBtn.addEventListener('click', () => {
      const onRescan = options && options.onRescan;
      closeModal();
      if (typeof onRescan === 'function') {
        onRescan();
      }
    });
    actions.appendChild(rescanBtn);

    // Nút Đóng
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qr-btn';
    closeBtn.textContent = '✖ Đóng';
    closeBtn.addEventListener('click', closeModal);
    actions.appendChild(closeBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    setTimeout(() => {
      copyBtn.focus();
    }, 20);
  }

  /**
   * Hiển thị hộp thông báo khi không tìm thấy mã QR hoặc có lỗi.
   * @param {string} [message] - Nội dung thông báo lỗi
   * @param {{ onRetry?: () => void }} [options]
   */
  function showError(message, options = {}) {
    const errorText = message || 'Không tìm thấy mã QR trong vùng đã chọn';
    const { card } = createBaseModal();

    // Header
    const header = document.createElement('div');
    header.className = 'qr-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'qr-title-wrap';

    const badgeIcon = document.createElement('span');
    badgeIcon.className = 'qr-badge-icon is-error';
    badgeIcon.textContent = '⚠️';

    const title = document.createElement('h2');
    title.className = 'qr-title';
    title.textContent = 'Không tìm thấy mã QR';

    titleWrap.appendChild(badgeIcon);
    titleWrap.appendChild(title);

    const topCloseBtn = document.createElement('button');
    topCloseBtn.type = 'button';
    topCloseBtn.className = 'qr-close-icon-btn';
    topCloseBtn.title = 'Đóng (Esc)';
    topCloseBtn.textContent = '✖';
    topCloseBtn.addEventListener('click', closeModal);

    header.appendChild(titleWrap);
    header.appendChild(topCloseBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'qr-body';

    const msgEl = document.createElement('p');
    msgEl.className = 'qr-error-msg';
    msgEl.textContent = errorText;

    body.appendChild(msgEl);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'qr-actions';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'qr-btn qr-btn-primary';
    retryBtn.textContent = '🔄 Thử lại';
    retryBtn.addEventListener('click', () => {
      const onRetry = options && options.onRetry;
      closeModal();
      if (typeof onRetry === 'function') {
        onRetry();
      }
    });
    actions.appendChild(retryBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'qr-btn';
    closeBtn.textContent = '✖ Đóng';
    closeBtn.addEventListener('click', closeModal);
    actions.appendChild(closeBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    setTimeout(() => {
      retryBtn.focus();
    }, 20);
  }

  /**
   * Hàm hiển thị tổng quát theo hợp đồng giao diện (hỗ trợ cả thành công và thất bại).
   * @param {{ text?: string, success?: boolean, errorMsg?: string, onRescan?: () => void, onRetry?: () => void }} params
   */
  function show(params = {}) {
    const isSuccess = params.success !== undefined ? Boolean(params.success) : Boolean(params.text);
    const callback = params.onRescan || params.onRetry;
    if (isSuccess && params.text) {
      showSuccess(params.text, { onRescan: callback });
    } else {
      showError(params.errorMsg || 'Không tìm thấy mã QR trong vùng đã chọn', {
        onRetry: callback
      });
    }
  }

  window.QRSnapResultUI = {
    show,
    showSuccess,
    showError,
    closeModal,
    hide: closeModal,
    isValidHttpUrl,
    copyToClipboard
  };
})();
