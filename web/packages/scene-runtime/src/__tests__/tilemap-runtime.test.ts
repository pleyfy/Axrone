import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '@axrone/asset-core';
import {
    AssetChunkPager,
    createAssetTilemapCodecs,
    createTilesetDefinition,
    createTilemapAssetDefinition,
    tilemapChunkAssetKey,
    type AssetTilemapSchema,
} from '@axrone/asset-tilemap';
import {
    TileTransform,
    asChunkKey,
    chunkAreaForShift,
    packChunkKey,
    packTileWord,
} from '@axrone/tilemap';
import type { ChunkSnapshot } from '@axrone/tilemap';
import {
    TilemapRuntime,
    TilemapRuntimeSet,
} from '../scene-tilemap-runtime';
import { TilemapAgent } from '../components/tilemap-agent';

const createDatabase = (): AssetDatabase<AssetTilemapSchema> =>
    new AssetDatabase<AssetTilemapSchema>({
        codecs: createAssetTilemapCodecs(),
        binary: { mode: 'inline' },
    });

const tileset = () => {
    const result = createTilesetDefinition({
        formatVersion: 1,
        name: 'atlas',
        image: 'tex:atlas',
        tileWidth: 16,
        tileHeight: 16,
        margin: 0,
        spacing: 0,
        columns: 8,
        tileCount: 32,
        imageWidth: 128,
        imageHeight: 64,
        tiles: [
            { id: 0, name: 'empty' },
            { id: 5, name: 'grass' },
            { id: 6, name: 'stone' },
        ],
    });
    if (result.isErr()) throw result.expectErr('tileset');
    return result.get();
};

const definition = () => {
    const result = createTilemapAssetDefinition({
        formatVersion: 1,
        projection: { kind: 'orthogonal', tileWidth: 16, tileHeight: 16 },
        chunkShift: 3,
        tilesets: ['atlas'],
        layers: [
            { name: 'ground', zIndex: 0 },
            { name: 'overlay', zIndex: 1 },
        ],
        chunks: [
            { chunkX: 0, chunkY: 0, asset: tilemapChunkAssetKey('level', 0, 0) },
            { chunkX: 1, chunkY: 0, asset: tilemapChunkAssetKey('level', 1, 0) },
        ],
    });
    if (result.isErr()) throw result.expectErr('definition');
    return result.get();
};

const snapshotFor = (chunkX: number, word: number): ChunkSnapshot => {
    const words = new Uint32Array(chunkAreaForShift(3) * 2);
    words[0] = word;
    return {
        key: asChunkKey(packChunkKey(chunkX, 0)),
        chunkShift: 3,
        layerCount: 2,
        words,
    };
};

const seed = async (database: AssetDatabase<AssetTilemapSchema>): Promise<void> => {
    database.upsertMany([
        { kind: 'tileset', data: tileset(), stableKey: 'tileset:atlas' },
        { kind: 'tilemap', data: definition(), stableKey: 'level' },
    ]);
    const pager = new AssetChunkPager(database, {
        mapKey: 'level',
        chunkShift: 3,
        layerCount: 2,
    });
    await pager.save(snapshotFor(0, packTileWord(5) as unknown as number));
    await pager.save(snapshotFor(1, packTileWord(6) as unknown as number));
};

const openRuntime = async (): Promise<TilemapRuntime> => {
    const database = createDatabase();
    await seed(database);
    const opened = await TilemapRuntime.open(database, { mapId: 'level' });
    expect(opened.isOk()).toBe(true);
    return opened.get();
};

