import type { Vec3Tuple, Vec4Tuple, QuatTuple, NodeId } from './gltf-branded-types';

export interface TransformComponentData {
    readonly position: Vec3Tuple;
    readonly rotation: QuatTuple;
    readonly scale: Vec3Tuple;
}

export interface CameraComponentData {
    readonly primary: boolean;
    readonly near: number;
    readonly far?: number;
    readonly fieldOfView?: number;
    readonly orthographic?: boolean;
    readonly orthographicSize?: number;
}

export interface DirectionalLightComponentData {
    readonly color: Vec3Tuple;
    readonly intensity: number;
    readonly primary: boolean;
}

export interface PointLightComponentData {
    readonly color: Vec3Tuple;
    readonly intensity: number;
    readonly range?: number;
}

export interface SpotLightComponentData {
    readonly color: Vec3Tuple;
    readonly intensity: number;
    readonly range?: number;
    readonly innerConeAngle: number;
    readonly outerConeAngle: number;
}

export interface MeshRendererSkinData {
    readonly jointNodeIds: readonly string[];
    readonly skeletonNodeId?: string;
    readonly inverseBindMatrices?: Float32Array;
}

export interface MeshRendererMorphData {
    readonly weights: Float32Array;
}

export interface MeshRendererComponentData {
    readonly meshId: string;
    readonly materialId: string | null;
    readonly visible: boolean;
    readonly renderOrder: number;
    readonly passId: string;
    readonly receiveLighting: boolean;
    readonly uniformOverrides: Readonly<Record<string, unknown>>;
    readonly morph?: MeshRendererMorphData;
    readonly skin?: MeshRendererSkinData;
}

export interface AnimatorSerializableTrack {
    readonly targetNodeId: string;
    readonly path: 'translation' | 'rotation' | 'scale' | 'weights';
    readonly interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    readonly keyframeCount: number;
    readonly valueComponentCount: number;
    readonly sampleStride: number;
    readonly times: Float32Array;
    readonly values: Float32Array;
}

export interface AnimatorSerializableClip {
    readonly id: string;
    readonly duration: number;
    readonly events?: readonly import('@axrone/animation/types').AnimationClipEventDefinition[];
    readonly footContacts?: readonly import('@axrone/animation/types').AnimationFootContactDefinition[];
    readonly tags?: readonly string[];
    readonly features?: readonly import('@axrone/animation/types').AnimationMotionFeatureDefinition[];
    readonly compression?: import('@axrone/animation/types').AnimationClipCompressionDefinition;
    readonly streaming?: import('@axrone/animation/types').AnimationClipStreamingDefinition;
    readonly tracks: readonly AnimatorSerializableTrack[];
}

export interface AnimatorComponentData {
    readonly clips: readonly AnimatorSerializableClip[];
    readonly parameters?: readonly import('@axrone/animation/types').AnimationParameterDefinition[];
    readonly layers?: readonly import('@axrone/animation/types').AnimationLayerDefinition[];
    readonly rootMotion?: import('@axrone/animation/types').AnimationRootMotionDefinition | null;
    readonly clipId: string | null;
    readonly playOnStart: boolean;
    readonly playing: boolean;
    readonly loop: boolean;
    readonly speed: number;
    readonly time: number;
}

export type ComponentType = 'Transform' | 'Camera' | 'DirectionalLight' | 'PointLight' | 'SpotLight' | 'MeshRenderer' | 'Animator';

export type ComponentDataMap = {
    readonly Transform: TransformComponentData;
    readonly Camera: CameraComponentData;
    readonly DirectionalLight: DirectionalLightComponentData;
    readonly PointLight: PointLightComponentData;
    readonly SpotLight: SpotLightComponentData;
    readonly MeshRenderer: MeshRendererComponentData;
    readonly Animator: AnimatorComponentData;
};

export type GltfComponentSnapshot = {
    readonly [K in ComponentType]: {
        readonly type: K;
        readonly data: ComponentDataMap[K];
    };
}[ComponentType];

export const isTransformSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'Transform'; readonly data: TransformComponentData } =>
    snapshot.type === 'Transform';

export const isCameraSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'Camera'; readonly data: CameraComponentData } =>
    snapshot.type === 'Camera';

export const isDirectionalLightSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'DirectionalLight'; readonly data: DirectionalLightComponentData } =>
    snapshot.type === 'DirectionalLight';

export const isPointLightSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'PointLight'; readonly data: PointLightComponentData } =>
    snapshot.type === 'PointLight';

export const isSpotLightSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'SpotLight'; readonly data: SpotLightComponentData } =>
    snapshot.type === 'SpotLight';

export const isMeshRendererSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'MeshRenderer'; readonly data: MeshRendererComponentData } =>
    snapshot.type === 'MeshRenderer';

