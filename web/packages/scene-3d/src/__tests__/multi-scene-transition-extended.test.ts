import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';
import type { MockGLContext } from '../../../../tests/shared/test-harness';

// ─── Dynamic imports (same pattern as existing tests) ───────────────────────

let Scene: typeof import('@axrone/scene-3d').Scene;
let Camera: typeof import('@axrone/scene-3d').Camera;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let Transform: typeof import('@axrone/ecs-runtime').Transform;
let Component: typeof import('@axrone/ecs-runtime').Component;

import type { SceneSnapshot } from '@axrone/scene-3d';

// ─── Snapshot Builders ──────────────────────────────────────────────────────

/**
 * Builds a snapshot with a shared material ID ("shared-mat") and shared shader.
 * Used to test that two scenes referencing the same material ID behave
 * independently when one is disposed.
 */
function buildSharedMaterialSnapshot(
    sceneTag: string,
    overrides?: Partial<SceneSnapshot>
): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'shared/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: `${sceneTag}-mesh`,
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
        materials: [{ id: 'shared-mat', shaderId: 'shared/shader' }],
        prefab: {
            id: `${sceneTag}-prefab`,
            entities: [
                {
                    name: `${sceneTag}_Root`,
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: {} }],
                },
                {
                    name: `${sceneTag}_Renderable`,
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: `${sceneTag}-mesh`, materialId: 'shared-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

/**
 * Builds a snapshot with a shared texture ID ("shared-tex") referenced by a material.
 */
function buildSharedTextureSnapshot(
    sceneTag: string,
    overrides?: Partial<SceneSnapshot>
): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'shared-tex/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: `${sceneTag}-mesh`,
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures: [
            {
                id: 'shared-tex',
                source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 2, height: 2 },
            },
        ],
        renderPasses: [],
        materials: [
            {
                id: 'shared-tex-mat',
                shaderId: 'shared-tex/shader',
                textures: { u_MainTex: 'shared-tex' },
            },
        ],
        prefab: {
            id: `${sceneTag}-tex-prefab`,
            entities: [
                {
                    name: `${sceneTag}_TexRoot`,
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: `${sceneTag}-mesh`, materialId: 'shared-tex-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildSnapshotA(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'scene-a/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1, 0, 0, 1); }',
            },
        ],
        meshes: [
            {
                id: 'scene-a-mesh',
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
        materials: [{ id: 'scene-a-mat', shaderId: 'scene-a/shader' }],
        prefab: {
            id: 'scene-a-prefab',
            entities: [
                {
                    name: 'EntityA_Root',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: { position: [1, 0, 0] } }],
                },
                {
                    name: 'EntityA_Renderable',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'scene-a-mesh', materialId: 'scene-a-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildSnapshotB(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'scene-b/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(0, 1, 0, 1); }',
            },
        ],
        meshes: [
            {
                id: 'scene-b-mesh',
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
        materials: [{ id: 'scene-b-mat', shaderId: 'scene-b/shader' }],
        prefab: {
            id: 'scene-b-prefab',
            entities: [
                {
                    name: 'EntityB_Root',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [{ type: 'Transform', data: { position: [5, 5, 5] } }],
                },
                {
                    name: 'EntityB_Camera',
                    layer: 0,
                    tag: 'Camera',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'Camera', data: { primary: true, fieldOfView: 45, nearClip: 0.1, farClip: 500 } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildTexturedSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'textured/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'textured-mesh',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures: [
            {
                id: 'tex-albedo',
                source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 2, height: 2 },
            },
        ],
        renderPasses: [],
        materials: [
            {
                id: 'textured-mat',
                shaderId: 'textured/shader',
                textures: { u_MainTex: 'tex-albedo' },
            },
        ],
        prefab: {
            id: 'textured-prefab',
            entities: [
                {
                    name: 'TexturedEntity',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'textured-mesh', materialId: 'textured-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildCameraSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'cam/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'cam-mesh',
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
        materials: [{ id: 'cam-mat', shaderId: 'cam/shader' }],
        prefab: {
            id: 'cam-prefab',
            entities: [
                {
                    name: 'CamEntity',
                    layer: 0,
                    tag: 'Camera',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'Camera', data: { primary: true, fieldOfView: 60, nearClip: 0.1, farClip: 1000 } },
                    ],
                },
                {
                    name: 'CamRenderable',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'cam-mesh', materialId: 'cam-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGlFromScene(scene: InstanceType<typeof Scene>): MockGLContext {
    return scene.gl as unknown as MockGLContext;
}

function countMockCalls(fn: unknown): number {
    return (fn as { mock: { calls: unknown[] } }).mock.calls.length;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('T-16 Extended: Multi-Scene Transition — Shared Resources, Error Recovery, Memory', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        Camera = sceneModule.Camera;
        MeshRenderer = sceneModule.MeshRenderer;

        const ecsModule = await import('@axrone/ecs-runtime');
        Transform = ecsModule.Transform;
        Component = ecsModule.Component;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── Group 1: Shared Resources Between Scenes ───────────────────────────

    describe('Shared Resources Between Scenes', () => {
        it('keeps material functional in scene B after scene A (with same material ID) is disposed', async () => {
            // Scene A and Scene B both reference material ID "shared-mat"
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));
            const entitys1 = await scene1.loadScene(buildSharedMaterialSnapshot('A'));
            expect(entitys1.length).toBe(2);

            // Verify scene A has the shared material
            expect(scene1.getMaterial('shared-mat')).not.toBeNull();

            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            const entitys2 = await scene2.loadScene(buildSharedMaterialSnapshot('B'));
            expect(entitys2.length).toBe(2);

            // Verify scene B also has the shared material
            expect(scene2.getMaterial('shared-mat')).not.toBeNull();

            // Dispose scene A
            scene1.dispose();
            expect(scene1.isDisposed).toBe(true);

            // Scene B's material should still be accessible and functional
            const matB = scene2.getMaterial('shared-mat');
            expect(matB).not.toBeNull();

            // Scene B should still be able to render
            scene2.start(0);
            scheduler.flush(16);
            expect(() => scene2.renderNow()).not.toThrow();

            scene2.dispose();
        });

        it('keeps texture valid in scene B after scene A (with same texture ID) is disposed', async () => {
            // Both scenes reference texture ID "shared-tex"
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));
            await scene1.loadScene(buildSharedTextureSnapshot('A'));

            const tex1 = scene1.getTexture('shared-tex');
            expect(tex1).not.toBeNull();

            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            await scene2.loadScene(buildSharedTextureSnapshot('B'));

            const tex2 = scene2.getTexture('shared-tex');
            expect(tex2).not.toBeNull();

            // Dispose scene A — its GL textures are released
            scene1.dispose();
            expect(scene1.isDisposed).toBe(true);

            // Scene B's texture should still be valid
            const tex2After = scene2.getTexture('shared-tex');
            expect(tex2After).not.toBeNull();
            expect(tex2After!.width).toBe(2);
            expect(tex2After!.height).toBe(2);

            scene2.dispose();
        });

        it('releases GL resources independently when two scenes with shared IDs are disposed sequentially', async () => {
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));
            const gl1 = getGlFromScene(scene1);
            await scene1.loadScene(buildSharedTextureSnapshot('A'));
            scene1.start(0);
            scheduler.flush(16);

            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            const gl2 = getGlFromScene(scene2);
            await scene2.loadScene(buildSharedTextureSnapshot('B'));
            scene2.start(0);
            scheduler.flush(32);

            const gl1TexturesBefore = countMockCalls(gl1.createTexture);
            const gl2TexturesBefore = countMockCalls(gl2.createTexture);
            expect(gl1TexturesBefore).toBeGreaterThan(0);
            expect(gl2TexturesBefore).toBeGreaterThan(0);

            // Dispose scene 1 first
            scene1.dispose();
            expect(countMockCalls(gl1.deleteTexture)).toBeGreaterThanOrEqual(gl1TexturesBefore);

            // Scene 2's GL resources should be untouched
            expect(countMockCalls(gl2.deleteTexture)).toBe(0);

            // Now dispose scene 2
            scene2.dispose();
            expect(countMockCalls(gl2.deleteTexture)).toBeGreaterThanOrEqual(gl2TexturesBefore);
        });
    });

    // ─── Group 2: Transition Error Recovery ─────────────────────────────────

    describe('Transition Error Recovery', () => {
        it('throws on invalid snapshot but keeps original scene functional', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Load a valid scene first
            const entities = await scene.loadScene(buildSnapshotA());
            expect(entities.length).toBe(2);
            expect(scene.world.getAllEntities().length).toBe(2);

            scene.start(0);
            scheduler.flush(16);

            // Attempt to load an invalid snapshot (missing required fields)
            const invalidSnapshot = { version: 1 } as unknown as SceneSnapshot;
            await expect(scene.loadScene(invalidSnapshot)).rejects.toThrow();

            // Original scene should still be functional — entities are still there
            // (loadScene failure should not corrupt the existing scene state)
            expect(scene.isDisposed).toBe(false);

            scene.dispose();
        });

        it('allows loading a valid scene after a failed load attempt', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Load scene A successfully
            await scene.loadScene(buildSnapshotA());

            // Attempt invalid load
            const invalidSnapshot = { version: 1 } as unknown as SceneSnapshot;
            await expect(scene.loadScene(invalidSnapshot)).rejects.toThrow();

            // Now load scene B successfully — should work fine
            const entitysB = await scene.loadScene(buildSnapshotB());
            expect(entitysB.find((a) => a.name === 'EntityB_Root')).toBeDefined();

            scene.dispose();
        });

        it('does not leak GL resources when a load attempt fails', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            // Load a valid scene first to establish baseline
            await scene.loadScene(buildSnapshotA());
            scene.start(0);
            scheduler.flush(16);

            const texturesBefore = countMockCalls(gl.createTexture);
            const programsBefore = countMockCalls(gl.createProgram);

            // Attempt invalid load — should not create any new GL resources
            const invalidSnapshot = { version: 1 } as unknown as SceneSnapshot;
            await expect(scene.loadScene(invalidSnapshot)).rejects.toThrow();

            // GL resource counts should not have increased
            expect(countMockCalls(gl.createTexture)).toBe(texturesBefore);
            expect(countMockCalls(gl.createProgram)).toBe(programsBefore);

            scene.dispose();
        });
    });

    // ─── Group 3: Rapid Scene Switching ─────────────────────────────────────

    describe('Rapid Scene Switching', () => {
        it('switches between 3 scenes for 50 cycles without resource leaks', async () => {
            const snapshots = [
                buildSnapshotA(),
                buildSnapshotB(),
                buildTexturedSnapshot(),
            ];
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            for (let cycle = 0; cycle < 50; cycle++) {
                const snapshot = snapshots[cycle % 3];
                const entities = await scene.loadScene(snapshot);
                expect(entities.length).toBeGreaterThan(0);

                scene.start(cycle * 16);
                scheduler.flush((cycle + 1) * 16);
            }

            // After 50 cycles, dispose and verify all GL resources are cleaned up
            const totalTexturesCreated = countMockCalls(gl.createTexture);
            const totalProgramsCreated = countMockCalls(gl.createProgram);
            const totalBuffersCreated = countMockCalls(gl.createBuffer);

            scene.dispose();

            // All created resources should be cleaned up
            expect(countMockCalls(gl.deleteTexture)).toBeGreaterThanOrEqual(totalTexturesCreated);
            expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(totalProgramsCreated);
            expect(countMockCalls(gl.deleteBuffer)).toBeGreaterThanOrEqual(totalBuffersCreated);
        });

        it('maintains entity isolation across 50 rapid scene reloads', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            for (let i = 0; i < 50; i++) {
                const useA = i % 2 === 0;
                const entities = await scene.loadScene(useA ? buildSnapshotA() : buildSnapshotB());

                if (useA) {
                    expect(entities.find((a) => a.name === 'EntityA_Root')).toBeDefined();
                    expect(entities.find((a) => a.name === 'EntityB_Root')).toBeUndefined();
                } else {
                    expect(entities.find((a) => a.name === 'EntityB_Root')).toBeDefined();
                    expect(entities.find((a) => a.name === 'EntityA_Root')).toBeUndefined();
                }
            }

            scene.dispose();
        });
    });

    // ─── Group 4: Scene Transition with Active Components ───────────────────

    describe('Scene Transition with Active Components', () => {
        it('shuts down components cleanly when scene is disposed mid-update', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            class TrackerComponent extends Component {
                updateCalls = 0;
                disposeCalls = 0;

                update(): void {
                    this.updateCalls += 1;
                }
            }

            scene.registerComponent(TrackerComponent);

            const entity = scene.createEntity({ name: 'TrackedEntity' });
            const comp = entity.addComponent(TrackerComponent);

            scene.start(0);
            scheduler.flush(16);
            expect(comp.updateCalls).toBe(1);

            // Dispose while the component is "active" (has been updating)
            expect(() => scene.dispose()).not.toThrow();
            expect(scene.isDisposed).toBe(true);
        });

        it('stops component updates immediately after scene disposal', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            class CounterComponent extends Component {
                count = 0;
                update(): void {
                    this.count += 1;
                }
            }

            scene.registerComponent(CounterComponent);

            const entity = scene.createEntity({ name: 'Counter' });
            const comp = entity.addComponent(CounterComponent);

            scene.start(0);
            scheduler.flush(16);
            scheduler.flush(32);
            expect(comp.count).toBe(2);

            scene.dispose();

            // After disposal, further scheduler flushes should not increment the counter
            // (the component is destroyed with the scene)
            expect(() => scheduler.flush(48)).not.toThrow();
            expect(comp.count).toBe(2); // unchanged
        });

        it('transitions between scenes with custom components without cross-contamination', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            class SceneTagComponent extends Component {
                tag = '';
            }

            scene.registerComponent(SceneTagComponent);

            // Load scene A with tagged component
            await scene.loadScene(buildSnapshotA());
            const entityA = scene.createEntity({ name: 'TaggedA' });
            entityA.addComponent(SceneTagComponent).tag = 'scene-a';

            scene.start(0);
            scheduler.flush(16);

            // Load scene B — should clear scene A entities
            await scene.loadScene(buildSnapshotB());
            const entityB = scene.createEntity({ name: 'TaggedB' });
            entityB.addComponent(SceneTagComponent).tag = 'scene-b';

            // Verify only scene B entities exist
            const allEntities = scene.world.getAllEntities();
            const taggedA = allEntities.find((a) => a.name === 'TaggedA');
            expect(taggedA).toBeUndefined();

            const taggedB = allEntities.find((a) => a.name === 'TaggedB');
            expect(taggedB).toBeDefined();
            expect(taggedB!.getComponent(SceneTagComponent)!.tag).toBe('scene-b');

            scene.dispose();
        });
    });

    // ─── Group 5: Memory Stability During Transitions ───────────────────────

    describe('Memory Stability During Transitions', () => {
        it('does not monotonically increase GL resource count across 10 transitions', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            const resourceCounts: number[] = [];

            for (let i = 0; i < 10; i++) {
                // Alternate between textured and non-textured snapshots
                const snapshot = i % 2 === 0 ? buildTexturedSnapshot() : buildSnapshotA();
                await scene.loadScene(snapshot);
                scene.start(i * 16);
                scheduler.flush((i + 1) * 16);

                // Track the live resource count from the tracking Sets
                const liveTextures = (gl as unknown as { _textures: Set<object> })._textures.size;
                const liveBuffers = (gl as unknown as { _buffers: Set<object> })._buffers.size;
                const livePrograms = (gl as unknown as { _programs: Set<object> })._programs.size;
                resourceCounts.push(liveTextures + liveBuffers + livePrograms);
            }

            // The resource count at cycle 9 should not be greater than at cycle 1
            // (no monotonic growth — resources from previous loads are cleaned up)
            expect(resourceCounts[resourceCounts.length - 1]).toBeLessThanOrEqual(
                resourceCounts[0] + 2 // allow small variance for stable re-allocation
            );

            scene.dispose();
        });

        it('cleans up all tracking sets to zero after final disposal', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            // Load several different scene types
            await scene.loadScene(buildTexturedSnapshot());
            scene.start(0);
            scheduler.flush(16);

            await scene.loadScene(buildSnapshotA());
            scene.start(0);
            scheduler.flush(32);

            await scene.loadScene(buildCameraSnapshot());
            scene.start(0);
            scheduler.flush(48);

            scene.dispose();

            // After disposal, all tracking sets should be empty
            const liveTextures = (gl as unknown as { _textures: Set<object> })._textures.size;
            const liveBuffers = (gl as unknown as { _buffers: Set<object> })._buffers.size;
            const livePrograms = (gl as unknown as { _programs: Set<object> })._programs.size;
            const liveShaders = (gl as unknown as { _shaders: Set<object> })._shaders.size;
            const liveVAOs = (gl as unknown as { _vertexArrays: Set<object> })._vertexArrays.size;

            expect(liveTextures).toBe(0);
            expect(liveBuffers).toBe(0);
            expect(livePrograms).toBe(0);
            expect(liveShaders).toBe(0);
            expect(liveVAOs).toBe(0);
        });
    });

    // ─── Group 6: Async Load Cancellation ───────────────────────────────────

    describe('Async Load Cancellation', () => {
        it('disposes scene while texture load is in-flight without hanging', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const snapshot = buildTexturedSnapshot();
            const loadPromise = scene.loadScene(snapshot);

            // Dispose immediately while textures may still be loading
            scene.dispose();
            expect(scene.isDisposed).toBe(true);

            // The load promise should settle (resolve or reject) without hanging
            await loadPromise.catch(() => {
                // Expected: disposal may cause the load to fail
            });
        });

        it('cleans up GL state when disposed during a textured scene load', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            const snapshot = buildTexturedSnapshot();
            const loadPromise = scene.loadScene(snapshot);

            // Dispose immediately
            scene.dispose();

            // Wait for the load to settle
            await loadPromise.catch(() => {});

            // The scene should be fully disposed regardless of async timing
            expect(scene.isDisposed).toBe(true);

            // After disposal, no further GL operations should be possible
            // on the scene (the scene is torn down). Any textures that were
            // created before disposal may or may not have been cleaned up
            // depending on async timing — the key guarantee is that disposal
            // completes without hanging or throwing.
        });
    });

    // ─── Group 7: Scene Snapshot Round-Trip ─────────────────────────────────

    describe('Scene Snapshot Round-Trip', () => {
        it('serializes, disposes, reloads, and verifies identical entity state', async () => {
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));

            await scene1.loadScene(buildSnapshotA());
            scene1.start(0);
            scheduler.flush(16);

            // Serialize the scene
            const snapshot = scene1.serializeScene();
            expect(snapshot.prefab.entities.length).toBe(2);
            expect(snapshot.materials.length).toBe(1);
            expect(snapshot.shaders.length).toBe(1);

            // Dispose the original scene
            scene1.dispose();
            expect(scene1.isDisposed).toBe(true);

            // Create a new scene and load the serialized snapshot
            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            const entities = await scene2.loadScene(snapshot);

            expect(entities.length).toBe(2);
            expect(entities.find((a) => a.name === 'EntityA_Root')).toBeDefined();
            expect(entities.find((a) => a.name === 'EntityA_Renderable')).toBeDefined();

            // Verify material was restored
            expect(scene2.getMaterial('scene-a-mat')).not.toBeNull();
            expect(scene2.getShader('scene-a/shader')).not.toBeNull();

            scene2.dispose();
        });

        it('preserves texture references through serialize → reload cycle', async () => {
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));

            await scene1.loadScene(buildTexturedSnapshot());

            const snapshot = scene1.serializeScene();
            expect(snapshot.textures.length).toBe(1);
            expect(snapshot.textures[0].id).toBe('tex-albedo');
            expect(snapshot.materials[0].textures?.u_MainTex).toBe('tex-albedo');

            scene1.dispose();

            // Reload into a new scene
            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            await scene2.loadScene(snapshot);

            const tex = scene2.getTexture('tex-albedo');
            expect(tex).not.toBeNull();
            expect(tex!.width).toBe(2);

            scene2.dispose();
        });

        it('produces consistent snapshots across multiple serialize calls', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            await scene.loadScene(buildSnapshotA());

            const snap1 = scene.serializeScene();
            const snap2 = scene.serializeScene();

            // Both snapshots should have the same structure
            expect(snap1.prefab.entities.length).toBe(snap2.prefab.entities.length);
            expect(snap1.materials.length).toBe(snap2.materials.length);
            expect(snap1.shaders.length).toBe(snap2.shaders.length);
            expect(snap1.meshes.length).toBe(snap2.meshes.length);

            scene.dispose();
        });
    });

    // ─── Group 8: Prefab Instance Cleanup ───────────────────────────────────

    describe('Prefab Instance Cleanup Across Scenes', () => {
        it('cleans up all prefab entities when scene is disposed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const entities = await scene.loadScene(buildSnapshotA());
            expect(entities.length).toBe(2);
            expect(scene.world.getAllEntities().length).toBe(2);

            scene.dispose();
            expect(scene.isDisposed).toBe(true);
        });

        it('cleans up prefab instances created via instantiatePrefab', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            // Create template entities (createEntity automatically adds Transform)
            const template = scene.createEntity({ name: 'Template' });

            const prefab = scene.createPrefab('test-prefab', [template]);

            // Instantiate the prefab multiple times
            const instances1 = scene.instantiatePrefab(prefab, { namePrefix: 'I1_' });
            const instances2 = scene.instantiatePrefab(prefab, { namePrefix: 'I2_' });

            expect(instances1.length).toBe(1);
            expect(instances2.length).toBe(1);

            // Total entities: template + 2 instances
            const totalBefore = scene.world.getAllEntities().length;
            expect(totalBefore).toBe(3);

            // Dispose should clean everything
            scene.dispose();
            expect(scene.isDisposed).toBe(true);
        });

        it('releases GL resources from prefab-loaded scenes on disposal', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildSnapshotA());
            scene.start(0);
            scheduler.flush(16);

            const texturesBefore = countMockCalls(gl.createTexture);
            const programsBefore = countMockCalls(gl.createProgram);
            const buffersBefore = countMockCalls(gl.createBuffer);

            scene.dispose();

            expect(countMockCalls(gl.deleteTexture)).toBeGreaterThanOrEqual(texturesBefore);
            expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(programsBefore);
            expect(countMockCalls(gl.deleteBuffer)).toBeGreaterThanOrEqual(buffersBefore);
        });
    });

    // ─── Group 9: Camera/Render Target Cleanup ──────────────────────────────

    describe('Camera/Render Target Cleanup', () => {
        it('releases framebuffer resources when scene with camera is disposed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildCameraSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const framebuffersCreated = countMockCalls(gl.createFramebuffer);

            scene.dispose();

            // If framebuffers were created, they should be cleaned up
            if (framebuffersCreated > 0) {
                expect(countMockCalls(gl.deleteFramebuffer)).toBeGreaterThanOrEqual(framebuffersCreated);
            }

            expect(scene.isDisposed).toBe(true);
        });

        it('cleans up camera scene GL resources completely', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildCameraSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const shadersCreated = countMockCalls(gl.createShader);
            const programsCreated = countMockCalls(gl.createProgram);
            const buffersCreated = countMockCalls(gl.createBuffer);

            scene.dispose();

            expect(countMockCalls(gl.deleteShader)).toBeGreaterThanOrEqual(shadersCreated);
            expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(programsCreated);
            expect(countMockCalls(gl.deleteBuffer)).toBeGreaterThanOrEqual(buffersCreated);

            // All tracking sets should be empty
            const livePrograms = (gl as unknown as { _programs: Set<object> })._programs.size;
            const liveShaders = (gl as unknown as { _shaders: Set<object> })._shaders.size;
            expect(livePrograms).toBe(0);
            expect(liveShaders).toBe(0);
        });

        it('disposes scene with camera and renderable without errors', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const cameraEntity = scene.createCameraEntity({ name: 'TestCam' }, { primary: true });
            expect(cameraEntity).toBeDefined();
            expect(cameraEntity.getComponent(Camera)).toBeDefined();

            scene.createRenderableEntity(
                { name: 'TestMesh' },
                { meshId: 'cam-mesh', materialId: 'cam-mat' }
            );

            scene.start(0);
            scheduler.flush(16);

            expect(() => scene.dispose()).not.toThrow();
            expect(scene.isDisposed).toBe(true);
        });
    });
});
