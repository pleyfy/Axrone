import { describe, expect, it } from 'vitest';
import {
    createTilemapAssetDefinition,
    serializeTilemapAssetDefinition,
    TILEMAP_ASSET_FORMAT_VERSION,
    tilemapAssetJsonCodec,
    tilemapChunkAssetKey,
    type TilemapAssetDefinition,
} from '../tilemap-asset';

const valid = (): TilemapAssetDefinition => {
    const result = createTilemapAssetDefinition({
        formatVersion: TILEMAP_ASSET_FORMAT_VERSION,
        projection: {
            kind: 'orthogonal',
            tileWidth: 16,
            tileHeight: 16,
        },
        chunkShift: 4,
        tilesets: ['atlas'],
        layers: [{ name: 'ground' }, { name: 'walls', collision: true }],
        chunks: [
            { chunkX: 0, chunkY: 0, asset: 'tilemap:map:chunk:0:0' },
            { chunkX: -1, chunkY: 2, asset: 'tilemap:map:chunk:-1:2' },
        ],
    });
    expect(result.isOk()).toBe(true);
    return result.get();
};

describe('createTilemapAssetDefinition', () => {
    it('validates, sorts and freezes a tilemap definition', () => {
        const definition = valid();
        expect(definition.chunks.map((chunk) => chunk.chunkY)).toEqual([0, 2]);
        expect(Object.isFrozen(definition)).toBe(true);
        expect(Object.isFrozen(definition.chunks)).toBe(true);
        expect(Object.isFrozen(definition.projection)).toBe(true);
    });

    it('rejects wrong versions, projections and chunk shifts', () => {
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                formatVersion: 2,
            }).expectErr('version').code
        ).toBe('UNSUPPORTED_VERSION');
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                projection: { kind: 'hexagonal', tileWidth: 16, tileHeight: 16 },
            }).isErr()
        ).toBe(true);
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                chunkShift: 7,
            }).isErr()
        ).toBe(true);
    });

    it('rejects duplicate layers, tilesets and chunks', () => {
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                layers: [{ name: 'ground' }, { name: 'ground' }],
            }).isErr()
        ).toBe(true);
        expect(
            createTilemapAssetDefinition({ ...valid(), tilesets: [] }).isErr()
        ).toBe(true);
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                chunks: [
                    { chunkX: 0, chunkY: 0, asset: 'a' },
                    { chunkX: 0, chunkY: 0, asset: 'b' },
                ],
            }).isErr()
        ).toBe(true);
        expect(
            createTilemapAssetDefinition({
                ...valid(),
                chunks: [{ chunkX: 40000, chunkY: 0, asset: 'a' }],
            }).isErr()
        ).toBe(true);
    });
});

describe('tilemap asset JSON codec', () => {
    it('round-trips through the asset JSON codec', () => {
        const definition = valid();
        const json = tilemapAssetJsonCodec.serialize(definition);
        expect(serializeTilemapAssetDefinition(definition)).toEqual(json);
        expect(tilemapAssetJsonCodec.deserialize(json)).toEqual(definition);
    });

    it('builds stable chunk asset keys', () => {
        expect(tilemapChunkAssetKey('map', -2, 3)).toBe(
            'tilemap:map:chunk:-2:3'
        );
    });
});
