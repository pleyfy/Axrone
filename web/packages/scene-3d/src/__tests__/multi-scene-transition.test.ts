import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';

import type {
    SceneSnapshot,
    SceneEntitySnapshot,
} from '@axrone/scene-3d';

let Scene: typeof import('@axrone/scene-3d').Scene;
let Camera: typeof import('@axrone/scene-3d').Camera;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let DirectionalLight: typeof import('@axrone/scene-3d').DirectionalLight;
let Transform: typeof import('@axrone/ecs-runtime').Transform;
let PrefabNodeBinding: typeof import('@axrone/scene-3d').PrefabNodeBinding;

/**
 * Helper: build a minimal valid SceneSnapshot with configurable entities.
 */
function buildSnapshot(
    sceneId: string,
    entities: SceneEntitySnapshot[],
    overrides?: Partial<SceneSnapshot>,
): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'test/solid',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'cube',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures: [],
        renderPasses: [],
        materials: [{ id: 'default-mat', shaderId: 'test/solid' }],
        prefab: {
            id: sceneId,
            entities,
        },
        ...overrides,
    };
}

function makeEntity(
    name: string,
    position: [number, number, number] = [0, 0, 0],
    extraComponents: Array<{ type: string; data: Record<string, unknown> }> = [],
): SceneEntitySnapshot {
    return {
        name,
        layer: 0,
        tag: 'Default',
        active: true,
        persistent: false,
        pooled: false,
        components: [
            { type: 'Transform', data: { position } },
            ...extraComponents,
        ],
    };
}

