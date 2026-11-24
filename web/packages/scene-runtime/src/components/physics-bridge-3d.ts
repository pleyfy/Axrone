import type { GameLoopSystem, FixedUpdateContext, BeforeUpdateContext } from '@axrone/game-loop';
import type { World, Entity } from '@axrone/ecs-runtime';
import type { SceneLoopState } from '../types';
import {
    PhysicsWorld3D,
    Rigidbody3D,
    Collider3D,
    Joint3D,
    CharacterController,
} from '@axrone/physics-3d';
import type {
    IContactListener3D,
    ICollisionEvent3D,
    ISensorEvent3D,
    BodyId3D,
    IPhysicsWorld3DConfig,
} from '@axrone/physics-core';
import { makeCollisionPairKey } from '@axrone/physics-core';

type AnyWorld = World<any>;
type AnyEntity = Entity<AnyWorld>;

/**
 * Interface for user script components that want to receive physics collision events.
 * Implement these methods on any Component subclass to receive callbacks.
 * Generic over rigidbody/event types so both 2D and 3D bridges can use the same contract.
 * Defaults preserve the original 3D signature for backward compatibility.
 */
export interface IPhysicsCollisionHandler<
    TRigidbody = Rigidbody3D,
    TCollisionEvent = ICollisionEvent3D,
    TSensorEvent = ISensorEvent3D,
> {
    onCollisionEnter?(other: TRigidbody, event: TCollisionEvent): void;
    onCollisionStay?(other: TRigidbody, event: TCollisionEvent): void;
    onCollisionExit?(other: TRigidbody, event: TCollisionEvent): void;
    onSensorEnter?(other: TRigidbody, event: TSensorEvent): void;
    onSensorStay?(other: TRigidbody, event: TSensorEvent): void;
    onSensorExit?(other: TRigidbody, event: TSensorEvent): void;
}

interface ContactPair {
    readonly bodyIdA: BodyId3D;
    readonly bodyIdB: BodyId3D;
}

function makePairKey(a: BodyId3D, b: BodyId3D): number {
    return makeCollisionPairKey(Number(a), Number(b));
}

const MILLISECONDS_PER_SECOND = 1000;

export interface PhysicsBridge3DOptions {
    readonly worldConfig?: IPhysicsWorld3DConfig;
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

export class PhysicsBridge3D implements GameLoopSystem<SceneLoopState>, IContactListener3D {
    readonly id = 'scene.physics-bridge-3d';

    private readonly _ecsWorld: World<any>;
    private readonly _physicsWorld: PhysicsWorld3D;
    private readonly _velocityIterations: number;
    private readonly _positionIterations: number;

    private readonly _initializedBodies = new WeakSet<Rigidbody3D>();
    private readonly _initializedColliders = new WeakSet<Collider3D>();
    private readonly _initializedJoints = new WeakSet<Joint3D>();
    private readonly _initializedCharacterControllers = new WeakSet<CharacterController>();
    private readonly _bodyIdToComponent = new Map<BodyId3D, Rigidbody3D>();
    private readonly _componentToEntity = new Map<Rigidbody3D, AnyEntity>();
    private readonly _activeContactPairs = new Set<number>();
    private readonly _activeTriggerPairs = new Set<number>();

    private _disposed = false;

    constructor(ecsWorld: World<any>, options: PhysicsBridge3DOptions = {}) {
        this._ecsWorld = ecsWorld;
        this._physicsWorld = new PhysicsWorld3D(options.worldConfig);
        this._velocityIterations = options.velocityIterations ?? 10;
        this._positionIterations = options.positionIterations ?? 4;
        this._physicsWorld.setContactListener(this);
    }

    get physicsWorld(): PhysicsWorld3D {
        return this._physicsWorld;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    beforeUpdate(_context: BeforeUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;
        this._initializeNewComponents();
    }

    fixedUpdate(context: FixedUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;

        this._physicsWorld.step(
            context.fixedDelta / MILLISECONDS_PER_SECOND,
            this._velocityIterations,
            this._positionIterations
        );

        this._syncAllTransforms();
    }

    onCollisionBegin(event: ICollisionEvent3D): void {
        const bodyIdA = event.bodyIdA as BodyId3D;
        const bodyIdB = event.bodyIdB as BodyId3D;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeContactPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionBegin');
        }
    }

    onCollisionStay(event: ICollisionEvent3D): void {
        const bodyIdA = event.bodyIdA as BodyId3D;
        const bodyIdB = event.bodyIdB as BodyId3D;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionStay');
        }
    }

    onCollisionEnd(event: ICollisionEvent3D): void {
        const bodyIdA = event.bodyIdA as BodyId3D;
        const bodyIdB = event.bodyIdB as BodyId3D;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeContactPairs.delete(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchCollisionEndEvent(componentA, componentB, event);
        }
    }

