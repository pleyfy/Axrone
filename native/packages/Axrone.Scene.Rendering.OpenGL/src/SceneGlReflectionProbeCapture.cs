namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Content rendered into each cubemap face during a probe capture pass.</summary>
public interface IReflectionProbeContentSource
{
    /// <summary>Renders one face of a probe cubemap.</summary>
    void RenderFace(in SceneReflectionProbeRenderItem probe, int face, in Mat4 viewProjection);
}

/// <summary>
/// Captures reflection probes into cubemaps through one framebuffer. Each face
/// is attached explicitly because cube maps cannot be attached as a whole, then
/// cleared and handed to the content source with a 90-degree view projection.
/// </summary>
public sealed class SceneGlReflectionProbeCapture : IDisposable
{
    private static readonly Vec3[] FaceDirections =
    [
        new(1, 0, 0), new(-1, 0, 0),
        new(0, 1, 0), new(0, -1, 0),
        new(0, 0, 1), new(0, 0, -1)
    ];

    private static readonly Vec3[] FaceUps =
    [
        new(0, -1, 0), new(0, -1, 0),
        new(0, 0, 1), new(0, 0, -1),
        new(0, -1, 0), new(0, -1, 0)
    ];

    private static readonly uint[] FaceTargets =
    [
        0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851A
    ];

    private readonly GLContext _context;
    private readonly SceneGlReflectionProbeAtlas _atlas;
    private readonly GLFramebuffer _framebuffer;
    private readonly Mat4 _projection;
    private bool _disposed;

    /// <summary>Creates a capture pass over a probe atlas.</summary>
    public SceneGlReflectionProbeCapture(GLContext context, SceneGlReflectionProbeAtlas atlas)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(atlas);

        _context = context;
        _atlas = atlas;
        _framebuffer = new GLFramebuffer(context, atlas.Resolution, atlas.Resolution, "scene-probe-capture");
        _projection = Mat4.CreatePerspectiveFieldOfView(MathF.PI * 0.5f, 1.0f, 0.1f, 100.0f);
    }

    /// <summary>Gets the number of faces captured by the last call.</summary>
    public int LastFaceCount { get; private set; }

    /// <summary>Captures all six faces of one probe.</summary>
    public int Capture(in SceneReflectionProbeRenderItem probe, IReflectionProbeContentSource? content = null)
    {
        ThrowIfDisposed();
        LastFaceCount = 0;
        if (!probe.CubemapId.IsValid)
        {
            return 0;
        }

        GLTexture cube = _atlas.GetOrCreate(probe.CubemapId);
        _framebuffer.Bind();
        _context.State.SetViewport(0, 0, _atlas.Resolution, _atlas.Resolution);

        int faces = 0;
        for (int face = 0; face < 6; face++)
        {
            _context.GL.FramebufferTexture2D(
                GLConst.Framebuffer,
                GLConst.ColorAttachment0,
                FaceTargets[face],
                cube.Id,
                0);

            uint status = _context.GL.CheckFramebufferStatus(GLConst.Framebuffer);
            if (status != GLConst.FramebufferComplete)
            {
                ThrowIncompleteFramebuffer(status);
            }

            _context.State.SetClearColor(0.0f, 0.0f, 0.0f, 1.0f);
            _context.GL.Clear(GLConst.ColorBufferBit);

            Mat4 view = Mat4.CreateLookAt(
                probe.WorldCenter,
                probe.WorldCenter + FaceDirections[face],
                FaceUps[face]);
            Mat4 viewProjection = view * _projection;
            content?.RenderFace(in probe, face, in viewProjection);
            faces++;
        }

        _framebuffer.Unbind();
        _context.State.BindFramebuffer(GLConst.Framebuffer, 0);
        LastFaceCount = faces;
        return faces;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _framebuffer.Dispose();
        _disposed = true;
    }

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ThrowIncompleteFramebuffer(uint status) =>
        throw new SceneConfigurationException(
            $"Reflection probe framebuffer is incomplete; status 0x{status:X}.");

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlReflectionProbeCapture));
        }
    }
}

/// <summary>Binds the selected probe cubemap and uniforms to a material shader.</summary>
public static class SceneGlReflectionProbeBinder
{
    /// <summary>Texture unit reserved for the reflection probe.</summary>
    public const int TextureUnit = 14;

    private const string TextureUniform = "u_ReflectionProbe";
    private const string IntensityUniform = "u_ReflectionProbeIntensity";
    private const string PositionUniform = "u_ReflectionProbePosition";
    private const string ExtentsUniform = "u_ReflectionProbeExtents";

    /// <summary>Binds a probe; clears the intensity when the cubemap is missing.</summary>
    public static bool Bind(
        GLContext context,
        SceneGlShader shader,
        SceneGlReflectionProbeAtlas atlas,
        in SceneReflectionProbeRenderItem probe)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(shader);
        ArgumentNullException.ThrowIfNull(atlas);

        if (!atlas.TryGet(probe.CubemapId, out GLTexture? cubemap))
        {
            shader.SetFloat(IntensityUniform, 0.0f);
            return false;
        }

        context.State.ActiveTexture(TextureUnit);
        context.State.BindTexture(GLConst.TextureCubeMap, cubemap.Id);
        shader.SetInt(TextureUniform, TextureUnit);
        shader.SetFloat(IntensityUniform, probe.Intensity);
        shader.SetVec3(PositionUniform, in probe.WorldCenter);
        shader.SetVec3(ExtentsUniform, in probe.WorldExtents);
        return true;
    }
}
