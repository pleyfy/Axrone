import { compileSceneProject } from '../playground/live-example-runtime';
import { createLiveEditor, type LiveEditorController } from '../playground/live-editor';
import type { PlaygroundSceneHandle } from '../projects/shared/playground-types';
import { loadProjectCatalog } from './project-catalog';
import { renderPlaygroundShell, type PlaygroundShell } from './shell';
import type {
	PersistedProjectFiles,
	PlaygroundCameraPreset,
	PlaygroundProjectRecord,
	VirtualProjectFile,
} from './types';

type ConsoleTone = 'log' | 'info' | 'warn' | 'error' | 'success';
type ConsoleTab = 'console' | 'problems' | 'output';
type ConsoleEntry = {
	readonly tone: ConsoleTone;
	readonly message: string;
	readonly time: string;
};
type FileVisualKind =
	| 'main'
	| 'scene'
	| 'data'
	| 'project'
	| 'palette'
	| 'code'
	| 'json'
	| 'shader'
	| 'style'
	| 'markup'
	| 'doc'
	| 'image'
	| 'audio'
	| 'video'
	| 'model'
	| 'default';
type FileVisual = {
	readonly color: string;
	readonly kind: FileVisualKind;
};
type FileTreeFileNode = {
	readonly kind: 'file';
	readonly name: string;
	readonly path: string;
	readonly order: number;
};
type FileTreeFolderNode = {
	readonly kind: 'folder';
	readonly name: string;
	readonly key: string;
	readonly order: number;
	readonly children: Map<string, FileTreeNode>;
};
type FileTreeNode = FileTreeFileNode | FileTreeFolderNode;
type RuntimeSession = {
	readonly projectId: string;
	readonly handle: PlaygroundSceneHandle;
	readonly summary?: string;
	readonly objectCount: number;
};

const sourceStoragePrefix = 'axrone:examples:vfs:';

const cloneFiles = (files: readonly VirtualProjectFile[]): VirtualProjectFile[] =>
	files.map((file) => ({ ...file }));

const resolveStorageKey = (projectId: string): string => `${sourceStoragePrefix}${projectId}`;

const parsePersistedProjectFiles = (value: string | null): PersistedProjectFiles | undefined => {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as Partial<PersistedProjectFiles>;
		if (parsed.version !== 1 || typeof parsed.files !== 'object' || !parsed.files) {
			return undefined;
		}

		return parsed as PersistedProjectFiles;
	} catch {
		return undefined;
	}
};

const formatTime = (): string =>
	new Date().toLocaleTimeString('en-US', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));

const resolveToneClass = (tone: ConsoleTone): string => {
	switch (tone) {
		case 'info':
			return 'console-message--info';
		case 'warn':
			return 'console-message--warn';
		case 'error':
			return 'console-message--error';
		case 'success':
			return 'console-message--success';
		default:
			return 'console-message--default';
	}
};

const createProjectFilesMap = (files: readonly VirtualProjectFile[]): Record<string, string> =>
	Object.fromEntries(files.map((file) => [file.path, file.content]));

const resolveLanguageLabel = (path: string): string => {
	const ext = path.split('.').pop()?.toLowerCase();
	switch (ext) {
		case 'js':
		case 'jsx':
			return 'JavaScript';
		case 'json':
			return 'JSON';
		case 'glsl':
		case 'wgsl':
			return 'Shader';
		case 'css':
		case 'scss':
			return 'Stylesheet';
		case 'html':
			return 'HTML';
		case 'md':
			return 'Markdown';
		case 'yaml':
		case 'yml':
			return 'YAML';
		case 'ts':
		case 'tsx':
		default:
			return 'TypeScript';
	}
};

const resolveCameraPresetLabel = (preset: PlaygroundCameraPreset): string => {
	switch (preset) {
		case 'front':
			return 'Front';
		case 'top':
			return 'Top';
		case 'right':
			return 'Right';
		default:
			return 'Perspective';
	}
};

const createFileIcon = (size: number, innerMarkup: string): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5L14.5 3z"></path>
		<path d="M14 3v5h5"></path>
		${innerMarkup}
	</svg>
`;

const createFolderIcon = (size: number): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M3.5 7.5a2 2 0 0 1 2-2H9l2 2h7.5a2 2 0 0 1 2 2v1.5H3.5z"></path>
		<path d="M3.5 9h17v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path>
	</svg>
`;

const createChevronIcon = (size: number): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M9 18l6-6-6-6"></path>
	</svg>
