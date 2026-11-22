import {
    MemoryPoolError,
    MemoryPoolErrorCode,
    POOL_OPTION_DEFAULTS,
    validateMemoryPoolOptions,
    type AsyncMemoryPoolOperations,
    type MemoryPoolOperations,
    type MemoryPoolOptions,
    type PoolableObject,
    type PoolPerformanceMetrics,
    type PoolSlot,
    type ResolvedMemoryPoolOptions,
} from './pool-support';
import { LruSlotIndex } from './internal/lru-slot-index';
import { PoolMetricsCollector } from './internal/pool-metrics';
import { WaitQueue } from './internal/wait-queue';
import { AllocationSelector } from './internal/allocation-selector';
import { FragmentationAnalyzer } from './internal/fragmentation';
import { createEvictionStrategy, type IEvictionStrategy } from './internal/eviction-strategy';
import { CapacityPlanner } from './internal/capacity-planner';
import { SlotFactory } from './internal/slot-factory';

export {
    MemoryPoolError,
    MemoryPoolErrorCode,
    type AsyncMemoryPoolOperations,
    type MemoryPoolOperations,
    type MemoryPoolOptions,
    type PoolAllocationStrategy,
    type PoolEvictionPolicy,
    type PoolExpansionStrategy,
    type PoolObjectStatus,
    type PoolPerformanceMetrics,
    type PoolableObject,
} from './pool-support';

const MAX_POOL_ID = 2 ** 31 - 1;

/**
 * High-performance, slot-based object pool with configurable allocation, eviction, and expansion.
 *
 * Objects are managed through a flat slot array with a free-list for O(1) acquire/release.
 * Supports multiple allocation strategies (first-available, LRU, MRU, round-robin), eviction
 * policies (none, LRU, TTL, FIFO), and expansion strategies (fixed, multiplicative, fibonacci, prime).
 * Objects must implement {@link PoolableObject} to receive pool lifecycle metadata (__poolId, __poolStatus).
 *
 * Key features:
 * - Auto-expansion with configurable max capacity and watermark-based contraction.
 * - Async acquire/release with wait-queue for backpressure handling.
 * - Optional metrics collection for monitoring hit ratios, allocation times, and fragmentation.
 * - Supports both sync and async object factories.
 *
 * @example
 * const pool = new MemoryPool({
 *   factory: () => new MyObject(),
 *   maxCapacity: 1024,
 *   evictionPolicy: 'lru',
 *   resetOnRecycle: true,
 * });
 * const obj = pool.acquire();
 * // ... use obj ...
 * pool.release(obj);
 * pool[Symbol.dispose]();
 *
 * @stable
 */
