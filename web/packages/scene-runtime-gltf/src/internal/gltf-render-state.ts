import type { SceneMaterialPassDefinition } from '@axrone/scene-runtime';
import type { GltfMaterialUniformMap } from './runtime-shaders';

const GLTF_SHADER_DOUBLE_SIDED_SUFFIX = '/double-sided';
const GLTF_SHADER_BLEND_SUFFIX = '/blend';
const GLTF_SHADER_TOON_PREFIX = 'gltf/toon';
const GLTF_SHADER_TOON_OUTLINE_ID = 'gltf/toon-outline';
const GLTF_SHADER_VOLUME_PREFIX = 'gltf/volume';
const GLTF_SHADER_PBR_PREFIX = 'gltf/pbr';
const VOLUME_RAYMARCH_PASS_ID = 'volume-raymarch';
const VOLUME_RAYMARCH_PASS_PHASE = 'volume';
const REFRACTION_COPY_PASS_ID = 'refraction-copy';
const REFRACTION_COPY_PASS_PHASE = 'refraction';
const REFRACTION_COPY_SHADER_ID = 'gltf/refraction-copy';
const REFRACTION_GATE_UNIFORM = '_TransmissionFactor';
const SSS_BLUR_PASS_ID = 'sss-blur';
const SSS_BLUR_PASS_PHASE = 'subsurface';
const SSS_BLUR_SHADER_ID = 'gltf/sss-blur';
const SSS_GATE_UNIFORM = '_SubsurfaceFactor';

const toOutlineShaderId = (shaderId: string): string =>
    `${GLTF_SHADER_TOON_OUTLINE_ID}${shaderId.slice(GLTF_SHADER_TOON_PREFIX.length)}`;

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

const isGltfToonOutlineEnabled = (
    uniforms: GltfMaterialUniformMap | undefined,
    shaderId?: string
): boolean =>
    shaderId !== undefined &&
    shaderId.startsWith(GLTF_SHADER_TOON_PREFIX) &&
    normalizeNumericUniform(uniforms?._OutlineWidth, 0) > 0;

const isGltfVolumeShader = (shaderId?: string): boolean =>
    shaderId !== undefined && shaderId.startsWith(GLTF_SHADER_VOLUME_PREFIX);

const isGltfPbrSurfaceShader = (shaderId?: string): boolean =>
    shaderId !== undefined && shaderId.startsWith(GLTF_SHADER_PBR_PREFIX);

/**
 * Mirrors the contract's `enabledWhenUniformNonZero` gate for a PBR surface
 * pass. The pbr/composable models declare `_TransmissionFactor` and
 * `_SubsurfaceFactor` as the gates; the V2 contract test pins these two
 * constant pairs so the runtime and the contract cannot drift apart.
 */
const isGatedSurfacePassEnabled = (
    uniforms: GltfMaterialUniformMap | undefined,
    shaderId: string | undefined,
    gateUniform: string
): boolean =>
    isGltfPbrSurfaceShader(shaderId) &&
    normalizeNumericUniform(uniforms?.[gateUniform], 0) > 0;

const toSurfaceEffectShaderId = (
    baseShaderId: string,
    shaderId: string | undefined
): string | undefined =>
    shaderId === undefined
        ? baseShaderId
        : `${baseShaderId}${shaderId.slice(GLTF_SHADER_PBR_PREFIX.length)}`;

const createSurfaceEffectMaterialPass = (
    id: string,
    phase: string,
    shaderId: string | undefined,
    cullMode: 'none' | 'back' | 'front'
): SceneMaterialPassDefinition => ({
    id,
    phase,
    shaderId,
    primitive: 'triangle-list',
    rasterizerState: {
        cullMode,
        frontFace: 'ccw',
    },
    depthStencilState: {
        depthTest: false,
        depthWrite: false,
        depthFunc: 'less',
    },
    blendState: {
        targets: [
            {
                blend: true,
                srcColorFactor: 'src-alpha',
                dstColorFactor: 'one-minus-src-alpha',
                colorOp: 'add',
                srcAlphaFactor: 'one',
                dstAlphaFactor: 'one-minus-src-alpha',
                alphaOp: 'add',
            },
        ],
    },
});

const createGltfVolumeMaterialPass = (): readonly SceneMaterialPassDefinition[] =>
    Object.freeze([
        {
            id: VOLUME_RAYMARCH_PASS_ID,
            phase: VOLUME_RAYMARCH_PASS_PHASE,
            primitive: 'triangle-list',
            rasterizerState: {
                cullMode: 'front',
                frontFace: 'ccw',
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: false,
                depthFunc: 'less',
            },
            blendState: {
                targets: [
                    {
                        blend: true,
                        srcColorFactor: 'src-alpha',
                        dstColorFactor: 'one-minus-src-alpha',
                        colorOp: 'add',
                        srcAlphaFactor: 'one',
                        dstAlphaFactor: 'one-minus-src-alpha',
                        alphaOp: 'add',
                    },
                ],
            },
        },
    ]);

