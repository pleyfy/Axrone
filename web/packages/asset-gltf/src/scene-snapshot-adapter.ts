import type {
    AssetDatabase,
    AssetImportDiagnostic,
    AssetRecord,
    AssetSelector,
} from './asset-contract';
import type { SceneSnapshot } from '@axrone/scene-runtime';
import {
    createGltfTextureDefinitionFromTextureAsset,
    normalizeGltfMaterialDefinition,
} from './internal/runtime-scene-assets';
import { resolveGltfShaderDefinition } from './internal/runtime-shaders';
import {
    adaptGltfMaterialDefinitionToScene,
    adaptGltfMeshDefinitionToScene,
    adaptGltfPrefabDefinitionToScene,
    adaptGltfSamplerDefinitionToScene,
    adaptGltfShaderDefinitionToScene,
    adaptGltfTextureDefinitionToScene,
} from './scene-definition-adapter';
import type { GltfShaderDefinition } from './asset-ir';
import type {
    GltfAssetSchemaLike,
    GltfDocumentSceneAsset,
} from './types';

export interface GltfSceneSnapshotOptions {
    readonly sceneIndex?: number;
    readonly resolveShaderDefinition?: (shaderId: string) => GltfShaderDefinition | undefined;
}

export interface GltfSceneSnapshotResult {
    readonly document: AssetRecord<GltfAssetSchemaLike, 'gltf.document'>;
    readonly scene: GltfDocumentSceneAsset;
    readonly prefab: AssetRecord<GltfAssetSchemaLike, 'gltf.prefab'>;
    readonly snapshot: SceneSnapshot;
    readonly diagnostics: readonly AssetImportDiagnostic[];
}

export const createGltfSceneSnapshot = (
    database: AssetDatabase<GltfAssetSchemaLike>,
    selector: AssetSelector<GltfAssetSchemaLike, 'gltf.document'>,
    options: GltfSceneSnapshotOptions = {}
): GltfSceneSnapshotResult => {
    const document = database.require(selector);
    const sceneIndex = options.sceneIndex ?? document.data.defaultScene;
    const scene = document.data.scenes[sceneIndex];
    if (!scene) {
        throw new Error(`glTF document does not contain scene ${sceneIndex}`);
    }

    const prefab = database.require({
        key: scene.prefabKey,
        kind: 'gltf.prefab',
    });
    const diagnostics: AssetImportDiagnostic[] = [];
    const samplers = new Map<string, SceneSnapshot['samplers'][number]>();
    const textures = new Map<string, SceneSnapshot['textures'][number]>();
    const materials: SceneSnapshot['materials'][number][] = [];
    const meshes: SceneSnapshot['meshes'][number][] = [];
    const shaderDefinitions = new Map<string, SceneSnapshot['shaders'][number]>();

    for (const materialKey of prefab.data.materialKeys) {
        const material = database.require({ key: materialKey, kind: 'gltf.material' });
        materials.push(
            adaptGltfMaterialDefinitionToScene(
                normalizeGltfMaterialDefinition(material.data, material.key)
            )
        );

        const shaderDefinition = resolveGltfShaderDefinition(
            material.data.definition.shaderId,
            options.resolveShaderDefinition
        );
        if (!shaderDefinition) {
            throw new Error(
                `glTF runtime bridge cannot resolve shader '${material.data.definition.shaderId}' for material '${materialKey}'`
            );
        }
        shaderDefinitions.set(
            shaderDefinition.id,
            adaptGltfShaderDefinitionToScene(shaderDefinition)
        );

        for (const textureBinding of Object.values(material.data.textures)) {
            if (!textureBinding) {
                continue;
            }
            const texture = database.require({ key: textureBinding.textureKey, kind: 'gltf.texture' });
            if (!samplers.has(texture.data.sampler.id)) {
                samplers.set(
                    texture.data.sampler.id,
                    adaptGltfSamplerDefinitionToScene(texture.data.sampler)
                );
            }
            if (!textures.has(texture.key)) {
                const built = createGltfTextureDefinitionFromTextureAsset(
                    texture.key,
                    texture.data
                );
                textures.set(texture.key, adaptGltfTextureDefinitionToScene(built.definition));
                diagnostics.push(...built.diagnostics);
            }
        }
    }

    for (const meshKey of prefab.data.meshKeys) {
        const mesh = database.require({ key: meshKey, kind: 'gltf.mesh' });
        meshes.push(adaptGltfMeshDefinitionToScene(mesh.data.definition, mesh.key));
    }

    return {
        document,
        scene,
        prefab,
        snapshot: {
            version: 1,
            prefab: adaptGltfPrefabDefinitionToScene(prefab.data.definition),
            shaders: [...shaderDefinitions.values()],
            meshes,
            materials,
            textures: [...textures.values()],
            samplers: [...samplers.values()],
            renderPasses: [],
        },
        diagnostics: Object.freeze(diagnostics),
    };
};
