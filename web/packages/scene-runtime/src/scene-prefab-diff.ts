import {
    cloneSceneActorSnapshot,
    cloneSceneComponentSnapshot,
    cloneScenePrefabOverrideOperation,
    cloneSceneSerializedValue,
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
    SceneActorSnapshot,
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
    readonly actorId: string;
    readonly scope:
        | 'actor-add'
        | 'actor-remove'
        | 'actor-field'
        | 'component-add'
        | 'component-remove'
        | 'component-replace'
        | 'component-property';
    readonly componentKey?: string;
    readonly fieldKey?: string;
    readonly path?: ScenePrefabPropertyPath;
}

const isActorSnapshotValue = (value: unknown): value is SceneActorSnapshot =>
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

const topologicallyOrderAddedActors = (
    actors: readonly SceneActorSnapshot[],
    pendingActorIds: ReadonlySet<string>,
): readonly SceneActorSnapshot[] => {
    const actorIndex = new Map<string, SceneActorSnapshot>();
    for (const actor of actors) {
        if (actor.nodeId) {
            actorIndex.set(actor.nodeId, actor);
        }
    }

    const ordered: SceneActorSnapshot[] = [];
    const visited = new Set<string>();

    const visit = (actor: SceneActorSnapshot): void => {
        const nodeId = actor.nodeId;
        if (!nodeId || visited.has(nodeId)) {
            return;
        }

        if (actor.parentNodeId && pendingActorIds.has(actor.parentNodeId)) {
            const parentActor = actorIndex.get(actor.parentNodeId);
            if (parentActor) {
                visit(parentActor);
            }
        }

        visited.add(nodeId);
        ordered.push(actor);
    };

    for (const actor of actors) {
        if (actor.nodeId && pendingActorIds.has(actor.nodeId)) {
            visit(actor);
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
    value: SceneSerializedValue | SceneActorSnapshot | SceneComponentSnapshot | string | number | boolean | null,
):
    | SceneSerializedValue
    | SceneActorSnapshot
    | SceneComponentSnapshot
    | string
    | number
    | boolean
    | null => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (isActorSnapshotValue(value)) {
        return cloneSceneActorSnapshot(value);
    }

    if (isComponentSnapshotValue(value)) {
        return cloneSceneComponentSnapshot(value);
    }

    if (Array.isArray(value) || isSceneSerializedObjectValue(value)) {
        return cloneSceneSerializedValue(value);
    }

    return null;
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
        case 'add-actor':
            return (
                right.kind === 'add-actor' &&
                left.afterNodeId === right.afterNodeId &&
                JSON.stringify(left.actor) === JSON.stringify(right.actor)
            );
        case 'remove-actor':
            return right.kind === 'remove-actor' && left.nodeId === right.nodeId;
        case 'reparent-actor':
            return (
                right.kind === 'reparent-actor' &&
                left.nodeId === right.nodeId &&
                left.parentNodeId === right.parentNodeId
            );
        case 'set-actor-field':
            return (
                right.kind === 'set-actor-field' &&
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
                JSON.stringify(left.selector) === JSON.stringify(right.selector)
            );
        case 'replace-component':
            return (
                right.kind === 'replace-component' &&
                left.nodeId === right.nodeId &&
                JSON.stringify(left.selector) === JSON.stringify(right.selector) &&
                isSameComponentSnapshot(left.component, right.component)
            );
        case 'set-component-property':
            return (
                right.kind === 'set-component-property' &&
                left.nodeId === right.nodeId &&
                JSON.stringify(left.selector) === JSON.stringify(right.selector) &&
                JSON.stringify(left.path) === JSON.stringify(right.path) &&
                deepEqualSceneSerializedValue(left.value, right.value)
            );
        case 'unset-component-property':
            return (
                right.kind === 'unset-component-property' &&
                left.nodeId === right.nodeId &&
                JSON.stringify(left.selector) === JSON.stringify(right.selector) &&
                JSON.stringify(left.path) === JSON.stringify(right.path)
            );
    }
};