    onSensorEnter(event: ISensorEvent3D): void {
        const bodyIdA = event.sensorBodyId as BodyId3D;
        const bodyIdB = event.visitorBodyId as BodyId3D;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeTriggerPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(componentA, componentB, event, 'onSensorEnter');
        }
    }

    onSensorExit(event: ISensorEvent3D): void {
        const bodyIdA = event.sensorBodyId as BodyId3D;
        const bodyIdB = event.visitorBodyId as BodyId3D;
        const key = makePairKey(bodyIdA, bodyIdB);
        this._activeTriggerPairs.delete(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(componentA, componentB, event, 'onSensorExit');
        }
    }

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._physicsWorld.setContactListener(null);
        this._bodyIdToComponent.clear();
        this._componentToEntity.clear();
        this._activeContactPairs.clear();
        this._activeTriggerPairs.clear();
        this._physicsWorld[Symbol.dispose]();
    }

    private _initializeNewComponents(): void {
        const entities = this._ecsWorld.getAllEntities();

        for (const entity of entities) {
            if (!entity.active || entity.isDestroyed) continue;

            const rigidbody = entity.getComponent(Rigidbody3D);
            if (rigidbody && !this._initializedBodies.has(rigidbody)) {
                rigidbody.initialize(this._physicsWorld);
                this._initializedBodies.add(rigidbody);
                this._bodyIdToComponent.set(rigidbody.bodyId, rigidbody);
                this._componentToEntity.set(rigidbody, entity as unknown as AnyEntity);
            }

            const colliders = this._getCollidersFromEntity(entity);
            for (const collider of colliders) {
                if (this._initializedColliders.has(collider)) continue;
                collider.initialize(this._physicsWorld, rigidbody ?? undefined);
                this._initializedColliders.add(collider);
            }

            const joints = this._getJointsFromEntity(entity);
            for (const joint of joints) {
                if (this._initializedJoints.has(joint)) continue;
                if (!rigidbody) continue;

                const connectedBody = this._resolveConnectedBody(joint);
                joint.initialize(this._physicsWorld, rigidbody, connectedBody ?? undefined);
                this._initializedJoints.add(joint);
            }

            const characterController = entity.getComponent(CharacterController);
            if (characterController && !this._initializedCharacterControllers.has(characterController)) {
                characterController.initialize(this._physicsWorld);
                this._initializedCharacterControllers.add(characterController);
            }
        }
    }

    private _getCollidersFromEntity(entity: ReturnType<AnyWorld['getAllEntities']>[number]): Collider3D[] {
        const result: Collider3D[] = [];
        for (const component of entity.getAllComponents()) {
            if (component instanceof Collider3D) {
                result.push(component);
            }
        }
        return result;
    }

    private _getJointsFromEntity(entity: ReturnType<AnyWorld['getAllEntities']>[number]): Joint3D[] {
        const result: Joint3D[] = [];
        for (const component of entity.getAllComponents()) {
            if (component instanceof Joint3D) {
                result.push(component);
            }
        }
        return result;
    }

    private _resolveConnectedBody(joint: Joint3D): Rigidbody3D | null {
        const connectedBody = joint.connectedBody;
        if (connectedBody && this._initializedBodies.has(connectedBody)) {
            return connectedBody;
        }
        return null;
    }

    private _syncAllTransforms(): void {
        // Iterate tracked bodies instead of scanning every entity: every
        // initialized rigidbody is registered in _componentToEntity, so this
        // is O(bodies) rather than O(entities x components) per fixed step.
        // Entries whose entity died are pruned — the strong maps would
        // otherwise retain destroyed bodies until bridge disposal.
        for (const [rigidbody, entity] of this._componentToEntity) {
            if (entity.isDestroyed) {
                this._componentToEntity.delete(rigidbody);
                this._bodyIdToComponent.delete(rigidbody.bodyId);
                continue;
            }
            if (!entity.active) continue;
            if (this._initializedBodies.has(rigidbody)) {
                rigidbody.syncTransformFromWorld();
            }
        }
    }

    private _dispatchCollisionEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: ICollisionEvent3D,
        handler: 'onCollisionBegin' | 'onCollisionStay'
    ): void {
        const method = handler === 'onCollisionBegin' ? 'onCollisionEnter' : 'onCollisionStay';
        this._notifyEntity(self, method, other, event);
        this._notifyEntity(other, method, self, event);
    }

    private _dispatchCollisionEndEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: ICollisionEvent3D
    ): void {
        this._notifyEntity(self, 'onCollisionExit', other, event);
        this._notifyEntity(other, 'onCollisionExit', self, event);
    }

    private _dispatchSensorEvent(
        self: Rigidbody3D,
        other: Rigidbody3D,
        event: ISensorEvent3D,
        handler: 'onSensorEnter' | 'onSensorExit'
    ): void {
        this._notifySensorEntity(self, handler, other, event);
        this._notifySensorEntity(other, handler, self, event);
    }

    private _notifyEntity(
        rigidbody: Rigidbody3D,
        method: 'onCollisionEnter' | 'onCollisionStay' | 'onCollisionExit',
        other: Rigidbody3D,
        event: ICollisionEvent3D
    ): void {
        const entity = this._componentToEntity.get(rigidbody);
        if (!entity) return;

        for (const component of entity.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }

    private _notifySensorEntity(
        rigidbody: Rigidbody3D,
        method: 'onSensorEnter' | 'onSensorExit',
        other: Rigidbody3D,
        event: ISensorEvent3D
    ): void {
        const entity = this._componentToEntity.get(rigidbody);
        if (!entity) return;

        for (const component of entity.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }
}

export function createPhysicsBridge3DSystems(
    ecsWorld: AnyWorld,
    options?: PhysicsBridge3DOptions
): { bridge: PhysicsBridge3D; system: GameLoopSystem<SceneLoopState> } {
    const bridge = new PhysicsBridge3D(ecsWorld, options);
    return {
        bridge,
        system: {
            id: bridge.id,
            beforeUpdate: (ctx) => bridge.beforeUpdate(ctx),
            fixedUpdate: (ctx) => bridge.fixedUpdate(ctx),
            dispose: () => bridge.dispose(),
        },
    };
}
