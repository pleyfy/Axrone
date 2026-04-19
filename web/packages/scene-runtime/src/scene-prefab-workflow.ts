import { ScenePrefabResolutionError } from './errors';
import { isInlineScenePrefabReference, isScenePrefabReference } from './scene-prefab-internals';
import {
    applyScenePrefabOverrideOperations,
    createScenePrefabState,
    materializeScenePrefabResolvedDefinition,
    mergeScenePrefabActors,
    scopeScenePrefabActors,
    scopeScenePrefabOverrideOperations,
    validateScenePrefabState,
} from './scene-prefab-operations';
import { diffScenePrefabDefinitions, mergeScenePrefabDefinitions } from './scene-prefab-diff';
import type {
    ScenePrefabDefinition,
    ScenePrefabDiffResult,
    ScenePrefabMergeDefinitionResult,
    ScenePrefabMergeOptions,
    ScenePrefabOverrideOperation,
    ScenePrefabReference,
    ScenePrefabRegistrySource,
    ScenePrefabResolveOptions,
    ScenePrefabResolutionResult,
    ScenePrefabResolvedDefinition,
    ScenePrefabResolver,
} from './types';

export interface ScenePrefabWorkflowOptions {
    readonly prefabs?: readonly ScenePrefabDefinition[];
    readonly registry?: ScenePrefabRegistrySource;
    readonly enableCache?: boolean;
}

export interface ResolveScenePrefabOptions extends ScenePrefabResolveOptions {
    readonly registry?: ScenePrefabRegistrySource;
}

const getDefinitionLineage = (definition: ScenePrefabDefinition): readonly string[] =>
    definition.kind === 'resolved' && 'lineage' in definition && Array.isArray(definition.lineage)
        ? definition.lineage
        : [definition.id];

export class ScenePrefabWorkflow implements ScenePrefabResolver, ScenePrefabRegistrySource {
    private readonly _definitions = new Map<string, ScenePrefabDefinition>();
    private readonly _externalRegistry: ScenePrefabRegistrySource | undefined;
    private readonly _resolutionCache = new Map<string, ScenePrefabResolvedDefinition>();
    private readonly _enableCache: boolean;
    private _revision = 0;

    constructor(options: ScenePrefabWorkflowOptions = {}) {
        this._externalRegistry = options.registry;
        this._enableCache = options.enableCache !== false;
        this.registerAll(options.prefabs ?? []);
    }

    register(prefab: ScenePrefabDefinition): this {
        this._definitions.set(prefab.id, prefab);
        this._revision += 1;
        this._resolutionCache.clear();
        return this;
    }

    registerAll(prefabs: readonly ScenePrefabDefinition[]): this {
        for (const prefab of prefabs) {
            this._definitions.set(prefab.id, prefab);
        }

        if (prefabs.length > 0) {
            this._revision += 1;
            this._resolutionCache.clear();
        }

        return this;
    }

    unregister(prefabId: string): boolean {
        const deleted = this._definitions.delete(prefabId);
        if (deleted) {
            this._revision += 1;
            this._resolutionCache.clear();
        }
        return deleted;
    }

    clear(): void {
        if (this._definitions.size === 0) {
            return;
        }

        this._definitions.clear();
        this._revision += 1;
        this._resolutionCache.clear();
    }

    getPrefab(prefabId: string): ScenePrefabDefinition | undefined {
        return this._definitions.get(prefabId) ?? this._externalRegistry?.getPrefab(prefabId);
    }

    resolvePrefab(
        prefab: ScenePrefabDefinition | ScenePrefabReference,
        options: ScenePrefabResolveOptions = {},
    ): ScenePrefabResolutionResult {
        const cacheKey = this._createCacheKey(prefab, options);
        if (cacheKey) {
            const cached = this._resolutionCache.get(cacheKey);
            if (cached) {
                return {
                    definition: cached,
                    conflicts: [],
                    cacheHit: true,
                };
            }
        }

        const definition = isScenePrefabReference(prefab)
            ? this._resolveReference(prefab, [])
            : this._resolveDefinition(prefab, []);
        const resolvedDefinition =
            options.liveOverrides && options.liveOverrides.length > 0
                ? this._applyLiveOverrides(definition, options.liveOverrides)
                : definition;

        if (cacheKey) {
            this._resolutionCache.set(cacheKey, resolvedDefinition);
        }

        return {
            definition: resolvedDefinition,
            conflicts: [],
            cacheHit: false,
        };
    }

    applyOverrides(
        prefab: ScenePrefabDefinition | ScenePrefabReference,
        overrides: readonly ScenePrefabOverrideOperation[],
        options: ScenePrefabResolveOptions = {},
    ): ScenePrefabResolvedDefinition {
        const resolvedDefinition = this.resolvePrefab(prefab, options).definition;
        return this._applyLiveOverrides(resolvedDefinition, overrides);
    }

