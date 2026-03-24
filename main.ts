import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, requestUrl, Setting, setIcon, setTooltip, Platform } from 'obsidian';
import { generateRequestUrl, createRequestBody, normaliseResponse } from 'google-translate-api-browser';

interface AITranslatorSettings {
	provider: 'gemini' | 'openai' | 'openrouter' | 'google' | 'free-dictionary';
	geminiApiKey: string;
	openaiApiKey: string;
	openRouterApiKey: string;
	geminiModel: string;
	openaiModel: string;
	openRouterModel: string;
	targetLanguage: string;
	triggerMode: 'auto' | 'manual' | 'disabled';
	providerPrompts: Record<string, string>;
	providerSaveTemplates: Record<string, string>;
	saveFolder: string;
	useSharedTemplate: boolean;
	sharedSaveTemplate: string;
	providerLoop: string[];
}

const DEFAULT_SETTINGS: AITranslatorSettings = {
	provider: 'gemini',
	geminiApiKey: '',
	openaiApiKey: '',
	openRouterApiKey: '',
	geminiModel: 'gemini-1.5-pro',
	openaiModel: 'gpt-4o',
	openRouterModel: 'meta-llama/llama-3-8b-instruct',
	targetLanguage: 'Vietnamese',
	triggerMode: 'auto',
	providerPrompts: {
		'gemini': "Analyze the following text. If it is a single word or short phrase, provide its definition, a list of synonyms, and some aliases. If it is a longer text/paragraph, provide a direct translation and a brief explanation. Respond entirely in {{targetLanguage}}. Format the response in concise Markdown. At the VERY end of your response, include a line: 'Aliases: [comma separated aliases]'.\n\nText: {{text}}",
		'openai': "Analyze the following text. If it is a single word or short phrase, provide its definition, a list of synonyms, and some aliases. If it is a longer text/paragraph, provide a direct translation and a brief explanation. Respond entirely in {{targetLanguage}}. Format the response in concise Markdown. At the VERY end of your response, include a line: 'Aliases: [comma separated aliases]'.\n\nText: {{text}}",
		'openrouter': "Analyze the following text. If it is a single word or short phrase, provide its definition, a list of synonyms, and some aliases. If it is a longer text/paragraph, provide a direct translation and a brief explanation. Respond entirely in {{targetLanguage}}. Format the response in concise Markdown. At the VERY end of your response, include a line: 'Aliases: [comma separated aliases]'.\n\nText: {{text}}",
		'google': "Translate: {{text}}",
		'free-dictionary': "Dictionary lookup: {{text}}"
	},
	providerSaveTemplates: {
		'gemini': "---\naliases: [{{aliases}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*",
		'openai': "---\naliases: [{{aliases}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*",
		'openrouter': "---\naliases: [{{aliases}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*",
		'google': "---\naliases: [{{word}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*",
		'free-dictionary': "---\naliases: [{{aliases}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*"
	},
	saveFolder: 'AI-Definitions',
	useSharedTemplate: false,
	sharedSaveTemplate: "---\naliases: [{{aliases}}]\n---\n# {{word}}\n\n{{definition}}\n\n*Saved on: {{date}} {{time}}*",
	providerLoop: ['gemini', 'openai', 'openrouter', 'google', 'free-dictionary']
}

