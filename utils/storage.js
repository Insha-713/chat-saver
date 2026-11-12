/**
 * Local storage service for Chat Saver – Advanced Edition.
 * Uses strictly chrome.storage.local (100% local, zero external sync or servers).
 */

import {
  buildCanonicalKey,
  computeContentHash,
  FOLDER_COLORS,
  generateId,
  TAG_COLORS
} from './helpers.js';

export const STORAGE_KEYS = {
  CHATS: 'cs_chats',
  FOLDERS: 'cs_folders',
  TAGS: 'cs_tags',
  SETTINGS: 'cs_settings',
  SCHEMA_VERSION: 'cs_schema_version'
};

export const UNFILED_FOLDER_ID = 'unfiled';

export const DEFAULT_SETTINGS = {
  theme: 'light',
  defaultExportFormat: 'pdf',
  filenameTemplate: '{title}',
  includeTimestamps: true
};

const CURRENT_SCHEMA_VERSION = 1;

function getStorageArea() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  throw new Error('chrome.storage.local API is unavailable in this context.');
}

async function storageGet(keys) {
  const area = getStorageArea();
  return area.get(keys);
}

async function storageSet(items) {
  const area = getStorageArea();
  return area.set(items);
}

// Simple async write queue to avoid concurrent read-modify-write races
let writeQueue = Promise.resolve();
function withWriteLock(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

export async function getAllData() {
  const raw = await storageGet([
    STORAGE_KEYS.CHATS,
    STORAGE_KEYS.FOLDERS,
    STORAGE_KEYS.TAGS,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.SCHEMA_VERSION
  ]);

  return {
    chats: Array.isArray(raw[STORAGE_KEYS.CHATS]) ? raw[STORAGE_KEYS.CHATS] : [],
    folders: Array.isArray(raw[STORAGE_KEYS.FOLDERS]) ? raw[STORAGE_KEYS.FOLDERS] : [],
    tags: Array.isArray(raw[STORAGE_KEYS.TAGS]) ? raw[STORAGE_KEYS.TAGS] : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw[STORAGE_KEYS.SETTINGS] || {}) },
    schemaVersion: raw[STORAGE_KEYS.SCHEMA_VERSION] || CURRENT_SCHEMA_VERSION
  };
}

export async function getChats() {
  const raw = await storageGet([STORAGE_KEYS.CHATS]);
  return Array.isArray(raw[STORAGE_KEYS.CHATS]) ? raw[STORAGE_KEYS.CHATS] : [];
}

export async function getChatById(chatId) {
  const chats = await getChats();
  return chats.find((c) => c.id === chatId) || null;
}

export async function getFolders() {
  const raw = await storageGet([STORAGE_KEYS.FOLDERS]);
  return Array.isArray(raw[STORAGE_KEYS.FOLDERS]) ? raw[STORAGE_KEYS.FOLDERS] : [];
}

export async function getTags() {
  const raw = await storageGet([STORAGE_KEYS.TAGS]);
  return Array.isArray(raw[STORAGE_KEYS.TAGS]) ? raw[STORAGE_KEYS.TAGS] : [];
}