const describeOperation = (operation: ScenePrefabOverrideOperation): OperationDescriptor => {
    switch (operation.kind) {
        case 'add-actor':
            return {
                actorId: operation.actor.nodeId ?? '',
                scope: 'actor-add',
            };
        case 'remove-actor':
            return {
                actorId: operation.nodeId,
                scope: 'actor-remove',
            };
        case 'reparent-actor':
            return {
                actorId: operation.nodeId,
                scope: 'actor-field',
                fieldKey: 'parentNodeId',
            };
        case 'set-actor-field':
            return {
                actorId: operation.nodeId,
                scope: 'actor-field',
                fieldKey: operation.field,
            };
        case 'add-component':
            return {
                actorId: operation.nodeId,
                scope: 'component-add',
                componentKey: operation.component.id
                    ? `id:${operation.component.id}`
                    : `type:${operation.component.type}`,
            };
        case 'remove-component':
            return {
                actorId: operation.nodeId,
                scope: 'component-remove',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
            };
        case 'replace-component':
            return {
                actorId: operation.nodeId,
                scope: 'component-replace',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
            };
        case 'set-component-property':
            return {
                actorId: operation.nodeId,
                scope: 'component-property',
                componentKey: getScenePrefabComponentSelectorKey(operation.selector),
                path: operation.path,
            };
        case 'unset-component-property':
            return {
                actorId: operation.nodeId,
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

    if (leftDescriptor.actorId !== rightDescriptor.actorId) {
        return false;
    }

    if (leftDescriptor.scope === 'actor-remove' || rightDescriptor.scope === 'actor-remove') {
        return true;
    }

    if (leftDescriptor.scope === 'actor-add' || rightDescriptor.scope === 'actor-add') {
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
            ? `actor:${left.actorId}:field:${left.fieldKey}`
            : `actor:${left.actorId}`;
    }

    const path = left.path ?? right.path;
    return path && path.length > 0
        ? `component:${left.actorId}:${componentKey}:path:${serializeScenePrefabPropertyPath(path)}`
        : `component:${left.actorId}:${componentKey}`;
};

const createConflict = (
    base: ScenePrefabDefinition,
    local: ScenePrefabOverrideOperation,
    incoming: ScenePrefabOverrideOperation,
): ScenePrefabConflict => {
    const baseState = createScenePrefabState(base);
    const localDescriptor = describeOperation(local);
    const incomingDescriptor = describeOperation(incoming);
    const actor = baseState.actorIndex.get(localDescriptor.actorId);

    let baseValue:
        | SceneSerializedValue
        | SceneActorSnapshot
        | SceneComponentSnapshot
        | string
        | number
        | boolean
        | null = null;

    if (!actor) {
        baseValue = null;
    } else if (!localDescriptor.componentKey) {
        if (!localDescriptor.fieldKey) {
            baseValue = cloneSceneActorSnapshot({
                nodeId: actor.nodeId,
                parentNodeId: actor.parentNodeId,
                name: actor.name,
                layer: actor.layer,
                tag: actor.tag,
                active: actor.active,
                persistent: actor.persistent,
                pooled: actor.pooled,
                ...(actor.source ? { source: actor.source } : {}),
                components: actor.components.map((component) => ({
                    ...(component.id ? { id: component.id } : {}),
                    type: component.type,
                    data: component.data,
                })),
            });
        } else {
            switch (localDescriptor.fieldKey) {
                case 'parentNodeId':
                    baseValue = actor.parentNodeId;
                    break;
                case 'name':
                    baseValue = actor.name;
                    break;
                case 'layer':
                    baseValue = actor.layer;
                    break;
                case 'tag':
                    baseValue = actor.tag;
                    break;
                case 'active':
                    baseValue = actor.active;
                    break;
                case 'persistent':
                    baseValue = actor.persistent;
                    break;
                case 'pooled':
                    baseValue = actor.pooled;
                    break;
            }
        }
    } else {
        const componentEntry = indexComponents(
            actor.components.map((component) => ({
                ...(component.id ? { id: component.id } : {}),
                type: component.type,
                data: component.data,
            })),
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

    const removedActorIds = new Set<string>();
    for (const actor of baseState.actors) {
        if (!targetState.actorIndex.has(actor.nodeId)) {
            removedActorIds.add(actor.nodeId);
        }
    }

    for (const actor of baseState.actors) {
        if (!removedActorIds.has(actor.nodeId)) {
            continue;
        }

        if (actor.parentNodeId && removedActorIds.has(actor.parentNodeId)) {
            continue;
        }

        overrides.push({
            kind: 'remove-actor',
            nodeId: actor.nodeId,
        });
    }

    const addedActorIds = new Set<string>();
    for (const actor of targetState.actors) {
        if (!baseState.actorIndex.has(actor.nodeId)) {
            addedActorIds.add(actor.nodeId);
        }
    }

    for (const actor of topologicallyOrderAddedActors(
        targetState.actors.map((entry) => ({
            nodeId: entry.nodeId,
            parentNodeId: entry.parentNodeId,
            name: entry.name,
            layer: entry.layer,
            tag: entry.tag,
            active: entry.active,
            persistent: entry.persistent,
            pooled: entry.pooled,
            ...(entry.source ? { source: entry.source } : {}),
            components: entry.components.map((component) => ({
                ...(component.id ? { id: component.id } : {}),
                type: component.type,
                data: component.data,
            })),
        })),
        addedActorIds,
    )) {
        overrides.push({
            kind: 'add-actor',
            actor: cloneSceneActorSnapshot(actor),
        });
    }

    for (const baseActor of baseState.actors) {
        const targetActor = targetState.actorIndex.get(baseActor.nodeId);
        if (!targetActor) {
            continue;
        }

        if (baseActor.parentNodeId !== targetActor.parentNodeId) {
            overrides.push({
                kind: 'reparent-actor',
                nodeId: baseActor.nodeId,
                parentNodeId: targetActor.parentNodeId,
            });
        }

        if (baseActor.name !== targetActor.name) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'name',
                value: targetActor.name,
            });
        }

        if (baseActor.layer !== targetActor.layer) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'layer',
                value: targetActor.layer,
            });
        }

        if (baseActor.tag !== targetActor.tag) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'tag',
                value: targetActor.tag,
            });
        }

        if (baseActor.active !== targetActor.active) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'active',
                value: targetActor.active,
            });
        }

        if (baseActor.persistent !== targetActor.persistent) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'persistent',
                value: targetActor.persistent,
            });
        }

        if (baseActor.pooled !== targetActor.pooled) {
            overrides.push({
                kind: 'set-actor-field',
                nodeId: baseActor.nodeId,
                field: 'pooled',
                value: targetActor.pooled,
            });
        }

        const baseComponents = indexComponents(
            baseActor.components.map((component) => ({
                ...(component.id ? { id: component.id } : {}),
                type: component.type,
                data: component.data,
            })),
        );
        const targetComponents = indexComponents(
            targetActor.components.map((component) => ({
                ...(component.id ? { id: component.id } : {}),
                type: component.type,
                data: component.data,
            })),
        );

        for (const [key, entry] of baseComponents) {
            if (!targetComponents.has(key)) {
                overrides.push({
                    kind: 'remove-component',
                    nodeId: baseActor.nodeId,
                    selector: entry.selector,
                });
            }
        }

        for (const [key, entry] of targetComponents) {
            if (!baseComponents.has(key)) {
                overrides.push({
                    kind: 'add-component',
                    nodeId: baseActor.nodeId,
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
                    nodeId: baseActor.nodeId,
                    selector: baseEntry.selector,
                    component: cloneSceneComponentSnapshot(targetEntry.component),
                });
                continue;
            }

            diffComponentValue(
                baseActor.nodeId,
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
            for (const index of [...conflictIndexes].sort((left, right) => right - left)) {
                mergedOverrides.splice(index, 1);
            }

            for (const index of conflictIndexes) {
                conflicts.push(createConflict(base, localOverrides[index]!, incomingOperation));
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