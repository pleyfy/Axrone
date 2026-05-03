import { EmptyQueueError, InvalidCapacityError } from './errors';
import {
    Capacity,
    Comparator,
    HeapIndex,
    QueueSize,
    BinaryHeapOperations,
} from './types';
import { createCapacity, createQueueSize, defaultComparator } from './utils';

export type { Comparator } from './types';

export type HeapOrder = 'min' | 'max';

export type CompareSign = -1 | 0 | 1;

export type Equality<T> = (left: T, right: T) => boolean;

export type HeapPrimitive = number | bigint | string | Date;

export type HeapSerialized<T> = Readonly<{
    readonly kind: 'BinaryHeap';
    readonly version: 1;
    readonly order: HeapOrder;
    readonly items: readonly T[];
}>;

export type HeapLike<T> = Iterable<T> | ArrayLike<T>;

export interface BinaryHeapOptions<T, O extends HeapOrder = HeapOrder> {
    readonly order?: O;
    readonly comparator?: Comparator<T>;
    readonly equality?: Equality<T>;
    readonly items?: HeapLike<T>;
}

export interface ReadonlyBinaryHeap<T, O extends HeapOrder = HeapOrder> extends Iterable<T> {
    readonly size: number;
    readonly order: O;
    readonly comparator: Comparator<T>;
    readonly [Symbol.toStringTag]: 'BinaryHeap';
    isEmpty(): boolean;
    peek(): T | undefined;
    toArray(): T[];
    toJSON(): HeapSerialized<T>;
    clone(): BinaryHeap<T, O>;
    values(): IterableIterator<T>;
}

export class HeapError extends Error {
    public override readonly name: string = 'HeapError';

    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class HeapComparatorError extends HeapError {
    public override readonly name: string = 'HeapComparatorError';

    constructor(message = 'A valid comparator function is required for this heap.') {
        super(message);
    }
}

export class HeapIndexError extends HeapError {
    public override readonly name: string = 'HeapIndexError';

    constructor(message = 'Heap index is out of range.') {
        super(message);
    }
}

export class HeapSerializationError extends HeapError {
    public override readonly name: string = 'HeapSerializationError';

    constructor(message = 'Invalid heap serialization payload.') {
        super(message);
    }
}

const enum InternalOrder {
    Min = 1,
    Max = -1,
}

const isFunction = (value: unknown): value is (...args: readonly unknown[]) => unknown =>
    typeof value === 'function';

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
    value !== null && typeof value === 'object';

export const defaultPrimitiveComparator = <T extends HeapPrimitive>(left: T, right: T): number => {
    if (left === right) return 0;

    if (typeof left === 'number' && typeof right === 'number') {
        if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;
        if (Number.isNaN(right)) return -1;
        return left < right ? -1 : 1;
    }

    const leftValue = left instanceof Date ? left.getTime() : left;
    const rightValue = right instanceof Date ? right.getTime() : right;

    return leftValue < rightValue ? -1 : 1;
};

const defaultEquality = <T>(left: T, right: T): boolean => Object.is(left, right);

const ensureComparator = <T>(comparator: unknown): Comparator<T> => {
    if (!isFunction(comparator)) {
        throw new HeapComparatorError();
    }

    return comparator as Comparator<T>;
};

const ensureEquality = <T>(equality: Equality<T> | undefined): Equality<T> =>
    equality ?? defaultEquality;

const normalizeOrder = (order: HeapOrder | undefined): HeapOrder => (order === 'max' ? 'max' : 'min');

const internalOrderOf = (order: HeapOrder): InternalOrder =>
    order === 'max' ? InternalOrder.Max : InternalOrder.Min;

const collectToArray = <T>(source: HeapLike<T> | undefined): T[] => {
    if (source === undefined) {
        return [];
    }

    if (Array.isArray(source)) {
        return source.slice();
    }

    const length = (source as ArrayLike<T>).length;

    if (typeof length === 'number') {
        const result = new Array<T>(length);

        for (let index = 0; index < length; index++) {
            result[index] = (source as ArrayLike<T>)[index]!;
        }

        return result;
    }

    const result: T[] = [];

    for (const value of source as Iterable<T>) {
        result.push(value);
    }

    return result;
};

const compareByOrder = <T>(
    order: InternalOrder,
    comparator: Comparator<T>,
    left: T,
    right: T
): boolean => comparator(left, right) * order < 0;

const ensureSerializable = <T>(value: unknown): HeapSerialized<T> => {
    if (!isObject(value)) {
        throw new HeapSerializationError();
    }

    if (value.kind !== 'BinaryHeap' || value.version !== 1) {
        throw new HeapSerializationError();
    }

    if (value.order !== 'min' && value.order !== 'max') {
        throw new HeapSerializationError();
    }

    if (!Array.isArray(value.items)) {
        throw new HeapSerializationError();
    }

    return value as HeapSerialized<T>;
};

const siftUpThreshold = (baseLength: number, incoming: number): number =>
    Math.ceil(baseLength / Math.log2(baseLength + incoming + 1));

export class BinaryHeap<T, O extends HeapOrder = 'min'> implements ReadonlyBinaryHeap<T, O> {
    readonly #store: T[];
    readonly #order: O;
    readonly #orderFactor: InternalOrder;
    readonly #comparator: Comparator<T>;
    readonly #equality: Equality<T>;

