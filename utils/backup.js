/**
 * JSON Backup & Restore utilities with strict validation and duplicate protection.
 */

import {
  buildCanonicalKey,
  computeContentHash,
  FOLDER_COLORS,
  generateId,
  sanitizeFilename,
  TAG_COLORS,
  triggerBlobDownload
} from './helpers.js';
import {
  DEFAULT_SETTINGS,
  getAllData,
  normalizeMessages,
  replaceAllData,
  UNFILED_FOLDER_ID
} from './storage.js';

export const BACKUP_APP_ID = 'Chat Saver – Advanced Edition';
export const BACKUP_SCHEMA_VERSION = 1;

export function createBackupPayload(data) {
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    stats: {
      chats: Array.isArray(data.chats) ? data.chats.length : 0,
      folders: Array.isArray(data.folders) ? data.folders.length : 0,
      tags: Array.isArray(data.tags) ? data.tags.length : 0
    },
    data: {
      chats: Array.isArray(data.chats) ? data.chats : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
    }
  };
}

export async function exportFullBackup(customFilename = '') {
  const data = await getAllData();
  const payload = createBackupPayload(data);
  const json = JSON.stringify(payload, null, 2);
  const datePart = new Date().toISOString().slice(0, 10);
  const baseName = customFilename
    ? sanitizeFilename(customFilename.replace(/\.json$/i, ''), 'chat-saver-backup')
    : `chat-saver-backup-${datePart}`;
  const filename = `${baseName}.json`;
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  triggerBlobDownload(blob, filename);
  return { filename, bytes: blob.size, stats: payload.stats };
}

