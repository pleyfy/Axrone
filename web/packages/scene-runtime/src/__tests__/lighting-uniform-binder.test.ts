import { Vec3 } from '@axrone/numeric';
import type { LightingUniformValueMap } from '@axrone/lighting';
import { describe, expect, it, vi } from 'vitest';
import { SceneLightingUniformBinder } from '../lighting-uniform-binder';
import type { SceneLightingState } from '../lighting-collector';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneUniformWriteTarget } from '../uniform-writer';

const createMockWriteTarget = (): SceneUniformWriteTarget & {
    writes: Map<string, unknown>;
} => {
    const writes = new Map<string, unknown>();
    return {
        writes,
        write: vi.fn((_shader: SceneShaderResource, name: string, value: unknown) => {
            writes.set(name, value);
        }),
    };
};

const createMockShader = (): SceneShaderResource =>
    ({
        id: 'test-shader',
        program: {} as WebGLProgram,
        uniformLocations: new Map(),
        uniformTypes: new Map(),
        uniformNames: [],
    }) as unknown as SceneShaderResource;

const createNeutralLightingState = (): SceneLightingState =>
    ({
        environment: {
            ambient: new Vec3(0.2, 0.2, 0.2),
            sky: new Vec3(0.5, 0.6, 0.7),
            ground: new Vec3(0.3, 0.25, 0.2),
            exposure: 1.0,
            gamma: 2.2,
        },
        stats: {
            selectedDirectionalCount: 0,
            selectedPointCount: 0,
            selectedSpotCount: 0,
            selectedLocalLightCount: 0,
        },
        directionalDirections: new Float32Array(0),
        directionalColors: new Float32Array(0),
        directionalAmbientColors: new Float32Array(0),
        directionalIntensities: new Float32Array(0),
        pointPositions: new Float32Array(0),
        pointColors: new Float32Array(0),
        pointIntensities: new Float32Array(0),
        pointRanges: new Float32Array(0),
        spotPositions: new Float32Array(0),
        spotDirections: new Float32Array(0),
        spotColors: new Float32Array(0),
        spotIntensities: new Float32Array(0),
        spotRanges: new Float32Array(0),
        spotInnerConeCosines: new Float32Array(0),
        spotOuterConeCosines: new Float32Array(0),
        localLightKinds: new Float32Array(0),
        localLightPositions: new Float32Array(0),
        localLightDirections: new Float32Array(0),
        localLightColors: new Float32Array(0),
        localLightIntensities: new Float32Array(0),
        localLightRanges: new Float32Array(0),
        localLightInnerConeCosines: new Float32Array(0),
        localLightOuterConeCosines: new Float32Array(0),
    }) as unknown as SceneLightingState;

describe('SceneLightingUniformBinder', () => {
    it('binds neutral (non-zero) ambient lighting when receiveLighting is false', () => {
        const target = createMockWriteTarget();
        const shader = createMockShader();
        const binder = new SceneLightingUniformBinder(target);
        const lighting = createNeutralLightingState();

        binder.apply(shader, { receiveLighting: false }, lighting);

        // Defense-in-depth: when receiveLighting is false the binder must
        // write NON-ZERO neutral values for environment lighting so PBR
        // shaders render flat albedo instead of pure black.
        const ambient = target.writes.get('u_AmbientLight') as Vec3;
        const sky = target.writes.get('u_SkyLight') as Vec3;
        const ground = target.writes.get('u_GroundLight') as Vec3;

        expect(ambient).toBeDefined();
        expect(sky).toBeDefined();
        expect(ground).toBeDefined();

        // All three must be non-zero (unit intensity for neutral display)
        expect(ambient.x).toBeGreaterThan(0);
        expect(ambient.y).toBeGreaterThan(0);
        expect(ambient.z).toBeGreaterThan(0);
        expect(sky.x).toBeGreaterThan(0);
        expect(sky.y).toBeGreaterThan(0);
        expect(sky.z).toBeGreaterThan(0);
        expect(ground.x).toBeGreaterThan(0);
        expect(ground.y).toBeGreaterThan(0);
        expect(ground.z).toBeGreaterThan(0);

        // Direct light counts must remain zeroed
        expect(target.writes.get('u_DirectionalLightCount')).toBe(0);
        expect(target.writes.get('u_PointLightCount')).toBe(0);
        expect(target.writes.get('u_SpotLightCount')).toBe(0);
        expect(target.writes.get('u_LocalLightCount')).toBe(0);
    });

    it('uses precomputed frame values instead of rebuilding the map', () => {
        const target = createMockWriteTarget();
        const shader = createMockShader();
        const binder = new SceneLightingUniformBinder(target);
        const lighting = createNeutralLightingState();

        const precomputed = {
            u_AmbientLight: new Vec3(9, 9, 9),
            u_DirectionalLightCount: 42,
        } as unknown as LightingUniformValueMap;

        binder.apply(shader, { receiveLighting: true }, lighting, precomputed);

        // Values come from the precomputed frame map, not from the state
        // (which would yield the neutral ambient and a zero count).
        const ambient = target.writes.get('u_AmbientLight') as Vec3;
        expect(ambient.x).toBe(9);
        expect(target.writes.get('u_DirectionalLightCount')).toBe(42);
    });

    it('writes the receiveLighting flag to the shader', () => {
        const target = createMockWriteTarget();
        const shader = createMockShader();
        const binder = new SceneLightingUniformBinder(target);
        const lighting = createNeutralLightingState();

        binder.apply(shader, { receiveLighting: false }, lighting);
        expect(target.writes.get('u_ReceiveLighting')).toBe(false);

        target.writes.clear();
        binder.apply(shader, { receiveLighting: true }, lighting);
        expect(target.writes.get('u_ReceiveLighting')).toBe(true);
    });
});
