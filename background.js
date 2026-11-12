/**
 * Background Service Worker (Manifest V3) for Chat Saver – Advanced Edition.
 * Handles lifecycle initialization and tab navigation helpers.
 * Strictly zero automatic scraping or external network requests.
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './utils/storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.CHATS,
      STORAGE_KEYS.FOLDERS,
      STORAGE_KEYS.TAGS
    ]);

    const updates = {};
    if (!existing[STORAGE_KEYS.SETTINGS]) {
      updates[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
    }
    if (!Array.isArray(existing[STORAGE_KEYS.CHATS])) {
      updates[STORAGE_KEYS.CHATS] = [];
    }
    if (!Array.isArray(existing[STORAGE_KEYS.FOLDERS])) {
      updates[STORAGE_KEYS.FOLDERS] = [];
    }
    if (!Array.isArray(existing[STORAGE_KEYS.TAGS])) {
      updates[STORAGE_KEYS.TAGS] = [];
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch (err) {
    console.error('[Chat Saver] Initialization error:', err);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return false;

  if (message.action === 'OPEN_DASHBOARD') {
    openOrFocusExtensionPage('dashboard/history.html', message.hash || '')
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'OPEN_DETAILS' && message.chatId) {
    const target = `dashboard/details.html?id=${encodeURIComponent(message.chatId)}`;
    openOrFocusExtensionPage(target)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

async function openOrFocusExtensionPage(relativePath, hash = '') {
  const baseUrl = chrome.runtime.getURL(relativePath);
  const fullUrl = hash ? `${baseUrl}${hash.startsWith('#') ? hash : `#${hash}`}` : baseUrl;

  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && t.url.startsWith(baseUrl));
  if (existing && existing.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url: fullUrl });
    if (existing.windowId !== undefined) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return existing;
  }

  return chrome.tabs.create({ url: fullUrl });
}
