namespace Axrone.Ui.Rendering;

/// <summary>
/// Headless backend used by tests and tooling. It compiles and caches pipelines,
/// validates frame nesting, and folds every batch into an FNV-1a trace hash so
/// two runs can be compared bit-for-bit without a GPU.
/// </summary>
/// <remarks>
/// The backend is not thread-safe; it mirrors the render-thread-affine contract
/// of the real OpenGL backend.
/// </remarks>
public sealed class UiRecordingBackend : IUiRenderBackend, IDisposable
{
    private const int MaxCachedPipelines = 16;

    private readonly UiPipelineDescriptor[] _descriptors = new UiPipelineDescriptor[MaxCachedPipelines];
    private readonly UiHeadlessPipeline?[] _pipelines = new UiHeadlessPipeline?[MaxCachedPipelines];
    private int _pipelineCount;
    private bool _inFrame;
    private int _disposed;

    /// <summary>Gets the number of completed frames.</summary>
    public int FrameCount { get; private set; }

    /// <summary>Gets the number of completed draw batches.</summary>
    public int DrawCallCount { get; private set; }

    /// <summary>Gets the number of commands observed since construction or reset.</summary>
    public int CommandCount { get; private set; }

    /// <summary>Gets the command count of the most recent frame.</summary>
    public int LastFrameCommandCount { get; private set; }

    /// <summary>Gets the viewport of the most recent frame.</summary>
    public UiViewport LastViewport { get; private set; }

    /// <summary>Gets the key of the most recent batch.</summary>
    public UiBatchKey LastKey { get; private set; }

    /// <summary>Gets the deterministic trace hash of every batch key and command observed.</summary>
    public uint TraceHash { get; private set; } = 2166136261u;

    /// <summary>Gets the number of cached pipelines.</summary>
    public int PipelineCount => _pipelineCount;

    /// <summary>Gets whether the backend is disposed.</summary>
    public bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <inheritdoc/>
    public bool IsReady => !IsDisposed;

    /// <inheritdoc/>
    public IUiPipeline CreatePipeline(in UiPipelineDescriptor descriptor)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);

        for (int i = 0; i < _pipelineCount; i++)
        {
            if (_descriptors[i] == descriptor)
            {
                return _pipelines[i]!;
            }
        }

        if (_pipelineCount == MaxCachedPipelines)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("Pipeline cache is exhausted; the descriptor set is unbounded.");
        }

        UiHeadlessPipeline pipeline = new(descriptor);
        _descriptors[_pipelineCount] = descriptor;
        _pipelines[_pipelineCount] = pipeline;
        _pipelineCount++;
        return pipeline;
    }

    /// <inheritdoc/>
    public void BeginFrame(in UiViewport viewport)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("BeginFrame called while a frame is already open.");
        }

        _inFrame = true;
        LastViewport = viewport;
        LastFrameCommandCount = 0;
        Mix(viewport.Width);
        Mix(viewport.Height);
    }

    /// <inheritdoc/>
    public void DrawBatch(in UiBatchKey key, ReadOnlySpan<UiRenderCommand> commands)
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (!_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("DrawBatch called outside BeginFrame/EndFrame.");
        }

        LastKey = key;
        DrawCallCount++;
        CommandCount += commands.Length;
        LastFrameCommandCount += commands.Length;

        Mix((uint)key.Kind);
        Mix((uint)key.Resource.Value);
        Mix((uint)(key.Resource.Value >> 32));
        Mix(key.AtlasPage.Value);
        Mix((uint)key.Blend);
        Mix((uint)key.Sampling);
        Mix(key.HasClip ? 1u : 0u);
        Mix(key.Clip.X);
        Mix(key.Clip.Y);
        Mix(key.Clip.Width);
        Mix(key.Clip.Height);

        for (int i = 0; i < commands.Length; i++)
        {
            ref readonly UiRenderCommand command = ref commands[i];
            Mix((uint)command.Kind);
            Mix(command.Node.Value);
            Mix((uint)command.ZIndex);
            Mix(command.Bounds.X);
            Mix(command.Bounds.Y);
            Mix(command.Bounds.Width);
            Mix(command.Bounds.Height);
        }
    }

    /// <inheritdoc/>
    public void EndFrame()
    {
        ObjectDisposedException.ThrowIf(IsDisposed, this);
        if (!_inFrame)
        {
            UiRenderThrowHelper.ThrowInvalidOperation("EndFrame called without a matching BeginFrame.");
        }

        _inFrame = false;
        FrameCount++;
    }

    /// <summary>Clears counters and resets the trace hash to its seed.</summary>
    public void Reset()
    {
        FrameCount = 0;
        DrawCallCount = 0;
        CommandCount = 0;
        LastFrameCommandCount = 0;
        LastViewport = default;
        LastKey = default;
        TraceHash = 2166136261u;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        for (int i = 0; i < _pipelineCount; i++)
        {
            _pipelines[i]?.Dispose();
            _pipelines[i] = null;
        }

        _pipelineCount = 0;
        _inFrame = false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void Mix(float value) => Mix(BitConverter.SingleToUInt32Bits(value));

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void Mix(uint value) => TraceHash = (TraceHash ^ value) * 16777619u;
}

/// <summary>Headless pipeline handle. Lifetime is explicit and idempotent.</summary>
public sealed class UiHeadlessPipeline : IUiPipeline
{
    private int _disposed;

    internal UiHeadlessPipeline(in UiPipelineDescriptor descriptor)
    {
        Descriptor = descriptor;
    }

    /// <inheritdoc/>
    public UiPipelineDescriptor Descriptor { get; }

    /// <inheritdoc/>
    public bool IsValid => Volatile.Read(ref _disposed) == 0;

    /// <inheritdoc/>
    public void Dispose() => Interlocked.Exchange(ref _disposed, 1);
}
