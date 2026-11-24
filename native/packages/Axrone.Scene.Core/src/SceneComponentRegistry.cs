namespace Axrone.Scene;

/// <summary>
/// Explicit component registration for a scene profile. Data and behaviour
/// ids are dense, independent and bounded; the structural tables are immutable
/// once <see cref="Seal"/> is called, which is the point the runtime begins
/// lock-free lookups.
/// </summary>
/// <remarks>
/// Registration is cold and serialized. <see cref="TryGetData"/> and
/// <see cref="TryGetBehaviour"/> are lock-free after sealing; calling them
/// concurrently with registration is a configuration error.
/// </remarks>
public sealed class SceneComponentRegistry
{
    /// <summary>Maximum number of data component types per registry.</summary>
    public const int MaxComponentTypes = SceneComponentMask.Capacity;

    private readonly Lock _gate = new();
    private readonly SceneDataComponentDescriptor?[] _dataById = new SceneDataComponentDescriptor?[MaxComponentTypes];
    private readonly SceneBehaviourDescriptor?[] _behaviourById = new SceneBehaviourDescriptor?[MaxComponentTypes];
    private readonly Dictionary<SceneStringId, SceneComponentDescriptor> _byName = new();
    private readonly Dictionary<Type, SceneDataComponentDescriptor> _dataByType = new();
    private readonly Dictionary<Type, SceneBehaviourDescriptor> _behaviourByType = new();
    private readonly List<SceneDataComponentDescriptor> _dataOrder = new();
    private readonly List<SceneBehaviourDescriptor> _behaviourOrder = new();
    private int _dataCount;
    private int _behaviourCount;
    private bool _sealed;

    /// <summary>Creates a registry, optionally sharing a name table.</summary>
    public SceneComponentRegistry(SceneNameTable? names = null)
    {
        Names = names ?? new SceneNameTable();
    }

    /// <summary>Name table that owns every symbol registered here.</summary>
    public SceneNameTable Names { get; }

