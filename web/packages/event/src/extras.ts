import {
    EventMap,
    EventOptions,
    UnsubscribeFn,
    EventPriority,
    EventCallback,
    EventKey,
    EventDispatchItem,
    EventDispatchResult,
} from './definition';
import { EventError } from './errors';
import { IEventEmitter, EventEmitter } from './event-emitter';
import { SubscriptionOptions, Subscription, QueuedEvent, IEventPublisher } from './interfaces';
import { EVENT_EMITTER_TAP, hasEventTapSupport } from './internals';
import { rethrowAsync, pipeToEmitter } from './internal/utils';
import { ForwardingEmitter } from './internal/forwarding-emitter';

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

class NamespacedEmitter<Prefix extends string, T extends EventMap>
    extends ForwardingEmitter<NamespacedEventMap<Prefix, T>> {
    readonly #actualSource: IEventEmitter<T>;
    readonly #ownsSource: boolean;
    readonly #prefixValue: string;

    constructor(prefix: Prefix, source: IEventEmitter<T> | undefined) {
        super();
        this.#actualSource = source ?? new EventEmitter<T>();
        this.#ownsSource = source === undefined;
        this.#prefixValue = `${prefix}:`;
    }

    // The public surface uses the namespaced event map, but the wrapped
    // emitter is the original (un-prefixed) source. The cast is the single,
    // deliberate bridging point: every method that touches `target` resolves
    // the event name through `this.#resolveSourceEvent` first, so the runtime
    // contract matches the static signature on this class.
    protected get target(): IEventEmitter<NamespacedEventMap<Prefix, T>> {
        return this.#actualSource as unknown as IEventEmitter<NamespacedEventMap<Prefix, T>>;
    }

    #resolveSourceEvent(
        event: EventKey<NamespacedEventMap<Prefix, T>>
    ): EventKey<T> {
        const eventName = String(event);

        if (!eventName.startsWith(this.#prefixValue)) {
            throw new EventError(
                `Event "${eventName}" must start with namespace "${this.#prefixValue}"`
            );
        }

        return eventName.slice(this.#prefixValue.length) as EventKey<T>;
    }

    #createNamespacedEvent(event: EventKey<T>): EventKey<NamespacedEventMap<Prefix, T>> {
        return `${this.#prefixValue}${event}` as EventKey<NamespacedEventMap<Prefix, T>>;
    }

    on<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        callback: EventCallback<NamespacedEventMap<Prefix, T>[K]>,
        options?: SubscriptionOptions
    ): UnsubscribeFn {
        return this.#actualSource.on(this.#resolveSourceEvent(event), callback as any, options);
    }

    once<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        callback: EventCallback<NamespacedEventMap<Prefix, T>[K]>,
        options?: Omit<SubscriptionOptions, 'once'>
    ): UnsubscribeFn {
        return this.#actualSource.once(this.#resolveSourceEvent(event), callback as any, options);
    }

    off<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        callback?: EventCallback<NamespacedEventMap<Prefix, T>[K]>
    ): boolean {
        return this.#actualSource.off(this.#resolveSourceEvent(event), callback as any);
    }

    pipe<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        emitter: IEventPublisher<any>,
        targetEvent?: string
    ): UnsubscribeFn {
        return pipeToEmitter(
            (callback) => this.#actualSource.on(this.#resolveSourceEvent(event), callback as EventCallback<T[EventKey<T>]>),
            emitter,
            targetEvent ?? (event as string)
        );
    }

    emit<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        data: NamespacedEventMap<Prefix, T>[K],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        return this.#actualSource.emit(this.#resolveSourceEvent(event), data as any, options);
    }

    emitSync<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        data: NamespacedEventMap<Prefix, T>[K],
        options?: { priority?: EventPriority }
    ): boolean {
        return this.#actualSource.emitSync(this.#resolveSourceEvent(event), data as any, options);
    }

    emitBatch(
        events: ReadonlyArray<EventDispatchItem<NamespacedEventMap<Prefix, T>>>
    ): Promise<ReadonlyArray<EventDispatchResult>> {
        return this.#actualSource.emitBatch(
            events.map(({ event, data, priority }) => ({
                event: this.#resolveSourceEvent(event),
                data: data as unknown as T[EventKey<T>],
                priority,
            })) as unknown as ReadonlyArray<EventDispatchItem<T>>
        );
    }

    has<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event: K): boolean {
        return this.#actualSource.has(this.#resolveSourceEvent(event));
    }

    listenerCount<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event: K): number {
        return this.#actualSource.listenerCount(this.#resolveSourceEvent(event));
    }

    eventNames(): EventKey<NamespacedEventMap<Prefix, T>>[] {
        return this.#actualSource
            .eventNames()
            .map((event) => this.#createNamespacedEvent(event));
    }

    getSubscriptions<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K
    ): ReadonlyArray<Subscription<NamespacedEventMap<Prefix, T>[K]>> {
        return this.#actualSource
            .getSubscriptions(this.#resolveSourceEvent(event))
            .map((subscription) => ({
                ...subscription,
                event: this.#createNamespacedEvent(subscription.event as EventKey<T>),
            })) as unknown as ReadonlyArray<Subscription<NamespacedEventMap<Prefix, T>[K]>>;
    }

    getMetrics<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event: K) {
        return this.#actualSource.getMetrics(this.#resolveSourceEvent(event));
    }

    getQueuedEvents<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event?: K
    ): ReadonlyArray<QueuedEvent<any>> {
        const queuedEvents = event
            ? this.#actualSource.getQueuedEvents(this.#resolveSourceEvent(event))
            : this.#actualSource.getQueuedEvents();

        return queuedEvents.map((queuedEvent) => ({
            ...queuedEvent,
            event: this.#createNamespacedEvent(queuedEvent.event as EventKey<T>),
        }));
    }

    getPendingCount<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event?: K): number {
        return event
            ? this.#actualSource.getPendingCount(this.#resolveSourceEvent(event))
            : this.#actualSource.getPendingCount();
    }

    clearBuffer<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event?: K): number {
        return event
            ? this.#actualSource.clearBuffer(this.#resolveSourceEvent(event))
            : this.#actualSource.clearBuffer();
    }

    removeAllListeners<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event?: K): this {
        if (event) {
            this.#actualSource.removeAllListeners(this.#resolveSourceEvent(event));
        } else {
            this.#actualSource.removeAllListeners();
        }

        return this;
    }

    batchSubscribe<K extends EventKey<NamespacedEventMap<Prefix, T>>>(
        event: K,
        callbacks: ReadonlyArray<EventCallback<NamespacedEventMap<Prefix, T>[K]>>,
        options?: SubscriptionOptions
    ): ReadonlyArray<symbol> {
        return this.#actualSource.batchSubscribe(
            this.#resolveSourceEvent(event),
            callbacks as any,
            options
        );
    }

    flush<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event: K): Promise<void> {
        return this.#actualSource.flush(this.#resolveSourceEvent(event));
    }

    resetMetrics<K extends EventKey<NamespacedEventMap<Prefix, T>>>(event?: K): void {
        if (event) {
            this.#actualSource.resetMetrics(this.#resolveSourceEvent(event));
        } else {
            this.#actualSource.resetMetrics();
        }
    }

    dispose(): void {
        if (this.#ownsSource) {
            this.#actualSource.dispose();
        }
    }
}

export function namespaceEvents<Prefix extends string, T extends EventMap>(
    prefix: Prefix,
    source?: IEventEmitter<T>
): IEventEmitter<NamespacedEventMap<Prefix, T>> {
    return new NamespacedEmitter<Prefix, T>(prefix, source);
}
