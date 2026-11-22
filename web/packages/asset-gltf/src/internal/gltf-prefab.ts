import type {
    AnimationClipCompressionDefinition,
    AnimationClipEventDefinition,
    AnimationClipStreamingDefinition,
    AnimationFootContactDefinition,
    AnimationMotionFeatureDefinition,
} from '@axrone/animation/types';
import type { AssetImportDiagnostic } from '../asset-contract';
import type { GltfDiagnostic } from './gltf-diagnostics';
import type {
    GltfAnimationClipAsset,
    GltfAnimationControllerMetadata,
    GltfMeshJson,
    GltfNodeJson,
    GltfRootJson,
    GltfSkinAsset,
} from '../types';
import type { GltfActorSnapshot, GltfComponentSnapshot, PrefabBuildContext, PrefabBuildResult, GltfSkinBinding, MeshRendererComponentData, AnimatorSerializableClip, AnimatorSerializableTrack, AnimatorComponentData } from './gltf-component-snapshot';
import type { AnimationManifest } from './gltf-animation-types';
import { GltfSchemaError } from '../errors';
import { encodeGltfValue } from '../value-serialization';
import { EMPTY_ARRAY, MAX_SCENE_LOCAL_LIGHTS } from './gltf-constants';
import { sanitizeName, ensureArray } from './gltf-utils';
import { createTransformSnapshot, createActorSnapshot, nodeIdFromIndex } from './gltf-scene-transform';
import { createCameraSnapshot } from './gltf-camera';
import { createDirectionalLightSnapshot, createPointLightSnapshot, createSpotLightSnapshot, resolveNodeLight } from './gltf-light';
import { createSkinBinding } from './gltf-skin';
import { resolveSceneAnimationControllerMetadata } from './gltf-animation-controller';

const createMeshRendererSnapshot = (
    meshKey: string,
    materialKey: string | undefined,
    morphWeights: readonly number[] | Float32Array | undefined,
    skin: GltfSkinBinding | undefined
): GltfComponentSnapshot => {
    const skinData = skin
        ? Object.freeze({
              jointNodeIds: Object.freeze([...skin.jointNodeIds]),
              ...(skin.skeletonNodeId ? { skeletonNodeId: skin.skeletonNodeId } : {}),
              ...(skin.inverseBindMatrices
                  ? { inverseBindMatrices: new Float32Array(skin.inverseBindMatrices) }
                  : {}),
          })
        : undefined;
    const morphData = morphWeights
        ? Object.freeze({
              weights: new Float32Array(morphWeights),
          })
        : undefined;

    return Object.freeze({
        type: 'MeshRenderer',
        data: encodeGltfValue(
            Object.freeze({
                meshId: meshKey,
                materialId: materialKey ?? null,
                visible: true,
                renderOrder: 0,
                passId: 'main',
                receiveLighting: true,
                uniformOverrides: Object.freeze({}),
                ...(morphData ? { morph: morphData } : {}),
                ...(skinData ? { skin: skinData } : {}),
            })
        ),
        // Snapshot verisi tel-formatında (encodeGltfValue) saklanır; tüketiciler
        // Float32Array benzeri alanları $type zarfından geçirir.
    }) as unknown as GltfComponentSnapshot;
};

const createMorphWeights = (
    node: GltfNodeJson,
    mesh: GltfMeshJson | undefined,
    primitiveIndex: number
): Float32Array | undefined => {
    const primitive = mesh?.primitives[primitiveIndex];
    const targetCount = primitive?.targets?.length ?? 0;
    if (targetCount === 0) {
        return undefined;
    }

    const sourceWeights = node.weights ?? mesh?.weights;
    const weights = new Float32Array(targetCount);
    if (sourceWeights) {
        const count = Math.min(targetCount, sourceWeights.length);
        for (let index = 0; index < count; index += 1) {
            weights[index] = Number(sourceWeights[index] ?? 0);
        }
    }

    return weights;
};

