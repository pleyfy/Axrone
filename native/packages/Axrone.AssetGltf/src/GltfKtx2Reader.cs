namespace Axrone.AssetGltf;

/// <summary>KTX2 supercompression scheme identifiers.</summary>
public enum GltfKtx2SupercompressionScheme : uint
{
    /// <summary>Level payloads are stored uncompressed.</summary>
    None = 0,

    /// <summary>Basis Universal ETC1S with BasisLZ entropy coding.</summary>
    BasisLz = 1,

    /// <summary>Zstandard-compressed level payloads.</summary>
    Zstandard = 2,

    /// <summary>Zlib-compressed level payloads.</summary>
    Zlib = 3,
}

/// <summary>DFD colour model identifiers relevant to glTF texture payloads.</summary>
public enum GltfKtx2ColorModel : byte
{
    /// <summary>Colour model was not reported or is not recognised.</summary>
    Unknown = 0,

    /// <summary>RGB with an optional alpha sample (KHR_DF_MODEL_RGBSDA).</summary>
    RgbaSda = 1,

    /// <summary>Basis Universal ETC1S block payload.</summary>
    ETC1S = 163,

    /// <summary>Basis Universal UASTC block payload.</summary>
    UASTC = 166,
}

/// <summary>Parsed KTX2 header (80 bytes, level index excluded).</summary>
public readonly record struct GltfKtx2Header(
    int VkFormat,
    int TypeSize,
    int PixelWidth,
    int PixelHeight,
    int PixelDepth,
    int LayerCount,
    int FaceCount,
    int LevelCount,
    GltfKtx2SupercompressionScheme Supercompression,
    int DataFormatDescriptorByteOffset,
    int DataFormatDescriptorByteLength,
    int KeyValueDataByteOffset,
    int KeyValueDataByteLength,
    long SupercompressionGlobalDataByteOffset,
    int SupercompressionGlobalDataByteLength);

/// <summary>First KTX2 data format descriptor block (DFD) parsed into scalar fields.</summary>
public readonly record struct GltfKtx2DataFormat(
    int VendorId,
    int DescriptorType,
    int VersionNumber,
    GltfKtx2ColorModel ColorModel,
    byte ColorPrimaries,
    byte TransferFunction,
    byte Flags,
    int TexelBlockWidth,
    int TexelBlockHeight,
    int TexelBlockDepth,
    int BytesPlane0,
    int SampleCount,
    int FirstSampleBitOffset,
    int FirstSampleBitLength,
    int FirstSampleChannelType)
{
    /// <summary>Whether the colour model identifies a Basis Universal payload.</summary>
    public bool IsBasisUniversal => ColorModel is GltfKtx2ColorModel.ETC1S or GltfKtx2ColorModel.UASTC;
}

/// <summary>One KTX2 mip level range inside the container.</summary>
public readonly record struct GltfKtx2Level(
    int Level,
    int Width,
    int Height,
    int ByteOffset,
    int ByteLength,
    int UncompressedByteLength);

/// <summary>One KTX2 key/value metadata entry, preserved verbatim in file order.</summary>
public readonly record struct GltfKtx2KeyValue(string Key, ReadOnlyMemory<byte> Value);

/// <summary>Allocation-free summary of a validated KTX2 container.</summary>
public readonly record struct GltfKtx2Info(
    GltfKtx2Header Header,
    bool HasDataFormat,
    GltfKtx2DataFormat DataFormat,
    int KeyValueCount,
    bool HasDkmd,
    bool HasSDef,
    bool HasODef,
    bool HasK10N,
    bool RequiresBasisTranscode);

/// <summary>Fully parsed KTX2 container. Level ranges point into <see cref="Data"/>.</summary>
public sealed class GltfKtx2Texture
{
    /// <summary>Parsed header.</summary>
    public required GltfKtx2Header Header { get; init; }

    /// <summary>Whether a DFD block was present.</summary>
    public bool HasDataFormat { get; init; }

    /// <summary>Parsed DFD block; default when <see cref="HasDataFormat"/> is false.</summary>
    public GltfKtx2DataFormat DataFormat { get; init; }

    /// <summary>Mip level ranges in container order.</summary>
    public required ImmutableArray<GltfKtx2Level> Levels { get; init; }

    /// <summary>Key/value metadata in file order.</summary>
    public required ImmutableArray<GltfKtx2KeyValue> KeyValues { get; init; }