export const createGltfRuntimeMaterialPasses = (
    uniforms?: GltfMaterialUniformMap,
    shaderId?: string
): readonly SceneMaterialPassDefinition[] => {
    if (isGltfVolumeShader(shaderId)) {
        return createGltfVolumeMaterialPass();
    }

    const alphaMode = normalizeNumericUniform(uniforms?._AlphaMode, 0);
    const blendEnabled = alphaMode >= 1.5;
    const alphaTestEnabled = alphaMode >= 0.5 && alphaMode < 1.5;
    const doubleSided = isGltfDoubleSided(uniforms);
    const cullMode = doubleSided ? 'none' : 'back';
    const outlineEnabled = isGltfToonOutlineEnabled(uniforms, shaderId);
    const outlineShaderId = shaderId === undefined ? undefined : toOutlineShaderId(shaderId);
    const refractionCopyEnabled = isGatedSurfacePassEnabled(
        uniforms,
        shaderId,
        REFRACTION_GATE_UNIFORM
    );
    const sssBlurEnabled = isGatedSurfacePassEnabled(uniforms, shaderId, SSS_GATE_UNIFORM);

    const passes: SceneMaterialPassDefinition[] = [
        {
            id: 'main',
            phase: 'default',
            primitive: 'triangle-list',
            rasterizerState: {
                cullMode,
                frontFace: 'ccw',
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: !blendEnabled,
                depthFunc: 'less',
            },
            blendState: {
                targets: [
                    {
                        blend: blendEnabled,
                        srcColorFactor: 'src-alpha',
                        dstColorFactor: 'one-minus-src-alpha',
                        colorOp: 'add',
                        srcAlphaFactor: 'one',
                        dstAlphaFactor: 'one-minus-src-alpha',
                        alphaOp: 'add',
                    },
                ],
            },
        },
        {
            id: 'forward-add',
            phase: 'forward-add',
            primitive: 'triangle-list',
            rasterizerState: {
                cullMode,
                frontFace: 'ccw',
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: false,
                depthFunc: 'lequal',
            },
            blendState: {
                targets: [
                    {
                        blend: true,
                        srcColorFactor: 'one',
                        dstColorFactor: 'one',
                        colorOp: 'add',
                        srcAlphaFactor: 'one',
                        dstAlphaFactor: 'one',
                        alphaOp: 'add',
                    },
                ],
            },
        },
        {
            id: 'shadow-caster',
            phase: 'shadow-caster',
            primitive: 'triangle-list',
            rasterizerState: {
                cullMode,
                frontFace: 'ccw',
            },
            depthStencilState: {
                depthTest: true,
                depthWrite: true,
                depthFunc: 'less',
            },
            blendState: {
                targets: [
                    {
                        blend: false,
                    },
                ],
            },
            ...(alphaTestEnabled
                ? {
                      priority: 1,
                  }
                : {}),
        },
        ...(outlineEnabled
            ? [
                  {
                      id: 'outline',
                      phase: 'outline',
                      shaderId: outlineShaderId,
                      primitive: 'triangle-list',
                      rasterizerState: {
                          cullMode: 'front',
                          frontFace: 'ccw',
                      },
                      depthStencilState: {
                          depthTest: true,
                          depthWrite: true,
                          depthFunc: 'less',
                      },
                      blendState: {
                          targets: [
                              {
                                  blend: false,
                              },
                          ],
                      },
                  },
              ]
            : []),
        ...(refractionCopyEnabled
            ? [
                  createSurfaceEffectMaterialPass(
                      REFRACTION_COPY_PASS_ID,
                      REFRACTION_COPY_PASS_PHASE,
                      toSurfaceEffectShaderId(REFRACTION_COPY_SHADER_ID, shaderId),
                      cullMode
                  ),
              ]
            : []),
        ...(sssBlurEnabled
            ? [
                  createSurfaceEffectMaterialPass(
                      SSS_BLUR_PASS_ID,
                      SSS_BLUR_PASS_PHASE,
                      toSurfaceEffectShaderId(SSS_BLUR_SHADER_ID, shaderId),
                      cullMode
                  ),
              ]
            : []),
    ];

    return Object.freeze(passes);
};

export const createVariantShaderId = (
    baseId: string,
    options: {
        readonly blend: boolean;
        readonly doubleSided: boolean;
    }
): string => {
    let variantId = baseId;
    if (options.blend) {
        variantId += GLTF_SHADER_BLEND_SUFFIX;
    }
    if (options.doubleSided) {
        variantId += GLTF_SHADER_DOUBLE_SIDED_SUFFIX;
    }
    return variantId;
};

export const resolveVariantRenderState = (uniforms: GltfMaterialUniformMap | undefined): {
    readonly blend: boolean;
    readonly cull: boolean;
} => {
    const blend = isGltfBlendAlphaMode(uniforms);
    const doubleSided = isGltfDoubleSided(uniforms);
    return {
        blend,
        cull: !doubleSided,
    };
};
