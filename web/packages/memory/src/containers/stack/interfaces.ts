import { StackIntegrityError, StackCapacityError } from './errors';
import { Variance, StackSize, StackCapacity, StackResult } from './types';

export interface StackConfiguration<T> {
    readonly capacity?: number;
    readonly enablePooling?: boolean;
    readonly enableAlignment?: boolean;
    readonly enableIntegrityChecks?: boolean;
    readonly cachePolicy?: 'lru' | 'lfu' | 'none';
    readonly serializationStrategy?: 'json' | 'binary' | 'custom';
    readonly compareFn?: (a: T, b: T) => boolean;
    readonly hashFn?: (value: T) => number;
    readonly serializeFn?: (value: T) => ArrayBuffer;
    readonly deserializeFn?: (data: ArrayBuffer) => T;
    readonly validateFn?: (value: T) => boolean;
    readonly transformFn?: (value: T) => T;
}

export interface ReadonlyStackInterface<out T> extends Iterable<T>, Variance<{}, 'out'> {
    readonly size: StackSize;
    readonly capacity: StackCapacity | null;
    readonly isEmpty: boolean;
    readonly isFull: boolean;
    readonly generation: number;
    readonly checksum: number;

    peek(): StackResult<T | undefined>;
    peekUnsafe(): T | undefined;
    peekMany(count: number): StackResult<readonly T[], StackIntegrityError>;
    contains(value: T): boolean;
    indexOf(value: T): number;
    toArray(): readonly T[];
    toReversedArray(): readonly T[];
    slice(start?: number, end?: number): readonly T[];
    serialize(): ArrayBuffer;
    equals(other: ReadonlyStackInterface<T>): boolean;
    hash(): number;
    validate(): StackResult<boolean, StackIntegrityError>;
}

export interface MutableStackInterface<T> extends ReadonlyStackInterface<T> {
    push(value: T): StackResult<this, StackCapacityError>;
    pushUnsafe(value: T): this;
    pushMany(values: readonly T[]): StackResult<this, StackCapacityError>;
    pop(): StackResult<T | undefined>;
    popUnsafe(): T | undefined;
    popMany(count: number): StackResult<readonly T[]>;
    swap(): StackResult<this, StackIntegrityError>;
    duplicate(): StackResult<this, StackCapacityError | StackIntegrityError>;
    clear(): this;
    compact(): this;
    defragment(): Promise<this>;
    dispose(): Promise<void>;
}

export interface ImmutableStackInterface<out T> extends ReadonlyStackInterface<T> {
    push<U extends T>(value: U): ImmutableStackInterface<T | U>;
    pushMany<U extends readonly T[]>(values: U): ImmutableStackInterface<T>;
    pop(): readonly [T | undefined, ImmutableStackInterface<T>];
    popMany(count: number): readonly [readonly T[], ImmutableStackInterface<T>];
    concat<U>(other: ReadonlyStackInterface<U>): ImmutableStackInterface<T | U>;
    filter<U extends T>(predicate: (value: T) => value is U): ImmutableStackInterface<U>;
    map<U>(fn: (value: T) => U): ImmutableStackInterface<U>;
}
