import * as axroneAssetCore from '@axrone/asset-core';
import * as axroneAssetGltf from '@axrone/asset-gltf';
import * as axroneEcsRuntime from '@axrone/ecs-runtime';
import * as axroneGameLoop from '@axrone/game-loop';
import * as axroneGeometry from '@axrone/geometry';
import * as axroneInput from '@axrone/input';
import * as axroneMemory from '@axrone/memory';
import * as axroneNumeric from '@axrone/numeric';
import * as axroneParticleSystem from '@axrone/particle-system';
import * as axronePhysics from '@axrone/physics';
import * as axroneRandom from '@axrone/random';
import * as axroneRenderWebGL2 from '@axrone/render-webgl2';
import * as axroneRuntimeProfile2D from '@axrone/runtime-profile-2d';
import * as axroneRuntimeProfile3D from '@axrone/runtime-profile-3d';
import * as axroneRuntimeProfileCore from '@axrone/runtime-profile-core';
import * as axroneRuntimeProfileFull from '@axrone/runtime-profile-full';
import * as axroneScene2D from '@axrone/scene-2d';
import * as axroneScene3D from '@axrone/scene-3d';
import * as axroneSceneRuntimeGltf from '@axrone/scene-runtime-gltf';
import * as axroneSceneRuntime from '@axrone/scene-runtime';
import * as axroneUI from '@axrone/ui';
import * as axroneUIWebGL2 from '@axrone/ui-webgl2';
import * as axroneUtility from '@axrone/utility';
import ts from 'typescript';
import * as axronePlayground from './runtime-support';

type PlaygroundSceneExample = {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	mount(context: { readonly container: HTMLElement }): unknown;
};

export type VirtualProjectFiles = Readonly<Record<string, string>>;

const supportedModules = {
	'@axrone/asset-core': axroneAssetCore,
	'@axrone/asset-gltf': axroneAssetGltf,
	'@axrone/ecs-runtime': axroneEcsRuntime,
	'@axrone/game-loop': axroneGameLoop,
	'@axrone/geometry': axroneGeometry,
	'@axrone/input': axroneInput,
	'@axrone/memory': axroneMemory,
	'@axrone/numeric': axroneNumeric,
	'@axrone/particle-system': axroneParticleSystem,
	'@axrone/physics': axronePhysics,
	'@axrone/random': axroneRandom,
	'@axrone/render-webgl2': axroneRenderWebGL2,
	'@axrone/runtime-profile-2d': axroneRuntimeProfile2D,
	'@axrone/runtime-profile-3d': axroneRuntimeProfile3D,
	'@axrone/runtime-profile-core': axroneRuntimeProfileCore,
	'@axrone/runtime-profile-full': axroneRuntimeProfileFull,
	'@axrone/scene-2d': axroneScene2D,
	'@axrone/scene-3d': axroneScene3D,
	'@axrone/scene-runtime': axroneSceneRuntime,
	'@axrone/scene-runtime-gltf': axroneSceneRuntimeGltf,
	'@axrone/ui': axroneUI,
	'@axrone/ui-webgl2': axroneUIWebGL2,
	'@axrone/utility': axroneUtility,
	'@axrone/playground': axronePlayground,
} as const;

type SupportedSpecifier = keyof typeof supportedModules;

type EvaluatedModule = {
	exports: { default?: unknown } & Record<string, unknown>;
	loaded: boolean;
};

const normalizeProjectPath = (value: string): string => {
	const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
	const segments = normalized.split('/');
	const resolved: string[] = [];

	for (const segment of segments) {
		if (!segment || segment === '.') {
			continue;
		}

		if (segment === '..') {
			resolved.pop();
			continue;
		}

		resolved.push(segment);
	}

	return resolved.join('/');
};

const dirname = (value: string): string => {
	const normalized = normalizeProjectPath(value);
	const lastSlashIndex = normalized.lastIndexOf('/');
	return lastSlashIndex === -1 ? '' : normalized.slice(0, lastSlashIndex);
};

const joinPath = (...parts: readonly string[]): string =>
	normalizeProjectPath(parts.filter((part) => part.length > 0).join('/'));

