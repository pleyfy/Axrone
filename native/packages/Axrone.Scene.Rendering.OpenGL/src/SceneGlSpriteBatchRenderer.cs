namespace Axrone.Scene.Rendering.OpenGL;

using Axrone.Render2D;

/// <summary>Why one sprite batch was rejected before a draw was issued.</summary>
public enum SceneGlSpriteMaterialFailure
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>The material id is not registered in the asset cache.</summary>
    MissingMaterial = 1,

    /// <summary>The material shader is not the Render2D sprite contract shader.</summary>
    UnsupportedShader = 2,
}

/// <summary>
/// Batched sprite renderer driven by <see cref="Render2DSpriteBatchBuilder"/>.
/// The scene collector feeds planning records; the renderer converts them into
/// renderer-independent submissions, lets the builder expand and batch them,
/// uploads the builder's 16-byte vertices and 16/32-bit indices, and draws one
/// range per batch. Long unsliced runs go through the instanced fast path;
/// sliced or masked runs always use the builder's expanded geometry.
/// </summary>
public sealed class SceneGlSpriteBatchRenderer : IDisposable
{
    private const int InitialVertexBytes = 64 * 1024;
    private const int InitialIndexCount = 16 * 1024;
    private const int InitialInstanceCapacity = 256;
    private const int InstanceStride = 112;

    private const string MaterialTintUniform = "u_MaterialTint";
    private const string MaskInvertUniform = "u_MaskInvert";
    private const string MaskFeatherUniform = "u_MaskFeather";

    private static readonly SceneAssetId<ShaderAssetTag> SpriteShaderId =
        SceneAssetId<ShaderAssetTag>.FromName(Render2DSpriteShaderContract.DefaultShaderId);

    private const string MaskFunctionSource = """
        uniform int u_MaskShape;
        uniform mat4 u_MaskWorldToLocal;
        uniform vec2 u_MaskSize;
        uniform vec2 u_MaskAnchor;
        uniform float u_MaskCornerRadius;
        uniform float u_MaskInvert;
        uniform float u_MaskFeather;

        float roundedRectSdf(vec2 p, vec2 size, float radius)
        {
            vec2 q = abs(p - (size * 0.5)) - ((size * 0.5) - radius);
            return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        }

        float evaluateMask(vec3 worldPosition)
        {
            if (u_MaskShape == 0)
            {
                return 1.0;
            }

            vec2 localPosition = (u_MaskWorldToLocal * vec4(worldPosition, 1.0)).xy;
            float feather = max(u_MaskFeather, 1e-4);
            float inside;
            if (u_MaskShape == 1)
            {
                vec2 maskMin = -u_MaskAnchor * u_MaskSize;
                vec2 maskCenter = maskMin + (u_MaskSize * 0.5);
                vec2 radius = max(u_MaskSize * 0.5, vec2(0.000001));
                vec2 normalized = (localPosition - maskCenter) / radius;
                inside = 1.0 - smoothstep(1.0, 1.0 + feather, length(normalized));
            }
            else
            {
                vec2 maskMin = -u_MaskAnchor * u_MaskSize;
                float radius = clamp(u_MaskCornerRadius, 0.0, min(u_MaskSize.x, u_MaskSize.y) * 0.5);
                float sdf = roundedRectSdf(localPosition - maskMin, u_MaskSize, radius);
                inside = 1.0 - smoothstep(0.0, feather, sdf);
            }

            return u_MaskInvert > 0.5 ? 1.0 - inside : inside;
        }
        """;

    private const string ImmediateVertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec2 a_Position;
        layout(location = 2) in vec2 a_UV0;
        layout(location = 3) in vec4 a_Color0;

        uniform mat4 u_ViewProjection;
        uniform vec4 u_MaterialTint;

        out vec2 v_UV0;
        out vec4 v_Color0;
        out vec3 v_WorldPosition;

