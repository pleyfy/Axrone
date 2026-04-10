export {
    Component,
} from './component-system/core/component';
export {
    script,
    getComponentMetadata,
    getAllScripts,
    getDependencyTree,
    getScriptMetrics,
    setComponentMetadata,
    validateAllScripts,
    clearScriptCaches,
    __debugScriptSystem,
} from './component-system/decorators/script';
export type {
    ComponentConfig,
    ComponentDebug,
    ComponentLifecycle,
    ComponentSerialization,
    ComponentState,
    ComponentValidation,
} from './component-system/core/component';
export type {
    ScriptDecoratorOptions,
    ScriptMetadata,
    ValidationResult,
} from './component-system/decorators/script';

export { Actor, ActorError } from './component-system/core/actor';
export type {
    ActorConfig,
    ActorLayer,
    ActorState,
    ActorTag,
    EventBus,
} from './component-system/core/actor';

export { World, EntityError, WorldError } from './component-system/core/world';
export type {
    EntityId,
    WorldState,
} from './component-system/core/world';

export { WorldActorRegistry } from './component-system/core/world-actor-registry';
export { WorldDiagnostics } from './component-system/core/world-diagnostics';
export type { WorldMetrics } from './component-system/core/world-diagnostics';
export { WorldEventRuntime } from './component-system/core/world-event-runtime';
export { WorldMutationRuntime } from './component-system/core/world-mutation-runtime';
export { WorldQueryRuntime } from './component-system/core/world-query-runtime';
export { WorldSingletonRegistry } from './component-system/core/world-singleton-registry';
export { WorldStorageRuntime } from './component-system/core/world-storage-runtime';
export type {
    WorldArchetypeResolution,
    WorldDestroyedEntity,
    WorldStorageDebugInfo,
} from './component-system/core/world-storage-runtime';

export { Hierarchy } from './component-system/components/hierarchy';
export { Transform } from './component-system/components/transform';

export { SystemManager, SystemPhase } from './component-system/systems/system-manager';

export { ECSObservables } from './component-system/observers/ecs-observer';

export { Archetype } from './component-system/archetype/archetype';
export { OptimizedQueryCache } from './component-system/archetype/query-cache';
export { ComponentPool } from './component-system/memory/component-pool';
export type { ComponentPoolConfig } from './component-system/memory/component-pool';

export type {
    ActorId,
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
} from './component-system/types/core';
export type {
    ComponentMetadata,
    ComponentType,
    IComponentPool,
} from './component-system/types/component';
export type {
    ECSEventMap,
    WorldEvents,
} from './component-system/types/events';
export type {
    QueryResult,
    System,
    SystemQuery,
} from './component-system/types/system';