    /// <summary>Complete container bytes.</summary>
    public required ReadOnlyMemory<byte> Data { get; init; }

    /// <summary>Runtime format derived from <see cref="GltfKtx2Header.VkFormat"/>; unknown for BasisU.</summary>
    public GltfTextureFormat RuntimeFormat { get; init; }

    /// <summary>
    /// Whether the payload can only be consumed after Basis Universal transcoding
    /// (BasisLZ supercompression, ETC1S/UASTC DFD, or vkFormat 0).
    /// </summary>
    public bool RequiresBasisTranscode { get; init; }

    /// <summary>Raw <c>Dkmd</c> metadata when present; empty otherwise.</summary>
    public ReadOnlyMemory<byte> Dkmd => FindKeyValue("Dkmd");

    /// <summary>Raw <c>SDef</c> metadata when present; empty otherwise.</summary>
    public ReadOnlyMemory<byte> SDef => FindKeyValue("SDef");

    /// <summary>Raw <c>ODef</c> metadata when present; empty otherwise.</summary>
    public ReadOnlyMemory<byte> ODef => FindKeyValue("ODef");

    /// <summary>Raw <c>K10N</c> metadata when present; empty otherwise.</summary>
    public ReadOnlyMemory<byte> K10N => FindKeyValue("K10N");

    /// <summary>Looks up one metadata value by exact key.</summary>
    /// <param name="key">Exact, case-sensitive metadata key.</param>
    /// <param name="value">Raw metadata value when found.</param>
    /// <returns>Whether the key exists.</returns>
    public bool TryGetKeyValue(string key, out ReadOnlyMemory<byte> value)
    {
        ArgumentNullException.ThrowIfNull(key);
        foreach (GltfKtx2KeyValue entry in KeyValues)
        {
            if (string.Equals(entry.Key, key, StringComparison.Ordinal))
            {
                value = entry.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    private ReadOnlyMemory<byte> FindKeyValue(string key) =>
        TryGetKeyValue(key, out ReadOnlyMemory<byte> value) ? value : default;
}

/// <summary>
/// External Basis Universal transcoder contract. KTX2 payloads that carry BasisU data cannot be
/// consumed without one; the default import path reports a typed missing-transcoder diagnostic
/// instead of silently falling back to raw bytes.
/// </summary>
public interface IGltfCompressedTextureTranscoder
{
    /// <summary>Stable transcoder identity for diagnostics.</summary>
    string Id { get; }

    /// <summary>Whether the transcoder accepts the parsed container for the requested target.</summary>
    /// <param name="texture">Parsed KTX2 container.</param>
    /// <param name="targetFormat">Requested runtime format.</param>
    bool CanTranscode(GltfKtx2Texture texture, GltfTextureFormat targetFormat);

    /// <summary>Transcodes one parsed container into a runtime texture payload.</summary>
    /// <param name="texture">Parsed KTX2 container.</param>
    /// <param name="targetFormat">Requested runtime format.</param>
    /// <param name="payload">Transcoded payload on success.</param>
    /// <param name="format">Runtime format of the transcoded payload.</param>
    /// <param name="failureReason">Deterministic failure reason when transcoding is refused.</param>
    /// <returns>Whether the payload was transcoded.</returns>
    bool TryTranscode(
        GltfKtx2Texture texture,
        GltfTextureFormat targetFormat,
        [NotNullWhen(true)] out GltfTexturePayload? payload,
        out GltfTextureFormat format,
        out string? failureReason);
}

/// <summary>
/// KTX2 container reader: header, level index, DFD, key/value metadata, supercompression
/// validation and Basis Universal dispatch. Structural failures are fail-closed typed diagnostics.
/// </summary>
public static class GltfKtx2Reader
{
    private const int HeaderLength = 80;
    private const int LevelIndexEntryLength = 24;
    private const int MaxDimension = 16384;
    private const int MaxLevelCount = 32;
    private const int DfdDescriptorBaseLength = 24;
    private const int DfdSampleLength = 16;

    private static ReadOnlySpan<byte> Identifier =>
        [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Whether the buffer starts with the KTX2 identifier.</summary>
    /// <param name="data">Candidate bytes.</param>
    public static bool IsKtx2(ReadOnlySpan<byte> data) =>
        data.Length >= 12 && data[..12].SequenceEqual(Identifier);

    /// <summary>Validates a KTX2 container without allocating.</summary>
    /// <param name="data">Container bytes.</param>
    /// <param name="info">Validated structural summary.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <returns>Whether the container is structurally valid and consumable.</returns>
    public static bool TryValidate(
        ReadOnlySpan<byte> data,
        out GltfKtx2Info info,
        out GltfImageDecodeError? error)
    {
        info = default;
        error = null;
        try
        {
            GltfKtx2Header header = ReadHeader(data);
            ValidateLevelIndex(data, header);
            (GltfKtx2DataFormat format, bool hasDataFormat) = ReadDataFormat(data, header);
            KeyScan keys = ScanKeyValues(data, header, output: null);
            ValidateSupercompression(header, format, hasDataFormat);

            bool requiresBasisTranscode =
                header.Supercompression == GltfKtx2SupercompressionScheme.BasisLz ||
                header.VkFormat == 0 ||
                (hasDataFormat && format.IsBasisUniversal);

            info = new GltfKtx2Info(
                header,
                hasDataFormat,
                format,
                keys.Count,
                keys.HasDkmd,
                keys.HasSDef,
                keys.HasODef,
                keys.HasK10N,
                requiresBasisTranscode);
            return true;
        }
        catch (Ktx2FailureException failure)
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                failure.Failure,
                failure.Message,
                failure.Marker);
            return false;
        }
        catch (Exception exception) when (exception is ArgumentOutOfRangeException or OverflowException)
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                GltfImageDecodeFailure.Container,
                $"KTX2 container parse failed: {exception.Message}",
                null);
            return false;
        }
    }

