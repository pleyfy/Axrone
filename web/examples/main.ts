import './styles.css';
import type { ExampleHandle, SceneExample } from './example-types';
import type { LiveEditorController } from './playground/live-editor';

type ExampleModule = {
    readonly default: SceneExample;
};

type ExampleDescriptor = {
    readonly path: string;
    readonly example: SceneExample;
    readonly source: string;
};

type PlaygroundTools = {
    readonly editorModule: typeof import('./playground/live-editor');
    readonly compilerModule: typeof import('./playground/live-example-runtime');
};

const moduleLoaders = import.meta.glob('./*.ts') as Record<string, () => Promise<ExampleModule>>;
const sourceLoaders = import.meta.glob('./*.ts', {
    query: '?raw',
    import: 'default',
}) as Record<string, () => Promise<string>>;

const ignoredModules = new Set(['./main.ts', './example-types.ts', './example-runtime.ts']);
const sourceStoragePrefix = 'axrone:examples:source:';

const resolveExamples = async (): Promise<readonly ExampleDescriptor[]> => {
    const entries = Object.entries(moduleLoaders).filter(([path]) => !ignoredModules.has(path));
    const descriptors = await Promise.all(
        entries.map(async ([path, loadModule]) => {
            const sourceLoader = sourceLoaders[path];

            if (!sourceLoader) {
                throw new Error(`Missing raw source loader for ${path}`);
            }

            const [module, source] = await Promise.all([loadModule(), sourceLoader()]);

            return {
                path,
                example: module.default,
                source,
            } satisfies ExampleDescriptor;
        })
    );

    return descriptors.sort((left, right) => {
        const orderDelta =
            (left.example.order ?? Number.MAX_SAFE_INTEGER) -
            (right.example.order ?? Number.MAX_SAFE_INTEGER);

        if (orderDelta !== 0) {
            return orderDelta;
        }

        return left.example.title.localeCompare(right.example.title);
    });
};

const loadPlaygroundTools = async (): Promise<PlaygroundTools> => {
    const [editorModule, compilerModule] = await Promise.all([
        import('./playground/live-editor'),
        import('./playground/live-example-runtime'),
    ]);

    return {
        editorModule,
        compilerModule,
    };
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
    throw new Error('Examples app root was not found');
}

// Modern Professional UI Structure
app.innerHTML = `
    <div class="page-shell">
        <!-- Header -->
        <header class="page-header">
            <div class="brand-copy">
                <div class="brand-logo">
                    <div class="brand-logo-icon">A</div>
                    <div class="brand-copy-text">
                        <span class="brand-title">Axrone Playground</span>
                        <span class="brand-subtitle">Live Examples Studio</span>
                    </div>
                </div>
            </div>
            
            <div class="header-controls">
                <label class="field-group" for="example-select">
                    <span class="field-label">Example</span>
                    <select id="example-select" class="project-select" aria-label="Select example"></select>
                </label>
                
                <div class="toolbar-actions">
                    <label class="toggle-control" for="autorun-toggle">
                        <input id="autorun-toggle" type="checkbox" checked />
                        <span>Auto-run</span>
                    </label>
                    
                    <div class="divider"></div>
                    
                    <button id="run-button" type="button" class="toolbar-button toolbar-button--accent">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        Run
                    </button>
                    
                    <button id="reset-button" type="button" class="toolbar-button">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
                        </svg>
                        Reset
                    </button>
                </div>
            </div>
        </header>
        
        <!-- Context Bar -->
        <section class="context-bar">
            <div class="context-copy">
                <span class="context-label">Selected Example</span>
                <h2 id="example-title">Select an example</h2>
                <p id="example-description">Choose an example from the dropdown to explore the code and live preview.</p>
            </div>
            <div class="context-meta">
                <span class="meta-pill">⚡ Live Reload</span>
                <span class="meta-pill">🎨 Interactive</span>
            </div>
        </section>
        
        <!-- Main Workbench - Split Screen -->
        <section class="workbench">
            <!-- Editor Panel -->
            <section class="editor-panel">
                <div class="panel-header panel-header--editor">
                    <div>
                        <span class="eyebrow">Source Editor</span>
                        <p id="editor-caption" class="panel-copy">Loading editor...</p>
                    </div>
                </div>
                <div id="editor-host" class="editor-host"></div>
                <footer class="editor-footer">
                    <p id="editor-status" class="editor-status" data-mode="loading">Initializing Monaco...</p>
                    <p id="editor-supported-imports" class="editor-supported-imports"></p>
                </footer>
            </section>
            
            <!-- Resize Handle -->
            <div id="resize-handle" class="resize-handle" title="Drag to resize"></div>
            
            <!-- Preview Panel -->
            <section class="preview-panel">
                <div class="panel-header">
                    <div>
                        <span class="eyebrow">Live Preview</span>
                        <p class="panel-copy">Real-time rendering with interactive controls</p>
                    </div>
                </div>
                <section class="stage-frame">
                    <div id="example-host" class="example-host"></div>
                    <div id="stage-status" class="stage-status" data-mode="loading">Loading scene...</div>
                </section>
            </section>
        </section>
    </div>
`;

