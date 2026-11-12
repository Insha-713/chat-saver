/**
 * Content Script for Claude (claude.ai).
 * Extracts conversation title, ordered user/assistant messages, code blocks,
 * and timestamps strictly on explicit user request.
 */

(function () {
  if (window.__chatSaverClaudeRegistered) return;
  window.__chatSaverClaudeRegistered = true;

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
      testId.includes('action-bar') ||
      testId.includes('copy') ||
      testId.includes('feedback') ||
      testId.includes('retry') ||
      testId.includes('edit-message') ||
      testId.includes('model-selector')
    ) {
      return true;
    }
    return false;
  }

  function extractCodeBlock(preEl) {
    const codeEl = preEl.querySelector('code') || preEl;
    let lang = '';

    const classNames = `${codeEl.className || ''} ${preEl.className || ''}`;
    const langClassMatch = classNames.match(/\b(?:language|lang)-([a-zA-Z0-9_+#.-]+)/i);
    if (langClassMatch) {
      lang = langClassMatch[1].toLowerCase();
    }

    // Claude often places a language label in the sibling wrapper above <code> or in a header bar inside <pre>
    if (!lang) {
      const container = preEl.closest('.code-block__code, [class*="code-block"]') || preEl;
      const candidates = container.querySelectorAll('div, span');
      for (const cand of candidates) {
        if (cand.contains(codeEl) || cand.closest('button') || codeEl.contains(cand)) continue;
        const txt = (cand.textContent || '').trim();
        if (
          txt &&
          txt.length <= 24 &&
          !/copy/i.test(txt) &&
          !/copied/i.test(txt) &&
          /^[a-zA-Z0-9_+#.-]+$/.test(txt)
        ) {
          lang = txt.toLowerCase();
          break;
        }
      }
    }

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
    const timeEl = containerEl.querySelector('time[datetime], time[title], time, [data-timestamp]');
    if (!timeEl) return null;
    const dt = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-timestamp');
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

  function isInsideChromeOrComposer(el) {
    return Boolean(
      el.closest('nav, aside, header, footer, form, fieldset, [role="dialog"], [contenteditable="true"]')
    );
  }

  function extractMessages() {
    const scope = document.querySelector('main') || document.body;

    // Strategy 1: Collect modern Claude user & assistant message nodes
    const userCandidates = Array.from(
      scope.querySelectorAll('[data-testid="user-message"], .font-user-message')
    ).filter((el) => !isInsideChromeOrComposer(el));

    const assistantCandidates = Array.from(
      scope.querySelectorAll(
        '.font-claude-response, .font-claude-message, [data-testid="assistant-message"], .standard-markdown, .progressive-markdown'
      )
    ).filter(
      (el) =>
        !isInsideChromeOrComposer(el) &&
        !el.closest('[data-testid="user-message"], .font-user-message')
    );

    const userNodes = dedupeOutermostElements(userCandidates);
    const assistantNodes = dedupeOutermostElements(assistantCandidates).filter(
      (aEl) => !userNodes.some((uEl) => uEl.contains(aEl) || aEl.contains(uEl))
    );

    const combined = [
      ...userNodes.map((el) => ({ role: 'user', el })),
      ...assistantNodes.map((el) => ({ role: 'assistant', el }))
    ];

    if (combined.length > 0) {
      combined.sort((a, b) =>
        (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      );

      const messages = [];
      for (const item of combined) {
        const content = domToMarkdown(item.el);
        if (content) {
          const turnWrap = item.el.closest('[data-test-render-count]') || item.el.parentElement;
          messages.push({
            role: item.role,
            content,
            timestamp: extractTimestamp(turnWrap) || extractTimestamp(item.el)
          });
        }
      }
      if (messages.length > 0) return messages;
    }

    // Strategy 2: Turn-render wrapper fallback ([data-test-render-count])
    const renderBlocks = dedupeOutermostElements(
      Array.from(scope.querySelectorAll('[data-test-render-count]')).filter(
        (el) => !isInsideChromeOrComposer(el)
      )
    );

    if (renderBlocks.length > 0) {
      const messages = [];
      for (const block of renderBlocks) {
        const hasUser = Boolean(
          block.querySelector('[data-testid="user-message"], .font-user-message, [data-testid*="human"]')
        );
        const hasAssistant = Boolean(
          block.querySelector('.font-claude-response, .font-claude-message, [data-is-streaming], .prose, .markdown')
        );
        let role = null;
        if (hasUser && !hasAssistant) role = 'user';
        else if (hasAssistant) role = 'assistant';
        else role = messages.length % 2 === 0 ? 'user' : 'assistant';

        const content = domToMarkdown(block);
        if (content) {
          messages.push({
            role,
            content,
            timestamp: extractTimestamp(block)
          });
        }
      }
      if (messages.length > 0) return messages;
    }

    return [];
  }

  function extractTitle(messages) {
    // 1. Claude chat title header button/heading
    const titleSelectors = [
      '[data-testid="chat-title-button"]',
      'header button[data-testid*="chat-title"]',
      'header h1'
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const txt = el.textContent.trim();
        if (txt && !/^(claude|new chat|untitled)$/i.test(txt)) {
          return txt;
        }
      }
    }

    // 2. Active sidebar link matching /chat/<id>
    const chatMatch = window.location.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
    if (chatMatch) {
      const link = document.querySelector(
        `nav a[href*="/chat/${chatMatch[1]}"], aside a[href*="/chat/${chatMatch[1]}"]`
      );
      if (link && link.textContent && link.textContent.trim()) {
        return link.textContent.trim();
      }
    }

    // 3. Document title cleanup
    const docTitle = (document.title || '')
      .replace(/\s*[-|–]\s*Claude\s*$/i, '')
      .trim();
    if (docTitle && !/^(claude|new chat)$/i.test(docTitle)) {
      return docTitle;
    }

    // 4. First user message fallback
    const firstUser = messages.find((m) => m.role === 'user') || messages[0];
    if (firstUser && firstUser.content) {
      const clean = firstUser.content.replace(/\s+/g, ' ').trim();
      return clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
    }

    return 'Claude Conversation';
  }

  function extractConversation() {
    const messages = extractMessages();
    if (!messages || messages.length === 0) {
      return {
        ok: false,
        platform: 'claude',
        error: 'No conversation messages found on this Claude page. Open an active Claude conversation with at least one message.'
      };
    }

    const title = extractTitle(messages);
    return {
      ok: true,
      data: {
        platform: 'claude',
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
        platform: 'claude',
        error: `Claude extraction error: ${err.message}`
      });
    }
    return false;
  });
})();
