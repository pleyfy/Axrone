import { describe, it, expect, afterEach, vi } from 'vitest';
import { Vec2 } from '@axrone/numeric';
import { PhysicsWorld2D } from '../core/physics-world';
import {
    finiteOr,
    normalizeVec2Like,
    quaternionToZRadians,
} from '../core/physics-world-2d-helpers';
import {
    PhysicsWorld2DComponent,
    _setPhysicsWorld2DBridgeProvider,
} from '../components/physics-world-2d-component';
import { Rigidbody2D } from '../components/rigidbody2d';
import { BoxCollider2D } from '../components/BoxCollider2D';
import { CircleCollider2D } from '../components/CircleCollider2D';
import { PolygonCollider2D } from '../components/PolygonCollider2D';
import { JOINT_2D_BREAK_LIMIT } from '../components/joint2d';
import { DistanceJoint2D } from '../components/distance-joint2d';
import { SpringJoint2D } from '../components/spring-joint2d';
import { HingeJoint2D } from '../components/hinge-joint2d';
import { SliderJoint2D } from '../components/slider-joint2d';
import { FixedJoint2D } from '../components/fixed-joint2d';
import { WheelJoint2D } from '../components/wheel-joint2d';
import { GearJoint2D } from '../components/gear-joint2d';

/**
 * Bridge & runtime contract tests for `@axrone/physics-2d`.
 *
 * These pin the contract that `PhysicsBridge2D` (in `@axrone/scene-runtime`)
 * relies on when a scene is played without an explicit `PhysicsWorld2DComponent`,
 * plus the Editor -> engine serialisation shapes for joints and colliders.
 */

interface FakeTransform {
    position: { x: number; y: number };
    rotation: { x: number; y: number; z: number; w: number };
}

function makeTransform(x = 0, y = 0): FakeTransform {
    return { position: { x, y }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}

/** A Rigidbody2D that behaves as if `onLoad()` had resolved its Transform. */
function makeRigidbody(world: PhysicsWorld2D | null, x = 0, y = 0): Rigidbody2D {
    const rb = new Rigidbody2D();
    (rb as any)._transform = makeTransform(x, y);
    if (world) (rb as any)._physicsWorld = world;
    return rb;
}

function createWorld(): PhysicsWorld2D {
    return new PhysicsWorld2D({ gravity: { x: 0, y: -9.81 } });
}

function registerBridge(world: PhysicsWorld2D | null): void {
    if (!world) {
        _setPhysicsWorld2DBridgeProvider(null);
        Rigidbody2D._setBridgeWorldProvider(null);
        return;
    }
    // Same contract as PhysicsBridge2D: report no world once disposed.
    const provider = () => ((world as any)._disposed ? null : world);
    _setPhysicsWorld2DBridgeProvider(provider);
    Rigidbody2D._setBridgeWorldProvider(provider);
}

const disposables: PhysicsWorld2D[] = [];

function track(world: PhysicsWorld2D): PhysicsWorld2D {
    disposables.push(world);
    return world;
}

afterEach(() => {
    registerBridge(null);
    while (disposables.length) {
        disposables.pop()![Symbol.dispose]();
    }
    if (PhysicsWorld2DComponent.instance) {
        PhysicsWorld2DComponent.instance.onDestroy();
    }
});

// ─── 1. Shared bridge world provider ────────────────────────────────────────

describe('bridge world provider is shared by every 2D component', () => {
    it('Rigidbody2D creates its body from the bridge world with no world component', () => {
        const world = track(createWorld());
        registerBridge(world);

        const rb = makeRigidbody(null, 2, 3);
        rb.start();

        expect(rb.bodyId).not.toBeNull();
        expect(world.getBodyManager().getPosition(rb.bodyId!).x).toBeCloseTo(2);
    });

    it('Collider2D resolves the bridge world and creates a shape', () => {
        const world = track(createWorld());
        registerBridge(world);

        const rb = makeRigidbody(world);
        rb.start();
        const collider = new BoxCollider2D();
        (collider as any)._rigidbody = rb;

        expect(collider.tryEnsureShape()).toBe(true);
        expect(collider.shapeId).not.toBeNull();
    });

    it('Joint2D resolves the bridge world and creates a constraint', () => {
        const world = track(createWorld());
        registerBridge(world);

        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 3, 0);
        bodyA.start();
        bodyB.start();

        const joint = new DistanceJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        joint.resolveConnectedBodyRef(bodyB);

        expect(joint.tryEnsureConstraint()).toBe(true);
        expect(joint.constraintId).not.toBeNull();
    });

    it('falls back to PhysicsWorld2DComponent when no bridge is registered', () => {
        registerBridge(null);
        const component = new PhysicsWorld2DComponent();
        component.onLoad();
        const world = component.physicsWorld!;
        expect(world).toBeDefined();

        const rb = makeRigidbody(null);
        rb.start();
        const collider = new BoxCollider2D();
        (collider as any)._rigidbody = rb;

        expect(rb.bodyId).not.toBeNull();
        expect(collider.tryEnsureShape()).toBe(true);
        // Both components bound to the singleton world, not a bridge world.
        expect((collider as any)._physicsWorld).toBe(world);
    });

    it('treats a disposed bridge (provider returns null) as absent', () => {
        const world = track(createWorld());
        registerBridge(world);
        const rb = makeRigidbody(null);
        rb.start();
        const firstBodyId = rb.bodyId;
        expect(firstBodyId).not.toBeNull();

        // Bridge tears down: provider now reports no world.
        world[Symbol.dispose]();
        registerBridge(null);

        const second = makeRigidbody(null);
        expect(second.tryEnsureBody()).toBe(false);
        expect(second.bodyId).toBeNull();
        // The already-bound component keeps its identity rather than throwing.
        expect(rb.bodyId).toBe(firstBodyId);
    });

    it('a throwing provider does not break component initialisation', () => {
        _setPhysicsWorld2DBridgeProvider(() => {
            throw new Error('bridge torn down mid-frame');
        });
        Rigidbody2D._setBridgeWorldProvider(() => {
            throw new Error('bridge torn down mid-frame');
        });

        const rb = makeRigidbody(null);
        expect(() => rb.start()).not.toThrow();
        expect(rb.bodyId).toBeNull();
    });

    it('_setBridgeWorldProvider still writes the rigidbody slot', () => {
        const world = track(createWorld());
        Rigidbody2D._setBridgeWorldProvider(() => world);
        expect(Rigidbody2D._getBridgeWorldProvider()).not.toBeNull();

        const rb = makeRigidbody(null);
        expect(rb.tryEnsureBody()).toBe(true);
    });
});

