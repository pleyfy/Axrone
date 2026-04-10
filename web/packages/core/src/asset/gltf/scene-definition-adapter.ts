import type {
    SceneMaterialDefinition,
    SceneMeshDefinition,
    ScenePrefabDefinition,
    SceneSamplerDefinition,
    SceneShaderDefinition,
    SceneTextureDefinition,
} from '../../scene';
import type {
    GltfActorSnapshot,
    GltfComponentSnapshot,
    GltfMaterialDefinition,
    GltfMeshDefinition,
    GltfPrefabDefinition,
    GltfSamplerDefinition,
    GltfShaderDefinition,
    GltfTextureDefinition,
} from './asset-ir';

const adaptGltfComponentSnapshotToScene = (
    component: GltfComponentSnapshot
): ScenePrefabDefinition['actors'][number]['components'][number] => ({
    ...component,
});

const adaptGltfActorSnapshotToScene = (
    actor: GltfActorSnapshot
): ScenePrefabDefinition['actors'][number] => ({
    ...actor,
    components: actor.components.map(adaptGltfComponentSnapshotToScene),
});

export const adaptGltfPrefabDefinitionToScene = (
    definition: GltfPrefabDefinition
): ScenePrefabDefinition => ({
    ...definition,
    actors: definition.actors.map(adaptGltfActorSnapshotToScene),
});

export const adaptGltfMeshDefinitionToScene = (
    definition: GltfMeshDefinition,
    id: string
): SceneMeshDefinition => ({
    ...definition,
    id,
    attributes: [...definition.attributes],
    morphTargets: definition.morphTargets
        ? definition.morphTargets.map((target) => ({
              ...target,
              attributes: [...target.attributes],
          }))
        : undefined,
});

export const adaptGltfMaterialDefinitionToScene = (
    definition: GltfMaterialDefinition
): SceneMaterialDefinition => ({
    ...definition,
    uniforms: definition.uniforms ? { ...definition.uniforms } : undefined,
    textures: definition.textures ? { ...definition.textures } : undefined,
});

export const adaptGltfTextureDefinitionToScene = (
    definition: GltfTextureDefinition
): SceneTextureDefinition => ({
    ...definition,
    source:
        definition.source.kind === 'compressed'
            ? {
                  ...definition.source,
                  levels: [...definition.source.levels],
              }
            : { ...definition.source },
});

export const adaptGltfSamplerDefinitionToScene = (
    definition: GltfSamplerDefinition
): SceneSamplerDefinition => ({
    ...definition,
});

export const adaptGltfShaderDefinitionToScene = (
    definition: GltfShaderDefinition
): SceneShaderDefinition => ({
    ...definition,
    attributes: definition.attributes ? { ...definition.attributes } : undefined,
    uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
});