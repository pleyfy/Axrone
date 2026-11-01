namespace Axrone.Ui.Assets;

/// <summary>
/// <c>.ui.json</c> importer. Decodes through the codec, rebuilds the tree into
/// an independent document through <see cref="IUiDocumentBuilder"/>, scans font,
/// image and material references, then pushes the document and the sorted
/// resource list into the sink. Not thread-safe.
/// </summary>
public sealed class UiDocumentJsonImporter : IUiAssetImporter, IDisposable
{
    private const int MaxCopyDepth = 256;

    private readonly UiDocumentJsonCodec _codec = new();
    private readonly UiAssetDocumentBuilder _builder = new();
    private readonly UiAssetDependencyScanner _scanner = new();

    /// <inheritdoc/>
    public string FormatId => UiDocumentJsonCodec.CodecFormatId;

    /// <inheritdoc/>
    public bool CanImport(ReadOnlySpan<byte> header)
    {
        int index = 0;
        if (header.Length >= 3 && header[0] == 0xEF && header[1] == 0xBB && header[2] == 0xBF)
        {
            index = 3;
        }

        while (index < header.Length && IsWhitespace(header[index]))
        {
            index++;
        }

        if (index >= header.Length || header[index] != (byte)'{')
        {
            return false;
        }

        index++;
        while (index < header.Length && IsWhitespace(header[index]))
        {
            index++;
        }

        if (index >= header.Length || header[index] != (byte)'"')
        {
            return false;
        }

        index++;
        int start = index;
        while (index < header.Length && header[index] != (byte)'"' && index - start <= 16)
        {
            index++;
        }

        if (index >= header.Length || header[index] != (byte)'"')
        {
            return false;
        }

        ReadOnlySpan<byte> key = header[start..index];
        return key.SequenceEqual("version"u8) || key.SequenceEqual("id"u8) || key.SequenceEqual("name"u8);
    }

    /// <inheritdoc/>
    public bool TryImport(ReadOnlySpan<byte> source, IUiAssetImportSink sink, out UiDocumentError failure)
    {
        ArgumentNullException.ThrowIfNull(sink);
        if (!_codec.TryRead(source, out IUiDocument? decoded, out failure))
        {
            return false;
        }

        if (decoded is not UiAssetDocument document)
        {
            failure = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Decoded document type is unsupported.");
            return false;
        }

        _builder.Reset();
        _builder.AssetId = document.AssetId;

        try
        {
            if (!CopyNode(document, document.Nodes.Root, UiNodeId.Invalid, 0))
            {
                failure = new UiDocumentError(UiDocumentErrorCode.InvalidReference, 0, "Document node graph is inconsistent.");
                return false;
            }

            CopyBindings(document);
            UiAssetDocument built = _builder.Build(document.Info);
            if (!_scanner.TryScan(built, out failure))
            {
                return false;
            }

            sink.AddDocument(built);
            IReadOnlyList<UiAssetResource> resources = _scanner.Resources;
            for (int i = 0; i < resources.Count; i++)
            {
                UiAssetResource resource = resources[i];
                sink.AddResource(in resource);
            }

            failure = UiDocumentError.None;
            return true;
        }
        catch (InvalidOperationException)
        {
            failure = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document tree could not be rebuilt.");
            return false;
        }
        catch (ArgumentException)
        {
            failure = new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "Document payload is invalid.");
            return false;
        }
    }

    private bool CopyNode(UiAssetDocument source, UiNodeId oldId, UiNodeId newParent, int depth)
    {
        if (depth > MaxCopyDepth || !source.Nodes.TryGetNode(oldId, out UiNodeRecord record))
        {
            return false;
        }

        UiNodeId created = _builder.CreateNode(record.Kind, record.Flags);
        if (newParent.IsValid && !_builder.TryAppendChild(newParent, created))
        {
            return false;
        }

        CopyPayload(source, oldId, created);

        ReadOnlySpan<UiNodeId> children = source.Nodes.GetChildren(oldId);
        for (int i = 0; i < children.Length; i++)
        {
            if (!CopyNode(source, children[i], created, depth + 1))
            {
                return false;
            }
        }

        return true;
    }

    private void CopyPayload(UiAssetDocument source, UiNodeId oldId, UiNodeId created)
    {
        if (source.TryGetRole(oldId, out string? role))
        {
            _ = _builder.TrySetRole(created, role.AsSpan());
        }

        if (source.TryGetController(oldId, out string? controller))
        {
            _ = _builder.TrySetController(created, controller.AsSpan());
        }

        if (source.TryGetKey(oldId, out UiBindingKey key))
        {
            _ = _builder.TrySetKey(created, in key);
        }

        if (source.TryGetLayout(oldId, out UiLayoutStyle layout))
        {
            _ = _builder.TrySetLayout(created, in layout);
        }

        if (source.TryGetStyle(oldId, out UiWidgetStyle style))
        {
            _ = _builder.TrySetStyle(created, in style);
        }

        if (source.TryGetText(oldId, out UiNodeText text))
        {
            _ = _builder.TrySetText(created, in text);
        }

        if (source.TryGetImage(oldId, out UiNodeImage image))
        {
            _ = _builder.TrySetImage(created, in image);
        }

        if (source.TryGetFocus(oldId, out UiNodeFocus focus))
        {
            _ = _builder.TrySetFocus(created, in focus);
        }

        if (source.TryGetMaterialUtf8(oldId, out ReadOnlySpan<byte> material) && !material.IsEmpty)
        {
            _ = _builder.TrySetMaterial(created, Encoding.UTF8.GetString(material).AsSpan());
        }
    }

    private void CopyBindings(UiAssetDocument source)
    {
        UiBindingTable bindings = source.Bindings;
        for (int i = 0; i < bindings.Count; i++)
        {
            if (!bindings.TryGetAt(i, out ReadOnlySpan<byte> name, out UiBindingValue value, out ReadOnlySpan<byte> text))
            {
                continue;
            }

            string bindingName = Encoding.UTF8.GetString(name);
            switch (value.Kind)
            {
                case UiBindingValueKind.Text:
                    _builder.Bindings.SetString(bindingName, Encoding.UTF8.GetString(text));
                    break;
                case UiBindingValueKind.Numeric:
                    _builder.Bindings.SetNumber(bindingName, value.Number);
                    break;
                case UiBindingValueKind.Flag:
                    _builder.Bindings.SetBoolean(bindingName, value.Boolean);
                    break;
                default:
                    _builder.Bindings.SetNull(bindingName);
                    break;
            }
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        _codec.Dispose();
        GC.SuppressFinalize(this);
    }

    private static bool IsWhitespace(byte value) =>
        value == (byte)' ' || value == (byte)'\t' || value == (byte)'\r' || value == (byte)'\n';
}