// DOM References
const exampleSelect = app.querySelector<HTMLSelectElement>('#example-select');
const host = app.querySelector<HTMLElement>('#example-host');
const title = app.querySelector<HTMLElement>('#example-title');
const description = app.querySelector<HTMLElement>('#example-description');
const status = app.querySelector<HTMLElement>('#stage-status');
const editorHost = app.querySelector<HTMLElement>('#editor-host');
const editorCaption = app.querySelector<HTMLElement>('#editor-caption');
const editorStatus = app.querySelector<HTMLElement>('#editor-status');
const editorSupportedImports = app.querySelector<HTMLElement>('#editor-supported-imports');
const runButton = app.querySelector<HTMLButtonElement>('#run-button');
const resetButton = app.querySelector<HTMLButtonElement>('#reset-button');
const autoRunToggle = app.querySelector<HTMLInputElement>('#autorun-toggle');
const resizeHandle = app.querySelector<HTMLElement>('#resize-handle');
const editorPanel = app.querySelector<HTMLElement>('.editor-panel');

if (
    !exampleSelect ||
    !host ||
    !title ||
    !description ||
    !status ||
    !editorHost ||
    !editorCaption ||
    !editorStatus ||
    !editorSupportedImports ||
    !runButton ||
    !resetButton ||
    !autoRunToggle ||
    !resizeHandle ||
    !editorPanel
) {
    throw new Error('Examples UI failed to initialize');
}

// State
const playgroundToolsPromise = loadPlaygroundTools();
const sourceOverrides = new Map<string, string>();

let currentHandle: ExampleHandle | undefined;
let currentDescriptor: ExampleDescriptor | undefined;
let currentRunToken = 0;
let isApplyingEditorSource = false;
let autoRun = autoRunToggle.checked;
let rerunTimer: number | undefined;
let editor: LiveEditorController | undefined;

// Status Helpers
const setStatus = (message: string, mode: 'loading' | 'ready' | 'error' = 'ready') => {
    status.textContent = message;
    status.dataset.mode = mode;
};

const setEditorStatus = (message: string, mode: 'loading' | 'ready' | 'error' = 'ready') => {
    editorStatus.textContent = message;
    editorStatus.dataset.mode = mode;
};

// Local Storage Helpers
const readPersistedSource = (path: string): string | undefined => {
    try {
        return globalThis.localStorage.getItem(`${sourceStoragePrefix}${path}`) ?? undefined;
    } catch {
        return undefined;
    }
};

const persistSource = (path: string, source: string) => {
    try {
        globalThis.localStorage.setItem(`${sourceStoragePrefix}${path}`, source);
    } catch {
        // Ignore environments where local storage is unavailable.
    }
};

const clearPersistedSource = (path: string) => {
    try {
        globalThis.localStorage.removeItem(`${sourceStoragePrefix}${path}`);
    } catch {
        // Ignore environments where local storage is unavailable.
    }
};

const getEffectiveSource = (descriptor: ExampleDescriptor): string => {
    return sourceOverrides.get(descriptor.path) ?? readPersistedSource(descriptor.path) ?? descriptor.source;
};

