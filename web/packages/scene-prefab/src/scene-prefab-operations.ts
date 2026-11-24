import { ScenePrefabValidationError } from './errors';
import {
    cloneSceneEntitySnapshot,
    cloneSceneComponentSnapshot,
    cloneScenePrefabDefinition,
    cloneScenePrefabMetadata,
    cloneScenePrefabNodeSource,
    cloneSceneSerializedValue,
    createScenePrefabScopedNodeId,
    ensureScenePrefabNodeId,
    findScenePrefabComponentIndex,
    isSceneSerializedObjectValue,
} from './scene-prefab-internals';
import type {
    SceneEntitySnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
    ScenePrefabNestedInstance,
    ScenePrefabOverrideOperation,
    ScenePrefabPropertyPath,
    ScenePrefabResolvedDefinition,
    ScenePrefabNodeSource,
    SceneSerializedValue,
} from './types';

interface MutableSceneComponentSnapshot {
    id?: string;
    type: string;
    data: SceneSerializedValue;
}

interface MutableSceneEntitySnapshot {
    nodeId: string;
    parentNodeId: string | null;
    name: string;
    layer: number;
    tag: string;
    active: boolean;
    persistent: boolean;
    pooled: boolean;
    source?: ScenePrefabNodeSource;
    components: MutableSceneComponentSnapshot[];
}

export interface ScenePrefabState {
    id: string;
    entities: MutableSceneEntitySnapshot[];
    entityIndex: Map<string, MutableSceneEntitySnapshot>;
}

const toMutableComponent = (component: SceneComponentSnapshot): MutableSceneComponentSnapshot => ({
    ...(component.id ? { id: component.id } : {}),
    type: component.type,
    data: cloneSceneSerializedValue(component.data),
});

const createEntitySource = (
    entity: SceneEntitySnapshot,
    nodeId: string,
    sourcePrefabId: string,
    lineage: readonly string[],
): ScenePrefabNodeSource =>
    cloneScenePrefabNodeSource(entity.source) ?? {
        prefabId: sourcePrefabId,
        nodeId,
        ...(lineage.length > 0 ? { lineage: [...lineage] } : {}),
    };

const toMutableEntity = (
    entity: SceneEntitySnapshot,
    index: number,
    sourcePrefabId: string,
    lineage: readonly string[],
): MutableSceneEntitySnapshot => {
    const nodeId = ensureScenePrefabNodeId(entity, sourcePrefabId, index);
    return {
        nodeId,
        parentNodeId: entity.parentNodeId ?? null,
        name: entity.name,
        layer: entity.layer,
        tag: entity.tag,
        active: entity.active,
        persistent: entity.persistent,
        pooled: entity.pooled,
        source: createEntitySource(entity, nodeId, sourcePrefabId, lineage),
        components: entity.components.map((component) => toMutableComponent(component)),
    };
};

const materializeComponent = (component: MutableSceneComponentSnapshot): SceneComponentSnapshot => ({
    ...(component.id ? { id: component.id } : {}),
    type: component.type,
    data: cloneSceneSerializedValue(component.data),
});

const materializeEntity = (entity: MutableSceneEntitySnapshot): SceneEntitySnapshot => ({
    nodeId: entity.nodeId,
    parentNodeId: entity.parentNodeId,
    name: entity.name,
    layer: entity.layer,
    tag: entity.tag,
    active: entity.active,
    persistent: entity.persistent,
    pooled: entity.pooled,
    ...(entity.source ? { source: cloneScenePrefabNodeSource(entity.source) } : {}),
    components: entity.components.map((component) => materializeComponent(component)),
});

const rebuildEntityIndex = (state: ScenePrefabState): void => {
    state.entityIndex.clear();
    for (const entity of state.entities) {
        if (state.entityIndex.has(entity.nodeId)) {
            throw new ScenePrefabValidationError(
                `Prefab '${state.id}' contains duplicate entity nodeId '${entity.nodeId}'`,
            );
        }
        state.entityIndex.set(entity.nodeId, entity);

        const seenComponentIds = new Set<string>();
        for (const component of entity.components) {
            if (!component.id) {
                continue;
            }
            if (seenComponentIds.has(component.id)) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' entity '${entity.nodeId}' contains duplicate component '${component.id}'`,
                );
            }
            seenComponentIds.add(component.id);
        }
    }
};

