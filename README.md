# Chat Saver – Advanced Edition

> **"Your AI Conversations, Organized Forever."**

A privacy-first, 100% local Chrome Extension (Manifest V3) that lets you save, organize, search, manage, and export your AI conversations from **ChatGPT** and **Claude** directly inside your browser — with zero servers, zero subscriptions, zero tracking, and zero external dependencies.

---

## Key Features

- **One-Click Capture**: Save conversations from **ChatGPT** (`chatgpt.com`, `chat.openai.com`) and **Claude** (`claude.ai`) strictly when you click **Save Current Chat**.
- **Duplicate Protection & Smart Updates**: Prevents accidental duplicate saves by tracking canonical conversation URLs and content hashes, and lets you update an existing saved conversation when new messages arrive or explicitly save a snapshot copy.
- **Full-Page Productivity Dashboard**: Linear/Notion-inspired workspace with **All Chats**, **Recent Chats**, **Favorites**, **Folders**, **Tags**, and **Settings**.
- **Search & Multi-Faceted Filtering**: Instantly search across titles, full message content, platforms, folders, and tags (`Ctrl+K` shortcut), filter by `All`, `ChatGPT`, `Claude`, `Favorites`, or `Recent`, and sort by `Newest First`, `Oldest First`, `Alphabetical`, or `Recently Updated`.
- **Folders & Custom Tags**: Create, rename, and delete folders (deleting a folder safely reassigns its conversations to **Unfiled**), create custom tags, assign multiple tags per conversation, and filter by tag.
- **Three Local Export Formats (with Custom Filename Support)**:
  - **PDF (`.pdf`)**: Multi-page formatted document generated locally using bundled `jsPDF` and DejaVu Unicode fonts (`DejaVuSans`, `DejaVuSans-Bold`, `DejaVuSansMono`), preserving Unicode text, margins, role badges, and wrapped code blocks.
  - **Markdown (`.md`)**: Clean structured headings, metadata block, fenced code blocks, lists, tables, and blockquotes.
  - **Plain Text (`.txt`)**: Clean, universally readable transcript with clear User and Assistant dividers.
- **JSON Backup & Restore**: Export all chats, folders, tags, and preferences to a versioned JSON file. Importing validates JSON structure strictly, previews counts before committing, merges safely without duplicates, and requires explicit confirmation before overwriting existing data.
- **Light & Dark Theme**: Seamless Light and Dark theme toggle synchronized across the popup, dashboard, and details views.

---

## Technology Stack

- **HTML5 & CSS3** (custom CSS variables, responsive layouts, Light/Dark themes)
- **Vanilla JavaScript (ES Modules)** (no React, no build pipeline, zero remote code)
- **Chrome Extension Manifest V3** (`storage`, `activeTab`, `scripting` permissions only)
- **Locally Bundled Libraries**:
  - `jsPDF` (`lib/jspdf.umd.min.js`)
  - `DejaVu Sans` & `DejaVu Sans Mono` Open-Source TrueType Fonts (`lib/fonts/`)

---

## Project Structure

```text
chat-saver/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── content/
│   ├── chatgpt.js
│   └── claude.js
├── dashboard/
│   ├── history.html
│   ├── history.css
│   ├── history.js
│   ├── details.html
│   ├── details.css
│   └── details.js
├── utils/
│   ├── storage.js
│   ├── export-pdf.js
│   ├── export-markdown.js
│   ├── export-txt.js
│   ├── backup.js
│   ├── helpers.js
│   └── ui.js
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
├── lib/
│   ├── jspdf.umd.min.js
│   ├── jspdf-LICENSE.txt
│   └── fonts/
│       ├── DejaVuSans.ttf
│       ├── DejaVuSans-Bold.ttf
│       ├── DejaVuSansMono.ttf
│       └── LICENSE.txt
└── README.md
```

---

## Installation & Loading in Chrome

1. Download or clone this repository to your computer (e.g., `chat-saver/`).
2. Open Google Chrome (or Microsoft Edge / Chromium) and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the `chat-saver` folder containing `manifest.json`.
6. Pin **Chat Saver – Advanced Edition** to your Chrome toolbar for one-click access.