    /// <summary>Whether registration has been frozen.</summary>
    public bool IsSealed
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Volatile.Read(ref _sealed);
    }

    /// <summary>Number of data component registrations.</summary>
    public int DataCount
    {
        get
        {
            lock (_gate)
            {
                return _dataCount;
            }
        }
    }

    /// <summary>Number of behaviour registrations.</summary>
    public int BehaviourCount
    {
        get
        {
            lock (_gate)
            {
                return _behaviourCount;
            }
        }
    }

    /// <summary>Total number of registrations.</summary>
    public int Count => DataCount + BehaviourCount;

    /// <summary>Freezes the registry for runtime use.</summary>
    public void Seal()
    {
        lock (_gate)
        {
            _sealed = true;
        }
    }

    /// <summary>Registers an unmanaged data component type.</summary>
    /// <exception cref="SceneValidationException">
    /// The name is already taken by a different type, the type was registered
    /// under another name, or the id budget is exhausted.
    /// </exception>
    public SceneDataComponentDescriptor RegisterData<T>(
        ReadOnlySpan<char> name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : unmanaged, ISceneDataComponent
    {
        ValidateTraits(in traits, name);
        ValidateDependencies(dependencies);

        lock (_gate)
        {
            ThrowIfSealed();

            SceneStringId symbol = Names.Intern(name);
            if (_byName.TryGetValue(symbol, out SceneComponentDescriptor? existing))
            {
                if (existing is SceneDataComponentDescriptor data &&
                    data.ComponentType == typeof(T))
                {
                    if (data.Priority != priority || data.Traits != traits)
                    {
                        throw new SceneValidationException(
                            SceneErrorCodes.ValidationInvalid,
                            $"Data component '{name}' is already registered with different metadata.");
                    }

                    return data;
                }

                throw new SceneValidationException(
                    SceneErrorCodes.NameCollision,
                    $"Name '{name}' is already used by a {existing.Kind} component.");
            }

            if (_dataByType.TryGetValue(typeof(T), out SceneDataComponentDescriptor? sameType))
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ComponentDuplicate,
                    $"Data component type {typeof(T).Name} is already registered as '{sameType.Name}'.");
            }

            if (_dataCount >= MaxComponentTypes)
            {
                SceneThrowHelper.ThrowComponentLimitExceeded(MaxComponentTypes);
            }

            var descriptor = new SceneDataComponentDescriptor(
                new SceneComponentTypeId((ushort)_dataCount),
                symbol,
                Unsafe.SizeOf<T>(),
                priority,
                traits,
                dependencies,
                typeof(T));

            _dataById[_dataCount] = descriptor;
            _dataOrder.Add(descriptor);
            _byName.Add(symbol, descriptor);
            _dataByType.Add(typeof(T), descriptor);
            _dataCount++;
            return descriptor;
        }
    }

    /// <summary>Registers an unmanaged data component type by string name.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneDataComponentDescriptor RegisterData<T>(
        string name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(name);
        return RegisterData<T>(name.AsSpan(), traits, priority, dependencies);
    }

    /// <summary>Registers a managed behaviour type with an explicit factory.</summary>
    /// <exception cref="SceneValidationException">
    /// The name is already taken by a different type, the type was registered
    /// under another name, or the id budget is exhausted.
    /// </exception>
    public SceneBehaviourDescriptor RegisterBehaviour<T>(
        ReadOnlySpan<char> name,
        Func<T> factory,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour
    {
        ArgumentNullException.ThrowIfNull(factory);
        ValidateTraits(in traits, name);
        ValidateDependencies(dependencies);

        lock (_gate)
        {
            ThrowIfSealed();

            SceneStringId symbol = Names.Intern(name);
            if (_byName.TryGetValue(symbol, out SceneComponentDescriptor? existing))
            {
                if (existing is SceneBehaviourDescriptor behaviour &&
                    behaviour.ComponentType == typeof(T))
                {
                    if (behaviour.Priority != priority || behaviour.Traits != traits)
                    {
                        throw new SceneValidationException(
                            SceneErrorCodes.ValidationInvalid,
                            $"Behaviour '{name}' is already registered with different metadata.");
                    }

                    return behaviour;
                }

                throw new SceneValidationException(
                    SceneErrorCodes.NameCollision,
                    $"Name '{name}' is already used by a {existing.Kind} component.");
            }

            if (_behaviourByType.TryGetValue(typeof(T), out SceneBehaviourDescriptor? sameType))
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ComponentDuplicate,
                    $"Behaviour type {typeof(T).Name} is already registered as '{sameType.Name}'.");
            }

            if (_behaviourCount >= MaxComponentTypes)
            {
                SceneThrowHelper.ThrowComponentLimitExceeded(MaxComponentTypes);
            }

            var descriptor = new SceneBehaviourDescriptor(
                new SceneBehaviourTypeId((ushort)_behaviourCount),
                symbol,
                factory,
                priority,
                traits,
                dependencies,
                typeof(T));

            _behaviourById[_behaviourCount] = descriptor;
            _behaviourOrder.Add(descriptor);
            _byName.Add(symbol, descriptor);
            _behaviourByType.Add(typeof(T), descriptor);
            _behaviourCount++;
            return descriptor;
        }
    }

    /// <summary>Registers a managed behaviour type with its parameterless constructor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneBehaviourDescriptor RegisterBehaviour<T>(
        ReadOnlySpan<char> name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour, new() =>
        RegisterBehaviour(name, static () => new T(), traits, priority, dependencies);

    /// <summary>Registers a managed behaviour type by string name.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneBehaviourDescriptor RegisterBehaviour<T>(
        string name,
        Func<T> factory,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour
    {
        ArgumentNullException.ThrowIfNull(name);
        return RegisterBehaviour(name.AsSpan(), factory, traits, priority, dependencies);
    }

    /// <summary>Registers a managed behaviour type by string name and default constructor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneBehaviourDescriptor RegisterBehaviour<T>(
        string name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour, new() =>
        RegisterBehaviour(name.AsSpan(), static () => new T(), traits, priority, dependencies);

    /// <summary>Resolves a data component descriptor by dense id.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetData(
        SceneComponentTypeId typeId,
        [NotNullWhen(true)] out SceneDataComponentDescriptor? descriptor)
    {
        if ((uint)typeId.Value >= (uint)MaxComponentTypes)
        {
            descriptor = null;
            return false;
        }

        descriptor = _dataById[typeId.Value];
        return descriptor is not null;
    }

    /// <summary>Resolves a data component descriptor, throwing when unregistered.</summary>
    public SceneDataComponentDescriptor GetData(SceneComponentTypeId typeId)
    {
        if (TryGetData(typeId, out SceneDataComponentDescriptor? descriptor))
        {
            return descriptor;
        }

        SceneThrowHelper.ThrowComponentTypeUnregistered(typeId);
        return null!;
    }

    /// <summary>Resolves a behaviour descriptor by dense id.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetBehaviour(
        SceneBehaviourTypeId typeId,
        [NotNullWhen(true)] out SceneBehaviourDescriptor? descriptor)
    {
        if ((uint)typeId.Value >= (uint)MaxComponentTypes)
        {
            descriptor = null;
            return false;
        }

        descriptor = _behaviourById[typeId.Value];
        return descriptor is not null;
    }

    /// <summary>Resolves a behaviour descriptor, throwing when unregistered.</summary>
    public SceneBehaviourDescriptor GetBehaviour(SceneBehaviourTypeId typeId)
    {
        if (TryGetBehaviour(typeId, out SceneBehaviourDescriptor? descriptor))
        {
            return descriptor;
        }

        SceneThrowHelper.ThrowBehaviourTypeUnregistered(typeId);
        return null!;
    }

    /// <summary>Resolves a descriptor by interned name.</summary>
    public bool TryGetByName(
        SceneStringId name,
        [NotNullWhen(true)] out SceneComponentDescriptor? descriptor)
    {
        lock (_gate)
        {
            return _byName.TryGetValue(name, out descriptor);
        }
    }

    /// <summary>Resolves a descriptor by its original name.</summary>
    public bool TryGetByName(
        string name,
        [NotNullWhen(true)] out SceneComponentDescriptor? descriptor)
    {
        ArgumentNullException.ThrowIfNull(name);

        lock (_gate)
        {
            return _byName.TryGetValue(SceneStringId.FromName(name), out descriptor);
        }
    }

    /// <summary>Resolves a data component descriptor by CLR type.</summary>
    public bool TryGetDataByType(
        Type componentType,
        [NotNullWhen(true)] out SceneDataComponentDescriptor? descriptor)
    {
        ArgumentNullException.ThrowIfNull(componentType);

        lock (_gate)
        {
            return _dataByType.TryGetValue(componentType, out descriptor);
        }
    }

    /// <summary>Resolves a data component descriptor by CLR type, throwing when unregistered.</summary>
    public SceneDataComponentDescriptor GetDataByType(Type componentType)
    {
        if (TryGetDataByType(componentType, out SceneDataComponentDescriptor? descriptor))
        {
            return descriptor;
        }

        throw new SceneValidationException(
            SceneErrorCodes.ComponentUnregistered,
            $"Data component type {componentType.Name} has no registration.");
    }

    /// <summary>Resolves a behaviour descriptor by CLR type.</summary>
    public bool TryGetBehaviourByType(
        Type componentType,
        [NotNullWhen(true)] out SceneBehaviourDescriptor? descriptor)
    {
        ArgumentNullException.ThrowIfNull(componentType);

        lock (_gate)
        {
            return _behaviourByType.TryGetValue(componentType, out descriptor);
        }
    }

    /// <summary>Resolves a behaviour descriptor by CLR type, throwing when unregistered.</summary>
    public SceneBehaviourDescriptor GetBehaviourByType(Type componentType)
    {
        if (TryGetBehaviourByType(componentType, out SceneBehaviourDescriptor? descriptor))
        {
            return descriptor;
        }

        throw new SceneValidationException(
            SceneErrorCodes.ComponentUnregistered,
            $"Behaviour type {componentType.Name} has no registration.");
    }

    /// <summary>Resolves an interned descriptor name back to its original string.</summary>
    public bool TryResolveName(SceneStringId name, [NotNullWhen(true)] out string? resolved) =>
        Names.TryResolve(name, out resolved);

    /// <summary>Returns registered data components in registration order.</summary>
    public ReadOnlySpan<SceneDataComponentDescriptor> DataComponents =>
        System.Runtime.InteropServices.CollectionsMarshal.AsSpan(_dataOrder);

    /// <summary>Returns registered behaviours in registration order.</summary>
    public ReadOnlySpan<SceneBehaviourDescriptor> BehaviourComponents =>
        System.Runtime.InteropServices.CollectionsMarshal.AsSpan(_behaviourOrder);

    private void ThrowIfSealed()
    {
        if (_sealed)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ConfigurationInvalid,
                "The component registry is sealed and no longer accepts registrations.");
        }
    }

    private static void ValidateTraits(in SceneComponentTraits traits, ReadOnlySpan<char> name)
    {
        if ((traits & (SceneComponentTraits.Singleton | SceneComponentTraits.MultiInstance)) ==
            (SceneComponentTraits.Singleton | SceneComponentTraits.MultiInstance))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Component '{name}' cannot be both Singleton and MultiInstance.");
        }
    }

    private static void ValidateDependencies(ReadOnlySpan<SceneStringId> dependencies)
    {
        for (int i = 0; i < dependencies.Length; i++)
        {
            if (!dependencies[i].IsValid)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ValidationInvalid,
                    "Component dependencies must be valid interned names.");
            }
        }
    }
}
