import {
    createTypedEmitter,
    type EventCallback,
    type EventKey,
    type IEventEmitter,
} from '@axrone/event';
import type { IObservableSubject } from '@axrone/observer';
import {
    ECSObservables,
    type ECSComponentChangeEvent,
    type ECSComponentName,
    type ECSEntityLifecycleEvent,
    type ECSReactiveQueryResult,
} from '../observers/ecs-observer';
import type { ComponentRegistry } from '../types/core';
import type { ECSEventMap } from '../types/events';

type ECSComponentAddedEventKey<
    R extends ComponentRegistry,
    K extends ECSComponentName<R>,
> = Extract<`${string & K}Added`, EventKey<ECSEventMap<R>>>;

type ECSComponentRemovedEventKey<
    R extends ComponentRegistry,
    K extends ECSComponentName<R>,
> = Extract<`${string & K}Removed`, EventKey<ECSEventMap<R>>>;

type EntityCreatedEventKey<R extends ComponentRegistry> = Extract<
    'EntityCreated',
    EventKey<ECSEventMap<R>>
>;

type EntityDestroyedEventKey<R extends ComponentRegistry> = Extract<
    'EntityDestroyed',
    EventKey<ECSEventMap<R>>
>;

type WorldQueryExecutor<R extends ComponentRegistry> = (
    ...components: readonly ECSComponentName<R>[]
) => readonly ECSReactiveQueryResult<R>[];

export interface WorldEventMetrics {
    readonly emittedCount: number;
    readonly handlerCount: number;
    readonly queuedCount: number;
    readonly errorCount: number;
    readonly lastEmittedAt: number | null;
}

export class WorldEventRuntime<R extends ComponentRegistry> {
    private readonly _eventBus: IEventEmitter<ECSEventMap<R>> = createTypedEmitter<ECSEventMap<R>>();
    private readonly _disposables = new Set<() => void>();
    private readonly _trackedEvents = new Set<string>();
    private readonly _lastEmittedAt = new Map<string, number>();
    private readonly _bridgedComponents = new Set<ECSComponentName<R>>();

    constructor(
        componentNames: readonly string[],
        private readonly _query: WorldQueryExecutor<R>,
        private readonly _observables: ECSObservables<R> = new ECSObservables<R>()
    ) {
        this._setupEventObserverBridge(componentNames as readonly ECSComponentName<R>[]);
    }

