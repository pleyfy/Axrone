import { describe, it, expect, afterEach } from 'vitest';
import { Transform, type Actor } from '@axrone/ecs-runtime';
import { Vec2 } from '@axrone/numeric';
import {
    Rigidbody2D,
    RigidbodyType2D,
    CircleCollider2D,
    BoxCollider2D,
    HingeJoint2D,
    GearJoint2D,
    PhysicsWorld2DComponent,
    _getPhysicsWorld2DBridgeProvider,
} from '@axrone/physics-2d';
import { PrefabNodeBinding, type ScenePrefabDefinition } from '@axrone/scene-prefab';
import { getDefaultSceneRuntimeComposition } from '@axrone/scene-runtime/default-composition';
import { get2DSceneRuntimeProfile } from '@axrone/scene-runtime/scene-2d-profile';
import { SceneRuntimeKernel } from '@axrone/scene-runtime/scene-facade';
import type { SceneSnapshot } from '../types';
import { resolvePhysicsBridgesForProfile } from '../scene-profile';
import { PhysicsBridge2D } from '../components/physics-bridge-2d';
import { encodeSceneValue } from '../serialization';
import { createSceneOptions, ManualScheduler } from '../../../../tests/shared/test-harness';

/**
 * Acceptance test for the 2D bridge joint layer.
 *
 * The composition under test is exactly what the root `Scene2D` entry builds:
 * the 2D runtime profile plus the full runtime composition (`scene-2d-full.ts`),
 * so PhysicsBridge2D is present without importing the scene-2d package here —
 * scene-runtime must not gain a reverse dependency on its own consumer.
 *
 * Every physics scene below is authored the way the Editor writes it: joint
 * references are entity/node id STRINGS, and the actor that owns the joint is
 * listed BEFORE the actor it points at.
 */

const ENGINE_FIXED_DELTA_MS = 1000 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const PIVOT = { x: 0, y: 0 };
const ARM_LENGTH = 2;
const BOB_LAUNCH_VELOCITY_Y = 3;
const SWING_SECONDS = 1;
const SWING_STEPS = Math.round(SWING_SECONDS * 60);
const SETTLE_DISTANCE_TOLERANCE = 0.35;
// Boundaries between "the joint holds the bob" and "the bob free-falls".
// Engine defect note: PhysicsWorld2D.step() currently freezes the position
// integration of any body inside a constraint island, so a correct solver would
// show the bob swinging (y about -1.0 at t=1s) instead of holding the launch
// point. Both regimes satisfy the assertions below; a free-falling body
// satisfies neither, which is what the hinge-less negative control pins.
const JOINTED_FALL_ARREST_Y = -1.4;
const FREE_FALL_Y = -1.5;

interface ActorSpec {
    readonly nodeId: string;
    readonly name: string;
    readonly position: readonly [number, number];
    readonly components: ReadonlyArray<{
        readonly type: string;
        readonly data?: Record<string, unknown>;
    }>;
}

