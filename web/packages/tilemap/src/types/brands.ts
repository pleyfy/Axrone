import type { Brand } from '@axrone/utility';
import { TilemapErrorCode, TilemapFault } from '../errors';
import {
    isCollisionMask,
    isMaterialId,
    isPackedTileWordValue,
    isTileId,
    isTileTransform,
    TILE_COLLISION_MAX,
    TILE_ID_MAX,
    TILE_MATERIAL_MAX,
    TILE_TRANSFORM_MAX,
} from './tile-word-abi';

/** 16-bit tile id inside a tileset page. */
export type TileId = Brand<number, 'TileId'>;
/** 32-bit packed tile word (see `tile-word-abi.ts`). */
export type PackedTileWord = Brand<number, 'PackedTileWord'>;
/** Index of a layer inside a map definition. */
export type LayerIndex = Brand<number, 'LayerIndex'>;
/** Packed signed 16-bit (chunkX, chunkY) pair stored as `uint32`. */
export type ChunkKey = Brand<number, 'ChunkKey'>;
/** Packed signed 16-bit (gridX, gridY) pair stored as `uint32`. */
export type GridKey = Brand<number, 'GridKey'>;

export type GridX = Brand<number, 'GridX'>;
export type GridY = Brand<number, 'GridY'>;
export type ChunkX = Brand<number, 'ChunkX'>;
export type ChunkY = Brand<number, 'ChunkY'>;
export type LocalX = Brand<number, 'LocalX'>;
export type LocalY = Brand<number, 'LocalY'>;
export type WorldX = Brand<number, 'WorldX'>;
export type WorldY = Brand<number, 'WorldY'>;

/** Monotonic chunk slot generation; changes every time a slot is reused. */
export type ChunkGeneration = Brand<number, 'ChunkGeneration'>;

/** Signed 16-bit key limit shared by grid and chunk coordinates. */
export const KEY_MIN = -0x8000;
export const KEY_MAX = 0x7fff;
export const KEY_BITS = 16;
export const KEY_MASK = 0xffff;

export const MAX_LAYER_COUNT = 64;
export const MAX_LAYER_INDEX = MAX_LAYER_COUNT - 1;

const fault = (message: string, details?: Record<string, unknown>): never => {
    throw new TilemapFault(
        message,
        TilemapErrorCode.INVALID_COORDINATE,
        details
    );
};

const assertInteger = (
    name: string,
    value: number,
    min: number,
    max: number
): void => {
    if (!Number.isInteger(value) || value < min || value > max) {
        fault(`${name} must be an integer in [${min}, ${max}]`, {
            name,
            value,
            min,
            max,
        });
    }
};

export const asTileId = (value: number): TileId => {
    if (!isTileId(value)) {
        throw new TilemapFault(
            `tile id must be an integer in [0, ${TILE_ID_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value as TileId;
};

export const asPackedTileWord = (value: number): PackedTileWord => {
    if (!isPackedTileWordValue(value)) {
        throw new TilemapFault(
            'packed tile word must be a 31-bit unsigned integer',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value as PackedTileWord;
};

export const asTransformFlags = (value: number): number => {
    if (!isTileTransform(value)) {
        throw new TilemapFault(
            `transform flags must be an integer in [0, ${TILE_TRANSFORM_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value;
};

export const asCollisionMask = (value: number): number => {
    if (!isCollisionMask(value)) {
        throw new TilemapFault(
            `collision mask must be an integer in [0, ${TILE_COLLISION_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value;
};

export const asMaterialId = (value: number): number => {
    if (!isMaterialId(value)) {
        throw new TilemapFault(
            `material id must be an integer in [0, ${TILE_MATERIAL_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value;
};

export const asLayerIndex = (value: number): LayerIndex => {
    assertInteger('layer index', value, 0, MAX_LAYER_INDEX);
    return value as LayerIndex;
};

export const asChunkKey = (value: number): ChunkKey => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new TilemapFault(
            'chunk key must be an unsigned 32-bit integer',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value as ChunkKey;
};

export const asGridKey = (value: number): GridKey => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new TilemapFault(
            'grid key must be an unsigned 32-bit integer',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value as GridKey;
};

export const asChunkGeneration = (value: number): ChunkGeneration => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new TilemapFault(
            'chunk generation must be an unsigned 32-bit integer',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { value }
        );
    }
    return value as ChunkGeneration;
};

export const asChunkX = (value: number): ChunkX => {
    assertInteger('chunk x', value, KEY_MIN, KEY_MAX);
    return value as ChunkX;
};

export const asChunkY = (value: number): ChunkY => {
    assertInteger('chunk y', value, KEY_MIN, KEY_MAX);
    return value as ChunkY;
};

export const asGridX = (value: number): GridX => {
    assertInteger('grid x', value, KEY_MIN, KEY_MAX);
    return value as GridX;
};

export const asGridY = (value: number): GridY => {
    assertInteger('grid y', value, KEY_MIN, KEY_MAX);
    return value as GridY;
};

export const asLocalX = (value: number): LocalX => {
    assertInteger('local x', value, 0, 63);
    return value as LocalX;
};

export const asLocalY = (value: number): LocalY => {
    assertInteger('local y', value, 0, 63);
    return value as LocalY;
};

export const asWorldX = (value: number): WorldX => {
    if (!Number.isFinite(value)) {
        fault('world x must be finite', { value });
    }
    return value as WorldX;
};

export const asWorldY = (value: number): WorldY => {
    if (!Number.isFinite(value)) {
        fault('world y must be finite', { value });
    }
    return value as WorldY;
};

export const isGridCoordinateInRange = (x: number, y: number): boolean =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= KEY_MIN &&
    x <= KEY_MAX &&
    y >= KEY_MIN &&
    y <= KEY_MAX;

export const isChunkCoordinateInRange = (x: number, y: number): boolean =>
    isGridCoordinateInRange(x, y);

/** The plan's coordinate limits, re-exported for docs and tests. */
export const COORDINATE_LIMITS = Object.freeze({
    min: KEY_MIN,
    max: KEY_MAX,
    bits: KEY_BITS,
    mask: KEY_MASK,
    tileIdMax: TILE_ID_MAX,
    collisionMax: TILE_COLLISION_MAX,
    materialMax: TILE_MATERIAL_MAX,
    transformMax: TILE_TRANSFORM_MAX,
});
