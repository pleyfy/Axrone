import { err, ok, type Result } from '@axrone/utility';
import {
    TilemapErrorCode,
    TilemapFault,
    tilemapError,
    type TilemapError,
} from '../errors';
import type { TilemapMetricsSink } from '../metrics';
import type { IChunkPager } from '../grid/chunk-pager';
import {
    createLayerSpecs,
    type AssertUniqueLayerNames,
    type LayerSpec,
} from '../types/layers';
import {
    createProjectionSpec,
    DEFAULT_PROJECTION,
    type ProjectionSpec,
} from '../types/projection';
import { isValidChunkShift, type ChunkSnapshot, type ValidChunkShift } from '../types/chunk';
import {
    TilemapEngine,
    type TilemapEngineOptions,
} from './tilemap-engine';

type MissingLayers = null;

type EngineLayers<L> = Extract<L, readonly LayerSpec[]>;

/**
 * Typestate builder for `TilemapEngine`.
 *
 * `build()` is only callable after `withLayers()`; before that the receiver
 * type is `never`, so the call fails to typecheck.
 */
export class TilemapBuilder<
    Layers extends readonly LayerSpec[] | MissingLayers = MissingLayers,
> {
    #projection: Readonly<ProjectionSpec> = DEFAULT_PROJECTION;
    #chunkShift: ValidChunkShift = TilemapEngine.DEFAULT_CHUNK_SHIFT;
    #layers: readonly Readonly<LayerSpec>[] | null = null;
    #maxLoadedChunks: number = TilemapEngine.DEFAULT_MAX_LOADED_CHUNKS;
    #maxDirtyChunks: number = TilemapEngine.DEFAULT_MAX_DIRTY_CHUNKS;
    #pager: IChunkPager | undefined;
    #metrics: TilemapMetricsSink | undefined;
    #onBeforeEvict:
        | ((snapshot: ChunkSnapshot) => Result<void, TilemapError>)
        | undefined;

    static create(): TilemapBuilder<MissingLayers> {
        return new TilemapBuilder<MissingLayers>();
    }

    withProjection(projection: ProjectionSpec): this {
        this.#projection = createProjectionSpec(projection);
        return this;
    }

    withChunkShift(chunkShift: ValidChunkShift): this {
        if (!isValidChunkShift(chunkShift)) {
            throw new TilemapFault(
                `chunkShift must be one of 3, 4, 5, 6; got ${String(chunkShift)}`,
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        this.#chunkShift = chunkShift;
        return this;
    }

    withLayers<const L extends readonly LayerSpec[]>(
        layers: L & AssertUniqueLayerNames<L>
    ): TilemapBuilder<L> {
        this.#layers = createLayerSpecs(layers);
        return this as unknown as TilemapBuilder<L>;
    }

    withCapacity(maxLoadedChunks: number): this {
        if (!Number.isInteger(maxLoadedChunks) || maxLoadedChunks < 1) {
            throw new TilemapFault(
                'maxLoadedChunks must be a positive integer',
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        this.#maxLoadedChunks = maxLoadedChunks;
        return this;
    }

    withDirtyBudget(maxDirtyChunks: number): this {
        if (!Number.isInteger(maxDirtyChunks) || maxDirtyChunks < 0) {
            throw new TilemapFault(
                'maxDirtyChunks must be a non-negative integer',
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        this.#maxDirtyChunks = maxDirtyChunks;
        return this;
    }

    withPager(pager: IChunkPager): this {
        this.#pager = pager;
        return this;
    }

    withMetrics(metrics: TilemapMetricsSink): this {
        this.#metrics = metrics;
        return this;
    }

    withEvictionHook(
        hook: (snapshot: ChunkSnapshot) => Result<void, TilemapError>
    ): this {
        this.#onBeforeEvict = hook;
        return this;
    }

    build(
        this: Layers extends readonly LayerSpec[]
            ? TilemapBuilder<Layers>
            : never
    ): Result<TilemapEngine<EngineLayers<Layers>>, TilemapError> {
        if (this.#layers === null) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_CONFIGURATION,
                    'tilemap builder needs layers before build()'
                )
            );
        }
        const options: TilemapEngineOptions<EngineLayers<Layers>> = {
            projection: this.#projection,
            layers: this.#layers as unknown as EngineLayers<Layers>,
            chunkShift: this.#chunkShift,
            maxLoadedChunks: this.#maxLoadedChunks,
            maxDirtyChunks: this.#maxDirtyChunks,
            pager: this.#pager,
            metrics: this.#metrics,
            onBeforeEvict: this.#onBeforeEvict,
        };
        return ok(new TilemapEngine<EngineLayers<Layers>>(options));
    }
}
