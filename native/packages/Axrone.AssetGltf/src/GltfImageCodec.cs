namespace Axrone.AssetGltf;

/// <summary>
/// Deterministic resolution result for one encoded image: either decoded RGBA8, a parsed KTX2
/// container, or a typed diagnostic. Exactly one of <see cref="Decoded"/> and <see cref="Ktx2"/>
/// is populated when <see cref="Error"/> is null.
/// </summary>
/// <param name="Codec">Detected container family.</param>
/// <param name="MimeType">Canonical MIME type for the detected container.</param>
/// <param name="Decoded">Decoded RGBA8 raster image, when the codec is PNG or JPEG.</param>
/// <param name="Ktx2">Parsed compressed container, when the codec is KTX2.</param>
/// <param name="Error">Typed diagnostic when resolution failed.</param>
public sealed record GltfImagePayload(
    GltfImageCodecKind Codec,
    string MimeType,
    GltfDecodedImage? Decoded,
    GltfKtx2Texture? Ktx2,
    GltfImageDecodeError? Error)
{
    /// <summary>Whether the payload carries a decoded raster image.</summary>
    public bool IsDecoded => Decoded is not null;

    /// <summary>Whether the payload carries a parsed KTX2 container.</summary>
    public bool IsCompressed => Ktx2 is not null;

    /// <summary>Whether resolution succeeded.</summary>
    public bool Success => Error is null;
}

