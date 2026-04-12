import {
    EventMap,
    EventOptions,
    UnsubscribeFn,
    EventPriority,
    EventCallback,
    EventKey,
    EventDispatchItem,
} from './definition';
import { EventError } from './errors';
import { IEventEmitter, EventEmitter } from './event-emitter';
import { SubscriptionOptions, Subscription, QueuedEvent, IEventPublisher } from './interfaces';
import { EVENT_EMITTER_TAP, hasEventTapSupport } from './internals';

export type EventMapOf<E> = E extends IEventEmitter<infer M> ? M : EventMap;

export type FilteredEventMap<M extends EventMap, K extends keyof M> = Pick<M, K & string>;

export type NamespacedEventMap<P extends string, M extends EventMap> = {
    [K in keyof M as `${P}:${string & K}`]: M[K];
};

export type MergedEventMap<Maps extends EventMap[]> = Maps extends [infer First, ...infer Rest]
    ? First extends EventMap
        ? Rest extends EventMap[]
            ? First & MergedEventMap<Rest>
            : First
        : {}
    : {};

export type EventTransformer<SrcMap extends EventMap, DestMap extends EventMap> = {
    [K in EventKey<SrcMap>]?: (data: SrcMap[K]) => DestMap[EventKey<DestMap>];
};

export type ExcludeEventsMap<M extends EventMap, K extends keyof M> = Pick<M, Exclude<keyof M, K>>;

type PriorityStacks = Map<string, EventPriority[]>;

function bindCleanup<T extends EventMap>(target: IEventEmitter<T>, cleanup: () => void): void {
    const baseDispose = target.dispose.bind(target);
    let disposed = false;

    target.dispose = () => {
        if (disposed) {
            return;
        }

        disposed = true;
        cleanup();
        baseDispose();
    };
}

function releaseAll(unsubscribers: Iterable<UnsubscribeFn>): void {
    for (const unsubscribe of unsubscribers) {
        unsubscribe();
    }
}

function toVoid(promise: Promise<unknown>): Promise<void> {
    return promise.then(() => undefined);
}

function isSchedulerLifecycleError(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.message === 'Scheduler disposed' || error.message === 'Scheduler has been disposed')
    );
}

function rethrowAsync(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));

    if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => {
            throw failure;
        });
        return;
    }

    void Promise.resolve().then(() => {
        throw failure;
    });
}

function detachPromise(promise: Promise<unknown>): void {
    void promise.catch((error) => {
        if (!isSchedulerLifecycleError(error)) {
            rethrowAsync(error);
        }
    });
}

function pushPriority(stacks: PriorityStacks, eventName: string, priority: EventPriority): void {
    const stack = stacks.get(eventName);

    if (stack) {
        stack.push(priority);
        return;
    }

    stacks.set(eventName, [priority]);
}

function popPriority(stacks: PriorityStacks, eventName: string): void {
    const stack = stacks.get(eventName);
    if (!stack) {
        return;
    }

    stack.pop();

    if (stack.length === 0) {
        stacks.delete(eventName);
    }
}

function peekPriority(stacks: PriorityStacks, eventName: string): EventPriority | undefined {
    const stack = stacks.get(eventName);
    return stack ? stack[stack.length - 1] : undefined;
}

function trackPriorities(
    emitter: IEventEmitter<any>,
    stacks: PriorityStacks
): UnsubscribeFn | undefined {
    if (!hasEventTapSupport(emitter)) {
        return undefined;
    }

    return emitter[EVENT_EMITTER_TAP]((context) => {
        if (context.phase === 'start') {
            pushPriority(stacks, context.event, context.priority);
        } else {
            popPriority(stacks, context.event);
        }
    });
}

export function createEmitter<T extends EventMap = EventMap>(
    options?: EventOptions
): IEventEmitter<T> {
    return new EventEmitter<T>(options);
}

export function createTypedEmitter<T extends EventMap>(): IEventEmitter<T> {
    return new EventEmitter<T>();
}

