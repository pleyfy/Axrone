import { Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import {
    createLegacyLightingUniformLayout,
    LEGACY_LIGHTING_LOCAL_LIGHT_TYPES,
    writeLegacyLightingUniformValues,
} from '../legacy-uniform-contract';

const createLegacyLightingSource = () => ({
    ambient: new Vec3(0.1, 0.2, 0.3),
    skyLight: new Vec3(0.4, 0.5, 0.6),
    groundLight: new Vec3(0.7, 0.8, 0.9),
    hasDirectional: true,
    directionalDirection: new Vec3(0, -1, 0),
    directionalColor: new Vec3(0.9, 0.8, 0.7),
    directionalIntensity: 3,
    pointLightPosition: new Vec3(1, 2, 3),
    pointLightColor: new Vec3(1, 0, 0),
    pointLightIntensity: 2,
    pointLightRange: 9,
    spotLightPosition: new Vec3(4, 5, 6),
    spotLightDirection: new Vec3(0, -1, 0),
    spotLightColor: new Vec3(0, 0, 1),
    spotLightIntensity: 6,
    spotLightRange: 12,
    spotLightInnerCone: 0.2,
    spotLightOuterCone: 0.6,
    pointCount: 1,
    spotCount: 1,
    localLightCount: 2,
    localLightTypes: new Int32Array([
        LEGACY_LIGHTING_LOCAL_LIGHT_TYPES.point,
        LEGACY_LIGHTING_LOCAL_LIGHT_TYPES.spot,
    ]),
    localLightPositions: new Float32Array([1, 2, 3, 4, 5, 6]),
    localLightDirections: new Float32Array([0, -1, 0, 0, -1, 0]),
    localLightColors: new Float32Array([1, 0, 0, 0, 0, 1]),
    localLightIntensities: new Float32Array([2, 6]),
    localLightRanges: new Float32Array([9, 12]),
    localLightInnerCones: new Float32Array([0, 0.2]),
    localLightOuterCones: new Float32Array([0, 0.6]),
});

describe('legacy lighting uniform contract', () => {
    it('describes the legacy shader contract with configurable local light capacity', () => {
        const layout = createLegacyLightingUniformLayout({ maxLocalLights: 6 });

        expect(layout.maxLocalLights).toBe(6);
        expect(layout.names.localLightType).toBe('u_LocalLightType');
        expect(layout.properties.find((property) => property.name === 'u_ReceiveLighting')?.scope).toBe('system');
        expect(layout.properties.find((property) => property.name === 'u_LocalLightPosition')?.arrayLength).toBe(6);
    });

    it('writes gated scalar uniforms while preserving legacy array payload references', () => {
        const source = createLegacyLightingSource();
        const writes = new Map<string, unknown>();

        writeLegacyLightingUniformValues(source, false, (name, value) => {
            writes.set(name, value);
        });

        expect(writes.get('u_ReceiveLighting')).toBe(false);
        expect(writes.get('u_AmbientLight')).toBe(Vec3.ZERO);
        expect(writes.get('u_LightDirection')).toBe(source.directionalDirection);
        expect(writes.get('u_LightIntensity')).toBe(0);
        expect(writes.get('u_LocalLightCount')).toBe(0);
        expect(writes.get('u_LocalLightType')).toBe(source.localLightTypes);
        expect(writes.get('u_LocalLightOuterCone')).toBe(source.localLightOuterCones);
    });
});