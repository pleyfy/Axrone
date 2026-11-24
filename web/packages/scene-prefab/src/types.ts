/**
 * @axrone/scene-prefab — Type definitions for the prefab subsystem.
 *
 * Extracted from scene-runtime to enable independent prefab tooling
 * and to break the cyclic coupling between scene-runtime and its
 * prefab authoring / diff / merge / resolution logic.
 */

import type { JsonValue as SceneSerializedValue } from '@axrone/utility';

export type { JsonValue as SceneSerializedValue } from '@axrone/utility';

// ─── Brand helpers ──────────────────────────────────────────────────

type ScenePrefabBrand<TValue extends string, TBrand extends string> = TValue & {
    readonly __scenePrefabBrand: TBrand;
};

export type ScenePrefabId = ScenePrefabBrand<string, 'ScenePrefabId'>;
export type ScenePrefabNodeId = ScenePrefabBrand<string, 'ScenePrefabNodeId'>;
export type ScenePrefabInstanceId = ScenePrefabBrand<string, 'ScenePrefabInstanceId'>;
export type ScenePrefabComponentId = ScenePrefabBrand<string, 'ScenePrefabComponentId'>;
export type ScenePrefabPropertyPathSegment = string | number;
export type ScenePrefabPropertyPath = readonly ScenePrefabPropertyPathSegment[];
export type ScenePrefabPropertyPathToken<
    TSegment extends ScenePrefabPropertyPathSegment,
> = TSegment extends number ? `[${TSegment}]` : TSegment;
export type ScenePrefabPropertyPathString<
    TSegments extends ScenePrefabPropertyPath = ScenePrefabPropertyPath,
> = TSegments extends readonly [
    infer THead extends ScenePrefabPropertyPathSegment,
    ...infer TTail extends readonly ScenePrefabPropertyPathSegment[],
]
    ? `${ScenePrefabPropertyPathToken<THead>}${TTail['length'] extends 0
          ? ''
          : `.${ScenePrefabPropertyPathString<TTail>}`}`
    : '';

// ─── Node source & metadata ─────────────────────────────────────────

export interface ScenePrefabNodeSource {
    readonly prefabId: string;
    readonly nodeId: string;
    readonly instancePath?: readonly string[];
    readonly lineage?: readonly string[];
}

export interface ScenePrefabMetadata {
    readonly revision?: string;
    readonly locale?: string;
    readonly updatedAt?: string;
    readonly timeZone?: string;
    readonly tags?: readonly string[];
}

// ─── Component selector ─────────────────────────────────────────────

export type ScenePrefabComponentSelector =
    | {
          readonly kind: 'id';
          readonly componentId: string;
          readonly type?: string;
      }
    | {
          readonly kind: 'type';
          readonly type: string;
          readonly occurrence?: number;
      };

// ─── Entity fields ───────────────────────────────────────────────────

export type ScenePrefabEntityField =
    | 'name'
    | 'layer'
    | 'tag'
    | 'active'
    | 'persistent'
    | 'pooled';

export type ScenePrefabEntityFieldValue<
    TField extends ScenePrefabEntityField = ScenePrefabEntityField,
> = TField extends 'name' | 'tag'
    ? string
    : TField extends 'layer'
      ? number
      : boolean;

// ─── Snapshots ──────────────────────────────────────────────────────

export interface SceneComponentSnapshot {
    readonly id?: string;
    readonly type: string;
    readonly data: SceneSerializedValue;
}

export interface SceneEntitySnapshot {
    readonly nodeId?: string;
    readonly parentNodeId?: string | null;
    readonly name: string;
    readonly layer: number;
    readonly tag: string;
    readonly active: boolean;
    readonly persistent: boolean;
    readonly pooled: boolean;
    readonly source?: ScenePrefabNodeSource;
    readonly components: readonly SceneComponentSnapshot[];
}

// ─── Reference & overrides ──────────────────────────────────────────

export type ScenePrefabReference =
    | {
          readonly kind: 'inline';
          readonly prefab: ScenePrefabDefinition;
      }
    | {
          readonly kind: 'registry';
          readonly prefabId: string;
          readonly revision?: string;
      };

