/**
 * @axrone/scene-prefab — Public API surface.
 *
 * All prefab types, error classes, and functions that were previously
 * part of @axrone/scene-runtime's prefab subpath export.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type {
    SceneSerializedValue,
    ScenePrefabId,
    ScenePrefabNodeId,
    ScenePrefabInstanceId,
    ScenePrefabComponentId,
    ScenePrefabPropertyPathSegment,
    ScenePrefabPropertyPath,
    ScenePrefabPropertyPathToken,
    ScenePrefabPropertyPathString,
    ScenePrefabNodeSource,
    ScenePrefabMetadata,
    ScenePrefabComponentSelector,
    ScenePrefabEntityField,
    ScenePrefabEntityFieldValue,
    SceneComponentSnapshot,
    SceneEntitySnapshot,
    ScenePrefabReference,
    ScenePrefabOverrideOperation,
    ScenePrefabNestedInstance,
    ScenePrefabDefinition,
    ScenePrefabConflictPolicy,
    ScenePrefabConflictResolution,
    ScenePrefabConflictBaseValue,
    ScenePrefabConflict,
    ScenePrefabConflictResolver,
    ScenePrefabMergeOptions,
    ScenePrefabDiffResult,
    ScenePrefabMergeResult,
    ScenePrefabMergeDefinitionResult,
    ScenePrefabResolvedDefinition,
    ScenePrefabResolveOptions,
    ScenePrefabResolutionResult,
    ScenePrefabRegistrySource,
    ScenePrefabResolver,
    ScenePrefabInstantiateOptions,
} from './types';

// ─── Errors ─────────────────────────────────────────────────────────

export {
    ScenePrefabError,
    ScenePrefabValidationError,
    ScenePrefabResolutionError,
    ScenePrefabConflictError,
} from './errors';

// ─── Internals (utility functions) ──────────────────────────────────

export {
    createScenePrefabComponentSelector,
    createScenePrefabScopedNodeId,
    findScenePrefabComponentIndex,
    getScenePrefabComponentSelectorKey,
    hasScenePrefabComposition,
    isScenePrefabReference,
    serializeScenePrefabPropertyPath,
} from './scene-prefab-internals';

// ─── Operations ─────────────────────────────────────────────────────

export { applyScenePrefabOverrides } from './scene-prefab-operations';

// ─── Diff / merge ───────────────────────────────────────────────────

export {
    diffScenePrefabDefinitions,
    mergeScenePrefabDefinitions,
} from './scene-prefab-diff';

// ─── Workflow ───────────────────────────────────────────────────────

export type {
    ResolveScenePrefabOptions,
    ScenePrefabWorkflowOptions,
} from './scene-prefab-workflow';

export {
    createScenePrefabWorkflow,
    resolveScenePrefab,
    ScenePrefabWorkflow,
} from './scene-prefab-workflow';

// ─── Variant ────────────────────────────────────────────────────────

export {
    unpackScenePrefabInstance,
    createScenePrefabVariant,
    applyOverridesToBaseDefinition,
} from './scene-prefab-variant';

// ─── ECS component ──────────────────────────────────────────────────

export { PrefabNodeBinding } from './prefab-node-binding';
export type { PrefabNodeBindingConfig } from './prefab-node-binding';
