namespace Axrone.Render.OpenGL.Pipeline;

/// <summary>
/// Render pass execution context.
/// </summary>
public readonly record struct RenderExecutionContext(int FrameIndex, double DeltaTime, int BackbufferWidth, int BackbufferHeight);

/// <summary>
/// Render frame result.
/// </summary>
public readonly record struct RenderFrameResult(int TotalPassesExecuted, int TotalDrawCalls);

/// <summary>
/// Resolved render pass with all necessary information for execution.
/// </summary>
public readonly record struct ResolvedRenderPass(
    PassKind Kind,
    string Name,
    NativeHandle Target,
    NativeHandle SourceInput,
    int ViewportWidth,
    int ViewportHeight,
    bool DirectFrameOutput = false);

/// <summary>
/// Interface for render pass executors.
/// </summary>
public interface IRenderPassExecutor
{
    /// <summary>
    /// Gets the pass kind.
    /// </summary>
    PassKind Kind { get; }

    /// <summary>
    /// Gets the priority (higher = executed first).
    /// </summary>
    int Priority { get; }

    /// <summary>
    /// Executes the render pass.
    /// </summary>
    /// <param name="pass">The resolved pass.</param>
    /// <param name="ctx">The execution context.</param>
    /// <param name="glContext">The GL context.</param>
    void Execute(in ResolvedRenderPass pass, in RenderExecutionContext ctx, GLContext glContext);
}

/// <summary>
/// Render pipeline backend that manages pass execution.
/// </summary>
public sealed class RenderPipelineBackend : IDisposable
{
    private readonly GLContext _context;
    private readonly IRenderPassExecutor?[] _executors = new IRenderPassExecutor?[256]; // Max PassKind value
    private readonly GLVertexArray _fullscreenVao;
    private GLProgram? _fullscreenTriangleProgram;
    private int _drawCalls;
    private int _passCount;
    private int _isDisposed;

    /// <summary>
    /// Gets a value indicating whether the backend has been disposed.
    /// </summary>
    public bool IsDisposed => Volatile.Read(ref _isDisposed) != 0;

    /// <summary>
    /// Initializes a new instance of the <see cref="RenderPipelineBackend"/> class.
    /// </summary>
    /// <param name="context">The GL context.</param>
    public RenderPipelineBackend(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        _context = context;
        _fullscreenVao = new GLVertexArray(context);
    }

