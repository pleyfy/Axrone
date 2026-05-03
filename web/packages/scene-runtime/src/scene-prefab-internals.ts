import { ScenePrefabValidationError } from './errors';
import type {
    SceneActorSnapshot,
    SceneComponentSnapshot,
    ScenePrefabComponentSelector,
    ScenePrefabDefinition,
    ScenePrefabMetadata,
    ScenePrefabNestedInstance,
    ScenePrefabNodeSource,
    ScenePrefabOverrideOperation,
    ScenePrefabPropertyPath,
    ScenePrefabReference,
    SceneSerializedValue,
} from './types';

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const cloneStringArray = (value: readonly string[] | undefined): readonly string[] | undefined =>
    value ? value.map((entry) => entry) : undefined;

export const isSceneSerializedObjectValue = (
    value: SceneSerializedValue,
): value is Record<string, SceneSerializedValue> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export const isSceneSerializedStructuredValue = (
    value: SceneSerializedValue,
): value is Record<string, SceneSerializedValue> =>
    isSceneSerializedObjectValue(value) && !(hasOwn(value, '$type') && hasOwn(value, 'value'));

export const cloneSceneSerializedValue = (value: SceneSerializedValue): SceneSerializedValue => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneSceneSerializedValue(entry));
    }

    const clone: Record<string, SceneSerializedValue> = {};
    for (const [key, entry] of Object.entries(value)) {
        clone[key] = cloneSceneSerializedValue(entry);
    }
    return clone;
};

