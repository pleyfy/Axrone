import { TaskPriority } from '../../event-scheduler';
import type { EventCallback, EventOptions, EventPriority } from '../../definition';
import type { QueuedEvent } from '../../interfaces';
import type { EventScheduler } from '../../event-scheduler';
import type { EventTap } from '../../internals';

export type InternalCallback<T> = EventCallback<T> | WeakRef<EventCallback<T>>;

export interface InternalSubscription<T = unknown> {
    readonly id: symbol;
    readonly event: string;
    readonly once: boolean;
    readonly priority: EventPriority;
    readonly createdAt: number;
    readonly weak: boolean;
    readonly callback: InternalCallback<T>;
    readonly unregisterToken?: object;
    lastExecuted?: number;
    executionCount: number;
    disposed: boolean;
}

export interface ListenerBucket {
    readonly high: InternalSubscription<any>[];
    readonly normal: InternalSubscription<any>[];
    readonly low: InternalSubscription<any>[];
    size: number;
}

export interface BufferedBucket {
    readonly high: QueuedEvent<any>[];
    readonly normal: QueuedEvent<any>[];
    readonly low: QueuedEvent<any>[];
    size: number;
}

export interface TimingAccumulator {
    count: number;
    total: number;
    min: number;
    max: number;
}

export type EmitMode = 'sync' | 'async' | 'buffered';

export interface MetricsAccumulator {
    emit: {
        timing: TimingAccumulator;
        sync: TimingAccumulator;
        async: TimingAccumulator;
        buffered: TimingAccumulator;
    };
    execution: TimingAccumulator & { errors: number };
}

export interface EmitterState {
    options: Required<EventOptions>;
    events: Map<string, ListenerBucket>;
    subscriptionIndex: Map<symbol, InternalSubscription<any>>;
    metrics: Map<string, MetricsAccumulator>;
    buffer: Map<string, BufferedBucket>;
    scheduler: EventScheduler | null;
    bufferedEventId: number;
    bufferedEventCount: number;
    isPaused: boolean;
    isDisposed: boolean;
    gcIntervalId?: ReturnType<typeof setInterval>;
    weakRegistry?: FinalizationRegistry<symbol>;
    tapListeners: Set<EventTap>;
    bufferProcessing: Promise<void> | null;
    emitDepth: Map<string, number>;
    warnedEvents: Set<string>;
}

export const MAX_EMIT_DEPTH = 32;

export const PRIORITY_ORDER = ['high', 'normal', 'low'] as const;

export const PRIORITY_TO_TASK_PRIORITY = Object.freeze({
    high: TaskPriority.HIGH,
    normal: TaskPriority.NORMAL,
    low: TaskPriority.LOW,
} satisfies Readonly<Record<EventPriority, TaskPriority>>);

export function createListenerBucket(): ListenerBucket {
    return {
        high: [],
        normal: [],
        low: [],
        size: 0,
    };
}

export function createEmitterState(options: Required<EventOptions>): EmitterState {
    return {
        options,
        events: new Map<string, ListenerBucket>(),
        subscriptionIndex: new Map<symbol, InternalSubscription<any>>(),
        metrics: new Map<string, MetricsAccumulator>(),
        buffer: new Map<string, BufferedBucket>(),
        scheduler: null,
        bufferedEventId: 0,
        bufferedEventCount: 0,
        isPaused: false,
        isDisposed: false,
        tapListeners: new Set<EventTap>(),
        bufferProcessing: null,
        emitDepth: new Map<string, number>(),
        warnedEvents: new Set<string>(),
    };
}
