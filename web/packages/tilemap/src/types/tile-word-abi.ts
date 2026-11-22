/**
 * Packed tile word ABI v1.
 *
 * `packedTileWord = tileId:16 | transform:3 | collision:8 | material:4 | reserved:1`
 *
 * Bit 31 is reserved and must stay zero. Changing any width, shift, or meaning
 * bumps `TILEMAP_FORMAT_VERSION` and the chunk snapshot `formatVersion`.
 */
export const TILE_WORD_BITS = 32;

export const TILE_ID_BITS = 16;
export const TILE_ID_SHIFT = 0;
export const TILE_ID_MASK = 0x0000ffff;
export const TILE_ID_MAX = TILE_ID_MASK;

export const TILE_TRANSFORM_BITS = 3;
export const TILE_TRANSFORM_SHIFT = 16;
export const TILE_TRANSFORM_MASK = 0x00070000;
export const TILE_TRANSFORM_MAX = 0x7;

export const TILE_COLLISION_BITS = 8;
export const TILE_COLLISION_SHIFT = 19;
export const TILE_COLLISION_MASK = 0x07f80000;
export const TILE_COLLISION_MAX = 0xff;

export const TILE_MATERIAL_BITS = 4;
export const TILE_MATERIAL_SHIFT = 27;
export const TILE_MATERIAL_MASK = 0x78000000;
export const TILE_MATERIAL_MAX = 0xf;

export const TILE_WORD_RESERVED_BIT = 31;
export const TILE_WORD_RESERVED_MASK = 0x80000000;
export const TILE_WORD_MAX = 0x7fffffff;

/** Empty tile word: no tile id, no transform, no collision, no material. */
export const TILE_WORD_EMPTY = 0;

/** Transform flags. The eight combinations form the dihedral D4 group. */
export const TileTransform = Object.freeze({
    None: 0,
    FlipX: 1,
    FlipY: 2,
    Rotate90: 4,
});

export type TileTransformFlags = number;

export const TILE_TRANSFORM_ALL_FLAGS =
    TileTransform.FlipX | TileTransform.FlipY | TileTransform.Rotate90;

export const isTileId = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TILE_ID_MAX;

export const isTileTransform = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TILE_TRANSFORM_MAX;

export const isCollisionMask = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TILE_COLLISION_MAX;

export const isMaterialId = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TILE_MATERIAL_MAX;

export const isPackedTileWordValue = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= TILE_WORD_MAX;
