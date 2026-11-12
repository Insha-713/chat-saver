import { exportChatAsMarkdown } from '../utils/export-markdown.js';
import { exportChatAsPdf } from '../utils/export-pdf.js';
import { exportChatAsTxt } from '../utils/export-txt.js';
import {
  formatDate,
  getPlatformLabel,
  isSafeHttpUrl,
  sanitizeFilename
} from '../utils/helpers.js';
import {
  addTagToChat,
  deleteChat,
  getAllData,
  moveChatToFolder,
  removeTagFromChat,
  toggleChatFavorite,
  UNFILED_FOLDER_ID,
  updateChatTitle,
  updateSettings
} from '../utils/storage.js';
import { applyTheme, renderMarkdownSafe, showToast } from '../utils/ui.js';

const params = new URLSearchParams(window.location.search);
const chatId = params.get('id');

const state = {
  chat: null,
  folders: [],
  tags: [],
  settings: null
};

const els = {
  actionBar: document.getElementById('actionBar'),
  customFilenameInput: document.getElementById('customFilenameInput'),
  exportPdfBtn: document.getElementById('exportPdfBtn'),
  exportMdBtn: document.getElementById('exportMdBtn'),
  exportTxtBtn: document.getElementById('exportTxtBtn'),
  editTitleBtn: document.getElementById('editTitleBtn'),
  deleteChatBtn: document.getElementById('deleteChatBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  notFoundState: document.getElementById('notFoundState'),
  detailsMain: document.getElementById('detailsMain'),
  platformBadge: document.getElementById('platformBadge'),
  msgCountBadge: document.getElementById('msgCountBadge'),
  favStatusBadge: document.getElementById('favStatusBadge'),
  favToggleBtn: document.getElementById('favToggleBtn'),
  favToggleLabel: document.getElementById('favToggleLabel'),
  chatTitle: document.getElementById('chatTitle'),
  savedDateValue: document.getElementById('savedDateValue'),
  updatedDateValue: document.getElementById('updatedDateValue'),
  folderSelect: document.getElementById('folderSelect'),
  sourceUrlContainer: document.getElementById('sourceUrlContainer'),
  tagsList: document.getElementById('tagsList'),
  addTagForm: document.getElementById('addTagForm'),
  newTagInput: document.getElementById('newTagInput'),
  existingTagsDatalist: document.getElementById('existingTagsDatalist'),
  messagesList: document.getElementById('messagesList'),
  scrollTopBtn: document.getElementById('scrollTopBtn'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalFooter: document.getElementById('modalFooter'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  toastContainer: document.getElementById('toastContainer')
};

async function init() {
  await loadAndRender();
  bindEvents();

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        loadAndRender();
      }
    });
  }
}

async function loadAndRender() {
  const data = await getAllData();
  state.folders = data.folders;
  state.tags = data.tags;
  state.settings = data.settings;
  applyTheme(state.settings.theme);

  if (!chatId) {
    showNotFound();
    return;
  }

  state.chat = data.chats.find((c) => c.id === chatId) || null;
  if (!state.chat) {
    showNotFound();
    return;
  }

  renderDetails();
}

function showNotFound() {
  els.notFoundState.classList.remove('hidden');
  els.detailsMain.classList.add('hidden');
  els.exportPdfBtn.disabled = true;
  els.exportMdBtn.disabled = true;
  els.exportTxtBtn.disabled = true;
  els.editTitleBtn.disabled = true;
  els.deleteChatBtn.disabled = true;
}

function renderDetails() {
  const chat = state.chat;
  els.notFoundState.classList.add('hidden');
  els.detailsMain.classList.remove('hidden');

  document.title = `${chat.title} | Chat Saver`;

  // Pre-fill custom filename only if user hasn't manually typed one
  if (!els.customFilenameInput.dataset.touched) {
    els.customFilenameInput.value = sanitizeFilename(chat.title || 'conversation');
  }

  els.platformBadge.className = `platform-badge platform-badge--${chat.platform}`;
  els.platformBadge.textContent = getPlatformLabel(chat.platform);

  const msgs = Array.isArray(chat.messages) ? chat.messages : [];
  const userCount = msgs.filter((m) => m.role === 'user').length;
  const aiCount = msgs.length - userCount;
  els.msgCountBadge.textContent = `${msgs.length} messages (${userCount} user, ${aiCount} assistant)`;

  els.favStatusBadge.classList.toggle('hidden', !chat.favorite);
  els.favToggleLabel.textContent = chat.favorite ? 'Remove from Favorites' : 'Add to Favorites';

  els.chatTitle.textContent = chat.title || 'Untitled Conversation';
  els.savedDateValue.textContent = formatDate(chat.createdAt);
  els.updatedDateValue.textContent = formatDate(chat.updatedAt || chat.createdAt);

  // Source URL
  els.sourceUrlContainer.textContent = '';
  if (isSafeHttpUrl(chat.url)) {
    const link = document.createElement('a');
    link.href = chat.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'source-link';
    link.textContent = chat.url;
    els.sourceUrlContainer.appendChild(link);
  } else {
    els.sourceUrlContainer.textContent = chat.url || 'Not available';
  }

  // Folder dropdown
  els.folderSelect.textContent = '';
  const unfiled = document.createElement('option');
  unfiled.value = UNFILED_FOLDER_ID;
  unfiled.textContent = 'Unfiled';
  els.folderSelect.appendChild(unfiled);
  for (const fld of state.folders) {
    const opt = document.createElement('option');
    opt.value = fld.id;
    opt.textContent = fld.name;
    els.folderSelect.appendChild(opt);
  }
  els.folderSelect.value = chat.folderId || UNFILED_FOLDER_ID;

  // Tags
  renderTags();

  // Messages
  renderMessages(msgs, chat.platform);
}

