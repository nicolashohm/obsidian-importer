import { App, Modal, Plugin, Setting } from 'obsidian';
import { FormatImporter } from './format-importer';
import { Bear2bkImporter } from './formats/bear-bear2bk';
import { EvernoteEnexImporter } from './formats/evernote-enex';
import { HtmlImporter } from './formats/html';
import { KeepImporter } from './formats/keep-json';
import { NotionImporter } from './formats/notion';
import { truncateText } from './util';

declare global {
	interface Window {
		electron: any;
		require: NodeRequire;
	}
}

interface ImporterDefinition {
	name: string;
	optionText: string;
	helpPermalink: string;
	importer: new (app: App, modal: Modal) => FormatImporter;
}

// Temporary compatibility for in progress PRs
export type ProgressReporter = ImportContext;

export class ImportContext {
	notes = 0;
	attachments = 0;
	skipped: string[] = [];
	failed: string[] = [];
	maxFileNameLength: number = 100;

	cancelled: boolean = false;

	el: HTMLElement;
	progressBarEl: HTMLElement;
	importedCountEl: HTMLElement;
	attachmentCountEl: HTMLElement;
	remainingCountEl: HTMLElement;
	skippedCountEl: HTMLElement;
	failedCountEl: HTMLElement;
	statusEl: HTMLElement;
	importLogEl: HTMLElement;

