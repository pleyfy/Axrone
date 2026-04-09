import { cloneTextureBinding, decodeSceneValue, encodeSceneValue } from './serialization';
import type {
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneTextureBindingDefinition,
    SceneUniformValue,
} from './types';

export interface SceneMaterialTextureBinding {
    readonly textureId: string;
    readonly samplerId: string | null;
    readonly unit?: number;
}

export interface SceneMaterialResource {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms: Map<string, SceneUniformValue>;
    readonly textureBindings: Map<string, SceneMaterialTextureBinding>;
}

const cloneSceneValue = <T>(value: T): T => decodeSceneValue(encodeSceneValue(value)) as T;

const toHandle = (material: SceneMaterialResource): SceneMaterialHandle => ({
    id: material.id,
    shaderId: material.shaderId,
    textureBindings: [...material.textureBindings.keys()],
});

export const normalizeSceneTextureBinding = (
    binding: SceneTextureBindingDefinition
): SceneMaterialTextureBinding => {
    if (typeof binding === 'string') {
        return {
            textureId: binding,
            samplerId: null,
        };
    }

    return {
        textureId: binding.textureId,
        samplerId: binding.samplerId ?? null,
        unit: binding.unit,
    };
};

export const cloneSceneMaterialDefinition = (
    definition: SceneMaterialDefinition
): SceneMaterialDefinition => ({
    id: definition.id,
    shaderId: definition.shaderId,
    uniforms: definition.uniforms
        ? Object.fromEntries(
              Object.entries(definition.uniforms).map(([name, value]) => [
                  name,
                  cloneSceneValue(value),
              ])
          )
        : undefined,
    textures: definition.textures
        ? Object.fromEntries(
              Object.entries(definition.textures).map(([name, binding]) => [
                  name,
                  cloneTextureBinding(binding),
              ])
          )
        : undefined,
});

export class SceneMaterialRegistry {
    private readonly _resources = new Map<string, SceneMaterialResource>();
    private readonly _definitions = new Map<string, SceneMaterialDefinition>();

    get size(): number {
        return this._resources.size;
    }

    create(definition: SceneMaterialDefinition): SceneMaterialHandle {
        const resource: SceneMaterialResource = {
            id: definition.id,
            shaderId: definition.shaderId,
            uniforms: new Map(Object.entries(definition.uniforms ?? {})),
            textureBindings: new Map(
                Object.entries(definition.textures ?? {}).map(([name, binding]) => [
                    name,
                    normalizeSceneTextureBinding(binding),
                ])
            ),
        };

        this._resources.set(resource.id, resource);
        this._definitions.set(resource.id, cloneSceneMaterialDefinition(definition));
        return toHandle(resource);
    }

    get(id: string): SceneMaterialResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneMaterialHandle | null {
        const resource = this._resources.get(id);
        return resource ? toHandle(resource) : null;
    }

    setUniform(id: string, name: string, value: SceneUniformValue): boolean {
        const material = this._resources.get(id);
        if (!material) {
            return false;
        }

        material.uniforms.set(name, value);
        const definition = this._definitions.get(id);
        if (definition) {
            const uniforms = { ...(definition.uniforms ?? {}) };
            uniforms[name] = cloneSceneValue(value);
            this._definitions.set(id, {
                ...definition,
                uniforms,
            });
        }

        return true;
    }

    setTexture(id: string, name: string, binding: SceneTextureBindingDefinition): boolean {
        const material = this._resources.get(id);
        if (!material) {
            return false;
        }

        material.textureBindings.set(name, normalizeSceneTextureBinding(binding));
        const definition = this._definitions.get(id);
        if (definition) {
            this._definitions.set(id, {
                ...definition,
                textures: {
                    ...(definition.textures ?? {}),
                    [name]: cloneTextureBinding(binding),
                },
            });
        }

        return true;
    }

    getDefinitions(): readonly SceneMaterialDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneMaterialDefinition(definition)
        );
    }

    clear(): void {
        this._resources.clear();
        this._definitions.clear();
    }
}
