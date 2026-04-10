import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../..');
const eventSrcDir = path.resolve(packagesDir, 'event/src');
const coreIndexPath = path.resolve(testDir, '../../index.ts');
const coreComponentSystemIndexPath = path.resolve(testDir, '../../component-system/index.ts');
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
            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.ts')) {
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

    it('keeps core barrels from re-exporting general event APIs', () => {
        const coreBarrelFiles = [coreIndexPath, coreComponentSystemIndexPath];
        const violatingFiles = coreBarrelFiles
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                return disallowedCoreEventLeakPatterns.some((pattern) => {
                    const hasViolation = pattern.test(content);
                    pattern.lastIndex = 0;
                    return hasViolation;
                });
            })
            .map((filePath) => path.relative(path.resolve(testDir, '../..'), filePath).replace(/\\/g, '/'))
            .sort((left, right) => left.localeCompare(right));

        expect(violatingFiles).toEqual([]);
    });
});