import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ecsFacadeComponentSystemDir = path.resolve(testDir, '../../../../ecs/src/component-system');

describe('ecs facade physical split', () => {
    it('keeps ecs facade free of a local component-system implementation tree', () => {
        expect(fs.existsSync(ecsFacadeComponentSystemDir)).toBe(false);
    });
});