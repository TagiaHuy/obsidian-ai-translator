# Obsidian AI Translator

A powerful translation and dictionary plugin for Obsidian, powered by TaGiaHuy and community APIs. Translate words or phrases on the fly, manage multiple translation engines, and save definitions directly to your vault with custom templates.

## ✨ Features

### 🌍 Multiple Translation Engines
- **AI-Powered**: Supports **Google Gemini**, **OpenAI**, and **OpenRouter** (for specialized models).
- **Lightweight APIs**: **Google Translate** (via browser API) and **Free Dictionary API** for quick lookups without API keys.

### 🔍 Interactive Dictionary Popup
- **Draggable & Dismissible**: Move the popup anywhere on your screen or close it with a single click or the `Escape` key.
- **On-the-fly Switching**: Change translation providers directly within the popup via a dropdown menu.
- **Editable Content**: Refine or add your own notes to the AI-generated definition before saving.
- **Quick Save & Copy**: Save definitions to your vault using customizable templates or copy them to your clipboard.

### ⚡ Seamless Workflow
- **Auto-Trigger**: Optional mode to automatically show the dictionary popup whenever you select text.
- **Provider Loop**: Configure a custom subset of providers to cycle through quickly using a hotkey.
- **Inline Translation**: Replace selected text with its translation directly in your editor.

### 🛠️ Extensive Customization
- **Per-Provider Prompts**: Fully customize the system prompt for each AI engine to get the exact output format you want.
- **Flexible Templates**: Use placeholders like `{{word}}`, `{{definition}}`, `{{date}}`, and `{{alliases}}` to create beautiful definition notes.
- **Shared or Unique Templates**: Choose whether all providers share one save template or if each has its own.

---

## 🚀 Installation

### From Community Plugins (Coming Soon)
1. Open **Settings** > **Community plugins**.
2. Click **Browse** and search for `AI Translator`.
3. Click **Install**, then **Enable**.

### Manual Installation
1. Download the latest release (`main.js`, `styles.css`, `manifest.json`).
2. Create a folder named `obsidian-ai-translator` in your vault's plugin directory: `<vault>/.obsidian/plugins/obsidian-ai-translator/`.
3. Move the downloaded files into that folder.
4. Reload Obsidian and enable the plugin in **Settings** > **Community plugins**.

---

## ⚙️ Configuration

1. **API Keys**: Go to the plugin settings and enter your API keys for Gemini, OpenAI, or OpenRouter.
2. **Target Language**: Set your preferred language for translations (e.g., `Vietnamese`, `English`).
3. **Trigger Mode**:
   - `Auto`: Popup appears immediately on text selection.
   - `Manual`: Popup only appears when you run the command.
   - `Disabled`: Selection trigger is off.
4. **Save Folder**: Specify where you want your definition files to be stored.
5. **Provider Loop**: Check the engines you want to include in the "Cycle AI Provider" rotation.

---

## 📖 How to Use

### Dictionary Lookup
1. Select a word or phrase in your editor.
2. Depending on your **Trigger Mode**, the popup will appear automatically, or you can run the **"Show Dictionary Popup for Selection"** command.
3. Click the **Save** icon to create a note in your vault, or the **Copy** icon to copy the text.
4. Use the dropdown in the popup to try a different translation engine.

### Quick Actions
- **Cycle AI Provider**: Bind this to a hotkey (e.g., `Alt+P`) via Obsidian's Hotkey settings to flip between your favorite engines instantly. The active popup will refresh automatically when you cycle.
- **Translate Selection**: Run this command to replace the selected text with its translation (e.g., `Hello` -> `Hello (Xin chào)`).

### Save Templates
Customize your notes using these placeholders:
- `{{word}}`: The original selected text.
- `{{definition}}`: The translated result.
- `{{date}}`: Current date (`YYYY-MM-DD`).
- `{{time}}`: Current time (`HH:mm:ss`).
- `{{alliases}}`: Any aliases extracted from the definition (if supported by your prompt).

---

## 📄 License

This plugin is released under the [MIT License](LICENSE).
