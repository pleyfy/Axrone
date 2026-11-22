import { describe, expect, it } from 'vitest';
import { createGameLoop } from '@axrone/game-loop';
import { BoxCollider3D, Rigidbody3D } from '@axrone/physics-3d';
import { ManualScheduler } from '../../../../../tests/shared/test-harness';
import { PhysicsBridge3D } from '../../../../scene-runtime/src/components/physics-bridge-3d';
import type { IBoxShapeDef3D } from '../../types';

// Task D (M6 validation, RE-QA round) — the SHIPPED path:
// ManualScheduler -> createGameLoop -> PhysicsBridge3D.fixedUpdate -> PhysicsWorld3D.step.
//
// Round-1 correction (documented, not a silent bound change):
// 1. Units. Round 1 fed seconds into the loop, which the engine reads as milliseconds
//    (game-loop DEFAULT_FIXED_DELTA = 1000/60); after 01b423626 the bridge divides the
//    loop's ms by 1000, so feeding seconds double-divided dt to ~1.67e-5 s/step and made
//    900 steps simulate only ~0.015 s (the "nothing fell" signature). This harness now
//    feeds engine-real milliseconds, exactly what a shipped scene gets.
// 2. Ground geometry. BoxCollider3D.size is FULL extents (components/boxcollider3d.ts
//    _createShape multiplies by 0.5). Round 1 passed the unit gate's HALF extents as size,
//    so the TD-03 scene built a ground whose top sits at -0.25 and a box resting at 0.15
//    was correct physics on the wrong ground. Both scenes now build size y=1.0
//    (halfExtents y=0.5, top at 0.0), matching rest-stability-3d.test.ts.
// 3. Expectations are DERIVED from the geometry the world actually built
//    (captured shape def + bodyManager ground position), not hardcoded literals.
//    Height/tilt/lateral bounds are aligned with the repo's own stack gate
//    (stack-rest-stability-3d.test.ts, d8736fb8a): top-height error < 0.02,
//    tilt < 1 deg, lateral < 0.05, zero lifecycle churn.

interface TransformData {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    worldPosition: { x: number; y: number; z: number };
    worldRotation: { x: number; y: number; z: number; w: number };
    worldScale: { x: number; y: number; z: number };
    parent: null;
}

const createTransform = (
    pos: { x: number; y: number; z: number },
    rot = { x: 0, y: 0, z: 0, w: 1 }
): TransformData => {
    const t: TransformData = {
        position: { ...pos },
        rotation: { ...rot },
        worldPosition: { ...pos },
        worldRotation: { ...rot },
        worldScale: { x: 1, y: 1, z: 1 },
        parent: null,
    };
    return new Proxy(t, {
        set(target, prop, value) {
            (target as unknown as Record<string, unknown>)[prop as string] = value;
            if (prop === 'position') target.worldPosition = { ...value };
            if (prop === 'rotation') target.worldRotation = { ...value };
            return true;
        },
    });
};

class MockActor {
    active = true;
    isDestroyed = false;
    private readonly _components: unknown[] = [];

    addComponent(component: object): this {
        this._components.push(component);
        return this;
    }

    getComponent<T>(Ctor: new (...args: never[]) => T): T | undefined {
        return this._components.find((c) => c instanceof Ctor) as T | undefined;
    }

    getAllComponents(): unknown[] {
        return [...this._components];
    }
}

class MockEcsWorld {
    private readonly _actors: MockActor[] = [];

    addActor(actor: MockActor): void {
        this._actors.push(actor);
    }

    getAllActors(): MockActor[] {
        return [...this._actors];
    }
}

const STACK = 3;
const TARGETS = [18, 25, 300, 900] as const;
const ENGINE_MS = 1000 / 60;
const MS_SPACING = [16.6667, 33.3333, 8.5, 41.2, 16.6667, 22.1, 5.3, 16.6667];
const GROUND_SIZE_Y = 1.0; // full extents; the shape gets halfExtents y = 0.5 (gate-equivalent)
const BOX_SIZE = 0.8; // full extents; halfExtents 0.4
const BOX_HALF = BOX_SIZE / 2;
const GROUND_Y = -0.5;

