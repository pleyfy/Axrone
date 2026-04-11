import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.resolve(testDir, '../../../packages/core');

describe('core asset boundary', () => {
    it('removes the legacy core package entirely', () => {
        expect(fs.existsSync(corePackageDir)).toBe(false);
    });

    it('does not expose the legacy asset subpath', async () => {
        const legacyAssetSubpath = '@axrone/core/asset';

        await expect(import(/* @vite-ignore */ legacyAssetSubpath)).rejects.toThrow();
    });
});
