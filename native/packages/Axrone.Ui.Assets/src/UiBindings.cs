namespace Axrone.Ui.Assets;

/// <summary>
/// Binds a UI document to a scene target. Scene and prefab types are generic
/// type parameters so this package never takes a hard reference to the ECS or
/// prefab assemblies; the concrete binder lives on the integrating side.
/// </summary>
/// <typeparam name="TScene">Scene target type.</typeparam>
public interface IUiSceneDocumentBinder<in TScene>
    where TScene : class
{
    /// <summary>Binds the document's nodes to the scene.</summary>
    void Bind(IUiDocument document, TScene scene);

    /// <summary>Removes every binding created by <see cref="Bind"/>.</summary>
    void Unbind(IUiDocument document, TScene scene);
}

/// <summary>Binds a UI document to a prefab target.</summary>
/// <typeparam name="TPrefab">Prefab target type.</typeparam>
public interface IUiPrefabDocumentBinder<in TPrefab>
    where TPrefab : class
{
    /// <summary>Binds the document's nodes to the prefab.</summary>
    void Bind(IUiDocument document, TPrefab prefab);

    /// <summary>Removes every binding created by <see cref="Bind"/>.</summary>
    void Unbind(IUiDocument document, TPrefab prefab);
}

/// <summary>
/// Editor-facing host contract for opening, saving and reloading documents
/// from disk. Implementations own path resolution and file watching.
/// </summary>
public interface IUiEditorDocumentHost
{
    /// <summary>Opens a document from a path.</summary>
    bool TryOpen(string path, out IUiDocument? document);

    /// <summary>Saves a document to a path.</summary>
    bool TrySave(IUiDocument document, string path);

    /// <summary>Reloads a previously opened document from its source.</summary>
    bool TryReload(UiDocumentId document, out IUiDocument? reloaded);
}
