import type { GltfMeshSemantic, GltfShaderDefinition } from '@axrone/asset-gltf';
import {
    createSceneShaderDefinitionFromEffect,
    type RenderShaderEffectDefinition,
} from '@axrone/scene-runtime';
import type {
    SceneMaterialSurfaceDefinition,
    SceneMaterialSurfaceFeaturesDefinition,
} from '@axrone/scene-runtime';
import {
    createGltfRuntimeMaterialPasses,
    createVariantShaderId,
    resolveVariantRenderState,
} from './gltf-render-state';
import { GLTF_PBR_SHADER_EFFECT, createGltfPbrShaderEffect } from './gltf-shader-effects-pbr';
import {
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
    GLTF_TOON_SHADER_EFFECT,
    createGltfToonOutlineShaderEffect,
    createGltfToonShaderEffect,
} from './gltf-shader-effects-toon';
import { GLTF_UNLIT_SHADER_EFFECT, createGltfUnlitShaderEffect } from './gltf-shader-effects-unlit';
import {
    GLTF_CLOTH_SHADER_EFFECT,
    GLTF_DECAL_SHADER_EFFECT,
    GLTF_FOLIAGE_SHADER_EFFECT,
    GLTF_HAIR_SHADER_EFFECT,
    GLTF_PARTICLE_SHADER_EFFECT,
    GLTF_REFRACTION_COPY_SHADER_EFFECT,
    GLTF_SSS_BLUR_SHADER_EFFECT,
    GLTF_VOLUME_SHADER_EFFECT,
    GLTF_WATER_SHADER_EFFECT,
    POST_PROCESS_CONTRACT_SHADER_EFFECT,
    V2_BUILTIN_SHADER_EFFECTS,
    createGltfClothShaderEffect,
    createGltfDecalShaderEffect,
    createGltfFoliageShaderEffect,
    createGltfHairShaderEffect,
    createGltfParticleShaderEffect,
    createGltfRefractionCopyShaderEffect,
    createGltfSssBlurShaderEffect,
    createGltfVolumeShaderEffect,
    createGltfWaterShaderEffect,
    createPostProcessContractShaderEffect,
} from './gltf-shader-effects-v2';
import {
    GLTF_PBR_ATTRIBUTES,
    GLTF_TOON_ATTRIBUTES,
    GLTF_UNLIT_ATTRIBUTES,
} from './gltf-shader-properties';

export {
    GLTF_CLOTH_SHADER_EFFECT,
    GLTF_DECAL_SHADER_EFFECT,
    GLTF_FOLIAGE_SHADER_EFFECT,
    GLTF_HAIR_SHADER_EFFECT,
    GLTF_PARTICLE_SHADER_EFFECT,
    GLTF_PBR_SHADER_EFFECT,
    GLTF_REFRACTION_COPY_SHADER_EFFECT,
    GLTF_SSS_BLUR_SHADER_EFFECT,
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
    GLTF_TOON_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    GLTF_VOLUME_SHADER_EFFECT,
    GLTF_WATER_SHADER_EFFECT,
    POST_PROCESS_CONTRACT_SHADER_EFFECT,
    V2_BUILTIN_SHADER_EFFECTS,
    createGltfClothShaderEffect,
    createGltfDecalShaderEffect,
    createGltfFoliageShaderEffect,
    createGltfHairShaderEffect,
    createGltfParticleShaderEffect,
    createGltfPbrShaderEffect,
    createGltfRefractionCopyShaderEffect,
    createGltfRuntimeMaterialPasses,
    createGltfSssBlurShaderEffect,
    createGltfToonOutlineShaderEffect,
    createGltfToonShaderEffect,
    createGltfUnlitShaderEffect,
    createGltfVolumeShaderEffect,
    createGltfWaterShaderEffect,
    createPostProcessContractShaderEffect,
    createVariantShaderId,
    resolveVariantRenderState,
};

