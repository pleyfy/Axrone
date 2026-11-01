namespace Axrone.Ui.Scene.Tests;

using System.Buffers;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Ui;
using Axrone.Ui.Assets;

internal static class UiHostTestAssets
{
    public const string AssetId = "UI/test-hud.ui.json";

    public static UiHostAssetTable CreateTable(bool withLabel = false)
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
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Stretch,
            Width = UiLength.Px(200.0f),
            Height = UiLength.Px(100.0f),
            Padding = new UiEdgeInsets(8.0f, 8.0f, 8.0f, 8.0f),
        });

        UiNodeId button = builder.CreateNode(
            UiNodeKind.Button,
            UiNodeFlags.Visible | UiNodeFlags.Enabled | UiNodeFlags.Interactive | UiNodeFlags.Focusable);
        builder.TryAppendChild(panel, button);
        builder.TrySetLayout(button, UiLayoutStyle.Default with
        {
            Width = UiLength.Px(120.0f),
            Height = UiLength.Px(30.0f),
        });
        builder.TrySetText(button, new UiNodeText("OK", string.Empty, 16.0f, UiFontWeight.Normal, UiFontStyle.Normal, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 20.0f, 0.0f, 1));

        if (withLabel)
        {
            UiNodeId label = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible | UiNodeFlags.Enabled);
            builder.TryAppendChild(panel, label);
            builder.TrySetLayout(label, UiLayoutStyle.Default with
            {
                Width = UiLength.Px(160.0f),
                Height = UiLength.Px(24.0f),
            });
            builder.TrySetText(label, new UiNodeText("Hello", string.Empty, 16.0f, UiFontWeight.Normal, UiFontStyle.Normal, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 20.0f, 0.0f, 1));
        }

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

    public static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/ui-host")))
            .AddTransform3D()
            .AddRendering3D()
            .AddUiHosts()
            .Build()
            .CreateWorld();

    public static SceneActor AddHost(SceneWorld world, in SceneUiHost component)
    {
        SceneActor actor = world.CreateActor("Hud");
        world.AddData(actor, component);
        return actor;
    }
}
