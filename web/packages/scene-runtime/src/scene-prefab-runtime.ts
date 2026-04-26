import { Hierarchy } from '@axrone/ecs-runtime';
import { Actor, type ActorConfig } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import type { ComponentConstructor } from '@axrone/ecs-runtime';
import { Transform, getComponentPropertyMetadata } from '@axrone/ecs-runtime';
import type { PropertyMetadata, PropertyTypeId, PropertyTypeReference } from '@axrone/ecs-runtime';
import { Vec2, Vec3 } from '@axrone/numeric';
import { PrefabNodeBinding } from './components/prefab-node-binding';
import type { SceneComponentTypeResolver } from './component-catalog';
import { SceneLifecycleError } from './errors';
import { hasScenePrefabComposition } from './scene-prefab-internals';
import { resolveScenePrefab } from './scene-prefab-workflow';
import { decodeSceneValue, encodeSceneValue } from './serialization';
import type {
    SceneActorSnapshot,
    SceneComponentSnapshot,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
} from './types';

interface ScenePrefabHost {
    readonly componentCatalog: SceneComponentTypeResolver;
    createActor(config: ActorConfig): Actor;
    getAllActors(): readonly Actor[];
}

const EDITOR_SCRIPT_METADATA_KEYS = new Set([
    'scriptPath',
    'className',
    'scriptName',
    'executeInEditMode',
    'propertyValues',
]);

const hasOwn = (value: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

const asString = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
};

const asBoolean = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        if (value === 'true') {
            return true;
        }

        if (value === 'false') {
            return false;
        }
    }

    return fallback;
};

const resolveVec2Fallback = (value: unknown): readonly [number, number] => {
    if (value instanceof Vec2) {
        return [value.x, value.y];
    }

    if (Array.isArray(value)) {
        return [asNumber(value[0], 0), asNumber(value[1], 0)];
    }

    const objectValue = asRecord(value);
    return [asNumber(objectValue.x, 0), asNumber(objectValue.y, 0)];
};

const resolveVec3Fallback = (value: unknown): readonly [number, number, number] => {
    if (value instanceof Vec3) {
        return [value.x, value.y, value.z];
    }

    if (Array.isArray(value)) {
        return [asNumber(value[0], 0), asNumber(value[1], 0), asNumber(value[2], 0)];
    }

    const objectValue = asRecord(value);
    return [asNumber(objectValue.x, 0), asNumber(objectValue.y, 0), asNumber(objectValue.z, 0)];
};

const toVec2 = (value: unknown, fallback: unknown): Vec2 => {
    if (value instanceof Vec2) {
        return value;
    }

    const [fallbackX, fallbackY] = resolveVec2Fallback(fallback);
    if (Array.isArray(value)) {
        return new Vec2(asNumber(value[0], fallbackX), asNumber(value[1], fallbackY));
    }

    const objectValue = asRecord(value);
    return new Vec2(asNumber(objectValue.x, fallbackX), asNumber(objectValue.y, fallbackY));
};

const toVec3 = (value: unknown, fallback: unknown): Vec3 => {
    if (value instanceof Vec3) {
        return value;
    }

    const [fallbackX, fallbackY, fallbackZ] = resolveVec3Fallback(fallback);
    if (Array.isArray(value)) {
        return new Vec3(
            asNumber(value[0], fallbackX),
            asNumber(value[1], fallbackY),
            asNumber(value[2], fallbackZ),
        );
    }

    const objectValue = asRecord(value);
    return new Vec3(
        asNumber(objectValue.x, fallbackX),
        asNumber(objectValue.y, fallbackY),
        asNumber(objectValue.z, fallbackZ),
    );
};

const normalizePropertyTypeId = (
    type: PropertyTypeReference | undefined,
): PropertyTypeId | undefined => {
    if (!type) {
        return undefined;
    }

    if (type === Actor) {
        return 'entity';
    }

    if (type === Transform) {
        return 'transform';
    }

    if (type === Boolean) {
        return 'boolean';
    }

    if (type === Number) {
        return 'number';
    }

    if (type === String) {
        return 'string';
    }

    if (type === Vec2) {
        return 'vec2';
    }

    if (type === Vec3) {
        return 'vec3';
    }

    if (typeof type === 'function') {
        const name = type.name.toLowerCase();
        if (name === 'actor' || name === 'entity') {
            return 'entity';
        }

        if (name === 'transform') {
            return 'transform';
        }

        if (name === 'vec2') {
            return 'vec2';
        }

        if (name === 'vec3') {
            return 'vec3';
        }
    }

    if (typeof type !== 'string') {
        return undefined;
    }

    switch (type.toLowerCase()) {
        case 'boolean':
            return 'boolean';
        case 'number':
            return 'number';
        case 'string':
        case 'color':
            return 'string';
        case 'vec2':
        case 'vector2':
            return 'vec2';
        case 'vec3':
        case 'vector3':
            return 'vec3';
        case 'actor':
        case 'entity':
            return 'entity';
        case 'transform':
            return 'transform';
        default:
            return undefined;
    }
};

