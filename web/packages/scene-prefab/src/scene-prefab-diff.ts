import {
    cloneSceneEntitySnapshot,
    cloneSceneComponentSnapshot,
    cloneScenePrefabOverrideOperation,
    cloneSceneSerializedValue,
    copySceneEntitySnapshot,
    copySceneComponentSnapshot,
    createScenePrefabComponentSelector,
    deepEqualSceneSerializedValue,
    getScenePrefabComponentSelectorKey,
    isScenePrefabPropertyPathAncestor,
    isSceneSerializedObjectValue,
    isSceneSerializedStructuredValue,
    serializeScenePrefabPropertyPath,
} from './scene-prefab-internals';
import {
    applyScenePrefabOverrides,
    createScenePrefabState,
    readSceneSerializedValueAtPath,
} from './scene-prefab-operations';
import type {
    SceneEntitySnapshot,
    SceneComponentSnapshot,
    ScenePrefabConflict,
    ScenePrefabComponentSelector,
    ScenePrefabDefinition,
    ScenePrefabDiffResult,
    ScenePrefabMergeDefinitionResult,
    ScenePrefabMergeOptions,
    ScenePrefabOverrideOperation,
    ScenePrefabPropertyPath,
    SceneSerializedValue,
} from './types';

interface IndexedComponentEntry {
    readonly selector: ScenePrefabComponentSelector;
    readonly component: SceneComponentSnapshot;
    readonly index: number;
}

interface OperationDescriptor {
    readonly entityUid: string;
    readonly scope:
        | 'entity-add'
        | 'entity-remove'
        | 'entity-field'
        | 'component-add'
        | 'component-remove'
        | 'component-replace'
        | 'component-property';
    readonly componentKey?: string;
    readonly fieldKey?: string;
    readonly path?: ScenePrefabPropertyPath;
}

const isEntitySnapshotValue = (value: unknown): value is SceneEntitySnapshot =>
    !!value &&
    typeof value === 'object' &&
    'name' in value &&
    'layer' in value &&
    'tag' in value &&
    'active' in value &&
    'persistent' in value &&
    'pooled' in value &&
    'components' in value &&
    Array.isArray(value.components);

const isComponentSnapshotValue = (value: unknown): value is SceneComponentSnapshot =>
    !!value && typeof value === 'object' && 'type' in value && 'data' in value;

const indexComponents = (
    components: readonly SceneComponentSnapshot[],
): Map<string, IndexedComponentEntry> => {
    const entries = new Map<string, IndexedComponentEntry>();

    for (let index = 0; index < components.length; index += 1) {
        const component = components[index]!;
        const selector = createScenePrefabComponentSelector(components, index);
        entries.set(getScenePrefabComponentSelectorKey(selector), {
            selector,
            component,
            index,
        });
    }

    return entries;
};

const topologicallyOrderAddedEntities = (
    entities: readonly SceneEntitySnapshot[],
    pendingEntityUids: ReadonlySet<string>,
): readonly SceneEntitySnapshot[] => {
    const entityIndex = new Map<string, SceneEntitySnapshot>();
    for (const entity of entities) {
        if (entity.nodeId) {
            entityIndex.set(entity.nodeId, entity);
        }
    }

    const ordered: SceneEntitySnapshot[] = [];
    const visited = new Set<string>();

    const visit = (entity: SceneEntitySnapshot): void => {
        const nodeId = entity.nodeId;
        if (!nodeId || visited.has(nodeId)) {
            return;
        }

        if (entity.parentNodeId && pendingEntityUids.has(entity.parentNodeId)) {
            const parentEntity = entityIndex.get(entity.parentNodeId);
            if (parentEntity) {
                visit(parentEntity);
            }
        }

        visited.add(nodeId);
        ordered.push(entity);
    };

    for (const entity of entities) {
        if (entity.nodeId && pendingEntityUids.has(entity.nodeId)) {
            visit(entity);
        }
    }

    return ordered;
};

