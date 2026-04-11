import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsPackageDir = path.resolve(testDir, '../../../packages/ecs');

describe('ecs package removal', () => {
    it('removes the legacy ecs workspace package', () => {
        expect(fs.existsSync(ecsPackageDir)).toBe(false);
    });
});