import type {
    EntityUid,
    ComponentId,
    ComponentRegistry,
    EntityId,
    QueryResult,
    System,
    SystemId,
    SystemQuery,
} from '@axrone/ecs-runtime';
import { Entity, World } from '@axrone/ecs-runtime';

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

export const createEntity = (world: World<any>, name?: string): Entity => {
    return new Entity(world, { name });
};

export const createEntityId = (id: number): EntityId => id as EntityId;

export const createSystemId = <T extends string>(id: T): SystemId<T> => id as SystemId<T>;

export const createComponentId = <T extends string>(id: T): ComponentId<T> => id as ComponentId<T>;

export const createEntityUid = <T extends string>(id: T): EntityUid<T> => id as EntityUid<T>;