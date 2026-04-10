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

type EditorModule = typeof import('./playground/live-editor');
type CompilerModule = typeof import('./playground/live-example-runtime');

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

let editorModulePromise: Promise<EditorModule> | undefined;
let compilerModulePromise: Promise<CompilerModule> | undefined;

const getEditorModule = (): Promise<EditorModule> => {
    editorModulePromise ??= import('./playground/live-editor');
    return editorModulePromise;
};

const getCompilerModule = (): Promise<CompilerModule> => {
    compilerModulePromise ??= import('./playground/live-example-runtime');
    return compilerModulePromise;
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
    throw new Error('Examples app root was not found');
}

// Modern Professional UI with Tailwind CSS
app.innerHTML = `
    <div class="flex flex-col h-screen overflow-hidden bg-bg-primary">
        <!-- Header -->
        <header class="flex items-center justify-between h-18 px-6 bg-gradient-to-br from-bg-secondary to-bg-primary border-b border-border-primary backdrop-blur-sm">
            <div class="flex items-center gap-4">
                <div class="flex items-center gap-2.5">
                    <div class="w-9 h-9 bg-gradient-to-br from-accent-primary to-accent-secondary rounded-lg flex items-center justify-center font-bold text-white text-lg shadow-glow">
                        A
                    </div>
                    <div class="flex flex-col">
                        <span class="text-base font-bold text-text-primary tracking-tight">Axrone Playground</span>
                        <span class="text-xs font-medium text-text-secondary">Live Examples Studio</span>
                    </div>
                </div>
            </div>
            
            <div class="flex items-center gap-4">
                <label class="flex flex-col gap-1">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-text-muted">Example</span>
                    <select id="example-select" class="project-select min-w-[220px] px-3 py-2 bg-bg-tertiary border border-border-primary rounded-md text-text-primary text-sm cursor-pointer transition-all hover:border-border-accent hover:bg-bg-elevated focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20 appearance-none" style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238b949e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E&quot;); background-repeat: no-repeat; background-position: right 8px center;" aria-label="Select example"></select>
                </label>
                
                <div class="flex items-center gap-2 pl-4 border-l border-border-primary">
                    <label class="toggle-control flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary border border-border-primary rounded-md cursor-pointer transition-all hover:border-border-accent select-none" title="Toggle auto-run on/off">
                        <input id="autorun-toggle" type="checkbox" class="hidden" checked />
                        <span class="flex items-center gap-2 text-xs font-medium text-text-secondary">
                            <span id="autorun-indicator" class="relative inline-flex w-8 h-4.5 bg-accent-primary border-2 border-accent-primary rounded-[10px] transition-colors before:content-[''] before:absolute before:w-3 before:h-3 before:bg-white before:rounded-full before:left-[14px] before:top-0.5 before:transition-all"></span>
                            <span id="autorun-label">Auto-run</span>
                        </span>
                    </label>
                    
                    <div class="w-px h-6 bg-border-primary"></div>
                    
                    <button id="run-button" type="button" class="toolbar-button toolbar-button--accent inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-br from-accent-primary to-accent-secondary border border-transparent rounded-md text-white text-xs font-semibold cursor-pointer transition-all hover:brightness-110 hover:translate-y-[-1px] active:translate-y-0 shadow-sm shadow-glow disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z"/>
                        </svg>
                        Run
                    </button>
                    
                    <button id="reset-button" type="button" class="toolbar-button inline-flex items-center gap-1.5 px-3.5 py-2 bg-bg-tertiary border border-border-primary rounded-md text-text-primary text-xs font-semibold cursor-pointer transition-all hover:bg-bg-elevated hover:border-border-accent hover:translate-y-[-1px] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
                        </svg>
                        Reset
                    </button>
                </div>
            </div>
        </header>
        
        <!-- Main Workbench - Split Screen -->
        <section class="flex flex-1 overflow-hidden">
            <!-- Editor Panel -->
            <section class="editor-panel flex flex-col w-1/2 min-w-[300px] max-w-[70%] border-r border-border-primary bg-bg-secondary">
                <div class="panel-header panel-header--editor flex items-center justify-between px-4 py-3 bg-gradient-to-br from-bg-tertiary to-bg-secondary border-b border-border-primary">
                    <div>
                        <span class="eyebrow inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted mb-0.5 before:content-[''] before:w-2 before:h-2 before:bg-accent-primary before:rounded-[2px]">Source Editor</span>
                        <p id="editor-caption" class="panel-copy text-xs text-text-secondary">Loading editor...</p>
                    </div>
                </div>
                <div id="editor-host" class="flex-1 overflow-hidden relative"></div>
                <footer class="editor-footer flex items-center justify-between px-4 py-1.5 bg-bg-tertiary border-t border-border-primary h-8">
                    <p id="editor-status" class="editor-status flex items-center gap-1.5 text-[11px] font-mono text-text-secondary before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-text-muted data-[mode=loading]:before:bg-accent-warning data-[mode=loading]:before:animate-pulse data-[mode=ready]:before:bg-accent-success data-[mode=error]:before:bg-accent-error data-[mode=error]:before:animate-[pulse_0.5s_infinite]"></p>
                    <p id="editor-supported-imports" class="editor-supported-imports text-[10px] text-text-muted font-mono max-w-[400px] whitespace-nowrap overflow-hidden text-ellipsis"></p>
                </footer>
            </section>
            
            <!-- Resize Handle -->
            <div id="resize-handle" class="resize-handle w-1 bg-bg-tertiary border-l border-r border-border-primary cursor-col-resize transition-all hover:bg-accent-primary hover:border-accent-primary relative z-10 before:content-['⋮'] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rotate-90 before:text-text-muted before:text-xs before:tracking-[2px] before:opacity-0 before:transition-opacity hover:before:opacity-100"></div>
            
            <!-- Preview Panel -->
            <section class="preview-panel flex flex-col flex-1 overflow-hidden bg-bg-primary">
                <div class="panel-header flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border-primary">
                    <div>
                        <span class="eyebrow inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted mb-0.5 before:content-[''] before:w-2 before:h-2 before:bg-accent-primary before:rounded-[2px]">Live Preview</span>
                        <p class="panel-copy text-xs text-text-secondary">Real-time rendering</p>
                    </div>
                </div>
                <section class="stage-frame flex-1 relative overflow-hidden bg-[radial-gradient(ellipse_at_top,rgba(31,111,235,0.05)_0%,transparent_50%),#0d1117]">
                    <div id="example-host" class="w-full h-full relative"></div>
                    <div id="stage-status" class="stage-status absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 px-6 py-5 bg-bg-secondary/95 border border-border-primary rounded-xl backdrop-blur-sm shadow-lg text-sm text-text-secondary opacity-0 pointer-events-none transition-opacity data-[mode=loading]:opacity-10 data-[mode=error]:opacity-10 data-[mode=ready]:opacity-0 data-[mode=ready]:pointer-events-none data-[mode=loading]:before:content-[''] data-[mode=loading]:before:w-6 data-[mode=loading]:before:h-6 data-[mode=loading]:before:border-2 data-[mode=loading]:before:border-border-primary data-[mode=loading]:before:border-t-accent-primary data-[mode=loading]:before:rounded-full data-[mode=loading]:before:animate-[spin_0.8s_linear_infinite] data-[mode=error]:before:hidden data-[mode=error]:text-accent-error data-[mode=error]:border-accent-error"></div>
                </section>
            </section>
        </section>
    </div>
`;

