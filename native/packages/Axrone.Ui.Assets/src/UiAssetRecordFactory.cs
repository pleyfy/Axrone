namespace Axrone.Ui.Assets;

/// <summary>Stable asset key derivation for UI documents.</summary>
public static class UiAssetKeyFactory
{
    /// <summary>Derives the asset key from the authored identifier, falling back to the document id.</summary>
    public static AssetKey FromDocument(IUiDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        if (document is UiAssetDocument asset && !string.IsNullOrEmpty(asset.AssetId))
        {
            return new AssetKey(asset.AssetId);
        }

        return new AssetKey(document.Info.Id.Value.ToString("x8", CultureInfo.InvariantCulture));
    }

    /// <summary>Creates a canonical asset key from a source path.</summary>
    public static AssetKey FromPath(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        return new AssetKey(path);
    }
}

/// <summary>
/// Bridges an imported UI document into the <c>Axrone.Asset</c> write model:
/// canonical UTF-8 payload, stable key, deterministic fingerprint and resource
/// dependencies. The caller passes the result to <c>AssetDatabase.Upsert</c>.
/// </summary>
public static class UiAssetRecordFactory
{
    /// <summary>Asset kind used for <c>.ui.json</c> documents.</summary>
    public const string AssetKind = "ui-asset";

    /// <summary>Creates the asset write input for one UI document.</summary>
    public static AssetWriteInput<byte[]> Create(
        IUiDocument document,
        IUiDocumentCodec codec,
        IReadOnlyList<UiAssetResource>? resources = null,
        string kind = AssetKind,
        AssetKey? key = null)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(codec);
        ArgumentException.ThrowIfNullOrEmpty(kind);

        var buffer = new ArrayBufferWriter<byte>(1024);
        codec.Write(document, buffer);
        byte[] payload = buffer.WrittenSpan.ToArray();
        AssetKey effectiveKey = key ?? UiAssetKeyFactory.FromDocument(document);

        string keyText = effectiveKey.Value ?? effectiveKey.Hash.ToString("x16", CultureInfo.InvariantCulture);
        ulong fingerprint = Fnv1a64.ComputeUtf8Chars(kind.AsSpan());
        fingerprint = Fnv1a64.Compute(payload, fingerprint);
        fingerprint = Fnv1a64.ComputeUtf8Chars(keyText.AsSpan(), fingerprint);
        if (fingerprint == 0UL)
        {
            fingerprint = 1UL;
        }

        AssetDependencyInput[] dependencies = [];
        if (resources is { Count: > 0 })
        {
            dependencies = new AssetDependencyInput[resources.Count];
            for (int i = 0; i < resources.Count; i++)
            {
                dependencies[i] = AssetDependencyInput.FromKey(new AssetKey(resources[i].Path));
            }
        }

        return new AssetWriteInput<byte[]>(
            kind,
            Id: null,
            effectiveKey,
            document.Info.Name,
            payload,
            Aliases: null,
            Metadata: null,
            Dependencies: dependencies,
            Fingerprint: new AssetFingerprint(fingerprint));
    }
}
