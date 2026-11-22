import { err, ok, type Disposable, type Result } from '@axrone/utility';
import { gridToChunkCoordinate, packChunkKey } from '../codec/spatial-codec';
import { TileCodec } from '../codec/tile-codec';
import {
    TilemapErrorCode,
    TilemapFault,
    tilemapError,
    type TilemapError,
} from '../errors';
import { ChunkStore } from '../grid/chunk-store';
import type { IChunkPager } from '../grid/chunk-pager';
import {
    NOOP_TILEMAP_METRICS,
    type TilemapMetricsSink,
    type TilemapStoreStats,
} from '../metrics';
import {
    asChunkKey,
    isChunkCoordinateInRange,
    isGridCoordinateInRange,
    type ChunkKey,
    type LayerIndex,
    type PackedTileWord,
} from '../types/brands';
import {
    createLayerSpecs,
    resolveLayerDefaultWords,
    type LayerReference,
    type LayerSpec,
} from '../types/layers';
import {
    createProjectionSpec,
    type ProjectionSpec,
} from '../types/projection';
import type {
    ChunkSnapshot,
    TileRead,
    ValidChunkShift,
} from '../types/chunk';
import { OperationTracker } from './lifecycle';

export interface TilemapEngineOptions<
    L extends readonly LayerSpec[] = readonly LayerSpec[],
> {
    readonly projection: ProjectionSpec;
    readonly layers: L;
    readonly chunkShift?: ValidChunkShift;
    readonly maxLoadedChunks?: number;
    readonly maxDirtyChunks?: number;
    readonly pager?: IChunkPager;
    readonly metrics?: TilemapMetricsSink;
    readonly onBeforeEvict?: (
        snapshot: ChunkSnapshot
    ) => Result<void, TilemapError>;
}

export interface TilemapEngineStats extends TilemapStoreStats {
    readonly pendingOperations: number;
    readonly hasPager: boolean;
}

type LayerInput<L extends readonly LayerSpec[]> = LayerReference<L>;

const DEFAULT_CHUNK_SHIFT: ValidChunkShift = 4;
const DEFAULT_MAX_LOADED_CHUNKS = 256;
const DEFAULT_MAX_DIRTY_CHUNKS = 32;

/**
 * Data-only tilemap engine. It owns chunk residency and lifecycle; projection
 * math, queries, pathfinding and rendering are separate modules that build on
 * `read`/`write`/`fillRect`.
 */
