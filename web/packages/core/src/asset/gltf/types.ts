import type { SceneMaterialDefinition, SceneMeshDefinition, ScenePrefabDefinition, SceneSamplerDefinition } from '../../scene';
import type { FilterMode, TextureFormat, WrapMode } from '../../renderer/webgl2/texture/interfaces';
import type {
    AssetCustomSource,
    AssetImportDiagnostic,
    AssetImportSource,
    AssetImportStage,
    AssetImporter,
    AssetKind,
    AssetSchema,
} from '../types';

export type GltfAssetKind =
    | 'gltf.document'
    | 'gltf.prefab'
    | 'gltf.mesh'
    | 'gltf.material'
    | 'gltf.texture';

export interface GltfDocumentAsset {
    readonly id: string;
    readonly uri?: string;
    readonly name: string;
    readonly format: 'gltf' | 'glb';
    readonly version: string;
    readonly generator?: string;
    readonly copyright?: string;
    readonly defaultScene: number;
    readonly scenes: readonly GltfDocumentSceneAsset[];
    readonly meshKeys: readonly string[];
    readonly materialKeys: readonly string[];
    readonly textureKeys: readonly string[];
    readonly extensionsUsed: readonly string[];
    readonly extensionsRequired: readonly string[];
    readonly stats: GltfDocumentStats;
}

export interface GltfDocumentSceneAsset {
    readonly sceneIndex: number;
    readonly name: string;
    readonly prefabKey: string;
    readonly rootNodeIds: readonly string[];
}

export interface GltfDocumentStats {
    readonly sceneCount: number;
    readonly nodeCount: number;
    readonly cameraCount: number;
    readonly lightCount: number;
    readonly meshCount: number;
    readonly primitiveCount: number;
    readonly materialCount: number;
    readonly textureCount: number;
    readonly skinCount: number;
    readonly animationCount: number;
}

export interface GltfMeshBounds {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
}

export interface GltfMeshAsset {
    readonly id: string;
    readonly meshIndex: number;
    readonly primitiveIndex: number;
    readonly definition: SceneMeshDefinition;
    readonly bounds?: GltfMeshBounds;
    readonly materialKey?: string;
    readonly extras?: Readonly<Record<string, unknown>>;
}

export type GltfMaterialAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';
export type GltfTextureUsage =
    | 'baseColor'
    | 'metallicRoughness'
    | 'normal'
    | 'occlusion'
    | 'emissive';

export interface GltfTextureTransform {
    readonly offset: readonly [number, number];
    readonly scale: readonly [number, number];
    readonly rotation: number;
    readonly texCoord: number;
}

export interface GltfMaterialTextureBinding {
    readonly textureKey: string;
    readonly usage: GltfTextureUsage;
    readonly texCoord: number;
    readonly colorSpace: 'linear' | 'srgb';
    readonly transform?: GltfTextureTransform;
    readonly scale?: number;
    readonly strength?: number;
}

export interface GltfMaterialAsset {
    readonly id: string;
    readonly materialIndex: number;
    readonly definition: SceneMaterialDefinition;
    readonly alphaMode: GltfMaterialAlphaMode;
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
    readonly unlit: boolean;
    readonly textures: Readonly<Partial<Record<GltfTextureUsage, GltfMaterialTextureBinding>>>;
}

export interface GltfTextureSampler extends SceneSamplerDefinition {
    readonly minFilter: FilterMode;
    readonly magFilter: FilterMode;
    readonly wrapS: WrapMode;
    readonly wrapT: WrapMode;
    readonly wrapR?: WrapMode;
}

