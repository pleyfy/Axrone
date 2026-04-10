import type {
    ActorId,
    ComponentId,
    ComponentRegistry,
    Entity,
    QueryResult,
    System,
    SystemId,
    SystemQuery,
} from '@axrone/ecs';
import { Actor, World } from '@axrone/ecs';

export const createWorld = <R extends ComponentRegistry>(registry: R): World<R> => {
    return new World(registry);
};

export const createSystem = <R extends ComponentRegistry, Q extends SystemQuery<R>>(
    id: SystemId,
    query: Q,
    execute: (entities: readonly QueryResult<R, Q>[], deltaTime: number) => void,
    priority: number = 0,
    enabled: boolean = true
): System<R, Q> => {
    return { id, query, execute, priority, enabled };
};

export const createActor = (world: World<any>, name?: string): Actor => {
    return new Actor(world, { name });
};

export const createEntity = (id: number): Entity => id as Entity;

export const createSystemId = <T extends string>(id: T): SystemId<T> => id as SystemId<T>;

export const createComponentId = <T extends string>(id: T): ComponentId<T> => id as ComponentId<T>;

export const createActorId = <T extends string>(id: T): ActorId<T> => id as ActorId<T>;