`;

const renderVisualIcon = (visual: FileVisual, size: number): string => {
	switch (visual.kind) {
		case 'main':
			return createFileIcon(size, '<path d="M10 10.2v5.6l4.6-2.8-4.6-2.8z" fill="currentColor" stroke="none"></path>');
		case 'scene':
			return createFileIcon(size, '<rect x="8" y="10.5" width="3" height="3" rx="0.6"></rect><rect x="13" y="10.5" width="3" height="3" rx="0.6"></rect><rect x="8" y="15.2" width="3" height="3" rx="0.6"></rect><rect x="13" y="15.2" width="3" height="3" rx="0.6"></rect>');
		case 'data':
			return createFileIcon(size, '<path d="M8 11.2h8"></path><path d="M8 14h8"></path><path d="M8 16.8h5.5"></path>');
		case 'project':
			return createFileIcon(size, '<path d="M8 11.5h8"></path><path d="M8 15.5h8"></path><circle cx="10.5" cy="11.5" r="1"></circle><circle cx="13.5" cy="15.5" r="1"></circle>');
		case 'palette':
			return createFileIcon(size, '<path d="M12 10.2a3.7 3.7 0 0 0 0 7.4h.9a1.2 1.2 0 0 0 1.05-1.78l-.28-.48a1.1 1.1 0 0 1 .94-1.65H15a2.8 2.8 0 0 0 0-5.6z"></path><circle cx="9.1" cy="12.1" r=".65" fill="currentColor" stroke="none"></circle><circle cx="10.6" cy="10.8" r=".65" fill="currentColor" stroke="none"></circle><circle cx="12.7" cy="10.6" r=".65" fill="currentColor" stroke="none"></circle>');
		case 'json':
			return createFileIcon(size, '<path d="M10 10.5c-.9 0-1.5.6-1.5 1.5v.3c0 .6-.3 1-.8 1.2.5.2.8.6.8 1.2v.3c0 .9.6 1.5 1.5 1.5"></path><path d="M14 10.5c.9 0 1.5.6 1.5 1.5v.3c0 .6.3 1 .8 1.2-.5.2-.8.6-.8 1.2v.3c0 .9-.6 1.5-1.5 1.5"></path>');
		case 'shader':
			return createFileIcon(size, '<path d="M12 10.1l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"></path>');
		case 'style':
			return createFileIcon(size, '<path d="M8.5 16.5c1.1 0 1.8-.7 1.8-1.8 0-.4-.1-.8-.4-1.1l4.9-4.9a1 1 0 0 0-1.4-1.4L8.5 12.2c-.3-.3-.7-.4-1.1-.4-1.1 0-1.8.7-1.8 1.8s.7 1.9 1.8 1.9z"></path><path d="M12.7 8.3l2 2"></path>');
		case 'markup':
			return createFileIcon(size, '<path d="M9.5 11.2 7.2 13.5l2.3 2.3"></path><path d="M14.5 11.2l2.3 2.3-2.3 2.3"></path><path d="M12.8 10.6 11.2 16.4"></path>');
		case 'doc':
			return createFileIcon(size, '<path d="M8.3 11.2h7.4"></path><path d="M8.3 14h7.4"></path><path d="M8.3 16.8h4.8"></path>');
		case 'image':
			return createFileIcon(size, '<circle cx="10" cy="10.7" r="1"></circle><path d="M8 17l3.1-3.1a1 1 0 0 1 1.4 0L16 17"></path><path d="M12.8 15.3l1.2-1.2a1 1 0 0 1 1.4 0l1.6 1.6"></path>');
		case 'audio':
			return createFileIcon(size, '<path d="M9 13.8h2.1l2.9-2.3v5.8L11.1 15H9z"></path><path d="M16.2 11.2a3.1 3.1 0 0 1 0 4.6"></path>');
		case 'video':
			return createFileIcon(size, '<rect x="8" y="10.5" width="8" height="5.6" rx="1"></rect><path d="M11.3 11.8v3l2.6-1.5-2.6-1.5z" fill="currentColor" stroke="none"></path>');
		case 'model':
			return createFileIcon(size, '<path d="M12 10l3.6 2.1v4.2L12 18.4l-3.6-2.1v-4.2z"></path><path d="M12 10v4.2"></path><path d="M8.4 12.1 12 14.2l3.6-2.1"></path>');
		case 'code':
			return createFileIcon(size, '<path d="M10 11.2 7.7 13.5 10 15.8"></path><path d="M14 11.2 16.3 13.5 14 15.8"></path>');
		default:
			return createFileIcon(size, '<path d="M8.3 11.2h7.4"></path><path d="M8.3 14h7.4"></path>');
	}
};

const resolveFileVisual = (path: string): FileVisual => {
	const fileName = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
	const ext = fileName.split('.').pop()?.toLowerCase();

	if (/^main\./.test(fileName)) {
		return { kind: 'main', color: '#f59e0b' };
	}
	if (/^scene\./.test(fileName)) {
		return { kind: 'scene', color: '#10b981' };
	}
	if (/^project\./.test(fileName)) {
		return { kind: 'project', color: '#6366f1' };
	}
	if (fileName.includes('palette')) {
		return { kind: 'palette', color: '#8b5cf6' };
	}
	if (fileName.includes('data')) {
		return { kind: 'data', color: '#ec4899' };
	}

	switch (ext) {
		case 'ts':
		case 'tsx':
			return { kind: 'code', color: '#2563eb' };
		case 'js':
		case 'jsx':
			return { kind: 'code', color: '#f59e0b' };
		case 'json':
			return { kind: 'json', color: '#fb923c' };
		case 'glsl':
		case 'wgsl':
			return { kind: 'shader', color: '#06b6d4' };
		case 'css':
		case 'scss':
			return { kind: 'style', color: '#14b8a6' };
		case 'html':
			return { kind: 'markup', color: '#f43f5e' };
		case 'md':
		case 'txt':
			return { kind: 'doc', color: '#64748b' };
		case 'yaml':
		case 'yml':
			return { kind: 'project', color: '#6366f1' };
		case 'png':
		case 'jpg':
		case 'jpeg':
		case 'webp':
		case 'gif':
		case 'svg':
			return { kind: 'image', color: '#22c55e' };
		case 'mp3':
		case 'wav':
		case 'ogg':
			return { kind: 'audio', color: '#db2777' };
		case 'mp4':
		case 'webm':
			return { kind: 'video', color: '#ef4444' };
		case 'glb':
		case 'gltf':
		case 'fbx':
		case 'obj':
			return { kind: 'model', color: '#7c3aed' };
		default:
			return { kind: 'default', color: '#94a3b8' };
	}
};

const createFolderNode = (name: string, key: string, order: number): FileTreeFolderNode => ({
	kind: 'folder',
	name,
	key,
	order,
	children: new Map<string, FileTreeNode>(),
});

const buildFileTree = (
	files: readonly VirtualProjectFile[],
): { readonly root: FileTreeFolderNode; readonly folderCount: number } => {
	const root = createFolderNode('', '', -1);
	let folderCount = 0;

	files.forEach((file, order) => {
		const segments = file.path.split('/').filter(Boolean);
		if (segments.length === 0) {
			return;
		}

		let currentFolder = root;
		let currentKey = '';
		for (const segment of segments.slice(0, -1)) {
			currentKey = currentKey ? `${currentKey}/${segment}` : segment;
			const childKey = `folder:${segment}`;
			let child = currentFolder.children.get(childKey);
			if (!child || child.kind !== 'folder') {
				child = createFolderNode(segment, currentKey, order);
				currentFolder.children.set(childKey, child);
				folderCount += 1;
			}
			currentFolder = child;
		}

		const fileName = segments[segments.length - 1] ?? file.path;
		currentFolder.children.set(`file:${fileName}`, {
			kind: 'file',
			name: fileName,
			path: file.path,
			order,
		});
	});

	return { root, folderCount };
};

const renderTemplateCards = (shell: PlaygroundShell, selectedTemplateId: string): void => {
	const templates = [
		{ id: 'blank', name: 'Blank Scene', desc: 'An empty Axrone scene with a camera and viewport.', accent: '#64748b', badge: 'AX' },
		{ id: 'basic', name: 'Basic Scene', desc: 'A starter scene with floor, cube, and default lighting.', accent: '#2563eb', badge: '3D' },
	];

	shell.newProjectTemplates.innerHTML = templates
		.map(
			(template) => `
				<button type="button" data-template-id="${template.id}" class="template-card ${template.id === selectedTemplateId ? 'selected' : ''}" style="--template-accent:${template.accent}">
					<span class="template-card__icon">${template.badge}</span>
					<span class="template-card__body">
						<span class="template-card__title">${template.name}</span>
						<span class="template-card__desc">${template.desc}</span>
					</span>
				</button>
			`,
		)
		.join('');
};

export const startPlaygroundApp = async (root: HTMLElement): Promise<void> => {
	const shell = renderPlaygroundShell(root);
	window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
	const projects = (await loadProjectCatalog()).map((project) => ({
		...project,
		files: cloneFiles(project.files),
	}));

	let currentProjectId = projects[0]?.id ?? '';
	let currentFilePath = projects[0]?.entryFile ?? '';
	let openTabs = currentFilePath ? [currentFilePath] : [];
	let editor: LiveEditorController | undefined;
	let runtimeSession: RuntimeSession | undefined;
	let projectDropdownOpen = false;
	let consoleVisible = true;
	let sidebarVisible = true;
	let verticalLayout = false;
	let playing = true;
	let wireframe = false;
	let gridVisible = true;
	let axesVisible = false;
	let activeConsoleTab: ConsoleTab = 'console';
	let selectedTemplateId = 'blank';
	const collapsedFolders = new Set<string>();
	const consoleEntries: ConsoleEntry[] = [];
	const problemEntries: ConsoleEntry[] = [];
	const outputEntries: ConsoleEntry[] = [];
	const applyProjectListFilter = (): void => {
		const query = shell.projectSearchInput.value.trim().toLowerCase();
		const cards = shell.projectList.querySelectorAll<HTMLElement>('[data-project-search]');
		let visibleCount = 0;
		for (const card of cards) {
			const haystack = card.dataset.projectSearch ?? '';
			const visible = !query || haystack.includes(query);
			card.style.display = visible ? '' : 'none';
			if (visible) {
				visibleCount += 1;
			}
		}
		shell.projectCount.textContent = `${visibleCount} proje`;
	};

	const getCurrentProject = (): PlaygroundProjectRecord | undefined =>
		projects.find((project) => project.id === currentProjectId);

	const persistCurrentProject = (): void => {
		const project = getCurrentProject();
		if (!project || typeof localStorage === 'undefined') {
			return;
		}

		const payload: PersistedProjectFiles = {
			version: 1,
			files: createProjectFilesMap(project.files),
		};
		localStorage.setItem(resolveStorageKey(project.id), JSON.stringify(payload));
	};

	const hydrateProject = (project: PlaygroundProjectRecord): PlaygroundProjectRecord => {
		if (typeof localStorage === 'undefined') {
			return project;
		}

		const payload = parsePersistedProjectFiles(localStorage.getItem(resolveStorageKey(project.id)));
		if (!payload) {
			return project;
		}

		return {
			...project,
			files: project.files.map((file) => ({
				...file,
				content: payload.files[file.path] ?? file.content,
			})),
		};
	};

	for (let index = 0; index < projects.length; index += 1) {
		projects[index] = hydrateProject(projects[index]!);
	}

	const appendConsoleEntry = (target: ConsoleEntry[], tone: ConsoleTone, message: string): void => {
		target.push({ tone, message, time: formatTime() });
		renderConsoleOutput();
	};

	const setStatus = (text: string, tone: 'running' | 'error' | 'ready' | 'stopped'): void => {
		shell.statusText.textContent = text;
		shell.statusDot.className = `dot ${tone === 'running' ? 'on' : tone === 'error' ? 'er' : 'id'}`;
	};

	const renderConsoleOutput = (): void => {
		const source = activeConsoleTab === 'console' ? consoleEntries : activeConsoleTab === 'problems' ? problemEntries : outputEntries;
		shell.consoleOut.innerHTML = source
			.map(
				(entry) => `
					<div class="console-line fi">
						<span class="console-time">[${entry.time}]</span>
						<span class="console-message ${resolveToneClass(entry.tone)}">${escapeHtml(entry.message)}</span>
					</div>
				`,
			)
			.join('');
		shell.problemCount.textContent = String(problemEntries.length);
	};

	const updatePlayIcon = (): void => {
		const playIcon = shell.playButton.querySelector<SVGElement>('#icon-play');
		const pauseIcon = shell.playButton.querySelector<SVGElement>('#icon-pause');
		if (playIcon && pauseIcon) {
			playIcon.style.display = playing ? 'none' : 'block';
			pauseIcon.style.display = playing ? 'block' : 'none';
		}
	};

	const updateControlState = (): void => {
		shell.wireframeButton.classList.toggle('active-t', wireframe);
		shell.gridButton.classList.toggle('active-t', gridVisible);
		shell.axesButton.classList.toggle('active-t', axesVisible);
		updatePlayIcon();
	};

	const updateRuntimeSummary = (): void => {
		shell.objectCountLabel.textContent = runtimeSession ? String(runtimeSession.objectCount) : '—';
		shell.ctrlInfo.textContent = runtimeSession?.summary ?? '—';
	};

	const stopCurrentRuntime = async (): Promise<void> => {
		const currentSession = runtimeSession;
		runtimeSession = undefined;
		updateRuntimeSummary();
		if (!currentSession) {
			shell.previewStage.replaceChildren();
			setStatus('Durduruldu', 'stopped');
			return;
		}

		await currentSession.handle.dispose();
		shell.previewStage.replaceChildren();
		setStatus('Stopped', 'stopped');
	};

	const runCurrentProject = async (): Promise<void> => {
		const project = getCurrentProject();
		if (!project) {
			appendConsoleEntry(problemEntries, 'error', 'No project is available to run.');
			return;
		}

		await stopCurrentRuntime();
		setStatus('Running', 'running');
		problemEntries.length = 0;
		renderConsoleOutput();
		shell.previewStage.replaceChildren();

		try {
			const sceneExample = compileSceneProject(createProjectFilesMap(project.files), project.entryFile);
			const mountResult = await sceneExample.mount({ container: shell.previewStage });
			const handle: PlaygroundSceneHandle = mountResult && typeof mountResult === 'object' && 'dispose' in mountResult
				? (mountResult as PlaygroundSceneHandle)
				: { dispose() {} };
			playing = true;
			wireframe = false;
			gridVisible = true;
			axesVisible = false;
			handle.setPlaying?.(true);
			handle.setWireframe?.(false);
			handle.setGridVisible?.(true);
			handle.setAxesVisible?.(false);
			const stats = handle.getStats?.();
			runtimeSession = {
				projectId: project.id,
				handle,
				objectCount: stats?.objectCount ?? 0,
				summary: stats?.summary,
			};
			updateControlState();
			updateRuntimeSummary();
			shell.ctrlBar.classList.add('visible');
			appendConsoleEntry(consoleEntries, 'success', `Scene started — ${project.name}`);
			appendConsoleEntry(outputEntries, 'info', `${sceneExample.title} loaded.`);
		} catch (error) {
			setStatus('Error', 'error');
			const message = error instanceof Error ? error.message : String(error);
			appendConsoleEntry(problemEntries, 'error', message);
			renderConsoleOutput();
		}
	};

	const renderProjectList = (): void => {
		shell.projectList.innerHTML = projects
			.map((project) => {
				const selected = project.id === currentProjectId;
				return `
					<div class="proj-card ${selected ? 'selected' : ''}" data-project-id="${escapeHtml(project.id)}" data-project-search="${escapeHtml(`${project.name} ${project.description}`.toLowerCase())}" style="--project-accent:${project.color}">
						<div class="proj-card__icon">
							<span class="proj-card__swatch"></span>
						</div>
						<div class="proj-card__body">
							<div class="proj-card__title-row">
								<span class="proj-card__title">${escapeHtml(project.name)}</span>
								${selected ? '<span class="proj-card__badge">Aktif</span>' : ''}
							</div>
							<span class="proj-card__desc">${escapeHtml(project.description)}</span>
							<span class="proj-card__meta">${project.files.length} dosya</span>
						</div>
					</div>
				`;
			})
			.join('');
		applyProjectListFilter();
	};

	const renderFileTree = (): void => {
		const project = getCurrentProject();
		if (!project) {
			shell.fileTree.innerHTML = '';
			shell.fileCountText.textContent = '0 dosya';
			return;
		}

		const { root: fileTree, folderCount } = buildFileTree(project.files);
		const folderContainsActivePath = (folder: FileTreeFolderNode): boolean =>
			[...folder.children.values()].some((child) =>
				child.kind === 'file' ? child.path === currentFilePath : folderContainsActivePath(child),
			);
		const renderNodes = (nodes: readonly FileTreeNode[], depth: number): string =>
			nodes
				.map((node) => {
					if (node.kind === 'folder') {
						const hasActiveDescendant = folderContainsActivePath(node);
						const expanded = hasActiveDescendant || !collapsedFolders.has(node.key);
						const childrenMarkup = expanded
							? renderNodes([...node.children.values()], depth + 1)
							: '';
						return `
							<div class="explorer-branch">
								<button
									type="button"
									class="explorer-item explorer-item--folder${hasActiveDescendant ? ' explorer-item--folder-current' : ''}"
									data-folder-path="${escapeHtml(node.key)}"
									data-expanded="${expanded ? 'true' : 'false'}"
									style="--tree-depth:${depth}"
								>
									<span class="explorer-item__chevron">${createChevronIcon(10)}</span>
									<span class="explorer-item__icon explorer-item__icon--folder" style="color:#94a3b8">${createFolderIcon(14)}</span>
									<span class="explorer-item__label">${escapeHtml(node.name)}</span>
								</button>
								${childrenMarkup ? `<div class="explorer-children">${childrenMarkup}</div>` : ''}
							</div>
						`;
					}

					const active = node.path === currentFilePath;
					const visual = resolveFileVisual(node.path);
					return `
						<div class="explorer-item explorer-item--file${active ? ' active' : ''}" data-file-path="${escapeHtml(node.path)}" style="--tree-depth:${depth}">
							<span class="explorer-item__icon" style="color:${visual.color}">${renderVisualIcon(visual, 14)}</span>
							<span class="explorer-item__label">${escapeHtml(node.name)}</span>
						</div>
					`;
				})
				.join('');

		shell.fileTree.innerHTML = renderNodes([...fileTree.children.values()], 0);
		shell.fileCountText.textContent = folderCount > 0 ? `${project.files.length} files • ${folderCount} folders` : `${project.files.length} files`;
	};

	const renderEditorTabs = (): void => {
		shell.editorTabs.innerHTML = openTabs
			.map((tabPath) => {
				const active = tabPath === currentFilePath;
				const visual = resolveFileVisual(tabPath);
				return `
					<div class="editor-tab${active ? ' active' : ''}" data-tab-path="${tabPath}">
						<span class="editor-tab__icon" style="color:${visual.color}">${renderVisualIcon(visual, 12)}</span>
						<span class="editor-tab__label">${escapeHtml(tabPath)}</span>
						<button type="button" class="editor-tab__close" data-close-tab="${tabPath}">
							<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</div>
				`;
			})
			.join('');
	};

	const syncProjectHeader = (): void => {
		const project = getCurrentProject();
		if (!project) {
			return;
		}

		shell.projectNameDisplay.textContent = project.name;
		shell.projectDot.style.background = project.color;
		shell.languageDisplay.textContent = resolveLanguageLabel(currentFilePath);
		shell.breadcrumbLabel.textContent = currentFilePath;
	};

	const refreshEditorFiles = (): void => {
		const project = getCurrentProject();
		if (!project || !editor) {
			return;
		}

		editor.loadFiles(project.files, currentFilePath);
		syncProjectHeader();
	};

	const selectFile = (path: string): void => {
		currentFilePath = path;
		if (!openTabs.includes(path)) {
			openTabs = [...openTabs, path];
		}
		editor?.openFile(path);
		renderFileTree();
		renderEditorTabs();
		syncProjectHeader();
	};

	const closeTab = (path: string): void => {
		if (openTabs.length <= 1) {
			return;
		}

		openTabs = openTabs.filter((item) => item !== path);
		if (currentFilePath === path) {
			currentFilePath = openTabs[openTabs.length - 1] ?? currentFilePath;
			editor?.openFile(currentFilePath);
		}
		renderEditorTabs();
		renderFileTree();
		syncProjectHeader();
	};

	const switchProject = (projectId: string): void => {
		const project = projects.find((candidate) => candidate.id === projectId);
		if (!project) {
			return;
		}

		currentProjectId = project.id;
		currentFilePath = project.entryFile;
		openTabs = [currentFilePath];
		refreshEditorFiles();
		renderProjectList();
		renderFileTree();
		renderEditorTabs();
		setProjectDropdownState(false);
		void runCurrentProject();
	};

	const editorProject = getCurrentProject();
	if (editorProject) {
		editor = createLiveEditor({
			container: shell.monacoContainer,
			files: editorProject.files,
			activePath: currentFilePath,
			onChange: (path, value) => {
				const project = getCurrentProject();
				if (!project) {
					return;
				}

				const fileIndex = project.files.findIndex((file) => file.path === path);
				if (fileIndex === -1) {
					return;
				}

				project.files[fileIndex] = {
					...project.files[fileIndex]!,
					content: value,
				};
				persistCurrentProject();
			},
			onCursorChange: (lineNumber, column) => {
				shell.cursorPositionLabel.textContent = `Ln ${lineNumber}, Col ${column}`;
			},
		});
	}

	const nativeConsole = {
		log: console.log.bind(console),
		info: console.info.bind(console),
		warn: console.warn.bind(console),
		error: console.error.bind(console),
	};

	console.log = (...args: unknown[]) => {
		nativeConsole.log(...args);
		appendConsoleEntry(consoleEntries, 'log', args.map(String).join(' '));
	};
	console.info = (...args: unknown[]) => {
		nativeConsole.info(...args);
		appendConsoleEntry(consoleEntries, 'info', args.map(String).join(' '));
	};
	console.warn = (...args: unknown[]) => {
		nativeConsole.warn(...args);
		appendConsoleEntry(consoleEntries, 'warn', args.map(String).join(' '));
	};
	console.error = (...args: unknown[]) => {
		nativeConsole.error(...args);
		appendConsoleEntry(problemEntries, 'error', args.map(String).join(' '));
	};

	const fpsState = { frames: 0, last: performance.now() };
	const fpsLoop = (): void => {
		fpsState.frames += 1;
		const now = performance.now();
		if (now - fpsState.last >= 1000) {
			shell.fpsLabel.textContent = String(fpsState.frames);
			fpsState.frames = 0;
			fpsState.last = now;
		}
		requestAnimationFrame(fpsLoop);
	};

	const setProjectDropdownState = (open: boolean): void => {
		projectDropdownOpen = open;
		shell.projectDropdown.style.opacity = open ? '1' : '0';
		shell.projectDropdown.style.transform = open ? 'translateY(0) scale(1)' : 'translateY(-6px) scale(.97)';
		shell.projectDropdown.style.pointerEvents = open ? 'auto' : 'none';
		shell.projectChevron.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
		if (open) {
			applyProjectListFilter();
			queueMicrotask(() => shell.projectSearchInput.focus());
		}
	};

	const toggleProjectDropdown = (): void => {
		setProjectDropdownState(!projectDropdownOpen);
	};

	const toggleConsole = (): void => {
		consoleVisible = !consoleVisible;
		shell.consolePanel.style.display = consoleVisible ? 'flex' : 'none';
		shell.consoleResize.style.display = consoleVisible ? '' : 'none';
	};

	const toggleSidebar = (): void => {
		sidebarVisible = !sidebarVisible;
		shell.sidebar.style.display = sidebarVisible ? 'flex' : 'none';
		shell.sidebarResize.style.display = sidebarVisible ? '' : 'none';
	};

	const toggleLayout = (): void => {
		verticalLayout = !verticalLayout;
		shell.workspace.style.flexDirection = verticalLayout ? 'column' : 'row';
	};

	const openNewProjectModal = (): void => {
		renderTemplateCards(shell, selectedTemplateId);
		setProjectDropdownState(false);
		shell.newProjectModal.style.opacity = '1';
		shell.newProjectModal.style.pointerEvents = 'auto';
		shell.newProjectCard.style.transform = 'translateY(0) scale(1)';
		shell.newProjectNameInput.value = '';
	};

	const closeNewProjectModal = (): void => {
		shell.newProjectModal.style.opacity = '0';
		shell.newProjectModal.style.pointerEvents = 'none';
		shell.newProjectCard.style.transform = 'translateY(12px) scale(.97)';
	};

	const createTemplateFiles = (templateId: string): VirtualProjectFile[] => {
		if (templateId === 'basic') {
			return [
				{
					path: 'main.ts',
					language: 'typescript',
					content: `import type { PlaygroundSceneExample } from '../shared/playground-types';\n\nconst example: PlaygroundSceneExample = {\n  id: 'basic-template',\n  title: 'Basic Template',\n  description: 'Editable project template.',\n  mount({ container }) {\n    container.replaceChildren();\n    const panel = document.createElement('div');\n    panel.style.cssText = 'height:100%;display:flex;align-items:center;justify-content:center;font:600 14px Plus Jakarta Sans,sans-serif;color:#1a1816;background:#f7f6f3';\n    panel.textContent = 'Replace this file with your Axrone scene.';\n    container.appendChild(panel);\n    return { dispose() { container.replaceChildren(); } };\n  },\n};\n\nexport default example;`,
				},
			];
		}

		return [
			{
				path: 'main.ts',
				language: 'typescript',
				content: `import type { PlaygroundSceneExample } from '../shared/playground-types';\n\nconst example: PlaygroundSceneExample = {\n  id: 'blank-template',\n  title: 'Blank Template',\n  description: 'Empty template project.',\n  mount({ container }) {\n    container.replaceChildren();\n    const panel = document.createElement('div');\n    panel.style.cssText = 'height:100%;display:flex;align-items:center;justify-content:center;font:600 14px Plus Jakarta Sans,sans-serif;color:#1a1816;background:#ffffff';\n    panel.textContent = 'Start building your Axrone scene here.';\n    container.appendChild(panel);\n    return { dispose() { container.replaceChildren(); } };\n  },\n};\n\nexport default example;`,
			},
		];
	};

	const createProject = (): void => {
		const name = shell.newProjectNameInput.value.trim();
		if (!name) {
			return;
		}

		const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `project-${Date.now()}`;
		const palette = ['#c2410c', '#2563eb', '#15803d', '#7c3aed', '#0d9488', '#b45309'];
		projects.push({
			id,
			name,
			color: palette[projects.length % palette.length]!,
			description: selectedTemplateId === 'basic' ? 'Basic scene template' : 'Blank scene template',
			entryFile: 'main.ts',
			files: createTemplateFiles(selectedTemplateId),
			builtIn: false,
		});
		closeNewProjectModal();
		renderProjectList();
		switchProject(id);
	};

	const setCameraPreset = (preset: PlaygroundCameraPreset): void => {
		runtimeSession?.handle.setCameraPreset?.(preset);
		shell.cameraLabel.textContent = resolveCameraPresetLabel(preset);
		for (const option of shell.cameraDropdown.querySelectorAll<HTMLElement>('.cam-opt')) {
			option.classList.toggle('active', option.dataset.cam === preset);
		}
		shell.cameraDropdown.classList.remove('open');
	};

	const initResize = (
		handle: HTMLElement,
		panel: HTMLElement,
		direction: 'horizontal' | 'vertical',
		minSize: number,
	): void => {
		let startPointer = 0;
		let startSize = 0;

		handle.addEventListener('mousedown', (event) => {
			event.preventDefault();
			startPointer = direction === 'horizontal' ? event.clientX : event.clientY;
			startSize = direction === 'horizontal' ? panel.offsetWidth : panel.offsetHeight;
			handle.classList.add('drag');

			const move = (moveEvent: MouseEvent) => {
				const delta = (direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY) - startPointer;
				const nextSize = Math.max(minSize, startSize + delta);
				if (direction === 'horizontal') {
					panel.style.width = `${nextSize}px`;
					panel.style.flex = 'none';
				} else {
					panel.style.height = `${nextSize}px`;
					panel.style.flex = 'none';
				}
			};

			const end = () => {
				handle.classList.remove('drag');
				document.removeEventListener('mousemove', move);
				document.removeEventListener('mouseup', end);
			};

			document.addEventListener('mousemove', move);
			document.addEventListener('mouseup', end);
		});
	};

	shell.runButton.addEventListener('click', () => void runCurrentProject());
	shell.stopButton.addEventListener('click', () => void stopCurrentRuntime());
	shell.restartButton.addEventListener('click', () => void runCurrentProject());
	shell.playButton.addEventListener('click', () => {
		playing = !playing;
		runtimeSession?.handle.setPlaying?.(playing);
		updatePlayIcon();
	});
	shell.wireframeButton.addEventListener('click', () => {
		wireframe = !wireframe;
		runtimeSession?.handle.setWireframe?.(wireframe);
		updateControlState();
	});
	shell.gridButton.addEventListener('click', () => {
		gridVisible = !gridVisible;
		runtimeSession?.handle.setGridVisible?.(gridVisible);
		updateControlState();
	});
	shell.axesButton.addEventListener('click', () => {
		axesVisible = !axesVisible;
		runtimeSession?.handle.setAxesVisible?.(axesVisible);
		updateControlState();
	});
	shell.cameraButton.addEventListener('click', () => {
		shell.cameraDropdown.classList.toggle('open');
	});
	for (const option of shell.cameraDropdown.querySelectorAll<HTMLElement>('.cam-opt')) {
		option.addEventListener('click', () => {
			const preset = option.dataset.cam as PlaygroundCameraPreset | undefined;
			if (preset) {
				setCameraPreset(preset);
			}
		});
	}
	shell.toggleConsoleButton.addEventListener('click', toggleConsole);
	shell.toggleSidebarButton.addEventListener('click', toggleSidebar);
	shell.toggleLayoutButton.addEventListener('click', toggleLayout);
	requireElement(root, '#proj-trigger').addEventListener('click', toggleProjectDropdown);
	shell.newProjectOpenButton.addEventListener('click', openNewProjectModal);
	for (const closeButton of shell.newProjectCloseButtons) {
		closeButton.addEventListener('click', closeNewProjectModal);
	}
	shell.newProjectCreateButton.addEventListener('click', createProject);
	shell.newProjectTemplates.addEventListener('click', (event) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-template-id]');
		if (!target?.dataset.templateId) {
			return;
		}

		selectedTemplateId = target.dataset.templateId;
		renderTemplateCards(shell, selectedTemplateId);
	});
	shell.projectList.addEventListener('click', (event) => {
		const card = (event.target as HTMLElement).closest<HTMLElement>('[data-project-id]');
		if (card?.dataset.projectId) {
			switchProject(card.dataset.projectId);
		}
	});
	shell.projectSearchInput.addEventListener('input', applyProjectListFilter);
	shell.fileTree.addEventListener('click', (event) => {
		const folder = (event.target as HTMLElement).closest<HTMLElement>('[data-folder-path]');
		if (folder?.dataset.folderPath) {
			if (collapsedFolders.has(folder.dataset.folderPath)) {
				collapsedFolders.delete(folder.dataset.folderPath);
			} else {
				collapsedFolders.add(folder.dataset.folderPath);
			}
			renderFileTree();
			return;
		}

		const item = (event.target as HTMLElement).closest<HTMLElement>('[data-file-path]');
		if (item?.dataset.filePath) {
			selectFile(item.dataset.filePath);
		}
	});
	shell.editorTabs.addEventListener('click', (event) => {
		const closeButton = (event.target as HTMLElement).closest<HTMLElement>('[data-close-tab]');
		if (closeButton?.dataset.closeTab) {
			event.stopPropagation();
			closeTab(closeButton.dataset.closeTab);
			return;
		}

		const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-path]');
		if (tab?.dataset.tabPath) {
			selectFile(tab.dataset.tabPath);
		}
	});
	shell.consoleTabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			activeConsoleTab = tab.dataset.ct as ConsoleTab;
			for (const candidate of shell.consoleTabs) {
				candidate.classList.toggle('active', candidate === tab);
			}
			renderConsoleOutput();
		});
	});
	requireElement(root, '#clear-console').addEventListener('click', () => {
		consoleEntries.length = 0;
		problemEntries.length = 0;
		outputEntries.length = 0;
		renderConsoleOutput();
	});
	requireElement(root, '#close-console').addEventListener('click', toggleConsole);
	shell.fullscreenButton.addEventListener('click', async () => {
		if (document.fullscreenElement) {
			await document.exitFullscreen();
			return;
		}

		await shell.previewContainer.requestFullscreen();
	});

	initResize(shell.sidebarResize, shell.sidebar, 'horizontal', 160);
	initResize(shell.editorResize, shell.editorPanel, 'horizontal', 280);
	initResize(shell.consoleResize, shell.consolePanel, 'vertical', 80);

	renderProjectList();
	renderFileTree();
	renderEditorTabs();
	renderConsoleOutput();
	syncProjectHeader();
	shell.cameraLabel.textContent = resolveCameraPresetLabel('perspective');
	updateControlState();
	fpsLoop();
	appendConsoleEntry(outputEntries, 'info', 'Axrone Playground initialized.');
	appendConsoleEntry(outputEntries, 'log', 'Press Ctrl+Enter to run the current project.');
	void runCurrentProject();

	document.addEventListener('click', (event) => {
		const target = event.target as Node | null;
		if (!target) {
			return;
		}

		if (!shell.projectDropdown.contains(target) && !requireElement(root, '#proj-trigger').contains(target)) {
			setProjectDropdownState(false);
		}

		if (!shell.cameraDropdown.contains(target) && !shell.cameraButton.contains(target)) {
			shell.cameraDropdown.classList.remove('open');
		}
	});

	document.addEventListener('keydown', (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			void runCurrentProject();
		}
		if (event.key === 'Escape') {
			closeNewProjectModal();
			shell.cameraDropdown.classList.remove('open');
			setProjectDropdownState(false);
		}
	});
};

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required element: ${selector}`);
	}

	return element;
};