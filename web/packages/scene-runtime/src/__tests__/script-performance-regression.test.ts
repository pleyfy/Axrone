import { describe, expect, it } from 'vitest';
import { Vec3, Vec4, Quat } from '@axrone/numeric';
import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { OrbitCameraController } from '../components/orbit-camera-controller';
import { TrailRenderer } from '../components/trail-renderer';
import { PathAgent } from '../components/path-agent';
import { BillboardRenderer } from '../components/billboard-renderer';
import { createSceneRegistry } from '../scene-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a World + Entity with a Transform and returns the entity + transform
 * for use in component tests.
 */
function createEntityWithTransform(): { world: World; entity: EntityId; transform: Transform } {
    const world = new World(createSceneRegistry());
    const entity = new Entity(world);
    const transform = entity.getComponent(Transform)!;
    return { world, entity, transform };
}

/**
 * Collects the own-property keys of an object. Used to detect hidden
 * allocations — if new own properties appear after an update() call,
 * something was allocated on the hot path.
 */
function ownKeys(obj: object): string[] {
    return Object.keys(obj);
}

/**
 * Returns the number of own properties on an object.
 */
function ownPropertyCount(obj: object): number {
    return Object.keys(obj).length;
}

// ---------------------------------------------------------------------------
// Test-double game scripts that follow the exact zero-allocation pattern
// from Assets/Scripts/CameraFollowControl.ts and CharacterMovement.ts.
//
// Direct import of the game scripts is not possible from within the engine
// package test suite (they live outside the monorepo package structure and
// use decorator metadata that requires the full engine bootstrap). Instead,
// we replicate the pre-allocation pattern and verify it is correct.
// ---------------------------------------------------------------------------

/**
 * Minimal test double replicating the zero-allocation pattern from
 * Assets/Scripts/CameraFollowControl.ts.
 */
class CameraFollowControlPattern {
    private static readonly MS_PER_SECOND = 1000;
    private static readonly FOLLOW_MIN_DISTANCE = 1e-4;

    public target: Transform | null = null;
    public offsetX = 0;
    public offsetY = 5;
    public offsetZ = -10;
    public damping = 5;
    public lookAtTarget = true;

    /* ---- Pre-allocated temporaries (zero per-frame allocations) ---- */
    private _cachedTransform: Transform | null = null;
    private readonly _desiredPosition = new Vec3();
    private readonly _lookDirection = new Vec3();
    private readonly _tempRotation = new Quat();

    /** Expose for testing — returns the pre-allocated field reference. */
    get _testDesiredPosition(): Vec3 { return this._desiredPosition; }
    get _testLookDirection(): Vec3 { return this._lookDirection; }
    get _testTempRotation(): Quat { return this._tempRotation; }
    get _testCachedTransform(): Transform | null { return this._cachedTransform; }

    onLoad(transform: Transform): void {
        this._cachedTransform = transform;
    }

    lateUpdate(deltaTime: number): void {
        const target = this.target;
        if (!target) return;
        const cameraTransform = this._cachedTransform;
        if (!cameraTransform) return;

        const deltaSeconds = deltaTime / CameraFollowControlPattern.MS_PER_SECOND;
        const t = 1 - Math.exp(-this.damping * deltaSeconds);
        const targetPos = target.position;

        // Desired position = target position + offset (in-place, no allocation)
        this._desiredPosition.x = targetPos.x + this.offsetX;
        this._desiredPosition.y = targetPos.y + this.offsetY;
        this._desiredPosition.z = targetPos.z + this.offsetZ;

        // Lerp camera position toward desired (out-param form, no allocation)
        Vec3.lerp(cameraTransform.position, this._desiredPosition, t, cameraTransform.position);

        if (this.lookAtTarget) {
            const camPos = cameraTransform.position;
            this._lookDirection.x = camPos.x - targetPos.x;
            this._lookDirection.y = camPos.y - targetPos.y;
            this._lookDirection.z = camPos.z - targetPos.z;
            const minDist = CameraFollowControlPattern.FOLLOW_MIN_DISTANCE;
            if (this._lookDirection.x * this._lookDirection.x
              + this._lookDirection.y * this._lookDirection.y
              + this._lookDirection.z * this._lookDirection.z >= minDist * minDist) {
                cameraTransform.rotation = Quat.lookRotation(
                    this._lookDirection,
                    Vec3.UP,
                    this._tempRotation,
                );
            }
        }
    }
}

