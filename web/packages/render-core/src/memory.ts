import type { ReadonlyRenderList } from './types';

export type SortDirection = 1 | -1;
export type SortOrder = readonly [SortDirection, SortDirection, SortDirection];

const DEFAULT_SORT_ORDER: SortOrder = [1, 1, 1] as const;

export class StringKeyCache {
    private readonly _hashes = new Map<string, number>();

    get(value: string): number {
        const cached = this._hashes.get(value);
        if (cached !== undefined) {
            return cached;
        }

        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
        }

        const resolved = hash >>> 0;
        this._hashes.set(value, resolved);
        return resolved;
    }

    clear(): void {
        this._hashes.clear();
    }
}

export class ReusableList<T> implements ReadonlyRenderList<T> {
    protected readonly _items: T[] = [];
    protected _length = 0;

    constructor(initialCapacity: number = 0) {
        if (initialCapacity > 0) {
            this._items.length = initialCapacity;
        }
    }

    get length(): number {
        return this._length;
    }

    at(index: number): T {
        if (index < 0 || index >= this._length) {
            throw new RangeError(`Index out of bounds: ${index}`);
        }

        return this._items[index] as T;
    }

    push(value: T): number {
        const index = this._length;
        this._items[index] = value;
        this._length = index + 1;
        return this._length;
    }

    reset(): void {
        this._length = 0;
    }

    clear(): void {
        this._items.length = 0;
        this._length = 0;
    }

    toArray(): readonly T[] {
        return this._items.slice(0, this._length);
    }

    [Symbol.iterator](): Iterator<T> {
        let index = 0;
        return {
            next: (): IteratorResult<T> => {
                if (index < this._length) {
                    return {
                        done: false,
                        value: this._items[index++] as T,
                    };
                }

                return {
                    done: true,
                    value: undefined as never,
                };
            },
        };
    }
}

export class MutableObjectArena<T extends object> {
    private readonly _items: T[] = [];
    private _count = 0;
    private readonly _factory: (index: number) => T;

    constructor(factory: (index: number) => T) {
        this._factory = factory;
    }

    get count(): number {
        return this._count;
    }

    acquire(): T {
        const index = this._count++;
        if (index >= this._items.length) {
            this._items.push(this._factory(index));
        }
        return this._items[index] as T;
    }

    reset(): void {
        this._count = 0;
    }

    values(): readonly T[] {
        return this._items.slice(0, this._count);
    }
}

export class SortableRenderList<T> implements ReadonlyRenderList<T> {
    private readonly _items: T[] = [];
    private _primary = new Float64Array(0);
    private _secondary = new Float64Array(0);
    private _tertiary = new Float64Array(0);
    private _length = 0;
    private _stackLeft = new Int32Array(64);
    private _stackRight = new Int32Array(64);

    constructor(initialCapacity: number = 32) {
        if (initialCapacity > 0) {
            this._ensureCapacity(initialCapacity);
        }
    }

    get length(): number {
        return this._length;
    }

    at(index: number): T {
        if (index < 0 || index >= this._length) {
            throw new RangeError(`Index out of bounds: ${index}`);
        }

        return this._items[index] as T;
    }

    push(value: T, primary: number, secondary: number = 0, tertiary: number = 0): number {
        this._ensureCapacity(this._length + 1);
        this._items[this._length] = value;
        this._primary[this._length] = primary;
        this._secondary[this._length] = secondary;
        this._tertiary[this._length] = tertiary;
        this._length += 1;
        return this._length;
    }

    reset(): void {
        this._length = 0;
    }

    clear(): void {
        this._items.length = 0;
        this._primary = new Float64Array(0);
        this._secondary = new Float64Array(0);
        this._tertiary = new Float64Array(0);
        this._stackLeft = new Int32Array(64);
        this._stackRight = new Int32Array(64);
        this._length = 0;
    }

