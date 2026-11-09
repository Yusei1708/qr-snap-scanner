/**
 * QR Snap Scanner — Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * 1. Lifecycle & Context Menu Registration:
 *    - "📷 Quét mã QR" (id: 'qr-snap-area') on page/selection
 *    - "Quét mã QR trong ảnh này" (id: 'qr-snap-image') on images
 * 2. Keyboard Command Listener (Alt+Shift+Q -> 'scan-qr-area')
 * 3. Restricted URL Interception & Action Badge User Feedback
 * 4. Dynamic Script Injection (insertCSS & executeScript)
 * 5. Screen Capture Provider ('captureVisibleTab')
 * 6. Safe Tab Navigation ('OPEN_TAB')
 * 7. Cross-Origin Image Fetch Proxy ('FETCH_IMAGE_DATA_URL')
 * 8. Scan History Persistence ('SAVE_HISTORY' in chrome.storage.local)
 */

'use strict';

// -------------------------------------------------------------
// Constants
// -------------------------------------------------------------
const MENU_AREA_ID = 'qr-snap-area';
const MENU_IMAGE_ID = 'qr-snap-image';
const COMMAND_SCAN_AREA = 'scan-qr-area';

const BADGE_RESTRICTED_TEXT = '!';
const BADGE_RESTRICTED_COLOR = '#DC2626';
const BADGE_CLEAR_DELAY_MS = 4000;

const MAX_HISTORY_ITEMS = 20;
const STORAGE_HISTORY_KEY = 'qr_history';

// -------------------------------------------------------------
// Restricted URL Guard
// -------------------------------------------------------------

/**
 * Determines whether the given URL is restricted from extension script injection.
 * Chrome forbids scripting on internal chrome://, extension, webstore, and viewer pages.
 *
 * @param {string} url - Target tab URL
 * @returns {boolean} True if restricted, false if injectable
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
    const pathWithoutQuery = parsed.pathname.toLowerCase();
    if (pathWithoutQuery.endsWith('.pdf')) {
      return true;
    }
  } catch (_) {
    return true;
  }

  return false;
}

/**
 * Displays user feedback via Action Badge on restricted pages.
 * Sets warning badge '!' with red background (#DC2626) and auto-clears after 4s.
 *
 * @param {number} [tabId] - ID of tab to display badge on
 */
function showRestrictedBadge(tabId) {
  try {
    const badgeTarget = tabId ? { tabId } : {};
    chrome.action.setBadgeText({ ...badgeTarget, text: BADGE_RESTRICTED_TEXT });
    chrome.action.setBadgeBackgroundColor({ ...badgeTarget, color: BADGE_RESTRICTED_COLOR });

    if (typeof chrome.action.setTitle === 'function') {
      chrome.action.setTitle({
        ...badgeTarget,
        title: 'Không thể quét mã QR trên trang hệ thống hoặc Chrome Web Store'
      });
    }

    setTimeout(() => {
      try {
        chrome.action.setBadgeText({ ...badgeTarget, text: '' });
      } catch (_) {}
    }, BADGE_CLEAR_DELAY_MS);
  } catch (err) {
    console.warn('[QR Snap] Failed to set action badge:', err);
  }
}

/**
 * Clears badge text for a tab upon successful operation.
 *
 * @param {number} [tabId]
 */
function clearBadge(tabId) {
  try {
    const badgeTarget = tabId ? { tabId } : {};
    chrome.action.setBadgeText({ ...badgeTarget, text: '' });
  } catch (_) {}
}

// -------------------------------------------------------------
// Dynamic Script & Style Injection
// -------------------------------------------------------------

/**
 * Dynamically injects stylesheet and content scripts into the active tab on demand.
 * Avoids broad declarative content scripts matching all URLs.
 *
 * @param {number} tabId - Target tab ID
 */
