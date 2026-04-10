import { EventMap, EventOptions, UnsubscribeFn, EventPriority, EventCallback } from './definition';
import { EventError } from './errors';
import { IEventEmitter, EventEmitter } from './event-emitter';
import { SubscriptionOptions } from './interfaces';

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
    [K in keyof SrcMap]?: (data: SrcMap[K]) => DestMap[keyof DestMap];
};

export type ExcludeEventsMap<M extends EventMap, K extends keyof M> = Pick<M, Exclude<keyof M, K>>;

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
    const target = new EventEmitter<FilteredEventMap<T, K>>();
    const unsubscribers: UnsubscribeFn[] = [];
    const allowedEventsSet = new Set(allowedEvents);

    if (options?.passthroughErrors && !allowedEventsSet.has('error' as any)) {
        allowedEventsSet.add('error' as any);
    }

    for (const event of allowedEventsSet) {
        unsubscribers.push(source.on(event, (data) => void target.emit(event, data)));
    }

    const originalEmit = target.emit.bind(target);
    target.emit = async function <E extends keyof FilteredEventMap<T, K> & string>(
        event: E,
        data: FilteredEventMap<T, K>[E],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        if (!allowedEventsSet.has(event as K)) {
            return false;
        }
        return originalEmit(event, data, options);
    };

    const originalEmitSync = target.emitSync.bind(target);
    target.emitSync = function <E extends keyof FilteredEventMap<T, K> & string>(
        event: E,
        data: FilteredEventMap<T, K>[E],
        options?: { priority?: EventPriority }
    ): boolean {
        if (!allowedEventsSet.has(event as K)) {
            return false;
        }
        return originalEmitSync(event, data, options);
    };

    const originalRemoveAllListeners = target.removeAllListeners.bind(target);
    target.removeAllListeners = function <E extends keyof FilteredEventMap<T, K> & string>(
        event?: E
    ): EventEmitter<FilteredEventMap<T, K>> {
        if (event === undefined) {
            unsubscribers.forEach((unsub) => unsub());
        }
        return originalRemoveAllListeners(event) as EventEmitter<FilteredEventMap<T, K>>;
    };

    (target as any).dispose = () => {
        unsubscribers.forEach((unsub) => unsub());
    };

    return target;
}

export function excludeEvents<T extends EventMap, K extends keyof T & string>(
    source: IEventEmitter<T>,
    excludedEvents: ReadonlyArray<K>
): IEventEmitter<ExcludeEventsMap<T, K>> {
    const target = new EventEmitter<ExcludeEventsMap<T, K>>();
    const excludedEventsSet = new Set(excludedEvents);
    const unsubscribers: UnsubscribeFn[] = [];
    const forwardedEvents = new Set<string>();

    const setupForwarding = (event: string) => {
        if (!excludedEventsSet.has(event as any) && !forwardedEvents.has(event)) {
            forwardedEvents.add(event);
            unsubscribers.push(
                source.on(event as any, (data) => void target.emit(event as any, data))
            );
        }
    };

    source.eventNames().forEach(setupForwarding);

    const originalTargetOn = target.on.bind(target);
    target.on = function <E extends keyof ExcludeEventsMap<T, K> & string>(
        event: E,
        callback: EventCallback<ExcludeEventsMap<T, K>[E]>,
        options?: { priority?: EventPriority }
    ): UnsubscribeFn {
        setupForwarding(event);
        return originalTargetOn(event, callback, options);
    };

    (target as any).dispose = () => {
        unsubscribers.forEach((unsub) => unsub());
    };

    return target as IEventEmitter<ExcludeEventsMap<T, K>>;
}

