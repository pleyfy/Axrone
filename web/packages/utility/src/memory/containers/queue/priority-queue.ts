import type { Comparator, Equality, HeapOrder } from './binary-heap';
import { defaultPrimitiveComparator } from './binary-heap';

declare const __priorityQueueHandle: unique symbol;

export type PriorityOrder = HeapOrder;

export type PrimitivePriority = number | bigint | string | Date;

export type PrioritySelector<T, P> = (value: T) => P;

export type PriorityQueueHandle = number & {
    readonly [__priorityQueueHandle]: true;
};

export type PriorityQueueEntry<T, P> = Readonly<{
    value: T;
    priority: P;
}>;

export type PriorityQueueSnapshotEntry<T, P> = Readonly<{
    value: T;
    priority: P;
    handle: PriorityQueueHandle;
}>;

export type PriorityQueueSerialized<T, P> = Readonly<{
    kind: 'PriorityQueue';
    version: 1;
    order: PriorityOrder;
    items: readonly PriorityQueueEntry<T, P>[];
}>;

export type QueueLike<T> = Iterable<T> | ArrayLike<T>;

export interface PriorityQueueOptions<T, P, O extends PriorityOrder = PriorityOrder> {
    readonly order?: O;
    readonly comparator?: Comparator<P>;
    readonly equality?: Equality<T>;
    readonly priority?: PrioritySelector<T, P>;
    readonly items?: QueueLike<PriorityQueueEntry<T, P>>;
}

export interface ReadonlyPriorityQueue<T, P, O extends PriorityOrder = PriorityOrder>
    extends Iterable<T> {
    readonly size: number;
    readonly order: O;
    readonly comparator: Comparator<P>;
    readonly [Symbol.toStringTag]: 'PriorityQueue';
    readonly prioritySelector?: PrioritySelector<T, P>;
    isEmpty(): boolean;
    peek(): T | undefined;
    peekEntry(): PriorityQueueSnapshotEntry<T, P> | undefined;
    has(handle: PriorityQueueHandle): boolean;
    get(handle: PriorityQueueHandle): PriorityQueueSnapshotEntry<T, P> | undefined;
    contains(value: T): boolean;
    toArray(): T[];
    toEntries(): PriorityQueueSnapshotEntry<T, P>[];
    toJSON(): PriorityQueueSerialized<T, P>;
    clone(): PriorityQueue<T, P, O>;
    values(): IterableIterator<T>;
}

export class PriorityQueueError extends Error {
    public override readonly name: string = 'PriorityQueueError';

    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class PriorityQueueComparatorError extends PriorityQueueError {
    public override readonly name: string = 'PriorityQueueComparatorError';

    constructor(message = 'A valid comparator function is required for this priority queue.') {
        super(message);
    }
}

export class PriorityQueuePriorityError extends PriorityQueueError {
    public override readonly name: string = 'PriorityQueuePriorityError';

    constructor(message = 'A priority selector or explicit priority value is required for this operation.') {
        super(message);
    }
}

export class PriorityQueueHandleError extends PriorityQueueError {
    public override readonly name: string = 'PriorityQueueHandleError';

    constructor(message = 'The provided priority queue handle is invalid or does not exist.') {
        super(message);
    }
}

export class PriorityQueueSerializationError extends PriorityQueueError {
    public override readonly name: string = 'PriorityQueueSerializationError';

