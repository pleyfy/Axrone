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
    type ChunkSnapshot,
} from '@axrone/tilemap';
import { Color } from '@axrone/numeric';
import {
    TilemapRuntime,
} from '../scene-tilemap-runtime';
import { TilemapInstanceSource } from '../rendering/tilemap-instance-source';
import { resolveTilemapCameraRect } from '../rendering/tilemap-render-item-collector';
import { TilemapRenderRuntime } from '../rendering/tilemap-render-runtime';

const openRuntime = async (): Promise<TilemapRuntime> => {
    const database = new AssetDatabase<AssetTilemapSchema>({
        codecs: createAssetTilemapCodecs(),
        binary: { mode: 'inline' },
    });
    const tileset = createTilesetDefinition({
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
            { id: 5, name: 'grass' },
            { id: 6, name: 'stone' },
        ],
    }).get();
    const definition = createTilemapAssetDefinition({
        formatVersion: 1,
        projection: { kind: 'orthogonal', tileWidth: 16, tileHeight: 16 },
        chunkShift: 3,
        tilesets: ['atlas'],
        layers: [
            { name: 'ground', zIndex: 0, opacity: 0.5 },
            { name: 'overlay', zIndex: 1 },
        ],
        chunks: [{ chunkX: 0, chunkY: 0, asset: tilemapChunkAssetKey('level', 0, 0) }],
    }).get();
    database.upsertMany([
        { kind: 'tileset', data: tileset, stableKey: 'tileset:atlas' },
        { kind: 'tilemap', data: definition, stableKey: 'level' },
    ]);
    const words = new Uint32Array(chunkAreaForShift(3) * 2);
    const snapshot: ChunkSnapshot = {
        key: asChunkKey(packChunkKey(0, 0)),
        chunkShift: 3,
        layerCount: 2,
        words,
    };
    await new AssetChunkPager(database, {
        mapKey: 'level',
        chunkShift: 3,
        layerCount: 2,
    }).save(snapshot);
    const opened = await TilemapRuntime.open(database, { mapId: 'level' });
    expect(opened.isOk()).toBe(true);
    const runtime = opened.get();
    await runtime.prefetchAround({ x: 0, y: 0, width: 16, height: 16 });
    return runtime;
};

const camera = { x: 0, y: 0, width: 16, height: 16 };

describe('TilemapInstanceSource', () => {
    it('writes UVs, tile centers and layer order', async () => {
        const runtime = await openRuntime();
        runtime.write('ground', 0, 0, packTileWord(5));
        runtime.write('ground', 1, 0, packTileWord(6));
        runtime.write('overlay', 0, 0, packTileWord(5));
        const source = new TilemapInstanceSource({
            runtime,
            tileset: runtime.tilesets[0]!,
        });
        expect(source.sync(camera)).toBe(3);
        expect(source.drawCount).toBe(3);
        expect(source.transformData[4]).toBe(8);
        expect(source.transformData[5]).toBe(8);
        expect(source.staticData[4]).toBeCloseTo(0.625);
        expect(source.staticData[5]).toBeCloseTo(0);
        expect(source.staticData[6]).toBeCloseTo(0.125);
        expect(source.staticData[7]).toBeCloseTo(0.25);
        expect(source.staticData[11]).toBeCloseTo(0.5);
        expect(source.staticData[13 + 4]).toBeCloseTo(0.75);
        expect(source.staticData[26 + 4]).toBeCloseTo(0.625);
        expect(source.groupCount).toBe(1);
        expect(source.textureId).toBe('tex:atlas');
        await runtime.dispose();
    });

    it('bakes flips into UV signs and honours layer overrides', async () => {
        const runtime = await openRuntime();
        runtime.write('ground', 0, 0, packTileWord(5, TileTransform.FlipX));
        runtime.write('overlay', 0, 0, packTileWord(6));
        const source = new TilemapInstanceSource({
            runtime,
            tileset: runtime.tilesets[0]!,
            tint: new Color(1, 0, 0, 1),
        });
        source.sync(camera);
        expect(source.staticData[6]).toBeCloseTo(-0.125);
        expect(source.staticData[8]).toBe(1);
        expect(source.staticData[9]).toBe(0);
        runtime.setLayerOverride('overlay', { visible: false });
        expect(source.sync(camera)).toBe(1);
        expect(source.drawCount).toBe(1);
        await runtime.dispose();
    });

    it('caches until the runtime revision or camera changes', async () => {
        const runtime = await openRuntime();
        runtime.write('ground', 0, 0, packTileWord(5));
        const source = new TilemapInstanceSource({
            runtime,
            tileset: runtime.tilesets[0]!,
        });
        source.sync(camera);
        const transforms = source.transformData;
        expect(source.sync(camera)).toBe(1);
        expect(source.transformData).toBe(transforms);
        runtime.write('ground', 1, 0, packTileWord(6));
        expect(source.sync(camera)).toBe(2);
        await runtime.dispose();
    });

    it('reports a missing tileset instead of crashing', async () => {
        const runtime = await openRuntime();
        const render = new TilemapRenderRuntime({
            runtime,
            tilesetId: 'missing',
            gl: {} as never,
            resources: {} as never,
            renderStateApplier: {} as never,
        });
        expect(render.prepare(camera)).toBeNull();
        expect(render.diagnostic).toContain('missing');
        await runtime.dispose();
    });
});

describe('resolveTilemapCameraRect', () => {
    it('projects an orthographic camera onto a world rectangle', () => {
        const frame = {
            camera3D: { isOrthographic: () => true },
            camera: { orthographicSize: 5 },
            position: { x: 10, y: 20, z: 0 },
        };
        expect(resolveTilemapCameraRect(frame as never, 200, 100)).toEqual({
            x: 0,
            y: 15,
            width: 20,
            height: 10,
        });
    });

    it('returns null without a camera or for perspective', () => {
        expect(resolveTilemapCameraRect(null, 200, 100)).toBeNull();
        expect(
            resolveTilemapCameraRect(
                {
                    camera3D: { isOrthographic: () => false },
                    camera: { orthographicSize: 5 },
                    position: { x: 0, y: 0, z: 0 },
                } as never,
                200,
                100
            )
        ).toBeNull();
    });
});