import { Extension, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export default class AITranslatorPlugin extends Plugin {
	settings: AITranslatorSettings;
	refreshActivePopup: ((provider: string) => Promise<void>) | null = null;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'translate-selected-text-replace',
			name: 'Translate Selected Text (Replace)',
			icon: 'languages',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (!selectedText) {
					new Notice('Please select a word or phrase to translate.');
					return;
				}

				new Notice(`Translating using ${this.settings.provider}...`);
				
				try {
					const translation = await this.translateText(selectedText);
					if (translation) {
						editor.replaceSelection(translation);
						new Notice('Translation complete.');
					} else {
						new Notice('Failed to get translation.');
					}
				} catch (error: any) {
					console.error('Translation error:', error);
					new Notice(`Translation error: ${error.message || error}`);
				}
			}
		});

        this.addCommand({
			id: 'translate-selected-text-append',
			name: 'Translate Selected Text (Append in parentheses)',
			icon: 'plus-circle',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (!selectedText) {
					new Notice('Please select a word or phrase to translate.');
					return;
				}

				new Notice(`Translating using ${this.settings.provider}...`);
				
				try {
					const translation = await this.translateText(selectedText);
					if (translation) {
						editor.replaceSelection(`${selectedText} (${translation})`);
						new Notice('Translation complete.');
					} else {
						new Notice('Failed to get translation.');
					}
				} catch (error: any) {
					console.error('Translation error:', error);
					new Notice(`Translation error: ${error.message || error}`);
				}
			}
		});

		this.addCommand({
			id: 'show-dictionary-popup',
			name: 'Show Dictionary Popup for Selection',
			icon: 'book',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				if (!selectedText) {
					new Notice('Please select text first.');
					return;
				}
				
				if (this.settings.triggerMode !== 'disabled') {
						await this.showPopup(selectedText);
				}
			}
		});

		this.addSettingTab(new AITranslatorSettingTab(this.app, this));

		this.addCommand({
			id: 'cycle-ai-provider',
			name: 'Cycle AI Provider',
			icon: 'refresh-ccw',
			callback: async () => {
				const allProviders: Array<'gemini' | 'openai' | 'openrouter' | 'google' | 'free-dictionary'> = ['gemini', 'openai', 'openrouter', 'google', 'free-dictionary'];
				const loop = this.settings.providerLoop && this.settings.providerLoop.length > 0 
					? this.settings.providerLoop 
					: allProviders;
				
				// @ts-ignore
				let currentIndex = loop.indexOf(this.settings.provider);
				let nextIndex = (currentIndex + 1) % loop.length;
				
				// @ts-ignore
				this.settings.provider = loop[nextIndex];
				await this.saveSettings();
				new Notice(`Provider switched to: ${this.settings.provider}`);

				if (this.refreshActivePopup) {
					await this.refreshActivePopup(this.settings.provider);
				}
			}
		});

		this.registerEditorExtension(this.getEditorExtension());

		// Support Reading Mode
		this.registerDomEvent(document, 'mouseup', (evt: MouseEvent) => {
			this.handleGlobalSelection(evt);
		});

		this.registerDomEvent(document, 'touchend', (evt: TouchEvent) => {
			this.handleGlobalSelection(evt);
		});
	}

	private handleGlobalSelection(evt: Event) {
		// Small delay to let selection stabilize
		setTimeout(() => {
			const selection = window.getSelection();
			const text = selection?.toString().trim();
			
			if (text && text.length > 0) {
				// Don't trigger if we are in an editor (EditorExtension handles that)
				// or if the click was inside the popup
				if (this.popupEl?.contains(evt.target as Node)) return;
				
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView && activeView.getMode() === 'preview') {
					if (this.settings.triggerMode === 'auto') {
						this.handleSelection(text);
					}
				}
			} else {
				// Only remove if we didn't click the popup
				if (!this.popupEl?.contains(evt.target as Node)) {
					this.removePopup();
				}
			}
		}, 50);
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

    async translateText(text: string): Promise<string> {
		const promptTemplate = this.settings.providerPrompts[this.settings.provider] || DEFAULT_SETTINGS.providerPrompts[this.settings.provider];
        const prompt = promptTemplate
			.replace('{{targetLanguage}}', this.settings.targetLanguage)
			.replace('{{text}}', text);
        
        switch (this.settings.provider) {
            case 'gemini':
                return await this.callGemini(prompt);
            case 'openai':
                return await this.callOpenAI(prompt);
            case 'openrouter':
                return await this.callOpenRouter(prompt);
            case 'google':
                return await this.callGoogleTranslate(text);
			case 'free-dictionary':
				return await this.callFreeDictionary(text);
            default:
                throw new Error("Invalid provider");
        }
    }

	async callFreeDictionary(text: string): Promise<string> {
		try {
			const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.trim())}`;
			const response = await requestUrl({ url });

			if (response.status === 404) {
				return "No definition found.";
			}

			if (response.status !== 200) {
				throw new Error(`Free Dictionary API Error ${response.status}: ${response.text}`);
			}

			const data = response.json;
			if (!data || data.length === 0) return "No definition found.";

			let result = `# ${data[0].word}\n\n`;
			
			const aliases: string[] = [];

			data[0].meanings.forEach((meaning: any) => {
				result += `### ${meaning.partOfSpeech}\n`;
				meaning.definitions.forEach((def: any, idx: number) => {
					result += `${idx + 1}. ${def.definition}\n`;
					if (def.example) result += `   *Example: ${def.example}*\n`;
				});
				if (meaning.synonyms && meaning.synonyms.length > 0) {
					result += `\n**Synonyms:** ${meaning.synonyms.join(', ')}\n`;
					aliases.push(...meaning.synonyms);
				}
				result += '\n';
			});

			if (aliases.length > 0) {
				result += `Aliases: ${aliases.slice(0, 5).join(', ')}`;
			} else {
				result += `Aliases: ${data[0].word}`;
			}

			return result;
		} catch (error: any) {
			console.error('Free Dictionary error:', error);
			throw new Error(`Free Dictionary error: ${error.message || error}`);
		}
	}

    async callGoogleTranslate(text: string): Promise<string> {
        try {
            const targetLang = this.getLanguageCode(this.settings.targetLanguage);
            const url = generateRequestUrl({ hl: targetLang as any });
            const body = createRequestBody(text, { from: 'auto' as any, to: targetLang as any });

            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: body
            });

            if (response.status !== 200) {
                throw new Error(`Google Translate API Error ${response.status}: ${response.text}`);
            }

            const result = normaliseResponse(response.text);
            return result.text;
        } catch (error: any) {
            console.error('Google Translate error:', error);
            throw new Error(`Google Translate error: ${error.message || error}`);
        }
    }

    private getLanguageCode(language: string): string {
        const langMap: { [key: string]: string } = {
            'Vietnamese': 'vi',
            'English': 'en',
            'French': 'fr',
            'German': 'de',
            'Spanish': 'es',
            'Japanese': 'ja',
            'Korean': 'ko',
            'Chinese': 'zh-CN',
            'Russian': 'ru',
            'Italian': 'it',
            'Portuguese': 'pt'
        };
        // If it looks like a 2-letter code already, use it
        if (language.length === 2) return language.toLowerCase();
        return langMap[language] || 'en';
    }

    async callGemini(prompt: string): Promise<string> {
        if (!this.settings.geminiApiKey) {
            throw new Error('Gemini API Key is missing. Please add it in settings.');
        }

        const model = this.settings.geminiModel || 'gemini-1.5-pro';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;
        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1,
            }
        };

        const response = await requestUrl({
            url: url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (response.status !== 200) {
            throw new Error(`API Error ${response.status}: ${response.text}`);
        }

        const data = response.json;
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error('No translation returned from Gemini.');
        }
        return data.candidates[0].content.parts[0].text.trim();
    }

    async callOpenAI(prompt: string): Promise<string> {
        if (!this.settings.openaiApiKey) {
            throw new Error('OpenAI API Key is missing. Please add it in settings.');
        }

        const url = 'https://api.openai.com/v1/chat/completions';
        const body = {
            model: this.settings.openaiModel || 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
        };

        const response = await requestUrl({
            url: url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.settings.openaiApiKey}`
            },
            body: JSON.stringify(body)
        });

        if (response.status !== 200) {
            throw new Error(`API Error ${response.status}: ${response.text}`);
        }

        const data = response.json;
        if (!data.choices || data.choices.length === 0) {
             throw new Error('No translation returned from OpenAI.');
        }
        return data.choices[0].message.content.trim();
    }

    async callOpenRouter(prompt: string): Promise<string> {
        if (!this.settings.openRouterApiKey) {
            throw new Error('OpenRouter API Key is missing. Please add it in settings.');
        }

        const url = 'https://openrouter.ai/api/v1/chat/completions';
        const body = {
            model: this.settings.openRouterModel || 'meta-llama/llama-3-8b-instruct',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
        };

        const response = await requestUrl({
            url: url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.settings.openRouterApiKey}`,
                'HTTP-Referer': 'https://github.com/obsidianmd/obsidian-api', // Required by OpenRouter
                'X-Title': 'Obsidian AI Translator' // Optional but recommended by OpenRouter
            },
            body: JSON.stringify(body)
        });

        if (response.status !== 200) {
            throw new Error(`API Error ${response.status}: ${response.text}`);
        }

        const data = response.json;
        if (!data.choices || data.choices.length === 0) {
             throw new Error('No translation returned from OpenRouter.');
        }
        return data.choices[0].message.content.trim();
    }

	private getEditorExtension(): Extension {
		return Prec.lowest(EditorView.updateListener.of((update) => {
			if (update.selectionSet) {
				const selection = update.state.selection.main;
				if (!selection.empty) {
					// Only auto-trigger if mode is 'auto'
					if (this.settings.triggerMode === 'auto') {
						const text = update.state.doc.sliceString(selection.from, selection.to).trim();
						if (text.length > 0) {
							this.handleSelection(text);
						}
					}
				} else {
					this.removePopup();
				}
			}
		}));
	}

	private selectionTimeout: any = null;
	private popupEl: HTMLElement | null = null;
	private activeHandlers: { [key: string]: (e: any) => void } = {};

	private handleSelection(text: string) {
		if (this.selectionTimeout) clearTimeout(this.selectionTimeout);
		
		this.selectionTimeout = setTimeout(async () => {
			await this.showPopup(text);
		}, 700);
	}

	private removePopup() {
		// Remove all popup elements from DOM just in case
		const existingPopups = document.querySelectorAll('.ai-translator-popup');
		existingPopups.forEach(el => el.remove());
		
		this.popupEl = null;

		// Cleanup global listeners
		if (this.activeHandlers.escape) document.removeEventListener('keydown', this.activeHandlers.escape);
		if (this.activeHandlers.clickOutside) document.removeEventListener('mousedown', this.activeHandlers.clickOutside);
		if (this.activeHandlers.mousemove) document.removeEventListener('mousemove', this.activeHandlers.mousemove);
		if (this.activeHandlers.touchmove) document.removeEventListener('touchmove', this.activeHandlers.touchmove);
		if (this.activeHandlers.mouseup) document.removeEventListener('mouseup', this.activeHandlers.mouseup);
		if (this.activeHandlers.touchend) document.removeEventListener('touchend', this.activeHandlers.touchend);
		
		this.activeHandlers = {};
		this.refreshActivePopup = null;
	}

	private async showPopup(text: string) {
		const isNarrow = window.innerWidth < 600;
		let rect: DOMRect | null = null;
		
		// Try to get selection coordinates
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			rect = range.getBoundingClientRect();
		}

		// If it's a manual trigger and no DOM selection, it might be an editor selection
		if (!rect || (rect.width === 0 && rect.height === 0)) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const editor = activeView?.editor;
			if (editor) {
				// @ts-ignore
				const cm = editor.cm;
				if (cm) {
					const head = cm.state.selection.main.head;
					const coords = cm.coordsAtPos(head);
					if (coords) {
						rect = new DOMRect(coords.left, coords.bottom, 0, 0);
					}
				}
			}
		}

		if (!rect && !Platform.isMobile && !isNarrow) return;

		this.removePopup();
		this.popupEl = document.body.createEl('div', { cls: 'ai-translator-popup' });
		
		if (Platform.isMobile || isNarrow) {
			this.popupEl.addClass('is-mobile');
		} else if (rect) {
			this.popupEl.style.left = `${rect.left}px`;
			this.popupEl.style.top = `${rect.bottom + 10}px`;
		}

		const header = this.popupEl.createEl('div', { cls: 'ai-translator-popup-header' });
		header.createEl('span', { text: 'AI Dictionary', cls: 'ai-translator-popup-title' });
		
		const closeBtn = header.createEl('div', { cls: 'ai-translator-popup-close-btn' });
		setIcon(closeBtn, 'x');
		setTooltip(closeBtn, 'Close');
		closeBtn.onclick = (e) => {
			e.stopPropagation();
			this.removePopup();
		};

		// Dragging logic
		let isDragging = false;
		let startX: number, startY: number;
		let initialLeft: number, initialTop: number;

		const startDragging = (clientX: number, clientY: number) => {
			isDragging = true;
			startX = clientX;
			startY = clientY;
			
			const rect = this.popupEl!.getBoundingClientRect();
			initialLeft = rect.left;
			initialTop = rect.top;
			
			// Remove mobile class/transform to allow manual positioning
			this.popupEl!.removeClass('is-mobile');
			if (this.popupEl!.style.transform) {
				this.popupEl!.style.transform = '';
			}
			this.popupEl!.style.left = `${initialLeft}px`;
			this.popupEl!.style.top = `${initialTop}px`;
			
			header.style.cursor = 'grabbing';
		};

		header.onmousedown = (e: MouseEvent) => {
			startDragging(e.clientX, e.clientY);
		};

		header.ontouchstart = (e: TouchEvent) => {
			if (e.touches.length > 0) {
				startDragging(e.touches[0].clientX, e.touches[0].clientY);
			}
		};

		const moveHandler = (clientX: number, clientY: number) => {
			if (!isDragging || !this.popupEl) return;
			const dx = clientX - startX;
			const dy = clientY - startY;
			
			let newLeft = initialLeft + dx;
			let newTop = initialTop + dy;
			
			// Keep within screen bounds
			const rect = this.popupEl.getBoundingClientRect();
			const padding = 10;
			
			newLeft = Math.max(padding, Math.min(newLeft, window.innerWidth - rect.width - padding));
			newTop = Math.max(padding, Math.min(newTop, window.innerHeight - rect.height - padding));

			this.popupEl.style.left = `${newLeft}px`;
			this.popupEl.style.top = `${newTop}px`;
		};

		const mouseMoveHandler = (e: MouseEvent) => moveHandler(e.clientX, e.clientY);
		const touchMoveHandler = (e: TouchEvent) => {
			if (e.touches.length > 0) {
				moveHandler(e.touches[0].clientX, e.touches[0].clientY);
			}
		};

		const stopDragging = () => {
			isDragging = false;
			if (header) header.style.cursor = 'grab';
		};

		this.activeHandlers.mousemove = mouseMoveHandler;
		this.activeHandlers.touchmove = touchMoveHandler;
		this.activeHandlers.mouseup = stopDragging;
		this.activeHandlers.touchend = stopDragging;

		document.addEventListener('mousemove', mouseMoveHandler);
		document.addEventListener('mouseup', stopDragging);
		document.addEventListener('touchmove', touchMoveHandler, { passive: false });
		document.addEventListener('touchend', stopDragging);

		const contentArea = this.popupEl.createEl('textarea', { cls: 'ai-translator-popup-content' });
		contentArea.style.width = '100%';
		contentArea.style.height = '150px';
		contentArea.style.resize = 'vertical';
		contentArea.style.backgroundColor = 'var(--background-primary)';
		contentArea.style.color = 'var(--text-normal)';
		contentArea.style.border = '1px solid var(--background-modifier-border)';
		contentArea.style.borderRadius = '4px';
		contentArea.style.padding = '8px';

		const fetchResult = async (provider: string) => {
			// Clear and show loading
			contentArea.value = '';
			contentArea.disabled = true;
			const loading = this.popupEl?.createEl('div', { cls: 'ai-translator-loading' });
			if (loading) {
				loading.createEl('div', { cls: 'ai-translator-spinner' });
				loading.createEl('span', { text: 'Analyzing...' });
			}

			try {
				const promptTemplate = this.settings.providerPrompts[provider] || DEFAULT_SETTINGS.providerPrompts[provider];
				const prompt = promptTemplate?.replace('{{targetLanguage}}', this.settings.targetLanguage).replace('{{text}}', text) || text;
				
				let result = '';
				switch (provider) {
					case 'gemini': result = await this.callGemini(prompt); break;
					case 'openai': result = await this.callOpenAI(prompt); break;
					case 'openrouter': result = await this.callOpenRouter(prompt); break;
					case 'google': result = await this.callGoogleTranslate(text); break;
					case 'free-dictionary': result = await this.callFreeDictionary(text); break;
				}
				contentArea.value = result;
			} catch (error: any) {
				contentArea.value = `Error: ${error.message || error}`;
			} finally {
				loading?.remove();
				contentArea.disabled = false;
			}
		};

		const footer = this.popupEl.createEl('div', { cls: 'ai-translator-popup-footer' });
		
		// Provider Dropdown
		const dropdownContainer = footer.createEl('div', { cls: 'ai-translator-dropdown-container' });
		const select = dropdownContainer.createEl('select', { cls: 'ai-translator-popup-select' });
		
		const allProviders = [
			{ id: 'gemini', name: 'Gemini' },
			{ id: 'openai', name: 'OpenAI' },
			{ id: 'openrouter', name: 'OpenRouter' },
			{ id: 'google', name: 'Google' },
			{ id: 'free-dictionary', name: 'Dict' }
		];

		allProviders.forEach(p => {
			const option = select.createEl('option', { text: p.name, value: p.id });
			if (p.id === this.settings.provider) option.selected = true;
		});

		select.onchange = async () => {
			// @ts-ignore
			this.settings.provider = select.value;
			await this.saveSettings();
			await fetchResult(select.value);
		};

		this.refreshActivePopup = async (provider: string) => {
			select.value = provider;
			await fetchResult(provider);
		};

		const saveBtn = footer.createEl('div', { cls: 'ai-translator-icon-btn ai-translator-save-btn' });
		setIcon(saveBtn, 'save');
		setTooltip(saveBtn, 'Save to Vault');
		saveBtn.onclick = async () => {
			await this.saveDefinition(text, contentArea.value);
		};

		const copyBtn = footer.createEl('div', { cls: 'ai-translator-icon-btn' });
		setIcon(copyBtn, 'copy');
		setTooltip(copyBtn, 'Copy Content');
		copyBtn.onclick = () => {
			navigator.clipboard.writeText(contentArea.value);
			new Notice('Copied to clipboard');
		};

		// Initial fetch
		await fetchResult(this.settings.provider);

		// Global event listeners for cleanup
		this.activeHandlers.escape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.removePopup();
			}
		};
		document.addEventListener('keydown', this.activeHandlers.escape);

		this.activeHandlers.clickOutside = (e: MouseEvent) => {
			if (this.popupEl && !this.popupEl.contains(e.target as Node) && !isDragging) {
				this.removePopup();
			}
		};
		document.addEventListener('mousedown', this.activeHandlers.clickOutside);
	}

	async saveDefinition(word: string, definition: string) {
		try {
			const folderPath = this.settings.saveFolder || 'AI-Definitions';
			
			// Ensure folder exists
			if (!(await this.app.vault.adapter.exists(folderPath))) {
				await this.app.vault.createFolder(folderPath);
			}

			const now = new Date();
			const dateStr = now.toISOString().split('T')[0];
			const timeStr = now.toTimeString().split(' ')[0];

			let extractedAliases = word;
			let cleanedDefinition = definition;
			const aliasMatch = definition.match(/Aliases:\s*(.*)$/m);
			if (aliasMatch) {
				extractedAliases = aliasMatch[1].trim();
				cleanedDefinition = definition.replace(/Aliases:\s*.*$/m, '').trim();
			}

			let saveTemplate = this.settings.useSharedTemplate 
				? (this.settings.sharedSaveTemplate || DEFAULT_SETTINGS.sharedSaveTemplate)
				: (this.settings.providerSaveTemplates[this.settings.provider] || DEFAULT_SETTINGS.providerSaveTemplates[this.settings.provider]);

			let fileContent = saveTemplate
				.replace(/{{word}}/g, word)
				.replace(/{{definition}}/g, cleanedDefinition)
				.replace(/{{date}}/g, dateStr)
				.replace(/{{time}}/g, timeStr)
				.replace(/{{aliases}}/g, extractedAliases);

			const fileName = `${word.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
			const filePath = `${folderPath}/${fileName}`;

			if (await this.app.vault.adapter.exists(filePath)) {
				// Append timestamp if file exists
				const timestamp = now.getTime();
				const newPath = `${folderPath}/${word.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${timestamp}.md`;
				await this.app.vault.create(newPath, fileContent);
				new Notice(`Saved to ${newPath}`);
			} else {
				await this.app.vault.create(filePath, fileContent);
				new Notice(`Saved to ${filePath}`);
			}
		} catch (error) {
			console.error('Error saving definition:', error);
			new Notice(`Error saving: ${error.message}`);
		}
	}
}

class AITranslatorSettingTab extends PluginSettingTab {
	plugin: AITranslatorPlugin;

	constructor(app: App, plugin: AITranslatorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Target Language')
			.setDesc('The language you want to translate your text into (e.g., Vietnamese, English, French)')
			.addText(text => text
				.setPlaceholder('Vietnamese')
				.setValue(this.plugin.settings.targetLanguage)
				.onChange(async (value) => {
					this.plugin.settings.targetLanguage = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Dictionary Popup Trigger')
			.setDesc('How should the dictionary popup be triggered?')
			.addDropdown(dropdown => dropdown
				.addOption('auto', 'Automatic (On Selection)')
				.addOption('manual', 'Manual (Hotkey Only)')
				.addOption('disabled', 'Disabled')
				.setValue(this.plugin.settings.triggerMode)
				.onChange(async (value: 'auto' | 'manual' | 'disabled') => {
					this.plugin.settings.triggerMode = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'AI Provider' });

		new Setting(containerEl)
			.setName('AI Provider')
			.setDesc('Choose which AI service or Dictionary to use')
			.addDropdown(dropdown => dropdown
				.addOption('gemini', 'Google Gemini')
				.addOption('openai', 'OpenAI')
				.addOption('openrouter', 'OpenRouter')
				.addOption('google', 'Google Translate')
				.addOption('free-dictionary', 'Free Dictionary API')
				.setValue(this.plugin.settings.provider)
				.onChange(async (value: 'gemini' | 'openai' | 'openrouter' | 'google' | 'free-dictionary') => {
					this.plugin.settings.provider = value;
					await this.plugin.saveSettings();
                    this.display(); // re-render to show provider-specific settings
				}));

		containerEl.createEl('h3', { text: 'Provider Loop Configuration' });
		containerEl.createEl('p', { text: 'Select which providers to include when using the "Cycle AI Provider" command.' });

		const providers: Array<{ id: string, name: string }> = [
			{ id: 'gemini', name: 'Google Gemini' },
			{ id: 'openai', name: 'OpenAI' },
			{ id: 'openrouter', name: 'OpenRouter' },
			{ id: 'google', name: 'Google Translate' },
			{ id: 'free-dictionary', name: 'Free Dictionary API' }
		];

		providers.forEach(p => {
			new Setting(containerEl)
				.setName(p.name)
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.providerLoop.includes(p.id))
					.onChange(async (value) => {
						if (value) {
							if (!this.plugin.settings.providerLoop.includes(p.id)) {
								this.plugin.settings.providerLoop.push(p.id);
							}
						} else {
							this.plugin.settings.providerLoop = this.plugin.settings.providerLoop.filter(id => id !== p.id);
						}
						await this.plugin.saveSettings();
					}));
		});

		containerEl.createEl('h3', { text: `Settings for ${this.plugin.settings.provider}` });

		const isAIProvider = ['gemini', 'openai', 'openrouter'].includes(this.plugin.settings.provider);
		
		if (isAIProvider) {
			new Setting(containerEl)
				.setName('Custom Prompt')
				.setDesc('Customize how the AI analyzes the selected text. Use {{targetLanguage}} and {{text}} as placeholders.')
				.addTextArea(text => text
					.setPlaceholder('Enter your custom prompt here...')
					.setValue(this.plugin.settings.providerPrompts[this.plugin.settings.provider] || '')
					.onChange(async (value) => {
						this.plugin.settings.providerPrompts[this.plugin.settings.provider] = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('Save Folder')
			.setDesc('The folder where definitions will be saved.')
			.addText(text => text
				.setPlaceholder('AI-Definitions')
				.setValue(this.plugin.settings.saveFolder)
				.onChange(async (value) => {
					this.plugin.settings.saveFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Use Shared Template')
			.setDesc('Use a single template for all providers instead of per-provider templates.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useSharedTemplate)
				.onChange(async (value) => {
					this.plugin.settings.useSharedTemplate = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		if (this.plugin.settings.useSharedTemplate) {
			new Setting(containerEl)
				.setName('Shared Save Template')
				.setDesc('The template used for all providers. Placeholders: {{word}}, {{definition}}, {{date}}, {{time}}, {{aliases}}.')
				.addTextArea(text => text
					.setPlaceholder('Enter shared template...')
					.setValue(this.plugin.settings.sharedSaveTemplate)
					.onChange(async (value) => {
						this.plugin.settings.sharedSaveTemplate = value;
						await this.plugin.saveSettings();
					}));
		} else {
			new Setting(containerEl)
				.setName('Save Template')
				.setDesc('The template for the saved definition file. Placeholders: {{word}}, {{definition}}, {{date}}, {{time}}, {{aliases}}.')
				.addTextArea(text => text
					.setPlaceholder('Enter template...')
					.setValue(this.plugin.settings.providerSaveTemplates[this.plugin.settings.provider] || '')
					.onChange(async (value) => {
						this.plugin.settings.providerSaveTemplates[this.plugin.settings.provider] = value;
						await this.plugin.saveSettings();
					}));
		}

        containerEl.createEl('h3', { text: 'Provider Settings' });

        if (this.plugin.settings.provider === 'gemini') {
            new Setting(containerEl)
                .setName('Gemini API Key')
                .setDesc('Your Google Gemini API Key')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.geminiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiApiKey = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(containerEl)
                .setName('Gemini Model')
                .setDesc('Which model to use (e.g., gemini-1.5-pro, gemini-1.5-flash)')
                .addText(text => text
                    .setPlaceholder('gemini-1.5-pro')
                    .setValue(this.plugin.settings.geminiModel)
                    .onChange(async (value) => {
                        this.plugin.settings.geminiModel = value;
                        await this.plugin.saveSettings();
                    }));
        } 
        else if (this.plugin.settings.provider === 'openai') {
            new Setting(containerEl)
                .setName('OpenAI API Key')
                .setDesc('Your OpenAI API Key')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.openaiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.openaiApiKey = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(containerEl)
                .setName('OpenAI Model')
                .setDesc('Which model to use (e.g., gpt-4o, gpt-4-turbo, gpt-3.5-turbo)')
                .addText(text => text
                    .setPlaceholder('gpt-4o')
                    .setValue(this.plugin.settings.openaiModel)
                    .onChange(async (value) => {
                        this.plugin.settings.openaiModel = value;
                        await this.plugin.saveSettings();
                    }));
        } 
        else if (this.plugin.settings.provider === 'openrouter') {
            new Setting(containerEl)
                .setName('OpenRouter API Key')
                .setDesc('Your OpenRouter API Key')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter your API key')
                    .setValue(this.plugin.settings.openRouterApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterApiKey = value;
                        await this.plugin.saveSettings();
                    });
                });

            new Setting(containerEl)
                .setName('OpenRouter Model')
                .setDesc('Which model to use (e.g., meta-llama/llama-3-8b-instruct, anthropic/claude-3-haiku)')
                .addText(text => text
                    .setPlaceholder('meta-llama/llama-3-8b-instruct')
                    .setValue(this.plugin.settings.openRouterModel)
                    .onChange(async (value) => {
                        this.plugin.settings.openRouterModel = value;
                        await this.plugin.saveSettings();
                    }));
        }
	}
}
