import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../packages');
const packageSourceDirs = [
    path.resolve(packagesDir, 'scene-2d/src'),
    path.resolve(packagesDir, 'scene-runtime/src'),
    path.resolve(packagesDir, 'scene-3d/src'),
    path.resolve(packagesDir, 'ui-webgl2/src'),
];
const disallowedCoreRuntimeImportPattern = /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:game-loop|renderer\/webgl2\/texture)(?:\/[^'"]*)?['"]/g;
const disallowedPrivateSceneRuntimeImportPattern = /(?:from ['"]|import\(['"])(?:\.\.\/)+scene-runtime\/src\/(?:[^'"]*)['"]/g;

const collectTypeScriptFiles = (dirPath: string): readonly string[] => {
    const files: string[] = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
        }
    }

    return files;
};

describe('scene runtime support boundary', () => {
    it('keeps runtime-facing packages off core game-loop and texture source paths', () => {
        const violatingFiles = packageSourceDirs
            .flatMap((dirPath) => collectTypeScriptFiles(dirPath))
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasCoreImport = disallowedCoreRuntimeImportPattern.test(content);
                disallowedCoreRuntimeImportPattern.lastIndex = 0;
                return hasCoreImport;
            })
            .map((filePath) => path.relative(packagesDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });

    it('keeps scene capability packages on public scene-runtime entrypoints', () => {
        const capabilityPackageDirs = [
            path.resolve(packagesDir, 'scene-2d/src'),
            path.resolve(packagesDir, 'scene-3d/src'),
        ];

        const violatingFiles = capabilityPackageDirs
            .flatMap((dirPath) => collectTypeScriptFiles(dirPath))
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasPrivateImport = disallowedPrivateSceneRuntimeImportPattern.test(content);
                disallowedPrivateSceneRuntimeImportPattern.lastIndex = 0;
                return hasPrivateImport;
            })
            .map((filePath) => path.relative(packagesDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});