/// <summary>
/// Single entry point for the encoded image family. Codec selection prefers container magic, then
/// MIME type, then URI extension, and every rejection is a typed, deterministic diagnostic.
/// </summary>
public static class GltfImageCodec
{
    /// <summary>Detects the encoded container family.</summary>
    /// <param name="data">Encoded bytes; magic wins over metadata.</param>
    /// <param name="mimeType">Optional MIME type (for example <c>image/jpeg</c>).</param>
    /// <param name="uri">Optional source URI used for its extension when magic is inconclusive.</param>
    /// <returns>Detected container family.</returns>
    public static GltfImageCodecKind Detect(
        ReadOnlySpan<byte> data,
        string? mimeType = null,
        string? uri = null)
    {
        if (GltfPngDecoder.IsPng(data))
        {
            return GltfImageCodecKind.Png;
        }

        if (GltfJpegDecoder.IsJpeg(data))
        {
            return GltfImageCodecKind.Jpeg;
        }

        if (GltfKtx2Reader.IsKtx2(data))
        {
            return GltfImageCodecKind.Ktx2;
        }

        if (!string.IsNullOrEmpty(mimeType))
        {
            if (string.Equals(mimeType, "image/png", StringComparison.OrdinalIgnoreCase))
            {
                return GltfImageCodecKind.Png;
            }

            if (string.Equals(mimeType, "image/jpeg", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(mimeType, "image/jpg", StringComparison.OrdinalIgnoreCase))
            {
                return GltfImageCodecKind.Jpeg;
            }

            if (string.Equals(mimeType, "image/ktx2", StringComparison.OrdinalIgnoreCase))
            {
                return GltfImageCodecKind.Ktx2;
            }
        }

        return DetectExtension(uri);
    }

    /// <summary>Decodes PNG or baseline JPEG bytes into RGBA8.</summary>
    /// <param name="data">Encoded raster bytes.</param>
    /// <param name="mimeType">Optional MIME type used when magic is inconclusive.</param>
    /// <param name="uri">Optional URI used when magic and MIME are inconclusive.</param>
    /// <param name="image">Decoded image on success.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <param name="upsampling">Chroma upsampling mode for JPEG scans.</param>
    /// <returns>Whether a raster image was decoded.</returns>
    public static bool TryDecodeRaster(
        ReadOnlySpan<byte> data,
        string? mimeType,
        string? uri,
        [NotNullWhen(true)] out GltfDecodedImage? image,
        out GltfImageDecodeError? error,
        GltfJpegChromaUpsampling upsampling = GltfJpegChromaUpsampling.Nearest)
    {
        image = null;
        error = null;
        GltfImageCodecKind codec = Detect(data, mimeType, uri);
        switch (codec)
        {
            case GltfImageCodecKind.Png:
                if (GltfPngDecoder.TryDecode(data, out image, out string? pngError))
                {
                    return true;
                }

                error = new GltfImageDecodeError(
                    GltfImageCodecKind.Png,
                    ClassifyPngFailure(pngError),
                    pngError ?? "PNG decode failed.",
                    null);
                return false;

            case GltfImageCodecKind.Jpeg:
                return GltfJpegDecoder.TryDecode(data, out image, out error, upsampling);

            case GltfImageCodecKind.Ktx2:
                error = new GltfImageDecodeError(
                    GltfImageCodecKind.Ktx2,
                    GltfImageDecodeFailure.Unsupported,
                    "KTX2 is a GPU texture container; parse it with GltfKtx2Reader instead of the raster decoder.",
                    "identifier");
                return false;

            default:
                error = new GltfImageDecodeError(
                    GltfImageCodecKind.Unknown,
                    GltfImageDecodeFailure.Signature,
                    "Encoded image signature, MIME type and URI extension did not match a supported codec.",
                    null);
                return false;
        }
    }

    /// <summary>Resolves one encoded image into a decoded raster or a parsed KTX2 container.</summary>
    /// <param name="data">Encoded bytes.</param>
    /// <param name="mimeType">Optional MIME type used when magic is inconclusive.</param>
    /// <param name="uri">Optional URI used when magic and MIME are inconclusive.</param>
    /// <param name="payload">Deterministic resolution result on success.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <param name="upsampling">Chroma upsampling mode for JPEG scans.</param>
    /// <returns>Whether the image resolved.</returns>
    public static bool TryResolve(
        ReadOnlyMemory<byte> data,
        string? mimeType,
        string? uri,
        [NotNullWhen(true)] out GltfImagePayload? payload,
        out GltfImageDecodeError? error,
        GltfJpegChromaUpsampling upsampling = GltfJpegChromaUpsampling.Nearest)
    {
        payload = null;
        GltfImageCodecKind codec = Detect(data.Span, mimeType, uri);
        switch (codec)
        {
            case GltfImageCodecKind.Ktx2:
                if (!GltfKtx2Reader.TryRead(data, out GltfKtx2Texture? texture, out error))
                {
                    return false;
                }

                payload = new GltfImagePayload(codec, "image/ktx2", null, texture, null);
                return true;

            case GltfImageCodecKind.Png:
            case GltfImageCodecKind.Jpeg:
                if (!TryDecodeRaster(data.Span, mimeType, uri, out GltfDecodedImage? image, out error, upsampling))
                {
                    return false;
                }

                payload = new GltfImagePayload(codec, MimeTypeOf(codec), image, null, null);
                return true;

            default:
                error = new GltfImageDecodeError(
                    GltfImageCodecKind.Unknown,
                    GltfImageDecodeFailure.Signature,
                    "Encoded image signature, MIME type and URI extension did not match a supported codec.",
                    null);
                return false;
        }
    }

    /// <summary>Canonical MIME type for a detected container family.</summary>
    /// <param name="codec">Detected container family.</param>
    public static string MimeTypeOf(GltfImageCodecKind codec) => codec switch
    {
        GltfImageCodecKind.Png => "image/png",
        GltfImageCodecKind.Jpeg => "image/jpeg",
        GltfImageCodecKind.Ktx2 => "image/ktx2",
        _ => "application/octet-stream",
    };

    private static GltfImageCodecKind DetectExtension(string? uri)
    {
        if (string.IsNullOrEmpty(uri))
        {
            return GltfImageCodecKind.Unknown;
        }

        ReadOnlySpan<char> path = uri.AsSpan();
        int query = path.IndexOfAny('?', '#');
        if (query >= 0)
        {
            path = path[..query];
        }

        if (path.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageCodecKind.Png;
        }

        if (path.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageCodecKind.Jpeg;
        }

        if (path.EndsWith(".ktx2", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageCodecKind.Ktx2;
        }

        return GltfImageCodecKind.Unknown;
    }

    private static GltfImageDecodeFailure ClassifyPngFailure(string? message)
    {
        if (string.IsNullOrEmpty(message))
        {
            return GltfImageDecodeFailure.Marker;
        }

        if (message.Contains("signature", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageDecodeFailure.Signature;
        }

        if (message.Contains("budget", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("exceeds", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageDecodeFailure.LimitExceeded;
        }

        if (message.Contains("unsupported", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("invalid for its color type", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageDecodeFailure.Unsupported;
        }

        if (message.Contains("ended", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("requires", StringComparison.OrdinalIgnoreCase))
        {
            return GltfImageDecodeFailure.Truncated;
        }

        return GltfImageDecodeFailure.Marker;
    }
}
