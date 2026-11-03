namespace Axrone.AssetGltf;

using System.IO.Compression;

/// <summary>Decoded RGBA8 image payload.</summary>
public sealed class GltfDecodedImage
{
    /// <summary>Pixel width.</summary>
    public required int Width { get; init; }

    /// <summary>Pixel height.</summary>
    public required int Height { get; init; }

    /// <summary>Row-major RGBA8 pixels.</summary>
    public required ReadOnlyMemory<byte> Rgba { get; init; }
}

/// <summary>
/// Self-contained PNG decoder producing RGBA8. Supports all PNG color types and bit depths,
/// filters 0..4 and Adam7 interlacing. Every malformed input is classified at the site that
/// detected it as a <see cref="GltfImageDecodeFailure"/>; decoder defects (index, arithmetic or
/// argument errors) are never converted into a diagnostic and are allowed to terminate the run.
/// </summary>
public static class GltfPngDecoder
{
    private const int MaxDimension = 8192;
    private const long MaxPixels = 32L * 1024 * 1024;
    private const long MaxRawBytes = 256L * 1024 * 1024;

    private const string MarkerIhdr = "IHDR";

    private const string MarkerPlte = "PLTE";

    private const string MarkerTrns = "tRNS";

    private const string MarkerIdat = "IDAT";

    private const string MarkerIend = "IEND";

    private static ReadOnlySpan<byte> Signature => [137, 80, 78, 71, 13, 10, 26, 10];

    private static ReadOnlySpan<byte> Ihdr => "IHDR"u8;

    private static ReadOnlySpan<byte> Plte => "PLTE"u8;

    private static ReadOnlySpan<byte> Trns => "tRNS"u8;

    private static ReadOnlySpan<byte> Idat => "IDAT"u8;

    private static ReadOnlySpan<byte> Iend => "IEND"u8;

    /// <summary>Whether the buffer starts with the PNG signature.</summary>
    /// <param name="data">Candidate bytes.</param>
    public static bool IsPng(ReadOnlySpan<byte> data) =>
        data.Length >= 8 && data[..8].SequenceEqual(Signature);

