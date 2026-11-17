import { describe, it, expect } from 'vitest';
import { createGameLoop } from '@axrone/game-loop';
import { ManualScheduler } from '../../../../tests/shared/test-harness';
import { createWasmPhysicsBridge3DSystems } from '../bridge';

interface SceneState {
    readonly sceneId: string;
}

type StepProbe = (
    deltaTime: number,
    velocityIterations?: number,
    positionIterations?: number
) => number;

const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const ENGINE_FIXED_DELTA_S = 1 / 60;
const GRAVITY_Y = -9.81;
const IRREGULAR_FRAME_SPACING_MS = [16.6667, 33.3333, 8.5, 41.2, 22.1, 5.3];

const createRealLoopHarness = async (options: {
    readonly frameSpacingMs: readonly number[];
    readonly fixedDeltaMs?: number;
}) => {
    const ecsWorld = { getAllActors: () => [] };
    const { bridge, system } = await createWasmPhysicsBridge3DSystems(ecsWorld as never, {
        worldConfig: { gravity: { y: GRAVITY_Y } },
    });

    const observedDeltas: number[] = [];
    const physicsWorld = bridge.physicsWorld;
    const solverStep: StepProbe = physicsWorld.step.bind(physicsWorld);
    const probeStep: StepProbe = (deltaTime, velocityIterations, positionIterations) => {
        observedDeltas.push(deltaTime);
        return solverStep(deltaTime, velocityIterations, positionIterations);
    };
    physicsWorld.step = probeStep;

    const scheduler = new ManualScheduler();
    let timestamp = 0;
    let frames = 0;

    const loop = createGameLoop<SceneState>({
        state: { sceneId: 'physics-bridge-3d-wasm-dt-contract' },
        scheduler: scheduler as never,
        fixedDelta: options.fixedDeltaMs,
        autoStart: false,
        systems: [system as never],
    });
    loop.start(0);

    const advanceFrames = (count: number): void => {
        for (let index = 0; index < count; index += 1) {
            timestamp += options.frameSpacingMs[frames % options.frameSpacingMs.length];
            frames += 1;
            scheduler.flush(timestamp);
        }
    };

    return { bridge, loop, observedDeltas, advanceFrames };
};

describe('WasmPhysicsBridge3D delta-time contract (shipped game loop)', () => {
    it('keeps the loop side of the seam on the documented millisecond fixedDelta', async () => {
        const { loop, advanceFrames, observedDeltas } = await createRealLoopHarness({
            frameSpacingMs: [ENGINE_FIXED_DELTA_MS],
        });

        expect(loop.fixedDelta).toBe(ENGINE_FIXED_DELTA_MS);

        advanceFrames(1);

        expect(observedDeltas).toHaveLength(1);

        loop.dispose();
    });

    it('hands the wasm solver a second-scale timestep for the engine default fixedDelta', async () => {
        const { loop, advanceFrames, observedDeltas } = await createRealLoopHarness({
            frameSpacingMs: [ENGINE_FIXED_DELTA_MS],
        });

        advanceFrames(5);

        expect(observedDeltas).toHaveLength(5);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime).toBe(ENGINE_FIXED_DELTA_S);
        }

        loop.dispose();
    });

    it('scales with a non-default millisecond fixedDelta instead of hardcoding one step size', async () => {
        const { loop, advanceFrames, observedDeltas } = await createRealLoopHarness({
            frameSpacingMs: [20],
            fixedDeltaMs: 20,
        });

        advanceFrames(3);

        expect(loop.fixedDelta).toBe(20);
        expect(observedDeltas).toHaveLength(3);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime).toBe(0.02);
        }

        loop.dispose();
    });

    it('keeps every fixed step on the seconds contract across an irregular frame cadence', async () => {
        const { loop, advanceFrames, observedDeltas } = await createRealLoopHarness({
            frameSpacingMs: IRREGULAR_FRAME_SPACING_MS,
        });

        advanceFrames(30);

        expect(observedDeltas.length).toBeGreaterThanOrEqual(20);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime).toBe(ENGINE_FIXED_DELTA_S);
        }

        loop.dispose();
    });
});
