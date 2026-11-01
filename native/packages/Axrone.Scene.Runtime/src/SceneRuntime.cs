namespace Axrone.Scene.Runtime;

/// <summary>
/// Composition root for a scene: owns the world, the asset catalog, component
/// codecs, the prefab registry and resolver, snapshot loading and the frame
/// planner. Rendering backends attach on top of this root.
/// </summary>
public sealed class SceneRuntime : IDisposable
{
    private bool _disposed;

    /// <summary>Creates a runtime with an optional shared asset catalog.</summary>
    public SceneRuntime(SceneRuntimeOptions options, SceneAssetRegistry? assets = null)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (options.ViewportWidth <= 0 || options.ViewportHeight <= 0)
        {
            throw new SceneConfigurationException(
                $"Viewport dimensions must be positive; received {options.ViewportWidth}x{options.ViewportHeight}.");
        }

        if (options.MaxLocalLights < 0)
        {
            throw new SceneConfigurationException(
                $"Local-light capacity must not be negative; received {options.MaxLocalLights}.");
        }

        RuntimeProfile = SceneRuntimeProfiles.Resolve(options.RuntimeProfile, options.Profile);
        SceneProfile profile = RuntimeProfile.Profile;
        Assets = assets ?? new SceneAssetRegistry();
        World = options.WorldOptions is { } worldOptions
            ? profile.CreateWorld(worldOptions)
            : profile.CreateWorld();

        Codecs = new SceneCodecRegistry(World.Registry);
        ScenePrefabCodecs.RegisterCore(Codecs, World.Registry);
        SceneRenderingCodecs.Register(Codecs, World.Registry, Assets);
        SceneRuntimeCodecs.Register(Codecs, World.Registry);

        Prefabs = new ScenePrefabRegistry();
        PrefabResolver = new ScenePrefabResolver(Prefabs);
        Snapshots = new SceneSnapshotLoader(World, Assets, Codecs, PrefabResolver);
        Profiler = new SceneRuntimeProfiler(options.Profiler);
        Physics = RuntimeProfile.PhysicsBridges.Bridge3D ? new ScenePhysicsBridge3D(World) : null;
        Physics2D = RuntimeProfile.PhysicsBridges.Bridge2D ? new ScenePhysicsBridge2D(World) : null;
        Particles = new SceneParticleBridge3D(World);
        HasParticles = World.Registry.TryGetDataByType(typeof(SceneParticleSystem), out _);
        HasAnimators = World.Registry.TryGetDataByType(typeof(SceneAnimator), out _);
        Animators = HasAnimators ? new SceneAnimatorBridge(World) : null;
        HasPathAgents = World.Registry.TryGetDataByType(typeof(ScenePathAgent), out _);
        PathAgents = HasPathAgents ? new ScenePathAgentBridge(World) : null;

