/**
 * Markdown export generator for Chat Saver – Advanced Edition.
 */

import {
  ensureExtension,
  formatDate,
  formatFilenameFromTemplate,
  getPlatformLabel,
  triggerBlobDownload
} from './helpers.js';

export function generateMarkdownContent(chat, context = {}) {
  const folderName = context.folderName || 'Unfiled';
  const tagNames = Array.isArray(context.tagNames) ? context.tagNames : [];
  const platformLabel = getPlatformLabel(chat.platform);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];

  const lines = [];
  lines.push(`# ${chat.title || 'Untitled Conversation'}`);
  lines.push('');
  lines.push(`- **Platform:** ${platformLabel}`);
  lines.push(`- **Saved:** ${formatDate(chat.createdAt)}`);
  if (chat.updatedAt && chat.updatedAt !== chat.createdAt) {
    lines.push(`- **Updated:** ${formatDate(chat.updatedAt)}`);
  }
  lines.push(`- **Messages:** ${messages.length}`);
  lines.push(`- **Folder:** ${folderName}`);
  if (tagNames.length > 0) {
    lines.push(`- **Tags:** ${tagNames.map((t) => `\`${t}\``).join(', ')}`);
  }
  if (chat.favorite) {
    lines.push('- **Favorite:** Yes');
  }
  if (chat.url) {
    lines.push(`- **Source URL:** ${chat.url}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  messages.forEach((msg, index) => {
    const roleHeading = msg.role === 'user' ? 'User' : `Assistant (${platformLabel})`;
    const tsSuffix = msg.timestamp ? ` · *${msg.timestamp}*` : '';
    lines.push(`## ${index + 1}. ${roleHeading}${tsSuffix}`);
    lines.push('');
    lines.push(String(msg.content || '').trim());
    lines.push('');
    if (index < messages.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });

  return lines.join('\n');
}

export function exportChatAsMarkdown(chat, options = {}) {
  const markdown = generateMarkdownContent(chat, options.context || {});
  const filename = options.customFilename
    ? ensureExtension(options.customFilename, '.md')
    : formatFilenameFromTemplate(options.filenameTemplate || '{title}', chat, '.md');

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  triggerBlobDownload(blob, filename);
  return { filename, bytes: blob.size, content: markdown };
}