export const deepEqualSceneSerializedValue = (
    left: SceneSerializedValue,
    right: SceneSerializedValue,
): boolean => {
    if (left === right) {
        return true;
    }

    if (left === null || right === null) {
        return left === right;
    }

    if (typeof left !== typeof right) {
        return false;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        for (let index = 0; index < left.length; index += 1) {
            if (!deepEqualSceneSerializedValue(left[index]!, right[index]!)) {
                return false;
            }
        }

        return true;
    }

    if (!isSceneSerializedObjectValue(left) || !isSceneSerializedObjectValue(right)) {
        return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    for (const key of leftKeys) {
        if (!hasOwn(right, key) || !deepEqualSceneSerializedValue(left[key]!, right[key]!)) {
            return false;
        }
    }

    return true;
};

export const cloneScenePrefabNodeSource = (
    source: ScenePrefabNodeSource | undefined,
): ScenePrefabNodeSource | undefined =>
    source
        ? {
              prefabId: source.prefabId,
              nodeId: source.nodeId,
              ...(source.instancePath ? { instancePath: cloneStringArray(source.instancePath) } : {}),
              ...(source.lineage ? { lineage: cloneStringArray(source.lineage) } : {}),
          }
        : undefined;

export const cloneScenePrefabMetadata = (
    metadata: ScenePrefabMetadata | undefined,
): ScenePrefabMetadata | undefined =>
    metadata
        ? {
              ...(metadata.revision ? { revision: metadata.revision } : {}),
              ...(metadata.locale ? { locale: metadata.locale } : {}),
              ...(metadata.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
              ...(metadata.timeZone ? { timeZone: metadata.timeZone } : {}),
              ...(metadata.tags ? { tags: cloneStringArray(metadata.tags) } : {}),
          }
        : undefined;

export const cloneScenePrefabComponentSelector = (
    selector: ScenePrefabComponentSelector,
): ScenePrefabComponentSelector =>
    selector.kind === 'id'
        ? {
              kind: 'id',
              componentId: selector.componentId,
              ...(selector.type ? { type: selector.type } : {}),
          }
        : {
              kind: 'type',
              type: selector.type,
              ...(selector.occurrence !== undefined ? { occurrence: selector.occurrence } : {}),
          };

export const cloneSceneComponentSnapshot = (
    component: SceneComponentSnapshot,
): SceneComponentSnapshot => ({
    ...(component.id ? { id: component.id } : {}),
    type: component.type,
    data: cloneSceneSerializedValue(component.data),
});

export const cloneSceneActorSnapshot = (actor: SceneActorSnapshot): SceneActorSnapshot => ({
    ...(actor.nodeId ? { nodeId: actor.nodeId } : {}),
    ...(actor.parentNodeId !== undefined ? { parentNodeId: actor.parentNodeId ?? null } : {}),
    name: actor.name,
    layer: actor.layer,
    tag: actor.tag,
    active: actor.active,
    persistent: actor.persistent,
    pooled: actor.pooled,
    ...(actor.source ? { source: cloneScenePrefabNodeSource(actor.source) } : {}),
    components: actor.components.map((component) => cloneSceneComponentSnapshot(component)),
});

export const cloneScenePrefabOverrideOperation = (
    operation: ScenePrefabOverrideOperation,
): ScenePrefabOverrideOperation => {
    switch (operation.kind) {
        case 'add-actor':
            return {
                kind: 'add-actor',
                actor: cloneSceneActorSnapshot(operation.actor),
                ...(operation.afterNodeId ? { afterNodeId: operation.afterNodeId } : {}),
            };
        case 'remove-actor':
            return {
                kind: 'remove-actor',
                nodeId: operation.nodeId,
            };
        case 'reparent-actor':
            return {
                kind: 'reparent-actor',
                nodeId: operation.nodeId,
                ...(operation.parentNodeId !== undefined
                    ? { parentNodeId: operation.parentNodeId ?? null }
                    : {}),
            };
        case 'set-actor-field':
            return {
                kind: 'set-actor-field',
                nodeId: operation.nodeId,
                field: operation.field,
                value: operation.value,
            };
        case 'add-component':
            return {
                kind: 'add-component',
                nodeId: operation.nodeId,
                component: cloneSceneComponentSnapshot(operation.component),
                ...(operation.index !== undefined ? { index: operation.index } : {}),
            };
        case 'remove-component':
            return {
                kind: 'remove-component',
                nodeId: operation.nodeId,
                selector: cloneScenePrefabComponentSelector(operation.selector),
            };
        case 'replace-component':
            return {
                kind: 'replace-component',
                nodeId: operation.nodeId,
                selector: cloneScenePrefabComponentSelector(operation.selector),
                component: cloneSceneComponentSnapshot(operation.component),
            };
        case 'set-component-property':
            return {
                kind: 'set-component-property',
                nodeId: operation.nodeId,
                selector: cloneScenePrefabComponentSelector(operation.selector),
                path: [...operation.path],
                value: cloneSceneSerializedValue(operation.value),
            };
        case 'unset-component-property':
            return {
                kind: 'unset-component-property',
                nodeId: operation.nodeId,
                selector: cloneScenePrefabComponentSelector(operation.selector),
                path: [...operation.path],
            };
    }
};

const cloneScenePrefabNestedInstance = (
    nested: ScenePrefabNestedInstance,
    seen: WeakMap<ScenePrefabDefinition, ScenePrefabDefinition>,
): ScenePrefabNestedInstance => ({
    instanceId: nested.instanceId,
    reference: cloneScenePrefabReference(nested.reference, seen),
    ...(nested.parentNodeId !== undefined ? { parentNodeId: nested.parentNodeId ?? null } : {}),
    ...(nested.namePrefix ? { namePrefix: nested.namePrefix } : {}),
    ...(nested.overrides
        ? {
              overrides: nested.overrides.map((operation) =>
                  cloneScenePrefabOverrideOperation(operation),
              ),
          }
        : {}),
});

export const cloneScenePrefabReference = (
    reference: ScenePrefabReference,
    seen: WeakMap<ScenePrefabDefinition, ScenePrefabDefinition> = new WeakMap(),
): ScenePrefabReference =>
    reference.kind === 'inline'
        ? {
              kind: 'inline',
              prefab: cloneScenePrefabDefinition(reference.prefab, seen),
          }
        : {
              kind: 'registry',
              prefabId: reference.prefabId,
              ...(reference.revision ? { revision: reference.revision } : {}),
          };

export const cloneScenePrefabDefinition = (
    definition: ScenePrefabDefinition,
    seen: WeakMap<ScenePrefabDefinition, ScenePrefabDefinition> = new WeakMap(),
): ScenePrefabDefinition => {
    const cached = seen.get(definition);
    if (cached) {
        return cached;
    }

    const clone: {
        id: string;
        actors: readonly SceneActorSnapshot[];
        kind?: ScenePrefabDefinition['kind'];
        base?: ScenePrefabReference;
        nested?: readonly ScenePrefabNestedInstance[];
        overrides?: readonly ScenePrefabOverrideOperation[];
        metadata?: ScenePrefabMetadata;
        lineage?: readonly string[];
    } = {
        id: definition.id,
        actors: [],
    };

    seen.set(definition, clone as ScenePrefabDefinition);

    if (definition.kind) {
        clone.kind = definition.kind;
    }

    clone.actors = definition.actors.map((actor) => cloneSceneActorSnapshot(actor));

    if ('lineage' in definition && Array.isArray(definition.lineage)) {
        clone.lineage = cloneStringArray(definition.lineage);
    }

    if (definition.base) {
        clone.base = cloneScenePrefabReference(definition.base, seen);
    }

    if (definition.nested) {
        clone.nested = definition.nested.map((nested) => cloneScenePrefabNestedInstance(nested, seen));
    }

    if (definition.overrides) {
        clone.overrides = definition.overrides.map((operation) =>
            cloneScenePrefabOverrideOperation(operation),
        );
    }

    if (definition.metadata) {
        clone.metadata = cloneScenePrefabMetadata(definition.metadata);
    }

    return clone as ScenePrefabDefinition;
};

export const isScenePrefabReference = (value: unknown): value is ScenePrefabReference => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const reference = value as Partial<ScenePrefabReference>;
    return (
        (reference.kind === 'inline' && !!reference.prefab) ||
        (reference.kind === 'registry' && typeof reference.prefabId === 'string')
    );
};

export const isInlineScenePrefabReference = (
    reference: ScenePrefabReference,
): reference is Extract<ScenePrefabReference, { kind: 'inline' }> => reference.kind === 'inline';

export const createScenePrefabScopedNodeId = (
    instanceId: string,
    nodeId: string,
): string => `${instanceId}::${nodeId}`;

export const serializeScenePrefabPropertyPath = (path: ScenePrefabPropertyPath): string =>
    path
        .map((segment) =>
            typeof segment === 'number'
                ? `[${segment}]`
                : String(segment).replace(/[.[\]\\]/g, '\\$&'),
        )
        .join('.');

export const isScenePrefabPropertyPathAncestor = (
    ancestor: ScenePrefabPropertyPath,
    descendant: ScenePrefabPropertyPath,
): boolean =>
    ancestor.length <= descendant.length && ancestor.every((segment, index) => segment === descendant[index]);

export const createScenePrefabComponentSelector = (
    components: readonly SceneComponentSnapshot[],
    index: number,
): ScenePrefabComponentSelector => {
    const component = components[index];
    if (!component) {
        throw new ScenePrefabValidationError(`Cannot create component selector for index ${index}`);
    }

    if (component.id) {
        return {
            kind: 'id',
            componentId: component.id,
            ...(component.type ? { type: component.type } : {}),
        };
    }

    let occurrence = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (components[cursor]?.type === component.type) {
            occurrence += 1;
        }
    }

    return {
        kind: 'type',
        type: component.type,
        ...(occurrence > 0 ? { occurrence } : {}),
    };
};