export const getScenePrefabLineage = (definition: ScenePrefabDefinition): readonly string[] =>
    definition.kind === 'resolved' && 'lineage' in definition && Array.isArray(definition.lineage)
        ? definition.lineage
        : [definition.id];

export const createScenePrefabState = (
    definition: Pick<ScenePrefabDefinition, 'id' | 'entities'>,
    sourcePrefabId = definition.id,
    lineage: readonly string[] = [sourcePrefabId],
): ScenePrefabState => {
    const entities = definition.entities.map((entity, index) =>
        toMutableEntity(entity, index, sourcePrefabId, lineage),
    );
    const state: ScenePrefabState = {
        id: definition.id,
        entities,
        entityIndex: new Map<string, MutableSceneEntitySnapshot>(),
    };
    rebuildEntityIndex(state);
    return state;
};

export const materializeScenePrefabEntities = (
    state: ScenePrefabState,
): readonly SceneEntitySnapshot[] => state.entities.map((entity) => materializeEntity(entity));

export const materializeScenePrefabDefinition = (
    definition: ScenePrefabDefinition,
    state: ScenePrefabState,
): ScenePrefabDefinition => {
    const clone = cloneScenePrefabDefinition(definition);
    return {
        ...clone,
        entities: materializeScenePrefabEntities(state),
    };
};

export const materializeScenePrefabResolvedDefinition = (
    definition: ScenePrefabDefinition,
    state: ScenePrefabState,
    lineage: readonly string[],
): ScenePrefabResolvedDefinition => ({
    id: definition.id,
    kind: 'resolved',
    entities: materializeScenePrefabEntities(state),
    lineage: [...lineage],
    ...(definition.metadata ? { metadata: cloneScenePrefabMetadata(definition.metadata) } : {}),
});

export const mergeScenePrefabEntities = (
    state: ScenePrefabState,
    entities: readonly SceneEntitySnapshot[],
    sourcePrefabId: string,
    lineage: readonly string[] = [sourcePrefabId],
): void => {
    const entityPositions = new Map<string, number>();
    for (let position = 0; position < state.entities.length; position += 1) {
        entityPositions.set(state.entities[position]!.nodeId, position);
    }

    for (let index = 0; index < entities.length; index += 1) {
        const entity = toMutableEntity(entities[index]!, index, sourcePrefabId, lineage);
        const existingPosition = entityPositions.get(entity.nodeId);
        if (existingPosition !== undefined) {
            state.entities.splice(existingPosition, 1, entity);
        } else {
            entityPositions.set(entity.nodeId, state.entities.length);
            state.entities.push(entity);
        }

        state.entityIndex.set(entity.nodeId, entity);
    }
};

export const validateScenePrefabState = (state: ScenePrefabState): void => {
    rebuildEntityIndex(state);

    for (const entity of state.entities) {
        if (entity.parentNodeId !== null && !state.entityIndex.has(entity.parentNodeId)) {
            throw new ScenePrefabValidationError(
                `Prefab '${state.id}' entity '${entity.nodeId}' references missing parent '${entity.parentNodeId}'`,
            );
        }
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
        if (visited.has(nodeId)) {
            return;
        }

        if (visiting.has(nodeId)) {
            throw new ScenePrefabValidationError(
                `Prefab '${state.id}' contains a hierarchy cycle at '${nodeId}'`,
            );
        }

        visiting.add(nodeId);

        const parentNodeId = state.entityIndex.get(nodeId)?.parentNodeId;
        if (parentNodeId !== null && parentNodeId !== undefined) {
            visit(parentNodeId);
        }

        visiting.delete(nodeId);
        visited.add(nodeId);
    };

    for (const entity of state.entities) {
        visit(entity.nodeId);
    }
};

const ensureEntity = (state: ScenePrefabState, nodeId: string): MutableSceneEntitySnapshot => {
    const entity = state.entityIndex.get(nodeId);
    if (!entity) {
        throw new ScenePrefabValidationError(
            `Prefab '${state.id}' does not contain entity '${nodeId}'`,
        );
    }
    return entity;
};

