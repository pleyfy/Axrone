import { Vec3 } from '@axrone/numeric';
import { TextureFormat } from '../../../renderer/webgl2/texture/interfaces';
import type {
    SceneMaterialDefinition,
    SceneTextureCompressedLevelDefinition,
    SceneTextureDefinition,
    SceneUniformValue,
} from '../../../scene';
import type { AssetImportDiagnostic } from '../../types';
import {
    inferTextureFormatFromKtx2,
    parseKtx2Texture,
} from '../internal/ktx2-container';
import type {
    GltfMaterialAsset,
    GltfTextureAsset,
    GltfTextureMipLevel,
    GltfTextureUsage,
} from '../types';

interface GltfTextureUniformSpec {
    readonly usage: GltfTextureUsage;
    readonly uniformName: string;
    readonly defaultTexCoord: number;
    readonly defaultST: readonly [number, number, number, number];
    readonly defaultRotation: number;
    readonly defaultScale?: number;
    readonly defaultStrength?: number;
}

const GLTF_TEXTURE_UNIFORM_SPECS: readonly GltfTextureUniformSpec[] = [
    {
        usage: 'baseColor',
        uniformName: '_BaseColorTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
    {
        usage: 'metallicRoughness',
        uniformName: '_MetallicRoughnessTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
    {
        usage: 'normal',
        uniformName: '_NormalTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
        defaultScale: 1,
    },
    {
        usage: 'occlusion',
        uniformName: '_OcclusionTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
        defaultStrength: 1,
    },
    {
        usage: 'emissive',
        uniformName: '_EmissiveTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
];

const toSceneTextureMimeType = (texture: GltfTextureAsset): string | undefined => {
    if (texture.payload.mimeType) {
        return texture.payload.mimeType;
    }

    const uri = texture.payload.uri?.toLowerCase();
    if (!uri) {
        return undefined;
    }

    if (uri.endsWith('.png')) {
        return 'image/png';
    }
    if (uri.endsWith('.jpg') || uri.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    if (uri.endsWith('.webp')) {
        return 'image/webp';
    }
    if (uri.endsWith('.ktx2')) {
        return 'image/ktx2';
    }
    if (uri.endsWith('.basis')) {
        return 'image/basis';
    }

    return undefined;
};

const isRuntimeLoadableImageMimeType = (mimeType: string | undefined): boolean =>
    mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/webp';

const createCompressedLevelDefinitions = (
    levels: readonly GltfTextureMipLevel[]
): readonly SceneTextureCompressedLevelDefinition[] =>
    Object.freeze(
        [...levels]
            .sort((left, right) => left.level - right.level)
            .map((level) =>
                Object.freeze({
                    level: level.level,
                    width: level.width,
                    height: level.height,
                    byteOffset: level.byteOffset,
                    byteLength: level.byteLength,
                })
            )
    );

const createFallbackTextureSource = (
    usageHints: readonly GltfTextureUsage[]
): SceneTextureDefinition['source'] => {
    const primaryUsage = usageHints[0];

    if (primaryUsage === 'normal') {
        return {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [128, 128, 255, 255],
        };
    }

    if (primaryUsage === 'emissive') {
        return {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [255, 255, 255, 255],
        };
    }

    return {
        kind: 'data',
        width: 1,
        height: 1,
        channels: 4,
        data: [255, 255, 255, 255],
    };
};

const createCompressedRuntimeTextureDefinition = (
    key: string,
    asset: GltfTextureAsset
): { readonly definition: SceneTextureDefinition; readonly diagnostics: readonly AssetImportDiagnostic[] } | undefined => {
    if (asset.payload.kind !== 'compressed') {
        return undefined;
    }

    const bytes = new Uint8Array(asset.payload.bytes);
    let runtimeFormat = asset.runtimeFormat ?? asset.payload.targetFormat;
    let levels = asset.payload.levels;

    if ((runtimeFormat === undefined || !levels?.length) && asset.payload.container === 'ktx2') {
        try {
            const parsed = parseKtx2Texture(bytes);
            if (parsed.supercompressionScheme !== 0 && !levels?.length) {
                return {
                    definition: {
                        id: key,
                        samplerId: asset.sampler.id,
                        format: TextureFormat.RGBA8,
                        generateMipmaps: false,
                        source: createFallbackTextureSource(asset.usageHints),
                    },
                    diagnostics: [
                        {
                            level: 'warning',
                            code: 'gltf.texture.runtime-supercompressed-unsupported',
                            message: `Texture '${key}' is a supercompressed KTX2 payload and still requires a transcoder before Axrone can upload it at runtime`,
                        },
                    ],
                };
            }

            runtimeFormat ??= inferTextureFormatFromKtx2(bytes);
            levels ??= parsed.levels;
        } catch (error) {
            return {
                definition: {
                    id: key,
                    samplerId: asset.sampler.id,
                    format: TextureFormat.RGBA8,
                    generateMipmaps: false,
                    source: createFallbackTextureSource(asset.usageHints),
                },
                diagnostics: [
                    {
                        level: 'warning',
                        code: 'gltf.texture.runtime-ktx2-invalid',
                        message: `Texture '${key}' could not be parsed as KTX2 and was replaced with a deterministic fallback`,
                        ...(error instanceof Error ? { cause: error } : {}),
                    },
                ],
            };
        }
    }

    if (!runtimeFormat) {
        return {
            definition: {
                id: key,
                samplerId: asset.sampler.id,
                format: TextureFormat.RGBA8,
                generateMipmaps: false,
                source: createFallbackTextureSource(asset.usageHints),
            },
            diagnostics: [
                {
                    level: 'warning',
                    code: 'gltf.texture.runtime-format-missing',
                    message: `Texture '${key}' does not expose a runtime GPU format, so Axrone substituted a deterministic fallback texture`,
                },
            ],
        };
    }

    if (!levels?.length) {
        if (asset.payload.width && asset.payload.height) {
            levels = [
                Object.freeze({
                    level: 0,
                    width: asset.payload.width,
                    height: asset.payload.height,
                    byteOffset: 0,
                    byteLength: bytes.byteLength,
                }),
            ];
        } else {
            return {
                definition: {
                    id: key,
                    samplerId: asset.sampler.id,
                    format: TextureFormat.RGBA8,
                    generateMipmaps: false,
                    source: createFallbackTextureSource(asset.usageHints),
                },
                diagnostics: [
                    {
                        level: 'warning',
                        code: 'gltf.texture.runtime-levels-missing',
                        message: `Texture '${key}' does not expose mip metadata, so Axrone substituted a deterministic fallback texture`,
                    },
                ],
            };
        }
    }

    return {
        definition: {
            id: key,
            samplerId: asset.sampler.id,
            format: runtimeFormat,
            generateMipmaps: false,
            source: {
                kind: 'compressed',
                bytes,
                levels: createCompressedLevelDefinitions(levels),
                container: asset.payload.container,
                ...(asset.payload.uri ? { uri: asset.payload.uri } : {}),
            },
        },
        diagnostics: [],
    };
};

const cloneUniformValue = (value: SceneUniformValue): SceneUniformValue => {
    if (ArrayBuffer.isView(value)) {
        return new (value.constructor as typeof Float32Array)(value as any) as SceneUniformValue;
    }

    if (Array.isArray(value)) {
        return [...value] as SceneUniformValue;
    }

    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    return value;
};

export const normalizeGltfMaterialDefinition = (
    asset: GltfMaterialAsset,
    key: string
): SceneMaterialDefinition => {
    const uniforms: Record<string, SceneUniformValue> = Object.fromEntries(
        Object.entries(asset.definition.uniforms ?? {}).map(([name, value]) => [
            name,
            cloneUniformValue(value),
        ])
    );

    for (const spec of GLTF_TEXTURE_UNIFORM_SPECS) {
        const binding = asset.textures[spec.usage];
        uniforms[`${spec.uniformName}_ST`] =
            binding?.transform
                ? [
                      binding.transform.scale[0],
                      binding.transform.scale[1],
                      binding.transform.offset[0],
                      binding.transform.offset[1],
                  ]
                : [...spec.defaultST];
        uniforms[`${spec.uniformName}_Rotation`] = binding?.transform?.rotation ?? spec.defaultRotation;
        uniforms[`${spec.uniformName}_TexCoord`] =
            binding?.transform?.texCoord ?? binding?.texCoord ?? spec.defaultTexCoord;

        if (spec.defaultScale !== undefined && uniforms[`${spec.uniformName}_Scale`] === undefined) {
            uniforms[`${spec.uniformName}_Scale`] = spec.defaultScale;
        }
        if (spec.defaultStrength !== undefined && uniforms[`${spec.uniformName}_Strength`] === undefined) {
            uniforms[`${spec.uniformName}_Strength`] = spec.defaultStrength;
        }
    }

    return {
        ...asset.definition,
        id: key,
        uniforms,
        textures: asset.definition.textures ? { ...asset.definition.textures } : undefined,
    };
};

export const createSceneTextureDefinitionFromGltfTexture = (
    key: string,
    asset: GltfTextureAsset
): { readonly definition: SceneTextureDefinition; readonly diagnostics: readonly AssetImportDiagnostic[] } => {
    const mimeType = toSceneTextureMimeType(asset);

    const compressed = createCompressedRuntimeTextureDefinition(key, asset);
    if (compressed) {
        return compressed;
    }

    if (asset.payload.kind === 'raw' && isRuntimeLoadableImageMimeType(mimeType)) {
        return {
            definition: {
                id: key,
                samplerId: asset.sampler.id,
                format: asset.runtimeFormat ?? TextureFormat.RGBA8,
                source: {
                    kind: 'bytes',
                    bytes: new Uint8Array(asset.payload.bytes),
                    mimeType: mimeType!,
                    ...(asset.payload.uri ? { uri: asset.payload.uri } : {}),
                },
            },
            diagnostics: [],
        };
    }

    if (asset.payload.kind === 'external' && isRuntimeLoadableImageMimeType(mimeType)) {
        return {
            definition: {
                id: key,
                samplerId: asset.sampler.id,
                format: asset.runtimeFormat ?? TextureFormat.RGBA8,
                source: {
                    kind: 'url',
                    url: asset.payload.uri,
                },
            },
            diagnostics: [],
        };
    }

    return {
        definition: {
            id: key,
            samplerId: asset.sampler.id,
            format: TextureFormat.RGBA8,
            generateMipmaps: false,
            source: createFallbackTextureSource(asset.usageHints),
        },
        diagnostics: [
            {
                level: 'warning',
                code: 'gltf.texture.runtime-fallback',
                message: `Texture '${key}' uses a payload the scene runtime cannot consume directly; a deterministic fallback texture was substituted`,
            },
        ],
    };
};