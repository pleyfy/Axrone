namespace Axrone.Scene;

/// <summary>
/// Immutable registration metadata shared by both component tiers. Descriptors
/// are built once during profile composition and read-only afterwards.
/// </summary>
public abstract class SceneComponentDescriptor
{
    private readonly SceneStringId[] _dependencies;

    /// <summary>Creates shared descriptor metadata.</summary>
    protected SceneComponentDescriptor(
        SceneStringId name,
        int priority,
        SceneComponentTraits traits,
        ReadOnlySpan<SceneStringId> dependencies,
        Type componentType)
    {
        if (!name.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Component descriptors require a non-empty interned name.");
        }

        ArgumentNullException.ThrowIfNull(componentType);

        Name = name;
        Priority = priority;
        Traits = traits;
        ComponentType = componentType;
        _dependencies = dependencies.IsEmpty ? [] : dependencies.ToArray();
    }

    /// <summary>Interned component name.</summary>
    public SceneStringId Name { get; }

    /// <summary>Dispatch priority; higher values run first.</summary>
    public int Priority { get; }

    /// <summary>Registration traits.</summary>
    public SceneComponentTraits Traits { get; }

    /// <summary>CLR type used for registration identity and editor metadata.</summary>
    public Type ComponentType { get; }

    /// <summary>Storage tier.</summary>
    public abstract SceneComponentKind Kind { get; }

    /// <summary>Whether at most one instance may be attached to an actor.</summary>
    public bool IsSingleton => (Traits & SceneComponentTraits.Singleton) != 0;

    /// <summary>Whether the component participates in snapshot serialization.</summary>
    public bool IsSerializable => (Traits & SceneComponentTraits.Serializable) != 0;

    /// <summary>Registration-time dependency symbols.</summary>
    public ReadOnlySpan<SceneStringId> Dependencies => _dependencies;

    /// <inheritdoc/>
    public override string ToString() => string.Create(
        CultureInfo.InvariantCulture,
        $"{GetType().Name}({Name}, priority={Priority})");
}

/// <summary>
/// Descriptor of an unmanaged data component stored in a dense column.
/// </summary>
public sealed class SceneDataComponentDescriptor : SceneComponentDescriptor
{
    /// <summary>Creates a data-component descriptor.</summary>
    public SceneDataComponentDescriptor(
        SceneComponentTypeId typeId,
        SceneStringId name,
        int size,
        int priority,
        SceneComponentTraits traits,
        ReadOnlySpan<SceneStringId> dependencies,
        Type componentType)
        : base(name, priority, traits, dependencies, componentType)
    {
        if (!typeId.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Data component '{name}' requires a valid type id.");
        }

        if (size <= 0)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Data component '{name}' must have a positive payload size; received {size}.");
        }

        TypeId = typeId;
        Size = size;
    }

    /// <summary>Dense data-component type id.</summary>
    public SceneComponentTypeId TypeId { get; }

    /// <summary>Payload size in bytes.</summary>
    public int Size { get; }

    /// <inheritdoc/>
    public override SceneComponentKind Kind => SceneComponentKind.Data;
}

/// <summary>
/// Descriptor of a managed behaviour component and its construction hook.
/// </summary>
public sealed class SceneBehaviourDescriptor : SceneComponentDescriptor
{
    /// <summary>Creates a behaviour descriptor.</summary>
    public SceneBehaviourDescriptor(
        SceneBehaviourTypeId typeId,
        SceneStringId name,
        Func<ISceneBehaviour> factory,
        int priority,
        SceneComponentTraits traits,
        ReadOnlySpan<SceneStringId> dependencies,
        Type componentType)
        : base(name, priority, traits, dependencies, componentType)
    {
        if (!typeId.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Behaviour '{name}' requires a valid type id.");
        }

        ArgumentNullException.ThrowIfNull(factory);

        TypeId = typeId;
        Factory = factory;
    }

    /// <summary>Dense behaviour type id.</summary>
    public SceneBehaviourTypeId TypeId { get; }

    /// <summary>Construction hook invoked once per attached instance.</summary>
    public Func<ISceneBehaviour> Factory { get; }

    /// <inheritdoc/>
    public override SceneComponentKind Kind => SceneComponentKind.Behaviour;

    /// <summary>Creates a new behaviour instance.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ISceneBehaviour Create() => Factory();
}