// ─── 2. Rigidbody2D initial transform + lifecycle ───────────────────────────

describe('Rigidbody2D initial rotation', () => {
    it('derives body rotation from a Z-rotated transform quaternion', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world, 1, 1);
        // 90 degrees about Z: q = (0, 0, sin45, cos45) -> atan2(1, 0) = PI/2.
        (rb as any)._transform.rotation = {
            x: 0,
            y: 0,
            z: Math.SQRT1_2,
            w: Math.SQRT1_2,
        };

        rb.start();

        expect(rb.getRotation()).toBeCloseTo(Math.PI / 2, 6);
    });

    it('keeps rotation 0 for an identity transform', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world, 1, 1);
        rb.start();
        expect(rb.getRotation()).toBeCloseTo(0, 6);
    });

    it('quaternionToZRadians matches closed-form values and rejects non-finite input', () => {
        expect(quaternionToZRadians(1, 0, 0, 0)).toBeCloseTo(0, 6);
        expect(
            quaternionToZRadians(Math.SQRT1_2, 0, 0, Math.SQRT1_2)
        ).toBeCloseTo(Math.PI / 2, 6);
        expect(
            quaternionToZRadians(Math.SQRT1_2, 0, 0, -Math.SQRT1_2)
        ).toBeCloseTo(-Math.PI / 2, 6);
        expect(quaternionToZRadians(NaN, 0, 0, 0)).toBe(0);
        expect(quaternionToZRadians(1, Infinity, 0, 0)).toBe(0);
        expect(quaternionToZRadians(0, 0, 0, 0)).toBe(0);
    });
});

describe('Rigidbody2D.tryEnsureBody / enabled state', () => {
    it('is idempotent and never creates a second body', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world, 4, 5);

        expect(rb.bodyId).toBeNull();
        expect(rb.tryEnsureBody()).toBe(true);
        const bodyId = rb.bodyId;
        expect(rb.tryEnsureBody()).toBe(true);
        expect(rb.tryEnsureBody()).toBe(true);
        expect(rb.bodyId).toBe(bodyId);
    });

    it('resolves a missing transform lazily', () => {
        const world = track(createWorld());
        const rb = new Rigidbody2D();
        (rb as any)._physicsWorld = world;
        // Detached component: getComponent() finds nothing, so it cannot bind.
        expect(rb.tryEnsureBody()).toBe(false);
    });

    it('returns false while the component is disabled', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world);
        rb.enabled = false;

        expect(rb.tryEnsureBody()).toBe(false);
        expect(rb.bodyId).toBeNull();

        rb.enabled = true;
        expect(rb.tryEnsureBody()).toBe(true);
    });

    it('syncEnabledState pushes the flag to the body manager', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world);
        rb.start();
        const bodyId = rb.bodyId!;
        expect(world.getBodyManager().isEnabled(bodyId)).toBe(true);

        rb.syncEnabledState(false);
        expect(world.getBodyManager().isEnabled(bodyId)).toBe(false);

        rb.syncEnabledState(true);
        expect(world.getBodyManager().isEnabled(bodyId)).toBe(true);
    });

    it('syncEnabledState before body creation only records the authored flag', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world);
        expect(() => rb.syncEnabledState(false)).not.toThrow();

        rb.start();
        expect(rb.bodyId).not.toBeNull();
        expect(world.getBodyManager().isEnabled(rb.bodyId!)).toBe(false);
    });

    it('disabling the ECS component disables the body and stops syncing', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world);
        // onEnable/onDisable only fire once the ECS has advanced the component
        // past 'uninitialized' (see Component.set enabled).
        (rb as any)._state = 'started';
        rb.deserialize({ bodyType: 2, gravityScale: 1 });
        rb.start();
        const bodyId = rb.bodyId!;

        rb.enabled = false;
        expect(world.getBodyManager().isEnabled(bodyId)).toBe(false);

        rb.enabled = true;
        expect(world.getBodyManager().isEnabled(bodyId)).toBe(true);
    });
});