export interface GltfTextureMipLevel {
    readonly level: number;
    readonly width: number;
    readonly height: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

export interface GltfTexturePayloadBase {
    readonly mimeType?: string;
    readonly uri?: string;
    readonly width?: number;
    readonly height?: number;
}

export interface GltfExternalTexturePayload extends GltfTexturePayloadBase {
    readonly kind: 'external';
    readonly uri: string;
}

export interface GltfRawTexturePayload extends GltfTexturePayloadBase {
    readonly kind: 'raw';
    readonly bytes: Uint8Array;
}

export interface GltfCompressedTexturePayload extends GltfTexturePayloadBase {
    readonly kind: 'compressed';
    readonly bytes: Uint8Array;
    readonly container: 'ktx2' | 'basisu';
    readonly levels?: readonly GltfTextureMipLevel[];
    readonly targetFormat?: TextureFormat;
}

export type GltfTexturePayload =
    | GltfExternalTexturePayload
    | GltfRawTexturePayload
    | GltfCompressedTexturePayload;

export interface GltfTextureTranscodeState {
    readonly status: 'source' | 'transcoded' | 'skipped';
    readonly transcoderId?: string;
    readonly reason?: string;
    readonly targetFormat?: TextureFormat;
}

export interface GltfTextureAsset {
    readonly id: string;
    readonly textureIndex: number;
    readonly imageIndex: number;
    readonly sampler: GltfTextureSampler;
    readonly payload: GltfTexturePayload;
    readonly usageHints: readonly GltfTextureUsage[];
    readonly runtimeFormat?: TextureFormat;
    readonly transcode: GltfTextureTranscodeState;
}

export interface GltfPrefabAsset {
    readonly id: string;
    readonly sceneIndex: number;
    readonly definition: ScenePrefabDefinition;
    readonly rootNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly meshKeys: readonly string[];
    readonly materialKeys: readonly string[];
}

export interface GltfAssetSchema extends AssetSchema {
    readonly 'gltf.document': GltfDocumentAsset;
    readonly 'gltf.prefab': GltfPrefabAsset;
    readonly 'gltf.mesh': GltfMeshAsset;
    readonly 'gltf.material': GltfMaterialAsset;
    readonly 'gltf.texture': GltfTextureAsset;
}

export interface GltfAssetSchemaLike extends AssetSchema {
    readonly 'gltf.document': GltfDocumentAsset;
    readonly 'gltf.prefab': GltfPrefabAsset;
    readonly 'gltf.mesh': GltfMeshAsset;
    readonly 'gltf.material': GltfMaterialAsset;
    readonly 'gltf.texture': GltfTextureAsset;
}

export interface GltfPackageResourceInput {
    readonly uri: string;
    readonly data: string | ArrayBuffer | ArrayBufferView | Uint8Array;
    readonly mimeType?: string;
}

export interface GltfPackageInput {
    readonly json: string | GltfRootJson;
    readonly resources?: readonly GltfPackageResourceInput[];
}

export interface GltfPackageSource extends AssetCustomSource<GltfPackageInput> {
    readonly kind: 'custom';
    readonly format: 'gltf-package';
}

export interface GltfResolvedResource {
    readonly uri: string;
    readonly bytes: Uint8Array;
    readonly mimeType?: string;
}

export interface GltfResourceRequest {
    readonly uri: string;
    readonly absoluteUri: string;
    readonly kind: 'buffer' | 'image';
    readonly mimeType?: string;
    readonly source: AssetImportSource;
    readonly signal?: AbortSignal;
}

export type GltfResourceResolver = (
    request: Readonly<GltfResourceRequest>
) => GltfResolvedResource | Promise<GltfResolvedResource | undefined> | undefined;

export interface GltfImporterOptions<TSchema extends GltfAssetSchemaLike = GltfAssetSchemaLike> {
    readonly id?: string;
    readonly resourceResolver?: GltfResourceResolver;
    readonly materialShaderId?: string;
    readonly textureStageId?: string;
    readonly defaultSamplerId?: string;
    readonly documentName?: string;
    readonly freeze?: boolean;
}

export interface GltfTextureTranscodeRequest {
    readonly texture: GltfTextureAsset;
    readonly signal?: AbortSignal;
}

export interface GltfTextureTranscodeResult {
    readonly payload?: GltfTexturePayload;
    readonly runtimeFormat?: TextureFormat;
    readonly diagnostics?: readonly AssetImportDiagnostic[];
    readonly state: GltfTextureTranscodeState;
}

export interface GltfTextureTranscoder {
    readonly id: string;
    readonly priority?: number;
    canTranscode(request: Readonly<GltfTextureTranscodeRequest>): boolean;
    transcode(
        request: Readonly<GltfTextureTranscodeRequest>
    ): GltfTextureTranscodeResult | Promise<GltfTextureTranscodeResult>;
}

export interface GltfTextureTranscodeStageOptions<
    TSchema extends GltfAssetSchemaLike = GltfAssetSchemaLike,
> {
    readonly id?: string;
    readonly registry?: GltfTextureTranscoderRegistry;
}

export interface GltfTextureBindingJson {
    readonly index: number;
    readonly texCoord?: number;
    readonly extensions?: {
        readonly KHR_texture_transform?: {
            readonly offset?: readonly [number, number];
            readonly scale?: readonly [number, number];
            readonly rotation?: number;
            readonly texCoord?: number;
        };
        readonly [extensionName: string]: unknown;
    };
    readonly scale?: number;
    readonly strength?: number;
}

export interface GltfRootAssetInfoJson {
    readonly version: string;
    readonly minVersion?: string;
    readonly generator?: string;
    readonly copyright?: string;
}

export interface GltfBufferJson {
    readonly uri?: string;
    readonly byteLength: number;
    readonly name?: string;
}

export interface GltfBufferViewJson {
    readonly buffer: number;
    readonly byteOffset?: number;
    readonly byteLength: number;
    readonly byteStride?: number;
    readonly target?: number;
    readonly name?: string;
}

export interface GltfAccessorSparseIndicesJson {
    readonly bufferView: number;
    readonly byteOffset?: number;
    readonly componentType: 5121 | 5123 | 5125;
}

export interface GltfAccessorSparseValuesJson {
    readonly bufferView: number;
    readonly byteOffset?: number;
}

export interface GltfAccessorSparseJson {
    readonly count: number;
    readonly indices: GltfAccessorSparseIndicesJson;
    readonly values: GltfAccessorSparseValuesJson;
}

export interface GltfAccessorJson {
    readonly bufferView?: number;
    readonly byteOffset?: number;
    readonly componentType: 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
    readonly normalized?: boolean;
    readonly count: number;
    readonly type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';
    readonly max?: readonly number[];
    readonly min?: readonly number[];
    readonly sparse?: GltfAccessorSparseJson;
    readonly name?: string;
}

export interface GltfPrimitiveJson {
    readonly attributes: Readonly<Record<string, number>>;
    readonly indices?: number;
    readonly material?: number;
    readonly mode?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    readonly targets?: readonly Readonly<Record<string, number>>[];
    readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfMeshJson {
    readonly primitives: readonly GltfPrimitiveJson[];
    readonly weights?: readonly number[];
    readonly name?: string;
    readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfImageJson {
    readonly uri?: string;
    readonly mimeType?: string;
    readonly bufferView?: number;
    readonly name?: string;
}

export interface GltfSamplerJson {
    readonly magFilter?: 9728 | 9729;
    readonly minFilter?: 9728 | 9729 | 9984 | 9985 | 9986 | 9987;
    readonly wrapS?: 33071 | 33648 | 10497;
    readonly wrapT?: 33071 | 33648 | 10497;
    readonly name?: string;
}

export interface GltfTextureJson {
    readonly sampler?: number;
    readonly source?: number;
    readonly extensions?: {
        readonly KHR_texture_basisu?: {
            readonly source: number;
        };
        readonly [extensionName: string]: unknown;
    };
    readonly name?: string;
}

export interface GltfCameraPerspectiveJson {
    readonly aspectRatio?: number;
    readonly yfov: number;
    readonly zfar?: number;
    readonly znear: number;
}

export interface GltfCameraOrthographicJson {
    readonly xmag: number;
    readonly ymag: number;
    readonly zfar: number;
    readonly znear: number;
}

export interface GltfCameraJson {
    readonly type: 'perspective' | 'orthographic';
    readonly perspective?: GltfCameraPerspectiveJson;
    readonly orthographic?: GltfCameraOrthographicJson;
    readonly name?: string;
}

export interface GltfSkinJson {
    readonly inverseBindMatrices?: number;
    readonly skeleton?: number;
    readonly joints: readonly number[];
    readonly name?: string;
}

export interface GltfAnimationSamplerJson {
    readonly input: number;
    readonly interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    readonly output: number;
}

export interface GltfAnimationChannelTargetJson {
    readonly node?: number;
    readonly path: 'translation' | 'rotation' | 'scale' | 'weights';
}

export interface GltfAnimationChannelJson {
    readonly sampler: number;
    readonly target: GltfAnimationChannelTargetJson;
}

export interface GltfAnimationJson {
    readonly channels: readonly GltfAnimationChannelJson[];
    readonly samplers: readonly GltfAnimationSamplerJson[];
    readonly name?: string;
}

export interface GltfPbrMetallicRoughnessJson {
    readonly baseColorFactor?: readonly [number, number, number, number];
    readonly baseColorTexture?: GltfTextureBindingJson;
    readonly metallicFactor?: number;
    readonly roughnessFactor?: number;
    readonly metallicRoughnessTexture?: GltfTextureBindingJson;
}

export interface GltfMaterialJson {
    readonly name?: string;
    readonly pbrMetallicRoughness?: GltfPbrMetallicRoughnessJson;
    readonly normalTexture?: GltfTextureBindingJson;
    readonly occlusionTexture?: GltfTextureBindingJson;
    readonly emissiveTexture?: GltfTextureBindingJson;
    readonly emissiveFactor?: readonly [number, number, number];
    readonly alphaMode?: GltfMaterialAlphaMode;
    readonly alphaCutoff?: number;
    readonly doubleSided?: boolean;
    readonly extensions?: {
        readonly KHR_materials_emissive_strength?: {
            readonly emissiveStrength?: number;
        };
        readonly KHR_materials_unlit?: Readonly<Record<string, never>>;
        readonly [extensionName: string]: unknown;
    };
}

export interface GltfPunctualLightSpotJson {
    readonly innerConeAngle?: number;
    readonly outerConeAngle?: number;
}

export interface GltfPunctualLightJson {
    readonly type: 'directional' | 'point' | 'spot';
    readonly color?: readonly [number, number, number];
    readonly intensity?: number;
    readonly range?: number;
    readonly spot?: GltfPunctualLightSpotJson;
    readonly name?: string;
}

export interface GltfNodeJson {
    readonly camera?: number;
    readonly children?: readonly number[];
    readonly extensions?: {
        readonly KHR_lights_punctual?: {
            readonly light: number;
        };
        readonly [extensionName: string]: unknown;
    };
    readonly skin?: number;
    readonly matrix?: readonly [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
    ];
    readonly mesh?: number;
    readonly rotation?: readonly [number, number, number, number];
    readonly scale?: readonly [number, number, number];
    readonly translation?: readonly [number, number, number];
    readonly weights?: readonly number[];
    readonly name?: string;
    readonly extras?: Readonly<Record<string, unknown>>;
}

export interface GltfSceneJson {
    readonly nodes?: readonly number[];
    readonly name?: string;
}

export interface GltfRootJson {
    readonly asset: GltfRootAssetInfoJson;
    readonly scene?: number;
    readonly scenes?: readonly GltfSceneJson[];
    readonly cameras?: readonly GltfCameraJson[];
    readonly extensions?: {
        readonly KHR_lights_punctual?: {
            readonly lights: readonly GltfPunctualLightJson[];
        };
        readonly [extensionName: string]: unknown;
    };
    readonly nodes?: readonly GltfNodeJson[];
    readonly meshes?: readonly GltfMeshJson[];
    readonly skins?: readonly GltfSkinJson[];
    readonly animations?: readonly GltfAnimationJson[];
    readonly accessors?: readonly GltfAccessorJson[];
    readonly bufferViews?: readonly GltfBufferViewJson[];
    readonly buffers?: readonly GltfBufferJson[];
    readonly materials?: readonly GltfMaterialJson[];
    readonly images?: readonly GltfImageJson[];
    readonly textures?: readonly GltfTextureJson[];
    readonly samplers?: readonly GltfSamplerJson[];
    readonly extensionsUsed?: readonly string[];
    readonly extensionsRequired?: readonly string[];
}

export declare class GltfTextureTranscoderRegistry {
    constructor(transcoders?: readonly GltfTextureTranscoder[]);
    register(transcoder: GltfTextureTranscoder): this;
    unregister(id: string): boolean;
    list(): readonly GltfTextureTranscoder[];
    resolve(
        request: Readonly<GltfTextureTranscodeRequest>
    ): GltfTextureTranscoder | undefined;
    transcode(
        request: Readonly<GltfTextureTranscodeRequest>
    ): Promise<GltfTextureTranscodeResult | undefined>;
}

export type GltfImporter<TSchema extends GltfAssetSchemaLike = GltfAssetSchemaLike> = AssetImporter<
    TSchema
    ,
    AssetImportSource,
    Extract<'gltf.document', AssetKind<TSchema>>
>;

export type GltfTranscodeStage<TSchema extends GltfAssetSchemaLike = GltfAssetSchemaLike> =
    AssetImportStage<TSchema, AssetImportSource, AssetKind<TSchema>>;
