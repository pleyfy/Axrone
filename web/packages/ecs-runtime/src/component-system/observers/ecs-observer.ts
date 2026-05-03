import {
    createBehaviorSubject,
    createSubject,
    type IObservableSubject,
} from '@axrone/observer';
import type { ComponentInstance, ComponentRegistry, Entity } from '../types/core';
import type { QueryResult } from '../types/system';
import type { Actor } from '../core/actor';

export type ECSComponentName<R extends ComponentRegistry> = Extract<keyof R, string>;

export type ECSEntityLifecycleEvent = {
    readonly entity: Entity;
    readonly actor: Actor;
};

export type ECSComponentChangeEvent<R extends ComponentRegistry> = {
    readonly entity: Entity;
    readonly component: ComponentInstance<R[keyof R]>;
    readonly actor: Actor;
};

export type ECSReactiveQueryResult<R extends ComponentRegistry> = QueryResult<
    R,
    readonly ECSComponentName<R>[]
>;

export interface ECSSystemExecutionStartEvent {
    readonly systemId: string;
    readonly deltaTime: number;
}

export interface ECSSystemExecutionEndEvent extends ECSSystemExecutionStartEvent {
    readonly duration: number;
}

export interface ECSFrameStartEvent {
    readonly frameId: number;
    readonly timestamp: number;
}

export interface ECSFrameEndEvent extends ECSFrameStartEvent {
    readonly duration: number;
}

export type ECSComponentChangeAction = 'added' | 'removed';
export type ECSEntityLifecycleAction = 'created' | 'destroyed';

export type ECSComponentChange<TComponentEvent> = TComponentEvent & {
    readonly action: ECSComponentChangeAction;
};

export type ECSEntityLifecycleChange<TEntityLifecycle> = TEntityLifecycle & {
    readonly action: ECSEntityLifecycleAction;
};

export interface ECSComponentStream<R extends ComponentRegistry> {
    readonly added: IObservableSubject<ECSComponentChangeEvent<R>>;
    readonly removed: IObservableSubject<ECSComponentChangeEvent<R>>;
    readonly changes: IObservableSubject<ECSComponentChange<ECSComponentChangeEvent<R>>>;
}

export interface ECSEntityLifecycleStreams<R extends ComponentRegistry> {
    readonly all: IObservableSubject<ECSEntityLifecycleChange<ECSEntityLifecycleEvent>>;
    byName(name: string): {
        readonly created: IObservableSubject<ECSEntityLifecycleEvent>;
        readonly destroyed: IObservableSubject<ECSEntityLifecycleEvent>;
    };
    byTag(tag: string): {
        readonly created: IObservableSubject<ECSEntityLifecycleEvent>;
        readonly destroyed: IObservableSubject<ECSEntityLifecycleEvent>;
    };
    byLayer(layer: number): {
        readonly created: IObservableSubject<ECSEntityLifecycleEvent>;
        readonly destroyed: IObservableSubject<ECSEntityLifecycleEvent>;
    };
}

export class ECSObservables<R extends ComponentRegistry> {
    readonly entityCreated: IObservableSubject<ECSEntityLifecycleEvent>;
    readonly entityDestroyed: IObservableSubject<ECSEntityLifecycleEvent>;

    readonly systemExecutionStart: IObservableSubject<ECSSystemExecutionStartEvent>;
    readonly systemExecutionEnd: IObservableSubject<ECSSystemExecutionEndEvent>;

    readonly frameStart: IObservableSubject<ECSFrameStartEvent>;
    readonly frameEnd: IObservableSubject<ECSFrameEndEvent>;

    private readonly componentObservables = new Map<
        string,
        {
            added: IObservableSubject<ECSComponentChangeEvent<R>>;
            removed: IObservableSubject<ECSComponentChangeEvent<R>>;
        }
    >();

    private readonly queryObservables = new Map<string, IObservableSubject<unknown[]>>();

    constructor() {
        this.entityCreated = createSubject<ECSEntityLifecycleEvent>();
        this.entityDestroyed = createSubject<ECSEntityLifecycleEvent>();
        this.systemExecutionStart = createSubject<ECSSystemExecutionStartEvent>();
        this.systemExecutionEnd = createSubject<ECSSystemExecutionEndEvent>();
        this.frameStart = createSubject<ECSFrameStartEvent>();
        this.frameEnd = createSubject<ECSFrameEndEvent>();
    }

    getComponentObservables(componentName: ECSComponentName<R>) {
        const key = componentName as string;

        if (!this.componentObservables.has(key)) {
            this.componentObservables.set(key, {
                added: createSubject<ECSComponentChangeEvent<R>>(),
                removed: createSubject<ECSComponentChangeEvent<R>>(),
            });
        }

        return this.componentObservables.get(key)!;
    }

