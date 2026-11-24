import {
    cloneSceneEntitySnapshot,
    cloneScenePrefabOverrideOperation,
} from './scene-prefab-internals';
import {
    applyScenePrefabOverrideOperations,
    applyScenePrefabOverrides,
    createScenePrefabState,
    materializeScenePrefabEntities,
} from './scene-prefab-operations';
import type {
    SceneEntitySnapshot,
    ScenePrefabDefinition,
    ScenePrefabOverrideOperation,
    ScenePrefabReference,
} from './types';

/**
 * Strips all prefab source/lineage metadata from entities, producing clean
 * standalone entities suitable for a non-instanced prefab definition.
 */
const stripEntitySourceMetadata = (entity: SceneEntitySnapshot): SceneEntitySnapshot => {
    const { source: _source, ...rest } = entity;
    return cloneSceneEntitySnapshot(rest);
};

/**
 * Unpacks a prefab instance into a flat, standalone prefab definition.
 *
 * Given a resolved prefab definition (already resolved through its variant
 * chain and nested instances) and a set of live instance overrides, this
 * function produces a new `ScenePrefabDefinition` with `kind: 'prefab'`
 * that contains fully materialized entities with no `base`, `nested`, or
 * `source` metadata.
 *
 * This is the engine-level equivalent of Unity's "Unpack Prefab" operation.
 */
export const unpackScenePrefabInstance = (
    definition: ScenePrefabDefinition,
    overrides: readonly ScenePrefabOverrideOperation[] = [],
    unpackedId?: string,
): ScenePrefabDefinition => {
    const withOverrides =
        overrides.length > 0
            ? applyScenePrefabOverrides(definition, overrides)
            : definition;

    const entities = withOverrides.entities.map(stripEntitySourceMetadata);

    return {
        id: unpackedId ?? definition.id,
        kind: 'prefab',
        entities,
        ...(definition.metadata ? { metadata: definition.metadata } : {}),
    };
};

/**
 * Creates a prefab variant definition that inherits from a base prefab.
 *
 * The variant stores only the delta (overrides) relative to its base.
 * At resolution time, the engine resolves the base first, then applies
 * the variant's overrides on top.
 *
 * @param baseId - The registry ID (or path) of the base prefab
 * @param variantId - The unique ID for the new variant
 * @param overrides - Override operations that differentiate this variant from its base
 * @param metadata - Optional metadata to attach to the variant
 */
export const createScenePrefabVariant = (
    baseId: string,
    variantId: string,
    overrides: readonly ScenePrefabOverrideOperation[] = [],
    metadata?: ScenePrefabDefinition['metadata'],
): ScenePrefabDefinition => {
    const base: ScenePrefabReference = {
        kind: 'registry',
        prefabId: baseId,
    };

    return {
        id: variantId,
        kind: 'variant',
        entities: [],
        base,
        overrides: overrides.map((operation) => cloneScenePrefabOverrideOperation(operation)),
        ...(metadata ? { metadata } : {}),
    };
};

/**
 * Applies instance overrides directly onto a base prefab definition,
 * producing a new standalone prefab definition with `kind: 'prefab'`.
 *
 * This is used when "Apply All Overrides" pushes per-instance changes
 * back into the source prefab asset. The result is a self-contained
 * definition with no `base` reference.
 *
 * @param base - The base prefab definition to modify
 * @param overrides - The override operations to bake in
 * @returns A new standalone prefab definition with overrides applied
 */
export const applyOverridesToBaseDefinition = (
    base: ScenePrefabDefinition,
    overrides: readonly ScenePrefabOverrideOperation[],
): ScenePrefabDefinition => {
    if (overrides.length === 0) {
        return {
            id: base.id,
            kind: 'prefab',
            entities: base.entities.map((entity) => cloneSceneEntitySnapshot(entity)),
            ...(base.metadata ? { metadata: base.metadata } : {}),
        };
    }

    const state = createScenePrefabState(base);
    applyScenePrefabOverrideOperations(state, overrides);
    const entities = materializeScenePrefabEntities(state);

    return {
        id: base.id,
        kind: 'prefab',
        entities,
        ...(base.metadata ? { metadata: base.metadata } : {}),
    };
};
