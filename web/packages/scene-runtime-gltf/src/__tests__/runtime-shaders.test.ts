import { describe, expect, it } from 'vitest';
import {
    GLTF_PBR_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    createGltfPbrShaderDefinition,
    createGltfUnlitShaderDefinition,
} from '@axrone/scene-runtime-gltf';

describe('scene-runtime glTF shader effects', () => {
    it('builds the built-in unlit shader from structured effect metadata', () => {
        const definition = createGltfUnlitShaderDefinition();

        expect(definition.effect?.id).toBe('gltf/unlit');
        expect(definition.uniforms).toContain('_BaseColorFactor');
        expect(
            definition.effect?.properties?.find((property) => property.name === '_AlphaMode')?.inspector
                ?.control
        ).toBe('select');
        expect(definition.fragmentSource).toContain('uniform vec4 _BaseColorFactor;');
    });

    it('builds the built-in pbr shader from structured effect metadata with uniform arrays', () => {
        const definition = createGltfPbrShaderDefinition();

        expect(definition.effect?.id).toBe('gltf/pbr');
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_JointMatrices')
                ?.arrayLength
        ).toBe(128);
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_LocalLightType')
                ?.arrayLength
        ).toBe(4);
        expect(GLTF_PBR_SHADER_EFFECT.properties?.some((property) => property.name === '_MetallicFactor')).toBe(true);
        expect(GLTF_UNLIT_SHADER_EFFECT.properties?.some((property) => property.name === '_BaseColorTexture')).toBe(true);
        expect(definition.fragmentSource).toContain('uniform int u_LocalLightType[4];');
    });
});