const diffComponentValue = (
    nodeId: string,
    selector: ScenePrefabComponentSelector,
    baseValue: SceneSerializedValue,
    targetValue: SceneSerializedValue,
    path: readonly (string | number)[],
    overrides: ScenePrefabOverrideOperation[],
): void => {
    if (deepEqualSceneSerializedValue(baseValue, targetValue)) {
        return;
    }

    if (isSceneSerializedStructuredValue(baseValue) && isSceneSerializedStructuredValue(targetValue)) {
        const keys = new Set([...Object.keys(baseValue), ...Object.keys(targetValue)]);
        for (const key of keys) {
            if (!(key in targetValue)) {
                overrides.push({
                    kind: 'unset-component-property',
                    nodeId,
                    selector,
                    path: [...path, key],
                });
                continue;
            }

            if (!(key in baseValue)) {
                overrides.push({
                    kind: 'set-component-property',
                    nodeId,
                    selector,
                    path: [...path, key],
                    value: cloneSceneSerializedValue(targetValue[key]!),
                });
                continue;
            }

            diffComponentValue(
                nodeId,
                selector,
                baseValue[key]!,
                targetValue[key]!,
                [...path, key],
                overrides,
            );
        }

        return;
    }

    overrides.push({
        kind: 'set-component-property',
        nodeId,
        selector,
        path: [...path],
        value: cloneSceneSerializedValue(targetValue),
    });
};

const cloneConflictBaseValue = (
    value: SceneSerializedValue | SceneEntitySnapshot | SceneComponentSnapshot | string | number | boolean | null,
):
    | SceneSerializedValue
    | SceneEntitySnapshot
    | SceneComponentSnapshot
    | string
    | number
    | boolean
    | null => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (isEntitySnapshotValue(value)) {
        return cloneSceneEntitySnapshot(value);
    }

    if (isComponentSnapshotValue(value)) {
        return cloneSceneComponentSnapshot(value);
    }

    if (Array.isArray(value) || isSceneSerializedObjectValue(value)) {
        return cloneSceneSerializedValue(value);
    }

    return null;
};

const isSameComponentSelector = (
    left: ScenePrefabComponentSelector,
    right: ScenePrefabComponentSelector,
): boolean => {
    if (left.kind !== right.kind) {
        return false;
    }

    if (left.kind === 'id' && right.kind === 'id') {
        return left.componentId === right.componentId && (left.type ?? '') === (right.type ?? '');
    }

    if (left.kind === 'type' && right.kind === 'type') {
        return left.type === right.type && (left.occurrence ?? 0) === (right.occurrence ?? 0);
    }

    return false;
};

const isSamePropertyPath = (
    left: ScenePrefabPropertyPath,
    right: ScenePrefabPropertyPath,
): boolean =>
    left.length === right.length && left.every((segment, index) => segment === right[index]);

const isSameEntitySnapshot = (left: SceneEntitySnapshot, right: SceneEntitySnapshot): boolean => {
    if (
        left.nodeId !== right.nodeId ||
        (left.parentNodeId ?? null) !== (right.parentNodeId ?? null) ||
        left.name !== right.name ||
        left.layer !== right.layer ||
        left.tag !== right.tag ||
        left.active !== right.active ||
        left.persistent !== right.persistent ||
        left.pooled !== right.pooled ||
        left.components.length !== right.components.length
    ) {
        return false;
    }

    if ((left.source?.prefabId ?? '') !== (right.source?.prefabId ?? '')) {
        return false;
    }

    return left.components.every((component, index) =>
        isSameComponentSnapshot(component, right.components[index]!),
    );
};

const isSameComponentSnapshot = (
    left: SceneComponentSnapshot,
    right: SceneComponentSnapshot,
): boolean =>
    left.id === right.id &&
    left.type === right.type &&
    deepEqualSceneSerializedValue(left.data, right.data);

