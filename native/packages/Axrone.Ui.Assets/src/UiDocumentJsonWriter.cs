namespace Axrone.Ui.Assets;

/// <summary>
/// Deterministic writer for the v1 <c>.ui.json</c> schema. Keys are emitted in a
/// fixed order, defaults are elided, and authored strings are written from the
/// document arena without intermediate allocations.
/// </summary>
internal static class UiDocumentJsonWriter
{
    public static void Write(Utf8JsonWriter writer, IUiDocument document)
    {
        writer.WriteStartObject();
        writer.WriteNumber("version", UiDocumentJsonSchema.Version);

        if (document is UiAssetDocument asset)
        {
            writer.WriteString("id", asset.AssetId);
        }
        else
        {
            writer.WriteString("id", document.Info.Id.Value.ToString("x8", CultureInfo.InvariantCulture));
        }

        writer.WriteString("name", document.Info.Name);
        WriteCanvas(writer, document.Info.Canvas);
        writer.WritePropertyName("root");
        if (document is UiAssetDocument richRoot)
        {
            WriteRichNode(writer, richRoot, document.Nodes.Root);
        }
        else
        {
            WriteStructuralNode(writer, document.Nodes, document.Nodes.Root);
        }

        if (document is UiAssetDocument withBindings && withBindings.Bindings.Count > 0)
        {
            WriteBindings(writer, withBindings.Bindings);
        }

        writer.WriteEndObject();
    }

    private static void WriteCanvas(Utf8JsonWriter writer, UiCanvasConfig canvas)
    {
        writer.WriteStartObject("canvas");
        writer.WriteNumber("referenceWidth", Finite(canvas.ReferenceWidth, "canvas.referenceWidth"));
        writer.WriteNumber("referenceHeight", Finite(canvas.ReferenceHeight, "canvas.referenceHeight"));
        writer.WriteString("scaleMode", UiDocumentJsonSchema.ScaleMode(canvas.ScaleMode));
        if (canvas.MatchBias != 0.5f)
        {
            writer.WriteNumber("matchBias", Finite(canvas.MatchBias, "canvas.matchBias"));
        }

        if (!canvas.SafeArea.Equals(UiEdgeInsets.Zero))
        {
            writer.WritePropertyName("safeAreaInset");
            WriteInsetsValue(writer, canvas.SafeArea, "canvas.safeAreaInset");
        }

        writer.WriteEndObject();
    }

    private static void WriteRichNode(Utf8JsonWriter writer, UiAssetDocument document, UiNodeId id)
    {
        if (!document.Nodes.TryGetNode(id, out UiNodeRecord record))
        {
            throw new ArgumentException("Document node graph is inconsistent.", nameof(document));
        }

        writer.WriteStartObject();

        if (document.TryGetRoleCore(id, out UiStringRef role))
        {
            writer.WriteString("role", document.Storage.GetUtf8(role));
        }
        else
        {
            writer.WriteString("role", UiDocumentJsonSchema.RoleFromKind(record.Kind));
        }

        if (document.TryGetControllerCore(id, out UiStringRef controller))
        {
            writer.WriteString("controller", document.Storage.GetUtf8(controller));
        }

        if (document.TryGetKeyCore(id, out UiBindingKeyCore key))
        {
            if (key.Kind == UiKeyKind.Text)
            {
                writer.WriteString("key", document.Storage.GetUtf8(key.Text));
            }
            else if (key.Kind == UiKeyKind.Numeric)
            {
                writer.WriteNumber("key", key.Number);
            }
        }

        WriteFlags(writer, record.Flags);

        if (document.TryGetLayout(id, out UiLayoutStyle layout) && !layout.Equals(UiLayoutStyle.Default))
        {
            WriteLayout(writer, in layout);
        }

        if (document.TryGetStyle(id, out UiWidgetStyle style))
        {
            WriteStyle(writer, in style);
        }

        if (document.TryGetTextCore(id, out UiNodeTextCore text))
        {
            WriteText(writer, document.Storage, in text);
        }

        if (document.TryGetImageCore(id, out UiNodeImageCore image))
        {
            WriteImage(writer, document.Storage, in image);
        }

        if (document.TryGetFocus(id, out UiNodeFocus focus))
        {
            WriteFocus(writer, in focus);
        }

        if (document.TryGetMaterialUtf8(id, out ReadOnlySpan<byte> material))
        {
            writer.WriteString("material", material);
        }

        WriteChildren(writer, document.Nodes, id, rich: true, document);
        writer.WriteEndObject();
    }

