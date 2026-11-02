namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// GPU skinning renderer that preserves the standard material pipeline: the
/// material's own fragment shader, every texture slot, surface/lighting/fog and
/// custom uniforms, and pass state are all bound exactly as the mesh executor
/// does. Skinning is injected into the material vertex shader through a bone
/// texture. Configuration, failures and their reasons are explicit through
/// <see cref="SceneSkinningOptions"/> and <see cref="Diagnostics"/>.
/// </summary>
public sealed class SceneGlSkinnedMeshRenderer : IDisposable
{
    /// <summary>Default bone budget.</summary>
    public const int DefaultMaxBones = 256;

    /// <summary>Default reserved bone texture unit.</summary>
    public const int DefaultTextureUnit = 15;

    /// <summary>Maximum bones of the default configuration.</summary>
    public const int MaxBones = DefaultMaxBones;

    /// <summary>Texture unit reserved by the default configuration.</summary>
    public const int BoneTextureUnit = DefaultTextureUnit;

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly ISceneBonePaletteSource _palettes;
    private readonly SceneSkinningOptions _options;
    private readonly GLTexture _boneTexture;
    private readonly int _boneTextureUnit;
    private bool _disposed;

    private int _drawn;
    private int _skipped;
    private int _missingMesh;
    private int _missingMaterial;
    private int _unskinnableMaterial;
    private int _missingPalette;
    private int _emptyPalette;
    private int _paletteOverflow;
    private int _missingSkinAttributes;
    private int _textureUnitConflict;
    private SceneSkinningFailureReason _lastFailure;