// DOM References
const exampleSelect = app.querySelector<HTMLSelectElement>('#example-select');
const host = app.querySelector<HTMLElement>('#example-host');
const status = app.querySelector<HTMLElement>('#stage-status');
const editorHost = app.querySelector<HTMLElement>('#editor-host');
const editorCaption = app.querySelector<HTMLElement>('#editor-caption');
const editorStatus = app.querySelector<HTMLElement>('#editor-status');
const editorSupportedImports = app.querySelector<HTMLElement>('#editor-supported-imports');
const runButton = app.querySelector<HTMLButtonElement>('#run-button');
const resetButton = app.querySelector<HTMLButtonElement>('#reset-button');
const autoRunToggle = app.querySelector<HTMLInputElement>('#autorun-toggle');
const autoRunIndicator = app.querySelector<HTMLElement>('#autorun-indicator');
const resizeHandle = app.querySelector<HTMLElement>('#resize-handle');
const editorPanel = app.querySelector<HTMLElement>('.editor-panel');

if (
    !exampleSelect ||
    !host ||
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

// Toggle visual state updater
const updateAutoRunIndicator = () => {
    if (!autoRunIndicator) return;
    
    if (autoRun) {
        autoRunIndicator.className = 'relative inline-flex w-8 h-4.5 bg-accent-primary border-2 border-accent-primary rounded-[10px] transition-colors before:content-[\'\'] before:absolute before:w-3 before:h-3 before:bg-white before:rounded-full before:left-[14px] before:top-0.5 before:transition-all';
    } else {
        autoRunIndicator.className = 'relative inline-flex w-8 h-4.5 bg-bg-elevated border-2 border-border-primary rounded-[10px] transition-colors before:content-[\'\'] before:absolute before:w-3 before:h-3 before:bg-text-muted before:rounded-full before:left-0.5 before:top-0.5 before:transition-all';
    }
};

// State
const sourceOverrides = new Map<string, string>();

let currentHandle: ExampleHandle | undefined;
let currentDescriptor: ExampleDescriptor | undefined;
let currentRunToken = 0;
let isApplyingEditorSource = false;
let autoRun = true; // Default to enabled
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

const syncSourceOverride = (descriptor: ExampleDescriptor, source: string) => {
    if (source === descriptor.source) {
        sourceOverrides.delete(descriptor.path);
        clearPersistedSource(descriptor.path);
        return;
    }

    sourceOverrides.set(descriptor.path, source);
    persistSource(descriptor.path, source);
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

    const [editorModule, compilerModule] = await Promise.all([
        getEditorModule(),
        getCompilerModule(),
    ]);
    editorSupportedImports.textContent = `Supported: ${compilerModule
        .getSupportedPlaygroundImports()
        .join(', ')}`;

    const initialSource = compilerModule.normalizePlaygroundSource(getEffectiveSource(descriptor));
    syncSourceOverride(descriptor, initialSource);

    editor = editorModule.createLiveEditor({
        container: editorHost,
        value: initialSource,
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

            // Debounce: Wait 500ms after last keystroke before refreshing
            cancelScheduledRun();
            setEditorStatus('Typing... refreshing soon', 'loading');
            rerunTimer = globalThis.setTimeout(() => {
                rerunTimer = undefined;
                void runCurrentSource('live');
            }, 500);
        },
    });

    return editor;
};

