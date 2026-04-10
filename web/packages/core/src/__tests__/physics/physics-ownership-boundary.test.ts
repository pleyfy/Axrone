import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../..');
const physicsSrcDir = path.resolve(packagesDir, 'physics/src');
const corePhysicsDir = path.resolve(testDir, '../../physics');
const disallowedCoreSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:input|physics|geometry)(?:\/[^'"]*)?['"]/g;
const disallowedSiblingSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+geometry\/src(?:\/[^'"]*)?['"]/g;

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

describe('physics ownership boundary', () => {
    it('keeps physics-owned sources on local files and public geometry dependencies', () => {
        const violatingFiles = collectTypeScriptFiles(physicsSrcDir)
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

    it('leaves core physics as a thin facade only', () => {
        const files = collectTypeScriptFiles(corePhysicsDir)
            .map((filePath) => path.relative(corePhysicsDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(files).toEqual(['index.ts']);
    });
});