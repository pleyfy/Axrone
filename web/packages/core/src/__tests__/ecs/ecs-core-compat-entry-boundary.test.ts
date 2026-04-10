import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const coreComponentSystemDir = path.resolve(testDir, '../../component-system');
const disallowedEcsSourceBypassPattern =
    /(?:from ['"]|import\(['"])\.{1,2}(?:\/[^'"]+)*\/ecs\/src\/component-system(?:\/[^'"]*)?['"]/g;

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

describe('ecs core compatibility boundary', () => {
    it('keeps core component-system compatibility wrappers on official ecs entrypoints', () => {
        const violatingFiles = collectTypeScriptFiles(coreComponentSystemDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasSourceBypass = disallowedEcsSourceBypassPattern.test(content);
                disallowedEcsSourceBypassPattern.lastIndex = 0;
                return hasSourceBypass;
            })
            .map((filePath) => path.relative(coreComponentSystemDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});
