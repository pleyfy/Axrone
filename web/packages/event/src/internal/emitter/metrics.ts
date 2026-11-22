import type { EmitterState, EmitMode, MetricsAccumulator, TimingAccumulator } from './state';
import type { EventMetrics } from '../../interfaces';

export function createTimingAccumulator(): TimingAccumulator {
    return {
        count: 0,
        total: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
    };
}

export function createMetricsAccumulator(): MetricsAccumulator {
    return {
        emit: {
            timing: createTimingAccumulator(),
            sync: createTimingAccumulator(),
            async: createTimingAccumulator(),
            buffered: createTimingAccumulator(),
        },
        execution: {
            ...createTimingAccumulator(),
            errors: 0,
        },
    };
}

export function snapshotTiming(timing: TimingAccumulator): EventMetrics['emit']['timing'] {
    if (timing.count === 0) {
        return {
            avg: 0,
            max: 0,
            min: 0,
            total: 0,
        };
    }

    return {
        avg: timing.total / timing.count,
        max: timing.max,
        min: Number.isFinite(timing.min) ? timing.min : 0,
        total: timing.total,
    };
}

export function determineDominantEmitMode(emit: MetricsAccumulator['emit']): EmitMode {
    const syncCount = emit.sync.count;
    const asyncCount = emit.async.count;
    const bufferedCount = emit.buffered.count;

    if (syncCount >= asyncCount && syncCount >= bufferedCount) {
        return 'sync';
    }
    if (asyncCount >= bufferedCount) {
        return 'async';
    }
    return 'buffered';
}

export function recordEmitMetric(
    state: EmitterState,
    eventName: string,
    duration: number,
    mode: EmitMode
): void {
    if (!state.options.metrics) {
        return;
    }
    const metrics = state.metrics.get(eventName) ?? createMetricsAccumulator();
    state.metrics.set(eventName, metrics);
    updateTiming(metrics.emit[mode], duration);
    if (mode !== 'buffered') {
        updateTiming(metrics.emit.timing, duration);
    }
}

export function recordExecutionMetric(
    state: EmitterState,
    eventName: string,
    duration: number,
    isError: boolean
): void {
    if (!state.options.metrics) {
        return;
    }
    const metrics = state.metrics.get(eventName) ?? createMetricsAccumulator();
    state.metrics.set(eventName, metrics);
    updateTiming(metrics.execution, duration);

    if (isError) {
        metrics.execution.errors += 1;
    }
}

export function updateTiming(timing: TimingAccumulator, duration: number): void {
    timing.count += 1;
    timing.total += duration;
    timing.max = Math.max(timing.max, duration);
    timing.min = Math.min(timing.min, duration);
}

export function getEventMetrics(state: EmitterState, eventName: string): EventMetrics {
    const metrics = state.metrics.get(eventName);

    if (!metrics) {
        return {
            emit: {
                count: 0,
                mode: 'sync',
                timing: snapshotTiming(createTimingAccumulator()),
            },
            execution: {
                count: 0,
                errors: 0,
                timing: snapshotTiming(createTimingAccumulator()),
            },
        };
    }

    return {
        emit: {
            count: metrics.emit.sync.count + metrics.emit.async.count + metrics.emit.buffered.count,
            mode: determineDominantEmitMode(metrics.emit),
            timing: snapshotTiming(metrics.emit.timing),
        },
        execution: {
            count: metrics.execution.count,
            errors: metrics.execution.errors,
            timing: snapshotTiming(metrics.execution),
        },
    };
}

export function resetMetrics(state: EmitterState, eventName?: string): void {
    if (eventName) {
        state.metrics.delete(eventName);
    } else {
        state.metrics.clear();
    }
}

export function pruneStaleMetrics(state: EmitterState): void {
    for (const [eventName] of state.metrics.entries()) {
        if (!state.events.has(eventName) && !state.buffer.has(eventName)) {
            state.metrics.delete(eventName);
        }
    }
}
