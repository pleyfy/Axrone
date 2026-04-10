import {
    type WorldDestroyedEntity as StorageWorldDestroyedEntity,
    type WorldStorageDebugInfo as StorageWorldStorageDebugInfo,
    WorldStorageRuntime as BaseWorldStorageRuntime,
} from '@axrone/ecs-storage/world-storage-runtime';
import type { WorldArchetypeResolution as StorageWorldArchetypeResolution } from '@axrone/ecs-storage/archetype-store';
import type { ArchetypeId, ComponentRegistry, Entity } from '../types/core';

export type WorldArchetypeResolution<R extends ComponentRegistry> = StorageWorldArchetypeResolution<
    R,
    Entity,
    ArchetypeId
>;

export type WorldDestroyedEntity<R extends ComponentRegistry> = StorageWorldDestroyedEntity<
    R,
    Entity,
    ArchetypeId
>;

export type WorldStorageDebugInfo<R extends ComponentRegistry> = StorageWorldStorageDebugInfo<
    R,
    Entity,
    ArchetypeId
>;

export class WorldStorageRuntime<R extends ComponentRegistry> extends BaseWorldStorageRuntime<
    R,
    Entity,
    ArchetypeId
> {}
