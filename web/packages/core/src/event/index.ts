export type {
    EventCallback,
    UnsubscribeFn,
    EventKey,
    EventMap,
    EventPriority,
    ExtractEventData,
    EventNames,
    OptionalData,
    EventOptions,
} from './definition';

export {
    isValidEventName,
    isValidCallback,
    isValidPriority,
    PRIORITY_VALUES,
    DEFAULT_PRIORITY,
    DEFAULT_OPTIONS,
    MEMORY_USAGE_SYMBOLS,
} from './definition';

export {
    BaseError,
    EventError,
    EventNotFoundError,
    EventQueueFullError,
    EventHandlerError,
} from './errors';

export type {
    Subscription,
    SubscriptionOptions,
    EventMetrics,
    QueuedEvent,
    IEventSubscriber,
    IEventPublisher,
    IEventBuffer,
    IEventObserver,
} from './interfaces';

export type { IEventEmitter } from './event-emitter';
export { EventEmitter } from './event-emitter';

export { EventGroup } from './event-group';

export { EventScheduler } from './event-scheduler';

export type {
    EventMapOf,
    FilteredEventMap,
    NamespacedEventMap,
    MergedEventMap,
    EventTransformer,
    ExcludeEventsMap,
} from './extras';

export {
    createEmitter,
    createTypedEmitter,
    isEventEmitter,
    filterEvents,
    excludeEvents,
    createEventProxy,
    mergeEmitters,
    namespaceEvents,
    TypedEventRegistry,
} from './extras';

export { performance } from './performance';

export { createHooks, EventUtils } from './utility';