export function createEventProxy<SrcMap extends EventMap, DestMap extends EventMap>(
    source: IEventEmitter<SrcMap>,
    target: IEventEmitter<DestMap>,
    mapping: Readonly<Partial<Record<keyof SrcMap & string, keyof DestMap & string>>>,
    transformers?: EventTransformer<SrcMap, DestMap>,
    options?: {
        preservePriority?: boolean;
        bidirectional?: boolean;
    }
): UnsubscribeFn {
    const unsubscribers: UnsubscribeFn[] = [];
    const proxyingEvents = new Set<string>();

    const currentPriorities = new Map<string, EventPriority>();

    if (options?.preservePriority) {
        const originalEmit = source.emit.bind(source);
        source.emit = async function <K extends keyof SrcMap & string>(
            event: K,
            data: SrcMap[K],
            emitOptions?: { priority?: EventPriority }
        ): Promise<boolean> {
            const priority = emitOptions?.priority || 'normal';
            currentPriorities.set(event, priority);
            try {
                return await originalEmit(event, data, emitOptions);
            } finally {
                setTimeout(() => currentPriorities.delete(event), 0);
            }
        };
    }

    for (const sourceEvent of Object.keys(mapping) as Array<keyof SrcMap & string>) {
        const targetEvent = mapping[sourceEvent]!;

        unsubscribers.push(
            source.on(sourceEvent, (data: SrcMap[typeof sourceEvent]) => {
                const proxyKey = `src->${sourceEvent}->${targetEvent}`;
                if (proxyingEvents.has(proxyKey)) {
                    return;
                }

                proxyingEvents.add(proxyKey);
                try {
                    const priority: EventPriority | undefined = options?.preservePriority
                        ? currentPriorities.get(sourceEvent) || 'normal'
                        : undefined;

                    if (transformers && sourceEvent in transformers) {
                        const transform = transformers[sourceEvent]!;
                        const transformedData = transform(data);
                        void target.emit(targetEvent, transformedData as any, { priority });
                        return;
                    }

                    void target.emit(targetEvent, data as any, { priority });
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

        const reverseTransformers: EventTransformer<DestMap, SrcMap> = {};

        for (const targetEvent of Object.keys(reverseMapping) as Array<keyof DestMap & string>) {
            const sourceEvent = reverseMapping[targetEvent] as keyof SrcMap & string;

            unsubscribers.push(
                target.on(targetEvent, (data: DestMap[typeof targetEvent]) => {
                    const proxyKey = `dest->${targetEvent}->${sourceEvent}`;
                    if (proxyingEvents.has(proxyKey)) {
                        return;
                    }

                    proxyingEvents.add(proxyKey);
                    try {
                        const priority: EventPriority | undefined = options?.preservePriority
                            ? 'normal'
                            : undefined;

                        if (reverseTransformers && targetEvent in reverseTransformers) {
                            const transform = reverseTransformers[targetEvent]!;
                            const transformedData = transform(data);
                            void source.emit(sourceEvent, transformedData as any, {
                                priority,
                            });
                            return;
                        }

                        void source.emit(sourceEvent, data as any, { priority });
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

    for (const emitter of emitters) {
        const originalEmit = emitter.emit.bind(emitter);

        (emitter as any).emit = async function (event: any, data: any, options?: any) {
            const result = await originalEmit(event, data, options);
            void merged.emit(event, data, options);
            return result;
        };

        (emitter as any)._originalEmit = originalEmit;
    }

    const originalRemoveAllListeners = merged.removeAllListeners.bind(merged);
    merged.removeAllListeners = function <E extends string>(event?: E) {
        if (event === undefined) {
            unsubscribers.forEach((unsub) => unsub());
        }
        return originalRemoveAllListeners(event);
    };

    (merged as any).dispose = () => {
        unsubscribers.forEach((unsub) => unsub());

        for (const emitter of emitters) {
            if ((emitter as any)._originalEmit) {
                (emitter as any).emit = (emitter as any)._originalEmit;
                delete (emitter as any)._originalEmit;
            }
        }
    };

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
    source: IEventEmitter<T> = new EventEmitter<T>()
): IEventEmitter<NamespacedEventMap<Prefix, T>> {
    const namespaced = new EventEmitter<NamespacedEventMap<Prefix, T>>();
    const unsubscribers: UnsubscribeFn[] = [];

    const resolveSourceEvent = <K extends keyof NamespacedEventMap<Prefix, T> & string>(
        event: K
    ): keyof T & string => {
        const prefixStr = `${prefix}:`;
        if (!event.startsWith(prefixStr)) {
            throw new EventError(`Event "${event}" must start with namespace "${prefixStr}"`);
        }
        return event.slice(prefixStr.length) as keyof T & string;
    };

    const createNamespacedEvent = <K extends keyof T & string>(
        event: K
    ): keyof NamespacedEventMap<Prefix, T> & string => {
        return `${prefix}:${event}` as any;
    };

    const originalOn = namespaced.on.bind(namespaced);
    namespaced.on = function <K extends keyof NamespacedEventMap<Prefix, T> & string>(
        event: K,
        callback: EventCallback<NamespacedEventMap<Prefix, T>[K]>,
        options?: SubscriptionOptions
    ): UnsubscribeFn {
        const sourceEvent = resolveSourceEvent(event);
        return source.on(sourceEvent, callback as any, options);
    };

    const originalEmit = namespaced.emit.bind(namespaced);
    namespaced.emit = function <K extends keyof NamespacedEventMap<Prefix, T> & string>(
        event: K,
        data: NamespacedEventMap<Prefix, T>[K],
        options?: { priority?: EventPriority }
    ): Promise<boolean> {
        const sourceEvent = resolveSourceEvent(event);
        return source.emit(sourceEvent, data as any, options);
    };

    for (const event of source.eventNames()) {
        const namespacedEvent = createNamespacedEvent(event) as keyof NamespacedEventMap<
            Prefix,
            T
        > &
            string;
        unsubscribers.push(
            source.on(event as any, (data: any) => {
                void namespaced.emit(namespacedEvent, data);
            })
        );
    }

    (namespaced as any).dispose = () => {
        unsubscribers.forEach((unsub) => unsub());
    };

    return namespaced;
}

export class TypedEventRegistry<T extends EventMap> {
    readonly #registry = new Map<keyof T & string, symbol>();
    readonly #symbolToEvent = new Map<symbol, keyof T & string>();

    register<K extends keyof T & string>(event: K): symbol {
        if (this.#registry.has(event)) {
            return this.#registry.get(event)!;
        }
        const symbol = Symbol(event);
        this.#registry.set(event, symbol);
        this.#symbolToEvent.set(symbol, event);
        return symbol;
    }

    getSymbol<K extends keyof T & string>(event: K): symbol | undefined {
        return this.#registry.get(event);
    }

    getEvent(symbol: symbol): (keyof T & string) | undefined {
        return this.#symbolToEvent.get(symbol);
    }

    has<K extends keyof T & string>(event: K): boolean {
        return this.#registry.has(event);
    }

    hasSymbol(symbol: symbol): boolean {
        return this.#symbolToEvent.has(symbol);
    }

    events(): Array<keyof T & string> {
        return Array.from(this.#registry.keys());
    }

    symbols(): Array<symbol> {
        return Array.from(this.#symbolToEvent.keys());
    }

    entries(): Array<[keyof T & string, symbol]> {
        return Array.from(this.#registry.entries());
    }

    clear(): void {
        this.#registry.clear();
        this.#symbolToEvent.clear();
    }
}
