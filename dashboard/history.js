import {
  applyBackupImport,
  exportFullBackup,
  parseAndValidateBackup,
  previewBackupImport
} from '../utils/backup.js';
import { exportChatAsMarkdown } from '../utils/export-markdown.js';
import { exportChatAsPdf } from '../utils/export-pdf.js';
import { exportChatAsTxt } from '../utils/export-txt.js';
import {
  FOLDER_COLORS,
  formatBytes,
  formatDate,
  formatFilenameFromTemplate,
  formatRelativeDate,
  getPlatformLabel,
  getSnippet,
  isRecentChat
} from '../utils/helpers.js';
import {
  addTagToChat,
  clearAllSavedData,
  createFolder,
  createTag,
  deleteChat,
  deleteFolder,
  deleteTag,
  getAllData,
  getStorageInfo,
  moveChatToFolder,
  removeTagFromChat,
  renameFolder,
  renameTag,
  toggleChatFavorite,
  UNFILED_FOLDER_ID,
  updateChatTitle,
  updateSettings
} from '../utils/storage.js';
import { applyTheme, filterAndSortChats, showToast } from '../utils/ui.js';

const state = {
  chats: [],
  folders: [],
  tags: [],
  settings: null,
  storageInfo: null,
  view: 'all', // 'all' | 'recent' | 'favorites' | 'folder' | 'tag' | 'folders' | 'tags' | 'settings'
  quickFilter: 'all',
  folderId: null,
  tagId: null,
  search: '',
  sort: 'newest',
  pendingBackup: null
};

const els = {
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  openSidebarBtn: document.getElementById('openSidebarBtn'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn'),
  navCountAll: document.getElementById('navCountAll'),
  navCountRecent: document.getElementById('navCountRecent'),
  navCountFav: document.getElementById('navCountFav'),
  navCountFolders: document.getElementById('navCountFolders'),
  navCountTags: document.getElementById('navCountTags'),
  sidebarFoldersList: document.getElementById('sidebarFoldersList'),
  sidebarTagsList: document.getElementById('sidebarTagsList'),
  sidebarNewFolderBtn: document.getElementById('sidebarNewFolderBtn'),
  sidebarNewTagBtn: document.getElementById('sidebarNewTagBtn'),
  sidebarStorageText: document.getElementById('sidebarStorageText'),
  sidebarStorageBar: document.getElementById('sidebarStorageBar'),
  viewTitle: document.getElementById('viewTitle'),
  viewSubtitle: document.getElementById('viewSubtitle'),
  searchWrap: document.getElementById('searchWrap'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  quickBackupBtn: document.getElementById('quickBackupBtn'),
  themeToggleBtn: document.getElementById('themeToggleBtn'),
  chatsToolbar: document.getElementById('chatsToolbar'),
  activeChipWrap: document.getElementById('activeChipWrap'),
  sortSelect: document.getElementById('sortSelect'),
  chatsView: document.getElementById('chatsView'),
  chatsGrid: document.getElementById('chatsGrid'),
  chatsEmptyState: document.getElementById('chatsEmptyState'),
  foldersView: document.getElementById('foldersView'),
  foldersManagerGrid: document.getElementById('foldersManagerGrid'),
  createFolderPageBtn: document.getElementById('createFolderPageBtn'),
  tagsView: document.getElementById('tagsView'),
  tagsManagerGrid: document.getElementById('tagsManagerGrid'),
  tagsEmptyState: document.getElementById('tagsEmptyState'),
  createTagPageBtn: document.getElementById('createTagPageBtn'),
  emptyNewTagBtn: document.getElementById('emptyNewTagBtn'),
  settingsView: document.getElementById('settingsView'),
  settingThemeSelect: document.getElementById('settingThemeSelect'),
  settingExportSelect: document.getElementById('settingExportSelect'),
  settingFilenameInput: document.getElementById('settingFilenameInput'),
  exportBackupBtn: document.getElementById('exportBackupBtn'),
  importBackupInput: document.getElementById('importBackupInput'),
  importPreviewBox: document.getElementById('importPreviewBox'),
  storageStatsGrid: document.getElementById('storageStatsGrid'),
  settingsStorageBar: document.getElementById('settingsStorageBar'),
  settingsStorageLabel: document.getElementById('settingsStorageLabel'),
  extensionVersion: document.getElementById('extensionVersion'),
  clearAllDataBtn: document.getElementById('clearAllDataBtn'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  modalTitle: document.getElementById('modalTitle'),
  modalBody: document.getElementById('modalBody'),
  modalFooter: document.getElementById('modalFooter'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  toastContainer: document.getElementById('toastContainer')
};

async function init() {
  applyHashRoute();
  await refreshData();
  bindEvents();

  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    els.extensionVersion.textContent = chrome.runtime.getManifest().version;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        refreshData();
      }
    });
  }

  window.addEventListener('hashchange', () => {
    applyHashRoute();
    render();
  });
}

function applyHashRoute() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (['all', 'recent', 'favorites', 'folders', 'tags', 'settings'].includes(hash)) {
    state.view = hash;
    if (hash !== 'folder') state.folderId = null;
    if (hash !== 'tag') state.tagId = null;
  }
}

async function refreshData() {
  const [data, storageInfo] = await Promise.all([getAllData(), getStorageInfo()]);
  state.chats = data.chats;
  state.folders = data.folders;
  state.tags = data.tags;
  state.settings = data.settings;
  state.storageInfo = storageInfo;
  applyTheme(state.settings.theme);
  render();
}

