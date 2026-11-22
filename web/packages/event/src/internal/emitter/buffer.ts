import { PRIORITY_ORDER } from './state';
import { ensureRuntime } from './runtime';
import type { EmitterState, BufferedBucket } from './state';
import type { EmitterHost } from './host';
import type { EventKey, EventMap, EventPriority } from '../../definition';
import type { QueuedEvent } from '../../interfaces';
import { EventQueueFullError } from '../../errors';
import { PRIORITY_VALUES } from '../../definition';

export function createBufferedBucket(): BufferedBucket {
    return {
        high: [],
        normal: [],
        low: [],
        size: 0,
    };
}

export function enqueueBufferedEvent<T extends EventMap>(
    state: EmitterState,
    event: EventKey<T> | string,
    data: T[EventKey<T>],
    priority: EventPriority
): void {
    const eventName = String(event);
    let bucket = state.buffer.get(eventName);

    if (!bucket) {
        bucket = createBufferedBucket();
        state.buffer.set(eventName, bucket);
    }

    if (bucket.size >= state.options.bufferSize) {
        const policy = state.options.bufferOverflow;

        if (policy === 'throw') {
            throw new EventQueueFullError(eventName, state.options.bufferSize);
        }

        if (policy === 'drop-newest') {
            return;
        }

        if (policy === 'drop-oldest') {
            dropOldestBufferedEvent(state, bucket);
        }
    }

    const eventId = ++state.bufferedEventId;
    const queuedEvent: QueuedEvent = {
        id: eventId,
        event: eventName,
        data,
        timestamp: Date.now(),
        priority,
    };

    bucket[priority].push(queuedEvent);
    bucket.size += 1;
    state.bufferedEventCount += 1;
}

export function dropOldestBufferedEvent(state: EmitterState, bucket: BufferedBucket): void {
    for (const priority of PRIORITY_ORDER) {
        const queue = bucket[priority];
        if (queue.length > 0) {
            queue.shift();
            bucket.size -= 1;
            state.bufferedEventCount -= 1;
            return;
        }
    }
}

export async function processBufferedEvents<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>
): Promise<void> {
    if (state.isPaused || state.bufferedEventCount === 0) {
        return;
    }

    const eventNames = Array.from(state.buffer.keys());

    for (const eventName of eventNames) {
        const bucket = state.buffer.get(eventName);
        if (!bucket) continue;

        for (const priority of PRIORITY_ORDER) {
            const queue = bucket[priority];
            const initialLength = queue.length;
            if (initialLength === 0) continue;

            for (let index = 0; index < initialLength; index++) {
                const queuedEvent = queue[index]!;
                await host.emit(queuedEvent.event as EventKey<T>, queuedEvent.data as T[EventKey<T>], {
                    priority: queuedEvent.priority,
                });
            }

            queue.splice(0, initialLength);
            state.bufferedEventCount -= initialLength;
        }

        bucket.size = bucket.high.length + bucket.normal.length + bucket.low.length;

        if (bucket.size === 0) {
            state.buffer.delete(eventName);
        }
    }
}

export function startBufferedEventProcessing<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>
): void {
    if (state.bufferedEventCount === 0 || state.bufferProcessing) {
        return;
    }

    const processing = processBufferedEvents(state, host).finally(() => {
        if (state.bufferProcessing === processing) {
            state.bufferProcessing = null;
        }
    });

    state.bufferProcessing = processing;
}

export function copyBufferedEntries(
    source: ReadonlyArray<QueuedEvent>,
    target: QueuedEvent[],
    offset: number
): number {
    for (let index = 0; index < source.length; index++) {
        target[offset] = source[index]!;
        offset += 1;
    }

    return offset;
}

export function snapshotBufferedBucket(bucket: BufferedBucket): QueuedEvent[] {
    const snapshot = new Array<QueuedEvent>(bucket.size);
    let offset = 0;
    offset = copyBufferedEntries(bucket.high, snapshot, offset);
    offset = copyBufferedEntries(bucket.normal, snapshot, offset);
    copyBufferedEntries(bucket.low, snapshot, offset);
    return snapshot;
}

export function getQueuedEvents<T extends EventMap>(
    state: EmitterState,
    eventName?: string
): ReadonlyArray<QueuedEvent<any>> {
    if (eventName) {
        const bucket = state.buffer.get(eventName);
        return bucket ? snapshotBufferedBucket(bucket) : [];
    }

    if (state.bufferedEventCount === 0) {
        return [];
    }

    const allEvents = new Array<QueuedEvent>(state.bufferedEventCount);
    let offset = 0;

    for (const bucket of state.buffer.values()) {
        offset = copyBufferedEntries(bucket.high, allEvents, offset);
        offset = copyBufferedEntries(bucket.normal, allEvents, offset);
        offset = copyBufferedEntries(bucket.low, allEvents, offset);
    }

    return allEvents.sort((a, b) => {
        const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.id - b.id;
    });
}

export function getPendingCount(state: EmitterState, eventName?: string): number {
    if (eventName) {
        return state.buffer.get(eventName)?.size ?? 0;
    }

    return state.bufferedEventCount;
}

export function getBufferSize(state: EmitterState): number {
    return state.options.bufferSize;
}

export function clearBuffer(state: EmitterState, eventName?: string): number {
    if (eventName) {
        const bucket = state.buffer.get(eventName);
        if (!bucket) return 0;
        const size = bucket.size;
        state.buffer.delete(eventName);
        state.bufferedEventCount -= size;
        return size;
    }

    const total = state.bufferedEventCount;
    state.buffer.clear();
    state.bufferedEventCount = 0;
    return total;
}

export function pauseEmitter(state: EmitterState): void {
    ensureRuntime(state);
    state.isPaused = true;
}

export function resumeEmitter<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>
): void {
    if (!state.isPaused) return;

    ensureRuntime(state);
    state.isPaused = false;

    startBufferedEventProcessing(state, host);
}

export async function flushBufferedEvent<T extends EventMap, K extends EventKey<T>>(
    state: EmitterState,
    host: EmitterHost<T>,
    event: K
): Promise<void> {
    if (state.bufferProcessing) {
        await state.bufferProcessing;
    }

    const eventName = String(event);
    const bucket = state.buffer.get(eventName);
    if (!bucket || bucket.size === 0) return;

    const queuedEvents = snapshotBufferedBucket(bucket);
    state.buffer.delete(eventName);
    state.bufferedEventCount -= queuedEvents.length;

    const wasPaused = state.isPaused;
    state.isPaused = false;

    try {
        for (const queuedEvent of queuedEvents) {
            await host.emit(event, queuedEvent.data as T[K], {
                priority: queuedEvent.priority,
            });
        }
    } finally {
        state.isPaused = wasPaused;
    }
}

export function pruneEmptyBufferBuckets(state: EmitterState): void {
    for (const [eventName, bucket] of state.buffer.entries()) {
        if (bucket.size === 0) {
            state.buffer.delete(eventName);
        }
    }
}
