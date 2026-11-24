namespace Axrone.Scene.Snapshot;

/// <summary>Snapshot loading options.</summary>
public sealed record SceneSnapshotLoadOptions : ScenePrefabInstantiateOptions
{
    /// <summary>Whether existing entities and render passes are cleared first.</summary>
    public bool ClearExisting { get; init; } = true;
}

/// <summary>
/// Loads snapshots transactionally: assets are registered in dependency order
/// (shaders, meshes, samplers, textures, passes, materials) and the prefab is
/// instantiated last. Any failure rolls the partial registrations back so the
/// catalog never observes a half-loaded scene.
/// </summary>
public sealed class SceneSnapshotLoader
{
    private static readonly Vec4 DefaultClearColor = new(0.08f, 0.09f, 0.11f, 1.0f);

    private readonly SceneWorld _world;
    private readonly SceneAssetRegistry _assets;
    private readonly SceneCodecRegistry _codecs;
    private readonly ScenePrefabResolver? _prefabResolver;

    /// <summary>Creates a loader bound to a world, asset catalog and codec catalog.</summary>
    public SceneSnapshotLoader(
        SceneWorld world,
        SceneAssetRegistry assets,
        SceneCodecRegistry codecs,
        ScenePrefabResolver? prefabResolver = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(codecs);

        _world = world;
        _assets = assets;
        _codecs = codecs;
        _prefabResolver = prefabResolver;
    }

    /// <summary>Loads a snapshot into the bound world.</summary>
    /// <exception cref="SceneSnapshotException">
    /// The snapshot is incompatible or loading failed; registered assets are rolled back.
    /// </exception>
    public ScenePrefabInstantiationResult Load(
        SceneSnapshot snapshot,
        SceneSnapshotLoadOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        options ??= new SceneSnapshotLoadOptions();

        var registrations = new List<AssetRegistration>();
        SceneRenderPassDefinition[]? clearedPasses = null;

        try
        {
            if (options.ClearExisting)
            {
                _world.DestroyAllEntities();
                clearedPasses = _assets.RenderPasses.Clear();
            }

            for (int i = 0; i < snapshot.Shaders.Count; i++)
            {
                Register(_assets.Shaders, snapshot.Shaders[i], registrations);
            }

            for (int i = 0; i < snapshot.Meshes.Count; i++)
            {
                Register(_assets.Meshes, snapshot.Meshes[i], registrations);
            }

            for (int i = 0; i < snapshot.Samplers.Count; i++)
            {
                Register(_assets.Samplers, snapshot.Samplers[i], registrations);
            }

            for (int i = 0; i < snapshot.Textures.Count; i++)
            {
                Register(_assets.Textures, snapshot.Textures[i], registrations);
            }

            if (snapshot.RenderPasses.Count == 0)
            {
                Register(_assets.RenderPasses, CreateDefaultPass(), registrations);
            }
            else
            {
                for (int i = 0; i < snapshot.RenderPasses.Count; i++)
                {
                    Register(_assets.RenderPasses, snapshot.RenderPasses[i], registrations);
                }
            }

            for (int i = 0; i < snapshot.Materials.Count; i++)
            {
                Register(_assets.Materials, snapshot.Materials[i], registrations);
            }

            return ScenePrefabInstantiator.Instantiate(
                _world,
                _codecs,
                snapshot.Prefab,
                new ScenePrefabInstantiateOptions
                {
                    NamePrefix = options.NamePrefix,
                    Resolver = options.Resolver ?? _prefabResolver,
                    LiveOverrides = options.LiveOverrides
                });
        }
        catch (SceneSnapshotException)
        {
            Rollback(registrations, clearedPasses);
            throw;
        }
        catch (Exception exception)
        {
            Rollback(registrations, clearedPasses);
            throw new SceneSnapshotException(
                SceneSnapshotErrorCodes.LoadFailed,
                "Snapshot loading failed; partial asset registrations were rolled back.",
                exception);
        }
    }

    private SceneRenderPassDefinition CreateDefaultPass() =>
        new(
            _assets.CreateId<RenderPassAssetTag>("main"),
            order: 0,
            enabled: true,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: DefaultClearColor,
            clearDepth: 1.0f);

    private static void Register<TTag, TDefinition>(
        SceneDefinitionRegistry<TTag, TDefinition> registry,
        TDefinition definition,
        List<AssetRegistration> registrations)
        where TTag : struct
        where TDefinition : class, ISceneAssetDefinition<TTag>
    {
        SceneRegistrationResult<TDefinition> result = registry.Register(definition);
        registrations.Add(new AssetRegistration<TTag, TDefinition>(
            registry,
            definition.Id,
            result.Previous));
    }

    private void Rollback(List<AssetRegistration> registrations, SceneRenderPassDefinition[]? clearedPasses)
    {
        for (int i = registrations.Count - 1; i >= 0; i--)
        {
            registrations[i].Rollback();
        }

        if (clearedPasses is not null)
        {
            for (int i = 0; i < clearedPasses.Length; i++)
            {
                _assets.RenderPasses.Register(clearedPasses[i]);
            }
        }
    }

    private abstract class AssetRegistration
    {
        public abstract void Rollback();
    }

    private sealed class AssetRegistration<TTag, TDefinition> : AssetRegistration
        where TTag : struct
        where TDefinition : class, ISceneAssetDefinition<TTag>
    {
        private readonly SceneDefinitionRegistry<TTag, TDefinition> _registry;
        private readonly SceneAssetId<TTag> _id;
        private readonly TDefinition? _previous;

        public AssetRegistration(
            SceneDefinitionRegistry<TTag, TDefinition> registry,
            SceneAssetId<TTag> id,
            TDefinition? previous)
        {
            _registry = registry;
            _id = id;
            _previous = previous;
        }

        public override void Rollback()
        {
            _registry.Remove(_id, out _);
            if (_previous is not null)
            {
                _registry.Register(_previous);
            }
        }
    }
}
