import type { EventKey, IEventEmitter } from '../../event';
import { createTypedEmitter } from '../../event';
import { ECSObservables } from '../observers/ecs-observer';
import type { ComponentRegistry } from '../types/core';
import type { ECSEventMap } from '../types/events';
import type { QueryResult } from '../types/system';

type WorldQueryExecutor<R extends ComponentRegistry> = (
    ...components: readonly (keyof R)[]
) => readonly QueryResult<R, readonly (keyof R)[]>[];

export class WorldEventRuntime<R extends ComponentRegistry> {
    private readonly _eventBus: IEventEmitter<ECSEventMap<R>> = createTypedEmitter<ECSEventMap<R>>();
    private readonly _observables = new ECSObservables<R>();
    private readonly _disposables = new Set<() => void>();

    constructor(
        componentNames: readonly string[],
        private readonly _query: WorldQueryExecutor<R>
    ) {
        this._setupEventObserverBridge(componentNames);
    }

    on<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: (data: ECSEventMap<R>[T]) => void
    ): () => void {
        return this._trackDisposer(this._eventBus.on(event, handler));
    }

    once<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: (data: ECSEventMap<R>[T]) => void
    ): () => void {
        return this._trackDisposer(this._eventBus.once(event, handler));
    }

    emit<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        data: ECSEventMap<R>[T]
    ): Promise<boolean> {
        return this._eventBus.emit(event, data);
    }

    emitSync<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): boolean {
        return this._eventBus.emitSync(event, data);
    }

    emitSafe<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): void {
        try {
            this._eventBus.emitSync(event, data);
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
        }
    }

    off<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler?: (data: ECSEventMap<R>[T]) => void
    ): boolean {
        return this._eventBus.off(event, handler);
    }

    getEventMetrics<T extends EventKey<ECSEventMap<R>>>(event: T) {
        return this._eventBus.getMetrics(event);
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

    getObservables(): ECSObservables<R> {
        return this._observables;
    }

    observeEntityLifecycle() {
        return this._observables.createEntityLifecycle();
    }

    observeComponent<K extends keyof R>(componentName: K) {
        return this._observables.createComponentStream(componentName);
    }

    createReactiveQuery<Q extends readonly (keyof R)[]>(...components: Q) {
        const queryKey =
            components.length === 1
                ? String(components[0])
                : [...components].sort().join(',');
        const queryObservable = this._observables.getQueryObservable<QueryResult<R, Q>>(queryKey, []);

        const updateQuery = () => {
            try {
                const results = this._query(...components) as readonly QueryResult<R, Q>[];
                queryObservable.notify([...results]);
            } catch (error) {
                console.error('Failed to update reactive query:', error);
            }
        };

        for (let i = 0; i < components.length; i++) {
            const componentName = components[i] as string;
            this._trackDisposer(this._eventBus.on(`${componentName}Added` as any, updateQuery));
            this._trackDisposer(this._eventBus.on(`${componentName}Removed` as any, updateQuery));
        }

        this._trackDisposer(this._eventBus.on('EntityCreated', updateQuery));
        this._trackDisposer(this._eventBus.on('EntityDestroyed', updateQuery));

        updateQuery();

        return queryObservable;
    }

    registerComponent(componentName: string): void {
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

    private _setupEventObserverBridge(componentNames: readonly string[]): void {
        this._eventBus.on('EntityCreated', (data) => {
            try {
                this._observables.entityCreated.notify(data);
            } catch (error) {
                console.error('Failed to notify entity created:', error);
            }
        });

        this._eventBus.on('EntityDestroyed', (data) => {
            try {
                this._observables.entityDestroyed.notify(data);
            } catch (error) {
                console.error('Failed to notify entity destroyed:', error);
            }
        });

        for (let i = 0; i < componentNames.length; i++) {
            this._registerComponentEventBridge(componentNames[i]!);
        }
    }

    private _registerComponentEventBridge(componentName: string): void {
        this._eventBus.on(`${componentName}Added` as any, (data) => {
            try {
                const observables = this._observables.getComponentObservables(componentName as keyof R);
                observables.added.notify(data);
            } catch (error) {
                console.error(`Failed to notify ${componentName} added:`, error);
            }
        });

        this._eventBus.on(`${componentName}Removed` as any, (data) => {
            try {
                const observables = this._observables.getComponentObservables(componentName as keyof R);
                observables.removed.notify(data);
            } catch (error) {
                console.error(`Failed to notify ${componentName} removed:`, error);
            }
        });
    }
}