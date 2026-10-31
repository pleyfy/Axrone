namespace Axrone.Ui.Assets;

using System.Buffers.Text;

/// <summary>Header fields recovered from a validated payload.</summary>
internal readonly record struct UiParsedDocument(
    UiStringRef AssetId,
    UiStringRef Name,
    int Version,
    UiCanvasConfig Canvas);

/// <summary>
/// Hand-written, fail-closed UTF-8 reader for the v1 <c>.ui.json</c> schema.
/// Parses directly into reusable storage; strings stay in the arena as slices.
/// </summary>
internal sealed class UiDocumentJsonReader
{
    private const int StackStringChars = 256;

    private static readonly JsonReaderOptions Options = new()
    {
        MaxDepth = UiDocumentJsonSchema.MaxJsonDepth,
        CommentHandling = JsonCommentHandling.Disallow,
        AllowTrailingCommas = false,
    };

    private readonly UiDocumentStorage _storage;

    public UiDocumentJsonReader(UiDocumentStorage storage)
    {
        _storage = storage;
    }

    /// <summary>Probes the top-level schema version without decoding payloads.</summary>
    public static bool TryProbeVersion(ReadOnlySpan<byte> data, out int version, out UiDocumentError error)
    {
        version = 0;
        try
        {
            var reader = new Utf8JsonReader(data, Options);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload root must be a JSON object.");
                return false;
            }

            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                {
                    break;
                }

                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a property name.");
                    return false;
                }

                if (reader.ValueTextEquals("version"u8))
                {
                    if (!reader.Read() || reader.TokenType != JsonTokenType.Number || !reader.TryGetInt32(out version))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Document version must be an integer.");
                        return false;
                    }

