namespace Axrone.Scene.Rendering.OpenGL;

using Axrone.Render.Core;

/// <summary>Upload counters for one asset-cache synchronization.</summary>
public readonly record struct SceneGlUploadStats(
    int Shaders,
    int Meshes,
    int Materials,
    int Textures,
    int Samplers);

/// <summary>
/// Owns GPU resources for scene asset definitions. Upload is explicit and
/// render-thread affine; draw-time lookups are allocation-free dictionary reads.
/// </summary>
public sealed class SceneGlAssetCache : IDisposable
{
    private readonly GLContext _context;
    private readonly SceneAssetRegistry _assets;
    private readonly Dictionary<SceneAssetId<ShaderAssetTag>, SceneGlShader> _shaders = new();
    private readonly Dictionary<SceneAssetId<ShaderAssetTag>, SceneGlShader?> _skinnedShaders = new();
    private readonly Dictionary<SceneAssetId<ShaderAssetTag>, SkinningShaderDiagnostic> _skinningDiagnostics = new();
    private readonly Dictionary<SceneAssetId<MeshAssetTag>, GLMesh> _meshes = new();
    private readonly Dictionary<SceneAssetId<MeshAssetTag>, SceneMeshDefinition> _meshSources = new();
    private readonly Dictionary<SceneAssetId<MaterialAssetTag>, SceneGlMaterial> _materials = new();
    private readonly Dictionary<SceneAssetId<TextureAssetTag>, GLTexture> _textures = new();
    private readonly Dictionary<SceneAssetId<SamplerAssetTag>, GLSampler> _samplers = new();
    private readonly Dictionary<SceneAssetId<TextureAssetTag>, SceneAssetId<SamplerAssetTag>?> _textureSamplers = new();
    private readonly GLSampler _defaultSampler;
    private int _unskinnableShaderCount;
    private bool _disposed;

    /// <summary>Creates a GPU cache over a scene asset registry.</summary>
    public SceneGlAssetCache(GLContext context, SceneAssetRegistry assets)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(assets);