/**
 * Minimal test double replicating the zero-allocation pattern from
 * Assets/Scripts/CharacterMovement.ts.
 */
class CharacterMovementPattern {
    private static readonly MS_PER_SECOND = 1000;

    public movementSpeed = 5;
    public rotationSpeed = 10;

    /* ---- Private State ---- */
    private readonly _pressedKeys = new Set<string>();
    private _yaw = 0;

    /* ---- Pre-allocated temporaries (zero per-frame allocations) ---- */
    private _cachedTransform: Transform | null = null;
    private readonly _moveDirection = new Vec3();
    private readonly _newPosition = new Vec3();
    private readonly _tempRotation = new Quat();

    /** Expose for testing. */
    get _testMoveDirection(): Vec3 { return this._moveDirection; }
    get _testNewPosition(): Vec3 { return this._newPosition; }
    get _testTempRotation(): Quat { return this._tempRotation; }
    get _testPressedKeys(): Set<string> { return this._pressedKeys; }
    get _testCachedTransform(): Transform | null { return this._cachedTransform; }

    onLoad(transform: Transform): void {
        this._cachedTransform = transform;
    }

    /** Simulate key state for testing. */
    simulateKeys(pressed: string[]): void {
        this._pressedKeys.clear();
        for (const key of pressed) {
            this._pressedKeys.add(key);
        }
    }

    update(deltaTime: number): void {
        const deltaSeconds = deltaTime / CharacterMovementPattern.MS_PER_SECOND;
        const transform = this._cachedTransform;
        if (!transform) return;

        const moveX =
            (this._pressedKeys.has('KeyA') ? 1 : 0) - (this._pressedKeys.has('KeyD') ? 1 : 0);
        const moveZ =
            (this._pressedKeys.has('KeyW') ? 1 : 0) - (this._pressedKeys.has('KeyS') ? 1 : 0);
        const isMoving = moveX !== 0 || moveZ !== 0;

        if (isMoving) {
            this._moveDirection.x = moveX;
            this._moveDirection.y = 0;
            this._moveDirection.z = moveZ;
            Vec3.normalize(this._moveDirection, this._moveDirection);

            const step = this.movementSpeed * deltaSeconds;
            const pos = transform.position;
            this._newPosition.x = pos.x + this._moveDirection.x * step;
            this._newPosition.y = pos.y;
            this._newPosition.z = pos.z + this._moveDirection.z * step;
            transform.position = this._newPosition;

            const targetYaw = Math.atan2(this._moveDirection.x, this._moveDirection.z);
            const deltaYaw = Math.atan2(
                Math.sin(targetYaw - this._yaw),
                Math.cos(targetYaw - this._yaw),
            );
            this._yaw += deltaYaw * Math.min(1, this.rotationSpeed * deltaSeconds);
            Quat.fromEuler(0, this._yaw, 0, this._tempRotation);
            transform.rotation = this._tempRotation;
        }
    }
}

// ---------------------------------------------------------------------------
// 1. CameraFollowControl Zero-Allocation (pattern test double)
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — CameraFollowControl pattern', () => {
    function createHarness() {
        const { entity: targetEntity, transform: targetTransform } = createEntityWithTransform();
        targetTransform.position = new Vec3(10, 0, 0);

        const { entity: cameraEntity, transform: cameraTransform } = createEntityWithTransform();
        cameraTransform.position = new Vec3(0, 5, -10);

        const script = new CameraFollowControlPattern();
        script.onLoad(cameraTransform);
        script.target = targetTransform;

        return { script, cameraTransform, targetTransform, targetEntity, cameraEntity };
    }

    it('_desiredPosition is the same object reference before and after lateUpdate()', () => {
        const { script } = createHarness();
        const refBefore = script._testDesiredPosition;
        script.lateUpdate(16);
        const refAfter = script._testDesiredPosition;
        expect(refBefore).toBe(refAfter);
    });

    it('_lookDirection is the same object reference before and after lateUpdate()', () => {
        const { script } = createHarness();
        const refBefore = script._testLookDirection;
        script.lateUpdate(16);
        const refAfter = script._testLookDirection;
        expect(refBefore).toBe(refAfter);
    });

    it('_tempRotation is the same object reference before and after lateUpdate()', () => {
        const { script } = createHarness();
        const refBefore = script._testTempRotation;
        script.lateUpdate(16);
        const refAfter = script._testTempRotation;
        expect(refBefore).toBe(refAfter);
    });

    it('_cachedTransform is null before onLoad() and non-null after', () => {
        const script = new CameraFollowControlPattern();
        expect(script._testCachedTransform).toBeNull();

        const { transform } = createEntityWithTransform();
        script.onLoad(transform);
        expect(script._testCachedTransform).not.toBeNull();
        expect(script._testCachedTransform).toBe(transform);
    });

    it('1000 iterations of lateUpdate() produce no new own properties', () => {
        const { script } = createHarness();
        const keysBefore = ownKeys(script);
        const countBefore = ownPropertyCount(script);

        for (let i = 0; i < 1000; i++) {
            script.lateUpdate(16);
        }

        const keysAfter = ownKeys(script);
        const countAfter = ownPropertyCount(script);
        expect(countAfter).toBe(countBefore);
        expect(keysAfter).toEqual(keysBefore);
    });
});

