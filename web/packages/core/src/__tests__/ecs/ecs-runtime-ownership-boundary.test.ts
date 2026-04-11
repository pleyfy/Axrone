import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsRuntimeSrcDir = path.resolve(testDir, '../../../../ecs-runtime/src');
const disallowedImportPattern =
    /(?:from ['"]|import\(['"])(?:[^'"]*@axrone\/ecs(?!-(?:runtime|events|query|storage|world-support))|[^'"]*core\/src\/(?:component-system|event|observer)|[^'"]*ecs\/src(?:\/[^'"]*)?)['"]/g;

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

describe('ecs-runtime ownership boundary', () => {
    it('keeps runtime-owned sources off ecs facade and core internals', () => {
        const violatingFiles = collectTypeScriptFiles(ecsRuntimeSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasDisallowedImport = disallowedImportPattern.test(content);
                disallowedImportPattern.lastIndex = 0;
                return hasDisallowedImport;
            })
            .map((filePath) => path.relative(ecsRuntimeSrcDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});