const updateEditorCaption = (descriptor: ExampleDescriptor, source: string) => {
    const displayPath = descriptor.path.replace(/^\.\//, '');
    const isModified = source !== descriptor.source;

    editorCaption.textContent = `${displayPath}${isModified ? ' • Modified' : ''}`;
    resetButton.disabled = !isModified;
};

// Run Management
const cancelScheduledRun = () => {
    if (rerunTimer === undefined) {
        return;
    }

    globalThis.clearTimeout(rerunTimer);
    rerunTimer = undefined;
};

const unmountCurrentExample = async () => {
    if (!currentHandle) {
        host.replaceChildren();
        return;
    }

    await currentHandle.dispose();
    currentHandle = undefined;
    host.replaceChildren();
};

// Editor Management
const ensureEditor = async (descriptor: ExampleDescriptor): Promise<LiveEditorController> => {
    if (editor) {
        return editor;
    }

    const { editorModule, compilerModule } = await playgroundToolsPromise;
    editorSupportedImports.textContent = `Supported: ${compilerModule
        .getSupportedPlaygroundImports()
        .join(', ')}`;

    editor = editorModule.createLiveEditor({
        container: editorHost,
        value: getEffectiveSource(descriptor),
        path: descriptor.path,
        onChange: () => {
            if (isApplyingEditorSource || !currentDescriptor || !editor) {
                return;
            }

            const nextSource = editor.getValue();

            if (nextSource === currentDescriptor.source) {
                sourceOverrides.delete(currentDescriptor.path);
                clearPersistedSource(currentDescriptor.path);
            } else {
                sourceOverrides.set(currentDescriptor.path, nextSource);
                persistSource(currentDescriptor.path, nextSource);
            }

            updateEditorCaption(currentDescriptor, nextSource);

            if (!autoRun) {
                setEditorStatus('Changes pending. Use Run to refresh.', 'ready');
                return;
            }

            cancelScheduledRun();
            setEditorStatus('Refreshing preview...', 'loading');
            rerunTimer = globalThis.setTimeout(() => {
                rerunTimer = undefined;
                void runCurrentSource('live');
            }, 450);
        },
    });

    return editor;
};

const syncEditorToDescriptor = async (descriptor: ExampleDescriptor) => {
    const liveEditor = await ensureEditor(descriptor);
    const nextSource = getEffectiveSource(descriptor);

    isApplyingEditorSource = true;
    liveEditor.loadSource(nextSource, descriptor.path);
    isApplyingEditorSource = false;

    updateEditorCaption(descriptor, nextSource);
    setEditorStatus(
        autoRun
            ? 'Editing will refresh preview automatically'
            : 'Auto-run off. Click Run to refresh.',
        'ready'
    );
    liveEditor.focus();
};

const runCurrentSource = async (reason: 'select' | 'manual' | 'live') => {
    if (!currentDescriptor) {
        return;
    }

    const liveEditor = await ensureEditor(currentDescriptor);
    cancelScheduledRun();

    const runToken = ++currentRunToken;
    const source = liveEditor.getValue();

    setStatus(reason === 'select' ? 'Preparing scene...' : 'Refreshing scene...', 'loading');
    setEditorStatus(
        reason === 'live' ? 'Compiling changes...' : 'Compiling example...',
        'loading'
    );

    try {
        const { compilerModule } = await playgroundToolsPromise;
        const runtimeExample = compilerModule.compileSceneExample(source, currentDescriptor.path);

        if (runToken !== currentRunToken) {
            return;
        }

        await unmountCurrentExample();

        if (runToken !== currentRunToken) {
            return;
        }

        const maybeHandle = await runtimeExample.mount({ container: host });

        if (runToken !== currentRunToken) {
            await maybeHandle?.dispose?.();
            return;
        }

        currentHandle = maybeHandle ?? undefined;
        title.textContent = runtimeExample.title;
        description.textContent = runtimeExample.description;
        setStatus('Scene ready', 'ready');
        setEditorStatus(
            reason === 'live' ? 'Preview synced' : 'Preview updated',
            'ready'
        );
    } catch (error) {
        if (runToken !== currentRunToken) {
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setStatus('Last valid scene still running', 'error');
        setEditorStatus(message, 'error');
    }
};

const selectExample = async (descriptor: ExampleDescriptor) => {
    if (currentDescriptor?.path === descriptor.path) {
        return;
    }

    currentRunToken += 1;
    cancelScheduledRun();
    currentDescriptor = descriptor;
    exampleSelect.value = descriptor.example.id;

    title.textContent = descriptor.example.title;
    description.textContent = descriptor.example.description;
    setStatus('Loading example...', 'loading');

    try {
        await syncEditorToDescriptor(descriptor);
        await runCurrentSource('select');
        location.hash = descriptor.example.id;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message, 'error');
        setEditorStatus(message, 'error');
    }
};

// Event Listeners
runButton.addEventListener('click', () => {
    void runCurrentSource('manual');
});

resetButton.addEventListener('click', () => {
    if (!currentDescriptor || !editor) {
        return;
    }

    sourceOverrides.delete(currentDescriptor.path);
    clearPersistedSource(currentDescriptor.path);

    isApplyingEditorSource = true;
    editor.setValue(currentDescriptor.source);
    isApplyingEditorSource = false;

    updateEditorCaption(currentDescriptor, currentDescriptor.source);

    if (!autoRun) {
        setEditorStatus('Source reset. Click Run to refresh.', 'ready');
        return;
    }

    void runCurrentSource('manual');
});

autoRunToggle.addEventListener('change', () => {
    autoRun = autoRunToggle.checked;

    if (!autoRun) {
        cancelScheduledRun();
        setEditorStatus('Auto-run disabled', 'ready');
        return;
    }

    setEditorStatus('Auto-run enabled. Refreshing...', 'loading');
    void runCurrentSource('live');
});

// Initialize supported imports display
void playgroundToolsPromise
    .then(({ compilerModule }) => {
        editorSupportedImports.textContent = `Supported: ${compilerModule
            .getSupportedPlaygroundImports()
            .join(', ')}`;
    })
    .catch((error) => {
        setEditorStatus(error instanceof Error ? error.message : String(error), 'error');
    });

// Resize Handle Logic
let isResizing = false;

const startResize = (e: MouseEvent | TouchEvent) => {
    isResizing = true;
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
};

const doResize = (e: MouseEvent | TouchEvent) => {
    if (!isResizing) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const containerWidth = app.clientWidth;
    const newWidth = (clientX / containerWidth) * 100;

    // Constrain between 20% and 80%
    if (newWidth >= 20 && newWidth <= 80) {
        editorPanel.style.width = `${newWidth}%`;
    }
};

const stopResize = () => {
    isResizing = false;
    resizeHandle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
};

resizeHandle.addEventListener('mousedown', startResize);
resizeHandle.addEventListener('touchstart', startResize);

document.addEventListener('mousemove', doResize);
document.addEventListener('touchmove', doResize);

document.addEventListener('mouseup', stopResize);
document.addEventListener('touchend', stopResize);

// Bootstrap
const bootstrap = async () => {
    const examples = await resolveExamples();
    const examplesById = new Map(examples.map((descriptor) => [descriptor.example.id, descriptor]));

    for (const descriptor of examples) {
        const option = document.createElement('option');
        option.value = descriptor.example.id;
        option.textContent = descriptor.example.title;
        exampleSelect.appendChild(option);
    }

    exampleSelect.addEventListener('change', () => {
        const nextExample = examplesById.get(exampleSelect.value);
        if (nextExample) {
            void selectExample(nextExample);
        }
    });

    if (examples.length === 0) {
        setStatus('No examples found in the examples folder.', 'error');
        setEditorStatus('No editable files found.', 'error');
        return;
    }

    const hashMatch = examples.find((example) => example.example.id === location.hash.slice(1));
    await selectExample(hashMatch ?? examples[0]);

    globalThis.addEventListener('hashchange', () => {
        const nextExample = examplesById.get(location.hash.slice(1));
        if (nextExample) {
            void selectExample(nextExample);
        }
    });
};

void bootstrap().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, 'error');
    setEditorStatus(message, 'error');
});
