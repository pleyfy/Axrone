import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import {
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
} from '../../../../tests/shared/test-harness';
import {
    ANY_ALLOCATION_PATTERN,
    VECTOR_ALLOCATION_PATTERN,
    extractMethodBody,
    forceGcIfAvailable,
    hasMemoryApi,
    linearSlope,
    median,
    readHeapBytes,
    runFrames,
} from './perf-test-utils';

let Scene: typeof import('@axrone/scene-3d').Scene;
let FollowCameraController: typeof import('@axrone/scene-3d').FollowCameraController;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Script Performance Regression', () => {
    let scheduler: ManualScheduler;

    beforeAll(async () => {
        installWebGL2Constants();
        const sceneModule = await import('@axrone/scene-3d');
        Scene = sceneModule.Scene;
        FollowCameraController = sceneModule.FollowCameraController;
    });

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    // ─── Group 1: Zero-Allocation Validation (FollowCameraController) ─────

    describe('Zero-Allocation Validation — FollowCameraController', () => {
        it('heap trend is flat over 500 frames (baseline reference)', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(5, 0, 0);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
                azimuth: 0,
                elevation: 0.3,
                targetOffset: [0, 1, 0],
                positionDamping: 10,
                targetDamping: 14,
            });
            controller.setTarget(targetTransform);

            scene.start(0);

            // Extended warm-up to let V8 heap stabilise
            runFrames(scheduler, 200, 0);

            // Sample heap every 50 frames for 500 frames of steady-state
            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                runFrames(scheduler, 50, 3200 + batch * 800);
                samples.push(readHeapBytes()!);
            }

            // The slope should be bounded — no unbounded leak.
            // Node.js V8 heap naturally expands; allow up to 500 KB per sample-step.
            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });

        it('heap trend is flat when target moves each frame', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'MovingTarget' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 8,
                azimuth: 0.5,
                elevation: 0.2,
                targetOffset: [0, 1.5, 0],
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    const idx = batch * 50 + f;
                    targetTransform.position = new Vec3(
                        Math.sin(idx * 0.1) * 10,
                        1,
                        Math.cos(idx * 0.1) * 10,
                    );
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });

        it('heap trend is flat during orbit/zoom operations', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(0, 0, 0);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 7,
                azimuth: 0,
                elevation: 0,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    controller.orbit(0.01, 0.005).zoom(-0.02);
                    scheduler.flush(3200 + (batch * 50 + f) * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });

    // ─── Group 2: Scene Lifecycle Memory Stability ───────────────────────

    describe('Scene Lifecycle Memory Stability', () => {
        it('heap does not grow monotonically across start/stop cycles', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');

            // Warm-up cycle
            {
                const s = new Scene(createSceneOptions(scheduler, canvas));
                const t = s.createActor({ name: 'Warmup' });
                s.start(0);
                runFrames(scheduler, 20, 0);
                s.stop();
                s.dispose();
            }

            const samples: number[] = [];
            for (let cycle = 0; cycle < 10; cycle++) {
                const scene = new Scene(createSceneOptions(scheduler, canvas));
                const target = scene.createActor({ name: 'Target' });
                const targetTransform = target.requireComponent(Transform);

                const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
                const controller = camera.addComponent(FollowCameraController, {
                    distance: 5,
                });
                controller.setTarget(targetTransform);

                scene.start(0);
                runFrames(scheduler, 20, (cycle + 1) * 320);
                scene.stop();
                scene.dispose();

                samples.push(readHeapBytes()!);
            }

            // The slope across 10 dispose/create cycles should be near zero
            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000); // < 500 KB per cycle
        });

        it('heap does not grow monotonically across scene load/dispose cycles', async () => {
            if (!hasMemoryApi()) return;

            // Warm-up
            {
                const c = document.createElement('canvas');
                const s = new Scene(createSceneOptions(scheduler, c));
                s.start(0);
                runFrames(scheduler, 10, 0);
                s.dispose();
            }

            const samples: number[] = [];
            for (let cycle = 0; cycle < 5; cycle++) {
                const canvas = document.createElement('canvas');
                const scene = new Scene(createSceneOptions(scheduler, canvas));

                const snapshot = {
                    version: 1 as const,
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
                                {
                                    semantic: 'position' as const,
                                    componentCount: 3 as const,
                                    offset: 0,
                                    stride: 12,
                                },
                            ],
                            vertexCount: 3,
                        },
                    ],
                    samplers: [],
                    textures: [],
                    renderPasses: [],
                    materials: [{ id: 'default-mat', shaderId: 'test/solid' }],
                    prefab: {
                        id: 'root-prefab',
                        actors: [
                            {
                                name: 'TestActor',
                                layer: 0,
                                tag: 'Default',
                                active: true,
                                persistent: false,
                                pooled: false,
                                components: [
                                    { type: 'Transform', data: {} },
                                    {
                                        type: 'MeshRenderer',
                                        data: { meshId: 'cube', materialId: 'default-mat' },
                                    },
                                ],
                            },
                        ],
                    },
                };

                await scene.loadScene(snapshot);
                scene.start(0);
                runFrames(scheduler, 10, (cycle + 1) * 160);
                scene.dispose();

                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000); // < 500 KB per cycle
        });
    });

    // ─── Group 3: Steady-State Memory (1000 frames) ─────────────────────

    describe('Steady-State Memory', () => {
        it('shows no monotonic heap growth over 1000 frames', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(3, 0, 0);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
                azimuth: 0,
                elevation: 0.3,
            });
            controller.setTarget(targetTransform);

            scene.start(0);

            // Extended warm-up
            runFrames(scheduler, 200, 0);

            // Sample heap every 100 frames for 1000 total frames
            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                runFrames(scheduler, 100, 3200 + batch * 1600);
                samples.push(readHeapBytes()!);
            }

            // Linear slope should be bounded — no unbounded leak
            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000); // < 500 KB per 100-frame step

            scene.dispose();
        });

        it('heap samples remain within a bounded range during active simulation', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 10,
                positionDamping: 5,
                targetDamping: 8,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 200, 0);

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 100; f++) {
                    const t = (batch * 100 + f) * 0.05;
                    targetTransform.position = new Vec3(
                        Math.sin(t) * 5,
                        1,
                        Math.cos(t) * 5,
                    );
                    scheduler.flush(3200 + (batch * 100 + f) * 16);
                }
                samples.push(readHeapBytes()!);
            }

            // The range (max - min) across all samples should be bounded.
            // In Node.js, V8 heap fluctuates with GC cycles — allow 100 MB.
            const minSample = Math.min(...samples);
            const maxSample = Math.max(...samples);
            expect(maxSample - minSample).toBeLessThan(100 * 1024 * 1024);

            scene.dispose();
        });
    });

    // ─── Group 4: Frame Time Budget ─────────────────────────────────────

    describe('Frame Time Budget', () => {
        it('median frame time stays under 5ms for logic/update phase', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(2, 0, 0);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 10, 0);
            // Collect setup garbage before the timed region so a background
            // collection cannot poison the samples.
            forceGcIfAvailable();

            const frameTimes: number[] = [];
            for (let i = 0; i < 60; i++) {
                const t0 = performance.now();
                scheduler.flush(160 + i * 16);
                const t1 = performance.now();
                frameTimes.push(t1 - t0);
            }

            // Median is the robust estimator here: a single GC/scheduler
            // spike drags the mean but not the median.
            const medianFrameTime = median(frameTimes);
            expect(medianFrameTime).toBeLessThan(5);

            scene.dispose();
        });

        it('no single frame exceeds 16.6ms in the logic phase', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 10, 0);
            forceGcIfAvailable();

            for (let i = 0; i < 60; i++) {
                targetTransform.position = new Vec3(
                    Math.sin(i * 0.1) * 8,
                    1,
                    Math.cos(i * 0.1) * 8,
                );
                const t0 = performance.now();
                scheduler.flush(160 + i * 16);
                const elapsed = performance.now() - t0;
                expect(elapsed).toBeLessThan(16.6);
            }

            scene.dispose();
        });

        it('frame time remains stable (no degradation) over 200 frames', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            runFrames(scheduler, 10, 0);
            forceGcIfAvailable();

            const firstBatch: number[] = [];
            for (let i = 0; i < 50; i++) {
                const t0 = performance.now();
                scheduler.flush(160 + i * 16);
                firstBatch.push(performance.now() - t0);
            }

            const lastBatch: number[] = [];
            for (let i = 150; i < 200; i++) {
                const t0 = performance.now();
                scheduler.flush(160 + i * 16);
                lastBatch.push(performance.now() - t0);
            }

            // Median-based comparison: means are dragged by isolated spikes
            // (GC, timer coalescing) that have nothing to do with degradation.
            const medianFirst = median(firstBatch);
            const medianLast = median(lastBatch);

            // Last batch should not be more than 2x the first batch
            expect(medianLast).toBeLessThan(medianFirst * 2 + 1);

            scene.dispose();
        });
    });

    // ─── Group 5: Pool Metrics Tracking ─────────────────────────────────

    describe('Pool Metrics', () => {
        interface PooledObj {
            reset(): void;
            id: number;
        }

        it('tracks allocation and release counts through acquire/release cycles', async () => {
            const { MemoryPool } = await import('@axrone/memory');

            let nextId = 0;
            const pool = new MemoryPool<PooledObj>({
                initialCapacity: 32,
                maxCapacity: 256,
                factory: () => ({ id: nextId++, reset() {} }),
                enableMetrics: true,
                name: 'test-pool',
            });

            // Warm-up: acquire and release 50 objects to fill the pool
            const warmUp: PooledObj[] = [];
            for (let i = 0; i < 50; i++) {
                warmUp.push(pool.acquire());
            }
            for (const obj of warmUp) {
                pool.release(obj);
            }

            // Measure phase: acquire and release 1000 times
            for (let i = 0; i < 1000; i++) {
                const obj = pool.acquire();
                pool.release(obj);
            }

            const metrics = pool.getMetrics();
            expect(metrics.allocations).toBeGreaterThanOrEqual(1050); // 50 warm-up + 1000 measure (+ possible internal)
            expect(metrics.releases).toBeGreaterThanOrEqual(1050);
            // After warm-up, all subsequent acquires should be pool hits
            expect(metrics.hitRatio).toBeGreaterThan(0.95);

            pool[Symbol.dispose]();
        });

        it('reports high hit ratio after pool is pre-warmed', async () => {
            const { MemoryPool } = await import('@axrone/memory');

            let nextId = 0;
            const pool = new MemoryPool<PooledObj>({
                initialCapacity: 100,
                maxCapacity: 200,
                factory: () => ({ id: nextId++, reset() {} }),
                enableMetrics: true,
                name: 'prewarmed-pool',
            });

            // Pre-warm: acquire 100 objects then release them all
            const objs: PooledObj[] = [];
            for (let i = 0; i < 100; i++) {
                objs.push(pool.acquire());
            }
            for (const obj of objs) {
                pool.release(obj);
            }

            // Now acquire 500 times — all should be hits
            for (let i = 0; i < 500; i++) {
                const obj = pool.acquire();
                pool.release(obj);
            }

            const metrics = pool.getMetrics();
            expect(metrics.missRate).toBeLessThan(0.05);
            expect(metrics.hitRatio).toBeGreaterThan(0.95);

            pool[Symbol.dispose]();
        });

        it('tracks high water mark correctly', async () => {
            const { MemoryPool } = await import('@axrone/memory');

            let nextId = 0;
            const pool = new MemoryPool<PooledObj>({
                initialCapacity: 64,
                maxCapacity: 256,
                factory: () => ({ id: nextId++, reset() {} }),
                enableMetrics: true,
                name: 'hwm-pool',
            });

            // Acquire 50 objects (high water mark = 50)
            const active: PooledObj[] = [];
            for (let i = 0; i < 50; i++) {
                active.push(pool.acquire());
            }

            const metricsAfter50 = pool.getMetrics();
            expect(metricsAfter50.highWaterMark).toBe(50);

            // Release 30
            for (let i = 0; i < 30; i++) {
                pool.release(active.pop()!);
            }

            // Acquire 20 more — total 40 active, but HWM stays at 50
            for (let i = 0; i < 20; i++) {
                active.push(pool.acquire());
            }

            const metricsFinal = pool.getMetrics();
            expect(metricsFinal.highWaterMark).toBe(50);
            expect(metricsFinal.allocated).toBe(40);

            // Cleanup
            for (const obj of active) {
                pool.release(obj);
            }
            pool[Symbol.dispose]();
        });

        it('pool with metrics disabled returns zeroed snapshot', async () => {
            const { MemoryPool } = await import('@axrone/memory');

            let nextId = 0;
            const pool = new MemoryPool<PooledObj>({
                initialCapacity: 16,
                maxCapacity: 64,
                factory: () => ({ id: nextId++, reset() {} }),
                enableMetrics: false,
                name: 'disabled-pool',
            });

            // Pool still works for acquire/release
            const obj = pool.acquire();
            pool.release(obj);

            // But getMetrics returns zeros when metrics are disabled
            const metrics = pool.getMetrics();
            expect(metrics.allocations).toBe(0);
            expect(metrics.releases).toBe(0);
            expect(metrics.highWaterMark).toBe(0);

            pool[Symbol.dispose]();
        });
    });

    // ─── Group 6: GC Pressure Detection ─────────────────────────────────

    describe('GC Pressure Detection', () => {
        it('heap trend is bounded over 200 frames with active simulation', () => {
            if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
                return;
            }

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            const camera = scene.createCameraActor({ name: 'Camera' }, { primary: true });
            const controller = camera.addComponent(FollowCameraController, {
                distance: 6,
            });
            controller.setTarget(targetTransform);

            scene.start(0);
            // Extended warm-up
            runFrames(scheduler, 200, 0);

            // Sample heap at intervals during 200 active frames
            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 20; f++) {
                    const idx = batch * 20 + f;
                    targetTransform.position = new Vec3(
                        Math.sin(idx * 0.05) * 5,
                        1,
                        Math.cos(idx * 0.05) * 5,
                    );
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(process.memoryUsage().heapUsed);
            }

            // Slope should be bounded — no unbounded leak
            const slope = linearSlope(samples);
            // Allow up to 500 KB per sample step (Node.js V8 noise)
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });

        it('heap does not grow unboundedly after repeated actor creation and disposal', () => {
            if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
                return;
            }

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));
            scene.start(0);

            // Warm-up
            runFrames(scheduler, 100, 0);

            // Sample heap across 5 rounds of actor churn
            const samples: number[] = [];
            for (let round = 0; round < 5; round++) {
                for (let i = 0; i < 20; i++) {
                    const actor = scene.createActor({ name: `Temp_${round}_${i}` });
                    const transform = actor.requireComponent(Transform);
                    transform.position = new Vec3(i, round, 0);
                    actor.destroy();
                }
                runFrames(scheduler, 10, 1600 + round * 160);
                samples.push(process.memoryUsage().heapUsed);
            }

            const slope = linearSlope(samples);
            // Allow up to 500 KB per round (generous for Node.js)
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });
    });

    // ─── Group 7: Code Pattern Validation ───────────────────────────────

    describe('Code Pattern Validation — Zero-Allocation in Hot Paths', () => {
        it('FollowCameraController.lateUpdate does not contain `new` expressions', () => {
            const controllerSource = FollowCameraController.toString();

            // Mandatory extraction: throws (fails) when the method body
            // cannot be located — no silent skips.
            const lateUpdateBody = extractMethodBody(controllerSource, 'lateUpdate');

            // The transpiled source allocates as `new __vite_ssr_import_x__.Vec3`,
            // so the naive `\bnew\s+Vec3\b` pattern would miss real allocations.
            const newExpressions = lateUpdateBody.match(ANY_ALLOCATION_PATTERN);
            expect(newExpressions).toBeNull();
        });

        it('FollowCameraController pre-allocates all temporary vectors in constructor', () => {
            const source = FollowCameraController.toString();

            // The zero-allocation pattern uses pre-allocated temp fields
            expect(source).toContain('_smoothedTarget');
            expect(source).toContain('_desiredTarget');
            expect(source).toContain('_desiredPosition');
            expect(source).toContain('_tempForward');
            expect(source).toContain('_tempUp');
            expect(source).toContain('_tempBackward');
            expect(source).toContain('_tempRotation');
        });

        it('FollowCameraController uses out-parameter pattern instead of creating new vectors', () => {
            const classSource = FollowCameraController.toString();

            expect(classSource).toContain('_resolveDesiredTarget');
            expect(classSource).toContain('_composeDesiredPosition');

            for (const method of [
                '_resolveDesiredTarget',
                '_composeDesiredPosition',
                '_resolveUp',
                '_applyCameraTransform',
            ]) {
                // Mandatory extraction — each listed method MUST be found.
                const methodBody = extractMethodBody(classSource, method);
                expect(
                    methodBody.match(VECTOR_ALLOCATION_PATTERN),
                    `${method} must not allocate Vec3/Quat`,
                ).toBeNull();
            }
        });
    });

    // ─── Group 8: Multi-Component Frame Stress ──────────────────────────

    describe('Multi-Component Frame Stress', () => {
        it('handles 10 cameras with FollowCameraController with flat heap trend', () => {
            if (!hasMemoryApi()) return;

            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);
            targetTransform.position = new Vec3(0, 0, 0);

            const controllers: InstanceType<typeof FollowCameraController>[] = [];
            for (let i = 0; i < 10; i++) {
                const cam = scene.createCameraActor(
                    { name: `Camera_${i}` },
                    { primary: i === 0 },
                );
                const ctrl = cam.addComponent(FollowCameraController, {
                    distance: 5 + i * 2,
                    azimuth: (i * Math.PI * 2) / 10,
                    elevation: 0.2 + i * 0.05,
                    targetOffset: [0, 1, 0],
                });
                ctrl.setTarget(targetTransform);
                controllers.push(ctrl);
            }

            scene.start(0);
            runFrames(scheduler, 200, 0); // warm-up

            const samples: number[] = [];
            for (let batch = 0; batch < 10; batch++) {
                for (let f = 0; f < 50; f++) {
                    const idx = batch * 50 + f;
                    targetTransform.position = new Vec3(
                        Math.sin(idx * 0.05) * 3,
                        1,
                        Math.cos(idx * 0.05) * 3,
                    );
                    controllers[idx % 10].orbit(0.01, 0.005);
                    scheduler.flush(3200 + idx * 16);
                }
                samples.push(readHeapBytes()!);
            }

            const slope = linearSlope(samples);
            expect(slope).toBeLessThan(500_000);

            scene.dispose();
        });

        it('maintains stable frame times with 10 active controllers', () => {
            const canvas = document.createElement('canvas');
            const scene = new Scene(createSceneOptions(scheduler, canvas));

            const target = scene.createActor({ name: 'Target' });
            const targetTransform = target.requireComponent(Transform);

            for (let i = 0; i < 10; i++) {
                const cam = scene.createCameraActor(
                    { name: `Camera_${i}` },
                    { primary: i === 0 },
                );
                const ctrl = cam.addComponent(FollowCameraController, {
                    distance: 5 + i,
                });
                ctrl.setTarget(targetTransform);
            }

            scene.start(0);
            runFrames(scheduler, 50, 0);

            const frameTimes: number[] = [];
            for (let i = 0; i < 60; i++) {
                targetTransform.position = new Vec3(
                    Math.sin(i * 0.1) * 5,
                    1,
                    Math.cos(i * 0.1) * 5,
                );
                const t0 = performance.now();
                scheduler.flush(800 + i * 16);
                frameTimes.push(performance.now() - t0);
            }

            const avgFrameTime =
                frameTimes.reduce((s, t) => s + t, 0) / frameTimes.length;
            const maxFrameTime = Math.max(...frameTimes);

            expect(avgFrameTime).toBeLessThan(5);
            expect(maxFrameTime).toBeLessThan(16.6);

            scene.dispose();
        });
    });

    // ─── Group 9: Memory API Availability Guard ────────────────────────

    describe('Memory API Availability', () => {
        it('memory API must be available in CI environments', () => {
            const isCI = typeof process !== 'undefined' && (process.env.CI === 'true' || process.env.CI === '1');
            if (isCI) {
                expect(hasMemoryApi()).toBe(true);
            }
        });

        it('readHeapBytes returns a positive number or null', () => {
            const result = readHeapBytes();
            if (result !== null) {
                expect(result).toBeGreaterThan(0);
            }
        });

        it('hasMemoryApi returns a boolean', () => {
            expect(typeof hasMemoryApi()).toBe('boolean');
        });

        it('linearSlope returns zero for constant samples', () => {
            expect(linearSlope([100, 100, 100, 100])).toBe(0);
        });

        it('linearSlope returns positive value for growing samples', () => {
            const slope = linearSlope([100, 200, 300, 400]);
            expect(slope).toBeGreaterThan(0);
            expect(slope).toBeCloseTo(100, 5);
        });
    });
});
