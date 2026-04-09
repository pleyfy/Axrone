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

export interface SceneMaterialTextureSlot {
    readonly uniformName: string;
    readonly binding: SceneMaterialTextureBinding;
    readonly resolvedUnit: number;
}

export interface SceneMaterialResource {
    readonly id: string;
    readonly shaderId: string;
    readonly uniforms: Map<string, SceneUniformValue>;
    readonly textureBindings: Map<string, SceneMaterialTextureBinding>;
}

const cloneSceneValue = <T>(value: T): T => decodeSceneValue(encodeSceneValue(value)) as T;

const compareTextureBindings = (
    left: readonly [string, SceneMaterialTextureBinding],
    right: readonly [string, SceneMaterialTextureBinding]
): number => {
    const leftUnit = left[1].unit ?? Number.MAX_SAFE_INTEGER;
    const rightUnit = right[1].unit ?? Number.MAX_SAFE_INTEGER;
    return leftUnit - rightUnit || left[0].localeCompare(right[0]);
};

const toHandle = (material: SceneMaterialResource): SceneMaterialHandle => ({
    id: material.id,
    shaderId: material.shaderId,
    textureBindings: [...material.textureBindings.keys()],
});

const createTextureSlots = (
    material: SceneMaterialResource
): readonly SceneMaterialTextureSlot[] => {
    const assignments = [...material.textureBindings.entries()].sort(compareTextureBindings);
    const usedUnits = new Set<number>();
    const slots: SceneMaterialTextureSlot[] = [];
    let nextUnit = 0;

    for (const [uniformName, binding] of assignments) {
        let resolvedUnit = binding.unit;
        if (resolvedUnit === undefined) {
            while (usedUnits.has(nextUnit)) {
                nextUnit += 1;
            }
            resolvedUnit = nextUnit;
        }

        usedUnits.add(resolvedUnit);
        slots.push(
            Object.freeze({
                uniformName,
                binding,
                resolvedUnit,
            })
        );
    }

    return Object.freeze(slots);
};

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
    private readonly _handles = new Map<string, SceneMaterialHandle>();
    private readonly _textureSlots = new Map<string, readonly SceneMaterialTextureSlot[]>();

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
        const handle = toHandle(resource);
        this._handles.set(resource.id, handle);
        this._textureSlots.set(resource.id, createTextureSlots(resource));
        return handle;
    }

    get(id: string): SceneMaterialResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneMaterialHandle | null {
        return this._handles.get(id) ?? null;
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

        this._handles.set(id, toHandle(material));
        this._textureSlots.set(id, createTextureSlots(material));

        return true;
    }

    getTextureSlots(id: string): readonly SceneMaterialTextureSlot[] {
        return this._textureSlots.get(id) ?? Object.freeze([]);
    }

    getDefinitions(): readonly SceneMaterialDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneMaterialDefinition(definition)
        );
    }

    clear(): void {
        this._resources.clear();
        this._definitions.clear();
        this._handles.clear();
        this._textureSlots.clear();
    }
}
