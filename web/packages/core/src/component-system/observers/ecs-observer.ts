import { createSubject, createBehaviorSubject } from '../../observer';
import type { IObservableSubject } from '../../observer';
import type { Entity, ComponentRegistry } from '../types/core';
import type { Actor } from '../core/actor';

export class ECSObservables<R extends ComponentRegistry> {
    readonly entityCreated: IObservableSubject<{ entity: Entity; actor: Actor }>;
    readonly entityDestroyed: IObservableSubject<{ entity: Entity; actor: Actor }>;

    private readonly componentObservables = new Map<
        string,
        {
            added: IObservableSubject<{ entity: Entity; component: any; actor: Actor }>;
            removed: IObservableSubject<{ entity: Entity; component: any; actor: Actor }>;
        }
    >();

    readonly systemExecutionStart: IObservableSubject<{ systemId: string; deltaTime: number }>;
    readonly systemExecutionEnd: IObservableSubject<{
        systemId: string;
        deltaTime: number;
        duration: number;
    }>;

    readonly frameStart: IObservableSubject<{ frameId: number; timestamp: number }>;
    readonly frameEnd: IObservableSubject<{ frameId: number; timestamp: number; duration: number }>;

    private readonly queryObservables = new Map<string, IObservableSubject<any[]>>();

    constructor() {
        this.entityCreated = createSubject();
        this.entityDestroyed = createSubject();
        this.systemExecutionStart = createSubject();
        this.systemExecutionEnd = createSubject();
        this.frameStart = createSubject();
        this.frameEnd = createSubject();
    }

    getComponentObservables<K extends keyof R>(componentName: K) {
        const key = componentName as string;

        if (!this.componentObservables.has(key)) {
            this.componentObservables.set(key, {
                added: createSubject(),
                removed: createSubject(),
            });
        }

        return this.componentObservables.get(key)!;
    }

    getQueryObservable<T>(queryKey: string, initialValue: T[] = []): IObservableSubject<T[]> {
        if (!this.queryObservables.has(queryKey)) {
            this.queryObservables.set(queryKey, createBehaviorSubject(initialValue));
        }

        return this.queryObservables.get(queryKey)!;
    }

    createEntityFilter(
        predicate: (data: { entity: Entity; actor: Actor }) => boolean
    ): IObservableSubject<{ entity: Entity; actor: Actor }> {
        const filtered = createSubject<{ entity: Entity; actor: Actor }>();

        this.entityCreated.addObserver((data) => {
            if (predicate(data)) {
                filtered.notify(data);
            }
        });

        return filtered;
    }

    createComponentStream<K extends keyof R>(componentName: K) {
        const observables = this.getComponentObservables(componentName);

        const changes = createSubject<{
            entity: Entity;
            component: any;
            actor: Actor;
            action: 'added' | 'removed';
        }>();

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

        let timeoutId: ReturnType<typeof setTimeout>;

        queryObservable.addObserver((data) => {
            clearTimeout(timeoutId);
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

    createEntityLifecycle() {
        const all = createSubject<{
            entity: Entity;
            actor: Actor;
            action: 'created' | 'destroyed';
        }>();

        this.entityCreated.addObserver((data) => {
            all.notify({ ...data, action: 'created' });
        });

        this.entityDestroyed.addObserver((data) => {
            all.notify({ ...data, action: 'destroyed' });
        });

        return {
            all,

            byName: (name: string) => ({
                created: this.createEntityFilter(({ actor }) => actor.name === name),
                destroyed: this.createEntityFilter(({ actor }) => actor.name === name),
            }),

            byTag: (tag: string) => ({
                created: this.createEntityFilter(({ actor }) => actor.tag === tag),
                destroyed: this.createEntityFilter(({ actor }) => actor.tag === tag),
            }),

            byLayer: (layer: number) => ({
                created: this.createEntityFilter(({ actor }) => actor.layer === layer),
                destroyed: this.createEntityFilter(({ actor }) => actor.layer === layer),
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
}
