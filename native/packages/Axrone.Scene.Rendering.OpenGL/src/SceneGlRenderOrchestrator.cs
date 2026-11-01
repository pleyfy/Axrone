namespace Axrone.Scene.Rendering.OpenGL;

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
    private readonly bool _hasSpriteComponent;
    private readonly bool _hasInstancedComponent;
    private SceneGlPrimitiveBatchRenderer? _primitiveRenderer;
    private bool _disposed;

    /// <summary>Creates an orchestrator over an uploaded GPU asset cache.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="assets">Uploaded GPU asset cache.</param>
    /// <param name="world">World whose actors are submitted.</param>
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
    public SceneGlRenderOrchestrator(
        GLContext context,
        SceneGlAssetCache assets,
        SceneWorld world,
        ISceneParticleSource? particles = null,
        SceneInstanceRegistry? instances = null,
        ISceneBonePaletteSource? bonePalettes = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(world);

        _context = context;
        _assets = assets;
        _meshExecutor = new SceneGlDrawExecutor(context, assets);
        _spriteRenderer = new SceneGlSpriteBatchRenderer(context, assets);
        _hasSpriteComponent = world.Registry.TryGetDataByType(typeof(SceneSpriteRenderer), out _);

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
            _skinnedRenderer = new SceneGlSkinnedMeshRenderer(context, assets, bonePalettes);
        }
    }

    /// <summary>Mesh executor used by the orchestrator (diagnostics/tests).</summary>
    internal SceneGlDrawExecutor MeshExecutor => _meshExecutor;

    /// <summary>
    /// Renders every enabled pass and returns the accumulated frame counters.
    /// </summary>
    public SceneRenderStats RenderFrame(
        SceneWorld world,
        SceneCameraFrame camera,
        ISceneFrameItemSource items,
        ReadOnlySpan<SceneRenderPassDefinition> passes,
        SceneRenderFrameState frameState,
        float elapsedSeconds = 0.0f)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(frameState);

        int passCount = 0;

        for (int i = 0; i < passes.Length; i++)
        {
            SceneRenderPassDefinition pass = passes[i];

            ReadOnlySpan<SceneRenderItem> meshes = items.CollectMeshes(pass.Id);
            _meshExecutor.Render(
                world,
                camera,
                meshes,
                items.Lighting,
                pass,
                frameState,
                elapsedSeconds,
                items.Fog);

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
                        items.Fog);
                }
            }

            if (_skinnedRenderer is not null && items is ISceneSkinnedMeshFrameItemSource skinnedSource)
            {
                ReadOnlySpan<SceneSkinnedMeshRenderItem> skinned = skinnedSource.CollectSkinnedMeshes(pass.Id);
                if (!skinned.IsEmpty)
                {
                    _ = _skinnedRenderer.Render(world, camera, skinned, pass, frameState);
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

            passCount++;
        }

        return frameState.Snapshot(passCount);
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
