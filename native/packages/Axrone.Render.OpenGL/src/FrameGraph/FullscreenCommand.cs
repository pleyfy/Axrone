namespace Axrone.Render.OpenGL.FrameGraph;

/// <summary>
/// Fullscreen primitive vocabulary, expressed as static abstracts. Implementations
/// translate the command vocabulary onto their own stack (production:
/// <see cref="GLContextInvoker"/>, which lands every value in
/// <see cref="GLStateCache"/> first). Static abstracts make the JIT monomorphize
/// each call site, so a command carries no vtable and issues no interface call.
/// </summary>
/// <remarks>
/// <para><typeparamref name="TSelf"/> is the invoker type itself (curiously
/// recurring), which lets the contract live on <c>in</c> context parameters. There
/// is deliberately no ambient scope object and no <see cref="IDisposable"/> command
/// scope: a scope would have to be created, threaded and torn down per draw, and a
/// missed <c>Dispose</c> would leak GL state invisibly. Here, state restoration is
/// a value the command carries and replays, so it is deterministic and cannot be
/// skipped.</para>
/// <para>The parameters stay raw GL handles — object names and blend fentities are
/// <see cref="uint"/> by definition — but an implementation must never forward
/// them to the driver directly. They go through the invoker's state cache so the
/// shadow state stays authoritative for every later pass.</para>
/// </remarks>
public interface IGLFullscreenInvoker<TSelf> where TSelf : struct, IGLFullscreenInvoker<TSelf>
{
    /// <summary>Binds a program, recording the change in the invoker's state cache.</summary>
    /// <param name="ctx">The invoker context.</param>
    /// <param name="program">The GL program name to bind.</param>
    static abstract void UseProgram(in TSelf ctx, uint program);

    /// <summary>Binds a texture to a unit, recording the change in the invoker's state cache.</summary>
    /// <param name="ctx">The invoker context.</param>
    /// <param name="unit">The texture unit index.</param>
    /// <param name="texture">The GL texture name to bind.</param>
    static abstract void BindTextureUnit(in TSelf ctx, uint unit, uint texture);

    /// <summary>
    /// Applies blend enable plus the RGB/alpha blend fentities. The fentities are
    /// recorded even on the disable path so the state cache and the driver agree
    /// on what a later enable will blend against.
    /// </summary>
    /// <param name="ctx">The invoker context.</param>
    /// <param name="enable">Whether blending is enabled.</param>
    /// <param name="srcFactor">The source blend factor.</param>
    /// <param name="dstFactor">The destination blend factor.</param>
    static abstract void SetBlendState(in TSelf ctx, bool enable, uint srcFactor, uint dstFactor);

    /// <summary>Sets a float uniform on the currently bound program.</summary>
    /// <param name="ctx">The invoker context.</param>
    /// <param name="location">The uniform location.</param>
    /// <param name="v">The value to upload.</param>
    static abstract void SetUniform1f(in TSelf ctx, int location, float v);

    /// <summary>Draws the fullscreen triangle (three vertices, no VAO).</summary>
    /// <param name="ctx">The invoker context.</param>
    static abstract void DrawFullscreenTriangle(in TSelf ctx);
}

/// <summary>
/// A recorded fullscreen draw that can be replayed against any concrete invoker.
/// </summary>
/// <remarks>
/// <para>Deliberately a plain (non-<c>ref struct</c>) contract: commands are passed
/// as <c>ref</c> parameters, so a command never escapes to the heap, while a plain
/// interface still lets the existing class-based pass executors build and issue
/// commands without changing their own signatures.</para>
/// <para>The command holds data plus exactly one replay method. It never inspects
/// the invoker's type, never allocates, and never throws on the draw path.</para>
/// </remarks>
/// <typeparam name="TInvoker">The invoker type this command replays against.</typeparam>
public interface IFullscreenDrawCommand<TInvoker> where TInvoker : struct, IGLFullscreenInvoker<TInvoker>
{
    /// <summary>Replays this command against <paramref name="invoker"/>.</summary>
    /// <param name="invoker">The invoker context. Threaded by reference so the struct stays on the stack.</param>
    void Execute(ref TInvoker invoker);
}

