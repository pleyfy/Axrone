namespace Axrone.Ui.Assets;

/// <summary>
/// Consumer-side binding target. The integrating assembly implements this with
/// its concrete scene or prefab type, so this package never references ECS or
/// prefab assemblies.
/// </summary>
/// <typeparam name="TTarget">Scene or prefab target type.</typeparam>
public interface IUiDocumentBindingTarget<in TTarget>
    where TTarget : class
{
    /// <summary>Binds a document to a target.</summary>
    void OnBind(IUiDocument document, TTarget target);

    /// <summary>Removes every binding created for a document.</summary>
    void OnUnbind(IUiDocument document, TTarget target);
}

/// <summary>Scene binder adapter over a consumer-provided binding target.</summary>
/// <typeparam name="TScene">Scene target type.</typeparam>
public sealed class UiSceneDocumentBinder<TScene> : IUiSceneDocumentBinder<TScene>
    where TScene : class
{
    private readonly IUiDocumentBindingTarget<TScene> _target;

    /// <summary>Creates a binder over a target.</summary>
    public UiSceneDocumentBinder(IUiDocumentBindingTarget<TScene> target)
    {
        ArgumentNullException.ThrowIfNull(target);
        _target = target;
    }

    /// <inheritdoc/>
    public void Bind(IUiDocument document, TScene scene)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(scene);
        _target.OnBind(document, scene);
    }

    /// <inheritdoc/>
    public void Unbind(IUiDocument document, TScene scene)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(scene);
        _target.OnUnbind(document, scene);
    }
}

/// <summary>Prefab binder adapter over a consumer-provided binding target.</summary>
/// <typeparam name="TPrefab">Prefab target type.</typeparam>
public sealed class UiPrefabDocumentBinder<TPrefab> : IUiPrefabDocumentBinder<TPrefab>
    where TPrefab : class
{
    private readonly IUiDocumentBindingTarget<TPrefab> _target;

    /// <summary>Creates a binder over a target.</summary>
    public UiPrefabDocumentBinder(IUiDocumentBindingTarget<TPrefab> target)
    {
        ArgumentNullException.ThrowIfNull(target);
        _target = target;
    }

    /// <inheritdoc/>
    public void Bind(IUiDocument document, TPrefab prefab)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(prefab);
        _target.OnBind(document, prefab);
    }

    /// <inheritdoc/>
    public void Unbind(IUiDocument document, TPrefab prefab)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(prefab);
        _target.OnUnbind(document, prefab);
    }
}
