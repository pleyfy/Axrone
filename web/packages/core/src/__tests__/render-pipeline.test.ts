import { Mat4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import { RenderPipeline } from '../renderer/webgl2/rendering';

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

const createTransparentPrimitive = () => ({
    id: 'primitive:transparent',
    meshId: 'mesh:glass',
    worldMatrix: new Mat4(),
    material: {
        id: 'material:glass',
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
});