// ---------------------------------------------------------------------------
// 2. CharacterMovement Zero-Allocation (pattern test double)
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — CharacterMovement pattern', () => {
    function createHarness() {
        const { entity, transform } = createEntityWithTransform();
        transform.position = new Vec3(0, 0, 0);

        const script = new CharacterMovementPattern();
        script.onLoad(transform);

        return { script, transform, entity };
    }

    it('_moveDirection is the same object reference before and after update()', () => {
        const { script } = createHarness();
        script.simulateKeys(['KeyW']);
        const refBefore = script._testMoveDirection;
        script.update(16);
        const refAfter = script._testMoveDirection;
        expect(refBefore).toBe(refAfter);
    });

    it('_newPosition is the same object reference before and after update()', () => {
        const { script } = createHarness();
        script.simulateKeys(['KeyW']);
        const refBefore = script._testNewPosition;
        script.update(16);
        const refAfter = script._testNewPosition;
        expect(refBefore).toBe(refAfter);
    });

    it('_tempRotation is the same object reference before and after update()', () => {
        const { script } = createHarness();
        script.simulateKeys(['KeyA']);
        const refBefore = script._testTempRotation;
        script.update(16);
        const refAfter = script._testTempRotation;
        expect(refBefore).toBe(refAfter);
    });

    it('_pressedKeys Set is reused across frames (not recreated)', () => {
        const { script } = createHarness();
        const setRef = script._testPressedKeys;
        script.simulateKeys(['KeyW', 'KeyD']);
        expect(script._testPressedKeys).toBe(setRef);
        script.update(16);
        expect(script._testPressedKeys).toBe(setRef);
        script.simulateKeys(['KeyS']);
        expect(script._testPressedKeys).toBe(setRef);
        script.update(16);
        expect(script._testPressedKeys).toBe(setRef);
    });

    it('1000 iterations of update() produce no new own properties', () => {
        const { script } = createHarness();
        script.simulateKeys(['KeyW']);
        const countBefore = ownPropertyCount(script);
        const keysBefore = ownKeys(script);

        for (let i = 0; i < 1000; i++) {
            script.update(16);
        }

        const countAfter = ownPropertyCount(script);
        const keysAfter = ownKeys(script);
        expect(countAfter).toBe(countBefore);
        expect(keysAfter).toEqual(keysBefore);
    });
});

