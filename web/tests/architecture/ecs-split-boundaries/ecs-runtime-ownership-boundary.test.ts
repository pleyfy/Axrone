import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsRuntimeSrcDir = path.resolve(testDir, '../../../packages/ecs-runtime/src');
const disallowedImportPattern =
    /(?:from ['"]|import\(['"])(?:[^'"]*@axrone\/ecs(?!-(?:runtime|query|storage|world-support))|[^'"]*core\/src\/(?:component-system|event|observer)|[^'"]*ecs\/src(?:\/[^'"]*)?)['"]/g;

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

    it('composes shared event and observer packages directly', () => {
        const worldEventRuntime = fs.readFileSync(
            path.resolve(ecsRuntimeSrcDir, 'component-system/core/world-event-runtime.ts'),
            'utf8'
        );
        const ecsObserver = fs.readFileSync(
            path.resolve(ecsRuntimeSrcDir, 'component-system/observers/ecs-observer.ts'),
            'utf8'
        );

        expect(worldEventRuntime).toContain("from '@axrone/event'");
        expect(ecsObserver).toContain("from '@axrone/observer'");
        expect(worldEventRuntime).not.toContain("@axrone/ecs-events");
        expect(ecsObserver).not.toContain("@axrone/ecs-events");
    });
});