function render() {
  renderSidebar();
  renderHeaderAndToolbar();
  renderActiveView();
}

function renderSidebar() {
  const recentCount = state.chats.filter((c) => isRecentChat(c, 7)).length;
  const favCount = state.chats.filter((c) => c.favorite).length;

  els.navCountAll.textContent = String(state.chats.length);
  els.navCountRecent.textContent = String(recentCount);
  els.navCountFav.textContent = String(favCount);
  els.navCountFolders.textContent = String(state.folders.length);
  els.navCountTags.textContent = String(state.tags.length);

  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-view') === state.view);
  });

  // Folders list in sidebar
  els.sidebarFoldersList.textContent = '';
  const folderCounts = new Map();
  for (const chat of state.chats) {
    const fid = chat.folderId || UNFILED_FOLDER_ID;
    folderCounts.set(fid, (folderCounts.get(fid) || 0) + 1);
  }

  const allFolderItems = [
    { id: UNFILED_FOLDER_ID, name: 'Unfiled', color: '#94a3b8' },
    ...state.folders
  ];
  for (const fld of allFolderItems) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `nav-item${state.view === 'folder' && state.folderId === fld.id ? ' is-active' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'folder-dot';
    dot.style.background = fld.color || '#6366f1';

    const label = document.createElement('span');
    label.textContent = fld.name;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.whiteSpace = 'nowrap';

    const cnt = document.createElement('span');
    cnt.className = 'nav-count';
    cnt.textContent = String(folderCounts.get(fld.id) || 0);

    btn.append(dot, label, cnt);
    btn.addEventListener('click', () => {
      state.view = 'folder';
      state.folderId = fld.id;
      state.tagId = null;
      closeMobileSidebar();
      render();
    });
    els.sidebarFoldersList.appendChild(btn);
  }

  // Tags cloud in sidebar
  els.sidebarTagsList.textContent = '';
  if (state.tags.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted-desc';
    empty.style.fontSize = '11.5px';
    empty.textContent = 'No tags yet';
    els.sidebarTagsList.appendChild(empty);
  } else {
    for (const tag of state.tags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sidebar-tag-pill${state.view === 'tag' && state.tagId === tag.id ? ' is-active' : ''}`;
      btn.textContent = `#${tag.name}`;
      btn.addEventListener('click', () => {
        state.view = 'tag';
        state.tagId = tag.id;
        state.folderId = null;
        closeMobileSidebar();
        render();
      });
      els.sidebarTagsList.appendChild(btn);
    }
  }

  // Storage indicator
  if (state.storageInfo) {
    const pct = Math.min(100, (state.storageInfo.bytesInUse / state.storageInfo.quotaBytes) * 100);
    els.sidebarStorageText.textContent = formatBytes(state.storageInfo.bytesInUse);
    els.sidebarStorageBar.style.width = `${Math.max(pct, state.chats.length > 0 ? 2 : 0).toFixed(1)}%`;
  }
}

function renderHeaderAndToolbar() {
  const isChatListView = ['all', 'recent', 'favorites', 'folder', 'tag'].includes(state.view);
  els.chatsToolbar.classList.toggle('hidden', !isChatListView);
  els.searchWrap.classList.toggle('hidden', !isChatListView);

  if (state.view === 'folders') {
    els.viewTitle.textContent = 'Folders';
    els.viewSubtitle.textContent = `${state.folders.length} custom folders`;
  } else if (state.view === 'tags') {
    els.viewTitle.textContent = 'Tags';
    els.viewSubtitle.textContent = `${state.tags.length} tags`;
  } else if (state.view === 'settings') {
    els.viewTitle.textContent = 'Settings';
    els.viewSubtitle.textContent = 'Preferences, backups & local privacy';
  } else {
    let title = 'All Chats';
    if (state.view === 'recent') title = 'Recent Chats';
    else if (state.view === 'favorites') title = 'Favorites';
    else if (state.view === 'folder') {
      const fld = state.folders.find((f) => f.id === state.folderId);
      title = fld ? `Folder: ${fld.name}` : 'Folder: Unfiled';
    } else if (state.view === 'tag') {
      const tag = state.tags.find((t) => t.id === state.tagId);
      title = tag ? `Tag: #${tag.name}` : 'Tagged Chats';
    }
    els.viewTitle.textContent = title;
  }

  // Filter pills active state
  document.querySelectorAll('.filter-pill[data-filter]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-filter') === state.quickFilter);
  });

  // Active folder/tag chip clear button
  els.activeChipWrap.textContent = '';
  if (state.view === 'folder' && state.folderId) {
    const fld = state.folders.find((f) => f.id === state.folderId);
    const chip = createRemovableFilterChip(`Folder: ${fld ? fld.name : 'Unfiled'}`, () => {
      state.view = 'all';
      state.folderId = null;
      render();
    });
    els.activeChipWrap.appendChild(chip);
  }
  if (state.view === 'tag' && state.tagId) {
    const tag = state.tags.find((t) => t.id === state.tagId);
    const chip = createRemovableFilterChip(`#${tag ? tag.name : 'Tag'}`, () => {
      state.view = 'all';
      state.tagId = null;
      render();
    });
    els.activeChipWrap.appendChild(chip);
  }

  els.clearSearchBtn.classList.toggle('hidden', !state.search);
}

function createRemovableFilterChip(label, onClear) {
  const chip = document.createElement('span');
  chip.className = 'active-chip';
  const txt = document.createElement('span');
  txt.textContent = label;
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.title = 'Clear filter';
  x.addEventListener('click', onClear);
  chip.append(txt, x);
  return chip;
}

