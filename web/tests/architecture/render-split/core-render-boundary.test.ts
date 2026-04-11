import { describe, expect, it } from 'vitest';
import * as core from '@axrone/core';

describe('core render boundary', () => {
    it('keeps the core root empty after the physical render split', () => {
        expect(Object.keys(core)).toEqual([]);
    });

    it('does not expose the legacy render buffer subpath', async () => {
        const legacyRenderBufferSubpath = '@axrone/core/renderer/webgl2/buffer';

        await expect(import(/* @vite-ignore */ legacyRenderBufferSubpath)).rejects.toThrow();
    });
});