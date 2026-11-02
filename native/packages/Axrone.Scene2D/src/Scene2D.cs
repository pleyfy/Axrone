namespace Axrone.Scene2D;

/// <summary>
/// Allocation-free 2D scene facade. Owns one <see cref="SceneWorld"/> built
/// from the lean 2D profile and creates cameras, sprites, animated sprites and
/// masks through the manifest-checked payloads of this package.
/// </summary>
/// <remarks>
/// The world is loop-thread confined. Disposing the facade disposes its world;
/// actor creation after disposal throws <see cref="SceneDisposedException"/>.
/// </remarks>
public sealed class Scene2D : IDisposable
{
    private readonly SceneWorld _world;
    private readonly SceneRuntimeProfile _profile;
    private bool _disposed;

    private Scene2D(SceneWorld world, SceneRuntimeProfile profile)
    {
        _world = world;
        _profile = profile;
    }

    /// <summary>Creates a facade with default options.</summary>
    public static Scene2D Create() => Create(new Scene2DCreateOptions());

    /// <summary>Creates a facade with explicit options.</summary>
    /// <exception cref="SceneCapabilityException">
    /// The profile does not expose <c>Transform2D</c>.
    /// </exception>
    public static Scene2D Create(in Scene2DCreateOptions options)
    {
        SceneRuntimeProfile profile = options.RuntimeProfile ?? Scene2DProfiles.LeanTwoDProfile;
        if (!profile.Profile.HasTransform2D)
        {
            throw new SceneCapabilityException(
                "Transform2D",
                "2D scene creation requires a runtime profile that registers Transform2D.");
        }

        SceneWorldOptions worldOptions = options.WorldOptions.InitialCapacity > 0
            ? options.WorldOptions
            : new SceneWorldOptions();
        SceneWorld world = profile.Profile.CreateWorld(worldOptions, options.Diagnostics);
        return new Scene2D(world, profile);
    }

    /// <summary>World owned by the facade.</summary>
    public SceneWorld World => _world;

    /// <summary>Runtime profile backing the world.</summary>
    public SceneRuntimeProfile Profile => _profile;

    /// <summary>Number of live actors.</summary>
    public int ActorCount => _world.ActorCount;

    /// <summary>Allocated actor slot capacity.</summary>
    public int Capacity => _world.Capacity;