const attachTransform = (component: object, transform: TransformData): void => {
    Object.defineProperty(component, 'transform', { get: () => transform, configurable: true });
};

const addBox = (
    world: MockEcsWorld,
    transform: TransformData,
    staticBody: boolean,
    sizeY: number,
    friction: number
): Rigidbody3D => {
    const actor = new MockActor();
    const rb = new Rigidbody3D();
    attachTransform(rb, transform);
    // Rigidbody3DType.Static === 0, Dynamic === 2 (local const enum in rigidbody3d.ts).
    rb.bodyType = (staticBody ? 0 : 2) as never;
    if (!staticBody) rb.mass = 1;
    actor.addComponent(rb);

    const col = new BoxCollider3D();
    attachTransform(col, transform);
    col.size = { x: 40, y: sizeY, z: 40 };
    col.material = { staticFriction: friction, dynamicFriction: friction, bounciness: 0 };
    actor.addComponent(col);

    world.addActor(actor);
    return rb;
};

const tiltDegrees = (q: { x: number; y: number; z: number; w: number }): number => {
    const norm = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    return (2 * Math.acos(Math.min(1, Math.abs(q.w) / norm)) * 180) / Math.PI;
};

interface RunOut {
    readonly posesAtStep: Record<number, string>;
    readonly fixedSteps: number;
    readonly maxTiltDegrees: number;
    readonly maxLateral: number;
    readonly maxOmega: number;
    readonly lifecycleChurnAfterSettle: number;
    readonly asleepStepCount: number;
    readonly firstSleepStep: number;
    readonly firstSleepY: number;
    readonly firstStepDt: number;
    readonly vyAfterFirstStep: number;
    readonly groundShape: IBoxShapeDef3D | null;
    readonly groundBodyY: number;
    readonly worldGravity: unknown;
    readonly finalY: number[];
}