    private static void WriteStructuralNode(Utf8JsonWriter writer, IUiNodeTree nodes, UiNodeId id)
    {
        if (!nodes.TryGetNode(id, out UiNodeRecord record))
        {
            throw new ArgumentException("Document node graph is inconsistent.", nameof(nodes));
        }

        writer.WriteStartObject();
        writer.WriteString("role", UiDocumentJsonSchema.RoleFromKind(record.Kind));
        WriteFlags(writer, record.Flags);
        WriteChildren(writer, nodes, id, rich: false, asset: null);
        writer.WriteEndObject();
    }

    private static void WriteChildren(
        Utf8JsonWriter writer,
        IUiNodeTree nodes,
        UiNodeId id,
        bool rich,
        UiAssetDocument? asset)
    {
        ReadOnlySpan<UiNodeId> children = nodes.GetChildren(id);
        if (children.IsEmpty)
        {
            return;
        }

        writer.WriteStartArray("children");
        for (int i = 0; i < children.Length; i++)
        {
            if (rich)
            {
                WriteRichNode(writer, asset!, children[i]);
            }
            else
            {
                WriteStructuralNode(writer, nodes, children[i]);
            }
        }

        writer.WriteEndArray();
    }

    private static void WriteFlags(Utf8JsonWriter writer, UiNodeFlags flags)
    {
        if ((flags & UiNodeFlags.Enabled) == 0)
        {
            writer.WriteBoolean("enabled", false);
        }

        if ((flags & UiNodeFlags.Interactive) == 0)
        {
            writer.WriteBoolean("interactive", false);
        }

        if ((flags & UiNodeFlags.Visible) == 0)
        {
            writer.WriteBoolean("visible", false);
        }

        if ((flags & UiNodeFlags.Clip) != 0)
        {
            writer.WriteBoolean("clip", true);
        }

        if ((flags & UiNodeFlags.Focusable) != 0)
        {
            writer.WriteBoolean("focusable", true);
        }

        if ((flags & UiNodeFlags.FocusScope) != 0)
        {
            writer.WriteBoolean("focusScope", true);
        }
    }

