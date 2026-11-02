namespace Axrone.AssetGltf;

/// <summary>External resource fetch request.</summary>
public readonly record struct GltfResourceRequest(
    string Uri,
    string? AbsoluteUri,
    string Kind,
    string? MimeType);

/// <summary>Fetched resource payload.</summary>
public readonly record struct GltfResolvedResource(
    ReadOnlyMemory<byte> Data,
    string? MimeType);

/// <summary>External resource resolver callback.</summary>
/// <param name="request">Resource request.</param>
/// <param name="token">Cancellation token.</param>
public delegate ValueTask<GltfResolvedResource?> GltfResourceResolver(GltfResourceRequest request, CancellationToken token);

/// <summary>Texture payload variants.</summary>
public abstract record GltfTexturePayload;

/// <summary>External texture reference.</summary>
public sealed record GltfExternalTexturePayload(string Uri) : GltfTexturePayload;

/// <summary>Raw decoded texture bytes.</summary>
public sealed record GltfRawTexturePayload(ReadOnlyMemory<byte> Bytes, string MimeType) : GltfTexturePayload;

/// <summary>Compressed KTX2 texture payload.</summary>
public sealed record GltfCompressedTexturePayload(
    int VkFormat,
    int Width,
    int Height,
    int LevelCount,
    int SupercompressionScheme,
    ImmutableArray<ReadOnlyMemory<byte>> Levels) : GltfTexturePayload
{
    /// <summary>Mip level metadata for packed transcoded output.</summary>
    public ImmutableArray<GltfTextureMipLevel> MipLevels { get; init; } = ImmutableArray<GltfTextureMipLevel>.Empty;
}

/// <summary>Transcoded texture payload with packed mip levels.</summary>
public sealed record GltfTranscodedTexturePayload(
    ReadOnlyMemory<byte> Bytes,
    GltfTextureFormat Format,
    ImmutableArray<GltfTextureMipLevel> Levels) : GltfTexturePayload;

/// <summary>Packed mip level metadata.</summary>
public readonly record struct GltfTextureMipLevel(
    int Level,
    int Width,
    int Height,
    int ByteOffset,
    int ByteLength);

/// <summary>KTX2 fast header parser.</summary>
public static class Ktx2Decoder
{
    /// <summary>Whether the buffer starts with the KTX2 identifier.</summary>
    /// <param name="data">Candidate bytes.</param>
    public static bool IsKtx2(ReadOnlySpan<byte> data) => GltfKtx2Reader.IsKtx2(data);

    /// <summary>Tries to parse KTX2 mip levels without transcoding.</summary>
    /// <param name="data">KTX2 container bytes.</param>
    /// <param name="payload">Compressed payload view of the container.</param>
    /// <param name="errorMessage">Failure reason when parsing fails.</param>
    /// <returns>Whether the container parsed.</returns>
    public static bool TryParse(
        ReadOnlyMemory<byte> data,
        [NotNullWhen(true)] out GltfCompressedTexturePayload? payload,
        out string? errorMessage)
    {
        if (GltfKtx2Reader.TryRead(data, out GltfKtx2Texture? texture, out GltfImageDecodeError? error))
        {
            payload = GltfKtx2Reader.ToPayload(texture);
            errorMessage = null;
            return true;
        }

        payload = null;
        errorMessage = error?.ToString() ?? "KTX2 container is invalid.";
        return false;
    }

    /// <summary>Maps a Vulkan format to a runtime texture format.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static GltfTextureFormat MapVkFormat(int vkFormat) =>
        vkFormat switch
        {
            131 => GltfTextureFormat.BC1_RGB,
            137 => GltfTextureFormat.BC3_RGBA,
            139 => GltfTextureFormat.BC4_R,
            141 => GltfTextureFormat.BC5_RG,
            145 => GltfTextureFormat.BC7_RGBA,
            >= 157 and <= 170 => (GltfTextureFormat)vkFormat,
            _ => GltfTextureFormat.Unknown,
        };
}

/// <summary>Buffer and bufferView resolution with meshopt support.</summary>
internal sealed class GltfResourceRuntimeCache
{
    private readonly ReadOnlyMemory<byte>? _glbBinaryChunk;
    private readonly GltfResourceResolver? _resolver;
    private readonly Dictionary<int, ReadOnlyMemory<byte>> _bufferCache = new();
    private readonly Dictionary<int, ReadOnlyMemory<byte>> _bufferViewCache = new();
    private readonly Lock _gate = new();