const isReferenceLike = (value: unknown): boolean => {
    const objectValue = asRecord(value);
    const kind = asString(objectValue.kind);
    return (kind === 'entity' || kind === 'component') && asString(objectValue.target).length > 0;
};

let prefabInstanceSequence = 1;

const createPrefabInstanceId = (): string => `prefab-instance-${prefabInstanceSequence++}`;

export class ScenePrefabRuntime {
    private readonly _host: ScenePrefabHost;

    constructor(host: ScenePrefabHost) {
        this._host = host;
    }

    createPrefab(
        id: string,
        actors: readonly Actor[] = this._host.getAllActors()
    ): ScenePrefabDefinition {
        return {
            id,
            kind: 'prefab',
            actors: actors.map((actor) => this._createActorSnapshot(actor, id)),
        };
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        const resolvedPrefab = this._resolvePrefab(prefab, options);
        const createdActors: Actor[] = [];
        const createdByNodeId = new Map<string, Actor>();
        const instanceId = createPrefabInstanceId();
        const pendingComponentHydration: Array<{
            readonly actor: Actor;
            readonly components: readonly SceneComponentSnapshot[];
        }> = [];
        const pendingHierarchyLinks: Array<{
            readonly actor: Actor;
            readonly parentNodeId?: string | null;
        }> = [];

        for (const actorSnapshot of resolvedPrefab.actors) {
            const actor = this._host.createActor({
                name: `${options.namePrefix ?? ''}${actorSnapshot.name}`,
                layer: actorSnapshot.layer as any,
                tag: actorSnapshot.tag as any,
                active: false,
                persistent: actorSnapshot.persistent,
                pooled: actorSnapshot.pooled,
                autoStart: false,
            });

            createdActors.push(actor);

            if (actorSnapshot.nodeId) {
                actor.addComponent(PrefabNodeBinding, {
                    nodeId: actorSnapshot.nodeId,
                    instanceId,
                });
                createdByNodeId.set(actorSnapshot.nodeId, actor);
            }

            pendingComponentHydration.push({
                actor,
                components: actorSnapshot.components,
            });

            pendingHierarchyLinks.push({
                actor,
                parentNodeId: actorSnapshot.parentNodeId,
            });
        }

        for (const pendingLink of pendingHierarchyLinks) {
            if (!pendingLink.parentNodeId) {
                continue;
            }

            const parentActor = createdByNodeId.get(pendingLink.parentNodeId);
            if (parentActor) {
                pendingLink.actor.setParent(parentActor);
            }
        }

        for (const pendingHydration of pendingComponentHydration) {
            for (const componentSnapshot of pendingHydration.components) {
                this._hydrateComponent(
                    pendingHydration.actor,
                    componentSnapshot,
                    options,
                    createdByNodeId,
                    createdActors,
                );
            }
        }

        for (let index = 0; index < resolvedPrefab.actors.length; index += 1) {
            const actor = createdActors[index]!;
            const actorSnapshot = resolvedPrefab.actors[index]!;

            actor.start();
            actor.active = actorSnapshot.active;
        }

        return createdActors;
    }

    destroyAllActors(): void {
        const actors = [...this._host.getAllActors()];
        for (const actor of actors) {
            actor.destroy(true);
        }
    }

    private _createActorSnapshot(actor: Actor, prefabId: string): SceneActorSnapshot {
        const binding = actor.getComponent(PrefabNodeBinding);
        const hierarchy = actor.getComponent(Hierarchy);
        const components = actor
            .getAllComponents()
            .filter(
                (component) =>
                    !(component instanceof Hierarchy) &&
                    !(component instanceof PrefabNodeBinding)
            )
            .map((component) => this._createComponentSnapshot(component));

        const parentActor = hierarchy?.parentActor;
        const parentNodeId = parentActor?.getComponent(PrefabNodeBinding)?.nodeId ?? parentActor?.id ?? null;

        return {
            nodeId: binding?.nodeId ?? actor.id,
            parentNodeId,
            name: actor.name,
            layer: actor.layer,
            tag: actor.tag,
            active: actor.active,
            persistent: actor.persistent,
            pooled: actor.pooled,
            source: {
                prefabId,
                nodeId: binding?.nodeId ?? actor.id,
                lineage: [prefabId],
            },
            components,
        };
    }

