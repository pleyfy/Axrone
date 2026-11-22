import type { Brand } from '@axrone/utility';

export type StackCapacity = Brand<number, "StackCapacity">;
export type StackSize = Brand<number, "StackSize">;
export type StackId = Brand<string, "StackId">;

export function assertStackCapacity(value: number): asserts value is StackCapacity {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`Capacity must be a positive safe integer. Received: ${value}`);
    }
}

export function assertStackId(value: string): asserts value is StackId {
    if (value.length === 0) {
        throw new RangeError("Stack identifier cannot be empty.");
    }
}

let globalStackSequence = 0;
export function generateStackId(): StackId {
    globalStackSequence = (globalStackSequence + 1) | 0;
    const candidate = `stk_${Date.now().toString(36)}_${globalStackSequence.toString(36)}`;
    assertStackId(candidate);
    return candidate;
}

export const LIFECYCLE_ACTIVE = 0 as const;
export const LIFECYCLE_DISPOSED = 1 as const;
export type Lifecycle = typeof LIFECYCLE_ACTIVE | typeof LIFECYCLE_DISPOSED;

export interface IStackMetricsSink {
    onPush(): void;
    onPop(): void;
    onChunkAllocated(): void;
    onChunkDeallocated(): void;
}

export const MonomorphicNoOpMetricsSink: Readonly<IStackMetricsSink> = Object.freeze({
    onPush(): void {},
    onPop(): void {},
    onChunkAllocated(): void {},
    onChunkDeallocated(): void {},
});

export const CHUNK_SIZE = 64 as const;
export const CHUNK_MASK = 63 as const;
export const CHUNK_SHIFT = 6 as const;
export const MAX_POOLED_CHUNKS = 4 as const;
export const HYSTERESIS_THRESHOLD = 2 as const;