    sort(order: SortOrder = DEFAULT_SORT_ORDER): void {
        if (this._length < 2) {
            return;
        }

        let top = 0;
        this._stackLeft[top] = 0;
        this._stackRight[top] = this._length - 1;

        while (top >= 0) {
            let left = this._stackLeft[top];
            let right = this._stackRight[top];
            top -= 1;

            while (right - left > 16) {
                const middle = left + ((right - left) >> 1);
                const pivotPrimary = this._primary[middle];
                const pivotSecondary = this._secondary[middle];
                const pivotTertiary = this._tertiary[middle];

                let i = left;
                let j = right;

                while (i <= j) {
                    while (
                        this._compareTriplet(
                            this._primary[i],
                            this._secondary[i],
                            this._tertiary[i],
                            pivotPrimary,
                            pivotSecondary,
                            pivotTertiary,
                            order
                        ) < 0
                    ) {
                        i += 1;
                    }

                    while (
                        this._compareTriplet(
                            this._primary[j],
                            this._secondary[j],
                            this._tertiary[j],
                            pivotPrimary,
                            pivotSecondary,
                            pivotTertiary,
                            order
                        ) > 0
                    ) {
                        j -= 1;
                    }

                    if (i <= j) {
                        this._swap(i, j);
                        i += 1;
                        j -= 1;
                    }
                }

                if (j - left > right - i) {
                    top += 1;
                    this._ensureStackCapacity(top + 1);
                    this._stackLeft[top] = left;
                    this._stackRight[top] = j;
                    left = i;
                } else {
                    top += 1;
                    this._ensureStackCapacity(top + 1);
                    this._stackLeft[top] = i;
                    this._stackRight[top] = right;
                    right = j;
                }
            }

            this._insertionSort(left, right, order);
        }
    }

    toArray(): readonly T[] {
        return this._items.slice(0, this._length);
    }

    [Symbol.iterator](): Iterator<T> {
        let index = 0;
        return {
            next: (): IteratorResult<T> => {
                if (index < this._length) {
                    return {
                        done: false,
                        value: this._items[index++] as T,
                    };
                }

                return {
                    done: true,
                    value: undefined as never,
                };
            },
        };
    }

    private _ensureCapacity(capacity: number): void {
        if (capacity <= this._primary.length) {
            return;
        }

        let next = this._primary.length > 0 ? this._primary.length : 32;
        while (next < capacity) {
            next <<= 1;
        }

        const primary = new Float64Array(next);
        const secondary = new Float64Array(next);
        const tertiary = new Float64Array(next);

        primary.set(this._primary);
        secondary.set(this._secondary);
        tertiary.set(this._tertiary);

        this._primary = primary;
        this._secondary = secondary;
        this._tertiary = tertiary;
        this._items.length = next;
    }

    private _ensureStackCapacity(size: number): void {
        if (size <= this._stackLeft.length) {
            return;
        }

        let next = this._stackLeft.length;
        while (next < size) {
            next <<= 1;
        }

        const left = new Int32Array(next);
        const right = new Int32Array(next);
        left.set(this._stackLeft);
        right.set(this._stackRight);
        this._stackLeft = left;
        this._stackRight = right;
    }

    private _swap(a: number, b: number): void {
        if (a === b) {
            return;
        }

        const item = this._items[a];
        this._items[a] = this._items[b] as T;
        this._items[b] = item as T;

        const primary = this._primary[a];
        this._primary[a] = this._primary[b];
        this._primary[b] = primary;

        const secondary = this._secondary[a];
        this._secondary[a] = this._secondary[b];
        this._secondary[b] = secondary;

        const tertiary = this._tertiary[a];
        this._tertiary[a] = this._tertiary[b];
        this._tertiary[b] = tertiary;
    }

    private _insertionSort(left: number, right: number, order: SortOrder): void {
        for (let i = left + 1; i <= right; i++) {
            let j = i;
            while (
                j > left &&
                this._compareIndices(j - 1, j, order) > 0
            ) {
                this._swap(j - 1, j);
                j -= 1;
            }
        }
    }

    private _compareIndices(a: number, b: number, order: SortOrder): number {
        return this._compareTriplet(
            this._primary[a],
            this._secondary[a],
            this._tertiary[a],
            this._primary[b],
            this._secondary[b],
            this._tertiary[b],
            order
        );
    }

    private _compareTriplet(
        primaryA: number,
        secondaryA: number,
        tertiaryA: number,
        primaryB: number,
        secondaryB: number,
        tertiaryB: number,
        order: SortOrder
    ): number {
        if (primaryA !== primaryB) {
            return primaryA < primaryB ? -order[0] : order[0];
        }

        if (secondaryA !== secondaryB) {
            return secondaryA < secondaryB ? -order[1] : order[1];
        }

        if (tertiaryA !== tertiaryB) {
            return tertiaryA < tertiaryB ? -order[2] : order[2];
        }

        return 0;
    }
}
