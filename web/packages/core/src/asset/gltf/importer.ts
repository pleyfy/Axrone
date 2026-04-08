import type {
    SceneActorSnapshot,
    SceneComponentSnapshot,
    SceneMaterialDefinition,
    ScenePrefabDefinition,
} from '../../scene/types';
import { FilterMode, TextureFormat, WrapMode } from '../../renderer/webgl2/texture/interfaces';
import type { AssetImportDiagnostic, AssetImportResult, AssetImportSource, AssetWriteInput } from '../types';
import { GltfSchemaError } from './errors';
import { GltfAccessorRuntime } from './internal/accessor-runtime';
import {
    basenameOfUri,
    GltfResourceRuntime,
    inferFormatFromSource,
    isGltfPackageSource,
    normalizeGltfSource,
    stripExtension,
    type NormalizedGltfSource,
} from './internal/source-runtime';
import { buildMeshDefinition, collectPrimitiveDiagnostics } from './internal/mesh-runtime';
import type {
    GltfAssetSchema,
    GltfAssetSchemaLike,
    GltfCameraJson,
    GltfDocumentAsset,
    GltfDocumentSceneAsset,
    GltfImporter,
    GltfImporterOptions,
    GltfMaterialAlphaMode,
    GltfMaterialAsset,
    GltfMaterialJson,
    GltfMaterialTextureBinding,
    GltfMeshAsset,
    GltfNodeJson,
    GltfRootJson,
    GltfSamplerJson,
    GltfTextureAsset,
    GltfTextureBindingJson,
    GltfTexturePayload,
    GltfTextureSampler,
    GltfTextureTranscodeRequest,
    GltfTextureTranscodeResult,
    GltfTextureTranscodeStageOptions,
    GltfTextureTranscoder,
    GltfTextureTransform,
    GltfTextureUsage,
    GltfTranscodeStage,
} from './types';

const EMPTY_ARRAY = Object.freeze([]) as readonly never[];
const DEFAULT_SAMPLER_ID = 'gltf/sampler/default';
const DEFAULT_MATERIAL_KEY_SUFFIX = 'material/default';
const DEFAULT_MATERIAL_NAME = 'Default Material';
const DEFAULT_DOCUMENT_NAME = 'glTF Document';
const RADIANS_TO_DEGREES = 180 / Math.PI;
const SUPPORTED_GLTF_EXTENSIONS = new Set<string>([
    'KHR_materials_unlit',
    'KHR_mesh_quantization',
    'KHR_texture_transform',
]);

interface PrefabBuildResult {
    readonly prefab: ScenePrefabDefinition;
    readonly rootNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly meshKeys: readonly string[];
    readonly materialKeys: readonly string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const isTypedArray = (value: unknown): value is ArrayBufferView =>
    ArrayBuffer.isView(value) && (value instanceof DataView === false);

const freezeDeep = <T>(value: T): T => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (value instanceof ArrayBuffer || isTypedArray(value) || value instanceof DataView) {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            freezeDeep(item);
        }
        return Object.freeze(value) as T;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
        freezeDeep(nested);
    }

    return Object.freeze(value);
};

const maybeFreeze = <T>(value: T, enabled: boolean): T => (enabled ? freezeDeep(value) : value);

const sanitizeName = (value: string | undefined, fallback: string): string => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const listUnsupportedExtensions = (
    extensions: readonly string[] | undefined
): readonly string[] =>
    Object.freeze(
        [...new Set(extensions?.filter((extension) => !SUPPORTED_GLTF_EXTENSIONS.has(extension)) ?? [])].sort(
            (left, right) => left.localeCompare(right)
        )
    );

const assertSupportedRequiredExtensions = (root: GltfRootJson): void => {
    const unsupported = listUnsupportedExtensions(root.extensionsRequired);
    if (unsupported.length === 0) {
        return;
    }

    throw new GltfSchemaError(
        `Unsupported required glTF extensions: ${unsupported.join(', ')}`
    );
};

const collectExtensionDiagnostics = (root: GltfRootJson): readonly AssetImportDiagnostic[] => {
    const required = new Set(root.extensionsRequired ?? EMPTY_ARRAY);

    return Object.freeze(
        listUnsupportedExtensions(root.extensionsUsed)
            .filter((extension) => required.has(extension) === false)
            .map(
                (extension) =>
                    Object.freeze({
                        level: 'warning',
                        code: 'gltf.extension.unsupported',
                        message: `glTF extension ${extension} is not supported and related data may be ignored`,
                    } satisfies AssetImportDiagnostic)
            )
    );
};

const collectFeatureDiagnostics = (root: GltfRootJson): readonly AssetImportDiagnostic[] => {
    const diagnostics: AssetImportDiagnostic[] = [];
    const skinCount = root.skins?.length ?? 0;
    const animationCount = root.animations?.length ?? 0;

    if (skinCount > 0) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.skin.unsupported',
                message: `glTF defines ${skinCount} skin${skinCount === 1 ? '' : 's'}, but Axrone does not import skeletal data yet`,
            } satisfies AssetImportDiagnostic)
        );
    }

    if (animationCount > 0) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.animation.unsupported',
                message: `glTF defines ${animationCount} animation clip${animationCount === 1 ? '' : 's'}, but Axrone does not import animation data yet`,
            } satisfies AssetImportDiagnostic)
        );
    }

    return Object.freeze(diagnostics);
};