function renderTags() {
  const tagMap = new Map(state.tags.map((t) => [t.id, t]));
  els.tagsList.textContent = '';

  const chatTags = state.chat.tags || [];
  if (chatTags.length === 0) {
    const none = document.createElement('span');
    none.style.fontSize = '12.5px';
    none.style.color = 'var(--text-muted)';
    none.textContent = 'No tags yet';
    els.tagsList.appendChild(none);
  } else {
    for (const tid of chatTags) {
      const tObj = tagMap.get(tid);
      if (!tObj) continue;
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const lbl = document.createElement('span');
      lbl.textContent = `#${tObj.name}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'tag-chip__remove';
      rm.title = `Remove tag #${tObj.name}`;
      rm.textContent = '×';
      rm.addEventListener('click', async () => {
        await removeTagFromChat(state.chat.id, tObj.id);
        showToast(els.toastContainer, `Removed #${tObj.name}`, 'success');
      });
      chip.append(lbl, rm);
      els.tagsList.appendChild(chip);
    }
  }

  els.existingTagsDatalist.textContent = '';
  for (const t of state.tags) {
    const opt = document.createElement('option');
    opt.value = t.name;
    els.existingTagsDatalist.appendChild(opt);
  }
}

function renderMessages(messages, platform) {
  els.messagesList.textContent = '';
  const platformLabel = getPlatformLabel(platform);

  messages.forEach((msg, index) => {
    const card = document.createElement('article');
    card.className = `msg-card msg-card--${msg.role === 'user' ? 'user' : 'assistant'}`;

    const header = document.createElement('div');
    header.className = 'msg-card__header';

    const roleWrap = document.createElement('div');
    roleWrap.className = 'msg-card__role-wrap';

    const roleBadge = document.createElement('span');
    roleBadge.className = `role-badge role-badge--${msg.role === 'user' ? 'user' : 'assistant'}`;
    roleBadge.textContent = msg.role === 'user' ? 'User' : platformLabel;

    const orderSpan = document.createElement('span');
    orderSpan.className = 'msg-order';
    orderSpan.textContent = `#${index + 1}`;

    roleWrap.append(roleBadge, orderSpan);

    if (msg.timestamp) {
      const ts = document.createElement('span');
      ts.className = 'msg-timestamp';
      ts.textContent = msg.timestamp;
      roleWrap.appendChild(ts);
    }

    const copyMsgBtn = document.createElement('button');
    copyMsgBtn.type = 'button';
    copyMsgBtn.className = 'btn btn--ghost btn--sm';
    copyMsgBtn.textContent = 'Copy';
    copyMsgBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(msg.content || '');
        showToast(els.toastContainer, 'Message copied to clipboard', 'success');
      } catch {
        showToast(els.toastContainer, 'Clipboard permission denied', 'error');
      }
    });

    header.append(roleWrap, copyMsgBtn);

    const body = document.createElement('div');
    body.className = 'msg-body';
    renderMarkdownSafe(body, msg.content || '', (ok) => {
      showToast(
        els.toastContainer,
        ok ? 'Code copied to clipboard' : 'Clipboard access failed',
        ok ? 'success' : 'error'
      );
    });

    card.append(header, body);
    els.messagesList.appendChild(card);
  });
}

function getExportContext() {
  const folder = state.folders.find((f) => f.id === state.chat.folderId);
  const tagMap = new Map(state.tags.map((t) => [t.id, t.name]));
  return {
    folderName: folder ? folder.name : 'Unfiled',
    tagNames: (state.chat.tags || []).map((tid) => tagMap.get(tid)).filter(Boolean)
  };
}

