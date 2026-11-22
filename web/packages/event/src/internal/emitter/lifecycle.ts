import { pruneStaleMetrics } from './metrics';
import { resolveCallback, removeAllListeners } from './subscriptions';
import { clearBuffer, pruneEmptyBufferBuckets } from './buffer';
import { clearTaps } from './taps';
import type { EmitterState } from './state';
import type { EmitterHost } from './host';
import type { EventMap } from '../../definition';

export function initWeakRegistry<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>
): void {
    if (
        state.options.weakReferences &&
        typeof WeakRef === 'function' &&
        typeof FinalizationRegistry === 'function'
    ) {
        state.weakRegistry = new FinalizationRegistry((subscriptionId: symbol) => {
            host.offById(subscriptionId);
        });
    }
}

export function startGc(state: EmitterState): void {
    if (state.gcIntervalId) {
        clearInterval(state.gcIntervalId);
    }

    state.gcIntervalId = setInterval(() => {
        runGc(state);
    }, state.options.gcIntervalMs);

    if (
        typeof state.gcIntervalId === 'object' &&
        state.gcIntervalId !== null &&
        'unref' in state.gcIntervalId
    ) {
        (state.gcIntervalId as any).unref();
    }
}

export function runGc(state: EmitterState): void {
    if (state.options.weakReferences) {
        for (const subscription of state.subscriptionIndex.values()) {
            resolveCallback(state, subscription);
        }
    }

    pruneStaleMetrics(state);

    pruneEmptyBufferBuckets(state);

    state.scheduler?.runGarbageCollection(state.options.gcIntervalMs);
}

export function initEmitterRuntime<T extends EventMap>(
    state: EmitterState,
    host: EmitterHost<T>
): void {
    initWeakRegistry(state, host);

    if (state.options.gcIntervalMs > 0) {
        startGc(state);
    }
}

export function disposeRuntime(state: EmitterState): void {
    if (state.gcIntervalId) {
        clearInterval(state.gcIntervalId);
        state.gcIntervalId = undefined;
    }

    if (state.scheduler) {
        state.scheduler.dispose();
        state.scheduler = null;
    }

    removeAllListeners(state);
    clearBuffer(state);
    state.metrics.clear();
    clearTaps(state);
    state.bufferProcessing = null;
    state.isPaused = false;
    state.isDisposed = true;
}
