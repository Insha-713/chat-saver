/**
 * Content Script for ChatGPT (chatgpt.com / chat.openai.com).
 * Extracts conversation title, ordered user/assistant messages, code blocks,
 * and timestamps strictly on explicit user request.
 */

(function () {
  if (window.__chatSaverChatGPTRegistered) return;
  window.__chatSaverChatGPTRegistered = true;

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'NAV', 'ASIDE', 'HEADER', 'FOOTER', 'TEXTAREA', 'INPUT'
  ]);

  function isSkippedElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.classList.contains('sr-only')) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'toolbar' || role === 'menu' || role === 'menubar' || role === 'dialog') return true;
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    if (
      testId.includes('action') ||
      testId.includes('copy') ||
      testId.includes('thumbs') ||
      testId.includes('feedback') ||
      testId.includes('voice') ||
      testId.includes('model-switcher')
    ) {
      return true;
    }
    return false;
  }

  function extractCodeBlock(preEl) {
    const codeEl = preEl.querySelector('code') || preEl;
    let lang = '';

    // 1. Check language-* class on <code> or <pre>
    const classNames = `${codeEl.className || ''} ${preEl.className || ''}`;
    const langClassMatch = classNames.match(/\b(?:language|lang)-([a-zA-Z0-9_+#.-]+)/i);
    if (langClassMatch) {
      lang = langClassMatch[1].toLowerCase();
    }

    // 2. Check ChatGPT code block header label (usually first child div/span before <code>, ignoring buttons)
    if (!lang) {
      const headerCandidates = preEl.querySelectorAll('div > span, div:first-child');
      for (const candidate of headerCandidates) {
        if (candidate.contains(codeEl) || candidate.closest('button')) continue;
        const txt = (candidate.textContent || '').trim();
        if (
          txt &&
          txt.length <= 24 &&
          !/copy/i.test(txt) &&
          !/edit/i.test(txt) &&
          !/run/i.test(txt) &&
          /^[a-zA-Z0-9_+#.-]+$/.test(txt)
        ) {
          lang = txt.toLowerCase();
          break;
        }
      }
    }

    // Clone code node and strip any injected UI buttons inside it
    const clone = codeEl.cloneNode(true);
    clone.querySelectorAll('button, [role="button"], .sr-only').forEach((n) => n.remove());
    const rawCode = (clone.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return `\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n`;
  }

  function extractTableMarkdown(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return '';
    const matrix = rows.map((tr) =>
      Array.from(tr.querySelectorAll('th, td')).map((cell) =>
        serializeChildren(cell).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
      )
    ).filter((r) => r.length > 0);
    if (matrix.length === 0) return '';

    const colCount = Math.max(...matrix.map((r) => r.length));
    const padRow = (r) => {
      const copy = [...r];
      while (copy.length < colCount) copy.push('');
      return `| ${copy.join(' | ')} |`;
    };
    const header = padRow(matrix[0]);
    const separator = `| ${Array(colCount).fill('---').join(' | ')} |`;
    const body = matrix.slice(1).map(padRow);
    return `\n${[header, separator, ...body].join('\n')}\n\n`;
  }

  function serializeChildren(node, ctx = { listDepth: 0 }) {
    let out = '';
    for (const child of node.childNodes) {
      out += serializeNode(child, ctx);
    }
    return out;
  }

  function serializeNode(node, ctx = { listDepth: 0 }) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node;
    if (isSkippedElement(el)) return '';

    // Handle KaTeX math cleanly via TeX annotation
    if (el.classList.contains('katex') || el.classList.contains('katex-display')) {
      const texAnn = el.querySelector('annotation[encoding="application/x-tex"]');
      if (texAnn && texAnn.textContent) {
        const tex = texAnn.textContent.trim();
        return el.classList.contains('katex-display') ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
      }
    }

    const tag = el.tagName;

    if (tag === 'PRE') {
      return extractCodeBlock(el);
    }

    if (tag === 'CODE') {
      const text = (el.textContent || '').replace(/\r\n/g, '\n');
      if (!text) return '';
      if (text.includes('`')) {
        return `\`\` ${text} \`\``;
      }
      return `\`${text}\``;
    }

    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n---\n\n';

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const headingText = serializeChildren(el, ctx).replace(/\s+/g, ' ').trim();
      return headingText ? `\n${'#'.repeat(level)} ${headingText}\n\n` : '';
    }

    if (tag === 'STRONG' || tag === 'B') {
      const inner = serializeChildren(el, ctx);
      return inner.trim() ? `**${inner.trim()}**` : inner;
    }

    if (tag === 'EM' || tag === 'I') {
      const inner = serializeChildren(el, ctx);
      return inner.trim() ? `*${inner.trim()}*` : inner;
    }

    if (tag === 'DEL' || tag === 'S') {
      const inner = serializeChildren(el, ctx);
      return inner.trim() ? `~~${inner.trim()}~~` : inner;
    }

    if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      const label = serializeChildren(el, ctx).replace(/\s+/g, ' ').trim();
      if (!label) return '';
      if (/^https?:\/\//i.test(href)) {
        return `[${label}](${href})`;
      }
      return label;
    }

    if (tag === 'BLOCKQUOTE') {
      const inner = serializeChildren(el, ctx).trim();
      if (!inner) return '';
      const quoted = inner.split('\n').map((line) => `> ${line}`).join('\n');
      return `\n${quoted}\n\n`;
    }

    if (tag === 'TABLE') {
      return extractTableMarkdown(el);
    }

    if (tag === 'UL' || tag === 'OL') {
      const isOrdered = tag === 'OL';
      const startAttr = Number(el.getAttribute('start') || '1') || 1;
      const indent = '  '.repeat(ctx.listDepth);
      const items = Array.from(el.children).filter((c) => c.tagName === 'LI');
      let listOut = ctx.listDepth === 0 ? '\n' : '';
      items.forEach((li, i) => {
        const prefix = isOrdered ? `${startAttr + i}. ` : '- ';
        const liText = serializeChildren(li, { listDepth: ctx.listDepth + 1 }).trim();
        if (liText) {
          const lines = liText.split('\n');
          const first = `${indent}${prefix}${lines[0]}`;
          const rest = lines.slice(1).map((l) => (l.trim() ? `${indent}  ${l}` : '')).join('\n');
          listOut += rest ? `${first}\n${rest}\n` : `${first}\n`;
        }
      });
      return ctx.listDepth === 0 ? `${listOut}\n` : listOut;
    }

    if (tag === 'P') {
      const inner = serializeChildren(el, ctx).trim();
      return inner ? `${inner}\n\n` : '';
    }

    const inner = serializeChildren(el, ctx);
    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
      return inner ? `${inner}\n` : '';
    }
    return inner;
  }

  function domToMarkdown(rootEl) {
    if (!rootEl) return '';
    const raw = serializeNode(rootEl, { listDepth: 0 });
    return raw
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractTimestamp(containerEl) {
    if (!containerEl) return null;
    const timeEl = containerEl.querySelector('time[datetime], time[title], time, [data-message-timestamp]');
    if (!timeEl) return null;
    const dt = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-message-timestamp');
    if (dt) return dt.trim();
    const txt = (timeEl.getAttribute('title') || timeEl.textContent || '').trim();
    return txt || null;
  }

  function dedupeOutermostElements(elements) {
    return elements.filter(
      (el, idx) =>
        elements.indexOf(el) === idx &&
        !elements.some((other) => other !== el && other.contains(el))
    );
  }

  function extractRoleFromTurn(turnEl) {
    const roleAttr = turnEl.getAttribute('data-message-author-role') || turnEl.getAttribute('data-turn');
    if (roleAttr === 'user' || roleAttr === 'assistant') return roleAttr;

    const nestedRole = turnEl.querySelector('[data-message-author-role="user"], [data-message-author-role="assistant"]');
    if (nestedRole) {
      return nestedRole.getAttribute('data-message-author-role');
    }

    const srHeading = turnEl.querySelector('.sr-only, h5, h6');
    if (srHeading) {
      const label = (srHeading.textContent || '').toLowerCase();
      if (label.includes('you said') || label.includes('user')) return 'user';
      if (label.includes('chatgpt said') || label.includes('assistant')) return 'assistant';
    }

    if (turnEl.querySelector('.markdown, .prose')) return 'assistant';
    if (turnEl.querySelector('.whitespace-pre-wrap')) return 'user';
    return null;
  }

  function extractContentElementFromTurn(turnEl, role) {
    if (role === 'assistant') {
      const md = turnEl.querySelector('.markdown, .prose, [data-message-author-role="assistant"] .markdown');
      if (md) return md;
      const auth = turnEl.querySelector('[data-message-author-role="assistant"]');
      if (auth) return auth;
    } else if (role === 'user') {
      const preWrap = turnEl.querySelector('[data-message-author-role="user"] .whitespace-pre-wrap, .whitespace-pre-wrap');
      if (preWrap) return preWrap;
      const auth = turnEl.querySelector('[data-message-author-role="user"]');
      if (auth) return auth;
    }
    return turnEl;
  }

  function extractMessages() {
    const messages = [];

    // Strategy 1: Modern ChatGPT conversation-turn containers
    const turnNodes = Array.from(
      document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')
    );
    const outerTurns = dedupeOutermostElements(turnNodes);

    if (outerTurns.length > 0) {
      for (const turn of outerTurns) {
        const roleNodes = Array.from(
          turn.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')
        );

        if (roleNodes.length > 0) {
          for (const rn of dedupeOutermostElements(roleNodes)) {
            const role = rn.getAttribute('data-message-author-role');
            if (role !== 'user' && role !== 'assistant') continue;
            const contentEl = extractContentElementFromTurn(rn, role);
            const content = domToMarkdown(contentEl);
            if (content) {
              messages.push({
                role,
                content,
                timestamp: extractTimestamp(turn) || extractTimestamp(rn)
              });
            }
          }
        } else {
          const role = extractRoleFromTurn(turn);
          if (role === 'user' || role === 'assistant') {
            const contentEl = extractContentElementFromTurn(turn, role);
            const content = domToMarkdown(contentEl);
            if (content) {
              messages.push({
                role,
                content,
                timestamp: extractTimestamp(turn)
              });
            }
          }
        }
      }
      if (messages.length > 0) return messages;
    }

    // Strategy 2: Direct author-role attributes anywhere in <main>
    const mainEl = document.querySelector('main') || document.body;
    const directRoleNodes = dedupeOutermostElements(
      Array.from(mainEl.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'))
    );
    if (directRoleNodes.length > 0) {
      for (const node of directRoleNodes) {
        const role = node.getAttribute('data-message-author-role');
        if (role !== 'user' && role !== 'assistant') continue;
        const contentEl = extractContentElementFromTurn(node, role);
        const content = domToMarkdown(contentEl);
        if (content) {
          messages.push({
            role,
            content,
            timestamp: extractTimestamp(node)
          });
        }
      }
      if (messages.length > 0) return messages;
    }

    // Strategy 3: Structural fallback (.whitespace-pre-wrap for user, .markdown/.prose for assistant)
    const structuralNodes = dedupeOutermostElements(
      Array.from(mainEl.querySelectorAll('.whitespace-pre-wrap, .markdown, .prose'))
        .filter((el) => !el.closest('nav, aside, header, footer, form, [contenteditable="true"]'))
    );
    structuralNodes.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    for (const el of structuralNodes) {
      const role = (el.classList.contains('markdown') || el.classList.contains('prose')) ? 'assistant' : 'user';
      const content = domToMarkdown(el);
      if (content) {
        messages.push({
          role,
          content,
          timestamp: extractTimestamp(el.parentElement)
        });
      }
    }

    return messages;
  }

  function extractTitle(messages) {
    // 1. Active sidebar link matching current conversation ID
    const cMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
    if (cMatch) {
      const activeLink = document.querySelector(
        `nav a[href*="/c/${cMatch[1]}"], aside a[href*="/c/${cMatch[1]}"]`
      );
      if (activeLink && activeLink.textContent && activeLink.textContent.trim()) {
        return activeLink.textContent.trim();
      }
    }

    const currentLink = document.querySelector('nav a[aria-current="page"], nav [data-active="true"]');
    if (currentLink && currentLink.textContent && currentLink.textContent.trim()) {
      const txt = currentLink.textContent.trim();
      if (txt.toLowerCase() !== 'chatgpt' && txt.toLowerCase() !== 'new chat') {
        return txt;
      }
    }

    // 2. Document title cleanup
    const rawDocTitle = (document.title || '')
      .replace(/\s*[-|–]\s*ChatGPT\s*$/i, '')
      .trim();
    if (rawDocTitle && !/^chatgpt$/i.test(rawDocTitle) && !/^new chat$/i.test(rawDocTitle)) {
      return rawDocTitle;
    }

    // 3. Fallback to first user prompt snippet
    const firstUser = messages.find((m) => m.role === 'user') || messages[0];
    if (firstUser && firstUser.content) {
      const clean = firstUser.content.replace(/\s+/g, ' ').trim();
      return clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
    }

    return 'ChatGPT Conversation';
  }

  function extractConversation() {
    const messages = extractMessages();
    if (!messages || messages.length === 0) {
      return {
        ok: false,
        platform: 'chatgpt',
        error: 'No conversation messages found on this ChatGPT page. Open a conversation with at least one message (and ensure it has finished loading).'
      };
    }

    const title = extractTitle(messages);
    return {
      ok: true,
      data: {
        platform: 'chatgpt',
        title,
        url: window.location.href,
        messages: messages.map((m, idx) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || null,
          order: idx
        }))
      }
    };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (!request || request.action !== 'EXTRACT_CONVERSATION') return false;
    try {
      const result = extractConversation();
      sendResponse(result);
    } catch (err) {
      sendResponse({
        ok: false,
        platform: 'chatgpt',
        error: `ChatGPT extraction error: ${err.message}`
      });
    }
    return false;
  });
})();
