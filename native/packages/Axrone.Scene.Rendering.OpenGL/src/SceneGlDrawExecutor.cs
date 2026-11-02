namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Executes a planned render pass against the OpenGL backend. Programs, VAOs,
/// textures and state are resolved from the GPU cache; the draw loop performs
/// only cached uniform writes and state-deduplicated GL calls.
/// </summary>
public sealed class SceneGlDrawExecutor
{
    internal const string ModelUniform = "u_Model";
    internal const string ViewUniform = "u_View";
    internal const string ProjectionUniform = "u_Projection";
    internal const string ViewProjectionUniform = "u_ViewProjection";
    internal const string CameraPositionUniform = "u_CameraPosition";
    internal const string ElapsedUniform = "u_Elapsed";
    internal const string ReceiveLightingUniform = "u_ReceiveLighting";
    private const string AlbedoUniform = "u_Albedo";
    private const string MetallicUniform = "u_Metallic";
    private const string RoughnessUniform = "u_Roughness";
    private const string EmissiveUniform = "u_Emissive";
    private const string NormalScaleUniform = "u_NormalScale";
    private const string OcclusionUniform = "u_Occlusion";
    private const string AlphaCutoffUniform = "u_AlphaCutoff";
    private const string TilingUniform = "u_Tiling";
    private const string OffsetUniform = "u_Offset";
    private const string LightDirectionUniform = "u_LightDirection";
    private const string LightColorUniform = "u_LightColor";
    private const string LightIntensityUniform = "u_LightIntensity";
    private const string AmbientLightUniform = "u_AmbientLight";
    private const string PointLightPositionUniform = "u_PointLightPosition";
    private const string PointLightColorUniform = "u_PointLightColor";
    private const string PointLightIntensityUniform = "u_PointLightIntensity";
    private const string PointLightRangeUniform = "u_PointLightRange";
    private const string SpotLightPositionUniform = "u_SpotLightPosition";
    private const string SpotLightDirectionUniform = "u_SpotLightDirection";
    private const string SpotLightColorUniform = "u_SpotLightColor";
    private const string SpotLightIntensityUniform = "u_SpotLightIntensity";
    private const string SpotLightRangeUniform = "u_SpotLightRange";
    private const string SpotLightInnerCosUniform = "u_SpotLightInnerCos";
    private const string SpotLightOuterCosUniform = "u_SpotLightOuterCos";
    private const string FogEnabledUniform = "u_FogEnabled";
    private const string FogColorUniform = "u_FogColor";
    private const string FogModeUniform = "u_FogMode";
    private const string FogDensityUniform = "u_FogDensity";
    private const string FogRangeUniform = "u_FogStartEnd";

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;

