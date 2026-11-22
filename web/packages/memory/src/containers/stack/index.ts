export { Stack } from './stack';
export { ChunkedStackIterator } from './iterator';
export {
    StackUnderflowError,
    StackOverflowError,
    StackDisposedError,
    StackAbortError,
    type StackError,
} from './errors';
export {
    type StackCapacity,
    type StackSize,
    type StackId,
    assertStackCapacity,
    assertStackId,
    generateStackId,
    LIFECYCLE_ACTIVE,
    LIFECYCLE_DISPOSED,
    type Lifecycle,
    type IStackMetricsSink,
    MonomorphicNoOpMetricsSink,
    CHUNK_SIZE,
    CHUNK_MASK,
    CHUNK_SHIFT,
    MAX_POOLED_CHUNKS,
    HYSTERESIS_THRESHOLD,
} from './types';
export { ChunkPool, StackChunkPoolAdapter, type ChunkPoolOptions } from './pool-adapter';