    /// <summary>Creates the skinning renderer and allocates the bone texture.</summary>
    /// <param name="context">Render-thread GL context.</param>
    /// <param name="assets">Uploaded GPU asset cache.</param>
    /// <param name="palettes">Bone palette source.</param>
    /// <param name="options">Skinning configuration; defaults are 256 bones on unit 15.</param>
    public SceneGlSkinnedMeshRenderer(
        GLContext context,
        SceneGlAssetCache assets,
        ISceneBonePaletteSource palettes,
        SceneSkinningOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        ArgumentNullException.ThrowIfNull(palettes);

        _options = options ?? SceneSkinningOptions.Default;
        _options.Validate(context);

        _context = context;
        _assets = assets;
        _palettes = palettes;
        _boneTextureUnit = _options.TextureUnit;
        _boneTexture = new GLTexture(
            context,
            GLConst.Texture2D,
            TextureFormat.Rgba32f,
            _options.MaxBones * SkinningShaderInjector.BoneTexelsPerBone,
            1,
            depth: 1,
            mipLevels: 1,
            "scene-skin-bones");
        _boneTexture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Nearest);
        _boneTexture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Nearest);
        _boneTexture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
        _boneTexture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);
    }

    /// <summary>Gets the active configuration.</summary>
    public SceneSkinningOptions Options => _options;

    /// <summary>Gets the diagnostics of the last render call.</summary>
    public SceneSkinningDiagnostics Diagnostics => new(
        _drawn,
        _skipped,
        _missingMesh,
        _missingMaterial,
        _unskinnableMaterial,
        _missingPalette,
        _emptyPalette,
        _paletteOverflow,
        _missingSkinAttributes,
        _textureUnitConflict,
        _lastFailure);

    /// <summary>Gets the reason of the last skipped or failed batch.</summary>
    public SceneSkinningFailureReason LastFailure => _lastFailure;

    /// <summary>Draw calls issued by the last render call.</summary>
    public int LastDrawCalls { get; private set; }

    /// <summary>Bone count of the last submitted palette.</summary>
    public int LastBoneCount { get; private set; }

    /// <summary>Batches skipped by the last render call.</summary>
    public int SkippedBatches => _skipped;

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
        ResetDiagnostics();
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

        for (int i = 0; i < items.Length; i++)
        {
            ref readonly SceneSkinnedMeshRenderItem item = ref items[i];

            if (!_assets.TryGetMesh(item.MeshId, out GLMesh? mesh))
            {
                Fail(SceneSkinningFailureReason.MissingMesh, $"mesh '{item.MeshId}' is not uploaded.");
                continue;
            }

            if (!_assets.TryGetMaterial(item.MaterialId, out SceneGlMaterial? material))
            {
                Fail(SceneSkinningFailureReason.MissingMaterial, $"material '{item.MaterialId}' is not uploaded.");
                continue;
            }

            if (UsesReservedTextureUnit(material))
            {
                FailTextureUnitConflict(material);
                continue;
            }

            if (material.SkinnedShader is not { } shader)
            {
                Fail(
                    SceneSkinningFailureReason.UnskinnableMaterial,
                    DescribeUnskinnableMaterial(material));
                continue;
            }

            if (!_palettes.TryGetBonePalette(item.Actor, out ReadOnlySpan<Mat4> palette))
            {
                Fail(SceneSkinningFailureReason.MissingPalette, $"actor '{item.Actor}' has no bone palette.");
                continue;
            }

            if (palette.IsEmpty)
            {
                Fail(SceneSkinningFailureReason.EmptyPalette, $"actor '{item.Actor}' has an empty bone palette.");
                continue;
            }

            if (palette.Length > _options.MaxBones)
            {
                Fail(
                    SceneSkinningFailureReason.PaletteOverflow,
                    $"palette has {palette.Length} bones but the budget is {_options.MaxBones}.");
                continue;
            }

            if (!HasSkinAttributes(mesh))
            {
                Fail(
                    SceneSkinningFailureReason.MissingSkinAttributes,
                    $"mesh '{item.MeshId}' lacks position/joint/weight attributes.");
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

            _context.State.BindTexture2D((uint)_boneTextureUnit, _boneTexture.Id);
            _context.State.BindSampler((uint)_boneTextureUnit, 0);
            shader.SetInt(SkinningShaderInjector.BoneTextureUniform, _boneTextureUnit);
            shader.SetInt(SkinningShaderInjector.BoneCountUniform, palette.Length);

            SceneGlDrawExecutor.ApplyState(_context, item.Transparent, material, pass);

            mesh.Draw();

            int triangles = (mesh.IsIndexed ? mesh.IndexCount : mesh.VertexCount) / 3;
            frameState.RecordDraw(triangles, 1);
            _drawn++;
            LastBoneCount = palette.Length;
            LastTextureSlotCount = material.TextureSlots.Length;
            LastCustomUniformCount = material.UniformEntries.Length;
        }

        _context.State.BindVertexArray(0);
        _context.State.UseProgram(0);
        LastDrawCalls = _drawn;
        return _drawn;
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

    private void ResetDiagnostics()
    {
        LastDrawCalls = 0;
        LastBoneCount = 0;
        LastTextureSlotCount = 0;
        LastCustomUniformCount = 0;
        _drawn = 0;
        _skipped = 0;
        _missingMesh = 0;
        _missingMaterial = 0;
        _unskinnableMaterial = 0;
        _missingPalette = 0;
        _emptyPalette = 0;
        _paletteOverflow = 0;
        _missingSkinAttributes = 0;
        _textureUnitConflict = 0;
        _lastFailure = SceneSkinningFailureReason.None;
    }

    private void Fail(SceneSkinningFailureReason reason, string message)
    {
        _skipped++;
        _lastFailure = reason;

        switch (reason)
        {
            case SceneSkinningFailureReason.MissingMesh:
                _missingMesh++;
                break;
            case SceneSkinningFailureReason.MissingMaterial:
                _missingMaterial++;
                break;
            case SceneSkinningFailureReason.UnskinnableMaterial:
                _unskinnableMaterial++;
                break;
            case SceneSkinningFailureReason.MissingPalette:
                _missingPalette++;
                break;
            case SceneSkinningFailureReason.EmptyPalette:
                _emptyPalette++;
                break;
            case SceneSkinningFailureReason.PaletteOverflow:
                _paletteOverflow++;
                break;
            case SceneSkinningFailureReason.MissingSkinAttributes:
                _missingSkinAttributes++;
                break;
            default:
                break;
        }

        if (_options.FailureMode == SceneSkinningFailureMode.Throw)
        {
            ThrowFailure(reason, message);
        }
    }

    private void FailTextureUnitConflict(SceneGlMaterial material)
    {
        _skipped++;
        _textureUnitConflict++;
        _lastFailure = SceneSkinningFailureReason.TextureUnitConflict;
        ThrowFailure(
            SceneSkinningFailureReason.TextureUnitConflict,
            $"material '{material.Definition.Id}' uses reserved skinning texture unit {_boneTextureUnit}.");
    }

    private string DescribeUnskinnableMaterial(SceneGlMaterial material)
    {
        string reason = _assets.TryGetSkinningDiagnostic(material.Definition.ShaderId, out SkinningShaderDiagnostic diagnostic)
            ? diagnostic.Failure.ToString()
            : "Unknown";
        return $"material '{material.Definition.Id}' shader '{material.Definition.ShaderId}' cannot be skinned: {reason}.";
    }

    private bool UsesReservedTextureUnit(SceneGlMaterial material)
    {
        ReadOnlySpan<SceneGlTextureSlot> slots = material.TextureSlots.Span;
        for (int i = 0; i < slots.Length; i++)
        {
            if (slots[i].Unit == _boneTextureUnit)
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

    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ThrowFailure(SceneSkinningFailureReason reason, string message) =>
        throw new SceneConfigurationException($"Skinning {reason}: {message}");

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlSkinnedMeshRenderer));
        }
    }
}
