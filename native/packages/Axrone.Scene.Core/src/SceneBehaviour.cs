namespace Axrone.Scene;

/// <summary>Lifecycle position of a managed scene behaviour.</summary>
public enum SceneBehaviourState : byte
{
    /// <summary>Constructed but not attached to an actor.</summary>
    Detached = 0,

    /// <summary>OnAttach has run.</summary>
    Loaded = 1,

    /// <summary>Start has run, but the behaviour is not enabled.</summary>
    Started = 2,

    /// <summary>Enable has run; update phases are dispatched.</summary>
    Enabled = 3,

    /// <summary>Disable has run; update phases are skipped.</summary>
    Disabled = 4,

    /// <summary>Detach has run; the instance must not be reused.</summary>
    Destroyed = 5
}

/// <summary>
/// Managed scene behaviour contract. Implementations get exactly one entry point,
/// <see cref="OnAttach"/>, and register the callbacks they need on the supplied
/// <see cref="SceneBehaviourContext"/>. There is no base class and no lifecycle override
/// surface: an unused phase costs no virtual dispatch and no empty override.
/// </summary>
/// <remarks>
/// Data components intentionally do not implement this interface: they are plain payloads
/// consumed by systems. A behaviour is the managed half of the scene model and owns
/// per-instance state.
/// </remarks>
public interface ISceneBehaviour
{
    /// <summary>
    /// Called once when the instance is attached to an actor. Register callbacks and
    /// lifetime-bound subscriptions here; the context is valid for the whole attachment.
    /// </summary>
    void OnAttach(SceneBehaviourContext context);
}

/// <summary>
/// Attachment context for one <see cref="ISceneBehaviour"/> instance. It exposes the owning
/// actor and world, live lifecycle state, typed scene-component access, and explicit
/// registration of the phases the behaviour actually uses.
/// </summary>
/// <remarks>
/// <para>The context stays valid after detach; <see cref="IsAttached"/> turns false and
/// <see cref="Enabled"/> reads false, so a script may safely keep the reference for
/// diagnostics without touching a reused table slot.</para>
/// <para>Registering the same phase twice throws: a silent overwrite would hide a bug in
/// script setup.</para>
/// </remarks>
public sealed class SceneBehaviourContext
{
    private readonly SceneBehaviourTable _table;
    private readonly int _slot;
    private bool _detached;

    internal SceneBehaviourContext(
        SceneBehaviourTable table,
        int slot,
        SceneActor actor,
        SceneWorld world,
        SceneBehaviourTypeId typeId,
        int priority)
    {
        _table = table;
        _slot = slot;
        Actor = actor;
        World = world;
        TypeId = typeId;
        Priority = priority;
        EnabledFlag = true;
        ActiveInHierarchyFlag = true;
    }

    /// <summary>Owning actor.</summary>
    public SceneActor Actor { get; }

    /// <summary>Owning world.</summary>
    public SceneWorld World { get; }

    /// <summary>Registered behaviour type id.</summary>
    public SceneBehaviourTypeId TypeId { get; }

    /// <summary>Dispatch priority; higher values run first.</summary>
    public int Priority { get; }

    /// <summary>Current lifecycle position; a detached context reports <see cref="SceneBehaviourState.Destroyed"/>.</summary>
    public SceneBehaviourState State => LifecycleState;

    /// <summary>
    /// Enables or disables update dispatch. The world applies the change immediately when the
    /// behaviour has started; before that the flag is remembered for the start transition.
    /// </summary>
    public bool Enabled
    {
        get => !_detached && EnabledFlag;
        set => _table.SetEnabled(this, value);
    }

    /// <summary>Whether the behaviour is still attached to its actor.</summary>
    public bool IsAttached => !_detached;

    /// <summary>Whether the actor's hierarchy branch is active.</summary>
    public bool IsActiveInHierarchy => !_detached && ActiveInHierarchyFlag;

    /// <summary>Whether the owning world has started.</summary>
    public bool IsWorldStarted => _table.IsStarted;

    internal int Slot => _slot;

    internal SceneBehaviourState LifecycleState;

    internal bool EnabledFlag;

    internal bool ActiveInHierarchyFlag;

    /// <summary>Tries to read one unmanaged scene component from the owning actor.</summary>
    public bool TryGet<T>(out T value)
        where T : unmanaged, ISceneDataComponent =>
        World.TryGetData(Actor, out value);

    /// <summary>Reads one unmanaged scene component from the owning actor.</summary>
    public T Get<T>()
        where T : unmanaged, ISceneDataComponent =>
        World.GetData<T>(Actor);

    /// <summary>Registers the callback that runs when the world starts.</summary>
    public void OnStart(Action callback)
    {
        EnsureAttached();
        _table.RegisterStart(this, callback);
    }

    /// <summary>Registers the callback that runs when the behaviour becomes enabled.</summary>
    public void OnEnable(Action callback)
    {
        EnsureAttached();
        _table.RegisterEnable(this, callback);
    }

    /// <summary>Registers the callback that runs when the behaviour becomes disabled.</summary>
    public void OnDisable(Action callback)
    {
        EnsureAttached();
        _table.RegisterDisable(this, callback);
    }

    /// <summary>Registers the callback that runs once per fixed step while enabled.</summary>
    public void OnFixedUpdate(Action<float> callback)
    {
        EnsureAttached();
        _table.RegisterFixedUpdate(this, callback);
    }

    /// <summary>Registers the callback that runs once per frame while enabled.</summary>
    public void OnUpdate(Action<float> callback)
    {
        EnsureAttached();
        _table.RegisterUpdate(this, callback);
    }

    /// <summary>Registers the callback that runs after update while enabled.</summary>
    public void OnLateUpdate(Action<float> callback)
    {
        EnsureAttached();
        _table.RegisterLateUpdate(this, callback);
    }

    /// <summary>Registers cleanup that runs when the behaviour is removed or its actor is destroyed.</summary>
    public void OnDetach(Action callback)
    {
        EnsureAttached();
        _table.RegisterDetach(this, callback);
    }

    /// <summary>
    /// Binds a subscription to this attachment. The owning table disposes it on detach, so
    /// observable handlers cannot outlive the behaviour that registered them.
    /// </summary>
    public IDisposable Track(IDisposable subscription)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        EnsureAttached();
        _table.Track(this, subscription);
        return subscription;
    }

    internal void MarkDetached()
    {
        _detached = true;
        EnabledFlag = false;
        ActiveInHierarchyFlag = false;
        LifecycleState = SceneBehaviourState.Destroyed;
    }

    private void EnsureAttached()
    {
        if (_detached)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "The behaviour context is no longer attached.");
        }
    }
}
