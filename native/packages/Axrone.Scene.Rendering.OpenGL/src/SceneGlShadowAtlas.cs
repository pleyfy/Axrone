namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Depth-only 2D shadow-map atlas. The renderer writes all cascades into one
/// texture through viewport tiles, which keeps the existing framebuffer API and
/// texture-unit plan unchanged while allowing up to four cascades in one pass.
/// </summary>
public sealed class SceneGlShadowAtlas : IDisposable
{
    private readonly GLContext _context;
    private readonly GLTexture _texture;
    private readonly GLFramebuffer _framebuffer;
    private readonly GLSampler _sampler;
    private bool _disposed;

    /// <summary>Minimum atlas edge supported by the renderer.</summary>
    public const int MinEdge = 512;

    /// <summary>Creates and validates a depth atlas on the render thread.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="edge">Atlas width and height; at least 512 pixels.</param>
    /// <exception cref="SceneConfigurationException">The edge or context capacity is unsupported.</exception>
    public SceneGlShadowAtlas(GLContext context, int edge = 2048)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (edge < MinEdge)
        {
            throw new SceneConfigurationException(
                $"Shadow atlas edge {edge} is below the supported minimum {MinEdge}.");
        }

        if (edge > context.Capabilities.MaxTextureSize)
        {
            throw new SceneConfigurationException(
                $"Shadow atlas edge {edge} exceeds the context limit {context.Capabilities.MaxTextureSize}.");
        }

        _context = context;
        Edge = edge;
        _context.AssertRenderThread();

        _texture = new GLTexture(
            context,
            GLConst.Texture2D,
            TextureFormat.Depth32f,
            edge,
            edge,
            depth: 1,
            mipLevels: 1,
            label: "scene-shadow-atlas");
        _texture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Nearest);
        _texture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Nearest);
        _texture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
        _texture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);

        _framebuffer = new GLFramebuffer(context, edge, edge, "scene-shadow-fbo");
        _framebuffer.AttachDepth(_texture);
        _framebuffer.Bind();
        uint status = context.GL.CheckFramebufferStatus(GLConst.Framebuffer);
        _framebuffer.Unbind();
        if (status != GLConst.FramebufferComplete)
        {
            _framebuffer.Dispose();
            _texture.Dispose();
            throw new SceneConfigurationException(
                $"Shadow framebuffer is incomplete; status 0x{status:X}.");
        }

        _sampler = new GLSampler(context, "scene-shadow-sampler");
        _sampler
            .SetFilter(GLConst.Nearest, GLConst.Nearest)
            .SetWrap(GLConst.ClampToEdge, GLConst.ClampToEdge)
            .Apply();
    }

    /// <summary>Atlas edge length.</summary>
    public int Edge { get; }

    /// <summary>Depth texture resource.</summary>
    public GLTexture Texture => _texture;

    /// <summary>Framebuffer resource.</summary>
    public GLFramebuffer Framebuffer => _framebuffer;

    /// <summary>Nearest sampler for depth comparisons.</summary>
    public GLSampler Sampler => _sampler;

    /// <summary>Whether the atlas resources are still alive.</summary>
    public bool IsAvailable => !_disposed && !_texture.IsDisposed && !_framebuffer.IsDisposed && !_sampler.IsDisposed;

    /// <summary>Binds the full atlas and clears depth for a fresh render.</summary>
    public void BeginFullClear()
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();
        _framebuffer.Bind();
        _context.State.SetViewport(0, 0, Edge, Edge);
        _context.State.SetClearDepth(1.0);
        _context.GL.Clear(GLConst.DepthBufferBit);
    }

    /// <summary>Restores the default framebuffer.</summary>
    public void End()
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();
        _framebuffer.Unbind();
        _context.State.BindFramebuffer(GLConst.Framebuffer, 0);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        DisposeOwned();
        _disposed = true;
    }

    private void DisposeOwned()
    {
        _sampler.Dispose();
        _framebuffer.Dispose();
        _texture.Dispose();
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            ThrowDisposed();
        }
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ThrowDisposed()
    {
        throw new SceneDisposedException(nameof(SceneGlShadowAtlas));
    }
}