    /// <summary>Creates a camera actor with explicit camera settings.</summary>
    public SceneActor CreateCameraActor(
        in SceneActorConfig actorConfig,
        in Scene2DCameraConfig cameraConfig)
    {
        ThrowIfDisposed();
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.Camera);
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.Camera2D);
        cameraConfig.Validate();

        Scene2DCamera camera = cameraConfig.ToComponent();
        Scene2DCamera2D camera2D = cameraConfig.ToDepthComponent();
        SceneActor actor = _world.CreateActor(in actorConfig);
        try
        {
            _world.AddData(actor, in camera);
            _world.AddData(actor, in camera2D);
            return actor;
        }
        catch
        {
            _world.DestroyActor(actor);
            throw;
        }
    }

    /// <summary>Creates a sprite actor with explicit sprite settings.</summary>
    public SceneActor CreateSpriteActor(
        in SceneActorConfig actorConfig,
        in Scene2DSpriteConfig spriteConfig)
    {
        ThrowIfDisposed();
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.SpriteRenderer);
        spriteConfig.Validate();

        Scene2DSpriteRenderer renderer = spriteConfig.ToComponent();
        SceneActor actor = _world.CreateActor(in actorConfig);
        try
        {
            _world.AddData(actor, in renderer);
            return actor;
        }
        catch
        {
            _world.DestroyActor(actor);
            throw;
        }
    }

    /// <summary>Creates a sprite actor with a renderer and animator payload.</summary>
    public SceneActor CreateAnimatedSpriteActor(
        in SceneActorConfig actorConfig,
        in Scene2DSpriteConfig spriteConfig,
        in Scene2DSpriteAnimatorConfig animatorConfig)
    {
        ThrowIfDisposed();
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.SpriteRenderer);
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.SpriteAnimator);
        spriteConfig.Validate();
        animatorConfig.Validate();

        Scene2DSpriteRenderer renderer = spriteConfig.ToComponent();
        Scene2DSpriteAnimator animator = animatorConfig.ToComponent();
        SceneActor actor = _world.CreateActor(in actorConfig);
        try
        {
            _world.AddData(actor, in renderer);
            _world.AddData(actor, in animator);
            return actor;
        }
        catch
        {
            _world.DestroyActor(actor);
            throw;
        }
    }

    /// <summary>Creates a mask actor with explicit mask settings.</summary>
    public SceneActor CreateMaskActor(
        in SceneActorConfig actorConfig,
        in Scene2DSpriteMaskConfig maskConfig)
    {
        ThrowIfDisposed();
        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.SpriteMask);
        maskConfig.Validate();

        Scene2DSpriteMask mask = maskConfig.ToComponent();
        SceneActor actor = _world.CreateActor(in actorConfig);
        try
        {
            _world.AddData(actor, in mask);
            return actor;
        }
        catch
        {
            _world.DestroyActor(actor);
            throw;
        }
    }

    /// <summary>
    /// Creates one sprite actor per spec inside a single structural batch.
    /// Every spec receives the same component set, so the batch stays on one
    /// archetype. Actor handles are written to <paramref name="destination"/>
    /// in input order; no managed allocation occurs once the world has warmed
    /// its actor slots and component columns.
    /// </summary>
    /// <returns>Number of sprite actors created.</returns>
    /// <exception cref="ArgumentException">
    /// The destination span is shorter than the spec span.
    /// </exception>
    /// <exception cref="SceneCapabilityException">
    /// The profile does not register the sprite renderer payload.
    /// </exception>
    /// <exception cref="SceneValidationException">A spec is malformed.</exception>
    public int CreateSprites(
        ReadOnlySpan<Scene2DSpriteSpec> specs,
        Span<SceneActor> destination)
    {
        ThrowIfDisposed();

        if (destination.Length < specs.Length)
        {
            Scene2DThrowHelper.ThrowDestinationTooSmall(destination.Length, specs.Length);
        }

        Scene2DBuiltInManifest.Require(_world, Scene2DBuiltInComponent.SpriteRenderer);
        for (int i = 0; i < specs.Length; i++)
        {
            specs[i].Validate();
        }

        if (specs.Length == 0)
        {
            return 0;
        }

        int created = 0;
        using SceneStructuralScope batch = _world.BeginStructuralBatch();
        try
        {
            for (int i = 0; i < specs.Length; i++)
            {
                ref readonly Scene2DSpriteSpec spec = ref specs[i];
                SceneActorConfig actorConfig = spec.ActorConfig;
                SceneActor actor = _world.CreateActor(in actorConfig);
                destination[i] = actor;
                created = i + 1;

                Scene2DSpriteRenderer renderer = spec.Sprite.ToComponent();
                _world.AddData(actor, in renderer);
                Vec2 position = spec.Position;
                _world.GetTransform2D(actor).SetPosition(in position);
            }

            _world.UpdateTransforms();
        }
        catch
        {
            for (int i = created - 1; i >= 0; i--)
            {
                _world.DestroyActor(destination[i]);
            }

            throw;
        }

        return created;
    }

    /// <summary>Disposes the facade and its world. Safe to call repeatedly.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _world.Dispose();
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            Scene2DThrowHelper.ThrowDisposed();
        }
    }
}

internal static class Scene2DThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDisposed() => throw new SceneDisposedException(nameof(Scene2D));

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDestinationTooSmall(int destinationLength, int required) =>
        throw new ArgumentException(
            $"Destination span holds {destinationLength} actors but {required} sprites were requested.",
            nameof(destinationLength));
}
