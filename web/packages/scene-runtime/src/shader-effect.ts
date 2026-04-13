import {
    cloneRenderShaderEffectDefinition,
    compileRenderShaderEffect,
    type RenderShaderEffectDefinition,
} from '@axrone/render-core';
import type { SceneMeshSemantic, SceneShaderDefinition } from './types';

export interface SceneShaderDefinitionFromEffectOptions {
    readonly id?: string;
    readonly attributes?: Partial<Record<SceneMeshSemantic, string>>;
    readonly uniforms?: readonly string[];
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export const createSceneShaderDefinitionFromEffect = (
    effect: RenderShaderEffectDefinition,
    options: SceneShaderDefinitionFromEffectOptions = {}
): SceneShaderDefinition => {
    const normalizedEffect = cloneRenderShaderEffectDefinition({
        ...effect,
        id: options.id ?? effect.id,
    });
    const compiledEffect = compileRenderShaderEffect(normalizedEffect);

    return {
        id: normalizedEffect.id,
        effect: normalizedEffect,
        vertexSource: compiledEffect.vertexSource,
        fragmentSource: compiledEffect.fragmentSource,
        attributes: options.attributes ? { ...options.attributes } : undefined,
        uniforms: options.uniforms ? [...options.uniforms] : [...compiledEffect.uniformNames],
        depthTest: options.depthTest ?? normalizedEffect.renderState?.depthTest,
        cull: options.cull ?? normalizedEffect.renderState?.cull,
        blend: options.blend ?? normalizedEffect.renderState?.blend,
    };
};