function renderActiveView() {
  const isChatListView = ['all', 'recent', 'favorites', 'folder', 'tag'].includes(state.view);
  els.chatsView.classList.toggle('hidden', !isChatListView);
  els.foldersView.classList.toggle('hidden', state.view !== 'folders');
  els.tagsView.classList.toggle('hidden', state.view !== 'tags');
  els.settingsView.classList.toggle('hidden', state.view !== 'settings');

  if (isChatListView) renderChatsView();
  else if (state.view === 'folders') renderFoldersManagerView();
  else if (state.view === 'tags') renderTagsManagerView();
  else if (state.view === 'settings') renderSettingsView();
}

function renderChatsView() {
  const results = filterAndSortChats(state.chats, state.folders, state.tags, {
    view: state.view,
    quickFilter: state.quickFilter,
    folderId: state.folderId,
    tagId: state.tagId,
    search: state.search,
    sort: state.sort
  });

  els.viewSubtitle.textContent = `${results.length} ${results.length === 1 ? 'conversation' : 'conversations'}`;
  els.chatsGrid.textContent = '';

  if (results.length === 0) {
    renderEmptyChatsState();
    return;
  }

  els.chatsEmptyState.classList.add('hidden');
  const folderMap = new Map(state.folders.map((f) => [f.id, f]));
  const tagMap = new Map(state.tags.map((t) => [t.id, t]));

  for (const chat of results) {
    const card = buildChatCard(chat, folderMap, tagMap);
    els.chatsGrid.appendChild(card);
  }
}

function buildChatCard(chat, folderMap, tagMap) {
  const card = document.createElement('article');
  card.className = 'chat-card';

  // Top badges + Favorite button
  const top = document.createElement('div');
  top.className = 'chat-card__top';

  const badges = document.createElement('div');
  badges.className = 'chat-card__badges';

  const platBadge = document.createElement('span');
  platBadge.className = `platform-badge platform-badge--${chat.platform}`;
  platBadge.textContent = getPlatformLabel(chat.platform);

  const folder = folderMap.get(chat.folderId);
  const folderBadge = document.createElement('span');
  folderBadge.className = 'folder-badge';
  const fDot = document.createElement('span');
  fDot.className = 'folder-dot';
  fDot.style.background = folder ? folder.color : '#94a3b8';
  const fLabel = document.createElement('span');
  fLabel.textContent = folder ? folder.name : 'Unfiled';
  folderBadge.append(fDot, fLabel);

  badges.append(platBadge, folderBadge);

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = `fav-btn${chat.favorite ? ' is-active' : ''}`;
  favBtn.title = chat.favorite ? 'Remove from Favorites' : 'Add to Favorites';
  favBtn.setAttribute('aria-label', favBtn.title);
  favBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="${chat.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
  favBtn.addEventListener('click', async () => {
    const updated = await toggleChatFavorite(chat.id);
    showToast(els.toastContainer, updated.favorite ? 'Added to favorites' : 'Removed from favorites', 'success');
  });

  top.append(badges, favBtn);

  // Title & Snippet
  const titleEl = document.createElement('h3');
  titleEl.className = 'chat-card__title';
  titleEl.textContent = chat.title || 'Untitled Conversation';
  titleEl.addEventListener('click', () => openDetailsPage(chat.id));

  const snippetEl = document.createElement('p');
  snippetEl.className = 'chat-card__snippet';
  snippetEl.textContent = getSnippet(chat, 160);

  // Tags row
  const tagsRow = document.createElement('div');
  tagsRow.className = 'chat-card__tags';
  for (const tid of chat.tags || []) {
    const tagObj = tagMap.get(tid);
    if (!tagObj) continue;
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const labelBtn = document.createElement('span');
    labelBtn.textContent = `#${tagObj.name}`;
    labelBtn.style.cursor = 'pointer';
    labelBtn.addEventListener('click', () => {
      state.view = 'tag';
      state.tagId = tagObj.id;
      render();
    });
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'tag-chip__remove';
    rmBtn.title = `Remove tag #${tagObj.name}`;
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', async () => {
      await removeTagFromChat(chat.id, tagObj.id);
      showToast(els.toastContainer, `Removed #${tagObj.name}`, 'info');
    });
    chip.append(labelBtn, rmBtn);
    tagsRow.appendChild(chip);
  }

  const addTagBtn = document.createElement('button');
  addTagBtn.type = 'button';
  addTagBtn.className = 'tag-add-btn';
  addTagBtn.textContent = '+ Tag';
  addTagBtn.addEventListener('click', () => openAddTagModal(chat));
  tagsRow.appendChild(addTagBtn);

  // Metadata line
  const metaRow = document.createElement('div');
  metaRow.className = 'chat-card__meta';
  const msgCountSpan = document.createElement('span');
  msgCountSpan.textContent = `${chat.messageCount || 0} messages`;
  const dateSpan = document.createElement('span');
  dateSpan.textContent = formatRelativeDate(chat.createdAt);
  dateSpan.title = `Saved: ${formatDate(chat.createdAt)}`;
  metaRow.append(msgCountSpan, dateSpan);

  // Quick Actions
  const actionsRow = document.createElement('div');
  actionsRow.className = 'chat-card__actions';

  const openBtn = makeActionBtn('Open Details', 'btn btn--primary btn--sm', () => openDetailsPage(chat.id));
  const exportBtn = makeActionBtn('Export', 'btn btn--secondary btn--sm', () => openExportModal(chat));
  const editTitleBtn = makeActionBtn('Edit Title', 'btn btn--secondary btn--sm', () => openEditTitleModal(chat));
  const moveBtn = makeActionBtn('Move to Folder', 'btn btn--secondary btn--sm', () => openMoveFolderModal(chat));
  const deleteBtn = makeActionBtn('Delete', 'btn btn--danger-soft btn--sm', () => openDeleteChatModal(chat));

  actionsRow.append(openBtn, exportBtn, editTitleBtn, moveBtn, deleteBtn);

  card.append(top, titleEl, snippetEl, tagsRow, metaRow, actionsRow);
  return card;
}