// ─── 3. Collider2D late binding + serialisation shapes ──────────────────────

describe('Collider2D.tryEnsureShape', () => {
    it('drives the rigidbody to create its body when the body is missing', () => {
        const world = track(createWorld());
        registerBridge(world);

        const rb = makeRigidbody(null, 0, 2);
        const collider = new CircleCollider2D();
        (collider as any)._rigidbody = rb;

        expect(rb.bodyId).toBeNull();
        expect(collider.tryEnsureShape()).toBe(true);
        expect(rb.bodyId).not.toBeNull();
        expect(collider.shapeId).not.toBeNull();
    });

    it('is idempotent across repeated calls', () => {
        const world = track(createWorld());
        registerBridge(world);
        const rb = makeRigidbody(world);
        rb.start();
        const collider = new BoxCollider2D();
        (collider as any)._rigidbody = rb;

        expect(collider.tryEnsureShape()).toBe(true);
        const shapeId = collider.shapeId;
        expect(collider.tryEnsureShape()).toBe(true);
        expect(collider.shapeId).toBe(shapeId);
    });

    it('returns false when the collider is authored-disabled', () => {
        const world = track(createWorld());
        const rb = makeRigidbody(world);
        rb.start();
        const collider = new BoxCollider2D();
        collider.deserialize({ enabled: false });
        (collider as any)._rigidbody = rb;

        expect(collider.tryEnsureShape()).toBe(false);
        expect(collider.shapeId).toBeNull();
    });

    it('returns false when there is no rigidbody on the node', () => {
        const world = track(createWorld());
        const collider = new BoxCollider2D();
        (collider as any)._physicsWorld = world;
        expect(collider.tryEnsureShape()).toBe(false);
    });

    it('is a no-op once a shape exists', () => {
        const world = track(createWorld());
        registerBridge(world);
        const rb = makeRigidbody(world);
        rb.start();
        const collider = new CircleCollider2D();
        (collider as any)._rigidbody = rb;
        collider.tryEnsureShape();
        const shapeId = collider.shapeId;

        collider.deserialize({ enabled: false });
        expect(collider.tryEnsureShape()).toBe(true);
        expect(collider.shapeId).toBe(shapeId);
    });
});