export class MemoryPool<T extends PoolableObject>
    implements MemoryPoolOperations<T>, AsyncMemoryPoolOperations<T>, Iterable<T>
{
    static #poolIdCounter = 0;

    readonly #id: number;
    readonly #slots: PoolSlot<T>[] = [];
    readonly #freeList: Set<number> = new Set();
    readonly #options: ResolvedMemoryPoolOptions<T>;

    #isDisposed = false;
    #lruIndex: LruSlotIndex | null = null;
    #metrics: PoolMetricsCollector;
    #allocator: AllocationSelector;
    #evictionStrategy: IEvictionStrategy;
    #planner: CapacityPlanner;
    #slotFactory: SlotFactory<T>;
    #waitQueue = new WaitQueue<T>();
    /** Contraction analysis is O(slots); amortize it over a batch of releases. */
    #releasesSinceContractionCheck = 0;

    constructor(options: MemoryPoolOptions<T>) {
        this.#id = ++MemoryPool.#poolIdCounter & MAX_POOL_ID;

        const resolved: ResolvedMemoryPoolOptions<T> = {
            initialCapacity: options.initialCapacity ?? POOL_OPTION_DEFAULTS.initialCapacity,
            maxCapacity: options.maxCapacity ?? POOL_OPTION_DEFAULTS.maxCapacity,
            minFree: options.minFree ?? POOL_OPTION_DEFAULTS.minFree,
            highWatermarkRatio:
                options.highWatermarkRatio ?? POOL_OPTION_DEFAULTS.highWatermarkRatio,
            lowWatermarkRatio: options.lowWatermarkRatio ?? POOL_OPTION_DEFAULTS.lowWatermarkRatio,
            expansionStrategy:
                options.expansionStrategy ?? POOL_OPTION_DEFAULTS.expansionStrategy,
            expansionFactor: options.expansionFactor ?? POOL_OPTION_DEFAULTS.expansionFactor,
            expansionRate: options.expansionRate ?? POOL_OPTION_DEFAULTS.expansionRate,
            allocationStrategy:
                options.allocationStrategy ?? POOL_OPTION_DEFAULTS.allocationStrategy,
            evictionPolicy: options.evictionPolicy ?? POOL_OPTION_DEFAULTS.evictionPolicy,
            ttl: options.ttl ?? POOL_OPTION_DEFAULTS.ttl,
            factory: options.factory,
            resetOnRecycle: options.resetOnRecycle ?? POOL_OPTION_DEFAULTS.resetOnRecycle,
            validator: options.validator ?? (() => true),
            preallocate: options.preallocate ?? POOL_OPTION_DEFAULTS.preallocate,
            autoExpand: options.autoExpand ?? POOL_OPTION_DEFAULTS.autoExpand,
            compactionThreshold:
                options.compactionThreshold ?? POOL_OPTION_DEFAULTS.compactionThreshold,
            compactionTriggerRatio:
                options.compactionTriggerRatio ?? POOL_OPTION_DEFAULTS.compactionTriggerRatio,
            onAcquire: options.onAcquire ?? (() => undefined),
            onRelease: options.onRelease ?? (() => undefined),
            onEvict: options.onEvict ?? (() => undefined),
            onOutOfMemory: options.onOutOfMemory ?? (() => undefined),
            enableMetrics: options.enableMetrics ?? POOL_OPTION_DEFAULTS.enableMetrics,
            enableInstrumentation:
                options.enableInstrumentation ?? POOL_OPTION_DEFAULTS.enableInstrumentation,
            name: options.name ?? `MemoryPool-${this.#id}`,
            asyncFactory: options.asyncFactory,
            estimatedObjectSize: options.estimatedObjectSize,
        };
        validateMemoryPoolOptions(resolved);
        this.#options = resolved;

        this.#metrics = new PoolMetricsCollector(
            this.#options.name,
            this.#options.enableMetrics
        );
        this.#slotFactory = new SlotFactory(this.#options.factory, this.#metrics);

        this.#initializeLruIndex();

        this.#allocator = new AllocationSelector(
            this.#slots as unknown as PoolSlot<PoolableObject>[],
            this.#freeList,
            this.#lruIndex
        );
        this.#evictionStrategy = createEvictionStrategy(
            this.#options.evictionPolicy,
            this.#options.ttl
        );
        this.#planner = new CapacityPlanner(this.#options.name, this.#lruIndex);

        this.#initializeCapacity();
    }

    #initializeLruIndex(): void {
        const strat = this.#options.allocationStrategy;
        if (strat === 'least-recently-used' || strat === 'most-recently-used') {
            this.#lruIndex = new LruSlotIndex(
                this.#options.maxCapacity,
                strat === 'most-recently-used' ? 'most-recently-used' : 'least-recently-used'
            );
        }
    }

    #initializeCapacity(): void {
        if (this.#options.preallocate) {
            this.#preallocate();
        } else {
            this.#reserve(this.#options.initialCapacity);
        }

        if (this.#options.asyncFactory !== undefined && this.#options.preallocate) {
            void this.#preloadAsync();
        }
    }

    #preallocate(): void {
        this.#slotFactory.preallocate(
            this.#slots,
            this.#freeList,
            this.#options.initialCapacity
        );
        if (this.#lruIndex) this.#lruIndex.rebuild(this.#slots);
    }

    #reserve(capacity: number): void {
        this.#slotFactory.reserve(this.#slots, this.#freeList, capacity);
    }

    #getNextFreeId(): number {
        return this.#allocator.pickNextFreeId(this.#options.allocationStrategy);
    }

    #updateLruIndex(slotId: number): void {
        if (!this.#lruIndex) return;
        const slot = this.#slots[slotId];
        if (!slot || slot.status !== 'free') {
            this.#lruIndex.remove(slotId);
            return;
        }
        this.#lruIndex.upsert(slotId, slot.lastAccessed);
    }

    public acquire(): T {
        if (this.#isDisposed) {
            throw new MemoryPoolError(
                'Cannot acquire from disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            );
        }

        const timer = this.#metrics.newTimer();

        try {
            if (this.#freeList.size === 0) {
                this.#metrics.recordAllocation(false, false);

                let replenished = false;
                if (
                    this.#options.autoExpand &&
                    this.#slots.length < this.#options.maxCapacity
                ) {
                    this.#expand();
                    replenished = this.#freeList.size > 0;
                }
                if (!replenished && this.#options.evictionPolicy !== 'none') {
                    replenished = this.#tryEvictObject();
                }
                if (!replenished) {
                    this.#options.onOutOfMemory(1, 0);
                    const msg =
                        this.#options.evictionPolicy === 'none'
                            ? 'Pool depleted'
                            : 'Pool depleted and no objects can be evicted';
                    throw new MemoryPoolError(
                        msg,
                        MemoryPoolErrorCode.POOL_DEPLETED,
                        this.#options.name,
                        { requested: 1, available: 0 }
                    );
                }
            }

            const id = this.#getNextFreeId();
            if (id === -1) {
                throw new MemoryPoolError(
                    'Internal error: failed to get free slot',
                    MemoryPoolErrorCode.INTERNAL_ERROR,
                    this.#options.name
                );
            }

            this.#freeList.delete(id);
            const slot = this.#slots[id];
            slot.status = 'allocated';
            slot.lastAccessed = Date.now();
            slot.allocCount++;

            if (!slot.obj) {
                const createTimer = this.#metrics.newTimer();
                slot.obj = this.#options.factory();
                if (createTimer) this.#metrics.recordCreation(createTimer.stop());
                slot.createdAt = Date.now();
            }

            const obj = slot.obj!;
            obj.__poolId = id;
            obj.__poolStatus = 'allocated';
            obj.__lastAccessed = slot.lastAccessed;
            obj.__allocCount = slot.allocCount;

            if (!this.#options.validator(obj)) {
                this.#freeList.add(id);
                slot.status = 'free';
                this.#metrics.recordValidationFailure();
                throw new MemoryPoolError(
                    'Object failed validation',
                    MemoryPoolErrorCode.VALIDATION_FAILED,
                    this.#options.name
                );
            }

            const allocated = this.#slots.length - this.#freeList.size;
            this.#metrics.recordHighWaterMark(allocated);
            this.#metrics.recordAllocation(true, true);

            try {
                this.#options.onAcquire(obj);
            } catch (e) {
                this.release(obj);
                throw e;
            }

            return obj;
        } finally {
            if (timer) this.#metrics.recordAllocationTime(timer.stop());
        }
    }

    public release(obj: T): void {
        if (this.#isDisposed) return;

        const timer = this.#metrics.newTimer();
        this.#metrics.recordRelease();

        try {
            if (
                obj.__poolId === undefined ||
                obj.__poolId >= this.#slots.length ||
                this.#slots[obj.__poolId].obj !== obj
            ) {
                throw new MemoryPoolError(
                    'Object not from this pool',
                    MemoryPoolErrorCode.FOREIGN_OBJECT,
                    this.#options.name
                );
            }

            const id = obj.__poolId;
            const slot = this.#slots[id];

            if (slot.status !== 'allocated') {
                throw new MemoryPoolError(
                    'Object already released',
                    MemoryPoolErrorCode.ALREADY_RELEASED,
                    this.#options.name
                );
            }

            if (this.#metrics.isEnabled) {
                this.#metrics.recordLifetime(Date.now() - slot.lastAccessed);
            }

            try {
                this.#options.onRelease(obj);
            } catch (e) {
                if (this.#options.enableInstrumentation) {
                    console.debug(`Error in onRelease handler for pool "${this.#options.name}":`, e);
                }
            }

            if (this.#options.resetOnRecycle) {
                try {
                    obj.reset();
                } catch (e) {
                    if (this.#options.enableInstrumentation) {
                        console.debug(
                            `Error in reset method for object in pool "${this.#options.name}":`,
                            e
                        );
                    }
                }
            }

            slot.status = 'free';
            obj.__poolStatus = 'free';
            slot.lastAccessed = Date.now();

            const waiter = this.#waitQueue.pop();
            if (waiter) {
                slot.status = 'allocated';
                obj.__poolStatus = 'allocated';
                slot.lastAccessed = Date.now();
                slot.allocCount++;
                queueMicrotask(() => {
                    try {
                        waiter.resolve(obj);
                    } catch (e) {
                        if (this.#options.enableInstrumentation) {
                            console.debug(
                                `Error notifying async waiter in pool "${this.#options.name}":`,
                                e
                            );
                        }
                    }
                });
                return;
            }

            this.#freeList.add(id);
            this.#updateLruIndex(id);
            // `#checkForContraction` scans every slot; running it per release
            // makes mass release quadratic. Once per 64 releases keeps the
            // shrink/compact behaviour without the hot-loop cost.
            this.#releasesSinceContractionCheck++;
            if ((this.#releasesSinceContractionCheck & 63) === 0) {
                this.#checkForContraction();
            }
        } finally {
            if (timer) this.#metrics.recordReleaseTime(timer.stop());
        }
    }

    public tryAcquire(): T | null {
        if (this.#isDisposed || this.#freeList.size === 0) return null;
        try {
            return this.acquire();
        } catch (e) {
            if (e instanceof MemoryPoolError && e.code === MemoryPoolErrorCode.POOL_DEPLETED) {
                return null;
            }
            throw e;
        }
    }

    public releaseAll(): void {
        if (this.#isDisposed) return;

        const toRelease: T[] = [];
        for (let i = 0; i < this.#slots.length; i++) {
            const slot = this.#slots[i];
            if (slot.status === 'allocated' && slot.obj) toRelease.push(slot.obj);
        }

        for (const obj of toRelease) {
            try {
                this.release(obj);
            } catch (e) {
                if (this.#options.enableInstrumentation) {
                    console.debug('Error releasing object during releaseAll:', e);
                }
            }
        }
    }

    public clear(): void {
        if (this.#isDisposed) {
            throw new MemoryPoolError(
                'Cannot clear disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            );
        }

        const allocatedCount = this.#slots.length - this.#freeList.size;
        if (allocatedCount > 0) {
            throw new MemoryPoolError(
                'Cannot clear pool with allocated objects',
                MemoryPoolErrorCode.IN_USE_DURING_OPERATION,
                this.#options.name,
                { allocatedCount }
            );
        }

        this.#slots.length = 0;
        this.#freeList.clear();
        if (this.#lruIndex) this.#lruIndex.clear();
        this.#initializeCapacity();
        this.#metrics.resetAggregate();
    }

    public drain(): void {
        if (this.#isDisposed) return;

        const allocatedSlots: PoolSlot<T>[] = [];
        const freeSlots: PoolSlot<T>[] = [];
        for (let i = 0; i < this.#slots.length; i++) {
            const slot = this.#slots[i];
            if (slot.status === 'allocated') allocatedSlots.push(slot);
            else if (slot.status === 'free' && slot.obj) freeSlots.push(slot);
        }

        const allocatedCount = allocatedSlots.length;
        const targetCapacity = Math.max(
            this.#options.initialCapacity,
            allocatedCount,
            this.#options.minFree + allocatedCount
        );

        freeSlots.sort((a, b) => b.lastAccessed - a.lastAccessed);
        const kept = freeSlots.slice(0, targetCapacity - allocatedCount);

        const newSlots: PoolSlot<T>[] = new Array(targetCapacity);
        const newFreeList = new Set<number>();
        let newId = 0;

        for (const slot of allocatedSlots) {
            const s: PoolSlot<T> = {
                obj: slot.obj,
                status: 'allocated',
                lastAccessed: slot.lastAccessed,
                allocCount: slot.allocCount,
                createdAt: slot.createdAt,
            };
            if (slot.obj) slot.obj.__poolId = newId;
            newSlots[newId] = s;
            newId++;
        }

        for (const slot of kept) {
            const s: PoolSlot<T> = {
                obj: slot.obj,
                status: 'free',
                lastAccessed: slot.lastAccessed,
                allocCount: slot.allocCount,
                createdAt: slot.createdAt,
            };
            if (slot.obj) slot.obj.__poolId = newId;
            newSlots[newId] = s;
            newFreeList.add(newId);
            newId++;
        }

        for (let i = newId; i < targetCapacity; i++) {
            newSlots[i] = {
                obj: undefined,
                status: 'free',
                lastAccessed: 0,
                allocCount: 0,
                createdAt: 0,
            };
            newFreeList.add(i);
        }

        if (this.#lruIndex) this.#lruIndex.clear();
        if (
            this.#options.allocationStrategy === 'least-recently-used' ||
            this.#options.allocationStrategy === 'most-recently-used' ||
            this.#options.evictionPolicy === 'lru'
        ) {
            this.#lruIndex?.rebuild(newSlots);
        }

        this.#slots.length = 0;
        for (const s of newSlots) this.#slots.push(s);
        this.#freeList.clear();
        for (const id of newFreeList) this.#freeList.add(id);
        this.#metrics.recordContraction();
    }

    public resize(newCapacity: number): void {
        if (this.#isDisposed) {
            throw new MemoryPoolError(
                'Cannot resize disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            );
        }

        const timer = this.#metrics.newTimer();
        try {
            const allocatedCount = this.#slots.length - this.#freeList.size;
            const clamped = Math.max(
                allocatedCount,
                Math.min(newCapacity, this.#options.maxCapacity)
            );
            if (clamped === this.#slots.length) return;
            if (clamped < this.#slots.length) this.#shrink(clamped);
            else this.#grow(clamped);
        } finally {
            if (timer) this.#metrics.recordResizeTime(timer.stop());
        }
    }

    public isFromPool(obj: T): boolean {
        if (!obj || obj.__poolId === undefined) return false;
        const id = obj.__poolId;
        return id >= 0 && id < this.#slots.length && this.#slots[id].obj === obj;
    }

    public forceCompact(): void {
        if (this.#isDisposed) {
            throw new MemoryPoolError(
                'Cannot compact disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            );
        }
        const timer = this.#metrics.newTimer();
        try {
            this.#planner.compact(this.#slots, this.#freeList);
        } finally {
            if (timer) this.#metrics.recordCompactionTime(timer.stop());
        }
    }

    public getAvailableCount(): number {
        return this.#freeList.size;
    }

    public getAllocatedCount(): number {
        return this.#slots.length - this.#freeList.size;
    }

    public getTotalCount(): number {
        return this.#slots.length;
    }

    public getMetrics(): PoolPerformanceMetrics {
        return this.#metrics.snapshot(
            this.#slots.length,
            this.#freeList.size,
            this.#getEstimatedMemoryUsage(),
            FragmentationAnalyzer.calculate(this.#slots)
        );
    }

    public [Symbol.dispose](): void {
        if (this.#isDisposed) return;
        this.#isDisposed = true;

        this.#waitQueue.rejectAll(
            new MemoryPoolError(
                'Pool was disposed while waiting for object',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            )
        );

        // Notify onEvict for all currently allocated objects before tearing down
        for (const slot of this.#slots) {
            if (slot && slot.status === 'allocated' && slot.obj) {
                try {
                    this.#options.onEvict(slot.obj);
                } catch (e) {
                    if (this.#options.enableInstrumentation) {
                        console.debug(`Error in onEvict handler during dispose:`, e);
                    }
                }
            }
        }

        this.#slots.length = 0;
        this.#freeList.clear();
        if (this.#lruIndex) this.#lruIndex.clear();
    }

    public async acquireAsync(): Promise<T> {
        const obj = this.tryAcquire();
        if (obj !== null) return obj;

        if (!this.#options.autoExpand || this.#slots.length >= this.#options.maxCapacity) {
            return new Promise<T>((resolve, reject) => {
                if (this.#isDisposed) {
                    return reject(
                        new MemoryPoolError(
                            'Cannot acquire from disposed pool',
                            MemoryPoolErrorCode.POOL_DISPOSED,
                            this.#options.name
                        )
                    );
                }
                this.#waitQueue.push(
                    (result) => {
                        if (result === null) {
                            reject(
                                new MemoryPoolError(
                                    'Pool was disposed while waiting for object',
                                    MemoryPoolErrorCode.POOL_DISPOSED,
                                    this.#options.name
                                )
                            );
                        } else {
                            resolve(result);
                        }
                    },
                    reject
                );
            });
        }

        if (this.#options.asyncFactory !== undefined) {
            await this.#expandAsync();
            return this.acquire();
        }
        return this.acquire();
    }

    public async releaseAsync(obj: T): Promise<void> {
        await Promise.resolve();
        this.release(obj);
    }

    public async tryAcquireAsync(timeoutMs: number = 0): Promise<T | null> {
        await Promise.resolve();
        const obj = this.tryAcquire();
        if (obj !== null) return obj;
        if (timeoutMs <= 0) return null;

        return new Promise<T | null>((resolve) => {
            if (this.#isDisposed) return resolve(null);

            const entry = this.#waitQueue.push(resolve, () => undefined);
            entry.timer = setTimeout(() => {
                this.#waitQueue.remove((e) => e === entry);
                resolve(null);
            }, timeoutMs);
        });
    }

    public async releaseAllAsync(): Promise<void> {
        await Promise.resolve();
        this.releaseAll();
    }

    public async clearAsync(): Promise<void> {
        await Promise.resolve();
        this.clear();
    }

    public async drainAsync(): Promise<void> {
        await Promise.resolve();
        this.drain();
    }

    public [Symbol.iterator](): Iterator<T> {
        if (this.#isDisposed) {
            throw new MemoryPoolError(
                'Cannot iterate over disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this.#options.name
            );
        }
        const allocated: T[] = [];
        for (let i = 0; i < this.#slots.length; i++) {
            const slot = this.#slots[i];
            if (slot.status === 'allocated' && slot.obj) allocated.push(slot.obj);
        }
        let index = 0;
        return {
            next(): IteratorResult<T, undefined> {
                if (index < allocated.length) {
                    return { value: allocated[index++], done: false };
                }
                return { value: undefined, done: true };
            },
        };
    }

    #expand(): void {
        const current = this.#slots.length;
        const expanded = this.#planner.computeExpandedCapacity(
            current,
            this.#options.expansionStrategy,
            this.#options.expansionFactor,
            this.#options.expansionRate
        );
        const newCapacity = Math.min(expanded, this.#options.maxCapacity);
        if (newCapacity <= current) return;

        this.#metrics.recordExpansion();
        this.#grow(newCapacity);
    }

    #grow(newCapacity: number): void {
        if (newCapacity <= this.#slots.length) return;
        this.#planner.grow(
            this.#slots,
            this.#freeList,
            newCapacity,
            this.#options.preallocate,
            (id, withObj) => this.#slotFactory.create(id, withObj)
        );
    }

    #shrink(newCapacity: number): void {
        this.#planner.shrink(this.#slots, this.#freeList, newCapacity);
        this.#metrics.recordContraction();
    }

    #checkForContraction(): void {
        const fragmentation = FragmentationAnalyzer.calculate(this.#slots);
        const decision = this.#planner.shouldContract(
            this.#slots,
            this.#freeList,
            {
                initialCapacity: this.#options.initialCapacity,
                compactionThreshold: this.#options.compactionThreshold,
                lowWatermarkRatio: this.#options.lowWatermarkRatio,
                minFree: this.#options.minFree,
                compactionTriggerRatio: this.#options.compactionTriggerRatio,
            },
            fragmentation
        );
        if (decision.shouldResize) this.resize(decision.targetCapacity);
        if (decision.shouldCompact) this.forceCompact();
    }

    #tryEvictObject(): boolean {
        if (this.#evictionStrategy.policy === 'none') return false;
        const allocatedCount = this.#slots.length - this.#freeList.size;
        if (allocatedCount === 0) return false;

        const evictId = this.#evictionStrategy.findEvictableSlot({
            slots: this.#slots,
            now: Date.now(),
        });
        if (evictId === null) return false;

        const slot = this.#slots[evictId];
        const obj = slot.obj;
        if (!obj) return false;

        try {
            this.#options.onEvict(obj);
        } catch (e) {
            if (this.#options.enableInstrumentation) {
                console.debug(`Error in onEvict handler for pool "${this.#options.name}":`, e);
            }
        }

        slot.status = 'free';
        obj.__poolStatus = 'free';
        this.#freeList.add(evictId);
        this.#metrics.recordEviction();
        return true;
    }

    #getEstimatedMemoryUsage(): number {
        let slotHasObjectCount = 0;
        for (const slot of this.#slots) {
            if (slot && slot.obj) slotHasObjectCount++;
        }
        return FragmentationAnalyzer.estimateMemoryUsageBytes({
            slotCount: this.#slots.length,
            freeListSize: this.#freeList.size,
            lruIndexSize: this.#lruIndex?.size ?? 0,
            waitQueueLength: this.#waitQueue.size,
            estimatedObjectSize: this.#options.estimatedObjectSize,
            slotHasObjectCount,
        });
    }

    async #expandAsync(): Promise<void> {
        if (this.#options.asyncFactory === undefined) {
            this.#expand();
            return;
        }

        const current = this.#slots.length;
        const expanded = this.#planner.computeExpandedCapacity(
            current,
            this.#options.expansionStrategy,
            this.#options.expansionFactor,
            this.#options.expansionRate
        );
        const newCapacity = Math.min(expanded, this.#options.maxCapacity);
        if (newCapacity <= current) return;

        this.#metrics.recordExpansion();
        this.#grow(newCapacity);

        const promises: Promise<void>[] = [];
        for (let i = current; i < newCapacity; i++) {
            promises.push(this.#createAsyncSlot(i));
        }
        await Promise.all(promises);
    }

    async #preloadAsync(): Promise<void> {
        if (this.#options.asyncFactory === undefined) return;
        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.#options.initialCapacity; i++) {
            promises.push(this.#createAsyncSlot(i));
        }
        await Promise.all(promises);
    }

    async #createAsyncSlot(id: number): Promise<void> {
        if (this.#options.asyncFactory === undefined) return;
        try {
            const obj = await this.#options.asyncFactory();
            if (this.#isDisposed) return;
            const slot = this.#slots[id];
            if (!slot) return;
            slot.obj = obj;
            slot.createdAt = Date.now();
            obj.__poolId = id;
            obj.__poolStatus = 'free';
            obj.__lastAccessed = Date.now();
            obj.__allocCount = 0;
        } catch (e) {
            if (this.#options.enableInstrumentation) {
                console.debug(
                    `Error creating async object for pool "${this.#options.name}":`,
                    e
                );
            }
        }
    }
}
