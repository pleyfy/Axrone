import { compileSceneProject, getSupportedPlaygroundImports } from '../playground/live-example-runtime';
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

const resolveToneClass = (tone: ConsoleTone): string => {
	switch (tone) {
		case 'info':
			return 'text-info';
		case 'warn':
			return 'text-warn';
		case 'error':
			return 'text-err';
		case 'success':
			return 'text-ok';
		default:
			return 'text-ink-2';
	}
};

const resolveToneIcon = (tone: ConsoleTone): string => {
	switch (tone) {
		case 'info':
			return 'i';
		case 'warn':
			return '!';
		case 'error':
			return 'x';
		case 'success':
			return 'v';
		default:
			return '>'; 
	}
};

const createProjectFilesMap = (files: readonly VirtualProjectFile[]): Record<string, string> =>
	Object.fromEntries(files.map((file) => [file.path, file.content]));

const resolveLanguageLabel = (path: string): string => (path.endsWith('.js') ? 'JavaScript' : 'TypeScript');

const renderTemplateCards = (shell: PlaygroundShell, selectedTemplateId: string): void => {
	const templates = [
		{ id: 'blank', name: 'Blank Scene', desc: 'Empty Axrone scene with camera and viewport.', accent: '#c2410c', badge: 'AX' },
		{ id: 'basic', name: 'Basic Scene', desc: 'Starter scene with floor, cube, and default lighting.', accent: '#2563eb', badge: '3D' },
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
	const consoleEntries: ConsoleEntry[] = [];
	const problemEntries: ConsoleEntry[] = [];
	const outputEntries: ConsoleEntry[] = [];

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
					<div class="ce fi">
						<span class="text-ink-3 shrink-0">${entry.time}</span>
						<span class="${resolveToneClass(entry.tone)} shrink-0 font-medium">${resolveToneIcon(entry.tone)}</span>
						<span class="text-ink break-all">${entry.message.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char))}</span>
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
		shell.objectCountLabel.textContent = runtimeSession ? `· ${runtimeSession.objectCount} obj` : '';
		shell.ctrlInfo.textContent = runtimeSession?.summary ?? '—';
	};

	const stopCurrentRuntime = async (): Promise<void> => {
		const currentSession = runtimeSession;
		runtimeSession = undefined;
		updateRuntimeSummary();
		if (!currentSession) {
			shell.previewStage.replaceChildren();
			setStatus('Stopped', 'stopped');
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
			appendConsoleEntry(outputEntries, 'info', `Mounted ${sceneExample.title}`);
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
					<div class="proj-card ${selected ? 'selected' : ''}" data-project-id="${project.id}">
						<div class="proj-card__swatch" style="background:${project.color}"></div>
						<div class="proj-card__body"><div class="proj-card__title-row"><span class="proj-card__title">${project.name}</span>${selected ? '<span class="proj-card__badge">Active</span>' : ''}</div><span class="proj-card__desc">${project.description}</span><span class="proj-card__meta">${project.files.length} files</span></div>
					</div>
				`;
			})
			.join('');
		shell.projectCount.textContent = `${projects.length} projects`;
	};

	const renderFileTree = (): void => {
		const project = getCurrentProject();
		if (!project) {
			shell.fileTree.innerHTML = '';
			shell.fileCountText.textContent = '0 files';
			return;
		}

		shell.fileTree.innerHTML = project.files
			.map((file) => {
				const active = file.path === currentFilePath;
				return `
					<div class="explorer-item${active ? ' active' : ''}" data-file-path="${file.path}">
						<svg class="explorer-item__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${active ? '#C2410C' : '#9C958D'}" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
						<span class="explorer-item__label">${file.path}</span>
					</div>
				`;
			})
			.join('');
		shell.fileCountText.textContent = `${project.files.length} files`;
	};

	const renderEditorTabs = (): void => {
		shell.editorTabs.innerHTML = openTabs
			.map((tabPath) => {
				const active = tabPath === currentFilePath;
				return `
					<div class="editor-tab${active ? ' active' : ''}" data-tab-path="${tabPath}">
						<svg class="editor-tab__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${active ? '#C2410C' : '#9C958D'}" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
						<span class="editor-tab__label">${tabPath}</span>
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
		shell.editorStatus.textContent = `${project.name} · ${currentFilePath}`;
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

	shell.editorSupportedImports.textContent = getSupportedPlaygroundImports().join(', ');

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
			shell.fpsLabel.textContent = `${fpsState.frames} FPS`;
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
	shell.fileTree.addEventListener('click', (event) => {
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
	updateControlState();
	fpsLoop();
	appendConsoleEntry(outputEntries, 'info', 'Axrone Playground initialized');
	appendConsoleEntry(outputEntries, 'log', 'Press Ctrl+Enter to run the current project');
	void runCurrentProject();

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