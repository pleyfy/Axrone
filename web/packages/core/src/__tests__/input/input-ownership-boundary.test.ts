import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../..');
const inputSrcDir = path.resolve(packagesDir, 'input/src');
const coreInputDir = path.resolve(testDir, '../../input');
const disallowedCoreSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:input|physics|geometry)(?:\/[^'"]*)?['"]/g;
const disallowedSiblingSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+(?:event|geometry|physics|observer|tween)\/src(?:\/[^'"]*)?['"]/g;

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

describe('input ownership boundary', () => {
    it('keeps input-owned sources on local or public package dependencies', () => {
        const violatingFiles = collectTypeScriptFiles(inputSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasCoreBypass = disallowedCoreSourceBypassPattern.test(content);
                disallowedCoreSourceBypassPattern.lastIndex = 0;
                const hasSiblingBypass = disallowedSiblingSourceBypassPattern.test(content);
                disallowedSiblingSourceBypassPattern.lastIndex = 0;
                return hasCoreBypass || hasSiblingBypass;
            })
            .map((filePath) => path.relative(packagesDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });

    it('leaves core input as a thin facade only', () => {
        const files = collectTypeScriptFiles(coreInputDir)
            .map((filePath) => path.relative(coreInputDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(files).toEqual(['index.ts']);
    });
});