const mapWrapMode = (
    value: GltfSamplerJson['wrapS'] | GltfSamplerJson['wrapT'] | undefined
): WrapMode => {
    switch (value) {
        case 33071:
            return WrapMode.CLAMP_TO_EDGE;
        case 33648:
            return WrapMode.MIRRORED_REPEAT;
        case 10497:
        default:
            return WrapMode.REPEAT;
    }
};

const mapMinFilter = (value: GltfSamplerJson['minFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
            return FilterMode.LINEAR;
        case 9984:
            return FilterMode.NEAREST_MIPMAP_NEAREST;
        case 9985:
            return FilterMode.LINEAR_MIPMAP_NEAREST;
        case 9986:
            return FilterMode.NEAREST_MIPMAP_LINEAR;
        case 9987:
        default:
            return FilterMode.LINEAR_MIPMAP_LINEAR;
    }
};

const mapMagFilter = (value: GltfSamplerJson['magFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
        default:
            return FilterMode.LINEAR;
    }
};

const inferTextureFormat = (payload: GltfTexturePayload): TextureFormat | undefined => {
    if (payload.kind === 'compressed') {
        return payload.targetFormat;
    }

    const mimeType = payload.mimeType?.toLowerCase();
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        return TextureFormat.RGB8;
    }
    if (mimeType === 'image/png' || mimeType === 'image/webp') {
        return TextureFormat.RGBA8;
    }
    if (mimeType === 'image/ktx2') {
        return TextureFormat.RGBA8;
    }
    return undefined;
};

const inferCompressedContainer = (
    mimeType: string | undefined,
    uri: string | undefined
): 'ktx2' | 'basisu' | undefined => {
    const normalizedMime = mimeType?.toLowerCase();
    const normalizedUri = uri?.toLowerCase();
    if (normalizedMime === 'image/ktx2' || normalizedUri?.endsWith('.ktx2')) {
        return 'ktx2';
    }
    if (normalizedMime === 'image/basis' || normalizedUri?.endsWith('.basis')) {
        return 'basisu';
    }
    return undefined;
};

const createTextureTransform = (binding: GltfTextureBindingJson | undefined): GltfTextureTransform | undefined => {
    const transform = binding?.extensions?.KHR_texture_transform;
    if (!transform && binding?.texCoord === undefined) {
        return undefined;
    }

    return Object.freeze({
        offset: Object.freeze([...(transform?.offset ?? [0, 0])]) as readonly [number, number],
        scale: Object.freeze([...(transform?.scale ?? [1, 1])]) as readonly [number, number],
        rotation: transform?.rotation ?? 0,
        texCoord: transform?.texCoord ?? binding?.texCoord ?? 0,
    });
};

const createMaterialTextureBinding = (
    usage: GltfTextureUsage,
    key: string,
    json: GltfTextureBindingJson,
    colorSpace: 'linear' | 'srgb'
): GltfMaterialTextureBinding =>
    Object.freeze({
        textureKey: key,
        usage,
        texCoord: json.texCoord ?? 0,
        colorSpace,
        transform: createTextureTransform(json),
        ...(json.scale !== undefined ? { scale: json.scale } : {}),
        ...(json.strength !== undefined ? { strength: json.strength } : {}),
    });


const decomposeNodeTransform = (
    node: GltfNodeJson
): {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
} => {
    if (node.matrix && node.matrix.length === 16) {
        const m = node.matrix;
        const sx = Math.hypot(m[0], m[1], m[2]);
        const sy = Math.hypot(m[4], m[5], m[6]);
        const sz = Math.hypot(m[8], m[9], m[10]);
        const rm00 = sx === 0 ? 1 : m[0] / sx;
        const rm01 = sx === 0 ? 0 : m[1] / sx;
        const rm02 = sx === 0 ? 0 : m[2] / sx;
        const rm10 = sy === 0 ? 0 : m[4] / sy;
        const rm11 = sy === 0 ? 1 : m[5] / sy;
        const rm12 = sy === 0 ? 0 : m[6] / sy;
        const rm20 = sz === 0 ? 0 : m[8] / sz;
        const rm21 = sz === 0 ? 0 : m[9] / sz;
        const rm22 = sz === 0 ? 1 : m[10] / sz;
        const trace = rm00 + rm11 + rm22;
        let x = 0;
        let y = 0;
        let z = 0;
        let w = 1;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (rm21 - rm12) / s;
            y = (rm02 - rm20) / s;
            z = (rm10 - rm01) / s;
        } else if (rm00 > rm11 && rm00 > rm22) {
            const s = Math.sqrt(1 + rm00 - rm11 - rm22) * 2;
            w = (rm21 - rm12) / s;
            x = 0.25 * s;
            y = (rm01 + rm10) / s;
            z = (rm02 + rm20) / s;
        } else if (rm11 > rm22) {
            const s = Math.sqrt(1 + rm11 - rm00 - rm22) * 2;
            w = (rm02 - rm20) / s;
            x = (rm01 + rm10) / s;
            y = 0.25 * s;
            z = (rm12 + rm21) / s;
        } else {
            const s = Math.sqrt(1 + rm22 - rm00 - rm11) * 2;
            w = (rm10 - rm01) / s;
            x = (rm02 + rm20) / s;
            y = (rm12 + rm21) / s;
            z = 0.25 * s;
        }

        return {
            position: [m[12], m[13], m[14]],
            rotation: [x, y, z, w],
            scale: [sx || 1, sy || 1, sz || 1],
        };
    }

    return {
        position: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
    };
};

