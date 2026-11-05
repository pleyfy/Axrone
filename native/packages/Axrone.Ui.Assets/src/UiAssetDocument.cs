namespace Axrone.Ui.Assets;

/// <summary>
/// Concrete UI asset document. It implements the frozen <see cref="IUiDocument"/>
/// contract and adds the authored payload layer (role, controller, key, layout,
/// style, text, image, focus, material) that the core document type does not
/// model. Instances produced by a reusable codec share their buffers until the
/// next successful read.
/// </summary>
public sealed class UiAssetDocument : IUiDocument
{
    private UiDocumentStorage _storage;
    private UiDocumentInfo _info;
    private string _assetId;

    internal UiAssetDocument(UiDocumentStorage storage, in UiDocumentInfo info, string assetId)
    {
        _storage = storage;
        _info = info;
        _assetId = assetId;
        Bindings = new UiBindingTable(storage);
    }

    /// <summary>Gets the document metadata.</summary>
    public UiDocumentInfo Info => _info;

    /// <summary>Gets the node tree.</summary>
    public IUiNodeTree Nodes => _storage;

    /// <summary>Gets the authored asset identifier preserved from the payload.</summary>
    public string AssetId => _assetId;

    /// <summary>Gets the sorted binding table.</summary>
    public UiBindingTable Bindings { get; }

    internal UiDocumentStorage Storage => _storage;

    internal void Attach(UiDocumentStorage storage, in UiDocumentInfo info, string assetId)
    {
        _storage = storage;
        _info = info;
        _assetId = assetId;
        Bindings.Attach(storage);
    }

