import type { GameLoopSystem, BeforeUpdateContext } from '@axrone/game-loop';
import type { World, Actor, Component } from '@axrone/ecs-runtime';
import type { SceneLoopState } from '../types';
import {
    PhysicsWorld2D,
    Rigidbody2D,
    Collider2D,
    Joint2D,
    GearJoint2D,
    _setPhysicsWorld2DBridgeProvider,
} from '@axrone/physics-2d';
import { PrefabNodeBinding } from '@axrone/scene-prefab';
import type {
    IContactListener2D,
    ICollisionEvent2D,
    ISensorEvent2D,
    IPhysicsWorldConfig,
} from '@axrone/physics-core';
import type { BodyId } from '@axrone/physics-core';
import { makeCollisionPairKey } from '@axrone/physics-core';
import type { IPhysicsCollisionHandler } from './physics-bridge-3d';
import {
    applyBodyReference,
    applyJointReferences,
    destroyJointConstraint,
    ensureColliderShape,
    ensureJointConstraint,
    ensureRigidbodyBody,
    readPendingBodyReference,
    readPendingJointReferences,
} from '../physics-reference-contract';

type AnyWorld = World<any>;
type AnyActor = Actor<AnyWorld>;

/**
 * Type alias for 2D physics collision handler used by user @script components.
 */
export type IPhysicsCollisionHandler2D = IPhysicsCollisionHandler<
    Rigidbody2D,
    ICollisionEvent2D,
    ISensorEvent2D
>;

interface ContactPair2D {
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
}

function makePairKey2D(a: BodyId, b: BodyId): number {
    return makeCollisionPairKey(Number(a), Number(b));
}

const MILLISECONDS_PER_SECOND = 1000;

class LoopMillisecondsPhysicsWorld2D extends PhysicsWorld2D {
    override step(
        deltaTimeMs: number,
        velocityIterations?: number,
        positionIterations?: number
    ): void {
        super.step(
            deltaTimeMs / MILLISECONDS_PER_SECOND,
            velocityIterations,
            positionIterations
        );
    }
}

export interface PhysicsBridge2DOptions {
    readonly worldConfig?: IPhysicsWorldConfig;
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

interface DestroyStateProbe {
    readonly state?: unknown;
}

// Both provider slots are process-global, so the bridges that own them are
// tracked in creation order. Disposing an older bridge must not blank the
// providers that a newer, still-live bridge installed.
const bridge2DOwnerStack: PhysicsBridge2D[] = [];

function installBridgeWorld2DProviders(owner: PhysicsBridge2D | null): void {
    if (!owner) {
        _setPhysicsWorld2DBridgeProvider(null);
        Rigidbody2D._setBridgeWorldProvider(null);
        return;
    }

    const provider = () => (owner.isDisposed ? null : owner.physicsWorld);
    _setPhysicsWorld2DBridgeProvider(provider);
    Rigidbody2D._setBridgeWorldProvider(provider);
}

/**
 * Bridge between the 2D physics engine and the scene-runtime game loop.
 *
 * Unlike the 3D bridge, this bridge does NOT create bodies/shapes or sync
 * transforms — Rigidbody2D/Collider2D are self-managing (they create their
 * own bodies in start() and sync in fixedUpdate()). The bridge's role is:
 *   1. Own the PhysicsWorld2D instance and expose it to components
 *   2. Set the contact listener so collision/sensor events reach user scripts
 *   3. Track body→component→actor mappings for event dispatch
 *   4. Track active contact/trigger pairs for begin/stay/exit semantics
 *   5. Close the ordering gaps the self-managing lifecycle cannot cover alone:
 *      deferred body/shape creation, and the entity-id joint references the
 *      Editor authors, which stay strings until the actors they name exist.
 */
export class PhysicsBridge2D implements GameLoopSystem<SceneLoopState>, IContactListener2D {
    readonly id = 'scene.physics-bridge-2d';

    private readonly _ecsWorld: World<any>;
    private readonly _physicsWorld: PhysicsWorld2D;
    private readonly _velocityIterations: number;
    private readonly _positionIterations: number;

    private readonly _registeredBodies = new WeakSet<Rigidbody2D>();
    private readonly _registeredColliders = new WeakSet<Collider2D>();
    private readonly _resolvedJoints = new WeakSet<Joint2D>();
    private readonly _bodyIdToComponent = new Map<BodyId, Rigidbody2D>();
    private readonly _componentToActor = new Map<Rigidbody2D, AnyActor>();
    private readonly _activeContactPairs = new Set<number>();
    private readonly _activeTriggerPairs = new Set<number>();

