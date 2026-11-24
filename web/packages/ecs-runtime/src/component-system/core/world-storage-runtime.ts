import {
    type WorldDestroyedEntity as StorageWorldDestroyedEntity,
    type WorldStorageDebugInfo as StorageWorldStorageDebugInfo,
    WorldStorageRuntime as BaseWorldStorageRuntime,
} from '../../storage/world-storage-runtime';
import type { WorldArchetypeResolution as StorageWorldArchetypeResolution } from '../../storage/archetype-store';
import type { ArchetypeId, ComponentRegistry, EntityId } from '../types/core';

export type WorldArchetypeResolution<R extends ComponentRegistry> = StorageWorldArchetypeResolution<
    R,
    EntityId,
    ArchetypeId
>;

export type WorldDestroyedEntity<R extends ComponentRegistry> = StorageWorldDestroyedEntity<
    R,
    EntityId,
    ArchetypeId
>;

export type WorldStorageDebugInfo<R extends ComponentRegistry> = StorageWorldStorageDebugInfo<
    R,
    EntityId,
    ArchetypeId
>;

export class WorldStorageRuntime<R extends ComponentRegistry> extends BaseWorldStorageRuntime<
    R,
    EntityId,
    ArchetypeId
> {}
