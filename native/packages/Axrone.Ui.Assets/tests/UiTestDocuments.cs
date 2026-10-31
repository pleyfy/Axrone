namespace Axrone.Ui.Assets.Tests;

using Axrone.Ui;

internal static class UiTestDocuments
{
    public static UiDocumentInfo Info(string name = "sample") => new(
        new UiDocumentId(1),
        name,
        1,
        new UiCanvasConfig(1920.0f, 1080.0f, UiCanvasScaleMode.MatchWidthOrHeight, 0.5f, UiEdgeInsets.Zero));

    public static UiAssetDocumentBuilder CreateBuilder()
    {
        UiAssetDocumentBuilder builder = new();
        UiNodeId root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        _ = builder.TrySetRole(root, "root".AsSpan());
        return builder;
    }

    public static UiAssetDocument CreateSample()
    {
        UiAssetDocumentBuilder builder = CreateBuilder();
        UiNodeId root = new(1);
        UiNodeId panel = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        _ = builder.TryAppendChild(root, panel);
        _ = builder.TrySetRole(panel, "panel".AsSpan());
        _ = builder.TrySetKey(panel, UiBindingKey.FromString("panel"));

        UiNodeId label = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        _ = builder.TryAppendChild(panel, label);
        _ = builder.TrySetRole(label, "text".AsSpan());
        _ = builder.TrySetText(label, new UiNodeText(
            "Hello",
            "Inter",
            18.0f,
            UiFontWeight.SemiBold,
            UiFontStyle.Normal,
            UiTextWrap.Word,
            UiTextOverflow.Ellipsis,
            UiTextAlign.Center,
            UiTextDirection.Ltr,
            1.2f,
            0.5f,
            2));

        UiNodeId icon = builder.CreateNode(UiNodeKind.Image, UiNodeFlags.Visible | UiNodeFlags.Enabled);
        _ = builder.TryAppendChild(panel, icon);
        _ = builder.TrySetRole(icon, "image".AsSpan());
        _ = builder.TrySetImage(icon, new UiNodeImage(
            UiImageSourceKind.Texture,
            "ui/icon.png",
            UiImageFit.Contain,
            UiColor.White,
            UiEdgeInsets.Zero,
            UiUvRect.Full,
            new UiSize(64.0f, 64.0f),
            false,
            false));

        builder.Bindings.SetString("title", "Play");
        builder.Bindings.SetNumber("score", 42);
        builder.Bindings.SetBoolean("paused", true);
        builder.Bindings.SetNull("selected");

        return builder.Build(Info());
    }
}