const GLTF_SHADER_PBR_ID = 'gltf/pbr';
const GLTF_SHADER_UNLIT_ID = 'gltf/unlit';
const GLTF_SHADER_TOON_ID = 'gltf/toon';
const GLTF_SHADER_TOON_OUTLINE_ID = 'gltf/toon-outline';
const GLTF_SHADER_HAIR_ID = 'gltf/hair';
const GLTF_SHADER_CLOTH_ID = 'gltf/cloth';
const GLTF_SHADER_WATER_ID = 'gltf/water';
const GLTF_SHADER_FOLIAGE_ID = 'gltf/foliage';
const GLTF_SHADER_PARTICLE_ID = 'gltf/particle';
const GLTF_SHADER_DECAL_ID = 'gltf/decal';
const POST_PROCESS_CONTRACT_ID = 'post-process/contract';
const GLTF_SHADER_VOLUME_ID = 'gltf/volume';
const GLTF_SHADER_REFRACTION_COPY_ID = 'gltf/refraction-copy';
const GLTF_SHADER_SSS_BLUR_ID = 'gltf/sss-blur';
const GLTF_SHADER_DOUBLE_SIDED_SUFFIX = '/double-sided';
const GLTF_SHADER_BLEND_SUFFIX = '/blend';

export type GltfMaterialUniformMap = Readonly<Record<string, unknown>>;

const createGltfShaderDefinitionFromEffect = (
    effect: RenderShaderEffectDefinition,
    attributes: Partial<Record<GltfMeshSemantic, string>>
): GltfShaderDefinition => {
    const definition = createSceneShaderDefinitionFromEffect(effect);

    return {
        id: definition.id,
        vertexSource: definition.vertexSource ?? '',
        fragmentSource: definition.fragmentSource ?? '',
        effect: definition.effect,
        attributes: { ...attributes },
        uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
        depthTest: definition.depthTest,
        cull: definition.cull,
        blend: definition.blend,
    };
};

const normalizeNumericUniform = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    return fallback;
};

const isGltfBlendAlphaMode = (uniforms: GltfMaterialUniformMap | undefined): boolean =>
    normalizeNumericUniform(uniforms?._AlphaMode, 0) >= 1.5;

const isGltfDoubleSided = (uniforms: GltfMaterialUniformMap | undefined): boolean =>
    normalizeNumericUniform(uniforms?._DoubleSided, 0) >= 0.5;

export const createGltfRuntimeSurfaceFeatures = (
    shaderId: string,
    uniforms?: GltfMaterialUniformMap
): SceneMaterialSurfaceFeaturesDefinition => {
    const unlit = shaderId.startsWith(GLTF_SHADER_UNLIT_ID);
    const useClearcoatMap =
        !unlit && normalizeNumericUniform(uniforms?._ClearcoatTexture_TexCoord, -1) >= 0;
    const useClearcoatRoughnessMap =
        !unlit && normalizeNumericUniform(uniforms?._ClearcoatRoughnessTexture_TexCoord, -1) >= 0;
    const useClearcoatNormalMap =
        !unlit && normalizeNumericUniform(uniforms?._ClearcoatNormalTexture_TexCoord, -1) >= 0;

    return {
        useVertexColor: false,
        hasSecondUv: normalizeNumericUniform(uniforms?._BaseColorTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._MetallicRoughnessTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._NormalTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._OcclusionTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._EmissiveTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._ClearcoatTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._ClearcoatRoughnessTexture_TexCoord, 0) === 1 ||
            normalizeNumericUniform(uniforms?._ClearcoatNormalTexture_TexCoord, 0) === 1,
        useNormalMap: !unlit && normalizeNumericUniform(uniforms?._NormalTexture_TexCoord, -1) >= 0,
        useTwoSided: isGltfDoubleSided(uniforms),
        useAlbedoMap: normalizeNumericUniform(uniforms?._BaseColorTexture_TexCoord, -1) >= 0,
        useOpacityMap: normalizeNumericUniform(uniforms?._OpacityTexture_TexCoord, -1) >= 0,
        usePbrMap: false,
        useMetallicRoughnessMap:
            !unlit && normalizeNumericUniform(uniforms?._MetallicRoughnessTexture_TexCoord, -1) >= 0,
        useOcclusionMap: !unlit && normalizeNumericUniform(uniforms?._OcclusionTexture_TexCoord, -1) >= 0,
        useEmissiveMap: !unlit && normalizeNumericUniform(uniforms?._EmissiveTexture_TexCoord, -1) >= 0,
        useClearcoat:
            !unlit &&
            (normalizeNumericUniform(uniforms?._ClearcoatFactor, 0) > 0 ||
                useClearcoatMap ||
                useClearcoatRoughnessMap ||
                useClearcoatNormalMap),
        useClearcoatMap,
        useClearcoatRoughnessMap,
        useClearcoatNormalMap,
        useAlphaTest: normalizeNumericUniform(uniforms?._AlphaMode, 0) >= 0.5 && normalizeNumericUniform(uniforms?._AlphaMode, 0) < 1.5,
        useAnisotropy: !unlit && Math.abs(normalizeNumericUniform(uniforms?._AnisotropyFactor, 0)) > 0.001,
        useSheen: !unlit && normalizeNumericUniform(uniforms?._SheenFactor, 0) > 0.001,
        useSubsurface: !unlit && normalizeNumericUniform(uniforms?._SubsurfaceFactor, 0) > 0.001,
        useTransmission: !unlit && normalizeNumericUniform(uniforms?._TransmissionFactor, 0) > 0.001,
        useIridescence: !unlit && normalizeNumericUniform(uniforms?._IridescenceFactor, 0) > 0.001,
    };
};

