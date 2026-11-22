import { TileCodec } from '../codec/tile-codec';
import { TilemapErrorCode, TilemapFault } from '../errors';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import { clampGridRect, type GridRect } from './viewport';

/**
 * The 47 canonical 8-neighbour masks of blob autotiling.
 *
 * Bit order: `N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128`. Corner bits
 * are only meaningful when both adjacent edges are present, so every raw mask
 * canonicalizes to one of these 47 values.
 */
export const BLOB47_CANONICAL_MASKS: readonly number[] = Object.freeze([
    0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80,
    81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193,
    197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255,
]);

const BLOB47_INDEX = (() => {
    const table = new Int8Array(256).fill(-1);
    for (let index = 0; index < BLOB47_CANONICAL_MASKS.length; index++) {
        table[BLOB47_CANONICAL_MASKS[index]!] = index;
    }
    return table;
})();

/** Drops corner bits whose two adjacent edge neighbours are not both set. */
export const canonicalizeBlobMask = (mask: number): number => {
    let canonical = mask & 0xff;
    if ((canonical & 0x01) === 0 || (canonical & 0x04) === 0) {
        canonical &= ~0x02;
    }
    if ((canonical & 0x10) === 0 || (canonical & 0x04) === 0) {
        canonical &= ~0x08;
    }
    if ((canonical & 0x10) === 0 || (canonical & 0x40) === 0) {
        canonical &= ~0x20;
    }
    if ((canonical & 0x01) === 0 || (canonical & 0x40) === 0) {
        canonical &= ~0x80;
    }
    return canonical;
};

/** Maps a raw 8-neighbour mask to its canonical blob index in `[0, 46]`. */
export const computeBlob47Index = (mask: number): number =>
    BLOB47_INDEX[canonicalizeBlobMask(mask)]!;

export interface AutotileGroup {
    readonly name: string;
    /** Only tiles with this id are rewritten; omit to accept any non-empty tile. */
    readonly tileId?: number;
    /**
     * Transform flag value for each canonical blob index (47 entries). Values
     * are applied with `TileCodec.withTransform`, so they must be in `[0, 7]`.
     */
    readonly transforms: readonly number[];
    /** Membership test for neighbours; defaults to the group tile id. */
    readonly matches?: (word: PackedTileWord) => boolean;
}

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
];

/**
 * Rewrites the transform flags of every group tile in `rect` from its 8
 * neighbours, in one pass and without intermediate arrays.
 *
 * Neighbours count as members when `group.matches` accepts them; by default a
 * tile belongs when its id equals `group.tileId` (or when it is non-empty if
 * `tileId` is omitted). Tiles outside the group are left untouched. Returns
 * the number of tiles whose word changed.
 */
export const applyAutotileRect = <L extends readonly LayerSpec[]>(
    engine: TilemapEngine<L>,
    layer: LayerReference<L>,
    rect: GridRect,
    group: AutotileGroup
): number => {
    if (group.transforms.length !== BLOB47_CANONICAL_MASKS.length) {
        throw new TilemapFault(
            `autotile group ${group.name} needs ${BLOB47_CANONICAL_MASKS.length} transforms`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            {
                group: group.name,
                transforms: group.transforms.length,
            }
        );
    }
    const matches =
        group.matches ??
        ((word: PackedTileWord): boolean =>
            group.tileId === undefined
                ? (word as unknown as number) !== 0
                : TileCodec.unpackTileId(word) === group.tileId);
    const bounds = clampGridRect(rect);
    let changed = 0;
    for (let gridY = bounds.y; gridY < bounds.y + bounds.height; gridY++) {
        for (let gridX = bounds.x; gridX < bounds.x + bounds.width; gridX++) {
            const word = engine.readAt(layer, gridX, gridY);
            if (!matches(word)) continue;
            let mask = 0;
            for (let bit = 0; bit < NEIGHBOUR_OFFSETS.length; bit++) {
                const [offsetX, offsetY] = NEIGHBOUR_OFFSETS[bit]!;
                if (
                    matches(
                        engine.readAt(
                            layer,
                            gridX + offsetX,
                            gridY + offsetY
                        )
                    )
                ) {
                    mask |= 1 << bit;
                }
            }
            const transform = group.transforms[computeBlob47Index(mask)]!;
            const next = TileCodec.withTransform(word, transform);
            if ((next as unknown as number) === (word as unknown as number)) {
                continue;
            }
            const written = engine.write(layer, gridX, gridY, next);
            if (written.isErr()) continue;
            changed++;
        }
    }
    return changed;
};
