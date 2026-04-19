export type {
    ScenePrefabActorField,
    ScenePrefabActorFieldValue,
    ScenePrefabComponentId,
    ScenePrefabComponentSelector,
    ScenePrefabConflict,
    ScenePrefabConflictBaseValue,
    ScenePrefabConflictPolicy,
    ScenePrefabConflictResolution,
    ScenePrefabConflictResolver,
    ScenePrefabDefinition,
    ScenePrefabDiffResult,
    ScenePrefabId,
    ScenePrefabInstanceId,
    ScenePrefabMergeDefinitionResult,
    ScenePrefabMergeOptions,
    ScenePrefabMergeResult,
    ScenePrefabMetadata,
    ScenePrefabNestedInstance,
    ScenePrefabNodeId,
    ScenePrefabNodeSource,
    ScenePrefabOverrideOperation,
    ScenePrefabPropertyPath,
    ScenePrefabPropertyPathSegment,
    ScenePrefabPropertyPathString,
    ScenePrefabReference,
    ScenePrefabRegistrySource,
    ScenePrefabResolveOptions,
    ScenePrefabResolvedDefinition,
    ScenePrefabResolutionResult,
    ScenePrefabResolver,
} from './types';
export {
    createScenePrefabComponentSelector,
    createScenePrefabScopedNodeId,
    findScenePrefabComponentIndex,
    getScenePrefabComponentSelectorKey,
    hasScenePrefabComposition,
    isScenePrefabReference,
    serializeScenePrefabPropertyPath,
} from './scene-prefab-internals';
export { applyScenePrefabOverrides } from './scene-prefab-operations';
export {
    diffScenePrefabDefinitions,
    mergeScenePrefabDefinitions,
} from './scene-prefab-diff';
export type {
    ResolveScenePrefabOptions,
    ScenePrefabWorkflowOptions,
} from './scene-prefab-workflow';
export {
    createScenePrefabWorkflow,
    resolveScenePrefab,
    ScenePrefabWorkflow,
} from './scene-prefab-workflow';
export {
    ScenePrefabConflictError,
    ScenePrefabError,
    ScenePrefabResolutionError,
    ScenePrefabValidationError,
} from './errors';