import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../packages');
const eventSrcDir = path.resolve(packagesDir, 'event/src');
const corePackageDir = path.resolve(testDir, '../../../packages/core');
const disallowedCoreSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:event|observer|tween)(?:\/[^'"]*)?['"]/g;
const disallowedSiblingSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+(?:observer|tween)\/src(?:\/[^'"]*)?['"]/g;
const disallowedCoreEventLeakPatterns = [
    /export\s+\*\s+from\s+['"]\.\/event['"]/g,
    /\b(?:EventEmitter|createEmitter|createTypedEmitter|EventGroup|EventScheduler|EventUtils)\b/g,
];

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

describe('event ownership boundary', () => {
    it('keeps event-owned sources off core and sibling private source paths', () => {
        const violatingFiles = collectTypeScriptFiles(eventSrcDir)
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

    it('removes the legacy core package entirely', () => {
        expect(fs.existsSync(corePackageDir)).toBe(false);
    });
});
