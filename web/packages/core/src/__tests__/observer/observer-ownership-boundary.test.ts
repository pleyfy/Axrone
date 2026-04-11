import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(testDir, '../../../..');
const observerSrcDir = path.resolve(packagesDir, 'observer/src');
const coreIndexPath = path.resolve(testDir, '../../index.ts');
const disallowedCoreSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+core\/src\/(?:event|observer|tween)(?:\/[^'"]*)?['"]/g;
const disallowedPackageSourceBypassPattern =
    /(?:from ['"]|import\(['"])(?:\.\.\/)+(?:event|tween)\/src(?:\/[^'"]*)?['"]/g;
const disallowedCoreObserverLeakPatterns = [
    /export\s+\*\s+from\s+['"]\.\/observer['"]/g,
    /\b(?:Subject|BehaviorSubject|ReplaySubject|AsyncSubject|ObserverUtils|createSubject|createBehaviorSubject|createReplaySubject)\b/g,
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

describe('observer ownership boundary', () => {
    it('keeps observer-owned sources on public package dependencies', () => {
        const violatingFiles = collectTypeScriptFiles(observerSrcDir)
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

    it('keeps core barrels from re-exporting general observer APIs', () => {
        const coreBarrelFiles = [coreIndexPath];
        const violatingFiles = coreBarrelFiles
            .filter((filePath) => {
                const content = fs.readFileSync(filePath, 'utf8');
                return disallowedCoreObserverLeakPatterns.some((pattern) => {
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