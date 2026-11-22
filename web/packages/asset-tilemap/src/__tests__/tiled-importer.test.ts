import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { unpackTileId, unpackTileTransform } from '@axrone/tilemap';
import { importTiledMap } from '../tiled/tiled-importer';

const fixturesRoot = (): string => 
    process.cwd().endsWith(path.join('packages', 'asset-tilemap'))
        ? path.resolve(process.cwd(), 'src/__tests__/fixtures')
        : path.resolve(process.cwd(), 'packages/asset-tilemap/src/__tests__/fixtures');

const fixture = (name: string): string =>
    readFileSync(path.resolve(fixturesRoot(), name), 'utf8');

const resolveAtlas = (source: string): string | undefined =>
    source === 'atlas.tsx' ? fixture('atlas.tsx') : undefined;

const errorCode = async (
    promise: ReturnType<typeof importTiledMap>
): Promise<string> => {
    const result = await promise;
    expect(result.isErr()).toBe(true);
    return result.expectErr('expected import error').code;
};

describe('importTiledMap', () => {
    it('imports an orthogonal CSV map with an external TSX', async () => {
        const result = await importTiledMap(fixture('orthogonal-csv.tmx'), {
            resolveTsx: resolveAtlas,
        });
        expect(result.isOk()).toBe(true);
        const imported = result.get();

        expect(imported.tilemap.tilesets).toEqual(['atlas']);
        expect(imported.tilemap.layers).toEqual([
            expect.objectContaining({
                name: 'ground',
                collision: true,
                visible: true,
            }),
        ]);
        expect(imported.tilemap.chunkShift).toBe(4);
        expect(imported.tilemap.chunks).toEqual([
            { chunkX: 0, chunkY: 0, asset: 'tilemap:demo:chunk:0:0' },
        ]);

        const tileset = imported.tilesets[0]!;
        const animated = tileset.tiles.find((tile) => tile.id === 5)!;
        expect(animated).toMatchObject({
            collision: 1,
            material: 2,
            autotileGroup: 'grass',
        });
        expect(animated.animation).toEqual([
            { tileId: 5, durationMs: 100 },
            { tileId: 6, durationMs: 150 },
        ]);

        const chunk = imported.chunks[0]!;
        expect(chunk.snapshot.layerCount).toBe(1);
        expect(chunk.snapshot.chunkShift).toBe(4);
        expect(chunk.snapshot.words).toHaveLength(16 * 16);
        expect(Array.from(chunk.snapshot.words.slice(0, 8))).toEqual([
            0, 1, 2, 3, 0, 1, 2, 3,
        ]);
        expect(chunk.snapshot.words[8]).toBe(0);

        expect(imported.collisionHints).toEqual([
            {
                layer: 'collision',
                name: 'wall',
                type: 'wall',
                gridX: 1,
                gridY: 1,
                width: 2,
                height: 1,
            },
        ]);
        expect(imported.diagnostics).toEqual([
            expect.objectContaining({
                level: 'warning',
                code: 'UNSUPPORTED_LAYER_TYPE',
            }),
        ]);
    });

    it('imports base64 + zlib tile data', async () => {
        const result = await importTiledMap(fixture('base64-zlib.tmx'), {
            resolveTsx: resolveAtlas,
        });
        expect(result.isOk()).toBe(true);
        const imported = result.get();
        const words = imported.chunks[0]!.snapshot.words;
        expect(Array.from(words.slice(0, 4))).toEqual([0, 1, 2, 3]);
        expect(imported.tilemap.chunks[0]!.asset).toBe(
            'tilemap:compressed:chunk:0:0'
        );
    });

    it('supports an async TSX resolver', async () => {
        const result = await importTiledMap(fixture('orthogonal-csv.tmx'), {
            resolveTsx: async (source) => resolveAtlas(source),
        });
        expect(result.isOk()).toBe(true);
    });

    it('converts Tiled flip bits into tile transforms', async () => {
        const result = await importTiledMap(fixture('flip-flags.tmx'));
        expect(result.isOk()).toBe(true);
        const words = result.get().chunks[0]!.snapshot.words;
        const corners = [words[0]!, words[1]!, words[16]!, words[17]!];
        expect(corners.map((word) => unpackTileId(word as never))).toEqual([
            0, 1, 2, 3,
        ]);
        expect(corners.map((word) => unpackTileTransform(word as never))).toEqual([
            1, 2, 4, 7,
        ]);
    });

    it('splits a map across chunk boundaries', async () => {
        const cells = Array.from({ length: 256 }, () => '0');
        cells[0] = '2';
        cells[255] = '2';
        const tmx = `<?xml version="1.0"?>
<map version="1.10" orientation="orthogonal" width="16" height="16" tilewidth="16" tileheight="16" name="cross">
 <tileset firstgid="1" name="tiny" tilewidth="16" tileheight="16" tilecount="2" columns="2">
  <image source="tiny.png" width="32" height="16"/>
 </tileset>
 <layer id="1" name="ground" width="16" height="16">
  <data encoding="csv">${cells.join(',')}</data>
 </layer>
</map>`;
        const result = await importTiledMap(tmx, { chunkShift: 3 });
        if (result.isErr()) {
            throw new Error(JSON.stringify(result.expectErr('cross')));
        }
        const chunks = result.get().chunks;
        expect(chunks.map((chunk) => [chunk.snapshot.key, chunk.assetKey])).toEqual([
            [0x00000000, 'tilemap:cross:chunk:0:0'],
            [0x00010001, 'tilemap:cross:chunk:1:1'],
        ]);
        expect(chunks[0]!.snapshot.words[0]).toBe(1);
        expect(chunks[1]!.snapshot.words[63]).toBe(1);
    });

    it('rejects unsupported compression, malformed XML and bad gids', async () => {
        expect(
            await errorCode(importTiledMap(fixture('unsupported-compression.tmx')))
        ).toBe('UNSUPPORTED_COMPRESSION');
        expect(await errorCode(importTiledMap(fixture('malformed.tmx')))).toBe(
            'MALFORMED_SOURCE'
        );
        expect(
            await errorCode(importTiledMap(fixture('tile-id-out-of-range.tmx')))
        ).toBe('TILED_ID_OUT_OF_RANGE');
    });

    it('reports a missing external tileset', async () => {
        expect(await errorCode(importTiledMap(fixture('missing-tsx.tmx')))).toBe(
            'MISSING_TILESET'
        );
    });
});