    /// <summary>Creates a cache.</summary>
    public GltfResourceRuntimeCache(
        ReadOnlyMemory<byte>? glbBinaryChunk,
        GltfResourceResolver? resolver)
    {
        _glbBinaryChunk = glbBinaryChunk;
        _resolver = resolver;
    }

    /// <summary>Resolves a buffer to bytes.</summary>
    public async ValueTask<ReadOnlyMemory<byte>> ResolveBufferAsync(
        int bufferIndex,
        GltfRawModel.Buffer bufferDef,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bufferDef);
        if (bufferDef.ByteLength < 0)
        {
            ThrowHelper.ThrowSchema($"Buffer {bufferIndex} has a negative byteLength.");
        }

        lock (_gate)
        {
            if (_bufferCache.TryGetValue(bufferIndex, out ReadOnlyMemory<byte> cached))
            {
                return cached;
            }
        }

        ReadOnlyMemory<byte> resolved;

        if (string.IsNullOrEmpty(bufferDef.Uri))
        {
            if (bufferIndex == 0 && _glbBinaryChunk.HasValue)
            {
                resolved = _glbBinaryChunk.Value.Slice(0, Math.Min(bufferDef.ByteLength, _glbBinaryChunk.Value.Length));
            }
            else
            {
                ThrowHelper.ThrowResource($"[buffer:{bufferIndex}]", "buffer", "GLB BIN chunk missing or requested buffer out of range.");
                resolved = default;
            }
        }
        else if (bufferDef.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            resolved = DecodeDataUri(bufferDef.Uri);
        }
        else
        {
            if (_resolver == null)
            {
                ThrowHelper.ThrowResource(bufferDef.Uri, "buffer", "External resource resolver callback not attached.");
            }

            var request = new GltfResourceRequest(bufferDef.Uri, null, "buffer", "application/octet-stream");
            GltfResolvedResource? result = await _resolver!(request, cancellationToken).ConfigureAwait(false);

            if (result == null || result.Value.Data.IsEmpty)
            {
                ThrowHelper.ThrowResource(bufferDef.Uri, "buffer", "Unable to resolve external binary URI.");
            }

            resolved = result.Value.Data;
        }

        lock (_gate)
        {
            _bufferCache[bufferIndex] = resolved;
        }

