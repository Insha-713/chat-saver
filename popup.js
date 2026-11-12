import {
  detectPlatformFromUrl,
  formatRelativeDate,
  getPlatformLabel
} from './utils/helpers.js';
import {
  addTagToChat,
  findExistingConversation,
  getAllData,
  saveNewConversation,
  toggleChatFavorite,
  UNFILED_FOLDER_ID,
  updateExistingConversationContent,
  updateSettings
} from './utils/storage.js';
import { applyTheme, showToast } from './utils/ui.js';

const els = {
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  openDashboardBtn: document.getElementById('openDashboardBtn'),
  platformBadge: document.getElementById('platformBadge'),
  savedStatePill: document.getElementById('savedStatePill'),
  tabTitlePreview: document.getElementById('tabTitlePreview'),
  tabHintText: document.getElementById('tabHintText'),
  saveOptionsRow: document.getElementById('saveOptionsRow'),
  folderSelect: document.getElementById('folderSelect'),
  quickTagsInput: document.getElementById('quickTagsInput'),
  saveBtn: document.getElementById('saveBtn'),
  saveBtnLabel: document.getElementById('saveBtnLabel'),
  saveSpinner: document.getElementById('saveSpinner'),
  saveIcon: document.getElementById('saveIcon'),
  duplicatePanel: document.getElementById('duplicatePanel'),
  duplicateMessage: document.getElementById('duplicateMessage'),
  updateExistingBtn: document.getElementById('updateExistingBtn'),
  saveCopyBtn: document.getElementById('saveCopyBtn'),
  viewExistingBtn: document.getElementById('viewExistingBtn'),
  statusAlert: document.getElementById('statusAlert'),
  statTotal: document.getElementById('statTotal'),
  statFavorites: document.getElementById('statFavorites'),
  statFolders: document.getElementById('statFolders'),
  recentList: document.getElementById('recentList'),
  recentEmpty: document.getElementById('recentEmpty'),
  viewAllLink: document.getElementById('viewAllLink'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  toastContainer: document.getElementById('toastContainer')
};

let activeTab = null;
let detectedPlatform = null;
let pendingExtraction = null;
let matchedExistingChat = null;
let currentSettings = null;

async function init() {
  await loadLibraryState();
  await inspectActiveTab();
  bindEvents();

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        loadLibraryState();
      }
    });
  }
}

async function loadLibraryState() {
  const data = await getAllData();
  currentSettings = data.settings;
  applyTheme(currentSettings.theme);

  // Stats
  els.statTotal.textContent = String(data.chats.length);
  els.statFavorites.textContent = String(data.chats.filter((c) => c.favorite).length);
  els.statFolders.textContent = String(data.folders.length);

  // Folder dropdown
  const prevValue = els.folderSelect.value || UNFILED_FOLDER_ID;
  els.folderSelect.textContent = '';
  const unfiledOpt = document.createElement('option');
  unfiledOpt.value = UNFILED_FOLDER_ID;
  unfiledOpt.textContent = 'Unfiled';
  els.folderSelect.appendChild(unfiledOpt);

  for (const folder of data.folders) {
    const opt = document.createElement('option');
    opt.value = folder.id;
    opt.textContent = folder.name;
    els.folderSelect.appendChild(opt);
  }
  if (Array.from(els.folderSelect.options).some((o) => o.value === prevValue)) {
    els.folderSelect.value = prevValue;
  }

  renderRecentChats(data.chats);
}

function renderRecentChats(chats) {
  const sorted = [...chats].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
  );
  const recent = sorted.slice(0, 4);

  els.recentList.textContent = '';
  if (recent.length === 0) {
    els.recentEmpty.classList.remove('hidden');
    return;
  }

  els.recentEmpty.classList.add('hidden');
  for (const chat of recent) {
    const row = document.createElement('div');
    row.className = 'recent-item';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');

    const main = document.createElement('div');
    main.className = 'recent-item__main';

    const titleEl = document.createElement('div');
    titleEl.className = 'recent-item__title';
    titleEl.textContent = chat.title || 'Untitled Conversation';

    const meta = document.createElement('div');
    meta.className = 'recent-item__meta';

    const plat = document.createElement('span');
    plat.className = `mini-platform mini-platform--${chat.platform}`;
    plat.textContent = getPlatformLabel(chat.platform);

    const info = document.createElement('span');
    info.textContent = `${chat.messageCount || 0} msgs · ${formatRelativeDate(chat.createdAt)}`;

    meta.append(plat, info);
    main.append(titleEl, meta);

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = `star-btn${chat.favorite ? ' is-active' : ''}`;
    starBtn.title = chat.favorite ? 'Remove from favorites' : 'Add to favorites';
    starBtn.setAttribute('aria-label', starBtn.title);
    starBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="${chat.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

    starBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        const updated = await toggleChatFavorite(chat.id);
        showToast(
          els.toastContainer,
          updated.favorite ? 'Added to favorites' : 'Removed from favorites',
          'success'
        );
      } catch (err) {
        showToast(els.toastContainer, err.message, 'error');
      }
    });

    row.addEventListener('click', () => openChatDetails(chat.id));
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openChatDetails(chat.id);
      }
    });

    row.append(main, starBtn);
    els.recentList.appendChild(row);
  }
}