    diff(
        base: ScenePrefabDefinition | ScenePrefabReference,
        target: ScenePrefabDefinition | ScenePrefabReference,
    ): ScenePrefabDiffResult {
        const resolvedBase = this.resolvePrefab(base).definition;
        const resolvedTarget = this.resolvePrefab(target).definition;
        return diffScenePrefabDefinitions(resolvedBase, resolvedTarget);
    }

    merge(
        base: ScenePrefabDefinition | ScenePrefabReference,
        local: ScenePrefabDefinition | ScenePrefabReference,
        incoming: ScenePrefabDefinition | ScenePrefabReference,
        options: ScenePrefabMergeOptions = {},
    ): ScenePrefabMergeDefinitionResult {
        const resolvedBase = this.resolvePrefab(base).definition;
        const resolvedLocal = this.resolvePrefab(local).definition;
        const resolvedIncoming = this.resolvePrefab(incoming).definition;
        return mergeScenePrefabDefinitions(resolvedBase, resolvedLocal, resolvedIncoming, options);
    }

    private _createCacheKey(
        prefab: ScenePrefabDefinition | ScenePrefabReference,
        options: ScenePrefabResolveOptions,
    ): string | undefined {
        if (!this._enableCache || this._externalRegistry || (options.liveOverrides?.length ?? 0) > 0) {
            return undefined;
        }

        if (isScenePrefabReference(prefab)) {
            if (prefab.kind !== 'registry' || !this._definitions.has(prefab.prefabId)) {
                return undefined;
            }

            return `${this._revision}:ref:${prefab.prefabId}`;
        }

        if (this._definitions.get(prefab.id) !== prefab) {
            return undefined;
        }

        return `${this._revision}:def:${prefab.id}`;
    }

    private _resolveReference(
        reference: ScenePrefabReference,
        stack: readonly string[],
    ): ScenePrefabResolvedDefinition {
        if (isInlineScenePrefabReference(reference)) {
            return this._resolveDefinition(reference.prefab, stack);
        }

        const definition = this.getPrefab(reference.prefabId);
        if (!definition) {
            throw new ScenePrefabResolutionError(
                `Cannot resolve prefab '${reference.prefabId}' from registry`,
            );
        }

        return this._resolveDefinition(definition, stack);
    }

    private _resolveDefinition(
        definition: ScenePrefabDefinition,
        stack: readonly string[],
    ): ScenePrefabResolvedDefinition {
        if (stack.includes(definition.id)) {
            throw new ScenePrefabResolutionError(
                `Prefab resolution cycle detected: ${[...stack, definition.id].join(' -> ')}`,
            );
        }

        const nextStack = [...stack, definition.id];
        const baseDefinition = definition.base ? this._resolveReference(definition.base, nextStack) : undefined;
        const lineage = baseDefinition ? [...baseDefinition.lineage, definition.id] : getDefinitionLineage(definition);
        const state = baseDefinition
            ? createScenePrefabState(baseDefinition, baseDefinition.id, baseDefinition.lineage)
            : createScenePrefabState(definition, definition.id, lineage);

        if (baseDefinition) {
            mergeScenePrefabActors(state, definition.actors, definition.id, [definition.id]);
        }

        for (const nested of definition.nested ?? []) {
            const resolvedNested = this._resolveReference(nested.reference, nextStack);
            mergeScenePrefabActors(
                state,
                scopeScenePrefabActors(resolvedNested.actors, nested, resolvedNested.id),
                definition.id,
                [definition.id],
            );

            if (nested.overrides && nested.overrides.length > 0) {
                applyScenePrefabOverrideOperations(
                    state,
                    scopeScenePrefabOverrideOperations(
                        nested.overrides,
                        nested,
                        resolvedNested.id,
                    ),
                );
            }
        }

        if (definition.overrides && definition.overrides.length > 0) {
            applyScenePrefabOverrideOperations(state, definition.overrides);
        }

        validateScenePrefabState(state);
        return materializeScenePrefabResolvedDefinition(definition, state, lineage);
    }

    private _applyLiveOverrides(
        definition: ScenePrefabResolvedDefinition,
        overrides: readonly ScenePrefabOverrideOperation[],
    ): ScenePrefabResolvedDefinition {
        const state = createScenePrefabState(definition, definition.id, definition.lineage);
        applyScenePrefabOverrideOperations(state, overrides);
        return materializeScenePrefabResolvedDefinition(definition, state, definition.lineage);
    }
}

export const createScenePrefabWorkflow = (
    options: ScenePrefabWorkflowOptions = {},
): ScenePrefabWorkflow => new ScenePrefabWorkflow(options);

export const resolveScenePrefab = (
    prefab: ScenePrefabDefinition | ScenePrefabReference,
    options: ResolveScenePrefabOptions = {},
): ScenePrefabResolutionResult =>
    new ScenePrefabWorkflow({
        registry: options.registry,
        enableCache: false,
    }).resolvePrefab(prefab, options);