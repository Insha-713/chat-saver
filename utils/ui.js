/**
 * Shared UI utilities: theme management, toasts, accessible modal dialogs,
 * safe Markdown-to-DOM rendering, and conversation search/filter/sort logic.
 */

import {
  escapeHtml,
  isRecentChat,
  isSafeHttpUrl
} from './helpers.js';

export function applyTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

export function showToast(containerEl, message, type = 'info', duration = 3400) {
  if (!containerEl) return;
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');

  const dot = document.createElement('span');
  dot.className = 'toast__dot';

  const text = document.createElement('span');
  text.className = 'toast__msg';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast__close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => removeToast());

  toast.append(dot, text, closeBtn);
  containerEl.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  let timer = setTimeout(removeToast, duration);
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', () => {
    timer = setTimeout(removeToast, 1800);
  });

  function removeToast() {
    clearTimeout(timer);
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 220);
  }
}

/**
 * Search, filter, and sort conversations locally.
 */
export function filterAndSortChats(chats, folders, tags, state) {
  const folderMap = new Map((folders || []).map((f) => [f.id, f.name.toLowerCase()]));
  const tagMap = new Map((tags || []).map((t) => [t.id, t.name.toLowerCase()]));

  const query = String(state.search || '').trim().toLowerCase();
  const view = state.view || 'all'; // 'all' | 'recent' | 'favorites' | 'folder' | 'tag'
  const platformFilter = state.platform || 'all'; // 'all' | 'chatgpt' | 'claude'
  const quickFilter = state.quickFilter || 'all'; // 'all' | 'chatgpt' | 'claude' | 'favorites' | 'recent'
  const activeFolderId = state.folderId || null;
  const activeTagId = state.tagId || null;
  const sortBy = state.sort || 'newest';

  const filtered = (chats || []).filter((chat) => {
    // Primary sidebar view constraints
    if (view === 'favorites' && !chat.favorite) return false;
    if (view === 'recent' && !isRecentChat(chat, 7)) return false;
    if (view === 'folder' && activeFolderId) {
      if ((chat.folderId || 'unfiled') !== activeFolderId) return false;
    }
    if (view === 'tag' && activeTagId) {
      if (!Array.isArray(chat.tags) || !chat.tags.includes(activeTagId)) return false;
    }

    // Secondary topbar filter pills
    if (platformFilter !== 'all' && chat.platform !== platformFilter) return false;
    if (quickFilter === 'chatgpt' && chat.platform !== 'chatgpt') return false;
    if (quickFilter === 'claude' && chat.platform !== 'claude') return false;
    if (quickFilter === 'favorites' && !chat.favorite) return false;
    if (quickFilter === 'recent' && !isRecentChat(chat, 7)) return false;

    // Explicit tag/folder chip filter inside All view
    if (view !== 'folder' && activeFolderId && (chat.folderId || 'unfiled') !== activeFolderId) {
      return false;
    }
    if (view !== 'tag' && activeTagId && (!Array.isArray(chat.tags) || !chat.tags.includes(activeTagId))) {
      return false;
    }

    if (!query) return true;

    const titleMatch = (chat.title || '').toLowerCase().includes(query);
    if (titleMatch) return true;

    const platformMatch = (chat.platform || '').toLowerCase().includes(query);
    if (platformMatch) return true;

    const folderName = folderMap.get(chat.folderId || 'unfiled') || 'unfiled';
    if (folderName.includes(query)) return true;

    const chatTagNames = (chat.tags || []).map((tid) => tagMap.get(tid) || '').filter(Boolean);
    if (chatTagNames.some((name) => name.includes(query))) return true;

    const msgMatch = (chat.messages || []).some((m) =>
      String(m.content || '').toLowerCase().includes(query)
    );
    return msgMatch;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (sortBy === 'oldest') {
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    }
    if (sortBy === 'alpha') {
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, {
        sensitivity: 'base'
      });
    }
    if (sortBy === 'updated') {
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    }
    // default 'newest'
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  return sorted;
}

/**
 * Safely renders Markdown text to DOM fragments inside a target container
 * without executing arbitrary HTML or unsafe links.
 */
export function renderMarkdownSafe(containerEl, markdownText, onCopyCode) {
  containerEl.textContent = '';
  const text = String(markdownText || '').replace(/\r\n/g, '\n');

  // Split by fenced code blocks first
  const fenceRegex = /```([a-zA-Z0-9_+#.-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const prose = text.slice(lastIndex, match.index);
      appendProseFragment(containerEl, prose);
    }
    const lang = (match[1] || 'code').trim();
    const code = match[2].replace(/\n$/, '');
    containerEl.appendChild(createCodeBlockNode(lang, code, onCopyCode));
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    appendProseFragment(containerEl, text.slice(lastIndex));
  }
}

function createCodeBlockNode(lang, code, onCopyCode) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-code-block';

  const header = document.createElement('div');
  header.className = 'md-code-block__header';

  const langSpan = document.createElement('span');
  langSpan.className = 'md-code-block__lang';
  langSpan.textContent = lang || 'text';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'md-code-block__copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.textContent = 'Copied!';
      if (onCopyCode) onCopyCode(true);
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    } catch {
      if (onCopyCode) onCopyCode(false);
    }
  });

  header.append(langSpan, copyBtn);

  const pre = document.createElement('pre');
  pre.className = 'md-code-block__pre';
  const codeEl = document.createElement('code');
  codeEl.textContent = code;
  pre.appendChild(codeEl);

  wrapper.append(header, pre);
  return wrapper;
}

function appendProseFragment(containerEl, prose) {
  const lines = prose.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      const hr = document.createElement('hr');
      hr.className = 'md-hr';
      containerEl.appendChild(hr);
      i += 1;
      continue;
    }

    // Headings
    const hMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = Math.min(6, hMatch[1].length);
      const h = document.createElement(`h${level}`);
      h.className = `md-heading md-heading--h${level}`;
      h.innerHTML = formatInlineMarkdown(hMatch[2]);
      containerEl.appendChild(h);
      i += 1;
      continue;
    }

    // Markdown table
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])
    ) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      containerEl.appendChild(createTableNode(tableLines));
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const bq = document.createElement('blockquote');
      bq.className = 'md-blockquote';
      bq.innerHTML = quoteLines.map(formatInlineMarkdown).join('<br>');
      containerEl.appendChild(bq);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const ul = document.createElement('ul');
      ul.className = 'md-list';
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        li.innerHTML = formatInlineMarkdown(lines[i].replace(/^\s*[-*+]\s+/, ''));
        ul.appendChild(li);
        i += 1;
      }
      containerEl.appendChild(ul);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const ol = document.createElement('ol');
      ol.className = 'md-list md-list--ordered';
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const li = document.createElement('li');
        li.innerHTML = formatInlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ''));
        ol.appendChild(li);
        i += 1;
      }
      containerEl.appendChild(ol);
      continue;
    }

    // Paragraph (collect until blank line or block start)
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|([-*_])\2{2,}\s*$)/.test(lines[i])
    ) {
      pLines.push(lines[i]);
      i += 1;
    }
    const p = document.createElement('p');
    p.className = 'md-paragraph';
    p.innerHTML = pLines.map(formatInlineMarkdown).join('<br>');
    containerEl.appendChild(p);
  }
}

function createTableNode(tableLines) {
  const wrap = document.createElement('div');
  wrap.className = 'md-table-wrap';
  const table = document.createElement('table');
  table.className = 'md-table';

  const parseRow = (rowStr) =>
    rowStr
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

  if (tableLines.length > 0) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const cell of parseRow(tableLines[0])) {
      const th = document.createElement('th');
      th.innerHTML = formatInlineMarkdown(cell);
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  if (tableLines.length > 2) {
    const tbody = document.createElement('tbody');
    for (let r = 2; r < tableLines.length; r++) {
      const tr = document.createElement('tr');
      for (const cell of parseRow(tableLines[r])) {
        const td = document.createElement('td');
        td.innerHTML = formatInlineMarkdown(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  wrap.appendChild(table);
  return wrap;
}

function formatInlineMarkdown(raw) {
  // First escape HTML completely so user/AI output cannot inject scripts/tags
  let html = escapeHtml(raw);

  // Preserve inline code spans first using placeholders
  const codeSpans = [];
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code class="md-inline-code">${code}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  // Links [label](url) - allow only http/https
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const unescapedUrl = url.replace(/&amp;/g, '&');
    if (isSafeHttpUrl(unescapedUrl)) {
      return `<a class="md-link" href="${escapeHtml(unescapedUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return label;
  });

  // Bold, Italic, Strikethrough
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Restore inline code spans
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx) => codeSpans[Number(idx)] || '');

  return html;
}
