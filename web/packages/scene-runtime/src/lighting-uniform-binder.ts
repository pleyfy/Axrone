import { createLightingUniformValueMap, type LightingUniformValueMap } from '@axrone/lighting';
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
        lighting: SceneLightingState,
        precomputedValues?: LightingUniformValueMap
    ): void {
        // The values map is identical for every draw in a frame — the render
        // runtime precomputes it once per frame and passes it down, so the
        // per-draw path only pays for the uniform writes themselves.
        const values = precomputedValues ?? createLightingUniformValueMap(lighting);

        this._writer.write(shader, 'u_ReceiveLighting', renderer.receiveLighting);

        for (const [name, value] of Object.entries(values)) {
            if (value !== null && value !== undefined) {
                this._writer.write(shader, name, value);
            }
        }

        if (!renderer.receiveLighting) {
            // Bind NEUTRAL lighting instead of all-zeros so PBR shaders render
            // flat albedo (base color) rather than pure black. The IBL path in
            // the glTF/PBR fragment shader still executes when receiveLighting
            // is false (else branch), computing:
            //   irradiance = mix(u_GroundLight, u_SkyLight, hemiFactor)
            //   diffuse    = kD * irradiance * albedo
            // With sky/ground = ONE the irradiance is 1.0, yielding ~albedo
            // for non-metallic surfaces. Direct light counts stay zeroed so
            // no directional/point/spot contribution is added.
            this._writer.write(shader, 'u_AmbientLight', Vec3.ONE);
            this._writer.write(shader, 'u_SkyLight', Vec3.ONE);
            this._writer.write(shader, 'u_GroundLight', Vec3.ONE);
            this._writer.write(shader, 'u_DirectionalLightCount', 0);
            this._writer.write(shader, 'u_PointLightCount', 0);
            this._writer.write(shader, 'u_SpotLightCount', 0);
            this._writer.write(shader, 'u_LocalLightCount', 0);
        }
    }
}
