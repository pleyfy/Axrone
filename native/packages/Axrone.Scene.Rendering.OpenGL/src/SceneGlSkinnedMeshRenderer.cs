namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// GPU skinning renderer. Vertices carry joint indices and weights at the
/// semantic locations 6 and 7 assigned by the asset cache; the composed bone
/// palette is uploaded as a matrix array before each draw. The material supplies
/// only its first texture slot; lighting and custom uniforms stay with the
/// standard mesh path.
/// </summary>
public sealed class SceneGlSkinnedMeshRenderer : IDisposable
{
    /// <summary>Maximum bones addressable by the skinning shader.</summary>
    public const int MaxBones = 64;

    private const string ModelUniform = "u_Model";
    private const string ViewProjectionUniform = "u_ViewProjection";
    private const string BonesUniform = "u_Bones";
    private const string TextureUniform = "u_Texture";
    private const string HasTextureUniform = "u_HasTexture";

    private const string VertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 2) in vec2 a_Uv;
        layout(location = 6) in ivec4 a_Joints;
        layout(location = 7) in vec4 a_Weights;

        uniform mat4 u_Model;
        uniform mat4 u_ViewProjection;
        uniform mat4 u_Bones[64];

        out vec2 v_Uv;

        void main()
        {
            mat4 skin =
                u_Bones[a_Joints.x] * a_Weights.x +
                u_Bones[a_Joints.y] * a_Weights.y +
                u_Bones[a_Joints.z] * a_Weights.z +
                u_Bones[a_Joints.w] * a_Weights.w;

            gl_Position = vec4(a_Position, 1.0) * skin * u_Model * u_ViewProjection;
            v_Uv = a_Uv;
        }
        """;

    private const string FragmentShaderSource = """
        #version 330 core
        in vec2 v_Uv;

        uniform sampler2D u_Texture;
        uniform int u_HasTexture;

        out vec4 fragColor;

        void main()
        {
            vec4 albedo = u_HasTexture != 0 ? texture(u_Texture, v_Uv) : vec4(1.0, 1.0, 1.0, 1.0);
            fragColor = albedo;
        }
        """;

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly ISceneBonePaletteSource _palettes;
    private readonly SceneGlShader _shader;
    private bool _disposed;

    /// <summary>Creates the skinning renderer.</summary>
    public SceneGlSkinnedMeshRenderer(
        GLContext context,
        SceneGlAssetCache assets,
        ISceneBonePaletteSource palettes)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(palettes);

        _context = context;
        _assets = assets;
        _palettes = palettes;
        _shader = new SceneGlShader(context, "scene-skinned-mesh", VertexShaderSource, FragmentShaderSource);
    }

    /// <summary>Draw calls issued by the last render call.</summary>
    public int LastDrawCalls { get; private set; }

    /// <summary>Bone count of the last submitted palette.</summary>
    public int LastBoneCount { get; private set; }

    /// <summary>Batches skipped for missing assets, palettes or skin attributes.</summary>
    public int SkippedBatches { get; private set; }

    /// <summary>Renders skinned batches and returns the draw-call count.</summary>
    public unsafe int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneSkinnedMeshRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        _context.AssertRenderThread();
        LastDrawCalls = 0;
        LastBoneCount = 0;
        SkippedBatches = 0;

        if (items.Length == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        ApplyState(pass);

        _shader.Bind();
        _shader.SetMatrix4(ViewProjectionUniform, camera.ViewProjectionMatrix);

        int boneLocation = _shader.GetUniformLocation(BonesUniform);
        int drawCalls = 0;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneSkinnedMeshRenderItem item = ref items[i];
            if (!_assets.TryGetMesh(item.MeshId, out GLMesh? mesh) ||
                !_assets.TryGetMaterial(item.MaterialId, out SceneGlMaterial? material) ||
                !_palettes.TryGetBonePalette(item.Actor, out ReadOnlySpan<Mat4> palette) ||
                palette.IsEmpty ||
                palette.Length > MaxBones ||
                !HasSkinAttributes(mesh))
            {
                SkippedBatches++;
                continue;
            }

            _shader.SetMatrix4(ModelUniform, world.GetWorldMatrix3D(item.Actor));

            bool hasTexture = material.TextureSlots.Length > 0;
            _shader.SetInt(HasTextureUniform, hasTexture ? 1 : 0);
            if (hasTexture)
            {
                SceneGlTextureSlot slot = material.TextureSlots.Span[0];
                _context.State.BindTexture2D((uint)slot.Unit, slot.Texture.Id);
                _ = slot.Sampler.Bind((uint)slot.Unit);
                _shader.SetInt(TextureUniform, slot.Unit);
            }

            fixed (Mat4* pointer = palette)
            {
                _context.GL.UniformMatrix4(boneLocation, (uint)palette.Length, false, (float*)pointer);
            }

            mesh.Draw();
            _context.State.BindVertexArray(0);

            int triangles = (mesh.IsIndexed ? mesh.IndexCount : mesh.VertexCount) / 3;
            frameState.RecordDraw(triangles, 1);
            drawCalls++;
            LastBoneCount = palette.Length;
        }

        LastDrawCalls = drawCalls;
        return drawCalls;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _shader.Dispose();
        _disposed = true;
    }

    private static bool HasSkinAttributes(GLMesh mesh)
    {
        bool hasPosition = false;
        bool hasJoints = false;
        bool hasWeights = false;

        ReadOnlySpan<VertexAttribute> attributes = mesh.Layout.Attributes;
        for (int i = 0; i < attributes.Length; i++)
        {
            VertexAttribute attribute = attributes[i];
            if (attribute.Location == 0 && attribute.ComponentCount >= 3)
            {
                hasPosition = true;
            }
            else if (attribute.Location == 6 && attribute.ComponentCount == 4)
            {
                hasJoints = true;
            }
            else if (attribute.Location == 7 && attribute.ComponentCount == 4)
            {
                hasWeights = true;
            }
        }

        return hasPosition && hasJoints && hasWeights;
    }

    private void ApplyState(SceneRenderPassDefinition pass)
    {
        bool depthTest = pass.DepthTest ?? true;
        bool blend = pass.Blend ?? true;

        _context.State.SetDepthTest(depthTest);
        _context.State.SetDepthMask(depthTest);
        _context.State.SetCullFace(pass.Cull ?? true);
        _context.State.SetCullMode(GLConst.Back);
        _context.State.SetBlend(blend);

        if (blend)
        {
            _context.State.SetBlendFuncSeparate(
                GLConst.SrcAlpha,
                GLConst.OneMinusSrcAlpha,
                GLConst.One,
                GLConst.OneMinusSrcAlpha);
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlSkinnedMeshRenderer));
        }
    }
}
