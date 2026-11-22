import { err, ok, type Disposable, type Result } from '@axrone/utility';
import { validateChunkSnapshot } from '../codec/chunk-binary-codec';
import {
    TilemapErrorCode,
    TilemapFault,
    tilemapError,
    type TilemapError,
} from '../errors';
import {
    NOOP_TILEMAP_METRICS,
    type TilemapGaugeName,
    type TilemapMetricsSink,
    type TilemapStoreStats,
} from '../metrics';
import {
    MAX_LAYER_COUNT,
    asChunkGeneration,
    type ChunkGeneration,
    type ChunkKey,
    type PackedTileWord,
} from '../types/brands';
import {
    chunkAreaForShift,
    isValidChunkShift,
    type ChunkSnapshot,
    type TileRead,
    type ValidChunkShift,
} from '../types/chunk';
import { createChunkLease, type IChunkLease } from './chunk-lease';
import { ChunkSlotTable } from './chunk-slot-table';

const NO_SLOT = -1;
const MAX_CHUNKS = 1 << 16;

export interface ChunkStoreOptions {
    readonly chunkShift: ValidChunkShift;
    readonly layerCount: number;
    readonly maxLoadedChunks: number;
    /** Dirty write-back budget; the engine flushes above this. */
    readonly maxDirtyChunks: number;
    readonly defaultWords: Uint32Array;
    readonly metrics?: TilemapMetricsSink;
    /**
     * Synchronous flush hook used before evicting a dirty chunk. Returning an
     * error keeps the chunk resident; the store then reports pool exhaustion.
     */
    readonly onBeforeEvict?: (
        snapshot: ChunkSnapshot
    ) => Result<void, TilemapError>;
}

export interface EvictMode {
    readonly mode: 'force' | 'write-back';
}

/**
 * Residency-aware chunk store: slab + intrusive LRU + open-addressing table.
 *
 * The store never drops dirty data without either a successful
 * `onBeforeEvict` flush or an explicit `mode: 'force'` eviction.
 */
export class ChunkStore implements Disposable {
    readonly #chunkShift: ValidChunkShift;
    readonly #chunkSize: number;
    readonly #chunkArea: number;
    readonly #layerCount: number;
    readonly #wordsPerChunk: number;
    readonly #maxLoadedChunks: number;
    readonly #maxDirtyChunks: number;
    readonly #defaultWords: Uint32Array;
    readonly #metrics: TilemapMetricsSink;
    readonly #onBeforeEvict:
        | ((snapshot: ChunkSnapshot) => Result<void, TilemapError>)
        | undefined;

    readonly #slab: Uint32Array;
    readonly #keys: Uint32Array;
    readonly #generations: Uint32Array;
    readonly #pins: Uint32Array;
    readonly #dirty: Uint8Array;
    readonly #prev: Int32Array;
    readonly #next: Int32Array;
    readonly #freeSlots: Int32Array;

    readonly #table: ChunkSlotTable;

    #freeCount: number;
    #head = NO_SLOT;
    #tail = NO_SLOT;
    #pinnedChunks = 0;
    #dirtyChunks = 0;
    #generationCounter = 0;
    #closed = false;