    private static void WriteLayout(Utf8JsonWriter writer, in UiLayoutStyle layout)
    {
        UiLayoutStyle defaults = UiLayoutStyle.Default;
        writer.WriteStartObject("layout");

        if (layout.Display != defaults.Display)
        {
            writer.WriteString("display", UiDocumentJsonSchema.Display(layout.Display));
        }

        if (layout.Direction != defaults.Direction)
        {
            writer.WriteString("direction", UiDocumentJsonSchema.Axis(layout.Direction));
        }

        if (layout.Gap != defaults.Gap)
        {
            writer.WriteNumber("gap", Finite(layout.Gap, "layout.gap"));
        }

        if (!layout.Padding.Equals(defaults.Padding))
        {
            writer.WritePropertyName("padding");
            WriteInsetsValue(writer, layout.Padding, "layout.padding");
        }

        if (!layout.Margin.Equals(defaults.Margin))
        {
            writer.WritePropertyName("margin");
            WriteInsetsValue(writer, layout.Margin, "layout.margin");
        }

        if (!layout.Width.Equals(defaults.Width))
        {
            WriteLength(writer, "width", layout.Width);
        }

        if (!layout.Height.Equals(defaults.Height))
        {
            WriteLength(writer, "height", layout.Height);
        }

        if (layout.MinWidth != defaults.MinWidth)
        {
            writer.WriteNumber("minWidth", Finite(layout.MinWidth, "layout.minWidth"));
        }

        if (layout.MinHeight != defaults.MinHeight)
        {
            writer.WriteNumber("minHeight", Finite(layout.MinHeight, "layout.minHeight"));
        }

        if (layout.MaxWidth != defaults.MaxWidth)
        {
            writer.WriteNumber("maxWidth", Finite(layout.MaxWidth, "layout.maxWidth"));
        }

        if (layout.MaxHeight != defaults.MaxHeight)
        {
            writer.WriteNumber("maxHeight", Finite(layout.MaxHeight, "layout.maxHeight"));
        }

        if (layout.Grow != defaults.Grow)
        {
            writer.WriteNumber("grow", Finite(layout.Grow, "layout.grow"));
        }

        if (layout.Shrink != defaults.Shrink)
        {
            writer.WriteNumber("shrink", Finite(layout.Shrink, "layout.shrink"));
        }

        if (!layout.Basis.Equals(defaults.Basis))
        {
            WriteLength(writer, "basis", layout.Basis);
        }

        if (layout.AlignItems != defaults.AlignItems)
        {
            writer.WriteString("alignItems", UiDocumentJsonSchema.Align(layout.AlignItems));
        }

        if (layout.AlignSelf != defaults.AlignSelf)
        {
            writer.WriteString("alignSelf", UiDocumentJsonSchema.AlignSelf(layout.AlignSelf));
        }

        if (layout.JustifyContent != defaults.JustifyContent)
        {
            writer.WriteString("justifyContent", UiDocumentJsonSchema.Justify(layout.JustifyContent));
        }

        if (layout.FlexWrap != defaults.FlexWrap)
        {
            writer.WriteString("flexWrap", UiDocumentJsonSchema.FlexWrap(layout.FlexWrap));
        }

        if (layout.Position != defaults.Position)
        {
            writer.WriteString("position", UiDocumentJsonSchema.Position(layout.Position));
        }

        if (!layout.InsetTop.Equals(defaults.InsetTop))
        {
            WriteLength(writer, "insetTop", layout.InsetTop);
        }

        if (!layout.InsetRight.Equals(defaults.InsetRight))
        {
            WriteLength(writer, "insetRight", layout.InsetRight);
        }

        if (!layout.InsetBottom.Equals(defaults.InsetBottom))
        {
            WriteLength(writer, "insetBottom", layout.InsetBottom);
        }

        if (!layout.InsetLeft.Equals(defaults.InsetLeft))
        {
            WriteLength(writer, "insetLeft", layout.InsetLeft);
        }

        if (layout.AspectRatio != defaults.AspectRatio)
        {
            writer.WriteNumber("aspectRatio", Finite(layout.AspectRatio, "layout.aspectRatio"));
        }

        if (layout.ZIndex != defaults.ZIndex)
        {
            writer.WriteNumber("zIndex", layout.ZIndex);
        }

        writer.WriteEndObject();
    }

