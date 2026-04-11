import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../packages');
const tweenSrcDir = path.resolve(packagesDir, 'tween/src');
const corePackageDir = path.resolve(testDir, '../../../packages/core');
const disallowedCoreSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:event|observer|tween|types)(?:\/[^'"]*)?['"]/g;
const disallowedPackageSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+(?:event|observer)\/src(?:\/[^'"]*)?['"]/g;
const disallowedCoreTweenLeakPattern = /export\s+\*\s+from\s+['"]\.\/tween['"]/g;

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

describe('tween ownership boundary', () => {
    it('keeps tween-owned sources off core and sibling private source paths', () => {
        const violatingFiles = collectTypeScriptFiles(tweenSrcDir)
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasCoreBypass = disallowedCoreSourceBypassPattern.test(content);
                disallowedCoreSourceBypassPattern.lastIndex = 0;
                const hasPackageBypass = disallowedPackageSourceBypassPattern.test(content);
                disallowedPackageSourceBypassPattern.lastIndex = 0;
                return hasCoreBypass || hasPackageBypass;
            })
            .map((filePath) => path.relative(packagesDir, filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });

    it('removes the legacy core package entirely', () => {
        expect(fs.existsSync(corePackageDir)).toBe(false);
    });
});