    static #restore<T, O extends HeapOrder>(
        store: T[],
        order: O,
        comparator: Comparator<T>,
        equality: Equality<T>
    ): BinaryHeap<T, O> {
        const heap = new BinaryHeap<T, O>({ order, comparator, equality });
        const length = store.length;

        heap.#store.length = length;

        for (let index = 0; index < length; index++) {
            heap.#store[index] = store[index]!;
        }

        return heap;
    }

    public static min<T extends HeapPrimitive>(items?: HeapLike<T>): BinaryHeap<T, 'min'>;
    public static min<T>(comparator: Comparator<T>, items?: HeapLike<T>): BinaryHeap<T, 'min'>;
    public static min<T>(arg1?: Comparator<T> | HeapLike<T>, arg2?: HeapLike<T>): BinaryHeap<T, 'min'> {
        if (isFunction(arg1)) {
            return new BinaryHeap<T, 'min'>({ order: 'min', comparator: arg1 as Comparator<T>, items: arg2 });
        }

        return new BinaryHeap<T, 'min'>({
            order: 'min',
            comparator: defaultPrimitiveComparator as unknown as Comparator<T>,
            items: arg1 as HeapLike<T> | undefined,
        });
    }

    public static max<T extends HeapPrimitive>(items?: HeapLike<T>): BinaryHeap<T, 'max'>;
    public static max<T>(comparator: Comparator<T>, items?: HeapLike<T>): BinaryHeap<T, 'max'>;
    public static max<T>(arg1?: Comparator<T> | HeapLike<T>, arg2?: HeapLike<T>): BinaryHeap<T, 'max'> {
        if (isFunction(arg1)) {
            return new BinaryHeap<T, 'max'>({ order: 'max', comparator: arg1 as Comparator<T>, items: arg2 });
        }

        return new BinaryHeap<T, 'max'>({
            order: 'max',
            comparator: defaultPrimitiveComparator as unknown as Comparator<T>,
            items: arg1 as HeapLike<T> | undefined,
        });
    }

    public static from<T extends HeapPrimitive, O extends HeapOrder = 'min'>(
        items: HeapLike<T>,
        options?: Omit<BinaryHeapOptions<T, O>, 'items' | 'comparator'>
    ): BinaryHeap<T, O>;
    public static from<T, O extends HeapOrder = 'min'>(
        items: HeapLike<T>,
        options: Omit<BinaryHeapOptions<T, O>, 'items'> & Required<Pick<BinaryHeapOptions<T, O>, 'comparator'>>
    ): BinaryHeap<T, O>;
    public static from<T, O extends HeapOrder = 'min'>(
        items: HeapLike<T>,
        options?: BinaryHeapOptions<T, O>
    ): BinaryHeap<T, O> {
        const order = normalizeOrder(options?.order) as O;
        const comparator = options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<T>);

