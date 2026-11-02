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

    public static GltfMeshAsset Mesh(
        string id = "mesh0",
        ImmutableArray<GltfVertexAttribute>? attributes = null,
        ImmutableArray<GltfMorphTargetDefinition>? morphTargets = null,
        ImmutableArray<float>? morphWeights = null) =>
        new()
        {
            Id = id,
            MeshIndex = 0,
            PrimitiveIndex = 0,
            Definition = new GltfMeshDefinition(
                id,
                new byte[36],
                attributes ?? [new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false)],
                morphTargets ?? [],
                new byte[6],
                VertexCount: 3,
                IndexCount: 3,
                Index16Bit: true,
                GltfMeshTopology.Triangles)
            {
                MorphWeights = morphWeights ?? ImmutableArray<float>.Empty
            }
        };

    public static GltfActorSnapshot Actor(
        string nodeId = "node_0_Root",
        string name = "Root",
        string meshId = "mesh0",
        string materialId = "material0",
        string? skinId = null,
        ImmutableArray<float> morphWeights = default) =>
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
                new GltfMeshRendererComponent(meshId, materialId, true, 0, "main", true, skinId, 0)
                {
                    MorphWeights = morphWeights.IsDefault ? ImmutableArray<float>.Empty : morphWeights
                }
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
        ImmutableArray<GltfPrefabAsset>? prefabs = null,
        ImmutableArray<GltfSkinAsset>? skins = null,
        ImmutableArray<GltfAnimationClipAsset>? animations = null,
        ImmutableArray<string>? extensionsUsed = null,
        ImmutableArray<string>? extensionsRequired = null)
    {
        ImmutableArray<GltfMaterialAsset> materialArray = materials ?? [Material()];
        ImmutableArray<GltfTextureAsset> textureArray = textures ?? [Texture()];
        ImmutableArray<GltfMeshAsset> meshArray = meshes ?? [Mesh()];
        ImmutableArray<GltfPrefabAsset> prefabArray = prefabs ?? [Prefab()];
        ImmutableArray<GltfSkinAsset> skinArray = skins ?? [];
        ImmutableArray<GltfAnimationClipAsset> animationArray = animations ?? [];
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
            SkinKeys = [.. SelectList(skinArray, skin => skin.Id)],
            AnimationKeys = [.. SelectList(animationArray, animation => animation.Id)],
            MaterialKeys = [.. SelectList(materialArray, material => material.Id)],
            TextureKeys = [.. SelectList(textureArray, texture => texture.Id)],
            ExtensionsUsed = extensionsUsed ?? [],
            ExtensionsRequired = extensionsRequired ?? [],
            Stats = new GltfDocumentStats(1, 1, 0, 0, 1, 1, 1, 1, 0, 0)
        };

        return new GltfImportResult
        {
            Document = document,
            Prefabs = prefabArray,
            Meshes = meshArray,
            Skins = skinArray,
            Animations = animationArray,
            Materials = materialArray,
            Textures = textureArray,
            Diagnostics = []
        };
    }

    public static GltfSkinAsset Skin(
        string id = "gltf/skin/0",
        IReadOnlyList<string>? joints = null,
        ReadOnlyMemory<float>? inverseBindMatrices = null)
    {
        IReadOnlyList<string> jointIds = joints ?? ["node_0_Root"];
        var indices = new int[jointIds.Count];
        for (int i = 0; i < jointIds.Count; i++)
        {
            indices[i] = i;
        }

        float[] matrices = new float[jointIds.Count * 16];
        for (int i = 0; i < jointIds.Count; i++)
        {
            matrices[(i * 16) + 0] = 1.0f;
            matrices[(i * 16) + 5] = 1.0f;
            matrices[(i * 16) + 10] = 1.0f;
            matrices[(i * 16) + 15] = 1.0f;
        }

        return new GltfSkinAsset
        {
            Id = id,
            SkinIndex = 0,
            JointNodeIds = [.. jointIds],
            JointNodeIndices = [.. indices],
            SkeletonNodeId = jointIds.Count > 0 ? jointIds[0] : null,
            SkeletonNodeIndex = 0,
            InverseBindMatrices = inverseBindMatrices ?? matrices
        };
    }

    public static GltfAnimationClipAsset Animation(
        string id = "gltf/animation/0",
        string targetNodeId = "node_0_Root",
        GltfAnimationPath path = GltfAnimationPath.Translation,
        GltfInterpolation interpolation = GltfInterpolation.Linear)
    {
        int valueComponents = path == GltfAnimationPath.Rotation ? 4 : 3;
        int sampleMultiplier = interpolation == GltfInterpolation.CubicSpline ? 3 : 1;
        int sampleStride = valueComponents * sampleMultiplier;
        return new GltfAnimationClipAsset
        {
            Id = id,
            AnimationIndex = 0,
            Duration = 1.0f,
            Tracks =
            [
                new GltfAnimationTrackAsset
                {
                    ChannelIndex = 0,
                    SamplerIndex = 0,
                    InputAccessor = 0,
                    OutputAccessor = 1,
                    TargetNodeIndex = 0,
                    TargetNodeId = targetNodeId,
                    Path = path,
                    Interpolation = interpolation,
                    KeyframeCount = 2,
                    ValueComponentCount = valueComponents,
                    SampleStride = sampleStride,
                    SampleMultiplier = sampleMultiplier,
                    Times = new float[] { 0.0f, 1.0f },
                    Values = new float[2 * sampleStride]
                }
            ]
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
