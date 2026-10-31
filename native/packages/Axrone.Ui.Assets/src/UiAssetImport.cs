namespace Axrone.Ui.Assets;

/// <summary>One external resource referenced by an imported UI asset.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiAssetResource(
    UiResourceId Id,
    string Path,
    string MediaType,
    int ByteLength);

/// <summary>
/// Import destination. The importer pushes documents and their resource
/// references into the sink; the sink decides how they land in the asset store.
/// </summary>
public interface IUiAssetImportSink
{
    /// <summary>Adds one decoded document.</summary>
    void AddDocument(IUiDocument document);

    /// <summary>Adds one external resource reference.</summary>
    void AddResource(in UiAssetResource resource);
}

/// <summary>
/// UI asset importer contract. <see cref="CanImport"/> is a cheap header probe;
/// <see cref="TryImport"/> performs the full decode and reports the first error.
/// </summary>
public interface IUiAssetImporter
{
    /// <summary>Gets the stable format identifier.</summary>
    string FormatId { get; }

    /// <summary>Probes whether the payload starts with this importer's header.</summary>
    bool CanImport(ReadOnlySpan<byte> header);

    /// <summary>Imports a payload into the sink.</summary>
    bool TryImport(ReadOnlySpan<byte> source, IUiAssetImportSink sink, out UiDocumentError failure);
}