export function isEventEmitter(value: unknown): value is IEventEmitter {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as any).on === 'function' &&
        typeof (value as any).emit === 'function' &&
        typeof (value as any).off === 'function'
    );
}

export function filterEvents<T extends EventMap, K extends keyof T & string>(
    source: IEventEmitter<T>,
    allowedEvents: ReadonlyArray<K>,
    options?: {
        passthroughErrors?: boolean;
    }
): IEventEmitter<FilteredEventMap<T, K>> {
    type TargetMap = FilteredEventMap<T, K>;
    type TargetKey = EventKey<TargetMap>;

    const target = new EventEmitter<TargetMap>();
    const unsubscribers = new Map<string, UnsubscribeFn>();
    const allowedEventsSet = new Set<string>(allowedEvents as ReadonlyArray<string>);

    if (options?.passthroughErrors && !allowedEventsSet.has('error' as any)) {
        allowedEventsSet.add('error' as any);
    }

    for (const event of allowedEventsSet) {
        unsubscribers.set(
            event,
            source.on(event as EventKey<T>, (data) =>
                toVoid(target.emit(event as TargetKey, data as any))
            )
        );
    }

    const originalEmit = target.emit.bind(target) as IEventEmitter<TargetMap>['emit'];
    target.emit = async function <E extends TargetKey>(
        event: E,
        data: TargetMap[E],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        if (!allowedEventsSet.has(event)) {
            return false;
        }
        return originalEmit(event as TargetKey, data as TargetMap[TargetKey], options);
    };

    const originalEmitSync = target.emitSync.bind(target) as IEventEmitter<TargetMap>['emitSync'];
    target.emitSync = function <E extends TargetKey>(
        event: E,
        data: TargetMap[E],
        options?: { priority?: EventPriority }
    ): boolean {
        if (!allowedEventsSet.has(event)) {
            return false;
        }
        return originalEmitSync(event as TargetKey, data as TargetMap[TargetKey], options);
    };

    bindCleanup(target, () => {
        releaseAll(unsubscribers.values());
        unsubscribers.clear();
    });

    return target;
}

export function excludeEvents<T extends EventMap, K extends keyof T & string>(
    source: IEventEmitter<T>,
    excludedEvents: ReadonlyArray<K>
): IEventEmitter<ExcludeEventsMap<T, K>> {
    type TargetMap = ExcludeEventsMap<T, K>;
    type TargetKey = EventKey<TargetMap>;

    const target = new EventEmitter<TargetMap>();
    const excludedEventsSet = new Set<string>(excludedEvents as ReadonlyArray<string>);
    const unsubscribers = new Map<string, UnsubscribeFn>();
    const forwardedEvents = new Set<string>();

    const setupForwarding = (event: string) => {
        if (!excludedEventsSet.has(event as any) && !forwardedEvents.has(event)) {
            forwardedEvents.add(event);
            unsubscribers.set(
                event,
                source.on(event as EventKey<T>, (data) =>
                    toVoid(target.emit(event as TargetKey, data as any))
                )
            );
        }
    };

    source.eventNames().forEach(setupForwarding);

    const originalTargetOn = target.on.bind(target) as IEventEmitter<TargetMap>['on'];
    target.on = function <E extends TargetKey>(
        event: E,
        callback: EventCallback<TargetMap[E]>,
        options?: SubscriptionOptions
    ): UnsubscribeFn {
        setupForwarding(event);
        return originalTargetOn(event as TargetKey, callback as EventCallback<TargetMap[TargetKey]>, options);
    };

    const originalTargetOnce = target.once.bind(target) as IEventEmitter<TargetMap>['once'];
    target.once = function <E extends TargetKey>(
        event: E,
        callback: EventCallback<TargetMap[E]>,
        options?: Omit<SubscriptionOptions, 'once'>
    ): UnsubscribeFn {
        setupForwarding(event);
        return originalTargetOnce(
            event as TargetKey,
            callback as EventCallback<TargetMap[TargetKey]>,
            options
        );
    };

    const originalEmit = target.emit.bind(target) as IEventEmitter<TargetMap>['emit'];
    target.emit = async function <E extends TargetKey>(
        event: E,
        data: TargetMap[E],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        if (excludedEventsSet.has(event)) {
            return false;
        }

        return originalEmit(event as TargetKey, data as TargetMap[TargetKey], options);
    };

    const originalEmitSync = target.emitSync.bind(target) as IEventEmitter<TargetMap>['emitSync'];
    target.emitSync = function <E extends TargetKey>(
        event: E,
        data: TargetMap[E],
        options?: { priority?: EventPriority }
    ): boolean {
        if (excludedEventsSet.has(event)) {
            return false;
        }

        return originalEmitSync(event as TargetKey, data as TargetMap[TargetKey], options);
    };

    bindCleanup(target, () => {
        releaseAll(unsubscribers.values());
        unsubscribers.clear();
        forwardedEvents.clear();
    });

    return target as IEventEmitter<ExcludeEventsMap<T, K>>;
}

