namespace Axrone.Scene2D;

/// <summary>
/// Allocation-free 2D scene facade. Owns one <see cref="SceneWorld"/> and
/// creates cameras, sprites, animated sprites and masks either as lean staging
/// payloads or as real renderer components, selected once at creation from the
/// runtime profile.
/// </summary>
/// <remarks>
/// The world is loop-thread confined. Disposing the facade disposes its world;
/// entity creation after disposal throws <see cref="SceneDisposedException"/>.
/// Renderer profiles convert every payload through
/// <see cref="Scene2DRendererBridge"/>; lean profiles keep staging payloads.
/// </remarks>
public sealed class Scene2D : IDisposable
{
    private readonly SceneWorld _world;
    private readonly SceneRuntimeProfile _profile;
    private readonly Scene2DComponentMode _mode;
    private bool _disposed;

    private Scene2D(SceneWorld world, SceneRuntimeProfile profile, Scene2DComponentMode mode)
    {
        _world = world;
        _profile = profile;
        _mode = mode;
    }

    /// <summary>Creates a facade with default options.</summary>
    public static Scene2D Create() => Create(new Scene2DCreateOptions());

    /// <summary>Creates a facade with explicit options.</summary>
    /// <exception cref="SceneCapabilityException">
    /// The profile lacks <c>Transform2D</c> or a complete payload family.
    /// </exception>
    /// <exception cref="SceneConfigurationException">
    /// The profile mixes staging and renderer payload owners.
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

