import { describe, expect, it, vi } from 'vitest';
import type {
    GltfAssetSchema,
    GltfAssetSchemaLike,
    GltfDocumentAsset,
    GltfMaterialAsset,
    GltfMeshAsset,
    GltfPrefabAsset,
    GltfTextureAsset,
} from '@axrone/asset-gltf';
import { FilterMode, TextureFormat, WrapMode } from '@axrone/render-webgl2';
import type { AssetDatabase, AssetRecord, AssetSelector } from '@axrone/asset-core';
import { createGltfSceneSnapshot } from '../scene-snapshot-adapter';

type AnyRecord = AssetRecord<GltfAssetSchemaLike, any>;

const createMockRecord = <T>(key: string, kind: string, data: T): AnyRecord =>
    ({
        kind,
        id: `id:${key}`,
        key,
        aliases: [],
        name: key,
        data,
        revision: 1,
        fingerprint: 'fp',
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        metadata: {},
        dependencyIds: [],
        reference: { kind, key },
        versionedReference: { kind, key, version: 1 },
    }) as unknown as AnyRecord;

const createMinimalDocument = (
    overrides: Partial<GltfDocumentAsset> = {}
): GltfDocumentAsset => ({
    id: 'doc/test',
    name: 'test',
    format: 'glb',
    version: '2.0',
    defaultScene: 0,
    scenes: [
        {
            sceneIndex: 0,
            name: 'Main',
            prefabKey: 'prefab/test',
            rootNodeIds: ['node/0'],
        },
    ],
    meshKeys: [],
    skinKeys: [],
    animationKeys: [],
    materialKeys: [],
    textureKeys: [],
    extensionsUsed: [],
    ...overrides,
});

const createMinimalPrefab = (
    overrides: Partial<GltfPrefabAsset> = {}
): GltfPrefabAsset => ({
    id: 'prefab/test',
    sceneIndex: 0,
    definition: {
        id: 'prefab/test',
        entities: [],
    },
    rootNodeIds: ['node/0'],
    nodeIds: ['node/0'],
    meshKeys: [],
    skinKeys: [],
    animationKeys: [],
    materialKeys: [],
    ...overrides,
});

const createMinimalMaterial = (
    key: string,
    overrides: Partial<GltfMaterialAsset> = {}
): GltfMaterialAsset => ({
    id: key,
    materialIndex: 0,
    definition: {
        id: key,
        shaderId: 'gltf/pbr',
        uniforms: {},
    },
    alphaMode: 'OPAQUE',
    alphaCutoff: 0.5,
    doubleSided: false,
    unlit: false,
    textures: {},
    ...overrides,
});

const createMinimalMesh = (key: string): GltfMeshAsset => ({
    id: key,
    meshIndex: 0,
    primitiveIndex: 0,
    definition: {
        id: key,
        vertices: new Float32Array([0, 0, 0]),
        attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
    },
});

const createMockDatabase = (
    document: GltfDocumentAsset,
    prefab: GltfPrefabAsset,
    materials: Map<string, GltfMaterialAsset> = new Map(),
    meshes: Map<string, GltfMeshAsset> = new Map(),
    textures: Map<string, GltfTextureAsset> = new Map()
): AssetDatabase<GltfAssetSchema> => {
    const docRecord = createMockRecord('doc/test', 'gltf.document', document);
    const prefabRecord = createMockRecord(prefab.definition.id, 'gltf.prefab', prefab);

    return {
        require: vi.fn((selector: AssetSelector<GltfAssetSchemaLike, any>) => {
            if (typeof selector === 'object' && 'kind' in selector) {
                const lookup = selector as { key: string; kind: string };
                switch (lookup.kind) {
                    case 'gltf.prefab':
                        return prefabRecord;
                    case 'gltf.material': {
                        const mat = materials.get(lookup.key);
                        if (mat) return createMockRecord(lookup.key, 'gltf.material', mat);
                        break;
                    }
                    case 'gltf.mesh': {
                        const mesh = meshes.get(lookup.key);
                        if (mesh) return createMockRecord(lookup.key, 'gltf.mesh', mesh);
                        break;
                    }
                    case 'gltf.texture': {
                        const tex = textures.get(lookup.key);
                        if (tex) return createMockRecord(lookup.key, 'gltf.texture', tex);
                        break;
                    }
                }
            }
            return docRecord;
        }),
    } as unknown as AssetDatabase<GltfAssetSchema>;
};