const collectSkinJointNodeIds = (
    root: GltfRootJson,
    importedNodeIds: ReadonlySet<string>
): readonly string[] => {
    const nodes = root.nodes ?? [];
    const skins = root.skins ?? [];
    for (const node of nodes) {
        if (node.skin === undefined) {
            continue;
        }
        const skin = skins[node.skin];
        if (!skin) {
            continue;
        }
        const jointNodeIds = skin.joints
            .map((jointIndex) => `node/${jointIndex}`)
            .filter((nodeId) => importedNodeIds.has(nodeId));
        if (jointNodeIds.length > 0) {
            return Object.freeze(jointNodeIds);
        }
    }
    return Object.freeze([]);
};

export const createAnimatorSnapshot = (
    animations: readonly GltfAnimationClipAsset[],
    metadata: GltfAnimationControllerMetadata | undefined,
    skinJointNodeIds?: readonly string[]
): GltfComponentSnapshot | undefined => {
    type SerializableTrack = Readonly<{
        targetNodeId: string;
        path: 'translation' | 'rotation' | 'scale' | 'weights';
        interpolation: NonNullable<GltfAnimationClipAsset['tracks'][number]['interpolation']>;
        keyframeCount: number;
        valueComponentCount: number;
        sampleStride: number;
        times: Float32Array;
        values: Float32Array;
    }>;

    type SerializableClip = Readonly<{
        id: string;
        duration: number;
        events?: readonly AnimationClipEventDefinition[];
        footContacts?: readonly AnimationFootContactDefinition[];
        tags?: readonly string[];
        features?: readonly AnimationMotionFeatureDefinition[];
        compression?: AnimationClipCompressionDefinition;
        streaming?: AnimationClipStreamingDefinition;
        tracks: readonly SerializableTrack[];
    }>;

    const clipMetadataById = new Map(
        (metadata?.clips ?? EMPTY_ARRAY).map((clip) => [clip.id, clip] as const)
    );

    const clips = animations
        .map((clip) => {
            const clipMetadata = clipMetadataById.get(clip.id) ?? clip;
            const tracks = clip.tracks
                .map(
                    (track) =>
                        Object.freeze({
                            targetNodeId: track.targetNodeId,
                            path: track.path,
                            interpolation: track.interpolation,
                            keyframeCount: track.keyframeCount,
                            valueComponentCount: track.valueComponentCount,
                            sampleStride: track.sampleStride,
                            times: new Float32Array(track.times),
                            values: new Float32Array(track.values),
                        } satisfies SerializableTrack)
                );

            if (tracks.length === 0) {
                return undefined;
            }

            return Object.freeze({
                id: clip.id,
                duration: clip.duration,
                ...(clipMetadata.events ? { events: clipMetadata.events } : {}),
                ...(clipMetadata.footContacts ? { footContacts: clipMetadata.footContacts } : {}),
                ...(clipMetadata.tags ? { tags: clipMetadata.tags } : {}),
                ...(clipMetadata.features ? { features: clipMetadata.features } : {}),
                ...(clipMetadata.compression ? { compression: clipMetadata.compression } : {}),
                ...(clipMetadata.streaming ? { streaming: clipMetadata.streaming } : {}),
                tracks: Object.freeze(tracks),
            } satisfies SerializableClip);
        })
        .filter((clip) => clip !== undefined) as readonly SerializableClip[];

    if (clips.length === 0) {
        return undefined;
    }

    return Object.freeze({
        type: 'Animator',
        data: encodeGltfValue(
            Object.freeze({
                clips: Object.freeze(clips),
                ...(metadata?.parameters ? { parameters: metadata.parameters } : {}),
                ...(metadata?.layers ? { layers: metadata.layers } : {}),
                ...(metadata && 'rootMotion' in metadata ? { rootMotion: metadata.rootMotion ?? null } : {}),
                clipId: clips[0]?.id ?? null,
                ...(skinJointNodeIds && skinJointNodeIds.length > 0
                    ? { skinJointNodeIds: Object.freeze([...skinJointNodeIds]) }
                    : {}),
                playOnStart: true,
                playing: true,
                loop: true,
                speed: 1,
                time: 0,
            })
        ),
        // Snapshot verisi tel-formatında (encodeGltfValue) saklanır; bkz. createMeshRendererSnapshot.
    }) as unknown as GltfComponentSnapshot;
};

