import * as axroneCore from '@axrone/core';
import * as axroneNumeric from '@axrone/numeric';
import * as axroneRandom from '@axrone/random';
import * as axroneUI from '@axrone/ui';
import * as axroneUIWebGL2 from '@axrone/ui-webgl2';
import * as axroneUtility from '@axrone/utility';
import ts from 'typescript';
import * as exampleRuntime from '../example-runtime';
import type { SceneExample } from '../example-types';

const supportedModules = {
    '@axrone/core': axroneCore,
    '@axrone/numeric': axroneNumeric,
    '@axrone/random': axroneRandom,
    '@axrone/ui': axroneUI,
    '@axrone/ui-webgl2': axroneUIWebGL2,
    '@axrone/utility': axroneUtility,
    './example-runtime': exampleRuntime,
    './example-types': {},
} as const;

type SupportedSpecifier = keyof typeof supportedModules;

const supportedImports = Object.keys(supportedModules).sort();

const isSceneExample = (value: unknown): value is SceneExample => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<SceneExample>;
    return (
        typeof candidate.id === 'string' &&
        typeof candidate.title === 'string' &&
        typeof candidate.description === 'string' &&
        typeof candidate.mount === 'function'
    );
};

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): readonly string[] => {
    return diagnostics.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

        if (!diagnostic.file || diagnostic.start === undefined) {
            return message;
        }

        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`;
    });
};

const createRuntimeRequire = () => {
    return (specifier: string): unknown => {
        if (specifier in supportedModules) {
            return supportedModules[specifier as SupportedSpecifier];
        }

        throw new Error(
            `Unsupported import "${specifier}". Supported imports: ${supportedImports.join(', ')}`
        );
    };
};

export const getSupportedPlaygroundImports = (): readonly string[] => supportedImports;

export const compileSceneExample = (source: string, fileName = 'live-example.ts'): SceneExample => {
    const transpileResult = ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            strict: true,
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

    const module = {
        exports: {} as { default?: unknown },
    };

    try {
        const execute = new Function('exports', 'module', 'require', transpileResult.outputText);
        execute(module.exports, module, createRuntimeRequire());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Example evaluation failed: ${message}`);
    }

    if (!isSceneExample(module.exports.default)) {
        throw new Error('The edited script must export a default SceneExample object.');
    }

    return module.exports.default;
};