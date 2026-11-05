namespace Axrone.Ui.Scene;

using System.Globalization;
using System.Text.Json;
using AssetImageFit = Axrone.Ui.Assets.UiImageFit;
using RenderImageFit = Axrone.Ui.Rendering.UiImageFit;

/// <summary>
/// One decoded UI document bound to a <see cref="UiControlRuntime"/>: builds the
/// control tree from authored asset nodes and compiles it into draw commands.
/// </summary>
/// <remarks>
/// Single-threaded. Binding allocates; steady-state layout and frame building
/// reuse the draw list, frame view, layout buffers and glyph atlas.
/// </remarks>
public sealed class UiHostRuntime : IDisposable
{
    private readonly UiControlRuntime _controls;
    private readonly UiHostTextSystem _text;
    private readonly UiDrawList _drawList;
    private readonly UiFrame _frame = new();
    private readonly Dictionary<UiNodeId, NodeVisual> _visuals = new();
    private int _disposed;

    private UiHostRuntime(UiAssetDocument document, in UiHostRuntimeOptions options, UiHostTextSystem text)
    {
        _text = text;
        _drawList = new UiDrawList();
        var controlOptions = new UiControlRuntimeOptions(
            TextMeasurer: text.Measurer,
            Events: options.Events,
            Images: options.Images,
            Theme: options.Theme,
            DefaultTextStyle: options.DefaultTextStyle,
            Viewport: default);
        _controls = new UiControlRuntime(in controlOptions);
        BuildTree(document);
    }

    /// <summary>Gets the live control runtime.</summary>
    public UiControlRuntime Controls => _controls;

    /// <summary>Gets the runtime node tree.</summary>
    public IUiNodeTree Nodes => _controls.Nodes;

    /// <summary>Gets the number of authored nodes that produced a visual record.</summary>
    public int VisualCount => _visuals.Count;