export const buildPrefabDefinition = (context: PrefabBuildContext): PrefabBuildResult => {
    const {
        root,
        sceneIndex,
        defaultSceneIndex,
        meshKeysByMesh,
        materialKeysByMesh,
        skinsByIndex,
        skinKeysByIndex,
        animationsByIndex,
        animationKeysByIndex,
        manifest,
    } = context;

    const scene = root.scenes?.[sceneIndex];
    if (!scene) {
        throw new GltfSchemaError(`Missing scene ${sceneIndex}`);
    }

    const actors: GltfActorSnapshot[] = [];
    const rootNodeIds: string[] = [];
    const nodeIds: string[] = [];
    const meshKeys = new Set<string>();
    const skinKeys = new Set<string>();
    const animationKeys = new Set<string>();
    const materialKeys = new Set<string>();
    const diagnostics: GltfDiagnostic[] = [];
    let primaryCameraAssigned = false;
    let primaryDirectionalAssigned = false;
    let directionalLightCount = 0;
    let localLightCount = 0;

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
        const meshDefinition = node.mesh !== undefined ? root.meshes?.[node.mesh] : undefined;
        const primitiveMorphWeights = meshDefinition
            ? meshDefinition.primitives.map((_, primitiveIndex) =>
                  createMorphWeights(node, meshDefinition, primitiveIndex)
              )
            : EMPTY_ARRAY;
        const transformComponent = createTransformSnapshot(node);
        const nodeName = sanitizeName(node.name, `Node ${nodeIndex}`);
        const skin =
            node.skin !== undefined
                ? skinsByIndex[node.skin] ??
                  (() => {
                      throw new GltfSchemaError(`Missing skin ${node.skin}`);
                  })()
                : undefined;
        const skinBinding = createSkinBinding(skin);
        const punctualLight = resolveNodeLight(root, node, nodeIndex);
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
        const lightComponent =
            punctualLight?.light.type === 'directional'
                ? createDirectionalLightSnapshot(
                      punctualLight.light,
                      sceneIndex === defaultSceneIndex && primaryDirectionalAssigned === false
                  )
                : punctualLight?.light.type === 'point'
                  ? createPointLightSnapshot(punctualLight.light)
                  : punctualLight?.light.type === 'spot'
                    ? createSpotLightSnapshot(punctualLight.light)
                    : undefined;

        if (cameraComponent && sceneIndex === defaultSceneIndex && primaryCameraAssigned === false) {
            primaryCameraAssigned = true;
        }

        if (
            punctualLight?.light.type === 'directional' &&
            sceneIndex === defaultSceneIndex &&
            primaryDirectionalAssigned === false
        ) {
            primaryDirectionalAssigned = true;
        }

        if (punctualLight?.light.type === 'directional') {
            directionalLightCount += 1;
        } else if (
            punctualLight?.light.type === 'point' ||
            punctualLight?.light.type === 'spot'
        ) {
            localLightCount += 1;
        }

        if (primitives.length <= 1) {
            const components = Object.freeze([
                transformComponent,
                ...(cameraComponent ? [cameraComponent] : EMPTY_ARRAY),
                ...(lightComponent ? [lightComponent] : EMPTY_ARRAY),
                ...(primitives.length === 1
                    ? [
                          createMeshRendererSnapshot(
                              primitives[0]!,
                              primitiveMaterials[0],
                              primitiveMorphWeights[0],
                              skinBinding
                          ),
                      ]
                    : EMPTY_ARRAY),
            ]);

            actors.push(createActorSnapshot(baseNodeId, parentNodeId, nodeName, components));
            nodeIds.push(baseNodeId);

            if (primitives.length === 1) {
                meshKeys.add(primitives[0]!);
                if (node.skin !== undefined && skinKeysByIndex[node.skin]) {
                    skinKeys.add(skinKeysByIndex[node.skin]!);
                }
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
                        ...(lightComponent ? [lightComponent] : EMPTY_ARRAY),
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
                                type: 'Transform' as const,
                                data: Object.freeze({
                                    position: [0, 0, 0] as const,
                                    rotation: [0, 0, 0, 1] as const,
                                    scale: [1, 1, 1] as const,
                                }),
                            }),
                            createMeshRendererSnapshot(
                                primitives[primitiveIndex]!,
                                primitiveMaterials[primitiveIndex],
                                primitiveMorphWeights[primitiveIndex],
                                skinBinding
                            ),
                        ])
                    )
                );
                nodeIds.push(primitiveNodeId);
                meshKeys.add(primitives[primitiveIndex]!);
                if (node.skin !== undefined && skinKeysByIndex[node.skin]) {
                    skinKeys.add(skinKeysByIndex[node.skin]!);
                }
                if (primitiveMaterials[primitiveIndex]) {
                    materialKeys.add(primitiveMaterials[primitiveIndex]!);
                }
            }
        }

        const children = ensureArray(node.children);
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ nodeIndex: children[i]!, parentNodeId: baseNodeId });
        }
    };

    // Iterative traversal with explicit stack to avoid stack overflow on deep hierarchies
    const stack: Array<{ nodeIndex: number; parentNodeId: string | null }> = [];
    const visited = new Set<number>();
    const sceneRootNodes = ensureArray(scene.nodes);
    for (let i = sceneRootNodes.length - 1; i >= 0; i--) {
        stack.push({ nodeIndex: sceneRootNodes[i]!, parentNodeId: null });
    }
    while (stack.length > 0) {
        const { nodeIndex, parentNodeId } = stack.pop()!;
        if (visited.has(nodeIndex)) {
            continue;
        }
        visited.add(nodeIndex);
        visitNode(nodeIndex, parentNodeId);
    }

    const importedNodeIds = new Set(nodeIds.filter((nodeId) => nodeId.startsWith('node/')));
    const sceneAnimations = animationsByIndex
        .map((animation, index) => {
            if (!animation) {
                return undefined;
            }

            const hasTrackedTarget = animation.tracks.some(
                (track) =>
                    importedNodeIds.has(track.targetNodeId) &&
                    (track.path === 'translation' ||
                        track.path === 'rotation' ||
                        track.path === 'scale' ||
                        track.path === 'weights')
            );
            if (!hasTrackedTarget) {
                return undefined;
            }

            if (animationKeysByIndex[index]) {
                animationKeys.add(animationKeysByIndex[index]!);
            }
            return animation;
        })
        .filter((animation): animation is GltfAnimationClipAsset => Boolean(animation));

    const animationController = resolveSceneAnimationControllerMetadata(
        root.scenes?.[sceneIndex],
        sceneIndex,
        new Set(sceneAnimations.map((animation) => animation.id)),
        importedNodeIds,
        sceneAnimations,
        manifest,
        diagnostics,
        true
    );

    const skinJointNodeIds = collectSkinJointNodeIds(root, importedNodeIds);
    const animatorComponent = createAnimatorSnapshot(
        sceneAnimations,
        animationController,
        skinJointNodeIds
    );
    if (animatorComponent) {
        const firstRootActorIndex = actors.findIndex((actor) => actor.parentNodeId === null);
        if (firstRootActorIndex >= 0) {
            const firstRootActor = actors[firstRootActorIndex]!;
            actors[firstRootActorIndex] = Object.freeze({
                ...firstRootActor,
                components: Object.freeze([...firstRootActor.components, animatorComponent]),
            });
        }
    }

    if (directionalLightCount > 1) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.light.directional.runtime-limit',
                message: `Scene ${sceneIndex} imports ${directionalLightCount} directional lights, but Axrone currently shades only one directional light`,
            } satisfies GltfDiagnostic)
        );
    }

    if (localLightCount > MAX_SCENE_LOCAL_LIGHTS) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.light.local.runtime-limit',
                message: `Scene ${sceneIndex} imports ${localLightCount} local lights, but Axrone currently shades only ${MAX_SCENE_LOCAL_LIGHTS} point/spot lights`,
            } satisfies GltfDiagnostic)
        );
    }

    return {
        prefab: Object.freeze({
            id: `gltf/scene/${sceneIndex}`,
            actors: Object.freeze(actors),
        }),
        rootNodeIds: Object.freeze(rootNodeIds),
        nodeIds: Object.freeze(nodeIds),
        meshKeys: Object.freeze([...meshKeys]),
        skinKeys: Object.freeze([...skinKeys]),
        animationKeys: Object.freeze([...animationKeys]),
        materialKeys: Object.freeze([...materialKeys]),
        ...(animationController ? { animationController } : {}),
        diagnostics: Object.freeze(diagnostics),
    };
};
