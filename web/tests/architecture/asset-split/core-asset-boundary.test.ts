import { describe, expect, it } from 'vitest';
import * as core from '@axrone/core';

describe('core asset boundary', () => {
    it('does not re-export asset-core primitives from the core root', () => {
        expect('AssetDatabase' in core).toBe(false);
        expect('AssetImportPipeline' in core).toBe(false);
        expect('createAssetDatabase' in core).toBe(false);
        expect('createAssetImportPipeline' in core).toBe(false);
    });

    it('does not expose the legacy asset subpath', async () => {
        const legacyAssetSubpath = '@axrone/core/asset';

        await expect(import(/* @vite-ignore */ legacyAssetSubpath)).rejects.toThrow();
    });
});