export type ScenePrefabOverrideOperation =
    | {
          readonly kind: 'add-entity';
          readonly entity: SceneEntitySnapshot;
          readonly afterNodeId?: string;
      }
    | {
          readonly kind: 'remove-entity';
          readonly nodeId: string;
      }
    | {
          readonly kind: 'reparent-entity';
          readonly nodeId: string;
          readonly parentNodeId?: string | null;
      }
    | {
          readonly kind: 'set-entity-field';
          readonly nodeId: string;
          readonly field: ScenePrefabEntityField;
          readonly value: ScenePrefabEntityFieldValue;
      }
    | {
          readonly kind: 'add-component';
          readonly nodeId: string;
          readonly component: SceneComponentSnapshot;
          readonly index?: number;
      }
    | {
          readonly kind: 'remove-component';
          readonly nodeId: string;
          readonly selector: ScenePrefabComponentSelector;
      }
    | {
          readonly kind: 'replace-component';
          readonly nodeId: string;
          readonly selector: ScenePrefabComponentSelector;
          readonly component: SceneComponentSnapshot;
      }
    | {
          readonly kind: 'set-component-property';
          readonly nodeId: string;
          readonly selector: ScenePrefabComponentSelector;
          readonly path: ScenePrefabPropertyPath;
          readonly value: SceneSerializedValue;
      }
    | {
          readonly kind: 'unset-component-property';
          readonly nodeId: string;
          readonly selector: ScenePrefabComponentSelector;
          readonly path: ScenePrefabPropertyPath;
      };

// ─── Nested instances ───────────────────────────────────────────────

export interface ScenePrefabNestedInstance {
    readonly instanceId: string;
    readonly reference: ScenePrefabReference;
    readonly parentNodeId?: string | null;
    readonly namePrefix?: string;
    readonly overrides?: readonly ScenePrefabOverrideOperation[];
}

// ─── Definition ─────────────────────────────────────────────────────

export interface ScenePrefabDefinition {
    readonly id: string;
    readonly kind?: 'prefab' | 'variant' | 'resolved';
    readonly entities: readonly SceneEntitySnapshot[];
    readonly base?: ScenePrefabReference;
    readonly nested?: readonly ScenePrefabNestedInstance[];
    readonly overrides?: readonly ScenePrefabOverrideOperation[];
    readonly metadata?: ScenePrefabMetadata;
}

// ─── Conflict resolution ────────────────────────────────────────────

export type ScenePrefabConflictPolicy = 'manual' | 'prefer-local' | 'prefer-incoming' | 'prefer-base';
export type ScenePrefabConflictResolution = 'local' | 'incoming' | 'base';
export type ScenePrefabConflictBaseValue =
    | SceneSerializedValue
    | SceneEntitySnapshot
    | SceneComponentSnapshot
    | ScenePrefabEntityFieldValue
    | null;

export interface ScenePrefabConflict {
    readonly key: string;
    readonly local: ScenePrefabOverrideOperation;
    readonly incoming: ScenePrefabOverrideOperation;
    readonly baseValue: ScenePrefabConflictBaseValue;
}

export type ScenePrefabConflictResolver = (
    conflict: ScenePrefabConflict
) => ScenePrefabConflictResolution;

export interface ScenePrefabMergeOptions {
    readonly conflictPolicy?: ScenePrefabConflictPolicy;
    readonly conflictResolver?: ScenePrefabConflictResolver;
}

// ─── Diff / merge results ───────────────────────────────────────────

export interface ScenePrefabDiffResult {
    readonly basePrefabId: string;
    readonly targetPrefabId: string;
    readonly overrides: readonly ScenePrefabOverrideOperation[];
}

export interface ScenePrefabMergeResult {
    readonly overrides: readonly ScenePrefabOverrideOperation[];
    readonly conflicts: readonly ScenePrefabConflict[];
    readonly resolved: boolean;
}

export interface ScenePrefabMergeDefinitionResult extends ScenePrefabMergeResult {
    readonly definition: ScenePrefabDefinition;
}

// ─── Resolution ─────────────────────────────────────────────────────

export interface ScenePrefabResolvedDefinition extends ScenePrefabDefinition {
    readonly kind: 'resolved';
    readonly base?: undefined;
    readonly nested?: undefined;
    readonly overrides?: undefined;
    readonly lineage: readonly string[];
}

export interface ScenePrefabResolveOptions {
    readonly liveOverrides?: readonly ScenePrefabOverrideOperation[];
}

export interface ScenePrefabResolutionResult {
    readonly definition: ScenePrefabResolvedDefinition;
    readonly conflicts: readonly ScenePrefabConflict[];
    readonly cacheHit: boolean;
}

// ─── Registry / resolver contracts ──────────────────────────────────

export interface ScenePrefabRegistrySource {
    getPrefab(prefabId: string): ScenePrefabDefinition | undefined;
}

export interface ScenePrefabResolver {
    resolvePrefab(
        prefab: ScenePrefabDefinition | ScenePrefabReference,
        options?: ScenePrefabResolveOptions
    ): ScenePrefabResolutionResult;
}

// ─── Instantiation options ──────────────────────────────────────────

export interface ScenePrefabInstantiateOptions {
    readonly namePrefix?: string;
    readonly componentArgsResolver?: (
        componentName: string,
        data: SceneSerializedValue
    ) => readonly unknown[] | undefined;
    readonly prefabResolver?: ScenePrefabResolver;
    readonly liveOverrides?: readonly ScenePrefabOverrideOperation[];
}
