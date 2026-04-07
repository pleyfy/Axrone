import type { ComponentRegistry, SystemId, Entity, ComponentInstance } from './core';

export type SystemQuery<R extends ComponentRegistry> = readonly (keyof R)[];

export type QueryResult<R extends ComponentRegistry, Q extends readonly (keyof R)[]> = {
    readonly entity: Entity;
    readonly components: {
        readonly [K in Q[number]]: ComponentInstance<R[K]>;
    };
};

export interface System<R extends ComponentRegistry, Q extends SystemQuery<R>> {
    readonly query: Q;
    readonly id: SystemId;
    readonly priority: number;
    readonly enabled: boolean;
    execute(entities: readonly QueryResult<R, Q>[], deltaTime: number): void;
    onEnable?(): void;
    onDisable?(): void;
}
