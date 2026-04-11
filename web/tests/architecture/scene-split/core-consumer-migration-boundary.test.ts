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

const collectWorkspaceSourceFiles = (): readonly string[] =>
    [packagesDir, examplesDir].flatMap((dirPath) =>
        collectTypeScriptFiles(dirPath, {
            exclude: (filePath) => isTestSourceFile(filePath),
        })
    );

const isCoreConsumerSpecifier = (specifier: string): boolean =>
    specifier === '@axrone/core' ||
    specifier.startsWith('@axrone/core/') ||
    specifier.includes('core/src/');

describe('core consumer migration boundary', () => {
    it('keeps package and example sources off the removed core facade and private core source paths', () => {
        const violatingFiles = collectWorkspaceSourceFiles()
            .filter((filePath) =>
                listModuleSpecifiers(filePath).some((specifier) => isCoreConsumerSpecifier(specifier))
            )
            .map((filePath) => toWorkspaceRelativePath(workspaceDir, filePath))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});