    constructor(options: ChunkStoreOptions) {
        if (!isValidChunkShift(options.chunkShift)) {
            throw new TilemapFault(
                `chunkShift must be one of 3, 4, 5, 6; got ${String(options.chunkShift)}`,
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        if (
            !Number.isInteger(options.layerCount) ||
            options.layerCount < 1 ||
            options.layerCount > MAX_LAYER_COUNT
        ) {
            throw new TilemapFault(
                `layerCount must be an integer in [1, ${MAX_LAYER_COUNT}]`,
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        if (
            !Number.isInteger(options.maxLoadedChunks) ||
            options.maxLoadedChunks < 1 ||
            options.maxLoadedChunks > MAX_CHUNKS
        ) {
            throw new TilemapFault(
                `maxLoadedChunks must be an integer in [1, ${MAX_CHUNKS}]`,
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        if (
            !Number.isInteger(options.maxDirtyChunks) ||
            options.maxDirtyChunks < 0
        ) {
            throw new TilemapFault(
                'maxDirtyChunks must be a non-negative integer',
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }
        if (options.defaultWords.length !== options.layerCount) {
            throw new TilemapFault(
                `defaultWords must have one entry per layer (${options.layerCount})`,
                TilemapErrorCode.INVALID_CONFIGURATION
            );
        }

        this.#chunkShift = options.chunkShift;
        this.#chunkSize = 1 << options.chunkShift;
        this.#chunkArea = chunkAreaForShift(options.chunkShift);
        this.#layerCount = options.layerCount;
        this.#wordsPerChunk = this.#chunkArea * options.layerCount;
        this.#maxLoadedChunks = options.maxLoadedChunks;
        this.#maxDirtyChunks = options.maxDirtyChunks;
        this.#defaultWords = Uint32Array.from(options.defaultWords);
        this.#metrics = options.metrics ?? NOOP_TILEMAP_METRICS;
        this.#onBeforeEvict = options.onBeforeEvict;

        this.#slab = new Uint32Array(
            this.#maxLoadedChunks * this.#wordsPerChunk
        );
        this.#keys = new Uint32Array(this.#maxLoadedChunks).fill(0xffffffff);
        this.#generations = new Uint32Array(this.#maxLoadedChunks);
        this.#pins = new Uint32Array(this.#maxLoadedChunks);
        this.#dirty = new Uint8Array(this.#maxLoadedChunks);
        this.#prev = new Int32Array(this.#maxLoadedChunks).fill(NO_SLOT);
        this.#next = new Int32Array(this.#maxLoadedChunks).fill(NO_SLOT);
        this.#freeSlots = new Int32Array(this.#maxLoadedChunks);
        for (let slot = 0; slot < this.#maxLoadedChunks; slot++) {
            this.#freeSlots[slot] = this.#maxLoadedChunks - 1 - slot;
        }
        this.#freeCount = this.#maxLoadedChunks;

        this.#table = new ChunkSlotTable({
            capacity: Math.max(64, this.#maxLoadedChunks * 2),
            onRehash: (capacity) => this.#metrics.onTableRehash?.(capacity),
        });
    }

    get chunkShift(): ValidChunkShift {
        return this.#chunkShift;
    }

    get chunkSize(): number {
        return this.#chunkSize;
    }

    get chunkArea(): number {
        return this.#chunkArea;
    }

    get layerCount(): number {
        return this.#layerCount;
    }

    get wordsPerChunk(): number {
        return this.#wordsPerChunk;
    }

    get residentChunkCount(): number {
        return this.#table.size;
    }

    get dirtyChunkCount(): number {
        return this.#dirtyChunks;
    }

    get pinnedChunkCount(): number {
        return this.#pinnedChunks;
    }

    get isClosed(): boolean {
        return this.#closed;
    }

    get dirtyBudgetExceeded(): boolean {
        return this.#dirtyChunks > this.#maxDirtyChunks;
    }

    defaultWordFor(layer: number): PackedTileWord {
        this.#assertLayer(layer);
        return this.#defaultWords[layer] as PackedTileWord;
    }

    isResident(key: ChunkKey): boolean {
        return this.#table.find(key as unknown as number) !== NO_SLOT;
    }

    hasDirtyChunk(key: ChunkKey): boolean {
        const slot = this.#table.find(key as unknown as number);
        return slot !== NO_SLOT && this.#dirty[slot] === 1;
    }

    /** Allocates a default-filled slot when the chunk is not resident. */
    ensureChunk(key: ChunkKey): Result<boolean, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        if (this.#table.find(key as unknown as number) !== NO_SLOT) {
            return ok(false);
        }
        const slot = this.#allocate(key);
        if (slot.isErr()) return err(slot.expectErr('allocate chunk'));
        return ok(true);
    }

    acquireLease(key: ChunkKey): Result<IChunkLease, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        let slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) {
            const allocated = this.#allocate(key);
            if (allocated.isErr()) return err(allocated.expectErr('allocate'));
            slot = allocated.get();
        }
        this.#pins[slot] = (this.#pins[slot]! + 1) >>> 0;
        if (this.#pins[slot] === 1) this.#pinnedChunks++;
        this.#metrics.onChunkPinned?.(key);
        this.#gauge('pinnedChunks', this.#pinnedChunks);
        const generation = asChunkGeneration(this.#generations[slot]!);
        return ok(
            createChunkLease(key, generation, (releasedKey, releasedGen) =>
                this.#unpin(releasedKey, releasedGen)
            )
        );
    }

    readWord(
        key: ChunkKey,
        layer: number,
        localX: number,
        localY: number
    ): TileRead {
        this.#assertLayer(layer);
        this.#assertLocal(localX, localY);
        const slot = this.#table.find(key as unknown as number);
        const defaultWord = this.#defaultWords[layer] as PackedTileWord;
        if (slot === NO_SLOT) {
            return { word: defaultWord, residency: 'unloaded' };
        }
        const word = this.#slab[
            this.#wordIndex(slot, layer, localX, localY)
        ] as PackedTileWord;
        this.#touch(slot);
        return {
            word,
            residency: word === defaultWord ? 'default' : 'resident',
        };
    }

    /** Hot read path: no residency report and no allocation; coordinates are still checked. */
    readWordFast(
        key: ChunkKey,
        layer: number,
        localX: number,
        localY: number
    ): PackedTileWord {
        this.#assertLayer(layer);
        this.#assertLocal(localX, localY);
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) {
            return this.#defaultWords[layer] as PackedTileWord;
        }
        this.#touch(slot);
        return this.#slab[
            this.#wordIndex(slot, layer, localX, localY)
        ] as PackedTileWord;
    }

    writeWord(
        key: ChunkKey,
        layer: number,
        localX: number,
        localY: number,
        word: PackedTileWord
    ): Result<void, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        this.#assertLayer(layer);
        this.#assertLocal(localX, localY);
        let slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) {
            if ((word as unknown as number) === this.#defaultWords[layer]) {
                return ok(undefined);
            }
            const allocated = this.#allocate(key);
            if (allocated.isErr()) {
                return err(allocated.expectErr('allocate chunk'));
            }
            slot = allocated.get();
        }
        const index = this.#wordIndex(slot, layer, localX, localY);
        this.#touch(slot);
        if (this.#slab[index] === (word as unknown as number)) {
            return ok(undefined);
        }
        this.#slab[index] = word as unknown as number;
        this.#markDirty(slot, key);
        return ok(undefined);
    }

    /** Fills a local rectangle inside one chunk; returns the number of changed words. */
    fillWords(
        key: ChunkKey,
        layer: number,
        x: number,
        y: number,
        width: number,
        height: number,
        word: PackedTileWord
    ): Result<number, TilemapError> {
        this.#assertLayer(layer);
        const changed = this.#fillLocal(
            key,
            layer,
            x,
            y,
            width,
            height,
            word,
            true
        );
        if (changed.isErr()) return err(changed.expectErr('fill words'));
        return changed;
    }

    readWords(
        key: ChunkKey,
        layer: number,
        out: Uint32Array,
        x = 0,
        y = 0,
        width = this.#chunkSize,
        height = this.#chunkSize
    ): Result<number, TilemapError> {
        this.#assertLayer(layer);
        if (x < 0 || y < 0 || width < 0 || height < 0) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_COORDINATE,
                    'read rectangle must be non-negative'
                )
            );
        }
        if (x + width > this.#chunkSize || y + height > this.#chunkSize) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_COORDINATE,
                    'read rectangle exceeds the chunk bounds'
                )
            );
        }
        if (out.length < width * height) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_CONFIGURATION,
                    `read target needs ${width * height} words, got ${out.length}`
                )
            );
        }
        const slot = this.#table.find(key as unknown as number);
        let written = 0;
        for (let row = 0; row < height; row++) {
            const localY = y + row;
            for (let column = 0; column < width; column++) {
                const localX = x + column;
                out[written++] =
                    slot === NO_SLOT
                        ? this.#defaultWords[layer]!
                        : this.#slab[
                              this.#wordIndex(slot, layer, localX, localY)
                          ]!;
            }
        }
        return ok(written);
    }

    exportSnapshot(key: ChunkKey): Result<ChunkSnapshot | null, TilemapError> {
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) return ok(null);
        return ok(this.#snapshotOfSlot(slot));
    }

    importSnapshot(
        snapshot: ChunkSnapshot,
        options: { readonly force?: boolean } = {}
    ): Result<void, TilemapError> {
        if (this.#closed) {
            return err(this.#closedError());
        }
        const validated = validateChunkSnapshot(snapshot, {
            chunkShift: this.#chunkShift,
            layerCount: this.#layerCount,
        });
        if (validated.isErr()) {
            return err(validated.expectErr('validated snapshot'));
        }
        let slot = this.#table.find(snapshot.key as unknown as number);
        if (slot === NO_SLOT) {
            const allocated = this.#allocate(snapshot.key);
            if (allocated.isErr()) {
                return err(allocated.expectErr('allocate chunk'));
            }
            slot = allocated.get();
        } else if (this.#dirty[slot] === 1 && options.force !== true) {
            return err(
                tilemapError(
                    TilemapErrorCode.CHUNK_DIRTY,
                    'refusing to overwrite a dirty chunk without force',
                    { chunkKey: snapshot.key }
                )
            );
        }
        this.#copyWordsIntoSlot(slot, snapshot.words);
        if (this.#dirty[slot] === 1) {
            this.#dirty[slot] = 0;
            this.#dirtyChunks--;
            this.#gauge('dirtyChunks', this.#dirtyChunks);
        }
        this.#metrics.onChunkLoaded?.(snapshot.key);
        return ok(undefined);
    }

    markClean(key: ChunkKey, generation: ChunkGeneration): void {
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) return;
        if (this.#generations[slot] !== (generation as unknown as number)) return;
        if (this.#dirty[slot] === 0) return;
        this.#dirty[slot] = 0;
        this.#dirtyChunks--;
        this.#gauge('dirtyChunks', this.#dirtyChunks);
    }

    /** Generation of a dirty chunk, or null when it is absent or clean. */
    dirtyGeneration(key: ChunkKey): ChunkGeneration | null {
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT || this.#dirty[slot] !== 1) return null;
        return asChunkGeneration(this.#generations[slot]!);
    }

    evict(
        key: ChunkKey,
        mode: 'force' | 'write-back'
    ): Result<boolean, TilemapError> {
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) return ok(false);
        if (this.#pins[slot]! > 0) {
            return err(
                tilemapError(
                    TilemapErrorCode.CHUNK_PINNED,
                    'chunk is pinned by an active lease',
                    { chunkKey: key }
                )
            );
        }
        const dirty = this.#dirty[slot] === 1;
        if (dirty) {
            if (mode !== 'force') {
                const flushed = this.#flushBeforeEvict(slot, key);
                if (flushed.isErr()) return err(flushed.expectErr('flush'));
            }
            this.#dirty[slot] = 0;
            this.#dirtyChunks--;
            this.#gauge('dirtyChunks', this.#dirtyChunks);
        }
        this.#releaseSlot(slot, dirty);
        this.#pushFreeSlot(slot);
        return ok(true);
    }

    /** Dirty chunks in LRU order (oldest first). */
    listDirty(): readonly {
        readonly key: ChunkKey;
        readonly generation: ChunkGeneration;
    }[] {
        const entries: { key: ChunkKey; generation: ChunkGeneration }[] = [];
        for (let slot = this.#tail; slot !== NO_SLOT; slot = this.#prev[slot]!) {
            if (this.#dirty[slot] === 1) {
                entries.push({
                    key: this.#keys[slot] as ChunkKey,
                    generation: asChunkGeneration(this.#generations[slot]!),
                });
            }
        }
        return entries;
    }

    stats(): TilemapStoreStats {
        return {
            residentChunks: this.#table.size,
            dirtyChunks: this.#dirtyChunks,
            pinnedChunks: this.#pinnedChunks,
            maxLoadedChunks: this.#maxLoadedChunks,
            maxDirtyChunks: this.#maxDirtyChunks,
            chunkShift: this.#chunkShift,
            layerCount: this.#layerCount,
        };
    }

    dispose(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#table.clear();
        this.#pinnedChunks = 0;
        this.#dirtyChunks = 0;
        this.#head = NO_SLOT;
        this.#tail = NO_SLOT;
        this.#freeCount = this.#maxLoadedChunks;
        this.#pins.fill(0);
        this.#dirty.fill(0);
        this.#prev.fill(NO_SLOT);
        this.#next.fill(NO_SLOT);
        this.#slab.fill(0);
        this.#gauge('residentChunks', 0);
        this.#gauge('dirtyChunks', 0);
        this.#gauge('pinnedChunks', 0);
        this.#gauge('activeLeases', 0);
    }

    #unpin(key: ChunkKey, generation: ChunkGeneration): void {
        if (this.#closed) return;
        const slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) return;
        if (this.#generations[slot] !== (generation as unknown as number)) {
            return;
        }
        if (this.#pins[slot]! > 0) {
            this.#pins[slot] = this.#pins[slot]! - 1;
            if (this.#pins[slot] === 0) this.#pinnedChunks--;
        }
        this.#metrics.onChunkUnpinned?.(key);
        this.#gauge('pinnedChunks', this.#pinnedChunks);
    }

    #allocate(key: ChunkKey): Result<number, TilemapError> {
        let slot: number;
        if (this.#freeCount > 0) {
            slot = this.#freeSlots[--this.#freeCount]!;
        } else {
            const victim = this.#selectVictim(key);
            if (victim.isErr()) return err(victim.expectErr('evict victim'));
            slot = victim.get();
        }
        this.#claimSlot(slot, key);
        return ok(slot);
    }

    #selectVictim(key: ChunkKey): Result<number, TilemapError> {
        let dirtyCandidate = NO_SLOT;
        for (let slot = this.#tail; slot !== NO_SLOT; slot = this.#prev[slot]!) {
            if (this.#pins[slot]! > 0) continue;
            if (this.#dirty[slot] === 0) {
                this.#releaseSlot(slot, false);
                return ok(slot);
            }
            if (dirtyCandidate === NO_SLOT) dirtyCandidate = slot;
        }

        if (dirtyCandidate !== NO_SLOT && this.#onBeforeEvict) {
            for (
                let slot = dirtyCandidate;
                slot !== NO_SLOT;
                slot = this.#prev[slot]!
            ) {
                if (this.#pins[slot]! > 0 || this.#dirty[slot] === 0) continue;
                const flushed = this.#flushBeforeEvict(
                    slot,
                    this.#keys[slot] as ChunkKey
                );
                if (flushed.isOk()) {
                    this.#dirty[slot] = 0;
                    this.#dirtyChunks--;
                    this.#gauge('dirtyChunks', this.#dirtyChunks);
                    this.#releaseSlot(slot, true);
                    return ok(slot);
                }
            }
        }

        this.#metrics.onPoolExhausted?.({
            dirtyPressure: dirtyCandidate !== NO_SLOT,
            residentChunks: this.#table.size,
            pinnedChunks: this.#pinnedChunks,
        });
        return err(
            tilemapError(
                TilemapErrorCode.CHUNK_POOL_EXHAUSTED,
                dirtyCandidate === NO_SLOT
                    ? 'no evictable chunk slot: every resident chunk is pinned or the pool is empty'
                    : 'no evictable chunk slot: dirty chunks could not be flushed',
                {
                    chunkKey: key,
                    details: {
                        dirtyPressure: dirtyCandidate !== NO_SLOT,
                        residentChunks: this.#table.size,
                        pinnedChunks: this.#pinnedChunks,
                    },
                }
            )
        );
    }

    #claimSlot(slot: number, key: ChunkKey): void {
        const generation = this.#nextGeneration();
        this.#keys[slot] = key as unknown as number;
        this.#generations[slot] = generation as unknown as number;
        this.#pins[slot] = 0;
        this.#dirty[slot] = 0;
        this.#prev[slot] = NO_SLOT;
        this.#next[slot] = NO_SLOT;

        const base = slot * this.#wordsPerChunk;
        for (let layer = 0; layer < this.#layerCount; layer++) {
            this.#slab.fill(
                this.#defaultWords[layer]!,
                base + layer * this.#chunkArea,
                base + (layer + 1) * this.#chunkArea
            );
        }

        this.#table.insert(key as unknown as number, slot);
        this.#linkHead(slot);
        this.#metrics.onChunkAllocated?.(key);
        this.#gauge('residentChunks', this.#table.size);
    }

    #releaseSlot(slot: number, dirty: boolean): void {
        const key = this.#keys[slot] as ChunkKey;
        this.#metrics.onChunkEvicted?.(key, dirty);
        this.#table.remove(key as unknown as number);
        this.#unlink(slot);
        this.#keys[slot] = 0xffffffff;
        this.#generations[slot] =
            this.#generations[slot]! + 1 > 0xffffffff
                ? 0
                : this.#generations[slot]! + 1;
        this.#pins[slot] = 0;
        this.#dirty[slot] = 0;
        this.#gauge('residentChunks', this.#table.size);
    }

    #pushFreeSlot(slot: number): void {
        if (this.#freeCount >= this.#maxLoadedChunks) return;
        this.#freeSlots[this.#freeCount++] = slot;
    }

    #markDirty(slot: number, key: ChunkKey): void {
        if (this.#dirty[slot] === 1) return;
        this.#dirty[slot] = 1;
        this.#dirtyChunks++;
        this.#metrics.onChunkDirtied?.(key);
        this.#gauge('dirtyChunks', this.#dirtyChunks);
    }

    #flushBeforeEvict(
        slot: number,
        key: ChunkKey
    ): Result<void, TilemapError> {
        if (!this.#onBeforeEvict) {
            return err(
                tilemapError(
                    TilemapErrorCode.CHUNK_DIRTY,
                    'dirty chunk cannot be evicted: no write-back hook is configured',
                    { chunkKey: key }
                )
            );
        }
        const snapshot = this.#snapshotOfSlot(slot);
        return this.#onBeforeEvict(snapshot);
    }

    #snapshotOfSlot(slot: number): ChunkSnapshot {
        const base = slot * this.#wordsPerChunk;
        return {
            key: this.#keys[slot] as ChunkKey,
            chunkShift: this.#chunkShift,
            layerCount: this.#layerCount,
            words: this.#slab.slice(base, base + this.#wordsPerChunk),
        };
    }

    #copyWordsIntoSlot(slot: number, words: Uint32Array): void {
        const base = slot * this.#wordsPerChunk;
        this.#slab.set(words, base);
    }

    #fillLocal(
        key: ChunkKey,
        layer: number,
        x: number,
        y: number,
        width: number,
        height: number,
        word: PackedTileWord,
        allocate: boolean
    ): Result<number, TilemapError> {
        if (
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 0 ||
            height < 0
        ) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_COORDINATE,
                    'fill rectangle must use integer, non-negative coordinates'
                )
            );
        }
        if (x + width > this.#chunkSize || y + height > this.#chunkSize) {
            return err(
                tilemapError(
                    TilemapErrorCode.INVALID_COORDINATE,
                    'fill rectangle exceeds the chunk bounds'
                )
            );
        }
        let slot = this.#table.find(key as unknown as number);
        if (slot === NO_SLOT) {
            if (!allocate || width === 0 || height === 0) return ok(0);
            if ((word as unknown as number) === this.#defaultWords[layer]) {
                return ok(0);
            }
            const allocated = this.#allocate(key);
            if (allocated.isErr()) {
                return err(allocated.expectErr('allocate chunk'));
            }
            slot = allocated.get();
        }
        let changed = 0;
        const value = word as unknown as number;
        for (let row = 0; row < height; row++) {
            const base =
                slot * this.#wordsPerChunk +
                layer * this.#chunkArea +
                ((y + row) << this.#chunkShift) +
                x;
            for (let column = 0; column < width; column++) {
                if (this.#slab[base + column] !== value) {
                    this.#slab[base + column] = value;
                    changed++;
                }
            }
        }
        if (changed > 0) this.#markDirty(slot, key);
        return ok(changed);
    }

    #wordIndex(
        slot: number,
        layer: number,
        localX: number,
        localY: number
    ): number {
        return (
            slot * this.#wordsPerChunk +
            layer * this.#chunkArea +
            (localY << this.#chunkShift) +
            localX
        );
    }

    #nextGeneration(): ChunkGeneration {
        this.#generationCounter = (this.#generationCounter + 1) >>> 0;
        if (this.#generationCounter === 0) this.#generationCounter = 1;
        return asChunkGeneration(this.#generationCounter);
    }

    #linkHead(slot: number): void {
        this.#prev[slot] = NO_SLOT;
        this.#next[slot] = this.#head;
        if (this.#head !== NO_SLOT) this.#prev[this.#head] = slot;
        this.#head = slot;
        if (this.#tail === NO_SLOT) this.#tail = slot;
    }

    #touch(slot: number): void {
        if (this.#head === slot) return;
        this.#unlink(slot);
        this.#linkHead(slot);
    }

    #unlink(slot: number): void {
        const previous = this.#prev[slot]!;
        const next = this.#next[slot]!;
        if (previous !== NO_SLOT) this.#next[previous] = next;
        else this.#head = next;
        if (next !== NO_SLOT) this.#prev[next] = previous;
        else this.#tail = previous;
        this.#prev[slot] = NO_SLOT;
        this.#next[slot] = NO_SLOT;
    }

    #gauge(name: TilemapGaugeName, value: number): void {
        this.#metrics.onGauge?.(name, value);
    }

    #assertLayer(layer: number): void {
        if (
            !Number.isInteger(layer) ||
            layer < 0 ||
            layer >= this.#layerCount
        ) {
            throw new TilemapFault(
                `layer index ${layer} is outside [0, ${this.#layerCount - 1}]`,
                TilemapErrorCode.INVALID_LAYER,
                { layer, layerCount: this.#layerCount }
            );
        }
    }

    #assertLocal(localX: number, localY: number): void {
        if (
            !Number.isInteger(localX) ||
            !Number.isInteger(localY) ||
            localX < 0 ||
            localY < 0 ||
            localX >= this.#chunkSize ||
            localY >= this.#chunkSize
        ) {
            throw new TilemapFault(
                `local coordinate (${localX}, ${localY}) is outside the ${this.#chunkSize}x${this.#chunkSize} chunk`,
                TilemapErrorCode.INVALID_COORDINATE,
                { localX, localY, chunkSize: this.#chunkSize }
            );
        }
    }

    #closedError(): TilemapError {
        return tilemapError(
            TilemapErrorCode.ENGINE_CLOSED,
            'chunk store is closed'
        );
    }
}
