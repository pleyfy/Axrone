namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>A source that can bind scene post-effect GPU state to a material shader.</summary>
public interface ISceneGlShadowSource
{
    /// <summary>Whether an atlas and populated cascade frame are available.</summary>
    bool IsAvailable { get; }

    /// <summary>Binds the source to a shader, returning false when the shader opts out.</summary>
    bool TryBind(GLContext context, SceneGlShader shader);

    /// <summary>Binds only the height-fog contract for shaders without shadow sampling.</summary>
    void BindFogOnly(SceneGlShader shader);
}

/// <summary>
/// Renders a tiled depth atlas and binds the resulting cascade frame to scene
/// materials. One atlas and framebuffer cover every cascade, so the pass stays a
/// single depth rasterization and does not alter the existing 0-15 texture plan.
/// </summary>
public sealed class SceneGlShadowRenderer : ISceneGlShadowSource, IDisposable
{
    private const string ModelUniform = "u_Model";
    private const string LightViewProjectionUniform = "u_lightViewProjection";

    private const string DefaultDepthVertexSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        uniform mat4 u_Model;
        uniform mat4 u_lightViewProjection;

        void main() {
            gl_Position = u_lightViewProjection * u_Model * vec4(a_Position, 1.0);
        }
        """;

    private const string DefaultDepthFragmentSource = """
        #version 330 core
        void main() {}
        """;

    private static readonly Vec3 LocalForward = new(0.0f, 0.0f, -1.0f);
    private static readonly Vec3 LocalUp = Vec3.UnitY;
    private static readonly Vec3 LocalRight = Vec3.UnitX;
    private static readonly Vec3 FallbackUp = Vec3.UnitX;

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly SceneGlShadowAtlas _atlas;
    private readonly GLProgram _depthProgram;
    private readonly bool _ownsDepthProgram;
    private bool _disposed;

    /// <summary>Creates a shadow renderer and its reusable cascade frame.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="assets">Uploaded mesh cache.</param>
    /// <param name="atlas">Depth atlas owned by the caller.</param>
    /// <param name="depthProgram">Optional depth program; a default no-output program is created when null.</param>
    /// <param name="settings">Initial shadow configuration.</param>
    public SceneGlShadowRenderer(
        GLContext context,
        SceneGlAssetCache assets,
        SceneGlShadowAtlas atlas,
        GLProgram? depthProgram = null,
        ShadowSettings settings = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(atlas);

        if (!SceneGlShadowBinder.SupportsTextureUnit(context))
        {
            throw new SceneConfigurationException(
                $"Shadow sampling needs more than {SceneGlShadowBinder.TextureUnit} fragment texture units; this context supports {context.Capabilities.MaxTextureImageUnits}.");
        }

        _context = context;
        _assets = assets;
        _atlas = atlas;
        if (depthProgram is null)
        {
            _depthProgram = new GLProgram(
                context,
                DefaultDepthVertexSource,
                DefaultDepthFragmentSource);
            _ownsDepthProgram = true;
        }
        else
        {
            if (depthProgram.IsDisposed)
            {
                throw new SceneConfigurationException("Shadow depth program has already been disposed.");
            }

            _depthProgram = depthProgram;
            _ownsDepthProgram = false;
        }

        Settings = settings.Enabled ? settings : settings.Equals(default) ? ShadowSettings.Default : settings;
        Frame = new ShadowFrameData();
    }

    /// <summary>Reusable cascade matrices, tiles, and settings.</summary>
    public ShadowFrameData Frame { get; }

    /// <summary>Shadow configuration.</summary>
    public ShadowSettings Settings { get; set; }

    /// <summary>Height-fog configuration bound with the shadow post-effect contract.</summary>
    public HeightFogSettings HeightFog { get; set; }

    /// <summary>Atlas bound to the renderer.</summary>
    public SceneGlShadowAtlas Atlas => _atlas;

    /// <summary>Cascades populated by the last render.</summary>
    public int LastCascadeCount { get; private set; }

    /// <summary>Meshes submitted into the last cascade render.</summary>
    public int LastDrawCalls { get; private set; }

    /// <summary>Whether the renderer currently has a drawable cascade frame.</summary>
    public bool IsAvailable => !_disposed && _atlas.IsAvailable && Frame.IsEnabled;

    /// <summary>
    /// Renders every caster once per cascade. The default framebuffer is restored
    /// before returning, so the pass cannot leak the shadow FBO into opaque draws.
    /// </summary>
    /// <param name="world">Actor world used for model matrices.</param>
    /// <param name="camera">Primary camera frame.</param>
    /// <param name="lighting">Resolved directional selection.</param>
    /// <param name="casters">Shadow-casting meshes.</param>
    /// <returns>Draw calls submitted.</returns>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        LightingSelectionState? lighting,
        ReadOnlySpan<SceneRenderItem> casters)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        _context.AssertRenderThread();

        LastCascadeCount = 0;
        LastDrawCalls = 0;
        Frame.Reset();

        if (!Settings.Enabled || !_atlas.IsAvailable || _depthProgram.IsDisposed || lighting is null)
        {
            return 0;
        }

        SceneGlDrawExecutor.ExtractLighting(lighting, out SceneGlDrawExecutor.LightingValues lights);
        if (lighting.Stats.SelectedDirectionalCount <= 0 ||
            lights.DirectionalIntensity <= 0.0f ||
            lights.DirectionalDirection.LengthSquared() < 1e-12f)
        {
            return 0;
        }

        ShadowCameraParameters parameters = CreateCameraParameters(camera);
        Vec3 lightDirection = lights.DirectionalDirection;
        ShadowCascadeFrameBuilder.Build(
            Frame,
            Settings,
            in parameters,
            in lightDirection,
            _atlas.Edge,
            _atlas.Edge);
        LastCascadeCount = Frame.ActiveCascadeCount;
        if (LastCascadeCount == 0)
        {
            return 0;
        }

        var state = _context.State;
        _atlas.BeginFullClear();
        state.SetDepthTest(true);
        state.SetDepthFunc(GLConst.Lequal);
        state.SetDepthMask(true);
        state.SetBlend(false);
        state.SetCullFace(true);
        state.SetCullMode(GLConst.Front);
        state.SetColorMask(false, false, false, false);
        state.UseProgram(_depthProgram.Id);

        int modelLocation = _depthProgram.GetUniformLocation(ModelUniform);
        int lightLocation = _depthProgram.GetUniformLocation(LightViewProjectionUniform);
        int drawCalls = 0;
        for (int cascade = 0; cascade < Frame.ActiveCascadeCount; cascade++)
        {
            Vec4 tile = Frame.GetAtlasTile(cascade);
            int x = (int)(_atlas.Edge * tile.X);
            int y = (int)(_atlas.Edge * tile.Y);
            int width = Math.Max(1, (int)(_atlas.Edge * tile.Z));
            int height = Math.Max(1, (int)(_atlas.Edge * tile.W));
            state.SetViewport(x, y, width, height);

            if (lightLocation >= 0)
            {
                unsafe
                {
                    Mat4 lightMatrix = Frame.GetLightViewProjection(cascade);
                    _context.GL.UniformMatrix4(lightLocation, 1, false, &lightMatrix.M11);
                }
            }

            for (int i = 0; i < casters.Length; i++)
            {
                ref readonly SceneRenderItem item = ref casters[i];
                if (!_assets.TryGetMesh(item.MeshId, out GLMesh? mesh) || mesh is null)
                {
                    continue;
                }

                if (modelLocation >= 0)
                {
                    unsafe
                    {
                        Mat4 model = world.GetWorldMatrix3D(item.Actor);
                        _context.GL.UniformMatrix4(modelLocation, 1, false, &model.M11);
                    }
                }

                mesh.Draw();
                drawCalls++;
            }
        }

        state.SetViewport(0, 0, _atlas.Edge, _atlas.Edge);
        state.SetColorMask(true, true, true, true);
        state.UseProgram(0);
        _atlas.End();
        LastDrawCalls = drawCalls;
        return drawCalls;
    }

    /// <inheritdoc/>
    public bool TryBind(GLContext context, SceneGlShader shader)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(shader);

        if (context != _context)
        {
            throw new SceneConfigurationException("Shadow renderer and shader are bound to different GL contexts.");
        }

        HeightFogSettings fog = HeightFog;
        return SceneGlShadowBinder.Bind(context, shader, _atlas, Frame, in fog);
    }

    /// <inheritdoc/>
    public void BindFogOnly(SceneGlShader shader)
    {
        ArgumentNullException.ThrowIfNull(shader);
        HeightFogSettings fog = HeightFog;
        SceneGlShadowBinder.BindHeightFog(shader, in fog);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (_ownsDepthProgram)
        {
            _depthProgram.Dispose();
        }

        _disposed = true;
    }

    private static ShadowCameraParameters CreateCameraParameters(SceneCameraFrame camera)
    {
        SceneCamera data = camera.Camera;
        Vec3 forward = camera.Rotation * LocalForward;
        Vec3 up = camera.Rotation * LocalUp;
        if (MathF.Abs(Vec3.Dot(forward, up)) > 0.999f)
        {
            up = camera.Rotation * FallbackUp;
        }

        Vec3 right = camera.Rotation * LocalRight;
        float verticalRadians = data.FieldOfViewDegrees * (MathF.PI / 180.0f);
        if (data.FieldOfViewAxis == SceneCameraFovAxis.Horizontal)
        {
            verticalRadians = 2.0f * MathF.Atan(MathF.Tan(verticalRadians * 0.5f) / camera.AspectRatio);
        }

        float orthographicWidth = data.Orthographic
            ? data.OrthographicSize * camera.AspectRatio * 2.0f
            : 1.0f;
        float orthographicHeight = data.Orthographic
            ? data.OrthographicSize * 2.0f
            : 1.0f;

        return new ShadowCameraParameters(
            camera.Position,
            forward,
            up,
            right,
            verticalRadians,
            camera.AspectRatio,
            data.Near,
            data.Far,
            data.Orthographic,
            orthographicWidth,
            orthographicHeight);
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
        throw new SceneDisposedException(nameof(SceneGlShadowRenderer));
    }
}