const resolveRuntimeShadingModel = (
    shaderId: string
): SceneMaterialSurfaceDefinition['shadingModel'] => {
    if (shaderId.startsWith(GLTF_SHADER_UNLIT_ID)) return 'unlit';
    if (shaderId.startsWith(GLTF_SHADER_TOON_ID)) return 'toon';
    if (shaderId.startsWith(GLTF_SHADER_HAIR_ID)) return 'hair';
    if (shaderId.startsWith(GLTF_SHADER_CLOTH_ID)) return 'cloth';
    if (shaderId.startsWith(GLTF_SHADER_WATER_ID)) return 'water';
    if (shaderId.startsWith(GLTF_SHADER_FOLIAGE_ID)) return 'foliage';
    if (shaderId.startsWith(GLTF_SHADER_PARTICLE_ID)) return 'particle';
    if (shaderId.startsWith(GLTF_SHADER_DECAL_ID)) return 'decal';
    if (shaderId.startsWith(POST_PROCESS_CONTRACT_ID)) return 'post-process';
    if (shaderId.startsWith(GLTF_SHADER_VOLUME_ID)) return 'volume';
    if (shaderId === 'Render2D/Sprite') return 'sprite';
    return 'pbr';
};

export const createGltfRuntimeSurfaceDefinition = (
    shaderId: string,
    uniforms?: GltfMaterialUniformMap
): SceneMaterialSurfaceDefinition => ({
    shadingModel: resolveRuntimeShadingModel(shaderId),
    alphaMode:
        normalizeNumericUniform(uniforms?._AlphaMode, 0) >= 1.5
            ? 'blend'
            : normalizeNumericUniform(uniforms?._AlphaMode, 0) >= 0.5
              ? 'mask'
              : 'opaque',
    alphaCutoff: normalizeNumericUniform(uniforms?._AlphaCutoff, 0.5),
    pbrUvSet: 0,
    features: createGltfRuntimeSurfaceFeatures(shaderId, uniforms),
    tilingOffset: [1, 1, 0, 0],
    albedo: Array.isArray(uniforms?._BaseColorFactor)
        ? [
              Number((uniforms?._BaseColorFactor as readonly unknown[])[0] ?? 1),
              Number((uniforms?._BaseColorFactor as readonly unknown[])[1] ?? 1),
              Number((uniforms?._BaseColorFactor as readonly unknown[])[2] ?? 1),
              Number((uniforms?._BaseColorFactor as readonly unknown[])[3] ?? 1),
          ]
        : [1, 1, 1, 1],
    normalScale: normalizeNumericUniform(uniforms?._NormalTexture_Scale, 1),
    occlusion: normalizeNumericUniform(uniforms?._OcclusionTexture_Strength, 1),
    roughness: normalizeNumericUniform(uniforms?._RoughnessFactor, 1),
    metallic: normalizeNumericUniform(uniforms?._MetallicFactor, 1),
    clearcoat: normalizeNumericUniform(uniforms?._ClearcoatFactor, 0),
    clearcoatRoughness: normalizeNumericUniform(uniforms?._ClearcoatRoughnessFactor, 0),
    clearcoatNormalScale: normalizeNumericUniform(uniforms?._ClearcoatNormalTexture_Scale, 1),
    specularIntensity: 1,
    emissive: Array.isArray(uniforms?._EmissiveFactor)
        ? [
              Number((uniforms?._EmissiveFactor as readonly unknown[])[0] ?? 0),
              Number((uniforms?._EmissiveFactor as readonly unknown[])[1] ?? 0),
              Number((uniforms?._EmissiveFactor as readonly unknown[])[2] ?? 0),
          ]
        : [0, 0, 0],
    emissiveScale: [1, 1, 1],
    sheenFactor: normalizeNumericUniform(uniforms?._SheenFactor, 0),
    sheenColor: Array.isArray(uniforms?._SheenColorFactor)
        ? [
              Number((uniforms?._SheenColorFactor as readonly unknown[])[0] ?? 0),
              Number((uniforms?._SheenColorFactor as readonly unknown[])[1] ?? 0),
              Number((uniforms?._SheenColorFactor as readonly unknown[])[2] ?? 0),
          ]
        : [0, 0, 0],
    sheenRoughness: normalizeNumericUniform(uniforms?._SheenRoughnessFactor, 0.5),
    anisotropy: normalizeNumericUniform(uniforms?._AnisotropyFactor, 0),
    anisotropyRotation: normalizeNumericUniform(uniforms?._AnisotropyRotation, 0),
    subsurfaceFactor: normalizeNumericUniform(uniforms?._SubsurfaceFactor, 0),
    subsurfaceColor: Array.isArray(uniforms?._SubsurfaceColorFactor)
        ? [
              Number((uniforms?._SubsurfaceColorFactor as readonly unknown[])[0] ?? 1),
              Number((uniforms?._SubsurfaceColorFactor as readonly unknown[])[1] ?? 0.8),
              Number((uniforms?._SubsurfaceColorFactor as readonly unknown[])[2] ?? 0.6),
          ]
        : [1, 0.8, 0.6],
    subsurfaceThickness: normalizeNumericUniform(uniforms?._SubsurfaceThickness, 1),
    transmissionFactor: normalizeNumericUniform(uniforms?._TransmissionFactor, 0),
    ior: normalizeNumericUniform(uniforms?._IorFactor, 1.5),
    thickness: normalizeNumericUniform(uniforms?._ThicknessFactor, 0),
    iridescenceFactor: normalizeNumericUniform(uniforms?._IridescenceFactor, 0),
    iridescenceIor: normalizeNumericUniform(uniforms?._IridescenceIor, 1.3),
    iridescenceThickness: normalizeNumericUniform(uniforms?._IridescenceThickness, 400),
});

