import { createListenerBucket, PRIORITY_ORDER } from './state';
import type { EmitterState, InternalCallback, InternalSubscription, ListenerBucket } from './state';
import type { EventCallback, EventKey, EventMap } from '../../definition';
import type { Subscription, SubscriptionOptions } from '../../interfaces';

export function registerListener<T extends EventMap, K extends EventKey<T>>(
    state: EmitterState,
    event: K,
    callback: EventCallback<T[K]>,
    options: Required<SubscriptionOptions>
): symbol {
    const eventName = String(event);
    let bucket = state.events.get(eventName);

    if (!bucket) {
        bucket = createListenerBucket();
        state.events.set(eventName, bucket);
    }

    if (
        state.options.maxListeners !== Infinity &&
        bucket.size >= state.options.maxListeners &&
        !state.warnedEvents.has(eventName) &&
        (globalThis as { __AXRONE_DEBUG__?: boolean }).__AXRONE_DEBUG__ !== false
    ) {
        state.warnedEvents.add(eventName);
        console.warn(
            `MaxListenersExceededWarning: Possible memory leak detected. ${
                bucket.size
            } listeners added to event "${eventName}". (Further warnings suppressed.)`
        );
    }

    const id = Symbol(eventName);
    let internalCallback: InternalCallback<T[K]> = callback;
    let unregisterToken: object | undefined;
    let weak = false;

    if (state.options.weakReferences && state.weakRegistry) {
        unregisterToken = Object.create(null) as object;
        state.weakRegistry.register(callback as EventCallback<T[K]> & object, id, unregisterToken);
        internalCallback = new WeakRef(callback as EventCallback<T[K]> & object);
        weak = true;
    }

    const subscription: InternalSubscription<T[K]> = {
        id,
        event: eventName,
        callback: internalCallback,
        once: options.once,
        priority: options.priority,
        executionCount: 0,
        createdAt: Date.now(),
        unregisterToken,
        weak,
        disposed: false,
    };

    bucket[options.priority].push(subscription);
    bucket.size += 1;
    state.subscriptionIndex.set(id, subscription);

    return id;
}

export function resolveCallback<TData>(
    state: EmitterState,
    subscription: InternalSubscription<TData>
): EventCallback<TData> | undefined {
    if (!subscription.weak) {
        return subscription.callback as EventCallback<TData>;
    }

    const callback = (subscription.callback as WeakRef<EventCallback<TData>>).deref();

    if (callback) {
        return callback;
    }

    deleteSubscription(state, subscription);
    return undefined;
}

export function deleteSubscription(
    state: EmitterState,
    subscription: InternalSubscription<any>
): boolean {
    subscription.disposed = true;
    const bucket = state.events.get(subscription.event);
    state.subscriptionIndex.delete(subscription.id);

    if (subscription.unregisterToken && state.weakRegistry) {
        state.weakRegistry.unregister(subscription.unregisterToken);
    }

    if (!bucket) {
        return false;
    }

    const records = bucket[subscription.priority];

    for (let index = 0; index < records.length; index++) {
        if (records[index] === subscription) {
            records.splice(index, 1);
            bucket.size -= 1;

            if (bucket.size === 0) {
                state.events.delete(subscription.event);
            }

            return true;
        }
    }

    if (bucket.size === 0) {
        state.events.delete(subscription.event);
    }

    return false;
}

export function clearBucket(state: EmitterState, eventName: string, bucket: ListenerBucket): void {
    for (const priority of PRIORITY_ORDER) {
        const records = bucket[priority];

        for (let index = 0; index < records.length; index++) {
            const subscription = records[index]!;
            state.subscriptionIndex.delete(subscription.id);

            if (subscription.unregisterToken && state.weakRegistry) {
                state.weakRegistry.unregister(subscription.unregisterToken);
            }
        }

        records.length = 0;
    }

    bucket.size = 0;
    state.events.delete(eventName);
}

export function snapshotListeners(state: EmitterState, eventName: string): InternalSubscription<any>[] {
    const bucket = state.events.get(eventName);
    if (!bucket || bucket.size === 0) {
        return [];
    }

    const snapshot = new Array<InternalSubscription<any>>(bucket.size);
    let offset = 0;
    offset = copyLiveSubscriptions(state, bucket.high, snapshot, offset);
    offset = copyLiveSubscriptions(state, bucket.normal, snapshot, offset);
    offset = copyLiveSubscriptions(state, bucket.low, snapshot, offset);

    snapshot.length = offset;
    return snapshot;
}