---

## How to Save Conversations

### Saving a ChatGPT Conversation
1. Open [chatgpt.com](https://chatgpt.com) (or `chat.openai.com`) and open an existing or active conversation.
2. Wait for the assistant's response to finish streaming.
3. Click the **Chat Saver** toolbar icon.
4. Optionally choose a destination **Folder** and add comma-separated **Tags**.
5. Click **Save Current Chat**.
6. If the conversation was previously saved, choose **Update Existing** (when new messages were added) or **Save as Copy**.

### Saving a Claude Conversation
1. Open [claude.ai](https://claude.ai) and navigate to any conversation thread.
2. Click the **Chat Saver** toolbar icon.
3. Select a **Folder** or enter quick **Tags** if desired.
4. Click **Save Current Chat**.

---

## How to Export Conversations

1. Open the **Dashboard** from the extension popup (**Dashboard ↗**) or click **Open Details** on any conversation.
2. In the **Dashboard**, click **Export** on any conversation card, choose **PDF**, **Markdown**, or **TXT**, optionally customize the filename, and click **Download Export**.
3. In the **Chat Details** view, edit the optional **File** field in the top toolbar and click **Export PDF**, **Export Markdown**, or **Export TXT**.

---

## How to Create & Restore Backups

1. Open the **Dashboard** and navigate to **Settings** (or click **Backup JSON** in the top bar).
2. Under **Backup & Restore**, click **Export Full JSON Backup** to download a `.json` archive of all conversations, folders, tags, and settings.
3. To restore, click **Import JSON Backup**, select a `.json` backup file, review the validation preview (new chats vs. automatically skipped duplicates), and choose either:
   - **Merge Safely (Keep Existing)** — adds new records without deleting or duplicating current chats.
   - **Replace Existing Data…** — asks for explicit confirmation before overwriting existing storage.

---

## Privacy & Security

- **Zero External Network Calls**: The extension never sends conversations, metadata, or telemetry to any remote server.
- **Minimal Permissions**: Requests only `storage`, `activeTab`, `scripting`, and scoped host permissions for `chatgpt.com`, `chat.openai.com`, and `claude.ai`.
- **No Credential or Cookie Harvesting**: Never accesses passwords, cookies, session tokens, or hidden APIs.
- **Explicit User Trigger**: Content extraction runs only when you explicitly click **Save Current Chat**.
- **Strict Local Storage**: All records persist locally in `chrome.storage.local` across browser restarts.

---

## Known Limitations

- **Web DOM Dependency**: ChatGPT and Claude are third-party single-page applications whose DOM classes and `data-testid` attributes may evolve over time. Both `content/chatgpt.js` and `content/claude.js` implement multi-strategy fallback selectors and clean error reporting, though live DOM verification against logged-in ChatGPT/Claude accounts should be performed when testing updates.
- **Very Long / Virtualized Threads**: If a platform uses virtual scrolling or lazy-collapsed branches on extremely long threads, only messages currently mounted in the DOM can be captured.
- **Astral Emojis in PDF**: Built-in DejaVu Unicode TTF fonts cover extensive Unicode scripts (Latin, Extended Latin, Greek, Cyrillic, Math operators, Arrows, Currency, Dingbats). Astral-plane emojis (`> U+FFFF`) not mapped to BMP symbols are stripped cleanly during PDF generation to prevent glyph corruption, while Markdown and TXT exports retain every UTF-8 emoji verbatim.
- **Chrome Local Storage Quota**: `chrome.storage.local` defaults to ~10 MB in Manifest V3 (sufficient for thousands of text conversations). Use **Settings → Storage Information** and JSON backups to manage space.

---

## Future Improvements

- Optional conversation diff viewer when updating an existing saved chat.
- Support for additional AI platforms (e.g., Gemini, Perplexity) via dedicated content scripts.
- Batch multi-select export (export an entire folder as a ZIP or combined Markdown).
- Keyboard-driven command palette inside the Dashboard.
