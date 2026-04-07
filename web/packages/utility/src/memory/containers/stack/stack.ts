import {
    Brand,
    Nominal,
    Phantom,
    StackCapacity,
    StackSize,
    NodeId,
    MemoryAddress,
    AllocatorId,
    PoolIndex,
    NonEmptyArray,
    EmptyArray,
    ArrayWithLength,
    StackNode,
    AlignedStackNode,
    StackResult,
    ExtractSuccess,
    ExtractError,
} from './types';

export declare const __variance: unique symbol;

import {
    StackCapacityError,
    StackIntegrityError,
    StackMemoryError,
    StackErrorUnion,
} from './errors';

import { AbstractStack } from './abstract-stack';
import {
    MutableStackInterface,
    ImmutableStackInterface,
    StackConfiguration,
    ReadonlyStackInterface,
} from './interfaces';

const CAPACITY_MASK = 0x7fffffff;
const SIZE_MASK = 0x7fffffff;
const NODE_ID_MASK = 0xffffffff;

const createStackCapacity = (value: number): StackCapacity => {
    const masked = value & CAPACITY_MASK;
    if (masked !== value || value <= 0) {
        throw new StackIntegrityError('Invalid capacity value', { value, masked });
    }
    return masked as StackCapacity;
};

const createStackSize = (value: number): StackSize => {
    const masked = value & SIZE_MASK;
    if (masked !== value || value < 0) {
        throw new StackIntegrityError('Invalid size value', { value, masked });
    }
    return masked as StackSize;
};

const createNodeId = (): NodeId => {
    return ((Math.random() * NODE_ID_MASK) | 0) as NodeId;
};

class OptimizedArrayStack<T> extends AbstractStack<T> implements MutableStackInterface<T> {
    private _disposed = false;
    readonly [__variance] = undefined as any;

    push(value: T): StackResult<this, StackCapacityError> {
        if (this._disposed) {
            throw new StackIntegrityError('Cannot operate on disposed stack');
        }

        if (this.isFull) {
            return {
                tag: 'failure',
                error: new StackCapacityError(this._size, this._capacity!, 'push'),
            };
        }

        return { tag: 'success', value: this.pushUnsafe(value), cost: 1 };
    }

    pushUnsafe(value: T): this {
        const transformedValue = this._config.transformFn(value);
        const node = this._memoryPool.allocate(transformedValue, this._head, this._generation);

        this._head = node;
        this._size = createStackSize(this._size + 1);
        this.incrementGeneration();
        this.updateChecksum();

        return this;
    }

    pushMany(values: readonly T[]): StackResult<this, StackCapacityError> {
        if (this._capacity && this._size + values.length > this._capacity) {
            return {
                tag: 'failure',
                error: new StackCapacityError(
                    createStackSize(this._size + values.length),
                    this._capacity,
                    'pushMany'
                ),
            };
        }

        for (const value of values) {
            this.pushUnsafe(value);
        }

        return { tag: 'success', value: this, cost: values.length };
    }

    pop(): StackResult<T | undefined> {
        if (this.isEmpty) {
            return { tag: 'success', value: undefined, cost: 0 };
        }

        return { tag: 'success', value: this.popUnsafe(), cost: 1 };
    }

    popUnsafe(): T | undefined {
        if (this._head === null) return undefined;

        const { value } = this._head;
        const oldHead = this._head;
        this._head = this._head.next;
        this._size = createStackSize(this._size - 1);

        this._memoryPool.deallocate(oldHead);
        this.incrementGeneration();
        this.updateChecksum();

        return value;
    }

    popMany(count: number): StackResult<readonly T[]> {
        const actualCount = Math.min(count, this._size);
        const result: T[] = new Array(actualCount);

        for (let i = 0; i < actualCount; i++) {
            const value = this.popUnsafe();
            if (value !== undefined) {
                result[i] = value;
            }
        }

        return { tag: 'success', value: Object.freeze(result), cost: actualCount };
    }

    swap(): StackResult<this, StackIntegrityError> {
        if (this._size < 2) {
            return {
                tag: 'failure',
                error: new StackIntegrityError('Insufficient elements for swap', {
                    size: this._size,
                }),
            };
        }

        const first = this.popUnsafe()!;
        const second = this.popUnsafe()!;
        this.pushUnsafe(first);
        this.pushUnsafe(second);

        return { tag: 'success', value: this, cost: 4 };
    }

    duplicate(): StackResult<this, StackCapacityError | StackIntegrityError> {
        if (this.isEmpty) {
            return {
                tag: 'failure',
                error: new StackIntegrityError('Cannot duplicate empty stack'),
            };
        }

        const value = this.peekUnsafe()!;
        return this.push(value) as StackResult<this, StackCapacityError | StackIntegrityError>;
    }

    clear(): this {
        while (this._head !== null) {
            const oldHead = this._head;
            this._head = this._head.next;
            this._memoryPool.deallocate(oldHead);
        }

        this._size = createStackSize(0);
        this.incrementGeneration();
        this.updateChecksum();

        return this;
    }

