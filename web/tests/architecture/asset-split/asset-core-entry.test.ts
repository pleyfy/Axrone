import { describe, expect, it } from 'vitest';
import * as assetCore from '@axrone/asset-core';

describe('asset-core entry', () => {
    it('surfaces asset database and import pipeline primitives without leaking gltf adapters', () => {
        expect(assetCore.AssetDatabase).toBeDefined();
        expect(assetCore.createAssetDatabase).toBeDefined();
        expect(assetCore.AssetImportPipeline).toBeDefined();
        expect(assetCore.createAssetImportPipeline).toBeDefined();
        expect(assetCore.canonicalizeAssetKey).toBeDefined();
        expect('createGltfImporter' in assetCore).toBe(false);
        expect('createGltfSceneSnapshot' in assetCore).toBe(false);
        expect('loadGltfSceneIntoScene' in assetCore).toBe(false);
    });
});