        return new BinaryHeap<T, O>({ order, comparator, equality: options?.equality, items });
    }

    public static deserialize<T extends HeapPrimitive, O extends HeapOrder = 'min'>(
        payload: unknown,
        options?: Omit<BinaryHeapOptions<T, O>, 'items' | 'order' | 'comparator'>
    ): BinaryHeap<T, O>;
    public static deserialize<T, O extends HeapOrder = 'min'>(
        payload: unknown,
        options: Omit<BinaryHeapOptions<T, O>, 'items' | 'order'> & Required<Pick<BinaryHeapOptions<T, O>, 'comparator'>>
    ): BinaryHeap<T, O>;
    public static deserialize<T, O extends HeapOrder = 'min'>(
        payload: unknown,
        options?: BinaryHeapOptions<T, O>
    ): BinaryHeap<T, O> {
        const serialized = ensureSerializable<T>(payload);

        const comparator = options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<T>);

        return new BinaryHeap<T, O>({
            order: serialized.order as O,
            comparator,
            equality: options?.equality,
            items: serialized.items,
        });
    }

    public static isHeap(value: unknown): value is ReadonlyBinaryHeap<unknown, HeapOrder> {
        return (
            isObject(value) &&
            value[Symbol.toStringTag] === 'BinaryHeap' &&
            isFunction((value as { peek?: unknown }).peek)
        );
    }

    constructor(options?: BinaryHeapOptions<T, O>) {
        const order = normalizeOrder(options?.order) as O;

        this.#order = order;
        this.#orderFactor = internalOrderOf(order);
        this.#comparator = ensureComparator<T>(
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<T>)
        );
        this.#equality = ensureEquality(options?.equality);
        this.#store = collectToArray(options?.items);

        if (this.#store.length > 1) {
            this.#heapify();
        }
    }

    public get [Symbol.toStringTag](): 'BinaryHeap' {
        return 'BinaryHeap';
    }

    public get size(): number {
        return this.#store.length;
    }

    public get order(): O {
        return this.#order;
    }

    public get comparator(): Comparator<T> {
        return this.#comparator;
    }

    public isEmpty(): boolean {
        return this.#store.length === 0;
    }

    public clear(): this {
        this.#store.length = 0;
        return this;
    }

    public clone(): BinaryHeap<T, O> {
        return BinaryHeap.#restore(this.#store, this.#order, this.#comparator, this.#equality);
    }

    public peek(): T | undefined {
        return this.#store[0];
    }

    public at(index: number): T | undefined {
        return index >= 0 && index < this.#store.length ? this.#store[index] : undefined;
    }

    public push(value: T): this {
        const store = this.#store;
        store.push(value);

        const index = store.length - 1;

        if (index > 0) {
            this.#siftUp(index);
        }

        return this;
    }

    public enqueue(value: T): this {
        return this.push(value);
    }

    public add(value: T): this {
        return this.push(value);
    }

    public pushAll(values: HeapLike<T>): this {
        const store = this.#store;

        let source: T[];

        if (!Array.isArray(values)) {
            const length = (values as ArrayLike<T>).length;

            if (typeof length === 'number') {
                source = new Array<T>(length);

                for (let index = 0; index < length; index++) {
                    source[index] = (values as ArrayLike<T>)[index]!;
                }
            } else {
                source = [];

                for (const value of values as Iterable<T>) {
                    source.push(value);
                }
            }
        } else {
            source = values;
        }

        const incoming = source.length;

        if (incoming === 0) {
            return this;
        }

        const baseLength = store.length;

        if (baseLength === 0) {
            store.length = incoming;

            for (let index = 0; index < incoming; index++) {
                store[index] = source[index]!;
            }

            if (incoming > 1) {
                this.#heapify();
            }

            return this;
        }

        const threshold = siftUpThreshold(baseLength, incoming);

        if (incoming <= threshold) {
            for (let index = 0; index < incoming; index++) {
                store.push(source[index]!);
                this.#siftUp(store.length - 1);
            }
        } else {
            const newLength = baseLength + incoming;
            store.length = newLength;

            for (let index = 0; index < incoming; index++) {
                store[baseLength + index] = source[index]!;
            }

            this.#heapify();
        }

        return this;
    }

    public merge(other: ReadonlyBinaryHeap<T> | HeapLike<T>): this {
        if (other instanceof BinaryHeap) {
            return this.pushAll(other.#store);
        }

        return this.pushAll(other);
    }

    public pop(): T | undefined {
        const store = this.#store;
        const length = store.length;

        if (length === 0) {
            return undefined;
        }

        if (length === 1) {
            return store.pop();
        }

        const root = store[0]!;
        store[0] = store.pop()!;
        this.#siftDown(0);

        return root;
    }

    public dequeue(): T | undefined {
        return this.pop();
    }

    public poll(): T | undefined {
        return this.pop();
    }

    public replaceTop(value: T): T | undefined {
        const store = this.#store;

        if (store.length === 0) {
            store.push(value);
            return undefined;
        }

        const root = store[0]!;
        store[0] = value;
        this.#siftDown(0);

        return root;
    }

    public pushPop(value: T): T {
        const store = this.#store;

        if (store.length === 0) {
            return value;
        }

        const root = store[0]!;

        if (this.#comesBefore(root, value)) {
            store[0] = value;
            this.#siftDown(0);
            return root;
        }

        return value;
    }

    public popPush(value: T): T | undefined {
        return this.replaceTop(value);
    }

    public delete(value: T): boolean {
        const index = this.indexOf(value);

        if (index < 0) {
            return false;
        }

        this.removeAt(index);
        return true;
    }

    public contains(value: T): boolean {
        return this.indexOf(value) >= 0;
    }

    public indexOf(value: T): number {
        const store = this.#store;
        const size = store.length;

        if (size === 0) {
            return -1;
        }

        if (this.#comesBefore(value, store[0]!)) {
            return -1;
        }

        const equality = this.#equality;

        for (let index = 0; index < size; index++) {
            if (equality(store[index]!, value)) {
                return index;
            }
        }

        return -1;
    }

    public updateAt(index: number, value: T): this {
        this.#assertIndex(index);

        const store = this.#store;
        const previous = store[index]!;
        store[index] = value;

        if (this.#comesBefore(value, previous)) {
            this.#siftUp(index);
        } else if (this.#comesBefore(previous, value)) {
            this.#siftDown(index);
        }

        return this;
    }

    public removeAt(index: number): T {
        this.#assertIndex(index);

        const store = this.#store;
        const removed = store[index]!;

        if (store.length === 1) {
            store.pop();
            return removed;
        }

        const tail = store.pop()!;

        if (index < store.length) {
            store[index] = tail;
            const parent = (index - 1) >> 1;

            if (index > 0 && this.#comesBefore(tail, store[parent]!)) {
                this.#siftUp(index);
            } else {
                this.#siftDown(index);
            }
        }

        return removed;
    }

    public drain(): T[] {
        const length = this.#store.length;

        if (length === 0) {
            return [];
        }

        const result = new Array<T>(length);

        for (let index = 0; index < length; index++) {
            result[index] = this.pop()!;
        }

        return result;
    }

    public toArray(): T[] {
        return this.#store.slice();
    }

    public toSortedArray(): T[] {
        const clone = this.clone();
        const size = clone.size;
        const result = new Array<T>(size);

        for (let index = 0; index < size; index++) {
            result[index] = clone.pop()!;
        }

        return result;
    }

    public values(): IterableIterator<T> {
        return this.#store.values();
    }

    public keys(): IterableIterator<number> {
        return this.#store.keys();
    }

    public entries(): IterableIterator<[number, T]> {
        return this.#store.entries();
    }

    public [Symbol.iterator](): IterableIterator<T> {
        return this.values();
    }

    public forEach(
        callback: (value: T, index: number, heap: this) => void,
        thisArg?: unknown
    ): void {
        const store = this.#store;

        for (let index = 0, length = store.length; index < length; index++) {
            callback.call(thisArg, store[index]!, index, this);
        }
    }

    public map<U>(callback: (value: T, index: number, heap: this) => U, thisArg?: unknown): U[] {
        const store = this.#store;
        const result = new Array<U>(store.length);

        for (let index = 0, length = store.length; index < length; index++) {
            result[index] = callback.call(thisArg, store[index]!, index, this);
        }

        return result;
    }

    public filter<S extends T>(
        predicate: (value: T, index: number, heap: this) => value is S,
        thisArg?: unknown
    ): S[];
    public filter(
        predicate: (value: T, index: number, heap: this) => boolean,
        thisArg?: unknown
    ): T[];
    public filter(
        predicate: (value: T, index: number, heap: this) => boolean,
        thisArg?: unknown
    ): T[] {
        const store = this.#store;
        const result: T[] = [];

        for (let index = 0, length = store.length; index < length; index++) {
            const value = store[index]!;

            if (predicate.call(thisArg, value, index, this)) {
                result.push(value);
            }
        }

        return result;
    }

    public some(predicate: (value: T, index: number, heap: this) => boolean, thisArg?: unknown): boolean {
        const store = this.#store;

        for (let index = 0, length = store.length; index < length; index++) {
            if (predicate.call(thisArg, store[index]!, index, this)) {
                return true;
            }
        }

        return false;
    }

    public every(predicate: (value: T, index: number, heap: this) => boolean, thisArg?: unknown): boolean {
        const store = this.#store;

        for (let index = 0, length = store.length; index < length; index++) {
            if (!predicate.call(thisArg, store[index]!, index, this)) {
                return false;
            }
        }

        return true;
    }

    public find<S extends T>(
        predicate: (value: T, index: number, heap: this) => value is S,
        thisArg?: unknown
    ): S | undefined;
    public find(
        predicate: (value: T, index: number, heap: this) => boolean,
        thisArg?: unknown
    ): T | undefined;
    public find(
        predicate: (value: T, index: number, heap: this) => boolean,
        thisArg?: unknown
    ): T | undefined {
        const store = this.#store;

        for (let index = 0, length = store.length; index < length; index++) {
            const value = store[index]!;

            if (predicate.call(thisArg, value, index, this)) {
                return value;
            }
        }

        return undefined;
    }

    public reduce<U>(
        callback: (accumulator: U, value: T, index: number, heap: this) => U,
        initialValue: U
    ): U {
        const store = this.#store;
        let accumulator = initialValue;

        for (let index = 0, length = store.length; index < length; index++) {
            accumulator = callback(accumulator, store[index]!, index, this);
        }

        return accumulator;
    }

    public toJSON(): HeapSerialized<T> {
        return {
            kind: 'BinaryHeap',
            version: 1,
            order: this.#order,
            items: this.#store.slice(),
        };
    }

    #comesBefore(left: T, right: T): boolean {
        return compareByOrder(this.#orderFactor, this.#comparator, left, right);
    }

    #assertIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.#store.length) {
            throw new HeapIndexError();
        }
    }

    #heapify(): void {
        const store = this.#store;

        for (let index = (store.length >> 1) - 1; index >= 0; index--) {
            this.#siftDown(index);
        }
    }

    #siftUp(index: number): void {
        const store = this.#store;
        const item = store[index]!;

        while (index > 0) {
            const parentIndex = (index - 1) >> 1;
            const parent = store[parentIndex]!;

            if (!this.#comesBefore(item, parent)) {
                break;
            }

            store[index] = parent;
            index = parentIndex;
        }

        store[index] = item;
    }

    #siftDown(index: number): void {
        const store = this.#store;
        const length = store.length;
        const item = store[index]!;
        const half = length >> 1;

        while (index < half) {
            let bestIndex = (index << 1) + 1;
            let bestChild = store[bestIndex]!;
            const rightIndex = bestIndex + 1;

            if (rightIndex < length) {
                const right = store[rightIndex]!;

                if (this.#comesBefore(right, bestChild)) {
                    bestIndex = rightIndex;
                    bestChild = right;
                }
            }

            if (!this.#comesBefore(bestChild, item)) {
                break;
            }

            store[index] = bestChild;
            index = bestIndex;
        }

        store[index] = item;
    }
}