    compact(): this {
        const values = this.toArray();
        this.clear();

        for (let i = values.length - 1; i >= 0; i--) {
            this.pushUnsafe(values[i]);
        }

        return this;
    }

    async defragment(): Promise<this> {
        return new Promise((resolve) => {
            const values = this.toArray();
            this.clear();

            const batchSize = 100;
            let index = values.length - 1;

            const processBatch = () => {
                const end = Math.max(0, index - batchSize);
                for (let i = index; i >= end; i--) {
                    this.pushUnsafe(values[i]);
                }
                index = end - 1;

                if (index >= 0) {
                    setTimeout(processBatch, 0);
                } else {
                    resolve(this);
                }
            };

            processBatch();
        });
    }

    async dispose(): Promise<void> {
        if (!this._disposed) {
            this.clear();
            this._memoryPool.clear();
            this._disposed = true;
        }
    }
}

class ImmutableStack<T> extends AbstractStack<T> implements ImmutableStackInterface<T> {
    private static readonly EMPTY_CACHE = new WeakMap<
        StackConfiguration<any>,
        ImmutableStack<any>
    >();
    readonly [__variance] = undefined as any;

    private constructor(
        head: StackNode<T> | null,
        size: StackSize,
        generation: number,
        config: StackConfiguration<T>
    ) {
        super(config);
        this._head = head;
        this._size = size;
        this._generation = generation;
        this.updateChecksum();
    }

    static empty<T>(config: StackConfiguration<T> = {}): ImmutableStack<T> {
        const cached = this.EMPTY_CACHE.get(config);
        if (cached) return cached;

        const instance = new ImmutableStack<T>(null, createStackSize(0), 1, config);
        this.EMPTY_CACHE.set(config, instance);
        return instance;
    }

    static of<T>(...values: readonly T[]): ImmutableStack<T> {
        return values.reduceRight((stack, value) => stack.push(value), ImmutableStack.empty<T>());
    }

    static fromIterable<T>(
        iterable: Iterable<T>,
        config: StackConfiguration<T> = {}
    ): ImmutableStack<T> {
        return Array.from(iterable).reduceRight(
            (stack, value) => stack.push(value),
            ImmutableStack.empty<T>(config)
        );
    }

    push<U extends T>(value: U): ImmutableStack<T | U> {
        const transformedValue = this._config.transformFn(value);
        const node = this._memoryPool.allocate(transformedValue, this._head, this._generation + 1);

        return new ImmutableStack(
            node,
            createStackSize(this._size + 1),
            this._generation + 1,
            this._config
        );
    }

    pushMany<U extends readonly T[]>(values: U): ImmutableStack<T> {
        return values.reduceRight((stack, value) => stack.push(value), this as ImmutableStack<T>);
    }

    pop(): readonly [T | undefined, ImmutableStack<T>] {
        if (this._head === null) {
            return [undefined, this] as const;
        }

        const newStack = new ImmutableStack(
            this._head.next,
            createStackSize(this._size - 1),
            this._generation + 1,
            this._config
        );

        return [this._head.value, newStack] as const;
    }

    popMany(count: number): readonly [readonly T[], ImmutableStack<T>] {
        const actualCount = Math.min(count, this._size);
        const result: T[] = new Array(actualCount);
        let current = this._head;

        for (let i = 0; i < actualCount && current !== null; i++) {
            result[i] = current.value;
            current = current.next;
        }

        const newStack = new ImmutableStack(
            current,
            createStackSize(this._size - actualCount),
            this._generation + 1,
            this._config
        );

        return [Object.freeze(result), newStack] as const;
    }

    concat<U>(other: ReadonlyStackInterface<U>): ImmutableStack<T | U> {
        const otherValues = other.toReversedArray();
        return otherValues.reduce(
            (stack, value) => stack.push(value),
            this as ImmutableStack<T | U>
        );
    }

    filter<U extends T>(predicate: (value: T) => value is U): ImmutableStack<U> {
        const filtered = this.toReversedArray().filter(predicate);
        return ImmutableStack.fromIterable(filtered, {} as StackConfiguration<U>);
    }

    map<U>(fn: (value: T) => U): ImmutableStack<U> {
        const mapped = this.toReversedArray().map(fn);
        return ImmutableStack.fromIterable(mapped, {} as StackConfiguration<U>);
    }
}

export type {
    StackCapacity,
    StackSize,
    NodeId,
    MemoryAddress,
    AllocatorId,
    PoolIndex,
    StackNode,
    AlignedStackNode,
    StackResult,
    ExtractSuccess,
    ExtractError,
    StackConfiguration,
    StackErrorUnion,
    ReadonlyStackInterface,
    MutableStackInterface,
    ImmutableStackInterface,
    NonEmptyArray,
    EmptyArray,
    ArrayWithLength,
};

export {
    StackCapacityError,
    StackIntegrityError,
    StackMemoryError,
    OptimizedArrayStack,
    ImmutableStack,
    createStackCapacity,
    createStackSize,
    createNodeId,
};