export const createGltfUnlitShaderDefinition = (
    id: string = GLTF_SHADER_UNLIT_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_UNLIT_ID ? GLTF_UNLIT_SHADER_EFFECT : createGltfUnlitShaderEffect(id),
        GLTF_UNLIT_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

export const createGltfPbrShaderDefinition = (
    id: string = GLTF_SHADER_PBR_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_PBR_ID ? GLTF_PBR_SHADER_EFFECT : createGltfPbrShaderEffect(id),
        GLTF_PBR_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

export const createGltfToonShaderDefinition = (
    id: string = GLTF_SHADER_TOON_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_TOON_ID ? GLTF_TOON_SHADER_EFFECT : createGltfToonShaderEffect(id),
        GLTF_TOON_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

export const createGltfToonOutlineShaderDefinition = (
    id: string = GLTF_SHADER_TOON_OUTLINE_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_TOON_OUTLINE_ID
            ? GLTF_TOON_OUTLINE_SHADER_EFFECT
            : createGltfToonOutlineShaderEffect(id),
        GLTF_TOON_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

const createV2ShaderDefinition = (
    id: string,
    baseId: string,
    singleton: RenderShaderEffectDefinition,
    factory: (effectId: string) => RenderShaderEffectDefinition,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === baseId ? singleton : factory(id),
        GLTF_PBR_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        ...(uniforms ? { cull: renderState.cull, blend: renderState.blend } : {}),
    };
};

export const createGltfHairShaderDefinition = (
    id: string = GLTF_SHADER_HAIR_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_HAIR_ID, GLTF_HAIR_SHADER_EFFECT, createGltfHairShaderEffect, uniforms);

export const createGltfClothShaderDefinition = (
    id: string = GLTF_SHADER_CLOTH_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_CLOTH_ID, GLTF_CLOTH_SHADER_EFFECT, createGltfClothShaderEffect, uniforms);

export const createGltfWaterShaderDefinition = (
    id: string = GLTF_SHADER_WATER_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_WATER_ID, GLTF_WATER_SHADER_EFFECT, createGltfWaterShaderEffect, uniforms);

export const createGltfFoliageShaderDefinition = (
    id: string = GLTF_SHADER_FOLIAGE_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_FOLIAGE_ID, GLTF_FOLIAGE_SHADER_EFFECT, createGltfFoliageShaderEffect, uniforms);

export const createGltfParticleShaderDefinition = (
    id: string = GLTF_SHADER_PARTICLE_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_PARTICLE_ID, GLTF_PARTICLE_SHADER_EFFECT, createGltfParticleShaderEffect, uniforms);

export const createGltfDecalShaderDefinition = (
    id: string = GLTF_SHADER_DECAL_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_DECAL_ID, GLTF_DECAL_SHADER_EFFECT, createGltfDecalShaderEffect, uniforms);

export const createPostProcessContractShaderDefinition = (
    id: string = POST_PROCESS_CONTRACT_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, POST_PROCESS_CONTRACT_ID, POST_PROCESS_CONTRACT_SHADER_EFFECT, createPostProcessContractShaderEffect, uniforms);

export const createGltfVolumeShaderDefinition = (
    id: string = GLTF_SHADER_VOLUME_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(id, GLTF_SHADER_VOLUME_ID, GLTF_VOLUME_SHADER_EFFECT, createGltfVolumeShaderEffect, uniforms);

export const createGltfRefractionCopyShaderDefinition = (
    id: string = GLTF_SHADER_REFRACTION_COPY_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(
        id,
        GLTF_SHADER_REFRACTION_COPY_ID,
        GLTF_REFRACTION_COPY_SHADER_EFFECT,
        createGltfRefractionCopyShaderEffect,
        uniforms
    );

export const createGltfSssBlurShaderDefinition = (
    id: string = GLTF_SHADER_SSS_BLUR_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition =>
    createV2ShaderDefinition(
        id,
        GLTF_SHADER_SSS_BLUR_ID,
        GLTF_SSS_BLUR_SHADER_EFFECT,
        createGltfSssBlurShaderEffect,
        uniforms
    );

export const resolveGltfRuntimeShaderId = (
    shaderId: string,
    uniforms?: GltfMaterialUniformMap
): string => {
    if (
        shaderId !== GLTF_SHADER_PBR_ID &&
        shaderId !== GLTF_SHADER_UNLIT_ID &&
        shaderId !== GLTF_SHADER_TOON_ID
    ) {
        return shaderId;
    }

    return createVariantShaderId(shaderId, {
        blend: isGltfBlendAlphaMode(uniforms),
        doubleSided: isGltfDoubleSided(uniforms),
    });
};

export const resolveGltfShaderDefinition = (
    shaderId: string,
    resolveShaderDefinition?: (shaderId: string) => GltfShaderDefinition | undefined
): GltfShaderDefinition | undefined => {
    if (shaderId.startsWith(GLTF_SHADER_TOON_OUTLINE_ID)) {
        return createGltfToonOutlineShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_TOON_ID)) {
        return createGltfToonShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_HAIR_ID)) return createGltfHairShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_CLOTH_ID)) return createGltfClothShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_WATER_ID)) return createGltfWaterShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_FOLIAGE_ID)) return createGltfFoliageShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_PARTICLE_ID)) return createGltfParticleShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_DECAL_ID)) return createGltfDecalShaderDefinition(shaderId);
    if (shaderId.startsWith(POST_PROCESS_CONTRACT_ID)) return createPostProcessContractShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_REFRACTION_COPY_ID)) {
        return createGltfRefractionCopyShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_SSS_BLUR_ID)) {
        return createGltfSssBlurShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_VOLUME_ID)) return createGltfVolumeShaderDefinition(shaderId);
    if (shaderId.startsWith(GLTF_SHADER_PBR_ID)) {
        return createGltfPbrShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_UNLIT_ID)) {
        return createGltfUnlitShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    return resolveShaderDefinition?.(shaderId);
};