export function createEventProxy<SrcMap extends EventMap, DestMap extends EventMap>(
    source: IEventEmitter<SrcMap>,
    target: IEventEmitter<DestMap>,
    mapping: Readonly<Partial<Record<EventKey<SrcMap>, EventKey<DestMap>>>>,
    transformers?: EventTransformer<SrcMap, DestMap>,
    options?: {
        preservePriority?: boolean;
        bidirectional?: boolean;
    }
): UnsubscribeFn {
    const unsubscribers: UnsubscribeFn[] = [];
    const proxyingEvents = new Set<string>();

    const sourcePriorities: PriorityStacks = new Map();
    const targetPriorities: PriorityStacks = new Map();

    if (options?.preservePriority) {
        const sourceTracking = trackPriorities(source, sourcePriorities);
        const targetTracking = options.bidirectional
            ? trackPriorities(target, targetPriorities)
            : undefined;

        if (sourceTracking) {
            unsubscribers.push(sourceTracking);
        }

        if (targetTracking) {
            unsubscribers.push(targetTracking);
        }
    }

    for (const [sourceEvent, targetEvent] of Object.entries(mapping) as Array<
        [EventKey<SrcMap>, EventKey<DestMap> | undefined]
    >) {
        if (!targetEvent) {
            continue;
        }

        unsubscribers.push(
            source.on(sourceEvent as EventKey<SrcMap>, async (data: SrcMap[typeof sourceEvent]) => {
                const proxyKey = `src->${sourceEvent}->${targetEvent}`;
                if (proxyingEvents.has(proxyKey)) {
                    return;
                }

                proxyingEvents.add(proxyKey);
                try {
                    const priority: EventPriority | undefined = options?.preservePriority
                        ? peekPriority(sourcePriorities, sourceEvent)
                        : undefined;

                    const transform = transformers?.[sourceEvent as EventKey<SrcMap>] as
                        | ((data: SrcMap[typeof sourceEvent]) => DestMap[EventKey<DestMap>])
                        | undefined;
                    const transformedData = transform ? transform(data) : data;

                    await target.emit(
                        targetEvent as EventKey<DestMap>,
                        transformedData as any,
                        priority ? { priority } : undefined
                    );
                } finally {
                    proxyingEvents.delete(proxyKey);
                }
            })
        );
    }

    if (options?.bidirectional) {
        const reverseMapping: Record<string, string> = {};
        for (const [src, dest] of Object.entries(mapping)) {
            if (dest) {
                reverseMapping[dest] = src;
            }
        }

        for (const targetEvent of Object.keys(reverseMapping) as Array<EventKey<DestMap>>) {
            const sourceEvent = reverseMapping[targetEvent] as EventKey<SrcMap>;

            unsubscribers.push(
                target.on(targetEvent as EventKey<DestMap>, async (data: DestMap[typeof targetEvent]) => {
                    const proxyKey = `dest->${targetEvent}->${sourceEvent}`;
                    if (proxyingEvents.has(proxyKey)) {
                        return;
                    }

                    proxyingEvents.add(proxyKey);
                    try {
                        const priority: EventPriority | undefined = options?.preservePriority
                            ? peekPriority(targetPriorities, targetEvent)
                            : undefined;

                        await source.emit(
                            sourceEvent as EventKey<SrcMap>,
                            data as any,
                            priority ? { priority } : undefined
                        );
                    } finally {
                        proxyingEvents.delete(proxyKey);
                    }
                })
            );
        }
    }

    return () => {
        let result = true;
        for (const unsub of unsubscribers) {
            if (!unsub()) {
                result = false;
            }
        }
        return result;
    };
}