export async function getSettings() {
  const raw = await storageGet([STORAGE_KEYS.SETTINGS]);
  return { ...DEFAULT_SETTINGS, ...(raw[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function updateSettings(partial) {
  return withWriteLock(async () => {
    const current = await getSettings();
    const next = { ...current, ...partial };
    await storageSet({ [STORAGE_KEYS.SETTINGS]: next });
    return next;
  });
}

export async function getStorageInfo() {
  const area = getStorageArea();
  const data = await getAllData();
  let bytesInUse = 0;
  if (typeof area.getBytesInUse === 'function') {
    bytesInUse = await area.getBytesInUse(null);
  } else {
    bytesInUse = new TextEncoder().encode(JSON.stringify(data)).length;
  }
  const quotaBytes = area.QUOTA_BYTES || 10485760; // 10 MB default MV3 local quota
  const totalMessages = data.chats.reduce(
    (sum, c) => sum + (Array.isArray(c.messages) ? c.messages.length : 0),
    0
  );
  return {
    bytesInUse,
    quotaBytes,
    totalChats: data.chats.length,
    totalMessages,
    totalFolders: data.folders.length,
    totalTags: data.tags.length
  };
}

export function normalizeMessages(rawMessages = []) {
  return rawMessages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m, idx) => ({
      id: m.id || generateId('msg'),
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content.trim(),
      timestamp: m.timestamp || null,
      order: idx
    }));
}

export async function findExistingConversation({ platform, url, messages, title }) {
  const chats = await getChats();
  const canonicalKey = buildCanonicalKey(platform, url);
  const contentHash = computeContentHash(messages, title);

  // 1. Exact content hash on same platform
  const exactMatch = chats.find(
    (c) => c.platform === platform && c.contentHash === contentHash
  );

  // 2. Canonical URL match (for specific conversation IDs like /c/xxx or /chat/xxx)
  const hasSpecificConvUrl =
    (platform === 'chatgpt' && /\/(c|share)\//.test(canonicalKey)) ||
    (platform === 'claude' && /\/(chat|share)\//.test(canonicalKey));

  const urlMatch = hasSpecificConvUrl
    ? chats.find((c) => c.canonicalKey === canonicalKey || c.url === url)
    : null;

  const existing = urlMatch || exactMatch || null;
  if (!existing) {
    return { existing: null, isExactDuplicate: false, canonicalKey, contentHash };
  }

  const existingMsgHash = computeContentHash(existing.messages || [], existing.title);
  const incomingMsgHash = computeContentHash(messages || [], title);
  const isExactDuplicate =
    existing.contentHash === contentHash ||
    existingMsgHash === incomingMsgHash ||
    (existing.messageCount === messages.length &&
      computeContentHash(existing.messages || [], '') === computeContentHash(messages, ''));

  return {
    existing,
    isExactDuplicate,
    canonicalKey,
    contentHash
  };
}

export async function saveNewConversation(payload, options = {}) {
  return withWriteLock(async () => {
    const chats = await getChats();
    const folders = await getFolders();
    const now = new Date().toISOString();
    const messages = normalizeMessages(payload.messages);
    if (messages.length === 0) {
      throw new Error('Cannot save an empty conversation with 0 messages.');
    }

    const platform = payload.platform === 'claude' ? 'claude' : 'chatgpt';
    const title = String(payload.title || '').trim() || `${platform === 'claude' ? 'Claude' : 'ChatGPT'} Conversation`;
    const url = String(payload.url || '');
    const canonicalKey = buildCanonicalKey(platform, url);
    const contentHash = computeContentHash(messages, title);

    let folderId = options.folderId || UNFILED_FOLDER_ID;
    if (folderId !== UNFILED_FOLDER_ID && !folders.some((f) => f.id === folderId)) {
      folderId = UNFILED_FOLDER_ID;
    }

    const chat = {
      id: generateId('chat'),
      platform,
      title,
      url,
      canonicalKey,
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      folderId,
      tags: Array.isArray(options.tags) ? [...new Set(options.tags)] : [],
      favorite: Boolean(options.favorite),
      contentHash,
      messages
    };

    chats.unshift(chat);
    await storageSet({
      [STORAGE_KEYS.CHATS]: chats,
      [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
    });
    return chat;
  });
}

export async function updateExistingConversationContent(chatId, payload) {
  return withWriteLock(async () => {
    const chats = await getChats();
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) {
      throw new Error('Saved conversation not found.');
    }

    const existing = chats[idx];
    const messages = normalizeMessages(payload.messages);
    if (messages.length === 0) {
      throw new Error('Extracted conversation has 0 messages; update aborted.');
    }

    const now = new Date().toISOString();
    const nextTitle = existing.titleEditedByUser
      ? existing.title
      : (String(payload.title || '').trim() || existing.title);

    const updated = {
      ...existing,
      title: nextTitle,
      url: payload.url || existing.url,
      canonicalKey: buildCanonicalKey(existing.platform, payload.url || existing.url),
      updatedAt: now,
      messageCount: messages.length,
      contentHash: computeContentHash(messages, nextTitle),
      messages
    };

    chats[idx] = updated;
    await storageSet({ [STORAGE_KEYS.CHATS]: chats });
    return updated;
  });
}

export async function updateChatTitle(chatId, newTitle) {
  const trimmed = String(newTitle || '').trim();
  if (!trimmed) throw new Error('Title cannot be empty.');
  return withWriteLock(async () => {
    const chats = await getChats();
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) throw new Error('Conversation not found.');
    chats[idx] = {
      ...chats[idx],
      title: trimmed,
      titleEditedByUser: true,
      updatedAt: new Date().toISOString(),
      contentHash: computeContentHash(chats[idx].messages || [], trimmed)
    };
    await storageSet({ [STORAGE_KEYS.CHATS]: chats });
    return chats[idx];
  });
}

export async function toggleChatFavorite(chatId) {
  return withWriteLock(async () => {
    const chats = await getChats();
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) throw new Error('Conversation not found.');
    chats[idx] = {
      ...chats[idx],
      favorite: !chats[idx].favorite,
      updatedAt: new Date().toISOString()
    };
    await storageSet({ [STORAGE_KEYS.CHATS]: chats });
    return chats[idx];
  });
}

export async function moveChatToFolder(chatId, folderId) {
  return withWriteLock(async () => {
    const [chats, folders] = await Promise.all([getChats(), getFolders()]);
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) throw new Error('Conversation not found.');
    const validFolderId = (folderId && folderId !== UNFILED_FOLDER_ID && folders.some((f) => f.id === folderId))
      ? folderId
      : UNFILED_FOLDER_ID;
    chats[idx] = {
      ...chats[idx],
      folderId: validFolderId,
      updatedAt: new Date().toISOString()
    };
    await storageSet({ [STORAGE_KEYS.CHATS]: chats });
    return chats[idx];
  });
}

export async function deleteChat(chatId) {
  return withWriteLock(async () => {
    const chats = await getChats();
    const next = chats.filter((c) => c.id !== chatId);
    await storageSet({ [STORAGE_KEYS.CHATS]: next });
    return next.length !== chats.length;
  });
}

// --- Folder Operations ---

export async function createFolder(name, color = null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  if (trimmed.toLowerCase() === 'unfiled') {
    throw new Error('"Unfiled" is a reserved system folder name.');
  }

  return withWriteLock(async () => {
    const folders = await getFolders();
    if (folders.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`A folder named "${trimmed}" already exists.`);
    }
    const chosenColor = color || FOLDER_COLORS[folders.length % FOLDER_COLORS.length];
    const folder = {
      id: generateId('fld'),
      name: trimmed,
      color: chosenColor,
      createdAt: new Date().toISOString()
    };
    folders.push(folder);
    await storageSet({ [STORAGE_KEYS.FOLDERS]: folders });
    return folder;
  });
}

