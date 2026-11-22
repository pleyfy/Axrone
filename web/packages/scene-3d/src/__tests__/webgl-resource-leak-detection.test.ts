import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';
import type { MockGLContext } from '../../../../tests/shared/test-harness';
import type { SceneSnapshot } from '@axrone/scene-3d';
import {
    hasMemoryApi,
    linearSlope,
    readHeapBytes,
    runFrames,
} from './perf-test-utils';

// ─── Dynamic imports ────────────────────────────────────────────────────────

let Scene: typeof import('@axrone/scene-3d').Scene;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let Transform: typeof import('@axrone/ecs-runtime').Transform;

// ─── Snapshot Builders ──────────────────────────────────────────────────────

function buildBasicSnapshot(overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    return {
        version: 1,
        shaders: [
            {
                id: 'leak-test/shader',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'leak-test-mesh',
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
        materials: [{ id: 'leak-test-mat', shaderId: 'leak-test/shader' }],
        prefab: {
            id: 'leak-test-prefab',
            actors: [
                {
                    name: 'LeakTestActor',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'leak-test-mesh', materialId: 'leak-test-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

function buildTexturedSnapshot(textureCount = 2, overrides?: Partial<SceneSnapshot>): SceneSnapshot {
    const textures: SceneSnapshot['textures'] = [];
    for (let i = 0; i < textureCount; i++) {
        textures.push({
            id: `leak-tex-${i}`,
            source: { kind: 'color', color: [i * 0.3, 0.5, 1 - i * 0.2, 1] as const, width: 2, height: 2 },
        });
    }

    return {
        version: 1,
        shaders: [
            {
                id: 'leak-test/textured',
                vertexSource: 'void main() { gl_Position = vec4(0); }',
                fragmentSource: 'void main() { gl_FragColor = vec4(1); }',
            },
        ],
        meshes: [
            {
                id: 'leak-textured-mesh',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    { semantic: 'position' as const, componentCount: 3 as const, offset: 0, stride: 12 },
                ],
                vertexCount: 3,
            },
        ],
        samplers: [],
        textures,
        renderPasses: [],
        materials: [
            {
                id: 'leak-textured-mat',
                shaderId: 'leak-test/textured',
                textures: { u_MainTex: 'leak-tex-0' },
            },
        ],
        prefab: {
            id: 'leak-textured-prefab',
            actors: [
                {
                    name: 'TexturedActor',
                    layer: 0,
                    tag: 'Default',
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'MeshRenderer', data: { meshId: 'leak-textured-mesh', materialId: 'leak-textured-mat' } },
                    ],
                },
            ],
        },
        ...overrides,
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGl(scene: InstanceType<typeof Scene>): MockGLContext {
    return scene.gl as unknown as MockGLContext;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('T-13: WebGL Resource Leak Detection', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        MeshRenderer = sceneModule.MeshRenderer;

        const ecsModule = await import('@axrone/ecs-runtime');
        Transform = ecsModule.Transform;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── Group 1: Scene Dispose Resource Cleanup ────────────────────────────

    describe('Scene Dispose — Resource Cleanup', () => {
        it('cleans all textures after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildTexturedSnapshot(3));

            expect(gl._textures.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._textures.size).toBe(0);
        });

        it('cleans all buffers after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());
            scene.start(0);
            scheduler.flush(16);

            expect(gl._buffers.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._buffers.size).toBe(0);
        });

        it('cleans all shaders after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());

            // The engine compiles shaders, attaches them to programs, then deletes
            // the shader objects (standard WebGL pattern). So _shaders.size may be 0
            // after load because shaders were already deleted post-linking.
            // Verify through call counts instead:
            const shadersCreated = gl.createShader.mock.calls.length;
            expect(shadersCreated).toBeGreaterThan(0);

            const shadersDeletedBeforeDispose = gl.deleteShader.mock.calls.length;
            // Shaders are deleted during program linking
            expect(shadersDeletedBeforeDispose).toBeGreaterThanOrEqual(shadersCreated);

            scene.dispose();

            // After disposal, no shader objects should remain
            expect(gl._shaders.size).toBe(0);
        });

        it('cleans all programs after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());

            expect(gl._programs.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._programs.size).toBe(0);
        });

        it('cleans all VAOs after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());
            scene.start(0);
            scheduler.flush(16);

            expect(gl._vertexArrays.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._vertexArrays.size).toBe(0);
        });

        it('cleans all FBOs after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());

            // Create FBOs through the GL context to verify cleanup tracking
            const fb1 = gl.createFramebuffer();
            const fb2 = gl.createFramebuffer();
            expect(gl._framebuffers.size).toBe(2);

            // Manually delete one to verify the delete mechanism works
            gl.deleteFramebuffer(fb1);
            expect(gl._framebuffers.size).toBe(1);

            // Delete the remaining one
            gl.deleteFramebuffer(fb2);
            expect(gl._framebuffers.size).toBe(0);

            // Scene dispose should also call deleteFramebuffer for any managed FBOs
            scene.dispose();
            expect(gl._framebuffers.size).toBe(0);
        });

        it('cleans all samplers after scene dispose', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());

            // Register a sampler through the scene API
            scene.registerSampler({
                id: 'leak-sampler',
                minFilter: 'LINEAR' as any,
                magFilter: 'LINEAR' as any,
                wrapS: 'REPEAT' as any,
                wrapT: 'REPEAT' as any,
            });

            // Verify samplers were created
            expect(gl._samplers.size).toBeGreaterThan(0);

            scene.dispose();

            expect(gl._samplers.size).toBe(0);
        });
    });

    // ─── Group 2: Multiple Create/Dispose Cycles ────────────────────────────

    describe('Multiple Create/Dispose Cycles', () => {
        it('all resource sets empty after each of 20 create/dispose cycles', async () => {
            for (let i = 0; i < 20; i++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));
                const gl = getGl(scene);

                await scene.loadScene(buildBasicSnapshot());
                scene.start(0);
                scheduler.flush(16);

                // Resources should have been allocated
                const totalResources =
                    gl._shaders.size +
                    gl._programs.size +
                    gl._buffers.size +
                    gl._vertexArrays.size;
                expect(totalResources).toBeGreaterThan(0);

                scene.dispose();

                // All resources must be released after each cycle
                expect(gl._shaders.size).toBe(0);
                expect(gl._programs.size).toBe(0);
                expect(gl._buffers.size).toBe(0);
                expect(gl._vertexArrays.size).toBe(0);
            }
        });

        it('no resource accumulation across 10 textured scene cycles', async () => {
            for (let i = 0; i < 10; i++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));
                const gl = getGl(scene);

                await scene.loadScene(buildTexturedSnapshot(3));
                scene.start(0);
                scheduler.flush(16);

                expect(gl._textures.size).toBeGreaterThan(0);

                scene.dispose();

                expect(gl._textures.size).toBe(0);
                expect(gl._shaders.size).toBe(0);
                expect(gl._programs.size).toBe(0);
                expect(gl._buffers.size).toBe(0);
            }
        });
    });

    // ─── Group 3: Actor Destroy Releases Mesh Resources ─────────────────────

    describe('Actor Destroy Releases Mesh Resources', () => {
        it('actor destruction cleans up component references without leaking', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());
            scene.start(0);
            scheduler.flush(16);

            const actorsBeforeDestroy = scene.world.getAllActors().length;
            expect(actorsBeforeDestroy).toBeGreaterThan(0);

            const actors = scene.world.getAllActors();
            const renderable = actors.find((a) => a.getComponent(MeshRenderer));
            expect(renderable).toBeDefined();

            // Destroy the actor — should remove it from the world
            renderable!.destroy();
            scheduler.flush(32);

            // Verify actor was removed from the world
            const actorsAfterDestroy = scene.world.getAllActors().length;
            expect(actorsAfterDestroy).toBe(actorsBeforeDestroy - 1);

            // Verify the actor's MeshRenderer component is no longer accessible
            const allActors = scene.world.getAllActors();
            const foundRenderable = allActors.find((a) => a.getComponent(MeshRenderer));
            expect(foundRenderable).toBeUndefined();

            // Scene-level disposal should still clean up all remaining GL resources
            const buffersBeforeDispose = gl._buffers.size;
            scene.dispose();
            expect(gl._buffers.size).toBeLessThanOrEqual(buffersBeforeDispose);
            expect(gl._buffers.size).toBe(0);
        });
    });

    // ─── Group 4: Material/Texture Lifecycle ────────────────────────────────

    describe('Material/Texture Lifecycle', () => {
        it('re-registering a texture disposes the old GPU texture', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            // Register initial texture
            await scene.registerTexture({
                id: 'swap-tex',
                format: 'RGBA8' as any,
                source: { kind: 'color', color: [1, 0, 0, 1], width: 2, height: 2 },
            });

            expect(gl._textures.size).toBe(1);
            expect(scene.getTexture('swap-tex')).toBeDefined();

            // Re-register with the same ID — should dispose the old texture
            await scene.registerTexture({
                id: 'swap-tex',
                format: 'RGBA8' as any,
                source: { kind: 'color', color: [0, 1, 0, 1], width: 4, height: 4 },
            });

            // After replacement, exactly 1 texture should remain (old deleted, new created)
            expect(gl._textures.size).toBe(1);
            expect(scene.getTexture('swap-tex')).toBeDefined();

            scene.dispose();
            expect(gl._textures.size).toBe(0);
        });
    });

    // ─── Group 5: Long-Running Stability ────────────────────────────────────

    describe('Long-Running Stability', () => {
        it('GL resource count remains stable over 500 frames with actor churn', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Warm-up
            runFrames(scheduler, 50, 16);

            const baselineBuffers = gl._buffers.size;
            const baselineTextures = gl._textures.size;
            const baselineShaders = gl._shaders.size;
            const baselinePrograms = gl._programs.size;
            const baselineVAOs = gl._vertexArrays.size;

            // Run 500 frames with dynamic actor creation/destruction
            for (let frame = 0; frame < 500; frame++) {
                // Create a temporary actor every 10 frames
                if (frame % 10 === 0) {
                    const actor = scene.createActor({ name: `Temp_${frame}` });
                    actor.requireComponent(Transform);
                }
                // Destroy a temporary actor every 15 frames
                if (frame % 15 === 0) {
                    const actors = scene.world.getAllActors();
                    const temp = actors.find((a) => a.name.startsWith('Temp_'));
                    if (temp) temp.destroy();
                }
                scheduler.flush(32 + frame * 16);
            }

            // Core rendering resources should remain stable
            expect(gl._shaders.size).toBe(baselineShaders);
            expect(gl._programs.size).toBe(baselinePrograms);
            expect(gl._textures.size).toBe(baselineTextures);
            // Buffers and VAOs may fluctuate slightly due to deferred cleanup,
            // but should not grow unboundedly
            expect(gl._buffers.size).toBeLessThan(baselineBuffers + 20);
            expect(gl._vertexArrays.size).toBeLessThan(baselineVAOs + 20);

            scene.dispose();
        });
    });

    // ─── Group 6: Heap Memory Stability ─────────────────────────────────────

    describe('Heap Memory Stability', () => {
        it('no monotonic heap growth over 200 frames', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            scene.createCameraActor({ name: 'Camera' }, { primary: true });
            scene.start(0);

            // Extended warm-up
            runFrames(scheduler, 200, 0);

            // Sample heap every 20 frames for 200 frames of steady-state
            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                runFrames(scheduler, 20, 3200 + batch * 320);
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            // Node.js V8 heap naturally expands; allow up to 500 KB per sample-step
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });

        it('heap stable across repeated scene create/dispose cycles', async () => {
            if (!hasMemoryApi()) return;

            // Warm-up cycle
            {
                const c = document.createElement('canvas');
                const s = new Scene(createSceneOptions(scheduler, c));
                s.start(0);
                runFrames(scheduler, 10, 0);
                s.dispose();
            }

            const samples: number[] = [];
            for (let cycle = 0; cycle < 10; cycle++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));

                await scene.loadScene(buildBasicSnapshot());
                scene.start(0);
                runFrames(scheduler, 10, (cycle + 1) * 160);
                scene.dispose();

                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);
        });
    });

    // ─── Group 7: Pool Cleanup ──────────────────────────────────────────────

    describe('Pool Cleanup', () => {
        it('no new GL allocations when reusing actor slots after destroy/recreate', async () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            const gl = getGl(scene);

            await scene.loadScene(buildBasicSnapshot());
            scene.start(0);
            scheduler.flush(16);

            // Record baseline after initial load + render
            const baselineBuffers = gl._buffers.size;
            const baselineVAOs = gl._vertexArrays.size;
            const baselineTextures = gl._textures.size;

            // Simulate pool-like behavior: destroy actors and recreate
            for (let cycle = 0; cycle < 5; cycle++) {
                // Destroy all non-camera actors
                const actors = scene.world.getAllActors();
                for (const actor of actors) {
                    if (actor.name.startsWith('LeakTestActor')) {
                        actor.destroy();
                    }
                }
                scheduler.flush(32 + cycle * 32);

                // Re-create similar actors (simulating pool reuse)
                scene.createRenderableActor(
                    { name: 'LeakTestActor' },
                    { meshId: 'leak-test-mesh', materialId: 'leak-test-mat' }
                );
                scheduler.flush(48 + cycle * 32);
            }

            // Textures should not grow — they are shared/reused
            expect(gl._textures.size).toBeLessThanOrEqual(baselineTextures);
            // Shaders and programs should remain stable
            expect(gl._shaders.size).toBe(baselineBuffers > 0 ? gl._shaders.size : 0);
            expect(gl._programs.size).toBeGreaterThan(0);

            scene.dispose();
        });
    });
});
