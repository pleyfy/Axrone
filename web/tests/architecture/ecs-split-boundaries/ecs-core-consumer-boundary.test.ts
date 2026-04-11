import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const coreSrcDir = path.resolve(testDir, '../../../packages/core/src');
const disallowedFacadeImportPattern =
    /(?:from ['"]|import\(['"])(?:\.{1,2}\/)+[^'"]*component-system\/(?:core|types|decorators|systems|memory|archetype|observers|components\/(?:hierarchy|transform))(?:\/[^'"]*)?['"]/g;

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

describe('ecs core consumer boundary', () => {
    it('keeps core consumers off removed component-system source paths', () => {
        const violatingFiles = collectTypeScriptFiles(coreSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasFacadeImport = disallowedFacadeImportPattern.test(content);
                disallowedFacadeImportPattern.lastIndex = 0;
                return hasFacadeImport;
            })
            .map((filePath) => path.relative(coreSrcDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});