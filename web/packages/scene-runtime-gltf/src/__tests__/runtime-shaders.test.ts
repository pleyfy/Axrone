import { describe, expect, it } from 'vitest';
import {
    GLTF_PBR_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    createGltfPbrShaderDefinition,
    createGltfRuntimeSurfaceDefinition,
    createGltfUnlitShaderDefinition,
    resolveGltfRuntimeShaderId,
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
        expect(definition.fragmentSource).toContain('vec3 linearToSrgb(vec3 color)');
        expect(definition.fragmentSource).toContain('o_Color = vec4(linearToSrgb(baseColor.rgb), baseColor.a);');
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
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_PointLightCount')
                ?.type
        ).toBe('int');
        expect(GLTF_PBR_SHADER_EFFECT.properties?.some((property) => property.name === '_MetallicFactor')).toBe(true);
        expect(GLTF_UNLIT_SHADER_EFFECT.properties?.some((property) => property.name === '_BaseColorTexture')).toBe(true);
        expect(definition.fragmentSource).toContain('uniform int u_LocalLightType[4];');
        expect(definition.fragmentSource).toContain('uniform int u_PointLightCount;');
        expect(definition.cull).toBe(true);
        expect(definition.blend).toBe(false);
    });

    it('derives shader variants from glTF material uniforms', () => {
        expect(resolveGltfRuntimeShaderId('gltf/pbr')).toBe('gltf/pbr');
        expect(resolveGltfRuntimeShaderId('gltf/pbr', { _DoubleSided: 1 })).toBe('gltf/pbr/double-sided');
        expect(resolveGltfRuntimeShaderId('gltf/pbr', { _AlphaMode: 2 })).toBe('gltf/pbr/blend');
        expect(resolveGltfRuntimeShaderId('gltf/unlit', { _AlphaMode: 2, _DoubleSided: 1 })).toBe(
            'gltf/unlit/blend/double-sided'
        );

        const variant = createGltfPbrShaderDefinition('gltf/pbr/blend/double-sided', {
            _AlphaMode: 2,
            _DoubleSided: 1,
        });

        expect(variant.cull).toBe(false);
        expect(variant.blend).toBe(true);
    });

    it('derives a runtime surface contract from glTF uniforms', () => {
        const surface = createGltfRuntimeSurfaceDefinition('gltf/pbr', {
            _AlphaMode: 1,
            _AlphaCutoff: 0.33,
            _DoubleSided: 1,
            _BaseColorFactor: [0.8, 0.7, 0.6, 1],
            _BaseColorTexture_TexCoord: 1,
            _MetallicFactor: 0.4,
            _RoughnessFactor: 0.2,
            _NormalTexture_TexCoord: 0,
            _NormalTexture_Scale: 1.5,
            _OcclusionTexture_TexCoord: 0,
            _OcclusionTexture_Strength: 0.75,
            _EmissiveFactor: [0.1, 0.2, 0.3],
            _EmissiveTexture_TexCoord: 0,
        });

        expect(surface).toMatchObject({
            shadingModel: 'pbr',
            alphaMode: 'mask',
            alphaCutoff: 0.33,
            metallic: 0.4,
            roughness: 0.2,
            normalScale: 1.5,
            occlusion: 0.75,
            emissive: [0.1, 0.2, 0.3],
            features: {
                useTwoSided: true,
                useAlbedoMap: true,
                useNormalMap: true,
                useOcclusionMap: true,
                useEmissiveMap: true,
                useAlphaTest: true,
                hasSecondUv: true,
            },
        });
    });
});
