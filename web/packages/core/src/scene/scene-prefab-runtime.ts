import { Hierarchy } from '../component-system/components/hierarchy';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { Component } from '../component-system/core/component';
import type { ComponentConstructor } from '../component-system/types/core';
import { PrefabNodeBinding } from './components/prefab-node-binding';
import type { SceneComponentTypeResolver } from './component-catalog';
import { SceneLifecycleError } from './errors';
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
            actors: actors.map((actor) => this._createActorSnapshot(actor)),
        };
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
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

        for (const actorSnapshot of prefab.actors) {
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
                this._hydrateComponent(pendingHydration.actor, componentSnapshot, options);
            }
        }

        for (let index = 0; index < prefab.actors.length; index += 1) {
            const actor = createdActors[index]!;
            const actorSnapshot = prefab.actors[index]!;

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

    private _createActorSnapshot(actor: Actor): SceneActorSnapshot {
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
            components,
        };
    }

    private _createComponentSnapshot(component: Component): SceneComponentSnapshot {
        const serialize = (component as { serialize?: () => Record<string, any> }).serialize;
        const data = typeof serialize === 'function' ? (serialize.call(component) ?? {}) : {};

        return {
            type: this._host.componentCatalog.getName(component.constructor as ComponentConstructor),
            data: encodeSceneValue(data),
        };
    }

    private _hydrateComponent(
        actor: Actor,
        snapshot: SceneComponentSnapshot,
        options: ScenePrefabInstantiateOptions
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
        if (
            typeof (component as { deserialize?: (data: Record<string, any>) => void })
                .deserialize === 'function'
        ) {
            (component as { deserialize(data: Record<string, any>): void }).deserialize(
                (decoded && typeof decoded === 'object' && !Array.isArray(decoded)
                    ? decoded
                    : {}) as Record<string, any>
            );
            return;
        }

        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
            Object.assign(component as object, decoded);
        }
    }
}