const createTransformSnapshot = (node: GltfNodeJson): SceneComponentSnapshot => {
    const transform = decomposeNodeTransform(node);
    return Object.freeze({
        type: 'Transform',
        data: Object.freeze({
            position: Object.freeze([...transform.position]),
            rotation: Object.freeze([...transform.rotation]),
            scale: Object.freeze([...transform.scale]),
        }),
    });
};

const createCameraSnapshot = (
    camera: GltfCameraJson,
    isPrimary: boolean
): SceneComponentSnapshot => {
    if (camera.type === 'orthographic') {
        if (!camera.orthographic) {
            throw new GltfSchemaError('Orthographic glTF camera is missing orthographic settings');
        }

        return Object.freeze({
            type: 'Camera',
            data: Object.freeze({
                primary: isPrimary,
                near: camera.orthographic.znear,
                far: camera.orthographic.zfar,
                orthographic: true,
                orthographicSize: camera.orthographic.ymag,
            }),
        });
    }

    if (!camera.perspective) {
        throw new GltfSchemaError('Perspective glTF camera is missing perspective settings');
    }

    return Object.freeze({
        type: 'Camera',
        data: Object.freeze({
            primary: isPrimary,
            near: camera.perspective.znear,
            ...(camera.perspective.zfar !== undefined
                ? { far: camera.perspective.zfar }
                : {}),
            fieldOfView: camera.perspective.yfov * RADIANS_TO_DEGREES,
            orthographic: false,
        }),
    });
};

const createMeshRendererSnapshot = (
    meshKey: string,
    materialKey: string | undefined
): SceneComponentSnapshot =>
    Object.freeze({
        type: 'MeshRenderer',
        data: Object.freeze({
            meshId: meshKey,
            materialId: materialKey ?? null,
            visible: true,
            renderOrder: 0,
            passId: 'main',
            receiveLighting: true,
            uniformOverrides: Object.freeze({}),
        }),
    });

const collectTextureUsages = (root: GltfRootJson): Map<number, Set<GltfTextureUsage>> => {
    const usages = new Map<number, Set<GltfTextureUsage>>();
    const addUsage = (textureIndex: number | undefined, usage: GltfTextureUsage): void => {
        if (textureIndex === undefined) {
            return;
        }

        const set = usages.get(textureIndex) ?? new Set<GltfTextureUsage>();
        if (!usages.has(textureIndex)) {
            usages.set(textureIndex, set);
        }
        set.add(usage);
    };

    for (const material of root.materials ?? EMPTY_ARRAY) {
        addUsage(material.pbrMetallicRoughness?.baseColorTexture?.index, 'baseColor');
        addUsage(
            material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
            'metallicRoughness'
        );
        addUsage(material.normalTexture?.index, 'normal');
        addUsage(material.occlusionTexture?.index, 'occlusion');
        addUsage(material.emissiveTexture?.index, 'emissive');
    }

    return usages;
};

const createSamplerDefinition = (
    index: number | undefined,
    sampler: GltfSamplerJson | undefined,
    fallbackId: string
): GltfTextureSampler =>
    Object.freeze({
        id: index === undefined ? fallbackId : `gltf/sampler/${index}`,
        minFilter: mapMinFilter(sampler?.minFilter),
        magFilter: mapMagFilter(sampler?.magFilter),
        wrapS: mapWrapMode(sampler?.wrapS),
        wrapT: mapWrapMode(sampler?.wrapT),
    });

const createDocumentName = (
    normalized: NormalizedGltfSource,
    explicitName: string | undefined
): string =>
    sanitizeName(
        explicitName ??
            normalized.json.scenes?.[normalized.json.scene ?? 0]?.name ??
            stripExtension(basenameOfUri(normalized.sourceUri)) ??
            normalized.json.asset.generator,
        DEFAULT_DOCUMENT_NAME
    );

const ensureArray = <T>(value: readonly T[] | undefined): readonly T[] => value ?? EMPTY_ARRAY;


const createDefaultMaterialDefinition = (
    shaderId: string
): SceneMaterialDefinition =>
    Object.freeze({
        id: '',
        shaderId,
        uniforms: Object.freeze({
            _BaseColorFactor: Object.freeze([1, 1, 1, 1]),
            _MetallicFactor: 1,
            _RoughnessFactor: 1,
            _EmissiveFactor: Object.freeze([0, 0, 0]),
            _AlphaMode: 0,
            _AlphaCutoff: 0.5,
            _DoubleSided: 0,
        }),
        textures: Object.freeze({}),
    });

