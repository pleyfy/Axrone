import { writeLegacyLightingUniformValues } from '@axrone/lighting';
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
        writeLegacyLightingUniformValues(lighting, renderer.receiveLighting, (name, value) => {
            this._writer.write(shader, name, value);
        });
    }
}
