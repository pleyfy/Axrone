namespace Axrone.Ui.Scene.OpenGL.Tests;

using System.Buffers;
using System.IO;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Ui;
using Axrone.Ui.Assets;
using Axrone.Ui.Rendering;
using Axrone.Ui.Scene;
using Axrone.Ui.Text;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostGlTextTests
{
    private const string AssetId = "UI/text-hud.ui.json";
    private static readonly UiViewport Viewport = new(new UiSize(320.0f, 180.0f));

    [Fact]
    public void LegacyConstructorFailsFastWhenFontsHaveNoUploader()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using UiFontProvider fonts = CreateFonts(out UiFontFamilyId family, out UiTextStyle style);
        using SceneWorld world = CreateWorld();
        using SceneUiHostBridge bridge = new(world, new SceneUiHostBridgeOptions
        {
            Assets = CreateTable(),
            Runtime = new UiHostRuntimeOptions
            {
                Fonts = fonts,
                DefaultFamily = family,
                DefaultTextStyle = style,
            },
        });

        Action create = () => _ = new SceneUiHostGlRenderer(context, bridge);

        create.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void CoverageFallbackRendersWhenSdfIsDisabled()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using UiFontProvider fonts = CreateFonts(out UiFontFamilyId family, out UiTextStyle style);
        using SceneWorld world = CreateWorld();
        using UiHostGlyphAtlasUploader uploader = new(context);
        using SceneUiHostBridge bridge = new(world, BridgeOptions(fonts, family, style, uploader, enableSdf: false));
        using SceneUiHostGlRenderer renderer = new(context, bridge, uploader);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.ScreenOverlay);
        bridge.Sync();
        bridge.Update(in Viewport);

        renderer.Render(world, null, in Viewport, bridge);

        renderer.MissedGlyphs.Should().Be(0);
        renderer.MissingTextures.Should().Be(0);
        renderer.SdfGlyphBatches.Should().Be(0);
        renderer.CoverageGlyphBatches.Should().BeGreaterThan(0);

        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();
        UiFrame frame = host!.BuildFrame(in Viewport);
        AssertAtlasFormat(bridge, frame, UiGlyphFormat.Alpha8);
    }

    [Fact]
    public void ScreenHostDrawsTextWithZeroMissingResources()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using UiFontProvider fonts = CreateFonts(out UiFontFamilyId family, out UiTextStyle style);
        using SceneWorld world = CreateWorld();
        using UiHostGlyphAtlasUploader uploader = new(context);
        using SceneUiHostBridge bridge = new(world, BridgeOptions(fonts, family, style, uploader));
        using SceneUiHostGlRenderer renderer = new(context, bridge, uploader);
        SceneActor actor = AddHost(world, SceneUiHostRenderMode.ScreenOverlay);
        bridge.Sync();
        bridge.Update(in Viewport);

        renderer.Render(world, null, in Viewport, bridge);

        renderer.UsesSharedAtlasUploader.Should().BeTrue();
        renderer.MissedGlyphs.Should().Be(0);
        renderer.MissingTextures.Should().Be(0);
        renderer.SdfGlyphBatches.Should().BeGreaterThan(0);
        renderer.CoverageGlyphBatches.Should().Be(0);
        renderer.DrawCalls.Should().BeGreaterThan(0);
        renderer.LastScreenHosts.Should().Be(1);

        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();
        UiFrame frame = host!.BuildFrame(in Viewport);
        frame.Commands.ToArray().Should().Contain(static c => c.Kind == UiRenderCommandKind.Text);
        AssertAtlasFormat(bridge, frame, UiGlyphFormat.Sdf);
        AssertPageFormat(bridge, uploader, UiGlyphFormat.Sdf);
    }

    [Fact]
    public void WorldHostDrawsTextThroughTheSharedUploader()
    {
        MockGLApi api = new();
        using GLContext context = new(api);
        using UiFontProvider fonts = CreateFonts(out UiFontFamilyId family, out UiTextStyle style);
        using SceneWorld world = CreateWorld();
        using UiHostGlyphAtlasUploader uploader = new(context);
        using SceneUiHostBridge bridge = new(world, BridgeOptions(fonts, family, style, uploader));
        using SceneUiHostGlRenderer renderer = new(context, bridge);
        SceneActor hostActor = AddHost(world, SceneUiHostRenderMode.WorldSpace);
        SceneCameraFrame camera = CreateCamera(world);
        bridge.Sync();

        renderer.Render(world, camera, in Viewport, bridge);

        renderer.UsesSharedAtlasUploader.Should().BeTrue();
        renderer.MissedGlyphs.Should().Be(0);
        renderer.MissingTextures.Should().Be(0);
        renderer.SdfGlyphBatches.Should().BeGreaterThan(0);
        renderer.CoverageGlyphBatches.Should().Be(0);
        renderer.DrawCalls.Should().BeGreaterThan(0);
        renderer.LastWorldHosts.Should().Be(1);

        bridge.TryGetHost(hostActor, out SceneUiHostInstance? host).Should().BeTrue();
        UiViewport surface = host!.SurfaceViewport;
        UiFrame frame = host.BuildFrame(in surface);
        frame.Commands.ToArray().Should().Contain(static c => c.Kind == UiRenderCommandKind.Text);
        AssertAtlasFormat(bridge, frame, UiGlyphFormat.Sdf);
    }

    private static void AssertAtlasFormat(SceneUiHostBridge bridge, UiFrame frame, UiGlyphFormat expected)
    {
        UiTextLayoutId layoutId = UiTextLayoutId.Invalid;
        for (int i = 0; i < frame.Commands.Length; i++)
        {
            if (frame.Commands[i].Kind == UiRenderCommandKind.Text)
            {
                layoutId = frame.Commands[i].TextLayout;
                break;
            }
        }

        layoutId.IsValid.Should().BeTrue();
        bridge.Text.TryGetLayout(layoutId, out _, out UiFontFaceId face).Should().BeTrue();
        bridge.Text.GlyphAtlas.TryGetEntry(face, 'A', out UiGlyphAtlasEntry entry).Should().BeTrue();
        entry.Format.Should().Be(expected);
    }

    private static UiHostRuntimeOptions RuntimeOptions(UiFontProvider fonts, UiFontFamilyId family, UiTextStyle style, UiHostGlyphAtlasUploader uploader, bool enableSdf = true) =>
        new()
        {
            Fonts = fonts,
            DefaultFamily = family,
            DefaultTextStyle = style,
            GlyphUploader = uploader,
            EnableSdfGlyphs = enableSdf,
        };

    private static SceneUiHostBridgeOptions BridgeOptions(
        UiFontProvider fonts,
        UiFontFamilyId family,
        UiTextStyle style,
        UiHostGlyphAtlasUploader uploader,
        bool enableSdf = true) =>
        new() { Assets = CreateTable(), Runtime = RuntimeOptions(fonts, family, style, uploader, enableSdf) };

    private static void AssertPageFormat(SceneUiHostBridge bridge, UiHostGlyphAtlasUploader uploader, UiGlyphFormat expected)
    {
        bool found = false;
        ReadOnlySpan<UiGlyphAtlasPageId> pages = bridge.Text.GlyphAtlas.Pages;
        for (int i = 0; i < pages.Length; i++)
        {
            if (uploader.TryGetPageFormat(pages[i], out UiGlyphFormat format))
            {
                format.Should().Be(expected);
                found = true;
            }
        }

        found.Should().BeTrue();
    }

    private static UiFontProvider CreateFonts(out UiFontFamilyId family, out UiTextStyle style)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fonts", "kenpixel.ttf");
        File.Exists(path).Should().BeTrue();
        UiFontProvider fonts = new();
        UiFontFaceId face = fonts.RegisterFace(
            File.ReadAllBytes(path),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.ToString());
        family = UiFontProvider.FromFamilyName("Test");
        style = new UiTextStyle(face, 16.0f, 20.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 1);
        return fonts;
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-host-gl-text")))
            .AddTransform3D()
            .AddRendering3D()
            .AddUiHosts()
            .Build()
            .CreateWorld();

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
        return new SceneCameraFrameCollector().Collect(world, 320, 180)!;
    }

    private static UiHostAssetTable CreateTable()
    {
        var builder = new UiAssetDocumentBuilder { AssetId = AssetId };
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TrySetLayout(root, UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Stretch(1.0f),
            AlignItems = UiAlign.Stretch,
        });

        UiNodeId panel = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TryAppendChild(root, panel);
        builder.TrySetLayout(panel, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(60.0f),
            Padding = new UiEdgeInsets(8.0f, 8.0f, 8.0f, 8.0f),
        });

        UiNodeId label = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TryAppendChild(panel, label);
        builder.TrySetLayout(label, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(160.0f),
            Height = UiLength.Px(24.0f),
        });
        builder.TrySetText(label, new UiNodeText("ABV", string.Empty, 16.0f, UiFontWeight.Normal, UiFontStyle.Normal, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 20.0f, 0.0f, 1));

        UiCanvasConfig canvas = new(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero);
        UiAssetDocument document = builder.Build(new UiDocumentInfo(new UiDocumentId(1), "text-hud", 1, canvas));
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
