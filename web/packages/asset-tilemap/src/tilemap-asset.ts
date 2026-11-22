import type { AssetJsonCodec, AssetJsonValue } from '@axrone/asset-core';
import {
    KEY_MAX,
    KEY_MIN,
    createLayerSpecs,
    createProjectionSpec,
    isValidChunkShift,
    type LayerSpec,
    type ProjectionSpec,
    type ValidChunkShift,
} from '@axrone/tilemap';
import { err, ok, isPlainObject, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from './errors';

export const TILEMAP_ASSET_FORMAT_VERSION = 1;

/** Reference to one persisted chunk asset. */
export interface TilemapChunkAssetReference {
    readonly chunkX: number;
    readonly chunkY: number;
    /** Asset key / stable key of the chunk snapshot asset. */
    readonly asset: string;
}

/** Versioned native tilemap definition. Chunk words live in chunk assets. */
export interface TilemapAssetDefinition {
    readonly formatVersion: 1;
    readonly projection: ProjectionSpec;
    readonly chunkShift: ValidChunkShift;
    readonly tilesets: readonly string[];
    readonly layers: readonly LayerSpec[];
    readonly chunks: readonly TilemapChunkAssetReference[];
}

const fail = (
    message: string,
    details?: Readonly<Record<string, unknown>>,
    code: TilemapAssetErrorCode = TilemapAssetErrorCode.INVALID_TILEMAP
): Result<never, TilemapAssetError> =>
    err(tilemapAssetError(code, message, { details }));

const isChunkCoordinate = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= KEY_MIN &&
    value <= KEY_MAX;

export const tilemapChunkAssetKey = (
    mapKey: string,
    chunkX: number,
    chunkY: number
): string => `tilemap:${mapKey}:chunk:${chunkX}:${chunkY}`;

export const serializeTilemapAssetDefinition = (
    definition: TilemapAssetDefinition
): AssetJsonValue => ({
    formatVersion: definition.formatVersion,
    projection: { ...definition.projection },
    chunkShift: definition.chunkShift,
    tilesets: [...definition.tilesets],
    layers: definition.layers.map((layer) => {
        const value: Record<string, AssetJsonValue> = { name: layer.name };
        if (layer.defaultWord !== undefined) {
            value.defaultWord = layer.defaultWord as number;
        }
        if (layer.visible !== undefined) value.visible = layer.visible;
        if (layer.collision !== undefined) value.collision = layer.collision;
        if (layer.zIndex !== undefined) value.zIndex = layer.zIndex;
        if (layer.renderOrder !== undefined) {
            value.renderOrder = layer.renderOrder;
        }
        if (layer.opacity !== undefined) value.opacity = layer.opacity;
        return value;
    }),
    chunks: definition.chunks.map((chunk) => ({
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        asset: chunk.asset,
    })),
});

/**
 * Validates and freezes a native tilemap definition. Projection and layers are
 * reused from `@axrone/tilemap`, so their rules (layer count/names, projection
 * fields) stay single-sourced.
 */
export const createTilemapAssetDefinition = (
    input: unknown
): Result<TilemapAssetDefinition, TilemapAssetError> => {
    if (!isPlainObject(input)) {
        return fail('tilemap definition must be an object');
    }
    if (input.formatVersion !== TILEMAP_ASSET_FORMAT_VERSION) {
        return fail(
            `unsupported tilemap formatVersion: ${String(input.formatVersion)}`,
            { formatVersion: input.formatVersion },
            TilemapAssetErrorCode.UNSUPPORTED_VERSION
        );
    }

    let projection: Readonly<ProjectionSpec>;
    try {
        projection = createProjectionSpec(input.projection as ProjectionSpec);
    } catch (cause) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.INVALID_TILEMAP,
                'tilemap projection is invalid',
                { cause }
            )
        );
    }
    if (!isValidChunkShift(input.chunkShift as number)) {
        return fail('tilemap chunkShift must be one of 3, 4, 5 or 6', {
            chunkShift: input.chunkShift,
        });
    }
    const chunkShift = input.chunkShift as ValidChunkShift;

    if (!Array.isArray(input.tilesets) || input.tilesets.length === 0) {
        return fail('tilemap tilesets must be a non-empty array of asset keys');
    }
    const tilesets: string[] = [];
    for (const tileset of input.tilesets) {
        if (typeof tileset !== 'string' || tileset.length === 0) {
            return fail('tilemap tileset entries must be non-empty strings');
        }
        tilesets.push(tileset);
    }

    let layers: readonly Readonly<LayerSpec>[];
    try {
        layers = createLayerSpecs(input.layers as readonly LayerSpec[]);
    } catch (cause) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.INVALID_TILEMAP,
                'tilemap layers are invalid',
                { cause }
            )
        );
    }

    if (!Array.isArray(input.chunks)) {
        return fail('tilemap chunks must be an array');
    }
    const chunks: TilemapChunkAssetReference[] = [];
    const seen = new Set<string>();
    for (const chunk of input.chunks) {
        if (!isPlainObject(chunk)) {
            return fail('tilemap chunk entries must be objects');
        }
        if (
            !Number.isInteger(chunk.chunkX) ||
            !isChunkCoordinate(chunk.chunkX) ||
            !Number.isInteger(chunk.chunkY) ||
            !isChunkCoordinate(chunk.chunkY)
        ) {
            return fail('tilemap chunk coordinates must be signed 16-bit integers', {
                chunkX: chunk.chunkX,
                chunkY: chunk.chunkY,
            });
        }
        if (typeof chunk.asset !== 'string' || chunk.asset.length === 0) {
            return fail('tilemap chunk asset must be a non-empty string');
        }
        const key = `${chunk.chunkX}:${chunk.chunkY}`;
        if (seen.has(key)) {
            return fail(`duplicate chunk reference ${key}`, {
                chunkX: chunk.chunkX,
                chunkY: chunk.chunkY,
            });
        }
        seen.add(key);
        chunks.push(
            Object.freeze({
                chunkX: chunk.chunkX as number,
                chunkY: chunk.chunkY as number,
                asset: chunk.asset,
            })
        );
    }
    chunks.sort(
        (left, right) =>
            left.chunkY - right.chunkY || left.chunkX - right.chunkX
    );

    return ok(
        Object.freeze({
            formatVersion: TILEMAP_ASSET_FORMAT_VERSION,
            projection,
            chunkShift,
            tilesets: Object.freeze(tilesets),
            layers: Object.freeze(layers.slice()),
            chunks: Object.freeze(chunks),
        }) as TilemapAssetDefinition
    );
};

export const tilemapAssetJsonCodec: AssetJsonCodec<TilemapAssetDefinition> = {
    format: 'json',
    serialize: serializeTilemapAssetDefinition,
    deserialize(value: AssetJsonValue): TilemapAssetDefinition {
        const result = createTilemapAssetDefinition(value);
        if (result.isErr()) {
            throw result.expectErr('tilemap asset json');
        }
        return result.get();
    },
};