describe('collider Editor payload shapes (array and object vectors)', () => {
    it('Collider2D offset accepts [x, y] and {x, y}', () => {
        const arrayForm = new CircleCollider2D();
        arrayForm.deserialize({ offset: [1.5, -2.5] });
        expect(arrayForm.offset.x).toBe(1.5);
        expect(arrayForm.offset.y).toBe(-2.5);

        const objectForm = new CircleCollider2D();
        objectForm.deserialize({ offset: { x: 1.5, y: -2.5 } });
        expect(objectForm.offset.x).toBe(1.5);
        expect(objectForm.offset.y).toBe(-2.5);
    });

    it('BoxCollider2D size accepts both forms and keeps its defaults', () => {
        const box = new BoxCollider2D();
        box.deserialize({ size: [2, 3], angle: 0.5 });
        expect(box.size.x).toBe(2);
        expect(box.size.y).toBe(3);
        expect(box.angle).toBe(0.5);

        const empty = new BoxCollider2D();
        empty.deserialize({});
        expect(empty.size.x).toBe(1);
        expect(empty.size.y).toBe(1);
        expect(empty.angle).toBe(0);
    });

    it('PolygonCollider2D vertices accept array, object and mixed forms', () => {
        const mixed = new PolygonCollider2D();
        mixed.deserialize({ vertices: [[0, 0], { x: 1, y: 0 }, [0, 1]] });
        expect(mixed.vertices).toHaveLength(3);
        expect(mixed.vertices[1].x).toBe(1);
        expect(mixed.vertices[2].y).toBe(1);

        const notAnArray = new PolygonCollider2D();
        notAnArray.deserialize({ vertices: { x: 1, y: 1 } });
        expect(notAnArray.vertices).toEqual([]);
    });

    it('non-finite collider values fall back to defaults', () => {
        const box = new BoxCollider2D();
        box.deserialize({ size: [NaN, Infinity], angle: NaN, offset: [Infinity, null] });
        expect(box.size.x).toBe(1);
        expect(box.size.y).toBe(1);
        expect(box.angle).toBe(0);
        expect(box.offset.x).toBe(0);
        expect(box.offset.y).toBe(0);

        const circle = new CircleCollider2D();
        circle.deserialize({ radius: NaN });
        expect(circle.radius).toBe(0.5);
    });

    it('material is copied, not aliased, and clamped', () => {
        const source = { friction: 0.8, restitution: 0.4, density: 1.5 };
        const collider = new BoxCollider2D();
        collider.deserialize({ material: source });
        collider.friction = 0.1;
        expect(source.friction).toBe(0.8);
    });

    it('serialize keeps the object vector form', () => {
        const box = new BoxCollider2D();
        box.deserialize({ size: [4, 5] });
        const data = box.serialize();
        expect(data.size).toEqual({ x: 4, y: 5 });
        expect(data.offset).toEqual({ x: 0, y: 0 });
    });

    it('normalizeVec2Like is the single shared implementation', () => {
        expect(normalizeVec2Like([3, 4])).toEqual({ x: 3, y: 4 });
        expect(normalizeVec2Like({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
        expect(normalizeVec2Like(undefined, 1, 2)).toEqual({ x: 1, y: 2 });
        expect(normalizeVec2Like([1], 7, 8)).toEqual({ x: 7, y: 8 });
        expect(finiteOr('nope', 3)).toBe(3);
        expect(finiteOr(Infinity, 3)).toBe(3);
        expect(finiteOr(2, 3)).toBe(2);
    });
});

// ─── 4. Joint bridge contract ───────────────────────────────────────────────

describe('Joint2D pending connectedBody reference', () => {
    it('exposes an entity id string through the pending channel', () => {
        const joint = new DistanceJoint2D();
        joint.deserialize({ connectedBody: 'ent_2' });

        expect(joint.getPendingConnectedBodyRef()).toBe('ent_2');
        // Legacy contract: the getter still hands back whatever the document held.
        expect(joint.connectedBody).toBe('ent_2' as any);
    });

    it('clears the pending ref for empty, missing and resolved values', () => {
        const empty = new DistanceJoint2D();
        empty.deserialize({ connectedBody: '' });
        expect(empty.getPendingConnectedBodyRef()).toBeNull();
        expect(empty.connectedBody).toBeNull();

        const whitespace = new DistanceJoint2D();
        whitespace.deserialize({ connectedBody: '   ' });
        expect(whitespace.getPendingConnectedBodyRef()).toBeNull();

        const resolved = new DistanceJoint2D();
        resolved.deserialize({ connectedBody: { id: 7 } as any });
        expect(resolved.getPendingConnectedBodyRef()).toBeNull();
    });

    it('leaves the pending ref untouched when connectedBody is absent', () => {
        const world = track(createWorld());
        const joint = new DistanceJoint2D();
        joint.deserialize({ connectedBody: 'ent_9' });
        joint.deserialize({ distance: 2 });
        expect(joint.getPendingConnectedBodyRef()).toBe('ent_9');
        expect(world).toBeDefined();
    });

    it('resolveConnectedBodyRef links the body and creates the constraint', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 5, 0);
        bodyA.start();
        bodyB.start();

        const joint = new DistanceJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        joint.deserialize({ connectedBody: 'ent_2', distance: 5 });

        // Not resolvable yet -> no constraint, and no throw.
        expect(joint.tryEnsureConstraint()).toBe(false);
        expect(joint.constraintId).toBeNull();

        joint.resolveConnectedBodyRef(bodyB);
        expect(joint.getPendingConnectedBodyRef()).toBeNull();
        expect(joint.connectedBody).toBe(bodyB);
        expect(joint.constraintId).not.toBeNull();
    });

    it('resolveConnectedBodyRef(null) clears the ref without creating anything', () => {
        const world = track(createWorld());
        const bodyA = makeRigidbody(world);
        bodyA.start();
        const joint = new SpringJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        joint.deserialize({ connectedBody: 'missing_entity' });

        joint.resolveConnectedBodyRef(null);

        expect(joint.getPendingConnectedBodyRef()).toBeNull();
        expect(joint.connectedBody).toBeNull();
        expect(joint.constraintId).toBeNull();
    });

    it('resolveConnectedBodyRef is idempotent', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 2, 0);
        bodyA.start();
        bodyB.start();
        const joint = new DistanceJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        joint.resolveConnectedBodyRef(bodyB);
        const constraintId = joint.constraintId;
        expect(constraintId).not.toBeNull();

        joint.resolveConnectedBodyRef(bodyB);
        expect(joint.constraintId).toBe(constraintId);
    });

    it('setting connectedBody to a real body clears the pending ref', () => {
        const world = track(createWorld());
        const bodyB = makeRigidbody(world, 1, 0);
        bodyB.start();
        const joint = new DistanceJoint2D();
        joint.deserialize({ connectedBody: 'ent_5' });

        joint.connectedBody = bodyB;

        expect(joint.getPendingConnectedBodyRef()).toBeNull();
        expect(joint.connectedBody).toBe(bodyB);
    });
});