export function mergeEmitters<T extends ReadonlyArray<IEventEmitter<any>>>(
    ...emitters: T
): IEventEmitter<
    MergedEventMap<
        [
            ...{
                [K in keyof T]: EventMapOf<T[K]>;
            },
        ]
    >
> {
    const merged = new EventEmitter<any>();
    const unsubscribers: UnsubscribeFn[] = [];
    const lazyForwarders = new Map<string, UnsubscribeFn[]>();
    const fallbackEmitters = emitters.filter((emitter) => !hasEventTapSupport(emitter));

    for (const emitter of emitters) {
        if (!hasEventTapSupport(emitter)) {
            continue;
        }

        unsubscribers.push(
            emitter[EVENT_EMITTER_TAP]((context) => {
                if (context.phase === 'start') {
                    detachPromise(
                        merged.emit(context.event as any, context.data as any, {
                            priority: context.priority,
                        })
                    );
                }
            })
        );
    }

    const ensureFallbackForwarding = (eventName: string): void => {
        if (fallbackEmitters.length === 0 || lazyForwarders.has(eventName)) {
            return;
        }

        const eventUnsubscribers = fallbackEmitters.map((emitter) =>
            emitter.on(eventName as any, (data) => toVoid(merged.emit(eventName as any, data)))
        );

        lazyForwarders.set(eventName, eventUnsubscribers);
    };

    const originalOn = merged.on.bind(merged);
    merged.on = function <K extends string>(
        event: K,
        callback: EventCallback<any>,
        options?: SubscriptionOptions
    ): UnsubscribeFn {
        ensureFallbackForwarding(event);
        return originalOn(event, callback, options);
    };

    const originalOnce = merged.once.bind(merged);
    merged.once = function <K extends string>(
        event: K,
        callback: EventCallback<any>,
        options?: Omit<SubscriptionOptions, 'once'>
    ): UnsubscribeFn {
        ensureFallbackForwarding(event);
        return originalOnce(event, callback, options);
    };

    bindCleanup(merged, () => {
        releaseAll(unsubscribers);

        for (const eventUnsubscribers of lazyForwarders.values()) {
            releaseAll(eventUnsubscribers);
        }

        lazyForwarders.clear();
    });

    return merged as unknown as IEventEmitter<
        MergedEventMap<
            [
                ...{
                    [K in keyof T]: EventMapOf<T[K]>;
                },
            ]
        >
    >;
}

