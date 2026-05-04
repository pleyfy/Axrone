import type { IDisposable, ReadonlyMap } from '@axrone/utility';
import { CameraValidationError } from './camera-culling-errors';
import {
    assertBoundingVolume,
    assertPositiveFiniteNumber,
    DEFAULT_CAMERA_LOCALE,
} from './camera-culling-internal';
import type {
    BoundingVolume,
    CameraLocale,
    CullingStats,
    FrustumClassification,
    FrustumCullerAsyncOptions,
    FrustumCullerOptions,
    OverflowStrategy,
} from './camera-culling-types';
import type { CameraFrustum } from './frustum';

interface MutableCullingStats extends CullingStats {
    totalCount: number;
    visibleCount: number;
    outsideCount: number;
    insideCount: number;
    intersectCount: number;
    skippedCount: number;
    overflowed: boolean;
    sphereCount: number;
    aabbCount: number;
    visibleSphereCount: number;
    visibleAabbCount: number;
}

const createStats = (): MutableCullingStats => ({
    totalCount: 0,
    visibleCount: 0,
    outsideCount: 0,
    insideCount: 0,
    intersectCount: 0,
    skippedCount: 0,
    overflowed: false,
    sphereCount: 0,
    aabbCount: 0,
    visibleSphereCount: 0,
    visibleAabbCount: 0,
});

const resetStats = (stats: MutableCullingStats): void => {
    stats.totalCount = 0;
    stats.visibleCount = 0;
    stats.outsideCount = 0;
    stats.insideCount = 0;
    stats.intersectCount = 0;
    stats.skippedCount = 0;
    stats.overflowed = false;
    stats.sphereCount = 0;
    stats.aabbCount = 0;
    stats.visibleSphereCount = 0;
    stats.visibleAabbCount = 0;
};

const nextMicrotask = (): Promise<void> =>
    new Promise<void>((resolve) => {
        queueMicrotask(resolve);
    });

export class FrustumCuller<TItem, TBounds extends BoundingVolume = BoundingVolume>
    implements IDisposable
{
    private readonly _visible: TItem[] = [];
    private readonly _stats: MutableCullingStats = createStats();
    private readonly _classifications?: Map<TItem, FrustumClassification>;
    private readonly _locale: CameraLocale;
    private readonly _maxResults: number;
    private readonly _overflow: OverflowStrategy;
    private readonly _asyncBatchSize: number;
    private _isDisposed = false;

    constructor(private readonly _options: Readonly<FrustumCullerOptions<TItem, TBounds>>) {
        this._locale = _options.locale ?? DEFAULT_CAMERA_LOCALE;
        this._maxResults = Math.max(0, _options.maxResults ?? Number.POSITIVE_INFINITY);
        this._overflow = _options.overflow ?? 'trim';
        this._asyncBatchSize = Math.max(1, _options.asyncBatchSize ?? 1024);
        if (Number.isFinite(this._maxResults)) {
            assertPositiveFiniteNumber(
                this._maxResults,
                this._locale,
                'maxResults',
                'INVALID_ARGUMENT'
            );
        }
        if (_options.trackClassifications === true) {
            this._classifications = new Map<TItem, FrustumClassification>();
        }
    }

    get isDisposed(): boolean {
        return this._isDisposed;
    }

    get visible(): readonly TItem[] {
        return this._visible;
    }

    get stats(): Readonly<CullingStats> {
        return this._stats;
    }

    get classifications(): ReadonlyMap<TItem, FrustumClassification> | undefined {
        return this._classifications;
    }

    reset(): this {
        this.assertActive();
        this._visible.length = 0;
        this._classifications?.clear();
        resetStats(this._stats);
        return this;
    }

    cull(items: Iterable<TItem>, frustum: Readonly<CameraFrustum>): this {
        this.assertActive();
        this.reset();
        for (const item of items) {
            this.processItem(item, frustum);
        }
        if (this._options.sort && this._visible.length > 1) {
            this._visible.sort(this._options.sort);
        }
        return this;
    }

    async cullAsync(items: Iterable<TItem>, frustum: Readonly<CameraFrustum>, options: Readonly<FrustumCullerAsyncOptions> = {}): Promise<this> {
        this.assertActive();
        this.reset();

        const batchSize = Math.max(1, options.batchSize ?? this._asyncBatchSize);
        let processed = 0;

        for (const item of items) {
            if (options.signal?.aborted === true) {
                throw new CameraValidationError('OPERATION_ABORTED', this._locale);
            }
            this.processItem(item, frustum);
            processed += 1;

            if (processed % batchSize === 0) {
                const scheduler = options.scheduler;
                if (scheduler) {
                    await scheduler();
                } else {
                    await nextMicrotask();
                }
            }
        }

        if (this._options.sort && this._visible.length > 1) {
            this._visible.sort(this._options.sort);
        }
        return this;
    }

    dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._visible.length = 0;
        this._classifications?.clear();
        resetStats(this._stats);
        this._isDisposed = true;
    }

    private processItem(item: TItem, frustum: Readonly<CameraFrustum>): void {
        if (this._options.filter && this._options.filter(item) === false) {
            this._stats.skippedCount += 1;
            return;
        }

        const bounds = this._options.bounds(item);
        if (!bounds) {
            this._stats.skippedCount += 1;
            return;
        }

        assertBoundingVolume(bounds, this._locale);
        this._stats.totalCount += 1;
        if (bounds.kind === 'sphere') {
            this._stats.sphereCount += 1;
        } else {
            this._stats.aabbCount += 1;
        }

        const classification = frustum.classify(bounds);
        this._classifications?.set(item, classification);

        if (classification === 'outside') {
            this._stats.outsideCount += 1;
            return;
        }

        if (classification === 'inside') {
            this._stats.insideCount += 1;
        } else {
            this._stats.intersectCount += 1;
        }

        if (this._visible.length >= this._maxResults) {
            this._stats.overflowed = true;
            if (this._overflow === 'throw') {
                throw new CameraValidationError('RESULT_OVERFLOW', this._locale, {
                    maxResults: this._maxResults,
                });
            }
            return;
        }

        this._visible.push(item);
        this._stats.visibleCount += 1;
        if (bounds.kind === 'sphere') {
            this._stats.visibleSphereCount += 1;
        } else {
            this._stats.visibleAabbCount += 1;
        }
    }

    private assertActive(): void {
        if (this._isDisposed) {
            throw new CameraValidationError('CULLER_DISPOSED', this._locale);
        }
    }
}