export class BinaryMinHeap<T> implements BinaryHeapOperations<T>, Iterable<T> {
    #heap: BinaryHeap<T, 'min'>;
    #comparator: Comparator<T>;
    #capacity: number;

    constructor(comparator: Comparator<T>, initialCapacity?: Capacity) {
        this.#comparator = comparator;
        this.#capacity = initialCapacity === undefined ? 16 : (initialCapacity as number);

        if (!Number.isInteger(this.#capacity) || this.#capacity < 0) {
            throw new InvalidCapacityError(this.#capacity);
        }

        this.#heap = new BinaryHeap<T, 'min'>({
            order: 'min',
            comparator,
        });
    }

    get size(): QueueSize {
        return createQueueSize(this.#heap.size);
    }

    get isEmpty(): boolean {
        return this.#heap.isEmpty();
    }

    get capacity(): Capacity {
        return createCapacity(this.#capacity);
    }

    insert(item: T): void {
        this.#growToFit(this.#heap.size + 1);
        this.#heap.push(item);
    }

    extract(): T {
        if (this.#heap.isEmpty()) {
            throw new EmptyQueueError();
        }

        return this.#heap.pop()!;
    }

    peek(): T {
        if (this.#heap.isEmpty()) {
            throw new EmptyQueueError();
        }

        return this.#heap.peek()!;
    }

    clear(): void {
        this.#heap.clear();
    }

    ensureCapacity(capacity: Capacity): void {
        const required = capacity as number;

        if (required <= this.#capacity) {
            return;
        }

        this.#growToFit(required);
    }

    trimExcess(): void {
        const targetCapacity = Math.max(1, this.#heap.size);

        if (targetCapacity < this.#capacity) {
            this.#heap = BinaryHeap.from(this.#heap.toArray(), {
                order: 'min',
                comparator: this.#comparator,
            });
            this.#capacity = targetCapacity;
        }
    }

    contains(item: T): boolean {
        const items = this.#heap.toArray();

        for (let index = 0; index < items.length; index++) {
            if (items[index] === item) {
                return true;
            }
        }

        return false;
    }

    toArray(): T[] {
        return this.#heap.toArray();
    }

    values(): IterableIterator<T> {
        return this.#heap.values();
    }

    [Symbol.iterator](): Iterator<T> {
        return this.#heap[Symbol.iterator]();
    }

    #growToFit(requiredCapacity: number): void {
        if (requiredCapacity <= this.#capacity) {
            return;
        }

        const doubled = this.#capacity > 0 ? this.#capacity * 2 : 1;
        this.#capacity = Math.max(requiredCapacity, doubled, this.#capacity + 1, 1);
    }
}

export function createBinaryHeap<T extends HeapPrimitive, O extends HeapOrder = 'min'>(
    options?: BinaryHeapOptions<T, O>
): BinaryHeap<T, O>;
export function createBinaryHeap<T, O extends HeapOrder = 'min'>(
    options: BinaryHeapOptions<T, O> & Required<Pick<BinaryHeapOptions<T, O>, 'comparator'>>
): BinaryHeap<T, O>;
export function createBinaryHeap<T, O extends HeapOrder = 'min'>(
    options?: BinaryHeapOptions<T, O>
): BinaryHeap<T, O> {
    return new BinaryHeap<T, O>(options);
}

export const isBinaryHeap = BinaryHeap.isHeap;
