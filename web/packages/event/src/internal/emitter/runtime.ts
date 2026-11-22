import type { EmitterState } from './state';
import { EventScheduler } from '../../event-scheduler';

export function createScheduler(state: EmitterState): EventScheduler {
    return new EventScheduler({
        concurrencyLimit: state.options.concurrencyLimit,
        gcIntervalMs: 0,
    });
}

export function getScheduler(state: EmitterState): EventScheduler {
    if (state.scheduler === null) {
        state.scheduler = createScheduler(state);
    }
    return state.scheduler;
}

export function ensureRuntime(state: EmitterState): void {
    if (state.isDisposed) {
        throw new Error('EventEmitter has been disposed and cannot be reused');
    }

    if (state.scheduler === null) {
        state.scheduler = createScheduler(state);
    }
}

export async function drainRuntime(
    state: EmitterState,
    options: { maxIterations?: number; timeoutMs?: number } = {}
): Promise<void> {
    const maxIterations = options.maxIterations ?? 1000;
    const timeoutMs = options.timeoutMs ?? 30000;
    const startTime = Date.now();
    let iteration = 0;

    for (;;) {
        if (iteration++ >= maxIterations) {
            throw new Error(`EventEmitter.drain() exceeded max iterations (${maxIterations})`);
        }

        if (Date.now() - startTime > timeoutMs) {
            throw new Error(`EventEmitter.drain() timed out after ${timeoutMs}ms`);
        }

        const currentBufferProcessing = state.bufferProcessing;
        if (currentBufferProcessing) {
            await currentBufferProcessing;
            continue;
        }

        await getScheduler(state).drain();

        if (
            state.bufferProcessing === null &&
            getScheduler(state).activeCount === 0 &&
            getScheduler(state).queuedCount === 0
        ) {
            break;
        }
    }
}
