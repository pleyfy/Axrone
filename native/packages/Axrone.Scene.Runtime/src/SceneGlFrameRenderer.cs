namespace Axrone.Scene.Runtime;

using Axrone.Scene;

/// <summary>
/// OpenGL execution layer over a <see cref="SceneRuntime"/>. Uploads the asset
/// catalog once (or after a reload) and submits one draw pass per planned
/// render pass. All methods are render-thread affine.
/// </summary>
public sealed class SceneGlFrameRenderer : IDisposable, ISceneGlShadowSource
{
    private const int InitialShadowCasterCapacity = 256;

    private readonly GLContext _context;
    private readonly SceneRuntime _runtime;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneRenderItemCollector _shadowCollector = new();
    private readonly SceneLodItemCollector _lodShadowCollector = new();
    private readonly SceneLodEvaluator _lodShadowEvaluator = new();
    private readonly SceneSkinnedMeshItemCollector _skinnedShadowCollector = new();
    private readonly ISceneBonePaletteSource? _bonePalettes;
    private SceneSkinnedMeshRenderItem[] _skinnedShadowCasters =
        new SceneSkinnedMeshRenderItem[InitialShadowCasterCapacity];
    private int _skinnedShadowCasterCount;
    private readonly bool _hasLodGroups;
    private readonly SceneGlRenderOrchestrator _orchestrator;
    private SceneGlShadowAtlas? _shadowAtlas;
    private SceneGlShadowRenderer? _shadow;
    private SceneRenderItem[] _shadowCasters = new SceneRenderItem[InitialShadowCasterCapacity];
    private int _shadowCasterCount;
    private bool _shadowCreationAttempted;
    private bool _disposed;

    /// <summary>Creates a GL frame renderer for a runtime and context.</summary>
    public SceneGlFrameRenderer(GLContext context, SceneRuntime runtime)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(runtime);