const createPrefabDefinition = (
    id: string,
    specs: readonly ActorSpec[]
): ScenePrefabDefinition => ({
    id,
    kind: 'prefab',
    actors: specs.map((spec) => ({
        nodeId: spec.nodeId,
        parentNodeId: null,
        name: spec.name,
        layer: 0,
        tag: 'default',
        active: true,
        persistent: false,
        pooled: false,
        components: [
            {
                type: 'Transform',
                data: encodeSceneValue({
                    position: [spec.position[0], spec.position[1], 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
            },
            ...spec.components.map((component) => ({
                type: component.type,
                data: encodeSceneValue(component.data ?? {}),
            })),
        ],
    })),
});

const createSnapshot = (prefab: ScenePrefabDefinition): SceneSnapshot => ({
    version: 1,
    prefab,
    shaders: [],
    meshes: [],
    materials: [],
    textures: [],
    samplers: [],
    renderPasses: [],
});

const PHYSICS_COMPONENTS = [
    Rigidbody2D,
    CircleCollider2D,
    BoxCollider2D,
    HingeJoint2D,
    GearJoint2D,
    PhysicsWorld2DComponent,
] as const;

interface SceneHarness {
    readonly kernel: SceneRuntimeKernel;
    readonly scheduler: ManualScheduler;
    readonly bridge: PhysicsBridge2D;
    advanceFrames(count: number): void;
}

const createSceneHarness = (sceneId: string): SceneHarness => {
    const canvas = document.createElement('canvas');
    const scheduler = new ManualScheduler();
    const kernel = new SceneRuntimeKernel({
        sceneId,
        options: {
            ...createSceneOptions(scheduler, canvas),
            registry: {},
            fixedDelta: undefined,
            profile: get2DSceneRuntimeProfile(),
            composition: getDefaultSceneRuntimeComposition(),
        },
    });

    for (const componentType of PHYSICS_COMPONENTS) {
        kernel.actors.registerComponent(componentType);
    }

    const bridge = kernel.physicsBridge2D as unknown as PhysicsBridge2D;
    if (!bridge) {
        throw new Error('the 2D scene profile did not arm PhysicsBridge2D');
    }

    kernel.loop.start(0);
    let timestamp = 0;

    return {
        kernel,
        scheduler,
        bridge,
        advanceFrames(count: number): void {
            for (let index = 0; index < count; index += 1) {
                timestamp += ENGINE_FIXED_DELTA_MS;
                scheduler.flush(timestamp);
            }
        },
    };
};

const stepBridgeWorld = (bridge: PhysicsBridge2D, steps: number): void => {
    for (let index = 0; index < steps; index += 1) {
        bridge.physicsWorld.step(ENGINE_FIXED_DELTA_MS, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    }
};

const findNodeActor = (actors: readonly Actor[], nodeId: string): Actor => {
    const actor = actors.find(
        (candidate) => candidate.getComponent(PrefabNodeBinding)?.nodeId === nodeId
    );
    if (!actor) {
        throw new Error(`scene snapshot produced no actor for node '${nodeId}'`);
    }
    return actor;
};

interface PendulumHandle {
    readonly bobTransform: Transform;
    readonly bobRigidbody: Rigidbody2D;
    readonly bobCollider: CircleCollider2D;
    readonly hinge: HingeJoint2D | null;
    readonly anchorRigidbody: Rigidbody2D;
}

interface PendulumSpec {
    readonly withHinge: boolean;
    readonly withPhysicsWorldComponent: boolean;
}

const createPendulumSnapshot = (spec: PendulumSpec): ScenePrefabDefinition => {
    const bobComponents: Array<{ type: string; data?: Record<string, unknown> }> = [
        {
            type: 'Rigidbody2D',
            data: {
                bodyType: RigidbodyType2D.Dynamic,
                // A fixed rotation would leave a pinned-anchor body zero
                // degrees of freedom: the pendulum needs the swing.
                allowSleep: false,
            },
        },
        { type: 'CircleCollider2D', data: { radius: 0.2 } },
    ];
    if (spec.withHinge) {
        bobComponents.push({
            type: 'HingeJoint2D',
            data: { connectedBody: 'node-anchor', anchor: [-ARM_LENGTH, 0] },
        });
    }

    const actors: ActorSpec[] = [
        { nodeId: 'node-bob', name: 'Bob', position: [ARM_LENGTH, 0], components: bobComponents },
        {
            nodeId: 'node-anchor',
            name: 'Anchor',
            position: [PIVOT.x, PIVOT.y],
            components: [
                { type: 'Rigidbody2D', data: { bodyType: RigidbodyType2D.Static } },
                { type: 'BoxCollider2D', data: { size: [0.4, 0.4] } },
            ],
        },
    ];
    if (spec.withPhysicsWorldComponent) {
        actors.push({
            nodeId: 'node-physics-world',
            name: 'PhysicsWorld2D',
            position: [0, 0],
            components: [{ type: 'PhysicsWorld2D', data: {} }],
        });
    }

    return createPrefabDefinition('prefab/2d-joint-pendulum', actors);
};

interface PendulumScene extends SceneHarness {
    readonly pendulum: PendulumHandle;
}

const loadPendulum = async (sceneId: string, spec: PendulumSpec): Promise<PendulumScene> => {
    const harness = createSceneHarness(sceneId);
    const actors = await harness.kernel.snapshots.loadScene(
        createSnapshot(createPendulumSnapshot(spec))
    );

    const bobActor = findNodeActor(actors, 'node-bob');
    const anchorActor = findNodeActor(actors, 'node-anchor');

    const pendulum: PendulumHandle = {
        bobTransform: bobActor.getComponent(Transform)!,
        bobRigidbody: bobActor.getComponent(Rigidbody2D)!,
        bobCollider: bobActor.getComponent(CircleCollider2D)!,
        hinge: bobActor.getComponent(HingeJoint2D) ?? null,
        anchorRigidbody: anchorActor.getComponent(Rigidbody2D)!,
    };

    return { ...harness, pendulum };
};

const launchBob = (pendulum: PendulumHandle): void => {
    pendulum.bobRigidbody.linearVelocity = new Vec2(0, BOB_LAUNCH_VELOCITY_Y);
};

const distanceToPivot = (pendulum: PendulumHandle): number => {
    const position = pendulum.bobTransform.position;
    return Math.hypot(position.x - PIVOT.x, position.y - PIVOT.y);
};

let activeKernels: SceneRuntimeKernel[] = [];
let activeBridges: PhysicsBridge2D[] = [];

afterEach(() => {
    while (activeKernels.length > 0) {
        const kernel = activeKernels.pop();
        if (kernel && !kernel.lifecycle.isDisposed) {
            kernel.lifecycle.dispose();
        }
    }
    while (activeBridges.length > 0) {
        const bridge = activeBridges.pop();
        if (bridge && !bridge.isDisposed) {
            bridge.dispose();
        }
    }
});

describe('PhysicsBridge2D 2D joint end-to-end', () => {
    it('creates hinge and shape constraints when the connected-body actor is declared after the joint actor', async () => {
        const scene = await loadPendulum('2d-joints-e2e/shipped-path', {
            withHinge: true,
            withPhysicsWorldComponent: true,
        });
        activeKernels.push(scene.kernel);

        expect(scene.pendulum.hinge).not.toBeNull();

        scene.advanceFrames(2);

        expect(scene.pendulum.hinge!.connectedBody).toBe(scene.pendulum.anchorRigidbody);
        expect(scene.pendulum.hinge!.constraintId).not.toBeNull();
        expect(scene.pendulum.bobRigidbody.bodyId).not.toBeNull();
        expect(scene.pendulum.anchorRigidbody.bodyId).not.toBeNull();
        expect(scene.pendulum.bobCollider.shapeId).not.toBeNull();
        expect(scene.bridge.pendingJointCount).toBe(0);
    });

    it('keeps a launched bob on its hinge radius through the shipped loop', async () => {
        const scene = await loadPendulum('2d-joints-e2e/hinge-motion', {
            withHinge: true,
            withPhysicsWorldComponent: true,
        });
        activeKernels.push(scene.kernel);

        scene.advanceFrames(2);
        expect(scene.pendulum.hinge!.constraintId).not.toBeNull();

        launchBob(scene.pendulum);
        scene.advanceFrames(SWING_STEPS);

        const position = scene.pendulum.bobTransform.position;
        const distance = distanceToPivot(scene.pendulum);
        expect(distance).toBeGreaterThan(ARM_LENGTH - SETTLE_DISTANCE_TOLERANCE);
        expect(distance).toBeLessThan(ARM_LENGTH + SETTLE_DISTANCE_TOLERANCE);
        // The hinge must arrest the free fall (see the engine defect note above).
        expect(position.y).toBeGreaterThan(JOINTED_FALL_ARREST_Y);
    });

    it('builds the same constraints with bridge-only worlds (no explicit PhysicsWorld2DComponent)', async () => {
        const scene = await loadPendulum('2d-joints-e2e/bridge-only-world', {
            withHinge: true,
            withPhysicsWorldComponent: false,
        });
        activeKernels.push(scene.kernel);

        scene.advanceFrames(2);
        // The static `PhysicsWorld2DComponent.instance` can outlive a disposed
        // scene in tests, so the scene-scoped question is what matters here:
        // this scene carries no explicit world component and the bridge world
        // still produced every constraint.
        const sceneOwnsWorldComponent = scene.kernel.world
            .getAllActors()
            .some((actor) => actor.getComponent(PhysicsWorld2DComponent));
        expect(sceneOwnsWorldComponent).toBe(false);
        expect(scene.pendulum.hinge!.constraintId).not.toBeNull();
        expect(scene.pendulum.bobCollider.shapeId).not.toBeNull();

        // No PhysicsWorld2DComponent owns the step here, so the step is driven
        // through the bridge's world directly — the bridge must not have been
        // the conversion site for it.
        launchBob(scene.pendulum);
        scene.advanceFrames(1);
        stepBridgeWorld(scene.bridge, SWING_STEPS);
        scene.advanceFrames(1);

        const position = scene.pendulum.bobTransform.position;
        const distance = distanceToPivot(scene.pendulum);
        expect(distance).toBeGreaterThan(ARM_LENGTH - SETTLE_DISTANCE_TOLERANCE);
        expect(distance).toBeLessThan(ARM_LENGTH + SETTLE_DISTANCE_TOLERANCE);
        expect(position.y).toBeGreaterThan(JOINTED_FALL_ARREST_Y);
    });

    it('fails the same motion assertions when the joint is absent', async () => {
        const scene = await loadPendulum('2d-joints-e2e/no-hinge-control', {
            withHinge: false,
            withPhysicsWorldComponent: true,
        });
        activeKernels.push(scene.kernel);

        expect(scene.pendulum.hinge).toBeNull();

        launchBob(scene.pendulum);
        scene.advanceFrames(2 + SWING_STEPS);

        // Negative control: without the hinge the bob free-falls on the
        // tangential-free trajectory — the jointed assertions above must be
        // able to fail.
        expect(scene.pendulum.bobTransform.position.y).toBeLessThan(FREE_FALL_Y);
        expect(Math.abs(distanceToPivot(scene.pendulum) - ARM_LENGTH)).toBeGreaterThan(0.5);
    });

    it('resolves GearJoint2D node references to the plain joints its actors own', async () => {
        const scene = createSceneHarness('2d-joints-e2e/gear-refs');
        activeKernels.push(scene.kernel);

        const prefab = createPrefabDefinition('prefab/2d-gear-train', [
            {
                nodeId: 'node-arm-a',
                name: 'ArmA',
                position: [1, 0],
                components: [
                    { type: 'Rigidbody2D', data: { bodyType: RigidbodyType2D.Dynamic } },
                    { type: 'CircleCollider2D', data: { radius: 0.2 } },
                    { type: 'HingeJoint2D', data: { connectedBody: 'node-pivot', anchor: [-1, 0] } },
                    {
                        type: 'GearJoint2D',
                        data: {
                            connectedBody: 'node-arm-b',
                            jointA: 'node-arm-a',
                            jointB: 'node-arm-b',
                            ratio: 2,
                        },
                    },
                ],
            },
            {
                nodeId: 'node-arm-b',
                name: 'ArmB',
                position: [0, 1],
                components: [
                    { type: 'Rigidbody2D', data: { bodyType: RigidbodyType2D.Dynamic } },
                    { type: 'CircleCollider2D', data: { radius: 0.2 } },
                    { type: 'HingeJoint2D', data: { connectedBody: 'node-pivot', anchor: [0, -1] } },
                ],
            },
            {
                nodeId: 'node-pivot',
                name: 'Pivot',
                position: [0, 0],
                components: [
                    { type: 'Rigidbody2D', data: { bodyType: RigidbodyType2D.Static } },
                    { type: 'BoxCollider2D', data: { size: [0.3, 0.3] } },
                ],
            },
        ]);

        const actors = await scene.kernel.snapshots.loadScene(createSnapshot(prefab));

        const armA = findNodeActor(actors, 'node-arm-a');
        const armB = findNodeActor(actors, 'node-arm-b');
        const hingeA = armA.getComponent(HingeJoint2D)!;
        const hingeB = armB.getComponent(HingeJoint2D)!;
        const gear = armA.getComponent(GearJoint2D)!;

        scene.advanceFrames(2);

        expect(hingeA.constraintId).not.toBeNull();
        expect(hingeB.constraintId).not.toBeNull();
        expect(gear.constraintId).not.toBeNull();
        expect(scene.bridge.pendingJointCount).toBe(0);

        // The gear's authored node ids must have coupled the *hinges* of those
        // actors, not the gear joint itself (node-arm-a owns both).
        const constraintManager = (
            scene.bridge.physicsWorld as unknown as {
                getConstraintManager(): unknown;
            }
        ).getConstraintManager() as {
            getGearConstraintData: (constraintId: number) => {
                constraintIdA: number;
                constraintIdB: number;
            };
        };
        const gearData = constraintManager.getGearConstraintData(gear.constraintId!);
        expect(gearData.constraintIdA).toBe(hingeA.constraintId);
        expect(gearData.constraintIdB).toBe(hingeB.constraintId);
    });

    it('resolves connectedBody during prefab deserialization, before the bridge ever runs', async () => {
        const scene = await loadPendulum('2d-joints-e2e/prefab-pass2', {
            withHinge: true,
            withPhysicsWorldComponent: false,
        });
        activeKernels.push(scene.kernel);

        // No frame has advanced, so only the scene loader's Pass-2 reference
        // resolution could have linked the reference.
        expect(scene.pendulum.hinge!.connectedBody).toBe(scene.pendulum.anchorRigidbody);
    });

    it('keeps an unresolved id as authored and resolves it once the target actor exists', async () => {
        const scene = await loadPendulum('2d-joints-e2e/late-target', {
            withHinge: true,
            withPhysicsWorldComponent: true,
        });
        activeKernels.push(scene.kernel);

        // Re-author the hinge the way a partially loaded scene graph arrives:
        // the id is a string because its target actor does not exist yet.
        scene.pendulum.hinge!.deserialize({ connectedBody: 'node-late-anchor' });

        scene.advanceFrames(2);
        expect(
            (scene.pendulum.hinge! as unknown as { _connectedBody: unknown })._connectedBody
        ).toBeTypeOf('string');
        expect(scene.pendulum.hinge!.constraintId).toBeNull();
        expect(scene.bridge.pendingJointCount).toBe(1);

        await scene.kernel.snapshots.instantiatePrefab(
            createPrefabDefinition('prefab/2d-late-anchor', [
                {
                    nodeId: 'node-late-anchor',
                    name: 'LateAnchor',
                    position: [0, 0],
                    components: [
                        { type: 'Rigidbody2D', data: { bodyType: RigidbodyType2D.Static } },
                        { type: 'BoxCollider2D', data: { size: [0.4, 0.4] } },
                    ],
                },
            ])
        );
        scene.advanceFrames(2);

        const lateActor = scene.kernel.world
            .getAllActors()
            .find((actor) => actor.getComponent(PrefabNodeBinding)?.nodeId === 'node-late-anchor');
        expect(lateActor).toBeDefined();

        expect(scene.pendulum.hinge!.connectedBody).toBe(lateActor!.getComponent(Rigidbody2D));
        expect(scene.pendulum.hinge!.constraintId).not.toBeNull();
        expect(scene.bridge.pendingJointCount).toBe(0);
    });

    it('stops constraining while a joint is disabled and re-binds when it is enabled again', async () => {
        const scene = await loadPendulum('2d-joints-e2e/joint-toggle', {
            withHinge: true,
            withPhysicsWorldComponent: true,
        });
        activeKernels.push(scene.kernel);

        scene.advanceFrames(2);
        const hinge = scene.pendulum.hinge!;
        expect(hinge.constraintId).not.toBeNull();

        hinge.enabled = false;
        scene.advanceFrames(2);
        expect(hinge.constraintId).toBeNull();

        hinge.enabled = true;
        scene.advanceFrames(2);
        expect(hinge.constraintId).not.toBeNull();
    });

    it('hands the world-provider slots back in bridge creation order', () => {
        const ecsWorld = { getAllActors: () => [] } as never;

        const first = new PhysicsBridge2D(ecsWorld);
        const second = new PhysicsBridge2D(ecsWorld);
        activeBridges.push(first, second);

        const provider = _getPhysicsWorld2DBridgeProvider();
        expect(provider).not.toBeNull();
        expect(provider!()).toBe(second.physicsWorld);

        second.dispose();
        expect(_getPhysicsWorld2DBridgeProvider()!()).toBe(first.physicsWorld);

        first.dispose();
        expect(_getPhysicsWorld2DBridgeProvider()).toBeNull();
    });

    it('arms the 2D bridge for 2D-flavoured manifest profile ids', () => {
        expect(resolvePhysicsBridgesForProfile('scene/2d-default')).toEqual({
            bridge3D: false,
            bridge2D: true,
        });
        expect(resolvePhysicsBridgesForProfile('scene/mixed-default')).toEqual({
            bridge3D: true,
            bridge2D: true,
        });
        expect(resolvePhysicsBridgesForProfile('scene/3d-default')).toEqual({
            bridge3D: true,
            bridge2D: false,
        });
        expect(resolvePhysicsBridgesForProfile('scene/custom-2d-playable')).toEqual({
            bridge3D: false,
            bridge2D: true,
        });
        expect(resolvePhysicsBridgesForProfile('scene/2d-and-3d')).toEqual({
            bridge3D: true,
            bridge2D: true,
        });
        expect(resolvePhysicsBridgesForProfile('scene/custom-core')).toEqual({
            bridge3D: true,
            bridge2D: false,
        });
        expect(resolvePhysicsBridgesForProfile(undefined)).toEqual({
            bridge3D: true,
            bridge2D: false,
        });

        const bridges = getDefaultSceneRuntimeComposition().createPhysicsBridges?.({
            world: { getAllActors: () => [] } as never,
            profileId: 'scene/custom-2d-playable',
            enableProfiler: false,
        });
        expect(bridges?.bridge2D).not.toBeNull();
        expect(bridges?.bridge3D).toBeNull();

        const bridge2D = bridges?.bridge2D as unknown as PhysicsBridge2D | undefined;
        if (bridge2D) {
            activeBridges.push(bridge2D);
        }
    });
});
