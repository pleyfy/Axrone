import { describe, expect, it, vi } from 'vitest';
import type { AssetDatabase, AssetSelector } from '@axrone/asset-core';
import type { GltfAssetSchemaLike } from '@axrone/asset-gltf';
import type { Scene, SceneSnapshot } from '@axrone/scene-3d';
import { loadGltfSceneIntoScene } from '../scene-runtime-adapter';

vi.mock('../scene-snapshot-adapter', () => ({
    createGltfSceneSnapshot: vi.fn(),
}));

import { createGltfSceneSnapshot } from '../scene-snapshot-adapter';

const mockedCreateSnapshot = vi.mocked(createGltfSceneSnapshot);

const createMockSnapshot = (): SceneSnapshot => ({
    version: 1,
    prefab: { id: 'prefab/test', entities: [] },
    shaders: [],
    meshes: [],
    materials: [],
    textures: [],
    samplers: [],
    renderPasses: [],
});

const createMockScene = (): Scene<any> =>
    ({
        loadScene: vi.fn().mockResolvedValue([{ id: 'entity-1' }, { id: 'entity-2' }]),
    }) as unknown as Scene<any>;

const createMockDatabase = (): AssetDatabase<GltfAssetSchemaLike> =>
    ({}) as unknown as AssetDatabase<GltfAssetSchemaLike>;

describe('scene-runtime-adapter', () => {
    it('delegates to createGltfSceneSnapshot and scene.loadScene', async () => {
        const snapshot = createMockSnapshot();
        const snapshotResult = {
            document: { key: 'doc/test' },
            scene: { sceneIndex: 0, name: 'Main', prefabKey: 'prefab/test', rootNodeIds: [] },
            prefab: { key: 'prefab/test' },
            snapshot,
            diagnostics: Object.freeze([]),
        };
        mockedCreateSnapshot.mockReturnValue(snapshotResult as any);

        const scene = createMockScene();
        const database = createMockDatabase();
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        const result = await loadGltfSceneIntoScene(scene, database, selector as any);

        expect(mockedCreateSnapshot).toHaveBeenCalledWith(database, selector, {});
        expect(scene.loadScene).toHaveBeenCalledWith(snapshot, {
            clearExisting: undefined,
            componentArgsResolver: undefined,
            namePrefix: undefined,
        });
        expect(result.entities).toEqual([{ id: 'entity-1' }, { id: 'entity-2' }]);
        expect(result.snapshot).toBe(snapshot);
        expect(result.document).toBe(snapshotResult.document);
        expect(result.scene).toBe(snapshotResult.scene);
        expect(result.prefab).toBe(snapshotResult.prefab);
        expect(result.diagnostics).toBe(snapshotResult.diagnostics);
    });

    it('forwards clearExisting, componentArgsResolver, and namePrefix options', async () => {
        const snapshot = createMockSnapshot();
        mockedCreateSnapshot.mockReturnValue({
            document: {},
            scene: {},
            prefab: {},
            snapshot,
            diagnostics: Object.freeze([]),
        } as any);

        const scene = createMockScene();
        const database = createMockDatabase();
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };
        const resolver = vi.fn();

        await loadGltfSceneIntoScene(scene, database, selector as any, {
            clearExisting: true,
            componentArgsResolver: resolver,
            namePrefix: 'Test ',
            sceneIndex: 2,
        });

        expect(mockedCreateSnapshot).toHaveBeenCalledWith(database, selector, {
            clearExisting: true,
            componentArgsResolver: resolver,
            namePrefix: 'Test ',
            sceneIndex: 2,
        });
        expect(scene.loadScene).toHaveBeenCalledWith(snapshot, {
            clearExisting: true,
            componentArgsResolver: resolver,
            namePrefix: 'Test ',
        });
    });

    it('returns the combined snapshot result with entities', async () => {
        const snapshot = createMockSnapshot();
        const diagnostics = Object.freeze([{ level: 'warning' as const, code: 'test', message: 'test' }]);
        mockedCreateSnapshot.mockReturnValue({
            document: { key: 'doc/1' },
            scene: { sceneIndex: 0 },
            prefab: { key: 'prefab/1' },
            snapshot,
            diagnostics,
        } as any);

        const scene = createMockScene();
        const database = createMockDatabase();
        const selector = { kind: 'gltf.document' as const, key: 'doc/1' };

        const result = await loadGltfSceneIntoScene(scene, database, selector as any);

        expect(result).toHaveProperty('entities');
        expect(result).toHaveProperty('snapshot');
        expect(result).toHaveProperty('document');
        expect(result).toHaveProperty('scene');
        expect(result).toHaveProperty('prefab');
        expect(result).toHaveProperty('diagnostics');
        expect(result.diagnostics).toBe(diagnostics);
    });

    it('uses default empty options when none are provided', async () => {
        const snapshot = createMockSnapshot();
        mockedCreateSnapshot.mockReturnValue({
            document: {},
            scene: {},
            prefab: {},
            snapshot,
            diagnostics: Object.freeze([]),
        } as any);

        const scene = createMockScene();
        const database = createMockDatabase();
        const selector = { kind: 'gltf.document' as const, key: 'doc/test' };

        await loadGltfSceneIntoScene(scene, database, selector as any);

        expect(mockedCreateSnapshot).toHaveBeenCalledWith(database, selector, {});
    });
});