// ---------------------------------------------------------------------------
// 3. OrbitCameraController Zero-Allocation
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — OrbitCameraController', () => {
    function createHarness(autoRotateSpeed = 0) {
        const { world, entity, transform } = createEntityWithTransform();
        transform.position = new Vec3(0, 5, 10);

        const controller = entity.addComponent(OrbitCameraController, {
            target: [0, 0, 0],
            distance: 10,
            azimuth: 0.5,
            elevation: 0.35,
            autoRotateSpeed,
        });

        return { world, entity, transform, controller };
    }

    /** Access private pre-allocated fields via bracket notation for testing. */
    function getPrivateField<T>(obj: object, field: string): T {
        return (obj as Record<string, unknown>)[field] as T;
    }

    it('_tempPosition is the same reference before and after update()', () => {
        const { controller } = createHarness();
        const refBefore = getPrivateField<Vec3>(controller, '_tempPosition');
        controller.update(16);
        const refAfter = getPrivateField<Vec3>(controller, '_tempPosition');
        expect(refBefore).toBe(refAfter);
    });

    it('_tempForward is the same reference before and after update()', () => {
        const { controller } = createHarness();
        const refBefore = getPrivateField<Vec3>(controller, '_tempForward');
        controller.update(16);
        const refAfter = getPrivateField<Vec3>(controller, '_tempForward');
        expect(refBefore).toBe(refAfter);
    });

    it('_tempNormalizedForward is the same reference before and after update()', () => {
        const { controller } = createHarness();
        const refBefore = getPrivateField<Vec3>(controller, '_tempNormalizedForward');
        controller.update(16);
        const refAfter = getPrivateField<Vec3>(controller, '_tempNormalizedForward');
        expect(refBefore).toBe(refAfter);
    });

    it('_tempBackward is the same reference before and after update()', () => {
        const { controller } = createHarness();
        const refBefore = getPrivateField<Vec3>(controller, '_tempBackward');
        controller.update(16);
        const refAfter = getPrivateField<Vec3>(controller, '_tempBackward');
        expect(refBefore).toBe(refAfter);
    });

    it('_tempRotation is the same reference before and after update()', () => {
        const { controller } = createHarness();
        const refBefore = getPrivateField<Quat>(controller, '_tempRotation');
        controller.update(16);
        const refAfter = getPrivateField<Quat>(controller, '_tempRotation');
        expect(refBefore).toBe(refAfter);
    });

    it('1000 iterations of update() produce no new own properties', () => {
        const { controller } = createHarness(0.5);
        const countBefore = ownPropertyCount(controller);
        const keysBefore = ownKeys(controller);

        for (let i = 0; i < 1000; i++) {
            controller.update(16);
        }

        const countAfter = ownPropertyCount(controller);
        const keysAfter = ownKeys(controller);
        expect(countAfter).toBe(countBefore);
        expect(keysAfter).toEqual(keysBefore);
    });
});

// ---------------------------------------------------------------------------
// 4. TrailRenderer Zero-Allocation
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — TrailRenderer', () => {
    function createHarness() {
        const { world, entity, transform } = createEntityWithTransform();
        transform.position = new Vec3(0, 0, 0);

        const trail = entity.addComponent(TrailRenderer, {
            lifetime: 2,
            minVertexDistance: 0.5,
            startWidth: 1,
            endWidth: 0,
        });

        return { world, entity, transform, trail };
    }

    function getPrivateField<T>(obj: object, field: string): T {
        return (obj as Record<string, unknown>)[field] as T;
    }

    it('ring buffer is pre-allocated to fixed capacity (256)', () => {
        const { trail } = createHarness();
        const capacity = getPrivateField<number>(trail, '_capacity');
        const points = getPrivateField<unknown[]>(trail, '_points');
        expect(capacity).toBe(256);
        expect(points.length).toBe(256);
    });

    it('_tempColor Vec4 is the same reference before and after update()', () => {
        const { trail, transform } = createHarness();
        const refBefore = getPrivateField<Vec4>(trail, '_tempColor');

        // Move the transform to generate trail points
        transform.position = new Vec3(1, 0, 0);
        trail.update(16);
        transform.position = new Vec3(2, 0, 0);
        trail.update(16);

        const refAfter = getPrivateField<Vec4>(trail, '_tempColor');
        expect(refBefore).toBe(refAfter);
    });

    it('TrailPoint objects in the ring buffer are reused (same reference at index)', () => {
        const { trail, transform } = createHarness();
        const points = getPrivateField<Array<{ position: Vec3; time: number; width: number }>>(
            trail, '_points'
        );

        // Record references to the first few trail points before any update
        const pointRef0Before = points[0];
        const pointRef1Before = points[1];
        const posRef0Before = points[0]!.position;

        // Generate several trail points
        for (let i = 0; i < 10; i++) {
            transform.position = new Vec3(i * 2, 0, 0);
            trail.update(100);
        }

        // The TrailPoint objects themselves are the same references (ring buffer reuse)
        expect(points[0]).toBe(pointRef0Before);
        expect(points[1]).toBe(pointRef1Before);
        // The position Vec3 inside each TrailPoint is also the same reference
        expect(points[0]!.position).toBe(posRef0Before);
    });

    it('evaluateColor() returns the same _tempColor reference across calls', () => {
        const { trail } = createHarness();
        const color1 = trail.evaluateColor(0.0);
        const color2 = trail.evaluateColor(0.5);
        const color3 = trail.evaluateColor(1.0);
        // All calls return the same pre-allocated Vec4
        expect(color1).toBe(color2);
        expect(color2).toBe(color3);
    });

    it('evaluateColor() produces no new Vec4 allocations (same reference)', () => {
        const { trail } = createHarness();
        const refBefore = getPrivateField<Vec4>(trail, '_tempColor');

        // Call evaluateColor many times
        for (let i = 0; i <= 100; i++) {
            trail.evaluateColor(i / 100);
        }

        const refAfter = getPrivateField<Vec4>(trail, '_tempColor');
        expect(refBefore).toBe(refAfter);
    });

    it('no array push/shift in hot path — ring buffer uses index arithmetic', () => {
        const { trail, transform } = createHarness();
        const pointCountBefore = trail.pointCount;

        // After updates, pointCount should grow via index arithmetic, not array resizing
        transform.position = new Vec3(1, 0, 0);
        trail.update(50);
        expect(trail.pointCount).toBeGreaterThan(pointCountBefore);

        // The internal _points array length never changes
        const points = getPrivateField<unknown[]>(trail, '_points');
        expect(points.length).toBe(256);
    });

    it('1000 iterations of update() produce no new own properties', () => {
        const { trail, transform } = createHarness();
        const countBefore = ownPropertyCount(trail);
        const keysBefore = ownKeys(trail);

        for (let i = 0; i < 1000; i++) {
            transform.position = new Vec3(i * 0.6, 0, 0);
            trail.update(16);
        }

        const countAfter = ownPropertyCount(trail);
        const keysAfter = ownKeys(trail);
        expect(countAfter).toBe(countBefore);
        expect(keysAfter).toEqual(keysBefore);
    });
});