        Frame = new SceneFramePipeline(
            World,
            Assets,
            options.ViewportWidth,
            options.ViewportHeight,
            options.AmbientLight,
            options.SkyLight,
            options.GroundLight,
            options.MaxLocalLights);
    }

    /// <summary>Resolved runtime profile (built-in or custom).</summary>
    public SceneRuntimeProfile RuntimeProfile { get; }

    /// <summary>Active scene composition.</summary>
    public SceneProfile Profile => RuntimeProfile.Profile;

    /// <summary>Physics bridges this runtime's profile participates in.</summary>
    public ScenePhysicsBridgeSelection PhysicsBridges => RuntimeProfile.PhysicsBridges;

    /// <summary>Scene world that owns actors, components and behaviours.</summary>
    public SceneWorld World { get; }

    /// <summary>Asset catalog shared by rendering and snapshot loading.</summary>
    public SceneAssetRegistry Assets { get; }

    /// <summary>Component codecs used by prefab snapshots.</summary>
    public SceneCodecRegistry Codecs { get; }

    /// <summary>Prefab definitions addressable by id.</summary>
    public ScenePrefabRegistry Prefabs { get; }

    /// <summary>Resolves variants and nested instances registered in <see cref="Prefabs"/>.</summary>
    public ScenePrefabResolver PrefabResolver { get; }

    /// <summary>Transactional snapshot loader bound to this world and catalog.</summary>
    public SceneSnapshotLoader Snapshots { get; }

    /// <summary>Backend-agnostic frame planner.</summary>
    public SceneFramePipeline Frame { get; }

    /// <summary>Frame profiler; recording is opt-in through the runtime options.</summary>
    public SceneRuntimeProfiler Profiler { get; }

    /// <summary>3D physics bridge; null when the profile does not step 3D physics.</summary>
    public ScenePhysicsBridge3D? Physics { get; }

    /// <summary>2D physics bridge; null when the profile does not step 2D physics.</summary>
    public ScenePhysicsBridge2D? Physics2D { get; }

    /// <summary>Particle bridge; active when the profile registers particle components.</summary>
    public SceneParticleBridge3D Particles { get; }

    /// <summary>Whether the profile registers particle systems.</summary>
    public bool HasParticles { get; }

    /// <summary>Animator bridge; null when the profile does not register animators.</summary>
    public SceneAnimatorBridge? Animators { get; }

    /// <summary>Whether the profile registers animator components.</summary>
    public bool HasAnimators { get; }

    /// <summary>Path agent bridge; null when the profile does not register path agents.</summary>
    public ScenePathAgentBridge? PathAgents { get; }

    /// <summary>Whether the profile registers path agent components.</summary>
    public bool HasPathAgents { get; }

    /// <summary>Viewport width forwarded to the frame planner.</summary>
    public int ViewportWidth
    {
        get => Frame.ViewportWidth;
        set => Frame.ViewportWidth = value;
    }

    /// <summary>Viewport height forwarded to the frame planner.</summary>
    public int ViewportHeight
    {
        get => Frame.ViewportHeight;
        set => Frame.ViewportHeight = value;
    }

    /// <summary>Registers or replaces a prefab definition.</summary>
    public SceneRuntime RegisterPrefab(ScenePrefabDefinition prefab)
    {
        ThrowIfDisposed();
        Prefabs.Register(prefab);
        return this;
    }

    /// <summary>Resolves a registered prefab, applying optional live overrides.</summary>
    public ScenePrefabDefinition ResolvePrefab(
        string prefabId,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides = null)
    {
        ThrowIfDisposed();
        return PrefabResolver.Resolve(prefabId, liveOverrides).Definition;
    }

    /// <summary>Instantiates a prefab into the world, resolving composition first.</summary>
    public ScenePrefabInstantiationResult Instantiate(
        ScenePrefabDefinition prefab,
        ScenePrefabInstantiateOptions? options = null)
    {
        ThrowIfDisposed();

        options ??= new ScenePrefabInstantiateOptions();
        if (options.Resolver is null)
        {
            options = options with { Resolver = PrefabResolver };
        }

        return ScenePrefabInstantiator.Instantiate(World, Codecs, prefab, options);
    }

    /// <summary>Loads a snapshot, then rebuilds the pass plan for the new assets.</summary>
    public ScenePrefabInstantiationResult LoadSnapshot(
        SceneSnapshot snapshot,
        SceneSnapshotLoadOptions? options = null)
    {
        ThrowIfDisposed();

        ScenePrefabInstantiationResult result = Snapshots.Load(snapshot, options);
        Frame.RebuildPasses();
        return result;
    }

    /// <summary>Creates a snapshot from the live world and the current catalog.</summary>
    public SceneSnapshot CaptureSnapshot(string prefabId, ScenePrefabMetadata? metadata = null)
    {
        ThrowIfDisposed();
        return SceneSnapshot.Capture(World, Codecs, Assets, prefabId, metadata);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        Frame.Dispose();
        PathAgents?.Dispose();
        Animators?.Dispose();
        Particles.Dispose();
        Physics2D?.Dispose();
        Physics?.Dispose();
        Profiler.Dispose();
        World.Dispose();
        _disposed = true;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneRuntime));
        }
    }
}