    on<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: EventCallback<ECSEventMap<R>[T]>
    ): () => void {
        return this._subscribe(event, handler);
    }

    once<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: EventCallback<ECSEventMap<R>[T]>
    ): () => void {
        return this._subscribeOnce(event, handler);
    }

    async emit<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        data: ECSEventMap<R>[T]
    ): Promise<boolean> {
        this._trackedEvents.add(String(event));
        const wasPaused = this._eventBus.isPaused();
        const result = await this._eventBus.emit(event, data);

        if (!wasPaused) {
            this._lastEmittedAt.set(String(event), performance.now());
        }

        return result;
    }

    emitSync<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): boolean {
        this._trackedEvents.add(String(event));
        const wasPaused = this._eventBus.isPaused();
        const result = this._eventBus.emitSync(event, data);

        if (!wasPaused) {
            this._lastEmittedAt.set(String(event), performance.now());
        }

        return result;
    }

    emitSafe<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): void {
        try {
            this.emitSync(event, data);
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
        }
    }

    off<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler?: EventCallback<ECSEventMap<R>[T]>
    ): boolean {
        this._trackedEvents.add(String(event));
        return this._eventBus.off(event, handler);
    }

    getEventMetrics<T extends EventKey<ECSEventMap<R>>>(event: T): WorldEventMetrics {
        this._trackedEvents.add(String(event));

        const metrics = this._eventBus.getMetrics(event);
        const queuedCount = this._eventBus.getPendingCount(event);

        return {
            emittedCount: Math.max(0, metrics.emit.count - queuedCount),
            handlerCount: this._eventBus.listenerCount(event),
            queuedCount,
            errorCount: metrics.execution.errors,
            lastEmittedAt: this._lastEmittedAt.get(String(event)) ?? null,
        };
    }

    getAllEventMetrics(): Record<string, WorldEventMetrics> {
        const allMetrics: Record<string, WorldEventMetrics> = {};
        const eventNames = new Set<string>(this._trackedEvents);

        for (const eventName of this._eventBus.eventNames()) {
            eventNames.add(String(eventName));
        }

        for (const eventName of eventNames) {
            try {
                allMetrics[eventName] = this.getEventMetrics(
                    eventName as EventKey<ECSEventMap<R>>
                );
            } catch (error) {
                console.warn(`Failed to get metrics for event ${eventName}:`, error);
            }
        }

        return allMetrics;
    }

    pause(): void {
        this._eventBus.pause();
    }

    resume(): void {
        this._eventBus.resume();
    }

    drain(): Promise<void> {
        return this._eventBus.drain();
    }

    getObservables(): ECSObservables<R> {
        return this._observables;
    }

    observeEntityLifecycle() {
        return this._observables.createEntityLifecycle();
    }

    observeComponent<K extends keyof R>(componentName: K) {
        return this._observables.createComponentStream(
            componentName as unknown as ECSComponentName<R>
        );
    }

    createReactiveQuery<Q extends readonly (keyof R)[]>(...components: Q) {
        const componentNames = components as unknown as readonly ECSComponentName<R>[];
        const queryKey =
            componentNames.length === 1
                ? String(componentNames[0])
                : [...componentNames].sort().join(',');
        const queryObservable = this._observables.getQueryObservable<ECSReactiveQueryResult<R>>(
            queryKey,
            []
        );

        const updateQuery = () => {
            try {
                const results = this._query(...componentNames);
                this._notifyObservable(queryObservable, [...results], `reactive query ${queryKey}`);
            } catch (error) {
                console.error('Failed to update reactive query:', error);
            }
        };

        const reactiveQueryHandler = () => {
            updateQuery();
        };

        for (const componentName of componentNames) {
            this._subscribeReactiveQueryComponent(componentName, reactiveQueryHandler);
        }

        this._subscribe(this._getEntityCreatedEventKey(), reactiveQueryHandler);
        this._subscribe(this._getEntityDestroyedEventKey(), reactiveQueryHandler);

        updateQuery();

        return queryObservable;
    }

    registerComponent(componentName: string): void {
        this._registerComponentEventBridge(componentName as ECSComponentName<R>);
    }

    dispose(): void {
        try {
            this._eventBus.dispose();
        } catch (error) {
            console.error('Failed to dispose event bus:', error);
        }

        try {
            this._observables.dispose();
        } catch (error) {
            console.error('Failed to dispose observables:', error);
        }

        for (const dispose of this._disposables) {
            try {
                dispose();
            } catch (error) {
                console.error('Failed to execute disposal task:', error);
            }
        }

        this._disposables.clear();
        this._bridgedComponents.clear();
        this._trackedEvents.clear();
        this._lastEmittedAt.clear();
    }

    private _trackDisposer(unsubscribe: () => unknown): () => void {
        const dispose = () => {
            unsubscribe();
            this._disposables.delete(dispose);
        };

        this._disposables.add(dispose);
        return dispose;
    }

    private _subscribe<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: EventCallback<ECSEventMap<R>[T]>
    ): () => void {
        this._trackedEvents.add(String(event));
        return this._trackDisposer(this._eventBus.on(event, handler));
    }

    private _subscribeOnce<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: EventCallback<ECSEventMap<R>[T]>
    ): () => void {
        this._trackedEvents.add(String(event));
        return this._trackDisposer(this._eventBus.once(event, handler));
    }

    private _getEntityCreatedEventKey(): EntityCreatedEventKey<R> {
        return 'EntityCreated' as EntityCreatedEventKey<R>;
    }

    private _getEntityDestroyedEventKey(): EntityDestroyedEventKey<R> {
        return 'EntityDestroyed' as EntityDestroyedEventKey<R>;
    }

    private _getAddedEventKey<K extends ECSComponentName<R>>(
        componentName: K
    ): ECSComponentAddedEventKey<R, K> {
        return `${componentName}Added` as ECSComponentAddedEventKey<R, K>;
    }

    private _getRemovedEventKey<K extends ECSComponentName<R>>(
        componentName: K
    ): ECSComponentRemovedEventKey<R, K> {
        return `${componentName}Removed` as ECSComponentRemovedEventKey<R, K>;
    }

    private _subscribeReactiveQueryComponent<K extends ECSComponentName<R>>(
        componentName: K,
        handler: () => void
    ): void {
        this._subscribe(this._getAddedEventKey(componentName), handler);
        this._subscribe(this._getRemovedEventKey(componentName), handler);
    }

    private _setupEventObserverBridge(componentNames: readonly ECSComponentName<R>[]): void {
        this._subscribe(this._getEntityCreatedEventKey(), (data) => {
            this._notifyObservable(
                this._observables.entityCreated,
                data as ECSEntityLifecycleEvent,
                'entity created'
            );
        });

        this._subscribe(this._getEntityDestroyedEventKey(), (data) => {
            this._notifyObservable(
                this._observables.entityDestroyed,
                data as ECSEntityLifecycleEvent,
                'entity destroyed'
            );
        });

        for (const componentName of componentNames) {
            this._registerComponentEventBridge(componentName);
        }
    }

    private _registerComponentEventBridge<K extends ECSComponentName<R>>(
        componentName: K
    ): void {
        if (this._bridgedComponents.has(componentName)) {
            return;
        }

        this._bridgedComponents.add(componentName);

        const addedEvent = this._getAddedEventKey(componentName);
        const removedEvent = this._getRemovedEventKey(componentName);

        this._subscribe(addedEvent, (data) => {
            const observables = this._observables.getComponentObservables(componentName);
            this._notifyObservable(
                observables.added,
                data as ECSComponentChangeEvent<R>,
                `${componentName} added`
            );
        });

        this._subscribe(removedEvent, (data) => {
            const observables = this._observables.getComponentObservables(componentName);
            this._notifyObservable(
                observables.removed,
                data as ECSComponentChangeEvent<R>,
                `${componentName} removed`
            );
        });
    }

    private _notifyObservable<T>(
        observable: IObservableSubject<T>,
        data: T,
        context: string
    ): void {
        void observable.notify(data).catch((error) => {
            console.error(`Failed to notify ${context}:`, error);
        });
    }
}