describe('TilemapRuntime', () => {
    it('opens the definition, tileset and chunk pager', async () => {
        const runtime = await openRuntime();
        expect(runtime.definition.layers.map((layer) => layer.name)).toEqual([
            'ground',
            'overlay',
        ]);
        expect(runtime.tilesets[0]!.name).toBe('atlas');
        expect(runtime.engine.chunkShift).toBe(3);
        await runtime.dispose();
    });

    it('prefetches, writes, serializes dirty chunks and applies snapshots', async () => {
        const runtime = await openRuntime();
        const loaded = await runtime.prefetchAround({
            x: 0,
            y: 0,
            width: 32,
            height: 32,
        });
        expect(loaded).toBe(2);
        expect(runtime.engine.readAt('ground', 0, 0)).toBe(5);
        const revision = runtime.revision;
        runtime.write('ground', 1, 0, packTileWord(6));
        expect(runtime.revision).toBeGreaterThan(revision);
        const snapshot = runtime.serializeSnapshot();
        expect(snapshot.isOk()).toBe(true);
        expect(snapshot.get().dirtyChunks).toHaveLength(1);
        expect(typeof snapshot.get().dirtyChunks[0]!.data).toBe('string');

        const restored = await openRuntime();
        const applied = await restored.applySnapshot(snapshot.get());
        expect(applied.isOk()).toBe(true);
        expect(restored.engine.readAt('ground', 1, 0)).toBe(6);
        await runtime.dispose();
        await restored.dispose();
    });

    it('trims chunks outside the camera window', async () => {
        const runtime = await openRuntime();
        await runtime.prefetchAround({ x: 0, y: 0, width: 32, height: 32 });
        const evicted = await runtime.trimOutside({
            x: 4096,
            y: 4096,
            width: 32,
            height: 32,
        });
        expect(evicted).toBe(2);
        expect(runtime.engine.isChunkResidentAt(0, 0)).toBe(false);
        await runtime.dispose();
    });

    it('applies layer overrides and bumps the revision', async () => {
        const runtime = await openRuntime();
        const revision = runtime.revision;
        runtime.setLayerOverride('ground', { visible: false, opacity: 0.5 });
        expect(runtime.revision).toBe(revision + 1);
        expect(runtime.layerOverrides).toContainEqual({
            name: 'ground',
            visible: false,
            opacity: 0.5,
        });
        await runtime.dispose();
    });

    it('owns runtimes through the set', async () => {
        const database = createDatabase();
        await seed(database);
        const set = new TilemapRuntimeSet(database);
        const loaded = await set.load({ mapId: 'level' });
        expect(loaded.isOk()).toBe(true);
        expect(set.get('level')).toBe(loaded.get());
        await set.preUpdate({ x: 0, y: 0, width: 32, height: 32 });
        expect(set.require('level').engine.isChunkResidentAt(0, 0)).toBe(true);
        await set.postUpdate({ x: 4096, y: 4096, width: 32, height: 32 });
        expect(set.require('level').engine.isChunkResidentAt(0, 0)).toBe(false);
        expect(set.serializeSnapshots().isOk()).toBe(true);
        await set.dispose();
    });
});

describe('tilemap agent system', () => {
    it('moves transforms along waypoints and completes the path', async () => {
        const { createTilemapAgentSystem } = await import('../scene-tilemap-runtime');
        const runtime = await openRuntime();
        const database = createDatabase();
        await seed(database);
        const set = new TilemapRuntimeSet(database);
        await set.load({ mapId: 'level' });

        const agent = new TilemapAgent({ speed: 2 });
        agent.setPath([10, 0]);
        const transform = {
            x: 0,
            y: 0,
            z: 0,
            get worldPosition() {
                return { x: this.x, y: this.y, z: this.z };
            },
            set position(value: { x: number; y: number; z: number }) {
                this.x = value.x;
                this.y = value.y;
                this.z = value.z;
            },
        };
        const system = createTilemapAgentSystem(set) as unknown as {
            execute(
                entities: readonly {
                    components: { TilemapAgent: TilemapAgent; Transform: unknown };
                }[],
                deltaTime: number
            ): void;
        };
        const entities = [
            { components: { TilemapAgent: agent, Transform: transform } },
        ];
        system.execute(entities, 1);
        expect(transform.x).toBe(2);
        expect(agent.moving).toBe(true);
        for (let step = 0; step < 10; step++) system.execute(entities, 1);
        expect(transform.x).toBe(10);
        expect(agent.moving).toBe(false);
        runtime.dispose();
        await set.dispose();
    });
});
