namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// GPU skinning renderer that preserves the standard material pipeline: the
/// material's own fragment shader, every texture slot, surface/lighting/fog and
/// custom uniforms, and pass state are all bound exactly as the mesh executor
/// does. Skinning is injected into the material vertex shader through a bone
/// texture, which raises the budget from a uniform array to 256 bones.
/// </summary>
public sealed class SceneGlSkinnedMeshRenderer : IDisposable
{
    /// <summary>Maximum bones addressable through the bone texture.</summary>
    public const int MaxBones = 256;

    /// <summary>Texture unit reserved for the bone palette; material slots must not use it.</summary>
    public const int BoneTextureUnit = 15;

    private const int BoneTextureWidth = MaxBones * SkinningShaderInjector.BoneTexelsPerBone;

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly ISceneBonePaletteSource _palettes;
    private readonly GLTexture _boneTexture;
    private bool _disposed;

    /// <summary>Creates the skinning renderer and allocates the bone texture.</summary>
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
        _boneTexture = new GLTexture(
            context,
            GLConst.Texture2D,
            TextureFormat.Rgba32f,
            BoneTextureWidth,
            1,
            depth: 1,
            mipLevels: 1,
            "scene-skin-bones");
        _boneTexture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Nearest);
        _boneTexture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Nearest);
        _boneTexture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
        _boneTexture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);
    }

    /// <summary>Draw calls issued by the last render call.</summary>
    public int LastDrawCalls { get; private set; }

    /// <summary>Bone count of the last submitted palette.</summary>
    public int LastBoneCount { get; private set; }

    /// <summary>Batches skipped for missing assets, palettes, skin attributes or an unskinnable material.</summary>
    public int SkippedBatches { get; private set; }

    /// <summary>Texture slots bound by the last submitted material.</summary>
    public int LastTextureSlotCount { get; private set; }

    /// <summary>Custom uniforms bound by the last submitted material.</summary>
    public int LastCustomUniformCount { get; private set; }

    /// <summary>Whether the last render call bound a resolved lighting selection.</summary>
    public bool LastLightingBound { get; private set; }

    /// <summary>Renders skinned batches through the material pipeline and returns the draw count.</summary>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneSkinnedMeshRenderItem> items,
        LightingSelectionState? lighting,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState,
        float elapsedSeconds = 0.0f,
        in SceneFogState fog = default)
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
        LastTextureSlotCount = 0;
        LastCustomUniformCount = 0;
        LastLightingBound = lighting is not null;

        if (items.Length == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        SceneGlDrawExecutor.ExtractLighting(lighting, out SceneGlDrawExecutor.LightingValues lights);

        Mat4 view = camera.ViewMatrix;
        Mat4 projection = camera.ProjectionMatrix;
        Mat4 viewProjection = camera.ViewProjectionMatrix;
        Vec3 cameraPosition = camera.Position;
        int drawCalls = 0;

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneSkinnedMeshRenderItem item = ref items[i];
            if (!_assets.TryGetMesh(item.MeshId, out GLMesh? mesh) ||
                !_assets.TryGetMaterial(item.MaterialId, out SceneGlMaterial? material) ||
                material.SkinnedShader is not { } shader ||
                !_palettes.TryGetBonePalette(item.Actor, out ReadOnlySpan<Mat4> palette) ||
                palette.IsEmpty ||
                palette.Length > MaxBones ||
                !HasSkinAttributes(mesh) ||
                UsesReservedTextureUnit(material))
            {
                SkippedBatches++;
                continue;
            }

            _boneTexture.UploadSubData2D(
                MemoryMarshal.AsBytes(palette),
                0,
                0,
                palette.Length * SkinningShaderInjector.BoneTexelsPerBone,
                1);

            shader.Bind();

            Mat4 model = world.GetWorldMatrix3D(item.Actor);
            shader.SetMatrix4(SceneGlDrawExecutor.ModelUniform, in model);
            shader.SetMatrix4(SceneGlDrawExecutor.ViewUniform, in view);
            shader.SetMatrix4(SceneGlDrawExecutor.ProjectionUniform, in projection);
            shader.SetMatrix4(SceneGlDrawExecutor.ViewProjectionUniform, in viewProjection);
            shader.SetVec3(SceneGlDrawExecutor.CameraPositionUniform, in cameraPosition);
            shader.SetFloat(SceneGlDrawExecutor.ElapsedUniform, elapsedSeconds);
            shader.SetBool(SceneGlDrawExecutor.ReceiveLightingUniform, item.ReceiveLighting);

            SceneGlDrawExecutor.ApplySurface(shader, material.Surface);
            SceneGlDrawExecutor.ApplyLighting(shader, in lights);
            SceneGlDrawExecutor.ApplyFog(shader, in fog);
            SceneGlDrawExecutor.ApplyCustomUniforms(shader, material.UniformEntries.Span);
            SceneGlDrawExecutor.BindTextures(_context, shader, material.TextureSlots.Span);

            _context.State.BindTexture2D(BoneTextureUnit, _boneTexture.Id);
            _context.State.BindSampler(BoneTextureUnit, 0);
            shader.SetInt(SkinningShaderInjector.BoneTextureUniform, BoneTextureUnit);
            shader.SetInt(SkinningShaderInjector.BoneCountUniform, palette.Length);

            SceneGlDrawExecutor.ApplyState(_context, item.Transparent, material, pass);

            mesh.Draw();

            int triangles = (mesh.IsIndexed ? mesh.IndexCount : mesh.VertexCount) / 3;
            frameState.RecordDraw(triangles, 1);
            drawCalls++;
            LastBoneCount = palette.Length;
            LastTextureSlotCount = material.TextureSlots.Length;
            LastCustomUniformCount = material.UniformEntries.Length;
        }

        _context.State.BindVertexArray(0);
        _context.State.UseProgram(0);
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

        _boneTexture.Dispose();
        _disposed = true;
    }

    private static bool UsesReservedTextureUnit(SceneGlMaterial material)
    {
        ReadOnlySpan<SceneGlTextureSlot> slots = material.TextureSlots.Span;
        for (int i = 0; i < slots.Length; i++)
        {
            if (slots[i].Unit == BoneTextureUnit)
            {
                return true;
            }
        }

        return false;
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

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlSkinnedMeshRenderer));
        }
    }
}
