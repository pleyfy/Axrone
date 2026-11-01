namespace Axrone.Scene.Runtime;

/// <summary>
/// OpenGL execution layer over a <see cref="SceneRuntime"/>. Uploads the asset
/// catalog once (or after a reload) and submits one draw pass per planned
/// render pass. All methods are render-thread affine.
/// </summary>
public sealed class SceneGlFrameRenderer : IDisposable
{
    private readonly GLContext _context;
    private readonly SceneRuntime _runtime;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneGlRenderOrchestrator _orchestrator;
    private bool _disposed;

    /// <summary>Creates a GL frame renderer for a runtime and context.</summary>
    public SceneGlFrameRenderer(GLContext context, SceneRuntime runtime)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(runtime);

        _context = context;
        _runtime = runtime;
        _assets = new SceneGlAssetCache(context, runtime.Assets);
        _orchestrator = new SceneGlRenderOrchestrator(
            context,
            _assets,
            runtime.World,
            runtime.HasParticles ? runtime.Particles : null,
            bonePalettes: runtime.HasSkinnedMeshes ? runtime.BonePalettes : null);
    }

    /// <summary>GPU-side asset cache.</summary>
    public SceneGlAssetCache GpuAssets => _assets;

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
    public SceneRenderStats Render(int frameIndex, float elapsedSeconds = 0.0f)
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();

        SceneFramePipeline frame = _runtime.Frame;
        frame.TimeSeconds = elapsedSeconds;
        if (!frame.Plan(frameIndex))
        {
            return frame.Complete(0);
        }

        SceneCameraFrame camera = frame.Camera!;
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

        _orchestrator.Dispose();
        _assets.Dispose();
        _disposed = true;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlFrameRenderer));
        }
    }
}