const runLoop = (options: {
    frameSpacing: readonly number[];
    stacked: boolean;
    worldConfig?: { readonly allowSleep?: boolean };
}): RunOut => {
    const world = new MockEcsWorld();
    const ground = addBox(
        world,
        createTransform({ x: 0, y: GROUND_Y, z: 0 }),
        true,
        GROUND_SIZE_Y,
        0.8
    );
    const boxes: Rigidbody3D[] = [];
    const dynamicCount = options.stacked ? STACK : 1;
    for (let i = 0; i < dynamicCount; i += 1) {
        boxes.push(
            addBox(
                world,
                createTransform({ x: 0, y: 0.8 + 0.8 * i, z: 0 }),
                false,
                BOX_SIZE,
                0.7
            )
        );
    }

    const bridge = new PhysicsBridge3D(world as never, { worldConfig: options.worldConfig });
    const physicsWorld = bridge.physicsWorld;
    const bodyManager = physicsWorld.getBodyManager();

    // Capture the geometry the world actually built (ground shape is created first) and
    // the deltaTime the solver actually receives on step 1 (01b423626 contract).
    let groundShape: IBoxShapeDef3D | null = null;
    const originalCreateBox = physicsWorld.createBoxShape.bind(physicsWorld);
    (physicsWorld as unknown as { createBoxShape: unknown }).createBoxShape = (
        ...args: unknown[]
    ) => {
        if (groundShape === null) groundShape = args[1] as IBoxShapeDef3D;
        return (originalCreateBox as (...a: unknown[]) => number)(...args);
    };
    let firstStepDt = Number.NaN;
    const originalStep = physicsWorld.step.bind(physicsWorld);
    (physicsWorld as unknown as { step: unknown }).step = (dt: number, ...rest: unknown[]) => {
        if (Number.isNaN(firstStepDt)) firstStepDt = dt;
        return (originalStep as (...a: unknown[]) => void)(dt, ...rest);
    };

    let fixedSteps = 0;
    let lifecycle = 0;
    let settledAt = 0;
    let maxTiltDegrees = 0;
    let maxLateral = 0;
    let maxOmega = 0;
    let vyAfterFirstStep = Number.NaN;
    let asleepStepCount = 0;
    let firstSleepStep = 0;
    let firstSleepY = Number.NaN;
    const posesAtStep: Record<number, string> = {};

    bridge.physicsWorld.setContactListener({
        onCollisionBegin: () => {
            lifecycle += 1;
        },
        onCollisionEnd: () => {
            lifecycle += 1;
        },
    } as never);

    const scheduler = new ManualScheduler();
    const loop = createGameLoop<Record<string, never>>({
        state: {},
        scheduler: scheduler as never,
        fixedDelta: ENGINE_MS,
        autoStart: false,
        systems: [
            {
                id: 'scene.physics-bridge-3d',
                beforeUpdate: (ctx) => bridge.beforeUpdate(ctx as never),
                fixedUpdate: () => {
                    bridge.fixedUpdate({ fixedDelta: ENGINE_MS } as never);
                    fixedSteps += 1;
                    if (fixedSteps === 1) vyAfterFirstStep = boxes[0].velocity.y;
                    if (fixedSteps === 60) settledAt = lifecycle;
                    let asleepThisStep = false;
                    for (const rb of boxes) {
                        const p = rb.position;
                        const av = rb.angularVelocity;
                        maxTiltDegrees = Math.max(maxTiltDegrees, tiltDegrees(rb.rotation));
                        maxLateral = Math.max(maxLateral, Math.hypot(p.x, p.z));
                        maxOmega = Math.max(maxOmega, Math.hypot(av.x, av.y, av.z));
                        if (!bodyManager.isAwake(rb.bodyId)) asleepThisStep = true;
                    }
                    if (asleepThisStep) {
                        asleepStepCount += 1;
                        if (firstSleepStep === 0) {
                            firstSleepStep = fixedSteps;
                            firstSleepY = boxes[0].position.y;
                        }
                    }
                    for (const target of TARGETS) {
                        if (fixedSteps === target && posesAtStep[target] === undefined) {
                            posesAtStep[target] = boxes
                                .map(
                                    (b, i) =>
                                        `box${i}=y${b.position.y.toFixed(4)}/awake${bodyManager.isAwake(b.bodyId)}`
                                )
                                .join(' ');
                        }
                    }
                },
                dispose: () => bridge.dispose(),
            },
        ],
    });

    loop.start(0);
    let timestamp = 0;
    let frames = 0;
    while (TARGETS.some((t) => posesAtStep[t] === undefined) && frames < 100000) {
        timestamp += options.frameSpacing[frames % options.frameSpacing.length];
        scheduler.flush(timestamp);
        frames += 1;
    }
    const finalY = boxes.map((b) => Number(b.position.y.toFixed(4)));
    // Read world truth BEFORE loop.dispose(): disposal clears the body-id map and
    // getPosition() would degrade to {0,0,0} (round-2 lesson).
    const groundBodyY = bodyManager.getPosition(ground.bodyId).y;
    loop.dispose();

    return {
        posesAtStep,
        fixedSteps,
        maxTiltDegrees,
        maxLateral,
        maxOmega,
        lifecycleChurnAfterSettle: lifecycle - settledAt,
        asleepStepCount,
        firstSleepStep,
        firstSleepY,
        firstStepDt,
        vyAfterFirstStep,
        groundShape,
        groundBodyY,
        worldGravity: (physicsWorld as unknown as { config: { gravity?: unknown } }).config?.gravity,
        finalY,
    };
};

const poseTrail = (run: RunOut): string =>
    TARGETS.map((t) => `${t}:${run.posesAtStep[t]}`).join('  ') +
    `  asleepSteps=${run.asleepStepCount}/${run.fixedSteps} firstSleep=${run.firstSleepStep}`;

const sceneContract = (run: RunOut): string =>
    `scene contract: ground halfExtents.y=${run.groundShape?.halfExtents.y} ` +
    `ground center.y=${run.groundShape?.center.y} groundBodyY=${run.groundBodyY} ` +
    `worldConfig.gravity=${JSON.stringify(run.worldGravity)} dt(step1)=${run.firstStepDt}`;

// Analytic rest height of box i on the ground this scene builds:
// groundTop = ground body Y + ground halfExtents.y; box i centre = groundTop + half*(2i+1).
const expectedRest = (run: RunOut, index: number): number => {
    const groundHalfY = run.groundShape?.halfExtents.y ?? Number.NaN;
    return run.groundBodyY + groundHalfY + BOX_HALF * (2 * index + 1);
};