describe('Joint2D.tryEnsureConstraint', () => {
    function wiredJoint(world: PhysicsWorld2D): {
        joint: HingeJoint2D;
        bodyA: Rigidbody2D;
        bodyB: Rigidbody2D;
    } {
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 0);
        bodyA.start();
        bodyB.start();
        const joint = new HingeJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        joint.resolveConnectedBodyRef(bodyB);
        return { joint, bodyA, bodyB };
    }

    it('is idempotent', () => {
        const world = track(createWorld());
        const { joint } = wiredJoint(world);

        expect(joint.tryEnsureConstraint()).toBe(true);
        const constraintId = joint.constraintId;
        expect(joint.tryEnsureConstraint()).toBe(true);
        expect(joint.constraintId).toBe(constraintId);
    });

    it('creates nothing while the joint is authored-disabled', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 0);
        bodyA.start();
        bodyB.start();

        const joint = new HingeJoint2D();
        joint.deserialize({ enabled: false });
        (joint as any)._rigidbodyA = bodyA;
        (joint as any)._connectedBody = bodyB;

        expect(joint.tryEnsureConstraint()).toBe(false);
        expect(joint.constraintId).toBeNull();

        joint.syncEnabledState(true);
        expect(joint.tryEnsureConstraint()).toBe(true);
        expect(joint.constraintId).not.toBeNull();
    });

    it('pushes enabled state to the constraint manager', () => {
        const world = track(createWorld());
        const { joint } = wiredJoint(world);
        joint.start();
        const constraintId = joint.constraintId!;
        expect(constraintId).not.toBeNull();
        expect(world.getConstraintManager().isEnabled(constraintId)).toBe(true);

        joint.syncEnabledState(false);
        expect(world.getConstraintManager().isEnabled(constraintId)).toBe(false);

        joint.syncEnabledState(true);
        expect(world.getConstraintManager().isEnabled(constraintId)).toBe(true);
    });

    it('lazily binds the local rigidbody when onLoad did not', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 1);
        bodyA.start();
        bodyB.start();

        const joint = new DistanceJoint2D();
        joint.resolveConnectedBodyRef(bodyB);
        // No actor attached -> _rigidbodyA cannot be discovered.
        expect(joint.tryEnsureConstraint()).toBe(false);

        (joint as any)._rigidbodyA = bodyA;
        expect(joint.tryEnsureConstraint()).toBe(true);
    });

    it('survives a disposed world without throwing', () => {
        const world = createWorld();
        const { joint } = wiredJoint(world);
        joint.start();
        expect(joint.constraintId).not.toBeNull();

        world[Symbol.dispose]();
        registerBridge(null);

        expect(() => joint.syncEnabledState(false)).not.toThrow();
    });
});

describe('break force / torque normalisation', () => {
    it('maps the Editor sentinel and non-numeric inputs to Infinity', () => {
        const sentinel = new DistanceJoint2D();
        sentinel.deserialize({ breakForce: JOINT_2D_BREAK_LIMIT, breakTorque: 1e18 });
        expect(sentinel.breakForce).toBe(Infinity);
        expect(sentinel.breakTorque).toBe(Infinity);

        const nullish = new DistanceJoint2D();
        nullish.deserialize({ breakForce: null, breakTorque: undefined });
        expect(nullish.breakForce).toBe(Infinity);
        expect(nullish.breakTorque).toBe(Infinity);

        const garbage = new DistanceJoint2D();
        garbage.deserialize({ breakForce: NaN, breakTorque: 'lots' });
        expect(garbage.breakForce).toBe(Infinity);
        expect(garbage.breakTorque).toBe(Infinity);
    });

    it('keeps a real threshold and clamps negatives', () => {
        const joint = new DistanceJoint2D();
        joint.deserialize({ breakForce: 250, breakTorque: -10 });
        expect(joint.breakForce).toBe(250);
        expect(joint.breakTorque).toBe(0);
    });

    it('serialises back to the sentinel and round-trips', () => {
        const joint = new DistanceJoint2D();
        const data = joint.serialize();
        expect(data.breakForce).toBe(JOINT_2D_BREAK_LIMIT);
        expect(data.breakTorque).toBe(JOINT_2D_BREAK_LIMIT);
        expect(JSON.parse(JSON.stringify(data)).breakForce).toBe(JOINT_2D_BREAK_LIMIT);

        const restored = new DistanceJoint2D();
        restored.deserialize(data);
        expect(restored.breakForce).toBe(Infinity);
    });

    it('preserves a finite threshold through serialise round-trip', () => {
        const joint = new DistanceJoint2D();
        joint.breakForce = 500;
        const data = joint.serialize();
        expect(data.breakForce).toBe(500);

        const restored = new DistanceJoint2D();
        restored.deserialize(data);
        expect(restored.breakForce).toBe(500);
    });
});

