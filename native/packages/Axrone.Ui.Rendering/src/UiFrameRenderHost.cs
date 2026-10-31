namespace Axrone.Ui.Rendering;

/// <summary>
/// Render host that decouples frame production from backend submission. Frames
/// are queued in a fixed ring and drained in submission order on
/// <see cref="Flush"/>; submission never allocates and flushing never grows the
/// ring. A full ring drops the oldest pending frame and counts the drop, which
/// keeps the most recent UI state authoritative instead of stalling producers.
/// </summary>
/// <remarks>
/// The host does not own the backend; its lifetime is managed by the engine.
/// The host is render-thread affine after construction.
/// </remarks>
public sealed class UiFrameRenderHost : IUiRenderHost, IDisposable
{
    /// <summary>Maximum frames queued between flushes.</summary>
    public const int MaxPendingFrames = 4;

    private readonly IUiFrame?[] _pending = new IUiFrame?[MaxPendingFrames];
    private int _head;
    private int _count;
    private int _disposed;

    /// <summary>Initializes a host over a backend.</summary>
    /// <param name="backend">Drawing backend.</param>
    public UiFrameRenderHost(IUiRenderBackend backend)
    {
        ArgumentNullException.ThrowIfNull(backend);
        Backend = backend;
    }

    /// <inheritdoc/>
    public IUiRenderBackend Backend { get; }

    /// <summary>Gets the number of frames waiting to be flushed.</summary>
    public int PendingCount => _count;

    /// <summary>Gets the number of frames dropped because the ring was full.</summary>
    public long DroppedFrames { get; private set; }

    /// <summary>Gets the number of frames skipped because the backend was not ready.</summary>
    public long SkippedFrames { get; private set; }

    /// <summary>Gets whether the host is disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public void Submit(IUiFrame frame)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        ArgumentNullException.ThrowIfNull(frame);

        if (_count == MaxPendingFrames)
        {
            _pending[_head] = null;
            _head = (_head + 1) % MaxPendingFrames;
            _count--;
            DroppedFrames++;
        }

        int tail = (_head + _count) % MaxPendingFrames;
        _pending[tail] = frame;
        _count++;
    }

    /// <inheritdoc/>
    public void Flush()
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        while (_count != 0)
        {
            IUiFrame? frame = _pending[_head];
            _pending[_head] = null;
            _head = (_head + 1) % MaxPendingFrames;
            _count--;

            if (frame is null)
            {
                continue;
            }

            if (!Backend.IsReady)
            {
                SkippedFrames++;
                continue;
            }

            Backend.BeginFrame(frame.Viewport);
            try
            {
                UiBatchGrouper grouper = new(frame.Commands);
                while (grouper.TryNext(out UiBatchKey key, out ReadOnlySpan<UiRenderCommand> commands))
                {
                    Backend.DrawBatch(in key, commands);
                }
            }
            finally
            {
                Backend.EndFrame();
            }
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Array.Clear(_pending);
        _head = 0;
        _count = 0;
    }
}
