import type { AssetDatabase } from '../database';
import type {
    AssetImportDiagnostic,
    AssetRecord,
    AssetSelector,
} from '../types';
import type {
    SceneMaterialDefinition,
    SceneMeshDefinition,
    SceneShaderDefinition,
    SceneSnapshot,
    SceneTextureDefinition,
} from '../../scene';
import {
    createSceneTextureDefinitionFromGltfTexture,
    normalizeGltfMaterialDefinition,
} from './internal/runtime-scene-assets';
import { resolveGltfShaderDefinition } from './internal/runtime-shaders';
import type {
    GltfAssetSchemaLike,
    GltfDocumentSceneAsset,
    GltfPrefabAsset,
} from './types';

export interface GltfSceneSnapshotOptions {
    readonly sceneIndex?: number;
    readonly resolveShaderDefinition?: (shaderId: string) => SceneShaderDefinition | undefined;
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
    const textures = new Map<string, SceneTextureDefinition>();
    const materials: SceneMaterialDefinition[] = [];
    const meshes: SceneMeshDefinition[] = [];
    const shaderDefinitions = new Map<string, SceneShaderDefinition>();

    for (const materialKey of prefab.data.materialKeys) {
        const material = database.require({ key: materialKey, kind: 'gltf.material' });
        materials.push(normalizeGltfMaterialDefinition(material.data, material.key));

        const shaderDefinition = resolveGltfShaderDefinition(
            material.data.definition.shaderId,
            options.resolveShaderDefinition
        );
        if (!shaderDefinition) {
            throw new Error(
                `glTF runtime bridge cannot resolve shader '${material.data.definition.shaderId}' for material '${materialKey}'`
            );
        }
        shaderDefinitions.set(shaderDefinition.id, shaderDefinition);

        for (const textureBinding of Object.values(material.data.textures)) {
            const texture = database.require({ key: textureBinding.textureKey, kind: 'gltf.texture' });
            if (!samplers.has(texture.data.sampler.id)) {
                samplers.set(texture.data.sampler.id, { ...texture.data.sampler });
            }
            if (!textures.has(texture.key)) {
                const built = createSceneTextureDefinitionFromGltfTexture(texture.key, texture.data);
                textures.set(texture.key, built.definition);
                diagnostics.push(...built.diagnostics);
            }
        }
    }

    for (const meshKey of prefab.data.meshKeys) {
        const mesh = database.require({ key: meshKey, kind: 'gltf.mesh' });
        meshes.push({
            ...mesh.data.definition,
            id: mesh.key,
        });
    }

    return {
        document,
        scene,
        prefab,
        snapshot: {
            version: 1,
            prefab: prefab.data.definition,
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