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
    private GLProgram? _skinnedDepthProgram;
    private GLTexture? _boneTexture;
    private bool _skinnedDepthAttempted;
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
    /// <param name="world">Entity world used for model matrices.</param>
    /// <param name="camera">Primary camera frame.</param>
    /// <param name="lighting">Resolved directional selection.</param>
    /// <param name="casters">Shadow-casting meshes.</param>
    /// <returns>Draw calls submitted.</returns>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        LightingSelectionState? lighting,
        ReadOnlySpan<SceneRenderItem> casters) =>
        Render(
            world,
            camera,
            lighting,
            casters,
            ReadOnlySpan<SceneSkinnedMeshRenderItem>.Empty,
            null);

    /// <summary>Rasterizes static and skinned casters into the shared depth atlas.</summary>
    /// <param name="world">Scene world providing entity transforms.</param>
    /// <param name="camera">Camera frame used for cascade fitting.</param>
    /// <param name="lighting">Resolved directional selection.</param>
    /// <param name="casters">Shadow-casting static meshes.</param>
    /// <param name="skinnedCasters">Shadow-casting skinned meshes.</param>
    /// <param name="bonePalettes">Palette source required by the skinned casters.</param>
    /// <returns>Draw calls submitted.</returns>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        LightingSelectionState? lighting,
        ReadOnlySpan<SceneRenderItem> casters,
        ReadOnlySpan<SceneSkinnedMeshRenderItem> skinnedCasters,
        ISceneBonePaletteSource? bonePalettes)
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
        ShadowStateSnapshot saved = ShadowStateSnapshot.Capture(state);
        int drawCalls = 0;

        try
        {
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
                            Mat4 model = world.GetWorldMatrix3D(item.Entity);
                            _context.GL.UniformMatrix4(modelLocation, 1, false, &model.M11);
                        }
                    }

                    mesh.Draw();
                    drawCalls++;
                }

                drawCalls += DrawSkinnedCasters(world, skinnedCasters, bonePalettes, cascade);
            }
        }
        finally
        {
            try
            {
                _atlas.End();
            }
            finally
            {
                // A disposed atlas must not abort the restore and strand the
                // caller on framebuffer 0 with an atlas-edge viewport.
                saved.Restore(state);
                LastDrawCalls = drawCalls;
            }
        }

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

        _skinnedDepthProgram?.Dispose();
        _skinnedDepthProgram = null;
        _boneTexture?.Dispose();
        _boneTexture = null;
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

    /// <summary>
    /// Draws skinned casters into one cascade. A context whose driver rejects
    /// the injected skinning program leaves this inert, so characters simply
    /// stop casting instead of failing the frame.
    /// </summary>
    private int DrawSkinnedCasters(
        SceneWorld world,
        ReadOnlySpan<SceneSkinnedMeshRenderItem> skinnedCasters,
        ISceneBonePaletteSource? bonePalettes,
        int cascade)
    {
        if (skinnedCasters.IsEmpty || bonePalettes is null || !EnsureSkinnedDepthProgram())
        {
            return 0;
        }

        GLProgram program = _skinnedDepthProgram!;
        GLTexture boneTexture = _boneTexture!;
        int boneUnit = SceneSkinningOptions.Default.TextureUnit;
        _context.State.UseProgram(program.Id);

        int modelLocation = program.GetUniformLocation(ModelUniform);
        int lightLocation = program.GetUniformLocation(LightViewProjectionUniform);
        int boneLocation = program.GetUniformLocation(SkinningShaderInjector.BoneTextureUniform);
        int countLocation = program.GetUniformLocation(SkinningShaderInjector.BoneCountUniform);

        if (boneLocation >= 0)
        {
            _context.GL.Uniform1(boneLocation, boneUnit);
        }

        _context.State.BindTexture2D((uint)boneUnit, boneTexture.Id);
        _context.State.BindSampler((uint)boneUnit, 0);

        if (lightLocation >= 0)
        {
            unsafe
            {
                Mat4 lightMatrix = Frame.GetLightViewProjection(cascade);
                _context.GL.UniformMatrix4(lightLocation, 1, false, &lightMatrix.M11);
            }
        }

        int drawn = 0;
        for (int i = 0; i < skinnedCasters.Length; i++)
        {
            ref readonly SceneSkinnedMeshRenderItem item = ref skinnedCasters[i];
            if (item.Transparent ||
                !_assets.TryGetMesh(item.MeshId, out GLMesh? mesh) ||
                mesh is null ||
                !SceneGlSkinnedMeshRenderer.HasSkinAttributes(mesh) ||
                !bonePalettes.TryGetBonePalette(item.Entity, out ReadOnlySpan<Mat4> palette) ||
                palette.IsEmpty ||
                palette.Length > SceneSkinningOptions.Default.MaxBones)
            {
                continue;
            }

            boneTexture.UploadSubData2D(
                MemoryMarshal.AsBytes(palette),
                0,
                0,
                palette.Length * SkinningShaderInjector.BoneTexelsPerBone,
                1);

            if (countLocation >= 0)
            {
                _context.GL.Uniform1(countLocation, palette.Length);
            }

            if (modelLocation >= 0)
            {
                unsafe
                {
                    Mat4 model = world.GetWorldMatrix3D(item.Entity);
                    _context.GL.UniformMatrix4(modelLocation, 1, false, &model.M11);
                }
            }

            mesh.Draw();
            drawn++;
        }

        _context.State.BindVertexArray(0);
        _context.State.UseProgram(_depthProgram.Id);
        return drawn;
    }

    private bool EnsureSkinnedDepthProgram()
    {
        if (_skinnedDepthProgram is not null)
        {
            return !_skinnedDepthProgram.IsDisposed && !_disposed;
        }

        if (_skinnedDepthAttempted)
        {
            return false;
        }

        _skinnedDepthAttempted = true;
        if (!SkinningShaderInjector.TryInject(DefaultDepthVertexSource, out string skinnedVertex))
        {
            return false;
        }

        try
        {
            _skinnedDepthProgram = new GLProgram(_context, skinnedVertex, DefaultDepthFragmentSource);
            _boneTexture = new GLTexture(
                _context,
                GLConst.Texture2D,
                TextureFormat.Rgba32f,
                SceneSkinningOptions.Default.MaxBones * SkinningShaderInjector.BoneTexelsPerBone,
                1,
                depth: 1,
                mipLevels: 1,
                "scene-shadow-skin-bones");
            _boneTexture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Nearest);
            _boneTexture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Nearest);
            _boneTexture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
            _boneTexture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);
            return true;
        }
        catch (Axrone.Render.Core.RenderException)
        {
            _skinnedDepthProgram?.Dispose();
            _skinnedDepthProgram = null;
            _boneTexture?.Dispose();
            _boneTexture = null;
            return false;
        }
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

    /// <summary>
    /// The GL state the depth pass overwrites, captured before it runs and
    /// restored afterwards. Hosts that render inside their own framebuffer
    /// (an MSAA resolve target or a composition FBO) must not lose it, and the
    /// atlas-edge viewport must not leak into the scene pass.
    /// </summary>
    /// <remarks>
    /// Values the state cache marks unknown (<see cref="Unknown"/> handles,
    /// negative viewport) are skipped on restore: a freshly invalidated cache
    /// holds sentinels, and replaying them would bind handle 4294967295.
    /// </remarks>
    private readonly struct ShadowStateSnapshot
    {
        private const uint Unknown = uint.MaxValue;

        private readonly uint _readFramebuffer;
        private readonly uint _drawFramebuffer;
        private readonly int _viewportX;
        private readonly int _viewportY;
        private readonly int _viewportWidth;
        private readonly int _viewportHeight;
        private readonly bool _depthTest;
        private readonly uint _depthFunc;
        private readonly bool _depthMask;
        private readonly bool _blend;
        private readonly bool _cullFace;
        private readonly uint _cullMode;
        private readonly bool _colorMaskR;
        private readonly bool _colorMaskG;
        private readonly bool _colorMaskB;
        private readonly bool _colorMaskA;
        private readonly uint _program;
        private readonly double _clearDepth;

        private ShadowStateSnapshot(GLStateCache state)
        {
            _readFramebuffer = state.BoundReadFramebuffer;
            _drawFramebuffer = state.BoundDrawFramebuffer;
            _viewportX = state.ViewportX;
            _viewportY = state.ViewportY;
            _viewportWidth = state.ViewportWidth;
            _viewportHeight = state.ViewportHeight;
            _depthTest = state.DepthTestEnabled;
            _depthFunc = state.DepthFunc;
            _depthMask = state.DepthMask;
            _blend = state.BlendEnabled;
            _cullFace = state.CullFaceEnabled;
            _cullMode = state.CullMode;
            _colorMaskR = state.ColorMaskR;
            _colorMaskG = state.ColorMaskG;
            _colorMaskB = state.ColorMaskB;
            _colorMaskA = state.ColorMaskA;
            _program = state.BoundProgram;
            _clearDepth = state.ClearDepth;
        }

        public static ShadowStateSnapshot Capture(GLStateCache state) => new(state);

        public void Restore(GLStateCache state)
        {
            if (_viewportX >= 0 &&
                _viewportY >= 0 &&
                _viewportWidth >= 0 &&
                _viewportHeight >= 0)
            {
                state.SetViewport(_viewportX, _viewportY, _viewportWidth, _viewportHeight);
            }

            state.SetColorMask(_colorMaskR, _colorMaskG, _colorMaskB, _colorMaskA);
            state.SetDepthTest(_depthTest);
            state.SetDepthMask(_depthMask);
            state.SetBlend(_blend);
            state.SetCullFace(_cullFace);

            if (_depthFunc != Unknown)
            {
                state.SetDepthFunc(_depthFunc);
            }

            if (_cullMode != Unknown)
            {
                state.SetCullMode(_cullMode);
            }

            if (_program != Unknown)
            {
                state.UseProgram(_program);
            }

            if (_clearDepth >= 0.0)
            {
                state.SetClearDepth(_clearDepth);
            }

            bool readKnown = _readFramebuffer != Unknown;
            bool drawKnown = _drawFramebuffer != Unknown;
            if (!readKnown && !drawKnown)
            {
                return;
            }

            if (readKnown && drawKnown && _readFramebuffer == _drawFramebuffer)
            {
                state.BindFramebuffer(GLConst.Framebuffer, _drawFramebuffer);
                return;
            }

            if (drawKnown)
            {
                state.BindFramebuffer(GLConst.DrawFramebuffer, _drawFramebuffer);
            }

            if (readKnown)
            {
                state.BindFramebuffer(GLConst.ReadFramebuffer, _readFramebuffer);
            }
        }
    }
}