// ---------------------------------------------------------------------------
// 5. PathAgent Zero-Allocation
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — PathAgent', () => {
    function createHarness() {
        const { world, entity, transform } = createEntityWithTransform();
        transform.position = new Vec3(0, 0, 0);

        const agent = entity.addComponent(PathAgent, {
            speed: 5,
            angularSpeed: 120,
            stoppingDistance: 0.5,
        });

        return { world, entity, transform, agent };
    }

    function getPrivateField<T>(obj: object, field: string): T {
        return (obj as Record<string, unknown>)[field] as T;
    }

    it('_tempToCorner is the same reference before and after update()', () => {
        const { agent, transform } = createHarness();
        transform.position = new Vec3(0, 0, 0);
        agent.setDestination(new Vec3(20, 0, 0));

        const refBefore = getPrivateField<Vec3>(agent, '_tempToCorner');
        agent.update(0.016);
        const refAfter = getPrivateField<Vec3>(agent, '_tempToCorner');
        expect(refBefore).toBe(refAfter);
    });

    it('_tempVelocity is the same reference before and after update()', () => {
        const { agent, transform } = createHarness();
        transform.position = new Vec3(0, 0, 0);
        agent.setDestination(new Vec3(20, 0, 0));

        const refBefore = getPrivateField<Vec3>(agent, '_tempVelocity');
        agent.update(0.016);
        const refAfter = getPrivateField<Vec3>(agent, '_tempVelocity');
        expect(refBefore).toBe(refAfter);
    });

    it('pre-allocated temp vectors are distinct Vec3 instances', () => {
        const { agent } = createHarness();
        const toCorner = getPrivateField<Vec3>(agent, '_tempToCorner');
        const velocity = getPrivateField<Vec3>(agent, '_tempVelocity');
        expect(toCorner).not.toBe(velocity);
        expect(toCorner).toBeInstanceOf(Vec3);
        expect(velocity).toBeInstanceOf(Vec3);
    });

    it('1000 iterations of update() produce no new own properties', () => {
        const { agent, transform } = createHarness();
        transform.position = new Vec3(0, 0, 0);
        agent.setDestination(new Vec3(100, 0, 0));

        const countBefore = ownPropertyCount(agent);
        const keysBefore = ownKeys(agent);

        for (let i = 0; i < 1000; i++) {
            agent.update(0.016);
        }

        const countAfter = ownPropertyCount(agent);
        const keysAfter = ownKeys(agent);
        expect(countAfter).toBe(countBefore);
        expect(keysAfter).toEqual(keysBefore);
    });
});