export function namespaceEvents<Prefix extends string, T extends EventMap>(
    prefix: Prefix,
    source?: IEventEmitter<T>
): IEventEmitter<NamespacedEventMap<Prefix, T>> {
    type SourceKey = EventKey<T>;
    type NamespacedMap = NamespacedEventMap<Prefix, T>;
    type NamespacedKey = EventKey<NamespacedMap>;

    const actualSource = source ?? new EventEmitter<T>();
    const ownsSource = source === undefined;
    const prefixValue = `${prefix}:`;

    const resolveSourceEvent = (event: NamespacedKey): SourceKey => {
        const eventName = String(event);

        if (!eventName.startsWith(prefixValue)) {
            throw new EventError(`Event "${eventName}" must start with namespace "${prefixValue}"`);
        }

        return eventName.slice(prefixValue.length) as SourceKey;
    };

    const createNamespacedEvent = (event: SourceKey): NamespacedKey => {
        return `${prefix}:${event}` as NamespacedKey;
    };

    const namespaced = {
        get maxListeners() {
            return actualSource.maxListeners;
        },
        set maxListeners(value: number) {
            actualSource.maxListeners = value;
        },
        on<K extends NamespacedKey>(
            event: K,
            callback: EventCallback<NamespacedMap[K]>,
            options?: SubscriptionOptions
        ): UnsubscribeFn {
            return actualSource.on(resolveSourceEvent(event) as SourceKey, callback as any, options);
        },
        once<K extends NamespacedKey>(
            event: K,
            callback: EventCallback<NamespacedMap[K]>,
            options?: Omit<SubscriptionOptions, 'once'>
        ): UnsubscribeFn {
            return actualSource.once(resolveSourceEvent(event) as SourceKey, callback as any, options);
        },
        off<K extends NamespacedKey>(
            event: K,
            callback?: EventCallback<NamespacedMap[K]>
        ): boolean {
            return actualSource.off(resolveSourceEvent(event) as SourceKey, callback as any);
        },
        offById(subscriptionId: symbol): boolean {
            return actualSource.offById(subscriptionId);
        },
        pipe<K extends NamespacedKey>(
            event: K,
            emitter: IEventPublisher<any>,
            targetEvent?: string
        ): UnsubscribeFn {
            return actualSource.on(resolveSourceEvent(event) as SourceKey, (data) => {
                return toVoid(emitter.emit((targetEvent ?? event) as any, data));
            });
        },
        emit<K extends NamespacedKey>(
            event: K,
            data: NamespacedMap[K],
            options?: { priority?: EventPriority }
        ): Promise<boolean> {
            return actualSource.emit(resolveSourceEvent(event) as SourceKey, data as any, options);
        },
        emitSync<K extends NamespacedKey>(
            event: K,
            data: NamespacedMap[K],
            options?: { priority?: EventPriority }
        ): boolean {
            return actualSource.emitSync(resolveSourceEvent(event) as SourceKey, data as any, options);
        },
        emitBatch(events: ReadonlyArray<EventDispatchItem<NamespacedMap>>): Promise<boolean[]> {
            return actualSource.emitBatch(
                events.map(({ event, data, priority }) => ({
                    event: resolveSourceEvent(event as NamespacedKey) as SourceKey,
                    data: data as unknown as T[SourceKey],
                    priority,
                })) as unknown as ReadonlyArray<EventDispatchItem<T>>
            );
        },
        has<K extends NamespacedKey>(event: K): boolean {
            return actualSource.has(resolveSourceEvent(event) as SourceKey);
        },
        listenerCount<K extends NamespacedKey>(event: K): number {
            return actualSource.listenerCount(resolveSourceEvent(event) as SourceKey);
        },
        listenerCountAll(): number {
            return actualSource.listenerCountAll();
        },
        eventNames(): NamespacedKey[] {
            return actualSource.eventNames().map((event) => createNamespacedEvent(event as SourceKey));
        },
        getSubscriptions<K extends NamespacedKey>(
            event: K
        ): ReadonlyArray<Subscription<NamespacedMap[K]>> {
            return actualSource
                .getSubscriptions(resolveSourceEvent(event) as SourceKey)
                .map((subscription) => ({
                    ...subscription,
                    event: createNamespacedEvent(subscription.event as SourceKey),
                })) as unknown as ReadonlyArray<Subscription<NamespacedMap[K]>>;
        },
        hasSubscription(subscriptionId: symbol): boolean {
            return actualSource.hasSubscription(subscriptionId);
        },
        getMetrics<K extends NamespacedKey>(event: K) {
            return actualSource.getMetrics(resolveSourceEvent(event) as SourceKey);
        },
        getMemoryUsage(): Record<string, number> {
            return actualSource.getMemoryUsage();
        },
        getQueuedEvents<K extends NamespacedKey>(
            event?: K
        ): ReadonlyArray<QueuedEvent<any>> {
            const queuedEvents = event
                ? actualSource.getQueuedEvents(resolveSourceEvent(event) as SourceKey)
                : actualSource.getQueuedEvents();

            return queuedEvents.map((queuedEvent) => ({
                ...queuedEvent,
                event: createNamespacedEvent(queuedEvent.event as SourceKey),
            }));
        },
        getPendingCount<K extends NamespacedKey>(event?: K): number {
            return event
                ? actualSource.getPendingCount(resolveSourceEvent(event) as SourceKey)
                : actualSource.getPendingCount();
        },
        getBufferSize(): number {
            return actualSource.getBufferSize();
        },
        clearBuffer<K extends NamespacedKey>(event?: K): number {
            return event
                ? actualSource.clearBuffer(resolveSourceEvent(event) as SourceKey)
                : actualSource.clearBuffer();
        },
        pause(): void {
            actualSource.pause();
        },
        resume(): void {
            actualSource.resume();
        },
        isPaused(): boolean {
            return actualSource.isPaused();
        },
        removeAllListeners<K extends NamespacedKey>(event?: K) {
            if (event) {
                actualSource.removeAllListeners(resolveSourceEvent(event) as SourceKey);
            } else {
                actualSource.removeAllListeners();
            }

            return namespaced;
        },
        batchSubscribe<K extends NamespacedKey>(
            event: K,
            callbacks: ReadonlyArray<EventCallback<NamespacedMap[K]>>,
            options?: SubscriptionOptions
        ): ReadonlyArray<symbol> {
            return actualSource.batchSubscribe(resolveSourceEvent(event) as SourceKey, callbacks as any, options);
        },
        batchUnsubscribe(subscriptionIds: ReadonlyArray<symbol>): number {
            return actualSource.batchUnsubscribe(subscriptionIds);
        },
        resetMaxListeners(): void {
            actualSource.resetMaxListeners();
        },
        drain(): Promise<void> {
            return actualSource.drain();
        },
        flush<K extends NamespacedKey>(event: K): Promise<void> {
            return actualSource.flush(resolveSourceEvent(event) as SourceKey);
        },
        resetMetrics<K extends NamespacedKey>(event?: K): void {
            if (event) {
                actualSource.resetMetrics(resolveSourceEvent(event) as SourceKey);
            } else {
                actualSource.resetMetrics();
            }
        },
        dispose(): void {
            if (ownsSource) {
                actualSource.dispose();
            }
        },
    } as unknown as IEventEmitter<NamespacedMap>;

    return namespaced;
}

