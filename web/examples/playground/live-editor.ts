import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { VirtualProjectFile } from '../app/types';

export interface LiveEditorController {
	getValue(path?: string): string;
	setValue(path: string, value: string): void;
	loadFiles(files: readonly VirtualProjectFile[], activePath: string): void;
	openFile(path: string): void;
	focus(): void;
	dispose(): void;
}

interface CreateLiveEditorOptions {
	readonly container: HTMLElement;
	readonly files: readonly VirtualProjectFile[];
	readonly activePath: string;
	readonly onChange: (path: string, value: string) => void;
	readonly onCursorChange?: (lineNumber: number, column: number) => void;
}

type MonacoEnvironmentTarget = typeof globalThis & {
	MonacoEnvironment?: {
		getWorker(_: string, label: string): Worker;
	};
};

type MonacoTypeScriptApi = {
	typescriptDefaults: {
		setCompilerOptions(options: Record<string, unknown>): void;
		setDiagnosticsOptions(options: Record<string, unknown>): void;
	};
	ScriptTarget: {
		ES2022: number;
	};
	ModuleKind: {
		ESNext: number;
	};
	ModuleResolutionKind: {
		NodeJs: number;
	};
};

const AXRONE_THEME = 'axrone-playground-light';

let isConfigured = false;

const monacoTypeScript = monaco.languages.typescript as unknown as MonacoTypeScriptApi;

const normalizePath = (value: string): string => value.replace(/^\.\//, '').replace(/\\/g, '/');

const toModelUri = (path: string): monaco.Uri =>
	monaco.Uri.parse(`file:///examples/${normalizePath(path)}`);

const resolveLanguage = (path: string): string => {
	if (path.endsWith('.js') || path.endsWith('.jsx')) {
		return 'javascript';
	}

	return 'typescript';
};

const configureMonaco = (): void => {
	if (isConfigured) {
		return;
	}

	isConfigured = true;

	const root = globalThis as MonacoEnvironmentTarget;
	root.MonacoEnvironment = {
		getWorker(_: string, label: string): Worker {
			if (label === 'typescript' || label === 'javascript') {
				return new tsWorker();
			}

			return new editorWorker();
		},
	};

	monacoTypeScript.typescriptDefaults.setCompilerOptions({
		target: monacoTypeScript.ScriptTarget.ES2022,
		module: monacoTypeScript.ModuleKind.ESNext,
		moduleResolution: monacoTypeScript.ModuleResolutionKind.NodeJs,
		allowNonTsExtensions: true,
		experimentalDecorators: true,
		strict: true,
		noEmit: true,
		lib: ['dom', 'dom.iterable', 'esnext'],
	});

	monacoTypeScript.typescriptDefaults.setDiagnosticsOptions({
		noSemanticValidation: true,
		noSuggestionDiagnostics: true,
	});

	monaco.editor.defineTheme(AXRONE_THEME, {
		base: 'vs',
		inherit: true,
		rules: [
			{ token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
			{ token: 'keyword', foreground: 'cf222e' },
			{ token: 'string', foreground: '0a3069' },
			{ token: 'number', foreground: '0550ae' },
			{ token: 'type.identifier', foreground: '8250df' },
		],
		colors: {
			'editor.background': '#ffffff',
			'editor.foreground': '#1f2328',
			'editor.lineHighlightBackground': '#f6f8fa',
			'editor.selectionBackground': '#dbeafe',
			'editor.inactiveSelectionBackground': '#eff2f5',
			'editorCursor.foreground': '#0969da',
			'editorLineNumber.foreground': '#a8b0b9',
			'editorLineNumber.activeForeground': '#4d5560',
			'editorIndentGuide.background1': '#eaeef2',
			'editorIndentGuide.activeBackground1': '#d0d7de',
			'editorBracketMatch.background': '#00000000',
			'editorBracketMatch.border': '#0969da40',
		},
	});
};

export const createLiveEditor = ({
	container,
	files,
	activePath,
	onChange,
	onCursorChange,
}: CreateLiveEditorOptions): LiveEditorController => {
	configureMonaco();

	const models = new Map<string, monaco.editor.ITextModel>();
	let currentPath = normalizePath(activePath);

	const ensureModel = (file: VirtualProjectFile): monaco.editor.ITextModel => {
		const normalizedPath = normalizePath(file.path);
		const existingModel = models.get(normalizedPath);
		if (existingModel) {
			if (existingModel.getValue() !== file.content) {
				existingModel.setValue(file.content);
			}
			return existingModel;
		}

		const model = monaco.editor.createModel(
			file.content,
			resolveLanguage(normalizedPath),
			toModelUri(normalizedPath),
		);
		models.set(normalizedPath, model);
		return model;
	};

	for (const file of files) {
		ensureModel(file);
	}

	const editor = monaco.editor.create(container, {
		model: models.get(currentPath) ?? ensureModel(files[0]!),
		theme: AXRONE_THEME,
		automaticLayout: true,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		smoothScrolling: true,
		tabSize: 2,
		fontSize: 13,
		lineHeight: 22,
		fontFamily: 'JetBrains Mono, ui-monospace, monospace',
		wordWrap: 'off',
		bracketPairColorization: { enabled: true },
		renderLineHighlight: 'line',
		padding: { top: 16, bottom: 16 },
		overviewRulerBorder: false,
		scrollbar: {
			verticalScrollbarSize: 10,
			horizontalScrollbarSize: 10,
		},
	});

	const changeSubscription = editor.onDidChangeModelContent(() => {
		onChange(currentPath, editor.getValue());
	});

	const cursorSubscription = editor.onDidChangeCursorPosition((event) => {
		onCursorChange?.(event.position.lineNumber, event.position.column);
	});

	return {
		getValue(path = currentPath) {
			const model = models.get(normalizePath(path));
			return model?.getValue() ?? '';
		},
		setValue(path, value) {
			const model = models.get(normalizePath(path));
			if (model && model.getValue() !== value) {
				model.setValue(value);
			}
		},
		loadFiles(nextFiles, nextActivePath) {
			const nextPaths = new Set(nextFiles.map((file) => normalizePath(file.path)));

			for (const [path, model] of models) {
				if (!nextPaths.has(path)) {
					model.dispose();
					models.delete(path);
				}
			}

			for (const file of nextFiles) {
				ensureModel(file);
			}

			currentPath = normalizePath(nextActivePath);
			const nextModel = models.get(currentPath);
			if (nextModel) {
				editor.setModel(nextModel);
			}
		},
		openFile(path) {
			const normalizedPath = normalizePath(path);
			const model = models.get(normalizedPath);
			if (!model) {
				return;
			}

			currentPath = normalizedPath;
			editor.setModel(model);
			editor.focus();
		},
		focus() {
			editor.focus();
		},
		dispose() {
			changeSubscription.dispose();
			cursorSubscription.dispose();
			editor.dispose();
			for (const model of models.values()) {
				model.dispose();
			}
			models.clear();
		},
	};
};