function makeActionBtn(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderEmptyChatsState() {
  els.chatsEmptyState.textContent = '';
  els.chatsEmptyState.classList.remove('hidden');

  const hasAnyChats = state.chats.length > 0;
  const iconWrap = document.createElement('div');
  iconWrap.className = 'empty-state__icon';
  iconWrap.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

  const h3 = document.createElement('h3');
  const p = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'empty-state__actions';

  if (!hasAnyChats) {
    h3.textContent = 'No saved conversations yet';
    p.textContent = 'Open any ChatGPT or Claude conversation, click the Chat Saver extension icon, and press "Save Current Chat". Or restore an existing JSON backup.';
    const goSettings = makeActionBtn('Restore JSON Backup', 'btn btn--secondary', () => {
      state.view = 'settings';
      window.location.hash = 'settings';
      render();
    });
    actions.appendChild(goSettings);
  } else if (state.view === 'favorites') {
    h3.textContent = 'No favorite conversations yet';
    p.textContent = 'Click the star icon on any saved conversation to pin it here for fast access.';
    actions.appendChild(makeActionBtn('Browse All Chats', 'btn btn--primary', () => {
      state.view = 'all';
      state.quickFilter = 'all';
      render();
    }));
  } else {
    h3.textContent = 'No conversations match your current filters';
    p.textContent = 'Try adjusting your search query, platform filter, folder, or tag selection.';
    actions.appendChild(makeActionBtn('Reset Search & Filters', 'btn btn--primary', () => {
      state.search = '';
      els.searchInput.value = '';
      state.quickFilter = 'all';
      state.view = 'all';
      state.folderId = null;
      state.tagId = null;
      render();
    }));
  }

  els.chatsEmptyState.append(iconWrap, h3, p, actions);
}

function renderFoldersManagerView() {
  els.foldersManagerGrid.textContent = '';

  const counts = new Map();
  for (const chat of state.chats) {
    const fid = chat.folderId || UNFILED_FOLDER_ID;
    counts.set(fid, (counts.get(fid) || 0) + 1);
  }

  // Unfiled system folder card
  const unfiledCard = document.createElement('div');
  unfiledCard.className = 'manager-card';
  unfiledCard.innerHTML = `
    <div class="manager-card__head">
      <div class="manager-card__name"><span class="folder-dot" style="background:#94a3b8"></span><span>Unfiled (Default)</span></div>
      <span class="manager-card__count">${counts.get(UNFILED_FOLDER_ID) || 0} chats</span>
    </div>
    <p class="muted-desc">Default destination for new or uncategorized chats.</p>
  `;
  const viewUnfiledBtn = makeActionBtn('View Chats', 'btn btn--secondary btn--sm', () => {
    state.view = 'folder';
    state.folderId = UNFILED_FOLDER_ID;
    render();
  });
  unfiledCard.appendChild(viewUnfiledBtn);
  els.foldersManagerGrid.appendChild(unfiledCard);

  for (const folder of state.folders) {
    const card = document.createElement('div');
    card.className = 'manager-card';

    const head = document.createElement('div');
    head.className = 'manager-card__head';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'manager-card__name';
    const dot = document.createElement('span');
    dot.className = 'folder-dot';
    dot.style.background = folder.color || '#6366f1';
    const nameTxt = document.createElement('span');
    nameTxt.textContent = folder.name;
    nameWrap.append(dot, nameTxt);

    const cnt = document.createElement('span');
    cnt.className = 'manager-card__count';
    cnt.textContent = `${counts.get(folder.id) || 0} chats`;

    head.append(nameWrap, cnt);

    const actions = document.createElement('div');
    actions.className = 'manager-card__actions';
    actions.append(
      makeActionBtn('Open', 'btn btn--secondary btn--sm', () => {
        state.view = 'folder';
        state.folderId = folder.id;
        render();
      }),
      makeActionBtn('Rename', 'btn btn--secondary btn--sm', () => openRenameFolderModal(folder)),
      makeActionBtn('Delete', 'btn btn--danger-soft btn--sm', () => openDeleteFolderModal(folder, counts.get(folder.id) || 0))
    );

    card.append(head, actions);
    els.foldersManagerGrid.appendChild(card);
  }
}

function renderTagsManagerView() {
  els.tagsManagerGrid.textContent = '';

  if (state.tags.length === 0) {
    els.tagsEmptyState.classList.remove('hidden');
    return;
  }
  els.tagsEmptyState.classList.add('hidden');

  const counts = new Map();
  for (const chat of state.chats) {
    for (const tid of chat.tags || []) {
      counts.set(tid, (counts.get(tid) || 0) + 1);
    }
  }

  for (const tag of state.tags) {
    const card = document.createElement('div');
    card.className = 'manager-card';

    const head = document.createElement('div');
    head.className = 'manager-card__head';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'manager-card__name';
    const dot = document.createElement('span');
    dot.className = 'folder-dot';
    dot.style.background = tag.color || '#4f46e5';
    const txt = document.createElement('span');
    txt.textContent = `#${tag.name}`;
    nameWrap.append(dot, txt);

    const cnt = document.createElement('span');
    cnt.className = 'manager-card__count';
    cnt.textContent = `${counts.get(tag.id) || 0} chats`;

    head.append(nameWrap, cnt);

    const actions = document.createElement('div');
    actions.className = 'manager-card__actions';
    actions.append(
      makeActionBtn('Filter Chats', 'btn btn--secondary btn--sm', () => {
        state.view = 'tag';
        state.tagId = tag.id;
        render();
      }),
      makeActionBtn('Rename', 'btn btn--secondary btn--sm', () => openRenameTagModal(tag)),
      makeActionBtn('Delete', 'btn btn--danger-soft btn--sm', () => openDeleteTagModal(tag))
    );

    card.append(head, actions);
    els.tagsManagerGrid.appendChild(card);
  }
}

function renderSettingsView() {
  if (!state.settings) return;
  els.settingThemeSelect.value = state.settings.theme || 'light';
  els.settingExportSelect.value = state.settings.defaultExportFormat || 'pdf';
  els.settingFilenameInput.value = state.settings.filenameTemplate || '{title}';

  if (state.storageInfo) {
    const info = state.storageInfo;
    els.storageStatsGrid.innerHTML = `
      <div class="storage-stat-box"><strong>${info.totalChats}</strong><span>Saved Chats</span></div>
      <div class="storage-stat-box"><strong>${info.totalMessages}</strong><span>Total Messages</span></div>
      <div class="storage-stat-box"><strong>${info.totalFolders}</strong><span>Custom Folders</span></div>
      <div class="storage-stat-box"><strong>${info.totalTags}</strong><span>Custom Tags</span></div>
    `;
    const pct = Math.min(100, (info.bytesInUse / info.quotaBytes) * 100);
    els.settingsStorageBar.style.width = `${Math.max(pct, info.totalChats > 0 ? 2 : 0).toFixed(1)}%`;
    els.settingsStorageLabel.textContent = `${formatBytes(info.bytesInUse)} used of ${formatBytes(info.quotaBytes)} local quota (${pct.toFixed(2)}%)`;
  }
}

// --- Modals ---

function openModal({ title, buildBody, footerButtons }) {
  els.modalTitle.textContent = title;
  els.modalBody.textContent = '';
  els.modalFooter.textContent = '';
  buildBody(els.modalBody);
  for (const btnSpec of footerButtons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = btnSpec.className || 'btn btn--secondary';
    btn.textContent = btnSpec.label;
    btn.addEventListener('click', () => btnSpec.onClick(btn));
    els.modalFooter.appendChild(btn);
  }
  els.modalBackdrop.classList.remove('hidden');
}

function closeModal() {
  els.modalBackdrop.classList.add('hidden');
}

function openExportModal(chat) {
  const defaultFmt = state.settings?.defaultExportFormat || 'pdf';
  let selectedFormat = defaultFmt;
  const folder = state.folders.find((f) => f.id === chat.folderId);
  const tagMap = new Map(state.tags.map((t) => [t.id, t.name]));
  const context = {
    folderName: folder ? folder.name : 'Unfiled',
    tagNames: (chat.tags || []).map((tid) => tagMap.get(tid)).filter(Boolean)
  };

  let filenameInput;
  const getInitialFilename = (fmt) => {
    const ext = fmt === 'markdown' ? '.md' : `.${fmt}`;
    return formatFilenameFromTemplate(state.settings?.filenameTemplate || '{title}', chat, ext);
  };

  openModal({
    title: 'Export Conversation',
    buildBody: (body) => {
      const formatField = document.createElement('div');
      formatField.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Select Export Format';
      const radioStack = document.createElement('div');
      radioStack.className = 'radio-stack';

      const formats = [
        { id: 'pdf', label: 'PDF Document (.pdf)', desc: 'Formatted multi-page document with code blocks' },
        { id: 'markdown', label: 'Markdown (.md)', desc: 'Clean headings, metadata & fenced code blocks' },
        { id: 'txt', label: 'Plain Text (.txt)', desc: 'Readable universal plain-text transcript' }
      ];

      formats.forEach((f) => {
        const opt = document.createElement('label');
        opt.className = 'radio-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'exportFormat';
        radio.value = f.id;
        radio.checked = f.id === selectedFormat;
        radio.addEventListener('change', () => {
          selectedFormat = f.id;
          if (filenameInput) {
            const currentBase = filenameInput.value.replace(/\.(pdf|md|txt)$/i, '');
            const ext = selectedFormat === 'markdown' ? '.md' : `.${selectedFormat}`;
            filenameInput.value = `${currentBase || 'conversation'}${ext}`;
          }
        });
        const txtWrap = document.createElement('div');
        txtWrap.innerHTML = `<strong>${f.label}</strong><div class="setting-row__desc">${f.desc}</div>`;
        opt.append(radio, txtWrap);
        radioStack.appendChild(opt);
      });
      formatField.append(lbl, radioStack);

      const fileField = document.createElement('div');
      fileField.className = 'form-field';
      const fLbl = document.createElement('label');
      fLbl.textContent = 'Custom Filename';
      filenameInput = document.createElement('input');
      filenameInput.type = 'text';
      filenameInput.className = 'text-input';
      filenameInput.value = getInitialFilename(selectedFormat);
      fileField.append(fLbl, filenameInput);

      body.append(formatField, fileField);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Download Export',
        className: 'btn btn--primary',
        onClick: async (btn) => {
          const customFilename = filenameInput.value.trim();
          btn.disabled = true;
          btn.textContent = 'Generating…';
          try {
            if (selectedFormat === 'pdf') {
              const res = await exportChatAsPdf(chat, { context, customFilename });
              showToast(els.toastContainer, `Exported ${res.filename} (${res.pageCount} pages)`, 'success');
            } else if (selectedFormat === 'markdown') {
              const res = exportChatAsMarkdown(chat, { context, customFilename });
              showToast(els.toastContainer, `Exported ${res.filename}`, 'success');
            } else {
              const res = exportChatAsTxt(chat, { context, customFilename });
              showToast(els.toastContainer, `Exported ${res.filename}`, 'success');
            }
            closeModal();
          } catch (err) {
            showToast(els.toastContainer, `Export failed: ${err.message}`, 'error');
            btn.disabled = false;
            btn.textContent = 'Download Export';
          }
        }
      }
    ]
  });
}