    /// <summary>Decodes an asset and builds a runtime.</summary>
    public static bool TryCreate(
        IUiHostAssetSource assets,
        SceneStringId assetId,
        in UiHostRuntimeOptions options,
        UiHostTextSystem text,
        [NotNullWhen(true)] out UiHostRuntime? runtime,
        out UiDocumentError error)
    {
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(text);
        runtime = null;

        if (!assetId.IsValid || !assets.TryRead(assetId, out ReadOnlyMemory<byte> payload))
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "UI host asset payload was not found.");
            return false;
        }

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        if (!codec.TryRead(payload.Span, out IUiDocument? document, out error))
        {
            return false;
        }

        if (document is not UiAssetDocument asset)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "The decoded UI asset has an unsupported document type.");
            return false;
        }

        runtime = new UiHostRuntime(asset, in options, text);
        return true;
    }

    /// <summary>Runs dirty layout for the viewport.</summary>
    public int UpdateLayout(in UiViewport viewport)
    {
        ThrowIfDisposed();
        return _controls.UpdateLayout(in viewport);
    }

    /// <summary>Runs layout for the viewport and compiles the next frame.</summary>
    public UiFrame BuildFrame(in UiViewport viewport)
    {
        ThrowIfDisposed();
        UpdateLayout(in viewport);
        _drawList.Clear();

        int zIndex = 0;
        int widgets = 0;
        int visible = 0;
        BuildNode(_controls.Root, 0, ref zIndex, ref widgets, ref visible);

        UiFrameMetrics metrics = _drawList.ComputeMetrics(0, widgets, visible);
        _drawList.Build(_frame, in viewport, in metrics);
        return _frame;
    }

    /// <summary>Routes one pointer event.</summary>
    public bool DispatchPointer(in UiPointerEvent args) => _controls.DispatchPointer(in args);

    /// <summary>Routes one key event.</summary>
    public bool DispatchKey(in UiKeyEvent args) => _controls.DispatchKey(in args);

    /// <summary>Routes committed text.</summary>
    public bool DispatchText(in UiTextInputEvent args) => _controls.DispatchText(in args);

    /// <summary>Routes a window focus transition.</summary>
    public bool DispatchWindowFocus(in UiWindowFocusEvent args) => _controls.DispatchWindowFocus(in args);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _visuals.Clear();
        _controls.Dispose();
    }

    private void BuildTree(UiAssetDocument document)
    {
        ReadOnlySpan<UiNodeId> children = document.Nodes.GetChildren(document.Nodes.Root);
        for (int i = 0; i < children.Length; i++)
        {
            BuildAssetNode(document, children[i], UiControl.Invalid, 0);
        }
    }

    private void BuildAssetNode(UiAssetDocument document, UiNodeId node, UiControl parent, int depth)
    {
        if (depth > 128 || !document.Nodes.TryGetNode(node, out UiNodeRecord record))
        {
            return;
        }

        ControlKind kind = MapKind(record.Kind);
        document.TryGetText(node, out UiNodeText text);
        document.TryGetLayout(node, out UiLayoutStyle layout);
        document.TryGetImage(node, out UiNodeImage image);

        UiTextStyle textStyle = default;
        bool hasText = !string.IsNullOrEmpty(text.Value);
        if (hasText)
        {
            textStyle = _text.ResolveStyle(in text);
        }

        UiResourceId imageResource = UiResourceId.Invalid;
        bool hasImage = TryParseResource(image.ResourceId, out imageResource);

        var definition = new UiControlDefinition(
            Text: hasText ? text.Value : null,
            Image: imageResource,
            TextStyle: textStyle);
        UiControl control = _controls.CreateControl(kind, in definition, parent);
        if (!control.IsValid)
        {
            return;
        }

        if (layout.Width.Kind != UiLengthKind.Auto || layout.Height.Kind != UiLengthKind.Auto)
        {
            _ = _controls.SetLayoutStyle(control, in layout);
        }

        _ = _controls.SetVisible(control, (record.Flags & UiNodeFlags.Visible) != 0);
        _ = _controls.SetEnabled(control, (record.Flags & UiNodeFlags.Enabled) != 0);

        if (hasText || hasImage)
        {
            _visuals[control.Node] = new NodeVisual(
                hasText ? text.Value : null,
                textStyle,
                layout,
                imageResource,
                hasImage,
                image.Tint,
                MapFit(image.Fit));
        }

        ReadOnlySpan<UiNodeId> children = document.Nodes.GetChildren(node);
        for (int i = 0; i < children.Length; i++)
        {
            BuildAssetNode(document, children[i], control, depth + 1);
        }
    }

    private void BuildNode(UiNodeId node, int depth, ref int zIndex, ref int widgets, ref int visible)
    {
        if (depth > 128 ||
            !_controls.Nodes.TryGetNode(node, out UiNodeRecord record) ||
            (record.Flags & UiNodeFlags.Visible) == 0)
        {
            return;
        }

        widgets++;
        if (!_controls.TryGetStyle(node, out UiWidgetStyle style) || !style.Visible)
        {
            return;
        }

        if (!_controls.TryGetBounds(node, out Rect bounds))
        {
            bounds = default;
        }

        bool drawable = bounds.Width > 0.0f && bounds.Height > 0.0f;
        if (drawable)
        {
            visible++;
            UiColor background = style.Background;
            if (background.A > 0.0f && style.Opacity > 0.0f)
            {
                _drawList.Add(UiRenderCommand.Quad(node, in bounds, in background, zIndex++, style.Opacity));
            }

            if (style.BorderWidth > 0.0f && style.BorderColor.A > 0.0f)
            {
                AddBorder(node, in bounds, in style, ref zIndex);
            }

            if (_visuals.TryGetValue(node, out NodeVisual? visual) && style.Opacity > 0.0f)
            {
                if (visual.HasText && _text.HasFonts)
                {
                    UiLayoutStyle visualLayout = visual.Layout;
                    Rect content = Inset(in bounds, in visualLayout, style.BorderWidth);
                    var constraints = new UiMeasureConstraints(0.0f, 0.0f, content.Width, content.Height);
                    UiTextStyle textStyle = visual.TextStyle;
                    if (textStyle.AutoSize == UiTextAutoSize.ShrinkToFit &&
                        _controls.TryGetResolvedTextStyle(node, out UiTextStyle resolvedStyle))
                    {
                        textStyle = resolvedStyle;
                    }

                    UiTextLayoutId layoutId = _text.BuildLayout(node, visual.Text!, in textStyle, in constraints);
                    if (layoutId.IsValid)
                    {
                        UiColor textColor = style.TextColor;
                        _drawList.Add(UiRenderCommand.Text(node, in content, layoutId, in textColor, zIndex++, style.Opacity));
                    }
                }

                if (visual.HasImage && visual.Image.IsValid)
                {
                    UiColor tint = visual.ImageTint;
                    _drawList.Add(UiRenderCommand.Image(
                        node,
                        in bounds,
                        visual.Image,
                        new Rect(0.0f, 0.0f, 1.0f, 1.0f),
                        in tint,
                        zIndex++,
                        style.Opacity,
                        visual.Fit));
                }
            }
        }

        bool clipped = style.Clip && drawable;
        if (clipped)
        {
            _drawList.PushClip(in bounds);
        }

        ReadOnlySpan<UiNodeId> children = _controls.Nodes.GetChildren(node);
        for (int i = 0; i < children.Length; i++)
        {
            BuildNode(children[i], depth + 1, ref zIndex, ref widgets, ref visible);
        }

        if (clipped)
        {
            _ = _drawList.PopClip();
        }
    }

    private void AddBorder(UiNodeId node, in Rect bounds, in UiWidgetStyle style, ref int zIndex)
    {
        float thickness = MathF.Min(style.BorderWidth, MathF.Min(bounds.Width, bounds.Height) * 0.5f);
        if (thickness <= 0.0f)
        {
            return;
        }

        float opacity = style.Opacity;
        UiColor borderColor = style.BorderColor;
        _drawList.Add(UiRenderCommand.Quad(node, new Rect(bounds.X, bounds.Y, bounds.Width, thickness), in borderColor, zIndex++, opacity));
        _drawList.Add(UiRenderCommand.Quad(node, new Rect(bounds.X, bounds.Bottom - thickness, bounds.Width, thickness), in borderColor, zIndex++, opacity));
        _drawList.Add(UiRenderCommand.Quad(node, new Rect(bounds.X, bounds.Y + thickness, thickness, MathF.Max(0.0f, bounds.Height - (2.0f * thickness))), in borderColor, zIndex++, opacity));
        _drawList.Add(UiRenderCommand.Quad(node, new Rect(bounds.Right - thickness, bounds.Y + thickness, thickness, MathF.Max(0.0f, bounds.Height - (2.0f * thickness))), in borderColor, zIndex++, opacity));
    }

    private static Rect Inset(in Rect bounds, in UiLayoutStyle layout, float borderWidth)
    {
        float left = MathF.Max(0.0f, layout.Padding.Left) + MathF.Max(0.0f, borderWidth);
        float top = MathF.Max(0.0f, layout.Padding.Top) + MathF.Max(0.0f, borderWidth);
        float right = MathF.Max(0.0f, layout.Padding.Right) + MathF.Max(0.0f, borderWidth);
        float bottom = MathF.Max(0.0f, layout.Padding.Bottom) + MathF.Max(0.0f, borderWidth);
        return new Rect(
            bounds.X + left,
            bounds.Y + top,
            MathF.Max(0.0f, bounds.Width - left - right),
            MathF.Max(0.0f, bounds.Height - top - bottom));
    }

    private static ControlKind MapKind(UiNodeKind kind) => kind switch
    {
        UiNodeKind.Text => ControlKind.Label,
        UiNodeKind.Image => ControlKind.Image,
        UiNodeKind.Button => ControlKind.Button,
        UiNodeKind.Input => ControlKind.TextInput,
        UiNodeKind.Root => ControlKind.Panel,
        _ => ControlKind.Panel,
    };

    private static RenderImageFit MapFit(AssetImageFit fit) => fit switch
    {
        AssetImageFit.Contain => RenderImageFit.Contain,
        AssetImageFit.Cover => RenderImageFit.Cover,
        AssetImageFit.None => RenderImageFit.None,
        AssetImageFit.ScaleDown => RenderImageFit.ScaleDown,
        _ => RenderImageFit.Fill,
    };

    private static bool TryParseResource(string resource, out UiResourceId id)
    {
        if (ulong.TryParse(resource, NumberStyles.None, CultureInfo.InvariantCulture, out ulong value) && value != 0)
        {
            id = new UiResourceId(value);
            return true;
        }

        id = UiResourceId.Invalid;
        return false;
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);

    private sealed class NodeVisual
    {
        public NodeVisual(
            string? text,
            in UiTextStyle textStyle,
            in UiLayoutStyle layout,
            UiResourceId image,
            bool hasImage,
            in UiColor imageTint,
            RenderImageFit fit)
        {
            Text = text;
            TextStyle = textStyle;
            Layout = layout;
            Image = image;
            HasImage = hasImage;
            ImageTint = imageTint;
            Fit = fit;
        }

        public string? Text { get; }

        public bool HasText => !string.IsNullOrEmpty(Text);

        public UiTextStyle TextStyle { get; }

        public UiLayoutStyle Layout { get; }

        public UiResourceId Image { get; }

        public bool HasImage { get; }

        public UiColor ImageTint { get; }

        public RenderImageFit Fit { get; }
    }
}
