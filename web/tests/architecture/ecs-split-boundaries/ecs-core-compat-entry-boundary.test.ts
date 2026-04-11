import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const coreSrcDir = path.resolve(testDir, '../../../packages/core/src');
const coreIndexPath = path.resolve(coreSrcDir, 'index.ts');
const coreComponentSystemDir = path.resolve(coreSrcDir, 'component-system');

describe('ecs core compatibility boundary', () => {
    it('removes the legacy core component-system compatibility directory', () => {
        expect(fs.existsSync(coreComponentSystemDir)).toBe(false);
    });

    it('keeps the core root entry off component-system re-exports', () => {
        const content = fs.readFileSync(coreIndexPath, 'utf8');

        expect(content).not.toContain('./component-system');
    });
});