    private readonly _jointOwners = new Map<Joint2D, AnyActor>();
    private readonly _pendingJoints = new Set<Joint2D>();
    private readonly _actorRefIndex = new Map<string, AnyActor>();
    private readonly _componentRefIndex = new Map<string, Component>();
    private readonly _componentOwnerIndex = new Map<string, AnyActor>();

    private _structureVersion = 0;
    private _resolvedStructureVersion = -1;
    private _lastActorCount = -1;

    private _disposed = false;

    constructor(ecsWorld: World<any>, options: PhysicsBridge2DOptions = {}) {
        this._ecsWorld = ecsWorld;

        const gravity = options.worldConfig?.gravity;
        const config: IPhysicsWorldConfig = {
            ...options.worldConfig,
            gravity: gravity
                ? { x: Number((gravity as any).x ?? 0), y: Number((gravity as any).y ?? -9.81) }
                : { x: 0, y: -9.81 },
        };

        this._physicsWorld = new LoopMillisecondsPhysicsWorld2D(config);
        this._velocityIterations = options.velocityIterations ?? 8;
        this._positionIterations = options.positionIterations ?? 3;
        this._physicsWorld.setContactListener(this);

        // Register this bridge as the world provider so PhysicsWorld2DComponent
        // reuses our world instead of creating a second instance, and so
        // colliders and joints resolve the same world without that component.
        bridge2DOwnerStack.push(this);
        installBridgeWorld2DProviders(this);
    }

    get physicsWorld(): PhysicsWorld2D {
        return this._physicsWorld;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    /**
     * Joints still waiting on a prerequisite (a body id, a connected body
     * reference, or the constraints a gear joint couples). Non-zero for a frame
     * or two after a scene load is normal; a value that never drains means an
     * authored reference names something the scene does not have.
     */
    get pendingJointCount(): number {
        return this._pendingJoints.size;
    }

    beforeUpdate(_context: BeforeUpdateContext<SceneLoopState>): void {
        if (this._disposed) return;
        this._registerNewComponents();
    }

    /**
     * Public registration trigger. Call this after creating bodies/shapes externally
     * (e.g. in tests or non-ECS harnesses) to ensure the bridge discovers them
     * before the next physics step.
     */
    registerNewComponents(): void {
        if (this._disposed) return;
        this._registerNewComponents();
    }

    fixedUpdate(_context: { fixedDelta: number }): void {
        if (this._disposed) return;
        // In self-manage pattern, Rigidbody2D.fixedUpdate() handles step() and sync.
        // The bridge does NOT step the world — PhysicsWorld2DComponent.fixedUpdate()
        // does, which physics-bridge-2d-dt-contract.test.ts pins at this seam.
        // Retrying deferred joint work here is step-neutral: a joint whose
        // prerequisites only appeared during this frame gets its constraint
        // before the next step instead of one step late. The empty-pending test
        // keeps the steady-state cost at a single size read.
        this._resolvePendingJoints();
    }

    // ── IContactListener2D ────────────────────────────────────────────────
    // The 2D contact manager now dispatches sensor events natively
    // (onSensorEnter/Stay/Exit) — same as the 3D engine. The bridge
    // simply routes them to user @script handlers.

    onCollisionBegin(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey2D(bodyIdA, bodyIdB);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._activeContactPairs.add(key);
        this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionBegin');
    }

    onCollisionStay(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._dispatchCollisionEvent(componentA, componentB, event, 'onCollisionStay');
    }

    onCollisionEnd(event: ICollisionEvent2D): void {
        const bodyIdA = event.bodyIdA;
        const bodyIdB = event.bodyIdB;
        const key = makePairKey2D(bodyIdA, bodyIdB);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (!componentA || !componentB) return;

        this._activeContactPairs.delete(key);
        this._dispatchCollisionEndEvent(componentA, componentB, event);
    }

    onSensorEnter(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey2D(bodyIdA, bodyIdB);
        this._activeTriggerPairs.add(key);

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorEvent(componentA, componentB, event, 'onSensorEnter');
        }
    }

    onSensorStay(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;

        const componentA = this._bodyIdToComponent.get(bodyIdA);
        const componentB = this._bodyIdToComponent.get(bodyIdB);
        if (componentA && componentB) {
            this._dispatchSensorStayEvent(componentA, componentB, event);
        }
    }

