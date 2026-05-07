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
	readonly projectSearchInput: HTMLInputElement;
	readonly projectList: HTMLDivElement;
	readonly projectCount: HTMLSpanElement;
	readonly projectNameDisplay: HTMLSpanElement;
	readonly projectDot: HTMLSpanElement;
	readonly fileTree: HTMLDivElement;
	readonly fileCountText: HTMLSpanElement;
	readonly editorTabs: HTMLDivElement;
	readonly breadcrumbLabel: HTMLSpanElement;
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
	readonly cameraLabel: HTMLSpanElement;
	readonly ctrlInfo: HTMLSpanElement;
	readonly newProjectModal: HTMLDivElement;
	readonly newProjectCard: HTMLDivElement;
	readonly newProjectNameInput: HTMLInputElement;
	readonly newProjectTemplates: HTMLDivElement;
	readonly newProjectOpenButton: HTMLButtonElement;
	readonly newProjectCloseButtons: readonly HTMLButtonElement[];
	readonly newProjectCreateButton: HTMLButtonElement;
	readonly fullscreenButton: HTMLButtonElement;
};

export const renderPlaygroundShell = (root: HTMLElement): PlaygroundShell => {
	root.innerHTML = `
		<div id="app-shell" class="app-shell">
			<header class="app-header">
				<div class="app-header__lead">
					<div class="app-brand">
						<div class="app-brand__icon" aria-hidden="true">
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
								<path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" stroke="white" stroke-width="1.5"></path>
								<path d="M8 1V15" stroke="white" stroke-width="1" opacity="0.5"></path>
								<path d="M2 4.5L14 11.5" stroke="white" stroke-width="1" opacity="0.5"></path>
								<path d="M14 4.5L2 11.5" stroke="white" stroke-width="1" opacity="0.5"></path>
							</svg>
						</div>
						<span class="app-brand__name">Axrone</span>
						<span class="app-brand__badge">PLAYGROUND</span>
					</div>
					<div class="app-divider"></div>
					<div class="project-switcher" id="proj-switcher">
						<button id="proj-trigger" type="button" class="project-trigger">
							<span class="project-trigger__mark">
								<span class="project-trigger__dot" id="proj-dot"></span>
							</span>
							<span class="project-trigger__label" id="proj-name-display">Loading</span>
							<span id="proj-chevron" class="project-trigger__chevron" aria-hidden="true">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"></path></svg>
							</span>
						</button>
						<div id="project-dropdown" class="project-dropdown" style="opacity:0;transform:translateY(-6px) scale(.97);pointer-events:none;transition:opacity .15s,transform .15s">
							<div class="project-dropdown__search">
								<svg class="project-dropdown__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
								<input id="proj-search" type="text" class="project-dropdown__search-input" placeholder="Proje ara...">
							</div>
							<div class="project-dropdown__meta-row">
								<span class="project-dropdown__eyebrow">Projects</span>
								<span class="project-dropdown__count" id="proj-count">0 projects</span>
							</div>
							<div class="project-dropdown__list" id="proj-list"></div>
							<div class="project-dropdown__footer">
								<button id="new-project-open" type="button" class="project-dropdown__action project-dropdown__action--primary">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
									<span>Create New Project</span>
								</button>
								<button type="button" class="project-dropdown__action project-dropdown__action--ghost" disabled>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
									<span>Open Existing Project</span>
								</button>
							</div>
						</div>
					</div>
					<div class="app-divider"></div>
					<nav class="top-menu" aria-label="Main">
						<button type="button" class="top-menu__button">Dosya</button>
						<button type="button" class="top-menu__button">Edit</button>
						<button type="button" class="top-menu__button">View</button>
						<button type="button" class="top-menu__button">Tools</button>
					</nav>
				</div>
				<div class="app-header__actions">
					<div class="header-run-group">
							<button id="run-button" type="button" class="toolbar-pill toolbar-pill--primary" data-tip="Run — Ctrl+Enter">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"></polygon></svg>
							<span>Run</span>
						</button>
						<button id="restart-button" type="button" class="toolbar-pill" data-tip="Restart">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"></path><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
						</button>
						<button id="stop-button" type="button" class="toolbar-pill toolbar-pill--danger" data-tip="Stop">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
						</button>
					</div>
					<div class="app-divider"></div>
					<div class="header-icon-group">
						<button id="toggle-layout" type="button" class="tbtn" data-tip="Toggle Layout">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
						</button>
						<button id="toggle-console" type="button" class="tbtn" data-tip="Console">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
						</button>
					</div>
					<div class="app-divider"></div>
					<div class="header-status">
						<span class="dot id" id="sdot"></span>
						<span id="stxt">Ready</span>
					</div>
					<div class="app-divider"></div>
					<div class="header-icon-group">
						<button type="button" class="tbtn" data-tip="Settings">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>
						</button>
						<button type="button" class="tbtn" data-tip="Notifications">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"></path><path d="M9 17a3 3 0 0 0 6 0"></path></svg>
						</button>
					</div>
				</div>
			</header>
			<div class="app-main">
				<aside id="sidebar" class="sidebar-panel">
					<div class="sidebar-tabs">
						<button type="button" class="sidebar-tabs__button sidebar-tabs__button--active">Files</button>
						<button type="button" class="sidebar-tabs__button" disabled>Assets</button>
					</div>
					<div class="sidebar-header">
						<span class="sidebar-header__title">Explorer</span>
						<button id="toggle-sidebar" type="button" class="tbtn xs" data-tip="Collapse">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
						</button>
					</div>
					<div class="sidebar-tree" id="file-tree"></div>
					<div class="sidebar-footer">
						<span class="sidebar-footer__meta" id="file-count-text">0 files</span>
					</div>
				</aside>
				<div class="rh" id="sb-resize"></div>
				<div id="content" class="content-shell">
					<div id="workspace" class="workspace-shell">
						<div id="editor-panel" class="editor-panel" style="flex:1 1 45%;min-width:360px">
							<div class="editor-tabs-shell">
								<div id="editor-tabs"></div>
							</div>
							<div class="editor-breadcrumb">
								<span class="editor-breadcrumb__root">src</span>
								<svg class="editor-breadcrumb__sep" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"></path></svg>
								<span class="editor-breadcrumb__current" id="file-breadcrumb">main.ts</span>
							</div>
							<div id="monaco-c" class="editor-surface"></div>
						</div>
						<div class="rh" id="ep-resize"></div>
						<div id="preview-panel" class="preview-panel" style="flex:1 1 55%;min-width:320px">
							<div class="preview-toolbar">
								<div class="preview-toolbar__group">
									<button id="btn-play" type="button" class="tbtn preview-tool" data-tip="Oynat / Duraklat">
										<svg id="icon-play" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:none"><polygon points="5 3 19 12 5 21"></polygon></svg>
										<svg id="icon-pause" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
									</button>
									<button id="btn-grid" type="button" class="tbtn preview-tool active-t" data-tip="Izgara">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
									</button>
									<button id="btn-wire" type="button" class="tbtn preview-tool" data-tip="Tel Kafes">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l10 6v8l-10 6L2 16V8z"></path><path d="M12 2v20M2 8l10 6 10-6"></path></svg>
									</button>
									<button id="btn-axes" type="button" class="tbtn preview-tool" data-tip="Eksenler">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="21" x2="3" y2="3"></line><line x1="3" y1="21" x2="21" y2="21"></line><path d="M3 17l4-4 3 3 5-5"></path></svg>
									</button>
								</div>
								<div class="preview-toolbar__group preview-toolbar__group--end">
									<div class="preview-camera">
										<button id="btn-cam" type="button" class="preview-camera__button">
											<span id="cam-label">Perspective</span>
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"></path></svg>
										</button>
										<div class="cam-dd" id="cam-dropdown">
											<div class="cam-opt active" data-cam="perspective">Perspective</div>
											<div class="cam-opt" data-cam="front">Front</div>
											<div class="cam-opt" data-cam="top">Top</div>
											<div class="cam-opt" data-cam="right">Right</div>
										</div>
									</div>
									<button id="fullscreen-button" type="button" class="tbtn preview-tool" data-tip="Fullscreen">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
									</button>
								</div>
							</div>
							<div id="preview-container" class="preview-container">
								<div id="preview-stage" class="preview-stage"></div>
								<div class="ctrl-bar" id="ctrl-bar">
									<div class="viewport-stat">FPS: <strong id="fps">—</strong></div>
									<div class="viewport-stat">Objects: <strong id="obj-count">—</strong></div>
									<div class="viewport-stat">Status: <strong id="ctrl-info">—</strong></div>
								</div>
								<div class="viewport-axis" aria-hidden="true">
									<svg width="60" height="60" viewBox="0 0 60 60">
										<line x1="30" y1="30" x2="55" y2="30" stroke="#ef4444" stroke-width="2"></line>
										<text x="56" y="34" fill="#ef4444" font-size="10" font-weight="600">X</text>
										<line x1="30" y1="30" x2="30" y2="5" stroke="#22c55e" stroke-width="2"></line>
										<text x="26" y="4" fill="#22c55e" font-size="10" font-weight="600">Y</text>
										<line x1="30" y1="30" x2="12" y2="45" stroke="#3b82f6" stroke-width="2"></line>
										<text x="4" y="50" fill="#3b82f6" font-size="10" font-weight="600">Z</text>
									</svg>
								</div>
							</div>
						</div>
					</div>
					<div class="rv" id="con-resize"></div>
					<div id="console-panel" class="console-panel">
						<div class="console-panel__header">
							<div class="console-panel__tabs">
								<div class="tab active" data-ct="console">Console</div>
								<div class="tab" data-ct="output">Output</div>
								<div class="tab" data-ct="problems">Problems <span class="console-panel__badge" id="pcount">0</span></div>
							</div>
							<div class="console-panel__actions">
								<button id="clear-console" type="button" class="tbtn xs" data-tip="Clear Console">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
								</button>
								<button id="close-console" type="button" class="tbtn xs" data-tip="Close">
									<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
								</button>
							</div>
						</div>
						<div id="console-out" class="console-panel__body"></div>
					</div>
				</div>
			</div>
			<footer class="app-footer">
				<div class="app-footer__group">
					<span class="app-footer__text">Axrone Examples</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text" id="lang-display">TypeScript</span>
				</div>
				<div class="app-footer__group">
						<span class="app-footer__text" id="cpos">Ln 1, Col 1</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text">UTF-8</span>
					<span class="app-footer__divider"></span>
						<span class="app-footer__text">Spaces: 2</span>
				</div>
			</footer>
			<div id="new-project-modal" class="new-project-modal" style="opacity:0;pointer-events:none;transition:opacity .2s">
				<div class="new-project-modal__overlay" data-modal-close="true"></div>
				<div id="modal-card" class="new-project-modal__card" style="transform:translateY(12px) scale(.97);transition:transform .2s">
					<div class="new-project-modal__header">
						<div>
							<p class="new-project-modal__eyebrow">Playground</p>
							<h2 class="new-project-modal__title">Create New Project</h2>
						</div>
						<button type="button" class="tbtn xs" data-modal-close="true">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
						</button>
					</div>
					<div class="new-project-modal__body">
						<label class="new-project-field">
							<span class="new-project-field__label">Project Name</span>
							<input id="np-name" type="text" placeholder="MyAwesomeProject" class="new-project-field__input">
						</label>
						<div class="new-project-field">
							<span class="new-project-field__label">Choose a Template</span>
							<div class="new-project-templates" id="np-templates"></div>
						</div>
					</div>
					<div class="new-project-modal__footer">
						<button type="button" data-modal-close="true" class="new-project-button new-project-button--ghost">Cancel</button>
						<button id="create-project" type="button" class="new-project-button new-project-button--primary">Create</button>
					</div>
				</div>
			</div>
		</div>
	`;

	return {
		projectDropdown: requireElement(root, '#project-dropdown'),
		projectChevron: requireElement(root, '#proj-chevron'),
		projectSearchInput: requireElement(root, '#proj-search'),
		projectList: requireElement(root, '#proj-list'),
		projectCount: requireElement(root, '#proj-count'),
		projectNameDisplay: requireElement(root, '#proj-name-display'),
		projectDot: requireElement(root, '#proj-dot'),
		fileTree: requireElement(root, '#file-tree'),
		fileCountText: requireElement(root, '#file-count-text'),
		editorTabs: requireElement(root, '#editor-tabs'),
		breadcrumbLabel: requireElement(root, '#file-breadcrumb'),
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
		cameraLabel: requireElement(root, '#cam-label'),
		ctrlInfo: requireElement(root, '#ctrl-info'),
		newProjectModal: requireElement(root, '#new-project-modal'),
		newProjectCard: requireElement(root, '#modal-card'),
		newProjectNameInput: requireElement(root, '#np-name'),
		newProjectTemplates: requireElement(root, '#np-templates'),
		newProjectOpenButton: requireElement(root, '#new-project-open'),
		newProjectCloseButtons: [...root.querySelectorAll<HTMLButtonElement>('[data-modal-close="true"]')],
		newProjectCreateButton: requireElement(root, '#create-project'),
		fullscreenButton: requireElement(root, '#fullscreen-button'),
	};
};