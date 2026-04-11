import { createTypedEmitter, type EventKey, type EventMap, type IEventEmitter } from './event';
import { ECSObservables, type ECSObservableComponentEvent, type ECSObservableEntityLifecycleEvent } from './ecs-observer';

export type WorldQueryExecutor<TComponentName extends string, TQueryResult> = (
    ...components: readonly TComponentName[]
) => readonly TQueryResult[];

export class WorldEventRuntime<
    TEvents extends EventMap,
    TComponentName extends string = string,
    TEntityLifecycle extends ECSObservableEntityLifecycleEvent = ECSObservableEntityLifecycleEvent,
    TComponentEvent extends ECSObservableComponentEvent = ECSObservableComponentEvent,
    TQueryResult = unknown,
> {
    private readonly _eventBus: IEventEmitter<TEvents> = createTypedEmitter<TEvents>();
    private readonly _disposables = new Set<() => void>();

    constructor(
        componentNames: readonly TComponentName[],
        private readonly _query: WorldQueryExecutor<TComponentName, TQueryResult>,
        private readonly _observables: ECSObservables<
            TComponentName,
            TEntityLifecycle,
            TComponentEvent,
            TQueryResult
        > = new ECSObservables<TComponentName, TEntityLifecycle, TComponentEvent, TQueryResult>()
    ) {
        this._setupEventObserverBridge(componentNames);
    }

    on<T extends EventKey<TEvents>>(event: T, handler: (data: TEvents[T]) => void): () => void {
        return this._trackDisposer(this._eventBus.on(event, handler));
    }

    once<T extends EventKey<TEvents>>(event: T, handler: (data: TEvents[T]) => void): () => void {
        return this._trackDisposer(this._eventBus.once(event, handler));
    }

    emit<T extends EventKey<TEvents>>(event: T, data: TEvents[T]): Promise<boolean> {
        return this._eventBus.emit(event, data);
    }

    emitSync<T extends EventKey<TEvents>>(event: T, data: TEvents[T]): boolean {
        return this._eventBus.emitSync(event, data);
    }

    emitSafe<T extends EventKey<TEvents>>(event: T, data: TEvents[T]): void {
        try {
            this._eventBus.emitSync(event, data);
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
        }
    }

    off<T extends EventKey<TEvents>>(event: T, handler?: (data: TEvents[T]) => void): boolean {
        return this._eventBus.off(event, handler);
    }

    getEventMetrics<T extends EventKey<TEvents>>(event: T) {
        return this._eventBus.getMetrics(String(event));
    }

    getAllEventMetrics(): Record<string, unknown> {
        const allMetrics: Record<string, unknown> = {};
        const eventNames = this._eventBus.eventNames();

        for (let i = 0; i < eventNames.length; i++) {
            const eventName = eventNames[i]!;
            try {
                allMetrics[eventName] = this._eventBus.getMetrics(eventName);
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

    getObservables(): ECSObservables<TComponentName, TEntityLifecycle, TComponentEvent, TQueryResult> {
        return this._observables;
    }

    observeEntityLifecycle() {
        return this._observables.createEntityLifecycle();
    }

    observeComponent(componentName: TComponentName) {
        return this._observables.createComponentStream(componentName);
    }

    createReactiveQuery<Q extends readonly TComponentName[]>(...components: Q) {
        const queryKey =
            components.length === 1
                ? String(components[0])
                : [...components].sort().join(',');
        const queryObservable = this._observables.getQueryObservable<TQueryResult>(queryKey, []);

        const updateQuery = () => {
            try {
                const results = this._query(...components);
                queryObservable.notify([...results]);
            } catch (error) {
                console.error('Failed to update reactive query:', error);
            }
        };
        const reactiveQueryHandler = updateQuery as (data: TEvents[EventKey<TEvents>]) => void;

        for (let i = 0; i < components.length; i++) {
            const componentName = components[i] as string;
            this._trackDisposer(
                this._eventBus.on(`${componentName}Added` as EventKey<TEvents>, reactiveQueryHandler)
            );
            this._trackDisposer(
                this._eventBus.on(`${componentName}Removed` as EventKey<TEvents>, reactiveQueryHandler)
            );
        }

        this._trackDisposer(this._eventBus.on('EntityCreated' as EventKey<TEvents>, reactiveQueryHandler));
        this._trackDisposer(this._eventBus.on('EntityDestroyed' as EventKey<TEvents>, reactiveQueryHandler));

        updateQuery();

        return queryObservable;
    }

    registerComponent(componentName: TComponentName): void {
        this._registerComponentEventBridge(componentName);
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
    }

    private _trackDisposer(unsubscribe: () => void): () => void {
        this._disposables.add(unsubscribe);

        return () => {
            unsubscribe();
            this._disposables.delete(unsubscribe);
        };
    }

    private _setupEventObserverBridge(componentNames: readonly TComponentName[]): void {
        this._eventBus.on('EntityCreated' as EventKey<TEvents>, (data) => {
            try {
                this._observables.entityCreated.notify(data as TEntityLifecycle);
            } catch (error) {
                console.error('Failed to notify entity created:', error);
            }
        });

        this._eventBus.on('EntityDestroyed' as EventKey<TEvents>, (data) => {
            try {
                this._observables.entityDestroyed.notify(data as TEntityLifecycle);
            } catch (error) {
                console.error('Failed to notify entity destroyed:', error);
            }
        });

        for (let i = 0; i < componentNames.length; i++) {
            this._registerComponentEventBridge(componentNames[i]!);
        }
    }

    private _registerComponentEventBridge(componentName: TComponentName): void {
        this._eventBus.on(`${componentName}Added` as EventKey<TEvents>, (data) => {
            try {
                const observables = this._observables.getComponentObservables(componentName);
                observables.added.notify(data as TComponentEvent);
            } catch (error) {
                console.error(`Failed to notify ${componentName} added:`, error);
            }
        });

        this._eventBus.on(`${componentName}Removed` as EventKey<TEvents>, (data) => {
            try {
                const observables = this._observables.getComponentObservables(componentName);
                observables.removed.notify(data as TComponentEvent);
            } catch (error) {
                console.error(`Failed to notify ${componentName} removed:`, error);
            }
        });
    }
}