        Scene2DComponentMode mode = Scene2DRendererBridge.ResolveMode(profile.Profile);
        SceneWorldOptions worldOptions = options.WorldOptions.InitialCapacity > 0
            ? options.WorldOptions
            : new SceneWorldOptions();
        SceneWorld world = profile.Profile.CreateWorld(worldOptions, options.Diagnostics);
        return new Scene2D(world, profile, mode);
    }

    /// <summary>World owned by the facade.</summary>
    public SceneWorld World => _world;

    /// <summary>Runtime profile backing the world.</summary>
    public SceneRuntimeProfile Profile => _profile;

    /// <summary>Payload ownership mode resolved at creation.</summary>
    public Scene2DComponentMode Mode => _mode;

    /// <summary>Number of live entities.</summary>
    public int EntityCount => _world.EntityCount;

    /// <summary>Allocated entity slot capacity.</summary>
    public int Capacity => _world.Capacity;

    /// <summary>Creates a camera entity with explicit camera settings.</summary>
    public SceneEntity CreateCameraEntity(
        in SceneEntityConfig entityConfig,
        in Scene2DCameraConfig cameraConfig)
    {
        ThrowIfDisposed();
        cameraConfig.Validate();

        Scene2DCamera camera = cameraConfig.ToComponent();
        Scene2DCamera2D camera2D = cameraConfig.ToDepthComponent();
        SceneEntity entity = _world.CreateEntity(in entityConfig);
        try
        {
            if (_mode == Scene2DComponentMode.Renderer)
            {
                Scene2DRendererBridge.AttachCamera(_world, entity, in camera, in camera2D);
            }
            else
            {
                _world.AddData(entity, in camera);
                _world.AddData(entity, in camera2D);
            }

            return entity;
        }
        catch
        {
            _world.DestroyEntity(entity);
            throw;
        }
    }

    /// <summary>Creates a sprite entity with explicit sprite settings.</summary>
    public SceneEntity CreateSpriteEntity(
        in SceneEntityConfig entityConfig,
        in Scene2DSpriteConfig spriteConfig)
    {
        ThrowIfDisposed();
        spriteConfig.Validate();

        Scene2DSpriteRenderer renderer = spriteConfig.ToComponent();
        SceneEntity entity = _world.CreateEntity(in entityConfig);
        try
        {
            if (_mode == Scene2DComponentMode.Renderer)
            {
                Scene2DRendererBridge.AttachSprite(_world, entity, in renderer);
            }
            else
            {
                _world.AddData(entity, in renderer);
            }

            return entity;
        }
        catch
        {
            _world.DestroyEntity(entity);
            throw;
        }
    }

    /// <summary>Creates a sprite entity with a renderer and animator payload.</summary>
    public SceneEntity CreateAnimatedSpriteEntity(
        in SceneEntityConfig entityConfig,
        in Scene2DSpriteConfig spriteConfig,
        in Scene2DSpriteAnimatorConfig animatorConfig)
    {
        ThrowIfDisposed();
        spriteConfig.Validate();
        animatorConfig.Validate();
        if (_mode == Scene2DComponentMode.LeanStaging && animatorConfig.Clip is not null)
        {
            throw new SceneCapabilityException(
                "SpriteAnimatorClip",
                "the lean profile stages animation state and cannot attach managed clips; use SceneRuntimeProfiles.TwoD.");
        }

        Scene2DSpriteRenderer renderer = spriteConfig.ToComponent();
        Scene2DSpriteAnimator animator = animatorConfig.ToComponent();
        SceneEntity entity = _world.CreateEntity(in entityConfig);
        try
        {
            if (_mode == Scene2DComponentMode.Renderer)
            {
                Scene2DRendererBridge.AttachSprite(_world, entity, in renderer);
                Scene2DRendererBridge.AttachAnimator(_world, entity, in animator, animatorConfig.Clip);
            }
            else
            {
                _world.AddData(entity, in renderer);
                _world.AddData(entity, in animator);
            }

            return entity;
        }
        catch
        {
            _world.DestroyEntity(entity);
            throw;
        }
    }

    /// <summary>Creates a mask entity with explicit mask settings.</summary>
    public SceneEntity CreateMaskEntity(
        in SceneEntityConfig entityConfig,
        in Scene2DSpriteMaskConfig maskConfig)
    {
        ThrowIfDisposed();
        maskConfig.Validate();

        Scene2DSpriteMask mask = maskConfig.ToComponent();
        SceneEntity entity = _world.CreateEntity(in entityConfig);
        try
        {
            if (_mode == Scene2DComponentMode.Renderer)
            {
                Scene2DRendererBridge.AttachMask(_world, entity, in mask);
            }
            else
            {
                _world.AddData(entity, in mask);
            }

            return entity;
        }
        catch
        {
            _world.DestroyEntity(entity);
            throw;
        }
    }

    /// <summary>
    /// Creates one sprite entity per spec inside a single structural batch.
    /// Every spec receives the same component set, so the batch stays on one
    /// archetype. Entity handles are written to <paramref name="destination"/>
    /// in input order; no managed allocation occurs once the world has warmed
    /// its entity slots and component columns.
    /// </summary>
    /// <returns>Number of sprite entities created.</returns>
    /// <exception cref="ArgumentException">
    /// The destination span is shorter than the spec span.
    /// </exception>
    /// <exception cref="SceneValidationException">A spec is malformed.</exception>
    public int CreateSprites(
        ReadOnlySpan<Scene2DSpriteSpec> specs,
        Span<SceneEntity> destination)
    {
        ThrowIfDisposed();

        if (destination.Length < specs.Length)
        {
            Scene2DThrowHelper.ThrowDestinationTooSmall(destination.Length, specs.Length);
        }

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
                SceneEntityConfig entityConfig = spec.EntityConfig;
                SceneEntity entity = _world.CreateEntity(in entityConfig);
                destination[i] = entity;
                created = i + 1;

                Scene2DSpriteRenderer renderer = spec.Sprite.ToComponent();
                if (_mode == Scene2DComponentMode.Renderer)
                {
                    Scene2DRendererBridge.AttachSprite(_world, entity, in renderer);
                }
                else
                {
                    _world.AddData(entity, in renderer);
                }

                Vec2 position = spec.Position;
                _world.GetTransform2D(entity).SetPosition(in position);
            }

            _world.UpdateTransforms();
        }
        catch
        {
            for (int i = created - 1; i >= 0; i--)
            {
                _world.DestroyEntity(destination[i]);
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
            $"Destination span holds {destinationLength} entities but {required} sprites were requested.",
            nameof(destinationLength));
}