        _context = context;
        _runtime = runtime;
        _hasLodGroups = runtime.World.Registry.TryGetDataByType(typeof(SceneLodGroup), out _);
        _bonePalettes = runtime.HasSkinnedMeshes ? runtime.BonePalettes : null;
        _assets = new SceneGlAssetCache(context, runtime.Assets);
        _orchestrator = new SceneGlRenderOrchestrator(
            context,
            _assets,
            runtime.World,
            runtime.HasParticles ? runtime.Particles : null,
            bonePalettes: runtime.HasSkinnedMeshes ? runtime.BonePalettes : null,
            morphWeights: runtime.MorphWeights,
            shadow: this);
    }

    /// <inheritdoc/>
    public bool IsAvailable => _shadow?.IsAvailable == true;

    /// <inheritdoc/>
    public bool TryBind(GLContext context, SceneGlShader shader) =>
        _shadow is not null && _shadow.TryBind(context, shader);

    /// <inheritdoc/>
    public void BindFogOnly(SceneGlShader shader) => _shadow?.BindFogOnly(shader);

    /// <summary>GPU-side asset cache.</summary>
    public SceneGlAssetCache GpuAssets => _assets;

    /// <summary>Skinning diagnostics of the last rendered frame, when skinning is active.</summary>
    public SceneSkinningDiagnostics SkinningDiagnostics => _orchestrator.SkinningDiagnostics;

    /// <summary>Skinned draw calls issued by the last rendered frame.</summary>
    public int SkinnedDrawCalls => _orchestrator.SkinnedDrawCalls;

    /// <summary>Last skinned batch failure of the last rendered frame.</summary>
    public SceneSkinningFailureReason SkinningFailure => _orchestrator.SkinningFailure;

    /// <summary>Uploads every registered asset; call after loading a snapshot.</summary>
    public SceneGlUploadStats UploadAssets()
    {
        ThrowIfDisposed();
        return _assets.UploadAll();
    }

    /// <summary>Synchronizes streamed or chunked meshes without re-uploading unchanged geometry.</summary>
    /// <returns>Upload counters for the incremental mesh pass.</returns>
    public SceneGlUploadStats SyncAssets()
    {
        ThrowIfDisposed();
        return _assets.SyncMeshes();
    }

    /// <summary>Plans and renders one frame.</summary>
    /// <param name="frameIndex">Frame index used by the render-state accumulator.</param>
    /// <param name="elapsedSeconds">Elapsed time for time-driven feature state.</param>
    /// <param name="cameraOverride">
    /// Explicit camera actor for preview rendering; the primary camera is used
    /// when this is <see cref="SceneActor.Null"/>.
    /// </param>
    public SceneRenderStats Render(int frameIndex, float elapsedSeconds = 0.0f, SceneActor cameraOverride = default)
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();

        SceneFramePipeline frame = _runtime.Frame;
        frame.TimeSeconds = elapsedSeconds;
        if (!frame.Plan(frameIndex, cameraOverride))
        {
            return frame.Complete(0);
        }

        SceneCameraFrame camera = frame.Camera!;
        RenderShadowPass(frame, camera);
        return _orchestrator.RenderFrame(
            _runtime.World,
            camera,
            frame,
            frame.Passes.Passes,
            frame.FrameState,
            elapsedSeconds);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        DisposeShadowResources();
        _orchestrator.Dispose();
        _assets.Dispose();
        _disposed = true;
    }

    /// <summary>
    /// Rasterizes the directional depth atlas before any colour pass samples
    /// it. Skipped entirely when shadows are disabled, so no atlas memory is
    /// reserved for scenes that never ask for shadows.
    /// </summary>
    private void RenderShadowPass(SceneFramePipeline frame, SceneCameraFrame camera)
    {
        ShadowSettings settings = frame.ShadowSettings;

        // The binder gates sampling on the cascade frame, not on Settings, so
        // every skip path has to clear it: otherwise switching a scene to
        // "No Shadows" at runtime leaves the last shadow map sampled forever.
        if (!settings.Enabled ||
            (frame.Lighting?.Stats.SelectedDirectionalCount ?? 0) <= 0)
        {
            _shadow?.Frame.Reset();
            return;
        }

        EnsureShadowRenderer(settings);
        if (_shadow is null)
        {
            return;
        }

        _shadow.Settings = settings;
        int casterCount = GatherShadowCasters(camera);
        if (casterCount == 0 && _skinnedShadowCasterCount == 0)
        {
            _shadow.Frame.Reset();
            return;
        }

        _ = _shadow.Render(
            _runtime.World,
            camera,
            frame.Lighting,
            _shadowCasters.AsSpan(0, casterCount),
            _skinnedShadowCasters.AsSpan(0, _skinnedShadowCasterCount),
            _bonePalettes);
    }

    /// <summary>
    /// Creates the atlas and depth renderer on first use, and re-creates them
    /// when the requested atlas size changes. A context that cannot host the
    /// reserved texture unit, or whose depth framebuffer is incomplete, leaves
    /// the renderer null so the frame renders unshadowed instead of throwing.
    /// </summary>
    private void EnsureShadowRenderer(in ShadowSettings settings)
    {
        if (_shadow is not null)
        {
            if (_shadowAtlas!.Edge == settings.AtlasSize)
            {
                return;
            }

            DisposeShadowResources();
        }
        else if (_shadowCreationAttempted)
        {
            return;
        }

        _shadowCreationAttempted = true;
        if (!SceneGlShadowBinder.SupportsTextureUnit(_context))
        {
            return;
        }

        try
        {
            SceneGlShadowAtlas atlas = new(_context, settings.AtlasSize);
            _shadowAtlas = atlas;
            _shadow = new SceneGlShadowRenderer(_context, _assets, atlas, settings: settings);
        }
        catch (Exception ex) when (ex is SceneConfigurationException or Axrone.Render.Core.RenderException)
        {
            // Oversized atlas, missing texture unit, incomplete framebuffer or
            // a GPU that refuses the Depth32f allocation all degrade to an
            // unshadowed frame rather than failing Render.
            _shadow?.Dispose();
            _shadow = null;
            _shadowAtlas?.Dispose();
            _shadowAtlas = null;
        }
    }

    /// <summary>
    /// Copies opaque casters out of private collectors. The pipeline's own
    /// CollectMeshes/CollectLodItems are deliberately avoided: they accumulate
    /// queue and cull counters into the frame state, and the orchestrator
    /// collects again afterwards.
    /// </summary>
    private int GatherShadowCasters(SceneCameraFrame camera)
    {
        _shadowCasterCount = 0;
        _skinnedShadowCasterCount = 0;
        SceneWorld world = _runtime.World;
        ReadOnlySpan<SceneRenderPassDefinition> passes = _runtime.Frame.Passes.Passes;
        for (int pass = 0; pass < passes.Length; pass++)
        {
            SceneAssetId<RenderPassAssetTag> passId = passes[pass].Id;

            _ = _shadowCollector.Collect(world, camera, passId, _runtime.Assets);
            AppendShadowCasters(_shadowCollector.Items);

            if (_hasLodGroups && world.HasTransform3D)
            {
                // LOD groups resolve their mesh through SceneLodGroup, so the
                // plain collector never sees them. Without this second pass LOD
                // geometry would receive shadows but never cast them.
                _lodShadowEvaluator.Evaluate(world, camera);
                _ = _lodShadowCollector.Collect(world, camera, passId, _lodShadowEvaluator);
                AppendShadowCasters(_lodShadowCollector.MeshItems);
            }

            if (_bonePalettes is not null && world.HasTransform3D)
            {
                _ = _skinnedShadowCollector.Collect(world, camera, passId, _runtime.Assets);
                AppendSkinnedShadowCasters(_skinnedShadowCollector.Items);
            }
        }

        return _shadowCasterCount;
    }

    private void AppendSkinnedShadowCasters(ReadOnlySpan<SceneSkinnedMeshRenderItem> items)
    {
        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneSkinnedMeshRenderItem item = ref items[i];
            if (item.Transparent)
            {
                continue;
            }

            if (_skinnedShadowCasterCount == _skinnedShadowCasters.Length)
            {
                Array.Resize(ref _skinnedShadowCasters, _skinnedShadowCasters.Length * 2);
            }

            _skinnedShadowCasters[_skinnedShadowCasterCount++] = item;
        }
    }

    private void AppendShadowCasters(ReadOnlySpan<SceneRenderItem> items)
    {
        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneRenderItem item = ref items[i];
            if (item.Transparent)
            {
                continue;
            }

            if (_shadowCasterCount == _shadowCasters.Length)
            {
                Array.Resize(ref _shadowCasters, _shadowCasters.Length * 2);
            }

            _shadowCasters[_shadowCasterCount++] = item;
        }
    }

    private void DisposeShadowResources()
    {
        _shadow?.Dispose();
        _shadow = null;
        _shadowAtlas?.Dispose();
        _shadowAtlas = null;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlFrameRenderer));
        }
    }
}
