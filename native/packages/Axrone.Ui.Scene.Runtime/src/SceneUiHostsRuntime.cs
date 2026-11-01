namespace Axrone.Ui.Scene.Runtime;

using Axrone.Input;
using Axrone.Scene.Rendering;

/// <summary>
/// Attached UI host composition: owns the bridge and optional renderer, exposes
/// deterministic update/render/input entry points and isolates failures behind
/// <see cref="LastError"/>.
/// </summary>
public sealed class SceneUiHostsRuntime : IDisposable
{
    private readonly SceneRuntime _runtime;
    private readonly SceneUiHostBridge _bridge;
    private readonly ISceneUiHostRenderer? _renderer;
    private readonly UiHostGlyphAtlasUploader? _atlasUploader;
    private int _disposed;

    internal SceneUiHostsRuntime(
        SceneRuntime runtime,
        SceneUiHostBridge bridge,
        ISceneUiHostRenderer? renderer,
        UiHostGlyphAtlasUploader? atlasUploader)
    {
        _runtime = runtime;
        _bridge = bridge;
        _renderer = renderer;
        _atlasUploader = atlasUploader;
    }

    /// <summary>Gets the owning scene runtime.</summary>
    public SceneRuntime Runtime => _runtime;

    /// <summary>Gets the host bridge.</summary>
    public SceneUiHostBridge Bridge => _bridge;

    /// <summary>Gets the renderer, or null for headless composition.</summary>
    public ISceneUiHostRenderer? Renderer => _renderer;

    /// <summary>Gets whether a renderer is attached.</summary>
    public bool HasRenderer => _renderer is not null;

    /// <summary>Gets the number of bound hosts.</summary>
    public int HostCount => _bridge.HostCount;

    /// <summary>Gets whether the composition is disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <summary>Gets the last isolated update/render/input failure.</summary>
    public Exception? LastError { get; private set; }

    /// <summary>Gets the screen viewport derived from the runtime.</summary>
    public UiViewport Viewport => new(new UiSize(_runtime.ViewportWidth, _runtime.ViewportHeight));

    /// <summary>Updates screen-host layout; returns the layout pass count.</summary>
    public int Update()
    {
        if (IsDisposed)
        {
            return 0;
        }

        try
        {
            int passes = _bridge.Update(Viewport);
            LastError = null;
            return passes;
        }
        catch (Exception exception)
        {
            LastError = exception;
            return 0;
        }
    }

    /// <summary>Renders world hosts and screen overlays with the planned camera.</summary>
    public bool Render() => Render(_runtime.Frame.Camera);

    /// <summary>Renders with an explicit camera frame.</summary>
    public bool Render(SceneCameraFrame? camera)
    {
        if (IsDisposed || _renderer is null)
        {
            return false;
        }

        try
        {
            _renderer.Render(_runtime.World, camera, Viewport, _bridge);
            LastError = null;
            return true;
        }
        catch (Exception exception)
        {
            LastError = exception;
            return false;
        }
    }

    /// <summary>Routes one raw engine event through the bridge.</summary>
    public bool ProcessRaw(in RawInputEvent raw)
    {
        if (IsDisposed)
        {
            return false;
        }

        try
        {
            bool handled = _bridge.ProcessRaw(in raw, Viewport, _runtime.Frame.Camera);
            LastError = null;
            return handled;
        }
        catch (Exception exception)
        {
            LastError = exception;
            return false;
        }
    }

    /// <summary>Rebuilds every host runtime from its asset.</summary>
    public bool ReloadAll()
    {
        if (IsDisposed)
        {
            return false;
        }

        try
        {
            _bridge.ReloadAll();
            LastError = null;
            return true;
        }
        catch (Exception exception)
        {
            LastError = exception;
            return false;
        }
    }

    /// <summary>Rebuilds one host runtime from its asset.</summary>
    public bool Reload(SceneActor actor)
    {
        if (IsDisposed)
        {
            return false;
        }

        try
        {
            bool reloaded = _bridge.Reload(actor);
            LastError = reloaded ? null : LastError;
            return reloaded;
        }
        catch (Exception exception)
        {
            LastError = exception;
            return false;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        SceneUiHostRuntimeExtensions.RemoveBinding(_runtime, this);
        DisposeCore();
    }

    internal void DisposeCore()
    {
        _renderer?.Dispose();
        _bridge.Dispose();
        _atlasUploader?.Dispose();
    }

    internal void DetachAndDispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            DisposeCore();
        }
    }
}