async function inspectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    detectedPlatform = detectPlatformFromUrl(tab?.url || '');

    if (!detectedPlatform) {
      els.platformBadge.className = 'platform-pill platform-pill--neutral';
      els.platformBadge.textContent = 'Unsupported Page';
      els.tabTitlePreview.textContent = 'Open a ChatGPT or Claude conversation';
      els.tabHintText.textContent = 'Navigate to chatgpt.com or claude.ai and open any conversation to save it.';
      els.saveOptionsRow.classList.add('hidden');
      els.saveBtn.disabled = true;
      return;
    }

    els.platformBadge.className = `platform-pill platform-pill--${detectedPlatform}`;
    els.platformBadge.textContent = getPlatformLabel(detectedPlatform);
    els.tabTitlePreview.textContent = (tab?.title || '').replace(/\s*[-|–]\s*(ChatGPT|Claude)\s*$/i, '').trim() || `${getPlatformLabel(detectedPlatform)} Active Tab`;
    els.tabHintText.textContent = 'Click below to capture this conversation locally.';
    els.saveOptionsRow.classList.remove('hidden');
    els.saveBtn.disabled = false;

    // Check if current URL is already saved
    const matchInfo = await findExistingConversation({
      platform: detectedPlatform,
      url: tab.url || '',
      messages: [],
      title: ''
    });

    if (matchInfo.existing) {
      matchedExistingChat = matchInfo.existing;
      els.savedStatePill.textContent = `Saved (${matchInfo.existing.messageCount} msgs)`;
      els.savedStatePill.classList.remove('hidden');
      els.saveBtnLabel.textContent = 'Save or Update Chat';
    } else {
      matchedExistingChat = null;
      els.savedStatePill.classList.add('hidden');
      els.saveBtnLabel.textContent = 'Save Current Chat';
    }
  } catch (err) {
    els.platformBadge.className = 'platform-pill platform-pill--neutral';
    els.platformBadge.textContent = 'Tab Unavailable';
    els.tabTitlePreview.textContent = 'Unable to inspect active tab';
    els.tabHintText.textContent = err.message;
    els.saveBtn.disabled = true;
  }
}

function setLoading(isLoading) {
  els.saveBtn.disabled = isLoading;
  els.saveSpinner.classList.toggle('hidden', !isLoading);
  els.saveIcon.classList.toggle('hidden', isLoading);
  els.saveBtnLabel.textContent = isLoading ? 'Extracting chat…' : (matchedExistingChat ? 'Save or Update Chat' : 'Save Current Chat');
}

function setStatusAlert(message, type = 'info') {
  if (!message) {
    els.statusAlert.classList.add('hidden');
    els.statusAlert.textContent = '';
    return;
  }
  els.statusAlert.className = `status-alert status-alert--${type}`;
  els.statusAlert.textContent = message;
  els.statusAlert.classList.remove('hidden');
}

async function extractFromActiveTab() {
  if (!activeTab || activeTab.id === undefined || !detectedPlatform) {
    throw new Error('No supported ChatGPT or Claude tab is currently active.');
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CONVERSATION' });
    if (response) return response;
  } catch {
    // Content script may not be injected yet if the tab was open before extension install/reload.
    const scriptFile = detectedPlatform === 'claude' ? 'content/claude.js' : 'content/chatgpt.js';
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: [scriptFile]
    });
    const retryResponse = await chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CONVERSATION' });
    if (retryResponse) return retryResponse;
  }

  throw new Error('Could not communicate with the page. Try refreshing the conversation tab.');
}

async function applyQuickTagsToSavedChat(chatId) {
  const raw = (els.quickTagsInput.value || '').trim();
  if (!raw) return;
  const tagNames = raw.split(',').map((t) => t.trim()).filter(Boolean);
  for (const name of tagNames) {
    await addTagToChat(chatId, name);
  }
}