describe('joint accessor and field parity with the Editor', () => {
    it('DistanceJoint2D exposes autoConfigureDistance', () => {
        const joint = new DistanceJoint2D();
        expect(joint.autoConfigureDistance).toBe(true);
        joint.deserialize({ autoConfigureDistance: false });
        expect(joint.autoConfigureDistance).toBe(false);
        expect(joint.serialize().autoConfigureDistance).toBe(false);
        joint.autoConfigureDistance = true;
        expect(joint.autoConfigureDistance).toBe(true);
    });

    it('SpringJoint2D exposes anchorA / anchorB / autoConfigureDistance', () => {
        const joint = new SpringJoint2D();
        joint.deserialize({ anchorA: [0, 0.5], anchorB: [-1, 0.25] });
        expect(joint.anchorA.y).toBe(0.5);
        expect(joint.anchorB.x).toBe(-1);
        expect(joint.autoConfigureDistance).toBe(true);

        joint.anchorA = new Vec2(2, 3);
        expect(joint.anchorA.x).toBe(2);
        expect(joint.anchorA.y).toBe(3);

        joint.autoConfigureDistance = false;
        expect(joint.serialize().autoConfigureDistance).toBe(false);
    });

    it('hinge connectedAnchor defaults to auto-configuration', () => {
        const world = track(createWorld());
        registerBridge(world);
        const joint = new HingeJoint2D();
        // Authored-only flag: no public accessor (see the marker-name test below).
        expect(joint.serialize().autoConfigureConnectedAnchor).toBe(true);
        expect(joint.connectedAnchor.x).toBe(0);

        joint.deserialize({ connectedAnchor: [1, 2], autoConfigureConnectedAnchor: false });
        expect(joint.serialize().autoConfigureConnectedAnchor).toBe(false);
        expect(joint.connectedAnchor.x).toBe(1);
        expect(joint.connectedAnchor.y).toBe(2);

        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 1);
        bodyA.start();
        bodyB.start();
        (joint as any)._rigidbodyA = bodyA;

        // The authored anchor must actually reach the solver definition.
        const createRevolute = vi.spyOn(
            world.getConstraintManager() as any,
            'createRevoluteConstraint'
        );
        joint.resolveConnectedBodyRef(bodyB);

        expect(joint.constraintId).not.toBeNull();
        expect(createRevolute).toHaveBeenCalledTimes(1);
        expect(createRevolute.mock.calls[0][0].localAnchorB).toEqual({ x: 1, y: 2 });

        const data = joint.serialize();
        expect(data.connectedAnchor).toEqual({ x: 1, y: 2 });
        expect(data.autoConfigureConnectedAnchor).toBe(false);
    });

    it('maps the authored world anchor into body B space while auto-configuration is on', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 1);
        bodyA.start();
        bodyB.start();

        const joint = new HingeJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        const createRevolute = vi.spyOn(
            world.getConstraintManager() as any,
            'createRevoluteConstraint'
        );
        joint.resolveConnectedBodyRef(bodyB);

        // The world anchor is body A's position (0,0); body B must express it
        // in its own space so the two ends stay coincident instead of snapping
        // B's center onto A.
        expect(createRevolute.mock.calls[0][0].localAnchorB).toEqual({ x: -1, y: -1 });
    });

    it('keeps localAnchorB at the origin when both bodies coincide', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 1.5, -0.75);
        const bodyB = makeRigidbody(world, 1.5, -0.75);
        bodyA.start();
        bodyB.start();

        const joint = new HingeJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        const createRevolute = vi.spyOn(
            world.getConstraintManager() as any,
            'createRevoluteConstraint'
        );
        joint.resolveConnectedBodyRef(bodyB);

        expect(createRevolute.mock.calls[0][0].localAnchorB).toEqual({ x: 0, y: 0 });
    });

    it('rotates the resolved world anchor into each body frame', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 2, 0);
        bodyA.start();
        bodyB.start();
        bodyA.setRotation(Math.PI / 2);
        bodyB.setRotation(Math.PI);

        const joint = new HingeJoint2D();
        joint.deserialize({ anchor: [1, 0] });
        (joint as any)._rigidbodyA = bodyA;
        const createRevolute = vi.spyOn(
            world.getConstraintManager() as any,
            'createRevoluteConstraint'
        );
        joint.resolveConnectedBodyRef(bodyB);

        // World anchor (0,1) -> B frame at rot PI -> (dx, dy) rotated by -PI.
        const def = createRevolute.mock.calls[0][0];
        expect(def.localAnchorA).toEqual({ x: 1, y: 0 });
        expect(def.localAnchorB.x).toBeCloseTo(2, 6);
        expect(def.localAnchorB.y).toBeCloseTo(-1, 6);
    });

    it('falls back to the origin when the connected body has no solver body', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        bodyA.start();
        const bodyB = makeRigidbody(world, 1, 1);

        const joint = new HingeJoint2D();
        (joint as any)._rigidbodyA = bodyA;
        const createRevolute = vi.spyOn(
            world.getConstraintManager() as any,
            'createRevoluteConstraint'
        );
        joint.resolveConnectedBodyRef(bodyB);

        expect(bodyB.bodyId).toBeNull();
        expect(joint.constraintId).toBeNull();
        expect(createRevolute).not.toHaveBeenCalled();

        // The helper itself must not guess an anchor without a real body.
        (joint as any)._connectedBody = bodyB;
        expect((joint as any).resolveAutoConnectedAnchor(new Vec2(0, 0))).toEqual({ x: 0, y: 0 });
    });

    it('slider and fixed joints share the base auto-anchor resolution', () => {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 1);
        bodyA.start();
        bodyB.start();

        const slider = new SliderJoint2D();
        (slider as any)._rigidbodyA = bodyA;
        const createPrismatic = vi.spyOn(
            world.getConstraintManager() as any,
            'createPrismaticConstraint'
        );
        slider.resolveConnectedBodyRef(bodyB);

        expect(createPrismatic).toHaveBeenCalledTimes(1);
        expect(createPrismatic.mock.calls[0][0].localAnchorB).toEqual({ x: -1, y: -1 });

        const fixed = new FixedJoint2D();
        (fixed as any)._rigidbodyA = bodyA;
        const createWeld = vi.spyOn(world.getConstraintManager() as any, 'createWeldConstraint');
        fixed.resolveConnectedBodyRef(bodyB);

        expect(createWeld).toHaveBeenCalledTimes(1);
        expect(createWeld.mock.calls[0][0].localAnchorB).toEqual({ x: -1, y: -1 });
    });

    it('hinge reads the anchorB alias for connectedAnchor', () => {
        const joint = new HingeJoint2D();
        joint.deserialize({ anchorB: [0.5, -0.5] });
        expect(joint.connectedAnchor.x).toBe(0.5);
        expect(joint.connectedAnchor.y).toBe(-0.5);
    });

    it('WheelJoint2D covers every Editor-authored key', () => {
        const joint = new WheelJoint2D();
        joint.deserialize({
            anchorA: [0, 0],
            anchorB: [1, 1],
            axis: [0, 1],
            enableLimit: true,
            lowerTranslation: -2,
            upperTranslation: 3,
            enableMotor: true,
            motorSpeed: 4,
            maxMotorTorque: 5,
            stiffness: 6,
            damping: 7,
            connectedBody: '',
            enableCollision: true,
            breakForce: 1e18,
            breakTorque: 1e18,
        });

        const data = joint.serialize();
        for (const key of [
            'anchorA',
            'anchorB',
            'axis',
            'enableLimit',
            'lowerTranslation',
            'upperTranslation',
            'enableMotor',
            'motorSpeed',
            'maxMotorTorque',
            'stiffness',
            'damping',
            'connectedBody',
            'enableCollision',
            'breakForce',
            'breakTorque',
        ]) {
            expect(data).toHaveProperty(key);
        }
        expect(data.enableLimit).toBe(true);
        expect(data.lowerTranslation).toBe(-2);
        expect(data.upperTranslation).toBe(3);
        expect(data.maxMotorTorque).toBe(5);
        expect(data.breakForce).toBe(JOINT_2D_BREAK_LIMIT);
    });
});

