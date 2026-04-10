import { ECSObservables as ECSObservablesBase } from '@axrone/ecs-events/ecs-observer';
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

export class ECSObservables<R extends ComponentRegistry> extends ECSObservablesBase<
    ECSComponentName<R>,
    ECSEntityLifecycleEvent,
    ECSComponentChangeEvent<R>,
    ECSReactiveQueryResult<R>
> {}