export async function renameFolder(folderId, newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  if (trimmed.toLowerCase() === 'unfiled') {
    throw new Error('"Unfiled" is a reserved system folder name.');
  }

  return withWriteLock(async () => {
    const folders = await getFolders();
    const idx = folders.findIndex((f) => f.id === folderId);
    if (idx === -1) throw new Error('Folder not found.');
    if (folders.some((f) => f.id !== folderId && f.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`A folder named "${trimmed}" already exists.`);
    }
    folders[idx] = { ...folders[idx], name: trimmed };
    await storageSet({ [STORAGE_KEYS.FOLDERS]: folders });
    return folders[idx];
  });
}

export async function deleteFolder(folderId) {
  if (!folderId || folderId === UNFILED_FOLDER_ID) {
    throw new Error('Cannot delete the Unfiled system folder.');
  }
  return withWriteLock(async () => {
    const [folders, chats] = await Promise.all([getFolders(), getChats()]);
    const nextFolders = folders.filter((f) => f.id !== folderId);
    let movedCount = 0;
    const nextChats = chats.map((chat) => {
      if (chat.folderId === folderId) {
        movedCount += 1;
        return { ...chat, folderId: UNFILED_FOLDER_ID, updatedAt: new Date().toISOString() };
      }
      return chat;
    });
    await storageSet({
      [STORAGE_KEYS.FOLDERS]: nextFolders,
      [STORAGE_KEYS.CHATS]: nextChats
    });
    return { movedCount };
  });
}

// --- Tag Operations ---

export async function createTag(name, color = null) {
  const trimmed = String(name || '').trim().replace(/^#+/, '');
  if (!trimmed) throw new Error('Tag name cannot be empty.');

  return withWriteLock(async () => {
    const tags = await getTags();
    const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      throw new Error(`Tag "${existing.name}" already exists.`);
    }
    const tag = {
      id: generateId('tag'),
      name: trimmed,
      color: color || TAG_COLORS[tags.length % TAG_COLORS.length],
      createdAt: new Date().toISOString()
    };
    tags.push(tag);
    await storageSet({ [STORAGE_KEYS.TAGS]: tags });
    return tag;
  });
}