    /// <summary>Reads the authored role of a node as UTF-8.</summary>
    public bool TryGetRoleUtf8(UiNodeId id, out ReadOnlySpan<byte> role)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Role))
        {
            role = ReadOnlySpan<byte>.Empty;
            return false;
        }

        role = _storage.GetUtf8(_storage.Roles[(int)id.Value - 1]);
        return true;
    }

    /// <summary>Reads the authored role of a node.</summary>
    public bool TryGetRole(UiNodeId id, out string? role)
    {
        if (TryGetRoleUtf8(id, out ReadOnlySpan<byte> utf8))
        {
            role = Encoding.UTF8.GetString(utf8);
            return true;
        }

        role = null;
        return false;
    }

    /// <summary>Reads the optional controller type of a node as UTF-8.</summary>
    public bool TryGetControllerUtf8(UiNodeId id, out ReadOnlySpan<byte> controller)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Controller))
        {
            controller = ReadOnlySpan<byte>.Empty;
            return false;
        }

        controller = _storage.GetUtf8(_storage.Controllers[(int)id.Value - 1]);
        return true;
    }

    /// <summary>Reads the optional controller type of a node.</summary>
    public bool TryGetController(UiNodeId id, out string? controller)
    {
        if (TryGetControllerUtf8(id, out ReadOnlySpan<byte> utf8))
        {
            controller = Encoding.UTF8.GetString(utf8);
            return true;
        }

        controller = null;
        return false;
    }

    /// <summary>Reads the authored widget key of a node.</summary>
    public bool TryGetKey(UiNodeId id, out UiBindingKey key)
    {
        if (!TryGetKeyCore(id, out UiBindingKeyCore core))
        {
            key = UiBindingKey.None;
            return false;
        }

        key = core.Kind switch
        {
            UiKeyKind.Text => new UiBindingKey(core.Kind, 0L, Encoding.UTF8.GetString(_storage.GetUtf8(core.Text))),
            UiKeyKind.Numeric => new UiBindingKey(core.Kind, core.Number, null),
            _ => UiBindingKey.None,
        };
        return true;
    }

    /// <summary>Reads a string widget key as UTF-8.</summary>
    public bool TryGetKeyTextUtf8(UiNodeId id, out ReadOnlySpan<byte> text)
    {
        if (TryGetKeyCore(id, out UiBindingKeyCore core) && core.Kind == UiKeyKind.Text)
        {
            text = _storage.GetUtf8(core.Text);
            return true;
        }

        text = ReadOnlySpan<byte>.Empty;
        return false;
    }

    /// <summary>Reads the resolved layout style of a node.</summary>
    public bool TryGetLayout(UiNodeId id, out UiLayoutStyle layout)
    {
        if (!IsKnown(id))
        {
            layout = UiLayoutStyle.Default;
            return false;
        }

        layout = _storage.Layouts[(int)id.Value - 1];
        return true;
    }

    /// <summary>Reads the authored widget style of a node.</summary>
    public bool TryGetStyle(UiNodeId id, out UiWidgetStyle style)
    {
        if (!IsKnown(id))
        {
            style = UiWidgetStyle.Default;
            return false;
        }

        style = _storage.Styles[(int)id.Value - 1];
        return true;
    }

    /// <summary>Reads the authored text block of a node.</summary>
    public bool TryGetText(UiNodeId id, out UiNodeText text)
    {
        if (!TryGetTextCore(id, out UiNodeTextCore core))
        {
            text = UiNodeText.Default;
            return false;
        }

        text = new UiNodeText(
            Encoding.UTF8.GetString(_storage.GetUtf8(core.Value)),
            Encoding.UTF8.GetString(_storage.GetUtf8(core.Family)),
            core.Size,
            core.Weight,
            core.FontStyle,
            core.Wrap,
            core.Overflow,
            core.Align,
            core.Direction,
            core.LineHeight,
            core.LetterSpacing,
            core.MaxLines,
            core.AutoSize,
            core.MinFontSize,
            core.MaxFontSize);
        return true;
    }

    /// <summary>Reads a node text value as UTF-8.</summary>
    public bool TryGetTextValueUtf8(UiNodeId id, out ReadOnlySpan<byte> value)
    {
        if (TryGetTextCore(id, out UiNodeTextCore core))
        {
            value = _storage.GetUtf8(core.Value);
            return true;
        }

        value = ReadOnlySpan<byte>.Empty;
        return false;
    }

    /// <summary>Reads the authored image block of a node.</summary>
    public bool TryGetImage(UiNodeId id, out UiNodeImage image)
    {
        if (!TryGetImageCore(id, out UiNodeImageCore core))
        {
            image = UiNodeImage.Default;
            return false;
        }

        image = new UiNodeImage(
            core.SourceKind,
            Encoding.UTF8.GetString(_storage.GetUtf8(core.ResourceId)),
            core.Fit,
            core.Tint,
            core.Border,
            core.UvRect,
            core.SourceSize,
            core.FillCenter,
            core.Bleed);
        return true;
    }

    /// <summary>Reads a node image resource identifier as UTF-8.</summary>
    public bool TryGetImageResourceUtf8(UiNodeId id, out ReadOnlySpan<byte> resourceId)
    {
        if (TryGetImageCore(id, out UiNodeImageCore core))
        {
            resourceId = _storage.GetUtf8(core.ResourceId);
            return true;
        }

        resourceId = ReadOnlySpan<byte>.Empty;
        return false;
    }

    /// <summary>Reads the authored focus policy of a node.</summary>
    public bool TryGetFocus(UiNodeId id, out UiNodeFocus focus)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Focus))
        {
            focus = UiNodeFocus.Default;
            return false;
        }

        focus = _storage.Focuses[(int)id.Value - 1];
        return true;
    }

    /// <summary>Reads the authored material identifier of a node as UTF-8.</summary>
    public bool TryGetMaterialUtf8(UiNodeId id, out ReadOnlySpan<byte> material)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Material))
        {
            material = ReadOnlySpan<byte>.Empty;
            return false;
        }

        material = _storage.GetUtf8(_storage.Materials[(int)id.Value - 1]);
        return true;
    }

    /// <summary>Reads the derived numeric resource identity of a node material.</summary>
    public bool TryGetMaterial(UiNodeId id, out UiResourceId material)
    {
        if (!TryGetMaterialUtf8(id, out ReadOnlySpan<byte> utf8) || utf8.IsEmpty)
        {
            material = UiResourceId.Invalid;
            return false;
        }

        material = new UiResourceId(Fnv1a64.Compute(utf8));
        return true;
    }

    internal bool TryGetKeyCore(UiNodeId id, out UiBindingKeyCore core)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Key))
        {
            core = UiBindingKeyCore.None;
            return false;
        }

        core = _storage.Keys[(int)id.Value - 1];
        return true;
    }

    internal bool TryGetTextCore(UiNodeId id, out UiNodeTextCore core)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Text))
        {
            core = default;
            return false;
        }

        core = _storage.Texts[(int)id.Value - 1];
        return true;
    }

    internal bool TryGetImageCore(UiNodeId id, out UiNodeImageCore core)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Image))
        {
            core = default;
            return false;
        }

        core = _storage.Images[(int)id.Value - 1];
        return true;
    }

    internal bool TryGetRoleCore(UiNodeId id, out UiStringRef role)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Role))
        {
            role = UiStringRef.Empty;
            return false;
        }

        role = _storage.Roles[(int)id.Value - 1];
        return true;
    }

    internal bool TryGetControllerCore(UiNodeId id, out UiStringRef controller)
    {
        if (!_storage.HasPresence(id, UiNodePresence.Controller))
        {
            controller = UiStringRef.Empty;
            return false;
        }

        controller = _storage.Controllers[(int)id.Value - 1];
        return true;
    }

    private bool IsKnown(UiNodeId id) => id.IsValid && (uint)((int)id.Value - 1) < (uint)_storage.Count;
}
