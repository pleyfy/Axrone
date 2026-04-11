import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    collectTypeScriptFiles,
    isTestSourceFile,
    listModuleSpecifiers,
    toWorkspaceRelativePath,
} from '../_helpers/import-specifiers';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(testDir, '../../..');
const packagesDir = path.resolve(workspaceDir, 'packages');
const examplesDir = path.resolve(workspaceDir, 'examples');
const inputSrcDir = path.resolve(packagesDir, 'input/src');

const collectWorkspaceSourceFiles = (): readonly string[] =>
    [packagesDir, examplesDir].flatMap((dirPath) =>
        collectTypeScriptFiles(dirPath, {
            exclude: (filePath) => isTestSourceFile(filePath),
        })
    );

const isPrivateInputSpecifier = (specifier: string): boolean =>
    specifier.startsWith('@axrone/input/') || specifier.includes('input/src/');

describe('input consumer boundary', () => {
    it('keeps package and example consumers on the public input facade only', () => {
        const violatingFiles = collectWorkspaceSourceFiles()
            .filter((filePath) => !filePath.startsWith(inputSrcDir))
            .filter((filePath) =>
                listModuleSpecifiers(filePath).some((specifier) => isPrivateInputSpecifier(specifier))
            )
            .map((filePath) => toWorkspaceRelativePath(workspaceDir, filePath))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});