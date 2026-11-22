import type { AssetJsonCodec, AssetJsonValue } from '@axrone/asset-core';
import {
    createTileDefinitionTable,
    type TileDefinition,
} from '@axrone/tilemap';
import { err, ok, isPlainObject, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from './errors';

export const TILESET_FORMAT_VERSION = 1;

/** Versioned tileset schema consumed by the tilemap asset pipeline. */
export interface TilesetDefinition {
    readonly formatVersion: 1;
    readonly name: string;
    /** Asset key of the atlas image. */
    readonly image: string;
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly margin: number;
    readonly spacing: number;
    readonly columns: number;
    readonly tileCount: number;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly tiles: readonly TileDefinition[];
}

const fail = (
    message: string,
    details?: Readonly<Record<string, unknown>>,
    code: TilemapAssetErrorCode = TilemapAssetErrorCode.INVALID_TILESET
): Result<never, TilemapAssetError> =>
    err(tilemapAssetError(code, message, { details }));

const isPositiveInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0;

const serializeTile = (tile: TileDefinition): AssetJsonValue => {
    const value: Record<string, AssetJsonValue> = {
        id: tile.id,
        name: tile.name,
    };
    if (tile.collision !== undefined) value.collision = tile.collision;
    if (tile.material !== undefined) value.material = tile.material;
    if (tile.autotileGroup !== undefined) {
        value.autotileGroup = tile.autotileGroup;
    }
    if (tile.animation !== undefined) {
        value.animation = tile.animation.map((frame) => ({
            tileId: frame.tileId,
            durationMs: frame.durationMs,
        }));
    }
    return value;
};

export const serializeTilesetDefinition = (
    definition: TilesetDefinition
): AssetJsonValue => ({
    formatVersion: definition.formatVersion,
    name: definition.name,
    image: definition.image,
    tileWidth: definition.tileWidth,
    tileHeight: definition.tileHeight,
    margin: definition.margin,
    spacing: definition.spacing,
    columns: definition.columns,
    tileCount: definition.tileCount,
    imageWidth: definition.imageWidth,
    imageHeight: definition.imageHeight,
    tiles: definition.tiles.map(serializeTile),
});

/**
 * Validates and freezes a tileset definition.
 *
 * `tileCount` must equal `columns * rows`, where `rows` follows the Tiled
 * atlas formula `floor((imageHeight - 2 * margin + spacing) / (tileHeight + spacing))`.
 * A partially filled last row is rejected instead of silently accepted.
 */
export const createTilesetDefinition = (
    input: unknown
): Result<TilesetDefinition, TilemapAssetError> => {
    if (!isPlainObject(input)) {
        return fail('tileset definition must be an object');
    }
    if (input.formatVersion !== TILESET_FORMAT_VERSION) {
        return fail(
            `unsupported tileset formatVersion: ${String(input.formatVersion)}`,
            { formatVersion: input.formatVersion },
            TilemapAssetErrorCode.UNSUPPORTED_VERSION
        );
    }
    if (!isNonEmptyString(input.name)) {
        return fail('tileset name must be a non-empty string');
    }
    if (!isNonEmptyString(input.image)) {
        return fail('tileset image must be a non-empty asset key');
    }
    if (!isPositiveInteger(input.tileWidth) || !isPositiveInteger(input.tileHeight)) {
        return fail('tileset tileWidth and tileHeight must be positive integers');
    }
    if (
        !isNonNegativeInteger(input.margin) ||
        !isNonNegativeInteger(input.spacing)
    ) {
        return fail('tileset margin and spacing must be non-negative integers');
    }
    if (!isPositiveInteger(input.columns)) {
        return fail('tileset columns must be a positive integer');
    }
    if (!isPositiveInteger(input.tileCount)) {
        return fail('tileset tileCount must be a positive integer');
    }
    if (
        !isPositiveInteger(input.imageWidth) ||
        !isPositiveInteger(input.imageHeight)
    ) {
        return fail('tileset imageWidth and imageHeight must be positive integers');
    }
    if (!Array.isArray(input.tiles)) {
        return fail('tileset tiles must be an array');
    }

    const columns = input.columns;
    const tileWidth = input.tileWidth;
    const tileHeight = input.tileHeight;
    const margin = input.margin;
    const spacing = input.spacing;
    const imageWidth = input.imageWidth;
    const imageHeight = input.imageHeight;
    const tileCount = input.tileCount;

    const rows = Math.floor(
        (imageHeight - 2 * margin + spacing) / (tileHeight + spacing)
    );
    if (rows <= 0) {
        return fail('tileset image is too short for one tile row', {
            imageHeight,
            tileHeight,
            margin,
            spacing,
        });
    }
    if (tileCount !== columns * rows) {
        return fail('tileset tileCount must equal columns * rows', {
            tileCount,
            columns,
            rows,
            expected: columns * rows,
        });
    }
    const requiredWidth =
        margin * 2 + columns * tileWidth + Math.max(0, columns - 1) * spacing;
    if (requiredWidth > imageWidth) {
        return fail('tileset columns do not fit the image width', {
            requiredWidth,
            imageWidth,
        });
    }

    let tiles: TileDefinition[];
    try {
        const table = createTileDefinitionTable(
            input.tiles as readonly TileDefinition[]
        );
        tiles = (input.tiles as readonly TileDefinition[]).map(
            (tile) => table.get(tile.id)!
        );
    } catch (cause) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.INVALID_TILESET,
                'tileset contains invalid tile definitions',
                { cause }
            )
        );
    }
    for (const tile of tiles) {
        if (tile.id >= tileCount) {
            return fail(`tile id ${tile.id} is outside tileCount ${tileCount}`);
        }
        for (const frame of tile.animation ?? []) {
            if (frame.tileId >= tileCount) {
                return fail(
                    `animation frame tile id ${frame.tileId} is outside tileCount ${tileCount}`
                );
            }
        }
    }
    tiles.sort((left, right) => left.id - right.id);

    return ok(
        Object.freeze({
            formatVersion: TILESET_FORMAT_VERSION,
            name: input.name,
            image: input.image,
            tileWidth,
            tileHeight,
            margin,
            spacing,
            columns,
            tileCount,
            imageWidth,
            imageHeight,
            tiles: Object.freeze(tiles),
        }) as TilesetDefinition
    );
};

export const tilesetJsonCodec: AssetJsonCodec<TilesetDefinition> = {
    format: 'json',
    serialize: serializeTilesetDefinition,
    deserialize(value: AssetJsonValue): TilesetDefinition {
        const result = createTilesetDefinition(value);
        if (result.isErr()) {
            throw result.expectErr('tileset json');
        }
        return result.get();
    },
};