    getQueryObservable<T>(queryKey: string, initialValue: T[] = []): IObservableSubject<T[]> {
        if (!this.queryObservables.has(queryKey)) {
            this.queryObservables.set(
                queryKey,
                createBehaviorSubject<T[]>(initialValue) as IObservableSubject<unknown[]>
            );
        }

        return this.queryObservables.get(queryKey)! as IObservableSubject<T[]>;
    }

    createEntityFilter(
        predicate: (data: ECSEntityLifecycleEvent) => boolean
    ): IObservableSubject<ECSEntityLifecycleEvent> {
        return this._createEntityFilterFrom(this.entityCreated, predicate);
    }

    createComponentStream(componentName: ECSComponentName<R>): ECSComponentStream<R> {
        const observables = this.getComponentObservables(componentName);
        const changes = createSubject<ECSComponentChange<ECSComponentChangeEvent<R>>>();

        observables.added.addObserver((data) => {
            this._notifySubject(changes, { ...data, action: 'added' }, `${componentName} changes`);
        });

        observables.removed.addObserver((data) => {
            this._notifySubject(changes, { ...data, action: 'removed' }, `${componentName} changes`);
        });

        return {
            added: observables.added,
            removed: observables.removed,
            changes,
        };
    }

    createDebouncedQuery<T>(
        queryKey: string,
        debounceMs: number = 100,
        initialValue: T[] = []
    ): IObservableSubject<T[]> {
        const queryObservable = this.getQueryObservable(queryKey, initialValue);
        const debounced = createSubject<T[]>();

        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        queryObservable.addObserver((data) => {
            if (timeoutId !== undefined) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                this._notifySubject(debounced, data, `debounced query ${queryKey}`);
            }, debounceMs);
        });

        return debounced;
    }

    createThrottledQuery<T>(
        queryKey: string,
        throttleMs: number = 100,
        initialValue: T[] = []
    ): IObservableSubject<T[]> {
        const queryObservable = this.getQueryObservable(queryKey, initialValue);
        const throttled = createSubject<T[]>();

        let lastExecution = 0;

        queryObservable.addObserver((data) => {
            const now = Date.now();
            if (now - lastExecution >= throttleMs) {
                this._notifySubject(throttled, data, `throttled query ${queryKey}`);
                lastExecution = now;
            }
        });

        return throttled;
    }

    createEntityLifecycle(): ECSEntityLifecycleStreams<R> {
        const all = createSubject<ECSEntityLifecycleChange<ECSEntityLifecycleEvent>>();

        this.entityCreated.addObserver((data) => {
            this._notifySubject(all, { ...data, action: 'created' }, 'entity lifecycle stream');
        });

        this.entityDestroyed.addObserver((data) => {
            this._notifySubject(all, { ...data, action: 'destroyed' }, 'entity lifecycle stream');
        });

        return {
            all,
            byName: (name: string) => ({
                created: this._createEntityFilterFrom(
                    this.entityCreated,
                    ({ actor }) => actor.name === name
                ),
                destroyed: this._createEntityFilterFrom(
                    this.entityDestroyed,
                    ({ actor }) => actor.name === name
                ),
            }),
            byTag: (tag: string) => ({
                created: this._createEntityFilterFrom(
                    this.entityCreated,
                    ({ actor }) => actor.tag === tag
                ),
                destroyed: this._createEntityFilterFrom(
                    this.entityDestroyed,
                    ({ actor }) => actor.tag === tag
                ),
            }),
            byLayer: (layer: number) => ({
                created: this._createEntityFilterFrom(
                    this.entityCreated,
                    ({ actor }) => actor.layer === layer
                ),
                destroyed: this._createEntityFilterFrom(
                    this.entityDestroyed,
                    ({ actor }) => actor.layer === layer
                ),
            }),
        };
    }

    dispose(): void {
        this.entityCreated.dispose();
        this.entityDestroyed.dispose();
        this.systemExecutionStart.dispose();
        this.systemExecutionEnd.dispose();
        this.frameStart.dispose();
        this.frameEnd.dispose();

        this.componentObservables.forEach(({ added, removed }) => {
            added.dispose();
            removed.dispose();
        });

        this.queryObservables.forEach((observable) => {
            observable.dispose();
        });

        this.componentObservables.clear();
        this.queryObservables.clear();
    }

    private _createEntityFilterFrom(
        source: IObservableSubject<ECSEntityLifecycleEvent>,
        predicate: (data: ECSEntityLifecycleEvent) => boolean
    ): IObservableSubject<ECSEntityLifecycleEvent> {
        const filtered = createSubject<ECSEntityLifecycleEvent>();

        source.addObserver((data) => {
            if (predicate(data)) {
                this._notifySubject(filtered, data, 'filtered entity lifecycle stream');
            }
        });

        return filtered;
    }

    private _notifySubject<T>(
        subject: IObservableSubject<T>,
        data: T,
        context: string
    ): void {
        void subject.notify(data).catch((error) => {
            console.error(`Failed to notify ${context}:`, error);
        });
    }
}