    onSensorExit(event: ISensorEvent2D): void {
        const bodyIdA = event.sensorBodyId;
        const bodyIdB = event.visitorBodyId;
        const key = makePairKey2D(bodyIdA, bodyIdB);
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

        const stackIndex = bridge2DOwnerStack.indexOf(this);
        const ownedProviders = stackIndex === bridge2DOwnerStack.length - 1;
        if (stackIndex >= 0) {
            bridge2DOwnerStack.splice(stackIndex, 1);
        }
        if (ownedProviders) {
            installBridgeWorld2DProviders(bridge2DOwnerStack[bridge2DOwnerStack.length - 1] ?? null);
        }

        this._physicsWorld.setContactListener(null);
        this._bodyIdToComponent.clear();
        this._componentToActor.clear();
        this._activeContactPairs.clear();
        this._activeTriggerPairs.clear();
        this._jointOwners.clear();
        this._pendingJoints.clear();
        this._actorRefIndex.clear();
        this._componentRefIndex.clear();
        this._componentOwnerIndex.clear();
        this._physicsWorld[Symbol.dispose]();
    }

    // ── Internal ──────────────────────────────────────────────────────────

    private _registerNewComponents(): void {
        this._pruneDestroyedState();

        const actors = this._ecsWorld.getAllActors();
        if (actors.length !== this._lastActorCount) {
            this._lastActorCount = actors.length;
            this._structureVersion += 1;
        }

        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index] as unknown as AnyActor;
            if (!actor.active || actor.isDestroyed) continue;

            // Resolved up front: component order inside an actor is not
            // guaranteed, and a collider added before its rigidbody must still
            // find the body it belongs to.
            const rigidbody = actor.getComponent(Rigidbody2D) ?? null;
            if (rigidbody) {
                if (ensureRigidbodyBody(rigidbody)) {
                    this._structureVersion += 1;
                }
                this._registerBody(rigidbody, actor);
            }

            // Colliders are tracked for completeness but event dispatch
            // goes through the actor's component list (same as 3D bridge).
            const components = actor.getAllComponents();
            for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
                const component = components[componentIndex] as unknown;

