import type { ComponentRegistry, ComponentInstance, Entity } from './core';
import type { Actor } from '../core/actor';
import type { EventMap } from '../../event';

export type ComponentChangeEvent<R extends ComponentRegistry> = {
    readonly [K in keyof R as `${string & K}Added`]: {
        readonly entity: Entity;
        readonly component: ComponentInstance<R[K]>;
        readonly actor: Actor;
    };
} & {
    readonly [K in keyof R as `${string & K}Removed`]: {
        readonly entity: Entity;
        readonly component: ComponentInstance<R[K]>;
        readonly actor: Actor;
    };
};

export type WorldEvents<R extends ComponentRegistry> = ComponentChangeEvent<R> & {
    readonly EntityCreated: { readonly entity: Entity; readonly actor: Actor };
    readonly EntityDestroyed: { readonly entity: Entity; readonly actor: Actor };
    readonly ActorCreated: { readonly actor: Actor };
    readonly ActorDestroyed: { readonly actor: Actor };
};

export type ECSEventMap<R extends ComponentRegistry> = EventMap & WorldEvents<R>;