    /// <summary>Parses a KTX2 container into levels, metadata and format information.</summary>
    /// <param name="data">Container bytes.</param>
    /// <param name="texture">Parsed container.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <returns>Whether the container parsed.</returns>
    public static bool TryRead(
        ReadOnlyMemory<byte> data,
        [NotNullWhen(true)] out GltfKtx2Texture? texture,
        out GltfImageDecodeError? error)
    {
        texture = null;
        if (!TryValidate(data.Span, out GltfKtx2Info info, out error))
        {
            return false;
        }

        try
        {
            GltfKtx2Header header = info.Header;
            ReadOnlySpan<byte> span = data.Span;
            var levels = ImmutableArray.CreateBuilder<GltfKtx2Level>(header.LevelCount);
            for (int level = 0; level < header.LevelCount; level++)
            {
                int entry = HeaderLength + (level * LevelIndexEntryLength);
                int byteOffset = checked((int)BinaryPrimitives.ReadUInt64LittleEndian(span.Slice(entry, 8)));
                int byteLength = checked((int)BinaryPrimitives.ReadUInt64LittleEndian(span.Slice(entry + 8, 8)));
                int uncompressedLength =
                    checked((int)BinaryPrimitives.ReadUInt64LittleEndian(span.Slice(entry + 16, 8)));
                levels.Add(new GltfKtx2Level(
                    level,
                    Math.Max(1, header.PixelWidth >> level),
                    Math.Max(1, header.PixelHeight >> level),
                    byteOffset,
                    byteLength,
                    uncompressedLength));
            }

            var keyValues = new List<GltfKtx2KeyValue>(info.KeyValueCount);
            _ = ScanKeyValues(span, header, keyValues);

            texture = new GltfKtx2Texture
            {
                Header = header,
                HasDataFormat = info.HasDataFormat,
                DataFormat = info.DataFormat,
                Levels = levels.MoveToImmutable(),
                KeyValues = keyValues.ToImmutableArray(),
                Data = data,
                RuntimeFormat = Ktx2Decoder.MapVkFormat(header.VkFormat),
                RequiresBasisTranscode = info.RequiresBasisTranscode,
            };
            return true;
        }
        catch (Exception exception) when (exception is ArgumentOutOfRangeException or OverflowException)
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                GltfImageDecodeFailure.Container,
                $"KTX2 parse failed: {exception.Message}",
                null);
            return false;
        }
    }

    /// <summary>Builds the legacy compressed payload view of a parsed container.</summary>
    /// <param name="texture">Parsed container.</param>
    public static GltfCompressedTexturePayload ToPayload(GltfKtx2Texture texture)
    {
        ArgumentNullException.ThrowIfNull(texture);
        GltfKtx2Header header = texture.Header;
        var levelBytes = ImmutableArray.CreateBuilder<ReadOnlyMemory<byte>>(texture.Levels.Length);
        var mipLevels = ImmutableArray.CreateBuilder<GltfTextureMipLevel>(texture.Levels.Length);
        foreach (GltfKtx2Level level in texture.Levels)
        {
            levelBytes.Add(texture.Data.Slice(level.ByteOffset, level.ByteLength));
            mipLevels.Add(new GltfTextureMipLevel(
                level.Level,
                level.Width,
                level.Height,
                level.ByteOffset,
                level.ByteLength));
        }

        return new GltfCompressedTexturePayload(
            header.VkFormat,
            header.PixelWidth,
            header.PixelHeight,
            header.LevelCount,
            (int)header.Supercompression,
            levelBytes.MoveToImmutable())
        {
            MipLevels = mipLevels.MoveToImmutable(),
        };
    }

    /// <summary>
    /// Produces a consumable payload: native compressed bytes when the container already carries
    /// a runtime format, otherwise a Basis Universal transcode through the registered transcoder.
    /// </summary>
    /// <param name="texture">Parsed container.</param>
    /// <param name="transcoder">Registered transcoder; may be null when none is linked.</param>
    /// <param name="targetFormat">Requested runtime format for transcoding.</param>
    /// <param name="payload">Consumable payload on success.</param>
    /// <param name="format">Runtime format of the payload.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <returns>Whether a consumable payload was produced.</returns>
    public static bool TryResolvePayload(
        GltfKtx2Texture texture,
        IGltfCompressedTextureTranscoder? transcoder,
        GltfTextureFormat targetFormat,
        [NotNullWhen(true)] out GltfTexturePayload? payload,
        out GltfTextureFormat format,
        out GltfImageDecodeError? error)
    {
        ArgumentNullException.ThrowIfNull(texture);
        payload = null;
        format = GltfTextureFormat.Unknown;
        error = null;

        if (!texture.RequiresBasisTranscode)
        {
            payload = ToPayload(texture);
            format = texture.RuntimeFormat;
            return true;
        }

        if (transcoder is null)
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                GltfImageDecodeFailure.TranscoderMissing,
                "KTX2 texture carries Basis Universal data but no IGltfCompressedTextureTranscoder is registered; " +
                "register a transcoder or retain the compressed payload.",
                "transcoder");
            return false;
        }

        if (!transcoder.CanTranscode(texture, targetFormat))
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                GltfImageDecodeFailure.TranscoderFailed,
                $"Transcoder '{transcoder.Id}' refuses target format '{targetFormat}' for this KTX2 payload.",
                "transcoder");
            return false;
        }

        if (!transcoder.TryTranscode(
                texture,
                targetFormat,
                out GltfTexturePayload? output,
                out GltfTextureFormat outputFormat,
                out string? failureReason))
        {
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Ktx2,
                GltfImageDecodeFailure.TranscoderFailed,
                failureReason ?? $"Transcoder '{transcoder.Id}' failed without a reason.",
                "transcoder");
            return false;
        }

        payload = output;
        format = outputFormat;
        return true;
    }

    private static GltfKtx2Header ReadHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HeaderLength)
        {
            Throw(
                GltfImageDecodeFailure.Truncated,
                $"KTX2 payload is {data.Length} bytes; the header requires {HeaderLength}.",
                "header");
        }

        if (!data[..12].SequenceEqual(Identifier))
        {
            Throw(GltfImageDecodeFailure.Signature, "KTX2 identifier is invalid.", "identifier");
        }

        uint vkFormat = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(12, 4));
        uint typeSize = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(16, 4));
        uint width = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(20, 4));
        uint height = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(24, 4));
        uint depth = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(28, 4));
        uint layerCount = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(32, 4));
        uint faceCount = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(36, 4));
        uint levelCount = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(40, 4));
        uint scheme = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(44, 4));
        int dfdOffset = ReadInt32(data, 48, "header");
        int dfdLength = ReadInt32(data, 52, "header");
        int kvdOffset = ReadInt32(data, 56, "header");
        int kvdLength = ReadInt32(data, 60, "header");
        ulong sgdOffset = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(64, 8));
        ulong sgdLength = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(72, 8));

        if (width == 0 || height == 0)
        {
            Throw(GltfImageDecodeFailure.Container, "KTX2 texture dimensions must be positive.", "header");
        }

        if (width > MaxDimension || height > MaxDimension)
        {
            Throw(
                GltfImageDecodeFailure.LimitExceeded,
                $"KTX2 texture dimensions exceed {MaxDimension}.",
                "header");
        }

        if (depth > 1)
        {
            Throw(
                GltfImageDecodeFailure.Unsupported,
                "3D KTX2 textures are unsupported by the glTF texture profile.",
                "header");
        }

        if (layerCount > 1)
        {
            Throw(
                GltfImageDecodeFailure.Unsupported,
                "Array KTX2 textures are unsupported by the glTF texture profile.",
                "header");
        }

        if (faceCount > 1)
        {
            Throw(
                GltfImageDecodeFailure.Unsupported,
                "Cubemap KTX2 textures are unsupported by the glTF texture profile.",
                "header");
        }

        uint normalizedLevelCount = Math.Max(1u, levelCount);
        if (normalizedLevelCount > MaxLevelCount)
        {
            Throw(
                GltfImageDecodeFailure.LimitExceeded,
                $"KTX2 level count {normalizedLevelCount} exceeds {MaxLevelCount}.",
                "header");
        }

        if (scheme > 3)
        {
            Throw(
                GltfImageDecodeFailure.Container,
                $"KTX2 supercompression scheme {scheme} is not defined.",
                "header");
        }

        if (sgdOffset > int.MaxValue || sgdLength > int.MaxValue)
        {
            Throw(
                GltfImageDecodeFailure.LimitExceeded,
                "KTX2 supercompression global data range exceeds 2 GiB.",
                "header");
        }

        return new GltfKtx2Header(
            checked((int)vkFormat),
            checked((int)typeSize),
            checked((int)width),
            checked((int)height),
            1,
            1,
            1,
            (int)normalizedLevelCount,
            (GltfKtx2SupercompressionScheme)scheme,
            dfdOffset,
            dfdLength,
            kvdOffset,
            kvdLength,
            (long)sgdOffset,
            (int)sgdLength);
    }

    private static void ValidateLevelIndex(ReadOnlySpan<byte> data, GltfKtx2Header header)
    {
        long indexEnd = HeaderLength + ((long)header.LevelCount * LevelIndexEntryLength);
        if (indexEnd > data.Length)
        {
            Throw(
                GltfImageDecodeFailure.Truncated,
                "KTX2 level index is truncated.",
                "level index");
        }

        for (int level = 0; level < header.LevelCount; level++)
        {
            int entry = HeaderLength + (level * LevelIndexEntryLength);
            ulong byteOffset = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(entry, 8));
            ulong byteLength = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(entry + 8, 8));
            ulong uncompressed = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(entry + 16, 8));

            if (byteLength == 0 || byteLength > int.MaxValue || uncompressed > int.MaxValue)
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    $"KTX2 level {level} has an invalid size.",
                    $"level {level}");
            }

            if (byteOffset < (ulong)indexEnd || byteOffset > (ulong)data.Length)
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    $"KTX2 level {level} offset is outside the container.",
                    $"level {level}");
            }

            if (byteOffset + byteLength > (ulong)data.Length)
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    $"KTX2 level {level} payload exceeds the container.",
                    $"level {level}");
            }

            if ((byteOffset & 7u) != 0)
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    $"KTX2 level {level} payload is not 8-byte aligned.",
                    $"level {level}");
            }
        }

        ValidateRegion(
            header.DataFormatDescriptorByteOffset,
            header.DataFormatDescriptorByteLength,
            (int)indexEnd,
            data.Length,
            "DFD",
            requireAlignment: true);
        ValidateRegion(
            header.KeyValueDataByteOffset,
            header.KeyValueDataByteLength,
            (int)indexEnd,
            data.Length,
            "KVD",
            requireAlignment: true);
        ValidateRegion(
            (int)header.SupercompressionGlobalDataByteOffset,
            header.SupercompressionGlobalDataByteLength,
            (int)indexEnd,
            data.Length,
            "SGD",
            requireAlignment: false);
    }

    private static void ValidateRegion(
        int offset,
        int length,
        int minimumOffset,
        int totalLength,
        string marker,
        bool requireAlignment)
    {
        if (length == 0)
        {
            return;
        }

        if (length < 0 || offset < minimumOffset || offset >= totalLength)
        {
            Throw(
                GltfImageDecodeFailure.Container,
                $"KTX2 {marker} offset is outside the payload.",
                marker);
        }

        if (length > totalLength - offset)
        {
            Throw(
                GltfImageDecodeFailure.Container,
                $"KTX2 {marker} range exceeds the payload.",
                marker);
        }

        if (requireAlignment && (offset & 3) != 0)
        {
            Throw(
                GltfImageDecodeFailure.Container,
                $"KTX2 {marker} offset is not 4-byte aligned.",
                marker);
        }
    }

    private static (GltfKtx2DataFormat Format, bool Present) ReadDataFormat(
        ReadOnlySpan<byte> data,
        GltfKtx2Header header)
    {
        if (header.DataFormatDescriptorByteLength == 0)
        {
            return (default, false);
        }

        ReadOnlySpan<byte> dfd = data.Slice(
            header.DataFormatDescriptorByteOffset,
            header.DataFormatDescriptorByteLength);
        if (dfd.Length < 4)
        {
            Throw(GltfImageDecodeFailure.Container, "KTX2 DFD is truncated.", "DFD");
        }

        uint totalSize = BinaryPrimitives.ReadUInt32LittleEndian(dfd);
        if (totalSize < 4 + DfdDescriptorBaseLength || totalSize > (uint)dfd.Length)
        {
            Throw(GltfImageDecodeFailure.Container, "KTX2 DFD total size is invalid.", "DFD");
        }

        uint vendorWord = BinaryPrimitives.ReadUInt32LittleEndian(dfd.Slice(4, 4));
        uint sizeAndVersion = BinaryPrimitives.ReadUInt32LittleEndian(dfd.Slice(8, 4));
        int descriptorBlockSize = (int)((sizeAndVersion >> 16) & 0xFFFFu);
        if (descriptorBlockSize < DfdDescriptorBaseLength ||
            (descriptorBlockSize & 3) != 0 ||
            4 + descriptorBlockSize > totalSize)
        {
            Throw(GltfImageDecodeFailure.Container, "KTX2 DFD descriptor block size is invalid.", "DFD");
        }

        int sampleBytes = descriptorBlockSize - DfdDescriptorBaseLength;
        if (sampleBytes % DfdSampleLength != 0)
        {
            Throw(GltfImageDecodeFailure.Container, "KTX2 DFD sample table is misaligned.", "DFD");
        }

        int vendorId = (int)(vendorWord & 0x1FFFFu);
        int descriptorType = (int)((vendorWord >> 17) & 0x7FFFu);
        int versionNumber = (int)(sizeAndVersion & 0xFFFFu);
        byte colorModelByte = dfd[12];
        int sampleCount = sampleBytes / DfdSampleLength;
        int firstBitOffset = 0;
        int firstBitLength = 0;
        int firstChannelType = 0;
        if (sampleCount > 0)
        {
            int sampleOffset = 4 + DfdDescriptorBaseLength;
            firstBitOffset = BinaryPrimitives.ReadUInt16LittleEndian(dfd.Slice(sampleOffset, 2));
            firstBitLength = dfd[sampleOffset + 2];
            firstChannelType = dfd[sampleOffset + 3];
        }

        var format = new GltfKtx2DataFormat(
            vendorId,
            descriptorType,
            versionNumber,
            (GltfKtx2ColorModel)colorModelByte,
            dfd[13],
            dfd[14],
            dfd[15],
            dfd[16] + 1,
            dfd[17] + 1,
            dfd[18] + 1,
            dfd[20],
            sampleCount,
            firstBitOffset,
            firstBitLength,
            firstChannelType);
        return (format, true);
    }

    private static KeyScan ScanKeyValues(
        ReadOnlySpan<byte> data,
        GltfKtx2Header header,
        List<GltfKtx2KeyValue>? output)
    {
        var scan = default(KeyScan);
        if (header.KeyValueDataByteLength == 0)
        {
            return scan;
        }

        ReadOnlySpan<byte> kvd = data.Slice(
            header.KeyValueDataByteOffset,
            header.KeyValueDataByteLength);
        int end = kvd.Length;
        int position = 0;
        while (position < end)
        {
            // An entry needs the 4-byte size plus at least a one-character key and its NUL.
            if (end - position < 6)
            {
                Throw(GltfImageDecodeFailure.Container, "KTX2 key/value entry header is truncated.", "KVD");
            }

            uint entryLength = BinaryPrimitives.ReadUInt32LittleEndian(kvd.Slice(position, 4));
            position += 4;
            if (entryLength < 2 || entryLength > (uint)(end - position))
            {
                Throw(GltfImageDecodeFailure.Container, "KTX2 key/value entry is truncated.", "KVD");
            }

            ReadOnlySpan<byte> entry = kvd.Slice(position, (int)entryLength);
            int separator = entry.IndexOf((byte)0);
            if (separator <= 0)
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    "KTX2 key/value entry has no null-terminated key.",
                    "KVD");
            }

            ReadOnlySpan<byte> key = entry[..separator];
            ReadOnlySpan<byte> value = entry[(separator + 1)..];
            scan.Count++;
            scan.HasDkmd |= key.SequenceEqual("Dkmd"u8);
            scan.HasSDef |= key.SequenceEqual("SDef"u8);
            scan.HasODef |= key.SequenceEqual("ODef"u8);
            scan.HasK10N |= key.SequenceEqual("K10N"u8);
            output?.Add(new GltfKtx2KeyValue(Encoding.UTF8.GetString(key), value.ToArray()));

            uint paddedLength = (entryLength + 3u) & ~3u;
            if (paddedLength > (uint)(end - position))
            {
                Throw(
                    GltfImageDecodeFailure.Container,
                    "KTX2 key/value entry padding exceeds the KVD region.",
                    "KVD");
            }

            position += (int)paddedLength;
        }

        return scan;
    }

    private static void ValidateSupercompression(
        GltfKtx2Header header,
        GltfKtx2DataFormat format,
        bool hasDataFormat)
    {
        switch (header.Supercompression)
        {
            case GltfKtx2SupercompressionScheme.None:
                break;
            case GltfKtx2SupercompressionScheme.BasisLz:
                if (!hasDataFormat || format.ColorModel != GltfKtx2ColorModel.ETC1S)
                {
                    Throw(
                        GltfImageDecodeFailure.Container,
                        "KTX2 BasisLZ supercompression requires an ETC1S data format descriptor.",
                        "supercompression");
                }

                if (header.SupercompressionGlobalDataByteLength == 0)
                {
                    Throw(
                        GltfImageDecodeFailure.Container,
                        "KTX2 BasisLZ supercompression requires global data.",
                        "supercompression");
                }

                break;
            case GltfKtx2SupercompressionScheme.Zstandard:
                Throw(
                    GltfImageDecodeFailure.Supercompression,
                    "KTX2 Zstandard supercompression (scheme 2) is unsupported; no zstd decoder is linked.",
                    "supercompression");
                break;
            case GltfKtx2SupercompressionScheme.Zlib:
                Throw(
                    GltfImageDecodeFailure.Supercompression,
                    "KTX2 zlib supercompression (scheme 3) is unsupported; no zlib decoder is linked.",
                    "supercompression");
                break;
            default:
                Throw(
                    GltfImageDecodeFailure.Container,
                    $"KTX2 supercompression scheme {(uint)header.Supercompression} is not defined.",
                    "supercompression");
                break;
        }

        if (header.VkFormat == 0 &&
            (!hasDataFormat ||
             format.ColorModel is not (GltfKtx2ColorModel.ETC1S or GltfKtx2ColorModel.UASTC)))
        {
            Throw(
                GltfImageDecodeFailure.Container,
                "KTX2 vkFormat 0 requires a Basis Universal ETC1S or UASTC data format descriptor.",
                "DFD");
        }
    }

    private static int ReadInt32(ReadOnlySpan<byte> data, int offset, string marker)
    {
        uint value = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(offset, 4));
        if (value > int.MaxValue)
        {
            Throw(
                GltfImageDecodeFailure.LimitExceeded,
                $"KTX2 {marker} range exceeds 2 GiB.",
                marker);
        }

        return (int)value;
    }

    private static void Throw(GltfImageDecodeFailure failure, string message, string marker) =>
        throw new Ktx2FailureException(failure, message, marker);

    [SuppressMessage(
        "Design",
        "CA1064:Exceptions should be public",
        Justification = "Internal control-flow exception; the reader surface returns typed diagnostics.")]
    private sealed class Ktx2FailureException : Exception
    {
        public Ktx2FailureException(GltfImageDecodeFailure failure, string message, string marker)
            : base(message)
        {
            Failure = failure;
            Marker = marker;
        }

        public GltfImageDecodeFailure Failure { get; }

        public string Marker { get; }
    }

    private struct KeyScan
    {
        public int Count;
        public bool HasDkmd;
        public bool HasSDef;
        public bool HasODef;
        public bool HasK10N;
    }
}