export class TypedEventRegistry<T extends EventMap> {
    readonly #registry = new Map<EventKey<T>, symbol>();
    readonly #symbolToEvent = new Map<symbol, EventKey<T>>();

    register<K extends EventKey<T>>(event: K): symbol {
        if (this.#registry.has(event)) {
            return this.#registry.get(event)!;
        }
        const symbol = Symbol(event);
        this.#registry.set(event, symbol);
        this.#symbolToEvent.set(symbol, event);
        return symbol;
    }

    getSymbol<K extends EventKey<T>>(event: K): symbol | undefined {
        return this.#registry.get(event);
    }

    getEvent(symbol: symbol): EventKey<T> | undefined {
        return this.#symbolToEvent.get(symbol);
    }

    has<K extends EventKey<T>>(event: K): boolean {
        return this.#registry.has(event);
    }

    hasSymbol(symbol: symbol): boolean {
        return this.#symbolToEvent.has(symbol);
    }

    events(): Array<EventKey<T>> {
        return Array.from(this.#registry.keys());
    }

    symbols(): Array<symbol> {
        return Array.from(this.#symbolToEvent.keys());
    }

    entries(): Array<[EventKey<T>, symbol]> {
        return Array.from(this.#registry.entries());
    }

    clear(): void {
        this.#registry.clear();
        this.#symbolToEvent.clear();
    }
}
