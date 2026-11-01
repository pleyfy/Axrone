namespace Axrone.Scene.Gltf.Tests;

using System.Collections.Immutable;
using Axrone.AssetGltf;
using Axrone.Numeric;
using Axrone.Scene.Gltf;
using Axrone.Scene.Prefab;

internal static class SceneGltfTestFactory
{
    public static GltfMaterialAsset Material(
        string id = "material0",
        string shaderId = "gltf/pbr",
        bool unlit = false,
        GltfAlphaMode alphaMode = GltfAlphaMode.Opaque,
        float alphaCutoff = 0.5f,
        bool doubleSided = false,
        IReadOnlyDictionary<string, float[]>? floats = null,
        IReadOnlyDictionary<string, float>? scalars = null,
        IReadOnlyDictionary<string, int>? ints = null,
        IReadOnlyDictionary<GltfTextureUsage, GltfMaterialTextureBinding>? textures = null) =>
        new()
        {
            Id = id,
            MaterialIndex = 0,
            Definition = new GltfMaterialDefinition
            {
                ShaderId = shaderId,
                FloatUniforms = (floats ?? ImmutableDictionary<string, float[]>.Empty)
                    .ToImmutableDictionary(StringComparer.Ordinal),
                ScalarUniforms = (scalars ?? ImmutableDictionary<string, float>.Empty)
                    .ToImmutableDictionary(StringComparer.Ordinal),
                IntUniforms = (ints ?? ImmutableDictionary<string, int>.Empty)
                    .ToImmutableDictionary(StringComparer.Ordinal)
            },
            AlphaMode = alphaMode,
            AlphaCutoff = alphaCutoff,
            DoubleSided = doubleSided,
            Unlit = unlit,
            Textures = (textures ?? ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding>.Empty)
                .ToImmutableDictionary()
        };

    public static GltfMaterialTextureBinding Binding(
        string textureKey,
        int texCoord = 0,
        float scale = 1.0f,
        float strength = 1.0f,
        Vec2? transformScale = null,
        Vec2? transformOffset = null,
        float rotation = 0.0f,
        int transformTexCoord = 0) =>
        new()
        {
            TextureKey = textureKey,
            TexCoord = texCoord,
            Scale = scale,
            Strength = strength,
            Transform = new GltfTextureTransform(
                transformOffset ?? Vec2.Zero,
                transformScale ?? Vec2.One,
                rotation,
                transformTexCoord)
        };

    public static GltfTextureAsset Texture(
        string id = "texture0",
        GltfTexturePayload? payload = null,
        GltfTextureSampler? sampler = null,
        ImmutableArray<GltfTextureUsage> usageHints = default) =>
        new()
        {
            Id = id,
            TextureIndex = 0,
            ImageIndex = 0,
            Sampler = sampler ?? new GltfTextureSampler(9729, 9987, 10497, 10497),
            Payload = payload ?? new GltfTranscodedTexturePayload(
                new byte[16],
                GltfTextureFormat.R8G8B8A8_UNorm,
                [new GltfTextureMipLevel(0, 2, 2, 0, 16)]),
            UsageHints = usageHints.IsDefault ? ImmutableArray<GltfTextureUsage>.Empty : usageHints
        };

    public static GltfMeshAsset Mesh(string id = "mesh0") =>
        new()
        {
            Id = id,
            MeshIndex = 0,
            PrimitiveIndex = 0,
            Definition = new GltfMeshDefinition(
                id,
                new byte[36],
                [new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false)],
                [],
                new byte[6],
                VertexCount: 3,
                IndexCount: 3,
                Index16Bit: true,
                GltfMeshTopology.Triangles)
        };

    public static GltfActorSnapshot Actor(
        string nodeId = "node_0_Root",
        string name = "Root",
        string meshId = "mesh0",
        string materialId = "material0") =>
        new()
        {
            NodeId = nodeId,
            Name = name,
            Layer = 0,
            Tag = "Default",
            Active = true,
            Components =
            [
                new GltfTransformComponent(Vec3.Zero, Quat.Identity, Vec3.One),
                new GltfMeshRendererComponent(meshId, materialId, true, 0, "main", true, null, 0)
            ]
        };

    public static GltfPrefabAsset Prefab(
        string id = "gltf/scene/0",
        int sceneIndex = 0,
        IReadOnlyList<GltfActorSnapshot>? actors = null)
    {
        IReadOnlyList<GltfActorSnapshot> actorList = actors is { Count: > 0 } ? actors : [Actor()];
        var nodeIds = new List<string>(actorList.Count);
        for (int i = 0; i < actorList.Count; i++)
        {
            nodeIds.Add(actorList[i].NodeId);
        }

        return new GltfPrefabAsset
        {
            Id = id,
            SceneIndex = sceneIndex,
            Definition = new GltfPrefabDefinition { Actors = [.. actorList] },
            RootNodeIds = [actorList[0].NodeId],
            NodeIds = [.. nodeIds],
            MeshKeys = [],
            SkinKeys = [],
            AnimationKeys = [],
            MaterialKeys = []
        };
    }

    public static GltfImportResult Result(
        ImmutableArray<GltfMaterialAsset>? materials = null,
        ImmutableArray<GltfTextureAsset>? textures = null,
        ImmutableArray<GltfMeshAsset>? meshes = null,
        ImmutableArray<GltfPrefabAsset>? prefabs = null)
    {
        ImmutableArray<GltfMaterialAsset> materialArray = materials ?? [Material()];
        ImmutableArray<GltfTextureAsset> textureArray = textures ?? [Texture()];
        ImmutableArray<GltfMeshAsset> meshArray = meshes ?? [Mesh()];
        ImmutableArray<GltfPrefabAsset> prefabArray = prefabs ?? [Prefab()];
        string prefabKey = prefabArray.IsDefaultOrEmpty ? string.Empty : prefabArray[0].Id;
        ImmutableArray<string> rootNodeIds = prefabArray.IsDefaultOrEmpty
            ? []
            : prefabArray[0].RootNodeIds;

        var document = new GltfDocumentAsset
        {
            Id = "sample",
            Name = "Sample",
            Format = "gltf",
            Version = "2.0",
            DefaultScene = 0,
            Scenes =
            [
                new GltfDocumentSceneAsset
                {
                    SceneIndex = 0,
                    Name = "Scene0",
                    PrefabKey = prefabKey,
                    RootNodeIds = rootNodeIds
                }
            ],
            MeshKeys = [.. SelectList(meshArray, mesh => mesh.Id)],
            SkinKeys = [],
            AnimationKeys = [],
            MaterialKeys = [.. SelectList(materialArray, material => material.Id)],
            TextureKeys = [.. SelectList(textureArray, texture => texture.Id)],
            ExtensionsUsed = [],
            ExtensionsRequired = [],
            Stats = new GltfDocumentStats(1, 1, 0, 0, 1, 1, 1, 1, 0, 0)
        };

        return new GltfImportResult
        {
            Document = document,
            Prefabs = prefabArray,
            Meshes = meshArray,
            Skins = [],
            Animations = [],
            Materials = materialArray,
            Textures = textureArray,
            Diagnostics = []
        };
    }

    private static List<TResult> SelectList<TSource, TResult>(
        IReadOnlyList<TSource> source,
        Func<TSource, TResult> selector)
    {
        var result = new List<TResult>(source.Count);
        for (int i = 0; i < source.Count; i++)
        {
            result.Add(selector(source[i]));
        }

        return result;
    }
}
