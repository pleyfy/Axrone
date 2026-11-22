import { describe, expect, it } from 'vitest';
import {
    TILEMAP_FORMAT_VERSION,
    TILEMAP_PACKAGE_NAME,
} from '../index';
import {
    TileCodec,
    packChunkKey,
    unpackChunkX,
    unpackChunkY,
} from '../codec';
import {
    asChunkKey,
    asPackedTileWord,
    asTileId,
    COORDINATE_LIMITS,
    TilemapErrorCode,
    TilemapFault,
    assertNever,
    createLayerSpecs,
    createProjectionSpec,
    isTilemapError,
    tilemapError,
    TileTransform,
    TILE_WORD_MAX,
    VALID_CHUNK_SHIFTS,
} from '../index';

const expectFault = (fn: () => unknown): void => {
    expect(fn).toThrow(TilemapFault);
};

describe('package surface', () => {
    it('reports format v1 and the package name', () => {
        expect(TILEMAP_FORMAT_VERSION).toBe(1);
        expect(TILEMAP_PACKAGE_NAME).toBe('@axrone/tilemap');
    });

    it('keeps the documented coordinate limits', () => {
        expect(COORDINATE_LIMITS.min).toBe(-32768);
        expect(COORDINATE_LIMITS.max).toBe(32767);
        expect(COORDINATE_LIMITS.tileIdMax).toBe(0xffff);
        expect(COORDINATE_LIMITS.materialMax).toBe(0xf);
        expect([...VALID_CHUNK_SHIFTS]).toEqual([3, 4, 5, 6]);
    });
});

describe('branded ids', () => {
    it('accepts in-range values', () => {
        expect(asTileId(0)).toBe(0);
        expect(asTileId(0xffff)).toBe(0xffff);
        expect(asPackedTileWord(TILE_WORD_MAX)).toBe(TILE_WORD_MAX);
        expect(asChunkKey(0xffffffff)).toBe(0xffffffff);
    });

    it('rejects out-of-range values instead of truncating', () => {
        expectFault(() => asTileId(0x10000));
        expectFault(() => asTileId(-1));
        expectFault(() => asTileId(1.5));
        expectFault(() => asPackedTileWord(0x80000000));
        expectFault(() => asChunkKey(-1));
    });

    it('packs signed chunk keys without losing sign', () => {
        for (const [x, y] of [
            [0, 0],
            [-1, -1],
            [-32768, 32767],
            [1234, -4321],
        ] as const) {
            const key = packChunkKey(x, y);
            expect(unpackChunkX(key)).toBe(x);
            expect(unpackChunkY(key)).toBe(y);
        }
    });
});

describe('layers', () => {
    it('rejects empty and duplicate layer sets', () => {
        expect(() => createLayerSpecs([])).toThrow(TilemapFault);
        expect(() =>
            createLayerSpecs([{ name: 'ground' }, { name: 'ground' }])
        ).toThrow(TilemapFault);
    });

    it('freezes layer specs', () => {
        const [layer] = createLayerSpecs([
            { name: 'ground', defaultWord: 0 },
        ]);
        expect(Object.isFrozen(layer)).toBe(true);
    });

    it('rejects an invalid default word', () => {
        expect(() =>
            createLayerSpecs([{ name: 'ground', defaultWord: 0x80000000 }])
        ).toThrow(TilemapFault);
    });
});

describe('projection specs', () => {
    it('freezes valid specs', () => {
        const projection = createProjectionSpec({
            kind: 'isometric',
            tileWidth: 64,
            tileHeight: 32,
            staggerAxis: 'y',
        });
        expect(Object.isFrozen(projection)).toBe(true);
        expect(projection.kind).toBe('isometric');
    });

    it('rejects unknown kinds and non-positive tile sizes', () => {
        expectFault(() =>
            createProjectionSpec({
                kind: 'hexagonal' as never,
                tileWidth: 32,
                tileHeight: 32,
            })
        );
        expectFault(() =>
            createProjectionSpec({
                kind: 'orthogonal',
                tileWidth: 0,
                tileHeight: 32,
            })
        );
    });
});

describe('transform flags', () => {
    it('encodes the eight D4 states', () => {
        const seen = new Set<number>();
        for (let flags = 0; flags < 8; flags++) {
            const word = TileCodec.pack(1, flags);
            seen.add(TileCodec.unpackTransform(word));
        }
        expect(seen.size).toBe(8);
        expect(TileTransform.FlipX | TileTransform.FlipY).toBe(3);
    });
});

describe('error domain', () => {
    it('produces frozen, serializable error records', () => {
        const error = tilemapError(
            TilemapErrorCode.CHUNK_DIRTY,
            'dirty chunk',
            { details: { key: 1 } }
        );
        expect(Object.isFrozen(error)).toBe(true);
        expect(isTilemapError(error)).toBe(true);
        expect(error.code).toBe('CHUNK_DIRTY');
        expect(JSON.parse(JSON.stringify(error)).code).toBe('CHUNK_DIRTY');
    });

    it('keeps every code reachable through a switch', () => {
        const describeCode = (code: TilemapErrorCode): string => {
            switch (code) {
                case TilemapErrorCode.INVALID_LAYER:
                case TilemapErrorCode.INVALID_COORDINATE:
                case TilemapErrorCode.INVALID_CONFIGURATION:
                case TilemapErrorCode.INVALID_SNAPSHOT:
                case TilemapErrorCode.CHUNK_POOL_EXHAUSTED:
                case TilemapErrorCode.CHUNK_PINNED:
                case TilemapErrorCode.CHUNK_DIRTY:
                case TilemapErrorCode.PAGER_NOT_CONFIGURED:
                case TilemapErrorCode.PAGER_IO_ERROR:
                case TilemapErrorCode.CODEC_CORRUPT_PAYLOAD:
                case TilemapErrorCode.CODEC_CHECKSUM_MISMATCH:
                case TilemapErrorCode.ENGINE_CLOSED:
                case TilemapErrorCode.OPERATION_ABORTED:
                case TilemapErrorCode.UNSUPPORTED_PROJECTION:
                case TilemapErrorCode.PATH_POOL_EXHAUSTED:
                case TilemapErrorCode.PATH_BUFFER_TOO_SMALL:
                case TilemapErrorCode.LEASE_EXPIRED:
                    return code;
                default:
                    return assertNever(code);
            }
        };
        expect(describeCode(TilemapErrorCode.ENGINE_CLOSED)).toBe(
            'ENGINE_CLOSED'
        );
    });
});
