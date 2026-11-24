import { describe, it, expect } from 'vitest';
import { createGameLoop } from '@axrone/game-loop';
import { BoxCollider3D, Rigidbody3D } from '@axrone/physics-3d';
import { ManualScheduler } from '../../../../tests/shared/test-harness';
import { PhysicsBridge3D } from '../components/physics-bridge-3d';
import type { SceneLoopState } from '../types';

interface Vector3Data {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

interface QuaternionData {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

interface TransformData {
    position: Vector3Data;
    rotation: QuaternionData;
    worldPosition: Vector3Data;
    worldRotation: QuaternionData;
    worldScale: Vector3Data;
    parent: null;
}

class MockEntity {
    active = true;
    isDestroyed = false;
    private readonly _components: object[] = [];

    addComponent(component: object): void {
        this._components.push(component);
    }

    getComponent<T extends object>(Ctor: new (...args: never[]) => T): T | undefined {
        return this._components.find((component) => component instanceof Ctor) as T | undefined;
    }

    getAllComponents(): object[] {
        return [...this._components];
    }
}

class MockEcsWorld {
    private readonly _entities: MockEntity[] = [];

    addEntity(entity: MockEntity): void {
        this._entities.push(entity);
    }

    getAllEntities(): MockEntity[] {
        return [...this._entities];
    }
}

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
const IRREGULAR_FRAME_SPACING_MS = [16.6667, 33.3333, 8.5, 41.2, 22.1, 5.3];

const createTransform = (position: Vector3Data): TransformData => {
    const transform: TransformData = {
        position: { ...position },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        worldPosition: { ...position },
        worldRotation: { x: 0, y: 0, z: 0, w: 1 },
        worldScale: { x: 1, y: 1, z: 1 },
        parent: null,
    };
    return new Proxy(transform, {
        set(target, property, value) {
            (target as unknown as Record<string, unknown>)[property as string] = value;
            if (property === 'position') target.worldPosition = { ...value };
            if (property === 'rotation') target.worldRotation = { ...value };
            return true;
        },
    });
};

const addFallingBox = (ecsWorld: MockEcsWorld, position: Vector3Data): Rigidbody3D => {
    const transform = createTransform(position);
    const entity = new MockEntity();

    const rigidbody = new Rigidbody3D();
    Object.defineProperty(rigidbody, 'transform', {
        get: () => transform,
        configurable: true,
    });
    rigidbody.mass = 1;
    entity.addComponent(rigidbody);

    const collider = new BoxCollider3D();
    Object.defineProperty(collider, 'transform', {
        get: () => transform,
        configurable: true,
    });
    collider.size = { x: 0.8, y: 0.8, z: 0.8 };
    entity.addComponent(collider);

    ecsWorld.addEntity(entity);
    return rigidbody;
};

const createRealLoopHarness = (options: {
    readonly frameSpacingMs: readonly number[];
    readonly fixedDeltaMs?: number;
}) => {
    const ecsWorld = new MockEcsWorld();
    const bridge = new PhysicsBridge3D(ecsWorld as never, {
        worldConfig: { gravity: { x: 0, y: GRAVITY_Y, z: 0 } },
    });

    const observedDeltas: number[] = [];
    const physicsWorld = bridge.physicsWorld;
    const solverStep: StepProbe = physicsWorld.step.bind(physicsWorld);
    const probeStep: StepProbe = (deltaTime, velocityIterations, positionIterations) => {
        observedDeltas.push(deltaTime);
        solverStep(deltaTime, velocityIterations, positionIterations);
    };
    physicsWorld.step = probeStep;

    const scheduler = new ManualScheduler();
    let timestamp = 0;
    let frames = 0;

    const loop = createGameLoop<SceneLoopState>({
        state: { sceneId: 'physics-bridge-3d-dt-contract' },
        scheduler: scheduler as never,
        fixedDelta: options.fixedDeltaMs,
        autoStart: false,
        systems: [
            {
                id: bridge.id,
                beforeUpdate: (context) => bridge.beforeUpdate(context),
                fixedUpdate: (context) => bridge.fixedUpdate(context),
                dispose: () => {
                    physicsWorld.step = solverStep;
                    bridge.dispose();
                },
            },
        ],
    });
    loop.start(0);

    const advanceFrames = (count: number): void => {
        for (let index = 0; index < count; index += 1) {
            timestamp += options.frameSpacingMs[frames % options.frameSpacingMs.length];
            frames += 1;
            scheduler.flush(timestamp);
        }
    };

    return { bridge, ecsWorld, loop, observedDeltas, advanceFrames };
};

describe('PhysicsBridge3D delta-time contract (shipped game loop)', () => {
    it('keeps the loop side of the seam on the documented millisecond fixedDelta', () => {
        const { loop, advanceFrames, observedDeltas } = createRealLoopHarness({
            frameSpacingMs: [ENGINE_FIXED_DELTA_MS],
        });

        expect(loop.fixedDelta).toBe(ENGINE_FIXED_DELTA_MS);

        advanceFrames(1);

        expect(observedDeltas).toHaveLength(1);

        loop.dispose();
    });

    it('converts the engine default millisecond fixedDelta into seconds for the solver', () => {
        const { ecsWorld, loop, advanceFrames, observedDeltas } = createRealLoopHarness({
            frameSpacingMs: [ENGINE_FIXED_DELTA_MS],
        });

        addFallingBox(ecsWorld, { x: 0, y: SPAWN_Y, z: 0 });

        advanceFrames(5);

        expect(observedDeltas).toHaveLength(5);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime).toBe(ENGINE_FIXED_DELTA_S);
        }

        loop.dispose();
    });

    it('scales with a non-default millisecond fixedDelta instead of hardcoding one step size', () => {
        const { loop, advanceFrames, observedDeltas } = createRealLoopHarness({
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

    it('integrates free fall at the seconds rate instead of tunnelling the world', () => {
        const { ecsWorld, loop, advanceFrames, observedDeltas } = createRealLoopHarness({
            frameSpacingMs: IRREGULAR_FRAME_SPACING_MS,
        });

        const rigidbody = addFallingBox(ecsWorld, { x: 0, y: SPAWN_Y, z: 0 });

        advanceFrames(ONE_SECOND_OF_STEPS);

        expect(observedDeltas.length).toBeGreaterThanOrEqual(ONE_SECOND_OF_STEPS);
        for (const deltaTime of observedDeltas) {
            expect(deltaTime).toBe(ENGINE_FIXED_DELTA_S);
        }

        const steps = observedDeltas.length;
        const expectedDrop =
            -GRAVITY_Y *
            ENGINE_FIXED_DELTA_S *
            ENGINE_FIXED_DELTA_S *
            ((steps * (steps + 1)) / 2);
        const expectedY = SPAWN_Y - expectedDrop;

        expect(rigidbody.position.y).toBeGreaterThan(expectedY - 0.25);
        expect(rigidbody.position.y).toBeLessThan(expectedY + 0.25);
        expect(rigidbody.velocity.y).toBeLessThan(0);
        expect(Math.abs(rigidbody.velocity.y)).toBeLessThan(expectedDrop * 2);

        loop.dispose();
    });
});
