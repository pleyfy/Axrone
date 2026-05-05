import type {
    GltfActorSnapshot,
    GltfComponentSnapshot,
    GltfMaterialDefinition,
    GltfMeshBounds,
    GltfMeshDefinition,
    GltfPrefabDefinition,
    GltfSamplerDefinition,
    GltfShaderDefinition,
    GltfTextureDefinition,
} from '@axrone/asset-gltf';
import type {
    SceneMaterialDefinition,
    SceneMeshDefinition,
    ScenePrefabDefinition,
    SceneSamplerDefinition,
    SceneShaderDefinition,
    SceneTextureDefinition,
} from '@axrone/scene-runtime';

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

const adaptGltfMeshBoundsToScene = (
    bounds: Readonly<GltfMeshBounds> | undefined
): SceneMeshDefinition['bounds'] | undefined => {
    if (!bounds) {
        return undefined;
    }

    const centerX = (bounds.min[0] + bounds.max[0]) * 0.5;
    const centerY = (bounds.min[1] + bounds.max[1]) * 0.5;
    const centerZ = (bounds.min[2] + bounds.max[2]) * 0.5;
    const radius = Math.hypot(
        bounds.max[0] - centerX,
        bounds.max[1] - centerY,
        bounds.max[2] - centerZ
    );

    return {
        kind: 'sphere',
        center: [centerX, centerY, centerZ],
        radius,
    };
};

export const adaptGltfMeshDefinitionToScene = (
    definition: GltfMeshDefinition,
    id: string,
    bounds?: Readonly<GltfMeshBounds>
): SceneMeshDefinition => ({
    ...definition,
    id,
    ...(adaptGltfMeshBoundsToScene(bounds) ? { bounds: adaptGltfMeshBoundsToScene(bounds) } : {}),
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
): SceneMaterialDefinition => {
    const material = definition as GltfMaterialDefinition & Partial<SceneMaterialDefinition>;

    return {
        ...definition,
        uniforms: definition.uniforms ? { ...definition.uniforms } : undefined,
        textures: definition.textures ? { ...definition.textures } : undefined,
        ...(material.surface ? { surface: material.surface } : {}),
        ...(material.passes ? { passes: material.passes } : {}),
    };
};

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
    effect: definition.effect,
    attributes: definition.attributes ? { ...definition.attributes } : undefined,
    uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
});