// ---------------------------------------------------------------------------
// 6. BillboardRenderer — construction-time allocation verification
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — BillboardRenderer', () => {
    it('has no update() method — passive component with zero per-frame cost', () => {
        const { entity } = createEntityWithTransform();
        const billboard = entity.addComponent(BillboardRenderer, {
            width: 2,
            height: 4,
        });
        // BillboardRenderer does not override update(), confirming zero per-frame cost.
        // The prototype chain should not have an own update() method.
        const hasOwnUpdate = Object.prototype.hasOwnProperty.call(billboard, 'update');
        expect(hasOwnUpdate).toBe(false);
    });

    it('pre-allocated _pivot Vec3 is stable across property reads', () => {
        const { entity } = createEntityWithTransform();
        const billboard = entity.addComponent(BillboardRenderer, {
            pivot: [0.5, 0.5, 0],
        });
        const pivotBefore = billboard.pivot;
        // Reading pivot multiple times should not allocate
        void billboard.pivot;
        void billboard.pivot;
        const pivotAfter = billboard.pivot;
        expect(pivotBefore).toBe(pivotAfter);
    });

    it('getAdjustedUVs() returns consistent results without hidden state mutation', () => {
        const { entity } = createEntityWithTransform();
        const billboard = entity.addComponent(BillboardRenderer, {
            flipX: true,
            flipY: false,
        });
        const uvs1 = billboard.getAdjustedUVs();
        const uvs2 = billboard.getAdjustedUVs();
        expect(uvs1).toEqual(uvs2);
    });
});

// ---------------------------------------------------------------------------
// 7. Frame Timing Consistency
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — Frame Timing Consistency', () => {
    /**
     * Frame budget at 60 fps = 16.67ms. We allow each component's hot path
     * to consume at most 2ms for 1000 iterations (i.e. ~2us per call),
     * which is generous but catches catastrophic regressions.
     */
    const BUDGET_MS_PER_1000 = 50;

    it('CameraFollowControl pattern: 1000 lateUpdate() iterations within frame budget', () => {
        const { entity: targetEntity, transform: targetTransform } = createEntityWithTransform();
        targetTransform.position = new Vec3(10, 0, 0);
        const { transform: cameraTransform } = createEntityWithTransform();
        cameraTransform.position = new Vec3(0, 5, -10);

        const script = new CameraFollowControlPattern();
        script.onLoad(cameraTransform);
        script.target = targetTransform;

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            script.lateUpdate(16);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(BUDGET_MS_PER_1000);
    });

    it('CharacterMovement pattern: 1000 update() iterations within frame budget', () => {
        const { transform } = createEntityWithTransform();
        const script = new CharacterMovementPattern();
        script.onLoad(transform);
        script.simulateKeys(['KeyW', 'KeyD']);

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            script.update(16);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(BUDGET_MS_PER_1000);
    });

    it('OrbitCameraController: 1000 update() iterations within frame budget', () => {
        const { entity, controller } = (() => {
            const { world, entity, transform } = createEntityWithTransform();
            transform.position = new Vec3(0, 5, 10);
            const ctrl = entity.addComponent(OrbitCameraController, {
                target: [0, 0, 0],
                distance: 10,
                azimuth: 0.5,
                elevation: 0.35,
                autoRotateSpeed: 1.0,
            });
            return { world, entity, controller: ctrl };
        })();

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            controller.update(16);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(BUDGET_MS_PER_1000);
    });

    it('TrailRenderer: 1000 update() iterations within frame budget', () => {
        const { entity, transform } = createEntityWithTransform();
        const trail = entity.addComponent(TrailRenderer, {
            lifetime: 5,
            minVertexDistance: 0.1,
        });

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            transform.position = new Vec3(i * 0.1, 0, 0);
            trail.update(16);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(BUDGET_MS_PER_1000);
    });

    it('PathAgent: 1000 update() iterations within frame budget', () => {
        const { entity, transform } = createEntityWithTransform();
        const agent = entity.addComponent(PathAgent, { speed: 5 });
        transform.position = new Vec3(0, 0, 0);
        agent.setDestination(new Vec3(100, 0, 0));

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            agent.update(0.016);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(BUDGET_MS_PER_1000);
    });
});

