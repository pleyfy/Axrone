import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsSrcDir = path.resolve(testDir, '../../../../ecs/src');
const directCoreInternalImportPattern = /from ['"][^'"]*core\/src\/(?:component-system|event|observer)(?:\/[^'"]*)?['"]/g;

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

describe('ecs ownership boundary', () => {
    it('keeps ecs-owned sources off core internals', () => {
        const directCoreImportFiles = collectTypeScriptFiles(ecsSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasDirectCoreImport = directCoreInternalImportPattern.test(content);
                directCoreInternalImportPattern.lastIndex = 0;
                return hasDirectCoreImport;
            })
            .map((filePath) => path.relative(ecsSrcDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(directCoreImportFiles).toEqual([]);
    });
});