        return resolved;
    }

    /// <summary>Resolves an external image URI through the configured resolver.</summary>
    public async ValueTask<ReadOnlyMemory<byte>?> TryResolveImageAsync(
        string uri,
        string? mimeType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (_resolver == null)
        {
            return null;
        }

        var request = new GltfResourceRequest(uri, null, "image", mimeType);
        GltfResolvedResource? result = await _resolver(request, cancellationToken).ConfigureAwait(false);
        if (!result.HasValue || result.Value.Data.IsEmpty)
        {
            return null;
        }

        return result.Value.Data;
    }

    /// <summary>Resolves a bufferView to bytes, decompressing meshopt when linked.</summary>
    public async ValueTask<ReadOnlyMemory<byte>> ResolveBufferViewAsync<TMeshoptPolicy>(
        int bufferViewIndex,
        GltfRawModel rawModel,
        CancellationToken cancellationToken)
        where TMeshoptPolicy : struct, IMeshoptCompressionPolicy
    {
        ArgumentNullException.ThrowIfNull(rawModel);
        if ((uint)bufferViewIndex >= (uint)rawModel.BufferViews.Count)
        {
            ThrowHelper.ThrowSchema($"BufferView index {bufferViewIndex} is out of range.");
        }

        lock (_gate)
        {
            if (_bufferViewCache.TryGetValue(bufferViewIndex, out ReadOnlyMemory<byte> cached))
            {
                return cached;
            }
        }

        GltfRawModel.BufferView bv = rawModel.BufferViews[bufferViewIndex];
        ReadOnlyMemory<byte> result;

        if (bv.Meshopt != null)
        {
            int meshoptBuffer = bv.Meshopt.Buffer;
            if ((uint)meshoptBuffer >= (uint)rawModel.Buffers.Count)
            {
                ThrowHelper.ThrowSchema($"BufferView {bufferViewIndex} references a missing buffer {meshoptBuffer}.");
            }

            if (bv.Meshopt.Count < 0 ||
                bv.Meshopt.ByteStride <= 0 ||
                bv.Meshopt.Count > int.MaxValue / bv.Meshopt.ByteStride)
            {
                ThrowHelper.ThrowSchema($"BufferView {bufferViewIndex} has an invalid meshopt element layout.");
            }

            ReadOnlyMemory<byte> raw = await ResolveBufferAsync(meshoptBuffer, rawModel.Buffers[meshoptBuffer], cancellationToken).ConfigureAwait(false);

            if (bv.Meshopt.ByteOffset < 0 ||
                bv.Meshopt.ByteLength < 0 ||
                (long)bv.Meshopt.ByteOffset + bv.Meshopt.ByteLength > raw.Length)
            {
                ThrowHelper.ThrowSchema($"BufferView {bufferViewIndex} meshopt range exceeds its buffer.");
            }

            int uncompressedSize = bv.Meshopt.Count * bv.Meshopt.ByteStride;
            byte[] decompressed = GC.AllocateUninitializedArray<byte>(uncompressedSize, pinned: true);

            bool ok;
            {
                ReadOnlySpan<byte> compressed = raw.Span.Slice(bv.Meshopt.ByteOffset, bv.Meshopt.ByteLength);
                ok = TMeshoptPolicy.IsSupported
                    && TMeshoptPolicy.TryDecompressBufferView(compressed, bv.Meshopt.Count, bv.Meshopt.ByteStride, bv.Meshopt.Mode.AsSpan(), bv.Meshopt.Filter.AsSpan(), decompressed);
            }

            if (!ok)
            {
                ThrowHelper.ThrowContainer($"EXT_meshopt_compression decompression failed for bufferView [{bufferViewIndex}].");
            }

            result = decompressed;
        }
        else
        {
            int bufferIndex = bv.Buffer;
            if ((uint)bufferIndex >= (uint)rawModel.Buffers.Count)
            {
                ThrowHelper.ThrowSchema($"BufferView {bufferViewIndex} references a missing buffer {bufferIndex}.");
            }

            ReadOnlyMemory<byte> raw = await ResolveBufferAsync(bufferIndex, rawModel.Buffers[bufferIndex], cancellationToken).ConfigureAwait(false);

            if (bv.ByteOffset < 0 ||
                bv.ByteLength < 0 ||
                (long)bv.ByteOffset + bv.ByteLength > raw.Length)
            {
                ThrowHelper.ThrowSchema($"BufferView {bufferViewIndex} range exceeds its buffer.");
            }

            result = raw.Slice(bv.ByteOffset, bv.ByteLength);
        }

        lock (_gate)
        {
            _bufferViewCache[bufferViewIndex] = result;
        }

        return result;
    }

    /// <summary>Extracts the media type from a data: URI, if present.</summary>
    [SuppressMessage("Design", "CA1055:URI-like return values should not be strings", Justification = "A data URI media type is not itself a URI.")]
    public static string? GetDataUriMimeType(string uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        ReadOnlySpan<char> span = uri.AsSpan();
        if (!span.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        int commaIndex = span.IndexOf(',');
        if (commaIndex < 5)
        {
            return null;
        }

        ReadOnlySpan<char> metadata = span.Slice(5, commaIndex - 5);
        int semicolonIndex = metadata.IndexOf(';');
        ReadOnlySpan<char> mimeType = semicolonIndex >= 0 ? metadata.Slice(0, semicolonIndex) : metadata;
        return mimeType.Length > 0 ? mimeType.ToString() : null;
    }

    /// <summary>Decodes a data: URI payload.</summary>
    public static ReadOnlyMemory<byte> DecodeDataUri(string uri)
    {
        ArgumentNullException.ThrowIfNull(uri);
        if (!uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            ThrowHelper.ThrowContainer("Malformed glTF data URI: missing the 'data:' scheme.");
        }

        int commaIndex = uri.IndexOf(',', StringComparison.Ordinal);
        if (commaIndex < 5)
        {
            ThrowHelper.ThrowContainer("Malformed glTF data URI.");
        }

        ReadOnlySpan<char> meta = uri.AsSpan(5, commaIndex - 5);
        ReadOnlySpan<char> data = uri.AsSpan(commaIndex + 1);

        if (meta.EndsWith("base64", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                return Convert.FromBase64String(data.ToString());
            }
            catch (FormatException exception)
            {
                throw new GltfContainerError("Malformed base64 glTF data URI.", exception);
            }
        }

        try
        {
            return Encoding.UTF8.GetBytes(Uri.UnescapeDataString(data.ToString()));
        }
        catch (UriFormatException exception)
        {
            throw new GltfContainerError("Malformed percent-encoded glTF data URI.", exception);
        }
    }
}