export function copyLiveSubscriptions(
    state: EmitterState,
    source: InternalSubscription<any>[],
    target: InternalSubscription<any>[],
    offset: number
): number {
    for (let index = 0; index < source.length; ) {
        const subscription = source[index]!;

        if (!resolveCallback(state, subscription)) {
            index += 1;
            continue;
        }

        target[offset] = subscription;
        offset += 1;
        index += 1;
    }

    return offset;
}

export function removeOnceSubscriptions(
    state: EmitterState,
    snapshot: ReadonlyArray<InternalSubscription<any>>
): void {
    for (let index = 0; index < snapshot.length; index++) {
        const subscription = snapshot[index]!;
        if (subscription.once) {
            deleteSubscription(state, subscription);
        }
    }
}

export function appendPublicSubscriptions<TData>(
    state: EmitterState,
    source: InternalSubscription<any>[],
    target: Subscription<TData>[]
): void {
    for (let index = 0; index < source.length; ) {
        const subscription = source[index]!;
        const callback = resolveCallback(state, subscription);

        if (!callback) {
            continue;
        }

        target.push({
            id: subscription.id,
            event: subscription.event,
            callback,
            once: subscription.once,
            priority: subscription.priority,
            createdAt: subscription.createdAt,
            lastExecuted: subscription.lastExecuted,
            executionCount: subscription.executionCount,
        });
        index += 1;
    }
}

export function hasListeners(state: EmitterState, eventName: string): boolean {
    const bucket = state.events.get(eventName);
    if (!bucket) {
        return false;
    }
    return bucket.size > 0;
}

export function hasEvent(state: EmitterState, eventName: string): boolean {
    const bucket = state.events.get(eventName);
    return bucket !== undefined && bucket.size > 0;
}

export function hasSubscription(state: EmitterState, subscriptionId: symbol): boolean {
    return state.subscriptionIndex.has(subscriptionId);
}

export function getListenerCount(state: EmitterState, eventName: string): number {
    return state.events.get(eventName)?.size ?? 0;
}

export function getListenerCountAll(state: EmitterState): number {
    return state.subscriptionIndex.size;
}

export function getEventNames<T extends EventMap>(state: EmitterState): EventKey<T>[] {
    return Array.from(state.events.keys()) as EventKey<T>[];
}

export function getSubscriptions<TData>(
    state: EmitterState,
    eventName: string
): ReadonlyArray<Subscription<TData>> {
    const bucket = state.events.get(eventName);
    if (!bucket || bucket.size === 0) {
        return [];
    }

    const subscriptions: Subscription<TData>[] = [];
    appendPublicSubscriptions(state, bucket.high, subscriptions);
    appendPublicSubscriptions(state, bucket.normal, subscriptions);
    appendPublicSubscriptions(state, bucket.low, subscriptions);
    return subscriptions;
}

export function removeListenerByCallback(
    state: EmitterState,
    eventName: string,
    callback?: EventCallback<any>
): boolean {
    const bucket = state.events.get(eventName);

    if (!bucket || bucket.size === 0) {
        return false;
    }

    if (!callback) {
        clearBucket(state, eventName, bucket);
        return true;
    }

    let removed = false;

    for (const priority of PRIORITY_ORDER) {
        const records = bucket[priority];

        for (let index = records.length - 1; index >= 0; index--) {
            const record = records[index]!;
            const currentCallback = resolveCallback(state, record);

            if (currentCallback === callback) {
                deleteSubscription(state, record);
                removed = true;
            }
        }
    }

    return removed;
}

export function removeSubscriptionById(state: EmitterState, subscriptionId: symbol): boolean {
    const subscription = state.subscriptionIndex.get(subscriptionId);
    if (!subscription) {
        return false;
    }

    return deleteSubscription(state, subscription);
}

export function removeAllListenersForEvent(state: EmitterState, eventName: string): void {
    const bucket = state.events.get(eventName);
    if (bucket) {
        clearBucket(state, eventName, bucket);
    }
}

export function removeAllListeners(state: EmitterState): void {
    for (const [eventName, bucket] of state.events.entries()) {
        clearBucket(state, eventName, bucket);
    }
}