const ensureComponentIndex = (
    state: ScenePrefabState,
    entity: MutableSceneEntitySnapshot,
    operation: ScenePrefabOverrideOperation,
): number => {
    if (
        operation.kind !== 'remove-component' &&
        operation.kind !== 'replace-component' &&
        operation.kind !== 'set-component-property' &&
        operation.kind !== 'unset-component-property'
    ) {
        throw new ScenePrefabValidationError('Invalid component operation');
    }

    const componentIndex = findScenePrefabComponentIndex(entity.components, operation.selector);
    if (componentIndex >= 0) {
        return componentIndex;
    }

    throw new ScenePrefabValidationError(
        `Prefab '${state.id}' entity '${entity.nodeId}' is missing component selector`,
    );
};

const collectSubtreeIds = (state: ScenePrefabState, rootNodeId: string): Set<string> => {
    const collected = new Set<string>();
    const childrenByParent = new Map<string, string[]>();
    for (const entity of state.entities) {
        if (entity.parentNodeId === null) {
            continue;
        }
        const siblings = childrenByParent.get(entity.parentNodeId);
        if (siblings) {
            siblings.push(entity.nodeId);
        } else {
            childrenByParent.set(entity.parentNodeId, [entity.nodeId]);
        }
    }

    const pending = [rootNodeId];
    while (pending.length > 0) {
        const currentNodeId = pending.pop()!;
        if (collected.has(currentNodeId)) {
            continue;
        }

        collected.add(currentNodeId);

        for (const childNodeId of childrenByParent.get(currentNodeId) ?? []) {
            pending.push(childNodeId);
        }
    }

    return collected;
};

const normalizeComponentInsertIndex = (index: number | undefined, length: number): number => {
    if (index === undefined) {
        return length;
    }

    if (!Number.isInteger(index)) {
        throw new ScenePrefabValidationError(`Invalid component insertion index '${index}'`);
    }

    return Math.min(Math.max(index, 0), length);
};

const validateEntityFieldValue = (
    operation: Extract<ScenePrefabOverrideOperation, { kind: 'set-entity-field' }>,
): void => {
    switch (operation.field) {
        case 'name':
        case 'tag':
            if (typeof operation.value !== 'string') {
                throw new ScenePrefabValidationError(
                    `Entity field '${operation.field}' expects a string value`,
                );
            }
            return;
        case 'layer':
            if (typeof operation.value !== 'number' || !Number.isFinite(operation.value)) {
                throw new ScenePrefabValidationError("Entity field 'layer' expects a finite number");
            }
            return;
        case 'active':
        case 'persistent':
        case 'pooled':
            if (typeof operation.value !== 'boolean') {
                throw new ScenePrefabValidationError(
                    `Entity field '${operation.field}' expects a boolean value`,
                );
            }
            return;
    }
};

const setSceneSerializedValueAtPath = (
    source: SceneSerializedValue,
    path: ScenePrefabPropertyPath,
    value: SceneSerializedValue,
): SceneSerializedValue => {
    if (path.length === 0) {
        return cloneSceneSerializedValue(value);
    }

    const [head, ...tail] = path;
    if (typeof head === 'number') {
        const nextArray = Array.isArray(source) ? [...source] : [];
        const currentValue = nextArray[head] ?? null;
        nextArray[head] = setSceneSerializedValueAtPath(currentValue, tail, value);
        return nextArray;
    }

    const nextObject = isSceneSerializedObjectValue(source) ? { ...source } : {};
    nextObject[head] = setSceneSerializedValueAtPath(nextObject[head] ?? null, tail, value);
    return nextObject;
};

const unsetSceneSerializedValueAtPath = (
    source: SceneSerializedValue,
    path: ScenePrefabPropertyPath,
): SceneSerializedValue => {
    if (path.length === 0) {
        return null;
    }

    const [head, ...tail] = path;
    if (typeof head === 'number') {
        const nextArray = Array.isArray(source) ? [...source] : [];
        if (tail.length === 0) {
            nextArray.splice(head, 1);
            return nextArray;
        }

        nextArray[head] = unsetSceneSerializedValueAtPath(nextArray[head] ?? null, tail);
        return nextArray;
    }

    const nextObject = isSceneSerializedObjectValue(source) ? { ...source } : {};
    if (tail.length === 0) {
        delete nextObject[head];
        return nextObject;
    }

    nextObject[head] = unsetSceneSerializedValueAtPath(nextObject[head] ?? null, tail);
    return nextObject;
};