function openEditTitleModal(chat) {
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
      input.value = chat.title || '';
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
            await updateChatTitle(chat.id, input.value);
            closeModal();
            showToast(els.toastContainer, 'Title updated', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openMoveFolderModal(chat) {
  let select;
  openModal({
    title: 'Move to Folder',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = `Destination folder for "${chat.title}"`;
      select = document.createElement('select');
      select.className = 'select-input';
      const unfiled = document.createElement('option');
      unfiled.value = UNFILED_FOLDER_ID;
      unfiled.textContent = 'Unfiled';
      select.appendChild(unfiled);
      for (const fld of state.folders) {
        const opt = document.createElement('option');
        opt.value = fld.id;
        opt.textContent = fld.name;
        select.appendChild(opt);
      }
      select.value = chat.folderId || UNFILED_FOLDER_ID;
      field.append(lbl, select);
      body.appendChild(field);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Move Conversation',
        className: 'btn btn--primary',
        onClick: async () => {
          await moveChatToFolder(chat.id, select.value);
          closeModal();
          showToast(els.toastContainer, 'Conversation moved', 'success');
        }
      }
    ]
  });
}

function openAddTagModal(chat) {
  let input;
  openModal({
    title: 'Add Tags to Conversation',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Enter a new or existing tag name';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.placeholder = 'e.g. architecture, python, prompts';
      field.append(lbl, input);
      body.appendChild(field);

      if (state.tags.length > 0) {
        const quickLabel = document.createElement('div');
        quickLabel.className = 'setting-row__desc';
        quickLabel.textContent = 'Click an existing tag to toggle:';
        const wrap = document.createElement('div');
        wrap.className = 'chat-card__tags';
        for (const t of state.tags) {
          const already = (chat.tags || []).includes(t.id);
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = `sidebar-tag-pill${already ? ' is-active' : ''}`;
          pill.textContent = `${already ? '✓ ' : '+ '}#${t.name}`;
          pill.addEventListener('click', async () => {
            if (already) {
              await removeTagFromChat(chat.id, t.id);
              showToast(els.toastContainer, `Removed #${t.name}`, 'info');
            } else {
              await addTagToChat(chat.id, t.id);
              showToast(els.toastContainer, `Added #${t.name}`, 'success');
            }
            closeModal();
          });
          wrap.appendChild(pill);
        }
        body.append(quickLabel, wrap);
      }
      setTimeout(() => input.focus(), 30);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Add Tag',
        className: 'btn btn--primary',
        onClick: async () => {
          try {
            await addTagToChat(chat.id, input.value);
            closeModal();
            showToast(els.toastContainer, 'Tag added', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openDeleteChatModal(chat) {
  openModal({
    title: 'Delete Conversation',
    buildBody: (body) => {
      const p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = `Are you sure you want to permanently delete "${chat.title}"? This action cannot be undone.`;
      body.appendChild(p);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Delete Forever',
        className: 'btn btn--danger',
        onClick: async () => {
          await deleteChat(chat.id);
          closeModal();
          showToast(els.toastContainer, 'Conversation deleted', 'success');
        }
      }
    ]
  });
}

function openCreateFolderModal() {
  let input;
  let chosenColor = FOLDER_COLORS[state.folders.length % FOLDER_COLORS.length];

  openModal({
    title: 'Create New Folder',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Folder Name';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.placeholder = 'e.g. Work Projects';
      field.append(lbl, input);

      const colorField = document.createElement('div');
      colorField.className = 'form-field';
      const clbl = document.createElement('label');
      clbl.textContent = 'Accent Color';
      const swatches = document.createElement('div');
      swatches.className = 'color-swatches';
      FOLDER_COLORS.forEach((c) => {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = `color-swatch${c === chosenColor ? ' is-selected' : ''}`;
        sw.style.background = c;
        sw.addEventListener('click', () => {
          chosenColor = c;
          swatches.querySelectorAll('.color-swatch').forEach((n) => n.classList.remove('is-selected'));
          sw.classList.add('is-selected');
        });
        swatches.appendChild(sw);
      });
      colorField.append(clbl, swatches);

      body.append(field, colorField);
      setTimeout(() => input.focus(), 30);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Create Folder',
        className: 'btn btn--primary',
        onClick: async () => {
          try {
            await createFolder(input.value, chosenColor);
            closeModal();
            showToast(els.toastContainer, 'Folder created', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openRenameFolderModal(folder) {
  let input;
  openModal({
    title: 'Rename Folder',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Folder Name';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.value = folder.name;
      field.append(lbl, input);
      body.appendChild(field);
      setTimeout(() => input.focus(), 30);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Save Name',
        className: 'btn btn--primary',
        onClick: async () => {
          try {
            await renameFolder(folder.id, input.value);
            closeModal();
            showToast(els.toastContainer, 'Folder renamed', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openDeleteFolderModal(folder, chatCount) {
  openModal({
    title: 'Delete Folder',
    buildBody: (body) => {
      const p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = chatCount > 0
        ? `Delete folder "${folder.name}"? Its ${chatCount} conversation(s) will NOT be deleted — they will be safely moved to "Unfiled".`
        : `Delete empty folder "${folder.name}"?`;
      body.appendChild(p);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Delete Folder',
        className: 'btn btn--danger',
        onClick: async () => {
          const res = await deleteFolder(folder.id);
          if (state.folderId === folder.id) {
            state.view = 'folders';
            state.folderId = null;
          }
          closeModal();
          showToast(
            els.toastContainer,
            res.movedCount > 0
              ? `Folder deleted (${res.movedCount} moved to Unfiled)`
              : 'Folder deleted',
            'success'
          );
        }
      }
    ]
  });
}

function openCreateTagModal() {
  let input;
  openModal({
    title: 'Create New Tag',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Tag Name';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.placeholder = 'e.g. debugging';
      field.append(lbl, input);
      body.appendChild(field);
      setTimeout(() => input.focus(), 30);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Create Tag',
        className: 'btn btn--primary',
        onClick: async () => {
          try {
            await createTag(input.value);
            closeModal();
            showToast(els.toastContainer, 'Tag created', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openRenameTagModal(tag) {
  let input;
  openModal({
    title: 'Rename Tag',
    buildBody: (body) => {
      const field = document.createElement('div');
      field.className = 'form-field';
      const lbl = document.createElement('label');
      lbl.textContent = 'Tag Name';
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'text-input';
      input.value = tag.name;
      field.append(lbl, input);
      body.appendChild(field);
      setTimeout(() => input.focus(), 30);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Save Name',
        className: 'btn btn--primary',
        onClick: async () => {
          try {
            await renameTag(tag.id, input.value);
            closeModal();
            showToast(els.toastContainer, 'Tag renamed', 'success');
          } catch (err) {
            showToast(els.toastContainer, err.message, 'error');
          }
        }
      }
    ]
  });
}

function openDeleteTagModal(tag) {
  openModal({
    title: 'Delete Tag',
    buildBody: (body) => {
      const p = document.createElement('p');
      p.style.margin = '0';
      p.textContent = `Delete tag "#${tag.name}"? Conversations will remain saved, and this tag will be removed from them.`;
      body.appendChild(p);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Delete Tag',
        className: 'btn btn--danger',
        onClick: async () => {
          await deleteTag(tag.id);
          if (state.tagId === tag.id) {
            state.view = 'tags';
            state.tagId = null;
          }
          closeModal();
          showToast(els.toastContainer, 'Tag deleted', 'success');
        }
      }
    ]
  });
}

function openClearAllConfirmModal() {
  openModal({
    title: 'Clear All Saved Data',
    buildBody: (body) => {
      const p = document.createElement('p');
      p.style.margin = '0';
      p.innerHTML = `This will permanently delete <strong>${state.chats.length} conversation(s)</strong>, <strong>${state.folders.length} folder(s)</strong>, and <strong>${state.tags.length} tag(s)</strong> from local storage. Your theme and export settings will be kept.`;
      body.appendChild(p);
    },
    footerButtons: [
      { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
      {
        label: 'Yes, Clear Everything',
        className: 'btn btn--danger',
        onClick: async () => {
          await clearAllSavedData();
          closeModal();
          showToast(els.toastContainer, 'All saved data cleared', 'success');
        }
      }
    ]
  });
}

// --- Backup Import Handler ---

async function handleBackupFileSelection(file) {
  if (!file) return;
  els.importPreviewBox.classList.add('hidden');
  els.importPreviewBox.textContent = '';

  try {
    const text = await file.text();
    const validated = parseAndValidateBackup(text);
    const preview = await previewBackupImport(validated);
    state.pendingBackup = validated;

    els.importPreviewBox.innerHTML = `
      <div><strong>Backup Ready:</strong> ${preview.incomingChatsCount} chat(s), ${validated.folders.length} folder(s), ${validated.tags.length} tag(s).</div>
      <div>• New chats to add (Merge): <strong>${preview.newChats}</strong></div>
      <div>• Duplicates skipped automatically: <strong>${preview.duplicateChats}</strong></div>
      <div class="backup-actions">
        <button id="confirmMergeBtn" class="btn btn--primary btn--sm" type="button">Merge Safely (Keep Existing)</button>
        <button id="confirmReplaceBtn" class="btn btn--danger-soft btn--sm" type="button">Replace Existing Data…</button>
        <button id="cancelImportBtn" class="btn btn--ghost btn--sm" type="button">Cancel</button>
      </div>
    `;
    els.importPreviewBox.classList.remove('hidden');

    document.getElementById('confirmMergeBtn').addEventListener('click', async () => {
      const res = await applyBackupImport(state.pendingBackup, 'merge');
      state.pendingBackup = null;
      els.importPreviewBox.classList.add('hidden');
      showToast(
        els.toastContainer,
        `Imported ${res.addedChats} chat(s), skipped ${res.skippedDuplicates} duplicate(s).`,
        'success'
      );
    });

    document.getElementById('confirmReplaceBtn').addEventListener('click', () => {
      openModal({
        title: 'Confirm Overwrite Existing Data',
        buildBody: (body) => {
          const p = document.createElement('p');
          p.style.margin = '0';
          p.textContent = `Replacing will overwrite your current ${state.chats.length} saved chat(s) with the ${state.pendingBackup.chats.length} chat(s) from this backup. Continue?`;
          body.appendChild(p);
        },
        footerButtons: [
          { label: 'Cancel', className: 'btn btn--ghost', onClick: closeModal },
          {
            label: 'Overwrite & Restore',
            className: 'btn btn--danger',
            onClick: async () => {
              const res = await applyBackupImport(state.pendingBackup, 'replace');
              state.pendingBackup = null;
              els.importPreviewBox.classList.add('hidden');
              closeModal();
              showToast(els.toastContainer, `Restored ${res.addedChats} chat(s) from backup.`, 'success');
            }
          }
        ]
      });
    });

    document.getElementById('cancelImportBtn').addEventListener('click', () => {
      state.pendingBackup = null;
      els.importPreviewBox.classList.add('hidden');
    });
  } catch (err) {
    showToast(els.toastContainer, `Import failed: ${err.message}`, 'error', 5000);
  } finally {
    els.importBackupInput.value = '';
  }
}

function openDetailsPage(chatId) {
  window.location.href = `details.html?id=${encodeURIComponent(chatId)}`;
}

function closeMobileSidebar() {
  els.sidebar.classList.remove('is-open');
  els.sidebarBackdrop.classList.add('hidden');
}

function bindEvents() {
  // Primary sidebar nav
  document.querySelectorAll('.nav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      state.view = view;
      state.folderId = null;
      state.tagId = null;
      window.location.hash = view;
      closeMobileSidebar();
      render();
    });
  });

  // Mobile drawer
  els.openSidebarBtn.addEventListener('click', () => {
    els.sidebar.classList.add('is-open');
    els.sidebarBackdrop.classList.remove('hidden');
  });
  els.closeSidebarBtn.addEventListener('click', closeMobileSidebar);
  els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Search & shortcut
  els.searchInput.addEventListener('input', (ev) => {
    state.search = ev.target.value;
    renderHeaderAndToolbar();
    if (['all', 'recent', 'favorites', 'folder', 'tag'].includes(state.view)) {
      renderChatsView();
    }
  });
  els.clearSearchBtn.addEventListener('click', () => {
    state.search = '';
    els.searchInput.value = '';
    renderHeaderAndToolbar();
    renderChatsView();
  });

  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      els.searchInput.focus();
    } else if (ev.key === 'Escape' && !els.modalBackdrop.classList.contains('hidden')) {
      closeModal();
    }
  });

  // Filter pills & Sort
  document.querySelectorAll('.filter-pill[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.quickFilter = btn.getAttribute('data-filter');
      renderHeaderAndToolbar();
      renderChatsView();
    });
  });

  els.sortSelect.addEventListener('change', (ev) => {
    state.sort = ev.target.value;
    renderChatsView();
  });

  // Theme toggle
  els.themeToggleBtn.addEventListener('click', async () => {
    const nextTheme = state.settings?.theme === 'dark' ? 'light' : 'dark';
    state.settings = await updateSettings({ theme: nextTheme });
    applyTheme(nextTheme);
  });

  // Quick backup
  els.quickBackupBtn.addEventListener('click', async () => {
    const res = await exportFullBackup();
    showToast(els.toastContainer, `Saved backup ${res.filename}`, 'success');
  });

  // Folder & Tag creators
  els.sidebarNewFolderBtn.addEventListener('click', openCreateFolderModal);
  els.createFolderPageBtn.addEventListener('click', openCreateFolderModal);
  els.sidebarNewTagBtn.addEventListener('click', openCreateTagModal);
  els.createTagPageBtn.addEventListener('click', openCreateTagModal);
  els.emptyNewTagBtn.addEventListener('click', openCreateTagModal);

  // Settings controls
  els.settingThemeSelect.addEventListener('change', async (ev) => {
    state.settings = await updateSettings({ theme: ev.target.value });
    applyTheme(ev.target.value);
    showToast(els.toastContainer, 'Theme updated', 'success');
  });

  els.settingExportSelect.addEventListener('change', async (ev) => {
    state.settings = await updateSettings({ defaultExportFormat: ev.target.value });
    showToast(els.toastContainer, 'Default export format updated', 'success');
  });

  els.settingFilenameInput.addEventListener('change', async (ev) => {
    const val = ev.target.value.trim() || '{title}';
    state.settings = await updateSettings({ filenameTemplate: val });
    showToast(els.toastContainer, 'Filename pattern saved', 'success');
  });

  els.exportBackupBtn.addEventListener('click', async () => {
    const res = await exportFullBackup();
    showToast(els.toastContainer, `Exported ${res.filename} (${res.stats.chats} chats)`, 'success');
  });

  els.importBackupInput.addEventListener('change', (ev) => {
    handleBackupFileSelection(ev.target.files?.[0]);
  });

  els.clearAllDataBtn.addEventListener('click', openClearAllConfirmModal);

  // Modal close
  els.modalCloseBtn.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', (ev) => {
    if (ev.target === els.modalBackdrop) closeModal();
  });
}

init();