    private static void WriteStyle(Utf8JsonWriter writer, in UiWidgetStyle style)
    {
        UiWidgetStyle defaults = UiWidgetStyle.Default;
        bool any =
            style.Opacity != defaults.Opacity ||
            !style.Background.Equals(defaults.Background) ||
            !style.BorderColor.Equals(defaults.BorderColor) ||
            style.BorderWidth != defaults.BorderWidth ||
            !style.Radius.Equals(defaults.Radius) ||
            !style.TextColor.Equals(defaults.TextColor);

        if (!any)
        {
            return;
        }

        writer.WriteStartObject("style");
        if (style.Opacity != defaults.Opacity)
        {
            writer.WriteNumber("opacity", Finite(style.Opacity, "style.opacity"));
        }

        if (!style.Background.Equals(defaults.Background))
        {
            writer.WriteStartArray("background");
            WriteColorValue(writer, style.Background, "style.background");
            writer.WriteEndArray();
        }

        if (!style.BorderColor.Equals(defaults.BorderColor))
        {
            writer.WriteStartArray("borderColor");
            WriteColorValue(writer, style.BorderColor, "style.borderColor");
            writer.WriteEndArray();
        }

        if (style.BorderWidth != defaults.BorderWidth)
        {
            writer.WriteNumber("borderWidth", Finite(style.BorderWidth, "style.borderWidth"));
        }

        if (!style.Radius.Equals(defaults.Radius))
        {
            writer.WriteStartArray("radius");
            WriteCornerValue(writer, style.Radius, "style.radius");
            writer.WriteEndArray();
        }

        if (!style.TextColor.Equals(defaults.TextColor))
        {
            writer.WriteStartArray("color");
            WriteColorValue(writer, style.TextColor, "style.color");
            writer.WriteEndArray();
        }

        writer.WriteEndObject();
    }

    private static void WriteText(Utf8JsonWriter writer, UiDocumentStorage storage, in UiNodeTextCore text)
    {
        writer.WriteStartObject("text");
        writer.WriteString("value", storage.GetUtf8(text.Value));

        if (!text.Family.IsEmpty)
        {
            writer.WriteString("family", storage.GetUtf8(text.Family));
        }

        if (text.Size != 16.0f)
        {
            writer.WriteNumber("size", Finite(text.Size, "text.size"));
        }

        if (text.Weight != UiFontWeight.Normal && text.Weight != UiFontWeight.Default)
        {
            writer.WriteNumber("weight", (int)text.Weight);
        }

        if (text.FontStyle != UiFontStyle.Normal)
        {
            writer.WriteString("style", UiDocumentJsonSchema.FontStyle(text.FontStyle));
        }

        if (text.Wrap != UiTextWrap.Word)
        {
            writer.WriteString("wrap", UiDocumentJsonSchema.TextWrap(text.Wrap));
        }

        if (text.Overflow != UiTextOverflow.Clip)
        {
            writer.WriteString("overflow", UiDocumentJsonSchema.TextOverflow(text.Overflow));
        }

        if (text.Align != UiTextAlign.Start)
        {
            writer.WriteString("align", UiDocumentJsonSchema.TextAlign(text.Align));
        }

        if (text.Direction != UiTextDirection.Auto)
        {
            writer.WriteString("direction", UiDocumentJsonSchema.TextDirection(text.Direction));
        }

        if (text.LineHeight != 0.0f)
        {
            writer.WriteNumber("lineHeight", Finite(text.LineHeight, "text.lineHeight"));
        }

        if (text.LetterSpacing != 0.0f)
        {
            writer.WriteNumber("letterSpacing", Finite(text.LetterSpacing, "text.letterSpacing"));
        }

        if (text.MaxLines != 0)
        {
            writer.WriteNumber("maxLines", text.MaxLines);
        }

        if (text.AutoSize != UiTextAutoSize.None)
        {
            writer.WriteString("autoSize", UiDocumentJsonSchema.TextAutoSize(text.AutoSize));
        }

        if (text.MinFontSize > 0.0f)
        {
            writer.WriteNumber("minFontSize", Finite(text.MinFontSize, "text.minFontSize"));
        }

        if (text.MaxFontSize > 0.0f)
        {
            writer.WriteNumber("maxFontSize", Finite(text.MaxFontSize, "text.maxFontSize"));
        }

        writer.WriteEndObject();
    }