export const readSceneSerializedValueAtPath = (
    source: SceneSerializedValue,
    path: ScenePrefabPropertyPath,
): SceneSerializedValue | null => {
    if (path.length === 0) {
        return cloneSceneSerializedValue(source);
    }

    const [head, ...tail] = path;
    if (typeof head === 'number') {
        if (!Array.isArray(source) || head < 0 || head >= source.length) {
            return null;
        }
        return readSceneSerializedValueAtPath(source[head]!, tail);
    }

    if (!isSceneSerializedObjectValue(source) || !(head in source)) {
        return null;
    }

    return readSceneSerializedValueAtPath(source[head]!, tail);
};

const applyScenePrefabOverrideOperation = (
    state: ScenePrefabState,
    operation: ScenePrefabOverrideOperation,
): void => {
    switch (operation.kind) {
        case 'add-entity': {
            const entity = toMutableEntity(operation.entity, 0, state.id, [state.id]);
            if (state.entityIndex.has(entity.nodeId)) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' already contains entity '${entity.nodeId}'`,
                );
            }

            const insertIndex = operation.afterNodeId
                ? state.entities.findIndex((entry) => entry.nodeId === operation.afterNodeId)
                : -1;

            if (insertIndex >= 0) {
                state.entities.splice(insertIndex + 1, 0, entity);
            } else {
                state.entities.push(entity);
            }

            state.entityIndex.set(entity.nodeId, entity);
            return;
        }
        case 'remove-entity': {
            ensureEntity(state, operation.nodeId);
            const subtreeIds = collectSubtreeIds(state, operation.nodeId);
            state.entities = state.entities.filter((entity) => !subtreeIds.has(entity.nodeId));
            for (const nodeId of subtreeIds) {
                state.entityIndex.delete(nodeId);
            }
            return;
        }
        case 'reparent-entity': {
            const entity = ensureEntity(state, operation.nodeId);
            if (
                operation.parentNodeId !== undefined &&
                operation.parentNodeId !== null &&
                !state.entityIndex.has(operation.parentNodeId)
            ) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' cannot reparent '${operation.nodeId}' to missing parent '${operation.parentNodeId}'`,
                );
            }

            entity.parentNodeId = operation.parentNodeId ?? null;
            return;
        }
        case 'set-entity-field': {
            validateEntityFieldValue(operation);
            const entity = ensureEntity(state, operation.nodeId);
            switch (operation.field) {
                case 'name':
                    entity.name = operation.value as string;
                    return;
                case 'layer':
                    entity.layer = operation.value as number;
                    return;
                case 'tag':
                    entity.tag = operation.value as string;
                    return;
                case 'active':
                    entity.active = operation.value as boolean;
                    return;
                case 'persistent':
                    entity.persistent = operation.value as boolean;
                    return;
                case 'pooled':
                    entity.pooled = operation.value as boolean;
                    return;
            }
            return;
        }
        case 'add-component': {
            const entity = ensureEntity(state, operation.nodeId);
            if (
                operation.component.id &&
                entity.components.some((component) => component.id === operation.component.id)
            ) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' entity '${entity.nodeId}' already contains component '${operation.component.id}'`,
                );
            }

            const insertIndex = normalizeComponentInsertIndex(
                operation.index,
                entity.components.length,
            );
            entity.components.splice(insertIndex, 0, toMutableComponent(operation.component));
            return;
        }
        case 'remove-component': {
            const entity = ensureEntity(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, entity, operation);
            entity.components.splice(componentIndex, 1);
            return;
        }
        case 'replace-component': {
            const entity = ensureEntity(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, entity, operation);
            entity.components.splice(componentIndex, 1, toMutableComponent(operation.component));
            return;
        }
        case 'set-component-property': {
            const entity = ensureEntity(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, entity, operation);
            const component = entity.components[componentIndex]!;
            component.data = setSceneSerializedValueAtPath(
                component.data,
                operation.path,
                operation.value,
            );
            return;
        }
        case 'unset-component-property': {
            const entity = ensureEntity(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, entity, operation);
            const component = entity.components[componentIndex]!;
            component.data = unsetSceneSerializedValueAtPath(component.data, operation.path);
            return;
        }
    }
};

export const applyScenePrefabOverrideOperations = (
    state: ScenePrefabState,
    operations: readonly ScenePrefabOverrideOperation[],
): void => {
    for (const operation of operations) {
        applyScenePrefabOverrideOperation(state, operation);
    }

    validateScenePrefabState(state);
};

