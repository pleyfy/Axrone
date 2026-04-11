import { Mat4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { RenderPipeline } from '@axrone/render-core';

const createCamera = () => ({
    id: 'camera:main',
    viewMatrix: new Mat4(),
    projectionMatrix: new Mat4(),
    position: [0, 0, 0] as const,
    near: 0.1,
    far: 1000,
    clearState: {
        color: [0.02, 0.03, 0.04, 1] as const,
        depth: 1,
    },
});

const createOpaquePrimitive = () => ({
    id: 'primitive:opaque',
    meshId: 'mesh:cube',
    worldMatrix: new Mat4(),
    material: {
        id: 'material:opaque',
        model: 'pbr' as const,
        renderQueue: 2000,
        castsShadows: true,
    },
});

const createTransparentPrimitive = (id: string = 'transparent') => ({
    id: `primitive:${id}`,
    meshId: 'mesh:glass',
    worldMatrix: new Mat4(),
    material: {
        id: `material:${id}`,
        model: 'pbr' as const,
        transparent: true,
        renderQueue: 3000,
        castsShadows: false,
    },
});

describe('RenderPipeline', () => {
    it('plans an integrated frame with core rendering features', () => {
        const pipeline = new RenderPipeline({
            frameBudgetMs: 16.6,
            hdr: true,
            shadows: true,
            gi: { mode: 'ssgi' },
            volumetrics: { enabled: true },
            lightBaking: { enabled: true, maxTasksPerFrame: 1 },
            postProcess: [
                { category: 'builtin', name: 'bloom' },
                { category: 'builtin', name: 'fxaa' },
            ],
        });

        pipeline.enqueueBakeTask({
            id: 'bake:lightmap',
            type: 'lightmap',
            priority: 10,
        });

        const result = pipeline.plan({
            frame: 1,
            deltaTime: 1 / 60,
            viewport: { width: 1280, height: 720 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive(), createTransparentPrimitive()],
            lights: [
                {
                    type: 'directional',
                    id: 'light:sun',
                    direction: [0, -1, 0],
                    color: [1, 1, 1],
                    intensity: 3,
                    castsShadows: true,
                },
                {
                    type: 'point',
                    id: 'light:fill',
                    position: [0, 2, 2],
                    color: [1, 0.8, 0.7],
                    intensity: 2,
                    range: 8,
                },
            ],
            environment: {
                reflectionProbes: [
                    {
                        id: 'probe:lobby',
                        mode: 'realtime',
                        position: [0, 0, 0],
                        priority: 5,
                        dirty: true,
                    },
                ],
                gi: { mode: 'ssgi' },
                volumetrics: { enabled: true },
                lightBaking: { enabled: true, maxTasksPerFrame: 1 },
            },
        });

        expect(result.passes.map((pass) => pass.kind)).toEqual([
            'depth-prepass',
            'shadow',
            'reflection-probe',
            'global-illumination',
            'opaque',
            'skybox',
            'volumetric',
            'transparent',
            'post-process',
            'tonemap',
            'post-process',
            'light-bake',
            'present',
        ]);
        expect(result.statistics.opaqueCount).toBe(1);
        expect(result.statistics.transparentCount).toBe(1);
        expect(result.statistics.lightCount).toBe(2);
        expect(result.statistics.activeReflectionProbeCount).toBe(1);
        expect(result.degraded).toBe(false);
    });

    it('reuses transient render resources across frames', () => {
        const pipeline = new RenderPipeline({
            hdr: true,
            shadows: true,
        });

        const input = {
            viewport: { width: 800, height: 600 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive()],
            lights: [
                {
                    type: 'directional' as const,
                    id: 'light:sun',
                    direction: [0, -1, 0] as const,
                    color: [1, 1, 1] as const,
                    intensity: 2,
                    castsShadows: true,
                },
            ],
        };

        pipeline.plan({
            frame: 1,
            deltaTime: 1 / 60,
            ...input,
        });
        const second = pipeline.plan({
            frame: 2,
            deltaTime: 1 / 60,
            ...input,
        });

        expect(second.statistics.resourceReuseCount).toBeGreaterThan(0);
    });

    it('gracefully degrades optional features under a constrained budget', () => {
        const pipeline = new RenderPipeline({
            frameBudgetMs: 0.4,
            degradeStrategy: 'aggressive',
            shadows: true,
            gi: { mode: 'ssgi' },
            volumetrics: { enabled: true },
            lightBaking: { enabled: true, maxTasksPerFrame: 1 },
            postProcess: [
                { category: 'builtin', name: 'bloom' },
                { category: 'builtin', name: 'ssao' },
                { category: 'builtin', name: 'taa' },
                { category: 'builtin', name: 'fxaa' },
                { category: 'builtin', name: 'vignette' },
            ],
        });

        pipeline.enqueueBakeTask({
            id: 'bake:budget',
            type: 'lightmap',
            priority: 3,
        });

        const result = pipeline.plan({
            frame: 1,
            deltaTime: 1 / 30,
            viewport: { width: 1920, height: 1080 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive(), createTransparentPrimitive()],
            lights: [
                {
                    type: 'directional',
                    id: 'light:sun',
                    direction: [0, -1, 0],
                    color: [1, 1, 1],
                    intensity: 4,
                    castsShadows: true,
                },
            ],
            environment: {
                reflectionProbes: [
                    {
                        id: 'probe:realtime',
                        mode: 'realtime',
                        position: [0, 0, 0],
                        dirty: true,
                        priority: 1,
                    },
                    {
                        id: 'probe:realtime-2',
                        mode: 'realtime',
                        position: [1, 0, 0],
                        dirty: true,
                        priority: 1,
                    },
                ],
                gi: { mode: 'ssgi' },
                volumetrics: { enabled: true },
                lightBaking: { enabled: true, maxTasksPerFrame: 1 },
            },
        });

        expect(result.degraded).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.passes.some((pass) => pass.kind === 'light-bake')).toBe(false);
        expect(result.passes.some((pass) => pass.kind === 'volumetric')).toBe(false);
        expect(result.passes.filter((pass) => pass.kind === 'post-process').length).toBeLessThanOrEqual(
            2
        );
    });

    it('caps transparent primitives through the classification service', () => {
        const pipeline = new RenderPipeline({
            maxTransparentPrimitives: 1,
        });

        const result = pipeline.plan({
            frame: 1,
            deltaTime: 1 / 60,
            viewport: { width: 1280, height: 720 },
            camera: createCamera(),
            primitives: [
                createOpaquePrimitive(),
                createTransparentPrimitive('transparent-a'),
                createTransparentPrimitive('transparent-b'),
            ],
        });

        expect(result.statistics.transparentCount).toBe(1);
        expect(result.warnings).toContain('transparent primitive budget exceeded at 1');
    });

    it('plans cascade metadata and temporal history for shadowed HDR frames', () => {
        const pipeline = new RenderPipeline({
            hdr: {
                enabled: true,
                exposure: {
                    mode: 'automatic',
                    keyValue: 0.18,
                },
            },
            shadows: {
                enabled: true,
                cascadeCount: 4,
                cascadeSplitLambda: 0.8,
                maxDistance: 120,
            },
            postProcess: [{ category: 'builtin', name: 'taa' }],
        });

        const result = pipeline.plan({
            frame: 3,
            deltaTime: 1 / 60,
            viewport: { width: 1440, height: 900 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive()],
            lights: [
                {
                    type: 'directional',
                    id: 'light:sun',
                    direction: [0, -1, 0],
                    color: [1, 1, 1],
                    intensity: 4,
                    castsShadows: true,
                },
            ],
            environment: {
                skybox: {
                    textureId: 'sky:studio',
                },
            },
        });

        const shadow = result.passes.find((pass) => pass.kind === 'shadow');
        const taa = result.passes.find(
            (pass) => pass.kind === 'post-process' && pass.metadata.effect.name === 'taa'
        );
        const tonemap = result.passes.find((pass) => pass.kind === 'tonemap');

        expect(shadow?.metadata).toEqual(
            expect.objectContaining({
                lightIds: ['light:sun'],
            })
        );
        expect((shadow?.metadata as { cascades: readonly unknown[] }).cascades).toHaveLength(4);
        expect(taa?.target).toContain('history:taa-');
        expect(taa?.inputs.some((input) => input.includes('history:taa-'))).toBe(true);
        expect(tonemap?.metadata).toEqual(
            expect.objectContaining({
                hdr: true,
                colorSpace: 'srgb',
                exposureHistory: 'history:exposure',
            })
        );
    });

    it('uses the provided frame number when deciding reflection probe refresh cadence', () => {
        const pipeline = new RenderPipeline({
            maxActiveReflectionProbes: 1,
        });

        const input = {
            deltaTime: 1 / 60,
            viewport: { width: 800, height: 600 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive()],
            environment: {
                reflectionProbes: [
                    {
                        id: 'probe:lobby',
                        mode: 'realtime' as const,
                        position: [0, 0, 0] as const,
                        lastUpdatedFrame: 2,
                        updateInterval: 4,
                    },
                ],
            },
        };

        const early = pipeline.plan({
            frame: 3,
            ...input,
        });
        const due = pipeline.plan({
            frame: 6,
            ...input,
        });

        expect(early.passes.some((pass) => pass.kind === 'reflection-probe')).toBe(false);
        expect(due.passes.some((pass) => pass.kind === 'reflection-probe')).toBe(true);
        expect(due.statistics.reflectionProbeUpdateCount).toBe(1);
    });

    it('respects light baking budget when selecting async work for a frame', () => {
        const pipeline = new RenderPipeline({
            lightBaking: {
                enabled: true,
                maxTasksPerFrame: 3,
                budgetMs: 0.4,
            },
        });

        pipeline.enqueueBakeTask({
            id: 'bake:lightmap',
            type: 'lightmap',
            priority: 10,
        });
        pipeline.enqueueBakeTask({
            id: 'bake:probe',
            type: 'probe',
            priority: 9,
        });
        pipeline.enqueueBakeTask({
            id: 'bake:cache',
            type: 'irradiance-cache',
            priority: 8,
        });

        const result = pipeline.plan({
            frame: 1,
            deltaTime: 1 / 60,
            viewport: { width: 1280, height: 720 },
            camera: createCamera(),
            primitives: [createOpaquePrimitive()],
        });

        const bakePass = result.passes.find((pass) => pass.kind === 'light-bake');
        expect(bakePass?.metadata).toEqual(
            expect.objectContaining({
                taskIds: ['bake:lightmap'],
                budgetMs: 0.4,
            })
        );
    });

    it('tracks bake task retry lifecycle through the pipeline facade', () => {
        const pipeline = new RenderPipeline({
            lightBaking: {
                enabled: true,
                maxRetries: 1,
            },
        });

        pipeline.enqueueBakeTask({
            id: 'bake:retry',
            type: 'probe',
            priority: 2,
        });

        expect(pipeline.listBakeTasks()).toHaveLength(1);
        expect(pipeline.getBakeTask('bake:retry')?.state).toBe('queued');

        pipeline.failBakeTask('bake:retry', 'first failure');
        expect(pipeline.getBakeTask('bake:retry')).toEqual(
            expect.objectContaining({
                retries: 1,
                state: 'queued',
                lastError: 'first failure',
            })
        );

        pipeline.failBakeTask('bake:retry', 'second failure');
        expect(pipeline.getBakeTask('bake:retry')).toEqual(
            expect.objectContaining({
                retries: 2,
                state: 'failed',
                lastError: 'second failure',
            })
        );

        expect(pipeline.removeBakeTask('bake:retry')).toBe(true);
        expect(pipeline.getBakeTask('bake:retry')).toBeNull();
    });
});