const isSameOverrideOperation = (
    left: ScenePrefabOverrideOperation,
    right: ScenePrefabOverrideOperation,
): boolean => {
    if (left.kind !== right.kind) {
        return false;
    }

    switch (left.kind) {
        case 'add-entity':
            return (
                right.kind === 'add-entity' &&
                left.afterNodeId === right.afterNodeId &&
                isSameEntitySnapshot(left.entity, right.entity)
            );
        case 'remove-entity':
            return right.kind === 'remove-entity' && left.nodeId === right.nodeId;
        case 'reparent-entity':
            return (
                right.kind === 'reparent-entity' &&
                left.nodeId === right.nodeId &&
                left.parentNodeId === right.parentNodeId
            );
        case 'set-entity-field':
            return (
                right.kind === 'set-entity-field' &&
                left.nodeId === right.nodeId &&
                left.field === right.field &&
                left.value === right.value
            );
        case 'add-component':
            return (
                right.kind === 'add-component' &&
                left.nodeId === right.nodeId &&
                left.index === right.index &&
                isSameComponentSnapshot(left.component, right.component)
            );
        case 'remove-component':
            return (
                right.kind === 'remove-component' &&
                left.nodeId === right.nodeId &&
                isSameComponentSelector(left.selector, right.selector)
            );
        case 'replace-component':
            return (
                right.kind === 'replace-component' &&
                left.nodeId === right.nodeId &&
                isSameComponentSelector(left.selector, right.selector) &&
                isSameComponentSnapshot(left.component, right.component)
            );
        case 'set-component-property':
            return (
                right.kind === 'set-component-property' &&
                left.nodeId === right.nodeId &&
                isSameComponentSelector(left.selector, right.selector) &&
                isSamePropertyPath(left.path, right.path) &&
                deepEqualSceneSerializedValue(left.value, right.value)
            );
        case 'unset-component-property':
            return (
                right.kind === 'unset-component-property' &&
                left.nodeId === right.nodeId &&
                isSameComponentSelector(left.selector, right.selector) &&
                isSamePropertyPath(left.path, right.path)
            );
    }
};

const describeOperation = (operation: ScenePrefabOverrideOperation): OperationDescriptor => {
    switch (operation.kind) {
        case 'add-entity':
            return {
                entityUid: operation.entity.nodeId ?? '',
                scope: 'entity-add',
            };
        case 'remove-entity':
            return {
                entityUid: operation.nodeId,
                scope: 'entity-remove',
            };
        case 'reparent-entity':
            return {
                entityUid: operation.nodeId,
                scope: 'entity-field',
                fieldKey: 'parentNodeId',
            };
        case 'set-entity-field':
            return {
                entityUid: operation.nodeId,
                scope: 'entity-field',
                fieldKey: operation.field,
            };
        case 'add-component':
            return {
                entityUid: operation.nodeId,
                scope: 'component-add',
                componentKey: operation.component.id
                    ? `id:${operation.component.id}`
                    : `type:${operation.component.type}`,
            };
        case 'remove-component':
            return {
                entityUid: operation.nodeId,
                scope: 'component-remove',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
            };
        case 'replace-component':
            return {
                entityUid: operation.nodeId,
                scope: 'component-replace',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
            };
        case 'set-component-property':
            return {
                entityUid: operation.nodeId,
                scope: 'component-property',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
                path: operation.path,
            };
        case 'unset-component-property':
            return {
                entityUid: operation.nodeId,
                scope: 'component-property',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
                path: operation.path,
            };
    }
};

