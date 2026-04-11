import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceTsconfigPath = path.resolve(testDir, '../../../tsconfig.json');

describe('ecs ownership boundary', () => {
    it('removes legacy ecs tsconfig path aliases', () => {
        const content = fs.readFileSync(workspaceTsconfigPath, 'utf8');

        expect(content).not.toContain('"@axrone/ecs"');
        expect(content).not.toContain('"@axrone/ecs/*"');
    });
});