    private static void WriteImage(Utf8JsonWriter writer, UiDocumentStorage storage, in UiNodeImageCore image)
    {
        writer.WriteStartObject("image");
        writer.WriteStartObject("source");
        writer.WriteString("kind", UiDocumentJsonSchema.ImageSourceKind(image.SourceKind));
        writer.WriteString(
            image.SourceKind == UiImageSourceKind.Material ? "materialId" : "resourceId",
            storage.GetUtf8(image.ResourceId));

        if (image.SourceSize.Width > 0.0f)
        {
            writer.WriteNumber("width", Finite(image.SourceSize.Width, "image.source.width"));
        }

        if (image.SourceSize.Height > 0.0f)
        {
            writer.WriteNumber("height", Finite(image.SourceSize.Height, "image.source.height"));
        }

        writer.WriteEndObject();

        if (image.Fit != UiImageFit.Fill)
        {
            writer.WriteString("fit", UiDocumentJsonSchema.ImageFit(image.Fit));
        }

        if (!image.Tint.Equals(UiColor.White))
        {
            writer.WriteStartArray("tint");
            WriteColorValue(writer, image.Tint, "image.tint");
            writer.WriteEndArray();
        }

        if (!image.Border.Equals(UiEdgeInsets.Zero))
        {
            writer.WritePropertyName("border");
            WriteInsetsValue(writer, image.Border, "image.border");
        }

        if (!image.UvRect.Equals(UiUvRect.Full))
        {
            writer.WriteStartObject("uvRect");
            writer.WriteNumber("x", Finite(image.UvRect.X, "image.uvRect.x"));
            writer.WriteNumber("y", Finite(image.UvRect.Y, "image.uvRect.y"));
            writer.WriteNumber("width", Finite(image.UvRect.Width, "image.uvRect.width"));
            writer.WriteNumber("height", Finite(image.UvRect.Height, "image.uvRect.height"));
            writer.WriteEndObject();
        }

        if (image.FillCenter)
        {
            writer.WriteBoolean("fillCenter", true);
        }

        if (image.Bleed)
        {
            writer.WriteBoolean("bleed", true);
        }

        writer.WriteEndObject();
    }

    private static void WriteFocus(Utf8JsonWriter writer, in UiNodeFocus focus)
    {
        UiNodeFocus defaults = UiNodeFocus.Default;
        bool any =
            focus.TabIndex != defaults.TabIndex ||
            focus.Order != defaults.Order ||
            focus.Scope != defaults.Scope ||
            focus.Cycle != defaults.Cycle ||
            !focus.RingColor.Equals(defaults.RingColor) ||
            focus.RingWidth != defaults.RingWidth ||
            focus.RingOffset != defaults.RingOffset;

        if (!any)
        {
            return;
        }

        writer.WriteStartObject("focus");
        if (focus.TabIndex != defaults.TabIndex)
        {
            writer.WriteNumber("tabIndex", focus.TabIndex);
        }

        if (focus.Order != defaults.Order)
        {
            writer.WriteNumber("order", focus.Order);
        }

        if (focus.Scope)
        {
            writer.WriteBoolean("scope", true);
        }

        if (focus.Cycle)
        {
            writer.WriteBoolean("cycle", true);
        }

        if (!focus.RingColor.Equals(defaults.RingColor))
        {
            writer.WriteStartArray("ringColor");
            WriteColorValue(writer, focus.RingColor, "focus.ringColor");
            writer.WriteEndArray();
        }

        if (focus.RingWidth != defaults.RingWidth)
        {
            writer.WriteNumber("ringWidth", Finite(focus.RingWidth, "focus.ringWidth"));
        }

        if (focus.RingOffset != defaults.RingOffset)
        {
            writer.WriteNumber("ringOffset", Finite(focus.RingOffset, "focus.ringOffset"));
        }

        writer.WriteEndObject();
    }