    constructor(message = 'Invalid priority queue serialization payload.') {
        super(message);
    }
}

const enum InternalOrder {
    Min = 1,
    Max = -1,
}

type Node<T, P> = {
    value: T;
    priority: P;
    handle: PriorityQueueHandle;
    sequence: number;
};

const isFunction = (value: unknown): value is (...args: readonly unknown[]) => unknown =>
    typeof value === 'function';

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
    value !== null && typeof value === 'object';

const isEntryLike = <T, P>(value: unknown): value is PriorityQueueEntry<T, P> =>
    isObject(value) && 'value' in value && 'priority' in value;

const defaultEquality = <T>(left: T, right: T): boolean => Object.is(left, right);

const ensureComparator = <P>(comparator: unknown): Comparator<P> => {
    if (!isFunction(comparator)) {
        throw new PriorityQueueComparatorError();
    }

    return comparator as Comparator<P>;
};

const normalizeOrder = (order: PriorityOrder | undefined): PriorityOrder =>
    order === 'min' ? 'min' : 'max';

const internalOrderOf = (order: PriorityOrder): InternalOrder =>
    order === 'max' ? InternalOrder.Max : InternalOrder.Min;

const toHandle = (value: number): PriorityQueueHandle => value as PriorityQueueHandle;

const collectEntries = <T, P>(
    source: QueueLike<PriorityQueueEntry<T, P>> | undefined
): PriorityQueueEntry<T, P>[] => {
    if (source === undefined) {
        return [];
    }

    if (Array.isArray(source)) {
        return source.slice();
    }

    const length = (source as ArrayLike<PriorityQueueEntry<T, P>>).length;

    if (typeof length === 'number') {
        const result = new Array<PriorityQueueEntry<T, P>>(length);

        for (let index = 0; index < length; index++) {
            result[index] = (source as ArrayLike<PriorityQueueEntry<T, P>>)[index]!;
        }

        return result;
    }

    const result: PriorityQueueEntry<T, P>[] = [];

    for (const entry of source as Iterable<PriorityQueueEntry<T, P>>) {
        result.push(entry);
    }

    return result;
};

const collectValues = <T>(source: QueueLike<T>): T[] => {
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

const ensureSerialized = <T, P>(value: unknown): PriorityQueueSerialized<T, P> => {
    if (!isObject(value)) {
        throw new PriorityQueueSerializationError();
    }

    if (value.kind !== 'PriorityQueue' || value.version !== 1) {
        throw new PriorityQueueSerializationError();
    }

    if (value.order !== 'min' && value.order !== 'max') {
        throw new PriorityQueueSerializationError();
    }

    if (!Array.isArray(value.items)) {
        throw new PriorityQueueSerializationError();
    }

    for (let index = 0; index < value.items.length; index++) {
        if (!isEntryLike<T, P>(value.items[index])) {
            throw new PriorityQueueSerializationError();
        }
    }

    return value as PriorityQueueSerialized<T, P>;
};

const siftUpThreshold = (baseLength: number, incoming: number): number =>
    Math.ceil(baseLength / Math.log2(baseLength + incoming + 1));

class NodeIterator<T, P, R> implements IterableIterator<R> {
    readonly #store: Node<T, P>[];
    readonly #select: (node: Node<T, P>) => R;
    #index = 0;

    constructor(store: Node<T, P>[], select: (node: Node<T, P>) => R) {
        this.#store = store;
        this.#select = select;
    }

    next(): IteratorResult<R> {
        const index = this.#index;

        if (index >= this.#store.length) {
            return { value: undefined as unknown as R, done: true };
        }

        this.#index = index + 1;
        return { value: this.#select(this.#store[index]!), done: false };
    }

    [Symbol.iterator](): this {
        return this;
    }
}

export class PriorityQueue<T, P = number, O extends PriorityOrder = 'max'>
    implements ReadonlyPriorityQueue<T, P, O>
{
    readonly #store: Node<T, P>[];
    readonly #indexByHandle: Map<PriorityQueueHandle, number>;
    readonly #order: O;
    readonly #orderFactor: InternalOrder;
    readonly #comparator: Comparator<P>;
    readonly #equality: Equality<T>;
    readonly #prioritySelector: PrioritySelector<T, P> | undefined;
    #nextHandle: number;
    #nextSequence: number;

    static #restore<T, P, O extends PriorityOrder>(source: PriorityQueue<T, P, O>): PriorityQueue<T, P, O> {
        const queue = new PriorityQueue<T, P, O>({
            order: source.#order,
            comparator: source.#comparator,
            equality: source.#equality,
            priority: source.#prioritySelector,
        });

        const length = source.#store.length;
        queue.#store.length = length;

        for (let index = 0; index < length; index++) {
            const current = source.#store[index]!;
            const node: Node<T, P> = {
                value: current.value,
                priority: current.priority,
                handle: current.handle,
                sequence: current.sequence,
            };

            queue.#store[index] = node;
            queue.#indexByHandle.set(node.handle, index);
        }

        queue.#nextHandle = source.#nextHandle;
        queue.#nextSequence = source.#nextSequence;
        return queue;
    }

    public static max<T, P extends PrimitivePriority = number>(
        options?: Omit<PriorityQueueOptions<T, P, 'max'>, 'order' | 'comparator'>
    ): PriorityQueue<T, P, 'max'>;
    public static max<T, P>(
        options: Omit<PriorityQueueOptions<T, P, 'max'>, 'order'> &
            Required<Pick<PriorityQueueOptions<T, P, 'max'>, 'comparator'>>
    ): PriorityQueue<T, P, 'max'>;
    public static max<T, P>(options?: PriorityQueueOptions<T, P, 'max'>): PriorityQueue<T, P, 'max'> {
        const comparator =
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>);

        return new PriorityQueue<T, P, 'max'>({ ...options, order: 'max', comparator });
    }

    public static min<T, P extends PrimitivePriority = number>(
        options?: Omit<PriorityQueueOptions<T, P, 'min'>, 'order' | 'comparator'>
    ): PriorityQueue<T, P, 'min'>;
    public static min<T, P>(
        options: Omit<PriorityQueueOptions<T, P, 'min'>, 'order'> &
            Required<Pick<PriorityQueueOptions<T, P, 'min'>, 'comparator'>>
    ): PriorityQueue<T, P, 'min'>;
    public static min<T, P>(options?: PriorityQueueOptions<T, P, 'min'>): PriorityQueue<T, P, 'min'> {
        const comparator =
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>);

        return new PriorityQueue<T, P, 'min'>({ ...options, order: 'min', comparator });
    }

