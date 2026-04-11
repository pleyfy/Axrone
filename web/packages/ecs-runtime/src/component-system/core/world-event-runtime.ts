import { WorldEventRuntime as BaseWorldEventRuntime } from '@axrone/ecs-events/world-event-runtime';
import { ECSObservables, type ECSComponentChangeEvent, type ECSComponentName, type ECSEntityLifecycleEvent, type ECSReactiveQueryResult } from '../observers/ecs-observer';
import type { ComponentRegistry } from '../types/core';
import type { ECSEventMap } from '../types/events';
import type { QueryResult } from '../types/system';

type WorldQueryExecutor<R extends ComponentRegistry> = (
    ...components: readonly ECSComponentName<R>[]
) => readonly ECSReactiveQueryResult<R>[];

export class WorldEventRuntime<R extends ComponentRegistry> extends BaseWorldEventRuntime<
    ECSEventMap<R>,
    ECSComponentName<R>,
    ECSEntityLifecycleEvent,
    ECSComponentChangeEvent<R>,
    ECSReactiveQueryResult<R>
> {
    constructor(componentNames: readonly string[], query: WorldQueryExecutor<R>) {
        super(
            componentNames as readonly ECSComponentName<R>[],
            query as (...components: readonly ECSComponentName<R>[]) => readonly QueryResult<
                R,
                readonly ECSComponentName<R>[]
            >[],
            new ECSObservables<R>()
        );
    }

    registerComponent(componentName: string): void {
        super.registerComponent(componentName as ECSComponentName<R>);
    }

    observeComponent<K extends keyof R>(componentName: K) {
        return super.observeComponent(componentName as unknown as ECSComponentName<R>);
    }

    createReactiveQuery<Q extends readonly (keyof R)[]>(...components: Q) {
        return super.createReactiveQuery(
            ...(components as unknown as readonly ECSComponentName<R>[])
        );
    }
}
