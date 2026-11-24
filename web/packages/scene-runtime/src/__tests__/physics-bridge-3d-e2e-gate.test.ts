import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Component, Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { BoxCollider3D, PhysicsWorld3D, Rigidbody3D } from '@axrone/physics-3d';
import { PhysicsConstants } from '@axrone/physics-core';
import { getDefaultSceneRuntimeComposition } from '@axrone/scene-runtime/default-composition';
import { SceneRuntimeKernel } from '@axrone/scene-runtime/scene-facade';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

type StepProbe = (
    deltaTime: number,
    velocityIterations?: number,
    positionIterations?: number
) => void;

class CollisionProbe extends Component {
    enters = 0;
    stays = 0;
    exits = 0;

    onCollisionEnter(): void {
        this.enters += 1;
    }
    onCollisionStay(): void {
        this.stays += 1;
    }
    onCollisionExit(): void {
        this.exits += 1;
    }
}

const GROUND_SIZE = { x: 40, y: 1, z: 40 };
const GROUND_CENTER_Y = -0.5;
const BOX_SIZE = { x: 0.8, y: 0.8, z: 0.8 };
const BOX_START_Y = 3;
const BOX_LAUNCH_VELOCITY_Y = -2;
const BOX_ANALYTIC_REST_Y = GROUND_CENTER_Y + GROUND_SIZE.y / 2 + BOX_SIZE.y / 2;
const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const ENGINE_FIXED_DELTA_S = 1 / 60;
const SETTLE_STEPS = 900;
const SPAWN_AT_REST_STEPS = 3;

const observedSolverDeltas: number[] = [];
const prototypeSolverStep: StepProbe = PhysicsWorld3D.prototype.step;

PhysicsWorld3D.prototype.step = function (
    deltaTime: number,
    velocityIterations?: number,
    positionIterations?: number
): void {
    observedSolverDeltas.push(deltaTime);
    prototypeSolverStep.call(this, deltaTime, velocityIterations, positionIterations);
};

const createGateScene = (launchVelocityY: number | null) => {
    const canvas = document.createElement('canvas');
    const scheduler = new ManualScheduler();
    const kernel = new SceneRuntimeKernel({
        sceneId: 'physics-3d-e2e-gate',
        options: {
            ...createSceneOptions(scheduler, canvas),
            registry: {},
            fixedDelta: undefined,
            composition: getDefaultSceneRuntimeComposition(),
        },
    });

    const entities = kernel.entities.createEntitiesWithComponents([
        {
            components: [{ type: Rigidbody3D }, { type: BoxCollider3D }, { type: CollisionProbe }],
        },
        {
            components: [{ type: Rigidbody3D }, { type: BoxCollider3D }, { type: CollisionProbe }],
        },
    ]);

    const [groundEntity, boxEntity] = entities;
    if (groundEntity === undefined || boxEntity === undefined) {
        throw new Error('scene descriptor produced no entities');
    }

    const components = {
        groundTransform: groundEntity.getComponent(Transform),
        boxTransform: boxEntity.getComponent(Transform),
        groundRigidbody: groundEntity.getComponent(Rigidbody3D),
        boxRigidbody: boxEntity.getComponent(Rigidbody3D),
        groundCollider: groundEntity.getComponent(BoxCollider3D),
        boxCollider: boxEntity.getComponent(BoxCollider3D),
        groundProbe: groundEntity.getComponent(CollisionProbe),
        boxProbe: boxEntity.getComponent(CollisionProbe),
    };

    const {
        groundTransform,
        boxTransform,
        groundRigidbody,
        boxRigidbody,
        groundCollider,
        boxCollider,
        groundProbe,
        boxProbe,
    } = components;
    if (
        groundTransform === undefined ||
        boxTransform === undefined ||
        groundRigidbody === undefined ||
        boxRigidbody === undefined ||
        groundCollider === undefined ||
        boxCollider === undefined ||
        groundProbe === undefined ||
        boxProbe === undefined
    ) {
        throw new Error('scene descriptor did not materialise the physics components');
    }

    groundTransform.position = new Vec3(0, GROUND_CENTER_Y, 0);

    boxTransform.position = new Vec3(0, BOX_START_Y, 0);

    groundRigidbody.isKinematic = true;
    groundCollider.size = { ...GROUND_SIZE };

    boxRigidbody.mass = 1;
    boxCollider.size = { ...BOX_SIZE };

    const bridgeWorld = (
        kernel.physicsBridge3D as unknown as { physicsWorld?: PhysicsWorld3D }
    ).physicsWorld;

    let timestamp = 0;
    kernel.loop.start(timestamp);

    const advanceSteps = (count: number): void => {
        for (let step = 0; step < count; step += 1) {
            timestamp += ENGINE_FIXED_DELTA_MS;
            scheduler.flush(timestamp);
        }
    };

    advanceSteps(1);

    if (launchVelocityY !== null) {
        boxRigidbody.velocity = { x: 0, y: launchVelocityY, z: 0 };
    }

    return {
        kernel,
        boxTransform,
        boxRigidbody,
        boxProbe,
        groundProbe,
        bridgeWorld,
        advanceSteps,
    };
};

