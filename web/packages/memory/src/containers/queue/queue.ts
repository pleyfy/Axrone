import { EmptyQueueError, InvalidCapacityError } from './errors';
import { Capacity, QueueSize } from './types';
import { createCapacity, createQueueSize } from './utils';

export interface QueueOptions {
    readonly initialCapacity?: Capacity;
    readonly autoTrim?: boolean;
    readonly growthFactor?: number;
    readonly shrinkThreshold?: number;
}

const DEFAULT_INITIAL_CAPACITY = 16;
const DEFAULT_GROWTH_FACTOR = 2;
const DEFAULT_SHRINK_THRESHOLD = 0.25;

function normalizeInitialCapacity(value?: Capacity): number {
    const resolved = value === undefined ? DEFAULT_INITIAL_CAPACITY : (value as number);

    if (!Number.isInteger(resolved) || resolved <= 0) {
        throw new InvalidCapacityError(resolved);
    }

    return resolved;
}

function normalizeGrowthFactor(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) {
        return DEFAULT_GROWTH_FACTOR;
    }

    return value;
}

function normalizeShrinkThreshold(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
        return DEFAULT_SHRINK_THRESHOLD;
    }

    return value;
}

export class Queue<T> implements Iterable<T> {
    private storage: Array<T | undefined>;
    private readonly autoTrimEnabled: boolean;
    private readonly growthFactor: number;
    private readonly shrinkThreshold: number;
    private readonly minimumCapacity: number;

    private _head = 0;
    private _size = 0;
    private _capacity: number;

    constructor(options: QueueOptions = {}) {
        this.minimumCapacity = normalizeInitialCapacity(options.initialCapacity);
        this.autoTrimEnabled = options.autoTrim ?? false;
        this.growthFactor = normalizeGrowthFactor(options.growthFactor);
        this.shrinkThreshold = normalizeShrinkThreshold(options.shrinkThreshold);
        this._capacity = this.minimumCapacity;
        this.storage = new Array<T | undefined>(this._capacity);
    }

    get size(): QueueSize {
        return createQueueSize(this._size);
    }

    get isEmpty(): boolean {
        return this._size === 0;
    }

    get capacity(): Capacity {
        return createCapacity(this._capacity);
    }

    enqueue(value: T): void {
        this.ensureInternalCapacity(this._size + 1);
        this.storage[(this._head + this._size) % this._capacity] = value;
        this._size += 1;
    }

    enqueueRange(values: ReadonlyArray<T> | Iterable<T>): void {
        if (Array.isArray(values)) {
            if (values.length === 0) {
                return;
            }

            this.ensureInternalCapacity(this._size + values.length);

            for (let index = 0; index < values.length; index++) {
                this.storage[(this._head + this._size) % this._capacity] = values[index];
                this._size += 1;
            }

            return;
        }

        for (const value of values) {
            this.enqueue(value);
        }
    }

    dequeue(): T {
        const value = this.tryDequeue();

        if (value === undefined) {
            throw new EmptyQueueError();
        }

        return value;
    }

    tryDequeue(): T | undefined {
        if (this._size === 0) {
            return undefined;
        }

        const index = this._head;
        const value = this.storage[index];
        this.storage[index] = undefined;
        this._size -= 1;

        if (this._size === 0) {
            this._head = 0;
        } else {
            this._head = (index + 1) % this._capacity;
        }

        if (this.autoTrimEnabled) {
            this.trimIfNeeded();
        }

        return value;
    }

    peek(): T {
        const value = this.tryPeek();

        if (value === undefined) {
            throw new EmptyQueueError();
        }

        return value;
    }

    tryPeek(): T | undefined {
        return this._size === 0 ? undefined : this.storage[this._head];
    }

    contains(value: T): boolean {
        for (let index = 0; index < this._size; index++) {
            if (this.storage[(this._head + index) % this._capacity] === value) {
                return true;
            }
        }

        return false;
    }

    clear(): void {
        if (this._size === 0) {
            return;
        }

        for (let index = 0; index < this._size; index++) {
            this.storage[(this._head + index) % this._capacity] = undefined;
        }

        this._head = 0;
        this._size = 0;

        if (this.autoTrimEnabled && this._capacity !== this.minimumCapacity) {
            this.resize(this.minimumCapacity);
        }
    }

    ensureCapacity(capacity: Capacity): void {
        const required = capacity as number;

        if (!Number.isInteger(required) || required <= 0) {
            throw new InvalidCapacityError(required);
        }

        this.ensureInternalCapacity(required);
    }

    trimExcess(): void {
        const targetCapacity = Math.max(this.minimumCapacity, this._size || 1);
        if (targetCapacity < this._capacity) {
            this.resize(targetCapacity);
        }
    }

    toArray(): ReadonlyArray<T> {
        const result = new Array<T>(this._size);

        for (let index = 0; index < this._size; index++) {
            result[index] = this.storage[(this._head + index) % this._capacity]!;
        }

        return Object.freeze(result);
    }

    clone(): Queue<T> {
        const clone = new Queue<T>({
            initialCapacity: createCapacity(Math.max(this.minimumCapacity, this._size || 1)),
            autoTrim: this.autoTrimEnabled,
            growthFactor: this.growthFactor,
            shrinkThreshold: this.shrinkThreshold,
        });

        clone.enqueueRange(this);
        return clone;
    }

    *[Symbol.iterator](): Iterator<T> {
        for (let index = 0; index < this._size; index++) {
            yield this.storage[(this._head + index) % this._capacity]!;
        }
    }

    private ensureInternalCapacity(requiredCapacity: number): void {
        if (requiredCapacity <= this._capacity) {
            return;
        }

        let nextCapacity = this._capacity;

        while (nextCapacity < requiredCapacity) {
            nextCapacity = Math.max(nextCapacity + 1, Math.ceil(nextCapacity * this.growthFactor));
        }

        this.resize(nextCapacity);
    }

    private trimIfNeeded(): void {
        if (this._capacity <= this.minimumCapacity || this._size === 0) {
            if (this._size === 0 && this._capacity > this.minimumCapacity) {
                this.resize(this.minimumCapacity);
            }

            return;
        }

        if (this._size > Math.floor(this._capacity * this.shrinkThreshold)) {
            return;
        }

        const targetCapacity = Math.max(this.minimumCapacity, Math.max(this._size << 1, 1));
        if (targetCapacity < this._capacity) {
            this.resize(targetCapacity);
        }
    }

    private resize(nextCapacity: number): void {
        if (!Number.isInteger(nextCapacity) || nextCapacity <= 0) {
            throw new InvalidCapacityError(nextCapacity);
        }

        const nextStorage = new Array<T | undefined>(nextCapacity);

        for (let index = 0; index < this._size; index++) {
            nextStorage[index] = this.storage[(this._head + index) % this._capacity];
        }

        this.storage = nextStorage;
        this._capacity = nextCapacity;
        this._head = 0;
    }
}