export function parseAndValidateBackup(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('Selected file is empty.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Invalid JSON syntax: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Backup JSON must be a valid JSON object.');
  }

  const root = (parsed.data && typeof parsed.data === 'object') ? parsed.data : parsed;

  if (!Array.isArray(root.chats)) {
    throw new Error('Invalid backup structure: missing "chats" array.');
  }

  // Validate & sanitize folders
  const rawFolders = Array.isArray(root.folders) ? root.folders : [];
  const folders = [];
  const validFolderIds = new Set([UNFILED_FOLDER_ID]);
  rawFolders.forEach((f, idx) => {
    if (!f || typeof f !== 'object') return;
    const name = String(f.name || '').trim();
    if (!name || name.toLowerCase() === 'unfiled') return;
    const id = String(f.id || generateId('fld'));
    if (validFolderIds.has(id)) return;
    validFolderIds.add(id);
    folders.push({
      id,
      name,
      color: typeof f.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(f.color)
        ? f.color
        : FOLDER_COLORS[idx % FOLDER_COLORS.length],
      createdAt: validIsoOrNow(f.createdAt)
    });
  });

  // Validate & sanitize tags
  const rawTags = Array.isArray(root.tags) ? root.tags : [];
  const tags = [];
  const validTagIds = new Set();
  rawTags.forEach((t, idx) => {
    if (typeof t === 'string') {
      const name = t.trim().replace(/^#+/, '');
      if (!name) return;
      const id = generateId('tag');
      validTagIds.add(id);
      tags.push({
        id,
        name,
        color: TAG_COLORS[idx % TAG_COLORS.length],
        createdAt: new Date().toISOString()
      });
      return;
    }
    if (!t || typeof t !== 'object') return;
    const name = String(t.name || '').trim().replace(/^#+/, '');
    if (!name) return;
    const id = String(t.id || generateId('tag'));
    if (validTagIds.has(id)) return;
    validTagIds.add(id);
    tags.push({
      id,
      name,
      color: typeof t.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(t.color)
        ? t.color
        : TAG_COLORS[idx % TAG_COLORS.length],
      createdAt: validIsoOrNow(t.createdAt)
    });
  });

  // Validate chats strictly
  const chats = [];
  for (let i = 0; i < root.chats.length; i++) {
    const item = root.chats[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid chat entry at index ${i}: expected an object.`);
    }
    if (!Array.isArray(item.messages)) {
      throw new Error(`Invalid chat "${item.title || i}": missing "messages" array.`);
    }

    const messages = normalizeMessages(item.messages);
    if (messages.length === 0) {
      throw new Error(`Chat "${item.title || i}" contains zero valid messages.`);
    }

    const platform = item.platform === 'claude' ? 'claude' : (item.platform === 'chatgpt' ? 'chatgpt' : null);
    if (!platform) {
      throw new Error(`Chat "${item.title || i}" has unsupported platform "${item.platform}". Expected "chatgpt" or "claude".`);
    }

    const title = String(item.title || '').trim() || `${platform === 'claude' ? 'Claude' : 'ChatGPT'} Conversation`;
    const url = typeof item.url === 'string' ? item.url : '';
    const folderId = (typeof item.folderId === 'string' && validFolderIds.has(item.folderId))
      ? item.folderId
      : UNFILED_FOLDER_ID;

    const itemTags = Array.isArray(item.tags)
      ? item.tags.filter((tid) => typeof tid === 'string' && validTagIds.has(tid))
      : [];

    chats.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : generateId('chat'),
      platform,
      title,
      url,
      canonicalKey: item.canonicalKey || buildCanonicalKey(platform, url),
      createdAt: validIsoOrNow(item.createdAt),
      updatedAt: validIsoOrNow(item.updatedAt || item.createdAt),
      messageCount: messages.length,
      folderId,
      tags: [...new Set(itemTags)],
      favorite: Boolean(item.favorite),
      titleEditedByUser: Boolean(item.titleEditedByUser),
      contentHash: computeContentHash(messages, title),
      messages
    });
  }

  const rawSettings = (root.settings && typeof root.settings === 'object') ? root.settings : {};
  const settings = {
    theme: rawSettings.theme === 'dark' ? 'dark' : 'light',
    defaultExportFormat: ['pdf', 'markdown', 'txt'].includes(rawSettings.defaultExportFormat)
      ? rawSettings.defaultExportFormat
      : DEFAULT_SETTINGS.defaultExportFormat,
    filenameTemplate: typeof rawSettings.filenameTemplate === 'string' && rawSettings.filenameTemplate.trim()
      ? rawSettings.filenameTemplate.trim()
      : DEFAULT_SETTINGS.filenameTemplate,
    includeTimestamps: rawSettings.includeTimestamps !== false
  };

  return {
    exportedAt: parsed.exportedAt || null,
    chats,
    folders,
    tags,
    settings
  };
}

function validIsoOrNow(val) {
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export async function previewBackupImport(validatedBackup) {
  const existing = await getAllData();
  const existingIds = new Set(existing.chats.map((c) => c.id));
  const existingHashes = new Set(existing.chats.map((c) => `${c.platform}:${c.contentHash}`));
  const existingFolderNames = new Set(existing.folders.map((f) => f.name.toLowerCase()));
  const existingTagNames = new Set(existing.tags.map((t) => t.name.toLowerCase()));

  let newChats = 0;
  let duplicateChats = 0;
  for (const chat of validatedBackup.chats) {
    if (existingIds.has(chat.id) || existingHashes.has(`${chat.platform}:${chat.contentHash}`)) {
      duplicateChats += 1;
    } else {
      newChats += 1;
    }
  }

  const newFolders = validatedBackup.folders.filter(
    (f) => !existingFolderNames.has(f.name.toLowerCase())
  ).length;
  const newTags = validatedBackup.tags.filter(
    (t) => !existingTagNames.has(t.name.toLowerCase())
  ).length;

  return {
    existingChatsCount: existing.chats.length,
    incomingChatsCount: validatedBackup.chats.length,
    newChats,
    duplicateChats,
    newFolders,
    newTags
  };
}

export async function applyBackupImport(validatedBackup, mode = 'merge') {
  if (mode === 'replace') {
    await replaceAllData({
      chats: validatedBackup.chats,
      folders: validatedBackup.folders,
      tags: validatedBackup.tags,
      settings: validatedBackup.settings
    });
    return {
      mode: 'replace',
      addedChats: validatedBackup.chats.length,
      skippedDuplicates: 0,
      addedFolders: validatedBackup.folders.length,
      addedTags: validatedBackup.tags.length
    };
  }

  // Safe merge mode: keep existing data, remap folder/tag IDs cleanly, skip duplicate chats
  const existing = await getAllData();
  const mergedFolders = [...existing.folders];
  const folderIdRemap = new Map([[UNFILED_FOLDER_ID, UNFILED_FOLDER_ID]]);
  let addedFolders = 0;

  for (const incFolder of validatedBackup.folders) {
    const matchByName = mergedFolders.find(
      (f) => f.name.toLowerCase() === incFolder.name.toLowerCase()
    );
    if (matchByName) {
      folderIdRemap.set(incFolder.id, matchByName.id);
    } else {
      const nextId = mergedFolders.some((f) => f.id === incFolder.id)
        ? generateId('fld')
        : incFolder.id;
      mergedFolders.push({ ...incFolder, id: nextId });
      folderIdRemap.set(incFolder.id, nextId);
      addedFolders += 1;
    }
  }

  const mergedTags = [...existing.tags];
  const tagIdRemap = new Map();
  let addedTags = 0;

  for (const incTag of validatedBackup.tags) {
    const matchByName = mergedTags.find(
      (t) => t.name.toLowerCase() === incTag.name.toLowerCase()
    );
    if (matchByName) {
      tagIdRemap.set(incTag.id, matchByName.id);
    } else {
      const nextId = mergedTags.some((t) => t.id === incTag.id)
        ? generateId('tag')
        : incTag.id;
      mergedTags.push({ ...incTag, id: nextId });
      tagIdRemap.set(incTag.id, nextId);
      addedTags += 1;
    }
  }

  const mergedChats = [...existing.chats];
  const existingIds = new Set(existing.chats.map((c) => c.id));
  const existingKeys = new Set(existing.chats.map((c) => `${c.platform}:${c.contentHash}`));
  let addedChats = 0;
  let skippedDuplicates = 0;

  for (const incChat of validatedBackup.chats) {
    const hashKey = `${incChat.platform}:${incChat.contentHash}`;
    if (existingIds.has(incChat.id) || existingKeys.has(hashKey)) {
      skippedDuplicates += 1;
      continue;
    }

    const mappedFolderId = folderIdRemap.get(incChat.folderId) || UNFILED_FOLDER_ID;
    const mappedTags = [...new Set(
      (incChat.tags || [])
        .map((tid) => tagIdRemap.get(tid))
        .filter(Boolean)
    )];

    const safeId = existingIds.has(incChat.id) ? generateId('chat') : incChat.id;
    existingIds.add(safeId);
    existingKeys.add(hashKey);

    mergedChats.push({
      ...incChat,
      id: safeId,
      folderId: mappedFolderId,
      tags: mappedTags
    });
    addedChats += 1;
  }

  // Sort newest first after merge
  mergedChats.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  await replaceAllData({
    chats: mergedChats,
    folders: mergedFolders,
    tags: mergedTags,
    settings: existing.settings
  });

  return {
    mode: 'merge',
    addedChats,
    skippedDuplicates,
    addedFolders,
    addedTags
  };
}