/// <summary>
/// Production invoker: replays fullscreen commands onto a <see cref="GLContext"/>,
/// funnelling every state change through <see cref="GLStateCache"/>.
/// </summary>
/// <remarks>
/// <para>Blend state is the reason this type exists. A fullscreen draw is almost
/// always opaque (blend off) yet it frequently follows geometry passes that left
/// blending on. Disabling blend with a raw <c>glDisable</c> would leave the state
/// cache still believing blend is enabled, so the next pass that enables blending
/// would see a cache hit, skip the GL call, and blend against whatever fentities
/// happened to be current — a silent, frame-wide rendering bug. Routing the
/// disable through the cache keeps shadow state and driver state in lockstep; the
/// fentities are pushed alongside the enable bit precisely so that a later re-enable
/// is deduplicated against a known-correct pair.</para>
/// </remarks>
public readonly struct GLContextInvoker : IGLFullscreenInvoker<GLContextInvoker>, IEquatable<GLContextInvoker>
{
    private readonly GLContext _context;

    /// <summary>
    /// Initializes a new instance of the <see cref="GLContextInvoker"/> struct.
    /// </summary>
    /// <param name="context">The GL context to issue calls through.</param>
    public GLContextInvoker(GLContext context)
    {
        if (context is null)
        {
            ThrowHelper.ThrowArgumentNull(nameof(context));
        }

        _context = context;
    }

    /// <summary>Compares two invokers by the GL context they target.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns>True if both invokers target the same GL context.</returns>
    public static bool operator ==(GLContextInvoker left, GLContextInvoker right) => left.Equals(right);

    /// <summary>Compares two invokers by the GL context they target.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns>True if the invokers target different GL contexts.</returns>
    public static bool operator !=(GLContextInvoker left, GLContextInvoker right) => !left.Equals(right);

    /// <summary>Compares this invoker with another by the GL context they target.</summary>
    /// <param name="other">The other invoker.</param>
    /// <returns>True if both invokers target the same GL context.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(GLContextInvoker other) => ReferenceEquals(_context, other._context);

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is GLContextInvoker other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => _context is null ? 0 : RuntimeHelpers.GetHashCode(_context);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void UseProgram(in GLContextInvoker ctx, uint program) =>
        ctx._context.State.UseProgram(program);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void BindTextureUnit(in GLContextInvoker ctx, uint unit, uint texture) =>
        ctx._context.State.BindTexture2D(unit, texture);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SetBlendState(in GLContextInvoker ctx, bool enable, uint srcFactor, uint dstFactor)
    {
        // Fentities first, then the enable bit: setting the fentities while blending is
        // off is legal GL and keeps the cache's blend pair meaningful on both paths.
        GLStateCache state = ctx._context.State;
        state.SetBlendFuncSeparate(srcFactor, dstFactor, srcFactor, dstFactor);
        state.SetBlend(enable);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SetUniform1f(in GLContextInvoker ctx, int location, float v) =>
        ctx._context.GL.Uniform1(location, v);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void DrawFullscreenTriangle(in GLContextInvoker ctx) =>
        ctx._context.GL.DrawArrays(GLConst.Triangles, 0, 3);
}

/// <summary>
/// Forwards a fullscreen command to its invoker. One call, monomorphized per closed
/// <c>(TInvoker, TCommand)</c> pair — the same idiom as the Simd
/// <c>IStaticStrategy</c> surface, so the forwarder inlines and no interface type
/// is ever materialized.
/// </summary>
public static class FullscreenDispatcher
{
    /// <summary>Replays <paramref name="command"/> against <paramref name="invoker"/>.</summary>
    /// <typeparam name="TInvoker">The invoker struct type.</typeparam>
    /// <typeparam name="TCommand">The command type.</typeparam>
    /// <param name="invoker">The invoker context, threaded by reference.</param>
    /// <param name="command">The command to replay, threaded by reference.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void Dispatch<TInvoker, TCommand>(ref TInvoker invoker, ref TCommand command)
        where TInvoker : struct, IGLFullscreenInvoker<TInvoker>
        where TCommand : IFullscreenDrawCommand<TInvoker> =>
        command.Execute(ref invoker);
}

/// <summary>Inline capacities of <see cref="FullscreenTriangleCommand{TInvoker}"/>.</summary>
internal static class FullscreenCommandLimits
{
    /// <summary>The number of texture units a single command can carry inline.</summary>
    public const int MaxTextureBinds = 4;

    /// <summary>The number of float uniforms a single command can carry inline.</summary>
    public const int MaxUniforms = 4;
}

/// <summary>A resolved texture-unit binding recorded in a command.</summary>
internal readonly record struct FullscreenTextureBind(uint Unit, uint Texture);

/// <summary>A resolved float uniform recorded in a command.</summary>
internal readonly record struct FullscreenUniform1f(int Location, float Value);

/// <summary>Inline storage for texture bindings — no heap, no pool.</summary>
[InlineArray(FullscreenCommandLimits.MaxTextureBinds)]
internal struct FullscreenTextureBindSlots
{
    private FullscreenTextureBind _element0;
}

/// <summary>Inline storage for float uniforms — no heap, no pool.</summary>
[InlineArray(FullscreenCommandLimits.MaxUniforms)]
internal struct FullscreenUniform1fSlots
{
    private FullscreenUniform1f _element0;
}

/// <summary>
/// Records one fullscreen triangle draw — program, texture units, float uniforms and
/// blend state — and replays it against any <see cref="IGLFullscreenInvoker{TSelf}"/>.
/// The payload lives in inline arrays, so filling a command allocates nothing.
/// </summary>
/// <typeparam name="TInvoker">The invoker type this command replays against.</typeparam>
internal struct FullscreenTriangleCommand<TInvoker> : IFullscreenDrawCommand<TInvoker>
    where TInvoker : struct, IGLFullscreenInvoker<TInvoker>
{
    /// <summary>Gets or sets the GL program name to bind.</summary>
    public uint Program { get; set; }

    /// <summary>Gets or sets the blend enable bit replayed before the draw.</summary>
    public bool BlendEnabled { get; set; }

    /// <summary>Gets or sets the source blend factor replayed before the draw.</summary>
    public uint BlendSrcFactor { get; set; }

    /// <summary>Gets or sets the destination blend factor replayed before the draw.</summary>
    public uint BlendDstFactor { get; set; }

    // InlineArray slots must stay fields: they are mutated in place, and a property
    // getter would hand back a copy the mutation would be lost on.
    private FullscreenTextureBindSlots _textureBinds;
    private FullscreenUniform1fSlots _uniforms;
    private int _textureBindCount;
    private int _uniformCount;

    /// <summary>Gets the number of populated texture slots.</summary>
    public readonly int TextureBindCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _textureBindCount;
    }

    /// <summary>Gets the number of populated uniform slots.</summary>
    public readonly int UniformCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _uniformCount;
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="FullscreenTriangleCommand{TInvoker}"/>
    /// struct with opaque blend state (blend off, One/Zero overwrite).
    /// </summary>
    /// <param name="program">The GL program name to bind.</param>
    public FullscreenTriangleCommand(uint program)
    {
        Program = program;
        BlendEnabled = false;
        BlendSrcFactor = GLConst.One;
        BlendDstFactor = GLConst.Zero;
        _textureBinds = default;
        _uniforms = default;
        _textureBindCount = 0;
        _uniformCount = 0;
    }

    /// <summary>Adds a texture-unit binding to the command.</summary>
    /// <param name="unit">The texture unit index.</param>
    /// <param name="texture">The GL texture name.</param>
    public void AddTextureBind(uint unit, uint texture)
    {
        if (_textureBindCount >= FullscreenCommandLimits.MaxTextureBinds)
        {
            ThrowHelper.ThrowInvalidArgument(
                $"Fullscreen command holds at most {FullscreenCommandLimits.MaxTextureBinds} texture binds");
        }

        _textureBinds[_textureBindCount++] = new FullscreenTextureBind(unit, texture);
    }

    /// <summary>Adds a float uniform to the command.</summary>
    /// <param name="location">The uniform location.</param>
    /// <param name="value">The value to upload.</param>
    public void AddUniform1f(int location, float value)
    {
        if (_uniformCount >= FullscreenCommandLimits.MaxUniforms)
        {
            ThrowHelper.ThrowInvalidArgument(
                $"Fullscreen command holds at most {FullscreenCommandLimits.MaxUniforms} float uniforms");
        }

        _uniforms[_uniformCount++] = new FullscreenUniform1f(location, value);
    }

    /// <summary>Replays the recorded draw against <paramref name="invoker"/>.</summary>
    /// <param name="invoker">The invoker context, threaded by reference.</param>
    public void Execute(ref TInvoker invoker)
    {
        TInvoker.UseProgram(in invoker, Program);

        for (int i = 0; i < _textureBindCount; i++)
        {
            FullscreenTextureBind bind = _textureBinds[i];
            TInvoker.BindTextureUnit(in invoker, bind.Unit, bind.Texture);
        }

        for (int i = 0; i < _uniformCount; i++)
        {
            FullscreenUniform1f uniform = _uniforms[i];
            TInvoker.SetUniform1f(in invoker, uniform.Location, uniform.Value);
        }

        TInvoker.SetBlendState(in invoker, BlendEnabled, BlendSrcFactor, BlendDstFactor);
        TInvoker.DrawFullscreenTriangle(in invoker);
    }
}
