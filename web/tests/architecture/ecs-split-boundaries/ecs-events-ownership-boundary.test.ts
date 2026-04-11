import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsEventsSrcDir = path.resolve(testDir, '../../../packages/ecs-events/src');
const disallowedImportPattern =
    /(?:from ['"]|import\(['"])(?:[^'"]*@axrone\/ecs(?!-events)|[^'"]*core\/src\/(?:component-system|event|observer)|[^'"]*ecs\/src\/(?:component-system|support))(?:\/[^'"]*)?['"]/g;

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

    it('composes shared event and observer packages for generic primitives', () => {
        const eventBridge = fs.readFileSync(path.resolve(ecsEventsSrcDir, 'event.ts'), 'utf8');
        const observerBridge = fs.readFileSync(path.resolve(ecsEventsSrcDir, 'observer.ts'), 'utf8');

        expect(eventBridge).toContain("from '@axrone/event'");
        expect(observerBridge).toContain("from '@axrone/observer'");
        expect(eventBridge).not.toMatch(/\bclass\s+TypedEventEmitter\b/);
        expect(observerBridge).not.toMatch(/\bclass\s+BehaviorObservableSubject\b/);
    });
});