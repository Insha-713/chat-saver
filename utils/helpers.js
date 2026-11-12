/**
 * Shared utility helpers for Chat Saver – Advanced Edition.
 * Pure functions only so this module works in service workers and DOM pages.
 */

export const PLATFORM_META = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    shortLabel: 'GPT'
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    shortLabel: 'Claude'
  }
};

export const FOLDER_COLORS = [
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#ef4444', // Red
  '#64748b'  // Slate
];

export const TAG_COLORS = [
  '#4f46e5',
  '#0284c7',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed'
];

export function generateId(prefix = '') {
  const raw = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${raw}` : raw;
}

export function detectPlatformFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'chatgpt.com' || host === 'www.chatgpt.com' || host === 'chat.openai.com') {
      return 'chatgpt';
    }
    if (host === 'claude.ai' || host === 'www.claude.ai') {
      return 'claude';
    }
    return null;
  } catch {
    return null;
  }
}

export function buildCanonicalKey(platform, url) {
  if (!url) return `${platform || 'unknown'}:no-url`;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (platform === 'chatgpt') {
      // Match /c/<id> or /g/<gizmo>/c/<id> or /share/<id>
      const cMatch = path.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (cMatch) return `chatgpt:/c/${cMatch[1]}`;
      const shareMatch = path.match(/\/share\/([a-zA-Z0-9_-]+)/);
      if (shareMatch) return `chatgpt:/share/${shareMatch[1]}`;
      return `chatgpt:${path}`;
    }
    if (platform === 'claude') {
      const chatMatch = path.match(/\/chat\/([a-zA-Z0-9_-]+)/);
      if (chatMatch) return `claude:/chat/${chatMatch[1]}`;
      const shareMatch = path.match(/\/share\/([a-zA-Z0-9_-]+)/);
      if (shareMatch) return `claude:/share/${shareMatch[1]}`;
      return `claude:${path}`;
    }
    return `${platform || parsed.hostname}:${path}`;
  } catch {
    return `${platform || 'unknown'}:${url}`;
  }
}

export function computeContentHash(messages = [], title = '') {
  // Fast deterministic FNV-1a 64-bit-like dual 32-bit hash for duplicate/diff checks
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  const payload = `${String(title || '').trim()}\n` + messages
    .map((m) => `${m.role}:${String(m.content || '').trim()}`)
    .join('\n---\n');

  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c + i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function sanitizeFilename(name, fallback = 'conversation') {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function formatFilenameFromTemplate(template, chat, ext) {
  const tpl = (template || '{title}').trim() || '{title}';
  const dateStr = (chat?.createdAt ? new Date(chat.createdAt) : new Date())
    .toISOString()
    .slice(0, 10);
  const platformLabel = PLATFORM_META[chat?.platform]?.label || chat?.platform || 'AI';
  const raw = tpl
    .replace(/\{title\}/gi, chat?.title || 'conversation')
    .replace(/\{platform\}/gi, platformLabel)
    .replace(/\{date\}/gi, dateStr);
  const base = sanitizeFilename(raw, 'conversation');
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  return base.toLowerCase().endsWith(cleanExt.toLowerCase()) ? base : `${base}${cleanExt}`;
}

export function ensureExtension(filename, ext) {
  const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
  const base = sanitizeFilename(
    String(filename || '').replace(new RegExp(`\\${cleanExt}$`, 'i'), ''),
    'conversation'
  );
  return `${base}${cleanExt}`;
}

export function formatDate(isoString, includeTime = true) {
  if (!isoString) return 'Unknown date';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const options = includeTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return d.toLocaleString(undefined, options);
}

export function formatRelativeDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(isoString, false);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / (1024 ** i);
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function isRecentChat(chat, days = 7) {
  const ts = new Date(chat?.updatedAt || chat?.createdAt || 0).getTime();
  if (!ts) return false;
  return (Date.now() - ts) <= days * 24 * 60 * 60 * 1000;
}

export function getPlatformLabel(platform) {
  return PLATFORM_META[platform]?.label || (platform ? String(platform) : 'Unknown');
}

export function getSnippet(chat, maxLength = 150) {
  const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
  if (msgs.length === 0) return 'No messages captured.';
  const firstUser = msgs.find((m) => m.role === 'user') || msgs[0];
  const plain = String(firstUser?.content || '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength - 1).trimEnd()}…`;
}

export function isSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 15000);
}