export class TilemapEngine<
        L extends readonly LayerSpec[] = readonly LayerSpec[],
    >
    implements Disposable
{
    static readonly DEFAULT_CHUNK_SHIFT = DEFAULT_CHUNK_SHIFT;
    static readonly DEFAULT_MAX_LOADED_CHUNKS = DEFAULT_MAX_LOADED_CHUNKS;
    static readonly DEFAULT_MAX_DIRTY_CHUNKS = DEFAULT_MAX_DIRTY_CHUNKS;

    readonly #projection: Readonly<ProjectionSpec>;
    readonly #layers: readonly Readonly<LayerSpec>[];
    readonly #layerNameToIndex: ReadonlyMap<string, number>;
    readonly #store: ChunkStore;
    readonly #pager: IChunkPager | undefined;
    readonly #metrics: TilemapMetricsSink;
    readonly #tracker = new OperationTracker();

    #closed = false;
    #disposed = false;

    constructor(options: TilemapEngineOptions<L>) {
        this.#projection = createProjectionSpec(options.projection);
        this.#layers = createLayerSpecs(options.layers);
        this.#layerNameToIndex = new Map(
            this.#layers.map((layer, index) => [layer.name, index])
        );
        this.#metrics = options.metrics ?? NOOP_TILEMAP_METRICS;
        this.#pager = options.pager;

        this.#store = new ChunkStore({
            chunkShift: options.chunkShift ?? DEFAULT_CHUNK_SHIFT,
            layerCount: this.#layers.length,
            maxLoadedChunks:
                options.maxLoadedChunks ?? DEFAULT_MAX_LOADED_CHUNKS,
            maxDirtyChunks:
                options.maxDirtyChunks ?? DEFAULT_MAX_DIRTY_CHUNKS,
            defaultWords: resolveLayerDefaultWords(this.#layers),
            metrics: this.#metrics,
            onBeforeEvict: options.onBeforeEvict,
        });
    }

    get projection(): Readonly<ProjectionSpec> {
        return this.#projection;
    }

    get layers(): readonly Readonly<LayerSpec>[] {
        return this.#layers;
    }

    get chunkShift(): ValidChunkShift {
        return this.#store.chunkShift;
    }

    get chunkSize(): number {
        return this.#store.chunkSize;
    }

    get layerCount(): number {
        return this.#layers.length;
    }

    get hasPager(): boolean {
        return this.#pager !== undefined;
    }

    get isClosed(): boolean {
        return this.#closed;
    }

    get isDisposed(): boolean {
        return this.#disposed;
    }

    get pendingOperations(): number {
        return this.#tracker.pending;
    }

    /** Resolves any layer index or name to an index, returning an error if unknown. */
    resolveLayer(layer: number | string): Result<number, TilemapError> {
        const index = this.#lookupLayer(layer);
        return index >= 0 ? ok(index) : err(this.#layerError(layer));
    }

    /** Residency-aware read. Invalid layers throw (programming error). */
    read(layer: LayerInput<L>, gridX: number, gridY: number): TileRead {
        const layerIndex = this.#layerIndexOrThrow(layer);
        const coordinate = gridToChunkCoordinate(
            gridX,
            gridY,
            this.#store.chunkShift
        );
        return this.#store.readWord(
            asChunkKey(
                this.#packChunk(coordinate.chunkX, coordinate.chunkY)
            ),
            layerIndex,
            coordinate.localX,
            coordinate.localY
        );
    }

    /** Fast read: returns the layer default when the chunk is unloaded. */
    readAt(
        layer: LayerInput<L>,
        gridX: number,
        gridY: number
    ): PackedTileWord {
        const layerIndex = this.#layerIndexOrThrow(layer);
        const coordinate = gridToChunkCoordinate(
            gridX,
            gridY,
            this.#store.chunkShift
        );
        return this.#store.readWordFast(
            asChunkKey(
                this.#packChunk(coordinate.chunkX, coordinate.chunkY)
            ),
            layerIndex,
            coordinate.localX,
            coordinate.localY
        );
    }

    getTile(
        layer: LayerInput<L>,
        gridX: number,
        gridY: number
    ): PackedTileWord {
        return this.readAt(layer, gridX, gridY);
    }

    write(
        layer: LayerInput<L>,
        gridX: number,
        gridY: number,
        word: PackedTileWord
    ): Result<void, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        if (!isGridCoordinateInRange(gridX, gridY)) {
            return err(this.#coordinateError(gridX, gridY));
        }
        if (!TileCodec.isPackedTileWord(word)) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_CONFIGURATION,
                    'tile word is not a valid 31-bit packed word',
                    { details: { word: word as unknown as number } }
                )
            );
        }
        const resolved = this.resolveLayer(layer);
        if (resolved.isErr()) return err(resolved.expectErr('resolve layer'));
        const layerIndex = resolved.get();
        const coordinate = gridToChunkCoordinate(
            gridX,
            gridY,
            this.#store.chunkShift
        );
        return this.#store.writeWord(
            asChunkKey(
                this.#packChunk(coordinate.chunkX, coordinate.chunkY)
            ),
            layerIndex,
            coordinate.localX,
            coordinate.localY,
            word
        );
    }

    setTile(
        layer: LayerInput<L>,
        gridX: number,
        gridY: number,
        word: PackedTileWord
    ): Result<void, TilemapError> {
        return this.write(layer, gridX, gridY, word);
    }

    /**
     * Writes a filled grid rectangle, touching only the chunks it overlaps.
     * Returns the number of changed words.
     */
    fillRect(
        layer: LayerInput<L>,
        gridX: number,
        gridY: number,
        width: number,
        height: number,
        word: PackedTileWord
    ): Result<number, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        if (
            !Number.isInteger(gridX) ||
            !Number.isInteger(gridY) ||
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 0 ||
            height < 0
        ) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_COORDINATE,
                    'fill rectangle must use integer, non-negative values'
                )
            );
        }
        if (width === 0 || height === 0) return ok(0);
        if (
            !isGridCoordinateInRange(gridX, gridY) ||
            !isGridCoordinateInRange(gridX + width - 1, gridY + height - 1)
        ) {
            return err(
                this.#coordinateError(gridX + width - 1, gridY + height - 1)
            );
        }
        if (!TileCodec.isPackedTileWord(word)) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_CONFIGURATION,
                    'tile word is not a valid 31-bit packed word',
                    { details: { word: word as unknown as number } }
                )
            );
        }
        const resolved = this.resolveLayer(layer);
        if (resolved.isErr()) return err(resolved.expectErr('resolve layer'));
        const layerIndex = resolved.get();

        const shift = this.#store.chunkShift;
        const chunkSize = this.#store.chunkSize;
        const startChunkX = gridX >> shift;
        const endChunkX = (gridX + width - 1) >> shift;
        const startChunkY = gridY >> shift;
        const endChunkY = (gridY + height - 1) >> shift;

        let changed = 0;
        for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY++) {
            const chunkOriginY = chunkY << shift;
            const localY = Math.max(gridY, chunkOriginY) - chunkOriginY;
            const localEndY =
                Math.min(gridY + height - 1, chunkOriginY + chunkSize - 1) -
                chunkOriginY;
            const localHeight = localEndY - localY + 1;
            for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX++) {
                const chunkOriginX = chunkX << shift;
                const localX = Math.max(gridX, chunkOriginX) - chunkOriginX;
                const localEndX =
                    Math.min(
                        gridX + width - 1,
                        chunkOriginX + chunkSize - 1
                    ) - chunkOriginX;
                const localWidth = localEndX - localX + 1;
                const filled = this.#store.fillWords(
                    asChunkKey(this.#packChunk(chunkX, chunkY)),
                    layerIndex,
                    localX,
                    localY,
                    localWidth,
                    localHeight,
                    word
                );
                if (filled.isErr()) {
                    return err(filled.expectErr('fill words'));
                }
                changed += filled.get();
            }
        }
        return ok(changed);
    }

    /** True when the chunk containing this grid position is resident. */
    isChunkResidentAt(gridX: number, gridY: number): boolean {
        const coordinate = gridToChunkCoordinate(
            gridX,
            gridY,
            this.#store.chunkShift
        );
        return this.#store.isResident(
            asChunkKey(this.#packChunk(coordinate.chunkX, coordinate.chunkY))
        );
    }

    hasDirtyChunkAt(gridX: number, gridY: number): boolean {
        const coordinate = gridToChunkCoordinate(
            gridX,
            gridY,
            this.#store.chunkShift
        );
        return this.#store.hasDirtyChunk(
            asChunkKey(this.#packChunk(coordinate.chunkX, coordinate.chunkY))
        );
    }

    chunkKeyFor(chunkX: number, chunkY: number): Result<ChunkKey, TilemapError> {
        if (!isChunkCoordinateInRange(chunkX, chunkY)) {
            return err(this.#coordinateError(chunkX, chunkY));
        }
        return ok(asChunkKey(this.#packChunk(chunkX, chunkY)));
    }

    /** Exports one resident chunk, or `null` when it is not loaded. */
    exportSnapshot(
        chunkX: number,
        chunkY: number
    ): Result<ChunkSnapshot | null, TilemapError> {
        if (!isChunkCoordinateInRange(chunkX, chunkY)) {
            return err(this.#coordinateError(chunkX, chunkY));
        }
        return this.#store.exportSnapshot(
            asChunkKey(this.#packChunk(chunkX, chunkY))
        );
    }

    /** Applies a detached snapshot without going through the pager. */
    importSnapshot(
        snapshot: ChunkSnapshot,
        options: { readonly force?: boolean } = {}
    ): Result<void, TilemapError> {
        if (this.#closed) return err(this.#closedError());
        return this.#store.importSnapshot(snapshot, options);
    }

    /** Every dirty chunk as a detached snapshot, in eviction order. */
    exportDirtySnapshots(): Result<readonly ChunkSnapshot[], TilemapError> {
        if (this.#closed) return err(this.#closedError());
        const snapshots: ChunkSnapshot[] = [];
        for (const entry of this.#store.listDirty()) {
            const snapshot = this.#store.exportSnapshot(entry.key);
            if (snapshot.isErr()) {
                return err(snapshot.expectErr('dirty snapshot'));
            }
            const value = snapshot.get();
            if (value !== null) snapshots.push(value);
        }
        return ok(snapshots);
    }

    /** Loads one chunk from the pager. `false` means it was already resident. */
    async loadChunk(
        chunkX: number,
        chunkY: number,
        signal?: AbortSignal
    ): Promise<Result<boolean, TilemapError>> {
        if (this.#closed) return err(this.#closedError());
        if (!this.#pager) {
            return err(
                tilemapError(
                    TilemapErrorCode.PAGER_NOT_CONFIGURED,
                    'loadChunk needs a chunk pager'
                )
            );
        }
        if (!isChunkCoordinateInRange(chunkX, chunkY)) {
            return err(this.#coordinateError(chunkX, chunkY));
        }
        if (!this.#tracker.begin()) return err(this.#closedError());
        const key = asChunkKey(this.#packChunk(chunkX, chunkY));
        const wasResident = this.#store.isResident(key);
        let imported = false;
        try {
            if (signal?.aborted) return err(this.#abortedError());
            // Resident data is authoritative: a dirty chunk holds newer words
            // than the pager, so a reload would either overwrite them or fail.
            if (wasResident) return ok(false);

            const leased = this.#store.acquireLease(key);
            if (leased.isErr()) return err(leased.expectErr('acquire lease'));
            const lease = leased.get();
            try {
                let loaded: Result<ChunkSnapshot | null, TilemapError>;
                try {
                    loaded = await this.#pager.load(key, signal);
                } catch (cause) {
                    return err(this.#pagerError('load', key, cause));
                }
                if (loaded.isErr()) {
                    return err(loaded.expectErr('pager load'));
                }
                if (signal?.aborted) return err(this.#abortedError());
                const snapshot = loaded.get();
                if (snapshot === null) return ok(false);
                if (snapshot.key !== key) {
                    return err(
                        tilemapError(
                            TilemapErrorCode.INVALID_SNAPSHOT,
                            'pager returned a snapshot for a different chunk',
                            {
                                chunkKey: key,
                                details: { actualKey: snapshot.key },
                            }
                        )
                    );
                }

                const applied = this.#store.importSnapshot(snapshot);
                if (applied.isErr()) {
                    return err(applied.expectErr('import snapshot'));
                }
                imported = true;
                return ok(true);
            } finally {
                lease.release();
            }
        } finally {
            if (!wasResident && !imported) {
                this.#store.evict(key, 'force');
            }
            this.#tracker.end();
        }
    }

    /**
     * Saves every dirty chunk. Callers retry a failed write after this when the
     * pool reports `CHUNK_POOL_EXHAUSTED` with dirty pressure.
     */
    async flushDirty(
        signal?: AbortSignal
    ): Promise<Result<number, TilemapError>> {
        if (this.#disposed) return err(this.#closedError());
        if (!this.#pager) {
            return err(
                tilemapError(
                    TilemapErrorCode.PAGER_NOT_CONFIGURED,
                    'flushDirty needs a chunk pager'
                )
            );
        }
        if (!this.#tracker.beginShutdown()) return err(this.#closedError());
        try {
            const entries = this.#store.listDirty();
            let flushed = 0;
            for (const entry of entries) {
                if (signal?.aborted) return err(this.#abortedError());
                const exported = this.#store.exportSnapshot(entry.key);
                if (exported.isErr()) {
                    return err(exported.expectErr('export snapshot'));
                }
                const snapshot = exported.get();
                if (snapshot === null) continue;
                let saved: Result<void, TilemapError>;
                try {
                    saved = await this.#pager.save(snapshot, signal);
                } catch (cause) {
                    return err(this.#pagerError('save', entry.key, cause));
                }
                if (saved.isErr()) return err(saved.expectErr('pager save'));
                this.#store.markClean(entry.key, entry.generation);
                this.#metrics.onChunkFlushed?.(
                    entry.key,
                    snapshot.words.byteLength
                );
                flushed++;
            }
            return ok(flushed);
        } finally {
            this.#tracker.end();
        }
    }

    /** Flushes the dirty chunk containing the chunk coordinate, if any. */
    async flushChunk(
        chunkX: number,
        chunkY: number,
        signal?: AbortSignal
    ): Promise<Result<boolean, TilemapError>> {
        if (this.#disposed) return err(this.#closedError());
        if (!this.#pager) {
            return err(
                tilemapError(
                    TilemapErrorCode.PAGER_NOT_CONFIGURED,
                    'flushChunk needs a chunk pager'
                )
            );
        }
        if (!isChunkCoordinateInRange(chunkX, chunkY)) {
            return err(this.#coordinateError(chunkX, chunkY));
        }
        const key = asChunkKey(this.#packChunk(chunkX, chunkY));
        const generation = this.#store.dirtyGeneration(key);
        if (generation === null) return ok(false);
        if (!this.#tracker.beginShutdown()) return err(this.#closedError());
        try {
            if (signal?.aborted) return err(this.#abortedError());
            const exported = this.#store.exportSnapshot(key);
            if (exported.isErr()) {
                return err(exported.expectErr('export snapshot'));
            }
            const snapshot = exported.get();
            if (snapshot === null) return ok(false);
            let saved: Result<void, TilemapError>;
            try {
                saved = await this.#pager.save(snapshot, signal);
            } catch (cause) {
                return err(this.#pagerError('save', key, cause));
            }
            if (saved.isErr()) return err(saved.expectErr('pager save'));
            this.#store.markClean(key, generation);
            this.#metrics.onChunkFlushed?.(key, snapshot.words.byteLength);
            return ok(true);
        } finally {
            this.#tracker.end();
        }
    }

    /** Evicts one chunk; `write-back` flushes dirty data through the pager first. */
    async unloadChunk(
        chunkX: number,
        chunkY: number,
        mode: 'force' | 'write-back' = 'write-back'
    ): Promise<Result<boolean, TilemapError>> {
        if (this.#disposed) return err(this.#closedError());
        if (!isChunkCoordinateInRange(chunkX, chunkY)) {
            return err(this.#coordinateError(chunkX, chunkY));
        }
        const key = asChunkKey(this.#packChunk(chunkX, chunkY));
        if (mode === 'write-back' && this.#store.hasDirtyChunk(key)) {
            const flushed = await this.flushChunk(chunkX, chunkY);
            if (flushed.isErr()) return err(flushed.expectErr('flush chunk'));
        }
        return this.#store.evict(key, mode);
    }

    /** Stops accepting new foreground work; `flushDirty` still works. */
    close(): void {
        if (this.#disposed) return;
        this.#closed = true;
        this.#tracker.close();
    }

    /** Resolves when all in-flight loads and saves have finished. */
    drain(): Promise<void> {
        return this.#tracker.drain();
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#closed = true;
        this.#disposed = true;
        this.#tracker.dispose();
        this.#store.dispose();
    }

    stats(): TilemapEngineStats {
        return {
            ...this.#store.stats(),
            pendingOperations: this.#tracker.pending,
            hasPager: this.#pager !== undefined,
            layerCount: this.#layers.length,
        };
    }

    #layerIndexOrThrow(layer: LayerInput<L>): number {
        const index = this.#lookupLayer(layer);
        if (index >= 0) return index;
        const error = this.#layerError(layer);
        throw new TilemapFault(error.message, error.code, error.details);
    }

    /** Non-allocating layer lookup for hot paths; returns -1 when unknown. */
    #lookupLayer(layer: number | string): number {
        if (typeof layer === 'number') {
            return Number.isInteger(layer) &&
                layer >= 0 &&
                layer < this.#layers.length
                ? layer
                : -1;
        }
        return this.#layerNameToIndex.get(layer) ?? -1;
    }

    #layerError(layer: number | string): TilemapError {
        if (typeof layer === 'number') {
            return tilemapError(
                TilemapErrorCode.INVALID_LAYER,
                `layer index ${layer} is outside [0, ${this.#layers.length - 1}]`,
                { details: { layer, layerCount: this.#layers.length } }
            );
        }
        return tilemapError(
            TilemapErrorCode.INVALID_LAYER,
            `unknown layer: ${layer}`,
            { details: { layer } }
        );
    }

    #packChunk(chunkX: number, chunkY: number): number {
        return packChunkKey(chunkX, chunkY);
    }

    #coordinateError(gridX: number, gridY: number): TilemapError {
        return tilemapError(
            TilemapErrorCode.INVALID_COORDINATE,
            `coordinate (${gridX}, ${gridY}) is outside the supported [-32768, 32767] range`,
            { details: { gridX, gridY } }
        );
    }

    #abortedError(): TilemapError {
        return tilemapError(
            TilemapErrorCode.OPERATION_ABORTED,
            'tilemap operation was aborted'
        );
    }

    #pagerError(
        operation: 'load' | 'save',
        key: ChunkKey,
        cause: unknown
    ): TilemapError {
        return tilemapError(
            TilemapErrorCode.PAGER_IO_ERROR,
            `chunk pager ${operation} failed`,
            { chunkKey: key, cause }
        );
    }

    #closedError(): TilemapError {
        return tilemapError(
            TilemapErrorCode.ENGINE_CLOSED,
            'tilemap engine is closed'
        );
    }
}
