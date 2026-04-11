import { describe, expect, it } from 'vitest';
import * as asset2D from '@axrone/asset-2d';

describe('asset-2d entry', () => {
    it('surfaces the 2d asset seam on top of asset-core without leaking gltf-specific importers', () => {
        expect(asset2D.ASSET_2D_CAPABILITY_ID).toBe('asset/2d');
        expect(asset2D.getAsset2DCapability().packageName).toBe('@axrone/asset-2d');
        expect(asset2D.AssetDatabase).toBeDefined();
        expect(asset2D.createAssetDatabase).toBeDefined();
        expect('createGltfImporter' in asset2D).toBe(false);
    });
});