async function handleSaveClick() {
  setStatusAlert(null);
  els.duplicatePanel.classList.add('hidden');
  setLoading(true);

  try {
    const result = await extractFromActiveTab();
    if (!result || !result.ok || !result.data) {
      throw new Error(result?.error || 'Extraction failed. No conversation messages were captured.');
    }

    const extracted = result.data;
    if (!Array.isArray(extracted.messages) || extracted.messages.length === 0) {
      throw new Error('No messages found in this conversation.');
    }

    const dupCheck = await findExistingConversation(extracted);

    if (dupCheck.existing) {
      pendingExtraction = extracted;
      matchedExistingChat = dupCheck.existing;

      const prevCount = dupCheck.existing.messageCount || 0;
      const nextCount = extracted.messages.length;

      if (dupCheck.isExactDuplicate) {
        els.duplicateMessage.textContent =
          `This conversation is already saved (${prevCount} messages) with no new changes.`;
        els.updateExistingBtn.textContent = 'Force Update';
      } else {
        const diff = nextCount - prevCount;
        const diffNote = diff > 0 ? `+${diff} new messages` : `${nextCount} total messages`;
        els.duplicateMessage.textContent =
          `Saved version found (${prevCount} msgs). Current tab has ${diffNote}.`;
        els.updateExistingBtn.textContent = 'Update Existing';
      }

      els.duplicatePanel.classList.remove('hidden');
      setLoading(false);
      return;
    }

    // Save brand new chat
    const folderId = els.folderSelect.value || UNFILED_FOLDER_ID;
    const saved = await saveNewConversation(extracted, { folderId });
    await applyQuickTagsToSavedChat(saved.id);

    matchedExistingChat = saved;
    pendingExtraction = null;
    els.quickTagsInput.value = '';
    els.savedStatePill.textContent = `Saved (${saved.messageCount} msgs)`;
    els.savedStatePill.classList.remove('hidden');

    setStatusAlert(`Saved "${saved.title}" (${saved.messageCount} messages).`, 'success');
    showToast(els.toastContainer, 'Conversation saved locally!', 'success');
    await loadLibraryState();
  } catch (err) {
    setStatusAlert(err.message, 'error');
    showToast(els.toastContainer, 'Could not save conversation', 'error');
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  els.saveBtn.addEventListener('click', handleSaveClick);

  els.updateExistingBtn.addEventListener('click', async () => {
    if (!pendingExtraction || !matchedExistingChat) return;
    try {
      const updated = await updateExistingConversationContent(matchedExistingChat.id, pendingExtraction);
      await applyQuickTagsToSavedChat(updated.id);
      els.duplicatePanel.classList.add('hidden');
      els.savedStatePill.textContent = `Saved (${updated.messageCount} msgs)`;
      els.savedStatePill.classList.remove('hidden');
      setStatusAlert(`Updated "${updated.title}" (${updated.messageCount} messages).`, 'success');
      showToast(els.toastContainer, 'Existing conversation updated!', 'success');
      pendingExtraction = null;
      await loadLibraryState();
    } catch (err) {
      setStatusAlert(err.message, 'error');
    }
  });

  els.saveCopyBtn.addEventListener('click', async () => {
    if (!pendingExtraction) return;
    try {
      const folderId = els.folderSelect.value || UNFILED_FOLDER_ID;
      const copyPayload = {
        ...pendingExtraction,
        title: `${pendingExtraction.title} (Copy)`
      };
      const saved = await saveNewConversation(copyPayload, { folderId });
      await applyQuickTagsToSavedChat(saved.id);
      els.duplicatePanel.classList.add('hidden');
      setStatusAlert(`Saved copy "${saved.title}" (${saved.messageCount} messages).`, 'success');
      showToast(els.toastContainer, 'Saved as new copy!', 'success');
      pendingExtraction = null;
      await loadLibraryState();
    } catch (err) {
      setStatusAlert(err.message, 'error');
    }
  });

  els.viewExistingBtn.addEventListener('click', () => {
    if (matchedExistingChat) {
      openChatDetails(matchedExistingChat.id);
    }
  });

  els.themeToggleBtn.addEventListener('click', async () => {
    const nextTheme = currentSettings?.theme === 'dark' ? 'light' : 'dark';
    currentSettings = await updateSettings({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  els.openDashboardBtn.addEventListener('click', () => openDashboard('all'));
  els.viewAllLink.addEventListener('click', () => openDashboard('all'));
  els.openSettingsBtn.addEventListener('click', () => openDashboard('settings'));

  document.querySelectorAll('.stat-chip[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => openDashboard(btn.getAttribute('data-nav')));
  });
}

function openDashboard(hash = 'all') {
  const url = chrome.runtime.getURL(`dashboard/history.html#${hash}`);
  chrome.tabs.create({ url });
}

function openChatDetails(chatId) {
  const url = chrome.runtime.getURL(`dashboard/details.html?id=${encodeURIComponent(chatId)}`);
  chrome.tabs.create({ url });
}

init();
