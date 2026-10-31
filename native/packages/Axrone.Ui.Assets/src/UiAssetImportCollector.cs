namespace Axrone.Ui.Assets;

/// <summary>In-memory import sink used by tools and tests.</summary>
public sealed class UiAssetImportCollector : IUiAssetImportSink
{
    private readonly List<IUiDocument> _documents = [];
    private readonly List<UiAssetResource> _resources = [];

    /// <summary>Gets the imported documents.</summary>
    public IReadOnlyList<IUiDocument> Documents => _documents;

    /// <summary>Gets the imported resource references.</summary>
    public IReadOnlyList<UiAssetResource> Resources => _resources;

    /// <summary>Gets the imported document count.</summary>
    public int DocumentCount => _documents.Count;

    /// <summary>Gets the imported resource count.</summary>
    public int ResourceCount => _resources.Count;

    /// <inheritdoc/>
    public void AddDocument(IUiDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        _documents.Add(document);
    }

    /// <inheritdoc/>
    public void AddResource(in UiAssetResource resource) => _resources.Add(resource);

    /// <summary>Removes every collected document and resource.</summary>
    public void Clear()
    {
        _documents.Clear();
        _resources.Clear();
    }
}
