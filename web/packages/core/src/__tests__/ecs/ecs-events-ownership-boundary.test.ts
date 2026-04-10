import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsEventsSrcDir = path.resolve(testDir, '../../../../ecs-events/src');
const disallowedImportPattern =
    /(?:from ['"]|import\(['"])(?:[^'"]*@axrone\/ecs(?!-events)|[^'"]*core\/src\/(?:component-system|event|observer)|[^'"]*ecs\/src\/(?:component-system|support))(?:\/[^'"]*)?['"]/g;

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

describe('ecs-events ownership boundary', () => {
    it('keeps ecs-events owned sources off ecs and core internals', () => {
        const violatingFiles = collectTypeScriptFiles(ecsEventsSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasDisallowedImport = disallowedImportPattern.test(content);
                disallowedImportPattern.lastIndex = 0;
                return hasDisallowedImport;
            })
            .map((filePath) => path.relative(ecsEventsSrcDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});