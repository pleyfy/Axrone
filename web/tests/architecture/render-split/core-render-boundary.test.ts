import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.resolve(testDir, '../../../packages/core');

describe('core render boundary', () => {
    it('removes the legacy core package entirely', () => {
        expect(fs.existsSync(corePackageDir)).toBe(false);
    });

    it('does not expose the legacy render buffer subpath', async () => {
        const legacyRenderBufferSubpath = '@axrone/core/renderer/webgl2/buffer';

        await expect(import(/* @vite-ignore */ legacyRenderBufferSubpath)).rejects.toThrow();
    });
});