        void main()
        {
            v_UV0 = a_UV0;
            v_Color0 = a_Color0 * u_MaterialTint;
            v_WorldPosition = vec3(a_Position, 0.0);
            gl_Position = vec4(a_Position, 0.0, 1.0) * u_ViewProjection;
        }
        """;

    private const string FragmentHeaderSource = """
        #version 330 core
        in vec2 v_UV0;
        in vec4 v_Color0;
        in vec3 v_WorldPosition;

        uniform sampler2D u_MainTex;

        out vec4 o_Color;

        """;

    private const string FragmentBodySource = """
        void main()
        {
            float mask = evaluateMask(v_WorldPosition);
            if (mask <= 0.0)
            {
                discard;
            }

            o_Color = texture(u_MainTex, v_UV0) * v_Color0;
        }
        """;

    private const string InstancedVertexShaderSource = """
        #version 330 core
        layout(location = 0) in vec2 a_Corner;
        layout(location = 1) in vec4 a_Row0;
        layout(location = 2) in vec4 a_Row1;
        layout(location = 3) in vec4 a_Row2;
        layout(location = 4) in vec4 a_Row3;
        layout(location = 5) in vec4 a_Color;
        layout(location = 6) in vec4 a_UvRect;
        layout(location = 7) in vec4 a_Geometry;

        uniform mat4 u_ViewProjection;
        uniform vec4 u_MaterialTint;

        out vec2 v_UV0;
        out vec4 v_Color0;
        out vec3 v_WorldPosition;

