namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Compiled scene shader with cached uniform locations and a value-dedup cache.
/// The instance is created once per registered shader definition.
/// </summary>
public sealed class SceneGlShader : IDisposable
{
    private readonly GLContext _context;
    private readonly UniformCache _uniformCache;
    private SceneShaderUniformReflection? _reflection;

    /// <summary>Creates and compiles a scene shader.</summary>
    public SceneGlShader(
        GLContext context,
        string label,
        string vertexSource,
        string fragmentSource)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(vertexSource);
        ArgumentNullException.ThrowIfNull(fragmentSource);

        _context = context;
        Label = label;
        VertexSource = vertexSource;
        FragmentSource = fragmentSource;
        Program = new GLProgram(context, vertexSource, fragmentSource);
        _uniformCache = new UniformCache();
        Uniforms = new ShaderInstance(context, Program, _uniformCache);
    }

    /// <summary>Debug label.</summary>
    public string Label { get; }

    /// <summary>Vertex source the program was compiled from.</summary>
    public string VertexSource { get; }

    /// <summary>Fragment source the program was compiled from.</summary>
    public string FragmentSource { get; }

    /// <summary>Compiled program.</summary>
    public GLProgram Program { get; }

    /// <summary>Uniform value cache and setter surface.</summary>
    public ShaderInstance Uniforms { get; }

    /// <summary>
    /// Uniform declarations reflected from the compiled sources. Scanned on first use: the
    /// binding path needs it for every draw, hand-authored shaders never do.
    /// </summary>
    public SceneShaderUniformReflection Reflection =>
        _reflection ??= SceneShaderUniformReflection.FromSources(VertexSource, FragmentSource);

    /// <summary>Names of the sampler uniforms the program declares.</summary>
    public IReadOnlyList<string> SamplerUniformNames => Reflection.SamplerNames;

    /// <summary>Whether the program has been disposed.</summary>
    public bool IsDisposed => Program.IsDisposed;

    /// <summary>Resolves the declared type of one uniform.</summary>
    /// <param name="name">Uniform name.</param>
    /// <param name="uniform">Uniform metadata when the program declares the name.</param>
    /// <returns>Whether the declaration was found.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetUniform(string name, out SceneShaderUniform uniform) =>
        Reflection.TryGet(name, out uniform);

    /// <summary>Binds the program.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Bind() => Uniforms.Bind();

    /// <summary>Resolves a uniform location, or <c>-1</c> when absent.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int GetUniformLocation(string name) => Program.GetUniformLocation(name);

    /// <summary>Sets a float uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetFloat(string name, float value) =>
        Uniforms.SetFloat(GetUniformLocation(name), value);

    /// <summary>Sets an integer uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetInt(string name, int value) =>
        Uniforms.SetInt(GetUniformLocation(name), value);

    /// <summary>Sets an unsigned integer uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetUInt(string name, uint value)
    {
        int location = GetUniformLocation(name);
        if (location >= 0)
        {
            _context.GL.Uniform1(location, unchecked((int)value));
        }
    }

    /// <summary>Sets a boolean uniform encoded as an integer.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBool(string name, bool value) =>
        Uniforms.SetInt(GetUniformLocation(name), value ? 1 : 0);

    /// <summary>Sets a two-component uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetVec2(string name, in Vec2 value) =>
        Uniforms.SetVec2(GetUniformLocation(name), value.X, value.Y);

    /// <summary>Sets a three-component uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetVec3(string name, in Vec3 value)
    {
        int location = GetUniformLocation(name);
        if (location >= 0)
        {
            _context.GL.Uniform3(location, value.X, value.Y, value.Z);
        }
    }

    /// <summary>Sets a four-component uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetVec4(string name, in Vec4 value) =>
        Uniforms.SetVec4(GetUniformLocation(name), value.X, value.Y, value.Z, value.W);

    /// <summary>Sets a matrix uniform.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetMatrix4(string name, in Mat4 value) =>
        Uniforms.SetMatrix4(GetUniformLocation(name), in value);

    /// <inheritdoc/>
    public void Dispose() => Program.Dispose();
}