export const scopeScenePrefabEntities = (
    entities: readonly SceneEntitySnapshot[],
    nested: ScenePrefabNestedInstance,
    sourcePrefabId: string,
): readonly SceneEntitySnapshot[] =>
    entities.map((entity, index) => {
        const originalNodeId = ensureScenePrefabNodeId(entity, sourcePrefabId, index);
        const scopedEntity = cloneSceneEntitySnapshot(entity);
        const source = cloneScenePrefabNodeSource(entity.source) ?? {
            prefabId: sourcePrefabId,
            nodeId: originalNodeId,
        };

        return {
            ...scopedEntity,
            nodeId: createScenePrefabScopedNodeId(nested.instanceId, originalNodeId),
            parentNodeId: entity.parentNodeId
                ? createScenePrefabScopedNodeId(nested.instanceId, entity.parentNodeId)
                : nested.parentNodeId ?? null,
            name: nested.namePrefix ? `${nested.namePrefix}${entity.name}` : entity.name,
            source: {
                ...source,
                instancePath: [...(source.instancePath ?? []), nested.instanceId],
            },
        };
    });

export const scopeScenePrefabOverrideOperations = (
    operations: readonly ScenePrefabOverrideOperation[],
    nested: ScenePrefabNestedInstance,
    sourcePrefabId: string,
): readonly ScenePrefabOverrideOperation[] =>
    operations.map((operation) => {
        const scopeNodeId = (nodeId: string): string =>
            createScenePrefabScopedNodeId(nested.instanceId, nodeId);

        switch (operation.kind) {
            case 'add-entity': {
                const scopedEntity = scopeScenePrefabEntities([operation.entity], nested, sourcePrefabId)[0]!;
                return {
                    kind: 'add-entity',
                    entity: scopedEntity,
                    ...(operation.afterNodeId ? { afterNodeId: scopeNodeId(operation.afterNodeId) } : {}),
                };
            }
            case 'remove-entity':
                return {
                    kind: 'remove-entity',
                    nodeId: scopeNodeId(operation.nodeId),
                };
            case 'reparent-entity':
                return {
                    kind: 'reparent-entity',
                    nodeId: scopeNodeId(operation.nodeId),
                    ...(operation.parentNodeId !== undefined
                        ? {
                              parentNodeId: operation.parentNodeId
                                  ? scopeNodeId(operation.parentNodeId)
                                  : nested.parentNodeId ?? null,
                          }
                        : {}),
                };
            case 'set-entity-field':
                return {
                    kind: 'set-entity-field',
                    nodeId: scopeNodeId(operation.nodeId),
                    field: operation.field,
                    value: operation.value,
                };
            case 'add-component':
                return {
                    kind: 'add-component',
                    nodeId: scopeNodeId(operation.nodeId),
                    component: cloneSceneComponentSnapshot(operation.component),
                    ...(operation.index !== undefined ? { index: operation.index } : {}),
                };
            case 'remove-component':
                return {
                    kind: 'remove-component',
                    nodeId: scopeNodeId(operation.nodeId),
                    selector: operation.selector,
                };
            case 'replace-component':
                return {
                    kind: 'replace-component',
                    nodeId: scopeNodeId(operation.nodeId),
                    selector: operation.selector,
                    component: cloneSceneComponentSnapshot(operation.component),
                };
            case 'set-component-property':
                return {
                    kind: 'set-component-property',
                    nodeId: scopeNodeId(operation.nodeId),
                    selector: operation.selector,
                    path: [...operation.path],
                    value: cloneSceneSerializedValue(operation.value),
                };
            case 'unset-component-property':
                return {
                    kind: 'unset-component-property',
                    nodeId: scopeNodeId(operation.nodeId),
                    selector: operation.selector,
                    path: [...operation.path],
                };
        }
    });

export const applyScenePrefabOverrides = (
    definition: ScenePrefabDefinition,
    operations: readonly ScenePrefabOverrideOperation[],
): ScenePrefabDefinition => {
    const state = createScenePrefabState(definition, definition.id, getScenePrefabLineage(definition));
    applyScenePrefabOverrideOperations(state, operations);
    return materializeScenePrefabDefinition(definition, state);
};