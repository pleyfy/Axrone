namespace Axrone.Scene.Runtime;

using Axrone.GameLoop;

/// <summary>
/// Fixed-step loop host for a scene runtime. Owns the kernel, registers the
/// scene system and exposes explicit start/pause/stop transitions and ticking
/// so hosts can drive the loop from their own platform callback.
/// </summary>
public sealed class SceneRuntimeLoop : IDisposable
{
    private readonly SceneRuntime _runtime;
    private readonly GameLoopKernel<
        SceneRuntimeFrameState,
        HighResolutionStopwatchClock,
        ModuloSpiralMitigation,
        FailFastErrorPolicy<SceneRuntimeFrameState>> _kernel;

    private SceneRuntimeFrameState _state;
    private bool _disposed;

    /// <summary>Creates a loop over a runtime with an optional GL frame renderer.</summary>
    public SceneRuntimeLoop(
        SceneRuntime runtime,
        SceneGlFrameRenderer? renderer = null,
        SceneRuntimeLoopOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        options ??= new SceneRuntimeLoopOptions();

        _runtime = runtime;
        _kernel = new GameLoopKernel<
            SceneRuntimeFrameState,
            HighResolutionStopwatchClock,
            ModuloSpiralMitigation,
            FailFastErrorPolicy<SceneRuntimeFrameState>>(
            options.FixedDelta,
            options.MaxDelta,
            options.MaxSubSteps,
            options.TimeScale,
            options.InitialCapacity);

        _kernel.Registry.Register(new SceneRuntimeSystem(runtime, renderer));
        _state = new SceneRuntimeFrameState(
            default,
            default,
            CameraAvailable: false,
            SceneRenderMode.None);
    }

    /// <summary>Underlying game-loop kernel.</summary>
    public GameLoopKernel<
        SceneRuntimeFrameState,
        HighResolutionStopwatchClock,
        ModuloSpiralMitigation,
        FailFastErrorPolicy<SceneRuntimeFrameState>> Kernel => _kernel;

    /// <summary>Current frame state.</summary>
    public SceneRuntimeFrameState State => _state;

    /// <summary>Current loop status.</summary>
    public GameLoopStatus Status => _kernel.Status;

    /// <summary>Frames advanced so far.</summary>
    public FrameIndex Frame => _kernel.Frame;

    /// <summary>
    /// Raised after every successful <see cref="Tick"/> call, on the loop thread. Adapters that
    /// mirror scene state (for example <c>SceneReactiveBridge</c>) subscribe here instead of
    /// requiring the host to call their pump manually.
    /// </summary>
    public event EventHandler? FrameCompleted;

    /// <summary>Starts the loop and the scene world lifecycle.</summary>
    public void Start(GameTime? timestamp = null)
    {
        ThrowIfDisposed();

        if (Status == GameLoopStatus.Running)
        {
            _runtime.World.Start();
            return;
        }

        var previousStatus = Status;
        try
        {
            _kernel.TransitionToRunning(timestamp);
            _runtime.World.Start();
        }
        catch
        {
            // Rollback to previous state (Idle, Stopped, or Paused)
            if (previousStatus == GameLoopStatus.Paused)
            {
                _kernel.TransitionToPaused();
            }
            else
            {
                _kernel.TransitionToStopped();
            }
            throw;
        }
    }

    /// <summary>Pauses the loop.</summary>
    public void Pause()
    {
        ThrowIfDisposed();
        _kernel.TransitionToPaused();
    }

    /// <summary>Stops the loop and resets all behaviours for a fresh start.</summary>
    public void Stop()
    {
        ThrowIfDisposed();
        _kernel.TransitionToStopped();
        _runtime.World.Stop();
    }

    /// <summary>Advances one frame.</summary>
    public FrameExecutionOutcome Tick(GameTime? timestamp = null)
    {
        ThrowIfDisposed();
        FrameExecutionOutcome outcome = _kernel.Advance(ref _state, timestamp);
        FrameCompleted?.Invoke(this, EventArgs.Empty);
        return outcome;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (Status == GameLoopStatus.Running)
        {
            _runtime.World.Stop();
        }

        _kernel.Dispose();
        _disposed = true;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneRuntimeLoop));
        }
    }
}
