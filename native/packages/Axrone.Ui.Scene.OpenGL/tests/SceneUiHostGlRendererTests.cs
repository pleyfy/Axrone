namespace Axrone.Ui.Scene.OpenGL.Tests;

using System.Buffers;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Ui;
using Axrone.Ui.Assets;
using Axrone.Ui.Rendering;
using Axrone.Ui.Rendering.OpenGL;
using Axrone.Ui.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostGlRendererTests
{
    private const string AssetId = "UI/test-hud.ui.json";
    private static readonly UiViewport Viewport = new(new UiSize(320.0f, 180.0f));

    [Fact]
    public void GlyphUploaderCreatesPagesAndTextureBindings()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using UiHostGlyphAtlasUploader uploader = new(context);

        UiResourceId resource = uploader.CreatePage(new UiGlyphAtlasPageId(1), 64, 64, UiGlyphFormat.Alpha8);
        uploader.UploadGlyph(new UiGlyphAtlasPageId(1), new Rect(0.0f, 0.0f, 16.0f, 16.0f), new byte[256]);

        resource.IsValid.Should().BeTrue();
        uploader.PageCount.Should().Be(1);
        uploader.TryGetTexture(resource, out UiTextureBinding binding).Should().BeTrue();
        binding.Width.Should().Be(64);
        binding.Height.Should().Be(64);
        binding.Texture.Should().NotBe(0U);
        api.CallLog.Should().Contain(static call => call.StartsWith("TexStorage2D(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(static call => call.StartsWith("BindTexture(", StringComparison.Ordinal));
    }

    [Fact]
    public void ScreenHostRendersThroughTheUiBackend()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.ScreenOverlay);
        bridge.Sync();
        bridge.Update(in Viewport);
        using SceneUiHostGlRenderer renderer = new(context, bridge);

        renderer.Render(world, null, in Viewport, bridge);

        renderer.FrameCount.Should().Be(1);
        renderer.LastScreenHosts.Should().Be(1);
        renderer.LastWorldHosts.Should().Be(0);
        api.CallLog.Should().Contain(static call => call.StartsWith("DrawArraysInstanced(", StringComparison.Ordinal));
        _ = actor;
    }

    [Fact]
    public void WorldHostRendersIntoSurfaceAndDrawsQuad()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneActor hostActor = AddHost(world, SceneUiHostRenderMode.WorldSpace);
        SceneCameraFrame camera = CreateCamera(world);
        bridge.Sync();
        using SceneUiHostGlRenderer renderer = new(context, bridge);

        renderer.Render(world, camera, in Viewport, bridge);

        renderer.LastWorldHosts.Should().Be(1);
        renderer.LastScreenHosts.Should().Be(0);
        renderer.SurfaceCount.Should().Be(1);
        renderer.TryGetSurfaceSize(hostActor, out int width, out int height).Should().BeTrue();
        width.Should().Be(512);
        height.Should().Be(256);
        api.CallLog.Should().Contain(static call => call.StartsWith("GenFramebuffer(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(static call => call.StartsWith("FramebufferTexture2D(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(static call => call.StartsWith("DrawArrays(5", StringComparison.Ordinal));
    }

    [Fact]
    public void SurfaceResizesWithComponentSize()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.WorldSpace);
        SceneCameraFrame camera = CreateCamera(world);
        bridge.Sync();
        using SceneUiHostGlRenderer renderer = new(context, bridge);
        renderer.Render(world, camera, in Viewport, bridge);

        ref SceneUiHost component = ref world.GetData<SceneUiHost>(actor);
        component.WorldWidth = 2.0f;
        component.WorldHeight = 1.0f;
        bridge.Sync();
        renderer.Render(world, camera, in Viewport, bridge);

        renderer.TryGetSurfaceSize(actor, out int width, out int height).Should().BeTrue();
        width.Should().Be(1024);
        height.Should().Be(512);
    }

    [Fact]
    public void HiddenHostIsSkipped()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.ScreenOverlay);
        ref SceneUiHost component = ref world.GetData<SceneUiHost>(actor);
        component.Visible = false;
        bridge.Sync();
        using SceneUiHostGlRenderer renderer = new(context, bridge);

        renderer.Render(world, null, in Viewport, bridge);

        renderer.LastScreenHosts.Should().Be(0);
        api.CallLog.Should().NotContain(static call => call.StartsWith("DrawArraysInstanced(", StringComparison.Ordinal));
    }

    [Fact]
    public void RemovingTheHostPrunesItsSurface()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.WorldSpace);
        SceneCameraFrame camera = CreateCamera(world);
        bridge.Sync();
        using SceneUiHostGlRenderer renderer = new(context, bridge);
        renderer.Render(world, camera, in Viewport, bridge);
        renderer.SurfaceCount.Should().Be(1);

        world.RemoveData<SceneUiHost>(actor);
        bridge.Sync();
        renderer.Render(world, camera, in Viewport, bridge);

        renderer.SurfaceCount.Should().Be(0);
    }

    [Fact]
    public void DisposeIsIdempotent()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world);
        SceneUiHostGlRenderer renderer = new(context, bridge);
        renderer.Dispose();
        renderer.Dispose();
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-host-gl")))
            .AddTransform3D()
            .AddRendering3D()
            .AddUiHosts()
            .Build()
            .CreateWorld();

    private static SceneUiHostBridge CreateBridge(SceneWorld world) =>
        new(world, new SceneUiHostBridgeOptions { Assets = CreateTable() });

    private static SceneActor AddHost(SceneWorld world, SceneUiHostRenderMode mode)
    {
        SceneActor actor = world.CreateActor("Hud");
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(AssetId);
        component.RenderMode = mode;
        world.AddData(actor, component);
        world.UpdateTransforms();
        return actor;
    }

    private static SceneCameraFrame CreateCamera(SceneWorld world)
    {
        SceneActor actor = world.CreateActor("Camera");
        world.GetTransform3D(actor).SetPosition(new Vec3(0.0f, 0.0f, 5.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(actor, camera);
        world.UpdateTransforms();
        SceneCameraFrame? frame = new SceneCameraFrameCollector().Collect(world, 320, 180);
        return frame!;
    }

    private static UiHostAssetTable CreateTable()
    {
        var builder = new UiAssetDocumentBuilder { AssetId = AssetId };
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TrySetLayout(root, UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Stretch(1.0f),
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Stretch,
        });
        UiNodeId panel = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TryAppendChild(root, panel);
        builder.TrySetLayout(panel, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(80.0f),
            Height = UiLength.Px(40.0f),
        });

        UiCanvasConfig canvas = new(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero);
        UiAssetDocument document = builder.Build(new UiDocumentInfo(new UiDocumentId(1), "hud", 1, canvas));
        ArrayBufferWriter<byte> buffer = new();
        using (var codec = new UiDocumentJsonCodec(reuseStorage: false))
        {
            codec.Write(document, buffer);
        }

        UiHostAssetTable table = new();
        table.Add(AssetId, buffer.WrittenSpan);
        return table;
    }
}