describe('Physics 3D end-to-end merge gate (descriptor -> kernel loop -> bridge -> solver)', () => {
    beforeAll(() => {
        installWebGL2Constants();
    });

    afterAll(() => {
        PhysicsWorld3D.prototype.step = prototypeSolverStep;
    });

    it('settles a scene-dropped box at its analytic rest height on solver seconds with one contact enter', () => {
        observedSolverDeltas.length = 0;
        const { kernel, boxTransform, boxRigidbody, boxProbe, groundProbe, advanceSteps } =
            createGateScene(BOX_LAUNCH_VELOCITY_Y);

        try {
            expect(kernel.physicsBridge3D).not.toBeNull();
            expect(kernel.loop.fixedDelta).toBe(ENGINE_FIXED_DELTA_MS);

            advanceSteps(SETTLE_STEPS);

            expect(observedSolverDeltas.length).toBe(SETTLE_STEPS + 1);
            for (const deltaTime of observedSolverDeltas) {
                expect(deltaTime, `solver received ${deltaTime}`).toBe(ENGINE_FIXED_DELTA_S);
            }

            const settledY = boxTransform.position.y;
            expect(
                Math.abs(settledY - BOX_ANALYTIC_REST_Y),
                `box settled at y=${settledY}, analytic rest ${BOX_ANALYTIC_REST_Y}`
            ).toBeLessThanOrEqual(PhysicsConstants.ALLOWED_PENETRATION);

            expect(boxProbe.enters, `box enters=${boxProbe.enters}`).toBe(1);
            expect(groundProbe.enters, `ground enters=${groundProbe.enters}`).toBe(1);
            expect(boxProbe.exits, `box exits=${boxProbe.exits}`).toBe(0);
            expect(groundProbe.exits, `ground exits=${groundProbe.exits}`).toBe(0);
            expect(boxProbe.stays).toBeGreaterThan(0);
            expect(Math.abs(boxRigidbody.velocity.y)).toBeLessThan(
                PhysicsConstants.LINEAR_SLEEP_TOLERANCE
            );
        } finally {
            kernel.lifecycle.dispose();
        }
    });

    it('BLOCKER-TRACK-E pin: a scene body spawned at rest is asleep after its first fixed step', () => {
        observedSolverDeltas.length = 0;
        const { kernel, boxRigidbody, bridgeWorld, advanceSteps } = createGateScene(null);

        try {
            advanceSteps(SPAWN_AT_REST_STEPS);

            const bodyManager = bridgeWorld?.getBodyManager();
            if (bodyManager === undefined) {
                throw new Error('bridge world exposes no body manager');
            }

            const bodyId = boxRigidbody.bodyId;
            expect(bridgeWorld?.gravity.y).toBeCloseTo(-9.81, 3);
            expect(ENGINE_FIXED_DELTA_MS).toBeGreaterThan(PhysicsConstants.SLEEP_TIME);
            expect(bodyManager.getInverseMass(bodyId)).toBeGreaterThan(0);
            expect(bodyManager.isEnabled(bodyId)).toBe(true);
            expect(bodyManager.isAwake(bodyId)).toBe(false);
            expect(bodyManager.getPosition(bodyId).y).toBe(BOX_START_Y);
            expect(bodyManager.getLinearVelocity(bodyId).y).toBe(0);
        } finally {
            kernel.lifecycle.dispose();
        }
    });
});
