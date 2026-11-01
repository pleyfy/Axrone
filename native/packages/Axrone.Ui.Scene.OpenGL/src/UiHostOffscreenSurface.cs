namespace Axrone.Ui.Scene.OpenGL;

/// <summary>Render target for one world-space host; recreated only on size change.</summary>
public sealed class UiHostOffscreenSurface : IDisposable
{
    private readonly GLContext _context;
    private GLTexture? _texture;
    private GLFramebuffer? _framebuffer;
    private int _disposed;

    /// <summary>Creates a surface with the given pixel size.</summary>
    public UiHostOffscreenSurface(GLContext context, int width, int height)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
        Resize(width, height);
    }

    /// <summary>Gets the color attachment.</summary>
    public GLTexture Texture => _texture ?? throw new ObjectDisposedException(nameof(UiHostOffscreenSurface));

    /// <summary>Gets the surface width in pixels.</summary>
    public int Width { get; private set; }

    /// <summary>Gets the surface height in pixels.</summary>
    public int Height { get; private set; }

    /// <summary>Recreates the attachments when the size changes.</summary>
    public void Resize(int width, int height)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "UI host surface dimensions must be positive.");
        }

        if (_texture is not null && Width == width && Height == height)
        {
            return;
        }

        _context.AssertRenderThread();
        DisposeAttachments();

        Width = width;
        Height = height;
        _texture = new GLTexture(_context, GLConst.Texture2D, TextureFormat.Rgba8, width, height, label: "UiHostSurface");
        _texture.SetParameter(GLConst.TextureMinFilter, GLConst.Linear);
        _texture.SetParameter(GLConst.TextureMagFilter, GLConst.Linear);
        _texture.SetParameter(GLConst.TextureWrapS, GLConst.ClampToEdge);
        _texture.SetParameter(GLConst.TextureWrapT, GLConst.ClampToEdge);

        _framebuffer = new GLFramebuffer(_context, width, height, "UiHostSurfaceFbo");
        _framebuffer.AttachColor(_texture);
        _framebuffer.EnsureComplete();
    }

    /// <summary>Binds the framebuffer, sets the viewport and clears it transparent.</summary>
    public void Bind()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        GLFramebuffer framebuffer = _framebuffer ?? throw new ObjectDisposedException(nameof(UiHostOffscreenSurface));
        framebuffer.Bind();
        _context.State.SetViewport(0, 0, Width, Height);
        _context.State.SetClearColor(0.0f, 0.0f, 0.0f, 0.0f);
        framebuffer.Clear(color: true, depth: false);
    }

    /// <summary>Unbinds the framebuffer.</summary>
    public void Unbind()
    {
        _framebuffer?.Unbind();
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        DisposeAttachments();
    }

    private void DisposeAttachments()
    {
        _framebuffer?.Dispose();
        _framebuffer = null;
        _texture?.Dispose();
        _texture = null;
    }
}

/// <summary>
/// Textured quad drawer for world-space hosts. Uses the same row-vector matrix
/// convention as the scene renderers and depth-tests against the scene buffer.
/// </summary>
public sealed class UiHostWorldQuadRenderer : IDisposable
{
    private const string VertexShader = """
#version 330 core
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec2 a_Uv;
uniform mat4 u_Model;
uniform mat4 u_ViewProjection;
out vec2 v_Uv;
void main()
{
    v_Uv = a_Uv;
    gl_Position = vec4(a_Position, 1.0) * u_Model * u_ViewProjection;
}
""";

    private const string FragmentShader = """
#version 330 core
in vec2 v_Uv;
uniform sampler2D u_Texture;
out vec4 o_Color;
void main()
{
    vec4 color = texture(u_Texture, v_Uv);
    if (color.a <= 0.001)
    {
        discard;
    }

    o_Color = color;
}
""";

    private static readonly float[] Vertices =
    [
        -0.5f, 0.5f, 0.0f, 0.0f, 0.0f,
        0.5f, 0.5f, 0.0f, 1.0f, 0.0f,
        -0.5f, -0.5f, 0.0f, 0.0f, 1.0f,
        0.5f, -0.5f, 0.0f, 1.0f, 1.0f,
    ];

    private readonly GLContext _context;
    private readonly GLProgram _program;
    private readonly ShaderInstance _shader;
    private readonly GLBuffer _vertices;
    private readonly GLVertexArray _vao;
    private readonly int _modelLocation;
    private readonly int _viewProjectionLocation;
    private readonly int _textureLocation;
    private int _disposed;

    /// <summary>Creates the quad renderer and compiles its program.</summary>
    public UiHostWorldQuadRenderer(GLContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _context = context;
        _program = new GLProgram(context, VertexShader, FragmentShader);
        _shader = new ShaderInstance(context, _program, new UniformCache());
        _modelLocation = _program.GetUniformLocation("u_Model");
        _viewProjectionLocation = _program.GetUniformLocation("u_ViewProjection");
        _textureLocation = _program.GetUniformLocation("u_Texture");

        _vertices = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.StaticDraw, Vertices.Length * sizeof(float), "UiHostQuad");
        _vertices.Update(System.Runtime.InteropServices.MemoryMarshal.AsBytes(Vertices.AsSpan()));
        _vao = new GLVertexArray(context, "UiHostQuad");
        _vao.ConfigureLayout(
            _vertices,
            new[]
            {
                VertexAttribute.Float(0, 3, 5 * sizeof(float), 0),
                VertexAttribute.Float(1, 2, 5 * sizeof(float), 3 * sizeof(float)),
            },
            4);
    }

    /// <summary>Draws one textured quad.</summary>
    public void Draw(GLTexture texture, in Mat4 model, in Mat4 viewProjection, bool depthTest)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ArgumentNullException.ThrowIfNull(texture);
        _context.AssertRenderThread();

        _shader.Bind();
        _shader.SetMatrix4(_modelLocation, in model);
        _shader.SetMatrix4(_viewProjectionLocation, in viewProjection);
        _shader.SetInt(_textureLocation, 0);
        _context.State.BindTexture2D(0, texture.Id);
        _context.State.SetDepthTest(depthTest);
        _context.State.SetDepthMask(false);
        _context.State.SetBlend(true);
        _context.State.SetBlendFuncSeparate(GLConst.SrcAlpha, GLConst.OneMinusSrcAlpha, GLConst.One, GLConst.OneMinusSrcAlpha);
        _vao.Draw(GLConst.TriangleStrip);
        _context.State.SetDepthMask(true);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _vao.Dispose();
        _vertices.Dispose();
        _program.Dispose();
    }
}