const isRelativeSpecifier = (value: string): boolean =>
	value.startsWith('./') || value.startsWith('../');

const resolveProjectModulePath = (files: VirtualProjectFiles, requestPath: string): string => {
	const normalizedRequest = normalizeProjectPath(requestPath);
	const candidates = [
		normalizedRequest,
		`${normalizedRequest}.ts`,
		`${normalizedRequest}.tsx`,
		`${normalizedRequest}.js`,
		`${normalizedRequest}.jsx`,
		joinPath(normalizedRequest, 'index.ts'),
		joinPath(normalizedRequest, 'index.tsx'),
		joinPath(normalizedRequest, 'index.js'),
		joinPath(normalizedRequest, 'index.jsx'),
	];

	for (const candidate of candidates) {
		if (candidate in files) {
			return candidate;
		}
	}

	throw new Error(`Unable to resolve project module "${requestPath}".`);
};

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): readonly string[] =>
	diagnostics.map((diagnostic) => {
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

		if (!diagnostic.file || diagnostic.start === undefined) {
			return message;
		}

		const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
		return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`;
	});

const isPlaygroundSceneExample = (value: unknown): value is PlaygroundSceneExample => {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<PlaygroundSceneExample>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.title === 'string' &&
		typeof candidate.description === 'string' &&
		typeof candidate.mount === 'function'
	);
};

export const getSupportedPlaygroundImports = (): readonly string[] =>
	Object.keys(supportedModules).sort();

export const normalizeVirtualProjectFiles = (files: VirtualProjectFiles): VirtualProjectFiles => {
	const normalizedEntries = Object.entries(files).map(([path, content]) => [
		normalizeProjectPath(path),
		content,
	] as const);

	return Object.freeze(Object.fromEntries(normalizedEntries));
};

export const compileSceneProject = (
	projectFiles: VirtualProjectFiles,
	entryFilePath = 'main.ts',
): PlaygroundSceneExample => {
	const files = normalizeVirtualProjectFiles(projectFiles);
	const entryPath = resolveProjectModulePath(files, entryFilePath);
	const moduleCache = new Map<string, EvaluatedModule>();

	const transpileModule = (filePath: string): string => {
		const source = files[filePath];
		if (source === undefined) {
			throw new Error(`Missing project source for ${filePath}.`);
		}

		const transpileResult = ts.transpileModule(source, {
			fileName: filePath,
			reportDiagnostics: true,
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.CommonJS,
				strict: true,
				allowJs: true,
				esModuleInterop: true,
				experimentalDecorators: true,
				moduleResolution: ts.ModuleResolutionKind.Node10,
				importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
			},
		});

		const diagnostics = formatDiagnostics(transpileResult.diagnostics ?? []);
		if (diagnostics.length > 0) {
			throw new Error(diagnostics.join('\n'));
		}

		return transpileResult.outputText;
	};

	const evaluateModule = (filePath: string): EvaluatedModule['exports'] => {
		const cached = moduleCache.get(filePath);
		if (cached?.loaded) {
			return cached.exports;
		}

		const record: EvaluatedModule = cached ?? {
			exports: {},
			loaded: false,
		};
		moduleCache.set(filePath, record);

		const localRequire = (specifier: string): unknown => {
			if (specifier in supportedModules) {
				return supportedModules[specifier as SupportedSpecifier];
			}

			if (!isRelativeSpecifier(specifier)) {
				throw new Error(
					`Unsupported import "${specifier}" in ${filePath}. Supported package imports: ${getSupportedPlaygroundImports().join(', ')}`,
				);
			}

			const resolvedPath = resolveProjectModulePath(files, joinPath(dirname(filePath), specifier));
			return evaluateModule(resolvedPath);
		};

		try {
			const executable = new Function('exports', 'module', 'require', transpileModule(filePath));
			executable(record.exports, record, localRequire);
			record.loaded = true;
			return record.exports;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Project evaluation failed in ${filePath}: ${message}`);
		}
	};

	const exportedModule = evaluateModule(entryPath);
	if (!isPlaygroundSceneExample(exportedModule.default)) {
		throw new Error(
			`The project entry "${entryPath}" must export a default playground scene object.`,
		);
	}

	return exportedModule.default;
};