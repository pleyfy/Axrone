namespace Axrone.Ui.Assets;

/// <summary>
/// Collects font, image and material references from a document into a
/// deterministic, duplicate-free resource list. Colliding resource identities
/// with different paths fail closed. Scratch state is reused per scan.
/// </summary>
internal sealed class UiAssetDependencyScanner
{
    private const string FontMediaType = "font/family";
    private const string MaterialMediaType = "application/x-axrone-material";
    private const int DefaultMaxResources = 65_536;

    private readonly List<UiAssetResource> _resources = [];
    private readonly Dictionary<ulong, int> _indexById = new();
    private readonly Stack<UiNodeId> _pending = new();
    private readonly int _maxResources;

    /// <summary>Creates a scanner with the default resource bound.</summary>
    public UiAssetDependencyScanner()
        : this(DefaultMaxResources)
    {
    }

    /// <summary>Creates a scanner with an explicit resource bound.</summary>
    internal UiAssetDependencyScanner(int maxResources)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxResources, 1);
        _maxResources = maxResources;
    }

    public IReadOnlyList<UiAssetResource> Resources => _resources;

    public bool TryScan(UiAssetDocument document, out UiDocumentError failure)
    {
        failure = UiDocumentError.None;
        _resources.Clear();
        _indexById.Clear();
        _pending.Clear();

        UiNodeId root = document.Nodes.Root;
        if (!root.IsValid)
        {
            failure = new UiDocumentError(UiDocumentErrorCode.MissingRoot, 0, "Document root is invalid.");
            return false;
        }

        _pending.Push(root);
        while (_pending.Count > 0)
        {
            UiNodeId node = _pending.Pop();
            if (!document.Nodes.TryGetNode(node, out _))
            {
                failure = new UiDocumentError(UiDocumentErrorCode.InvalidReference, 0, "Document node graph is inconsistent.");
                return false;
            }

            if (document.TryGetTextCore(node, out UiNodeTextCore text) && !text.Family.IsEmpty)
            {
                string family = Encoding.UTF8.GetString(document.Storage.GetUtf8(text.Family));
                if (!Add("font:"u8, family, FontMediaType, out failure))
                {
                    return false;
                }
            }

            if (document.TryGetImageCore(node, out UiNodeImageCore image) && !image.ResourceId.IsEmpty)
            {
                string path = Encoding.UTF8.GetString(document.Storage.GetUtf8(image.ResourceId));
                bool materialSource = image.SourceKind == UiImageSourceKind.Material;
                ReadOnlySpan<byte> prefix = materialSource ? "material:"u8 : "texture:"u8;
                string mediaType = materialSource ? MaterialMediaType : TextureMediaType(path);
                if (!Add(prefix, path, mediaType, out failure))
                {
                    return false;
                }
            }

            if (document.TryGetMaterialUtf8(node, out ReadOnlySpan<byte> material) && !material.IsEmpty)
            {
                string path = Encoding.UTF8.GetString(material);
                if (!Add("material:"u8, path, MaterialMediaType, out failure))
                {
                    return false;
                }
            }

            ReadOnlySpan<UiNodeId> children = document.Nodes.GetChildren(node);
            for (int i = 0; i < children.Length; i++)
            {
                _pending.Push(children[i]);
            }
        }

        _resources.Sort(static (left, right) => left.Id.Value.CompareTo(right.Id.Value));
        return true;
    }

    private bool Add(ReadOnlySpan<byte> prefix, string path, string mediaType, out UiDocumentError failure)
    {
        failure = UiDocumentError.None;
        string canonical = AssetKey.Canonicalize(path);
        if (canonical.Length == 0)
        {
            return true;
        }

        ulong hash = Fnv1a64.Compute(prefix);
        hash = Fnv1a64.ComputeUtf8Chars(canonical.AsSpan(), hash);
        if (hash == 0UL)
        {
            hash = 1UL;
        }

        if (_indexById.TryGetValue(hash, out int index))
        {
            UiAssetResource existing = _resources[index];
            if (string.Equals(existing.Path, canonical, StringComparison.Ordinal) &&
                string.Equals(existing.MediaType, mediaType, StringComparison.Ordinal))
            {
                return true;
            }

            failure = new UiDocumentError(
                UiDocumentErrorCode.Malformed,
                0,
                "Distinct UI resource paths collide under the same identity.");
            return false;
        }

        if (_resources.Count >= _maxResources)
        {
            failure = new UiDocumentError(
                UiDocumentErrorCode.ResourceLimit,
                0,
                "UI resource count exceeds the scan limit.");
            return false;
        }

        _indexById.Add(hash, _resources.Count);
        _resources.Add(new UiAssetResource(new UiResourceId(hash), canonical, mediaType, 0));
        return true;
    }

    private static string TextureMediaType(string path)
    {
        int dot = path.LastIndexOf('.');
        ReadOnlySpan<char> extension = dot >= 0 ? path.AsSpan(dot + 1) : ReadOnlySpan<char>.Empty;
        if (extension.Equals("png", StringComparison.OrdinalIgnoreCase))
        {
            return "image/png";
        }

        if (extension.Equals("jpg", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals("jpeg", StringComparison.OrdinalIgnoreCase))
        {
            return "image/jpeg";
        }

        if (extension.Equals("webp", StringComparison.OrdinalIgnoreCase))
        {
            return "image/webp";
        }

        if (extension.Equals("gif", StringComparison.OrdinalIgnoreCase))
        {
            return "image/gif";
        }

        if (extension.Equals("bmp", StringComparison.OrdinalIgnoreCase))
        {
            return "image/bmp";
        }

        if (extension.Equals("avif", StringComparison.OrdinalIgnoreCase))
        {
            return "image/avif";
        }

        if (extension.Equals("ttf", StringComparison.OrdinalIgnoreCase))
        {
            return "font/ttf";
        }

        if (extension.Equals("otf", StringComparison.OrdinalIgnoreCase))
        {
            return "font/otf";
        }

        if (extension.Equals("woff", StringComparison.OrdinalIgnoreCase))
        {
            return "font/woff";
        }

        if (extension.Equals("woff2", StringComparison.OrdinalIgnoreCase))
        {
            return "font/woff2";
        }

        return "application/octet-stream";
    }
}
