import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.resolve(testDir, '../../../packages/core');

describe('ecs core compatibility boundary', () => {
    it('removes the legacy core package entirely', () => {
        expect(fs.existsSync(corePackageDir)).toBe(false);
    });
});