    private _createComponentSnapshot(component: Component): SceneComponentSnapshot {
        const serialize = (component as { serialize?: () => Record<string, any> }).serialize;
        const data = typeof serialize === 'function' ? (serialize.call(component) ?? {}) : {};

        return {
            id: component.id,
            type: this._host.componentCatalog.getName(component.constructor as ComponentConstructor),
            data: encodeSceneValue(data),
        };
    }

    private _resolvePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions,
    ): ScenePrefabDefinition {
        if (options.prefabResolver) {
            return options.prefabResolver.resolvePrefab(prefab, {
                liveOverrides: options.liveOverrides,
            }).definition;
        }

        if (hasScenePrefabComposition(prefab) || (options.liveOverrides?.length ?? 0) > 0) {
            return resolveScenePrefab(prefab, {
                liveOverrides: options.liveOverrides,
            }).definition;
        }

        return prefab;
    }

    private _hydrateComponent(
        actor: Actor,
        snapshot: SceneComponentSnapshot,
        options: ScenePrefabInstantiateOptions,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[]
    ): void {
        const componentType = this._host.componentCatalog.get(snapshot.type);
        if (!componentType) {
            throw new SceneLifecycleError(
                `Cannot instantiate prefab because component '${snapshot.type}' is not registered`
            );
        }

        const existingComponent = actor
            .getAllComponents()
            .find((component) => component.constructor === componentType);
        const component =
            existingComponent ??
            actor.addComponent(
                componentType as new (...args: any[]) => Component,
                ...(options.componentArgsResolver?.(snapshot.type, snapshot.data) ?? [])
            );

        const decoded = decodeSceneValue(snapshot.data);
        const normalized =
            decoded && typeof decoded === 'object' && !Array.isArray(decoded)
                ? this._normalizeComponentData(
                      componentType,
                      component,
                      decoded as Record<string, unknown>,
                      createdByNodeId,
                      createdActors,
                  )
                : {};
        const deserialize = (component as {
            deserialize?: (data: Record<string, any>) => void;
        }).deserialize;
        const hasCustomDeserialize =
            typeof deserialize === 'function' && deserialize !== Component.prototype.deserialize;

        if (hasCustomDeserialize) {
            deserialize.call(component, normalized as Record<string, any>);
            return;
        }

        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
            this._assignHydratedProperties(component, normalized);
        }
    }

    private _assignHydratedProperties(
        component: Component,
        values: Record<string, unknown>
    ): void {
        const target = component as unknown as Record<string, unknown>;

        for (const [propertyKey, value] of Object.entries(values)) {
            if (propertyKey === 'id') {
                continue;
            }

            const descriptor =
                this._findPropertyDescriptor(component, propertyKey) ??
                Object.getOwnPropertyDescriptor(target, propertyKey);
            if (
                descriptor &&
                ('writable' in descriptor
                    ? descriptor.writable === false
                    : descriptor.set === undefined)
            ) {
                continue;
            }

            target[propertyKey] = value;
        }
    }

    private _findPropertyDescriptor(
        component: Component,
        propertyKey: string
    ): PropertyDescriptor | undefined {
        let prototype = Object.getPrototypeOf(component);

        while (prototype && prototype !== Object.prototype) {
            const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyKey);
            if (descriptor) {
                return descriptor;
            }
            prototype = Object.getPrototypeOf(prototype);
        }

        return undefined;
    }

    private _normalizeComponentData(
        componentType: ComponentConstructor,
        component: Component,
        decoded: Record<string, unknown>,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[],
    ): Record<string, unknown> {
        const propertyMetadata = getComponentPropertyMetadata(componentType as any);
        if (propertyMetadata.length === 0) {
            return decoded;
        }

        const hasPropertyValues = hasOwn(decoded, 'propertyValues') && decoded.propertyValues !== null;
        const sourceValues = hasPropertyValues ? asRecord(decoded.propertyValues) : decoded;
        const normalized = hasPropertyValues
            ? this._stripEditorScriptMetadata(decoded)
            : { ...decoded };
        const resolvedPropertyKeys = new Set<string>();

        for (const metadata of propertyMetadata) {
            if (metadata.serializable === false || !hasOwn(sourceValues, metadata.propertyKey)) {
                continue;
            }

            normalized[metadata.propertyKey] = this._resolvePropertyValue(
                component,
                metadata,
                sourceValues[metadata.propertyKey],
                createdByNodeId,
                createdActors,
            );
            resolvedPropertyKeys.add(metadata.propertyKey);
        }

        if (hasPropertyValues) {
            for (const [propertyKey, value] of Object.entries(sourceValues)) {
                if (resolvedPropertyKeys.has(propertyKey)) {
                    continue;
                }

                normalized[propertyKey] = this._resolveFallbackPropertyValue(
                    component,
                    propertyKey,
                    value,
                    createdByNodeId,
                    createdActors,
                );
            }
        }

        return normalized;
    }

    private _stripEditorScriptMetadata(decoded: Record<string, unknown>): Record<string, unknown> {
        const normalized: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(decoded)) {
            if (!EDITOR_SCRIPT_METADATA_KEYS.has(key)) {
                normalized[key] = value;
            }
        }

        return normalized;
    }

    private _resolvePropertyValue(
        component: Component,
        metadata: PropertyMetadata,
        value: unknown,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[],
    ): unknown {
        const currentValue = (component as unknown as Record<string, unknown>)[metadata.propertyKey];
        const fallbackValue = currentValue ?? metadata.defaultValue;

        switch (normalizePropertyTypeId(metadata.type)) {
            case 'boolean':
                return asBoolean(value, asBoolean(fallbackValue, false));
            case 'number':
                return asNumber(value, asNumber(fallbackValue, 0));
            case 'string':
                return asString(value, asString(fallbackValue, ''));
            case 'vec2':
                return toVec2(value, fallbackValue);
            case 'vec3':
                return toVec3(value, fallbackValue);
            case 'entity':
                return this._resolveActorReference(value, createdByNodeId, createdActors) ?? null;
            case 'transform': {
                const targetActor = this._resolveActorReference(value, createdByNodeId, createdActors);
                return targetActor?.getComponent(Transform) ?? null;
            }
            default:
                return value;
        }
    }

    private _resolveFallbackPropertyValue(
        component: Component,
        propertyKey: string,
        value: unknown,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[],
    ): unknown {
        const currentValue = (component as unknown as Record<string, unknown>)[propertyKey];
        const normalizedKey = propertyKey.toLowerCase();

        if (currentValue instanceof Vec2) {
            return toVec2(value, currentValue);
        }

        if (currentValue instanceof Vec3) {
            return toVec3(value, currentValue);
        }

        if (typeof currentValue === 'number') {
            return asNumber(value, currentValue);
        }

        if (typeof currentValue === 'boolean') {
            return asBoolean(value, currentValue);
        }

        if (typeof currentValue === 'string') {
            return asString(value, currentValue);
        }

        if (normalizedKey.includes('transform')) {
            return (
                this._resolveActorReference(value, createdByNodeId, createdActors)?.getComponent(
                    Transform,
                ) ?? null
            );
        }

        if (isReferenceLike(value) || normalizedKey.includes('actor') || normalizedKey.includes('entity')) {
            return this._resolveActorReference(value, createdByNodeId, createdActors) ?? null;
        }

        const objectValue = asRecord(value);
        if (hasOwn(objectValue, 'x') && hasOwn(objectValue, 'y') && hasOwn(objectValue, 'z')) {
            return toVec3(value, currentValue);
        }

        if (hasOwn(objectValue, 'x') && hasOwn(objectValue, 'y')) {
            return toVec2(value, currentValue);
        }

        return value;
    }

    private _resolveActorReference(
        value: unknown,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[],
    ): Actor | undefined {
        if (value instanceof Actor) {
            return value;
        }

        if (value instanceof Transform) {
            return this._findActorByComponentId(value.id, createdActors);
        }

        if (typeof value === 'string') {
            return this._findActorByReferenceTarget(value, createdByNodeId, createdActors);
        }

        const referenceObject = asRecord(value);
        const referenceKind = asString(referenceObject.kind);
        const referenceTarget = asString(referenceObject.target);

        if (!referenceTarget) {
            return undefined;
        }

        if (referenceKind === 'component') {
            return this._findActorByComponentId(referenceTarget, createdActors);
        }

        return this._findActorByReferenceTarget(referenceTarget, createdByNodeId, createdActors);
    }

    private _findActorByReferenceTarget(
        target: string,
        createdByNodeId: ReadonlyMap<string, Actor>,
        createdActors: readonly Actor[],
    ): Actor | undefined {
        return (
            createdByNodeId.get(target) ??
            createdActors.find((actor) => actor.id === target) ??
            this._host
                .getAllActors()
                .find(
                    (actor) =>
                        actor.id === target ||
                        actor.getComponent(PrefabNodeBinding)?.nodeId === target,
                )
        );
    }

    private _findActorByComponentId(
        componentId: string,
        createdActors: readonly Actor[],
    ): Actor | undefined {
        const actorSets = [createdActors, this._host.getAllActors()];

        for (const actors of actorSets) {
            const actor = actors.find((candidate) =>
                candidate.getAllComponents().some((component) => component.id === componentId),
            );
            if (actor) {
                return actor;
            }
        }

        return undefined;
    }
}
