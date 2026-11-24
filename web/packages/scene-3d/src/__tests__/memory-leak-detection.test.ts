import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';
import type { MockGLContext } from '../../../../tests/shared/test-harness';

// ─── Dynamic imports ─────────────────────────────────────────────────────────

let Scene: typeof import('@axrone/scene-3d').Scene;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let Transform: typeof import('@axrone/ecs-runtime').Transform;
let Component: typeof import('@axrone/ecs-runtime').Component;

import type { SceneSnapshot } from '@axrone/scene-3d';

// ─── Snapshot Builders ──────────────────────────────────────────────────────

function buildMeshSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'mem/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'mem-mesh',
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
        materials: [{ id: 'mem-mat', shaderId: 'mem/shader' }],
        prefab: {
            id: 'mem-prefab',
            entities: [
                {
                    name: 'MeshEntity',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'mem-mesh', materialId: 'mem-mat' } },
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
                id: 'mem/tex-shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = texture2D(u_MainTex, v_UV); }',
            },
        ],
        meshes: [
            {
                id: 'mem-tex-mesh',
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
                id: 'mem-albedo',
                source: { kind: 'color', color: [1, 0, 0, 1] as const, width: 4, height: 4 },
            },
            {
                id: 'mem-normal',
                source: { kind: 'color', color: [0.5, 0.5, 1, 1] as const, width: 4, height: 4 },
            },
        ],
        renderPasses: [],
        materials: [
            {
                id: 'mem-tex-mat',
                shaderId: 'mem/tex-shader',
                textures: { u_MainTex: 'mem-albedo' },
            },
        ],
        prefab: {
            id: 'mem-tex-prefab',
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
                        { type: 'MeshRenderer', data: { meshId: 'mem-tex-mesh', materialId: 'mem-tex-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildRttSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'mem/rtt-shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'mem-rtt-mesh',
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
                id: 'mem-rtt-tex',
                source: { kind: 'color', color: [0, 1, 0, 1] as const, width: 256, height: 256 },
            },
        ],
        renderPasses: [
            {
                id: 'rtt-pass',
                target: { kind: 'texture', textureId: 'mem-rtt-tex' },
            },
        ],
        materials: [{ id: 'mem-rtt-mat', shaderId: 'mem/rtt-shader' }],
        prefab: {
            id: 'mem-rtt-prefab',
            entities: [
                {
                    name: 'RttEntity',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'mem-rtt-mesh', materialId: 'mem-rtt-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildSnapshotA(): SceneSnapshot {
    return buildMeshSnapshot({
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
        materials: [{ id: 'scene-a-mat', shaderId: 'scene-a/shader' }],
        prefab: {
            id: 'scene-a-prefab',
            entities: [
                {
                    name: 'EntityA',
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
    });
}

function buildSnapshotB(): SceneSnapshot {
    return buildMeshSnapshot({
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
        materials: [{ id: 'scene-b-mat', shaderId: 'scene-b/shader' }],
        prefab: {
            id: 'scene-b-prefab',
            entities: [
                {
                    name: 'EntityB',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'scene-b-mesh', materialId: 'scene-b-mat' } },
                    ],
                },
            ],
        },
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGlFromScene(scene: InstanceType<typeof Scene>): MockGLContext {
    return scene.gl as unknown as MockGLContext;
}

function countMockCalls(fn: unknown): number {
    return (fn as { mock: { calls: unknown[] } }).mock.calls.length;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Memory Leak Detection Suite', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
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

    // ─── Group 1: Texture Lifecycle ─────────────────────────────────────────

    describe('Texture Lifecycle', () => {
        it('calls gl.createTexture() for each texture during scene load', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());

            const texturesCreated = countMockCalls(gl.createTexture);
            // We defined 2 textures in the snapshot
            expect(texturesCreated).toBeGreaterThanOrEqual(2);

            scene.dispose();
        });

        it('calls gl.deleteTexture() for each created texture on dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());

            const texturesCreated = countMockCalls(gl.createTexture);
            expect(texturesCreated).toBeGreaterThan(0);

            scene.dispose();

            const texturesDeleted = countMockCalls(gl.deleteTexture);
            expect(texturesDeleted).toBeGreaterThanOrEqual(texturesCreated);
        });

        it('tracking set is empty after dispose — no live textures remain', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());
            expect(gl._textures.size).toBeGreaterThan(0);

            scene.dispose();

            // The mock deleteTexture removes from the set; after full cleanup
            // all textures that were created should have been deleted
            expect(gl._textures.size).toBe(0);
        });

        it('produces no texture leak after 10 load/dispose cycles', async () => {
            for (let i = 0; i < 10; i++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));
                const gl = getGlFromScene(scene);

                await scene.loadScene(buildTexturedSnapshot());

                const texturesCreated = countMockCalls(gl.createTexture);
                expect(texturesCreated).toBeGreaterThan(0);

                scene.dispose();

                // Delete count must match create count — no leak
                const texturesDeleted = countMockCalls(gl.deleteTexture);
                expect(texturesDeleted).toBeGreaterThanOrEqual(texturesCreated);

                // Tracking set must be empty
                expect(gl._textures.size).toBe(0);
            }
        });
    });

    // ─── Group 2: Buffer Lifecycle ───────────────────────────────────────────

    describe('Buffer Lifecycle', () => {
        it('calls gl.createBuffer() when loading a scene with mesh geometry', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const buffersCreated = countMockCalls(gl.createBuffer);
            expect(buffersCreated).toBeGreaterThan(0);

            scene.dispose();
        });

        it('calls gl.deleteBuffer() for each created buffer on dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const buffersCreated = countMockCalls(gl.createBuffer);
            expect(buffersCreated).toBeGreaterThan(0);

            scene.dispose();

            const buffersDeleted = countMockCalls(gl.deleteBuffer);
            expect(buffersDeleted).toBeGreaterThanOrEqual(buffersCreated);
        });

        it('buffer tracking set is empty after dispose — no leak', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            expect(gl._buffers.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._buffers.size).toBe(0);
        });
    });

    // ─── Group 3: Shader Program Lifecycle ───────────────────────────────────

    describe('Shader Program Lifecycle', () => {
        it('calls gl.createShader() and gl.createProgram() during scene load', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());

            const shadersCreated = countMockCalls(gl.createShader);
            const programsCreated = countMockCalls(gl.createProgram);

            // At least one vertex + one fragment shader, and one program
            expect(shadersCreated).toBeGreaterThanOrEqual(2);
            expect(programsCreated).toBeGreaterThanOrEqual(1);

            scene.dispose();
        });

        it('calls gl.deleteShader() and gl.deleteProgram() on dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());

            const shadersCreated = countMockCalls(gl.createShader);
            const programsCreated = countMockCalls(gl.createProgram);

            scene.dispose();

            const shadersDeleted = countMockCalls(gl.deleteShader);
            const programsDeleted = countMockCalls(gl.deleteProgram);

            expect(shadersDeleted).toBeGreaterThanOrEqual(shadersCreated);
            expect(programsDeleted).toBeGreaterThanOrEqual(programsCreated);
        });

        it('shader and program resources are fully cleaned up after dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());

            // Verify shaders and programs were created
            const shadersCreated = countMockCalls(gl.createShader);
            const programsCreated = countMockCalls(gl.createProgram);
            expect(shadersCreated).toBeGreaterThanOrEqual(2);
            expect(programsCreated).toBeGreaterThanOrEqual(1);

            scene.dispose();

            // After dispose, all programs should be deleted
            // (shaders may be deleted eagerly after linking, so check delete count >= create count)
            expect(countMockCalls(gl.deleteShader)).toBeGreaterThanOrEqual(shadersCreated);
            expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(programsCreated);

            // Tracking sets must be empty
            expect(gl._shaders.size).toBe(0);
            expect(gl._programs.size).toBe(0);
        });
    });

    // ─── Group 4: Framebuffer Lifecycle ──────────────────────────────────────

    describe('Framebuffer Lifecycle', () => {
        it('loads a scene with render-to-texture without errors', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            await scene.loadScene(buildRttSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Verify the scene loaded successfully with RTT resources
            expect(scene.isDisposed).toBe(false);

            scene.dispose();
        });

        it('if framebuffers are created, they are deleted on dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildRttSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const framebuffersCreated = countMockCalls(gl.createFramebuffer);

            scene.dispose();

            if (framebuffersCreated > 0) {
                const framebuffersDeleted = countMockCalls(gl.deleteFramebuffer);
                expect(framebuffersDeleted).toBeGreaterThanOrEqual(framebuffersCreated);
            } else {
                // No framebuffers created — delete count should also be 0
                expect(countMockCalls(gl.deleteFramebuffer)).toBe(0);
            }
        });

        it('framebuffer tracking set is empty after dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildRttSnapshot());
            scene.start(0);
            scheduler.flush(16);

            scene.dispose();

            // Whether or not framebuffers were created, the tracking set should be empty
            expect(gl._framebuffers.size).toBe(0);
        });
    });

    // ─── Group 5: VAO Lifecycle ──────────────────────────────────────────────

    describe('VAO Lifecycle', () => {
        it('calls gl.createVertexArray() when loading a scene with meshes (WebGL2)', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const vaosCreated = countMockCalls(gl.createVertexArray);
            expect(vaosCreated).toBeGreaterThan(0);

            scene.dispose();
        });

        it('calls gl.deleteVertexArray() on dispose for each created VAO', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const vaosCreated = countMockCalls(gl.createVertexArray);
            expect(vaosCreated).toBeGreaterThan(0);

            scene.dispose();

            const vaosDeleted = countMockCalls(gl.deleteVertexArray);
            expect(vaosDeleted).toBeGreaterThanOrEqual(vaosCreated);
        });

        it('VAO tracking set is empty after dispose — no leak', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            expect(gl._vertexArrays.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._vertexArrays.size).toBe(0);
        });
    });

    // ─── Group 6: Component Disposal ─────────────────────────────────────────

    describe('Component Disposal', () => {
        it('all GL resources released after entities destroyed and scene disposed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const buffersCreated = countMockCalls(gl.createBuffer);
            const vaosCreated = countMockCalls(gl.createVertexArray);
            expect(buffersCreated).toBeGreaterThan(0);
            expect(vaosCreated).toBeGreaterThan(0);

            // Destroy all entities
            const entities = scene.world.getAllEntities();
            expect(entities.length).toBeGreaterThan(0);
            for (const entity of entities) {
                entity.destroy(true);
            }

            // Dispose scene — releases all remaining GL resources
            scene.dispose();

            // After full cleanup, all created buffers and VAOs should be deleted
            const buffersDeleted = countMockCalls(gl.deleteBuffer);
            const vaosDeleted = countMockCalls(gl.deleteVertexArray);
            expect(buffersDeleted).toBeGreaterThanOrEqual(buffersCreated);
            expect(vaosDeleted).toBeGreaterThanOrEqual(vaosCreated);

            // Tracking sets must be empty
            expect(gl._buffers.size).toBe(0);
            expect(gl._vertexArrays.size).toBe(0);
        });

        it('does not throw when scene is disposed after entities are destroyed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Destroy all entities first
            const entities = scene.world.getAllEntities();
            for (const entity of entities) {
                entity.destroy(true);
            }

            // Now dispose the scene — should not throw even if resources already released
            expect(() => scene.dispose()).not.toThrow();
            expect(scene.isDisposed).toBe(true);
        });

        it('component onDestroy is called when entity is destroyed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            class DisposableTracker extends Component {
                destroyed = false;
                onDestroy(): void {
                    this.destroyed = true;
                }
            }

            scene.registerComponent(DisposableTracker);

            const entity = scene.createEntity({ name: 'TrackDispose' });
            const tracker = entity.addComponent(DisposableTracker);

            expect(tracker.destroyed).toBe(false);

            entity.destroy();

            expect(tracker.destroyed).toBe(true);

            scene.dispose();
        });

        it('no double-dispose when entities destroyed then scene disposed', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const buffersCreated = countMockCalls(gl.createBuffer);

            // Destroy entities (releases mesh resources)
            for (const entity of scene.world.getAllEntities()) {
                entity.destroy(true);
            }

            const buffersAfterEntityDestroy = countMockCalls(gl.deleteBuffer);

            // Dispose scene (should not re-delete already freed resources)
            scene.dispose();

            const buffersAfterSceneDispose = countMockCalls(gl.deleteBuffer);

            // Total deletes should match total creates (no double-delete)
            expect(buffersAfterSceneDispose).toBeLessThanOrEqual(buffersCreated);
            // But should be at least as many as were deleted during entity destroy
            expect(buffersAfterSceneDispose).toBeGreaterThanOrEqual(buffersAfterEntityDestroy);
        });
    });

    // ─── Group 7: Scene Transition Leak Check ───────────────────────────────

    describe('Scene Transition Leak Check', () => {
        it('total deletes match total creates after scene A then scene B', async () => {
            // Scene A
            const canvas1 = document.createElement('canvas');
            const scene1 = new Scene(createSceneOptions(scheduler, canvas1));
            const gl1 = getGlFromScene(scene1);

            await scene1.loadScene(buildSnapshotA());
            scene1.start(0);
            scheduler.flush(16);
            for (let i = 0; i < 9; i++) {
                scheduler.flush(16 * (i + 2));
            }

            const gl1TexCreated = countMockCalls(gl1.createTexture);
            const gl1BufCreated = countMockCalls(gl1.createBuffer);
            const gl1ShdCreated = countMockCalls(gl1.createShader);
            const gl1PrgCreated = countMockCalls(gl1.createProgram);
            const gl1VaoCreated = countMockCalls(gl1.createVertexArray);

            scene1.dispose();

            // Verify all resources from scene A cleaned up
            expect(countMockCalls(gl1.deleteTexture)).toBeGreaterThanOrEqual(gl1TexCreated);
            expect(countMockCalls(gl1.deleteBuffer)).toBeGreaterThanOrEqual(gl1BufCreated);
            expect(countMockCalls(gl1.deleteShader)).toBeGreaterThanOrEqual(gl1ShdCreated);
            expect(countMockCalls(gl1.deleteProgram)).toBeGreaterThanOrEqual(gl1PrgCreated);
            expect(countMockCalls(gl1.deleteVertexArray)).toBeGreaterThanOrEqual(gl1VaoCreated);

            // Tracking sets should be empty
            expect(gl1._textures.size).toBe(0);
            expect(gl1._buffers.size).toBe(0);
            expect(gl1._shaders.size).toBe(0);
            expect(gl1._programs.size).toBe(0);
            expect(gl1._vertexArrays.size).toBe(0);

            // Scene B
            const canvas2 = document.createElement('canvas');
            const scene2 = new Scene(createSceneOptions(scheduler, canvas2));
            const gl2 = getGlFromScene(scene2);

            await scene2.loadScene(buildSnapshotB());
            scene2.start(0);
            scheduler.flush(16);
            for (let i = 0; i < 9; i++) {
                scheduler.flush(16 * (i + 2));
            }

            const gl2TexCreated = countMockCalls(gl2.createTexture);
            const gl2BufCreated = countMockCalls(gl2.createBuffer);
            const gl2ShdCreated = countMockCalls(gl2.createShader);
            const gl2PrgCreated = countMockCalls(gl2.createProgram);
            const gl2VaoCreated = countMockCalls(gl2.createVertexArray);

            scene2.dispose();

            // Verify all resources from scene B cleaned up
            expect(countMockCalls(gl2.deleteTexture)).toBeGreaterThanOrEqual(gl2TexCreated);
            expect(countMockCalls(gl2.deleteBuffer)).toBeGreaterThanOrEqual(gl2BufCreated);
            expect(countMockCalls(gl2.deleteShader)).toBeGreaterThanOrEqual(gl2ShdCreated);
            expect(countMockCalls(gl2.deleteProgram)).toBeGreaterThanOrEqual(gl2PrgCreated);
            expect(countMockCalls(gl2.deleteVertexArray)).toBeGreaterThanOrEqual(gl2VaoCreated);

            expect(gl2._textures.size).toBe(0);
            expect(gl2._buffers.size).toBe(0);
            expect(gl2._shaders.size).toBe(0);
            expect(gl2._programs.size).toBe(0);
            expect(gl2._vertexArrays.size).toBe(0);
        });

        it('no resource accumulation across 5 load/dispose cycles', async () => {
            for (let cycle = 0; cycle < 5; cycle++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));
                const gl = getGlFromScene(scene);

                await scene.loadScene(buildMeshSnapshot());
                scene.start(0);
                scheduler.flush(16);

                const texCreated = countMockCalls(gl.createTexture);
                const bufCreated = countMockCalls(gl.createBuffer);
                const shdCreated = countMockCalls(gl.createShader);
                const prgCreated = countMockCalls(gl.createProgram);

                scene.dispose();

                expect(countMockCalls(gl.deleteTexture)).toBeGreaterThanOrEqual(texCreated);
                expect(countMockCalls(gl.deleteBuffer)).toBeGreaterThanOrEqual(bufCreated);
                expect(countMockCalls(gl.deleteShader)).toBeGreaterThanOrEqual(shdCreated);
                expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(prgCreated);

                // Tracking sets must be empty after each cycle
                expect(gl._textures.size).toBe(0);
                expect(gl._buffers.size).toBe(0);
                expect(gl._shaders.size).toBe(0);
                expect(gl._programs.size).toBe(0);
            }
        });

        it('reloading into same Scene instance cleans up previous resources', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            // Load scene A
            await scene.loadScene(buildSnapshotA());
            scene.start(0);
            scheduler.flush(16);

            const shadersAfterA = countMockCalls(gl.createShader);
            const programsAfterA = countMockCalls(gl.createProgram);
            expect(shadersAfterA).toBeGreaterThan(0);
            expect(programsAfterA).toBeGreaterThan(0);

            // Load scene B into the same scene — should clean up scene A resources
            await scene.loadScene(buildSnapshotB());
            scene.start(0);
            scheduler.flush(32);

            // Now dispose — everything should be cleaned up
            scene.dispose();

            const totalShadersCreated = countMockCalls(gl.createShader);
            const totalProgramsCreated = countMockCalls(gl.createProgram);
            const deletedShaders = countMockCalls(gl.deleteShader);
            const deletedPrograms = countMockCalls(gl.deleteProgram);

            expect(deletedShaders).toBeGreaterThanOrEqual(totalShadersCreated);
            expect(deletedPrograms).toBeGreaterThanOrEqual(totalProgramsCreated);

            // Tracking sets empty
            expect(gl._shaders.size).toBe(0);
            expect(gl._programs.size).toBe(0);
        });
    });

    // ─── Group 8: Context Loss Recovery ──────────────────────────────────────

    describe('Context Loss Recovery', () => {
        it('scene survives webglcontextlost without crashing', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Verify resources were created
            const shadersCreated = countMockCalls(gl.createShader);
            expect(shadersCreated).toBeGreaterThan(0);

            // Simulate context loss
            const contextLostEvent = new Event('webglcontextlost');
            canvas.dispatchEvent(contextLostEvent);

            // After context loss, the scene should still be in a valid state
            expect(scene.isDisposed).toBe(false);

            scene.dispose();
        });

        it('scene survives webglcontextrestored and continues operating', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const shadersBeforeLoss = countMockCalls(gl.createShader);
            const programsBeforeLoss = countMockCalls(gl.createProgram);

            // Simulate context loss
            canvas.dispatchEvent(new Event('webglcontextlost'));

            // Simulate context restored
            canvas.dispatchEvent(new Event('webglcontextrestored'));

            // After context restored, the engine may re-create resources on next frame
            scheduler.flush(32);

            // The scene should still be operational
            expect(scene.isDisposed).toBe(false);

            const shadersAfterRestore = countMockCalls(gl.createShader);
            const programsAfterRestore = countMockCalls(gl.createProgram);

            // Original creation counts should be intact (may be more if re-created)
            expect(shadersAfterRestore).toBeGreaterThanOrEqual(shadersBeforeLoss);
            expect(programsAfterRestore).toBeGreaterThanOrEqual(programsBeforeLoss);

            scene.dispose();
        });

        it('scene remains functional after context loss/restore cycle', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Context loss
            canvas.dispatchEvent(new Event('webglcontextlost'));
            expect(scene.isDisposed).toBe(false);

            // Context restored
            canvas.dispatchEvent(new Event('webglcontextrestored'));
            expect(scene.isDisposed).toBe(false);

            // Should still be able to run frames
            expect(() => scheduler.flush(32)).not.toThrow();
            expect(() => scheduler.flush(48)).not.toThrow();

            // Should still be able to create entities
            const entity = scene.createEntity({ name: 'PostRecovery' });
            expect(entity).toBeDefined();
            expect(entity.name).toBe('PostRecovery');

            scene.dispose();
        });

        it('dispose after context loss does not throw', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            await scene.loadScene(buildMeshSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Context loss
            canvas.dispatchEvent(new Event('webglcontextlost'));

            // Disposing after context loss should not throw
            expect(() => scene.dispose()).not.toThrow();
            expect(scene.isDisposed).toBe(true);
        });
    });

    // ─── Group 9: Comprehensive Resource Accounting ──────────────────────────

    describe('Comprehensive Resource Accounting', () => {
        it('tracks all resource types simultaneously — delete counts match create counts', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            // Load a scene with textures, meshes, and shaders
            await scene.loadScene(buildTexturedSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const texCreated = countMockCalls(gl.createTexture);
            const bufCreated = countMockCalls(gl.createBuffer);
            const shdCreated = countMockCalls(gl.createShader);
            const prgCreated = countMockCalls(gl.createProgram);
            const vaoCreated = countMockCalls(gl.createVertexArray);

            // Verify resources were created for key types
            expect(texCreated).toBeGreaterThan(0);
            expect(shdCreated).toBeGreaterThan(0);
            expect(prgCreated).toBeGreaterThan(0);

            scene.dispose();

            // Every resource type: deletes >= creates
            expect(countMockCalls(gl.deleteTexture)).toBeGreaterThanOrEqual(texCreated);
            expect(countMockCalls(gl.deleteBuffer)).toBeGreaterThanOrEqual(bufCreated);
            expect(countMockCalls(gl.deleteShader)).toBeGreaterThanOrEqual(shdCreated);
            expect(countMockCalls(gl.deleteProgram)).toBeGreaterThanOrEqual(prgCreated);
            expect(countMockCalls(gl.deleteVertexArray)).toBeGreaterThanOrEqual(vaoCreated);
        });

        it('mock GL tracking sets are all empty after dispose (all resources freed)', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Before dispose, key resources should have been created
            // (textures and programs are long-lived; shaders may be detached after linking)
            expect(gl._textures.size).toBeGreaterThan(0);
            expect(gl._programs.size).toBeGreaterThan(0);

            scene.dispose();

            // After dispose, the mock's delete functions remove from the tracking sets
            expect(gl._textures.size).toBe(0);
            expect(gl._shaders.size).toBe(0);
            expect(gl._programs.size).toBe(0);
            expect(gl._buffers.size).toBe(0);
            expect(gl._vertexArrays.size).toBe(0);
            expect(gl._framebuffers.size).toBe(0);
        });

        it('delete calls never exceed create calls (no double-delete)', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGlFromScene(scene);

            await scene.loadScene(buildTexturedSnapshot());
            scene.start(0);
            scheduler.flush(16);

            scene.dispose();

            // For each resource type, deletes should not exceed creates
            expect(countMockCalls(gl.deleteTexture)).toBeLessThanOrEqual(countMockCalls(gl.createTexture));
            expect(countMockCalls(gl.deleteBuffer)).toBeLessThanOrEqual(countMockCalls(gl.createBuffer));
            expect(countMockCalls(gl.deleteShader)).toBeLessThanOrEqual(countMockCalls(gl.createShader));
            expect(countMockCalls(gl.deleteProgram)).toBeLessThanOrEqual(countMockCalls(gl.createProgram));
            expect(countMockCalls(gl.deleteVertexArray)).toBeLessThanOrEqual(countMockCalls(gl.createVertexArray));
        });
    });
});
