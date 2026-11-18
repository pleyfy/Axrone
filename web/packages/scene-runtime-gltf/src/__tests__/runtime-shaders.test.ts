import { describe, expect, it } from 'vitest';
import { compileRenderShaderEffect } from '@axrone/scene-runtime';
import {
    GLTF_PBR_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    createGltfPbrShaderDefinition,
    createGltfRuntimeMaterialPasses,
    createGltfRuntimeSurfaceDefinition,
    createGltfRuntimeSurfaceFeatures,
    createGltfUnlitShaderDefinition,
    resolveGltfRuntimeShaderId,
} from '@axrone/scene-runtime-gltf';
import {
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
    GLTF_TOON_SHADER_EFFECT,
    resolveGltfShaderDefinition,
} from '../internal/runtime-shaders';
import { MAX_GLTF_SKIN_JOINTS } from '../internal/gltf-shader-libraries';
import { GLTF_PBR_SHADER_EFFECT as GLTF_PBR_SHADER_EFFECT_FROM_PBR_MODULE } from '../internal/gltf-shader-effects-pbr';
import { GLTF_UNLIT_SHADER_EFFECT as GLTF_UNLIT_SHADER_EFFECT_FROM_UNLIT_MODULE } from '../internal/gltf-shader-effects-unlit';
import { GLTF_TOON_SHADER_EFFECT as GLTF_TOON_SHADER_EFFECT_FROM_TOON_MODULE } from '../internal/gltf-shader-effects-toon';

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
        expect(definition.fragmentSource).toContain('o_Color = vec4(linearToSrgb(finalColor), baseColor.a);');
        expect(definition.fragmentSource).toContain('#ifdef FOG');
        expect(definition.fragmentSource).toContain('applyFog(finalColor, v_WorldPosition, u_CameraPosition)');
        expect(definition.fragmentSource).toContain('in vec3 v_WorldPosition;');
    });

    it('builds the built-in pbr shader from structured effect metadata with uniform arrays', () => {
        const definition = createGltfPbrShaderDefinition();

        expect(definition.effect?.id).toBe('gltf/pbr');
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_JointMatrices')
                ?.arrayLength
        ).toBe(MAX_GLTF_SKIN_JOINTS);
        expect(MAX_GLTF_SKIN_JOINTS * 4).toBeLessThanOrEqual(192);
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_DirectionalLightDirection')
                ?.arrayLength
        ).toBe(1);
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_PointLightPosition')
                ?.arrayLength
        ).toBe(4);
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_SpotLightInnerConeCosine')
                ?.arrayLength
        ).toBe(4);
        expect(
            definition.effect?.properties?.find((property) => property.name === 'u_PointLightCount')
                ?.type
        ).toBe('int');
        expect(definition.effect?.properties?.some((property) => property.name === 'u_LocalLightType')).toBe(false);
        expect(GLTF_PBR_SHADER_EFFECT.properties?.some((property) => property.name === '_MetallicFactor')).toBe(true);
        expect(GLTF_PBR_SHADER_EFFECT.properties?.some((property) => property.name === '_ClearcoatFactor')).toBe(true);
        expect(
            GLTF_PBR_SHADER_EFFECT.properties?.some(
                (property) => property.name === '_ClearcoatNormalTexture_Scale'
            )
        ).toBe(true);
        expect(GLTF_UNLIT_SHADER_EFFECT.properties?.some((property) => property.name === '_BaseColorTexture')).toBe(true);
        expect(definition.fragmentSource).toContain('uniform vec3 u_DirectionalLightDirection[1];');
        expect(definition.fragmentSource).toContain('uniform int u_PointLightCount;');
        expect(definition.fragmentSource).toContain('uniform float u_SpotLightInnerConeCosine[4];');
        expect(definition.fragmentSource).toContain('uniform sampler2D _ClearcoatTexture;');
        expect(definition.fragmentSource).toContain('vec3 resolveClearcoatNormal(vec3 baseNormal)');
        expect(definition.fragmentSource).toContain('vec3 evaluateClearcoatLight(');
        expect(definition.fragmentSource).not.toContain('u_LocalLightType');
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
            _ClearcoatFactor: 0.65,
            _ClearcoatRoughnessFactor: 0.15,
            _ClearcoatTexture_TexCoord: 0,
            _ClearcoatRoughnessTexture_TexCoord: 0,
            _ClearcoatNormalTexture_TexCoord: 0,
            _ClearcoatNormalTexture_Scale: 0.8,
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
            clearcoat: 0.65,
            clearcoatRoughness: 0.15,
            clearcoatNormalScale: 0.8,
            normalScale: 1.5,
            occlusion: 0.75,
            emissive: [0.1, 0.2, 0.3],
            features: {
                useTwoSided: true,
                useAlbedoMap: true,
                useNormalMap: true,
                useOcclusionMap: true,
                useEmissiveMap: true,
                useClearcoat: true,
                useClearcoatMap: true,
                useClearcoatRoughnessMap: true,
                useClearcoatNormalMap: true,
                useAlphaTest: true,
                hasSecondUv: true,
            },
        });
    });

    describe('createGltfRuntimeSurfaceFeatures', () => {
        it('disables all PBR-specific features for unlit shaders', () => {
            const features = createGltfRuntimeSurfaceFeatures('gltf/unlit', {
                _NormalTexture_TexCoord: 0,
                _MetallicRoughnessTexture_TexCoord: 0,
                _ClearcoatFactor: 1,
                _ClearcoatTexture_TexCoord: 0,
            });

            expect(features.useNormalMap).toBe(false);
            expect(features.useMetallicRoughnessMap).toBe(false);
            expect(features.useOcclusionMap).toBe(false);
            expect(features.useEmissiveMap).toBe(false);
            expect(features.useClearcoat).toBe(false);
            expect(features.useClearcoatMap).toBe(false);
            expect(features.useClearcoatRoughnessMap).toBe(false);
            expect(features.useClearcoatNormalMap).toBe(false);
            expect(features.useAnisotropy).toBe(false);
            expect(features.useSheen).toBe(false);
            expect(features.useSubsurface).toBe(false);
            expect(features.useTransmission).toBe(false);
            expect(features.useIridescence).toBe(false);
        });

        it('enables anisotropy, sheen, subsurface, transmission, and iridescence flags', () => {
            const features = createGltfRuntimeSurfaceFeatures('gltf/pbr', {
                _AnisotropyFactor: 0.8,
                _SheenFactor: 0.5,
                _SubsurfaceFactor: 0.3,
                _TransmissionFactor: 0.9,
                _IridescenceFactor: 0.6,
            });

            expect(features.useAnisotropy).toBe(true);
            expect(features.useSheen).toBe(true);
            expect(features.useSubsurface).toBe(true);
            expect(features.useTransmission).toBe(true);
            expect(features.useIridescence).toBe(true);
        });

        it('sets hasSecondUv when any texture uses texCoord 1', () => {
            const features = createGltfRuntimeSurfaceFeatures('gltf/pbr', {
                _EmissiveTexture_TexCoord: 1,
            });

            expect(features.hasSecondUv).toBe(true);
        });

        it('enables useAlphaTest only for MASK mode (0.5 <= AlphaMode < 1.5)', () => {
            const maskFeatures = createGltfRuntimeSurfaceFeatures('gltf/pbr', { _AlphaMode: 1 });
            expect(maskFeatures.useAlphaTest).toBe(true);

            const opaqueFeatures = createGltfRuntimeSurfaceFeatures('gltf/pbr', { _AlphaMode: 0 });
            expect(opaqueFeatures.useAlphaTest).toBe(false);

            const blendFeatures = createGltfRuntimeSurfaceFeatures('gltf/pbr', { _AlphaMode: 2 });
            expect(blendFeatures.useAlphaTest).toBe(false);
        });
    });

    describe('createGltfRuntimeMaterialPasses', () => {
        it('produces 3 passes for opaque mode with depthWrite true', () => {
            const passes = createGltfRuntimeMaterialPasses({ _AlphaMode: 0 });

            expect(passes).toHaveLength(3);
            expect(passes.map((p) => p.id)).toEqual(['main', 'forward-add', 'shadow-caster']);

            const mainPass = passes[0];
            expect(mainPass.depthStencilState.depthWrite).toBe(true);
            expect(mainPass.blendState.targets[0].blend).toBe(false);
            expect(mainPass.rasterizerState.cullMode).toBe('back');
        });

        it('enables blend for BLEND mode with correct factors', () => {
            const passes = createGltfRuntimeMaterialPasses({ _AlphaMode: 2 });

            const mainPass = passes[0];
            expect(mainPass.depthStencilState.depthWrite).toBe(false);
            expect(mainPass.blendState.targets[0].blend).toBe(true);
            expect(mainPass.blendState.targets[0].srcColorFactor).toBe('src-alpha');
            expect(mainPass.blendState.targets[0].dstColorFactor).toBe('one-minus-src-alpha');
        });

        it('sets shadow-caster priority to 1 for MASK mode', () => {
            const passes = createGltfRuntimeMaterialPasses({ _AlphaMode: 1 });

            const shadowPass = passes[2];
            expect(shadowPass.id).toBe('shadow-caster');
            expect((shadowPass as any).priority).toBe(1);
        });

        it('sets cullMode to none for double-sided materials', () => {
            const passes = createGltfRuntimeMaterialPasses({ _DoubleSided: 1 });

            expect(passes[0].rasterizerState.cullMode).toBe('none');
        });

        it('returns a frozen array', () => {
            const passes = createGltfRuntimeMaterialPasses();

            expect(Object.isFrozen(passes)).toBe(true);
        });

        it('appends the outline pass only for toon shaders with a positive outline width', () => {
            const outlinePasses = createGltfRuntimeMaterialPasses({ _OutlineWidth: 0.02 }, 'gltf/toon');

            expect(outlinePasses).toHaveLength(4);
            expect(outlinePasses.map((pass) => pass.id)).toEqual([
                'main',
                'forward-add',
                'shadow-caster',
                'outline',
            ]);

            const outlinePass = outlinePasses[3];
            expect(outlinePass.shaderId).toBe('gltf/toon-outline');
            expect(outlinePass.phase).toBe('outline');
            expect(outlinePass.rasterizerState.cullMode).toBe('front');
            expect(outlinePass.depthStencilState.depthWrite).toBe(true);

            const zeroWidthPasses = createGltfRuntimeMaterialPasses({}, 'gltf/toon');
            expect(zeroWidthPasses).toHaveLength(3);
            expect(zeroWidthPasses.map((pass) => pass.id)).toEqual([
                'main',
                'forward-add',
                'shadow-caster',
            ]);

            const pbrPasses = createGltfRuntimeMaterialPasses({ _OutlineWidth: 0.02 }, 'gltf/pbr');
            expect(pbrPasses).toHaveLength(3);
            expect(pbrPasses.map((pass) => pass.id)).toEqual([
                'main',
                'forward-add',
                'shadow-caster',
            ]);

            const legacyPasses = createGltfRuntimeMaterialPasses({ _OutlineWidth: 0.02 });
            expect(legacyPasses).toHaveLength(3);
            expect(legacyPasses.map((pass) => pass.id)).toEqual([
                'main',
                'forward-add',
                'shadow-caster',
            ]);
        });

        it('maps toon variant shader ids onto the outline shader variant', () => {
            const passes = createGltfRuntimeMaterialPasses(
                { _OutlineWidth: 0.02, _AlphaMode: 2 },
                'gltf/toon/blend'
            );

            expect(passes[3].shaderId).toBe('gltf/toon-outline/blend');
        });
    });

    describe('resolveGltfShaderDefinition', () => {
        it('returns PBR definition for gltf/pbr base ID', () => {
            const result = resolveGltfShaderDefinition('gltf/pbr');

            expect(result).toBeDefined();
            expect(result!.effect?.id).toBe('gltf/pbr');
        });

        it('returns PBR blend variant with correct cull/blend state', () => {
            const result = resolveGltfShaderDefinition('gltf/pbr/blend');

            expect(result).toBeDefined();
            expect(result!.blend).toBe(true);
            expect(result!.cull).toBe(true);
        });

        it('returns unlit definition for gltf/unlit base ID', () => {
            const result = resolveGltfShaderDefinition('gltf/unlit');

            expect(result).toBeDefined();
            expect(result!.effect?.id).toBe('gltf/unlit');
        });

        it('delegates to custom resolveShaderDefinition callback', () => {
            const customDef = { id: 'custom/shader', effect: { id: 'custom/effect' } } as any;
            const callback = (id: string) => (id === 'custom/shader' ? customDef : undefined);

            const result = resolveGltfShaderDefinition('custom/shader', callback);

            expect(result).toBe(customDef);
        });

        it('returns undefined for unknown shader with no callback', () => {
            const result = resolveGltfShaderDefinition('unknown/shader');

            expect(result).toBeUndefined();
        });

        it('resolves the toon outline shader and the toon base shader', () => {
            const outline = resolveGltfShaderDefinition('gltf/toon-outline');

            expect(outline).toBeDefined();
            expect(outline!.id).toBe('gltf/toon-outline');
            expect(outline!.effect?.id).toBe('gltf/toon-outline');
            expect(outline!.effect).toEqual(GLTF_TOON_OUTLINE_SHADER_EFFECT);

            const toon = resolveGltfShaderDefinition('gltf/toon');

            expect(toon).toBeDefined();
            expect(toon!.effect?.id).toBe('gltf/toon');
        });
    });

    describe('createGltfRuntimeSurfaceDefinition material model reporting', () => {
        it('reports the toon material model for toon shaders', () => {
            expect(createGltfRuntimeSurfaceDefinition('gltf/toon').shadingModel).toBe('toon');
            expect(createGltfRuntimeSurfaceDefinition('gltf/toon/blend').shadingModel).toBe('toon');
            expect(createGltfRuntimeSurfaceDefinition('gltf/pbr').shadingModel).toBe('pbr');
            expect(createGltfRuntimeSurfaceDefinition('gltf/unlit').shadingModel).toBe('unlit');
        });
    });

    describe('GLTF_TOON_OUTLINE_SHADER_EFFECT', () => {
        const compiledOutline = compileRenderShaderEffect(GLTF_TOON_OUTLINE_SHADER_EFFECT);

        it('has the outline effect id', () => {
            expect(GLTF_TOON_OUTLINE_SHADER_EFFECT.id).toBe('gltf/toon-outline');
        });

        it('compiles a vertex stage that skins, extrudes and guards zero-length normals', () => {
            expect(compiledOutline.vertexSource).toContain('mat4 skin = resolveSkinMatrix();');
            expect(compiledOutline.vertexSource).toContain(
                'vec3 extrudeDirection = length(localNormal) > 0.0001 ? normalize(localNormal) : vec3(0.0);'
            );
            expect(compiledOutline.vertexSource).toContain(
                'localPosition += vec4(extrudeDirection * (_OutlineWidth * 0.01), 0.0);'
            );
            expect(compiledOutline.vertexSource).toContain('uniform float _OutlineWidth;');
            expect(compiledOutline.vertexSource).toContain(
                'layout(location = 9) in uvec4 a_Joints0;'
            );
            expect(compiledOutline.vertexSource).toContain('layout(location = 10) in vec4 a_Weights0;');
        });

        it('compiles a fragment stage that discards without an outline width and outputs sRGB', () => {
            expect(compiledOutline.fragmentSource).toContain('if (_OutlineWidth <= 0.0) {');
            expect(compiledOutline.fragmentSource).toContain('discard;');
            expect(compiledOutline.fragmentSource).toContain(
                'o_Color = vec4(linearToSrgb(_OutlineColor), alpha);'
            );
            expect(compiledOutline.fragmentSource).toContain('precision mediump float;');
            expect(compiledOutline.fragmentSource).toContain('uniform float _AlphaCutoff;');
        });

        it('declares front-face culling with depth writes in its render profile', () => {
            expect(GLTF_TOON_OUTLINE_SHADER_EFFECT.renderState?.cullMode).toBe('front');
            expect(GLTF_TOON_OUTLINE_SHADER_EFFECT.renderState?.depthWrite).toBe(true);
            expect(GLTF_TOON_OUTLINE_SHADER_EFFECT.renderState?.depthTest).toBe(true);
            expect(GLTF_TOON_OUTLINE_SHADER_EFFECT.renderState?.blend).toBe(false);
        });

        it('declares the outline and vertex offset properties with defaults', () => {
            const outlineWidth = GLTF_TOON_OUTLINE_SHADER_EFFECT.properties?.find(
                (property) => property.name === '_OutlineWidth'
            );
            const vertexOffset = GLTF_TOON_OUTLINE_SHADER_EFFECT.properties?.find(
                (property) => property.name === '_VertexOffset'
            );

            expect(outlineWidth?.defaultValue).toBe(0);
            expect(vertexOffset?.type).toBe('vec3');
            expect(vertexOffset?.defaultValue).toEqual([0, 0, 0]);
            expect(vertexOffset?.stages).toEqual(['vertex']);
        });
    });

    describe('toon vertex offset support', () => {
        it('declares _VertexOffset on the toon effect and applies it in the vertex stage', () => {
            const vertexOffset = GLTF_TOON_SHADER_EFFECT.properties?.find(
                (property) => property.name === '_VertexOffset'
            );

            expect(vertexOffset?.type).toBe('vec3');
            expect(vertexOffset?.defaultValue).toEqual([0, 0, 0]);

            const vertexLines = GLTF_TOON_SHADER_EFFECT.vertex.main.join('\n');

            expect(vertexLines).toContain('localPosition += vec4(_VertexOffset, 0.0);');
            expect(vertexLines).toContain('if (any(greaterThan(abs(_VertexOffset), vec3(0.0)))) {');
        });

        it('keeps every existing toon property name', () => {
            const propertyNames = GLTF_TOON_SHADER_EFFECT.properties?.map((p) => p.name) ?? [];

            expect(propertyNames).toContain('_ShadowColor');
            expect(propertyNames).toContain('_ShadowThreshold');
            expect(propertyNames).toContain('_ShadowSmoothness');
            expect(propertyNames).toContain('_HighlightThreshold');
            expect(propertyNames).toContain('_HighlightColor');
            expect(propertyNames).toContain('_RimColor');
            expect(propertyNames).toContain('_RimThreshold');
            expect(propertyNames).toContain('_RimSmoothness');
            expect(propertyNames).toContain('_OutlineWidth');
            expect(propertyNames).toContain('_OutlineColor');
        });

        it('describes the outline pass through the toon technique', () => {
            const passes = GLTF_TOON_SHADER_EFFECT.techniques?.[0]?.passes ?? [];

            expect(passes.map((pass) => pass.id)).toEqual(['main', 'outline']);
            expect(passes[1].renderState?.cullMode).toBe('front');
            expect(passes[1].fragment?.main.join('\n')).toContain('linearToSrgb(_OutlineColor)');
        });
    });

    describe('GLTF_TOON_SHADER_EFFECT', () => {
        it('has the correct effect id', () => {
            expect(GLTF_TOON_SHADER_EFFECT.id).toBe('gltf/toon');
        });

        it('contains toon-specific properties', () => {
            const propertyNames = GLTF_TOON_SHADER_EFFECT.properties?.map((p) => p.name) ?? [];

            expect(propertyNames).toContain('_ShadowColor');
            expect(propertyNames).toContain('_RimColor');
            expect(propertyNames).toContain('_OutlineWidth');
        });

        it('contains toon shading logic in fragment main', () => {
            const fragmentLines = GLTF_TOON_SHADER_EFFECT.fragment?.main ?? [];
            const joined = fragmentLines.join('\n');

            expect(joined).toContain('_ShadowColor');
            expect(joined).toContain('toonShade');
        });
    });

    describe('createGltfUnlitShaderDefinition with variant uniforms', () => {
        it('creates blend variant with blend enabled', () => {
            const variant = createGltfUnlitShaderDefinition('gltf/unlit/blend', { _AlphaMode: 2 });

            expect(variant.blend).toBe(true);
        });

        it('creates double-sided variant with cull disabled', () => {
            const variant = createGltfUnlitShaderDefinition('gltf/unlit/double-sided', {
                _DoubleSided: 1,
            });

            expect(variant.cull).toBe(false);
        });
    });

    describe('createGltfPbrShaderDefinition with custom ID', () => {
        it('generates a definition with the custom ID', () => {
            const custom = createGltfPbrShaderDefinition('gltf/pbr/custom');

            expect(custom.id).toBe('gltf/pbr/custom');
            expect(custom.effect?.id).toBe('gltf/pbr/custom');
        });
    });

    describe('runtime-shaders re-exports', () => {
        it('re-exports the moved shader effects without rebuilding them', () => {
            expect(GLTF_UNLIT_SHADER_EFFECT).toBe(GLTF_UNLIT_SHADER_EFFECT_FROM_UNLIT_MODULE);
            expect(GLTF_PBR_SHADER_EFFECT).toBe(GLTF_PBR_SHADER_EFFECT_FROM_PBR_MODULE);
            expect(GLTF_TOON_SHADER_EFFECT).toBe(GLTF_TOON_SHADER_EFFECT_FROM_TOON_MODULE);
        });
    });
});