    /// <summary>Creates a draw executor over a GPU asset cache.</summary>
    public SceneGlDrawExecutor(GLContext context, SceneGlAssetCache assets)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);

        _context = context;
        _assets = assets;
    }

    /// <summary>Fog state bound by the last render call (diagnostics/tests).</summary>
    internal SceneFogState LastFog { get; private set; }

    /// <summary>Renders one pass and returns the submitted draw count.</summary>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneRenderItem> items,
        LightingSelectionState? lighting,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState,
        float elapsedSeconds = 0.0f,
        in SceneFogState fog = default,
        ISceneAreaLightSource? areaLights = null,
        SceneGlReflectionProbeAtlas? probeAtlas = null,
        ISceneReflectionProbeSource? reflectionProbe = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        _context.AssertRenderThread();
        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        LastFog = fog;

        BeginPass(camera, pass);
        ExtractLighting(lighting, out LightingValues lights);

        Mat4 view = camera.ViewMatrix;
        Mat4 projection = camera.ProjectionMatrix;
        Mat4 viewProjection = camera.ViewProjectionMatrix;
        Vec3 cameraPosition = camera.Position;

        int drawCalls = 0;
        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneRenderItem item = ref items[i];

            if (!_assets.TryGetMaterial(item.MaterialId, out SceneGlMaterial? material) ||
                !_assets.TryGetMesh(item.MeshId, out GLMesh? mesh))
            {
                continue;
            }

            SceneGlShader shader = material.Shader;
            shader.Bind();

            Mat4 model = world.GetWorldMatrix3D(item.Actor);
            shader.SetMatrix4(ModelUniform, in model);
            shader.SetMatrix4(ViewUniform, in view);
            shader.SetMatrix4(ProjectionUniform, in projection);
            shader.SetMatrix4(ViewProjectionUniform, in viewProjection);
            shader.SetVec3(CameraPositionUniform, in cameraPosition);
            shader.SetFloat(ElapsedUniform, elapsedSeconds);
            shader.SetBool(ReceiveLightingUniform, item.ReceiveLighting);

            ApplySurface(shader, material.Surface);
            SceneGlMaterialExtensionBinder.Bind(shader, material.Surface);
            ApplyLighting(shader, in lights);
            ApplyFog(shader, in fog);
            ApplyCustomUniforms(shader, material.UniformEntries.Span);
            BindTextures(_context, shader, material.TextureSlots.Span);
            SceneGlAreaLightBinder.Bind(shader, areaLights is null ? default : areaLights.AreaLights);
            if (probeAtlas is not null && reflectionProbe is not null &&
                reflectionProbe.TryGetSelectedProbe(out SceneReflectionProbeRenderItem probe))
            {
                SceneGlReflectionProbeBinder.Bind(_context, shader, probeAtlas, in probe);
            }

            ApplyState(_context, item.Transparent, material, pass);

            int triangles = mesh.Topology == GLConst.Triangles
                ? (mesh.IndexCount > 0 ? mesh.IndexCount / 3 : mesh.VertexCount / 3)
                : 0;

            mesh.Draw();
            frameState.RecordDraw(triangles);
            drawCalls++;
        }

        _context.State.BindVertexArray(0);
        _context.State.UseProgram(0);
        return drawCalls;
    }

    private void BeginPass(SceneCameraFrame camera, SceneRenderPassDefinition pass)
    {
        if ((pass.ClearMask & SceneClearMask.Color) != 0)
        {
            Vec4 color = pass.ClearColor ?? camera.Camera.ClearColor;
            _context.State.SetColorMask(true, true, true, true);
            _context.State.SetClearColor(color.X, color.Y, color.Z, color.W);
            _context.GL.Clear(GLConst.ColorBufferBit);
        }

        if ((pass.ClearMask & SceneClearMask.Depth) != 0)
        {
            float depth = pass.ClearDepth ?? camera.Camera.ClearDepth;
            _context.State.SetDepthMask(true);
            _context.State.SetClearDepth(depth);
            _context.GL.Clear(GLConst.DepthBufferBit);
        }
    }

    internal static void ApplyFog(SceneGlShader shader, in SceneFogState fog)
    {
        shader.SetInt(FogEnabledUniform, fog.Enabled ? 1 : 0);

        if (!fog.Enabled)
        {
            return;
        }

        Vec3 color = fog.Color;
        shader.SetVec3(FogColorUniform, in color);
        shader.SetInt(FogModeUniform, (int)fog.Mode);
        shader.SetFloat(FogDensityUniform, fog.Density);

        var range = new Vec2(fog.RangeStart, fog.RangeEnd);
        shader.SetVec2(FogRangeUniform, in range);
    }

    internal static void ApplySurface(SceneGlShader shader, SceneMaterialSurface surface)
    {
        Vec4 albedo = surface.Albedo;
        Vec3 emissive = surface.Emissive;
        Vec2 tiling = surface.Tiling;
        Vec2 offset = surface.Offset;

        shader.SetVec4(AlbedoUniform, in albedo);
        shader.SetFloat(MetallicUniform, surface.Metallic);
        shader.SetFloat(RoughnessUniform, surface.Roughness);
        shader.SetFloat(NormalScaleUniform, surface.NormalScale);
        shader.SetFloat(OcclusionUniform, surface.Occlusion);
        shader.SetFloat(AlphaCutoffUniform, surface.AlphaCutoff);
        shader.SetVec3(EmissiveUniform, in emissive);
        shader.SetVec2(TilingUniform, in tiling);
        shader.SetVec2(OffsetUniform, in offset);
    }

    internal static void ApplyLighting(SceneGlShader shader, in LightingValues lights)
    {
        shader.SetVec3(LightDirectionUniform, in lights.DirectionalDirection);
        shader.SetVec3(LightColorUniform, in lights.DirectionalColor);
        shader.SetFloat(LightIntensityUniform, lights.DirectionalIntensity);
        shader.SetVec3(AmbientLightUniform, in lights.Ambient);

        shader.SetVec3(PointLightPositionUniform, in lights.PointPosition);
        shader.SetVec3(PointLightColorUniform, in lights.PointColor);
        shader.SetFloat(PointLightIntensityUniform, lights.PointIntensity);
        shader.SetFloat(PointLightRangeUniform, lights.PointRange);

        shader.SetVec3(SpotLightPositionUniform, in lights.SpotPosition);
        shader.SetVec3(SpotLightDirectionUniform, in lights.SpotDirection);
        shader.SetVec3(SpotLightColorUniform, in lights.SpotColor);
        shader.SetFloat(SpotLightIntensityUniform, lights.SpotIntensity);
        shader.SetFloat(SpotLightRangeUniform, lights.SpotRange);
        shader.SetFloat(SpotLightInnerCosUniform, lights.SpotInnerCos);
        shader.SetFloat(SpotLightOuterCosUniform, lights.SpotOuterCos);
    }

    internal static void ApplyCustomUniforms(SceneGlShader shader, ReadOnlySpan<SceneGlUniformEntry> uniforms)
    {
        for (int i = 0; i < uniforms.Length; i++)
        {
            ref readonly SceneGlUniformEntry entry = ref uniforms[i];
            SceneUniformValue value = entry.Value;

            switch (value.Kind)
            {
                case SceneUniformKind.Float:
                    shader.SetFloat(entry.Name, value.X);
                    break;
                case SceneUniformKind.Int:
                    shader.SetInt(entry.Name, value.I);
                    break;
                case SceneUniformKind.UInt:
                    shader.SetUInt(entry.Name, value.U);
                    break;
                case SceneUniformKind.Bool:
                    shader.SetBool(entry.Name, value.B);
                    break;
                case SceneUniformKind.Vec2:
                    {
                        Vec2 vector = new(value.X, value.Y);
                        shader.SetVec2(entry.Name, in vector);
                        break;
                    }
                case SceneUniformKind.Vec3:
                    {
                        Vec3 vector = new(value.X, value.Y, value.Z);
                        shader.SetVec3(entry.Name, in vector);
                        break;
                    }
                case SceneUniformKind.Vec4:
                    {
                        Vec4 vector = new(value.X, value.Y, value.Z, value.W);
                        shader.SetVec4(entry.Name, in vector);
                        break;
                    }
                default:
                    break;
            }
        }
    }

    internal static void BindTextures(GLContext context, SceneGlShader shader, ReadOnlySpan<SceneGlTextureSlot> slots)
    {
        for (int i = 0; i < slots.Length; i++)
        {
            ref readonly SceneGlTextureSlot slot = ref slots[i];
            uint unit = (uint)slot.Unit;
            context.State.BindTexture2D(unit, slot.Texture.Id);
            context.State.BindSampler(unit, slot.Sampler.Id);
            shader.SetInt(slot.UniformName, slot.Unit);
        }
    }

    internal static void ApplyState(
        GLContext context,
        bool transparent,
        SceneGlMaterial material,
        SceneRenderPassDefinition pass)
    {
        SceneMaterialPass? materialPass = material.PrimaryPass;

        bool depthTest = materialPass?.DepthTest ?? pass.DepthTest ?? true;
        bool depthWrite = materialPass?.DepthWrite ?? !transparent;
        bool cull = materialPass?.Cull ?? pass.Cull ?? true;
        context.State.SetDepthTest(depthTest);
        context.State.SetDepthMask(depthWrite);
        context.State.SetCullFace(cull);
        context.State.SetCullMode(GLConst.Back);
        SceneGlBlendMapping mapping = SceneGlBlendStateMapper.Resolve(material, pass, transparent);
        context.State.SetBlend(mapping.Enabled);

        if (mapping.Enabled)
        {
            context.State.SetBlendFuncSeparate(
                mapping.SourceColor,
                mapping.DestinationColor,
                mapping.SourceAlpha,
                mapping.DestinationAlpha);
            context.State.SetBlendEquationSeparate(mapping.ColorEquation, mapping.AlphaEquation);
        }
    }

    internal static void ExtractLighting(
        LightingSelectionState? lighting,
        out LightingValues values)
    {
        values = default;
        if (lighting is null)
        {
            return;
        }

        LightingStats stats = lighting.Stats;
        values.Ambient = lighting.Environment.Ambient;

        if (stats.SelectedDirectionalCount > 0)
        {
            ReadOnlySpan<float> directions = lighting.DirectionalDirections.Span;
            ReadOnlySpan<float> colors = lighting.DirectionalColors.Span;
            ReadOnlySpan<float> intensities = lighting.DirectionalIntensities.Span;

            values.DirectionalDirection = new Vec3(directions[0], directions[1], directions[2]);
            values.DirectionalColor = new Vec3(colors[0], colors[1], colors[2]);
            values.DirectionalIntensity = intensities[0];
        }

        if (stats.SelectedPointCount > 0)
        {
            ReadOnlySpan<float> positions = lighting.PointPositions.Span;
            ReadOnlySpan<float> colors = lighting.PointColors.Span;
            ReadOnlySpan<float> intensities = lighting.PointIntensities.Span;
            ReadOnlySpan<float> ranges = lighting.PointRanges.Span;

            values.PointPosition = new Vec3(positions[0], positions[1], positions[2]);
            values.PointColor = new Vec3(colors[0], colors[1], colors[2]);
            values.PointIntensity = intensities[0];
            values.PointRange = ranges[0];
        }

        if (stats.SelectedSpotCount > 0)
        {
            ReadOnlySpan<float> positions = lighting.SpotPositions.Span;
            ReadOnlySpan<float> directions = lighting.SpotDirections.Span;
            ReadOnlySpan<float> colors = lighting.SpotColors.Span;
            ReadOnlySpan<float> intensities = lighting.SpotIntensities.Span;
            ReadOnlySpan<float> ranges = lighting.SpotRanges.Span;
            ReadOnlySpan<float> inner = lighting.SpotInnerConeCosines.Span;
            ReadOnlySpan<float> outer = lighting.SpotOuterConeCosines.Span;

            values.SpotPosition = new Vec3(positions[0], positions[1], positions[2]);
            values.SpotDirection = new Vec3(directions[0], directions[1], directions[2]);
            values.SpotColor = new Vec3(colors[0], colors[1], colors[2]);
            values.SpotIntensity = intensities[0];
            values.SpotRange = ranges[0];
            values.SpotInnerCos = inner[0];
            values.SpotOuterCos = outer[0];
        }
    }

    internal struct LightingValues
    {
        public Vec3 Ambient;
        public Vec3 DirectionalDirection;
        public Vec3 DirectionalColor;
        public float DirectionalIntensity;
        public Vec3 PointPosition;
        public Vec3 PointColor;
        public float PointIntensity;
        public float PointRange;
        public Vec3 SpotPosition;
        public Vec3 SpotDirection;
        public Vec3 SpotColor;
        public float SpotIntensity;
        public float SpotRange;
        public float SpotInnerCos;
        public float SpotOuterCos;
    }
}
