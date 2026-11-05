namespace Axrone.Ui.Scene.Tests;

using System.Buffers;
using System.IO;
using System.Text;
using Axrone.Scene;
using Axrone.Ui;
using Axrone.Ui.Assets;
using Axrone.Ui.Controls;
using Axrone.Ui.Rendering;
using Axrone.Ui.Scene;
using Axrone.Ui.Text;
using FluentAssertions;
using Xunit;

public sealed class SceneUiHostAutoSizePaintTests : IDisposable
{
    private const string AutoAssetId = "UI/auto-hud.ui.json";
    private const string PlainAssetId = "UI/plain-hud.ui.json";
    private const string LongText = "S shrink to fit this long sentence inside a small box";
    private const float AuthoredSize = 16.0f;

    private static readonly UiViewport Viewport = new(new UiSize(320.0f, 180.0f));

    private readonly UiFontProvider _fonts;
    private readonly UiFontFaceId _face;

    public SceneUiHostAutoSizePaintTests()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "Fonts", "kenpixel.ttf");
        File.Exists(path).Should().BeTrue();
        _fonts = new UiFontProvider();
        _face = _fonts.RegisterFace(
            File.ReadAllBytes(path),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        _face.IsValid.Should().BeTrue(error.ToString());
    }

    public void Dispose() => _fonts.Dispose();

    [Fact]
    public void ShrinkToFitLabelPaintsAtResolvedSizeNotAuthored()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world, AutoAssetId);
        SceneUiHostInstance host = Bind(world, bridge, AutoAssetId);

        UiFrame frame = host.BuildFrame(in Viewport);
        UiNodeId node = FindTextNode(in frame);

        bridge.Text.TryGetPaintedFontSize(node, out float painted).Should().BeTrue();
        host.Runtime.Controls.TryGetResolvedTextStyle(node, out UiTextStyle resolved).Should().BeTrue(
            "layout must expose the resolved shrink style the paint path consumes");
        painted.Should().NotBe(AuthoredSize, "the shrunk size must reach glyph rasterization");
        painted.Should().Be(resolved.Size);
        painted.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void PaintedSizeAndLayoutSizeShareOneSource()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world, AutoAssetId);
        SceneUiHostInstance host = Bind(world, bridge, AutoAssetId);

        UiFrame first = host.BuildFrame(in Viewport);
        UiNodeId node = FindTextNode(in first);

        for (int frame = 0; frame < 3; frame++)
        {
            _ = host.BuildFrame(in Viewport);
            bridge.Text.TryGetPaintedFontSize(node, out float painted).Should().BeTrue();
            host.Runtime.Controls.TryGetResolvedTextStyle(node, out UiTextStyle resolved).Should().BeTrue();
            painted.Should().Be(resolved.Size, "paint and layout must never diverge on size (frame {0})", frame);
        }
    }

    [Fact]
    public void DefaultAuthoredPathPaintsAtAuthoredSize()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world, PlainAssetId);
        SceneUiHostInstance host = Bind(world, bridge, PlainAssetId);

        UiFrame frame = host.BuildFrame(in Viewport);
        UiNodeId node = FindTextNode(in frame);

        bridge.Text.TryGetPaintedFontSize(node, out float painted).Should().BeTrue();
        painted.Should().Be(AuthoredSize);
        host.Runtime.Controls.TryGetResolvedTextStyle(node, out _).Should().BeFalse(
            "nodes without shrink-to-fit never produce a resolved style");
    }

    [Fact]
    public void LongerTextRepaintsAtNewlyResolvedSize()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world, AutoAssetId);
        SceneUiHostInstance host = Bind(world, bridge, AutoAssetId);

        UiFrame first = host.BuildFrame(in Viewport);
        UiNodeId node = FindTextNode(in first);
        bridge.Text.TryGetPaintedFontSize(node, out float beforePaint).Should().BeTrue();

        host.Runtime.Controls.TryGetControl(node, out UiControl control).Should().BeTrue();
        _ = host.Runtime.Controls.SetText(control, LongText + LongText);
        UiFrame second = host.BuildFrame(in Viewport);

        bridge.Text.TryGetPaintedFontSize(node, out float afterPaint).Should().BeTrue();
        host.Runtime.Controls.TryGetResolvedTextStyle(node, out UiTextStyle resolved).Should().BeTrue();
        afterPaint.Should().BeLessThan(beforePaint, "doubling the text must shrink the painted size further");
        afterPaint.Should().Be(resolved.Size);
    }

    [Fact]
    public void ShrinkFramesAllocateNothingAfterWarmup()
    {
        using SceneWorld world = UiHostTestAssets.CreateWorld();
        using SceneUiHostBridge bridge = CreateBridge(world, AutoAssetId);
        SceneUiHostInstance host = Bind(world, bridge, AutoAssetId);

        for (int warmup = 0; warmup < 16; warmup++)
        {
            _ = host.BuildFrame(in Viewport);
        }

        int lastCommandCount = 0;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int frame = 0; frame < 16; frame++)
        {
            UiFrame built = host.BuildFrame(in Viewport);
            lastCommandCount = built.Commands.Length;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        lastCommandCount.Should().BeGreaterThan(0);
        allocated.Should().Be(0);
    }

    private SceneUiHostBridge CreateBridge(SceneWorld world, string assetId)
    {
        UiHostAssetTable table = new();
        table.Add(assetId, BuildDocument(assetId));
        return new SceneUiHostBridge(world, new SceneUiHostBridgeOptions
        {
            Assets = table,
            Runtime = new UiHostRuntimeOptions
            {
                Fonts = _fonts,
                DefaultFamily = UiFontProvider.FromFamilyName("Test"),
                DefaultTextStyle = new UiTextStyle(_face, AuthoredSize, 20.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 1),
            },
        });
    }

    private static SceneUiHostInstance Bind(SceneWorld world, SceneUiHostBridge bridge, string assetId)
    {
        SceneUiHost component = SceneUiHost.Default;
        component.AssetId = SceneStringId.FromName(assetId);
        SceneActor actor = UiHostTestAssets.AddHost(world, in component);
        bridge.Sync();
        bridge.Update(in Viewport);
        bridge.TryGetHost(actor, out SceneUiHostInstance? host).Should().BeTrue();
        return host!;
    }

    private static UiNodeId FindTextNode(in UiFrame frame)
    {
        for (int i = 0; i < frame.Commands.Length; i++)
        {
            if (frame.Commands[i].Kind == UiRenderCommandKind.Text)
            {
                return frame.Commands[i].Node;
            }
        }

        throw new InvalidOperationException("Frame contains no text command.");
    }

    private static byte[] BuildDocument(string assetId)
    {
        bool auto = assetId == AutoAssetId;
        UiAssetDocumentBuilder builder = new() { AssetId = assetId };
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
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Stretch,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(100.0f),
            Padding = new UiEdgeInsets(8.0f, 8.0f, 8.0f, 8.0f),
        });

        UiNodeId label = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        builder.TryAppendChild(panel, label);
        builder.TrySetLayout(label, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(160.0f),
            Height = UiLength.Px(24.0f),
        });
        builder.TrySetText(label, new UiNodeText(
            LongText,
            string.Empty,
            AuthoredSize,
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            20.0f,
            0.0f,
            1,
            auto ? UiTextAutoSize.ShrinkToFit : UiTextAutoSize.None,
            4.0f,
            0.0f));

        UiAssetDocument document = builder.Build(new UiDocumentInfo(
            new UiDocumentId(1),
            "auto-hud",
            1,
            new UiCanvasConfig(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero)));
        ArrayBufferWriter<byte> buffer = new();
        using (var codec = new UiDocumentJsonCodec(reuseStorage: false))
        {
            codec.Write(document, buffer);
        }

        return buffer.WrittenSpan.ToArray();
    }
}
