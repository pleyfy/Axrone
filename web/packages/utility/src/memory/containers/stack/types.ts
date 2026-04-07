export type Brand<T, B extends string> = T & { readonly __brand?: B };
export type Nominal<T, N extends string> = T & { readonly __nominal?: N };
// Variance is a phantom type marker used for documentation and compile-time checks.
export type Variance<T, V extends 'in' | 'out' | 'invariant'> = T & { readonly __variance?: V };
export type Phantom<T, P> = T & { readonly __phantom?: P };

export type StackCapacity = Nominal<number, 'StackCapacity'>;
export type StackSize = Nominal<number, 'StackSize'>;
export type NodeId = Nominal<number, 'NodeId'>;
export type MemoryAddress = Nominal<number, 'MemoryAddress'>;
export type AllocatorId = Nominal<number, 'AllocatorId'>;
export type PoolIndex = Nominal<number, 'PoolIndex'>;

export type NonEmptyArray<T> = readonly [T, ...T[]];
export type EmptyArray = readonly [];
export type ArrayWithLength<T, N extends number> = readonly T[] & { readonly length: N };

export interface StackNode<T> extends Variance<{}, 'out'> {
    readonly id: NodeId;
    readonly value: T;
    readonly next: StackNode<T> | null;
    readonly refs: number;
    readonly generation: number;
    readonly memAddr: MemoryAddress;
}

export interface AlignedStackNode<T> extends StackNode<T> {
    readonly padding: readonly number[];
    readonly checksum: number;
}

export type StackResult<T, E = never> =
    | { readonly tag: 'success'; readonly value: T; readonly cost: number }
    | { readonly tag: 'failure'; readonly error: E; readonly recovery?: () => void };

export type ExtractSuccess<T> = T extends StackResult<infer U, any> ? U : never;
export type ExtractError<T> = T extends StackResult<any, infer E> ? E : never;