const operationsConflict = (
    left: ScenePrefabOverrideOperation,
    right: ScenePrefabOverrideOperation,
): boolean => {
    const leftDescriptor = describeOperation(left);
    const rightDescriptor = describeOperation(right);

    if (leftDescriptor.entityUid !== rightDescriptor.entityUid) {
        return false;
    }

    if (leftDescriptor.scope === 'entity-remove' || rightDescriptor.scope === 'entity-remove') {
        return true;
    }

    if (leftDescriptor.scope === 'entity-add' || rightDescriptor.scope === 'entity-add') {
        return true;
    }

    if (!leftDescriptor.componentKey && !rightDescriptor.componentKey) {
        if (!leftDescriptor.fieldKey || !rightDescriptor.fieldKey) {
            return true;
        }

        return leftDescriptor.fieldKey === rightDescriptor.fieldKey;
    }

    if (!leftDescriptor.componentKey || !rightDescriptor.componentKey) {
        return false;
    }

    if (leftDescriptor.componentKey !== rightDescriptor.componentKey) {
        return false;
    }

    if (
        leftDescriptor.scope === 'component-add' ||
        leftDescriptor.scope === 'component-remove' ||
        leftDescriptor.scope === 'component-replace' ||
        rightDescriptor.scope === 'component-add' ||
        rightDescriptor.scope === 'component-remove' ||
        rightDescriptor.scope === 'component-replace'
    ) {
        return true;
    }

    if (!leftDescriptor.path || !rightDescriptor.path) {
        return true;
    }

    return (
        isScenePrefabPropertyPathAncestor(leftDescriptor.path, rightDescriptor.path) ||
        isScenePrefabPropertyPathAncestor(rightDescriptor.path, leftDescriptor.path)
    );
};

const createConflictKey = (left: OperationDescriptor, right: OperationDescriptor): string => {
    const componentKey = left.componentKey ?? right.componentKey;
    if (!componentKey) {
        return left.fieldKey === right.fieldKey && left.fieldKey
            ? `entity:${left.entityUid}:field:${left.fieldKey}`
            : `entity:${left.entityUid}`;
    }

    const path = left.path ?? right.path;
    return path && path.length > 0
        ? `component:${left.entityUid}:${componentKey}:path:${serializeScenePrefabPropertyPath(path)}`
        : `component:${left.entityUid}:${componentKey}`;
};

const createConflict = (
    base: ScenePrefabDefinition,
    local: ScenePrefabOverrideOperation,
    incoming: ScenePrefabOverrideOperation,
): ScenePrefabConflict => {
    const baseState = createScenePrefabState(base);
    const localDescriptor = describeOperation(local);
    const incomingDescriptor = describeOperation(incoming);
    const entity = baseState.entityIndex.get(localDescriptor.entityUid);

    let baseValue:
        | SceneSerializedValue
        | SceneEntitySnapshot
        | SceneComponentSnapshot
        | string
        | number
        | boolean
        | null = null;

    if (!entity) {
        baseValue = null;
    } else if (!localDescriptor.componentKey) {
        if (!localDescriptor.fieldKey) {
            baseValue = cloneSceneEntitySnapshot({
                nodeId: entity.nodeId,
                parentNodeId: entity.parentNodeId,
                name: entity.name,
                layer: entity.layer,
                tag: entity.tag,
                active: entity.active,
                persistent: entity.persistent,
                pooled: entity.pooled,
                ...(entity.source ? { source: entity.source } : {}),
                components: entity.components.map((component) => copySceneComponentSnapshot(component)),
            });
        } else {
            switch (localDescriptor.fieldKey) {
                case 'parentNodeId':
                    baseValue = entity.parentNodeId;
                    break;
                case 'name':
                    baseValue = entity.name;
                    break;
                case 'layer':
                    baseValue = entity.layer;
                    break;
                case 'tag':
                    baseValue = entity.tag;
                    break;
                case 'active':
                    baseValue = entity.active;
                    break;
                case 'persistent':
                    baseValue = entity.persistent;
                    break;
                case 'pooled':
                    baseValue = entity.pooled;
                    break;
            }
        }
    } else {
        const componentEntry = indexComponents(
            entity.components.map((component) => copySceneComponentSnapshot(component)),
        ).get(localDescriptor.componentKey);

        if (!componentEntry) {
            baseValue = null;
        } else if (!localDescriptor.path || localDescriptor.path.length === 0) {
            baseValue = cloneSceneComponentSnapshot(componentEntry.component);
        } else {
            baseValue = readSceneSerializedValueAtPath(componentEntry.component.data, localDescriptor.path);
        }
    }

    return {
        key: createConflictKey(localDescriptor, incomingDescriptor),
        local: cloneScenePrefabOverrideOperation(local),
        incoming: cloneScenePrefabOverrideOperation(incoming),
        baseValue: cloneConflictBaseValue(baseValue),
    };
};