        void main()
        {
            vec2 local = (a_Corner - a_Geometry.zw) * a_Geometry.xy;
            mat4 model = mat4(a_Row0, a_Row1, a_Row2, a_Row3);
            vec4 world = vec4(local, 0.0, 1.0) * model;
            v_UV0 = a_UvRect.xy + (a_Corner * a_UvRect.zw);
            v_Color0 = a_Color * u_MaterialTint;
            v_WorldPosition = world.xyz;
            gl_Position = world * u_ViewProjection;
        }
        """;

    private const string ImmediateFragmentShaderSource =
        FragmentHeaderSource + MaskFunctionSource + "\n" + FragmentBodySource;

    private const string InstancedFragmentShaderSource =
        FragmentHeaderSource + MaskFunctionSource + "\n" + FragmentBodySource;

    private static readonly VertexAttribute[] s_immediateLayout = BuildImmediateLayout();
    private static readonly VertexAttribute[] s_quadLayout =
    [
        new VertexAttribute(0, 2, GLConst.Float, false, 8, 0, 0, false),
    ];

    private static readonly QuadCorner[] s_quadCorners =
    [
        new QuadCorner(new Vec2(0.0f, 0.0f)),
        new QuadCorner(new Vec2(1.0f, 0.0f)),
        new QuadCorner(new Vec2(1.0f, 1.0f)),
        new QuadCorner(new Vec2(0.0f, 1.0f)),
    ];

    private static readonly uint[] s_quadIndices = [0u, 1u, 2u, 0u, 2u, 3u];

    private readonly GLContext _context;
    private readonly SceneGlAssetCache _assets;
    private readonly int _minInstancesForFastPath;
    private readonly Render2DSpriteBatchBuilder _builder = new(new Render2DSpriteBatchBuilderOptions { MaxBatchQuads = 2048 });

    private readonly SceneGlShader _shader;
    private readonly GLBuffer _vertexBuffer;
    private readonly GLBuffer _indexBuffer16;
    private readonly GLBuffer _indexBuffer32;
    private readonly GLVertexArray _vao16;
    private readonly GLVertexArray _vao32;

    private readonly SceneGlShader _instancedShader;
    private readonly GLVertexArray _instancedVao;
    private readonly GLBuffer _quadBuffer;
    private readonly GLBuffer _quadIndexBuffer;
    private readonly GLBuffer _instanceBuffer;

    private Render2DSpriteSubmission[] _submissions;
    private SpriteInstance[] _instances;
    private bool _disposed;

    /// <summary>Creates a sprite batch renderer over an uploaded asset cache.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets)
        : this(context, assets, SceneSpriteBatchPlanner.DefaultMinInstancesForFastPath)
    {
    }

    /// <summary>Creates a sprite batch renderer with an explicit fast-path threshold.</summary>
    public SceneGlSpriteBatchRenderer(GLContext context, SceneGlAssetCache assets, int minInstancesForFastPath)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);
        if (minInstancesForFastPath <= 0)
        {
            throw new SceneConfigurationException(
                $"Sprite instancing threshold must be positive; received {minInstancesForFastPath}.");
        }

        _context = context;
        _assets = assets;
        _minInstancesForFastPath = minInstancesForFastPath;
        _submissions = new Render2DSpriteSubmission[64];
        _instances = GC.AllocateArray<SpriteInstance>(InitialInstanceCapacity, pinned: true);

        _shader = new SceneGlShader(context, "scene-sprite-batch", ImmediateVertexShaderSource, ImmediateFragmentShaderSource);
        _instancedShader = new SceneGlShader(context, "scene-sprite-batch-instanced", InstancedVertexShaderSource, InstancedFragmentShaderSource);
        _vertexBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, InitialVertexBytes, "scene-sprite-vertices");
        _indexBuffer16 = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.DynamicDraw, InitialIndexCount * sizeof(ushort), "scene-sprite-indices16");
        _indexBuffer32 = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.DynamicDraw, InitialIndexCount * sizeof(uint), "scene-sprite-indices32");
        _vao16 = new GLVertexArray(context, "scene-sprite-batch16");
        _vao16.ConfigureLayout(_vertexBuffer, _indexBuffer16, s_immediateLayout, 0, 0, GLConst.UnsignedShort);
        _vao32 = new GLVertexArray(context, "scene-sprite-batch32");
        _vao32.ConfigureLayout(_vertexBuffer, _indexBuffer32, s_immediateLayout, 0, 0, GLConst.UnsignedInt);

        _quadBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.StaticDraw, s_quadCorners.Length * 8, "scene-sprite-quad");
        _quadIndexBuffer = new GLBuffer(context, GLConst.ElementArrayBuffer, GLConst.StaticDraw, s_quadIndices.Length * sizeof(uint), "scene-sprite-quad-indices");
        _instanceBuffer = new GLBuffer(context, GLConst.ArrayBuffer, GLConst.DynamicDraw, InitialInstanceCapacity * InstanceStride, "scene-sprite-instances");
        _instancedVao = new GLVertexArray(context, "scene-sprite-batch-instanced");
        _instancedVao.ConfigureLayout(_quadBuffer, _quadIndexBuffer, s_quadLayout, s_quadCorners.Length, s_quadIndices.Length, GLConst.UnsignedInt);

        if (Unsafe.SizeOf<SpriteInstance>() != InstanceStride)
        {
            _instancedVao.Dispose();
            _instanceBuffer.Dispose();
            _quadIndexBuffer.Dispose();
            _quadBuffer.Dispose();
            _vao32.Dispose();
            _vao16.Dispose();
            _indexBuffer32.Dispose();
            _indexBuffer16.Dispose();
            _vertexBuffer.Dispose();
            _instancedShader.Dispose();
            _shader.Dispose();
            throw new SceneConfigurationException(
                $"Sprite instance layout must be 112 bytes; measured {InstanceStride}.");
        }

        UploadQuadGeometry();
        ConfigureInstanceAttributes();
        context.Lifecycle.ContextRestored += OnContextRestored;
    }

    /// <summary>Number of sprites submitted by the last render call.</summary>
    public int LastSpriteCount { get; private set; }

    /// <summary>Number of batches drawn by the last render call.</summary>
    public int LastBatchCount { get; private set; }

    /// <summary>Number of sprites drawn through the instanced fast path.</summary>
    public int LastInstancedSpriteCount { get; private set; }

    /// <summary>Number of sprites drawn through builder-expanded geometry.</summary>
    public int LastImmediateSpriteCount { get; private set; }

    /// <summary>Number of instanced batches drawn.</summary>
    public int LastInstancedRunCount { get; private set; }

    /// <summary>Number of builder-expanded batches drawn.</summary>
    public int LastImmediateRunCount { get; private set; }

    /// <summary>Batches skipped because their texture or material is unavailable.</summary>
    public int SkippedBatches { get; private set; }

    /// <summary>Batches rejected by the material contract.</summary>
    public int SkippedMaterialBatches { get; private set; }

    /// <summary>Last material rejection reason.</summary>
    public SceneGlSpriteMaterialFailure LastMaterialFailure { get; private set; }

    /// <summary>Whether the last build selected 32-bit indices.</summary>
    public bool LastUsesUint32Indices { get; private set; }

    /// <summary>Validation failure of the last builder run, or none.</summary>
    public Render2DValidationErrorCode LastBuildError { get; private set; }

    /// <summary>Material tint bound by the last batch (white when unset).</summary>
    public Vec4 LastMaterialTint { get; private set; }

    /// <summary>Mask shape bound by the last batch (0 none, 1 circle, 2 rounded rect).</summary>
    public int LastMaskShape { get; private set; }

    /// <summary>Gets the deterministic run-length threshold for the fast path.</summary>
    public int MinInstancesForFastPath => _minInstancesForFastPath;

    /// <summary>Renders one sprite pass and returns the number of draw calls.</summary>
    public int Render(
        SceneWorld world,
        SceneCameraFrame camera,
        ReadOnlySpan<SceneSpriteRenderItem> items,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        EnsureSubmissionCapacity(items.Length);
        int count = 0;
        for (int i = 0; i < items.Length; i++)
        {
            _submissions[count++] = ToSubmission(world, in items[i]);
        }

        return RenderSubmissions(camera, _submissions.AsSpan(0, count), pass, frameState);
    }

    /// <summary>Renders already-built submissions; used by tests and non-scene sources.</summary>
    public int RenderSubmissions(
        SceneCameraFrame camera,
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        SceneRenderPassDefinition pass,
        SceneRenderFrameState frameState)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(camera);
        ArgumentNullException.ThrowIfNull(pass);
        ArgumentNullException.ThrowIfNull(frameState);

        _context.AssertRenderThread();
        ResetCounters();

        if (!_builder.TryBuild(submissions, out Render2DSpriteBatchBuildResult build, out Render2DValidationErrorCode error))
        {
            LastBuildError = error;
            return 0;
        }

        LastBuildError = Render2DValidationErrorCode.None;
        LastUsesUint32Indices = build.UsesUint32Indices;
        if (build.SpriteCount == 0)
        {
            return 0;
        }

        _context.State.SetViewport(0, 0, camera.ViewportWidth, camera.ViewportHeight);
        ApplyState(pass);
        UploadGeometry(in build);

        uint indexType = build.UsesUint32Indices ? GLConst.UnsignedInt : GLConst.UnsignedShort;
        int indexSize = build.UsesUint32Indices ? sizeof(uint) : sizeof(ushort);
        GLVertexArray indexVao = build.UsesUint32Indices ? _vao32 : _vao16;
        int drawCalls = 0;
        int triangles = 0;
        int submitted = 0;
        ReadOnlySpan<Render2DBatchRange> batches = build.Batches;
        for (int batchIndex = 0; batchIndex < batches.Length; batchIndex++)
        {
            ref readonly Render2DBatchRange batch = ref batches[batchIndex];
            Render2DBatchKey key = batch.Key;
            if (!TryResolveBatch(key, out GLTexture texture, out Vec4 tint))
            {
                continue;
            }

            BindTexture(key, texture);
            bool instanced = !key.RequiresImmediate && batch.SubmissionCount >= _minInstancesForFastPath;
            if (instanced)
            {
                _instancedShader.SetVec4(MaterialTintUniform, in tint);
                BindMaskUniforms(_instancedShader, key);
                DrawInstanced(camera, submissions, in batch);
                LastInstancedRunCount++;
                LastInstancedSpriteCount += batch.SubmissionCount;
            }
            else
            {
                BindImmediatePipeline(camera, in tint);
                BindMaskUniforms(_shader, key);
                indexVao.Bind();
                DrawIndexRange(in batch, indexType, indexSize);
                LastImmediateRunCount++;
                LastImmediateSpriteCount += batch.SubmissionCount;
            }

            submitted += batch.SubmissionCount;
            triangles += batch.QuadCount * 2;
            drawCalls++;
        }

        LastSpriteCount = submitted;
        LastBatchCount = drawCalls;
        frameState.RecordDraw(triangles, drawCalls);
        return drawCalls;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _context.Lifecycle.ContextRestored -= OnContextRestored;

        _instancedVao.Dispose();
        _instanceBuffer.Dispose();
        _quadIndexBuffer.Dispose();
        _quadBuffer.Dispose();
        _instancedShader.Dispose();
        _vao32.Dispose();
        _vao16.Dispose();
        _indexBuffer32.Dispose();
        _indexBuffer16.Dispose();
        _vertexBuffer.Dispose();
        _shader.Dispose();
        _disposed = true;
    }

    private static VertexAttribute[] BuildImmediateLayout()
    {
        ReadOnlySpan<Render2DSpriteAttributeLayout> attributes = Render2DSpriteShaderContract.Attributes;
        var layout = new VertexAttribute[attributes.Length];
        for (int i = 0; i < attributes.Length; i++)
        {
            ref readonly Render2DSpriteAttributeLayout attribute = ref attributes[i];
            (uint type, bool normalized) = attribute.Type switch
            {
                Render2DSpriteAttributeType.Scalar32 => (GLConst.Float, false),
                Render2DSpriteAttributeType.UNorm16 => (GLConst.UnsignedShort, true),
                _ => (GLConst.UnsignedByte, true),
            };
            layout[i] = new VertexAttribute(
                attribute.Location,
                attribute.ComponentCount,
                type,
                normalized,
                Render2DSpriteShaderContract.VertexStride,
                attribute.Offset,
                0,
                false);
        }

        return layout;
    }

    private static Render2DSpriteSubmission ToSubmission(SceneWorld world, in SceneSpriteRenderItem item)
    {
        Mat4 worldMatrix = world.HasTransform2D
            ? SceneBounds.FromAffine2D(world.GetWorldMatrix2D(item.Actor))
            : world.GetWorldMatrix3D(item.Actor);

        Mat4 inverse = default;
        bool hasMask = item.HasMask && Mat4.Invert(worldMatrix, out inverse);
        Render2DSpriteMask mask = hasMask
            ? BuildMask(item, in inverse)
            : default;

        bool hasSlice = item.HasSlice;
        Render2DSpriteSlice slice = default;
        if (hasSlice)
        {
            var border = new Render2DBorder(item.SliceBorder.X, item.SliceBorder.Y, item.SliceBorder.Z, item.SliceBorder.W);
            Vec2 sourceSize = item.SourceSize.X > 0.0f && item.SourceSize.Y > 0.0f ? item.SourceSize : item.Size;
            slice = new Render2DSpriteSlice(sourceSize, border);
        }

        return new Render2DSpriteSubmission(
            Render2DSpriteSource.Texture(item.TextureId.Value.Value),
            worldMatrix,
            item.Size,
            item.Anchor,
            new Rect(item.UvRect.X, item.UvRect.Y, item.UvRect.Z, item.UvRect.W),
            item.Color,
            true,
            item.FlipX,
            item.FlipY,
            false,
            default,
            hasSlice,
            slice,
            hasMask,
            mask,
            item.MaterialId.IsValid ? item.MaterialId.Value.Value : 0UL,
            hasSlice);
    }

    private static Render2DSpriteMask BuildMask(in SceneSpriteRenderItem item, in Mat4 inverse)
    {
        float width = MathF.Max(item.MaskRect.Z, 1e-5f);
        float height = MathF.Max(item.MaskRect.W, 1e-5f);
        var size = new Vec2(width * item.Size.X, height * item.Size.Y);
        var anchor = new Vec2(
            (item.Anchor.X - item.MaskRect.X) / width,
            (item.Anchor.Y - item.MaskRect.Y) / height);
        Render2DSpriteMaskShape shape = item.MaskKind == SceneSpriteMaskKind.Ellipse
            ? Render2DSpriteMaskShape.Circle
            : Render2DSpriteMaskShape.RoundedRect;
        float corner = item.MaskCornerRadius * MathF.Min(size.X, size.Y);
        return new Render2DSpriteMask(shape, inverse, size, anchor, corner, item.MaskInvert, item.MaskFeather);
    }

    private bool TryResolveBatch(Render2DBatchKey key, out GLTexture texture, out Vec4 tint)
    {
        texture = null!;
        tint = Vec4.One;
        if (key.Source.Kind != Render2DSpriteSourceKind.Texture || key.Source.Id == 0)
        {
            SkippedBatches++;
            return false;
        }

        var textureId = SceneAssetId<TextureAssetTag>.FromSymbol(new SceneStringId(key.Source.Id));
        if (!_assets.TryGetTexture(textureId, out GLTexture? resolved))
        {
            SkippedBatches++;
            return false;
        }

        texture = resolved;
        if (key.MaterialId == 0)
        {
            return true;
        }

        var materialId = SceneAssetId<MaterialAssetTag>.FromSymbol(new SceneStringId(key.MaterialId));
        if (!_assets.TryGetMaterial(materialId, out SceneGlMaterial? material))
        {
            SkippedBatches++;
            SkippedMaterialBatches++;
            LastMaterialFailure = SceneGlSpriteMaterialFailure.MissingMaterial;
            return false;
        }

        if (material.Definition.ShaderId != SpriteShaderId)
        {
            SkippedBatches++;
            SkippedMaterialBatches++;
            LastMaterialFailure = SceneGlSpriteMaterialFailure.UnsupportedShader;
            return false;
        }

        tint = material.Surface.Albedo;
        LastMaterialTint = tint;
        return true;
    }

    private void BindTexture(Render2DBatchKey key, GLTexture texture)
    {
        var textureId = SceneAssetId<TextureAssetTag>.FromSymbol(new SceneStringId(key.Source.Id));
        _assets.TryGetTextureSampler(textureId, out GLSampler? sampler);
        _context.State.BindTexture2D(0, texture.Id);
        _ = sampler!.Bind(0);
    }

    private void BindImmediatePipeline(SceneCameraFrame camera, in Vec4 tint)
    {
        _shader.Bind();
        _shader.SetMatrix4(Render2DSpriteShaderContract.ViewProjectionUniform, camera.ViewProjectionMatrix);
        _shader.SetInt(Render2DSpriteShaderContract.MainTextureUniform, 0);
        _shader.SetVec4(MaterialTintUniform, in tint);
    }

    private void BindMaskUniforms(SceneGlShader shader, Render2DBatchKey key)
    {
        if (!key.HasMask)
        {
            LastMaskShape = Render2DSpriteShaderContract.MaskShapeNone;
            SetMaskUniforms(shader, Render2DSpriteShaderContract.MaskShapeNone, default, default, default, 0.0f, false, 0.0f);
            return;
        }

        Render2DSpriteMask mask = key.Mask;
        int shape = mask.Shape == Render2DSpriteMaskShape.Circle
            ? Render2DSpriteShaderContract.MaskShapeCircle
            : Render2DSpriteShaderContract.MaskShapeRoundedRect;
        LastMaskShape = shape;
        SetMaskUniforms(shader, shape, mask.InverseWorldMatrix, mask.Size, mask.Anchor, mask.CornerRadius, mask.Invert, mask.Feather);
    }

    private static void SetMaskUniforms(
        SceneGlShader shader,
        int shape,
        in Mat4 worldToLocal,
        in Vec2 size,
        in Vec2 anchor,
        float cornerRadius,
        bool invert,
        float feather)
    {
        shader.SetInt(Render2DSpriteShaderContract.MaskShapeUniform, shape);
        shader.SetMatrix4(Render2DSpriteShaderContract.MaskWorldToLocalUniform, in worldToLocal);
        shader.SetVec2(Render2DSpriteShaderContract.MaskSizeUniform, in size);
        shader.SetVec2(Render2DSpriteShaderContract.MaskAnchorUniform, in anchor);
        shader.SetFloat(Render2DSpriteShaderContract.MaskCornerRadiusUniform, cornerRadius);
        shader.SetFloat(MaskInvertUniform, invert ? 1.0f : 0.0f);
        shader.SetFloat(MaskFeatherUniform, feather);
    }

    private unsafe void DrawIndexRange(in Render2DBatchRange batch, uint indexType, int indexSize)
    {
        _context.GL.DrawElements(
            GLConst.Triangles,
            (uint)batch.IndexCount,
            indexType,
            (void*)(batch.IndexOffset * indexSize));
    }

    private unsafe void DrawInstanced(
        SceneCameraFrame camera,
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        in Render2DBatchRange batch)
    {
        EnsureInstanceCapacity(batch.SubmissionCount);
        int written = 0;
        for (int i = batch.FirstSubmission; i < submissions.Length && written < batch.SubmissionCount; i++)
        {
            ref readonly Render2DSpriteSubmission submission = ref submissions[i];
            if (!Render2DSpriteBatchBuilder.IsRenderable(in submission))
            {
                continue;
            }

            _instances[written++] = BuildInstance(in submission);
        }

        if (written == 0)
        {
            return;
        }

        _instanceBuffer.Update(MemoryMarshal.AsBytes(_instances.AsSpan(0, written)));
        _instancedShader.Bind();
        _instancedShader.SetMatrix4(Render2DSpriteShaderContract.ViewProjectionUniform, camera.ViewProjectionMatrix);
        _instancedShader.SetInt(Render2DSpriteShaderContract.MainTextureUniform, 0);
        _context.State.BindVertexArray(_instancedVao.Id);
        _context.GL.DrawElementsInstanced(
            GLConst.Triangles,
            Render2DSpriteShaderContract.IndicesPerQuad,
            GLConst.UnsignedInt,
            null,
            (uint)written);
        _context.State.BindVertexArray(0);
    }

    private static SpriteInstance BuildInstance(in Render2DSpriteSubmission submission)
    {
        Rect sourceUv = submission.UvRect;
        Render2DUvMath.Resolve(
            in sourceUv,
            submission.FlipX,
            submission.FlipY,
            out float u0,
            out float v0,
            out float u1,
            out float v1);
        var uv = new Vec4(u0, v0, u1 - u0, v1 - v0);
        var geometry = new Vec4(submission.Size.X, submission.Size.Y, submission.Anchor.X, submission.Anchor.Y);
        return new SpriteInstance(submission.WorldMatrix, submission.Color, uv, geometry);
    }

    private void UploadGeometry(in Render2DSpriteBatchBuildResult build)
    {
        EnsureVertexCapacity(build.VertexByteLength);
        _vertexBuffer.Update(build.VertexData);
        if (build.UsesUint32Indices)
        {
            int bytes = build.Indices32.Length * sizeof(uint);
            if (_indexBuffer32.ByteLength < bytes)
            {
                _indexBuffer32.Resize(Math.Max(bytes, _indexBuffer32.ByteLength * 2));
            }

            _indexBuffer32.Update(MemoryMarshal.AsBytes(build.Indices32));
        }
        else
        {
            int bytes = build.Indices16.Length * sizeof(ushort);
            if (_indexBuffer16.ByteLength < bytes)
            {
                _indexBuffer16.Resize(Math.Max(bytes, _indexBuffer16.ByteLength * 2));
            }

            _indexBuffer16.Update(MemoryMarshal.AsBytes(build.Indices16));
        }
    }

    private void EnsureVertexCapacity(int bytes)
    {
        if (_vertexBuffer.ByteLength < bytes)
        {
            _vertexBuffer.Resize(Math.Max(bytes, _vertexBuffer.ByteLength * 2));
        }
    }

    private void EnsureSubmissionCapacity(int count)
    {
        if (count <= _submissions.Length)
        {
            return;
        }

        Array.Resize(ref _submissions, Math.Max(count, _submissions.Length * 2));
    }

    private void ApplyState(SceneRenderPassDefinition pass)
    {
        bool depthTest = pass.DepthTest ?? true;
        bool blend = pass.Blend ?? true;

        _context.State.SetDepthTest(depthTest);
        _context.State.SetDepthMask(depthTest);
        _context.State.SetCullFace(pass.Cull ?? false);
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

    private void UploadQuadGeometry()
    {
        _quadBuffer.Update(MemoryMarshal.AsBytes(s_quadCorners.AsSpan()));
        _quadIndexBuffer.Update(MemoryMarshal.AsBytes(s_quadIndices.AsSpan()));
    }

    private unsafe void ConfigureInstanceAttributes()
    {
        _context.State.BindVertexArray(_instancedVao.Id);
        _context.State.BindArrayBuffer(_instanceBuffer.Id);

        for (uint row = 0; row < 4; row++)
        {
            SetInstanceAttribute(1 + row, 4, (int)(row * 16));
        }

        SetInstanceAttribute(5, 4, 64);
        SetInstanceAttribute(6, 4, 80);
        SetInstanceAttribute(7, 4, 96);

        _context.State.BindVertexArray(0);
    }

    private unsafe void SetInstanceAttribute(uint location, int components, int offset)
    {
        _context.GL.EnableVertexAttribArray(location);
        _context.GL.VertexAttribPointer(
            location,
            components,
            GLConst.Float,
            false,
            (uint)InstanceStride,
            (void*)offset);
        _context.GL.VertexAttribDivisor(location, 1);
    }

    private void OnContextRestored(object? sender, EventArgs e)
    {
        UploadQuadGeometry();
        ConfigureInstanceAttributes();
    }

    private void EnsureInstanceCapacity(int required)
    {
        if (required <= _instances.Length)
        {
            return;
        }

        int capacity = _instances.Length;
        while (capacity < required)
        {
            capacity = capacity > int.MaxValue / 2 ? required : capacity * 2;
        }

        _instances = GC.AllocateArray<SpriteInstance>(capacity, pinned: true);
        _instanceBuffer.Resize(capacity * InstanceStride);
    }

    private void ResetCounters()
    {
        LastSpriteCount = 0;
        LastBatchCount = 0;
        LastInstancedSpriteCount = 0;
        LastImmediateSpriteCount = 0;
        LastInstancedRunCount = 0;
        LastImmediateRunCount = 0;
        SkippedBatches = 0;
        SkippedMaterialBatches = 0;
        LastMaterialFailure = SceneGlSpriteMaterialFailure.None;
        LastUsesUint32Indices = false;
        LastBuildError = Render2DValidationErrorCode.None;
        LastMaterialTint = Vec4.One;
        LastMaskShape = Render2DSpriteShaderContract.MaskShapeNone;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlSpriteBatchRenderer));
        }
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct QuadCorner
    {
        public QuadCorner(in Vec2 corner) => Corner = corner;

        public readonly Vec2 Corner;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly struct SpriteInstance
    {
        public SpriteInstance(
            in Mat4 matrix,
            in Vec4 color,
            in Vec4 uvRect,
            in Vec4 geometry)
        {
            Matrix = matrix;
            Color = color;
            UvRect = uvRect;
            Geometry = geometry;
        }

        public readonly Mat4 Matrix;

        public readonly Vec4 Color;

        public readonly Vec4 UvRect;

        public readonly Vec4 Geometry;
    }
}