    private GLProgram FullscreenTriangleProgram
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get
        {
            GLProgram? program = Volatile.Read(ref _fullscreenTriangleProgram);
            if (program is not null)
            {
                return program;
            }

            // Created on first use: construction stays GL-call-free so backends
            // can be built on threads without a current context.
            const string vs = """
            #version 330 core
            void main() {
                vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
                gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
            }
            """;

            const string fs = """
            #version 330 core
            out vec4 FragColor;
            void main() {
                FragColor = vec4(1.0, 0.5, 0.0, 1.0);
            }
            """;

            var created = new GLProgram(_context, vs, fs);
            GLProgram? raced = Interlocked.CompareExchange(ref _fullscreenTriangleProgram, created, null);
            if (raced is not null)
            {
                created.Dispose();
                return raced;
            }

            return created;
        }
    }

    /// <summary>
    /// Registers a render pass executor.
    /// </summary>
    /// <param name="executor">The executor to register.</param>
    public void RegisterExecutor(IRenderPassExecutor executor)
    {
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Backend disposed");

        ArgumentNullException.ThrowIfNull(executor);

        int kindIndex = (int)executor.Kind;
        if (kindIndex >= 0 && kindIndex < _executors.Length)
        {
            _executors[kindIndex] = executor;
        }
    }

    /// <summary>
    /// Begins a frame.
    /// </summary>
    /// <param name="ctx">The execution context.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void BeginFrame(in RenderExecutionContext ctx)
    {
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Backend disposed");

        _drawCalls = 0;
        _passCount = 0;
    }

    /// <summary>
    /// Executes a render pass.
    /// </summary>
    /// <param name="pass">The resolved pass.</param>
    /// <param name="ctx">The execution context.</param>
    /// <param name="manageTarget">
    /// When <see langword="true"/> the backend binds the pass target and sets its viewport before
    /// dispatching. A renderer that owns its own framebuffer and viewport stack - the scene
    /// renderer does - passes <see langword="false"/> so dispatching adds no state change.
    /// </param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void ExecutePass(in ResolvedRenderPass pass, in RenderExecutionContext ctx, bool manageTarget = true)
    {
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Backend disposed");

        _passCount++;

        int kindIndex = (int)pass.Kind;
        if (kindIndex < 0 || kindIndex >= _executors.Length)
            ThrowHelper.ThrowExecutorNotFound(pass.Kind.ToString());

        ref readonly var executor = ref _executors[kindIndex];
        if (executor == null)
            ThrowHelper.ThrowExecutorNotFound(pass.Kind.ToString());

        if (manageTarget)
        {
            // Bind target framebuffer
            if (pass.Target.IsDefaultFramebuffer)
            {
                _context.State.BindFramebuffer(GLConst.Framebuffer, 0);
            }

            _context.State.SetViewport(0, 0, pass.ViewportWidth, pass.ViewportHeight);
        }

        executor.Execute(pass, ctx, _context);

        _drawCalls++;
    }

    /// <summary>
    /// Ends a frame.
    /// </summary>
    /// <param name="ctx">The execution context.</param>
    /// <param name="manageTarget">
    /// Restores the default framebuffer on the way out. Omitted when the caller owns target state.
    /// </param>
    /// <returns>The frame result.</returns>
    public RenderFrameResult EndFrame(in RenderExecutionContext ctx, bool manageTarget = true)
    {
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Backend disposed");

        if (manageTarget)
        {
            _context.State.BindFramebuffer(GLConst.Framebuffer, 0);
        }

        return new RenderFrameResult(_passCount, _drawCalls);
    }

    /// <summary>
    /// Draws a fullscreen triangle.
    /// </summary>
    public void DrawFullscreenTriangle()
    {
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Backend disposed");

        _context.State.SetDepthTest(false);
        _context.State.SetCullFace(false);
        _context.State.SetBlend(false);
        _context.State.SetDepthMask(false);
        _context.State.SetColorMask(true, true, true, true);

        _context.State.UseProgram(FullscreenTriangleProgram.Id);
        _context.State.BindVertexArray(_fullscreenVao.Id);
        _context.GL.DrawArrays(GLConst.Triangles, 0, 3);
        _context.State.BindVertexArray(0);
        _context.State.SetDepthMask(true);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _isDisposed, 1) == 0)
        {
            _fullscreenVao.Dispose();
            Interlocked.Exchange(ref _fullscreenTriangleProgram, null)?.Dispose();
            Array.Clear(_executors);
        }
    }
}
/// <summary>
/// Render resource allocator for creating textures.
/// </summary>
public sealed class RenderResourceAllocator : IDisposable
{
    private readonly GLContext _context;
    private readonly Dictionary<string, GLTexture> _allocated = new(StringComparer.OrdinalIgnoreCase);
    private int _isDisposed;

    /// <summary>
    /// Gets a value indicating whether the allocator has been disposed.
    /// </summary>
    public bool IsDisposed => Volatile.Read(ref _isDisposed) != 0;

    /// <summary>
    /// Initializes a new instance of the <see cref="RenderResourceAllocator"/> class.
    /// </summary>
    /// <param name="context">The GL context.</param>
    public RenderResourceAllocator(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
    }

    /// <summary>
    /// Creates a texture with the specified format.
    /// </summary>
    /// <param name="name">The texture name.</param>
    /// <param name="formatKey">The format key.</param>
    /// <param name="width">The width.</param>
    /// <param name="height">The height.</param>
    /// <returns>A native handle to the texture.</returns>
    public NativeHandle CreateTexture(string name, string formatKey, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(formatKey);
        if (IsDisposed)
            ThrowHelper.ThrowInvalidOperation("Allocator disposed");

        // Present usage → default framebuffer
        if (name.Contains("present", StringComparison.OrdinalIgnoreCase))
            return NativeHandle.FromDefaultFramebuffer();

        if (!TextureFormats.TryParseName(formatKey, out var format))
            ThrowHelper.ThrowInvalidOperation($"Unsupported allocator format key: {formatKey}");

        // Delete previous texture if exists
        if (_allocated.TryGetValue(name, out var oldTex))
        {
            oldTex.Dispose();
            _allocated.Remove(name);
        }

        var tex = new GLTexture(_context, GLConst.Texture2D, format, width, height);
        _allocated[name] = tex;

        return NativeHandle.FromTexture(new GpuTextureHandle(tex.Id, width, height, tex.FormatInfo.InternalFormat));
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _isDisposed, 1) == 0)
        {
            foreach (var tex in _allocated.Values)
            {
                tex.Dispose();
            }
            _allocated.Clear();
        }
    }
}
