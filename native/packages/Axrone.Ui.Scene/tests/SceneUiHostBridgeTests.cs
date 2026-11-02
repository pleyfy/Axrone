namespace Axrone.Ui.Scene.Tests;

using System.IO;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Ui;
using Axrone.Ui.Assets;
using Axrone.Ui.Controls;
using Axrone.Ui.Input;
using Axrone.Ui.Rendering;
using Axrone.Ui.Scene;
using Axrone.Ui.Text;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostBridgeTests
{
    private static readonly UiViewport Viewport = new(new UiSize(320.0f, 180.0f));

    [Fact]
    public void SyncBindsAnAssetBackedHost()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable()));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);

        bridge.Sync();

        bridge.HostCount.Should().Be(1);
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();
        bridge.Update(in Viewport).Should().BeGreaterThan(0);

        UiFrame frame = host!.BuildFrame(in Viewport);
        frame.Commands.Length.Should().BeGreaterThan(0);
        frame.Viewport.Width.Should().Be(320.0f);
    }

    [Fact]
    public void SyncRemovesHostsWhenComponentDisappears()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable()));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.HostCount.Should().Be(1);

        world.RemoveData<SceneUiHost>(actor);
        bridge.Sync();

        bridge.HostCount.Should().Be(0);
    }

    [Fact]
    public void DisabledHostIsNotBound()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable()));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        component.Enabled = false;
        UiHostTestAssets.AddHost(world, in component);

        bridge.Sync();

        bridge.HostCount.Should().Be(0);
    }

    [Fact]
    public void MissingAssetIsSkipped()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, Options(new UiHostAssetTable()));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName("UI/missing.ui.json");
        UiHostTestAssets.AddHost(world, in component);

        bridge.Sync();

        bridge.HostCount.Should().Be(0);
    }

    [Fact]
    public void ReceiveInputFalseBlocksPointerRouting()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        RecordingSink sink = new();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable(), sink));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        component.ReceiveInput = false;
        UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.Update(in Viewport);

        bool handled = bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Down, 1.0f, 1.0f), in Viewport);

        handled.Should().BeFalse();
        sink.Events.Should().BeEmpty();
    }

    [Fact]
    public void PointerClicksTheAuthoredButton()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        RecordingSink sink = new();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable(), sink));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.Update(in Viewport);
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();

        UiNodeId button = FindButton(host!.Runtime.Nodes);
        button.IsValid.Should().BeTrue();
        host.Runtime.Controls.TryGetBounds(button, out Rect bounds).Should().BeTrue();
        Vec2 center = new(bounds.X + (bounds.Width * 0.5f), bounds.Y + (bounds.Height * 0.5f));

        bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Move, center.X, center.Y), in Viewport).Should().BeFalse();
        bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Down, center.X, center.Y), in Viewport).Should().BeTrue();
        bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Up, center.X, center.Y), in Viewport).Should().BeTrue();

        sink.Events.Should().Contain(static e => e.EventKind == UiControlEventKind.Click);
    }

    [Fact]
    public void SortingOrderPicksTheTopHost()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        RecordingSink sink = new();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable(), sink));

        SceneUiHost low = SceneUiHost.Default;
        low.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        low.SortingOrder = 0;
        UiHostTestAssets.AddHost(world, in low);

        SceneUiHost high = SceneUiHost.Default;
        high.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        high.SortingOrder = 5;
        SceneActor topActor = UiHostTestAssets.AddHost(world, in high);
        bridge.Sync();
        bridge.Update(in Viewport);
        bridge.TryGetHost(topActor, out SceneUiHostInstance? top).Should().BeTrue();

        UiNodeId button = FindButton(top!.Runtime.Nodes);
        top.Runtime.Controls.TryGetBounds(button, out Rect bounds).Should().BeTrue();
        Vec2 center = new(bounds.X + (bounds.Width * 0.5f), bounds.Y + (bounds.Height * 0.5f));

        bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Down, center.X, center.Y), in Viewport);
        bridge.ProcessPointer(ButtonEvent(UiPointerPhase.Up, center.X, center.Y), in Viewport);

        sink.Events.Should().ContainSingle(static e => e.EventKind == UiControlEventKind.Click);
    }

    [Fact]
    public void WorldPointerMapsToSurfacePixels()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        SceneActor cameraActor = world.CreateActor("Camera");
        world.GetTransform3D(cameraActor).SetPosition(new Vec3(0.0f, 0.0f, 5.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(cameraActor, camera);
        world.UpdateTransforms();

        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        component.RenderMode = SceneUiHostRenderMode.WorldSpace;
        SceneActor hostActor = UiHostTestAssets.AddHost(world, in component);
        world.UpdateTransforms();

        SceneCameraFrame? frame = new SceneCameraFrameCollector().Collect(world, 320, 180);
        frame.Should().NotBeNull();

        bool mapped = SceneUiHostBridge.TryMapWorldPointer(
            world,
            hostActor,
            in component,
            in Viewport,
            frame!,
            new Vec2(160.0f, 90.0f),
            out Vec2 surface,
            out float distance);

        mapped.Should().BeTrue();
        distance.Should().BeGreaterThan(0.0f);
        surface.X.Should().BeApproximately(256.0f, 0.5f);
        surface.Y.Should().BeApproximately(128.0f, 0.5f);
    }

    [Fact]
    public void BillboardModelFacesTheCamera()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        component.RenderMode = SceneUiHostRenderMode.WorldSpace;
        component.Billboard = SceneUiHostBillboard.CameraFacing;
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        world.UpdateTransforms();

        SceneUiHostMath.TryBuildWorldModel(world, actor, in component, new Vec3(2.0f, 1.0f, 5.0f), out Mat4 model)
            .Should().BeTrue();
        model.IsAllFinite.Should().BeTrue();
        SceneUiHost fixedComponent = component;
        fixedComponent.Billboard = SceneUiHostBillboard.None;
        SceneUiHostMath.TryBuildWorldModel(world, actor, in fixedComponent, new Vec3(2.0f, 1.0f, 5.0f), out Mat4 fixedModel)
            .Should().BeTrue();
        model.Should().NotBe(fixedModel);
    }

    [Fact]
    public void FrameBuildIsDeterministic()
    {
        using SceneWorld firstWorld = UiHostTestAssets.CreateWorld();
        using SceneWorld secondWorld = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge first = new(firstWorld, Options(UiHostTestAssets.CreateTable()));
        using SceneUiHostBridge second = new(secondWorld, Options(UiHostTestAssets.CreateTable()));

        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor firstActor = UiHostTestAssets.AddHost(firstWorld, in component);
        SceneActor secondActor = UiHostTestAssets.AddHost(secondWorld, in component);
        first.Sync();
        second.Sync();
        first.Update(in Viewport);
        second.Update(in Viewport);
        first.TryGetHost(firstActor, out SceneUiHostInstance? firstHost).Should().BeTrue();
        second.TryGetHost(secondActor, out SceneUiHostInstance? secondHost).Should().BeTrue();

        UiFrame firstFrame = firstHost!.BuildFrame(in Viewport);
        UiFrame secondFrame = secondHost!.BuildFrame(in Viewport);

        firstFrame.Commands.Length.Should().Be(secondFrame.Commands.Length);
        for (int i = 0; i < firstFrame.Commands.Length; i++)
        {
            firstFrame.Commands[i].Should().Be(secondFrame.Commands[i]);
        }
    }

    [Fact]
    public void TextAssetProducesTextCommandsAndGlyphPages()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fonts", "kenpixel.ttf");
        File.Exists(path).Should().BeTrue();
        using var fonts = new UiFontProvider();
        UiFontFaceId face = fonts.RegisterFace(File.ReadAllBytes(path), new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal), out UiFontError error);
        face.IsValid.Should().BeTrue(error.ToString());

        var options = new SceneUiHostBridgeOptions
        {
            Assets = UiHostTestAssets.CreateTable(withLabel: true),
            Runtime = new UiHostRuntimeOptions
            {
                Fonts = fonts,
                DefaultFamily = UiFontProvider.FromFamilyName("Test"),
                DefaultTextStyle = new UiTextStyle(face, 16.0f, 20.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 1),
            },
        };

        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, options);
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.Update(in Viewport);
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();

        UiFrame frame = host!.BuildFrame(in Viewport);

        frame.Commands.Length.Should().BeGreaterThan(0);
        bool hasText = false;
        for (int i = 0; i < frame.Commands.Length; i++)
        {
            hasText |= frame.Commands[i].Kind == UiRenderCommandKind.Text;
        }

        hasText.Should().BeTrue();
        bridge.Text.GlyphAtlas.PageCount.Should().BeGreaterThan(0);

        UiTextLayoutId layoutId = UiTextLayoutId.Invalid;
        for (int i = 0; i < frame.Commands.Length; i++)
        {
            if (frame.Commands[i].Kind == UiRenderCommandKind.Text)
            {
                layoutId = frame.Commands[i].TextLayout;
                break;
            }
        }

        TryGetAtlasFormat(bridge, layoutId, out UiGlyphFormat format).Should().BeTrue();
        format.Should().Be(UiGlyphFormat.Sdf);
    }

    [Fact]
    public void CoverageFallbackIsUsedWhenSdfIsDisabled()
    {
        using UiFontProvider fonts = CreateFonts(out UiFontFaceId face);
        var options = new SceneUiHostBridgeOptions
        {
            Assets = UiHostTestAssets.CreateTable(withLabel: true),
            Runtime = new UiHostRuntimeOptions
            {
                Fonts = fonts,
                DefaultFamily = UiFontProvider.FromFamilyName("Test"),
                DefaultTextStyle = new UiTextStyle(face, 16.0f, 20.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 1),
                EnableSdfGlyphs = false,
            },
        };

        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, options);
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.Update(in Viewport);
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();

        UiFrame frame = host!.BuildFrame(in Viewport);
        UiTextLayoutId layoutId = UiTextLayoutId.Invalid;
        for (int i = 0; i < frame.Commands.Length; i++)
        {
            if (frame.Commands[i].Kind == UiRenderCommandKind.Text)
            {
                layoutId = frame.Commands[i].TextLayout;
                break;
            }
        }

        TryGetAtlasFormat(bridge, layoutId, out UiGlyphFormat format).Should().BeTrue();
        format.Should().Be(UiGlyphFormat.Alpha8);
    }

    [Fact]
    public void SteadyStateSdfFramesAllocateNothing()
    {
        using UiFontProvider fonts = CreateFonts(out UiFontFaceId face);
        var options = new SceneUiHostBridgeOptions
        {
            Assets = UiHostTestAssets.CreateTable(withLabel: true),
            Runtime = new UiHostRuntimeOptions
            {
                Fonts = fonts,
                DefaultFamily = UiFontProvider.FromFamilyName("Test"),
                DefaultTextStyle = new UiTextStyle(face, 16.0f, 20.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 1),
            },
        };

        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, options);
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();

        for (int i = 0; i < 4; i++)
        {
            bridge.Update(in Viewport);
            _ = host!.BuildFrame(in Viewport);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            bridge.Update(in Viewport);
            _ = host!.BuildFrame(in Viewport);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void SteadyStateFramesAllocateNothing()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable()));
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(UiHostTestAssets.AssetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.TryGetHost(actor, out _).Should().BeFalse();
        bridge.Sync();
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();

        for (int i = 0; i < 4; i++)
        {
            bridge.Update(in Viewport);
            _ = host!.BuildFrame(in Viewport);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            bridge.Update(in Viewport);
            _ = host!.BuildFrame(in Viewport);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void DisposeIsIdempotent()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        SceneUiHostBridge bridge = new(world, Options(UiHostTestAssets.CreateTable()));
        bridge.Dispose();
        bridge.Dispose();

        Action sync = () => bridge.Sync();
        sync.Should().Throw<ObjectDisposedException>();
    }

    private static SceneUiHostBridgeOptions Options(IUiHostAssetSource assets, IUiControlEventSink? events = null) =>
        new()
        {
            Assets = assets,
            Runtime = new UiHostRuntimeOptions { Events = events },
        };

    private static UiPointerEvent ButtonEvent(UiPointerPhase phase, float x, float y) =>
        new(
            UiNodeId.Invalid,
            phase,
            new Vec2(x, y),
            Vec2.Zero,
            UiInputAdapter.MousePointerId,
            phase == UiPointerPhase.Move ? -1 : 0,
            phase == UiPointerPhase.Down ? UiPointerButtons.Left : UiPointerButtons.None,
            UiKeyModifiers.None,
            0);

    private static UiFontProvider CreateFonts(out UiFontFaceId face)
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fonts", "kenpixel.ttf");
        File.Exists(path).Should().BeTrue();
        UiFontProvider fonts = new();
        face = fonts.RegisterFace(
            File.ReadAllBytes(path),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.ToString());
        return fonts;
    }

    private static bool TryGetAtlasFormat(SceneUiHostBridge bridge, UiTextLayoutId layoutId, out UiGlyphFormat format)
    {
        format = default;
        if (!layoutId.IsValid || !bridge.Text.TryGetLayout(layoutId, out IUiTextLayout layout, out UiFontFaceId face))
        {
            return false;
        }

        ReadOnlySpan<UiShapedGlyph> glyphs = layout.Glyphs;
        for (int i = 0; i < glyphs.Length; i++)
        {
            if (bridge.Text.GlyphAtlas.TryGetEntry(face, glyphs[i].CodePoint, out UiGlyphAtlasEntry entry))
            {
                format = entry.Format;
                return true;
            }
        }

        return false;
    }

    private static UiNodeId FindButton(IUiNodeTree tree)
    {
        return Find(tree, tree.Root, 0);

        static UiNodeId Find(IUiNodeTree tree, UiNodeId node, int depth)
        {
            if (depth > 128 || !tree.TryGetNode(node, out UiNodeRecord record))
            {
                return UiNodeId.Invalid;
            }

            if (record.Kind == UiNodeKind.Button)
            {
                return node;
            }

            ReadOnlySpan<UiNodeId> children = tree.GetChildren(node);
            for (int i = 0; i < children.Length; i++)
            {
                UiNodeId found = Find(tree, children[i], depth + 1);
                if (found.IsValid)
                {
                    return found;
                }
            }

            return UiNodeId.Invalid;
        }
    }

    private sealed class RecordingSink : IUiControlEventSink
    {
        public List<UiControlEvent> Events { get; } = new();

        public void OnControlEvent(in UiControlEvent args) => Events.Add(args);
    }
}
