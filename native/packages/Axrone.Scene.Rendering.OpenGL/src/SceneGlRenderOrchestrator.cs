namespace Axrone.Scene.Rendering.OpenGL;

using Axrone.Render.Core;
using Axrone.Render.OpenGL.Pipeline;
using Axrone.Scene.Assets;

/// <summary>
/// Executes a planned frame across every active render path. For each pass it
/// submits 3D meshes through the draw executor, 2D sprites through the sprite
/// batch and particles through the point-sprite batch, so mixed 2D/3D scenes
/// share one deterministic pass order.
/// </summary>
public sealed class SceneGlRenderOrchestrator : IDisposable
{
    private readonly SceneGlDrawExecutor _meshExecutor;
    private readonly SceneGlSpriteBatchRenderer _spriteRenderer;
    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly ISceneParticleSource? _particles;
    private readonly SceneGlParticleBatchRenderer? _particleRenderer;
    private readonly SceneInstanceRegistry? _instances;
    private readonly SceneGlInstancedMeshRenderer? _instancedRenderer;
    private readonly SceneGlSkinnedMeshRenderer? _skinnedRenderer;
    private readonly SceneGlReflectionProbeAtlas? _probeAtlas;
    private readonly ISceneReflectionProbeSource? _reflectionProbe;
    private readonly ISceneGlShadowSource? _shadow;
    private readonly bool _hasSpriteComponent;
    private readonly bool _hasInstancedComponent;
    private readonly SceneGlRenderPipeline _pipeline;
    private readonly SceneGlPostProcessChain? _postProcess;
    private readonly SceneRenderPassDefinition _postProcessPass = new(
        new SceneAssetId<RenderPassAssetTag>(SceneStringId.FromName("scene/post-process")),
        int.MaxValue);
    private ScenePassWork _work;
    private SceneGlPrimitiveBatchRenderer? _primitiveRenderer;
    private bool _disposed;

    /// <summary>Frame arguments a dispatched pass executes against.</summary>
    /// <param name="World">World whose entities are submitted.</param>
    /// <param name="Camera">Active camera frame.</param>
    /// <param name="Items">Planned frame items.</param>
    /// <param name="FrameState">Frame counter accumulator.</param>
    /// <param name="ElapsedSeconds">Elapsed time for the frame.</param>
    private readonly record struct ScenePassWork(
        SceneWorld World,
        SceneCameraFrame Camera,
        ISceneFrameItemSource Items,
        SceneRenderFrameState FrameState,
        float ElapsedSeconds);

    /// <summary>Creates an orchestrator over an uploaded GPU asset cache.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="assets">Uploaded GPU asset cache.</param>
    /// <param name="world">World whose entities are submitted.</param>
    /// <param name="particles">
    /// Optional particle source; when supplied, particle point draws are
    /// interleaved into every blending pass.
    /// </param>
    /// <param name="instances">
    /// Optional instance registry; when supplied and the frame source implements
    /// <see cref="ISceneInstancedFrameItemSource"/>, instanced mesh batches are
    /// drawn after sprites in every pass.
    /// </param>
    /// <param name="bonePalettes">
    /// Optional palette source; when supplied and the frame source implements
    /// <see cref="ISceneSkinnedMeshFrameItemSource"/>, skinned batches are drawn
    /// after LOD meshes.
    /// </param>
    /// <param name="morphWeights">
    /// Optional morphology weight source; when supplied, skinned entities with
    /// weights draw their private deformed mesh variant.
    /// </param>
    /// <param name="skinningOptions">Optional skinning configuration; defaults to 256 bones on unit 15.</param>
    /// <param name="probeAtlas">Optional reflection probe cubemap atlas.</param>
    /// <param name="reflectionProbe">Optional selected-probe source for material sampling.</param>
    /// <param name="shadow">Optional shadow source; when supplied, its cascade frame and
    /// height-fog contract are bound to every mesh and skinned shader in the pass.</param>
    /// <param name="postProcess">
    /// Optional offscreen post-process chain. When supplied the scene renders into its HDR target
    /// and one extra post-process pass is dispatched after the planned passes, presenting the
    /// result to the default framebuffer.
    /// </param>
    public SceneGlRenderOrchestrator(
        GLContext context,
        SceneGlAssetCache assets,
        SceneWorld world,
        ISceneParticleSource? particles = null,
        SceneInstanceRegistry? instances = null,
        ISceneBonePaletteSource? bonePalettes = null,
        SceneSkinningOptions? skinningOptions = null,
        ISceneMorphWeightSource? morphWeights = null,
        SceneGlReflectionProbeAtlas? probeAtlas = null,
        ISceneReflectionProbeSource? reflectionProbe = null,
        ISceneGlShadowSource? shadow = null,
        SceneGlPostProcessChain? postProcess = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(world);

        _context = context;
        _assets = assets;
        _probeAtlas = probeAtlas;
        _reflectionProbe = reflectionProbe;
        _shadow = shadow;
        _meshExecutor = new SceneGlDrawExecutor(context, assets);
        _spriteRenderer = new SceneGlSpriteBatchRenderer(context, assets);
        _hasSpriteComponent = world.Registry.TryGetDataByType(typeof(SceneSpriteRenderer), out _);
        _pipeline = new SceneGlRenderPipeline(context);
        _pipeline.Register(PassKind.Opaque, ExecuteScenePass);
        if (postProcess is not null)
        {
            _postProcess = postProcess;
            _pipeline.Register(PassKind.PostProcess, _ => SubmitPostProcess());
            _pipeline.KindResolver = ResolveKind;
        }

        if (particles is not null)
        {
            _particles = particles;
            _particleRenderer = new SceneGlParticleBatchRenderer(context);
        }

        if (instances is not null)
        {
            _instances = instances;
            _instancedRenderer = new SceneGlInstancedMeshRenderer(context, assets);
            _hasInstancedComponent = world.Registry.TryGetDataByType(typeof(SceneInstancedMeshRenderer), out _);
        }

        if (bonePalettes is not null)
        {
            _skinnedRenderer = new SceneGlSkinnedMeshRenderer(context, assets, bonePalettes, skinningOptions, morphWeights);
        }
    }

