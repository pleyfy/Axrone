import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapFault } from '../errors';
import {
    TileTransform,
    TILE_COLLISION_MAX,
    TILE_MATERIAL_MAX,
    TILE_TRANSFORM_MAX,
    TILE_WORD_MAX,
} from '../types';

const lcg = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
    };
};

describe('TileCodec', () => {
    it('round-trips every field at its extremes', () => {
        const tileIds = [0, 1, 0x7fff, 0xffff];
        const transforms = [0, 1, TILE_TRANSFORM_MAX];
        const collisions = [0, 1, TILE_COLLISION_MAX];
        const materials = [0, 1, TILE_MATERIAL_MAX];

        for (const tileId of tileIds) {
            for (const transform of transforms) {
                for (const collision of collisions) {
                    for (const material of materials) {
                        const word = TileCodec.pack(
                            tileId,
                            transform,
                            collision,
                            material
                        );
                        expect(word >>> 0).toBe(word);
                        expect(word).toBeLessThanOrEqual(TILE_WORD_MAX);
                        expect(TileCodec.unpackTileId(word)).toBe(tileId);
                        expect(TileCodec.unpackTransform(word)).toBe(
                            transform
                        );
                        expect(TileCodec.unpackCollision(word)).toBe(
                            collision
                        );
                        expect(TileCodec.unpackMaterial(word)).toBe(material);
                    }
                }
            }
        }
    });

    it('packs the documented ABI layout', () => {
        const word = TileCodec.pack(0x1234, TileTransform.Rotate90, 0xab, 0xc);
        expect(word >>> 0).toBe(
            (0x1234 | (4 << 16) | (0xab << 19) | (0xc << 27)) >>> 0
        );
        expect((word & 0xffff) >>> 0).toBe(0x1234);
        expect((word >>> 16) & 0x7).toBe(4);
        expect((word >>> 19) & 0xff).toBe(0xab);
        expect((word >>> 27) & 0xf).toBe(0xc);
        expect(word >>> 31).toBe(0);
    });

    it('with* preserves every other field', () => {
        const base = TileCodec.pack(7, TileTransform.FlipY, 0x40, 3);
        const cases: readonly [number, typeof base][] = [
            [9, TileCodec.withTileId(base, 9)],
            [5, TileCodec.withTransform(base, 5)],
            [0x11, TileCodec.withCollision(base, 0x11)],
            [1, TileCodec.withMaterial(base, 1)],
        ];
        expect(TileCodec.unpackTileId(cases[0]![1])).toBe(9);
        expect(TileCodec.unpackTransform(cases[1]![1])).toBe(5);
        expect(TileCodec.unpackCollision(cases[2]![1])).toBe(0x11);
        expect(TileCodec.unpackMaterial(cases[3]![1])).toBe(1);

        expect(TileCodec.unpackTransform(cases[0]![1])).toBe(TileTransform.FlipY);
        expect(TileCodec.unpackCollision(cases[0]![1])).toBe(0x40);
        expect(TileCodec.unpackMaterial(cases[0]![1])).toBe(3);
        expect(TileCodec.unpackTileId(cases[1]![1])).toBe(7);
        expect(TileCodec.unpackMaterial(cases[2]![1])).toBe(3);
        expect(TileCodec.unpackCollision(cases[3]![1])).toBe(0x40);
    });

    it('rejects invalid fields instead of truncating', () => {
        expect(() => TileCodec.pack(-1)).toThrow(TilemapFault);
        expect(() => TileCodec.pack(0x10000)).toThrow(TilemapFault);
        expect(() => TileCodec.pack(1, 8)).toThrow(TilemapFault);
        expect(() => TileCodec.pack(1, 0, 0x100)).toThrow(TilemapFault);
        expect(() => TileCodec.pack(1, 0, 0, 0x10)).toThrow(TilemapFault);
        expect(() => TileCodec.pack(1.25)).toThrow(TilemapFault);
        expect(() => TileCodec.withCollision(0 as never, 0x100)).toThrow(
            TilemapFault
        );
    });

    it('rejects a word with the reserved bit', () => {
        expect(TileCodec.isPackedTileWord(0x80000000)).toBe(false);
        expect(TileCodec.isPackedTileWord(-1)).toBe(false);
        expect(TileCodec.isPackedTileWord(1.5)).toBe(false);
        expect(TileCodec.isPackedTileWord(TILE_WORD_MAX)).toBe(true);
    });

    it('round-trips 100k deterministic pseudo-random words', () => {
        const next = lcg(0xdecafbad);
        for (let index = 0; index < 100_000; index++) {
            const value = next();
            const tileId = value & 0xffff;
            const transform = (value >>> 16) & 0x7;
            const collision = (value >>> 19) & 0xff;
            const material = (value >>> 27) & 0xf;
            const word = TileCodec.pack(
                tileId,
                transform,
                collision,
                material
            );
            expect(TileCodec.unpackTileId(word)).toBe(tileId);
            expect(TileCodec.unpackTransform(word)).toBe(transform);
            expect(TileCodec.unpackCollision(word)).toBe(collision);
            expect(TileCodec.unpackMaterial(word)).toBe(material);
        }
    });

    it('treats the empty word as empty', () => {
        const empty = TileCodec.pack(0);
        expect(TileCodec.isEmpty(empty)).toBe(true);
        expect(TileCodec.isEmpty(TileCodec.pack(1))).toBe(false);
        expect(TileCodec.equals(TileCodec.pack(3), TileCodec.pack(3))).toBe(
            true
        );
    });

    it('keeps the programming-error type distinct from data errors', () => {
        try {
            TileCodec.pack(-1);
        } catch (error) {
            expect(error).toBeInstanceOf(TilemapFault);
        }
    });
});