	constructor(el: HTMLElement) {
		this.el = el;

		el.empty();

		this.statusEl = el.createDiv('importer-status');

		el.createDiv('importer-progress-bar', el => {
			this.progressBarEl = el.createDiv('importer-progress-bar-inner');
		});

		el.createDiv('import-stats-container', el => {
			el.createDiv('import-stat mod-imported', el => {
				this.importedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'imported' });
			});
			el.createDiv('import-stat mod-attachments', el => {
				this.attachmentCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'attachments' });
			});
			el.createDiv('import-stat mod-remaining', el => {
				this.remainingCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'remaining' });
			});
			el.createDiv('import-stat mod-skipped', el => {
				this.skippedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'skipped' });
			});
			el.createDiv('import-stat mod-failed', el => {
				this.failedCountEl = el.createDiv({ cls: 'import-stat-count', text: '0' });
				el.createDiv({ cls: 'import-stat-name', text: 'failed' });
			});
		});

		this.importLogEl = el.createDiv('import-log');
		this.importLogEl.hide();
	}

	/**
	 * Sets the current user visible in-progress task. The purpose is to tell the user that something is happening,
	 * and makes it easy to tell if something got stuck.
	 *
	 * Try to keep the message short, since longer ones will get truncated based on font and space availability.
	 * @param message
	 */
	status(message: string) {
		this.statusEl.setText(message);
	}

	/**
	 * Report that a note has been successfully imported.
	 * @param name
	 */
	reportNoteSuccess(name: string) {
		this.notes++;
		this.importedCountEl.setText(this.notes.toString());
	}

	/**
	 * Report that an attachment has been successfully imported.
	 * @param name
	 */
	reportAttachmentSuccess(name: string) {
		this.attachments++;
		this.attachmentCountEl.setText(this.attachments.toString());
	}

	/**
	 * Report that something has been skipped and ignored.
	 * If the skipping action is on purpose and expected for the import, then prefer not to report it
	 * (for example, some tools export to a Note.json and a Note.html, and we only use one of them).
	 * @param name
	 * @param reason
	 */
	reportSkipped(name: string, reason?: any) {
		let { importLogEl } = this;
		this.skipped.push(name);
		this.skippedCountEl.setText(this.skipped.length.toString());

		console.log('Import skipped', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'import-error', text: 'Skipped: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report that something has failed to import.
	 * @param name
	 * @param reason
	 */
	reportFailed(name: string, reason?: any) {
		let { importLogEl } = this;

		this.failed.push(name);
		this.failedCountEl.setText(this.failed.length.toString());

		console.log('Import failed', name, reason);

		this.importLogEl.createDiv('list-item', el => {
			el.createSpan({ cls: 'import-error', text: 'Failed: ' });
			el.createSpan({ text: `"${truncateText(name, this.maxFileNameLength)}"` + (reason ? ` because ${truncateText(String(reason), this.maxFileNameLength)}` : '') });
		});
		importLogEl.scrollTop = importLogEl.scrollHeight;
		importLogEl.show();
	}

	/**
	 * Report the current progress. This will update the progress bar as well as changing
	 * the "imported" and "remaining" numbers on the UI.
	 * @param current
	 * @param total
	 */
	reportProgress(current: number, total: number) {
		if (total <= 0) return;
		console.log('Current progress:', (100 * current / total).toFixed(1) + '%');
		this.remainingCountEl.setText((total - current).toString());
		this.importedCountEl.setText(current.toString());
		this.progressBarEl.style.width = (100 * current / total).toFixed(1) + '%';
	}

	cancel() {
		this.cancelled = true;
	}

	/**
	 * Check if the user has cancelled this run.
	 */
	isCancelled() {
		return this.cancelled;
	}
}

export default class ImporterPlugin extends Plugin {
	importers: Record<string, ImporterDefinition>;

	async onload() {
		this.importers = {
			'bear': {
				name: 'Bear',
				optionText: 'Bear (.bear2bk)',
				importer: Bear2bkImporter,
				helpPermalink: 'import/bear',
			},
			'evernote': {
				name: 'Evernote',
				optionText: 'Evernote (.enex)',
				importer: EvernoteEnexImporter,
				helpPermalink: 'import/evernote',
			},
			'keep': {
				name: 'Google Keep',
				optionText: 'Google Keep (.zip/.json)',
				importer: KeepImporter,
				helpPermalink: 'import/google-keep',
			},
			'html': {
				name: 'HTML files',
				optionText: 'HTML (.html)',
				importer: HtmlImporter,
				helpPermalink: 'import/html',
			},
			'notion': {
				name: 'Notion',
				optionText: 'Notion (.zip)',
				importer: NotionImporter,
				helpPermalink: 'import/notion',
			},
		};

		this.addRibbonIcon('lucide-import', 'Open Importer', () => {
			new ImporterModal(this.app, this).open();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open importer',
			callback: () => {
				new ImporterModal(this.app, this).open();
			},
		});

		// For development, un-comment this and tweak it to your importer:

		/*
		// Create and open the importer on boot
		let modal = new ImporterModal(this.app, this);
		modal.open();
		// Select my importer
		modal.updateContent('html');
		if (modal.importer instanceof HtmlImporter) {
			// Automatically pick file
			modal.importer.files = [new NodePickedFile('path/to/test/file.html')];
		}
		*/
	}

	onunload() {

	}
}

export class ImporterModal extends Modal {
	plugin: ImporterPlugin;
	importer: FormatImporter;
	selectedId: string;

	current: ImportContext | null = null;

	constructor(app: App, plugin: ImporterPlugin) {
		super(app);
		this.plugin = plugin;
		this.titleEl.setText('Import data into Obsidian');

		let keys = Object.keys(plugin.importers);
		if (keys.length > 0) {
			this.selectedId = keys[0];
			this.updateContent();
		}
	}

	updateContent() {
		const { contentEl, selectedId } = this;
		let importers = this.plugin.importers;
		let selectedImporter = importers[selectedId];
		contentEl.empty();

		let descriptionFragment = new DocumentFragment();
		descriptionFragment.createSpan({ text: 'The format to be imported.' });
		descriptionFragment.createEl('br');
		descriptionFragment.createEl('a', {
			text: `Learn more about importing from ${selectedImporter.name}.`,
			href: `https://help.obsidian.md/${selectedImporter.helpPermalink}`,
		});

		new Setting(contentEl)
			.setName('File format')
			.setDesc(descriptionFragment)
			.addDropdown(dropdown => {
				for (let id in importers) {
					if (importers.hasOwnProperty(id)) {
						dropdown.addOption(id, importers[id].optionText);
					}
				}
				dropdown.onChange((value) => {
					if (importers.hasOwnProperty(value)) {
						this.selectedId = value;
						this.updateContent();
					}
				});
				dropdown.setValue(this.selectedId);
			});

		if (selectedId && importers.hasOwnProperty(selectedId)) {
			let importer = this.importer = new selectedImporter.importer(this.app, this);

			contentEl.createDiv('button-container u-center-text', el => {
				el.createEl('button', { cls: 'mod-cta', text: 'Import' }, el => {
					el.addEventListener('click', async () => {
						if (this.current) {
							this.current.cancel();
						}
						contentEl.empty();
						let progressEl = contentEl.createDiv();

						let ctx = this.current = new ImportContext(progressEl);

						let buttonsEl = contentEl.createDiv('button-container u-center-text');
						let cancelButtonEl = buttonsEl.createEl('button', { cls: 'mod-danger', text: 'Stop' }, el => {
							el.addEventListener('click', () => {
								ctx.cancel();
								cancelButtonEl.detach();
							});
						});
						try {
							await importer.import(ctx);
						}
						finally {
							if (this.current === ctx) {
								this.current = null;
							}
							cancelButtonEl.detach();
							buttonsEl.createEl('button', { cls: 'mod-cta', text: 'Done' }, el => {
								el.addEventListener('click', () => this.close());
							});
							buttonsEl.createEl('button', { text: 'Import again' }, el => {
								el.addEventListener('click', () => this.updateContent());
							});
						}
					});
				});
			});
		}
	}

	onClose() {
		const { contentEl, current } = this;
		contentEl.empty();
		if (current) {
			current.cancel();
		}
	}
}
