import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsEventsPackageDir = path.resolve(testDir, '../../../packages/ecs-events');

describe('ecs-events package removal', () => {
    it('removes the deprecated ecs-events workspace package', () => {
        expect(fs.existsSync(ecsEventsPackageDir)).toBe(false);
    });
});