const syncEditorToDescriptor = async (descriptor: ExampleDescriptor) => {
    const liveEditor = await ensureEditor(descriptor);
    const compilerModule = await getCompilerModule();
    const nextSource = compilerModule.normalizePlaygroundSource(getEffectiveSource(descriptor));
    syncSourceOverride(descriptor, nextSource);

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

    const descriptor = currentDescriptor;

    cancelScheduledRun();

    const runToken = ++currentRunToken;
    const compilerModule = await getCompilerModule();
    const liveEditor = editor;
    const source = liveEditor?.getValue() ?? getEffectiveSource(descriptor);
    const normalizedSource = compilerModule.normalizePlaygroundSource(source);

    if (normalizedSource !== source) {
        if (liveEditor) {
            isApplyingEditorSource = true;
            liveEditor.setValue(normalizedSource);
            isApplyingEditorSource = false;
        }
        syncSourceOverride(descriptor, normalizedSource);
        if (liveEditor) {
            updateEditorCaption(descriptor, normalizedSource);
        }
    }

    setStatus(reason === 'select' ? 'Preparing scene...' : 'Refreshing scene...', 'loading');
    setEditorStatus(
        reason === 'live' ? 'Compiling changes...' : 'Compiling example...',
        'loading'
    );

    try {
        const runtimeExample = compilerModule.compileSceneExample(
            normalizedSource,
            descriptor.path
        );

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
    autoRun = !autoRun; // Toggle state
    updateAutoRunIndicator();

    if (!autoRun) {
        cancelScheduledRun();
        setEditorStatus('Auto-run disabled. Click Run to refresh.', 'ready');
        return;
    }

    setEditorStatus('Auto-run enabled. Will refresh as you type...', 'ready');
    // Optionally trigger immediate refresh when enabling
    void runCurrentSource('live');
});

// Initialize supported imports display and auto-run indicator
void getCompilerModule()
    .then((compilerModule) => {
        editorSupportedImports.textContent = `Supported: ${compilerModule
            .getSupportedPlaygroundImports()
            .join(', ')}`;
        updateAutoRunIndicator(); // Initialize toggle state
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