const createMaterialDefinition = (
    material: GltfMaterialJson,
    shaderId: string,
    textureKeys: readonly string[]
): {
    readonly definition: SceneMaterialDefinition;
    readonly textures: Readonly<Record<GltfTextureUsage, GltfMaterialTextureBinding>>;
    readonly alphaMode: GltfMaterialAlphaMode;
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
    readonly unlit: boolean;
} => {
    const uniforms: Record<string, number | readonly number[]> = {
        _BaseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
        _MetallicFactor: material.pbrMetallicRoughness?.metallicFactor ?? 1,
        _RoughnessFactor: material.pbrMetallicRoughness?.roughnessFactor ?? 1,
        _EmissiveFactor: material.emissiveFactor ?? [0, 0, 0],
        _AlphaMode:
            material.alphaMode === 'MASK' ? 1 : material.alphaMode === 'BLEND' ? 2 : 0,
        _AlphaCutoff: material.alphaCutoff ?? 0.5,
        _DoubleSided: material.doubleSided ? 1 : 0,
    };
    const textureBindings: Record<string, string> = {};
    const textures: Partial<Record<GltfTextureUsage, GltfMaterialTextureBinding>> = {};

    const addTexture = (
        slot: GltfTextureUsage,
        source: GltfTextureBindingJson | undefined,
        uniformName: string,
        colorSpace: 'linear' | 'srgb'
    ): void => {
        if (!source) {
            return;
        }

        const textureKey = textureKeys[source.index];
        if (!textureKey) {
            throw new GltfSchemaError(
                `Material references missing texture ${source.index}`
            );
        }

        textureBindings[uniformName] = textureKey;
        const binding = createMaterialTextureBinding(slot, textureKey, source, colorSpace);
        textures[slot] = binding;
        if (binding.transform) {
            uniforms[`${uniformName}_ST`] = Object.freeze([
                binding.transform.scale[0],
                binding.transform.scale[1],
                binding.transform.offset[0],
                binding.transform.offset[1],
            ]);
        }
        if (binding.scale !== undefined) {
            uniforms[`${uniformName}_Scale`] = binding.scale;
        }
        if (binding.strength !== undefined) {
            uniforms[`${uniformName}_Strength`] = binding.strength;
        }
    };

    addTexture(
        'baseColor',
        material.pbrMetallicRoughness?.baseColorTexture,
        '_BaseColorTexture',
        'srgb'
    );
    addTexture(
        'metallicRoughness',
        material.pbrMetallicRoughness?.metallicRoughnessTexture,
        '_MetallicRoughnessTexture',
        'linear'
    );
    addTexture('normal', material.normalTexture, '_NormalTexture', 'linear');
    addTexture('occlusion', material.occlusionTexture, '_OcclusionTexture', 'linear');
    addTexture('emissive', material.emissiveTexture, '_EmissiveTexture', 'srgb');

    const unlit = material.extensions?.KHR_materials_unlit !== undefined;

    return {
        definition: Object.freeze({
            id: '',
            shaderId: unlit ? 'gltf/unlit' : shaderId,
            uniforms: Object.freeze(uniforms),
            textures: Object.freeze(textureBindings),
        }),
        textures: Object.freeze(
            textures as Record<GltfTextureUsage, GltfMaterialTextureBinding>
        ),
        alphaMode: material.alphaMode ?? 'OPAQUE',
        alphaCutoff: material.alphaCutoff ?? 0.5,
        doubleSided: material.doubleSided ?? false,
        unlit,
    };
};

const createActorSnapshot = (
    nodeId: string,
    parentNodeId: string | null,
    name: string,
    components: readonly SceneComponentSnapshot[]
): SceneActorSnapshot =>
    Object.freeze({
        nodeId,
        parentNodeId,
        name,
        layer: 0,
        tag: 'Default',
        active: true,
        persistent: false,
        pooled: false,
        components,
    });