async function ensureInjected(tabId) {
  if (!tabId) {
    throw new Error('Tab ID is required for script injection');
  }

  // 1. Inject isolated styles
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/styles.css']
    });
  } catch (err) {
    console.warn('[QR Snap] insertCSS notice:', err);
  }

  // 2. Inject scripts in strict dependency order: library -> UI -> selector engine
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      'lib/jsQR.js',
      'content/result-ui.js',
      'content/selector.js'
    ]
  });

  // Clear any lingering error badges on successful injection
  clearBadge(tabId);
}

// -------------------------------------------------------------
// URL Validation & Safe Navigation
// -------------------------------------------------------------

/**
 * Validates that a string is a secure web URL (HTTP or HTTPS only).
 * Rejects javascript:, file:, data:, or malformed strings.
 *
 * @param {string} string - Potential URL string
 * @returns {boolean}
 */
function isValidHttpUrl(string) {
  if (!string || typeof string !== 'string') return false;
  try {
    const url = new URL(string.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// -------------------------------------------------------------
// Cross-Origin Image Fetch Proxy
// -------------------------------------------------------------

/**
 * Fetches an image URL and converts the response into a base64 Data URL.
 * Bypasses canvas CORS tainting for content scripts.
 *
 * @param {string} url - Remote image URL
 * @returns {Promise<string>} Base64 Data URL
 */
async function fetchImageUrlAsDataUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid image URL provided');
  }

  if (url.startsWith('data:')) {
    return url;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed with HTTP status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const arrayBuffer = await response.arrayBuffer();

  let base64 = '';
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(arrayBuffer).toString('base64');
  } else {
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    base64 = btoa(binary);
  }

  return `data:${contentType};base64,${base64}`;
}

// -------------------------------------------------------------
// History Persistence
// -------------------------------------------------------------

let historySaveQueue = Promise.resolve();

/**
 * Saves a decoded QR result to chrome.storage.local qr_history.
 * Maintains a deduplicated FIFO list capped at MAX_HISTORY_ITEMS (20).
 *
 * @param {string} text - Decoded QR text
 * @param {'selection'|'image'} [source='selection'] - Origin of the scan
 * @returns {Promise<{success: boolean, count?: number, entry?: Object, error?: string}>}
 */
async function saveHistoryItem(text, source = 'selection') {
  if (!text || typeof text !== 'string') {
    return { success: false, error: 'Text must be a non-empty string' };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return { success: false, error: 'Text cannot be empty' };
  }

  const executeSave = () =>
    new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_HISTORY_KEY, (result) => {
        let history = Array.isArray(result && result[STORAGE_HISTORY_KEY])
          ? [...result[STORAGE_HISTORY_KEY]]
          : [];

        // Deduplicate: filter out previous entry with exact matching text
        history = history.filter((item) => item && item.text !== trimmedText);

        const newEntry = {
          id: 'qr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          text: trimmedText,
          timestamp: Date.now(),
          isUrl: isValidHttpUrl(trimmedText),
          source: source === 'image' ? 'image' : 'selection'
        };

        // Prepend newest entry to the top (FIFO)
        history.unshift(newEntry);

        // Enforce strict upper bound of 20 items
        if (history.length > MAX_HISTORY_ITEMS) {
          history = history.slice(0, MAX_HISTORY_ITEMS);
        }

        chrome.storage.local.set({ [STORAGE_HISTORY_KEY]: history }, () => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve({ success: true, count: history.length, entry: newEntry });
          }
        });
      });
    });

  const queuedOperation = historySaveQueue.then(executeSave, executeSave);
  historySaveQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

// -------------------------------------------------------------
// Context Menu Setup
// -------------------------------------------------------------

/**
 * Initializes context menus with idempotent teardown.
 */
function setupContextMenus() {
  if (!chrome.contextMenus) return;

  chrome.contextMenus.removeAll(() => {
    // Suppress potential lastError from removeAll
    if (chrome.runtime.lastError) {
      // Intentionally ignored
    }

    chrome.contextMenus.create(
      {
        id: MENU_AREA_ID,
        title: '📷 Quét mã QR',
        contexts: ['page', 'selection']
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[QR Snap] Error creating area menu:', chrome.runtime.lastError.message);
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: MENU_IMAGE_ID,
        title: 'Quét mã QR trong ảnh này',
        contexts: ['image']
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[QR Snap] Error creating image menu:', chrome.runtime.lastError.message);
        }
      }
    );
  });
}

