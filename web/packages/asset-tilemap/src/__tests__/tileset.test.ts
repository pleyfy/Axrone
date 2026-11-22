import { describe, expect, it } from 'vitest';
import {
    createTilesetDefinition,
    serializeTilesetDefinition,
    TILESET_FORMAT_VERSION,
    tilesetJsonCodec,
    type TilesetDefinition,
} from '../tileset';

const valid = (): TilesetDefinition => {
    const result = createTilesetDefinition({
        formatVersion: TILESET_FORMAT_VERSION,
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
            {
                id: 5,
                name: 'wall',
                collision: 1,
                material: 2,
                animation: [{ tileId: 5, durationMs: 100 }],
            },
        ],
    });
    expect(result.isOk()).toBe(true);
    return result.get();
};

describe('createTilesetDefinition', () => {
    it('validates and freezes a tileset', () => {
        const tileset = valid();
        expect(tileset.tileCount).toBe(32);
        expect(tileset.tiles.map((tile) => tile.id)).toEqual([0, 5]);
        expect(Object.isFrozen(tileset)).toBe(true);
        expect(Object.isFrozen(tileset.tiles)).toBe(true);
    });

    it('rejects wrong versions and shapes', () => {
        const wrongVersion = createTilesetDefinition({
            formatVersion: 2,
        });
        expect(wrongVersion.isErr()).toBe(true);
        if (wrongVersion.isErr()) {
            expect(wrongVersion.expectErr('version').code).toBe(
                'UNSUPPORTED_VERSION'
            );
        }
        expect(createTilesetDefinition(null).isErr()).toBe(true);
        expect(createTilesetDefinition({}).isErr()).toBe(true);
    });

    it('rejects tileCount that does not match columns * rows', () => {
        const result = createTilesetDefinition({
            ...valid(),
            tileCount: 31,
        });
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
            const error = result.expectErr('tile count');
            expect(error.code).toBe('INVALID_TILESET');
            expect(error.details).toMatchObject({ expected: 32 });
        }
    });

    it('rejects columns that do not fit the image', () => {
        expect(
            createTilesetDefinition({
                ...valid(),
                columns: 9,
                tileCount: 36,
            }).isErr()
        ).toBe(true);
    });

    it('rejects invalid and out-of-range tiles', () => {
        expect(
            createTilesetDefinition({
                ...valid(),
                tiles: [
                    { id: 1, name: 'a' },
                    { id: 1, name: 'b' },
                ],
            }).isErr()
        ).toBe(true);
        expect(
            createTilesetDefinition({
                ...valid(),
                tiles: [{ id: 32, name: 'outside' }],
            }).isErr()
        ).toBe(true);
        expect(
            createTilesetDefinition({
                ...valid(),
                tiles: [
                    {
                        id: 1,
                        name: 'bad animation',
                        animation: [{ tileId: 32, durationMs: 10 }],
                    },
                ],
            }).isErr()
        ).toBe(true);
    });
});

describe('tileset JSON codec', () => {
    it('round-trips through the asset JSON codec', () => {
        const tileset = valid();
        const json = tilesetJsonCodec.serialize(tileset);
        expect(serializeTilesetDefinition(tileset)).toEqual(json);
        const decoded = tilesetJsonCodec.deserialize(json);
        expect(decoded).toEqual(tileset);
    });

    it('throws on invalid JSON data', () => {
        expect(() =>
            tilesetJsonCodec.deserialize({ formatVersion: 1 })
        ).toThrow();
    });
});