    /// <summary>Mesh executor used by the orchestrator (diagnostics/tests).</summary>
    internal SceneGlDrawExecutor MeshExecutor => _meshExecutor;

    /// <summary>Skinning diagnostics of the last submitted pass, when skinning is active.</summary>
    public SceneSkinningDiagnostics SkinningDiagnostics =>
        _skinnedRenderer?.Diagnostics ?? default;

    /// <summary>Skinned draw calls issued by the last submitted pass.</summary>
    public int SkinnedDrawCalls => _skinnedRenderer?.LastDrawCalls ?? 0;

    /// <summary>Last skinned batch failure, or <see cref="SceneSkinningFailureReason.None"/>.</summary>
    public SceneSkinningFailureReason SkinningFailure =>
        _skinnedRenderer?.LastFailure ?? SceneSkinningFailureReason.None;

    /// <summary>Pipeline backend the frame is dispatched through (diagnostics/tests).</summary>
    internal SceneGlRenderPipeline Pipeline => _pipeline;

    /// <summary>
    /// Renders every enabled pass and returns the accumulated frame counters.
    /// </summary>
    public SceneRenderStats RenderFrame(
        SceneWorld world,
        SceneCameraFrame camera,
        ISceneFrameItemSource items,
        ReadOnlySpan<SceneRenderPassDefinition> passes,
        SceneRenderFrameState frameState,
        float elapsedSeconds = 0.0f,
        int backbufferWidth = 0,
        int backbufferHeight = 0)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(frameState);

        _work = new ScenePassWork(world, camera, items, frameState, elapsedSeconds);
        var ctx = new RenderExecutionContext(frameState.Frame, elapsedSeconds, backbufferWidth, backbufferHeight);
        _postProcess?.BeginScene();
        int dispatched;
        try
        {
            dispatched = _pipeline.Execute(passes, ctx).TotalPassesExecuted;
            if (_postProcess is not null)
            {
                // The chain reads the frame's HDR target, so it dispatches through the backend with
                // target management on while the pass work is still published.
                dispatched += _pipeline.Execute([_postProcessPass], ctx, manageTarget: true).TotalPassesExecuted;
            }
        }
        finally
        {
            _work = default;
        }