export const isAnimatorSnapshot = (snapshot: GltfComponentSnapshot): snapshot is { readonly type: 'Animator'; readonly data: AnimatorComponentData } =>
    snapshot.type === 'Animator';

export const isLightSnapshot = (
    snapshot: GltfComponentSnapshot
): snapshot is
    | { readonly type: 'DirectionalLight'; readonly data: DirectionalLightComponentData }
    | { readonly type: 'PointLight'; readonly data: PointLightComponentData }
    | { readonly type: 'SpotLight'; readonly data: SpotLightComponentData } =>
    snapshot.type === 'DirectionalLight' || snapshot.type === 'PointLight' || snapshot.type === 'SpotLight';

export type ComponentSnapshotOf<T extends ComponentType> = { readonly type: T; readonly data: ComponentDataMap[T] };

export type ComponentDataOf<T extends ComponentType> = ComponentDataMap[T];

export type GltfEntitySnapshot = {
    readonly nodeId: NodeId;
    readonly parentNodeId: NodeId | null;
    readonly name: string;
    readonly layer: number;
    readonly tag: string;
    readonly active: boolean;
    readonly persistent: boolean;
    readonly pooled: boolean;
    readonly components: readonly GltfComponentSnapshot[];
};

export type GltfPrefabDefinition = {
    readonly id: string;
    readonly entities: readonly GltfEntitySnapshot[];
};

/**
 * Prefab build context and result types.
 *
 * These are defined here (rather than in `gltf-prefab.ts`) to avoid circular
 * dependencies between the prefab builder and other modules that need to
 * reference these types (e.g., animation controller, snapshot visitors).
 */
export type PrefabBuildContext = {
    readonly root: import('../types').GltfRootJson;
    readonly sceneIndex: number;
    readonly defaultSceneIndex: number;
    readonly meshKeysByMesh: readonly (readonly string[])[];
    readonly materialKeysByMesh: readonly (readonly (string | undefined)[])[];
    readonly skinsByIndex: readonly (import('../types').GltfSkinAsset | undefined)[];
    readonly skinKeysByIndex: readonly string[];
    readonly animationsByIndex: readonly (import('../types').GltfAnimationClipAsset | undefined)[];
    readonly animationKeysByIndex: readonly string[];
    readonly manifest: import('./gltf-animation-types').AnimationManifest | undefined;
};

export type PrefabBuildResult = {
    readonly prefab: GltfPrefabDefinition;
    readonly rootNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly meshKeys: readonly string[];
    readonly skinKeys: readonly string[];
    readonly animationKeys: readonly string[];
    readonly materialKeys: readonly string[];
    readonly animationController?: import('../types').GltfAnimationControllerMetadata;
    readonly diagnostics: readonly import('./gltf-diagnostics').GltfDiagnostic[];
};

export type GltfSkinBinding = {
    readonly jointNodeIds: readonly string[];
    readonly skeletonNodeId?: string;
    readonly inverseBindMatrices?: readonly number[] | Float32Array;
};

export type GltfComponentVisitor<T> = {
    readonly Transform?: (data: TransformComponentData) => T;
    readonly Camera?: (data: CameraComponentData) => T;
    readonly DirectionalLight?: (data: DirectionalLightComponentData) => T;
    readonly PointLight?: (data: PointLightComponentData) => T;
    readonly SpotLight?: (data: SpotLightComponentData) => T;
    readonly MeshRenderer?: (data: MeshRendererComponentData) => T;
    readonly Animator?: (data: AnimatorComponentData) => T;
};

export const visitComponent = <T>(
    snapshot: GltfComponentSnapshot,
    visitor: GltfComponentVisitor<T>,
    fallback: T
): T => {
    switch (snapshot.type) {
        case 'Transform': return visitor.Transform?.(snapshot.data) ?? fallback;
        case 'Camera': return visitor.Camera?.(snapshot.data) ?? fallback;
        case 'DirectionalLight': return visitor.DirectionalLight?.(snapshot.data) ?? fallback;
        case 'PointLight': return visitor.PointLight?.(snapshot.data) ?? fallback;
        case 'SpotLight': return visitor.SpotLight?.(snapshot.data) ?? fallback;
        case 'MeshRenderer': return visitor.MeshRenderer?.(snapshot.data) ?? fallback;
        case 'Animator': return visitor.Animator?.(snapshot.data) ?? fallback;
        default: return fallback;
    }
};

export const mapComponents = (
    entity: GltfEntitySnapshot,
    fn: (snapshot: GltfComponentSnapshot) => GltfComponentSnapshot
): GltfEntitySnapshot =>
    Object.freeze({
        ...entity,
        components: Object.freeze(entity.components.map(fn)),
    });