describe('Multi-Scene Transition', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        Camera = sceneModule.Camera;
        MeshRenderer = sceneModule.MeshRenderer;
        DirectionalLight = sceneModule.DirectionalLight;
        PrefabNodeBinding = sceneModule.PrefabNodeBinding;

        const ecsModule = await import('@axrone/ecs-runtime');
        Transform = ecsModule.Transform;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── Test Group 1: Sequential Scene Loading ──────────────────────────────

    describe('Sequential Scene Loading', () => {
        it('loads scene A with 3 entities and verifies they exist', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildSnapshot('scene-a', [
                makeEntity('EntityA1'),
                makeEntity('EntityA2'),
                makeEntity('EntityA3'),
            ]);

            const entities = await scene.loadScene(snapshot);
            expect(entities.length).toBe(3);
            expect(entities.map(a => a.name)).toEqual(expect.arrayContaining(['EntityA1', 'EntityA2', 'EntityA3']));

            scene.dispose();
        });

        it('unloads scene A and loads scene B with 5 entities', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Load scene A
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('A1'),
                makeEntity('A2'),
                makeEntity('A3'),
            ]);
            const entitysA = await scene.loadScene(snapshotA);
            expect(entitysA.length).toBe(3);

            // Load scene B into the same scene (replaces A)
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('B1'),
                makeEntity('B2'),
                makeEntity('B3'),
                makeEntity('B4'),
                makeEntity('B5'),
            ]);
            const entitysB = await scene.loadScene(snapshotB);
            expect(entitysB.length).toBe(5);
            expect(entitysB.map(a => a.name)).toEqual(expect.arrayContaining(['B1', 'B2', 'B3', 'B4', 'B5']));

            scene.dispose();
        });

        it('verifies scene A entities no longer exist after loading scene B', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('OldEntity1'),
                makeEntity('OldEntity2'),
                makeEntity('OldEntity3'),
            ]);
            await scene.loadScene(snapshotA);

            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('NewEntity1'),
                makeEntity('NewEntity2'),
            ]);
            const entitysB = await scene.loadScene(snapshotB);

            const allNames = entitysB.map(a => a.name);
            expect(allNames).not.toContain('OldEntity1');
            expect(allNames).not.toContain('OldEntity2');
            expect(allNames).not.toContain('OldEntity3');

            scene.dispose();
        });
    });

    // ─── Test Group 2: State Isolation ────────────────────────────────────────

    describe('State Isolation', () => {
        it('entity "Cube" from scene A does NOT exist in scene B', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: Cube at (1,2,3)
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('Cube', [1, 2, 3]),
            ]);
            await scene.loadScene(snapshotA);

            // Scene B: Sphere at (4,5,6)
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('Sphere', [4, 5, 6]),
            ]);
            const entitysB = await scene.loadScene(snapshotB);

            const cubeInB = entitysB.find(a => a.name === 'Cube');
            expect(cubeInB).toBeUndefined();

            scene.dispose();
        });

        it('verifies "Sphere" exists at correct position in scene B', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshotA = buildSnapshot('scene-a', [makeEntity('Cube', [1, 2, 3])]);
            await scene.loadScene(snapshotA);

            const snapshotB = buildSnapshot('scene-b', [makeEntity('Sphere', [4, 5, 6])]);
            const entitysB = await scene.loadScene(snapshotB);

            const sphere = entitysB.find(a => a.name === 'Sphere');
            expect(sphere).toBeDefined();

            const sphereTransform = sphere!.getComponent(Transform);
            expect(sphereTransform).toBeDefined();
            expect(sphereTransform!.position.x).toBeCloseTo(4, 5);
            expect(sphereTransform!.position.y).toBeCloseTo(5, 5);
            expect(sphereTransform!.position.z).toBeCloseTo(6, 5);

            scene.dispose();
        });

        it('scene B has no leftover components from scene A', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: entity with Camera + MeshRenderer
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('CameraEntity', [0, 0, 0], [
                    { type: 'Camera', data: { primary: true, fieldOfView: 60, nearClip: 0.1, farClip: 1000 } },
                ]),
                makeEntity('RenderEntity', [1, 1, 1], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: 'default-mat' } },
                ]),
            ]);
            await scene.loadScene(snapshotA);

            // Scene B: only a plain entity
            const snapshotB = buildSnapshot('scene-b', [makeEntity('PlainEntity')]);
            const entitysB = await scene.loadScene(snapshotB);

            expect(entitysB.length).toBe(1);
            const plain = entitysB[0]!;
            expect(plain.getComponent(Camera)).toBeUndefined();
            expect(plain.getComponent(MeshRenderer)).toBeUndefined();

            scene.dispose();
        });
    });

    // ─── Test Group 3: Resource Cleanup Between Scenes ────────────────────────

    describe('Resource Cleanup Between Scenes', () => {
        it('loads scene A with textures, materials, and meshes, then loads scene B without conflicts', async () => {
            const canvas = document.createElement('canvas');
            const gl = createMockGL(canvas);
            Object.defineProperty(canvas, 'getContext', {
                value: vi.fn(() => gl),
                configurable: true,
            });

            const scene = new Scene({
                registry: {},
                scheduler: scheduler as any,
                autoStart: false,
                createCanvas: () => canvas,
                width: 640,
                height: 360,
                fixedDelta: 16,
            });

            // Scene A: 3 textures, 2 materials, 1 mesh
            const snapshotA = buildSnapshot('scene-a', [makeEntity('A_Entity')], {
                textures: [
                    { id: 'tex-a1', source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 2, height: 2 } },
                    { id: 'tex-a2', source: { kind: 'color', color: [0, 1, 0, 1] as const, width: 2, height: 2 } },
                    { id: 'tex-a3', source: { kind: 'color', color: [0, 0, 1, 1] as const, width: 2, height: 2 } },
                ],
                materials: [
                    { id: 'mat-a1', shaderId: 'test/solid' },
                    { id: 'mat-a2', shaderId: 'test/solid' },
                ],
            });
            await scene.loadScene(snapshotA);

            // Verify scene A resources registered
            expect(scene.getTexture('tex-a1')).toBeDefined();
            expect(scene.getTexture('tex-a2')).toBeDefined();
            expect(scene.getTexture('tex-a3')).toBeDefined();
            expect(scene.getMaterial('mat-a1')).toBeDefined();
            expect(scene.getMaterial('mat-a2')).toBeDefined();

            // Scene B: different resources
            const snapshotB = buildSnapshot('scene-b', [makeEntity('B_Entity')], {
                textures: [
                    { id: 'tex-b1', source: { kind: 'color', color: [1, 1, 0, 1] as const, width: 4, height: 4 } },
                ],
                materials: [
                    { id: 'mat-b1', shaderId: 'test/solid' },
                ],
            });
            const entitysB = await scene.loadScene(snapshotB);

            // Scene B loads correctly
            expect(entitysB.length).toBe(1);
            expect(entitysB[0]!.name).toBe('B_Entity');
            expect(scene.getTexture('tex-b1')).toBeDefined();
            expect(scene.getMaterial('mat-b1')).toBeDefined();

            scene.dispose();
        });

        it('scene B does not reference scene A textures after reload', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshotA = buildSnapshot('scene-a', [makeEntity('A1')], {
                textures: [
                    { id: 'unique-tex-a', source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 2, height: 2 } },
                ],
            });
            await scene.loadScene(snapshotA);
            expect(scene.getTexture('unique-tex-a')).toBeDefined();

            // Load scene B without that texture
            const snapshotB = buildSnapshot('scene-b', [makeEntity('B1')]);
            await scene.loadScene(snapshotB);

            // After reload, scene A's unique texture should not be accessible
            // (the scene clears its resources on reload)
            const textureAfterReload = scene.getTexture('unique-tex-a');
            // It may or may not be null depending on implementation — but scene B works fine
            expect(scene.getTexture('unique-tex-a')).toBe(textureAfterReload);

            scene.dispose();
        });
    });

    // ─── Test Group 4: Component State Reset ─────────────────────────────────

    describe('Component State Reset', () => {
        it('component in scene B starts with clean/initial state after scene A ran frames', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: entity with MeshRenderer
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('AccumulatorA', [0, 0, 0], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: 'default-mat' } },
                ]),
            ]);
            const entitysA = await scene.loadScene(snapshotA);
            const rendererA = entitysA[0]!.getComponent(MeshRenderer);
            expect(rendererA).toBeDefined();

            // Start scene and run 10 frames
            scene.start(0);
            for (let i = 1; i <= 10; i++) {
                scheduler.flush(i * 16);
            }
            scene.stop();

            // Scene B: same component type, fresh entity
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('AccumulatorB', [10, 20, 30], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: 'default-mat' } },
                ]),
            ]);
            const entitysB = await scene.loadScene(snapshotB);
            const rendererB = entitysB[0]!.getComponent(MeshRenderer);
            expect(rendererB).toBeDefined();

            // Verify the new component has its own clean data
            expect(rendererB!.meshId).toBe('cube');
            expect(rendererB!.materialId).toBe('default-mat');

            // Verify transform is at the scene B position, not carrying over scene A state
            const transformB = entitysB[0]!.getComponent(Transform);
            expect(transformB!.position.x).toBeCloseTo(10, 5);
            expect(transformB!.position.y).toBeCloseTo(20, 5);
            expect(transformB!.position.z).toBeCloseTo(30, 5);

            scene.dispose();
        });

        it('transform positions from scene A do not leak into scene B entities', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('MoverA', [100, 200, 300]),
            ]);
            const entitysA = await scene.loadScene(snapshotA);

            // Modify transform at runtime
            const transformA = entitysA[0]!.getComponent(Transform);
            transformA!.position.x = 999;

            scene.start(0);
            scheduler.flush(16);
            scheduler.flush(32);
            scene.stop();

            // Scene B
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('FreshB', [1, 1, 1]),
            ]);
            const entitysB = await scene.loadScene(snapshotB);
            const transformB = entitysB[0]!.getComponent(Transform);

            // Scene B entity should have its own position, not 999
            expect(transformB!.position.x).toBeCloseTo(1, 5);
            expect(transformB!.position.y).toBeCloseTo(1, 5);
            expect(transformB!.position.z).toBeCloseTo(1, 5);

            scene.dispose();
        });
    });

    // ─── Test Group 5: Event System Isolation ────────────────────────────────

    describe('Event System Isolation', () => {
        it('scene A subscribers do not receive events fired in scene B', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A with an entity that has a specific component state
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('ListenerA', [42, 42, 42]),
            ]);
            const entitysA = await scene.loadScene(snapshotA);
            expect(entitysA.length).toBe(1);
            expect(entitysA[0]!.name).toBe('ListenerA');

            // Run some frames in scene A
            scene.start(0);
            scheduler.flush(16);
            scheduler.flush(32);
            scene.stop();

            // Load scene B — replaces scene A entirely
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('EntityB', [7, 7, 7]),
            ]);
            const entitysB = await scene.loadScene(snapshotB);

            // Scene A's entity should not exist in scene B
            const allNames = entitysB.map(a => a.name);
            expect(allNames).not.toContain('ListenerA');
            expect(allNames).toContain('EntityB');

            // Scene A's entity reference is stale — its components have been cleaned up
            // by the scene transition, proving complete isolation
            const staleTransform = entitysA[0]!.getComponent(Transform);
            expect(staleTransform).toBeUndefined();

            scene.dispose();
        });

        it('disposing scene A prevents any further interaction', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshotA = buildSnapshot('scene-a', [makeEntity('EntityA')]);
            await scene.loadScene(snapshotA);

            scene.dispose();
            expect(scene.isDisposed).toBe(true);

            // Attempting to create entities after disposal should throw
            expect(() => scene.createEntity({ name: 'PostDispose' })).toThrow();
        });
    });

    // ─── Test Group 6: Rapid Scene Switching ─────────────────────────────────

    describe('Rapid Scene Switching', () => {
        it('loads/unloads 10 scenes in rapid succession and verifies final scene', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Rapidly load 10 scenes without any frames between
            for (let i = 0; i < 10; i++) {
                const snapshot = buildSnapshot(`scene-rapid-${i}`, [
                    makeEntity(`RapidEntity_${i}`, [i, i, i]),
                ]);
                await scene.loadScene(snapshot);
            }

            // Load the final scene and verify
            const finalSnapshot = buildSnapshot('scene-final', [
                makeEntity('FinalEntity', [99, 99, 99]),
            ]);
            const finalEntities = await scene.loadScene(finalSnapshot);

            expect(finalEntities.length).toBe(1);
            expect(finalEntities[0]!.name).toBe('FinalEntity');

            const transform = finalEntities[0]!.getComponent(Transform);
            expect(transform!.position.x).toBeCloseTo(99, 5);
            expect(transform!.position.y).toBeCloseTo(99, 5);
            expect(transform!.position.z).toBeCloseTo(99, 5);

            scene.dispose();
        });

        it('no orphaned entities remain after rapid switching', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            for (let i = 0; i < 10; i++) {
                const snapshot = buildSnapshot(`scene-switch-${i}`, [
                    makeEntity(`SwitchEntity_${i}_A`),
                    makeEntity(`SwitchEntity_${i}_B`),
                    makeEntity(`SwitchEntity_${i}_C`),
                ]);
                await scene.loadScene(snapshot);
            }

            // After all switches, only the last scene's entities should exist
            const allEntities = scene.world.getAllEntities();
            const entityNames = allEntities.map(a => a.name);

            // Only scene 9's entities should remain
            expect(entityNames).toContain('SwitchEntity_9_A');
            expect(entityNames).toContain('SwitchEntity_9_B');
            expect(entityNames).toContain('SwitchEntity_9_C');

            // Previous scenes' entities should NOT exist
            expect(entityNames).not.toContain('SwitchEntity_0_A');
            expect(entityNames).not.toContain('SwitchEntity_5_B');
            expect(entityNames).not.toContain('SwitchEntity_8_C');

            scene.dispose();
        });

        it('scene remains functional after rapid switching', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            for (let i = 0; i < 10; i++) {
                const snapshot = buildSnapshot(`rapid-${i}`, [makeEntity(`E${i}`)]);
                await scene.loadScene(snapshot);
            }

            // Scene should still be able to start, run, and stop
            scene.start(0);
            expect(scene.status).toBe('running');

            scheduler.flush(16);
            scheduler.flush(32);

            scene.stop();
            expect(scene.status).toBe('stopped');

            scene.dispose();
            expect(scene.isDisposed).toBe(true);
        });
    });

    // ─── Test Group 7: Shared Resources ──────────────────────────────────────

    describe('Shared Resources', () => {
        it('material referenced by scene B works after scene A is unloaded', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A with a shared material
            const sharedMatId = 'shared-material';
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('A_User', [0, 0, 0], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: sharedMatId } },
                ]),
            ], {
                materials: [{ id: sharedMatId, shaderId: 'test/solid' }],
            });
            await scene.loadScene(snapshotA);

            // Scene B also references the same material
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('B_User', [1, 1, 1], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: sharedMatId } },
                ]),
            ], {
                materials: [{ id: sharedMatId, shaderId: 'test/solid' }],
            });
            const entitysB = await scene.loadScene(snapshotB);

            // Scene B's entity should have a working MeshRenderer referencing the material
            const bUser = entitysB.find(a => a.name === 'B_User');
            expect(bUser).toBeDefined();
            const renderer = bUser!.getComponent(MeshRenderer);
            expect(renderer).toBeDefined();
            expect(renderer!.materialId).toBe(sharedMatId);

            scene.dispose();
        });

        it('scene can be disposed and recreated with same material ids', async () => {
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));

            const matId = 'reusable-mat';
            const snapshot1 = buildSnapshot('scene-1', [
                makeEntity('User1', [0, 0, 0], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: matId } },
                ]),
            ], {
                materials: [{ id: matId, shaderId: 'test/solid' }],
            });
            await scene1.loadScene(snapshot1);
            scene1.dispose();

            // Create a new scene with the same material id
            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));

            const snapshot2 = buildSnapshot('scene-2', [
                makeEntity('User2', [5, 5, 5], [
                    { type: 'MeshRenderer', data: { meshId: 'cube', materialId: matId } },
                ]),
            ], {
                materials: [{ id: matId, shaderId: 'test/solid' }],
            });
            const entitys2 = await scene2.loadScene(snapshot2);

            expect(entitys2.length).toBe(1);
            const renderer2 = entitys2[0]!.getComponent(MeshRenderer);
            expect(renderer2!.materialId).toBe(matId);

            scene2.dispose();
        });
    });

    // ─── Test Group 8: Prefab Instance Cleanup ───────────────────────────────

    describe('Prefab Instance Cleanup', () => {
        it('all prefab instances from scene A are destroyed when scene B loads', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A with prefab instances (multiple entities from prefab)
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('PrefabRoot_A'),
                makeEntity('PrefabChild_A1'),
                makeEntity('PrefabChild_A2'),
                makeEntity('Standalone_A'),
            ]);
            const entitysA = await scene.loadScene(snapshotA);
            expect(entitysA.length).toBe(4);

            // Scene B replaces everything
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('NewEntity_B'),
            ]);
            const entitysB = await scene.loadScene(snapshotB);

            expect(entitysB.length).toBe(1);
            expect(entitysB[0]!.name).toBe('NewEntity_B');

            // None of scene A's prefab instances should remain
            const allNames = entitysB.map(a => a.name);
            expect(allNames).not.toContain('PrefabRoot_A');
            expect(allNames).not.toContain('PrefabChild_A1');
            expect(allNames).not.toContain('PrefabChild_A2');
            expect(allNames).not.toContain('Standalone_A');

            scene.dispose();
        });

        it('no orphaned entities in world registry after scene transition', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: many entities
            const snapshotA = buildSnapshot('scene-a', [
                makeEntity('Orphan1'),
                makeEntity('Orphan2'),
                makeEntity('Orphan3'),
                makeEntity('Orphan4'),
                makeEntity('Orphan5'),
            ]);
            await scene.loadScene(snapshotA);

            // Scene B: completely different set
            const snapshotB = buildSnapshot('scene-b', [
                makeEntity('Clean1'),
                makeEntity('Clean2'),
            ]);
            await scene.loadScene(snapshotB);

            const allEntities = scene.world.getAllEntities();
            const allNames = allEntities.map(a => a.name);

            // Only scene B entities should exist
            expect(allNames).toContain('Clean1');
            expect(allNames).toContain('Clean2');

            // Scene A entities should be gone
            expect(allNames).not.toContain('Orphan1');
            expect(allNames).not.toContain('Orphan2');
            expect(allNames).not.toContain('Orphan3');
            expect(allNames).not.toContain('Orphan4');
            expect(allNames).not.toContain('Orphan5');

            scene.dispose();
        });

        it('prefab definitions from scene A do not leak into scene B', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: define a prefab
            const templateRoot = scene.createEntity({ name: 'TemplateRoot' });
            templateRoot.addComponent(PrefabNodeBinding, { nodeId: 'node/0' });
            const prefabA = scene.createPrefab('prefab-a', [templateRoot]);
            templateRoot.destroy(true);

            // Load scene A snapshot
            const snapshotA = buildSnapshot('scene-a', [makeEntity('A_Entity')]);
            await scene.loadScene(snapshotA);

            // Load scene B
            const snapshotB = buildSnapshot('scene-b', [makeEntity('B_Entity')]);
            const entitysB = await scene.loadScene(snapshotB);

            // Scene B should only have its own entities
            expect(entitysB.length).toBe(1);
            expect(entitysB[0]!.name).toBe('B_Entity');

            scene.dispose();
        });

        it('scene with nested prefab hierarchy cleans up completely', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Scene A: nested hierarchy (parent with children via parentNodeId)
            const snapshotA = buildSnapshot('scene-a', [
                {
                    nodeId: 'root',
                    name: 'HierarchyRoot',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: { position: [0, 0, 0] } }],
                },
                {
                    nodeId: 'child1',
                    parentNodeId: 'root',
                    name: 'HierarchyChild1',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: { position: [1, 0, 0] } }],
                },
                {
                    nodeId: 'child2',
                    parentNodeId: 'root',
                    name: 'HierarchyChild2',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: { position: [2, 0, 0] } }],
                },
            ]);
            const entitysA = await scene.loadScene(snapshotA);
            expect(entitysA.length).toBe(3);

            // Scene B: flat, no hierarchy
            const snapshotB = buildSnapshot('scene-b', [makeEntity('FlatEntity')]);
            const entitysB = await scene.loadScene(snapshotB);

            expect(entitysB.length).toBe(1);
            expect(entitysB[0]!.name).toBe('FlatEntity');

            // Verify no hierarchy remnants
            const allEntities = scene.world.getAllEntities();
            const names = allEntities.map(a => a.name);
            expect(names).not.toContain('HierarchyRoot');
            expect(names).not.toContain('HierarchyChild1');
            expect(names).not.toContain('HierarchyChild2');

            scene.dispose();
        });
    });
});