    private static void WriteBindings(Utf8JsonWriter writer, UiBindingTable bindings)
    {
        writer.WriteStartObject("bindings");
        for (int i = 0; i < bindings.Count; i++)
        {
            if (!bindings.TryGetAt(i, out ReadOnlySpan<byte> name, out UiBindingValue value, out ReadOnlySpan<byte> text))
            {
                continue;
            }

            writer.WritePropertyName(name);
            switch (value.Kind)
            {
                case UiBindingValueKind.Flag:
                    writer.WriteBooleanValue(value.Boolean);
                    break;
                case UiBindingValueKind.Numeric:
                    writer.WriteNumberValue(Finite(value.Number, "bindings.value"));
                    break;
                case UiBindingValueKind.Text:
                    writer.WriteStringValue(text);
                    break;
                default:
                    writer.WriteNullValue();
                    break;
            }
        }

        writer.WriteEndObject();
    }

    private static void WriteLength(Utf8JsonWriter writer, string name, UiLength length)
    {
        switch (length.Kind)
        {
            case UiLengthKind.Auto:
                writer.WriteString(name, "auto"u8);
                return;
            case UiLengthKind.Content:
                writer.WriteString(name, "content"u8);
                return;
            case UiLengthKind.Px:
                writer.WriteNumber(name, Finite(length.Value, "length"));
                return;
            case UiLengthKind.Percent:
                WriteSuffixed(writer, name, length.Value, (byte)'%');
                return;
            case UiLengthKind.Stretch:
                WritePrefixed(writer, name, "stretch:"u8, length.Value);
                return;
            case UiLengthKind.Viewport:
                WritePrefixed(writer, name, "viewport:"u8, length.Value);
                return;
            default:
                throw new ArgumentException("Unknown UI length kind.", nameof(length));
        }
    }

    private static void WriteSuffixed(Utf8JsonWriter writer, string name, float value, byte suffix)
    {
        Span<byte> buffer = stackalloc byte[80];
        if (!Finite(value, "length").TryFormat(buffer, out int written, default, CultureInfo.InvariantCulture))
        {
            throw new ArgumentException("UI length could not be formatted.", nameof(value));
        }

        buffer[written] = suffix;
        writer.WriteString(name, buffer[..(written + 1)]);
    }

    private static void WritePrefixed(Utf8JsonWriter writer, string name, ReadOnlySpan<byte> prefix, float value)
    {
        Span<byte> buffer = stackalloc byte[80];
        prefix.CopyTo(buffer);
        if (!Finite(value, "length").TryFormat(buffer[prefix.Length..], out int written, default, CultureInfo.InvariantCulture))
        {
            throw new ArgumentException("UI length could not be formatted.", nameof(value));
        }

        writer.WriteString(name, buffer[..(prefix.Length + written)]);
    }

    private static void WriteInsetsValue(Utf8JsonWriter writer, UiEdgeInsets insets, string name)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(Finite(insets.Top, name));
        writer.WriteNumberValue(Finite(insets.Right, name));
        writer.WriteNumberValue(Finite(insets.Bottom, name));
        writer.WriteNumberValue(Finite(insets.Left, name));
        writer.WriteEndArray();
    }

    private static void WriteCornerValue(Utf8JsonWriter writer, UiCornerRadii corners, string name)
    {
        writer.WriteNumberValue(Finite(corners.TopLeft, name));
        writer.WriteNumberValue(Finite(corners.TopRight, name));
        writer.WriteNumberValue(Finite(corners.BottomRight, name));
        writer.WriteNumberValue(Finite(corners.BottomLeft, name));
    }

    private static void WriteColorValue(Utf8JsonWriter writer, UiColor color, string name)
    {
        writer.WriteNumberValue(Finite(color.R, name));
        writer.WriteNumberValue(Finite(color.G, name));
        writer.WriteNumberValue(Finite(color.B, name));
        writer.WriteNumberValue(Finite(color.A, name));
    }

    private static float Finite(float value, string name)
    {
        if (!float.IsFinite(value))
        {
            throw new ArgumentException($"{name} must be finite.", name);
        }

        return value == 0.0f ? 0.0f : value;
    }

    private static double Finite(double value, string name)
    {
        if (!double.IsFinite(value))
        {
            throw new ArgumentException($"{name} must be finite.", name);
        }

        return value == 0.0 ? 0.0 : value;
    }
}
