export {
    Component,
    script,
    getComponentMetadata,
    setComponentMetadata,
} from '../../core/src/component-system/core/component';
export type {
    ComponentConfig,
    ComponentDebug,
    ComponentLifecycle,
    ComponentSerialization,
    ComponentState,
    ComponentValidation,
} from '../../core/src/component-system/core/component';

export { Actor, ActorError } from '../../core/src/component-system/core/actor';
export type {
    ActorConfig,
    ActorLayer,
    ActorState,
    ActorTag,
    EventBus,
} from '../../core/src/component-system/core/actor';

export { World, EntityError, WorldError } from '../../core/src/component-system/core/world';
export type {
    EntityId,
    WorldState,
} from '../../core/src/component-system/core/world';

export { WorldActorRegistry } from '../../core/src/component-system/core/world-actor-registry';
export { WorldDiagnostics } from '../../core/src/component-system/core/world-diagnostics';
export type { WorldMetrics } from '../../core/src/component-system/core/world-diagnostics';
export { WorldEventRuntime } from '../../core/src/component-system/core/world-event-runtime';
export { WorldMutationRuntime } from '../../core/src/component-system/core/world-mutation-runtime';
export { WorldQueryRuntime } from '../../core/src/component-system/core/world-query-runtime';
export { WorldSingletonRegistry } from '../../core/src/component-system/core/world-singleton-registry';
export { WorldStorageRuntime } from '../../core/src/component-system/core/world-storage-runtime';
export type {
    WorldArchetypeResolution,
    WorldDestroyedEntity,
    WorldStorageDebugInfo,
} from '../../core/src/component-system/core/world-storage-runtime';

export { Hierarchy } from '../../core/src/component-system/components/hierarchy';
export { Transform } from '../../core/src/component-system/components/transform';

export { SystemManager, SystemPhase } from '../../core/src/component-system/systems/system-manager';

export { ECSObservables } from '../../core/src/component-system/observers/ecs-observer';

export { Archetype } from '../../core/src/component-system/archetype/archetype';
export { OptimizedQueryCache } from '../../core/src/component-system/archetype/query-cache';

export type {
    ArchetypeId,
    ArchetypeSignature,
    BitMask,
    ComponentConstructor,
    ComponentId,
    ComponentInstance,
    ComponentMask,
    ComponentRegistry,
    Entity,
    EventType,
    SystemId,
} from '../../core/src/component-system/types/core';
export type {
    ComponentMetadata,
    ComponentType,
    IComponentPool,
} from '../../core/src/component-system/types/component';
export type {
    ECSEventMap,
    WorldEvents,
} from '../../core/src/component-system/types/events';
export type {
    QueryResult,
    System,
    SystemQuery,
} from '../../core/src/component-system/types/system';