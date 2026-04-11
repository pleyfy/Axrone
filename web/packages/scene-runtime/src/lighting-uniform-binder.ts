import { Vec3 } from '@axrone/numeric';
import type { MeshRenderer } from './components/mesh-renderer';
import type { SceneLightingState } from './lighting-collector';
import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformWriteTarget } from './uniform-writer';

export class SceneLightingUniformBinder {
    constructor(private readonly _writer: SceneUniformWriteTarget) {}

    apply(
        shader: SceneShaderResource,
        renderer: Pick<MeshRenderer, 'receiveLighting'>,
        lighting: SceneLightingState
    ): void {
        const receiveLighting = renderer.receiveLighting;

        this._writer.write(shader, 'u_ReceiveLighting', receiveLighting);
        this._writer.write(
            shader,
            'u_AmbientLight',
            receiveLighting ? lighting.ambient : Vec3.ZERO
        );
        this._writer.write(shader, 'u_LightDirection', lighting.directionalDirection);
        this._writer.write(
            shader,
            'u_LightColor',
            receiveLighting && lighting.hasDirectional ? lighting.directionalColor : Vec3.ZERO
        );
        this._writer.write(
            shader,
            'u_LightIntensity',
            receiveLighting && lighting.hasDirectional ? lighting.directionalIntensity : 0
        );
        this._writer.write(shader, 'u_PointLightCount', receiveLighting ? lighting.pointCount : 0);
        this._writer.write(shader, 'u_PointLightPosition', lighting.pointLightPosition);
        this._writer.write(
            shader,
            'u_PointLightColor',
            receiveLighting && lighting.pointCount > 0 ? lighting.pointLightColor : Vec3.ZERO
        );
        this._writer.write(
            shader,
            'u_PointLightIntensity',
            receiveLighting && lighting.pointCount > 0 ? lighting.pointLightIntensity : 0
        );
        this._writer.write(
            shader,
            'u_PointLightRange',
            receiveLighting && lighting.pointCount > 0 ? lighting.pointLightRange : 0
        );
        this._writer.write(shader, 'u_SpotLightCount', receiveLighting ? lighting.spotCount : 0);
        this._writer.write(shader, 'u_SpotLightPosition', lighting.spotLightPosition);
        this._writer.write(shader, 'u_SpotLightDirection', lighting.spotLightDirection);
        this._writer.write(
            shader,
            'u_SpotLightColor',
            receiveLighting && lighting.spotCount > 0 ? lighting.spotLightColor : Vec3.ZERO
        );
        this._writer.write(
            shader,
            'u_SpotLightIntensity',
            receiveLighting && lighting.spotCount > 0 ? lighting.spotLightIntensity : 0
        );
        this._writer.write(
            shader,
            'u_SpotLightRange',
            receiveLighting && lighting.spotCount > 0 ? lighting.spotLightRange : 0
        );
        this._writer.write(
            shader,
            'u_SpotLightInnerCone',
            receiveLighting && lighting.spotCount > 0 ? lighting.spotLightInnerCone : 0
        );
        this._writer.write(
            shader,
            'u_SpotLightOuterCone',
            receiveLighting && lighting.spotCount > 0 ? lighting.spotLightOuterCone : 0
        );
        this._writer.write(
            shader,
            'u_LocalLightCount',
            receiveLighting ? lighting.localLightCount : 0
        );
        this._writer.write(shader, 'u_LocalLightType', lighting.localLightTypes);
        this._writer.write(shader, 'u_LocalLightPosition', lighting.localLightPositions);
        this._writer.write(shader, 'u_LocalLightDirection', lighting.localLightDirections);
        this._writer.write(shader, 'u_LocalLightColor', lighting.localLightColors);
        this._writer.write(shader, 'u_LocalLightIntensity', lighting.localLightIntensities);
        this._writer.write(shader, 'u_LocalLightRange', lighting.localLightRanges);
        this._writer.write(shader, 'u_LocalLightInnerCone', lighting.localLightInnerCones);
        this._writer.write(shader, 'u_LocalLightOuterCone', lighting.localLightOuterCones);
    }
}