        _context = context;
        _assets = assets;
        _defaultSampler = new GLSampler(context, "scene-default-sampler");
        _defaultSampler.SetFilter(GLConst.Linear, GLConst.Linear).Apply();
    }

    /// <summary>Number of uploaded shaders.</summary>
    public int ShaderCount => _shaders.Count;

    /// <summary>Number of uploaded meshes.</summary>
    public int MeshCount => _meshes.Count;

    /// <summary>Number of uploaded materials.</summary>
    public int MaterialCount => _materials.Count;

    /// <summary>Number of uploaded textures.</summary>
    public int TextureCount => _textures.Count;

    /// <summary>Number of uploaded samplers.</summary>
    public int SamplerCount => _samplers.Count;

    /// <summary>Uploads every definition in dependency order.</summary>
    public SceneGlUploadStats UploadAll()
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();

        DisposeResources();

        SceneSamplerDefinition[] samplers = _assets.Samplers.Definitions();
        for (int i = 0; i < samplers.Length; i++)
        {
            RegisterSampler(samplers[i]);
        }

        SceneTextureDefinition[] textures = _assets.Textures.Definitions();
        for (int i = 0; i < textures.Length; i++)
        {
            RegisterTexture(textures[i]);
        }

        SceneShaderDefinition[] shaders = _assets.Shaders.Definitions();
        for (int i = 0; i < shaders.Length; i++)
        {
            RegisterShader(shaders[i]);
        }

        SceneMeshDefinition[] meshes = _assets.Meshes.Definitions();
        for (int i = 0; i < meshes.Length; i++)
        {
            RegisterMesh(meshes[i]);
        }

        SceneMaterialDefinition[] materials = _assets.Materials.Definitions();
        for (int i = 0; i < materials.Length; i++)
        {
            RegisterMaterial(materials[i]);
        }

        return new SceneGlUploadStats(
            shaders.Length,
            meshes.Length,
            materials.Length,
            textures.Length,
            samplers.Length);
    }

    /// <summary>Compiles and stores a shader.</summary>
    public SceneGlShader RegisterShader(SceneShaderDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ThrowIfDisposed();
        _context.AssertRenderThread();

        string label = definition.Id.ToString();
        var shader = new SceneGlShader(
            _context,
            label,
            definition.VertexSource,
            definition.FragmentSource);

        if (_shaders.TryGetValue(definition.Id, out SceneGlShader? previous))
        {
            previous.Dispose();
        }

        _shaders[definition.Id] = shader;

        SceneGlShader? previousSkinned = null;
        _ = _skinnedShaders.Remove(definition.Id, out previousSkinned);
        previousSkinned?.Dispose();

        if (_skinningDiagnostics.Remove(definition.Id, out SkinningShaderDiagnostic previousDiagnostic) &&
            !previousDiagnostic.Skinned)
        {
            _unskinnableShaderCount--;
        }

        (SceneGlShader? skinned, SkinningInjectionFailure failure) = CompileSkinnedShader(definition, label);
        _skinnedShaders[definition.Id] = skinned;
        _skinningDiagnostics[definition.Id] = new SkinningShaderDiagnostic(definition.Id, skinned is not null, failure);
        if (skinned is null)
        {
            _unskinnableShaderCount++;
        }

        return shader;
    }

    private (SceneGlShader? Shader, SkinningInjectionFailure Failure) CompileSkinnedShader(
        SceneShaderDefinition definition,
        string label)
    {
        if (!SkinningShaderInjector.TryInject(definition.VertexSource, out string injected, out SkinningInjectionFailure failure))
        {
            return (null, failure);
        }

        try
        {
            return (new SceneGlShader(_context, label + "-skinned", injected, definition.FragmentSource), SkinningInjectionFailure.None);
        }
        catch (GLShaderException)
        {
            return (null, SkinningInjectionFailure.CompilationFailed);
        }
    }

    /// <summary>Uploads and stores a mesh.</summary>
    public GLMesh RegisterMesh(SceneMeshDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ThrowIfDisposed();
        _context.AssertRenderThread();

        VertexAttribute[] attributes = new VertexAttribute[definition.Attributes.Count];
        for (int i = 0; i < attributes.Length; i++)
        {
            SceneVertexAttribute attribute = definition.Attributes[i];
            uint type = attribute.Integer ? GLConst.Int : GLConst.Float;
            attributes[i] = new VertexAttribute(
                (int)attribute.Semantic,
                attribute.ComponentCount,
                type,
                attribute.Normalized,
                attribute.Stride,
                attribute.Offset,
                0,
                attribute.Integer);
        }

        var layout = new VertexLayout(attributes);
        Aabb3D bounds = definition.Bounds is { } sphere
            ? new Aabb3D(
                sphere.Center - new Vec3(sphere.Radius),
                sphere.Center + new Vec3(sphere.Radius))
            : new Aabb3D(Vec3.Zero, Vec3.Zero);

        var mesh = new GLMesh(
            _context,
            layout,
            definition.Vertices.Span,
            definition.Indices.Span,
            bounds,
            MapTopology(definition.Topology),
            definition.Id.ToString(),
            MapIndexType(definition.IndexFormat));

        if (_meshes.TryGetValue(definition.Id, out GLMesh? previous))
        {
            previous.Dispose();
        }

        _meshes[definition.Id] = mesh;
        _meshSources[definition.Id] = definition;
        return mesh;
    }

    /// <summary>Uploads and stores a texture.</summary>
    public GLTexture RegisterTexture(SceneTextureDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ThrowIfDisposed();
        _context.AssertRenderThread();

        TextureFormat format = MapTextureFormat(definition.Format);
        int mipLevels = definition.GenerateMipmaps
            ? 1 + (int)MathF.Floor(MathF.Log2(MathF.Max(definition.Width, definition.Height)))
            : 1;

        GLTexture? texture = null;
        try
        {
            texture = new GLTexture(
                _context,
                GLConst.Texture2D,
                format,
                definition.Width,
                definition.Height,
                depth: 1,
                mipLevels,
                definition.Id.ToString());

            switch (definition.Source)
            {
                case SceneTextureData data:
                    UploadDataTexture(texture, definition, data.Data);
                    break;
                case SceneTextureColor color:
                    UploadColorTexture(texture, definition, color.Color);
                    break;
                case SceneTextureUrl:
                    throw new SceneAssetException(
                        SceneAssetErrorCodes.Invalid,
                        $"Texture '{definition.Id}' uses a URL source; an asset loader is required before GPU upload.");
                default:
                    throw new SceneAssetException(
                        SceneAssetErrorCodes.Invalid,
                        $"Texture '{definition.Id}' uses an unsupported source type.");
            }

            if (definition.GenerateMipmaps && mipLevels > 1)
            {
                _context.GL.GenerateMipmap(GLConst.Texture2D);
            }

            if (_textures.TryGetValue(definition.Id, out GLTexture? previous))
            {
                previous.Dispose();
            }

            _textures[definition.Id] = texture;
            _textureSamplers[definition.Id] = definition.SamplerId;
            return texture;
        }
        catch
        {
            texture?.Dispose();
            throw;
        }
    }

    /// <summary>Creates and stores a sampler.</summary>
    public GLSampler RegisterSampler(SceneSamplerDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ThrowIfDisposed();
        _context.AssertRenderThread();

        var sampler = new GLSampler(_context, definition.Id.ToString());
        sampler
            .SetFilter(MapFilter(definition.MinFilter), MapFilter(definition.MagFilter))
            .SetWrap(
                MapWrap(definition.WrapS),
                MapWrap(definition.WrapT),
                MapWrap(definition.WrapR))
            .SetAnisotropy(definition.MaxAnisotropy)
            .Apply();

        if (_samplers.TryGetValue(definition.Id, out GLSampler? previous))
        {
            previous.Dispose();
        }

        _samplers[definition.Id] = sampler;
        return sampler;
    }

    /// <summary>Resolves every dependency and stores a GPU material.</summary>
    public SceneGlMaterial RegisterMaterial(SceneMaterialDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ThrowIfDisposed();
        _context.AssertRenderThread();

        if (!_shaders.TryGetValue(definition.ShaderId, out SceneGlShader? shader))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.NotFound,
                $"Material '{definition.Id}' references shader '{definition.ShaderId}' which is not uploaded.");
        }

        var slots = new List<SceneGlTextureSlot>(5);
        AddTextureSlot(slots, "u_AlbedoMap", 0, definition.Surface.AlbedoMap);
        AddTextureSlot(slots, "u_NormalMap", 1, definition.Surface.NormalMap);
        AddTextureSlot(slots, "u_PbrMap", 2, definition.Surface.PbrMap);
        AddTextureSlot(slots, "u_OcclusionMap", 3, definition.Surface.OcclusionMap);
        AddTextureSlot(slots, "u_EmissiveMap", 4, definition.Surface.EmissiveMap);

        var material = new SceneGlMaterial(
            definition,
            shader,
            slots.ToArray(),
            TryGetSkinnedShader(definition.ShaderId, out SceneGlShader? skinnedShader) ? skinnedShader : null);
        _materials[definition.Id] = material;
        return material;
    }

    /// <summary>Resolves the skinned vertex variant of an uploaded shader, when one compiled.</summary>
    public bool TryGetSkinnedShader(
        SceneAssetId<ShaderAssetTag> id,
        [NotNullWhen(true)] out SceneGlShader? skinnedShader)
    {
        if (_skinnedShaders.TryGetValue(id, out skinnedShader) && skinnedShader is not null)
        {
            return true;
        }

        skinnedShader = null;
        return false;
    }

    /// <summary>Gets why a shader could not be converted into a skinned variant.</summary>
    public bool TryGetSkinningDiagnostic(
        SceneAssetId<ShaderAssetTag> id,
        out SkinningShaderDiagnostic diagnostic) =>
        _skinningDiagnostics.TryGetValue(id, out diagnostic);

    /// <summary>Gets the number of uploaded shaders without a skinned variant.</summary>
    public int UnskinnableShaderCount => _unskinnableShaderCount;

    /// <summary>Resolves an uploaded shader.</summary>
    public bool TryGetShader(SceneAssetId<ShaderAssetTag> id, [NotNullWhen(true)] out SceneGlShader? shader) =>
        _shaders.TryGetValue(id, out shader);

    /// <summary>
    /// Synchronizes uploaded meshes with the asset catalog without re-uploading unchanged
    /// geometry. New or replaced definitions are uploaded, and definitions removed from the
    /// catalog release their GPU mesh. Intended for chunked or streamed content.
    /// </summary>
    /// <returns>Upload counters; only <see cref="SceneGlUploadStats.Meshes"/> is populated.</returns>
    public SceneGlUploadStats SyncMeshes()
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();

        SceneMeshDefinition[] definitions = _assets.Meshes.Definitions();
        var live = new HashSet<SceneAssetId<MeshAssetTag>>(definitions.Length);
        var uploaded = 0;

        for (int i = 0; i < definitions.Length; i++)
        {
            SceneMeshDefinition definition = definitions[i];
            live.Add(definition.Id);
            if (!_meshSources.TryGetValue(definition.Id, out SceneMeshDefinition? previous) ||
                !ReferenceEquals(previous, definition))
            {
                RegisterMesh(definition);
                uploaded++;
            }
        }

        List<SceneAssetId<MeshAssetTag>>? stale = null;
        foreach (SceneAssetId<MeshAssetTag> id in _meshSources.Keys)
        {
            if (!live.Contains(id))
            {
                (stale ??= []).Add(id);
            }
        }

        if (stale is not null)
        {
            for (int i = 0; i < stale.Count; i++)
            {
                RemoveMesh(stale[i]);
            }
        }

        return new SceneGlUploadStats(0, uploaded, 0, 0, 0);
    }

    /// <summary>Releases one uploaded mesh and forgets its source definition.</summary>
    /// <param name="id">Mesh asset id.</param>
    /// <returns><see langword="true"/> when the mesh was uploaded.</returns>
    public bool RemoveMesh(SceneAssetId<MeshAssetTag> id)
    {
        ThrowIfDisposed();
        _context.AssertRenderThread();

        _meshSources.Remove(id);
        if (_meshes.Remove(id, out GLMesh? mesh))
        {
            mesh.Dispose();
            return true;
        }

        return false;
    }

    /// <summary>Resolves an uploaded mesh.</summary>
    public bool TryGetMesh(SceneAssetId<MeshAssetTag> id, [NotNullWhen(true)] out GLMesh? mesh) =>
        _meshes.TryGetValue(id, out mesh);

    /// <summary>Resolves an uploaded material.</summary>
    public bool TryGetMaterial(SceneAssetId<MaterialAssetTag> id, [NotNullWhen(true)] out SceneGlMaterial? material) =>
        _materials.TryGetValue(id, out material);

    /// <summary>Resolves an uploaded texture.</summary>
    public bool TryGetTexture(SceneAssetId<TextureAssetTag> id, [NotNullWhen(true)] out GLTexture? texture) =>
        _textures.TryGetValue(id, out texture);

    /// <summary>Resolves an uploaded sampler.</summary>
    public bool TryGetSampler(SceneAssetId<SamplerAssetTag> id, [NotNullWhen(true)] out GLSampler? sampler) =>
        _samplers.TryGetValue(id, out sampler);

    /// <summary>Sampler used when a texture or sprite declares none.</summary>
    public GLSampler DefaultSampler => _defaultSampler;

    /// <summary>
    /// Resolves the sampler a texture should be sampled with, falling back to
    /// the cache default when the texture has no override.
    /// </summary>
    public bool TryGetTextureSampler(
        SceneAssetId<TextureAssetTag> id,
        [NotNullWhen(true)] out GLSampler? sampler)
    {
        if (_textureSamplers.TryGetValue(id, out SceneAssetId<SamplerAssetTag>? samplerId) &&
            samplerId is { } resolved &&
            _samplers.TryGetValue(resolved, out sampler))
        {
            return true;
        }

        sampler = _defaultSampler;
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        DisposeResources();
        _defaultSampler.Dispose();
        _disposed = true;
    }

    private void AddTextureSlot(
        List<SceneGlTextureSlot> slots,
        string uniformName,
        int unit,
        SceneMaterialTextureBinding? binding)
    {
        if (binding is not { } value)
        {
            return;
        }

        if (!_textures.TryGetValue(value.TextureId, out GLTexture? texture))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.NotFound,
                $"Material texture '{value.TextureId}' is not uploaded.");
        }

        SceneAssetId<SamplerAssetTag>? samplerId = value.SamplerId;
        if (samplerId is null && _textureSamplers.TryGetValue(value.TextureId, out var textureSampler))
        {
            samplerId = textureSampler;
        }

        GLSampler sampler = samplerId is { } id && _samplers.TryGetValue(id, out GLSampler? found)
            ? found
            : _defaultSampler;

        slots.Add(new SceneGlTextureSlot(uniformName, value.Unit ?? unit, texture, sampler));
    }

    private static void UploadDataTexture(
        GLTexture texture,
        SceneTextureDefinition definition,
        ReadOnlyMemory<byte> data)
    {
        int required = definition.Width * definition.Height * texture.FormatInfo.BytesPerPixel;
        if (data.Length < required)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Texture '{definition.Id}' payload is shorter than its declared dimensions.");
        }

        texture.UploadSubData2D(
            data.Span[..required],
            0,
            0,
            definition.Width,
            definition.Height);
    }

    private static void UploadColorTexture(
        GLTexture texture,
        SceneTextureDefinition definition,
        in Vec4 color)
    {
        if (definition.Format is not SceneTextureFormat.Rgba8 and not SceneTextureFormat.Srgba8)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Solid-color texture '{definition.Id}' requires an RGBA8 or sRGB8 format.");
        }

        int pixelCount = definition.Width * definition.Height;
        byte[] pixels = new byte[pixelCount * 4];
        byte r = ToByte(color.X);
        byte g = ToByte(color.Y);
        byte b = ToByte(color.Z);
        byte a = ToByte(color.W);

        for (int i = 0; i < pixelCount; i++)
        {
            int offset = i * 4;
            pixels[offset] = r;
            pixels[offset + 1] = g;
            pixels[offset + 2] = b;
            pixels[offset + 3] = a;
        }

        texture.UploadSubData2D(pixels, 0, 0, definition.Width, definition.Height);
    }

    private void DisposeResources()
    {
        foreach (SceneGlShader shader in _shaders.Values)
        {
            shader.Dispose();
        }

        _shaders.Clear();

        foreach (SceneGlShader? skinnedShader in _skinnedShaders.Values)
        {
            skinnedShader?.Dispose();
        }

        _skinnedShaders.Clear();
        _skinningDiagnostics.Clear();
        _unskinnableShaderCount = 0;

        foreach (GLMesh mesh in _meshes.Values)
        {
            mesh.Dispose();
        }

        _meshes.Clear();
        _meshSources.Clear();

        foreach (GLTexture texture in _textures.Values)
        {
            texture.Dispose();
        }

        _textures.Clear();

        foreach (GLSampler sampler in _samplers.Values)
        {
            sampler.Dispose();
        }

        _samplers.Clear();
        _textureSamplers.Clear();
        _materials.Clear();
    }

    private static uint MapFilter(SceneFilterMode mode) => mode switch
    {
        SceneFilterMode.Nearest => GLConst.Nearest,
        SceneFilterMode.Linear => GLConst.Linear,
        SceneFilterMode.NearestMipmapNearest => GLConst.NearestMipmapNearest,
        SceneFilterMode.LinearMipmapNearest => GLConst.LinearMipmapNearest,
        SceneFilterMode.NearestMipmapLinear => GLConst.NearestMipmapLinear,
        SceneFilterMode.LinearMipmapLinear => GLConst.LinearMipmapLinear,
        _ => GLConst.Linear
    };

    private static uint MapWrap(SceneWrapMode mode) => mode switch
    {
        SceneWrapMode.Repeat => GLConst.Repeat,
        SceneWrapMode.ClampToEdge => GLConst.ClampToEdge,
        SceneWrapMode.MirroredRepeat => GLConst.MirroredRepeat,
        _ => GLConst.Repeat
    };

    private static uint MapTopology(SceneMeshTopology topology) => topology switch
    {
        SceneMeshTopology.Triangles => GLConst.Triangles,
        SceneMeshTopology.Lines => GLConst.Lines,
        SceneMeshTopology.Points => GLConst.Points,
        _ => GLConst.Triangles
    };

    private static uint MapIndexType(SceneIndexFormat format) => format switch
    {
        SceneIndexFormat.UInt16 => GLConst.UnsignedShort,
        SceneIndexFormat.UInt32 => GLConst.UnsignedInt,
        _ => GLConst.UnsignedInt
    };

    private static TextureFormat MapTextureFormat(SceneTextureFormat format) => format switch
    {
        SceneTextureFormat.Rgba8 => TextureFormat.Rgba8,
        SceneTextureFormat.Srgba8 => TextureFormat.Srgb8Alpha8,
        SceneTextureFormat.Rgba16Float => TextureFormat.Rgba16f,
        SceneTextureFormat.Rgba32Float => TextureFormat.Rgba32f,
        SceneTextureFormat.R8 => TextureFormat.R8,
        SceneTextureFormat.Rg8 => TextureFormat.Rg8,
        _ => throw new SceneAssetException(
            SceneAssetErrorCodes.Invalid,
            $"Texture format '{format}' is not supported by the OpenGL upload path.")
    };

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static byte ToByte(float value) =>
        (byte)Math.Clamp((int)MathF.Round(value * 255.0f), 0, 255);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlAssetCache));
        }
    }
}