const resolveConflictChoice = (
    conflict: ScenePrefabConflict,
    options: ScenePrefabMergeOptions,
): 'manual' | 'local' | 'incoming' | 'base' => {
    if (options.conflictResolver) {
        return options.conflictResolver(conflict);
    }

    switch (options.conflictPolicy ?? 'manual') {
        case 'prefer-local':
            return 'local';
        case 'prefer-incoming':
            return 'incoming';
        case 'prefer-base':
            return 'base';
        default:
            return 'manual';
    }
};

export const diffScenePrefabDefinitions = (
    base: ScenePrefabDefinition,
    target: ScenePrefabDefinition,
): ScenePrefabDiffResult => {
    const baseState = createScenePrefabState(base);
    const targetState = createScenePrefabState(target);
    const overrides: ScenePrefabOverrideOperation[] = [];

    const removedEntityUids = new Set<string>();
    for (const entity of baseState.entities) {
        if (!targetState.entityIndex.has(entity.nodeId)) {
            removedEntityUids.add(entity.nodeId);
        }
    }

    for (const entity of baseState.entities) {
        if (!removedEntityUids.has(entity.nodeId)) {
            continue;
        }

        if (entity.parentNodeId && removedEntityUids.has(entity.parentNodeId)) {
            continue;
        }

        overrides.push({
            kind: 'remove-entity',
            nodeId: entity.nodeId,
        });
    }

    const addedEntityUids = new Set<string>();
    for (const entity of targetState.entities) {
        if (!baseState.entityIndex.has(entity.nodeId)) {
            addedEntityUids.add(entity.nodeId);
        }
    }

    for (const entity of topologicallyOrderAddedEntities(
        targetState.entities.map((entry) => copySceneEntitySnapshot(entry)),
        addedEntityUids,
    )) {
        overrides.push({
            kind: 'add-entity',
            entity: cloneSceneEntitySnapshot(entity),
        });
    }

    for (const baseEntity of baseState.entities) {
        const targetEntity = targetState.entityIndex.get(baseEntity.nodeId);
        if (!targetEntity) {
            continue;
        }

        if (baseEntity.parentNodeId !== targetEntity.parentNodeId) {
            overrides.push({
                kind: 'reparent-entity',
                nodeId: baseEntity.nodeId,
                parentNodeId: targetEntity.parentNodeId,
            });
        }

        if (baseEntity.name !== targetEntity.name) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'name',
                value: targetEntity.name,
            });
        }

        if (baseEntity.layer !== targetEntity.layer) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'layer',
                value: targetEntity.layer,
            });
        }

        if (baseEntity.tag !== targetEntity.tag) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'tag',
                value: targetEntity.tag,
            });
        }

        if (baseEntity.active !== targetEntity.active) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'active',
                value: targetEntity.active,
            });
        }

        if (baseEntity.persistent !== targetEntity.persistent) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'persistent',
                value: targetEntity.persistent,
            });
        }

        if (baseEntity.pooled !== targetEntity.pooled) {
            overrides.push({
                kind: 'set-entity-field',
                nodeId: baseEntity.nodeId,
                field: 'pooled',
                value: targetEntity.pooled,
            });
        }

        const baseComponents = indexComponents(
            baseEntity.components.map((component) => copySceneComponentSnapshot(component)),
        );
        const targetComponents = indexComponents(
            targetEntity.components.map((component) => copySceneComponentSnapshot(component)),
        );

        for (const [key, entry] of baseComponents) {
            if (!targetComponents.has(key)) {
                overrides.push({
                    kind: 'remove-component',
                    nodeId: baseEntity.nodeId,
                    selector: entry.selector,
                });
            }
        }

        for (const [key, entry] of targetComponents) {
            if (!baseComponents.has(key)) {
                overrides.push({
                    kind: 'add-component',
                    nodeId: baseEntity.nodeId,
                    component: cloneSceneComponentSnapshot(entry.component),
                    index: entry.index,
                });
            }
        }

        for (const [key, baseEntry] of baseComponents) {
            const targetEntry = targetComponents.get(key);
            if (!targetEntry) {
                continue;
            }

            if (baseEntry.component.type !== targetEntry.component.type) {
                overrides.push({
                    kind: 'replace-component',
                    nodeId: baseEntity.nodeId,
                    selector: baseEntry.selector,
                    component: cloneSceneComponentSnapshot(targetEntry.component),
                });
                continue;
            }

            diffComponentValue(
                baseEntity.nodeId,
                baseEntry.selector,
                baseEntry.component.data,
                targetEntry.component.data,
                [],
                overrides,
            );
        }
    }

    return {
        basePrefabId: base.id,
        targetPrefabId: target.id,
        overrides,
    };
};

