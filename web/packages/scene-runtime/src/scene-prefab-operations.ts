import { ScenePrefabValidationError } from './errors';
import {
    cloneSceneActorSnapshot,
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
    SceneActorSnapshot,
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

interface MutableSceneActorSnapshot {
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
    actors: MutableSceneActorSnapshot[];
    actorIndex: Map<string, MutableSceneActorSnapshot>;
}

const toMutableComponent = (component: SceneComponentSnapshot): MutableSceneComponentSnapshot => ({
    ...(component.id ? { id: component.id } : {}),
    type: component.type,
    data: cloneSceneSerializedValue(component.data),
});

const createActorSource = (
    actor: SceneActorSnapshot,
    nodeId: string,
    sourcePrefabId: string,
    lineage: readonly string[],
): ScenePrefabNodeSource =>
    cloneScenePrefabNodeSource(actor.source) ?? {
        prefabId: sourcePrefabId,
        nodeId,
        ...(lineage.length > 0 ? { lineage: [...lineage] } : {}),
    };

const toMutableActor = (
    actor: SceneActorSnapshot,
    index: number,
    sourcePrefabId: string,
    lineage: readonly string[],
): MutableSceneActorSnapshot => {
    const nodeId = ensureScenePrefabNodeId(actor, sourcePrefabId, index);
    return {
        nodeId,
        parentNodeId: actor.parentNodeId ?? null,
        name: actor.name,
        layer: actor.layer,
        tag: actor.tag,
        active: actor.active,
        persistent: actor.persistent,
        pooled: actor.pooled,
        source: createActorSource(actor, nodeId, sourcePrefabId, lineage),
        components: actor.components.map((component) => toMutableComponent(component)),
    };
};

const materializeComponent = (component: MutableSceneComponentSnapshot): SceneComponentSnapshot => ({
    ...(component.id ? { id: component.id } : {}),
    type: component.type,
    data: cloneSceneSerializedValue(component.data),
});

const materializeActor = (actor: MutableSceneActorSnapshot): SceneActorSnapshot => ({
    nodeId: actor.nodeId,
    parentNodeId: actor.parentNodeId,
    name: actor.name,
    layer: actor.layer,
    tag: actor.tag,
    active: actor.active,
    persistent: actor.persistent,
    pooled: actor.pooled,
    ...(actor.source ? { source: cloneScenePrefabNodeSource(actor.source) } : {}),
    components: actor.components.map((component) => materializeComponent(component)),
});

const rebuildActorIndex = (state: ScenePrefabState): void => {
    state.actorIndex.clear();
    for (const actor of state.actors) {
        if (state.actorIndex.has(actor.nodeId)) {
            throw new ScenePrefabValidationError(
                `Prefab '${state.id}' contains duplicate actor nodeId '${actor.nodeId}'`,
            );
        }
        state.actorIndex.set(actor.nodeId, actor);
    }
};

const getScenePrefabLineage = (definition: ScenePrefabDefinition): readonly string[] =>
    definition.kind === 'resolved' && 'lineage' in definition && Array.isArray(definition.lineage)
        ? definition.lineage
        : [definition.id];

export const createScenePrefabState = (
    definition: Pick<ScenePrefabDefinition, 'id' | 'actors'>,
    sourcePrefabId = definition.id,
    lineage: readonly string[] = [sourcePrefabId],
): ScenePrefabState => {
    const actors = definition.actors.map((actor, index) =>
        toMutableActor(actor, index, sourcePrefabId, lineage),
    );
    const state: ScenePrefabState = {
        id: definition.id,
        actors,
        actorIndex: new Map<string, MutableSceneActorSnapshot>(),
    };
    rebuildActorIndex(state);
    return state;
};

export const materializeScenePrefabActors = (
    state: ScenePrefabState,
): readonly SceneActorSnapshot[] => state.actors.map((actor) => materializeActor(actor));

export const materializeScenePrefabDefinition = (
    definition: ScenePrefabDefinition,
    state: ScenePrefabState,
): ScenePrefabDefinition => {
    const clone = cloneScenePrefabDefinition(definition);
    return {
        ...clone,
        actors: materializeScenePrefabActors(state),
    };
};

export const materializeScenePrefabResolvedDefinition = (
    definition: ScenePrefabDefinition,
    state: ScenePrefabState,
    lineage: readonly string[],
): ScenePrefabResolvedDefinition => ({
    id: definition.id,
    kind: 'resolved',
    actors: materializeScenePrefabActors(state),
    lineage: [...lineage],
    ...(definition.metadata ? { metadata: cloneScenePrefabMetadata(definition.metadata) } : {}),
});

export const mergeScenePrefabActors = (
    state: ScenePrefabState,
    actors: readonly SceneActorSnapshot[],
    sourcePrefabId: string,
    lineage: readonly string[] = [sourcePrefabId],
): void => {
    for (let index = 0; index < actors.length; index += 1) {
        const actor = toMutableActor(actors[index]!, index, sourcePrefabId, lineage);
        const existingActor = state.actorIndex.get(actor.nodeId);
        if (existingActor) {
            const actorIndex = state.actors.indexOf(existingActor);
            state.actors.splice(actorIndex, 1, actor);
        } else {
            state.actors.push(actor);
        }

        state.actorIndex.set(actor.nodeId, actor);
    }
};

export const validateScenePrefabState = (state: ScenePrefabState): void => {
    rebuildActorIndex(state);

    for (const actor of state.actors) {
        if (actor.parentNodeId !== null && !state.actorIndex.has(actor.parentNodeId)) {
            throw new ScenePrefabValidationError(
                `Prefab '${state.id}' actor '${actor.nodeId}' references missing parent '${actor.parentNodeId}'`,
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

        const parentNodeId = state.actorIndex.get(nodeId)?.parentNodeId;
        if (parentNodeId !== null && parentNodeId !== undefined) {
            visit(parentNodeId);
        }

        visiting.delete(nodeId);
        visited.add(nodeId);
    };

    for (const actor of state.actors) {
        visit(actor.nodeId);
    }
};

const ensureActor = (state: ScenePrefabState, nodeId: string): MutableSceneActorSnapshot => {
    const actor = state.actorIndex.get(nodeId);
    if (!actor) {
        throw new ScenePrefabValidationError(
            `Prefab '${state.id}' does not contain actor '${nodeId}'`,
        );
    }
    return actor;
};

const ensureComponentIndex = (
    state: ScenePrefabState,
    actor: MutableSceneActorSnapshot,
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

    const componentIndex = findScenePrefabComponentIndex(actor.components, operation.selector);
    if (componentIndex >= 0) {
        return componentIndex;
    }

    throw new ScenePrefabValidationError(
        `Prefab '${state.id}' actor '${actor.nodeId}' is missing component selector`,
    );
};

const collectSubtreeIds = (state: ScenePrefabState, rootNodeId: string): Set<string> => {
    const collected = new Set<string>();
    const pending = [rootNodeId];

    while (pending.length > 0) {
        const currentNodeId = pending.pop()!;
        if (collected.has(currentNodeId)) {
            continue;
        }

        collected.add(currentNodeId);

        for (const actor of state.actors) {
            if (actor.parentNodeId === currentNodeId) {
                pending.push(actor.nodeId);
            }
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

const validateActorFieldValue = (
    operation: Extract<ScenePrefabOverrideOperation, { kind: 'set-actor-field' }>,
): void => {
    switch (operation.field) {
        case 'name':
        case 'tag':
            if (typeof operation.value !== 'string') {
                throw new ScenePrefabValidationError(
                    `Actor field '${operation.field}' expects a string value`,
                );
            }
            return;
        case 'layer':
            if (typeof operation.value !== 'number' || !Number.isFinite(operation.value)) {
                throw new ScenePrefabValidationError("Actor field 'layer' expects a finite number");
            }
            return;
        case 'active':
        case 'persistent':
        case 'pooled':
            if (typeof operation.value !== 'boolean') {
                throw new ScenePrefabValidationError(
                    `Actor field '${operation.field}' expects a boolean value`,
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
        case 'add-actor': {
            const actor = toMutableActor(operation.actor, 0, state.id, [state.id]);
            if (state.actorIndex.has(actor.nodeId)) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' already contains actor '${actor.nodeId}'`,
                );
            }

            const insertIndex = operation.afterNodeId
                ? state.actors.findIndex((entry) => entry.nodeId === operation.afterNodeId)
                : -1;

            if (insertIndex >= 0) {
                state.actors.splice(insertIndex + 1, 0, actor);
            } else {
                state.actors.push(actor);
            }

            state.actorIndex.set(actor.nodeId, actor);
            return;
        }
        case 'remove-actor': {
            ensureActor(state, operation.nodeId);
            const subtreeIds = collectSubtreeIds(state, operation.nodeId);
            state.actors = state.actors.filter((actor) => !subtreeIds.has(actor.nodeId));
            for (const nodeId of subtreeIds) {
                state.actorIndex.delete(nodeId);
            }
            return;
        }
        case 'reparent-actor': {
            const actor = ensureActor(state, operation.nodeId);
            if (
                operation.parentNodeId !== undefined &&
                operation.parentNodeId !== null &&
                !state.actorIndex.has(operation.parentNodeId)
            ) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' cannot reparent '${operation.nodeId}' to missing parent '${operation.parentNodeId}'`,
                );
            }

            actor.parentNodeId = operation.parentNodeId ?? null;
            return;
        }
        case 'set-actor-field': {
            validateActorFieldValue(operation);
            const actor = ensureActor(state, operation.nodeId);
            switch (operation.field) {
                case 'name': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'string') {
                        throw new ScenePrefabValidationError("Actor field 'name' expects a string value");
                    }
                    actor.name = nextValue;
                    return;
                }
                case 'layer': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'number') {
                        throw new ScenePrefabValidationError("Actor field 'layer' expects a number value");
                    }
                    actor.layer = nextValue;
                    return;
                }
                case 'tag': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'string') {
                        throw new ScenePrefabValidationError("Actor field 'tag' expects a string value");
                    }
                    actor.tag = nextValue;
                    return;
                }
                case 'active': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'boolean') {
                        throw new ScenePrefabValidationError("Actor field 'active' expects a boolean value");
                    }
                    actor.active = nextValue;
                    return;
                }
                case 'persistent': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'boolean') {
                        throw new ScenePrefabValidationError(
                            "Actor field 'persistent' expects a boolean value",
                        );
                    }
                    actor.persistent = nextValue;
                    return;
                }
                case 'pooled': {
                    const nextValue = operation.value;
                    if (typeof nextValue !== 'boolean') {
                        throw new ScenePrefabValidationError("Actor field 'pooled' expects a boolean value");
                    }
                    actor.pooled = nextValue;
                    return;
                }
            }
            return;
        }
        case 'add-component': {
            const actor = ensureActor(state, operation.nodeId);
            if (
                operation.component.id &&
                actor.components.some((component) => component.id === operation.component.id)
            ) {
                throw new ScenePrefabValidationError(
                    `Prefab '${state.id}' actor '${actor.nodeId}' already contains component '${operation.component.id}'`,
                );
            }

            const insertIndex = normalizeComponentInsertIndex(
                operation.index,
                actor.components.length,
            );
            actor.components.splice(insertIndex, 0, toMutableComponent(operation.component));
            return;
        }
        case 'remove-component': {
            const actor = ensureActor(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, actor, operation);
            actor.components.splice(componentIndex, 1);
            return;
        }
        case 'replace-component': {
            const actor = ensureActor(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, actor, operation);
            actor.components.splice(componentIndex, 1, toMutableComponent(operation.component));
            return;
        }
        case 'set-component-property': {
            const actor = ensureActor(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, actor, operation);
            const component = actor.components[componentIndex]!;
            component.data = setSceneSerializedValueAtPath(
                component.data,
                operation.path,
                operation.value,
            );
            return;
        }
        case 'unset-component-property': {
            const actor = ensureActor(state, operation.nodeId);
            const componentIndex = ensureComponentIndex(state, actor, operation);
            const component = actor.components[componentIndex]!;
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

export const scopeScenePrefabActors = (
    actors: readonly SceneActorSnapshot[],
    nested: ScenePrefabNestedInstance,
    sourcePrefabId: string,
): readonly SceneActorSnapshot[] =>
    actors.map((actor, index) => {
        const originalNodeId = ensureScenePrefabNodeId(actor, sourcePrefabId, index);
        const scopedActor = cloneSceneActorSnapshot(actor);
        const source = cloneScenePrefabNodeSource(actor.source) ?? {
            prefabId: sourcePrefabId,
            nodeId: originalNodeId,
        };

        return {
            ...scopedActor,
            nodeId: createScenePrefabScopedNodeId(nested.instanceId, originalNodeId),
            parentNodeId: actor.parentNodeId
                ? createScenePrefabScopedNodeId(nested.instanceId, actor.parentNodeId)
                : nested.parentNodeId ?? null,
            name: nested.namePrefix ? `${nested.namePrefix}${actor.name}` : actor.name,
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
            case 'add-actor': {
                const scopedActor = scopeScenePrefabActors([operation.actor], nested, sourcePrefabId)[0]!;
                return {
                    kind: 'add-actor',
                    actor: scopedActor,
                    ...(operation.afterNodeId ? { afterNodeId: scopeNodeId(operation.afterNodeId) } : {}),
                };
            }
            case 'remove-actor':
                return {
                    kind: 'remove-actor',
                    nodeId: scopeNodeId(operation.nodeId),
                };
            case 'reparent-actor':
                return {
                    kind: 'reparent-actor',
                    nodeId: scopeNodeId(operation.nodeId),
                    ...(operation.parentNodeId !== undefined
                        ? {
                              parentNodeId: operation.parentNodeId
                                  ? scopeNodeId(operation.parentNodeId)
                                  : nested.parentNodeId ?? null,
                          }
                        : {}),
                };
            case 'set-actor-field':
                return {
                    kind: 'set-actor-field',
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