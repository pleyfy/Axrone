const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
	const element = root.querySelector<T>(selector);
	if (!element) {
		throw new Error(`Missing required shell element: ${selector}`);
	}

	return element;
};

const icon = (paths: string, size = 14): string => `
	<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>
`;

export type PlaygroundShell = {
	readonly projectTrigger: HTMLButtonElement;
	readonly projectChevron: HTMLSpanElement;
	readonly projectNameDisplay: HTMLSpanElement;
	readonly projectCategoryDisplay: HTMLSpanElement;
	readonly projectDot: HTMLSpanElement;
	readonly fileTree: HTMLDivElement;
	readonly fileCountText: HTMLSpanElement;
	readonly editorTabs: HTMLDivElement;
	readonly breadcrumbLabel: HTMLSpanElement;
	readonly monacoContainer: HTMLDivElement;
	readonly previewContainer: HTMLDivElement;
	readonly previewStage: HTMLDivElement;
	readonly viewportSceneLabel: HTMLSpanElement;
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
	readonly examplesModal: HTMLDivElement;
	readonly examplesDialog: HTMLElement;
	readonly examplesSearchInput: HTMLInputElement;
	readonly examplesList: HTMLDivElement;
	readonly examplesEmpty: HTMLDivElement;
	readonly examplesDetail: HTMLDivElement;
	readonly examplesCount: HTMLSpanElement;
	readonly examplesScopeButtons: readonly HTMLButtonElement[];
	readonly examplesScopeCounts: readonly HTMLSpanElement[];
	readonly examplesOpenButton: HTMLButtonElement;
	readonly examplesNewButton: HTMLButtonElement;
	readonly examplesCloseButtons: readonly HTMLElement[];
	readonly newProjectModal: HTMLDivElement;
	readonly newProjectCard: HTMLDivElement;
	readonly newProjectNameInput: HTMLInputElement;
	readonly newProjectTemplates: HTMLDivElement;
	readonly newProjectCloseButtons: readonly HTMLElement[];
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
							<svg width="15" height="15" viewBox="0 0 16 16" fill="none">
								<path d="M8 1.25 13.75 4.5v7L8 14.75 2.25 11.5v-7L8 1.25Z" stroke="currentColor" stroke-width="1.35"></path>
								<path d="M8 1.25v13.5M2.25 4.5 13.75 11.5M13.75 4.5 2.25 11.5" stroke="currentColor" stroke-width=".9" opacity=".45"></path>
							</svg>
						</div>
						<span class="app-brand__name">Axrone</span>
						<span class="app-brand__badge">Playground</span>
					</div>
					<div class="app-divider"></div>
					<button id="proj-trigger" type="button" class="project-trigger" aria-haspopup="dialog" aria-expanded="false" data-tip="Browse examples">
						<span class="project-trigger__mark" aria-hidden="true">
							<span class="project-trigger__dot" id="proj-dot"></span>
						</span>
						<span class="project-trigger__text">
							<span class="project-trigger__label" id="proj-name-display">Loading</span>
							<span class="project-trigger__meta" id="proj-category">Project library</span>
						</span>
						<kbd class="project-trigger__kbd">Ctrl K</kbd>
						<span id="proj-chevron" class="project-trigger__chevron" aria-hidden="true">
							${icon('<path d="m6 9 6 6 6-6"></path>', 12)}
						</span>
					</button>
				</div>
				<div class="app-header__actions">
					<div class="header-run-group">
						<button id="run-button" type="button" class="run-button" data-tip="Run — Ctrl+Enter">
							${icon('<polygon points="6 4 19 12 6 20" fill="currentColor" stroke="none"></polygon>', 12)}
							<span>Run</span>
						</button>
						<button id="restart-button" type="button" class="tbtn" data-tip="Restart">
							${icon('<path d="M3 12a9 9 0 1 0 2.64-6.36"></path><path d="M3 4v5h5"></path>', 13)}
						</button>
						<button id="stop-button" type="button" class="tbtn tbtn--danger" data-tip="Stop">
							${icon('<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect>', 12)}
						</button>
					</div>
					<div class="app-divider"></div>
					<div class="header-icon-group">
						<button id="toggle-layout" type="button" class="tbtn" data-tip="Toggle layout">
							${icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="M12 4.5v15"></path>', 13)}
						</button>
						<button id="toggle-console" type="button" class="tbtn" data-tip="Toggle console">
							${icon('<path d="m5 8 4 4-4 4"></path><path d="M12 17h7"></path>', 13)}
						</button>
					</div>
					<div class="app-divider"></div>
					<div class="header-status">
						<span class="dot id" id="sdot"></span>
						<span id="stxt">Ready</span>
					</div>
				</div>
			</header>
			<div class="app-main">
				<aside id="sidebar" class="sidebar-panel">
					<div class="sidebar-header">
						<span class="sidebar-header__title">Explorer</span>
						<button id="toggle-sidebar" type="button" class="tbtn tbtn--xs" data-tip="Collapse sidebar">
							${icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="M9 4.5v15"></path>', 12)}
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
								<div class="editor-tabs-shell__fill"></div>
							</div>
							<div class="editor-breadcrumb">
								<span class="editor-breadcrumb__root">src</span>
								${icon('<path d="m9 18 6-6-6-6"></path>', 11)}
								<span class="editor-breadcrumb__current" id="file-breadcrumb">main.ts</span>
							</div>
							<div id="monaco-c" class="editor-surface"></div>
						</div>
						<div class="rh" id="ep-resize"></div>
						<div id="preview-panel" class="preview-panel" style="flex:1 1 55%;min-width:320px">
							<div class="preview-toolbar">
								<div class="preview-toolbar__group">
									<div class="segmented-control" role="group" aria-label="Viewport controls">
										<button id="btn-play" type="button" class="tbtn preview-tool" data-tip="Play / pause">
											<svg id="icon-play" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="display:none"><polygon points="6 4 19 12 6 20"></polygon></svg>
											<svg id="icon-pause" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
										</button>
										<button id="btn-grid" type="button" class="tbtn preview-tool active-t" data-tip="Grid">
											${icon('<path d="M3.5 3.5h17v17h-17z"></path><path d="M3.5 9.5h17M3.5 14.5h17M9.5 3.5v17M14.5 3.5v17"></path>', 11)}
										</button>
										<button id="btn-wire" type="button" class="tbtn preview-tool" data-tip="Wireframe">
											${icon('<path d="m12 3 8.5 5v8L12 21l-8.5-5V8z"></path><path d="M12 3v18M3.5 8l8.5 5 8.5-5"></path>', 11)}
										</button>
										<button id="btn-axes" type="button" class="tbtn preview-tool" data-tip="Axes">
											${icon('<path d="M4 20V4M4 20h16"></path><path d="m4 14 4-4 3 3 6-7"></path>', 11)}
										</button>
									</div>
								</div>
								<div class="preview-toolbar__group preview-toolbar__group--end">
									<div class="preview-camera">
										<button id="btn-cam" type="button" class="preview-camera__button">
											<span id="cam-label">Perspective</span>
											${icon('<path d="m6 9 6 6 6-6"></path>', 11)}
										</button>
										<div class="cam-dd" id="cam-dropdown">
											<button type="button" class="cam-opt active" data-cam="perspective">Perspective</button>
											<button type="button" class="cam-opt" data-cam="front">Front</button>
											<button type="button" class="cam-opt" data-cam="top">Top</button>
											<button type="button" class="cam-opt" data-cam="right">Right</button>
										</div>
									</div>
									<div class="toolbar-separator"></div>
									<button id="fullscreen-button" type="button" class="tbtn preview-tool" data-tip="Fullscreen">
										${icon('<path d="M8 3H5a2 2 0 0 0-2 2v3M18 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"></path>', 11)}
									</button>
								</div>
							</div>
							<div id="preview-container" class="preview-container">
								<div id="preview-stage" class="preview-stage"></div>
								<div class="ctrl-bar" id="ctrl-bar">
									<span class="viewport-stat viewport-stat--live"><span class="viewport-stat__dot"></span>Live</span>
									<span class="viewport-stat">FPS <strong id="fps">—</strong></span>
									<span class="viewport-stat">Objects <strong id="obj-count">—</strong></span>
									<span class="viewport-stat">Status <strong id="ctrl-info">—</strong></span>
								</div>
								<span class="viewport-scene" id="viewport-scene">—</span>
								<div class="viewport-axis" aria-hidden="true">
									<svg width="56" height="56" viewBox="0 0 60 60">
										<line x1="30" y1="30" x2="52" y2="30" stroke="#dc2626" stroke-width="1.5"></line>
										<text x="53" y="33" fill="#dc2626" font-size="8.5" font-weight="600">X</text>
										<line x1="30" y1="30" x2="30" y2="8" stroke="#16a34a" stroke-width="1.5"></line>
										<text x="26" y="7" fill="#16a34a" font-size="8.5" font-weight="600">Y</text>
										<line x1="30" y1="30" x2="14" y2="43" stroke="#2563eb" stroke-width="1.5"></line>
										<text x="6" y="48" fill="#2563eb" font-size="8.5" font-weight="600">Z</text>
									</svg>
								</div>
							</div>
						</div>
					</div>
					<div class="rv" id="con-resize"></div>
					<div id="console-panel" class="console-panel">
						<div class="console-panel__header">
							<div class="console-panel__tabs">
								<button type="button" class="tab active" data-ct="console">Console</button>
								<button type="button" class="tab" data-ct="output">Output</button>
								<button type="button" class="tab" data-ct="problems">Problems <span class="console-panel__badge" id="pcount">0</span></button>
							</div>
							<div class="console-panel__actions">
								<button id="clear-console" type="button" class="tbtn tbtn--xs" data-tip="Clear console">
									${icon('<path d="M4 6h16"></path><path d="M9 6V4h6v2"></path><path d="M6 6v14h12V6"></path>', 11)}
								</button>
								<button id="close-console" type="button" class="tbtn tbtn--xs" data-tip="Close console">
									${icon('<path d="M18 6 6 18M6 6l12 12"></path>', 11)}
								</button>
							</div>
						</div>
						<div id="console-out" class="console-panel__body"></div>
					</div>
				</div>
			</div>
			<footer class="app-footer">
				<div class="app-footer__group">
					<span class="app-footer__brand"><span class="app-footer__mark"></span>Axrone Engine</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text">Playground</span>
				</div>
				<div class="app-footer__group">
					<span class="app-footer__text" id="cpos">Ln 1, Col 1</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text" id="lang-display">TypeScript</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text">UTF-8</span>
					<span class="app-footer__divider"></span>
					<span class="app-footer__text">Spaces: 2</span>
				</div>
			</footer>
			<div id="examples-modal" class="examples-modal" aria-hidden="true">
				<div class="examples-modal__overlay" data-examples-close="true"></div>
				<section id="examples-dialog" class="examples-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="examples-title">
					<header class="examples-header">
						<div class="examples-header__titles">
							<span class="examples-header__eyebrow">Project library</span>
							<h2 class="examples-header__title" id="examples-title">Examples</h2>
						</div>
						<div class="examples-search">
							${icon('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>', 13)}
							<input id="examples-search" type="text" placeholder="Search examples" autocomplete="off" spellcheck="false" aria-label="Search examples">
						</div>
						<button type="button" class="examples-close" data-examples-close="true" aria-label="Close examples">
							${icon('<path d="M18 6 6 18M6 6l12 12"></path>', 14)}
						</button>
					</header>
					<div class="examples-body">
						<aside class="examples-list-panel">
							<div class="examples-scope" role="group" aria-label="Filter examples">
								<button type="button" class="examples-scope__button is-active" data-example-scope="all" aria-pressed="true">All <span class="examples-scope__count" data-scope-count="all">0</span></button>
								<button type="button" class="examples-scope__button" data-example-scope="builtin" aria-pressed="false">Built-in <span class="examples-scope__count" data-scope-count="builtin">0</span></button>
								<button type="button" class="examples-scope__button" data-example-scope="user" aria-pressed="false">Yours <span class="examples-scope__count" data-scope-count="user">0</span></button>
							</div>
							<div class="examples-list-meta">
								<span class="examples-list-meta__label">Examples</span>
								<span class="examples-list-meta__count" id="examples-count">0</span>
							</div>
							<div class="examples-list" id="examples-list"></div>
							<div class="examples-list-empty" id="examples-empty" hidden>
								${icon('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>', 18)}
								<span class="examples-list-empty__title">No examples found</span>
								<span class="examples-list-empty__text">Try another search or filter.</span>
							</div>
						</aside>
						<section class="examples-detail" id="examples-detail" aria-live="polite"></section>
					</div>
					<footer class="examples-footer">
						<div class="examples-footer__hints">
							<span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
							<span><kbd>↵</kbd> Open</span>
							<span><kbd>Esc</kbd> Close</span>
						</div>
						<div class="examples-footer__actions">
							<button id="examples-new-project" type="button" class="button button--ghost">
								${icon('<path d="M12 5v14M5 12h14"></path>', 13)}
								New project
							</button>
							<button id="examples-open-project" type="button" class="button button--primary">
								<span>Open example</span>
								${icon('<path d="M5 12h14M13 6l6 6-6 6"></path>', 13)}
							</button>
						</div>
					</footer>
				</section>
			</div>
			<div id="new-project-modal" class="new-project-modal" aria-hidden="true">
				<div class="new-project-modal__overlay" data-modal-close="true"></div>
				<div id="modal-card" class="new-project-modal__card" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
					<header class="new-project-modal__header">
						<div>
							<span class="new-project-modal__eyebrow">Playground</span>
							<h2 class="new-project-modal__title" id="new-project-title">Create a project</h2>
						</div>
						<button type="button" class="tbtn tbtn--xs" data-modal-close="true" aria-label="Close">
							${icon('<path d="M18 6 6 18M6 6l12 12"></path>', 12)}
						</button>
					</header>
					<div class="new-project-modal__body">
						<label class="new-project-field">
							<span class="new-project-field__label">Project name</span>
							<input id="np-name" type="text" placeholder="Untitled scene" class="new-project-field__input" autocomplete="off">
						</label>
						<div class="new-project-field">
							<span class="new-project-field__label">Start from a template</span>
							<div class="new-project-templates" id="np-templates"></div>
						</div>
					</div>
					<footer class="new-project-modal__footer">
						<button type="button" data-modal-close="true" class="button button--ghost">Cancel</button>
						<button id="create-project" type="button" class="button button--primary">Create project</button>
					</footer>
				</div>
			</div>
		</div>
	`;

	return {
		projectTrigger: requireElement(root, '#proj-trigger'),
		projectChevron: requireElement(root, '#proj-chevron'),
		projectNameDisplay: requireElement(root, '#proj-name-display'),
		projectCategoryDisplay: requireElement(root, '#proj-category'),
		projectDot: requireElement(root, '#proj-dot'),
		fileTree: requireElement(root, '#file-tree'),
		fileCountText: requireElement(root, '#file-count-text'),
		editorTabs: requireElement(root, '#editor-tabs'),
		breadcrumbLabel: requireElement(root, '#file-breadcrumb'),
		monacoContainer: requireElement(root, '#monaco-c'),
		previewContainer: requireElement(root, '#preview-container'),
		previewStage: requireElement(root, '#preview-stage'),
		viewportSceneLabel: requireElement(root, '#viewport-scene'),
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
		examplesModal: requireElement(root, '#examples-modal'),
		examplesDialog: requireElement(root, '#examples-dialog'),
		examplesSearchInput: requireElement(root, '#examples-search'),
		examplesList: requireElement(root, '#examples-list'),
		examplesEmpty: requireElement(root, '#examples-empty'),
		examplesDetail: requireElement(root, '#examples-detail'),
		examplesCount: requireElement(root, '#examples-count'),
		examplesScopeButtons: [...root.querySelectorAll<HTMLButtonElement>('[data-example-scope]')],
		examplesScopeCounts: [...root.querySelectorAll<HTMLSpanElement>('[data-scope-count]')],
		examplesOpenButton: requireElement(root, '#examples-open-project'),
		examplesNewButton: requireElement(root, '#examples-new-project'),
		examplesCloseButtons: [...root.querySelectorAll<HTMLElement>('[data-examples-close="true"]')],
		newProjectModal: requireElement(root, '#new-project-modal'),
		newProjectCard: requireElement(root, '#modal-card'),
		newProjectNameInput: requireElement(root, '#np-name'),
		newProjectTemplates: requireElement(root, '#np-templates'),
		newProjectCloseButtons: [...root.querySelectorAll<HTMLElement>('[data-modal-close="true"]')],
		newProjectCreateButton: requireElement(root, '#create-project'),
		fullscreenButton: requireElement(root, '#fullscreen-button'),
	};
};
