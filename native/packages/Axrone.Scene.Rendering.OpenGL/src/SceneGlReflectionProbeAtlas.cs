namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Owns one cubemap per probe cubemap asset. Capture writes into these textures
/// and the sampling binder reads them. Textures are registered with the context
/// registry, so a context restore recreates the storage.
/// </summary>
public sealed class SceneGlReflectionProbeAtlas : IDisposable
{
    private readonly GLContext _context;
    private readonly Dictionary<SceneAssetId<TextureAssetTag>, GLTexture> _probes = new();
    private bool _disposed;

    /// <summary>Creates an atlas with one cube face resolution for every probe.</summary>
    public SceneGlReflectionProbeAtlas(GLContext context, int resolution = 128)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (resolution <= 0 || resolution > context.Capabilities.MaxCubeMapTextureSize)
        {
            throw new SceneConfigurationException(
                $"Probe resolution {resolution} is outside the supported range 1..{context.Capabilities.MaxCubeMapTextureSize}.");
        }

        _context = context;
        Resolution = resolution;
    }

    /// <summary>Gets the cube face resolution.</summary>
    public int Resolution { get; }

    /// <summary>Gets the number of allocated cubemaps.</summary>
    public int Count => _probes.Count;

    /// <summary>Gets or creates the cubemap for a probe asset.</summary>
    public GLTexture GetOrCreate(SceneAssetId<TextureAssetTag> id)
    {
        ThrowIfDisposed();

        if (!id.IsValid)
        {
            throw new SceneConfigurationException("Reflection probes require a valid cubemap asset id.");
        }

        if (_probes.TryGetValue(id, out GLTexture? existing))
        {
            return existing;
        }

        var texture = new GLTexture(
            _context,
            GLConst.TextureCubeMap,
            TextureFormat.Rgba16f,
            Resolution,
            Resolution,
            depth: 1,
            mipLevels: 1,
            id.ToString());
        texture.SetParameter(GLConst.TextureMinFilter, (int)GLConst.Linear);
        texture.SetParameter(GLConst.TextureMagFilter, (int)GLConst.Linear);
        texture.SetParameter(GLConst.TextureWrapS, (int)GLConst.ClampToEdge);
        texture.SetParameter(GLConst.TextureWrapT, (int)GLConst.ClampToEdge);
        _probes[id] = texture;
        return texture;
    }

    /// <summary>Looks up an allocated cubemap.</summary>
    public bool TryGet(SceneAssetId<TextureAssetTag> id, [NotNullWhen(true)] out GLTexture? texture) =>
        _probes.TryGetValue(id, out texture);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        foreach (GLTexture texture in _probes.Values)
        {
            texture.Dispose();
        }

        _probes.Clear();
        _disposed = true;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneGlReflectionProbeAtlas));
        }
    }
}