// -------------------------------------------------------------
// Event Listeners Registration
// -------------------------------------------------------------

// 1. Installation Lifecycle
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    setupContextMenus();
  });
}

// 2. Context Menu Click Handler
if (typeof chrome !== 'undefined' && chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let targetTab = tab;
    if (!targetTab || !targetTab.id) {
      const activeTabs = await new Promise((res) => {
        chrome.tabs.query({ active: true, currentWindow: true }, res);
      });
      targetTab = activeTabs && activeTabs[0];
    }

    if (!targetTab || !targetTab.id) return;

    if (isRestrictedUrl(targetTab.url)) {
      showRestrictedBadge(targetTab.id);
      return;
    }

    if (info.menuItemId === MENU_AREA_ID) {
      try {
        await ensureInjected(targetTab.id);
        chrome.tabs.sendMessage(targetTab.id, { action: 'START_SELECTION' }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[QR Snap] Area scan response warning:', chrome.runtime.lastError.message);
          }
        });
      } catch (err) {
        console.warn('[QR Snap] Failed to trigger area selection:', err);
      }
    } else if (info.menuItemId === MENU_IMAGE_ID && info.srcUrl) {
      try {
        await ensureInjected(targetTab.id);
        chrome.tabs.sendMessage(
          targetTab.id,
          { action: 'SCAN_IMAGE_URL', srcUrl: info.srcUrl },
          () => {
            if (chrome.runtime.lastError) {
              console.warn('[QR Snap] Image scan response warning:', chrome.runtime.lastError.message);
            }
          }
        );
      } catch (err) {
        console.warn('[QR Snap] Failed to trigger image scan:', err);
      }
    }
  });
}

// 3. Keyboard Shortcut Command Listener
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === COMMAND_SCAN_AREA) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return;

        if (isRestrictedUrl(tab.url)) {
          showRestrictedBadge(tab.id);
          return;
        }

        try {
          await ensureInjected(tab.id);
          chrome.tabs.sendMessage(tab.id, { action: 'START_SELECTION' }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[QR Snap] Command response warning:', chrome.runtime.lastError.message);
            }
          });
        } catch (err) {
          console.warn('[QR Snap] Failed to trigger command selection:', err);
        }
      });
    }
  });
}

// 4. Runtime Message Dispatcher
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;

    // Action: captureVisibleTab
    if (message.action === 'captureVisibleTab') {
      try {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ dataUrl });
          }
        });
      } catch (err) {
        sendResponse({ error: err.message });
      }
      return true; // Keep channel open for async response
    }

    // Action: OPEN_TAB
    if (message.action === 'OPEN_TAB') {
      if (!message.url || !isValidHttpUrl(message.url)) {
        sendResponse({ success: false, error: 'Chỉ chấp nhận URL http hoặc https' });
        return true;
      }
      try {
        chrome.tabs.create({ url: message.url.trim() }, (newTab) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, tabId: newTab ? newTab.id : undefined });
          }
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    // Action: FETCH_IMAGE_DATA_URL (CORS bypass proxy)
    if (message.action === 'FETCH_IMAGE_DATA_URL') {
      fetchImageUrlAsDataUrl(message.url)
        .then((dataUrl) => {
          sendResponse({ success: true, dataUrl });
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    // Action: SAVE_HISTORY
    if (message.action === 'SAVE_HISTORY') {
      saveHistoryItem(message.text, message.source)
        .then((result) => {
          sendResponse(result);
        })
        .catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    // Action: SHOW_RESTRICTED_BADGE
    if (message.action === 'SHOW_RESTRICTED_BADGE') {
      const tabId = (sender && sender.tab && sender.tab.id) || message.tabId;
      showRestrictedBadge(tabId);
      sendResponse({ success: true });
      return true;
    }

    return false;
  });
}