const buildPrefabDefinition = (
    root: GltfRootJson,
    sceneIndex: number,
    defaultSceneIndex: number,
    meshKeysByMesh: readonly (readonly string[])[],
    materialKeysByMesh: readonly (readonly (string | undefined)[])[]
): PrefabBuildResult => {
    const scene = root.scenes?.[sceneIndex];
    if (!scene) {
        throw new GltfSchemaError(`Missing scene ${sceneIndex}`);
    }

    const actors: SceneActorSnapshot[] = [];
    const rootNodeIds: string[] = [];
    const nodeIds: string[] = [];
    const meshKeys = new Set<string>();
    const materialKeys = new Set<string>();
    let primaryCameraAssigned = false;

    const visitNode = (nodeIndex: number, parentNodeId: string | null): void => {
        const node = root.nodes?.[nodeIndex];
        if (!node) {
            throw new GltfSchemaError(`Missing node ${nodeIndex}`);
        }

        const baseNodeId = `node/${nodeIndex}`;
        if (parentNodeId === null) {
            rootNodeIds.push(baseNodeId);
        }

        const primitives =
            node.mesh !== undefined ? meshKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const primitiveMaterials =
            node.mesh !== undefined ? materialKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const transformComponent = createTransformSnapshot(node);
        const nodeName = sanitizeName(node.name, `Node ${nodeIndex}`);
        const cameraComponent =
            node.camera !== undefined
                ? createCameraSnapshot(
                      root.cameras?.[node.camera] ??
                          (() => {
                              throw new GltfSchemaError(`Missing camera ${node.camera}`);
                          })(),
                      sceneIndex === defaultSceneIndex && primaryCameraAssigned === false
                  )
                : undefined;

        if (cameraComponent && sceneIndex === defaultSceneIndex && primaryCameraAssigned === false) {
            primaryCameraAssigned = true;
        }

        if (primitives.length <= 1) {
            const components = Object.freeze([
                transformComponent,
                ...(cameraComponent ? [cameraComponent] : EMPTY_ARRAY),
                ...(primitives.length === 1
                    ? [
                          createMeshRendererSnapshot(
                              primitives[0]!,
                              primitiveMaterials[0]
                          ),
                      ]
                    : EMPTY_ARRAY),
            ]);

            actors.push(createActorSnapshot(baseNodeId, parentNodeId, nodeName, components));
            nodeIds.push(baseNodeId);

            if (primitives.length === 1) {
                meshKeys.add(primitives[0]!);
                if (primitiveMaterials[0]) {
                    materialKeys.add(primitiveMaterials[0]!);
                }
            }
        } else {
            actors.push(
                createActorSnapshot(
                    baseNodeId,
                    parentNodeId,
                    nodeName,
                    Object.freeze([
                        transformComponent,
                        ...(cameraComponent ? [cameraComponent] : EMPTY_ARRAY),
                    ])
                )
            );
            nodeIds.push(baseNodeId);

            for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
                const primitiveNodeId = `${baseNodeId}/primitive/${primitiveIndex}`;
                actors.push(
                    createActorSnapshot(
                        primitiveNodeId,
                        baseNodeId,
                        `${nodeName} Primitive ${primitiveIndex}`,
                        Object.freeze([
                            Object.freeze({
                                type: 'Transform',
                                data: Object.freeze({
                                    position: Object.freeze([0, 0, 0]),
                                    rotation: Object.freeze([0, 0, 0, 1]),
                                    scale: Object.freeze([1, 1, 1]),
                                }),
                            }),
                            createMeshRendererSnapshot(
                                primitives[primitiveIndex]!,
                                primitiveMaterials[primitiveIndex]
                            ),
                        ])
                    )
                );
                nodeIds.push(primitiveNodeId);
                meshKeys.add(primitives[primitiveIndex]!);
                if (primitiveMaterials[primitiveIndex]) {
                    materialKeys.add(primitiveMaterials[primitiveIndex]!);
                }
            }
        }

        for (const child of ensureArray(node.children)) {
            visitNode(child, baseNodeId);
        }
    };

    for (const rootNode of ensureArray(scene.nodes)) {
        visitNode(rootNode, null);
    }

    return {
        prefab: Object.freeze({
            id: `gltf/scene/${sceneIndex}`,
            actors: Object.freeze(actors),
        }),
        rootNodeIds: Object.freeze(rootNodeIds),
        nodeIds: Object.freeze(nodeIds),
        meshKeys: Object.freeze([...meshKeys]),
        materialKeys: Object.freeze([...materialKeys]),
    };
};

export class GltfTextureTranscoderRegistry {
    private readonly _transcoders = new Map<string, GltfTextureTranscoder>();

    constructor(transcoders: readonly GltfTextureTranscoder[] = EMPTY_ARRAY) {
        for (const transcoder of transcoders) {
            this.register(transcoder);
        }
    }

    register(transcoder: GltfTextureTranscoder): this {
        this._transcoders.set(transcoder.id, transcoder);
        return this;
    }

    unregister(id: string): boolean {
        return this._transcoders.delete(id);
    }

    list(): readonly GltfTextureTranscoder[] {
        return Object.freeze(
            [...this._transcoders.values()].sort(
                (left, right) =>
                    (right.priority ?? 0) - (left.priority ?? 0) ||
                    left.id.localeCompare(right.id)
            )
        );
    }

    resolve(request: Readonly<GltfTextureTranscodeRequest>): GltfTextureTranscoder | undefined {
        return this.list().find((transcoder) => transcoder.canTranscode(request));
    }

    async transcode(
        request: Readonly<GltfTextureTranscodeRequest>
    ): Promise<GltfTextureTranscodeResult | undefined> {
        const transcoder = this.resolve(request);
        return transcoder ? transcoder.transcode(request) : undefined;
    }
}

const isTextureWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>
): boolean => input.kind === 'gltf.texture';

