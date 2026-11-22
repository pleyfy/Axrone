import { describe, it, expect, afterEach } from 'vitest';
import { createGameLoop } from '@axrone/game-loop';
import { PhysicsWorld2D, RigidbodyType2D } from '@axrone/physics-2d';
import { ManualScheduler } from '../../../../tests/shared/test-harness';
import { PhysicsBridge2D } from '../components/physics-bridge-2d';
import { SceneActorLifecycleRunner } from '../actor-lifecycle-runner';
import type { SceneLoopState } from '../types';

type StepProbe = (
    deltaTime: number,
    velocityIterations?: number,
    positionIterations?: number
) => void;

const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const ENGINE_FIXED_DELTA_S = 1 / 60;
const GRAVITY_Y = -9.81;
const SPAWN_Y = 10;
const ONE_SECOND_OF_STEPS = 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const IRREGULAR_FRAME_SPACING_MS = [16.6667, 33.3333, 8.5, 41.2, 22.1, 5.3];

const createFallingBody = (world: PhysicsWorld2D) => {
    const bodyManager = world.getBodyManager();
    const bodyId = bodyManager.createBody({
        type: RigidbodyType2D.Dynamic as never,
        position: { x: 0, y: SPAWN_Y },
        rotation: 0,
        linearVelocity: { x: 0, y: 0 },
        angularVelocity: 0,
        linearDamping: 0,
        angularDamping: 0,
        gravityScale: 1,
        fixedRotation: true,
        bullet: false,
        allowSleep: false,
        awake: true,
        enabled: true,
    });

    world.createCircleShape(bodyId, {
        center: { x: 0, y: 0 },
        radius: 0.5,
        material: { friction: 0.4, restitution: 0, density: 1 } as never,
        isSensor: false,
        filter: { categoryBits: 0x0001, maskBits: 0xffff, groupIndex: 0 },
    });

    return { bodyId, bodyManager };
};

const createShippedPathHarness = (frameSpacingMs: readonly number[] = IRREGULAR_FRAME_SPACING_MS) => {
    const bridge = new PhysicsBridge2D({ getAllActors: () => [] } as never, {
        worldConfig: { gravity: { x: 0, y: GRAVITY_Y } },
    });

    const world = bridge.physicsWorld;
    const observedDeltas: number[] = [];
    const solverStep: StepProbe = PhysicsWorld2D.prototype.step;
    PhysicsWorld2D.prototype.step = function (
        deltaTime: number,
        velocityIterations?: number,
        positionIterations?: number
    ): void {
        observedDeltas.push(deltaTime);
        solverStep.call(this, deltaTime, velocityIterations, positionIterations);
    };
    restoreSteps.push(() => {
        PhysicsWorld2D.prototype.step = solverStep;
    });

    const actors = [
        {
            active: true,
            isDestroyed: false,
            fixedUpdate: (deltaTime: number) => {
                world.step(deltaTime, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
            },
            update: () => {},
            lateUpdate: () => {},
        },
    ];

    const runner = new SceneActorLifecycleRunner({
        getActors: () => actors as never,
    });

    const scheduler = new ManualScheduler();
    let timestamp = 0;
    let frames = 0;

    const loop = createGameLoop<SceneLoopState>({
        state: { sceneId: 'physics-bridge-2d-dt-contract' },
        scheduler: scheduler as never,
        autoStart: false,
        systems: [
            {
                id: bridge.id,
                beforeUpdate: (context) => bridge.beforeUpdate(context),
                fixedUpdate: (context) => {
                    bridge.fixedUpdate(context);
                    runner.fixedUpdate(context.fixedDelta);
                },
                dispose: () => bridge.dispose(),
            },
        ],
    });
    loop.start(0);
    runningLoops.push(loop);

    const advanceFrames = (count: number): void => {
        for (let index = 0; index < count; index += 1) {
            timestamp += frameSpacingMs[frames % frameSpacingMs.length];
            frames += 1;
            scheduler.flush(timestamp);
        }
    };

    return { bridge, loop, observedDeltas, advanceFrames };
};

const secondsTrajectoryY = (steps: number): number => {
    const drop =
        -GRAVITY_Y * ENGINE_FIXED_DELTA_S * ENGINE_FIXED_DELTA_S * ((steps * (steps + 1)) / 2);
    return SPAWN_Y - drop;
};

const runningLoops: { dispose: () => void }[] = [];
const restoreSteps: (() => void)[] = [];

afterEach(() => {
    while (runningLoops.length > 0) {
        runningLoops.pop()?.dispose();
    }
    while (restoreSteps.length > 0) {
        restoreSteps.pop()?.();
    }
});

describe('PhysicsBridge2D delta-time contract (shipped game loop)', () => {
    it('mirrors the physics-2d world-component forward and shows the solver receives seconds', () => {
        const { loop, advanceFrames, observedDeltas } = createShippedPathHarness([
            ENGINE_FIXED_DELTA_MS,
        ]);

        advanceFrames(3);

        expect(observedDeltas).toHaveLength(3);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime, `2D solver received ${deltaTime}`).toBe(ENGINE_FIXED_DELTA_S);
        }

        loop.dispose();
    });

    it('does not step the 2D world from the bridge seam, so the bridge is not the conversion site', () => {
        const { bridge, loop, advanceFrames, observedDeltas } = createShippedPathHarness([
            ENGINE_FIXED_DELTA_MS,
        ]);

        advanceFrames(1);

        bridge.fixedUpdate({ fixedDelta: ENGINE_FIXED_DELTA_MS });

        expect(observedDeltas).toHaveLength(1);

        loop.dispose();
    });

    it('keeps a 2D free-fall body on the seconds trajectory through the shipped path', () => {
        const { bridge, loop, advanceFrames, observedDeltas } = createShippedPathHarness();

        const { bodyId, bodyManager } = createFallingBody(bridge.physicsWorld);

        advanceFrames(ONE_SECOND_OF_STEPS);

        const steps = observedDeltas.length;
        const actualY = bodyManager.getPosition(bodyId).y;
        const expectedY = secondsTrajectoryY(steps);

        expect(steps).toBeGreaterThanOrEqual(ONE_SECOND_OF_STEPS);
        expect(actualY, `2D body at y=${actualY}, seconds trajectory ${expectedY}`).toBeGreaterThan(
            expectedY - 0.25
        );
        expect(actualY).toBeLessThan(expectedY + 0.25);

        loop.dispose();
    });
});
