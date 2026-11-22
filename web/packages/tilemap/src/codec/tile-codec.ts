import {
    asCollisionMask,
    asMaterialId,
    asTileId,
    asTransformFlags,
    type PackedTileWord,
    type TileId,
} from '../types/brands';
import {
    TilemapErrorCode,
    TilemapFault,
} from '../errors';
import {
    isPackedTileWordValue,
    TILE_COLLISION_MASK,
    TILE_COLLISION_SHIFT,
    TILE_ID_MASK,
    TILE_MATERIAL_MASK,
    TILE_MATERIAL_SHIFT,
    TILE_TRANSFORM_MASK,
    TILE_TRANSFORM_SHIFT,
    TILE_WORD_EMPTY,
    TILE_WORD_RESERVED_MASK,
} from '../types/tile-word-abi';

/**
 * Tile word codec.
 *
 * `pack` validates every field and throws `TilemapFault` on invalid values; it
 * never truncates silently. `unpack*`/`with*` are pure bit math: the brand
 * cast happens only at the API boundary.
 */
export const TileCodec = Object.freeze({
    pack(
        tileId: number,
        transform = 0,
        collision = 0,
        material = 0
    ): PackedTileWord {
        if (!Number.isInteger(tileId) || tileId < 0 || tileId > TILE_ID_MASK) {
            throw new TilemapFault(
                `tileId must be an integer in [0, ${TILE_ID_MASK}], got ${tileId}`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { tileId }
            );
        }
        const transformFlags = asTransformFlags(transform);
        const collisionMask = asCollisionMask(collision);
        const materialId = asMaterialId(material);
        const word =
            ((tileId & TILE_ID_MASK) |
                ((transformFlags << TILE_TRANSFORM_SHIFT) &
                    TILE_TRANSFORM_MASK) |
                ((collisionMask << TILE_COLLISION_SHIFT) &
                    TILE_COLLISION_MASK) |
                ((materialId << TILE_MATERIAL_SHIFT) &
                    TILE_MATERIAL_MASK)) >>>
            0;
        if ((word & TILE_WORD_RESERVED_MASK) !== 0) {
            throw new TilemapFault(
                'packed tile word would set the reserved bit 31',
                TilemapErrorCode.INVALID_CONFIGURATION,
                { word }
            );
        }
        return word as PackedTileWord;
    },

    unpackTileId(word: PackedTileWord): TileId {
        return ((word as number) & TILE_ID_MASK) as TileId;
    },

    unpackTransform(word: PackedTileWord): number {
        return ((word as number) & TILE_TRANSFORM_MASK) >>> TILE_TRANSFORM_SHIFT;
    },

    unpackCollision(word: PackedTileWord): number {
        return ((word as number) & TILE_COLLISION_MASK) >>> TILE_COLLISION_SHIFT;
    },

    unpackMaterial(word: PackedTileWord): number {
        return ((word as number) & TILE_MATERIAL_MASK) >>> TILE_MATERIAL_SHIFT;
    },

    withTileId(word: PackedTileWord, tileId: number): PackedTileWord {
        asTileId(tileId);
        return ((((word as number) & ~TILE_ID_MASK) | (tileId & TILE_ID_MASK)) >>>
            0) as PackedTileWord;
    },

    withTransform(word: PackedTileWord, transform: number): PackedTileWord {
        const flags = asTransformFlags(transform);
        return (
            (((word as number) & ~TILE_TRANSFORM_MASK) |
                ((flags << TILE_TRANSFORM_SHIFT) & TILE_TRANSFORM_MASK)) >>>
            0
        ) as PackedTileWord;
    },

    withCollision(word: PackedTileWord, collision: number): PackedTileWord {
        const mask = asCollisionMask(collision);
        return (
            (((word as number) & ~TILE_COLLISION_MASK) |
                ((mask << TILE_COLLISION_SHIFT) & TILE_COLLISION_MASK)) >>>
            0
        ) as PackedTileWord;
    },

    withMaterial(word: PackedTileWord, material: number): PackedTileWord {
        const materialId = asMaterialId(material);
        return (
            (((word as number) & ~TILE_MATERIAL_MASK) |
                ((materialId << TILE_MATERIAL_SHIFT) & TILE_MATERIAL_MASK)) >>>
            0
        ) as PackedTileWord;
    },

    isPackedTileWord(word: unknown): word is PackedTileWord {
        return isPackedTileWordValue(word);
    },

    isEmpty(word: PackedTileWord): boolean {
        return (word as number) === TILE_WORD_EMPTY;
    },

    equals(a: PackedTileWord, b: PackedTileWord): boolean {
        return (a as number) === (b as number);
    },
});

export const packTileWord = TileCodec.pack;
export const unpackTileId = TileCodec.unpackTileId;
export const unpackTileTransform = TileCodec.unpackTransform;
export const unpackTileCollision = TileCodec.unpackCollision;
export const unpackTileMaterial = TileCodec.unpackMaterial;
