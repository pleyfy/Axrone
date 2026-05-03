import { createLightingUniformValueMap } from '@axrone/lighting';
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
        const values = createLightingUniformValueMap(lighting);

        this._writer.write(shader, 'u_ReceiveLighting', renderer.receiveLighting);

        for (const [name, value] of Object.entries(values)) {
            this._writer.write(shader, name, value);
        }

        if (!renderer.receiveLighting) {
            this._writer.write(shader, 'u_AmbientLight', Vec3.ZERO);
            this._writer.write(shader, 'u_SkyLight', Vec3.ZERO);
            this._writer.write(shader, 'u_GroundLight', Vec3.ZERO);
            this._writer.write(shader, 'u_DirectionalLightCount', 0);
            this._writer.write(shader, 'u_PointLightCount', 0);
            this._writer.write(shader, 'u_SpotLightCount', 0);
            this._writer.write(shader, 'u_LocalLightCount', 0);
        }
    }
}