    public static fromEntries<T, P extends PrimitivePriority = number, O extends PriorityOrder = 'max'>(
        items: QueueLike<PriorityQueueEntry<T, P>>,
        options?: Omit<PriorityQueueOptions<T, P, O>, 'items' | 'comparator'>
    ): PriorityQueue<T, P, O>;
    public static fromEntries<T, P, O extends PriorityOrder = 'max'>(
        items: QueueLike<PriorityQueueEntry<T, P>>,
        options: Omit<PriorityQueueOptions<T, P, O>, 'items'> &
            Required<Pick<PriorityQueueOptions<T, P, O>, 'comparator'>>
    ): PriorityQueue<T, P, O>;
    public static fromEntries<T, P, O extends PriorityOrder = 'max'>(
        items: QueueLike<PriorityQueueEntry<T, P>>,
        options?: PriorityQueueOptions<T, P, O>
    ): PriorityQueue<T, P, O> {
        const comparator =
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>);

        return new PriorityQueue<T, P, O>({
            order: normalizeOrder(options?.order) as O,
            comparator,
            equality: options?.equality,
            priority: options?.priority,
            items,
        });
    }

    public static fromValues<T, P extends PrimitivePriority = number, O extends PriorityOrder = 'max'>(
        values: QueueLike<T>,
        options: Omit<PriorityQueueOptions<T, P, O>, 'items' | 'comparator'> &
            Required<Pick<PriorityQueueOptions<T, P, O>, 'priority'>>
    ): PriorityQueue<T, P, O>;
    public static fromValues<T, P, O extends PriorityOrder = 'max'>(
        values: QueueLike<T>,
        options: Omit<PriorityQueueOptions<T, P, O>, 'items'> &
            Required<Pick<PriorityQueueOptions<T, P, O>, 'priority' | 'comparator'>>
    ): PriorityQueue<T, P, O>;
    public static fromValues<T, P, O extends PriorityOrder = 'max'>(
        values: QueueLike<T>,
        options: PriorityQueueOptions<T, P, O> & Required<Pick<PriorityQueueOptions<T, P, O>, 'priority'>>
    ): PriorityQueue<T, P, O> {
        const comparator =
            options.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>);

        const queue = new PriorityQueue<T, P, O>({
            order: normalizeOrder(options.order) as O,
            comparator,
            equality: options.equality,
            priority: options.priority,
        });

        queue.enqueueValues(values);
        return queue;
    }

    public static deserialize<T, P extends PrimitivePriority = number, O extends PriorityOrder = 'max'>(
        payload: unknown,
        options?: Omit<PriorityQueueOptions<T, P, O>, 'items' | 'order' | 'comparator'>
    ): PriorityQueue<T, P, O>;
    public static deserialize<T, P, O extends PriorityOrder = 'max'>(
        payload: unknown,
        options: Omit<PriorityQueueOptions<T, P, O>, 'items' | 'order'> &
            Required<Pick<PriorityQueueOptions<T, P, O>, 'comparator'>>
    ): PriorityQueue<T, P, O>;
    public static deserialize<T, P, O extends PriorityOrder = 'max'>(
        payload: unknown,
        options?: PriorityQueueOptions<T, P, O>
    ): PriorityQueue<T, P, O> {
        const serialized = ensureSerialized<T, P>(payload);
        const comparator =
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>);

        return new PriorityQueue<T, P, O>({
            order: serialized.order as O,
            comparator,
            equality: options?.equality,
            priority: options?.priority,
            items: serialized.items,
        });
    }

    public static isPriorityQueue(value: unknown): value is ReadonlyPriorityQueue<unknown, unknown> {
        return (
            isObject(value) &&
            value[Symbol.toStringTag] === 'PriorityQueue' &&
            isFunction((value as { peek?: unknown }).peek)
        );
    }

    public constructor(options?: PriorityQueueOptions<T, P, O>) {
        const order = normalizeOrder(options?.order) as O;

        this.#order = order;
        this.#orderFactor = internalOrderOf(order);
        this.#comparator = ensureComparator<P>(
            options?.comparator ?? (defaultPrimitiveComparator as unknown as Comparator<P>)
        );
        this.#equality = options?.equality ?? defaultEquality;
        this.#prioritySelector = options?.priority;
        this.#store = [];
        this.#indexByHandle = new Map();
        this.#nextHandle = 1;
        this.#nextSequence = 1;

        const items = collectEntries(options?.items);

        if (items.length > 0) {
            this.#store.length = items.length;

            for (let index = 0; index < items.length; index++) {
                const entry = items[index]!;
                const handle = this.#allocateHandle();
                const node: Node<T, P> = {
                    value: entry.value,
                    priority: entry.priority,
                    handle,
                    sequence: this.#allocateSequence(),
                };

                this.#store[index] = node;
                this.#indexByHandle.set(handle, index);
            }

            if (items.length > 1) {
                this.#heapify();
            }
        }
    }

    public get [Symbol.toStringTag](): 'PriorityQueue' {
        return 'PriorityQueue';
    }

    public get size(): number {
        return this.#store.length;
    }

    public get order(): O {
        return this.#order;
    }

    public get comparator(): Comparator<P> {
        return this.#comparator;
    }

    public get prioritySelector(): PrioritySelector<T, P> | undefined {
        return this.#prioritySelector;
    }

    public isEmpty(): boolean {
        return this.#store.length === 0;
    }

    public clear(): this {
        this.#store.length = 0;
        this.#indexByHandle.clear();
        return this;
    }

    public clone(): PriorityQueue<T, P, O> {
        return PriorityQueue.#restore(this);
    }

    public peek(): T | undefined {
        return this.#store[0]?.value;
    }

    public peekPriority(): P | undefined {
        return this.#store[0]?.priority;
    }

    public peekHandle(): PriorityQueueHandle | undefined {
        return this.#store[0]?.handle;
    }

    public peekEntry(): PriorityQueueSnapshotEntry<T, P> | undefined {
        const node = this.#store[0];

        return node === undefined ? undefined : this.#snapshot(node);
    }

    public has(handle: PriorityQueueHandle): boolean {
        return this.#indexByHandle.has(handle);
    }

    public get(handle: PriorityQueueHandle): PriorityQueueSnapshotEntry<T, P> | undefined {
        const index = this.#indexByHandle.get(handle);

        if (index === undefined) {
            return undefined;
        }

        const node = this.#store[index];
        return node === undefined ? undefined : this.#snapshot(node);
    }

    public assertHas(handle: PriorityQueueHandle): PriorityQueueSnapshotEntry<T, P> {
        const entry = this.get(handle);

        if (entry === undefined) {
            throw new PriorityQueueHandleError();
        }

        return entry;
    }

    public contains(value: T): boolean {
        const store = this.#store;
        const equality = this.#equality;

        for (let index = 0; index < store.length; index++) {
            if (equality(store[index]!.value, value)) {
                return true;
            }
        }

        return false;
    }

    public enqueue(value: T, priority: P): PriorityQueueHandle;
    public enqueue(value: T): PriorityQueueHandle;
    public enqueue(value: T, priority?: P): PriorityQueueHandle {
        return this.#insert(
            value,
            priority !== undefined ? priority : this.#resolveFromSelector(value)
        );
    }

    public offer(value: T, priority: P): PriorityQueueHandle;
    public offer(value: T): PriorityQueueHandle;
    public offer(value: T, priority?: P): PriorityQueueHandle {
        return priority !== undefined ? this.enqueue(value, priority) : this.enqueue(value);
    }

    public enqueueEntry(entry: PriorityQueueEntry<T, P>): PriorityQueueHandle {
        return this.#insert(entry.value, entry.priority);
    }

    public enqueueEntries(entries: QueueLike<PriorityQueueEntry<T, P>>): this {
        const items = collectEntries(entries);
        const incoming = items.length;

        if (incoming === 0) {
            return this;
        }

        const store = this.#store;
        const baseSize = store.length;

        if (baseSize === 0) {
            store.length = incoming;

            for (let index = 0; index < incoming; index++) {
                const item = items[index]!;
                const handle = this.#allocateHandle();
                const node: Node<T, P> = {
                    value: item.value,
                    priority: item.priority,
                    handle,
                    sequence: this.#allocateSequence(),
                };

                store[index] = node;
                this.#indexByHandle.set(handle, index);
            }

            if (incoming > 1) {
                this.#heapify();
            }

            return this;
        }

        const threshold = siftUpThreshold(baseSize, incoming);

        if (incoming <= threshold) {
            for (let index = 0; index < incoming; index++) {
                const item = items[index]!;
                this.#insert(item.value, item.priority);
            }
        } else {
            const offset = store.length;
            store.length = offset + incoming;

            for (let index = 0; index < incoming; index++) {
                const item = items[index]!;
                const handle = this.#allocateHandle();
                const node: Node<T, P> = {
                    value: item.value,
                    priority: item.priority,
                    handle,
                    sequence: this.#allocateSequence(),
                };

                const targetIndex = offset + index;
                store[targetIndex] = node;
                this.#indexByHandle.set(handle, targetIndex);
            }

            this.#heapify();
        }

        return this;
    }

    public enqueueRange(items: QueueLike<PriorityQueueEntry<T, P>>): this {
        return this.enqueueEntries(items);
    }

    public enqueueValues(values: QueueLike<T>): this {
        const items = collectValues(values);
        const incoming = items.length;

        if (incoming === 0) {
            return this;
        }

        const store = this.#store;
        const baseSize = store.length;
        const threshold = baseSize === 0 ? 0 : siftUpThreshold(baseSize, incoming);

        if (baseSize === 0 && incoming > 1) {
            const selector = this.#prioritySelector;

            if (selector === undefined) {
                throw new PriorityQueuePriorityError();
            }

            store.length = incoming;

            for (let index = 0; index < incoming; index++) {
                const value = items[index]!;
                const handle = this.#allocateHandle();
                const node: Node<T, P> = {
                    value,
                    priority: selector(value),
                    handle,
                    sequence: this.#allocateSequence(),
                };

                store[index] = node;
                this.#indexByHandle.set(handle, index);
            }

            this.#heapify();
            return this;
        }

        if (incoming > threshold && baseSize > 0) {
            const selector = this.#prioritySelector;

            if (selector === undefined) {
                throw new PriorityQueuePriorityError();
            }

            const offset = store.length;
            store.length = offset + incoming;

            for (let index = 0; index < incoming; index++) {
                const value = items[index]!;
                const handle = this.#allocateHandle();
                const node: Node<T, P> = {
                    value,
                    priority: selector(value),
                    handle,
                    sequence: this.#allocateSequence(),
                };

                const targetIndex = offset + index;
                store[targetIndex] = node;
                this.#indexByHandle.set(handle, targetIndex);
            }

            this.#heapify();
            return this;
        }

        for (let index = 0; index < incoming; index++) {
            this.#insert(items[index]!, this.#resolveFromSelector(items[index]!));
        }

        return this;
    }

    public dequeue(): T | undefined {
        return this.#extractRoot()?.value;
    }

    public tryDequeue(): T | undefined {
        return this.dequeue();
    }

    public poll(): T | undefined {
        return this.dequeue();
    }

    public dequeueEntry(): PriorityQueueSnapshotEntry<T, P> | undefined {
        const node = this.#extractRoot();
        return node === undefined ? undefined : this.#snapshot(node);
    }

    public tryPeek(): T | undefined {
        return this.peek();
    }

    public replaceHead(value: T, priority: P): PriorityQueueSnapshotEntry<T, P> | undefined;
    public replaceHead(value: T): PriorityQueueSnapshotEntry<T, P> | undefined;
    public replaceHead(value: T, priority?: P): PriorityQueueSnapshotEntry<T, P> | undefined {
        const resolvedPriority = priority !== undefined ? priority : this.#resolveFromSelector(value);
        const store = this.#store;

        if (store.length === 0) {
            this.#insert(value, resolvedPriority);
            return undefined;
        }

        const removed = store[0]!;
        this.#indexByHandle.delete(removed.handle);

        const handle = this.#allocateHandle();
        const node: Node<T, P> = {
            value,
            priority: resolvedPriority,
            handle,
            sequence: this.#allocateSequence(),
        };

        store[0] = node;
        this.#indexByHandle.set(handle, 0);
        this.#siftDown(0);

        return this.#snapshot(removed);
    }

    public remove(handle: PriorityQueueHandle): PriorityQueueSnapshotEntry<T, P> | undefined {
        const index = this.#indexByHandle.get(handle);

        if (index === undefined) {
            return undefined;
        }

        return this.#snapshot(this.#removeAt(index));
    }

    public delete(value: T): boolean {
        const store = this.#store;
        const equality = this.#equality;

        for (let index = 0; index < store.length; index++) {
            if (equality(store[index]!.value, value)) {
                this.#removeAt(index);
                return true;
            }
        }

        return false;
    }

    public updatePriority(handle: PriorityQueueHandle, priority: P): boolean {
        const index = this.#indexByHandle.get(handle);

        if (index === undefined) {
            return false;
        }

        return this.#updatePriorityAt(index, priority);
    }

    public updateValue(handle: PriorityQueueHandle, value: T): boolean {
        const index = this.#indexByHandle.get(handle);

        if (index === undefined) {
            return false;
        }

        this.#store[index]!.value = value;
        return true;
    }

    public update(handle: PriorityQueueHandle, value: T, priority: P): boolean;
    public update(handle: PriorityQueueHandle, value: T): boolean;
    public update(handle: PriorityQueueHandle, value: T, priority?: P): boolean {
        const index = this.#indexByHandle.get(handle);

        if (index === undefined) {
            return false;
        }

        const node = this.#store[index]!;
        node.value = value;

        if (priority !== undefined) {
            return this.#updatePriorityAt(index, priority);
        }

        const selector = this.#prioritySelector;

        if (selector !== undefined) {
            return this.#updatePriorityAt(index, selector(value));
        }

        return true;
    }

    public drain(): T[] {
        const length = this.#store.length;

        if (length === 0) {
            return [];
        }

        const result = new Array<T>(length);

        for (let index = 0; index < length; index++) {
            result[index] = this.dequeue()!;
        }

        return result;
    }

    public dequeueAll(): T[] {
        return this.drain();
    }

    public drainEntries(): PriorityQueueSnapshotEntry<T, P>[] {
        const length = this.#store.length;

        if (length === 0) {
            return [];
        }

        const result = new Array<PriorityQueueSnapshotEntry<T, P>>(length);

        for (let index = 0; index < length; index++) {
            result[index] = this.dequeueEntry()!;
        }

        return result;
    }

    public toArray(): T[] {
        const store = this.#store;
        const result = new Array<T>(store.length);

        for (let index = 0; index < store.length; index++) {
            result[index] = store[index]!.value;
        }

        return result;
    }

    public toEntries(): PriorityQueueSnapshotEntry<T, P>[] {
        const store = this.#store;
        const result = new Array<PriorityQueueSnapshotEntry<T, P>>(store.length);

        for (let index = 0; index < store.length; index++) {
            result[index] = this.#snapshot(store[index]!);
        }

        return result;
    }

    public toSortedArray(): T[] {
        const clone = PriorityQueue.#restore(this);
        const length = clone.size;
        const result = new Array<T>(length);

        for (let index = 0; index < length; index++) {
            result[index] = clone.dequeue()!;
        }

        return result;
    }

    public toSortedEntries(): PriorityQueueSnapshotEntry<T, P>[] {
        const clone = PriorityQueue.#restore(this);
        const length = clone.size;
        const result = new Array<PriorityQueueSnapshotEntry<T, P>>(length);

        for (let index = 0; index < length; index++) {
            result[index] = clone.dequeueEntry()!;
        }

        return result;
    }

    public toJSON(): PriorityQueueSerialized<T, P> {
        const store = this.#store;
        const items = new Array<PriorityQueueEntry<T, P>>(store.length);

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;
            items[index] = { value: node.value, priority: node.priority };
        }

        return { kind: 'PriorityQueue', version: 1, order: this.#order, items };
    }

    public values(): IterableIterator<T> {
        return new NodeIterator(this.#store, (node) => node.value);
    }

    public priorities(): IterableIterator<P> {
        return new NodeIterator(this.#store, (node) => node.priority);
    }

    public handles(): IterableIterator<PriorityQueueHandle> {
        return new NodeIterator(this.#store, (node) => node.handle);
    }

    public entries(): IterableIterator<[PriorityQueueHandle, T]> {
        return new NodeIterator<T, P, [PriorityQueueHandle, T]>(this.#store, (node) => [node.handle, node.value]);
    }

    public [Symbol.iterator](): IterableIterator<T> {
        return this.values();
    }

    public forEach(
        callback: (value: T, handle: PriorityQueueHandle, queue: this) => void,
        thisArg?: unknown
    ): void {
        const store = this.#store;

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;
            callback.call(thisArg, node.value, node.handle, this);
        }
    }

    public map<U>(
        callback: (value: T, handle: PriorityQueueHandle, queue: this) => U,
        thisArg?: unknown
    ): U[] {
        const store = this.#store;
        const result = new Array<U>(store.length);

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;
            result[index] = callback.call(thisArg, node.value, node.handle, this);
        }

        return result;
    }

    public filter<S extends T>(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => value is S,
        thisArg?: unknown
    ): S[];
    public filter(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): T[];
    public filter(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): T[] {
        const store = this.#store;
        const result: T[] = [];

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;

            if (predicate.call(thisArg, node.value, node.handle, this)) {
                result.push(node.value);
            }
        }

        return result;
    }

    public find<S extends T>(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => value is S,
        thisArg?: unknown
    ): S | undefined;
    public find(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): T | undefined;
    public find(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): T | undefined {
        const store = this.#store;

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;

            if (predicate.call(thisArg, node.value, node.handle, this)) {
                return node.value;
            }
        }

        return undefined;
    }

    public some(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): boolean {
        const store = this.#store;

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;

            if (predicate.call(thisArg, node.value, node.handle, this)) {
                return true;
            }
        }

        return false;
    }

    public every(
        predicate: (value: T, handle: PriorityQueueHandle, queue: this) => boolean,
        thisArg?: unknown
    ): boolean {
        const store = this.#store;

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;

            if (!predicate.call(thisArg, node.value, node.handle, this)) {
                return false;
            }
        }

        return true;
    }

    public reduce<U>(
        callback: (accumulator: U, value: T, handle: PriorityQueueHandle, queue: this) => U,
        initialValue: U
    ): U {
        const store = this.#store;
        let accumulator = initialValue;

        for (let index = 0; index < store.length; index++) {
            const node = store[index]!;
            accumulator = callback(accumulator, node.value, node.handle, this);
        }

        return accumulator;
    }

    public tryDequeueEntry(): PriorityQueueSnapshotEntry<T, P> | undefined {
        return this.dequeueEntry();
    }

    public tryPeekEntry(): PriorityQueueSnapshotEntry<T, P> | undefined {
        return this.peekEntry();
    }

    #allocateHandle(): PriorityQueueHandle {
        if (this.#nextHandle >= Number.MAX_SAFE_INTEGER) {
            this.#nextHandle = 1;
        }

        return toHandle(this.#nextHandle++);
    }

    #allocateSequence(): number {
        if (this.#nextSequence >= Number.MAX_SAFE_INTEGER) {
            this.#nextSequence = 1;
        }

        return this.#nextSequence++;
    }

    #resolveFromSelector(value: T): P {
        const selector = this.#prioritySelector;

        if (selector === undefined) {
            throw new PriorityQueuePriorityError();
        }

        return selector(value);
    }

    #snapshot(node: Node<T, P>): PriorityQueueSnapshotEntry<T, P> {
        return { value: node.value, priority: node.priority, handle: node.handle };
    }

    #comesBefore(left: Node<T, P>, right: Node<T, P>): boolean {
        const cmp = this.#comparator(left.priority, right.priority);

        if (cmp !== 0) {
            return cmp * this.#orderFactor < 0;
        }

        return left.sequence < right.sequence;
    }

    #updatePriorityAt(index: number, priority: P): boolean {
        const node = this.#store[index]!;
        const cmp = this.#comparator(priority, node.priority);

        node.priority = priority;

        if (cmp === 0) {
            return true;
        }

        if (cmp * this.#orderFactor < 0) {
            this.#siftUp(index);
        } else {
            this.#siftDown(index);
        }

        return true;
    }

    #insert(value: T, priority: P): PriorityQueueHandle {
        const handle = this.#allocateHandle();
        const node: Node<T, P> = {
            value,
            priority,
            handle,
            sequence: this.#allocateSequence(),
        };

        const index = this.#store.length;
        this.#store.push(node);
        this.#indexByHandle.set(handle, index);

        if (index > 0) {
            this.#siftUp(index);
        }

        return handle;
    }

    #extractRoot(): Node<T, P> | undefined {
        const store = this.#store;
        const length = store.length;

        if (length === 0) {
            return undefined;
        }

        if (length === 1) {
            const node = store.pop()!;
            this.#indexByHandle.delete(node.handle);
            return node;
        }

        const root = store[0]!;
        const tail = store.pop()!;

        this.#indexByHandle.delete(root.handle);
        store[0] = tail;
        this.#indexByHandle.set(tail.handle, 0);
        this.#siftDown(0);

        return root;
    }

    #removeAt(index: number): Node<T, P> {
        const store = this.#store;
        const removed = store[index]!;

        this.#indexByHandle.delete(removed.handle);

        if (store.length === 1) {
            store.pop();
            return removed;
        }

        const tail = store.pop()!;

        if (index < store.length) {
            store[index] = tail;
            this.#indexByHandle.set(tail.handle, index);

            const parent = (index - 1) >> 1;

            if (index > 0 && this.#comesBefore(tail, store[parent]!)) {
                this.#siftUp(index);
            } else {
                this.#siftDown(index);
            }
        }

        return removed;
    }

    #heapify(): void {
        for (let index = (this.#store.length >> 1) - 1; index >= 0; index--) {
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
            this.#indexByHandle.set(parent.handle, index);
            index = parentIndex;
        }

        store[index] = item;
        this.#indexByHandle.set(item.handle, index);
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
            this.#indexByHandle.set(bestChild.handle, index);
            index = bestIndex;
        }

        store[index] = item;
        this.#indexByHandle.set(item.handle, index);
    }
}

export function createPriorityQueue<T, P extends PrimitivePriority = number, O extends PriorityOrder = 'max'>(
    options?: Omit<PriorityQueueOptions<T, P, O>, 'comparator'>
): PriorityQueue<T, P, O>;
export function createPriorityQueue<T, P, O extends PriorityOrder = 'max'>(
    options: PriorityQueueOptions<T, P, O> & Required<Pick<PriorityQueueOptions<T, P, O>, 'comparator'>>
): PriorityQueue<T, P, O>;
export function createPriorityQueue<T, P, O extends PriorityOrder = 'max'>(
    options?: PriorityQueueOptions<T, P, O>
): PriorityQueue<T, P, O> {
    return new PriorityQueue<T, P, O>(options);
}

export const isPriorityQueue = PriorityQueue.isPriorityQueue;

export type { Comparator, Equality } from './binary-heap';
export type {
    HeapIndex,
    QueueSize,
    Capacity,
    ReadonlyQueueNode,
    QueueNode,
    PriorityQueueCore,
    OptionalOperations,
    QueryOperations,
    CapacityOperations,
} from './types';