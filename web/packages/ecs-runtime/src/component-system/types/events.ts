import type { ComponentRegistry, ComponentInstance, EntityId } from './core';
import type { Entity } from '../core/entity';
import type { EventMap } from '@axrone/event';

export type ComponentChangeEvent<R extends ComponentRegistry> = {
    readonly [K in keyof R as `${string & K}Added`]: {
        readonly entityId: EntityId;
        readonly component: ComponentInstance<R[K]>;
        readonly entity: Entity;
    };
} & {
    readonly [K in keyof R as `${string & K}Removed`]: {
        readonly entityId: EntityId;
        readonly component: ComponentInstance<R[K]>;
        readonly entity: Entity;
    };
};

export type WorldEvents<R extends ComponentRegistry> = ComponentChangeEvent<R> & {
    readonly EntityCreated: { readonly entityId: EntityId; readonly entity: Entity };
    readonly EntityDestroyed: { readonly entityId: EntityId; readonly entity: Entity };
};

export type ECSEventMap<R extends ComponentRegistry> = EventMap & WorldEvents<R>;