function openModal({ title, buildBody, footerButtons }) {
  els.modalTitle.textContent = title;
  els.modalBody.textContent = '';
  els.modalFooter.textContent = '';
  buildBody(els.modalBody);
  for (const b of footerButtons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = b.className || 'btn btn--secondary';
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    els.modalFooter.appendChild(btn);
  }
  els.modalBackdrop.classList.remove('hidden');
}

function closeModal() {
  els.modalBackdrop.classList.add('hidden');
}

function bindEvents() {
  els.customFilenameInput.addEventListener('input', () => {
    els.customFilenameInput.dataset.touched = 'true';
  });

  els.exportPdfBtn.addEventListener('click', async () => {
    if (!state.chat) return;
    els.exportPdfBtn.disabled = true;
    const prev = els.exportPdfBtn.textContent;
    els.exportPdfBtn.textContent = 'Exporting…';
    try {
      const res = await exportChatAsPdf(state.chat, {
        context: getExportContext(),
        customFilename: els.customFilenameInput.value.trim()
      });
      showToast(els.toastContainer, `Downloaded ${res.filename} (${res.pageCount} pages)`, 'success');
    } catch (err) {
      showToast(els.toastContainer, `PDF export failed: ${err.message}`, 'error');
    } finally {
      els.exportPdfBtn.disabled = false;
      els.exportPdfBtn.textContent = prev;
    }
  });

  els.exportMdBtn.addEventListener('click', () => {
    if (!state.chat) return;
    const res = exportChatAsMarkdown(state.chat, {
      context: getExportContext(),
      customFilename: els.customFilenameInput.value.trim()
    });
    showToast(els.toastContainer, `Downloaded ${res.filename}`, 'success');
  });

  els.exportTxtBtn.addEventListener('click', () => {
    if (!state.chat) return;
    const res = exportChatAsTxt(state.chat, {
      context: getExportContext(),
      customFilename: els.customFilenameInput.value.trim()
    });
    showToast(els.toastContainer, `Downloaded ${res.filename}`, 'success');
  });

  els.favToggleBtn.addEventListener('click', async () => {
    if (!state.chat) return;
    const updated = await toggleChatFavorite(state.chat.id);
    showToast(
      els.toastContainer,
      updated.favorite ? 'Added to favorites' : 'Removed from favorites',
      'success'
    );
  });

  els.folderSelect.addEventListener('change', async (ev) => {
    if (!state.chat) return;
    await moveChatToFolder(state.chat.id, ev.target.value);
    showToast(els.toastContainer, 'Folder updated', 'success');
  });

  els.addTagForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!state.chat) return;
    const raw = els.newTagInput.value.trim();
    if (!raw) return;
    try {
      await addTagToChat(state.chat.id, raw);
      els.newTagInput.value = '';
      showToast(els.toastContainer, `Added tag #${raw.replace(/^#+/, '')}`, 'success');
    } catch (err) {
      showToast(els.toastContainer, err.message, 'error');
    }
  });

  els.editTitleBtn.addEventListener('click', () => {
    if (!state.chat) return;
    let input;
    openModal({
      title: 'Edit Conversation Title',
      buildBody: (body) => {
        const field = document.createElement('div');
        field.className = 'form-field';
        const lbl = document.createElement('label');
        lbl.textContent = 'Title';
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'text-input';
        input.value = state.chat.title || '';
        field.append(lbl, input);
        body.appendChild(field);
        setTimeout(() => input.focus(), 30);
      },
      footerButtons: [
        { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
        {
          label: 'Save Title',
          className: 'btn btn--primary',
          onClick: async () => {
            try {
              await updateChatTitle(state.chat.id, input.value);
              delete els.customFilenameInput.dataset.touched;
              closeModal();
              showToast(els.toastContainer, 'Title updated', 'success');
            } catch (err) {
              showToast(els.toastContainer, err.message, 'error');
            }
          }
        }
      ]
    });
  });

  els.deleteChatBtn.addEventListener('click', () => {
    if (!state.chat) return;
    openModal({
      title: 'Delete Conversation',
      buildBody: (body) => {
        const p = document.createElement('p');
        p.style.margin = '0';
        p.textContent = `Permanently delete "${state.chat.title}"? This action cannot be undone.`;
        body.appendChild(p);
      },
      footerButtons: [
        { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
        {
          label: 'Delete Forever',
          className: 'btn btn--danger',
          onClick: async () => {
            await deleteChat(state.chat.id);
            closeModal();
            window.location.href = 'history.html';
          }
        }
      ]
    });
  });

  els.themeToggleBtn.addEventListener('click', async () => {
    const nextTheme = state.settings?.theme === 'dark' ? 'light' : 'dark';
    state.settings = await updateSettings({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  els.modalCloseBtn.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === els.modalBackdrop) closeModal();
  });

  window.addEventListener('scroll', () => {
    els.scrollTopBtn.classList.toggle('hidden', window.scrollY < 300);
  });
  els.scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

init();
