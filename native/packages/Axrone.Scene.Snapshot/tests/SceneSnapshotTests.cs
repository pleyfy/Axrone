namespace Axrone.Scene.Snapshot.Tests;

using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Axrone.AssetShader;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Prefab;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneSnapshotTests
{
    [Fact]
    public void Json_RoundTripsSnapshot()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();

        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        var readNames = new SceneNameTable();
        using JsonDocument document = JsonDocument.Parse(json);
        SceneSnapshot read = SceneSnapshotJson.Read(document.RootElement, readNames);
        byte[] rewritten = SceneSnapshotJson.Serialize(read, readNames);

        read.Shaders.Should().ContainSingle().Which.Id.Should().Be(snapshot.Shaders[0].Id);
        read.Meshes.Should().ContainSingle().Which.VertexCount.Should().Be(3);
        read.Samplers.Should().ContainSingle();
        read.Textures.Should().ContainSingle().Which.Width.Should().Be(4);
        read.RenderPasses.Should().ContainSingle().Which.ClearMask
            .Should().Be(SceneClearMask.Color | SceneClearMask.Depth);
        read.Materials.Should().ContainSingle().Which.Uniforms.Count.Should().Be(2);
        read.Prefab.Actors.Should().HaveCount(2);
        rewritten.Should().Equal(json);
    }

    [Fact]
    public void Json_PreservesMaterialDetails()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();

        SceneSnapshot read = SceneSnapshotJson.Deserialize(
            SceneSnapshotJson.Serialize(snapshot, assets.Names));

        SceneMaterialDefinition material = read.Materials[0];
        material.Surface.ShadingModel.Should().Be(SceneMaterialShadingModel.Pbr);
        material.Surface.AlphaMode.Should().Be(SceneMaterialAlphaMode.Blend);
        material.Surface.Features.Should().HaveFlag(SceneMaterialFeatures.AlbedoMap);
        material.Surface.AlbedoMap.Should().NotBeNull();
        material.Surface.AlbedoMap!.Value.TextureId.Should().Be(snapshot.Textures[0].Id);
        material.Surface.AlbedoMap.Value.SamplerId.Should().Be(snapshot.Samplers[0].Id);
        material.Surface.AlbedoMap.Value.Scale.Should().Be(new Vec2(2.0f, 3.0f));
        material.Passes.Should().ContainSingle().Which.Id.Should().Be("main");
        material.Passes[0].Blend.Should().BeTrue();
        material.Uniforms["intensity"].Kind.Should().Be(SceneUniformKind.Float);
        material.Uniforms["tint"].Kind.Should().Be(SceneUniformKind.Vec3);
    }

    [Fact]
    public void Json_PreservesMeshPayloads()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();

        SceneSnapshot read = SceneSnapshotJson.Deserialize(
            SceneSnapshotJson.Serialize(snapshot, assets.Names));

        SceneMeshDefinition mesh = read.Meshes[0];
        mesh.Vertices.ToArray().Should().Equal(snapshot.Meshes[0].Vertices.ToArray());
        mesh.Indices.ToArray().Should().Equal(snapshot.Meshes[0].Indices.ToArray());
        mesh.Bounds!.Value.Center.Should().Be(new Vec3(0.0f, 1.0f, 0.0f));
        mesh.Bounds.Value.Radius.Should().BeApproximately(2.0f, 1e-6f);
        mesh.Topology.Should().Be(SceneMeshTopology.Triangles);
        mesh.IndexFormat.Should().Be(SceneIndexFormat.UInt16);
    }

    [Fact]
    public void Loader_RegistersAssetsAndInstantiatesPrefab()
    {
        (SceneSnapshot snapshot, _) = CreateSnapshot();
        using SceneWorld world = CreateProfile().CreateWorld();
        var assets = new SceneAssetRegistry();
        var codecs = new SceneCodecRegistry(world.Registry);
        ScenePrefabCodecs.RegisterCore(codecs, world.Registry);
        var loader = new SceneSnapshotLoader(world, assets, codecs);

        ScenePrefabInstantiationResult result = loader.Load(
            snapshot,
            new SceneSnapshotLoadOptions { NamePrefix = "Loaded/" });

        result.Actors.Should().HaveCount(2);
        world.ActorCount.Should().Be(2);
        world.GetName(result.Actors[0]).Should().Be("Loaded/Root");
        world.GetTransform3D(result.Actors[1]).Position.Should().Be(new Vec3(1.0f, 2.0f, 3.0f));
        assets.Shaders.Count.Should().Be(1);
        assets.Meshes.Count.Should().Be(1);
        assets.Materials.Count.Should().Be(1);
        assets.Textures.Count.Should().Be(1);
        assets.Samplers.Count.Should().Be(1);
        assets.RenderPasses.Count.Should().Be(1);
    }

    [Fact]
    public void Loader_AddsDefaultRenderPassWhenSnapshotHasNone()
    {
        (SceneSnapshot snapshot, _) = CreateSnapshot();
        var withoutPasses = new SceneSnapshot(
            snapshot.Prefab,
            snapshot.Shaders,
            snapshot.Meshes,
            snapshot.Materials,
            snapshot.Textures,
            snapshot.Samplers,
            []);
        using SceneWorld world = CreateProfile().CreateWorld();
        var assets = new SceneAssetRegistry();
        var codecs = new SceneCodecRegistry(world.Registry);
        ScenePrefabCodecs.RegisterCore(codecs, world.Registry);

        _ = new SceneSnapshotLoader(world, assets, codecs).Load(withoutPasses);

        SceneAssetId<RenderPassAssetTag> mainId = assets.CreateId<RenderPassAssetTag>("main");
        SceneRenderPassDefinition pass = assets.RenderPasses.Get(mainId);
        pass.ClearMask.Should().Be(SceneClearMask.Color | SceneClearMask.Depth);
        pass.ClearColor.Should().Be(new Vec4(0.08f, 0.09f, 0.11f, 1.0f));
    }

    [Fact]
    public void Loader_RollsBackAssetRegistrationsOnFailure()
    {
        (SceneSnapshot snapshot, _) = CreateSnapshot();
        using SceneWorld world = CreateProfile().CreateWorld();
        var assets = new SceneAssetRegistry();
        SceneAssetId<ShaderAssetTag> existingId = assets.CreateId<ShaderAssetTag>("shader/existing");
        assets.Shaders.Register(new SceneShaderDefinition(existingId, "void main(){}", "void main(){}"));

        var codecs = new SceneCodecRegistry(world.Registry);
        ScenePrefabCodecs.RegisterCore(codecs, world.Registry);

        var brokenPrefab = new ScenePrefabDefinition(
            "prefab/broken",
            [
                new SceneActorSnapshot(
                    "root",
                    "Root",
                    0,
                    "Untagged",
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [Component("Missing", """{"value":1}""")])
            ]);
        var brokenSnapshot = new SceneSnapshot(
            brokenPrefab,
            snapshot.Shaders,
            snapshot.Meshes,
            snapshot.Materials,
            snapshot.Textures,
            snapshot.Samplers,
            snapshot.RenderPasses);
        var loader = new SceneSnapshotLoader(world, assets, codecs);

        Action act = () => loader.Load(
            brokenSnapshot,
            new SceneSnapshotLoadOptions { ClearExisting = false });

        act.Should().Throw<SceneSnapshotException>()
            .Where(exception => exception.Code == SceneSnapshotErrorCodes.LoadFailed);
        assets.Shaders.Count.Should().Be(1);
        assets.Shaders.Contains(existingId).Should().BeTrue();
        assets.Meshes.Count.Should().Be(0);
        assets.Materials.Count.Should().Be(0);
        world.ActorCount.Should().Be(0);
    }

    [Fact]
    public void Capture_CollectsWorldAndCatalog()
    {
        using SceneWorld world = CreateProfile().CreateWorld();
        var assets = new SceneAssetRegistry();
        var codecs = new SceneCodecRegistry(world.Registry);
        ScenePrefabCodecs.RegisterCore(codecs, world.Registry);

        SceneActor root = world.CreateActor("Root");
        world.GetTransform3D(root).SetPosition(new Vec3(0.0f, 1.0f, 0.0f));
        SceneActor child = world.CreateActor("Child");
        world.Hierarchy.SetParent(child, root);
        world.GetTransform3D(child).SetPosition(new Vec3(0.0f, 2.0f, 0.0f));
        world.UpdateTransforms();

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        assets.RenderPasses.Register(new SceneRenderPassDefinition(passId));

        SceneSnapshot snapshot = SceneSnapshot.Capture(world, codecs, assets, "prefab/captured");

        snapshot.Prefab.Id.Should().Be("prefab/captured");
        snapshot.Prefab.Actors.Should().HaveCount(2);
        snapshot.Prefab.Actors[1].ParentNodeId.Should().Be(snapshot.Prefab.Actors[0].NodeId);
        snapshot.RenderPasses.Should().ContainSingle();
        snapshot.Prefab.Actors[0].Components.Should().ContainSingle()
            .Which.Type.Should().Be("Transform3D");
    }

    [Fact]
    public void Json_RoundTripsPrefabProvenance()
    {
        ScenePrefabNodeSource source = ScenePrefabNodeSource.Create(
            "prefab/base",
            "root",
            ["outer", "mid"],
            ["prefab/base"]);
        var actor = new SceneActorSnapshot(
            "root",
            "Root",
            0,
            "Default",
            active: true,
            persistent: false,
            pooled: false,
            [],
            null,
            source);
        var snapshot = new SceneSnapshot(
            new ScenePrefabDefinition("prefab/source", [actor]),
            [],
            [],
            [],
            [],
            [],
            []);
        var names = new SceneNameTable();

        byte[] json = SceneSnapshotJson.Serialize(snapshot, names);
        SceneSnapshot read = SceneSnapshotJson.Deserialize(json, names);
        byte[] rewritten = SceneSnapshotJson.Serialize(read, names);

        rewritten.Should().Equal(json);
        read.Prefab.Actors.Should().ContainSingle().Which.Source.Should().Be(source);
    }

    [Fact]
    public void Json_MissingSourceRemainsCompatible()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();
        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        JsonNode root = JsonNode.Parse(Encoding.UTF8.GetString(json))!;
        JsonArray actors = root["prefab"]!["actors"]!.AsArray();
        for (int i = 0; i < actors.Count; i++)
        {
            actors[i]!.AsObject().Remove("source");
        }

        SceneSnapshot read = SceneSnapshotJson.Deserialize(
            JsonSerializer.SerializeToUtf8Bytes(root),
            assets.Names);

        read.Prefab.Actors.Should().OnlyContain(actor => actor.Source == null);
    }

    [Fact]
    public void Json_WrongTypedUniformArrayFailsClosed()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();
        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        JsonNode root = JsonNode.Parse(Encoding.UTF8.GetString(json))!;
        root["shaders"]!.AsArray()[0]!["uniforms"] = JsonValue.Create(42);

        Action read = () => SceneSnapshotJson.Deserialize(
            JsonSerializer.SerializeToUtf8Bytes(root),
            assets.Names);

        read.Should().Throw<SceneSnapshotException>()
            .Which.Code.Should().Be(SceneSnapshotErrorCodes.Invalid);
    }

    [Fact]
    public void Json_NullUniformElementFailsClosed()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();
        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        JsonNode root = JsonNode.Parse(Encoding.UTF8.GetString(json))!;
        root["shaders"]!.AsArray()[0]!["uniforms"] = new JsonArray(
            JsonValue.Create("uModel"),
            null);

        Action read = () => SceneSnapshotJson.Deserialize(
            JsonSerializer.SerializeToUtf8Bytes(root),
            assets.Names);

        read.Should().Throw<SceneSnapshotException>()
            .Which.Code.Should().Be(SceneSnapshotErrorCodes.InvalidNullElement);
    }

    [Fact]
    public void Json_MissingUniformsRemainCompatible()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();
        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        JsonNode root = JsonNode.Parse(Encoding.UTF8.GetString(json))!;
        root["shaders"]!.AsArray()[0]!.AsObject().Remove("uniforms");

        SceneSnapshot read = SceneSnapshotJson.Deserialize(
            JsonSerializer.SerializeToUtf8Bytes(root),
            assets.Names);

        read.Shaders.Should().ContainSingle().Which.Uniforms.Should().BeEmpty();
    }

    [Fact]
    public void Json_NullShaderAttributeFailsClosed()
    {
        (SceneSnapshot snapshot, SceneAssetRegistry assets) = CreateSnapshot();
        byte[] json = SceneSnapshotJson.Serialize(snapshot, assets.Names);
        JsonNode root = JsonNode.Parse(Encoding.UTF8.GetString(json))!;
        JsonObject attributes = root["shaders"]!.AsArray()[0]!["attributes"]!.AsObject();
        foreach (KeyValuePair<string, JsonNode?> property in attributes)
        {
            attributes[property.Key] = null;
            break;
        }

        Action read = () => SceneSnapshotJson.Deserialize(
            JsonSerializer.SerializeToUtf8Bytes(root),
            assets.Names);

        read.Should().Throw<SceneSnapshotException>()
            .Which.Code.Should().Be(SceneSnapshotErrorCodes.InvalidNullElement);
    }

    private static SceneProfile CreateProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/snapshot")))
            .AddTransform3D()
            .Build();

    [Fact]
    public void Json_RoundTripsEffectTechniqueAndKeywords()
    {
        (SceneSnapshot baseline, SceneAssetRegistry assets) = CreateSnapshot();
        var effect = new ShaderEffect(new ShaderEffectDefinition(
            new ShaderSymbol("test/roundtrip"),
            new ShaderStageDefinition("void main(){}"),
            new ShaderStageDefinition("void main(){}"),
            Keywords: [new ShaderKeywordDefinition(new ShaderSymbol("MODE"), Options: ["a", "b"])]));

        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/effect");
        var shader = new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}", effect: effect);
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/effect");
        var material = new SceneMaterialDefinition(
            materialId,
            shaderId,
            new SceneMaterialSurface(),
            techniqueId: "opaque",
            keywords: new Dictionary<string, string> { ["MODE"] = "b" });

        var snapshot = new SceneSnapshot(baseline.Prefab, [shader], [], [material], [], [], []);

        SceneSnapshot read = SceneSnapshotJson.Deserialize(
            SceneSnapshotJson.Serialize(snapshot, assets.Names));

        read.Shaders[0].Effect.Should().NotBeNull();
        read.Shaders[0].Effect!.Id.Name.Should().Be("test/roundtrip");
        read.Materials[0].TechniqueId.Should().Be("opaque");
        read.Materials[0].Keywords["MODE"].Should().Be("b");
    }

    private static (SceneSnapshot Snapshot, SceneAssetRegistry Assets) CreateSnapshot()
    {
        var assets = new SceneAssetRegistry();

        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/basic");
        var shader = new SceneShaderDefinition(
            shaderId,
            "attribute vec3 aPosition; void main(){gl_Position=vec4(aPosition,1.0);}",
            "void main(){gl_FragColor=vec4(1.0);}",
            ["uModel", "uTint"],
            new Dictionary<SceneMeshSemantic, string> { [SceneMeshSemantic.Position] = "aPosition" },
            depthTest: true,
            cull: false,
            blend: true);

        SceneAssetId<MeshAssetTag> meshId = assets.CreateId<MeshAssetTag>("mesh/quad");
        var mesh = new SceneMeshDefinition(
            meshId,
            new byte[36],
            [new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)],
            vertexCount: 3,
            indices: new byte[] { 0, 1, 2, 0, 0, 0 },
            indexFormat: SceneIndexFormat.UInt16,
            indexCount: 3,
            bounds: new BoundingSphere3(new Vec3(0.0f, 1.0f, 0.0f), 2.0f));

        SceneAssetId<SamplerAssetTag> samplerId = assets.CreateId<SamplerAssetTag>("sampler/linear");
        var sampler = new SceneSamplerDefinition(
            samplerId,
            SceneFilterMode.Linear,
            SceneFilterMode.Linear,
            SceneWrapMode.ClampToEdge,
            SceneWrapMode.MirroredRepeat,
            SceneWrapMode.Repeat,
            maxAnisotropy: 4);

        SceneAssetId<TextureAssetTag> textureId = assets.CreateId<TextureAssetTag>("texture/white");
        var texture = new SceneTextureDefinition(
            textureId,
            new SceneTextureColor(new Vec4(1.0f, 1.0f, 1.0f, 1.0f), 4, 4),
            SceneTextureFormat.Srgba8,
            width: 4,
            height: 4,
            samplerId: samplerId);

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("pass/main");
        var pass = new SceneRenderPassDefinition(
            passId,
            order: 0,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.1f, 0.2f, 0.3f, 1.0f),
            clearDepth: 1.0f,
            depthTest: true);

        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/basic");
        var surface = new SceneMaterialSurface
        {
            ShadingModel = SceneMaterialShadingModel.Pbr,
            AlphaMode = SceneMaterialAlphaMode.Blend,
            Features = SceneMaterialFeatures.AlbedoMap,
            Albedo = new Vec4(0.5f, 0.6f, 0.7f, 1.0f),
            Emissive = new Vec3(0.1f, 0.0f, 0.0f),
            Metallic = 0.25f,
            Roughness = 0.75f,
            AlbedoMap = new SceneMaterialTextureBinding(
                textureId,
                samplerId,
                SceneUvSet.Uv0,
                unit: 1,
                scale: new Vec2(2.0f, 3.0f),
                offset: new Vec2(0.25f, 0.5f),
                rotation: 0.75f)
        };
        var material = new SceneMaterialDefinition(
            materialId,
            shaderId,
            surface,
            [new SceneMaterialPass("main", priority: 5, depthTest: true, blend: true)],
            new Dictionary<string, SceneUniformValue>
            {
                ["intensity"] = SceneUniformValue.FromFloat(2.5f),
                ["tint"] = SceneUniformValue.FromVec3(new Vec3(1.0f, 0.5f, 0.25f))
            });

        var prefab = new ScenePrefabDefinition(
            "prefab/demo",
            [
                new SceneActorSnapshot(
                    "root",
                    "Root",
                    0,
                    "Untagged",
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [Component("Transform3D", """{"position":[0,0,0]}""")]),
                new SceneActorSnapshot(
                    "child",
                    "Child",
                    1,
                    "Untagged",
                    active: true,
                    persistent: false,
                    pooled: false,
                    components: [Component("Transform3D", """{"position":[1,2,3]}""")],
                    parentNodeId: "root")
            ]);

        var snapshot = new SceneSnapshot(
            prefab,
            [shader],
            [mesh],
            [material],
            [texture],
            [sampler],
            [pass]);

        return (snapshot, assets);
    }

    private static SceneComponentSnapshot Component(string type, string json, string? id = null)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return new SceneComponentSnapshot(type, document.RootElement.Clone(), id);
    }
}
