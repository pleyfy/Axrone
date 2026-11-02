namespace Axrone.Scene.Runtime.Tests;

using Axrone.Animation;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneGlEndToEndTests
{
    private const int SkinnedStride = 52;

    [Fact]
    public void AnimatedSkinnedSceneRendersEveryPathDeterministically()
    {
        using var context = new GLContext(new MockGLApi { EnableCallLogging = false });
        using SceneRuntime runtime = CreateScene(out SceneActor skinnedActor, out SceneActor cameraActor);
        runtime.Animators.Should().NotBeNull();
        runtime.Animators!.Bind(skinnedActor, CreateController()).Should().BeTrue();
        runtime.Animators.Step(0.5f, runtime.BonePaletteSink);

        runtime.BonePalettes.TryGetBonePalette(skinnedActor, out ReadOnlySpan<Mat4> palette).Should().BeTrue();
        palette[0].M14.Should().BeApproximately(0.5f, 0.001f);

        using var renderer = new SceneGlFrameRenderer(context, runtime);
        _ = renderer.UploadAssets();

        SceneRenderStats first = renderer.Render(0, elapsedSeconds: 1.0f);

        first.DrawCalls.Should().Be(5);
        first.TrianglesSubmitted.Should().Be(10);
        runtime.Frame.LodItems[0].MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/far"));
        runtime.Frame.SkinnedItems.Length.Should().Be(1);
        runtime.Frame.BillboardItems.Length.Should().Be(1);
        runtime.Frame.LineItems.Length.Should().Be(2);
        runtime.Frame.TrailItems.Length.Should().Be(1);

        SceneRenderStats second = renderer.Render(1, elapsedSeconds: 1.0f);
        second.DrawCalls.Should().Be(first.DrawCalls);
        second.TrianglesSubmitted.Should().Be(first.TrianglesSubmitted);

        runtime.World.GetTransform3D(cameraActor).SetPosition(new Vec3(0, 0, 1));
        runtime.World.UpdateTransforms();
        SceneRenderStats near = renderer.Render(2, elapsedSeconds: 1.0f);
        near.DrawCalls.Should().Be(5);
        runtime.Frame.LodItems[0].MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/near"));

        runtime.BonePalettes.Remove(skinnedActor);
        SceneRenderStats unskinned = renderer.Render(3, elapsedSeconds: 1.0f);
        unskinned.DrawCalls.Should().Be(4);
        unskinned.TrianglesSubmitted.Should().Be(9);
    }

    [Fact]
    public void FrameCollectionIsZeroAllocationAfterWarmup()
    {
        using SceneRuntime runtime = CreateScene(out _, out _);
        runtime.Frame.TimeSeconds = 1.0f;

        static void Collect(SceneFramePipeline frame)
        {
            _ = frame.CollectLodItems(SceneRenderPassIds.Main);
            _ = frame.CollectSkinnedMeshes(SceneRenderPassIds.Main);
            _ = frame.CollectBillboards(SceneRenderPassIds.Main);
            _ = frame.CollectLines(SceneRenderPassIds.Main);
            _ = frame.CollectTrails(SceneRenderPassIds.Main);
        }

        runtime.Frame.Plan(0);
        Collect(runtime.Frame);
        runtime.Frame.Plan(1);
        Collect(runtime.Frame);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            runtime.Frame.Plan(i);
            Collect(runtime.Frame);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    private static SceneRuntime CreateScene(out SceneActor skinnedActor, out SceneActor cameraActor)
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<ShaderAssetTag> shader = assets.CreateId<ShaderAssetTag>("shader/basic");
        assets.Shaders.Register(new SceneShaderDefinition(shader, SkinnableVertexShader, FragmentShader));
        SceneAssetId<MaterialAssetTag> material = assets.CreateId<MaterialAssetTag>("material/basic");
        assets.Materials.Register(new SceneMaterialDefinition(material, shader, new SceneMaterialSurface()));
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("main");
        assets.RenderPasses.Register(new SceneRenderPassDefinition(
            pass,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: true,
            blend: false));

        SceneAssetId<MeshAssetTag> skinnedMesh = RegisterSkinnedMesh(assets);
        SceneAssetId<MeshAssetTag> nearMesh = RegisterPlainMesh(assets, "mesh/near");
        SceneAssetId<MeshAssetTag> farMesh = RegisterPlainMesh(assets, "mesh/far");
        SceneAssetId<TextureAssetTag> texture = assets.CreateId<TextureAssetTag>("texture/billboard");
        assets.Textures.Register(new SceneTextureDefinition(texture, new SceneTextureColor(Vec4.One, 8, 8)));

        SceneProfile profile = new SceneProfileBuilder(
            new SceneProfileId(SceneStringId.FromName("test/e2e-wiring")))
            .AddTransform3D()
            .AddRendering3D()
            .AddAnimators3D()
            .AddSceneRenderables(
                SceneRenderableFeatures.Billboard |
                SceneRenderableFeatures.Line |
                SceneRenderableFeatures.Trail |
                SceneRenderableFeatures.LodGroup |
                SceneRenderableFeatures.SkinnedMesh)
            .Build();
        SceneRuntime runtime = new(new SceneRuntimeOptions { Profile = profile }, assets);

        cameraActor = runtime.World.CreateActor("Camera");
        runtime.World.GetTransform3D(cameraActor).SetPosition(new Vec3(0, 0, 10));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        runtime.World.AddData(cameraActor, camera);

        skinnedActor = runtime.World.CreateActor("Skinned");
        SceneSkinnedMeshRenderer skinned = SceneSkinnedMeshRenderer.Default;
        skinned.MeshId = skinnedMesh;
        skinned.MaterialId = material;
        runtime.World.AddData(skinnedActor, skinned);
        runtime.World.AddData(skinnedActor, SceneAnimator.Default);

        SceneActor billboardActor = runtime.World.CreateActor("Billboard");
        runtime.World.GetTransform3D(billboardActor).SetPosition(new Vec3(2, 0, 0));
        SceneBillboardRenderer billboard = SceneBillboardRenderer.Default;
        billboard.TextureId = texture;
        runtime.World.AddData(billboardActor, billboard);

        runtime.Frame.Polylines.Register(1, [new Vec3(-2, 1, 0), new Vec3(0, 1, 0), new Vec3(2, 1, 0)]);
        SceneActor lineActor = runtime.World.CreateActor("Line");
        SceneLineRenderer line = SceneLineRenderer.Default;
        line.PolylineId = 1;
        runtime.World.AddData(lineActor, line);

        runtime.Frame.Trails.Register(1, capacity: 8);
        _ = runtime.Frame.Trails.Push(1, new Vec3(-1, -1, 0), 0.0f);
        _ = runtime.Frame.Trails.Push(1, new Vec3(0, -1, 0), 0.5f);
        SceneActor trailActor = runtime.World.CreateActor("Trail");
        SceneTrailRenderer trail = SceneTrailRenderer.Default;
        trail.TrailId = 1;
        runtime.World.AddData(trailActor, trail);

        SceneActor lodActor = runtime.World.CreateActor("Lod");
        SceneLodGroup group = SceneLodGroup.Default;
        group.Hysteresis = 0.0f;
        group.SetLevel(0, new SceneLodLevel(nearMesh, material, 5.0f));
        group.SetLevel(1, new SceneLodLevel(farMesh, material, 50.0f));
        runtime.World.AddData(lodActor, group);

        runtime.World.UpdateTransforms();
        return runtime;
    }

    private static SceneAssetId<MeshAssetTag> RegisterSkinnedMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/skinned");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, SkinnedStride),
            new SceneVertexAttribute(SceneMeshSemantic.Uv0, 2, 12, SkinnedStride),
            new SceneVertexAttribute(SceneMeshSemantic.Joints0, 4, 20, SkinnedStride, integer: true),
            new SceneVertexAttribute(SceneMeshSemantic.Weights0, 4, 36, SkinnedStride)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[3 * SkinnedStride],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static SceneAssetId<MeshAssetTag> RegisterPlainMesh(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>(name);
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[36],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static AnimationController CreateController()
    {
        Rig rig = new(new RigId("e2e-rig"), new BoneInfo { Name = "root", ParentIndex = -1 });
        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        var controller = new AnimationController(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        var channel = new AnimationChannel(
            0,
            ChannelTarget.Translation,
            InterpolationMode.Linear,
            ChannelTimes,
            ChannelValues);
        var clip = new AnimationClip(new ClipId("move"), 1.0f, new[] { channel });
        var layer = new AnimationLayer(
            new LayerId("base"),
            new StateMachineInstance(
                new[] { new AnimationState(new StateId("state"), new ClipMotionNode(clip)) },
                Array.Empty<StateTransition>(),
                0));
        controller.AddLayer(layer);
        controller.BindAll();
        return controller;
    }

    private const string SkinnableVertexShader = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        uniform mat4 u_Model;
        uniform mat4 u_ViewProjection;
        void main()
        {
            gl_Position = vec4(a_Position, 1.0) * u_Model * u_ViewProjection;
        }
        """;

    private const string FragmentShader = """
        #version 330 core
        out vec4 fragColor;
        void main()
        {
            fragColor = vec4(1.0);
        }
        """;

    private static readonly float[] ChannelTimes = [0.0f, 1.0f];
    private static readonly float[] ChannelValues = [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f];
}