    /// <summary>Decodes a PNG buffer into RGBA8.</summary>
    /// <param name="png">PNG bytes.</param>
    /// <param name="image">Decoded image on success.</param>
    /// <param name="error">Typed diagnostic on failure.</param>
    /// <returns>Whether the buffer decoded successfully.</returns>
    public static bool TryDecode(
        ReadOnlySpan<byte> png,
        [NotNullWhen(true)] out GltfDecodedImage? image,
        out GltfImageDecodeError? error)
    {
        try
        {
            image = DecodeCore(png);
            error = null;
            return true;
        }
        catch (PngFailureException failure)
        {
            image = null;
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Png,
                failure.Failure,
                failure.Message,
                failure.Marker);
            return false;
        }
        catch (InvalidDataException exception)
        {
            // The deflate stream rejects corrupt entropy-coded data; the exception type
            // carries the classification and the message is human detail only.
            image = null;
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Png,
                GltfImageDecodeFailure.ScanData,
                $"PNG compressed data stream was rejected: {exception.Message}",
                MarkerIdat);
            return false;
        }
        catch (IOException exception)
        {
            image = null;
            error = new GltfImageDecodeError(
                GltfImageCodecKind.Png,
                GltfImageDecodeFailure.Truncated,
                $"PNG compressed data stream stopped early: {exception.Message}",
                MarkerIdat);
            return false;
        }
    }

    private static GltfDecodedImage DecodeCore(ReadOnlySpan<byte> png)
    {
        if (!IsPng(png))
        {
            throw Failure(GltfImageDecodeFailure.Signature, "PNG signature is missing.", null);
        }

        int offset = 8;
        int width = 0;
        int height = 0;
        byte bitDepth = 0;
        byte colorType = 0;
        byte compression = 0;
        byte filterMethod = 0;
        byte interlace = 0;
        bool hasHeader = false;
        bool hasData = false;
        bool hasEnd = false;
        byte[]? palette = null;
        byte[]? transparency = null;
        var idat = new ArrayBufferWriter<byte>();

        while (offset + 12 <= png.Length)
        {
            int length = BinaryPrimitives.ReadInt32BigEndian(png.Slice(offset, 4));
            ReadOnlySpan<byte> type = png.Slice(offset + 4, 4);
            if (length < 0 || length > png.Length - offset - 12)
            {
                throw Failure(
                    GltfImageDecodeFailure.Truncated,
                    "PNG chunk length is outside the buffer.",
                    Encoding.ASCII.GetString(type));
            }

            ReadOnlySpan<byte> data = png.Slice(offset + 8, length);
            offset += 12 + length;

            if (type.SequenceEqual(Ihdr))
            {
                if (hasHeader || length != 13)
                {
                    throw Failure(
                        GltfImageDecodeFailure.Marker,
                        "PNG IHDR is duplicated or malformed.",
                        MarkerIhdr);
                }

                width = BinaryPrimitives.ReadInt32BigEndian(data);
                height = BinaryPrimitives.ReadInt32BigEndian(data[4..]);
                bitDepth = data[8];
                colorType = data[9];
                compression = data[10];
                filterMethod = data[11];
                interlace = data[12];
                hasHeader = true;
            }
            else if (type.SequenceEqual(Plte))
            {
                palette = data.ToArray();
            }
            else if (type.SequenceEqual(Trns))
            {
                transparency = data.ToArray();
            }
            else if (type.SequenceEqual(Idat))
            {
                hasData = true;
                idat.Write(data);
            }
            else if (type.SequenceEqual(Iend))
            {
                hasEnd = true;
                break;
            }
        }

        if (!hasHeader)
        {
            throw Failure(GltfImageDecodeFailure.Truncated, "PNG stream has no IHDR chunk.", MarkerIhdr);
        }

        if (!hasData)
        {
            throw Failure(GltfImageDecodeFailure.Truncated, "PNG stream has no IDAT chunk.", MarkerIdat);
        }

        if (!hasEnd)
        {
            throw Failure(GltfImageDecodeFailure.Truncated, "PNG stream has no IEND chunk.", MarkerIend);
        }

        int channels = ResolveLayout(
            width,
            height,
            bitDepth,
            colorType,
            compression,
            filterMethod,
            interlace,
            palette,
            transparency);

        long expected = ComputeExpectedBytes(width, height, channels, bitDepth, interlace);
        if (expected <= 0 || expected > MaxRawBytes || expected > int.MaxValue)
        {
            throw Failure(
                GltfImageDecodeFailure.LimitExceeded,
                "PNG decoded scanline size exceeds the decoder budget.",
                MarkerIdat);
        }

        byte[] raw = GC.AllocateUninitializedArray<byte>((int)expected);
        Inflate(idat.WrittenSpan, raw);

        byte[] rgba = GC.AllocateUninitializedArray<byte>(width * height * 4, pinned: true);
        int rawOffset = 0;
        int filterBpp = Math.Max(1, (channels * bitDepth + 7) >> 3);
        if (interlace == 0)
        {
            DecodePass(raw, ref rawOffset, rgba, width, height, width, height, 0, 0, 1, 1,
                channels, bitDepth, colorType, filterBpp, palette, transparency);
        }
        else
        {
            DecodeInterlaced(raw, ref rawOffset, rgba, width, height, channels, bitDepth, colorType,
                filterBpp, palette, transparency);
        }

        return new GltfDecodedImage
        {
            Width = width,
            Height = height,
            Rgba = rgba
        };
    }

    private static int ResolveLayout(
        int width,
        int height,
        byte bitDepth,
        byte colorType,
        byte compression,
        byte filterMethod,
        byte interlace,
        byte[]? palette,
        byte[]? transparency)
    {
        if (width <= 0 || height <= 0 || width > MaxDimension || height > MaxDimension)
        {
            throw Failure(
                GltfImageDecodeFailure.LimitExceeded,
                "PNG dimensions are outside the supported range.",
                MarkerIhdr);
        }

        if ((long)width * height > MaxPixels)
        {
            throw Failure(
                GltfImageDecodeFailure.LimitExceeded,
                "PNG pixel count exceeds the decoder budget.",
                MarkerIhdr);
        }

        if (compression != 0 || filterMethod != 0 || interlace > 1)
        {
            throw Failure(
                GltfImageDecodeFailure.Unsupported,
                "PNG compression, filter or interlace method is unsupported.",
                MarkerIhdr);
        }

        int channels = colorType switch
        {
            0 => 1,
            2 => 3,
            3 => 1,
            4 => 2,
            6 => 4,
            _ => 0
        };

        if (channels == 0)
        {
            throw Failure(
                GltfImageDecodeFailure.Unsupported,
                $"PNG color type {colorType} is unsupported.",
                MarkerIhdr);
        }

        bool validDepth = colorType switch
        {
            0 => bitDepth is 1 or 2 or 4 or 8 or 16,
            2 => bitDepth is 8 or 16,
            3 => bitDepth is 1 or 2 or 4 or 8,
            4 => bitDepth is 8 or 16,
            _ => bitDepth is 8 or 16
        };

        if (!validDepth)
        {
            throw Failure(
                GltfImageDecodeFailure.Unsupported,
                $"PNG bit depth {bitDepth} is invalid for color type {colorType}.",
                MarkerIhdr);
        }

        if (colorType == 3 && (palette is null || palette.Length == 0 || palette.Length % 3 != 0))
        {
            throw Failure(
                GltfImageDecodeFailure.Marker,
                "Indexed PNG requires a valid PLTE chunk.",
                MarkerPlte);
        }

        if (transparency is not null)
        {
            bool validTransparency = colorType switch
            {
                0 => transparency.Length == 2,
                2 => transparency.Length == 6,
                3 => palette is not null && transparency.Length <= palette.Length / 3,
                _ => false
            };

            if (!validTransparency)
            {
                throw Failure(
                    GltfImageDecodeFailure.Marker,
                    $"PNG tRNS chunk is invalid for color type {colorType}.",
                    MarkerTrns);
            }
        }

        return channels;
    }

    private static long ComputeExpectedBytes(int width, int height, int channels, byte bitDepth, byte interlace)
    {
        if (interlace == 0)
        {
            return (RowBytes(width, channels, bitDepth) + 1) * (long)height;
        }

        long total = 0;
        ReadOnlySpan<int> offsets = [0, 4, 0, 2, 0, 1, 0];
        ReadOnlySpan<int> steps = [8, 8, 4, 4, 2, 2, 1];
        ReadOnlySpan<int> rows = [0, 0, 4, 0, 2, 0, 1];
        ReadOnlySpan<int> columns = [8, 8, 8, 4, 4, 2, 2];
        for (int pass = 0; pass < 7; pass++)
        {
            int passWidth = PassSize(width, offsets[pass], steps[pass]);
            int passHeight = PassSize(height, rows[pass], columns[pass]);
            if (passWidth > 0 && passHeight > 0)
            {
                total += (RowBytes(passWidth, channels, bitDepth) + 1) * (long)passHeight;
            }
        }

        return total;
    }

    private static void DecodeInterlaced(
        byte[] raw,
        ref int rawOffset,
        byte[] rgba,
        int width,
        int height,
        int channels,
        byte bitDepth,
        byte colorType,
        int filterBpp,
        byte[]? palette,
        byte[]? transparency)
    {
        ReadOnlySpan<int> offsets = [0, 4, 0, 2, 0, 1, 0];
        ReadOnlySpan<int> steps = [8, 8, 4, 4, 2, 2, 1];
        ReadOnlySpan<int> rows = [0, 0, 4, 0, 2, 0, 1];
        ReadOnlySpan<int> columns = [8, 8, 8, 4, 4, 2, 2];
        for (int pass = 0; pass < 7; pass++)
        {
            int passWidth = PassSize(width, offsets[pass], steps[pass]);
            int passHeight = PassSize(height, rows[pass], columns[pass]);
            if (passWidth == 0 || passHeight == 0)
            {
                continue;
            }

            DecodePass(
                raw,
                ref rawOffset,
                rgba,
                width,
                height,
                passWidth,
                passHeight,
                offsets[pass],
                rows[pass],
                steps[pass],
                columns[pass],
                channels,
                bitDepth,
                colorType,
                filterBpp,
                palette,
                transparency);
        }
    }

    private static void DecodePass(
        byte[] raw,
        ref int rawOffset,
        byte[] rgba,
        int imageWidth,
        int imageHeight,
        int passWidth,
        int passHeight,
        int xStart,
        int yStart,
        int xStep,
        int yStep,
        int channels,
        byte bitDepth,
        byte colorType,
        int filterBpp,
        byte[]? palette,
        byte[]? transparency)
    {
        _ = imageHeight;
        int rowBytes = RowBytes(passWidth, channels, bitDepth);
        int previousRowStart = -1;

        for (int rowIndex = 0; rowIndex < passHeight; rowIndex++)
        {
            if (rawOffset >= raw.Length)
            {
                throw Failure(GltfImageDecodeFailure.Truncated, "PNG scanline data ended early.", MarkerIdat);
            }

            int filter = raw[rawOffset++];
            if (filter > 4)
            {
                throw Failure(GltfImageDecodeFailure.Marker, "PNG scanline filter type is invalid.", MarkerIdat);
            }

            if (raw.Length - rawOffset < rowBytes)
            {
                throw Failure(GltfImageDecodeFailure.Truncated, "PNG scanline data ended early.", MarkerIdat);
            }

            int rowStart = rawOffset;
            Span<byte> row = raw.AsSpan(rowStart, rowBytes);
            ReadOnlySpan<byte> previous = previousRowStart < 0
                ? default
                : raw.AsSpan(previousRowStart, rowBytes);

            Unfilter(row, previous, filterBpp, filter);
            int y = yStart + (rowIndex * yStep);
            for (int column = 0; column < passWidth; column++)
            {
                int x = xStart + (column * xStep);
                int pixel = (y * imageWidth + x) * 4;
                ReadPixel(row, column, channels, bitDepth, colorType, palette, transparency, rgba, pixel);
            }

            previousRowStart = rowStart;
            rawOffset += rowBytes;
        }
    }

    private static void Unfilter(Span<byte> row, ReadOnlySpan<byte> previous, int bpp, int filter)
    {
        switch (filter)
        {
            case 1:
                for (int i = bpp; i < row.Length; i++)
                {
                    row[i] = (byte)(row[i] + row[i - bpp]);
                }

                break;
            case 2:
                if (!previous.IsEmpty)
                {
                    for (int i = 0; i < row.Length; i++)
                    {
                        row[i] = (byte)(row[i] + previous[i]);
                    }
                }

                break;
            case 3:
                for (int i = 0; i < row.Length; i++)
                {
                    int left = i >= bpp ? row[i - bpp] : 0;
                    int up = previous.IsEmpty ? 0 : previous[i];
                    row[i] = (byte)(row[i] + ((left + up) >> 1));
                }

                break;
            case 4:
                for (int i = 0; i < row.Length; i++)
                {
                    int left = i >= bpp ? row[i - bpp] : 0;
                    int up = previous.IsEmpty ? 0 : previous[i];
                    int upLeft = i >= bpp && !previous.IsEmpty ? previous[i - bpp] : 0;
                    row[i] = (byte)(row[i] + Paeth(left, up, upLeft));
                }

                break;
            default:
                break;
        }
    }

    private static int Paeth(int left, int up, int upLeft)
    {
        int estimate = left + up - upLeft;
        int leftDistance = Math.Abs(estimate - left);
        int upDistance = Math.Abs(estimate - up);
        int upLeftDistance = Math.Abs(estimate - upLeft);
        return leftDistance <= upDistance && leftDistance <= upLeftDistance
            ? left
            : upDistance <= upLeftDistance
                ? up
                : upLeft;
    }

    private static void ReadPixel(
        ReadOnlySpan<byte> row,
        int column,
        int channels,
        byte bitDepth,
        byte colorType,
        byte[]? palette,
        byte[]? transparency,
        byte[] rgba,
        int target)
    {
        int valueOffset = column * channels;
        switch (colorType)
        {
            case 0:
                {
                    int grayRaw = ReadSample(row, valueOffset, bitDepth, channels);
                    int gray = ScaleTo8(grayRaw, bitDepth);
                    int alpha = transparency is not null &&
                        grayRaw == (int)BinaryPrimitives.ReadUInt16BigEndian(transparency)
                            ? 0
                            : 255;
                    Write(rgba, target, gray, gray, gray, alpha);
                    break;
                }

            case 2:
                {
                    int redRaw = ReadSample(row, valueOffset, bitDepth, channels);
                    int greenRaw = ReadSample(row, (valueOffset) + 1, bitDepth, channels);
                    int blueRaw = ReadSample(row, (valueOffset) + 2, bitDepth, channels);
                    int alpha = 255;
                    if (transparency is not null &&
                        redRaw == BinaryPrimitives.ReadUInt16BigEndian(transparency) &&
                        greenRaw == BinaryPrimitives.ReadUInt16BigEndian(transparency.AsSpan(2)) &&
                        blueRaw == BinaryPrimitives.ReadUInt16BigEndian(transparency.AsSpan(4)))
                    {
                        alpha = 0;
                    }

                    Write(rgba, target, ScaleTo8(redRaw, bitDepth), ScaleTo8(greenRaw, bitDepth),
                        ScaleTo8(blueRaw, bitDepth), alpha);
                    break;
                }

            case 3:
                {
                    int index = ReadSample(row, valueOffset, bitDepth, channels);
                    if (palette is null || index * 3 + 2 >= palette.Length)
                    {
                        throw Failure(
                            GltfImageDecodeFailure.ScanData,
                            $"PNG palette index {index} is out of range.",
                            MarkerPlte);
                    }

                    int alpha = transparency is not null && index < transparency.Length
                        ? transparency[index]
                        : 255;
                    Write(rgba, target, palette[index * 3], palette[index * 3 + 1],
                        palette[index * 3 + 2], alpha);
                    break;
                }

            case 4:
                {
                    int gray = ScaleTo8(ReadSample(row, valueOffset, bitDepth, channels), bitDepth);
                    int alpha = ScaleTo8(ReadSample(row, valueOffset + 1, bitDepth, channels), bitDepth);
                    Write(rgba, target, gray, gray, gray, alpha);
                    break;
                }

            default:
                {
                    int red = ScaleTo8(ReadSample(row, valueOffset, bitDepth, channels), bitDepth);
                    int green = ScaleTo8(ReadSample(row, valueOffset + 1, bitDepth, channels), bitDepth);
                    int blue = ScaleTo8(ReadSample(row, valueOffset + 2, bitDepth, channels), bitDepth);
                    int alpha = ScaleTo8(ReadSample(row, valueOffset + 3, bitDepth, channels), bitDepth);
                    Write(rgba, target, red, green, blue, alpha);
                    break;
                }
        }
    }

    private static int ReadSample(ReadOnlySpan<byte> row, int componentIndex, byte bitDepth, int channels)
    {
        if (bitDepth == 8)
        {
            return row[componentIndex];
        }

        if (bitDepth == 16)
        {
            int byteOffset = componentIndex * 2;
            return (row[byteOffset] << 8) | row[byteOffset + 1];
        }

        int samplesPerByte = 8 / bitDepth;
        int sampleIndex = componentIndex;
        int byteIndex = sampleIndex / samplesPerByte;
        int bitShift = 8 - (bitDepth * ((sampleIndex % samplesPerByte) + 1));
        int mask = (1 << bitDepth) - 1;
        return (row[byteIndex] >> bitShift) & mask;
    }

    private static int ScaleTo8(int sample, byte bitDepth) => bitDepth switch
    {
        8 => sample,
        16 => sample >> 8,
        _ => sample * 255 / ((1 << bitDepth) - 1)
    };

    private static void Write(byte[] rgba, int target, int red, int green, int blue, int alpha)
    {
        rgba[target] = (byte)red;
        rgba[target + 1] = (byte)green;
        rgba[target + 2] = (byte)blue;
        rgba[target + 3] = (byte)alpha;
    }

    private static int RowBytes(int width, int channels, byte bitDepth) =>
        (int)(((long)width * channels * bitDepth + 7) >> 3);

    private static int PassSize(int size, int start, int step) =>
        size <= start ? 0 : (size - start + step - 1) / step;

    private static void Inflate(ReadOnlySpan<byte> compressed, byte[] output)
    {
        using var input = new MemoryStream(compressed.ToArray(), writable: false);
        using var zlib = new ZLibStream(input, CompressionMode.Decompress);
        int total = 0;
        while (total < output.Length)
        {
            int read = zlib.Read(output, total, output.Length - total);
            if (read == 0)
            {
                break;
            }

            total += read;
        }

        if (total != output.Length)
        {
            throw Failure(
                GltfImageDecodeFailure.Truncated,
                "PNG image data ended before all scanlines were decoded.",
                MarkerIdat);
        }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static PngFailureException Failure(
        GltfImageDecodeFailure failure,
        string message,
        string? marker) => new(failure, message, marker);

    [SuppressMessage(
        "Design",
        "CA1064:Exceptions should be public",
        Justification = "Internal control-flow exception; the decoder surface returns typed diagnostics.")]
    private sealed class PngFailureException(
        GltfImageDecodeFailure failure,
        string message,
        string? marker) : Exception(message)
    {
        public GltfImageDecodeFailure Failure { get; } = failure;

        public string? Marker { get; } = marker;
    }
}
