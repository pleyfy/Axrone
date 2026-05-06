const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required shell element: ${selector}`);
	}

	return element;
};

export type PlaygroundShell = {
	readonly projectDropdown: HTMLDivElement;
	readonly projectChevron: HTMLSpanElement;
	readonly projectList: HTMLDivElement;
	readonly projectCount: HTMLSpanElement;
	readonly projectNameDisplay: HTMLSpanElement;
	readonly projectDot: HTMLSpanElement;
	readonly fileTree: HTMLDivElement;
	readonly fileCountText: HTMLSpanElement;
	readonly editorTabs: HTMLDivElement;
	readonly monacoContainer: HTMLDivElement;
	readonly previewContainer: HTMLDivElement;
	readonly previewStage: HTMLDivElement;
	readonly consoleOut: HTMLDivElement;
	readonly consoleTabs: readonly HTMLDivElement[];
	readonly problemCount: HTMLSpanElement;
	readonly statusDot: HTMLSpanElement;
	readonly statusText: HTMLSpanElement;
	readonly fpsLabel: HTMLSpanElement;
	readonly objectCountLabel: HTMLSpanElement;
	readonly languageDisplay: HTMLSpanElement;
	readonly cursorPositionLabel: HTMLSpanElement;
	readonly sidebar: HTMLElement;
	readonly sidebarResize: HTMLElement;
	readonly editorPanel: HTMLElement;
	readonly editorResize: HTMLElement;
	readonly consolePanel: HTMLElement;
	readonly consoleResize: HTMLElement;
	readonly workspace: HTMLElement;
	readonly ctrlBar: HTMLDivElement;
	readonly cameraDropdown: HTMLDivElement;
	readonly runButton: HTMLButtonElement;
	readonly stopButton: HTMLButtonElement;
	readonly restartButton: HTMLButtonElement;
	readonly toggleLayoutButton: HTMLButtonElement;
	readonly toggleConsoleButton: HTMLButtonElement;
	readonly toggleSidebarButton: HTMLButtonElement;
	readonly playButton: HTMLButtonElement;
	readonly wireframeButton: HTMLButtonElement;
	readonly gridButton: HTMLButtonElement;
	readonly axesButton: HTMLButtonElement;
	readonly cameraButton: HTMLButtonElement;
	readonly ctrlInfo: HTMLSpanElement;
	readonly newProjectModal: HTMLDivElement;
	readonly newProjectCard: HTMLDivElement;
	readonly newProjectNameInput: HTMLInputElement;
	readonly newProjectTemplates: HTMLDivElement;
	readonly newProjectOpenButton: HTMLButtonElement;
	readonly newProjectCloseButtons: readonly HTMLButtonElement[];
	readonly newProjectCreateButton: HTMLButtonElement;
	readonly fullscreenButton: HTMLButtonElement;
	readonly editorStatus: HTMLParagraphElement;
	readonly editorSupportedImports: HTMLParagraphElement;
};

export const renderPlaygroundShell = (root: HTMLElement): PlaygroundShell => {
	root.innerHTML = `
		<div id="app-shell" class="app-shell h-full flex flex-col bg-canvas text-ink">
			<header class="app-header h-11 flex items-center justify-between bg-surface border-b border-border shrink-0">
				<div class="app-header__lead flex items-center gap-3">
					<div class="flex items-center justify-center w-7 h-7 bg-accent rounded-md">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" fill="#fff"/><rect x="9" y="1" width="6" height="6" rx="1" fill="#fff" opacity=".6"/><rect x="1" y="9" width="6" height="6" rx="1" fill="#fff" opacity=".6"/><rect x="9" y="9" width="6" height="6" rx="1" fill="#fff" opacity=".3"/></svg>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-sm font-semibold">Axrone</span>
						<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent-s text-accent tracking-wide">PLAYGROUND</span>
					</div>
					<div class="w-px h-5 bg-border mx-1"></div>
					<div class="relative" id="proj-switcher">
						<button id="proj-trigger" type="button" class="project-trigger flex items-center rounded-md border border-border hover:border-border-s bg-canvas hover:bg-canvas-alt transition-all cursor-pointer group">
							<span class="w-2 h-2 rounded-full shrink-0" id="proj-dot"></span>
							<span class="project-trigger__label text-xs font-semibold text-ink" id="proj-name-display">Loading</span>
							<span id="proj-chevron" class="text-ink-3 transition-transform">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
							</span>
						</button>
						<div id="project-dropdown" class="project-dropdown absolute top-full left-0 mt-2 bg-surface border border-border rounded-xl shadow-lg z-50 overflow-hidden" style="opacity:0;transform:translateY(-6px) scale(.97);pointer-events:none;transition:opacity .15s,transform .15s">
							<div class="px-3 py-2.5 border-b border-border flex items-center justify-between">
								<span class="text-[11px] font-semibold text-ink-3 tracking-wider uppercase">Projects</span>
								<span class="text-[11px] text-ink-3" id="proj-count">0 projects</span>
							</div>
							<div class="project-dropdown__list max-h-[320px] overflow-y-auto" id="proj-list"></div>
							<div class="border-t border-border px-1.5 py-1.5">
								<button id="new-project-open" type="button" class="project-dropdown__action flex items-center gap-2 w-full rounded-lg text-ink-2 hover:bg-canvas-alt hover:text-accent transition-colors">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
									New Project
								</button>
							</div>
						</div>
					</div>
				</div>
				<div class="flex items-center gap-1.5">
					<button id="run-button" type="button" class="tbtn pri" data-tip="Run — Ctrl+Enter"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg></button>
					<button id="stop-button" type="button" class="tbtn dng" data-tip="Stop"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
					<button id="restart-button" type="button" class="tbtn" data-tip="Restart"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
					<div class="w-px h-5 bg-border mx-1"></div>
					<button id="toggle-layout" type="button" class="tbtn" data-tip="Toggle Layout"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg></button>
					<button id="toggle-console" type="button" class="tbtn" data-tip="Console"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></button>
					<div class="w-px h-5 bg-border mx-1"></div>
					<button type="button" class="tbtn" data-tip="Settings"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></button>
				</div>
			</header>
			<div class="flex-1 flex overflow-hidden">
				<aside id="sidebar" class="sidebar-panel w-[176px] bg-surface border-r border-border flex flex-col shrink-0 overflow-hidden">
					<div class="sidebar-header flex items-center justify-between border-b border-border">
						<span class="text-[11px] font-semibold text-ink-3 tracking-wider uppercase">Files</span>
						<div class="flex items-center gap-0.5">
							<button type="button" class="tbtn xs" data-tip="Search"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></button>
							<button id="toggle-sidebar" type="button" class="tbtn xs" data-tip="Collapse"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button>
						</div>
					</div>
					<div class="sidebar-tree flex-1 overflow-y-auto" id="file-tree"></div>
					<div class="px-3 py-2 border-t border-border text-[11px] text-ink-3 flex items-center gap-2"><span class="dot on"></span><span id="file-count-text">0 files</span></div>
				</aside>
				<div class="rh" id="sb-resize"></div>
				<div id="content" class="flex-1 flex flex-col overflow-hidden">
					<div id="workspace" class="flex-1 flex overflow-hidden">
						<div id="editor-panel" class="flex flex-col overflow-hidden" style="flex:1 1 58%;min-width:360px">
							<div class="editor-tabs-shell flex items-center border-b border-border bg-canvas shrink-0"><div class="flex items-center" id="editor-tabs"></div></div>
							<div id="monaco-c" class="flex-1"></div>
							<div class="h-8 border-t border-border bg-canvas-alt px-4 flex items-center justify-between text-[11px]"><p id="editor-status" class="text-ink-2">Editor ready</p><p id="editor-supported-imports" class="truncate text-ink-3"></p></div>
						</div>
						<div class="rh" id="ep-resize"></div>
						<div id="preview-panel" class="flex flex-col overflow-hidden" style="flex:1 1 42%;min-width:320px">
							<div class="flex items-center justify-between px-3 py-1.5 border-b border-border bg-canvas shrink-0">
								<div class="flex items-center gap-2"><span class="text-[11px] font-semibold text-ink-3 tracking-wider uppercase">Preview</span><span class="fps" id="fps">— FPS</span><span class="text-[11px] text-ink-3" id="obj-count"></span></div>
								<div class="flex items-center gap-0.5"><button id="fullscreen-button" type="button" class="tbtn xs" data-tip="Fullscreen"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button></div>
							</div>
							<div id="preview-container" class="flex-1 relative overflow-hidden" style="background:#F0EFEC">
								<div id="preview-stage" class="absolute inset-0"></div>
								<div class="ctrl-bar" id="ctrl-bar">
									<button id="btn-play" type="button" class="tbtn xs" data-tip="Play/Pause"><svg id="icon-play" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="display:none"><polygon points="5 3 19 12 5 21"/></svg><svg id="icon-pause" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></button>
									<button id="btn-stop-mini" type="button" class="tbtn xs" data-tip="Stop"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
									<button id="btn-restart-mini" type="button" class="tbtn xs" data-tip="Restart"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>
									<div class="sep"></div>
									<button id="btn-wire" type="button" class="tbtn xs" data-tip="Wireframe"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l10 6v8l-10 6L2 16V8z"/><path d="M12 2v20M2 8l10 6 10-6"/></svg></button>
									<button id="btn-grid" type="button" class="tbtn xs active-t" data-tip="Grid"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg></button>
									<button id="btn-axes" type="button" class="tbtn xs" data-tip="Axes"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="21" x2="3" y2="3"/><line x1="3" y1="21" x2="21" y2="21"/><path d="M3 17l4-4 3 3 5-5"/></svg></button>
									<div class="sep"></div>
									<div class="relative"><button id="btn-cam" type="button" class="tbtn xs" data-tip="Camera"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button><div class="cam-dd" id="cam-dropdown"><div class="cam-opt active" data-cam="perspective">Perspective</div><div class="cam-opt" data-cam="front">Front</div><div class="cam-opt" data-cam="top">Top</div><div class="cam-opt" data-cam="right">Right</div></div></div>
									<div class="sep"></div>
									<span class="text-[10px] font-mono font-medium text-ink-3 px-1" id="ctrl-info">—</span>
								</div>
							</div>
						</div>
					</div>
					<div class="rv" id="con-resize"></div>
					<div id="console-panel" class="h-[170px] bg-surface border-t border-border flex flex-col shrink-0 overflow-hidden">
						<div class="flex items-center justify-between px-2 border-b border-border shrink-0">
							<div class="flex items-center"><div class="tab active" data-ct="console">Console</div><div class="tab" data-ct="problems">Problems <span class="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-canvas-alt text-[10px] font-semibold text-ink-3" id="pcount">0</span></div><div class="tab" data-ct="output">Output</div></div>
							<div class="flex items-center gap-0.5"><button id="clear-console" type="button" class="tbtn xs" data-tip="Clear"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button><button id="close-console" type="button" class="tbtn xs" data-tip="Close"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>
						</div>
						<div id="console-out" class="flex-1 overflow-y-auto"></div>
					</div>
				</div>
			</div>
			<footer class="h-[26px] flex items-center justify-between px-4 bg-canvas-alt border-t border-border shrink-0 text-[11px]"><div class="flex items-center gap-3"><div class="flex items-center gap-1.5"><span class="dot id" id="sdot"></span><span class="text-ink-2" id="stxt">Stopped</span></div><div class="w-px h-3 bg-border"></div><span class="text-ink-3" id="lang-display">TypeScript</span></div><div class="flex items-center gap-3"><span class="text-ink-3" id="cpos">Ln 1, Col 1</span><div class="w-px h-3 bg-border"></div><span class="text-ink-3">UTF-8</span><div class="w-px h-3 bg-border"></div><span class="text-ink-3">Spaces: 2</span></div></footer>
			<div id="new-project-modal" class="fixed inset-0 z-[200] flex items-center justify-center px-6" style="opacity:0;pointer-events:none;transition:opacity .2s">
				<div class="new-project-modal__overlay absolute inset-0" data-modal-close="true"></div>
				<div id="modal-card" class="new-project-modal__card relative bg-surface overflow-hidden" style="transform:translateY(12px) scale(.97);transition:transform .2s">
					<div class="new-project-modal__header">
						<div>
							<p class="new-project-modal__eyebrow">Playground</p>
							<h2 class="new-project-modal__title">Create New Project</h2>
						</div>
						<button type="button" class="tbtn xs" data-modal-close="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
					</div>
					<div class="new-project-modal__body">
						<label class="new-project-field">
							<span class="new-project-field__label">Project Name</span>
							<input id="np-name" type="text" placeholder="My Awesome Project" class="new-project-field__input">
						</label>
						<div class="new-project-field">
							<span class="new-project-field__label">Template</span>
							<div class="new-project-templates" id="np-templates"></div>
						</div>
					</div>
					<div class="new-project-modal__footer">
						<button type="button" data-modal-close="true" class="new-project-button new-project-button--ghost">Cancel</button>
						<button id="create-project" type="button" class="new-project-button new-project-button--primary">Create Project</button>
					</div>
				</div>
			</div>
		</div>
	`;

	return {
		projectDropdown: requireElement(root, '#project-dropdown'),
		projectChevron: requireElement(root, '#proj-chevron'),
		projectList: requireElement(root, '#proj-list'),
		projectCount: requireElement(root, '#proj-count'),
		projectNameDisplay: requireElement(root, '#proj-name-display'),
		projectDot: requireElement(root, '#proj-dot'),
		fileTree: requireElement(root, '#file-tree'),
		fileCountText: requireElement(root, '#file-count-text'),
		editorTabs: requireElement(root, '#editor-tabs'),
		monacoContainer: requireElement(root, '#monaco-c'),
		previewContainer: requireElement(root, '#preview-container'),
		previewStage: requireElement(root, '#preview-stage'),
		consoleOut: requireElement(root, '#console-out'),
		consoleTabs: [...root.querySelectorAll<HTMLDivElement>('#console-panel .tab')],
		problemCount: requireElement(root, '#pcount'),
		statusDot: requireElement(root, '#sdot'),
		statusText: requireElement(root, '#stxt'),
		fpsLabel: requireElement(root, '#fps'),
		objectCountLabel: requireElement(root, '#obj-count'),
		languageDisplay: requireElement(root, '#lang-display'),
		cursorPositionLabel: requireElement(root, '#cpos'),
		sidebar: requireElement(root, '#sidebar'),
		sidebarResize: requireElement(root, '#sb-resize'),
		editorPanel: requireElement(root, '#editor-panel'),
		editorResize: requireElement(root, '#ep-resize'),
		consolePanel: requireElement(root, '#console-panel'),
		consoleResize: requireElement(root, '#con-resize'),
		workspace: requireElement(root, '#workspace'),
		ctrlBar: requireElement(root, '#ctrl-bar'),
		cameraDropdown: requireElement(root, '#cam-dropdown'),
		runButton: requireElement(root, '#run-button'),
		stopButton: requireElement(root, '#stop-button'),
		restartButton: requireElement(root, '#restart-button'),
		toggleLayoutButton: requireElement(root, '#toggle-layout'),
		toggleConsoleButton: requireElement(root, '#toggle-console'),
		toggleSidebarButton: requireElement(root, '#toggle-sidebar'),
		playButton: requireElement(root, '#btn-play'),
		wireframeButton: requireElement(root, '#btn-wire'),
		gridButton: requireElement(root, '#btn-grid'),
		axesButton: requireElement(root, '#btn-axes'),
		cameraButton: requireElement(root, '#btn-cam'),
		ctrlInfo: requireElement(root, '#ctrl-info'),
		newProjectModal: requireElement(root, '#new-project-modal'),
		newProjectCard: requireElement(root, '#modal-card'),
		newProjectNameInput: requireElement(root, '#np-name'),
		newProjectTemplates: requireElement(root, '#np-templates'),
		newProjectOpenButton: requireElement(root, '#new-project-open'),
		newProjectCloseButtons: [...root.querySelectorAll<HTMLButtonElement>('[data-modal-close="true"]')],
		newProjectCreateButton: requireElement(root, '#create-project'),
		fullscreenButton: requireElement(root, '#fullscreen-button'),
		editorStatus: requireElement(root, '#editor-status'),
		editorSupportedImports: requireElement(root, '#editor-supported-imports'),
	};
};