const applyTextureTranscode = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>,
    result: GltfTextureTranscodeResult
): AssetWriteInput<TSchema> => {
    const data = input.data as unknown as GltfTextureAsset;
    const updated = Object.freeze({
        ...data,
        payload: result.payload ?? data.payload,
        runtimeFormat: result.runtimeFormat ?? data.runtimeFormat,
        transcode: result.state,
    }) as unknown as TSchema['gltf.texture'];

    return Object.freeze({
        ...input,
        data: updated,
    }) as unknown as AssetWriteInput<TSchema>;
};

const asWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<any>
): AssetWriteInput<TSchema> => input as unknown as AssetWriteInput<TSchema>;

export const createGltfTextureTranscodeStage = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfTextureTranscodeStageOptions<TSchema> = {}
): GltfTranscodeStage<TSchema> => {
    const registry = options.registry ?? new GltfTextureTranscoderRegistry();

    return {
        id: options.id ?? 'gltf.texture.transcode',
        phases: ['after-import'],
        run: async (context) => {
            if (context.phase !== 'after-import') {
                return {};
            }

            const { result, signal } = context;
            const diagnostics: AssetImportDiagnostic[] = [];
            let primary = result.primary;
            let primaryChanged = false;
            let additionalChanged = false;
            const additional = result.additional ? [...result.additional] : undefined;

            if (isTextureWrite(primary)) {
                const transcode = await registry.transcode({
                    texture: primary.data as unknown as GltfTextureAsset,
                    signal,
                });
                if (transcode) {
                    primary = applyTextureTranscode(primary, transcode);
                    primaryChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (additional) {
                for (let index = 0; index < additional.length; index += 1) {
                    const entry = additional[index]!;
                    if (!isTextureWrite(entry)) {
                        continue;
                    }

                    const transcode = await registry.transcode({
                        texture: entry.data as unknown as GltfTextureAsset,
                        signal,
                    });
                    if (!transcode) {
                        continue;
                    }

                    additional[index] = applyTextureTranscode(entry, transcode);
                    additionalChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (!primaryChanged && !additionalChanged && diagnostics.length === 0) {
                return {};
            }

            return {
                result: Object.freeze({
                    ...result,
                    primary,
                    ...(additional
                        ? {
                              additional: Object.freeze(additional),
                          }
                        : {}),
                    diagnostics:
                        diagnostics.length > 0
                            ? Object.freeze([
                                  ...(result.diagnostics ?? EMPTY_ARRAY),
                                  ...diagnostics,
                              ])
                            : result.diagnostics,
                }),
            };
        },
    };
};

export const createPassthroughGltfTextureTranscoder = (
    targetFormat?: TextureFormat
): GltfTextureTranscoder => ({
    id: 'gltf.texture.passthrough',
    priority: -100,
    canTranscode: () => true,
    transcode: ({ texture }) => ({
        runtimeFormat: texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        state: {
            status: 'source',
            transcoderId: 'gltf.texture.passthrough',
            targetFormat:
                texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        },
    }),
});

export const createGltfImporter = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfImporterOptions<TSchema> = {}
): GltfImporter<TSchema> => {
    const freeze = options.freeze !== false;
    const materialShaderId = options.materialShaderId ?? 'gltf/pbr';
    const fallbackSamplerId = options.defaultSamplerId ?? DEFAULT_SAMPLER_ID;

    const importer = {
        id: options.id ?? 'asset.gltf',
        sourceKinds: ['bytes', 'text', 'json', 'custom'],
        extensions: ['gltf', 'glb'],
        mimeTypes: ['model/gltf+json', 'model/gltf-binary', 'application/json'],
        canImport: (context: Readonly<{ source: AssetImportSource }>) => {
            const { source } = context;
            if (isGltfPackageSource(source)) {
                return true;
            }

            if (source.kind === 'json') {
                return isPlainObject(source.data) && isPlainObject(source.data.asset);
            }

            if (source.kind === 'text') {
                return source.data.trimStart().startsWith('{');
            }

            if (source.kind === 'bytes') {
                const inferred = inferFormatFromSource(source);
                return inferred === 'glb' || inferred === 'gltf';
            }

            return false;
        },
        import: async (
            context: Readonly<{
                source: AssetImportSource;
                createSubKey: (suffix: string) => string;
            }>
        ) => {
            const { source, createSubKey } = context;
            const normalized = normalizeGltfSource(source);
            assertSupportedRequiredExtensions(normalized.json);
            const runtime = new GltfResourceRuntime(normalized, source, options.resourceResolver);
            const accessors = new GltfAccessorRuntime(runtime);
            const diagnostics: AssetImportDiagnostic[] = [
                ...collectExtensionDiagnostics(normalized.json),
                ...collectFeatureDiagnostics(normalized.json),
            ];
            const textureUsageMap = collectTextureUsages(normalized.json);
            const explicitTextures = normalized.json.textures ?? EMPTY_ARRAY;
            const explicitMaterials = normalized.json.materials ?? EMPTY_ARRAY;
            const explicitMeshes = normalized.json.meshes ?? EMPTY_ARRAY;
            const textureKeys = explicitTextures.map((_, index) =>
                String(createSubKey(`texture/${index}`))
            );
            const materialKeys = explicitMaterials.map((_, index) =>
                String(createSubKey(`material/${index}`))
            );
            const meshKeysByMesh: string[][] = [];
            const materialKeysByMesh: Array<Array<string | undefined>> = [];
            const additional: AssetWriteInput<TSchema>[] = [];
            let defaultMaterialKey: string | undefined;

            for (let textureIndex = 0; textureIndex < explicitTextures.length; textureIndex += 1) {
                const texture = explicitTextures[textureIndex]!;
                if (texture.source === undefined) {
                    diagnostics.push({
                        level: 'warning',
                        code: 'gltf.texture.missing-source',
                        message: `Texture ${textureIndex} does not declare an image source`,
                    });
                    continue;
                }

                const payload = await runtime.resolveImage(texture.source);
                const sampler = createSamplerDefinition(
                    texture.sampler,
                    texture.sampler !== undefined
                        ? normalized.json.samplers?.[texture.sampler]
                        : undefined,
                    fallbackSamplerId
                );
                const usageHints = Object.freeze([
                    ...(textureUsageMap.get(textureIndex) ?? EMPTY_ARRAY),
                ]);
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(texture.name, `Texture ${textureIndex}`),
                        textureIndex,
                        imageIndex: texture.source,
                        sampler,
                        payload,
                        usageHints,
                        runtimeFormat: inferTextureFormat(payload),
                        transcode: Object.freeze({
                            status: 'source',
                            targetFormat: inferTextureFormat(payload),
                        }),
                    } satisfies GltfTextureAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.texture',
                        stableKey: textureKeys[textureIndex],
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.texture'],
                    }))
                );
            }

            const requiresDefaultMaterial = explicitMeshes.some((mesh) =>
                mesh.primitives.some((primitive) => primitive.material === undefined)
            );
            if (requiresDefaultMaterial) {
                defaultMaterialKey = String(createSubKey(DEFAULT_MATERIAL_KEY_SUFFIX));
                const definition = createDefaultMaterialDefinition(materialShaderId);
                const asset = maybeFreeze(
                    {
                        id: DEFAULT_MATERIAL_NAME,
                        materialIndex: -1,
                        definition: Object.freeze({
                            ...definition,
                            id: defaultMaterialKey,
                        }),
                        alphaMode: 'OPAQUE',
                        alphaCutoff: 0.5,
                        doubleSided: false,
                        unlit: false,
                        textures: Object.freeze({}),
                    } satisfies GltfMaterialAsset,
                    freeze
                );
                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: defaultMaterialKey,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                    }))
                );
            }

            for (let materialIndex = 0; materialIndex < explicitMaterials.length; materialIndex += 1) {
                const material = explicitMaterials[materialIndex]!;
                const built = createMaterialDefinition(material, materialShaderId, textureKeys);
                const key = materialKeys[materialIndex]!;
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(material.name, `Material ${materialIndex}`),
                        materialIndex,
                        definition: Object.freeze({
                            ...built.definition,
                            id: key,
                        }),
                        alphaMode: built.alphaMode,
                        alphaCutoff: built.alphaCutoff,
                        doubleSided: built.doubleSided,
                        unlit: built.unlit,
                        textures: built.textures,
                    } satisfies GltfMaterialAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                        dependencies: Object.freeze(
                            Object.values(asset.textures).map((binding) => binding.textureKey)
                        ),
                    }))
                );
            }

            for (let meshIndex = 0; meshIndex < explicitMeshes.length; meshIndex += 1) {
                const mesh = explicitMeshes[meshIndex]!;
                const primitiveKeys: string[] = [];
                const primitiveMaterialKeys: Array<string | undefined> = [];

                for (
                    let primitiveIndex = 0;
                    primitiveIndex < mesh.primitives.length;
                    primitiveIndex += 1
                ) {
                    const primitive = mesh.primitives[primitiveIndex]!;
                    diagnostics.push(
                        ...collectPrimitiveDiagnostics(primitive, meshIndex, primitiveIndex)
                    );
                    const built = await buildMeshDefinition(primitive, accessors);
                    const key = String(
                        createSubKey(`mesh/${meshIndex}/primitive/${primitiveIndex}`)
                    );
                    const materialKey =
                        primitive.material !== undefined
                            ? materialKeys[primitive.material]
                            : defaultMaterialKey;
                    const meshAsset = maybeFreeze(
                        {
                            id: sanitizeName(
                                mesh.name,
                                `${sanitizeName(mesh.name, `Mesh ${meshIndex}`)} Primitive ${primitiveIndex}`
                            ),
                            meshIndex,
                            primitiveIndex,
                            definition: Object.freeze({
                                ...built.definition,
                                id: key,
                            }),
                            ...(built.bounds ? { bounds: built.bounds } : {}),
                            ...(materialKey ? { materialKey } : {}),
                            ...(primitive.extras ? { extras: primitive.extras } : {}),
                        } satisfies GltfMeshAsset,
                        freeze
                    );

                    additional.push(
                        asWrite<TSchema>(Object.freeze({
                            kind: 'gltf.mesh',
                            stableKey: key,
                            name: meshAsset.id,
                            data: meshAsset as unknown as TSchema['gltf.mesh'],
                            ...(materialKey
                                ? {
                                      dependencies: Object.freeze([materialKey]),
                                  }
                                : {}),
                        }))
                    );
                    primitiveKeys.push(key);
                    primitiveMaterialKeys.push(materialKey);
                }

                meshKeysByMesh[meshIndex] = primitiveKeys;
                materialKeysByMesh[meshIndex] = primitiveMaterialKeys;
            }

            const scenes =
                normalized.json.scenes && normalized.json.scenes.length > 0
                    ? normalized.json.scenes
                    : Object.freeze([
                          Object.freeze({
                              name: 'Scene 0',
                              nodes: Object.freeze(
                                  ensureArray(normalized.json.nodes).map((_, index) => index)
                              ),
                          }),
                      ]);
            const defaultSceneIndex = Math.min(
                Math.max(normalized.json.scene ?? 0, 0),
                Math.max(0, scenes.length - 1)
            );
            const sceneEntries: GltfDocumentSceneAsset[] = [];

            for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
                const built = buildPrefabDefinition(
                    normalized.json,
                    sceneIndex,
                    defaultSceneIndex,
                    meshKeysByMesh,
                    materialKeysByMesh
                );
                const key = String(createSubKey(`scene/${sceneIndex}/prefab`));
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(scenes[sceneIndex]?.name, `Scene ${sceneIndex}`),
                        sceneIndex,
                        definition: Object.freeze({
                            ...built.prefab,
                            id: key,
                        }),
                        rootNodeIds: built.rootNodeIds,
                        nodeIds: built.nodeIds,
                        meshKeys: built.meshKeys,
                        materialKeys: built.materialKeys,
                    },
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.prefab',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.prefab'],
                        dependencies: Object.freeze([
                            ...built.meshKeys,
                            ...built.materialKeys,
                        ]),
                    }))
                );
                sceneEntries.push(
                    maybeFreeze(
                        {
                            sceneIndex,
                            name: asset.id,
                            prefabKey: key,
                            rootNodeIds: built.rootNodeIds,
                        } satisfies GltfDocumentSceneAsset,
                        freeze
                    )
                );
            }

            const document = maybeFreeze(
                {
                    id: createDocumentName(normalized, options.documentName),
                    uri: normalized.sourceUri,
                    name: createDocumentName(normalized, options.documentName),
                    format: normalized.format,
                    version: normalized.json.asset.version,
                    ...(normalized.json.asset.generator
                        ? { generator: normalized.json.asset.generator }
                        : {}),
                    ...(normalized.json.asset.copyright
                        ? { copyright: normalized.json.asset.copyright }
                        : {}),
                    defaultScene: defaultSceneIndex,
                    scenes: Object.freeze(sceneEntries),
                    meshKeys: Object.freeze(meshKeysByMesh.flat()),
                    materialKeys: Object.freeze(
                        [
                            ...(defaultMaterialKey ? [defaultMaterialKey] : EMPTY_ARRAY),
                            ...materialKeys,
                        ].filter((value): value is string => Boolean(value))
                    ),
                    textureKeys: Object.freeze(textureKeys.filter(Boolean)),
                    extensionsUsed: Object.freeze([
                        ...(normalized.json.extensionsUsed ?? EMPTY_ARRAY),
                    ]),
                    extensionsRequired: Object.freeze([
                        ...(normalized.json.extensionsRequired ?? EMPTY_ARRAY),
                    ]),
                    stats: Object.freeze({
                        sceneCount: sceneEntries.length,
                        nodeCount: ensureArray(normalized.json.nodes).length,
                        cameraCount: ensureArray(normalized.json.cameras).length,
                        meshCount: explicitMeshes.length,
                        primitiveCount: meshKeysByMesh.reduce(
                            (total, entries) => total + entries.length,
                            0
                        ),
                        materialCount:
                            explicitMaterials.length + (defaultMaterialKey ? 1 : 0),
                        textureCount: textureKeys.length,
                        skinCount: ensureArray(normalized.json.skins).length,
                        animationCount: ensureArray(normalized.json.animations).length,
                    }),
                } satisfies GltfDocumentAsset,
                freeze
            );

            return Object.freeze({
                primary: asWrite<TSchema>(Object.freeze({
                    kind: 'gltf.document',
                    stableKey: String(createSubKey('document')),
                    name: document.name,
                    data: document as unknown as TSchema['gltf.document'],
                    dependencies: Object.freeze([
                        ...document.textureKeys,
                        ...document.materialKeys,
                        ...document.meshKeys,
                        ...document.scenes.map((scene) => scene.prefabKey),
                    ]),
                })),
                additional: Object.freeze(additional),
                diagnostics: Object.freeze(diagnostics),
            }) as AssetImportResult<TSchema>;
        },
    };

    return importer as unknown as GltfImporter<TSchema>;
};
