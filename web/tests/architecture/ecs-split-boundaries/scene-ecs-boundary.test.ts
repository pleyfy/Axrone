import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../packages');
const scenePackageDirs = [
    path.resolve(packagesDir, 'scene-runtime/src'),
    path.resolve(packagesDir, 'scene-2d/src'),
    path.resolve(packagesDir, 'scene-3d/src'),
];
const directCoreComponentSystemImportPattern = /from ['"](?:\.\.\/)+core\/src\/component-system(?:\/[^'"]*)?['"]/g;

const collectTypeScriptFiles = (dirPath: string): readonly string[] => {
    const files: string[] = [];

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__') {
                continue;
            }

            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }

        if (
            entry.isFile() &&
            entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.test.ts') &&
            !entry.name.endsWith('.spec.ts')
        ) {
            files.push(fullPath);
        }
    }

    return files;
};

describe('scene ecs boundary', () => {
    it('keeps scene packages off core component-system source paths', () => {
        const directCoreImportFiles = scenePackageDirs
            .flatMap((dirPath) => collectTypeScriptFiles(dirPath))
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasDirectCoreImport = directCoreComponentSystemImportPattern.test(content);
                directCoreComponentSystemImportPattern.lastIndex = 0;
                return hasDirectCoreImport;
            })
            .map((filePath) => path.relative(packagesDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(directCoreImportFiles).toEqual([]);
    });
});