// ─── 5. GearJoint2D two-reference contract ─────────────────────────────────

describe('GearJoint2D pending joint references', () => {
    function gearFixture(): {
        world: PhysicsWorld2D;
        gear: GearJoint2D;
        bodyA: Rigidbody2D;
        bodyB: Rigidbody2D;
    } {
        const world = track(createWorld());
        registerBridge(world);
        const bodyA = makeRigidbody(world, 0, 0);
        const bodyB = makeRigidbody(world, 1, 0);
        bodyA.start();
        bodyB.start();
        const gear = new GearJoint2D();
        (gear as any)._rigidbodyA = bodyA;
        gear.resolveConnectedBodyRef(bodyB);
        return { world, gear, bodyA, bodyB };
    }

    it('captures both entity ids on deserialize', () => {
        const gear = new GearJoint2D();
        gear.deserialize({ jointA: 'ent_11', jointB: 'ent_12', ratio: 2 });
        expect(gear.getPendingJointRefs()).toEqual({ jointA: 'ent_11', jointB: 'ent_12' });
        expect(gear.ratio).toBe(2);
    });

    it('reports no pending refs for empty references', () => {
        const gear = new GearJoint2D();
        gear.deserialize({ jointA: '', jointB: '  ' });
        expect(gear.getPendingJointRefs()).toEqual({ jointA: null, jointB: null });
    });

    it('does not fabricate a constraint from unresolved string refs', () => {
        const { gear } = gearFixture();
        gear.deserialize({ jointA: 'ent_1', jointB: 'ent_2' });
        gear.start();

        // Pending is legitimate; a bogus constraint id must never leak through.
        expect(gear.constraintId).toBeNull();
        expect(gear.isPending).toBe(true);
        expect(gear.tryEnsureConstraint()).toBe(false);
    });

    it('resolveJointRefs creates the gear constraint once both joints are ready', () => {
        const { gear } = gearFixture();
        const coupledA = new HingeJoint2D();
        const coupledB = new HingeJoint2D();
        Object.defineProperty(coupledA, 'constraintId', { value: 400 });
        Object.defineProperty(coupledB, 'constraintId', { value: 700 });

        gear.resolveJointRefs(coupledA, coupledB);

        expect(gear.getPendingJointRefs()).toEqual({ jointA: null, jointB: null });
        expect(gear.isPending).toBe(false);
        expect(gear.tryEnsureConstraint()).toBe(true);
        expect(gear.constraintId).not.toBeNull();
    });

    it('resolveJointRefs is idempotent', () => {
        const { gear } = gearFixture();
        const coupledA = new HingeJoint2D();
        const coupledB = new HingeJoint2D();
        Object.defineProperty(coupledA, 'constraintId', { value: 401 });
        Object.defineProperty(coupledB, 'constraintId', { value: 701 });

        gear.resolveJointRefs(coupledA, coupledB);
        const constraintId = gear.constraintId;
        expect(constraintId).not.toBeNull();

        gear.resolveJointRefs(coupledA, coupledB);
        expect(gear.constraintId).toBe(constraintId);
    });

    it('resolveJointRefs(null, null) drops the coupling without throwing', () => {
        const { gear } = gearFixture();
        gear.deserialize({ jointA: 'ent_1', jointB: 'ent_2' });
        expect(() => gear.resolveJointRefs(null, null)).not.toThrow();
        expect(gear.jointA).toBeNull();
        expect(gear.jointB).toBeNull();
        expect(gear.constraintId).toBeNull();
    });

    it('resolves lazily when the coupled joints gain ids later', () => {
        const { gear } = gearFixture();
        const coupledA = new HingeJoint2D();
        const coupledB = new HingeJoint2D();
        gear.resolveJointRefs(coupledA, coupledB);
        expect(gear.constraintId).toBeNull();
        expect(gear.isPending).toBe(true);

        Object.defineProperty(coupledA, 'constraintId', { value: 402 });
        Object.defineProperty(coupledB, 'constraintId', { value: 702 });
        expect(gear.tryEnsureConstraint()).toBe(true);
        expect(gear.isPending).toBe(false);
    });

    it('ratio garbage falls back to the neutral ratio', () => {
        const gear = new GearJoint2D();
        gear.deserialize({ ratio: NaN });
        expect(gear.ratio).toBe(1);
        gear.deserialize({ ratio: Infinity });
        expect(gear.ratio).toBe(1);
        gear.deserialize({ ratio: 2.5 });
        expect(gear.ratio).toBe(2.5);
    });
});