                    error = UiDocumentError.None;
                    return true;
                }

                reader.Skip();
            }

            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document version is missing.");
            return false;
        }
        catch (JsonException)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload is truncated or malformed JSON.");
            return false;
        }
    }

    /// <summary>Parses a full document into storage.</summary>
    public bool TryParse(ReadOnlySpan<byte> data, out UiParsedDocument document, out UiDocumentError error)
    {
        document = default;
        error = UiDocumentError.None;
        if (data.IsEmpty)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload is empty.");
            return false;
        }

        try
        {
            var reader = new Utf8JsonReader(data, Options);
            if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload root must be a JSON object.");
                return false;
            }

            ulong seen = 0;
            int version = 0;
            bool hasVersion = false;
            bool hasCanvas = false;
            bool hasRoot = false;
            bool closed = false;
            UiStringRef assetId = UiStringRef.Empty;
            UiStringRef name = UiStringRef.Empty;
            UiCanvasConfig canvas = default;
            UiNodeId root = UiNodeId.Invalid;

            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndObject)
                {
                    closed = true;
                    break;
                }

                if (reader.TokenType != JsonTokenType.PropertyName)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a property name.");
                    return false;
                }

                int offset = Offset(reader);
                if (reader.ValueTextEquals("version"u8))
                {
                    if (Duplicate(ref seen, 0))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'version'.");
                        return false;
                    }

                    if (!reader.Read() || reader.TokenType != JsonTokenType.Number || !reader.TryGetInt32(out version))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'version' must be an integer.");
                        return false;
                    }

                    hasVersion = true;
                }
                else if (reader.ValueTextEquals("id"u8))
                {
                    if (Duplicate(ref seen, 1))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'id'.");
                        return false;
                    }

                    if (!reader.Read() || !ReadString(ref reader, out assetId, out error))
                    {
                        return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "'id' must be a string.");
                    }

                    if (assetId.IsEmpty)
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'id' must be a non-empty string.");
                        return false;
                    }
                }
                else if (reader.ValueTextEquals("name"u8))
                {
                    if (Duplicate(ref seen, 2))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'name'.");
                        return false;
                    }

                    if (!reader.Read() || !ReadString(ref reader, out name, out error))
                    {
                        return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "'name' must be a string.");
                    }
                }
                else if (reader.ValueTextEquals("canvas"u8))
                {
                    if (Duplicate(ref seen, 3))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'canvas'.");
                        return false;
                    }

                    if (!TryParseCanvas(ref reader, out canvas, out error))
                    {
                        return false;
                    }

                    hasCanvas = true;
                }
                else if (reader.ValueTextEquals("root"u8))
                {
                    if (Duplicate(ref seen, 4))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'root'.");
                        return false;
                    }

                    if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.MissingRoot, offset, "'root' must be an object.");
                        return false;
                    }

                    if (!TryParseNode(ref reader, UiNodeId.Invalid, 1, out root, out error))
                    {
                        return false;
                    }

                    hasRoot = true;
                }
                else if (reader.ValueTextEquals("bindings"u8))
                {
                    if (Duplicate(ref seen, 5))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Duplicate 'bindings'.");
                        return false;
                    }

                    if (!TryParseBindings(ref reader, out error))
                    {
                        return false;
                    }
                }
                else if (reader.ValueTextEquals("components"u8) || reader.ValueTextEquals("props"u8))
                {
                    error = new UiDocumentError(
                        UiDocumentErrorCode.UnsupportedFeature,
                        offset,
                        "Document components and props are not supported by the v1 schema.");
                    return false;
                }
                else
                {
                    error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported document field.");
                    return false;
                }
            }

            if (!closed)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Payload is truncated.");
                return false;
            }

            if (!hasVersion)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document version is missing.");
                return false;
            }

            if (version != UiDocumentJsonSchema.Version)
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedVersion, 0, "Document version is not supported.");
                return false;
            }

            if (!hasCanvas)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document canvas is missing.");
                return false;
            }

            if (name.IsEmpty)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document name must be non-empty.");
                return false;
            }

            if (!hasRoot)
            {
                error = new UiDocumentError(UiDocumentErrorCode.MissingRoot, 0, "Document root is missing.");
                return false;
            }

            if (!_storage.Publish(root))
            {
                error = new UiDocumentError(UiDocumentErrorCode.MissingRoot, 0, "Document root is invalid.");
                return false;
            }

            _storage.SortBindings();
            if (HasDuplicateBinding())
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Duplicate binding name.");
                return false;
            }

            document = new UiParsedDocument(assetId, name, version, canvas);
            error = UiDocumentError.None;
            return true;
        }
        catch (JsonException)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Payload is truncated or malformed JSON.");
            return false;
        }
    }

    private static bool TryParseCanvas(ref Utf8JsonReader reader, out UiCanvasConfig canvas, out UiDocumentError error)
    {
        canvas = default;
        error = UiDocumentError.None;
        if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "'canvas' must be an object.");
            return false;
        }

        ulong seen = 0;
        float width = 0.0f;
        float height = 0.0f;
        UiCanvasScaleMode scaleMode = UiCanvasScaleMode.MatchWidthOrHeight;
        float matchBias = 0.5f;
        UiEdgeInsets safeArea = UiEdgeInsets.Zero;
        bool closed = false;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a canvas property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("referenceWidth"u8))
            {
                if (Duplicate(ref seen, 0) || !ReadPositiveFloat(ref reader, out width))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'referenceWidth' must be positive and finite.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("referenceHeight"u8))
            {
                if (Duplicate(ref seen, 1) || !ReadPositiveFloat(ref reader, out height))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'referenceHeight' must be positive and finite.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("scaleMode"u8))
            {
                if (Duplicate(ref seen, 2) || !reader.Read() || !UiDocumentJsonSchema.TryParseScaleMode(ref reader, out scaleMode))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'scaleMode' is not a known mode.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("matchBias"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !reader.TryGetSingle(out matchBias) || !float.IsFinite(matchBias))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'matchBias' must be finite.");
                    return false;
                }

                matchBias = Math.Clamp(matchBias, 0.0f, 1.0f);
            }
            else if (reader.ValueTextEquals("safeAreaInset"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !ReadInsets(ref reader, allowNegative: false, out safeArea))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'safeAreaInset' is invalid.");
                    return false;
                }
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported canvas field.");
                return false;
            }
        }

        if (!closed || (seen & 0b111UL) != 0b111UL)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Canvas requires referenceWidth, referenceHeight and scaleMode.");
            return false;
        }

        canvas = new UiCanvasConfig(width, height, scaleMode, matchBias, safeArea);
        return true;
    }

    private bool TryParseNode(
        ref Utf8JsonReader reader,
        UiNodeId parent,
        int depth,
        out UiNodeId id,
        out UiDocumentError error)
    {
        id = UiNodeId.Invalid;
        error = UiDocumentError.None;
        if (depth > UiDocumentJsonSchema.MaxNodeDepth)
        {
            error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "Node nesting exceeds the limit.");
            return false;
        }

        if (_storage.Count >= UiDocumentJsonSchema.MaxNodes)
        {
            error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "Node count exceeds the limit.");
            return false;
        }

        if (!_storage.EnsureNodeCapacity(_storage.Count + 1))
        {
            error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "Node capacity exceeds the limit.");
            return false;
        }

        id = _storage.AddNode(UiNodeKind.Custom, UiDocumentJsonSchema.DefaultFlags);
        UiNodeFlags flags = UiDocumentJsonSchema.DefaultFlags;
        UiLayoutStyle layout = UiLayoutStyle.Default;
        UiWidgetStyle style = UiWidgetStyle.Default;
        bool hasRole = false;
        bool closed = false;
        ulong seen = 0;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a node property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("role"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || !ReadString(ref reader, out UiStringRef role, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'role' must be a string.");
                }

                if (role.IsEmpty)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'role' must be non-empty.");
                    return false;
                }

                hasRole = true;
                _storage.SetRole(id, role);
                _storage.SetKind(id, UiDocumentJsonSchema.KindFromRole(_storage.GetUtf8(role)));
            }
            else if (reader.ValueTextEquals("controller"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !ReadString(ref reader, out UiStringRef controller, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'controller' must be a string.");
                }

                if (controller.IsEmpty)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'controller' must be non-empty.");
                    return false;
                }

                _storage.SetController(id, controller);
            }
            else if (reader.ValueTextEquals("key"u8))
            {
                if (Duplicate(ref seen, 2) || !reader.Read())
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'key' is invalid.");
                    return false;
                }

                if (reader.TokenType == JsonTokenType.String)
                {
                    if (!ReadString(ref reader, out UiStringRef keyText, out error))
                    {
                        return false;
                    }

                    _storage.SetKey(id, new UiBindingKeyCore(UiKeyKind.Text, 0L, keyText));
                }
                else if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt64(out long keyNumber))
                {
                    _storage.SetKey(id, new UiBindingKeyCore(UiKeyKind.Numeric, keyNumber, UiStringRef.Empty));
                }
                else
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'key' must be a string or an integer.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("enabled"u8))
            {
                if (Duplicate(ref seen, 3) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'enabled' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Enabled : flags & ~UiNodeFlags.Enabled;
            }
            else if (reader.ValueTextEquals("interactive"u8))
            {
                if (Duplicate(ref seen, 4) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'interactive' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Interactive : flags & ~UiNodeFlags.Interactive;
            }
            else if (reader.ValueTextEquals("visible"u8))
            {
                if (Duplicate(ref seen, 5) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'visible' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Visible : flags & ~UiNodeFlags.Visible;
            }
            else if (reader.ValueTextEquals("clip"u8))
            {
                if (Duplicate(ref seen, 6) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'clip' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Clip : flags & ~UiNodeFlags.Clip;
            }
            else if (reader.ValueTextEquals("focusable"u8))
            {
                if (Duplicate(ref seen, 7) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'focusable' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Focusable : flags & ~UiNodeFlags.Focusable;
            }
            else if (reader.ValueTextEquals("focusScope"u8))
            {
                if (Duplicate(ref seen, 8) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'focusScope' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.FocusScope : flags & ~UiNodeFlags.FocusScope;
            }
            else if (reader.ValueTextEquals("layout"u8))
            {
                if (Duplicate(ref seen, 9) || !reader.Read() || !TryParseLayout(ref reader, out layout, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'layout' is invalid.");
                }
            }
            else if (reader.ValueTextEquals("style"u8))
            {
                if (Duplicate(ref seen, 10) || !reader.Read() ||
                    !TryParseStyle(ref reader, ref flags, out style, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'style' is invalid.");
                }
            }
            else if (reader.ValueTextEquals("text"u8))
            {
                if (Duplicate(ref seen, 11) || !reader.Read())
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'text' is invalid.");
                    return false;
                }

                if (reader.TokenType != JsonTokenType.Null)
                {
                    if (reader.TokenType != JsonTokenType.StartObject ||
                        !TryParseText(ref reader, out UiNodeTextCore text, out error))
                    {
                        return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'text' is invalid.");
                    }

                    _storage.SetText(id, text);
                }
            }
            else if (reader.ValueTextEquals("image"u8))
            {
                if (Duplicate(ref seen, 12) || !reader.Read())
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'image' is invalid.");
                    return false;
                }

                if (reader.TokenType != JsonTokenType.Null)
                {
                    if (reader.TokenType != JsonTokenType.StartObject ||
                        !TryParseImage(ref reader, out UiNodeImageCore image, out error))
                    {
                        return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'image' is invalid.");
                    }

                    _storage.SetImage(id, image);
                }
            }
            else if (reader.ValueTextEquals("focus"u8))
            {
                if (Duplicate(ref seen, 13) || !reader.Read())
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'focus' is invalid.");
                    return false;
                }

                if (reader.TokenType != JsonTokenType.Null)
                {
                    if (reader.TokenType != JsonTokenType.StartObject ||
                        !TryParseFocus(ref reader, out UiNodeFocus focus, out error))
                    {
                        return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "Node 'focus' is invalid.");
                    }

                    _storage.SetFocus(id, focus);
                }
            }
            else if (reader.ValueTextEquals("material"u8))
            {
                if (Duplicate(ref seen, 14) || !reader.Read())
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'material' is invalid.");
                    return false;
                }

                if (reader.TokenType != JsonTokenType.Null)
                {
                    if (reader.TokenType != JsonTokenType.String)
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Object material payloads are not supported.");
                        return false;
                    }

                    if (!ReadString(ref reader, out UiStringRef material, out error))
                    {
                        return false;
                    }

                    _storage.SetMaterial(id, material);
                }
            }
            else if (reader.ValueTextEquals("props"u8))
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Node props are not supported by the v1 schema.");
                return false;
            }
            else if (reader.ValueTextEquals("children"u8))
            {
                if (Duplicate(ref seen, 15) || !reader.Read() || reader.TokenType != JsonTokenType.StartArray)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Node 'children' must be an array.");
                    return false;
                }

                bool arrayClosed = false;
                while (reader.Read())
                {
                    if (reader.TokenType == JsonTokenType.EndArray)
                    {
                        arrayClosed = true;
                        break;
                    }

                    if (reader.TokenType != JsonTokenType.StartObject)
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Child nodes must be objects.");
                        return false;
                    }

                    if (!TryParseNode(ref reader, id, depth + 1, out _, out error))
                    {
                        return false;
                    }
                }

                if (!arrayClosed)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Node children are truncated.");
                    return false;
                }
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported node field.");
                return false;
            }
        }

        if (!closed)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Node is truncated.");
            return false;
        }

        if (!hasRole)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Node 'role' is required.");
            return false;
        }

        _storage.SetFlags(id, flags);
        _storage.SetLayout(id, layout);
        style = style with
        {
            Visible = (flags & UiNodeFlags.Visible) != 0,
            Clip = (flags & UiNodeFlags.Clip) != 0,
        };
        _storage.SetStyle(id, style);

        if (parent.IsValid && !_storage.LinkChild(parent, id))
        {
            error = new UiDocumentError(UiDocumentErrorCode.InvalidReference, Offset(reader), "Node parent link is invalid.");
            return false;
        }

        return true;
    }

    private static bool TryParseLayout(ref Utf8JsonReader reader, out UiLayoutStyle layout, out UiDocumentError error)
    {
        layout = UiLayoutStyle.Default;
        error = UiDocumentError.None;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "'layout' must be an object.");
            return false;
        }

        ulong seen = 0;
        bool closed = false;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a layout property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("display"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || !TryParseDisplay(ref reader, out UiDisplayMode value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'display' is invalid.");
                    return false;
                }

                layout = layout with { Display = value };
            }
            else if (reader.ValueTextEquals("direction"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !TryParseAxis(ref reader, out UiAxis value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'direction' is invalid.");
                    return false;
                }

                layout = layout with { Direction = value };
            }
            else if (reader.ValueTextEquals("gap"u8))
            {
                if (Duplicate(ref seen, 2) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'gap' must be non-negative and finite.");
                    return false;
                }

                layout = layout with { Gap = value };
            }
            else if (reader.ValueTextEquals("padding"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !ReadInsets(ref reader, allowNegative: false, out UiEdgeInsets value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'padding' is invalid.");
                    return false;
                }

                layout = layout with { Padding = value };
            }
            else if (reader.ValueTextEquals("margin"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !ReadInsets(ref reader, allowNegative: true, out UiEdgeInsets value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'margin' is invalid.");
                    return false;
                }

                layout = layout with { Margin = value };
            }
            else if (reader.ValueTextEquals("width"u8))
            {
                if (Duplicate(ref seen, 5) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'width' is invalid.");
                    return false;
                }

                layout = layout with { Width = value };
            }
            else if (reader.ValueTextEquals("height"u8))
            {
                if (Duplicate(ref seen, 6) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'height' is invalid.");
                    return false;
                }

                layout = layout with { Height = value };
            }
            else if (reader.ValueTextEquals("minWidth"u8))
            {
                if (Duplicate(ref seen, 7) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'minWidth' is invalid.");
                    return false;
                }

                layout = layout with { MinWidth = value };
            }
            else if (reader.ValueTextEquals("minHeight"u8))
            {
                if (Duplicate(ref seen, 8) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'minHeight' is invalid.");
                    return false;
                }

                layout = layout with { MinHeight = value };
            }
            else if (reader.ValueTextEquals("maxWidth"u8))
            {
                if (Duplicate(ref seen, 9) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'maxWidth' is invalid.");
                    return false;
                }

                layout = layout with { MaxWidth = value };
            }
            else if (reader.ValueTextEquals("maxHeight"u8))
            {
                if (Duplicate(ref seen, 10) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'maxHeight' is invalid.");
                    return false;
                }

                layout = layout with { MaxHeight = value };
            }
            else if (reader.ValueTextEquals("grow"u8))
            {
                if (Duplicate(ref seen, 11) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'grow' is invalid.");
                    return false;
                }

                layout = layout with { Grow = value };
            }
            else if (reader.ValueTextEquals("shrink"u8))
            {
                if (Duplicate(ref seen, 12) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'shrink' is invalid.");
                    return false;
                }

                layout = layout with { Shrink = value };
            }
            else if (reader.ValueTextEquals("basis"u8))
            {
                if (Duplicate(ref seen, 13) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'basis' is invalid.");
                    return false;
                }

                layout = layout with { Basis = value };
            }
            else if (reader.ValueTextEquals("alignItems"u8))
            {
                if (Duplicate(ref seen, 14) || !reader.Read() || !TryParseAlign(ref reader, out UiAlign value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'alignItems' is invalid.");
                    return false;
                }

                layout = layout with { AlignItems = value };
            }
            else if (reader.ValueTextEquals("alignSelf"u8))
            {
                if (Duplicate(ref seen, 15) || !reader.Read() || !TryParseAlignSelf(ref reader, out UiAlignSelf value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'alignSelf' is invalid.");
                    return false;
                }

                layout = layout with { AlignSelf = value };
            }
            else if (reader.ValueTextEquals("justifyContent"u8))
            {
                if (Duplicate(ref seen, 16) || !reader.Read() || !TryParseJustify(ref reader, out UiJustify value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'justifyContent' is invalid.");
                    return false;
                }

                layout = layout with { JustifyContent = value };
            }
            else if (reader.ValueTextEquals("flexWrap"u8))
            {
                if (Duplicate(ref seen, 17) || !reader.Read() || !TryParseFlexWrap(ref reader, out UiFlexWrap value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'flexWrap' is invalid.");
                    return false;
                }

                layout = layout with { FlexWrap = value };
            }
            else if (reader.ValueTextEquals("position"u8))
            {
                if (Duplicate(ref seen, 18) || !reader.Read() || !TryParsePosition(ref reader, out UiPositionMode value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'position' is invalid.");
                    return false;
                }

                layout = layout with { Position = value };
            }
            else if (reader.ValueTextEquals("insetTop"u8))
            {
                if (Duplicate(ref seen, 19) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'insetTop' is invalid.");
                    return false;
                }

                layout = layout with { InsetTop = value };
            }
            else if (reader.ValueTextEquals("insetRight"u8))
            {
                if (Duplicate(ref seen, 20) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'insetRight' is invalid.");
                    return false;
                }

                layout = layout with { InsetRight = value };
            }
            else if (reader.ValueTextEquals("insetBottom"u8))
            {
                if (Duplicate(ref seen, 21) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'insetBottom' is invalid.");
                    return false;
                }

                layout = layout with { InsetBottom = value };
            }
            else if (reader.ValueTextEquals("insetLeft"u8))
            {
                if (Duplicate(ref seen, 22) || !reader.Read() || !ReadLength(ref reader, out UiLength value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'insetLeft' is invalid.");
                    return false;
                }

                layout = layout with { InsetLeft = value };
            }
            else if (reader.ValueTextEquals("aspectRatio"u8))
            {
                if (Duplicate(ref seen, 23) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'aspectRatio' is invalid.");
                    return false;
                }

                layout = layout with { AspectRatio = value };
            }
            else if (reader.ValueTextEquals("zIndex"u8))
            {
                if (Duplicate(ref seen, 24) || !reader.Read() || reader.TokenType != JsonTokenType.Number ||
                    !reader.TryGetInt32(out int value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'zIndex' must be an integer.");
                    return false;
                }

                layout = layout with { ZIndex = value };
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported layout field.");
                return false;
            }
        }

        if (!closed)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Layout is truncated.");
            return false;
        }

        if (layout.MinWidth > layout.MaxWidth || layout.MinHeight > layout.MaxHeight)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Layout minimum exceeds maximum.");
            return false;
        }

        return true;
    }

    private static bool TryParseStyle(
        ref Utf8JsonReader reader,
        ref UiNodeFlags flags,
        out UiWidgetStyle style,
        out UiDocumentError error)
    {
        style = UiWidgetStyle.Default;
        error = UiDocumentError.None;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "'style' must be an object.");
            return false;
        }

        ulong seen = 0;
        bool closed = false;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a style property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("visible"u8))
            {
                if (Duplicate(ref seen, 0) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'visible' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Visible : flags & ~UiNodeFlags.Visible;
            }
            else if (reader.ValueTextEquals("clip"u8))
            {
                if (Duplicate(ref seen, 1) || !ReadFlag(ref reader, out bool value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'clip' must be a boolean.");
                    return false;
                }

                flags = value ? flags | UiNodeFlags.Clip : flags & ~UiNodeFlags.Clip;
            }
            else if (reader.ValueTextEquals("opacity"u8))
            {
                if (Duplicate(ref seen, 2) || !reader.Read() || !reader.TryGetSingle(out float value) ||
                    !float.IsFinite(value) || value < 0.0f || value > 1.0f)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'opacity' must be within [0, 1].");
                    return false;
                }

                style = style with { Opacity = value };
            }
            else if (reader.ValueTextEquals("background"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !ReadColor(ref reader, out UiColor value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'background' is invalid.");
                    return false;
                }

                style = style with { Background = value };
            }
            else if (reader.ValueTextEquals("borderColor"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !ReadColor(ref reader, out UiColor value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'borderColor' is invalid.");
                    return false;
                }

                style = style with { BorderColor = value };
            }
            else if (reader.ValueTextEquals("borderWidth"u8))
            {
                if (Duplicate(ref seen, 5) || !ReadNonNegativeFloat(ref reader, out float value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'borderWidth' is invalid.");
                    return false;
                }

                style = style with { BorderWidth = value };
            }
            else if (reader.ValueTextEquals("radius"u8))
            {
                if (Duplicate(ref seen, 6) || !reader.Read() || !ReadCorners(ref reader, out UiCornerRadii value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'radius' is invalid.");
                    return false;
                }

                style = style with { Radius = value };
            }
            else if (reader.ValueTextEquals("color"u8))
            {
                if (Duplicate(ref seen, 7) || !reader.Read() || !ReadColor(ref reader, out UiColor value))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'color' is invalid.");
                    return false;
                }

                style = style with { TextColor = value };
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported style field.");
                return false;
            }
        }

        if (!closed)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Style is truncated.");
            return false;
        }

        return true;
    }

    private bool TryParseText(ref Utf8JsonReader reader, out UiNodeTextCore text, out UiDocumentError error)
    {
        text = default;
        error = UiDocumentError.None;
        ulong seen = 0;
        UiStringRef value = UiStringRef.Empty;
        UiStringRef family = UiStringRef.Empty;
        float size = 16.0f;
        UiFontWeight weight = UiFontWeight.Normal;
        UiFontStyle fontStyle = UiFontStyle.Normal;
        UiTextWrap wrap = UiTextWrap.Word;
        UiTextOverflow overflow = UiTextOverflow.Clip;
        UiTextAlign align = UiTextAlign.Start;
        UiTextDirection direction = UiTextDirection.Auto;
        float lineHeight = 0.0f;
        float letterSpacing = 0.0f;
        int maxLines = 0;
        bool hasValue = false;
        bool closed = false;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a text property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("value"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || !ReadString(ref reader, out value, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "'value' must be a string.");
                }

                hasValue = true;
            }
            else if (reader.ValueTextEquals("family"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !ReadString(ref reader, out family, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "'family' must be a string.");
                }
            }
            else if (reader.ValueTextEquals("size"u8))
            {
                if (Duplicate(ref seen, 2) || !ReadNonNegativeFloat(ref reader, out size))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'size' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("weight"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !TryParseWeight(ref reader, out weight))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'weight' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("style"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !TryParseFontStyle(ref reader, out fontStyle))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'style' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("wrap"u8))
            {
                if (Duplicate(ref seen, 5) || !reader.Read() || !TryParseTextWrap(ref reader, out wrap))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'wrap' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("overflow"u8))
            {
                if (Duplicate(ref seen, 6) || !reader.Read() || !TryParseTextOverflow(ref reader, out overflow))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'overflow' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("align"u8))
            {
                if (Duplicate(ref seen, 7) || !reader.Read() || !TryParseTextAlign(ref reader, out align))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'align' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("direction"u8))
            {
                if (Duplicate(ref seen, 8) || !reader.Read() || !TryParseTextDirection(ref reader, out direction))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'direction' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("lineHeight"u8))
            {
                if (Duplicate(ref seen, 9) || !ReadNonNegativeFloat(ref reader, out lineHeight))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'lineHeight' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("letterSpacing"u8))
            {
                if (Duplicate(ref seen, 10) || !reader.Read() || !reader.TryGetSingle(out letterSpacing) ||
                    !float.IsFinite(letterSpacing))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'letterSpacing' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("maxLines"u8))
            {
                if (Duplicate(ref seen, 11) || !reader.Read() || reader.TokenType != JsonTokenType.Number ||
                    !reader.TryGetInt32(out maxLines) || maxLines < 0)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'maxLines' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("spans"u8))
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Rich text spans are not supported by the v1 schema.");
                return false;
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported text field.");
                return false;
            }
        }

        if (!closed || !hasValue)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Text requires a 'value'.");
            return false;
        }

        text = new UiNodeTextCore(
            value,
            family,
            size,
            lineHeight,
            letterSpacing,
            weight,
            fontStyle,
            wrap,
            overflow,
            align,
            direction,
            maxLines);
        return true;
    }

    private bool TryParseImage(ref Utf8JsonReader reader, out UiNodeImageCore image, out UiDocumentError error)
    {
        image = default;
        error = UiDocumentError.None;
        ulong seen = 0;
        UiImageSourceKind sourceKind = UiImageSourceKind.Texture;
        UiStringRef resourceId = UiStringRef.Empty;
        UiSize sourceSize = UiSize.Zero;
        UiImageFit fit = UiImageFit.Fill;
        UiColor tint = UiColor.White;
        UiEdgeInsets border = UiEdgeInsets.Zero;
        UiUvRect uv = UiUvRect.Full;
        bool fillCenter = false;
        bool bleed = false;
        bool hasSource = false;
        bool closed = false;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected an image property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("source"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() ||
                    !TryParseImageSource(ref reader, out sourceKind, out resourceId, out sourceSize, out error))
                {
                    return Fail(ref error, UiDocumentErrorCode.Malformed, offset, "'source' is invalid.");
                }

                hasSource = true;
            }
            else if (reader.ValueTextEquals("fit"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !TryParseImageFit(ref reader, out fit))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'fit' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("tint"u8))
            {
                if (Duplicate(ref seen, 2) || !reader.Read() || !ReadColor(ref reader, out tint))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'tint' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("border"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !ReadInsets(ref reader, allowNegative: false, out border))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'border' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("uvRect"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !ReadUvRect(ref reader, out uv))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'uvRect' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("fillCenter"u8))
            {
                if (Duplicate(ref seen, 5) || !ReadFlag(ref reader, out fillCenter))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'fillCenter' must be a boolean.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("bleed"u8))
            {
                if (Duplicate(ref seen, 6) || !ReadFlag(ref reader, out bleed))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'bleed' must be a boolean.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("material"u8) ||
                     reader.ValueTextEquals("alignX"u8) ||
                     reader.ValueTextEquals("alignY"u8) ||
                     reader.ValueTextEquals("sampling"u8))
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported image field.");
                return false;
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported image field.");
                return false;
            }
        }

        if (!closed || !hasSource)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Image requires a 'source'.");
            return false;
        }

        image = new UiNodeImageCore(
            resourceId,
            sourceKind,
            fit,
            tint,
            border,
            uv,
            sourceSize,
            fillCenter,
            bleed);
        return true;
    }

    private bool TryParseImageSource(
        ref Utf8JsonReader reader,
        out UiImageSourceKind kind,
        out UiStringRef resourceId,
        out UiSize size,
        out UiDocumentError error)
    {
        kind = UiImageSourceKind.Texture;
        resourceId = UiStringRef.Empty;
        size = UiSize.Zero;
        error = UiDocumentError.None;
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Image source must be an object.");
            return false;
        }

        ulong seen = 0;
        bool hasKind = false;
        bool closed = false;
        float width = 0.0f;
        float height = 0.0f;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected an image source property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("kind"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || reader.TokenType != JsonTokenType.String)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'kind' must be a string.");
                    return false;
                }

                if (reader.ValueTextEquals("texture"u8))
                {
                    kind = UiImageSourceKind.Texture;
                }
                else if (reader.ValueTextEquals("material"u8))
                {
                    kind = UiImageSourceKind.Material;
                }
                else
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'kind' must be 'texture' or 'material'.");
                    return false;
                }

                hasKind = true;
            }
            else if (reader.ValueTextEquals("resourceId"u8) || reader.ValueTextEquals("materialId"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !ReadString(ref reader, out resourceId, out error) || resourceId.IsEmpty)
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Image source identifier must be a non-empty string.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("width"u8))
            {
                if (Duplicate(ref seen, 2) || !ReadNonNegativeFloat(ref reader, out width))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'width' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("height"u8))
            {
                if (Duplicate(ref seen, 3) || !ReadNonNegativeFloat(ref reader, out height))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'height' is invalid.");
                    return false;
                }
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported image source field.");
                return false;
            }
        }

        if (!closed || !hasKind || resourceId.IsEmpty)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Image source requires 'kind' and an identifier.");
            return false;
        }

        size = new UiSize(width, height);
        return true;
    }

    private static bool TryParseFocus(ref Utf8JsonReader reader, out UiNodeFocus focus, out UiDocumentError error)
    {
        focus = UiNodeFocus.Default;
        error = UiDocumentError.None;
        ulong seen = 0;
        int tabIndex = 0;
        int order = 0;
        bool scope = false;
        bool cycle = false;
        UiColor ringColor = UiColor.White;
        float ringWidth = 0.0f;
        float ringOffset = 0.0f;
        bool closed = false;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a focus property.");
                return false;
            }

            int offset = Offset(reader);
            if (reader.ValueTextEquals("tabIndex"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || reader.TokenType != JsonTokenType.Number ||
                    !reader.TryGetInt32(out tabIndex))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'tabIndex' must be an integer.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("order"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || reader.TokenType != JsonTokenType.Number ||
                    !reader.TryGetInt32(out order))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'order' must be an integer.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("scope"u8))
            {
                if (Duplicate(ref seen, 2) || !ReadFlag(ref reader, out scope))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'scope' must be a boolean.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("cycle"u8))
            {
                if (Duplicate(ref seen, 3) || !ReadFlag(ref reader, out cycle))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'cycle' must be a boolean.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("ringColor"u8))
            {
                if (Duplicate(ref seen, 4) || !reader.Read() || !ReadColor(ref reader, out ringColor))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'ringColor' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("ringWidth"u8))
            {
                if (Duplicate(ref seen, 5) || !ReadNonNegativeFloat(ref reader, out ringWidth))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'ringWidth' is invalid.");
                    return false;
                }
            }
            else if (reader.ValueTextEquals("ringOffset"u8))
            {
                if (Duplicate(ref seen, 6) || !ReadNonNegativeFloat(ref reader, out ringOffset))
                {
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "'ringOffset' is invalid.");
                    return false;
                }
            }
            else
            {
                error = new UiDocumentError(UiDocumentErrorCode.UnsupportedFeature, offset, "Unsupported focus field.");
                return false;
            }
        }

        if (!closed)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Focus is truncated.");
            return false;
        }

        focus = new UiNodeFocus(tabIndex, order, scope, cycle, ringColor, ringWidth, ringOffset);
        return true;
    }

    private bool TryParseBindings(ref Utf8JsonReader reader, out UiDocumentError error)
    {
        error = UiDocumentError.None;
        if (!reader.Read() || reader.TokenType != JsonTokenType.StartObject)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "'bindings' must be an object.");
            return false;
        }

        bool closed = false;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a binding name.");
                return false;
            }

            if (_storage.BindingCount >= UiDocumentJsonSchema.MaxBindings)
            {
                error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "Binding count exceeds the limit.");
                return false;
            }

            int offset = Offset(reader);
            if (!TryAppendString(ref reader, out UiStringRef name, out error))
            {
                return false;
            }

            if (name.IsEmpty)
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Binding names must be non-empty.");
                return false;
            }

            if (!_storage.EnsureBindingCapacity(_storage.BindingCount + 1))
            {
                error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, offset, "Binding capacity exceeds the limit.");
                return false;
            }

            if (!reader.Read())
            {
                error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Binding value is truncated.");
                return false;
            }

            UiBindingValue value;
            UiStringRef text = UiStringRef.Empty;
            switch (reader.TokenType)
            {
                case JsonTokenType.Null:
                    value = UiBindingValue.Null;
                    break;
                case JsonTokenType.True:
                    value = UiBindingValue.FromBoolean(true);
                    break;
                case JsonTokenType.False:
                    value = UiBindingValue.FromBoolean(false);
                    break;
                case JsonTokenType.Number:
                    if (!reader.TryGetDouble(out double number) || !double.IsFinite(number))
                    {
                        error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Binding numbers must be finite.");
                        return false;
                    }

                    value = UiBindingValue.FromNumber(number);
                    break;
                case JsonTokenType.String:
                    if (!ReadString(ref reader, out text, out error))
                    {
                        return false;
                    }

                    value = UiBindingValue.FromString();
                    break;
                default:
                    error = new UiDocumentError(UiDocumentErrorCode.Malformed, offset, "Binding values must be scalar.");
                    return false;
            }

            _storage.AddBinding(name, in value, text);
        }

        if (!closed)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Bindings are truncated.");
            return false;
        }

        return true;
    }

    private bool HasDuplicateBinding()
    {
        for (int i = 1; i < _storage.BindingCount; i++)
        {
            if (_storage.GetUtf8(_storage.BindingNames[i - 1])
                .SequenceEqual(_storage.GetUtf8(_storage.BindingNames[i])))
            {
                return true;
            }
        }

        return false;
    }

    private bool ReadString(ref Utf8JsonReader reader, out UiStringRef reference, out UiDocumentError error)
    {
        reference = UiStringRef.Empty;
        error = UiDocumentError.None;
        if (reader.TokenType != JsonTokenType.String)
        {
            error = new UiDocumentError(UiDocumentErrorCode.Malformed, Offset(reader), "Expected a string value.");
            return false;
        }

        return TryAppendString(ref reader, out reference, out error);
    }

    private bool TryAppendString(ref Utf8JsonReader reader, out UiStringRef reference, out UiDocumentError error)
    {
        reference = UiStringRef.Empty;
        error = UiDocumentError.None;
        if (reader.ValueSpan.Length > UiDocumentJsonSchema.MaxStringBytes)
        {
            error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "String exceeds the size limit.");
            return false;
        }

        if (!reader.ValueIsEscaped)
        {
            if (!_storage.TryAppendUtf8(reader.ValueSpan, out reference))
            {
                error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "String arena exceeds the limit.");
                return false;
            }

            return true;
        }

        int length = reader.ValueSpan.Length + 1;
        if (length <= StackStringChars)
        {
            Span<char> chars = stackalloc char[length];
            int written = reader.CopyString(chars);
            if (!_storage.TryAppendString(chars[..written], out reference))
            {
                error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "String arena exceeds the limit.");
                return false;
            }

            return true;
        }

        char[] rented = ArrayPool<char>.Shared.Rent(length);
        try
        {
            int written = reader.CopyString(rented);
            if (!_storage.TryAppendString(rented.AsSpan(0, written), out reference))
            {
                error = new UiDocumentError(UiDocumentErrorCode.ResourceLimit, Offset(reader), "String arena exceeds the limit.");
                return false;
            }

            return true;
        }
        finally
        {
            ArrayPool<char>.Shared.Return(rented);
        }
    }

    private static bool ReadPositiveFloat(ref Utf8JsonReader reader, out float value)
    {
        if (!reader.Read() || !reader.TryGetSingle(out value) || !float.IsFinite(value) || value <= 0.0f)
        {
            value = 0.0f;
            return false;
        }

        return true;
    }

    private static bool ReadNonNegativeFloat(ref Utf8JsonReader reader, out float value)
    {
        if (!reader.Read() || !reader.TryGetSingle(out value) || !float.IsFinite(value) || value < 0.0f)
        {
            value = 0.0f;
            return false;
        }

        return true;
    }

    private static bool ReadFlag(ref Utf8JsonReader reader, out bool value)
    {
        if (!reader.Read() || (reader.TokenType != JsonTokenType.True && reader.TokenType != JsonTokenType.False))
        {
            value = false;
            return false;
        }

        value = reader.TokenType == JsonTokenType.True;
        return true;
    }

    private static bool ReadInsets(ref Utf8JsonReader reader, bool allowNegative, out UiEdgeInsets insets)
    {
        insets = UiEdgeInsets.Zero;
        float min = allowNegative ? float.NegativeInfinity : 0.0f;
        if (reader.TokenType == JsonTokenType.Number)
        {
            if (!reader.TryGetSingle(out float uniform) || !float.IsFinite(uniform) || uniform < min)
            {
                return false;
            }

            insets = new UiEdgeInsets(uniform, uniform, uniform, uniform);
            return true;
        }

        if (reader.TokenType != JsonTokenType.StartArray)
        {
            return false;
        }

        Span<float> values = stackalloc float[4];
        int count = 0;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray)
            {
                if (count != 4)
                {
                    return false;
                }

                insets = new UiEdgeInsets(values[0], values[1], values[2], values[3]);
                return true;
            }

            if (count >= 4 || reader.TokenType != JsonTokenType.Number || !reader.TryGetSingle(out float value) ||
                !float.IsFinite(value) || value < min)
            {
                return false;
            }

            values[count++] = value;
        }

        return false;
    }

    private static bool ReadCorners(ref Utf8JsonReader reader, out UiCornerRadii corners)
    {
        corners = UiCornerRadii.Zero;
        if (reader.TokenType == JsonTokenType.Number)
        {
            if (!reader.TryGetSingle(out float uniform) || !float.IsFinite(uniform) || uniform < 0.0f)
            {
                return false;
            }

            corners = new UiCornerRadii(uniform, uniform, uniform, uniform);
            return true;
        }

        if (reader.TokenType != JsonTokenType.StartArray)
        {
            return false;
        }

        Span<float> values = stackalloc float[4];
        int count = 0;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndArray)
            {
                if (count != 4)
                {
                    return false;
                }

                corners = new UiCornerRadii(values[0], values[1], values[2], values[3]);
                return true;
            }

            if (count >= 4 || reader.TokenType != JsonTokenType.Number || !reader.TryGetSingle(out float value) ||
                !float.IsFinite(value) || value < 0.0f)
            {
                return false;
            }

            values[count++] = value;
        }

        return false;
    }

    private static bool ReadUvRect(ref Utf8JsonReader reader, out UiUvRect uv)
    {
        uv = UiUvRect.Full;
        if (reader.TokenType == JsonTokenType.StartArray)
        {
            Span<float> values = stackalloc float[4];
            int count = 0;
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                {
                    if (count != 4)
                    {
                        return false;
                    }

                    uv = new UiUvRect(values[0], values[1], values[2], values[3]);
                    return true;
                }

                if (count >= 4 || reader.TokenType != JsonTokenType.Number || !reader.TryGetSingle(out float value) ||
                    !float.IsFinite(value))
                {
                    return false;
                }

                values[count++] = value;
            }

            return false;
        }

        if (reader.TokenType != JsonTokenType.StartObject)
        {
            return false;
        }

        float x = 0.0f;
        float y = 0.0f;
        float width = 1.0f;
        float height = 1.0f;
        ulong seen = 0;
        bool closed = false;
        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.EndObject)
            {
                closed = true;
                break;
            }

            if (reader.TokenType != JsonTokenType.PropertyName)
            {
                return false;
            }

            if (reader.ValueTextEquals("x"u8))
            {
                if (Duplicate(ref seen, 0) || !reader.Read() || !reader.TryGetSingle(out x) || !float.IsFinite(x))
                {
                    return false;
                }
            }
            else if (reader.ValueTextEquals("y"u8))
            {
                if (Duplicate(ref seen, 1) || !reader.Read() || !reader.TryGetSingle(out y) || !float.IsFinite(y))
                {
                    return false;
                }
            }
            else if (reader.ValueTextEquals("width"u8))
            {
                if (Duplicate(ref seen, 2) || !reader.Read() || !reader.TryGetSingle(out width) || !float.IsFinite(width))
                {
                    return false;
                }
            }
            else if (reader.ValueTextEquals("height"u8))
            {
                if (Duplicate(ref seen, 3) || !reader.Read() || !reader.TryGetSingle(out height) || !float.IsFinite(height))
                {
                    return false;
                }
            }
            else
            {
                return false;
            }
        }

        if (!closed)
        {
            return false;
        }

        uv = new UiUvRect(x, y, width, height);
        return true;
    }

    private static bool ReadColor(ref Utf8JsonReader reader, out UiColor color)
    {
        color = UiColor.Transparent;
        if (reader.TokenType == JsonTokenType.StartArray)
        {
            Span<float> values = stackalloc float[4];
            int count = 0;
            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.EndArray)
                {
                    if (count != 3 && count != 4)
                    {
                        return false;
                    }

                    float alpha = count == 4 ? values[3] : 1.0f;
                    color = new UiColor(values[0], values[1], values[2], alpha);
                    return true;
                }

                if (count >= 4 || reader.TokenType != JsonTokenType.Number || !reader.TryGetSingle(out float value) ||
                    !float.IsFinite(value) || value < 0.0f || value > 1.0f)
                {
                    return false;
                }

                values[count++] = value;
            }

            return false;
        }

        if (reader.TokenType == JsonTokenType.String)
        {
            if (reader.ValueIsEscaped)
            {
                return false;
            }

            return TryParseHexColor(reader.ValueSpan, out color);
        }

        return false;
    }

    private static bool TryParseHexColor(ReadOnlySpan<byte> text, out UiColor color)
    {
        color = UiColor.Transparent;
        if (text.Length < 2 || text[0] != (byte)'#')
        {
            return false;
        }

        ReadOnlySpan<byte> digits = text[1..];
        return digits.Length switch
        {
            3 => TryParseHex(digits, 1, out color, expandNibble: true),
            4 => TryParseHex(digits, 1, out color, expandNibble: true),
            6 => TryParseHex(digits, 2, out color, expandNibble: false),
            8 => TryParseHex(digits, 2, out color, expandNibble: false),
            _ => false,
        };
    }

    private static bool TryParseHex(ReadOnlySpan<byte> digits, int stride, out UiColor color, bool expandNibble)
    {
        color = UiColor.Transparent;
        Span<float> channels = stackalloc float[4];
        int count = digits.Length / stride;
        for (int i = 0; i < count; i++)
        {
            int value = 0;
            for (int j = 0; j < stride; j++)
            {
                int nibble = HexValue(digits[(i * stride) + j]);
                if (nibble < 0)
                {
                    return false;
                }

                value = (value << 4) | nibble;
            }

            channels[i] = expandNibble ? (value * 17) / 255.0f : value / 255.0f;
        }

        color = new UiColor(channels[0], channels[1], channels[2], count == 4 ? channels[3] : 1.0f);
        return true;
    }

    private static int HexValue(byte value) => value switch
    {
        >= (byte)'0' and <= (byte)'9' => value - '0',
        >= (byte)'a' and <= (byte)'f' => value - 'a' + 10,
        >= (byte)'A' and <= (byte)'F' => value - 'A' + 10,
        _ => -1,
    };

    private static bool ReadLength(ref Utf8JsonReader reader, out UiLength length)
    {
        length = UiLength.Auto;
        if (reader.TokenType == JsonTokenType.Number)
        {
            if (!reader.TryGetSingle(out float px) || !float.IsFinite(px))
            {
                return false;
            }

            length = UiLength.Px(px);
            return true;
        }

        if (reader.TokenType != JsonTokenType.String)
        {
            return false;
        }

        if (reader.ValueTextEquals("auto"u8))
        {
            length = UiLength.Auto;
            return true;
        }

        if (reader.ValueTextEquals("content"u8))
        {
            length = UiLength.Content;
            return true;
        }

        if (reader.ValueIsEscaped)
        {
            return false;
        }

        ReadOnlySpan<byte> span = reader.ValueSpan;
        if (span.Length > 1 && span[^1] == (byte)'%')
        {
            if (!Utf8Parser.TryParse(span[..^1], out float percent, out int consumed) ||
                consumed != span.Length - 1 || !float.IsFinite(percent))
            {
                return false;
            }

            length = UiLength.Percent(percent);
            return true;
        }

        if (span.StartsWith("stretch:"u8))
        {
            if (!Utf8Parser.TryParse(span["stretch:".Length..], out float weight, out int consumed) ||
                consumed != span.Length - "stretch:".Length || !float.IsFinite(weight))
            {
                return false;
            }

            length = UiLength.Stretch(weight);
            return true;
        }

        if (span.StartsWith("viewport:"u8))
        {
            if (!Utf8Parser.TryParse(span["viewport:".Length..], out float percent, out int consumed) ||
                consumed != span.Length - "viewport:".Length || !float.IsFinite(percent))
            {
                return false;
            }

            length = UiLength.Viewport(percent);
            return true;
        }

        return false;
    }

    private static bool TryParseWeight(ref Utf8JsonReader reader, out UiFontWeight weight)
    {
        weight = UiFontWeight.Normal;
        if (reader.TokenType == JsonTokenType.Number)
        {
            if (!reader.TryGetInt32(out int numeric) || numeric < 100 || numeric > 900 || numeric % 100 != 0)
            {
                return false;
            }

            weight = (UiFontWeight)numeric;
            return true;
        }

        if (reader.TokenType != JsonTokenType.String)
        {
            return false;
        }

        if (reader.ValueTextEquals("thin"u8))
        {
            weight = UiFontWeight.Thin;
        }
        else if (reader.ValueTextEquals("extralight"u8))
        {
            weight = UiFontWeight.ExtraLight;
        }
        else if (reader.ValueTextEquals("light"u8))
        {
            weight = UiFontWeight.Light;
        }
        else if (reader.ValueTextEquals("normal"u8))
        {
            weight = UiFontWeight.Normal;
        }
        else if (reader.ValueTextEquals("medium"u8))
        {
            weight = UiFontWeight.Medium;
        }
        else if (reader.ValueTextEquals("semibold"u8))
        {
            weight = UiFontWeight.SemiBold;
        }
        else if (reader.ValueTextEquals("bold"u8))
        {
            weight = UiFontWeight.Bold;
        }
        else if (reader.ValueTextEquals("extrabold"u8))
        {
            weight = UiFontWeight.ExtraBold;
        }
        else if (reader.ValueTextEquals("black"u8))
        {
            weight = UiFontWeight.Black;
        }
        else
        {
            return false;
        }

        return true;
    }

    private static bool TryParseDisplay(ref Utf8JsonReader reader, out UiDisplayMode value)
    {
        value = UiDisplayMode.Stack;
        if (reader.ValueTextEquals("stack"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("overlay"u8))
        {
            value = UiDisplayMode.Overlay;
            return true;
        }

        return false;
    }

    private static bool TryParseAxis(ref Utf8JsonReader reader, out UiAxis value)
    {
        value = UiAxis.Column;
        if (reader.ValueTextEquals("column"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("row"u8))
        {
            value = UiAxis.Row;
            return true;
        }

        return false;
    }

    private static bool TryParseAlign(ref Utf8JsonReader reader, out UiAlign value)
    {
        value = UiAlign.Start;
        if (reader.ValueTextEquals("start"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("center"u8))
        {
            value = UiAlign.Center;
            return true;
        }

        if (reader.ValueTextEquals("end"u8))
        {
            value = UiAlign.End;
            return true;
        }

        if (reader.ValueTextEquals("stretch"u8))
        {
            value = UiAlign.Stretch;
            return true;
        }

        return false;
    }

    private static bool TryParseAlignSelf(ref Utf8JsonReader reader, out UiAlignSelf value)
    {
        value = UiAlignSelf.Auto;
        if (reader.ValueTextEquals("auto"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("start"u8))
        {
            value = UiAlignSelf.Start;
            return true;
        }

        if (reader.ValueTextEquals("center"u8))
        {
            value = UiAlignSelf.Center;
            return true;
        }

        if (reader.ValueTextEquals("end"u8))
        {
            value = UiAlignSelf.End;
            return true;
        }

        if (reader.ValueTextEquals("stretch"u8))
        {
            value = UiAlignSelf.Stretch;
            return true;
        }

        return false;
    }

    private static bool TryParseJustify(ref Utf8JsonReader reader, out UiJustify value)
    {
        value = UiJustify.Start;
        if (reader.ValueTextEquals("start"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("center"u8))
        {
            value = UiJustify.Center;
            return true;
        }

        if (reader.ValueTextEquals("end"u8))
        {
            value = UiJustify.End;
            return true;
        }

        if (reader.ValueTextEquals("space-between"u8))
        {
            value = UiJustify.SpaceBetween;
            return true;
        }

        if (reader.ValueTextEquals("space-around"u8))
        {
            value = UiJustify.SpaceAround;
            return true;
        }

        if (reader.ValueTextEquals("space-evenly"u8))
        {
            value = UiJustify.SpaceEvenly;
            return true;
        }

        return false;
    }

    private static bool TryParseFlexWrap(ref Utf8JsonReader reader, out UiFlexWrap value)
    {
        value = UiFlexWrap.NoWrap;
        if (reader.ValueTextEquals("no-wrap"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("wrap"u8))
        {
            value = UiFlexWrap.Wrap;
            return true;
        }

        if (reader.ValueTextEquals("wrap-reverse"u8))
        {
            value = UiFlexWrap.WrapReverse;
            return true;
        }

        return false;
    }

    private static bool TryParsePosition(ref Utf8JsonReader reader, out UiPositionMode value)
    {
        value = UiPositionMode.Flow;
        if (reader.ValueTextEquals("flow"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("absolute"u8))
        {
            value = UiPositionMode.Absolute;
            return true;
        }

        return false;
    }

    private static bool TryParseFontStyle(ref Utf8JsonReader reader, out UiFontStyle value)
    {
        value = UiFontStyle.Normal;
        if (reader.ValueTextEquals("normal"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("italic"u8))
        {
            value = UiFontStyle.Italic;
            return true;
        }

        if (reader.ValueTextEquals("oblique"u8))
        {
            value = UiFontStyle.Oblique;
            return true;
        }

        return false;
    }

    private static bool TryParseTextWrap(ref Utf8JsonReader reader, out UiTextWrap value)
    {
        value = UiTextWrap.Word;
        if (reader.ValueTextEquals("word"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("none"u8))
        {
            value = UiTextWrap.None;
            return true;
        }

        if (reader.ValueTextEquals("grapheme"u8))
        {
            value = UiTextWrap.Grapheme;
            return true;
        }

        return false;
    }

    private static bool TryParseTextOverflow(ref Utf8JsonReader reader, out UiTextOverflow value)
    {
        value = UiTextOverflow.Clip;
        if (reader.ValueTextEquals("clip"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("ellipsis"u8))
        {
            value = UiTextOverflow.Ellipsis;
            return true;
        }

        return false;
    }

    private static bool TryParseTextAlign(ref Utf8JsonReader reader, out UiTextAlign value)
    {
        value = UiTextAlign.Start;
        if (reader.ValueTextEquals("start"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("center"u8))
        {
            value = UiTextAlign.Center;
            return true;
        }

        if (reader.ValueTextEquals("end"u8))
        {
            value = UiTextAlign.End;
            return true;
        }

        if (reader.ValueTextEquals("justify"u8))
        {
            value = UiTextAlign.Justify;
            return true;
        }

        return false;
    }

    private static bool TryParseTextDirection(ref Utf8JsonReader reader, out UiTextDirection value)
    {
        value = UiTextDirection.Auto;
        if (reader.ValueTextEquals("auto"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("ltr"u8))
        {
            value = UiTextDirection.Ltr;
            return true;
        }

        if (reader.ValueTextEquals("rtl"u8))
        {
            value = UiTextDirection.Rtl;
            return true;
        }

        return false;
    }

    private static bool TryParseImageFit(ref Utf8JsonReader reader, out UiImageFit value)
    {
        value = UiImageFit.Fill;
        if (reader.ValueTextEquals("fill"u8))
        {
            return true;
        }

        if (reader.ValueTextEquals("contain"u8))
        {
            value = UiImageFit.Contain;
            return true;
        }

        if (reader.ValueTextEquals("cover"u8))
        {
            value = UiImageFit.Cover;
            return true;
        }

        if (reader.ValueTextEquals("none"u8))
        {
            value = UiImageFit.None;
            return true;
        }

        if (reader.ValueTextEquals("scale-down"u8))
        {
            value = UiImageFit.ScaleDown;
            return true;
        }

        return false;
    }

    private static bool Duplicate(ref ulong seen, int bit)
    {
        ulong mask = 1UL << bit;
        if ((seen & mask) != 0)
        {
            return true;
        }

        seen |= mask;
        return false;
    }

    private static int Offset(in Utf8JsonReader reader) =>
        reader.TokenStartIndex > int.MaxValue ? int.MaxValue : (int)reader.TokenStartIndex;

    private static bool Fail(ref UiDocumentError error, UiDocumentErrorCode code, int offset, string message)
    {
        if (!error.HasError)
        {
            error = new UiDocumentError(code, offset, message);
        }

        return false;
    }
}
