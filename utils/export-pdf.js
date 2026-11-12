/**
 * Local PDF export generator using bundled jsPDF + DejaVu Unicode fonts.
 */

import {
  ensureExtension,
  formatDate,
  formatFilenameFromTemplate,
  getPlatformLabel,
  triggerBlobDownload
} from './helpers.js';

let cachedFontBase64 = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

async function loadBundledFontsBase64() {
  if (cachedFontBase64) return cachedFontBase64;
  if (typeof fetch !== 'function') return null;

  const resolveAssetUrl = (relPath) => {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(relPath);
    }
    return `../${relPath}`;
  };

  try {
    const [sansResp, boldResp, monoResp] = await Promise.all([
      fetch(resolveAssetUrl('lib/fonts/DejaVuSans.ttf')),
      fetch(resolveAssetUrl('lib/fonts/DejaVuSans-Bold.ttf')),
      fetch(resolveAssetUrl('lib/fonts/DejaVuSansMono.ttf'))
    ]);

    if (!sansResp.ok || !boldResp.ok || !monoResp.ok) {
      return null;
    }

    const [sansBuf, boldBuf, monoBuf] = await Promise.all([
      sansResp.arrayBuffer(),
      boldResp.arrayBuffer(),
      monoResp.arrayBuffer()
    ]);

    cachedFontBase64 = {
      sans: arrayBufferToBase64(sansBuf),
      bold: arrayBufferToBase64(boldBuf),
      mono: arrayBufferToBase64(monoBuf)
    };
    return cachedFontBase64;
  } catch {
    return null;
  }
}

/**
 * Normalize text for reliable PDF glyph rendering while preserving Unicode BMP characters
 * (accents, Greek, Cyrillic, math operators, arrows, currency, punctuation).
 */
export function normalizeTextForPdf(text, unicodeFontEnabled = true) {
  let out = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u200B-\u200D\uFE0E\uFE0F\u2060]/g, '')
    .replace(/\t/g, '  ');

  // Map popular astral emojis to crisp BMP symbols supported by DejaVuSans
  const emojiToBmp = {
    '✅': '✓',
    '✔️': '✓',
    '✔': '✓',
    '❌': '✗',
    '⭐': '★',
    '⚠️': '⚠',
    '⚡': '⚡',
    '➡️': '→',
    '⬅️': '←',
    '⬆️': '↑',
    '⬇️': '↓',
    'ℹ️': 'ℹ',
    '🔥': '*',
    '💡': '*',
    '🚀': '→',
    '📌': '•',
    '📁': '[Folder]',
    '💬': '[Chat]'
  };

  for (const [emoji, rep] of Object.entries(emojiToBmp)) {
    out = out.split(emoji).join(rep);
  }

  if (unicodeFontEnabled) {
    // Strip remaining astral (non-BMP > U+FFFF) surrogate pairs so TTF never emits garbled boxes
    out = out.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
    return out;
  }

  // Fallback for WinAnsi built-in Helvetica/Courier when TTF fonts are unavailable
  const winAnsiMap = {
    '—': '--',
    '–': '-',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '…': '...',
    '•': '*',
    '→': '->',
    '←': '<-',
    '↔': '<->',
    '⇒': '=>',
    '✓': '[x]',
    '✗': '[ ]',
    '★': '*',
    '⚠': '!',
    '≤': '<=',
    '≥': '>=',
    '≠': '!=',
    '≈': '~='
  };
  for (const [ch, rep] of Object.entries(winAnsiMap)) {
    out = out.split(ch).join(rep);
  }
  return out.replace(/[^\x09\x0A\x20-\xFF]/g, '?');
}

/**
 * Parse message Markdown into structured visual blocks for PDF rendering.
 */