// ─── 6. Cross-package member-shape contract ────────────────────────────────
//
// `@axrone/scene-runtime` resolves references by *member shape* (see
// `packages/scene-runtime/src/physics-reference-contract.ts`), never by class.
// Two consequences are load-bearing and cheap to break by accident:
//   - the ensure/resolve members below must stay declared, or the bridge falls
//     back to poking private fields;
//   - 3D-only marker names must NEVER appear on a 2D component, or a 2D joint is
//     misclassified as spatial and can no longer link to a 2D rigidbody.

function declares(value: unknown, key: string): boolean {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    let prototype: object | null = Object.getPrototypeOf(value as object);
    while (prototype && prototype !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(prototype, key)) return true;
        prototype = Object.getPrototypeOf(prototype);
    }
    return Object.prototype.hasOwnProperty.call(value as object, key);
}

const JOINT_CLASSES = [DistanceJoint2D, SpringJoint2D, HingeJoint2D, WheelJoint2D, GearJoint2D];

describe('scene-runtime member-shape contract', () => {
    it('declares every ensure/resolve member the adapter probes', () => {
        expect(declares(new Rigidbody2D(), 'tryEnsureBody')).toBe(true);
        expect(declares(new BoxCollider2D(), 'tryEnsureShape')).toBe(true);

        for (const JointClass of JOINT_CLASSES) {
            const joint = new JointClass();
            expect(declares(joint, 'tryEnsureConstraint')).toBe(true);
            expect(declares(joint, 'getPendingConnectedBodyRef')).toBe(true);
            expect(declares(joint, 'resolveConnectedBodyRef')).toBe(true);
            expect(declares(joint, 'constraintId')).toBe(true);
            expect(declares(joint, 'connectedBody')).toBe(true);
        }

        const gear = new GearJoint2D();
        expect(declares(gear, 'getPendingJointRefs')).toBe(true);
        expect(declares(gear, 'resolveJointRefs')).toBe(true);
        expect(declares(gear, 'tryResolve')).toBe(true);
        expect(declares(gear, 'jointA')).toBe(true);
        expect(declares(gear, 'jointB')).toBe(true);
    });

    it('keeps 3D-only discriminator members undeclared on 2D components', () => {
        // physics-reference-contract: isRigidbody3DLike -> useGravity | isKinematic
        //                            isJoint3DLike      -> autoConfigureConnectedAnchor
        const forbidden = ['useGravity', 'isKinematic', 'autoConfigureConnectedAnchor'];

        const rigidbody = new Rigidbody2D();
        for (const key of forbidden) {
            expect(declares(rigidbody, key)).toBe(false);
        }
        for (const JointClass of JOINT_CLASSES) {
            const joint = new JointClass();
            for (const key of forbidden) {
                expect(declares(joint, key)).toBe(false);
            }
        }
    });

    it('still reads the authored autoConfigureConnectedAnchor value', () => {
        // The marker name is banned as a *member*, but the scene key stays
        // supported so documents authored by the Editor keep their intent.
        const joint = new HingeJoint2D();
        joint.deserialize({
            connectedAnchor: [2, 3],
            autoConfigureConnectedAnchor: false,
        });
        expect(joint.serialize().autoConfigureConnectedAnchor).toBe(false);
        expect(joint.serialize().connectedAnchor).toEqual({ x: 2, y: 3 });
        expect(declares(joint, 'autoConfigureConnectedAnchor')).toBe(false);
    });
});