export async function renameTag(tagId, newName) {
  const trimmed = String(newName || '').trim().replace(/^#+/, '');
  if (!trimmed) throw new Error('Tag name cannot be empty.');

  return withWriteLock(async () => {
    const tags = await getTags();
    const idx = tags.findIndex((t) => t.id === tagId);
    if (idx === -1) throw new Error('Tag not found.');
    if (tags.some((t) => t.id !== tagId && t.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Tag "${trimmed}" already exists.`);
    }
    tags[idx] = { ...tags[idx], name: trimmed };
    await storageSet({ [STORAGE_KEYS.TAGS]: tags });
    return tags[idx];
  });
}

export async function deleteTag(tagId) {
  return withWriteLock(async () => {
    const [tags, chats] = await Promise.all([getTags(), getChats()]);
    const nextTags = tags.filter((t) => t.id !== tagId);
    const nextChats = chats.map((chat) => {
      if (Array.isArray(chat.tags) && chat.tags.includes(tagId)) {
        return {
          ...chat,
          tags: chat.tags.filter((id) => id !== tagId),
          updatedAt: new Date().toISOString()
        };
      }
      return chat;
    });
    await storageSet({
      [STORAGE_KEYS.TAGS]: nextTags,
      [STORAGE_KEYS.CHATS]: nextChats
    });
    return true;
  });
}

export async function addTagToChat(chatId, tagNameOrId) {
  const raw = String(tagNameOrId || '').trim().replace(/^#+/, '');
  if (!raw) throw new Error('Tag name cannot be empty.');

  return withWriteLock(async () => {
    const [tags, chats] = await Promise.all([getTags(), getChats()]);
    const chatIdx = chats.findIndex((c) => c.id === chatId);
    if (chatIdx === -1) throw new Error('Conversation not found.');

    let tag = tags.find((t) => t.id === raw || t.name.toLowerCase() === raw.toLowerCase());
    if (!tag) {
      tag = {
        id: generateId('tag'),
        name: raw,
        color: TAG_COLORS[tags.length % TAG_COLORS.length],
        createdAt: new Date().toISOString()
      };
      tags.push(tag);
    }

    const currentTags = Array.isArray(chats[chatIdx].tags) ? chats[chatIdx].tags : [];
    if (!currentTags.includes(tag.id)) {
      chats[chatIdx] = {
        ...chats[chatIdx],
        tags: [...currentTags, tag.id],
        updatedAt: new Date().toISOString()
      };
    }

    await storageSet({
      [STORAGE_KEYS.TAGS]: tags,
      [STORAGE_KEYS.CHATS]: chats
    });
    return { chat: chats[chatIdx], tag };
  });
}

export async function removeTagFromChat(chatId, tagId) {
  return withWriteLock(async () => {
    const chats = await getChats();
    const chatIdx = chats.findIndex((c) => c.id === chatId);
    if (chatIdx === -1) throw new Error('Conversation not found.');
    const currentTags = Array.isArray(chats[chatIdx].tags) ? chats[chatIdx].tags : [];
    chats[chatIdx] = {
      ...chats[chatIdx],
      tags: currentTags.filter((id) => id !== tagId),
      updatedAt: new Date().toISOString()
    };
    await storageSet({ [STORAGE_KEYS.CHATS]: chats });
    return chats[chatIdx];
  });
}

// --- Bulk Backup & Clear ---

export async function replaceAllData({ chats, folders, tags, settings }) {
  return withWriteLock(async () => {
    await storageSet({
      [STORAGE_KEYS.CHATS]: chats,
      [STORAGE_KEYS.FOLDERS]: folders,
      [STORAGE_KEYS.TAGS]: tags,
      [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...(settings || {}) },
      [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
    });
  });
}

export async function clearAllSavedData() {
  return withWriteLock(async () => {
    const currentSettings = await getSettings();
    await storageSet({
      [STORAGE_KEYS.CHATS]: [],
      [STORAGE_KEYS.FOLDERS]: [],
      [STORAGE_KEYS.TAGS]: [],
      [STORAGE_KEYS.SETTINGS]: currentSettings,
      [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION
    });
  });
}