describe('Task D RE-QA — shipped game-loop path (bridge -> PhysicsWorld3D.step)', () => {
    it('hands the solver seconds and default gravity at the fixed-update seam, on the geometry it built', () => {
        const run = runLoop({ frameSpacing: MS_SPACING, stacked: true });

        // 01b423626: the bridge converts the loop's milliseconds to seconds.
        expect(run.firstStepDt, sceneContract(run)).toBeCloseTo(1 / 60, 9);
        // Default gravity reached the solver: v(t1) = -9.81 * dt (nothing else acts yet).
        expect(run.vyAfterFirstStep, sceneContract(run)).toBeCloseTo(-9.81 / 60, 6);
        // The ground this scene builds is the gate-equivalent plane: halfExtents y=0.5,
        // body at y=-0.5, top surface at 0.
        expect(run.groundShape?.halfExtents.y, sceneContract(run)).toBeCloseTo(0.5, 12);
        expect(run.groundBodyY, sceneContract(run)).toBeCloseTo(-0.5, 12);
    });

    it('BUG-TD-02 (repaired): a 3-box stack rests at its geometry-derived heights through the shipped loop', () => {
        const run = runLoop({ frameSpacing: MS_SPACING, stacked: true });

        const expected = [0, 1, 2].map((i) => Number(expectedRest(run, i).toFixed(4)));
        // Bounds aligned with stack-rest-stability-3d.test.ts (d8736fb8a): the stack gate
        // allows top-height error < 0.02, tilt < 1 deg, lateral < 0.05, zero churn.
        for (let i = 0; i < 3; i += 1) {
            expect(
                Math.abs(run.finalY[i] - expected[i]),
                `box${i} ${sceneContract(run)} expected=${expected[i]} ${poseTrail(run)}`
            ).toBeLessThan(0.02);
        }
        expect(run.maxTiltDegrees, poseTrail(run)).toBeLessThan(1);
        expect(run.maxLateral, poseTrail(run)).toBeLessThan(0.05);
        expect(run.lifecycleChurnAfterSettle, poseTrail(run)).toBe(0);
    });

    it('BUG-TD-03 (repaired): a single box meets the unit-gate thresholds in the shipped loop, asleep and awake', () => {
        const sleeping = runLoop({ frameSpacing: MS_SPACING, stacked: false });
        const noSleep = runLoop({
            frameSpacing: MS_SPACING,
            stacked: false,
            worldConfig: { allowSleep: false },
        });

        const gateThresholds = (run: RunOut, label: string): void => {
            const expectedY = expectedRest(run, 0);
            expect(
                Math.abs(run.finalY[0] - expectedY),
                `${label} expected rest ${expectedY.toFixed(4)} ${sceneContract(run)} ${poseTrail(run)}`
            ).toBeLessThan(0.005);
            expect(run.maxTiltDegrees, `${label} ${poseTrail(run)}`).toBeLessThan(0.05);
            expect(run.maxLateral, `${label} ${poseTrail(run)}`).toBeLessThan(0.005);
            expect(run.maxOmega, `${label} ${poseTrail(run)}`).toBeLessThan(0.01);
            expect(run.lifecycleChurnAfterSettle, `${label} ${poseTrail(run)}`).toBe(0);
        };

        // Shipped default (sleep on): the box must reach the gate rest height, not park
        // mid-drift or mid-fall. When it first sleeps it must already be at the rest
        // height — sleeping mid-drift would hide solver drift from users.
        gateThresholds(sleeping, 'sleep-on');
        expect(sleeping.firstSleepStep, poseTrail(sleeping)).toBeGreaterThan(0);
        expect(
            Math.abs(sleeping.firstSleepY - expectedRest(sleeping, 0)),
            `firstSleepY=${sleeping.firstSleepY} at step ${sleeping.firstSleepStep} ${poseTrail(sleeping)}`
        ).toBeLessThan(0.005);
        gateThresholds(noSleep, 'sleep-off');
    });
});