describe('scene-snapshot-adapter', () => {
    it('builds a complete scene snapshot from a minimal document', () => {
        const document = createMinimalDocument();
        const prefab = createMinimalPrefab();
        const database = createMockDatabase(document, prefab);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = createGltfSceneSnapshot(database, selector as any);

        expect(result.document).toEqual(docRecord(document));
        expect(result.scene).toEqual(document.scenes[0]);
        expect(result.prefab).toBeDefined();
        expect(result.snapshot.version).toBe(1);
        expect(result.snapshot.prefab).toBeDefined();
        expect(result.snapshot.shaders).toEqual([]);
        expect(result.snapshot.meshes).toEqual([]);
        expect(result.snapshot.materials).toEqual([]);
        expect(result.snapshot.textures).toEqual([]);
        expect(result.snapshot.samplers).toEqual([]);
        expect(result.snapshot.renderPasses).toEqual([]);
        expect(Object.isFrozen(result.diagnostics)).toBe(true);
    });

    it('uses the default scene index from the document', () => {
        const document = createMinimalDocument({
            defaultScene: 1,
            scenes: [
                { sceneIndex: 0, name: 'Other', prefabKey: 'prefab/other', rootNodeIds: [] },
                { sceneIndex: 1, name: 'Main', prefabKey: 'prefab/test', rootNodeIds: ['node/0'] },
            ],
        });
        const prefab = createMinimalPrefab();
        const database = createMockDatabase(document, prefab);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = createGltfSceneSnapshot(database, selector as any);

        expect(result.scene.name).toBe('Main');
        expect(result.scene.sceneIndex).toBe(1);
    });

    it('uses explicit sceneIndex option over defaultScene', () => {
        const document = createMinimalDocument({
            defaultScene: 0,
            scenes: [
                { sceneIndex: 0, name: 'Default', prefabKey: 'prefab/default', rootNodeIds: [] },
                { sceneIndex: 1, name: 'Override', prefabKey: 'prefab/test', rootNodeIds: ['node/0'] },
            ],
        });
        const prefab = createMinimalPrefab();
        const database = createMockDatabase(document, prefab);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = createGltfSceneSnapshot(database, selector as any, { sceneIndex: 1 });

        expect(result.scene.name).toBe('Override');
    });

    it('throws when the scene index is out of range', () => {
        const document = createMinimalDocument({ scenes: [] });
        const prefab = createMinimalPrefab();
        const database = createMockDatabase(document, prefab);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        expect(() => createGltfSceneSnapshot(database, selector as any, { sceneIndex: 5 })).toThrow(
            /does not contain scene 5/
        );
    });

    it('throws when shader cannot be resolved for a material', () => {
        const material = createMinimalMaterial('mat/test', {
            definition: {
                id: 'mat/test',
                shaderId: 'custom/unknown',
                uniforms: {},
            },
        });
        const materials = new Map([['mat/test', material]]);
        const document = createMinimalDocument({ materialKeys: ['mat/test'] });
        const prefab = createMinimalPrefab({ materialKeys: ['mat/test'] });
        const database = createMockDatabase(document, prefab, materials);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        expect(() =>
            createGltfSceneSnapshot(database, selector as any, {
                resolveShaderDefinition: () => undefined,
            })
        ).toThrow(/cannot resolve shader 'custom\/unknown'/);
    });

    it('deduplicates textures and samplers shared across materials', () => {
        const sampler = {
            id: 'sampler/shared',
            minFilter: FilterMode.LINEAR,
            magFilter: FilterMode.LINEAR,
            wrapS: WrapMode.REPEAT,
            wrapT: WrapMode.REPEAT,
        };
        const textureAsset: GltfTextureAsset = {
            id: 'tex/shared',
            textureIndex: 0,
            imageIndex: 0,
            sampler,
            payload: {
                kind: 'raw',
                bytes: new Uint8Array([255, 255, 255, 255]),
                mimeType: 'image/png',
                width: 1,
                height: 1,
            },
            usageHints: ['baseColor'],
            runtimeFormat: TextureFormat.RGBA8,
            transcode: { status: 'source' },
        };

        const textureBinding = {
            textureKey: 'tex/shared',
            usage: 'baseColor' as const,
            texCoord: 0,
            colorSpace: 'srgb' as const,
        };

        const mat1 = createMinimalMaterial('mat/one', {
            textures: { baseColor: textureBinding },
        });
        const mat2 = createMinimalMaterial('mat/two', {
            textures: { baseColor: textureBinding },
        });

        const materials = new Map([
            ['mat/one', mat1],
            ['mat/two', mat2],
        ]);
        const textures = new Map([['tex/shared', textureAsset]]);

        const document = createMinimalDocument({ materialKeys: ['mat/one', 'mat/two'] });
        const prefab = createMinimalPrefab({ materialKeys: ['mat/one', 'mat/two'] });
        const database = createMockDatabase(document, prefab, materials, new Map(), textures);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = createGltfSceneSnapshot(database, selector as any);

        expect(result.snapshot.textures).toHaveLength(1);
        expect(result.snapshot.samplers).toHaveLength(1);
        expect(result.snapshot.materials).toHaveLength(2);
    });

    it('collects mesh definitions from the prefab', () => {
        const mesh = createMinimalMesh('mesh/test');
        const meshes = new Map([['mesh/test', mesh]]);

        const document = createMinimalDocument({ meshKeys: ['mesh/test'] });
        const prefab = createMinimalPrefab({ meshKeys: ['mesh/test'] });
        const database = createMockDatabase(document, prefab, new Map(), meshes);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = createGltfSceneSnapshot(database, selector as any);

        expect(result.snapshot.meshes).toHaveLength(1);
        expect(result.snapshot.meshes[0]!.id).toBe('mesh/test');
    });

    it('invokes custom resolveShaderDefinition per material', () => {
        const material = createMinimalMaterial('mat/custom', {
            definition: {
                id: 'mat/custom',
                shaderId: 'custom/my-shader',
                uniforms: {},
            },
        });
        const materials = new Map([['mat/custom', material]]);

        const document = createMinimalDocument({ materialKeys: ['mat/custom'] });
        const prefab = createMinimalPrefab({ materialKeys: ['mat/custom'] });
        const database = createMockDatabase(document, prefab, materials);
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const resolveSpy = vi.fn(() => undefined);

        expect(() =>
            createGltfSceneSnapshot(database, selector as any, {
                resolveShaderDefinition: resolveSpy,
            })
        ).toThrow();

        expect(resolveSpy).toHaveBeenCalledWith('custom/my-shader');
    });
});

function docRecord(document: GltfDocumentAsset): AnyRecord {
    return createMockRecord('doc/test', 'gltf.document', document);
}
