namespace Axrone.AssetGltf;

/// <summary>Encoded image container family detected from magic, MIME type or extension.</summary>
public enum GltfImageCodecKind : byte
{
    /// <summary>No supported codec matched the payload.</summary>
    Unknown = 0,

    /// <summary>PNG raster container.</summary>
    Png = 1,

    /// <summary>Baseline JPEG raster container.</summary>
    Jpeg = 2,

    /// <summary>KTX2 GPU texture container.</summary>
    Ktx2 = 3,
}

/// <summary>Failure category of one encoded image decode or parse attempt.</summary>
public enum GltfImageDecodeFailure : byte
{
    /// <summary>No failure.</summary>
    None = 0,

    /// <summary>Container signature or identifier did not match.</summary>
    Signature = 1,

    /// <summary>The payload ended before the structure was complete.</summary>
    Truncated = 2,

    /// <summary>A marker, chunk or structural element was unexpected or malformed.</summary>
    Marker = 3,

    /// <summary>The feature or profile is intentionally not implemented.</summary>
    Unsupported = 4,

    /// <summary>Entropy-coded scan data was malformed.</summary>
    ScanData = 5,

    /// <summary>A decoder resource budget was exceeded.</summary>
    LimitExceeded = 6,

    /// <summary>A KTX2 container field, offset or metadata entry is invalid.</summary>
    Container = 7,

    /// <summary>The container uses a supercompression scheme with no linked decoder.</summary>
    Supercompression = 8,

    /// <summary>A compressed texture requires a transcoder and none is registered.</summary>
    TranscoderMissing = 9,

    /// <summary>A registered transcoder refused or failed the payload.</summary>
    TranscoderFailed = 10,
}

/// <summary>
/// Typed, deterministic decode diagnostic. <see cref="Marker"/> carries the marker or
/// element name where decoding stopped, when the format exposes one.
/// </summary>
/// <param name="Codec">Container family that produced the diagnostic.</param>
/// <param name="Failure">Failure category.</param>
/// <param name="Message">Human-readable detail; stable for a given input.</param>
/// <param name="Marker">Marker, chunk or key that was being processed, if any.</param>
public readonly record struct GltfImageDecodeError(
    GltfImageCodecKind Codec,
    GltfImageDecodeFailure Failure,
    string Message,
    string? Marker)
{
    /// <summary>Renders the diagnostic in a single deterministic line.</summary>
    public override string ToString() =>
        Marker is null
            ? $"{Codec}.{Failure}: {Message}"
            : $"{Codec}.{Failure} at {Marker}: {Message}";
}
