import { Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { SceneLightingState } from '@axrone/scene-3d';
import { SceneLightingUniformBinder } from '@axrone/scene-3d';
import type { SceneShaderResource } from '@axrone/scene-3d';
import type { SceneUniformWriteTarget } from '@axrone/scene-3d';

describe('SceneLightingUniformBinder', () => {
    it('writes zeroed lighting controls when the renderer does not receive lighting', () => {
        const writer = {
            write: vi.fn(),
        } as unknown as SceneUniformWriteTarget;
        const binder = new SceneLightingUniformBinder(writer);
        const shader = {} as SceneShaderResource;
        const lighting = {
            ambient: new Vec3(0.4, 0.3, 0.2),
            hasDirectional: true,
            directionalDirection: new Vec3(0, -1, 0),
            directionalColor: new Vec3(1, 0.8, 0.6),
            directionalIntensity: 5,
            pointCount: 2,
            pointLightPosition: new Float32Array([1, 2, 3, 4, 5, 6]),
            pointLightColor: new Float32Array([1, 0, 0, 0, 1, 0]),
            pointLightIntensity: new Float32Array([2, 3]),
            pointLightRange: new Float32Array([10, 12]),
            spotCount: 1,
            spotLightPosition: new Float32Array([7, 8, 9]),
            spotLightDirection: new Float32Array([0, -1, 0]),
            spotLightColor: new Float32Array([0, 0, 1]),
            spotLightIntensity: new Float32Array([4]),
            spotLightRange: new Float32Array([14]),
            spotLightInnerCone: new Float32Array([0.2]),
            spotLightOuterCone: new Float32Array([0.4]),
            localLightCount: 3,
            localLightTypes: new Int32Array([0, 0, 1]),
            localLightPositions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
            localLightDirections: new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]),
            localLightColors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
            localLightIntensities: new Float32Array([1, 2, 3]),
            localLightRanges: new Float32Array([5, 6, 7]),
            localLightInnerCones: new Float32Array([0.1, 0.2, 0.3]),
            localLightOuterCones: new Float32Array([0.3, 0.4, 0.5]),
        } satisfies SceneLightingState;

        binder.apply(shader, { receiveLighting: false }, lighting);

        expect(writer.write).toHaveBeenCalledWith(shader, 'u_ReceiveLighting', false);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_AmbientLight', Vec3.ZERO);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_LightColor', Vec3.ZERO);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_LightIntensity', 0);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_PointLightCount', 0);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_SpotLightCount', 0);
        expect(writer.write).toHaveBeenCalledWith(shader, 'u_LocalLightCount', 0);
        expect(writer.write).toHaveBeenCalledWith(
            shader,
            'u_LocalLightPosition',
            lighting.localLightPositions
        );
    });
});
