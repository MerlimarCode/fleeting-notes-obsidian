import { App, Notice, Plugin, PluginSettingTab, Setting, request, TFile } from 'obsidian';

// Remember to rename these classes and interfaces!

interface FleetingNotesSettings {
	fleeting_notes_folder: string;
	note_template: string;
	sync_on_startup: boolean;
	username: string;
	password: string;
}

const DEFAULT_SETTINGS: FleetingNotesSettings = {
	fleeting_notes_folder: '/',
	note_template: "---\nid: ${id}\ntitle: ${title}\ndate: ${datetime}\n---\n${content}\n\n---\n\n${source}",
	sync_on_startup: false,
	username: '',
	password: '',
}

export default class FleetingNotesPlugin extends Plugin {
	settings: FleetingNotesSettings;

	async onload() {
		await this.loadSettings();
		// This forces fleeting notes to sync with obsidian
		this.addCommand({
			id: 'sync-fleeting-notes',
			name: 'Pull All Notes from Fleeting Notes',
			callback: async () => {
				this.syncFleetingNotes();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new FleetingNotesSettingTab(this.app, this));

		// syncs on startup
		if (this.settings.sync_on_startup) {
			this.syncFleetingNotes();
		}
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncFleetingNotes () {
		try {
			let notes = await getAllNotesFirebase(this.settings.username, this.settings.password);
			notes = notes.filter((note: Note) => !note._isDeleted);
			await this.writeNotes(notes, this.settings.fleeting_notes_folder);
			new Notice('Fleeting Notes sync success!');
		} catch (e) {
			if (typeof e === 'string') {
				new Notice(e);
			} else {
				new Notice('Fleeing Notes sync failed - please check settings');
				console.error(e);
			}
		}
	}

	async getExistingFleetingNotes (dir: string) {
		let noteMap: Map<string, TFile> = new Map<string, TFile>();
		try {
			var files = this.app.vault.getFiles();
			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				var file_id: string;
				var metadata = await this.app.metadataCache.getFileCache(file);
				if (metadata && metadata.frontmatter){
					file_id = metadata.frontmatter.id || null;
				} else {
					file_id = null
				}
				var fileInDir = (dir === '/') ? !file.path.contains('/') : file.path.startsWith(dir);
				if (!fileInDir || file_id == null) {
					continue
				}
				noteMap.set(file_id, file);
			}
		} catch (e) {
			console.error('Failed to Retrieve All Existing Fleeting Notes');
			console.error(e);
		}
		return noteMap;
	}

	// paths in obsidian are weird, need function to convert to proper path
	convertObsidianPath(path: string) {
		path = (path[0] === '/') ? path.replace('/', '') : path;
		path = path || '/';
		return path;
	}

	getFilledTemplate(template: string, note: Note) {
		var newTs = note.timestamp.replace(':', 'h').replace(':', 'm') + 's';
		var title = (note.title) ? `${note.title}` : `${newTs}`;
		var newTemplate = template
			.replace(/\$\{id\}/gm, note._id)
			.replace(/\$\{title\}/gm, title)
			.replace(/\$\{datetime\}/gm, note.timestamp.substring(0.10))
			.replace(/\$\{content\}/gm, note.content)
			.replace(/\$\{source\}/gm, note.source);

		return newTemplate;
	}

	// TODO: add templating in the future
	async writeNotes (notes: Array<Note>, folder: string) {
		folder = this.convertObsidianPath(folder);
		try {
			var existingNotes = await this.getExistingFleetingNotes(folder);
			var folderExists = await this.app.vault.adapter.exists(folder);
			if (!folderExists) {
				await this.app.vault.createFolder(folder);
			}
			for (var i = 0; i < notes.length; i++) {
				var note = notes[i];
				var newTs = note.timestamp.replace(':', 'h').replace(':', 'm') + 's';
				var title = (note.title) ? `${note.title}.md` : `${newTs}.md`;
				var path = this.convertObsidianPath(pathJoin([folder, title]));
				var mdContent = this.getFilledTemplate(this.settings.note_template, note);
				var file = existingNotes.get(note._id) || null;
				if (file != null) {
					// modify file if id exists in frontmatter
					await this.app.vault.modify(file, mdContent);
				} else {
					// recreate file otherwise
					var delFile = this.app.vault.getAbstractFileByPath(path);
					if (delFile != null) {
						await this.app.vault.delete(delFile);
					}
					await this.app.vault.create(path, mdContent);
				}
				
			}
		} catch (e) {
			console.log(e);
			throw 'Failed to write notes to Obsidian - Check `folder location` is not empty in settings';
		}
	}
}

class FleetingNotesSettingTab extends PluginSettingTab {
	plugin: FleetingNotesPlugin;

	constructor(app: App, plugin: FleetingNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Fleeting Notes Sync Settings'});

		new Setting(containerEl)
			.setName('Fleeting Notes folder location')
			.setDesc('Files will be populated here from Fleeting Notes')
			.addText(text => text
				.setPlaceholder('Enter the folder location')
				.setValue(this.plugin.settings.fleeting_notes_folder)
				.onChange(async (value) => {
					this.plugin.settings.fleeting_notes_folder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Username / Email')
			.addText(text => text
				.setPlaceholder('Enter username/email')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Password')
			.addText(text => text
				.setPlaceholder('Enter password')
				.setValue(this.plugin.settings.password)
				.onChange(async (value) => {
					this.plugin.settings.password = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync notes on startup')
			.addToggle(tog => tog
				.setValue(this.plugin.settings.sync_on_startup)
				.onChange(async (val) => {
					this.plugin.settings.sync_on_startup = val;
					await this.plugin.saveSettings();
				}));
			
		containerEl.createEl("hr");
		new Setting(containerEl)
				.setHeading()
				.setName('Note Template')
		new Setting(containerEl)
			.setHeading()
			.addTextArea(t => {
				t
					.setValue(this.plugin.settings.note_template)
					.onChange(async (val) => {
						this.plugin.settings.note_template = val;
						await this.plugin.saveSettings();
					});
				t.inputEl.setAttr("rows", 10);
				t.inputEl.addClass("note_template");
			})
			.addExtraButton(cb => {
				cb
					.setIcon("sync")
					.setTooltip("Refresh template")
					.onClick(() => {
						this.plugin.settings.note_template = DEFAULT_SETTINGS.note_template;
						this.plugin.saveSettings();
						this.display();
					});
				
			})
	}
}

// helper functions
// https://stackoverflow.com/a/29855282/13659833
function pathJoin(parts: Array<string>, sep: string = '/'){
  var separator = sep || '/';
  var replace   = new RegExp(separator+'{1,}', 'g');
  return parts.join(separator).replace(replace, separator);
}

// takes in API key & query
const getAllNotesRealm = async (email: string, password: string) => {
  let notes = [];
  try {
	const query = `{"query":"query {  notes {    _id    title    content    source    timestamp   _isDeleted}}"}'`
	const config = {
		method: 'post',
		url: 'https://realm.mongodb.com/api/client/v2.0/app/fleeting-notes-knojs/graphql',
		headers: { 
		'email': email,
		'password': password,
		},
		body: query,
	};
	const res = await request(config);
	notes = JSON.parse(res)["data"]["notes"]
  } catch (e) {
	  console.log(e);
	  throw 'Failed to retrieve notes from the database - Check credentials in settings & internet connection';
  }
  return notes;
}

// takes in API key & query
const getAllNotesFirebase = async (email: string, password: string) => {
  let notes = [];
  try {
	const body = {
		'email': email,
		'password': password,
	}
	const config = {
		method: 'post',
		url: 'https://us-central1-fleetingnotes-22f77.cloudfunctions.net/get_all_notes',
		contentType: 'application/json',
		body: JSON.stringify(body),
	};
	const res = await request(config);
	notes = JSON.parse(res);
  } catch (e) {
	  console.log(e);
	  throw 'Failed to retrieve notes from the database - Check credentials in settings & internet connection';
  }
  return notes;
}
interface Note {
	_id: string,
	title: string,
	content: string,
	timestamp: string,
	source: string,
	_isDeleted: boolean,
}

