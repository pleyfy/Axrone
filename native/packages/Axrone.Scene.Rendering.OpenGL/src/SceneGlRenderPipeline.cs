namespace Axrone.Scene.Rendering.OpenGL;

using Axrone.Render.Core;
using Axrone.Render.OpenGL.Pipeline;
using Axrone.Scene.Assets;

/// <summary>
/// Bridges the scene renderer to the render pipeline backend: every scene pass is dispatched
/// through the backend's executor registry instead of a private loop, so the pass kinds the
/// backend already knows (opaque, transparent, skybox, tonemap, post-process, present) become the
/// single place where frame work is registered, counted and replaced.
/// </summary>
/// <remarks>
/// <para><b>Target state stays with the renderer.</b> The scene renderer owns its framebuffer and
/// viewport stack, so scene passes dispatch with target management off. Pass kinds that do need an
/// offscreen target - a post-process or present executor - are dispatched with it on.</para>
/// <para><b>Dispatch is synchronous and single-threaded.</b> The pass being executed is published in
/// a field for the duration of the call, which is the same render-thread affinity the draw
/// executors already rely on. An executor must not capture the current pass beyond its own call.</para>
/// <para><b>An unregistered kind fails the frame.</b> The backend throws rather than skipping a pass,
/// so a pass the scene plan asked for can never silently disappear from the output.</para>
/// </remarks>
public sealed class SceneGlRenderPipeline : IDisposable
{
    private readonly RenderPipelineBackend _backend;
    private readonly Dictionary<PassKind, ScenePassAdapter> _adapters = new();
    private SceneRenderPassDefinition? _currentPass;
    private bool _disposed;

    /// <summary>Creates a pipeline over one GL context.</summary>
    /// <param name="context">Context the backend dispatches into.</param>
    public SceneGlRenderPipeline(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _backend = new RenderPipelineBackend(context);
    }

    /// <summary>
    /// Maps a scene pass to the pass kind that should execute it. Scene passes carry no kind of
    /// their own, so the default is <see cref="PassKind.Opaque"/> - what the scene renderer has
    /// always drawn - and a host that classifies its passes replaces this.
    /// </summary>
    public Func<SceneRenderPassDefinition, PassKind> KindResolver { get; set; } =
        static _ => PassKind.Opaque;

    /// <summary>Total passes dispatched since construction.</summary>
    public int ExecutedPasses { get; private set; }

    /// <summary>Passes dispatched by the most recent frame.</summary>
    public int LastFramePassCount { get; private set; }

    /// <summary>
    /// Registers the body that executes a pass kind, replacing any previous registration.
    /// </summary>
    /// <param name="kind">Pass kind to own.</param>
    /// <param name="body">Scene pass work for that kind.</param>
    /// <exception cref="ArgumentNullException"><paramref name="body"/> is <see langword="null"/>.</exception>
    public void Register(PassKind kind, Action<SceneRenderPassDefinition> body)
    {
        ArgumentNullException.ThrowIfNull(body);
        ObjectDisposedException.ThrowIf(_disposed, this);

        _adapters[kind] = new ScenePassAdapter(kind, this, body);
        _backend.RegisterExecutor(_adapters[kind]);
    }

    /// <summary>Dispatches every pass in declared order.</summary>
    /// <param name="passes">The frame's pass plan.</param>
    /// <param name="ctx">Execution context for the frame.</param>
    /// <param name="manageTarget">
    /// Let the backend bind each pass target and viewport. Off for scene passes, on for passes that
    /// render into a pipeline-allocated target.
    /// </param>
    /// <returns>The backend's frame counters.</returns>
    public RenderFrameResult Execute(
        ReadOnlySpan<SceneRenderPassDefinition> passes,
        in RenderExecutionContext ctx,
        bool manageTarget = false)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        _backend.BeginFrame(ctx);
        LastFramePassCount = 0;
        for (int i = 0; i < passes.Length; i++)
        {
            SceneRenderPassDefinition pass = passes[i];
            _currentPass = pass;
            try
            {
                _backend.ExecutePass(Resolve(pass, ctx), ctx, manageTarget);
            }
            finally
            {
                _currentPass = null;
            }

            LastFramePassCount++;
        }

        ExecutedPasses += LastFramePassCount;
        return _backend.EndFrame(ctx, manageTarget);
    }

    /// <summary>Releases the backend.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _adapters.Clear();
        _backend.Dispose();
    }

    private ResolvedRenderPass Resolve(SceneRenderPassDefinition pass, in RenderExecutionContext ctx) =>
        new(
            KindResolver(pass),
            pass.Id.ToString(),
            NativeHandle.FromDefaultFramebuffer(),
            NativeHandle.FromDefaultFramebuffer(),
            ctx.BackbufferWidth,
            ctx.BackbufferHeight,
            DirectFrameOutput: true);

    private SceneRenderPassDefinition CurrentPass =>
        _currentPass ?? throw new InvalidOperationException("No scene pass is being dispatched.");

    private sealed class ScenePassAdapter(
        PassKind kind,
        SceneGlRenderPipeline owner,
        Action<SceneRenderPassDefinition> body) : IRenderPassExecutor
    {
        public PassKind Kind { get; } = kind;

        public int Priority => 0;

        public void Execute(in ResolvedRenderPass pass, in RenderExecutionContext ctx, GLContext glContext) =>
            body(owner.CurrentPass);
    }
}
