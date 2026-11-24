namespace Axrone.Scene;

/// <summary>
/// Fluent composition of a scene profile. Registration is explicit and
/// order-independent; <see cref="Build"/> freezes the profile for runtime use.
/// </summary>
public sealed class SceneProfileBuilder
{
    private readonly SceneComponentRegistry _registry;
    private bool _built;

    /// <summary>Creates a builder for a profile identity.</summary>
    public SceneProfileBuilder(SceneProfileId id, SceneNameTable? names = null)
    {
        if (!id.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ProfileInvalid,
                "Scene profiles require a non-empty identity.");
        }

        Id = id;
        _registry = new SceneComponentRegistry(names);
    }

    /// <summary>Profile identity.</summary>
    public SceneProfileId Id { get; }

    /// <summary>Registry under construction.</summary>
    public SceneComponentRegistry Registry => _registry;

    /// <summary>Registers the 3D transform column and presence bit.</summary>
    public SceneProfileBuilder AddTransform3D()
    {
        ThrowIfBuilt();
        _registry.RegisterData<SceneTransform3D>(
            "Transform3D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);
        return this;
    }

    /// <summary>Registers the 2D transform column and presence bit.</summary>
    public SceneProfileBuilder AddTransform2D()
    {
        ThrowIfBuilt();
        _registry.RegisterData<SceneTransform2D>(
            "Transform2D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);
        return this;
    }

    /// <summary>Registers a custom unmanaged data component.</summary>
    public SceneProfileBuilder AddData<T>(
        string name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfBuilt();
        _registry.RegisterData<T>(name, traits, priority, dependencies);
        return this;
    }

    /// <summary>Registers a custom managed behaviour with a default constructor.</summary>
    public SceneProfileBuilder AddBehaviour<T>(
        string name,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour, new()
    {
        ThrowIfBuilt();
        _registry.RegisterBehaviour<T>(name, traits, priority, dependencies);
        return this;
    }

    /// <summary>Registers a custom managed behaviour with an explicit factory.</summary>
    public SceneProfileBuilder AddBehaviour<T>(
        string name,
        Func<T> factory,
        SceneComponentTraits traits = SceneComponentTraits.None,
        int priority = 0,
        ReadOnlySpan<SceneStringId> dependencies = default)
        where T : class, ISceneBehaviour
    {
        ThrowIfBuilt();
        _registry.RegisterBehaviour(name, factory, traits, priority, dependencies);
        return this;
    }

    /// <summary>Freezes the profile and returns it.</summary>
    public SceneProfile Build()
    {
        ThrowIfBuilt();
        _built = true;
        return new SceneProfile(Id, _registry);
    }

    private void ThrowIfBuilt()
    {
        if (_built)
        {
            throw new SceneLifecycleException(
                $"Profile '{Id}' has been built and no longer accepts registrations.");
        }
    }
}

/// <summary>Built-in profile factories that only include implemented components.</summary>
public static class SceneProfiles
{
    /// <summary>Creates the core 3D profile.</summary>
    public static SceneProfile CreateCore3D(SceneNameTable? names = null) =>
        new SceneProfileBuilder(SceneProfileIds.Core3D, names)
            .AddTransform3D()
            .Build();

    /// <summary>Creates the core 2D profile.</summary>
    public static SceneProfile CreateCore2D(SceneNameTable? names = null) =>
        new SceneProfileBuilder(SceneProfileIds.Core2D, names)
            .AddTransform2D()
            .Build();
}
