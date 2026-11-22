import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    AssetDatabase,
    type AssetChangeEvent,
} from '@axrone/asset-core';
import {
    asChunkKey,
    packChunkKey,
    packTileWord,
    unpackChunkX,
    unpackChunkY,
} from '@axrone/tilemap';
import type { ChunkSnapshot } from '@axrone/tilemap';
import {
    AssetChunkPager,
    chunkAssetCodec,
    createAssetTilemapCodecs,
    createAssetTilemapImportPipeline,
    type AssetTilemapSchema,
} from '../index';

const fixturesRoot = (): string => 
    process.cwd().endsWith(path.join('packages', 'asset-tilemap'))
        ? path.resolve(process.cwd(), 'src/__tests__/fixtures')
        : path.resolve(process.cwd(), 'packages/asset-tilemap/src/__tests__/fixtures');

const fixture = (name: string): string =>
    readFileSync(path.resolve(fixturesRoot(), name), 'utf8');

const createDatabase = (): AssetDatabase<AssetTilemapSchema> =>
    new AssetDatabase<AssetTilemapSchema>({
        codecs: createAssetTilemapCodecs(),
        pipeline: createAssetTilemapImportPipeline({
            tiled: {
                resolveTsx: (source) =>
                    source === 'atlas.tsx' ? fixture('atlas.tsx') : undefined,
            },
        }),
        binary: { mode: 'inline' },
    });

const snapshotFor = (
    chunkX: number,
    chunkY: number,
    word: number
): ChunkSnapshot => {
    const words = new Uint32Array(16 * 16);
    words[0] = word;
    return {
        key: asChunkKey(packChunkKey(chunkX, chunkY)),
        chunkShift: 4,
        layerCount: 1,
        words,
    };
};

const flattenEvents = (
    event: Readonly<AssetChangeEvent<AssetTilemapSchema>>
): readonly AssetChangeEvent<AssetTilemapSchema>[] =>
    event.type === 'batch' ? event.events : [event];

describe('AssetChunkPager', () => {
    it('imports a Tiled map through the asset pipeline and loads chunks', async () => {
        const database = createDatabase();
        const receipt = await database.import({
            kind: 'text',
            data: fixture('orthogonal-csv.tmx'),
            uri: 'demo.tmx',
            mimeType: 'application/x-tmx+xml',
        });
        expect(receipt.primary.kind).toBe('tilemap');
        expect(
            receipt.assets.filter((asset) => asset.kind === 'tilemap-chunk')
        ).toHaveLength(1);
        expect(
            receipt.assets.some((asset) => asset.kind === 'tileset')
        ).toBe(true);

        const pager = new AssetChunkPager(database, {
            mapKey: 'demo',
            chunkShift: 4,
            layerCount: 1,
        });
        const key = asChunkKey(packChunkKey(0, 0));
        const loaded = await pager.load(key);
        expect(loaded.isOk()).toBe(true);
        const snapshot = loaded.get();
        expect(snapshot).not.toBeNull();
        expect(unpackChunkX(key as unknown as number)).toBe(0);
        expect(unpackChunkY(key as unknown as number)).toBe(0);
        expect(Array.from(snapshot!.words.slice(0, 4))).toEqual([0, 1, 2, 3]);
        database.dispose();
    });

    it('saves chunks, bumps revisions and emits change events', async () => {
        const database = createDatabase();
        const pager = new AssetChunkPager(database, {
            mapKey: 'map',
            chunkShift: 4,
            layerCount: 1,
        });
        const events: AssetChangeEvent<AssetTilemapSchema>[] = [];
        const subscription = database.subscribe((event) => {
            events.push(...flattenEvents(event));
        });

        const first = snapshotFor(0, 0, packTileWord(5) as unknown as number);
        expect((await pager.save(first)).isOk()).toBe(true);
        const key = 'tilemap:map:chunk:0:0';
        expect(
            database.get({ kind: 'tilemap-chunk', key })?.revision
        ).toBe(1);

        first.words[0] = packTileWord(6) as unknown as number;
        expect((await pager.save(first)).isOk()).toBe(true);
        expect(
            database.get({ kind: 'tilemap-chunk', key })?.revision
        ).toBe(2);
        expect(
            events.some(
                (event) => event.type === 'upsert' && event.asset.key === key
            )
        ).toBe(true);

        subscription.dispose();
        database.dispose();
    });

    it('round-trips chunks through database snapshots and verifies CRC', async () => {
        const database = createDatabase();
        const pager = new AssetChunkPager(database, {
            mapKey: 'map',
            chunkShift: 4,
            layerCount: 1,
        });
        const first = snapshotFor(0, 0, packTileWord(7) as unknown as number);
        const second = snapshotFor(1, 0, packTileWord(8) as unknown as number);
        await pager.save(first);
        await pager.save(second);

        const serialized = database.snapshot();
        const restored = new AssetDatabase<AssetTilemapSchema>({
            codecs: createAssetTilemapCodecs(),
            binary: { mode: 'inline' },
        });
        restored.hydrate(serialized);
        const restoredPager = new AssetChunkPager(restored, {
            mapKey: 'map',
            chunkShift: 4,
            layerCount: 1,
        });
        const loaded = await restoredPager.load(first.key);
        expect(loaded.isOk()).toBe(true);
        expect(loaded.get()!.words[0]).toBe(
            packTileWord(7) as unknown as number
        );

        const bytes = chunkAssetCodec.serialize(first) as Uint8Array;
        const corrupted = bytes.slice();
        corrupted[corrupted.length - 1] ^= 0xff;
        expect(() => chunkAssetCodec.deserialize(corrupted)).toThrow();

        database.dispose();
        restored.dispose();
    });

    it('returns null for missing chunks and rejects geometry mismatches', async () => {
        const database = createDatabase();
        const pager = new AssetChunkPager(database, {
            mapKey: 'map',
            chunkShift: 4,
            layerCount: 1,
        });
        const missing = await pager.load(
            asChunkKey(packChunkKey(9, 9))
        );
        expect(missing.isOk()).toBe(true);
        expect(missing.get()).toBeNull();

        const wrongShift = {
            ...snapshotFor(0, 0, 1),
            chunkShift: 3 as const,
        };
        expect((await pager.save(wrongShift)).isErr()).toBe(true);
        database.dispose();
    });
});
