import { describe, expect, it } from 'vitest';
import { createGltfAssetDisposers } from '../disposers';
import type { GltfAssetSchema, GltfTextureAsset, GltfDocumentAsset, GltfPrefabAsset } from '../types';
import type { AssetRecord } from '@axrone/asset-core';

function makeTextureAsset(payload: Record<string, unknown> = {}): GltfTextureAsset {
    return {
        id: 'tex-0',
        textureIndex: 0,
        imageIndex: 0,
        sampler: {
            wrapS: 'repeat',
            wrapT: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear',
        },
        payload: {
            kind: 'raw',
            bytes: new Uint8Array([1, 2, 3]),
            ...payload,
        } as GltfTextureAsset['payload'],
        usageHints: [],
        transcode: { transcoderId: undefined, reason: undefined, targetFormat: undefined },
    };
}

function makeFakeRecord<TKind extends keyof GltfAssetSchema>(
    kind: TKind,
    data: GltfAssetSchema[TKind]
): Readonly<AssetRecord<GltfAssetSchema, TKind>> {
    return Object.freeze({
        id: 'test-id',
        kind,
        key: 'test-key',
        data,
        revision: 1,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        metadata: {},
        aliases: [],
        dependencies: [],
        reference: { id: 'test-id', kind } as AssetRecord<GltfAssetSchema, TKind>['reference'],
    });
}

describe('createGltfAssetDisposers', () => {
    it('returns a disposer map with entries for document, prefab, and texture kinds', () => {
        const disposers = createGltfAssetDisposers();
        expect(disposers).toBeDefined();
        expect(typeof disposers['gltf.document']).toBe('function');
        expect(typeof disposers['gltf.prefab']).toBe('function');
        expect(typeof disposers['gltf.texture']).toBe('function');
    });

    it('texture disposer calls close() on payloads that support it', () => {
        const disposers = createGltfAssetDisposers();
        const closeFn = { close: () => { closed = true; } };
        let closed = false;
        const texture = makeTextureAsset(closeFn);
        const record = makeFakeRecord('gltf.texture', texture);

        disposers['gltf.texture']!(texture, record as Readonly<AssetRecord<GltfAssetSchema, 'gltf.texture'>>);

        expect(closed).toBe(true);
    });

    it('texture disposer is safe for raw byte payloads (no close method)', () => {
        const disposers = createGltfAssetDisposers();
        const texture = makeTextureAsset();
        const record = makeFakeRecord('gltf.texture', texture);

        expect(() => {
            disposers['gltf.texture']!(texture, record as Readonly<AssetRecord<GltfAssetSchema, 'gltf.texture'>>);
        }).not.toThrow();
    });

    it('document disposer runs without error on a minimal document', () => {
        const disposers = createGltfAssetDisposers();
        const doc: GltfDocumentAsset = {
            id: 'doc-0',
            name: 'test',
            format: 'gltf',
            version: '2.0',
            defaultScene: 0,
            scenes: [],
            meshKeys: [],
            skinKeys: [],
            animationKeys: [],
            materialKeys: [],
            textureKeys: [],
            extensionsUsed: [],
            extensionsRequired: [],
            stats: {
                sceneCount: 0,
                nodeCount: 0,
                cameraCount: 0,
                lightCount: 0,
                meshCount: 0,
                materialCount: 0,
                textureCount: 0,
                animationCount: 0,
                skinCount: 0,
                primitiveCount: 0,
                vertexCount: 0,
            },
        };
        const record = makeFakeRecord('gltf.document', doc);

        expect(() => {
            disposers['gltf.document']!(doc, record as Readonly<AssetRecord<GltfAssetSchema, 'gltf.document'>>);
        }).not.toThrow();
    });

    it('prefab disposer runs without error on a minimal prefab', () => {
        const disposers = createGltfAssetDisposers();
        const prefab: GltfPrefabAsset = {
            id: 'prefab-0',
            sceneIndex: 0,
            definition: {
                id: 'def-0',
                entities: [],
            },
            rootNodeIds: [],
            nodeIds: [],
            meshKeys: [],
            skinKeys: [],
            animationKeys: [],
            materialKeys: [],
        };
        const record = makeFakeRecord('gltf.prefab', prefab);

        expect(() => {
            disposers['gltf.prefab']!(prefab, record as Readonly<AssetRecord<GltfAssetSchema, 'gltf.prefab'>>);
        }).not.toThrow();
    });
});