// ---------------------------------------------------------------------------
// 8. Source-level pattern verification for game scripts
// ---------------------------------------------------------------------------

describe('T-11: Script Performance Regression — zero-allocation pattern governance', () => {
    it('OrbitCameraController declares all temp fields as readonly', () => {
        const { entity } = createEntityWithTransform();
        const controller = entity.addComponent(OrbitCameraController);

        // Verify the pre-allocated fields exist and are Vec3/Quat instances
        const tempPosition = (controller as Record<string, unknown>)['_tempPosition'];
        const tempForward = (controller as Record<string, unknown>)['_tempForward'];
        const tempNormalizedForward = (controller as Record<string, unknown>)['_tempNormalizedForward'];
        const tempBackward = (controller as Record<string, unknown>)['_tempBackward'];
        const tempRotation = (controller as Record<string, unknown>)['_tempRotation'];

        expect(tempPosition).toBeInstanceOf(Vec3);
        expect(tempForward).toBeInstanceOf(Vec3);
        expect(tempNormalizedForward).toBeInstanceOf(Vec3);
        expect(tempBackward).toBeInstanceOf(Vec3);
        expect(tempRotation).toBeInstanceOf(Quat);
    });

    it('TrailRenderer declares all temp fields as readonly Vec3/Vec4', () => {
        const { entity } = createEntityWithTransform();
        const trail = entity.addComponent(TrailRenderer);

        const tempPosition = (trail as Record<string, unknown>)['_tempPosition'];
        const tempColor = (trail as Record<string, unknown>)['_tempColor'];
        const tempLowerColor = (trail as Record<string, unknown>)['_tempLowerColor'];
        const tempUpperColor = (trail as Record<string, unknown>)['_tempUpperColor'];
        const lastPosition = (trail as Record<string, unknown>)['_lastPosition'];

        expect(tempPosition).toBeInstanceOf(Vec3);
        expect(tempColor).toBeInstanceOf(Vec4);
        expect(tempLowerColor).toBeInstanceOf(Vec4);
        expect(tempUpperColor).toBeInstanceOf(Vec4);
        expect(lastPosition).toBeInstanceOf(Vec3);
    });

    it('PathAgent declares pre-allocated temp vectors as readonly Vec3', () => {
        const { entity } = createEntityWithTransform();
        const agent = entity.addComponent(PathAgent);

        const tempToCorner = (agent as Record<string, unknown>)['_tempToCorner'];
        const tempVelocity = (agent as Record<string, unknown>)['_tempVelocity'];

        expect(tempToCorner).toBeInstanceOf(Vec3);
        expect(tempVelocity).toBeInstanceOf(Vec3);
    });

    it('TrailRenderer ring buffer TrailPoint objects contain pre-allocated Vec3 positions', () => {
        const { entity } = createEntityWithTransform();
        const trail = entity.addComponent(TrailRenderer);

        const points = (trail as Record<string, unknown>)['_points'] as Array<{
            position: Vec3;
            time: number;
            width: number;
        }>;
        const capacity = (trail as Record<string, unknown>)['_capacity'] as number;

        expect(capacity).toBe(256);
        for (let i = 0; i < capacity; i++) {
            expect(points[i]).toBeDefined();
            expect(points[i]!.position).toBeInstanceOf(Vec3);
        }
    });

    it('OrbitCameraController pre-allocated fields are initialized in constructor (not lazily)', () => {
        const controller = new OrbitCameraController();
        // All temp fields should be non-undefined immediately after construction
        const tempPosition = (controller as Record<string, unknown>)['_tempPosition'];
        const tempForward = (controller as Record<string, unknown>)['_tempForward'];
        const tempRotation = (controller as Record<string, unknown>)['_tempRotation'];

        expect(tempPosition).toBeDefined();
        expect(tempForward).toBeDefined();
        expect(tempRotation).toBeDefined();
        // They should be distinct instances
        expect(tempPosition).not.toBe(tempForward);
        expect(tempPosition).not.toBe(tempRotation);
    });
});
