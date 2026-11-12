/**
 * Plain-text (.txt) export generator for Chat Saver – Advanced Edition.
 */

import {
  ensureExtension,
  formatDate,
  formatFilenameFromTemplate,
  getPlatformLabel,
  triggerBlobDownload
} from './helpers.js';

const MAJOR_DIVIDER = '='.repeat(72);
const MINOR_DIVIDER = '-'.repeat(72);

export function generateTxtContent(chat, context = {}) {
  const folderName = context.folderName || 'Unfiled';
  const tagNames = Array.isArray(context.tagNames) ? context.tagNames : [];
  const platformLabel = getPlatformLabel(chat.platform);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];

  const lines = [];
  lines.push(MAJOR_DIVIDER);
  lines.push(`TITLE:     ${chat.title || 'Untitled Conversation'}`);
  lines.push(`PLATFORM:  ${platformLabel}`);
  lines.push(`SAVED:     ${formatDate(chat.createdAt)}`);
  if (chat.updatedAt && chat.updatedAt !== chat.createdAt) {
    lines.push(`UPDATED:   ${formatDate(chat.updatedAt)}`);
  }
  lines.push(`MESSAGES:  ${messages.length}`);
  lines.push(`FOLDER:    ${folderName}`);
  if (tagNames.length > 0) {
    lines.push(`TAGS:      ${tagNames.join(', ')}`);
  }
  if (chat.url) {
    lines.push(`SOURCE:    ${chat.url}`);
  }
  lines.push(MAJOR_DIVIDER);
  lines.push('');

  messages.forEach((msg, index) => {
    const roleLabel = msg.role === 'user' ? 'USER' : `ASSISTANT (${platformLabel.toUpperCase()})`;
    const tsPart = msg.timestamp ? ` | ${msg.timestamp}` : '';
    lines.push(`[${index + 1}] ${roleLabel}${tsPart}`);
    lines.push(MINOR_DIVIDER);
    lines.push(String(msg.content || '').trim());
    lines.push('');
    lines.push('');
  });

  return lines.join('\n');
}

export function exportChatAsTxt(chat, options = {}) {
  const txt = generateTxtContent(chat, options.context || {});
  const filename = options.customFilename
    ? ensureExtension(options.customFilename, '.txt')
    : formatFilenameFromTemplate(options.filenameTemplate || '{title}', chat, '.txt');

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  triggerBlobDownload(blob, filename);
  return { filename, bytes: blob.size, content: txt };
}
