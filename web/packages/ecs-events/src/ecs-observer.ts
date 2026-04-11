import { createBehaviorSubject, createSubject, type IObservableSubject } from './observer';

export interface ECSObservableActorLike {
    readonly name?: string;
    readonly tag?: string;
    readonly layer?: number;
}

export interface ECSObservableEntityLifecycleEvent<
    TEntity = unknown,
    TActor extends ECSObservableActorLike = ECSObservableActorLike,
> {
    readonly entity: TEntity;
    readonly actor: TActor;
}

export interface ECSObservableComponentEvent<
    TEntity = unknown,
    TComponent = unknown,
    TActor extends ECSObservableActorLike = ECSObservableActorLike,
> {
    readonly entity: TEntity;
    readonly component: TComponent;
    readonly actor: TActor;
}

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

export type ECSComponentChange<TComponentEvent extends ECSObservableComponentEvent> = TComponentEvent & {
    readonly action: ECSComponentChangeAction;
};

export type ECSEntityLifecycleChange<
    TEntityLifecycle extends ECSObservableEntityLifecycleEvent,
> = TEntityLifecycle & {
    readonly action: ECSEntityLifecycleAction;
};

export interface ECSComponentStream<TComponentEvent extends ECSObservableComponentEvent> {
    readonly added: IObservableSubject<TComponentEvent>;
    readonly removed: IObservableSubject<TComponentEvent>;
    readonly changes: IObservableSubject<ECSComponentChange<TComponentEvent>>;
}

export interface ECSEntityLifecycleStreams<
    TEntityLifecycle extends ECSObservableEntityLifecycleEvent,
> {
    readonly all: IObservableSubject<ECSEntityLifecycleChange<TEntityLifecycle>>;
    byName(name: string): {
        readonly created: IObservableSubject<TEntityLifecycle>;
        readonly destroyed: IObservableSubject<TEntityLifecycle>;
    };
    byTag(tag: string): {
        readonly created: IObservableSubject<TEntityLifecycle>;
        readonly destroyed: IObservableSubject<TEntityLifecycle>;
    };
    byLayer(layer: number): {
        readonly created: IObservableSubject<TEntityLifecycle>;
        readonly destroyed: IObservableSubject<TEntityLifecycle>;
    };
}

export class ECSObservables<
    TComponentName extends string = string,
    TEntityLifecycle extends ECSObservableEntityLifecycleEvent = ECSObservableEntityLifecycleEvent,
    TComponentEvent extends ECSObservableComponentEvent = ECSObservableComponentEvent,
    TQueryResult = unknown,
> {
    readonly entityCreated: IObservableSubject<TEntityLifecycle>;
    readonly entityDestroyed: IObservableSubject<TEntityLifecycle>;

    private readonly componentObservables = new Map<
        string,
        {
            added: IObservableSubject<TComponentEvent>;
            removed: IObservableSubject<TComponentEvent>;
        }
    >();

    readonly systemExecutionStart: IObservableSubject<ECSSystemExecutionStartEvent>;
    readonly systemExecutionEnd: IObservableSubject<ECSSystemExecutionEndEvent>;

    readonly frameStart: IObservableSubject<ECSFrameStartEvent>;
    readonly frameEnd: IObservableSubject<ECSFrameEndEvent>;

    private readonly queryObservables = new Map<string, IObservableSubject<unknown[]>>();

    constructor() {
        this.entityCreated = createSubject<TEntityLifecycle>();
        this.entityDestroyed = createSubject<TEntityLifecycle>();
        this.systemExecutionStart = createSubject<ECSSystemExecutionStartEvent>();
        this.systemExecutionEnd = createSubject<ECSSystemExecutionEndEvent>();
        this.frameStart = createSubject<ECSFrameStartEvent>();
        this.frameEnd = createSubject<ECSFrameEndEvent>();
    }

    getComponentObservables(componentName: TComponentName) {
        const key = componentName as string;

        if (!this.componentObservables.has(key)) {
            this.componentObservables.set(key, {
                added: createSubject<TComponentEvent>(),
                removed: createSubject<TComponentEvent>(),
            });
        }

        return this.componentObservables.get(key)!;
    }

    getQueryObservable<T>(queryKey: string, initialValue: T[] = []): IObservableSubject<T[]> {
        if (!this.queryObservables.has(queryKey)) {
            this.queryObservables.set(queryKey, createBehaviorSubject<T[]>(initialValue) as IObservableSubject<unknown[]>);
        }

        return this.queryObservables.get(queryKey)! as IObservableSubject<T[]>;
    }

    createEntityFilter(
        predicate: (data: TEntityLifecycle) => boolean
    ): IObservableSubject<TEntityLifecycle> {
        return this._createEntityFilterFrom(this.entityCreated, predicate);
    }

    createComponentStream(componentName: TComponentName): ECSComponentStream<TComponentEvent> {
        const observables = this.getComponentObservables(componentName);

        const changes = createSubject<ECSComponentChange<TComponentEvent>>();

        observables.added.addObserver((data) => {
            changes.notify({ ...data, action: 'added' });
        });

        observables.removed.addObserver((data) => {
            changes.notify({ ...data, action: 'removed' });
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
                debounced.notify(data);
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
                throttled.notify(data);
                lastExecution = now;
            }
        });

        return throttled;
    }

    createEntityLifecycle(): ECSEntityLifecycleStreams<TEntityLifecycle> {
        const all = createSubject<ECSEntityLifecycleChange<TEntityLifecycle>>();

        this.entityCreated.addObserver((data) => {
            all.notify({ ...data, action: 'created' });
        });

        this.entityDestroyed.addObserver((data) => {
            all.notify({ ...data, action: 'destroyed' });
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
        source: IObservableSubject<TEntityLifecycle>,
        predicate: (data: TEntityLifecycle) => boolean
    ): IObservableSubject<TEntityLifecycle> {
        const filtered = createSubject<TEntityLifecycle>();

        source.addObserver((data) => {
            if (predicate(data)) {
                filtered.notify(data);
            }
        });

        return filtered;
    }
}