        return frameState.Snapshot(dispatched);
    }

    /// <summary>Routes the synthetic post-process pass to its own kind; planned passes stay opaque.</summary>
    private PassKind ResolveKind(SceneRenderPassDefinition pass) =>
        pass.Id.Equals(_postProcessPass.Id)
            ? PassKind.PostProcess
            : PassKind.Opaque;

    /// <summary>Runs the offscreen effect chain and presents its result.</summary>
    private void SubmitPostProcess()
    {
        ScenePassWork work = _work;
        _postProcess!.Submit(work.FrameState.Frame);
    }

    /// <summary>Executes one dispatched pass across every active render path.</summary>
    /// <param name="pass">The pass the backend dispatched.</param>
    private void ExecuteScenePass(SceneRenderPassDefinition pass)
    {
        ScenePassWork work = _work;
        SceneWorld world = work.World;
        SceneCameraFrame camera = work.Camera;
        ISceneFrameItemSource items = work.Items;
        SceneRenderFrameState frameState = work.FrameState;
        float elapsedSeconds = work.ElapsedSeconds;
        ReadOnlySpan<SceneRenderItem> meshes = items.CollectMeshes(pass.Id);
        _meshExecutor.Render(
            world,
            camera,
            meshes,
            items.Lighting,
            pass,
            frameState,
            elapsedSeconds,
            items.Fog,
            items as ISceneAreaLightSource,
            _probeAtlas,
            _reflectionProbe,
            _shadow,
            items.OutputGamma,
            items.EditorPreview);

        if (items is ISceneLodFrameItemSource lodSource)
        {
            ReadOnlySpan<SceneRenderItem> lodMeshes = lodSource.CollectLodMeshItems(pass.Id);
            if (!lodMeshes.IsEmpty)
            {
                _meshExecutor.Render(
                    world,
                    camera,
                    lodMeshes,
                    items.Lighting,
                    pass,
                    frameState,
                    elapsedSeconds,
                    items.Fog,
                    items as ISceneAreaLightSource,
                    _probeAtlas,
                    _reflectionProbe,
                    _shadow,
                    items.OutputGamma,
                    items.EditorPreview);
            }
        }

        if (_skinnedRenderer is not null && items is ISceneSkinnedMeshFrameItemSource skinnedSource)
        {
            ReadOnlySpan<SceneSkinnedMeshRenderItem> skinned = skinnedSource.CollectSkinnedMeshes(pass.Id);
            if (!skinned.IsEmpty)
            {
                _ = _skinnedRenderer.Render(
                    world,
                    camera,
                    skinned,
                    items.Lighting,
                    pass,
                    frameState,
                    elapsedSeconds,
                    items.Fog,
                    items as ISceneAreaLightSource,
                    _probeAtlas,
                    _reflectionProbe,
                    _shadow,
                    items.OutputGamma,
                    items.EditorPreview);
            }
        }

        if (_hasSpriteComponent)
        {
            ReadOnlySpan<SceneSpriteRenderItem> sprites = items.CollectSprites(pass.Id);
            if (sprites.Length > 0)
            {
                _ = _spriteRenderer.Render(world, camera, sprites, pass, frameState);
            }
        }

        if (_hasInstancedComponent &&
            _instancedRenderer is not null &&
            _instances is not null &&
            items is ISceneInstancedFrameItemSource instancedSource)
        {
            ReadOnlySpan<SceneInstancedMeshItem> batches = instancedSource.CollectInstancedMeshes(pass.Id);
            if (!batches.IsEmpty)
            {
                _ = _instancedRenderer.Render(world, camera, batches, _instances, pass, frameState);
            }
        }

        if (items is IScenePrimitiveFrameItemSource primitiveSource)
        {
            RenderPrimitives(world, camera, primitiveSource, pass, frameState);
        }

        RenderParticles(camera, pass, frameState);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _particleRenderer?.Dispose();
        _instancedRenderer?.Dispose();
        _skinnedRenderer?.Dispose();
        _primitiveRenderer?.Dispose();
        _spriteRenderer.Dispose();
        _pipeline.Dispose();
        _disposed = true;
    }

    private void RenderPrimitives(
        SceneWorld world,
        SceneCameraFrame camera,
        IScenePrimitiveFrameItemSource source,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ReadOnlySpan<SceneBillboardRenderItem> billboards = source.CollectBillboards(pass.Id);
        ReadOnlySpan<SceneLineRenderItem> lines = source.CollectLines(pass.Id);
        ReadOnlySpan<SceneTrailRenderItem> trails = source.CollectTrails(pass.Id);

        if (billboards.IsEmpty && lines.IsEmpty && trails.IsEmpty)
        {
            return;
        }

        _primitiveRenderer ??= new SceneGlPrimitiveBatchRenderer(_context, _assets);

        if (!billboards.IsEmpty)
        {
            _ = _primitiveRenderer.RenderBillboards(world, camera, billboards, pass, frameState);
        }

        if (!lines.IsEmpty)
        {
            _ = _primitiveRenderer.RenderLines(camera, lines, pass, frameState);
        }

        if (!trails.IsEmpty)
        {
            _ = _primitiveRenderer.RenderTrails(camera, trails, pass, frameState);
        }
    }

    private void RenderParticles(
        SceneCameraFrame camera,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        if (_particleRenderer is null || pass.Blend == false)
        {
            return;
        }

        int systems = _particles!.SystemCount;
        for (int i = 0; i < systems; i++)
        {
            SceneParticleSnapshot snapshot = _particles.GetSnapshot(i);
            if (snapshot.Count > 0)
            {
                _ = _particleRenderer.Render(snapshot, camera, pass, frameState);
            }
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlRenderOrchestrator));
        }
    }
}
