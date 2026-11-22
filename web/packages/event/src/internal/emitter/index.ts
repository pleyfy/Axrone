export type {
    BufferedBucket,
    EmitMode,
    EmitterState,
    InternalCallback,
    InternalSubscription,
    ListenerBucket,
    MetricsAccumulator,
    TimingAccumulator,
} from './state';
export {
    createEmitterState,
    createListenerBucket,
    MAX_EMIT_DEPTH,
    PRIORITY_ORDER,
    PRIORITY_TO_TASK_PRIORITY,
} from './state';

export type { EmitOptions, EmitterHost, EmitterHostTarget } from './host';
export { createEmitterHost } from './host';

export { normalizeOptions } from './options';

export {
    createMetricsAccumulator,
    determineDominantEmitMode,
    getEventMetrics,
    pruneStaleMetrics,
    recordEmitMetric,
    recordExecutionMetric,
    resetMetrics,
    snapshotTiming,
    updateTiming,
} from './metrics';

export {
    appendPublicSubscriptions,
    clearBucket,
    copyLiveSubscriptions,
    deleteSubscription,
    getEventNames,
    getListenerCount,
    getListenerCountAll,
    getSubscriptions,
    hasEvent,
    hasListeners,
    hasSubscription,
    registerListener,
    removeAllListeners,
    removeAllListenersForEvent,
    removeListenerByCallback,
    removeOnceSubscriptions,
    removeSubscriptionById,
    resolveCallback,
    snapshotListeners,
} from './subscriptions';

export {
    clearBuffer,
    copyBufferedEntries,
    createBufferedBucket,
    dropOldestBufferedEvent,
    enqueueBufferedEvent,
    flushBufferedEvent,
    getBufferSize,
    getPendingCount,
    getQueuedEvents,
    pauseEmitter,
    processBufferedEvents,
    pruneEmptyBufferBuckets,
    resumeEmitter,
    snapshotBufferedBucket,
    startBufferedEventProcessing,
} from './buffer';

export { addTap, clearTaps, emitTaps, emitTapsFor } from './taps';

export {
    createScheduler,
    drainRuntime,
    ensureRuntime,
    getScheduler,
} from './runtime';

export {
    handleCapturedErrorAsync,
    handleCapturedErrorSync,
    reportAsyncError,
} from './failure';

export {
    dispatchAsync,
    dispatchBatchItem,
    emitBatch,
    emitInternal,
    emitSyncInternal,
    scheduleDispatch,
} from './dispatch';

export { disposeRuntime, initEmitterRuntime, runGc, startGc } from './lifecycle';
