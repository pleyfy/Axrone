import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

export interface LiveEditorController {
    getValue(): string;
    setValue(value: string): void;
    loadSource(value: string, path: string): void;
    focus(): void;
    dispose(): void;
}

interface CreateLiveEditorOptions {
    readonly container: HTMLElement;
    readonly value: string;
    readonly path: string;
    readonly onChange: () => void;
}

type MonacoEnvironmentTarget = typeof globalThis & {
    MonacoEnvironment?: {
        getWorker(_: string, label: string): Worker;
    };
};

const AXRONE_THEME = 'axrone-playground-light';

let isConfigured = false;

// Track existing models to prevent duplicates
const existingModels = new Map<string, monaco.editor.ITextModel>();

const toModelUri = (path: string) => {
    const normalizedPath = path.replace(/^\.\//, '').replace(/\\/g, '/');
    return monaco.Uri.parse(`file:///examples/${normalizedPath}`);
};

const configureMonaco = () => {
    if (isConfigured) {
        return;
    }

    isConfigured = true;

    const root = globalThis as MonacoEnvironmentTarget;
    root.MonacoEnvironment = {
        getWorker(_: string, label: string) {
            if (label === 'typescript' || label === 'javascript') {
                return new tsWorker();
            }

            return new editorWorker();
        },
    };

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2022,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        experimentalDecorators: true,
        strict: true,
        noEmit: true,
        lib: ['dom', 'dom.iterable', 'esnext'],
    });

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSuggestionDiagnostics: true,
    });

    monaco.editor.defineTheme(AXRONE_THEME, {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '8a877f' },
            { token: 'keyword', foreground: '0f8b8d' },
            { token: 'string', foreground: 'b8662d' },
            { token: 'number', foreground: 'b78a19' },
            { token: 'type.identifier', foreground: '256c87' },
        ],
        colors: {
            'editor.background': '#fffdf9',
            'editorLineNumber.foreground': '#baaf9e',
            'editorLineNumber.activeForeground': '#5f625c',
            'editorCursor.foreground': '#0f8b8d',
            'editor.selectionBackground': '#d7efec',
            'editor.inactiveSelectionBackground': '#e9f5f2',
            'editor.lineHighlightBackground': '#f8f1e7',
            'editorIndentGuide.background1': '#e8dfd3',
            'editorIndentGuide.activeBackground1': '#c6b7a4',
            'editorBracketMatch.background': '#00000000',
            'editorBracketMatch.border': '#c96f2d',
        },
    });
};

const createModel = (value: string, path: string) => {
    const uri = toModelUri(path);
    const uriString = uri.toString();

    // Check if model already exists and dispose it
    const existingModel = existingModels.get(uriString);
    if (existingModel) {
        existingModel.dispose();
        existingModels.delete(uriString);
    }

    // Also dispose any model at this URI in Monaco's registry
    const modelFromRegistry = monaco.editor.getModel(uri);
    if (modelFromRegistry) {
        modelFromRegistry.dispose();
    }

    const newModel = monaco.editor.createModel(value, 'typescript', uri);
    existingModels.set(uriString, newModel);
    return newModel;
};

export const createLiveEditor = ({
    container,
    value,
    path,
    onChange,
}: CreateLiveEditorOptions): LiveEditorController => {
    configureMonaco();

    let model = createModel(value, path);

    const editor = monaco.editor.create(container, {
        model,
        theme: AXRONE_THEME,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 4,
        fontSize: 14,
        lineHeight: 22,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        wordWrap: 'off',
        bracketPairColorization: { enabled: true },
        renderLineHighlight: 'all',
        padding: { top: 16, bottom: 16 },
        overviewRulerBorder: false,
        scrollbar: {
            verticalScrollbarSize: 12,
            horizontalScrollbarSize: 12,
        },
    });

    const changeSubscription = editor.onDidChangeModelContent(onChange);

    return {
        getValue() {
            return model.getValue();
        },
        setValue(nextValue) {
            if (model.getValue() !== nextValue) {
                model.setValue(nextValue);
            }
        },
        loadSource(nextValue, nextPath) {
            const previousModel = model;
            const uriString = toModelUri(nextPath).toString();
            
            // Remove from tracking map
            existingModels.delete(uriString);
            
            // Create new model (which will handle disposal of any existing)
            model = createModel(nextValue, nextPath);
            editor.setModel(model);
            
            // Dispose old model
            previousModel.dispose();
        },
        focus() {
            editor.focus();
        },
        dispose() {
            changeSubscription.dispose();
            editor.dispose();
            
            // Remove from tracking and dispose
            const uriString = toModelUri(path).toString();
            existingModels.delete(uriString);
            model.dispose();
        },
    };
};