function parseMessageIntoBlocks(rawContent) {
  const text = String(rawContent || '').replace(/\r\n/g, '\n');
  const blocks = [];
  const fenceRegex = /```([a-zA-Z0-9_+#.-]*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      pushProseBlocks(text.slice(lastIdx, match.index), blocks);
    }
    blocks.push({
      type: 'code',
      lang: (match[1] || '').trim(),
      content: match[2].replace(/\n$/, '')
    });
    lastIdx = fenceRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    pushProseBlocks(text.slice(lastIdx), blocks);
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: '' }];
}

function pushProseBlocks(prose, blocks) {
  const lines = prose.split('\n');
  let buffer = [];

  const flushBuffer = () => {
    const joined = buffer.join('\n').trim();
    if (joined) {
      blocks.push({ type: 'text', content: cleanInlineMarkdownForPdf(joined) });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushBuffer();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: cleanInlineMarkdownForPdf(headingMatch[2])
      });
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushBuffer();
      blocks.push({
        type: 'quote',
        content: cleanInlineMarkdownForPdf(quoteMatch[1])
      });
      continue;
    }

    if (line.trim() === '') {
      flushBuffer();
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
}

function cleanInlineMarkdownForPdf(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

export async function buildPdfDocument(chat, options = {}) {
  const jsPDFCtor = options.jsPDFConstructor || globalThis.jspdf?.jsPDF || globalThis.jsPDF;
  if (!jsPDFCtor) {
    throw new Error('Local jsPDF library is not loaded. Verify lib/jspdf.umd.min.js.');
  }

  const doc = new jsPDFCtor({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true
  });

  // Register Unicode fonts if available
  const fontData = options.fontData !== undefined ? options.fontData : await loadBundledFontsBase64();
  let useUnicodeFont = false;
  if (fontData && fontData.sans && fontData.bold && fontData.mono) {
    try {
      doc.addFileToVFS('DejaVuSans.ttf', fontData.sans);
      doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
      doc.addFileToVFS('DejaVuSans-Bold.ttf', fontData.bold);
      doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
      doc.addFileToVFS('DejaVuSansMono.ttf', fontData.mono);
      doc.addFont('DejaVuSansMono.ttf', 'DejaVuSansMono', 'normal');
      useUnicodeFont = true;
    } catch {
      useUnicodeFont = false;
    }
  }

  const SANS = useUnicodeFont ? 'DejaVuSans' : 'helvetica';
  const MONO = useUnicodeFont ? 'DejaVuSansMono' : 'courier';
  const norm = (s) => normalizeTextForPdf(s, useUnicodeFont);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 44;
  const marginTop = 48;
  const marginBottom = 48;
  const contentWidth = pageWidth - marginX * 2;
  const maxY = pageHeight - marginBottom;

  let y = marginTop;

  const ensureSpace = (neededHeight) => {
    if (y + neededHeight > maxY) {
      doc.addPage();
      y = marginTop;
      return true;
    }
    return false;
  };

  const context = options.context || {};
  const platformLabel = getPlatformLabel(chat.platform);
  const folderName = context.folderName || 'Unfiled';
  const tagNames = Array.isArray(context.tagNames) ? context.tagNames : [];
  const messages = Array.isArray(chat.messages) ? chat.messages : [];

  // Top decorative accent bar
  const accentRgb = chat.platform === 'claude' ? [217, 119, 6] : [79, 70, 229];
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, pageWidth, 6, 'F');

  // Brand Eyebrow
  doc.setFont(SANS, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(norm('CHAT SAVER – ADVANCED EDITION'), marginX, y);
  y += 18;

  // Conversation Title
  doc.setFont(SANS, 'bold');
  doc.setFontSize(17);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(norm(chat.title || 'Untitled Conversation'), contentWidth);
  for (const line of titleLines) {
    ensureSpace(22);
    doc.text(line, marginX, y);
    y += 22;
  }
  y += 4;

  // Metadata Box
  const metaRows = [
    `Platform: ${platformLabel}   |   Messages: ${messages.length}   |   Saved: ${formatDate(chat.createdAt)}`,
    `Folder: ${folderName}${tagNames.length ? `   |   Tags: ${tagNames.join(', ')}` : ''}`
  ];
  if (chat.url) {
    metaRows.push(`Source: ${chat.url}`);
  }

  doc.setFont(SANS, 'normal');
  doc.setFontSize(8.8);
  const wrappedMetaLines = [];
  for (const row of metaRows) {
    const split = doc.splitTextToSize(norm(row), contentWidth - 20);
    wrappedMetaLines.push(...split);
  }
  const metaBoxHeight = wrappedMetaLines.length * 13 + 16;
  ensureSpace(metaBoxHeight + 12);

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(marginX, y, contentWidth, metaBoxHeight, 5, 5, 'FD');

  doc.setTextColor(71, 85, 105);
  let metaY = y + 15;
  for (const mLine of wrappedMetaLines) {
    doc.text(mLine, marginX + 10, metaY);
    metaY += 13;
  }
  y += metaBoxHeight + 18;

  // Messages Loop
  messages.forEach((msg, index) => {
    const isUser = msg.role === 'user';
    const roleLabel = isUser ? 'USER' : `ASSISTANT (${platformLabel.toUpperCase()})`;
    const badgeColor = isUser
      ? [79, 70, 229]
      : (chat.platform === 'claude' ? [180, 83, 9] : [13, 148, 136]);

    // Prevent orphaned message header at page bottom
    ensureSpace(54);

    // Role Pill + Index + Timestamp
    const pillText = norm(`#${index + 1}  ${roleLabel}`);
    doc.setFont(SANS, 'bold');
    doc.setFontSize(8.5);
    const pillWidth = Math.min(contentWidth, doc.getTextWidth(pillText) + 16);

    doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.roundedRect(marginX, y - 10, pillWidth, 16, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(pillText, marginX + 8, y + 1);

    if (msg.timestamp) {
      doc.setFont(SANS, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(norm(msg.timestamp), marginX + pillWidth + 10, y + 1);
    }

    y += 18;

    const blocks = parseMessageIntoBlocks(msg.content);

    for (const block of blocks) {
      if (block.type === 'heading') {
        doc.setFont(SANS, 'bold');
        const fontSize = block.level <= 2 ? 12 : 10.8;
        const lineHeight = fontSize + 4.5;
        doc.setFontSize(fontSize);
        doc.setTextColor(15, 23, 42);
        const hLines = doc.splitTextToSize(norm(block.content), contentWidth);
        for (const hl of hLines) {
          ensureSpace(lineHeight);
          doc.text(hl, marginX, y);
          y += lineHeight;
        }
        y += 4;
      } else if (block.type === 'quote') {
        doc.setFont(SANS, 'normal');
        doc.setFontSize(9.8);
        doc.setTextColor(71, 85, 105);
        const qLines = doc.splitTextToSize(norm(block.content), contentWidth - 16);
        const qLineH = 14;
        for (const ql of qLines) {
          ensureSpace(qLineH);
          doc.setFillColor(203, 213, 225);
          doc.rect(marginX + 2, y - 9, 2.5, qLineH, 'F');
          doc.text(ql, marginX + 12, y);
          y += qLineH;
        }
        y += 4;
      } else if (block.type === 'code') {
        doc.setFont(MONO, 'normal');
        doc.setFontSize(8.4);
        const codeLineH = 12;
        const innerPadX = 10;
        const rawCodeLines = norm(block.content).split('\n');
        const wrappedCodeLines = [];
        for (const rawLine of rawCodeLines) {
          const split = doc.splitTextToSize(rawLine || ' ', contentWidth - innerPadX * 2);
          wrappedCodeLines.push(...split);
        }

        if (block.lang) {
          ensureSpace(28);
          doc.setFont(SANS, 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text(norm(block.lang.toUpperCase()), marginX + 4, y);
          y += 11;
          doc.setFont(MONO, 'normal');
          doc.setFontSize(8.4);
        }

        // Render code block across page breaks smoothly in chunks
        let cursor = 0;
        while (cursor < wrappedCodeLines.length) {
          const availableHeight = maxY - y;
          if (availableHeight < codeLineH + 14) {
            doc.addPage();
            y = marginTop;
          }
          const availNow = maxY - y - 12;
          const linesFit = Math.max(1, Math.floor(availNow / codeLineH));
          const slice = wrappedCodeLines.slice(cursor, cursor + linesFit);
          const slabHeight = slice.length * codeLineH + 12;

          doc.setFillColor(241, 245, 249);
          doc.setDrawColor(226, 232, 240);
          doc.roundedRect(marginX, y - 8, contentWidth, slabHeight, 3, 3, 'FD');

          // Left accent bar inside code slab
          doc.setFillColor(99, 102, 241);
          doc.rect(marginX, y - 8, 3, slabHeight, 'F');

          doc.setTextColor(30, 41, 59);
          let codeY = y + 4;
          for (const cl of slice) {
            doc.text(cl, marginX + innerPadX, codeY);
            codeY += codeLineH;
          }

          y += slabHeight + 6;
          cursor += slice.length;
        }
        y += 2;
      } else {
        // Regular text paragraph
        doc.setFont(SANS, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        const lineHeight = 14.5;
        const pLines = doc.splitTextToSize(norm(block.content), contentWidth);
        for (const pl of pLines) {
          ensureSpace(lineHeight);
          doc.text(pl, marginX, y);
          y += lineHeight;
        }
        y += 5;
      }
    }

    // Divider between messages
    if (index < messages.length - 1) {
      y += 4;
      if (y + 12 <= maxY) {
        doc.setDrawColor(226, 232, 240);
        doc.line(marginX, y, pageWidth - marginX, y);
      }
      y += 14;
    }
  });

  // Page numbers & subtle footer on every page
  const totalPages = doc.getNumberOfPages();
  const shortTitle = norm(chat.title || 'Conversation').slice(0, 55);
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont(SANS, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(shortTitle, marginX, pageHeight - 22);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 22, { align: 'right' });
  }

  return doc;
}

export async function exportChatAsPdf(chat, options = {}) {
  const doc = await buildPdfDocument(chat, options);
  const filename = options.customFilename
    ? ensureExtension(options.customFilename, '.pdf')
    : formatFilenameFromTemplate(options.filenameTemplate || '{title}', chat, '.pdf');

  const arrayBuffer = doc.output('arraybuffer');
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  triggerBlobDownload(blob, filename);
  return {
    filename,
    bytes: blob.size,
    pageCount: doc.getNumberOfPages()
  };
}
