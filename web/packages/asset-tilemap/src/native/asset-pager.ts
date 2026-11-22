import type { AssetDatabase } from '@axrone/asset-core';
import {
    TilemapErrorCode,
    tilemapError,
    unpackChunkX,
    unpackChunkY,
    validateChunkSnapshot,
    type ChunkKey,
    type ChunkSnapshot,
    type IChunkPager,
    type ValidChunkShift,
} from '@axrone/tilemap';
import { err, ok, type Result } from '@axrone/utility';
import type { TilemapError } from '@axrone/tilemap';
import type { AssetTilemapSchema } from '../index';
import { tilemapChunkAssetKey } from '../tilemap-asset';

export interface AssetChunkPagerOptions {
    /** Map key used to build chunk asset keys. */
    readonly mapKey: string;
    readonly chunkShift: ValidChunkShift;
    readonly layerCount: number;
}

/**
 * `IChunkPager` over an `AssetDatabase<AssetTilemapSchema>`.
 *
 * `load` returns `null` for missing chunks and validates the stored snapshot
 * against the requested key/shift/layer count before handing it to the engine.
 * `save` upserts the chunk asset by stable key, so asset-core bumps the
 * revision and emits normal change events.
 */
export class AssetChunkPager implements IChunkPager {
    readonly #database: AssetDatabase<AssetTilemapSchema>;
    readonly #options: AssetChunkPagerOptions;

    constructor(
        database: AssetDatabase<AssetTilemapSchema>,
        options: AssetChunkPagerOptions
    ) {
        this.#database = database;
        this.#options = options;
    }

    async load(
        key: ChunkKey,
        signal?: AbortSignal
    ): Promise<Result<ChunkSnapshot | null, TilemapError>> {
        if (signal?.aborted) {
            return err(
                tilemapError(
                    TilemapErrorCode.OPERATION_ABORTED,
                    'chunk asset load was aborted'
                )
            );
        }
        const chunkX = unpackChunkX(key as unknown as number);
        const chunkY = unpackChunkY(key as unknown as number);
        const assetKey = tilemapChunkAssetKey(
            this.#options.mapKey,
            chunkX,
            chunkY
        );
        try {
            const record = this.#database.get({
                kind: 'tilemap-chunk',
                key: assetKey,
            });
            if (record === undefined) return ok(null);
            const snapshot = record.data as ChunkSnapshot;
            const valid = validateChunkSnapshot(snapshot, {
                key,
                chunkShift: this.#options.chunkShift,
                layerCount: this.#options.layerCount,
            });
            if (valid.isErr()) {
                return err(valid.expectErr('chunk asset snapshot'));
            }
            return ok(snapshot);
        } catch (cause) {
            return err(
                tilemapError(
                    TilemapErrorCode.PAGER_IO_ERROR,
                    'failed to load a chunk asset',
                    { chunkKey: key, cause }
                )
            );
        }
    }

    async save(
        snapshot: ChunkSnapshot,
        signal?: AbortSignal
    ): Promise<Result<void, TilemapError>> {
        if (signal?.aborted) {
            return err(
                tilemapError(
                    TilemapErrorCode.OPERATION_ABORTED,
                    'chunk asset save was aborted'
                )
            );
        }
        const valid = validateChunkSnapshot(snapshot, {
            chunkShift: this.#options.chunkShift,
            layerCount: this.#options.layerCount,
        });
        if (valid.isErr()) {
            return err(valid.expectErr('chunk asset snapshot'));
        }
        const chunkX = unpackChunkX(snapshot.key as unknown as number);
        const chunkY = unpackChunkY(snapshot.key as unknown as number);
        const assetKey = tilemapChunkAssetKey(
            this.#options.mapKey,
            chunkX,
            chunkY
        );
        try {
            this.#database.upsertMany([
                {
                    kind: 'tilemap-chunk',
                    data: snapshot,
                    name: assetKey,
                    stableKey: assetKey,
                },
            ]);
            return ok(undefined);
        } catch (cause) {
            return err(
                tilemapError(
                    TilemapErrorCode.PAGER_IO_ERROR,
                    'failed to save a chunk asset',
                    { chunkKey: snapshot.key, cause }
                )
            );
        }
    }
}
