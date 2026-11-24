/**
 * Re-export bridge — all prefab exports now come from @axrone/scene-prefab.
 *
 * This file is kept so that the `./prefab` subpath export of
 * @axrone/scene-runtime continues to work during the migration.
 * New code should import from `@axrone/scene-prefab` directly.
 */
export type {
    ScenePrefabEntityField,
    ScenePrefabEntityFieldValue,
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
    SceneSerializedValue,
    SceneComponentSnapshot,
    SceneEntitySnapshot,
    ScenePrefabInstantiateOptions,
} from '@axrone/scene-prefab';
export {
    createScenePrefabComponentSelector,
    createScenePrefabScopedNodeId,
    findScenePrefabComponentIndex,
    getScenePrefabComponentSelectorKey,
    hasScenePrefabComposition,
    isScenePrefabReference,
    serializeScenePrefabPropertyPath,
} from '@axrone/scene-prefab';
export { applyScenePrefabOverrides } from '@axrone/scene-prefab';
export {
    diffScenePrefabDefinitions,
    mergeScenePrefabDefinitions,
} from '@axrone/scene-prefab';
export type {
    ResolveScenePrefabOptions,
    ScenePrefabWorkflowOptions,
} from '@axrone/scene-prefab';
export {
    createScenePrefabWorkflow,
    resolveScenePrefab,
    ScenePrefabWorkflow,
} from '@axrone/scene-prefab';
export {
    ScenePrefabConflictError,
    ScenePrefabError,
    ScenePrefabResolutionError,
    ScenePrefabValidationError,
} from '@axrone/scene-prefab';
export {
    unpackScenePrefabInstance,
    createScenePrefabVariant,
    applyOverridesToBaseDefinition,
} from '@axrone/scene-prefab';