                if (component instanceof Collider2D) {
                    if (ensureColliderShape(component, rigidbody)) {
                        this._structureVersion += 1;
                    }
                    this._registeredColliders.add(component);
                } else if (component instanceof Joint2D) {
                    if (this._trackJoint(component, actor)) {
                        this._structureVersion += 1;
                    }
                }
            }
        }

        this._resolvePendingJoints();
    }

    /**
     * Drops bookkeeping for components whose owner is gone, and takes away the
     * solver constraint that a jointly-disabled component leaves behind (the
     * physics components have no onDisable hook of their own).
     */
    private _pruneDestroyedState(): void {
        // Entries whose actor died — the strong maps would otherwise
        // retain destroyed bodies until bridge disposal.
        for (const [rigidbody, actor] of this._componentToActor) {
            if (actor.isDestroyed) {
                this._componentToActor.delete(rigidbody);
                if (rigidbody.bodyId != null) {
                    this._bodyIdToComponent.delete(rigidbody.bodyId);
                }
            }
        }

        for (const [joint, actor] of this._jointOwners) {
            if (!actor.isDestroyed && !this._isDestroyed(joint)) {
                continue;
            }

            this._jointOwners.delete(joint);
            this._pendingJoints.delete(joint);
            if (this._resolvedJoints.delete(joint)) {
                this._structureVersion += 1;
            }
        }
    }

    private _isDestroyed(component: Component): boolean {
        return (component as unknown as DestroyStateProbe).state === 'destroyed';
    }

    private _registerBody(rigidbody: Rigidbody2D, actor: AnyActor): void {
        const bodyId = rigidbody.bodyId;
        if (bodyId == null || this._registeredBodies.has(rigidbody)) {
            return;
        }

        this._registeredBodies.add(rigidbody);
        this._bodyIdToComponent.set(bodyId, rigidbody);
        this._componentToActor.set(rigidbody, actor);
    }

    /**
     * Registers a joint with the reconciliation pass.
     *
     * @returns true when the pending or resolved bookkeeping changed, which is
     *   the signal that reference resolution is worth retrying.
     */
    private _trackJoint(joint: Joint2D, actor: AnyActor): boolean {
        let changed = this._jointOwners.get(joint) !== actor;
        if (changed) {
            this._jointOwners.set(joint, actor);
        }

        if (!joint.enabled) {
            if (this._resolvedJoints.delete(joint)) {
                destroyJointConstraint(joint);
                changed = true;
            }
            if (this._pendingJoints.delete(joint)) {
                changed = true;
            }
            return changed;
        }

        if (joint.constraintId != null) {
            if (this._hasRegressedReference(joint)) {
                // The document re-authored the reference while a constraint was
                // live: the solver object still points at a body the scene no
                // longer names, so it must go and the joint must re-pend.
                destroyJointConstraint(joint);
                this._pendingJoints.add(joint);
                this._structureVersion += 1;
                return true;
            }
            this._resolvedJoints.add(joint);
            if (this._pendingJoints.delete(joint)) {
                changed = true;
            }
            return changed;
        }

        if (!this._pendingJoints.has(joint)) {
            this._pendingJoints.add(joint);
            changed = true;
        }

        return changed;
    }

    /** True when a live joint's reference fell back to an unresolved id. */
    private _hasRegressedReference(joint: Joint2D): boolean {
        if (readPendingBodyReference(joint) !== null) {
            return true;
        }

        if (joint instanceof GearJoint2D) {
            const pending = readPendingJointReferences(joint);
            if (pending.jointA !== null || pending.jointB !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * Resolves entity-id joint references and creates the constraints that the
     * components' own `start()` could not.
     *
     * Runs on structural change only. Actor/component creation and any real
     * progress on a joint are the events that can make an impossible constraint
     * possible, so a pending set that stopped making progress costs nothing to
     * leave in place.
     */
    private _resolvePendingJoints(): void {
        if (this._pendingJoints.size === 0) return;
        if (this._structureVersion === this._resolvedStructureVersion) return;

        this._resolvedStructureVersion = this._structureVersion;
        this._rebuildReferenceIndex();

        // Gear joints couple two other constraints, so they are resolved last —
        // inside the same pass — once their references own a constraintId.
        for (const joint of this._pendingJoints) {
            if (!(joint instanceof GearJoint2D)) {
                this._resolveJoint(joint);
            }
        }
        for (const joint of this._pendingJoints) {
            if (joint instanceof GearJoint2D) {
                this._resolveJoint(joint);
            }
        }
    }

    private _rebuildReferenceIndex(): void {
        this._actorRefIndex.clear();
        this._componentRefIndex.clear();
        this._componentOwnerIndex.clear();

        const actors = this._ecsWorld.getAllActors();
        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index] as unknown as AnyActor;
            if (actor.isDestroyed) continue;

            this._indexActorKey(actor.id, actor);
            this._indexActorKey(actor.getComponent(PrefabNodeBinding)?.nodeId, actor);

            const components = actor.getAllComponents();
            for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
                const component = components[componentIndex];
                const componentId = component.id;
                if (typeof componentId !== 'string' || componentId.length === 0) {
                    continue;
                }
                this._componentRefIndex.set(componentId, component);
                this._componentOwnerIndex.set(componentId, actor);
            }
        }
    }

    private _indexActorKey(key: unknown, actor: AnyActor): void {
        if (typeof key === 'string' && key.length > 0 && !this._actorRefIndex.has(key)) {
            this._actorRefIndex.set(key, actor);
        }
    }

    private _findReferencedActor(reference: string): AnyActor | null {
        return this._actorRefIndex.get(reference) ?? this._componentOwnerIndex.get(reference) ?? null;
    }

    private _resolveJoint(joint: Joint2D): void {
        const actor = this._jointOwners.get(joint);
        if (!actor || actor.isDestroyed) {
            this._jointOwners.delete(joint);
            this._pendingJoints.delete(joint);
            return;
        }

        if (!actor.active || !joint.enabled) {
            return;
        }

        let progressed = false;

        const pendingBodyRef = readPendingBodyReference(joint);
        if (pendingBodyRef !== null) {
            const target = this._resolveRigidbodyRef(pendingBodyRef);
            if (target) {
                applyBodyReference(joint, target);
                progressed = true;
            }
        }

        if (joint instanceof GearJoint2D && this._resolveGearRefs(joint)) {
            progressed = true;
        }

        if (ensureJointConstraint(joint)) {
            this._resolvedJoints.add(joint);
            this._pendingJoints.delete(joint);
            this._structureVersion += 1;
            return;
        }

        if (progressed) {
            this._structureVersion += 1;
        }
    }

    private _resolveRigidbodyRef(reference: string): Rigidbody2D | null {
        const direct = this._componentRefIndex.get(reference);
        if (direct instanceof Rigidbody2D) {
            return direct;
        }

        const actor = this._findReferencedActor(reference);
        if (!actor) {
            return null;
        }

        return actor.getComponent(Rigidbody2D) ?? null;
    }

    private _resolveGearRefs(gear: GearJoint2D): boolean {
        const pending = readPendingJointReferences(gear);
        const coupledA = this._asJointInstance(gear.jointA);
        const coupledB = this._asJointInstance(gear.jointB);
        const resolvedA = coupledA ?? (pending.jointA === null ? null : this._resolveJointRef(pending.jointA, gear));
        const resolvedB = coupledB ?? (pending.jointB === null ? null : this._resolveJointRef(pending.jointB, gear));

        return applyJointReferences(
            gear,
            resolvedA ?? null,
            resolvedB ?? null,
            pending.jointA,
            pending.jointB
        );
    }

    /** The getters are typed as component references but still hold authored ids. */
    private _asJointInstance(value: unknown): Joint2D | null {
        return value instanceof Joint2D ? value : null;
    }

    private _resolveJointRef(reference: string, gear: GearJoint2D): Joint2D | null {
        const direct = this._componentRefIndex.get(reference);
        if (direct instanceof Joint2D && direct !== gear) {
            return direct;
        }

        const actor = this._findReferencedActor(reference);
        if (!actor) {
            return null;
        }

        const components = actor.getAllComponents();

        // A gear joint coupling another gear joint is never what an authored
        // node reference meant, so a plain joint wins when both exist.
        for (let index = 0; index < components.length; index += 1) {
            const component = components[index] as unknown;
            if (
                component instanceof Joint2D &&
                !(component instanceof GearJoint2D) &&
                component !== gear
            ) {
                return component;
            }
        }

        for (let index = 0; index < components.length; index += 1) {
            const component = components[index] as unknown;
            if (component instanceof Joint2D && component !== gear) {
                return component;
            }
        }

        return null;
    }

    private _dispatchCollisionEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ICollisionEvent2D,
        handler: 'onCollisionBegin' | 'onCollisionStay'
    ): void {
        const method = handler === 'onCollisionBegin' ? 'onCollisionEnter' : 'onCollisionStay';
        this._notifyActor(self, method, other, event);
        this._notifyActor(other, method, self, event);
    }

    private _dispatchCollisionEndEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ICollisionEvent2D
    ): void {
        this._notifyActor(self, 'onCollisionExit', other, event);
        this._notifyActor(other, 'onCollisionExit', self, event);
    }

    private _dispatchSensorEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ISensorEvent2D,
        handler: 'onSensorEnter' | 'onSensorExit'
    ): void {
        this._notifySensorActor(self, handler, other, event);
        this._notifySensorActor(other, handler, self, event);
    }

    private _dispatchSensorStayEvent(
        self: Rigidbody2D,
        other: Rigidbody2D,
        event: ISensorEvent2D
    ): void {
        this._notifySensorActor(self, 'onSensorStay', other, event);
        this._notifySensorActor(other, 'onSensorStay', self, event);
    }

    private _notifyActor(
        rigidbody: Rigidbody2D,
        method: 'onCollisionEnter' | 'onCollisionStay' | 'onCollisionExit',
        other: Rigidbody2D,
        event: ICollisionEvent2D
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler2D;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }

    private _notifySensorActor(
        rigidbody: Rigidbody2D,
        method: 'onSensorEnter' | 'onSensorStay' | 'onSensorExit',
        other: Rigidbody2D,
        event: ISensorEvent2D
    ): void {
        const actor = this._componentToActor.get(rigidbody);
        if (!actor) return;

        for (const component of actor.getAllComponents()) {
            const handler = component as unknown as IPhysicsCollisionHandler2D;
            const fn = handler[method];
            if (typeof fn === 'function') {
                fn.call(component, other, event);
            }
        }
    }
}

export function createPhysicsBridge2DSystems(
    ecsWorld: AnyWorld,
    options?: PhysicsBridge2DOptions
): { bridge: PhysicsBridge2D; system: GameLoopSystem<SceneLoopState> } {
    const bridge = new PhysicsBridge2D(ecsWorld, options);
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
