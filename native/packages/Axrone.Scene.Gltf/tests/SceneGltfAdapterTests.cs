namespace Axrone.Scene.Gltf.Tests;

using System.Collections.Immutable;
using Axrone.AssetGltf;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using Axrone.Scene.Prefab;
using Axrone.Scene.Rendering;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfAdapterTests
{
    [Fact]
    public void Import_ConvertsMeshMaterialTextureAndPrefab()
    {
        GltfImportResult source = CreateResult();

        SceneGltfImportResult result = SceneGltfAdapter.Import(source);
        SceneSnapshot snapshot = result.Snapshot;

        snapshot.Meshes.Should().ContainSingle();
        snapshot.Materials.Should().ContainSingle();
        snapshot.Textures.Should().ContainSingle();
        snapshot.Samplers.Should().ContainSingle();
        snapshot.Prefab.Actors.Should().ContainSingle();

        SceneMeshDefinition mesh = snapshot.Meshes[0];
        mesh.Id.Should().Be(SceneAssetId<MeshAssetTag>.FromName("gltf/mesh0"));
        mesh.VertexCount.Should().Be(3);
        mesh.IndexFormat.Should().Be(SceneIndexFormat.UInt16);
        mesh.Bounds.Should().NotBeNull();

        SceneMaterialDefinition material = snapshot.Materials[0];
        material.Id.Should().Be(SceneAssetId<MaterialAssetTag>.FromName("gltf/material0"));
        material.ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr"));
        material.Surface.Albedo.Should().Be(new Vec4(0.5f, 0.5f, 0.5f, 1.0f));
        material.Surface.Metallic.Should().BeApproximately(0.5f, 1e-6f);
        material.Surface.Roughness.Should().BeApproximately(0.25f, 1e-6f);
        material.Surface.AlbedoMap.Should().NotBeNull();
        material.Surface.AlbedoMap!.Value.TextureId
            .Should().Be(SceneAssetId<TextureAssetTag>.FromName("gltf/texture0"));
        material.Surface.AlbedoMap.Value.SamplerId
            .Should().Be(SceneAssetId<SamplerAssetTag>.FromName("gltf/texture0/sampler"));
        material.Uniforms.Should().ContainKey("_MetallicFactor");
    }

    [Fact]
    public void Import_ConvertsPrefabComponents()
    {
        SceneGltfImportResult result = SceneGltfAdapter.Import(CreateResult());
        SceneActorSnapshot actor = result.Snapshot.Prefab.Actors[0];

        actor.NodeId.Should().Be("node_0_Root");
        actor.Name.Should().Be("Root");
        actor.Components.Should().Contain(component => component.Type == "Transform3D");
        SceneComponentSnapshot renderer = actor.Components.Should()
            .ContainSingle(component => component.Type == "MeshRenderer").Subject;
        renderer.Data.GetProperty("mesh").GetString().Should().Be("gltf/mesh0");
        renderer.Data.GetProperty("material").GetString().Should().Be("gltf/material0");
        renderer.Data.GetProperty("pass").GetString().Should().Be("main");
    }

    [Fact]
    public void Import_ReportsUnsupportedTexturePayloads()
    {
        GltfImportResult source = CreateResult(texturePayload: new GltfExternalTexturePayload("texture.png"));

        SceneGltfImportResult result = SceneGltfAdapter.Import(source);

        result.Snapshot.Textures.Should().BeEmpty();
        result.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == "scene.gltf.unsupported-texture");
    }

    [Fact]
    public void Import_ConvertsMorphTargetsOntoTheMesh()
    {
        GltfImportResult source = CreateResult(withMorphTargets: true);

        SceneGltfImportResult result = SceneGltfAdapter.Import(source);

        result.Snapshot.Meshes.Should().ContainSingle();
        result.Snapshot.Meshes[0].MorphTargets.Should().ContainSingle();
        result.Snapshot.Meshes[0].MorphTargets[0].Semantic.Should().Be(SceneMorphTargetSemantic.Position);
        result.Diagnostics.Should().NotContain(diagnostic =>
            diagnostic.Code == "scene.gltf.morph-targets");
    }

    [Fact]
    public void Import_InternsNamesForSerializableSnapshots()
    {
        var names = new SceneNameTable();
        GltfImportResult source = CreateResult();

        SceneGltfImportResult result = SceneGltfAdapter.Import(
            source,
            new SceneGltfImportOptions { Names = names });

        byte[] json = SceneSnapshotJson.Serialize(result.Snapshot, names);
        SceneSnapshot read = SceneSnapshotJson.Deserialize(json);

        read.Meshes.Should().ContainSingle();
        read.Materials.Should().ContainSingle();
        read.Textures.Should().ContainSingle();
    }

    [Fact]
    public void Import_SelectsDefaultPrefab()
    {
        GltfImportResult source = CreateResult(additionalSceneIndex: 1);

        SceneGltfImportResult result = SceneGltfAdapter.Import(source);

        result.Snapshot.Prefab.Id.Should().Be("gltf/scene/1");
        result.Snapshot.Prefab.Actors[0].NodeId.Should().Be("node_1_Second");
    }

    private static GltfImportResult CreateResult(
        GltfTexturePayload? texturePayload = null,
        bool withMorphTargets = false,
        int? additionalSceneIndex = null)
    {
        byte[] vertices = new byte[36];
        byte[] indices = new byte[6];

        ImmutableArray<GltfMorphTargetDefinition> morphTargets = withMorphTargets
            ? [new GltfMorphTargetDefinition(
                GltfMorphTargetSemantic.Position,
                new byte[36],
                Stride: 12,
                ComponentCount: 3)]
            : [];

        var meshDefinition = new GltfMeshDefinition(
            "mesh0",
            vertices,
            [new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false)],
            morphTargets,
            indices,
            VertexCount: 3,
            IndexCount: 3,
            Index16Bit: true,
            GltfMeshTopology.Triangles);

        var mesh = new GltfMeshAsset
        {
            Id = "mesh0",
            MeshIndex = 0,
            PrimitiveIndex = 0,
            Definition = meshDefinition
        };

        var texture = new GltfTextureAsset
        {
            Id = "texture0",
            TextureIndex = 0,
            ImageIndex = 0,
            Sampler = new GltfTextureSampler(9729, 9987, 10497, 10497),
            Payload = texturePayload ?? new GltfTranscodedTexturePayload(
                new byte[16],
                GltfTextureFormat.R8G8B8A8_UNorm,
                [new GltfTextureMipLevel(0, 2, 2, 0, 16)]),
            UsageHints = []
        };

        var material = new GltfMaterialAsset
        {
            Id = "material0",
            MaterialIndex = 0,
            Definition = new GltfMaterialDefinition
            {
                ShaderId = "gltf/pbr",
                FloatUniforms = ImmutableDictionary<string, float[]>.Empty
                    .Add("_BaseColorFactor", [0.5f, 0.5f, 0.5f, 1.0f]),
                ScalarUniforms = ImmutableDictionary<string, float>.Empty
                    .Add("_MetallicFactor", 0.5f)
                    .Add("_RoughnessFactor", 0.25f),
                IntUniforms = ImmutableDictionary<string, int>.Empty
            },
            AlphaMode = GltfAlphaMode.Opaque,
            AlphaCutoff = 0.5f,
            DoubleSided = false,
            Unlit = false,
            Textures = ImmutableDictionary<GltfTextureUsage, GltfMaterialTextureBinding>.Empty
                .Add(
                    GltfTextureUsage.BaseColor,
                    new GltfMaterialTextureBinding { TextureKey = "texture0", TexCoord = 0 })
        };

        var actor = new GltfActorSnapshot
        {
            NodeId = "node_0_Root",
            Name = "Root",
            Layer = 0,
            Tag = "Default",
            Active = true,
            Components =
            [
                new GltfTransformComponent(new Vec3(1.0f, 2.0f, 3.0f), Quat.Identity, Vec3.One),
                new GltfMeshRendererComponent("mesh0", "material0", true, 0, "main", true, null, 0)
            ]
        };

        var prefabs = ImmutableArray.CreateBuilder<GltfPrefabAsset>();
        prefabs.Add(new GltfPrefabAsset
        {
            Id = "gltf/scene/0",
            SceneIndex = 0,
            Definition = new GltfPrefabDefinition { Actors = [actor] },
            RootNodeIds = ["node_0_Root"],
            NodeIds = ["node_0_Root"],
            MeshKeys = ["mesh0"],
            SkinKeys = [],
            AnimationKeys = [],
            MaterialKeys = ["material0"]
        });

        int defaultScene = 0;

        if (additionalSceneIndex is { } sceneIndex)
        {
            var secondActor = new GltfActorSnapshot
            {
                NodeId = "node_1_Second",
                Name = "Second",
                Layer = 0,
                Tag = "Default",
                Active = true,
                Components = [new GltfTransformComponent(Vec3.Zero, Quat.Identity, Vec3.One)]
            };
            prefabs.Add(new GltfPrefabAsset
            {
                Id = "gltf/scene/1",
                SceneIndex = 1,
                Definition = new GltfPrefabDefinition { Actors = [secondActor] },
                RootNodeIds = ["node_1_Second"],
                NodeIds = ["node_1_Second"],
                MeshKeys = [],
                SkinKeys = [],
                AnimationKeys = [],
                MaterialKeys = []
            });
            defaultScene = sceneIndex;
        }

        var document = new GltfDocumentAsset
        {
            Id = "sample",
            Name = "Sample",
            Format = "gltf",
            Version = "2.0",
            DefaultScene = defaultScene,
            Scenes =
            [
                new GltfDocumentSceneAsset
                {
                    SceneIndex = 0,
                    Name = "Scene0",
                    PrefabKey = "gltf/scene/0",
                    RootNodeIds = ["node_0_Root"]
                }
            ],
            MeshKeys = ["mesh0"],
            SkinKeys = [],
            AnimationKeys = [],
            MaterialKeys = ["material0"],
            TextureKeys = ["texture0"],
            ExtensionsUsed = [],
            ExtensionsRequired = [],
            Stats = new GltfDocumentStats(1, 1, 0, 0, 1, 1, 1, 1, 0, 0)
        };

        return new GltfImportResult
        {
            Document = document,
            Prefabs = prefabs.ToImmutable(),
            Meshes = [mesh],
            Skins = [],
            Animations = [],
            Materials = [material],
            Textures = [texture],
            Diagnostics = []
        };
    }
}