export const getScenePrefabComponentSelectorKey = (
    selector: ScenePrefabComponentSelector,
): string =>
    selector.kind === 'id'
        ? `id:${selector.componentId}`
        : `type:${selector.type}#${selector.occurrence ?? 0}`;

export const findScenePrefabComponentIndex = (
    components: readonly SceneComponentSnapshot[],
    selector: ScenePrefabComponentSelector,
): number => {
    if (selector.kind === 'id') {
        const directIndex = components.findIndex((component) => component.id === selector.componentId);
        if (directIndex >= 0) {
            return directIndex;
        }
    }

    const typeName = selector.kind === 'type' ? selector.type : selector.type;
    if (!typeName) {
        return -1;
    }

    const targetOccurrence = selector.kind === 'type' ? selector.occurrence ?? 0 : 0;
    let occurrence = 0;

    for (let index = 0; index < components.length; index += 1) {
        if (components[index]?.type !== typeName) {
            continue;
        }

        if (occurrence === targetOccurrence) {
            return index;
        }

        occurrence += 1;
    }

    return -1;
};

export const ensureScenePrefabNodeId = (
    actor: SceneActorSnapshot,
    prefabId: string,
    index: number,
): string => {
    const nodeId = actor.nodeId?.trim();
    if (nodeId) {
        return nodeId;
    }

    throw new ScenePrefabValidationError(
        `Prefab '${prefabId}' actor at index ${index} is missing a stable nodeId`,
    );
};

export const hasScenePrefabComposition = (definition: ScenePrefabDefinition): boolean =>
    !!definition.base || (definition.nested?.length ?? 0) > 0 || (definition.overrides?.length ?? 0) > 0;