export const mergeScenePrefabDefinitions = (
    base: ScenePrefabDefinition,
    local: ScenePrefabDefinition,
    incoming: ScenePrefabDefinition,
    options: ScenePrefabMergeOptions = {},
): ScenePrefabMergeDefinitionResult => {
    const localOverrides = diffScenePrefabDefinitions(base, local).overrides.map((operation) =>
        cloneScenePrefabOverrideOperation(operation),
    );
    const incomingOverrides = diffScenePrefabDefinitions(base, incoming).overrides;
    const mergedOverrides = [...localOverrides];
    const conflicts: ScenePrefabConflict[] = [];

    for (const incomingOperation of incomingOverrides) {
        if (mergedOverrides.some((existing) => isSameOverrideOperation(existing, incomingOperation))) {
            continue;
        }

        const conflictIndexes: number[] = [];
        for (let index = 0; index < mergedOverrides.length; index += 1) {
            if (operationsConflict(mergedOverrides[index]!, incomingOperation)) {
                conflictIndexes.push(index);
            }
        }

        if (conflictIndexes.length === 0) {
            mergedOverrides.push(cloneScenePrefabOverrideOperation(incomingOperation));
            continue;
        }

        const firstConflict = createConflict(base, mergedOverrides[conflictIndexes[0]!]!, incomingOperation);
        const choice = resolveConflictChoice(firstConflict, options);

        if (choice === 'manual') {
            const conflictingOperations = conflictIndexes.map((index) => mergedOverrides[index]!);
            for (const index of [...conflictIndexes].sort((left, right) => right - left)) {
                mergedOverrides.splice(index, 1);
            }

            for (const localOperation of conflictingOperations) {
                conflicts.push(createConflict(base, localOperation, incomingOperation));
            }

            continue;
        }

        if (choice === 'local') {
            continue;
        }

        for (const index of [...conflictIndexes].sort((left, right) => right - left)) {
            mergedOverrides.splice(index, 1);
        }

        if (choice === 'incoming') {
            mergedOverrides.push(cloneScenePrefabOverrideOperation(incomingOperation));
        }
    }

    return {
        overrides: mergedOverrides,
        conflicts,
        resolved: conflicts.length === 0,
        definition: applyScenePrefabOverrides(base, mergedOverrides),
    };
};