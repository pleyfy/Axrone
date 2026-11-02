namespace Axrone.AssetGltf.Tests;

public sealed class GltfJpegDecoderTests
{
    [Fact]
    public void Decode_Grayscale1x1_RoundTripsExactly()
    {
        byte[] rgba = [37, 37, 37, 255];
        byte[] jpeg = JpegWriter.Encode(rgba, 1, 1, components: 1);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        error.Should().BeNull();
        image!.Width.Should().Be(1);
        image.Height.Should().Be(1);
        image.Rgba.ToArray().Should().Equal(JpegWriter.RenderReference(rgba, 1, 1, 1, 1, 1, GltfJpegChromaUpsampling.Nearest));
    }

    [Fact]
    public void Decode_Grayscale8x8_Gradient_RoundTripsWithinQuantizationTolerance()
    {
        const int size = 8;
        byte[] rgba = Gradient(size, size);
        byte[] jpeg = JpegWriter.Encode(rgba, size, size, components: 1);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        byte[] expected = JpegWriter.RenderReference(rgba, size, size, 1, 1, 1, GltfJpegChromaUpsampling.Nearest);
        AssertNear(image!.Rgba.Span, expected, tolerance: 8);
    }

    [Fact]
    public void Decode_Grayscale8x8_MatchesDirectIdctReferenceBytes()
    {
        byte[] rgba = Gradient(8, 8);
        byte[] jpeg = JpegWriter.Encode(rgba, 8, 8, components: 1);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        byte[] expected = JpegWriter.RenderDirectIdctGray(rgba, 8, 8);
        image!.Rgba.ToArray().Should().Equal(expected);
    }

    [Fact]
    public void Decode_Rgb8x8_Flat_RoundTripsExactly()
    {
        const int size = 8;
        byte[] rgba = Solid(size, size, 200, 100, 50);
        byte[] jpeg = JpegWriter.Encode(rgba, size, size, components: 3);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        byte[] expected = JpegWriter.RenderReference(rgba, size, size, 3, 1, 1, GltfJpegChromaUpsampling.Nearest);
        image!.Width.Should().Be(size);
        image.Height.Should().Be(size);
        image.Rgba.ToArray().Should().Equal(expected);
    }

    [Fact]
    public void Decode_Rgb16x16_Gradient_RoundTripsWithinQuantizationTolerance()
    {
        const int size = 16;
        byte[] rgba = Gradient(size, size);
        byte[] jpeg = JpegWriter.Encode(rgba, size, size, components: 3);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        byte[] expected = JpegWriter.RenderReference(rgba, size, size, 3, 1, 1, GltfJpegChromaUpsampling.Nearest);
        AssertNear(image!.Rgba.Span, expected, tolerance: 8);
    }

    [Fact]
    public void Decode_16x16_420_NearestChroma_MatchesReference()
    {
        const int size = 16;
        byte[] rgba = Quadrants(size);
        byte[] jpeg = JpegWriter.Encode(rgba, size, size, components: 3, horizontalSampling: 2, verticalSampling: 2);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        byte[] expected = JpegWriter.RenderReference(rgba, size, size, 3, 2, 2, GltfJpegChromaUpsampling.Nearest);
        AssertNear(image!.Rgba.Span, expected, tolerance: 8);

        GltfJpegDecoder.TryDecode(
                jpeg,
                out GltfDecodedImage? bilinear,
                out _,
                GltfJpegChromaUpsampling.Bilinear)
            .Should().BeTrue();
        bilinear!.Rgba.Span.SequenceEqual(image.Rgba.Span).Should().BeFalse();
    }

    [Fact]
    public void Decode_5x3_Padding_ClipsToFrameAndFillsAlpha()
    {
        const int width = 5;
        const int height = 3;
        byte[] rgba = Solid(width, height, 10, 220, 30);
        byte[] jpeg = JpegWriter.Encode(rgba, width, height, components: 3);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        image!.Width.Should().Be(width);
        image.Height.Should().Be(height);
        byte[] expected = JpegWriter.RenderReference(rgba, width, height, 3, 1, 1, GltfJpegChromaUpsampling.Nearest);
        image.Rgba.ToArray().Should().Equal(expected);
    }

    [Fact]
    public void Decode_StridePadding_PreservesGapBytes()
    {
        const int width = 5;
        const int height = 4;
        const int stride = (width * 4) + 7;
        byte[] rgba = Solid(width, height, 90, 120, 60);
        byte[] jpeg = JpegWriter.Encode(rgba, width, height, components: 3);

        byte[] destination = new byte[stride * height];
        destination.AsSpan().Fill(0xAA);

        bool ok = GltfJpegDecoder.TryDecode(
            jpeg,
            destination,
            stride,
            out int decodedWidth,
            out int decodedHeight,
            out GltfImageDecodeError? error);

        ok.Should().BeTrue(error.ToString());
        decodedWidth.Should().Be(width);
        decodedHeight.Should().Be(height);

        byte[] expected = JpegWriter.RenderReference(rgba, width, height, 3, 1, 1, GltfJpegChromaUpsampling.Nearest);
        for (int row = 0; row < height; row++)
        {
            destination.AsSpan(row * stride, width * 4)
                .SequenceEqual(expected.AsSpan(row * width * 4, width * 4))
                .Should().BeTrue();
            destination.AsSpan((row * stride) + (width * 4), stride - (width * 4))
                .ToArray()
                .Should().Equal(Enumerable.Repeat((byte)0xAA, stride - (width * 4)));
        }
    }

    [Fact]
    public void Decode_RestartMarkers_ProduceSamePixels()
    {
        const int size = 16;
        byte[] rgba = Quadrants(size);
        byte[] plain = JpegWriter.Encode(rgba, size, size, components: 3, horizontalSampling: 2, verticalSampling: 2);
        byte[] restarted = JpegWriter.Encode(
            rgba,
            size,
            size,
            components: 3,
            horizontalSampling: 2,
            verticalSampling: 2,
            restartInterval: 1);

        GltfJpegDecoder.TryDecode(plain, out GltfDecodedImage? first, out GltfImageDecodeError? firstError)
            .Should().BeTrue(firstError.ToString());
        GltfJpegDecoder.TryDecode(restarted, out GltfDecodedImage? second, out GltfImageDecodeError? secondError)
            .Should().BeTrue(secondError.ToString());

        second!.Rgba.Span.SequenceEqual(first!.Rgba.Span).Should().BeTrue();
    }

    [Fact]
    public void Decode_Repeated_InDeterministic()
    {
        byte[] rgba = Gradient(13, 9);
        byte[] jpeg = JpegWriter.Encode(rgba, 13, 9, components: 3);

        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? first, out _).Should().BeTrue();
        GltfJpegDecoder.TryDecode(jpeg, out GltfDecodedImage? second, out _).Should().BeTrue();

        second!.Rgba.ToArray().Should().Equal(first!.Rgba.ToArray());
    }

    [Fact]
    public void Decode_MissingEoi_FailsClosedWithMarker()
    {
        byte[] jpeg = JpegWriter.Encode(Solid(8, 8, 1, 2, 3), 8, 8, components: 3);
        byte[] truncated = jpeg[..^2];

        GltfJpegDecoder.TryDecode(truncated, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error.Should().NotBeNull();
        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Truncated);
        error.Value.Marker.Should().Be("EOI");
    }

    [Fact]
    public void Decode_TruncatedScan_FailsClosed()
    {
        byte[] jpeg = JpegWriter.Encode(Gradient(16, 16), 16, 16, components: 3);
        byte[] truncated = jpeg[..(jpeg.Length * 2 / 3)];

        GltfJpegDecoder.TryDecode(truncated, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error.Should().NotBeNull();
        error!.Value.Failure.Should().BeOneOf(
            GltfImageDecodeFailure.Truncated,
            GltfImageDecodeFailure.ScanData,
            GltfImageDecodeFailure.Marker);
        error.Value.Marker.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void Decode_InvalidMarkerPrefix_FailsClosed()
    {
        byte[] jpeg = [0xFF, 0xD8, 0x00, 0x00];

        GltfJpegDecoder.TryDecode(jpeg, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        error.Value.Marker.Should().Be("marker");
    }

    [Fact]
    public void Decode_EoiBeforeScan_FailsClosed()
    {
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xD9];

        GltfJpegDecoder.TryDecode(jpeg, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        error.Value.Marker.Should().Be("EOI");
    }

    [Fact]
    public void Decode_ProgressiveSof_IsRejectedAsUnsupported()
    {
        byte[] jpeg = JpegWriter.Encode(Solid(8, 8, 50, 60, 70), 8, 8, components: 3);
        int sof = FindMarker(jpeg, 0xC0);
        sof.Should().BeGreaterThan(0);
        jpeg[sof + 1] = 0xC2;

        GltfJpegDecoder.TryDecode(jpeg, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
        error.Value.Marker.Should().Be("SOF2");
    }

    [Fact]
    public void Decode_TwelveBitPrecision_IsRejectedAsUnsupported()
    {
        byte[] jpeg = JpegWriter.Encode(Solid(8, 8, 50, 60, 70), 8, 8, components: 3);
        int sof = FindMarker(jpeg, 0xC0);
        sof.Should().BeGreaterThan(0);
        jpeg[sof + 4] = 12;

        GltfJpegDecoder.TryDecode(jpeg, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
        error.Value.Marker.Should().Be("SOF0");
    }

    [Fact]
    public void Decode_ArithmeticCodingTable_IsRejectedAsUnsupported()
    {
        byte[] jpeg = JpegWriter.Encode(Solid(8, 8, 50, 60, 70), 8, 8, components: 3);
        byte[] patched = [.. jpeg[..2], 0xFF, 0xCC, 0x00, 0x02, .. jpeg[2..]];

        GltfJpegDecoder.TryDecode(patched, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
        error.Value.Marker.Should().Be("DAC");
    }

    [Fact]
    public void Decode_SpanPath_IsAllocationFreeAfterWarmup()
    {
        const int size = 64;
        byte[] jpeg = JpegWriter.Encode(Gradient(size, size), size, size, components: 1);
        byte[] destination = new byte[size * size * 4];

        for (int warmup = 0; warmup < 64; warmup++)
        {
            GltfJpegDecoder.TryDecode(jpeg, destination, size * 4, out _, out _, out _)
                .Should().BeTrue();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int iteration = 0; iteration < 32; iteration++)
        {
            _ = GltfJpegDecoder.TryDecode(jpeg, destination, size * 4, out _, out _, out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    private static int FindMarker(byte[] jpeg, byte marker)
    {
        for (int index = 2; index + 1 < jpeg.Length; index++)
        {
            if (jpeg[index] == 0xFF && jpeg[index + 1] == marker)
            {
                return index;
            }
        }

        return -1;
    }

    private static void AssertNear(ReadOnlySpan<byte> actual, byte[] expected, int tolerance)
    {
        actual.Length.Should().Be(expected.Length);
        for (int index = 0; index < expected.Length; index++)
        {
            int delta = Math.Abs(actual[index] - expected[index]);
            Assert.True(
                delta <= tolerance,
                $"Byte {index} differs by {delta}: actual {actual[index]}, expected {expected[index]}.");
        }
    }

    private static byte[] Solid(int width, int height, int red, int green, int blue)
    {
        byte[] rgba = new byte[width * height * 4];
        for (int pixel = 0; pixel < width * height; pixel++)
        {
            rgba[(pixel * 4) + 0] = (byte)red;
            rgba[(pixel * 4) + 1] = (byte)green;
            rgba[(pixel * 4) + 2] = (byte)blue;
            rgba[(pixel * 4) + 3] = 255;
        }

        return rgba;
    }

    private static byte[] Gradient(int width, int height)
    {
        byte[] rgba = new byte[width * height * 4];
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                int pixel = ((y * width) + x) * 4;
                rgba[pixel + 0] = (byte)((x * 17) + (y * 3));
                rgba[pixel + 1] = (byte)((y * 19) + (x * 5));
                rgba[pixel + 2] = (byte)(((x + y) * 11) + 20);
                rgba[pixel + 3] = 255;
            }
        }

        return rgba;
    }

    private static byte[] Quadrants(int size)
    {
        byte[] rgba = new byte[size * size * 4];
        int half = size / 2;
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                int pixel = ((y * size) + x) * 4;
                (int r, int g, int b) = (x < half, y < half) switch
                {
                    (true, true) => (230, 20, 20),
                    (false, true) => (20, 220, 40),
                    (true, false) => (30, 40, 220),
                    _ => (240, 230, 40),
                };
                rgba[pixel + 0] = (byte)r;
                rgba[pixel + 1] = (byte)g;
                rgba[pixel + 2] = (byte)b;
                rgba[pixel + 3] = 255;
            }
        }

        return rgba;
    }

    internal static class JpegWriter    {
        private const int BlockSize = 8;
        private const int DcTableId = 0;
        private const int AcTableId = 0;

        private static ReadOnlySpan<byte> ZigZag =>
        [
            0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
            12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
            35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
            58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
        ];

        private static readonly double[] Cosine = CreateCosine();
        private static readonly HuffmanCode[] DcCodes = BuildCodes(DcCounts(), DcSymbols());
        private static readonly HuffmanCode[] AcCodes = BuildCodes(AcCounts(), AcSymbols());

        public static byte[] Encode(
            byte[] rgba,
            int width,
            int height,
            int components,
            int horizontalSampling = 1,
            int verticalSampling = 1,
            int restartInterval = 0)
        {
            int maxH = horizontalSampling;
            int maxV = verticalSampling;
            int mcuCols = (width + (maxH * BlockSize) - 1) / (maxH * BlockSize);
            int mcuRows = (height + (maxV * BlockSize) - 1) / (maxV * BlockSize);
            int yStride = mcuCols * maxH * BlockSize;
            int yRows = mcuRows * maxV * BlockSize;
            var yPlane = new byte[yStride * yRows];
            var cbPlane = new byte[mcuCols * BlockSize * mcuRows * BlockSize];
            var crPlane = new byte[cbPlane.Length];

            for (int y = 0; y < yRows; y++)
            {
                for (int x = 0; x < yStride; x++)
                {
                    (int luminance, _, _) = ToYCbCr(rgba, width, height, x, y);
                    yPlane[(y * yStride) + x] = (byte)luminance;
                }
            }

            if (components == 3)
            {
                int chromaStride = mcuCols * BlockSize;
                int chromaRows = mcuRows * BlockSize;
                for (int cy = 0; cy < chromaRows; cy++)
                {
                    for (int cx = 0; cx < chromaStride; cx++)
                    {
                        int sumCb = 0;
                        int sumCr = 0;
                        int count = 0;
                        for (int dy = 0; dy < verticalSampling; dy++)
                        {
                            for (int dx = 0; dx < horizontalSampling; dx++)
                            {
                                (_, int cb, int cr) = ToYCbCr(
                                    rgba,
                                    width,
                                    height,
                                    (cx * horizontalSampling) + dx,
                                    (cy * verticalSampling) + dy);
                                sumCb += cb;
                                sumCr += cr;
                                count++;
                            }
                        }

                        cbPlane[(cy * chromaStride) + cx] = (byte)((sumCb + (count / 2)) / count);
                        crPlane[(cy * chromaStride) + cx] = (byte)((sumCr + (count / 2)) / count);
                    }
                }
            }

            var output = new List<byte>();
            WriteMarker(output, 0xD8);
            WriteSegment(output, 0xDB, QuantizationSegment());
            WriteSegment(output, 0xC0, FrameSegment(width, height, components, horizontalSampling, verticalSampling));
            WriteSegment(output, 0xC4, HuffmanSegment());
            if (restartInterval > 0)
            {
                WriteSegment(output, 0xDD, [(byte)(restartInterval >> 8), (byte)restartInterval]);
            }

            WriteSegment(output, 0xDA, ScanSegment(components));

            var writer = new EntropyWriter(output);
            var predictors = new int[3];
            int totalMcus = mcuCols * mcuRows;
            int mcu = 0;
            int restartIndex = 0;
            for (int mcuRow = 0; mcuRow < mcuRows; mcuRow++)
            {
                for (int mcuCol = 0; mcuCol < mcuCols; mcuCol++)
                {
                    EncodeComponent(
                        yPlane,
                        yStride,
                        mcuCol,
                        mcuRow,
                        maxH,
                        maxV,
                        predictors,
                        0,
                        writer);
                    if (components == 3)
                    {
                        int chromaStride = mcuCols * BlockSize;
                        EncodeComponent(
                            cbPlane,
                            chromaStride,
                            mcuCol,
                            mcuRow,
                            1,
                            1,
                            predictors,
                            1,
                            writer);
                        EncodeComponent(
                            crPlane,
                            chromaStride,
                            mcuCol,
                            mcuRow,
                            1,
                            1,
                            predictors,
                            2,
                            writer);
                    }

                    mcu++;
                    if (restartInterval > 0 && mcu < totalMcus && mcu % restartInterval == 0)
                    {
                        writer.Align();
                        WriteMarker(output, (byte)(0xD0 + (restartIndex & 7)));
                        restartIndex++;
                        Array.Clear(predictors);
                    }
                }
            }

            writer.Align();
            WriteMarker(output, 0xD9);
            return [.. output];
        }

        public static byte[] RenderDirectIdctGray(byte[] rgba, int width, int height)
        {
            byte[] result = new byte[width * height * 4];
            Span<double> block = stackalloc double[64];
            Span<double> coefficients = stackalloc double[64];
            Span<int> quantized = stackalloc int[64];
            for (int blockY = 0; blockY < height; blockY += BlockSize)
            {
                for (int blockX = 0; blockX < width; blockX += BlockSize)
                {
                    for (int y = 0; y < BlockSize; y++)
                    {
                        for (int x = 0; x < BlockSize; x++)
                        {
                            (int luminance, _, _) = ToYCbCr(rgba, width, height, blockX + x, blockY + y);
                            block[(y * BlockSize) + x] = luminance - 128;
                        }
                    }

                    ForwardDct(block, coefficients);
                    for (int index = 0; index < 64; index++)
                    {
                        quantized[index] = (int)Math.Round(coefficients[index], MidpointRounding.AwayFromZero);
                    }

                    for (int y = 0; y < BlockSize; y++)
                    {
                        for (int x = 0; x < BlockSize; x++)
                        {
                            double sum = 0.0;
                            for (int v = 0; v < 8; v++)
                            {
                                for (int u = 0; u < 8; u++)
                                {
                                    double cu = u == 0 ? 1.0 / Math.Sqrt(2.0) : 1.0;
                                    double cv = v == 0 ? 1.0 / Math.Sqrt(2.0) : 1.0;
                                    sum += cu * cv * quantized[(v * 8) + u]
                                        * Cosine[(u * 8) + x]
                                        * Cosine[(v * 8) + y];
                                }
                            }

                            int sample = (int)Math.Floor((sum * 0.25) + 128.5);
                            sample = Clamp(sample);
                            WritePixel(result, width, blockX + x, blockY + y, sample, sample, sample);
                        }
                    }
                }
            }

            return result;
        }

        public static byte[] RenderReference(
            byte[] rgba,
            int width,
            int height,
            int components,
            int horizontalSampling,
            int verticalSampling,
            GltfJpegChromaUpsampling upsampling)
        {
            int maxH = horizontalSampling;
            int maxV = verticalSampling;
            byte[] result = new byte[width * height * 4];

            if (components == 1)
            {
                for (int y = 0; y < height; y++)
                {
                    for (int x = 0; x < width; x++)
                    {
                        (int luminance, _, _) = ToYCbCr(rgba, width, height, x, y);
                        WritePixel(result, width, x, y, luminance, luminance, luminance);
                    }
                }

                return result;
            }

            int chromaWidth = ((width * maxH) + maxH - 1) / maxH;
            int chromaHeight = ((height * maxV) + maxV - 1) / maxV;
            var cb = new byte[chromaWidth * chromaHeight];
            var cr = new byte[chromaWidth * chromaHeight];
            for (int cy = 0; cy < chromaHeight; cy++)
            {
                for (int cx = 0; cx < chromaWidth; cx++)
                {
                    int sumCb = 0;
                    int sumCr = 0;
                    int count = 0;
                    for (int dy = 0; dy < maxV; dy++)
                    {
                        for (int dx = 0; dx < maxH; dx++)
                        {
                            (_, int sampleCb, int sampleCr) = ToYCbCr(
                                rgba,
                                width,
                                height,
                                (cx * maxH) + dx,
                                (cy * maxV) + dy);
                            sumCb += sampleCb;
                            sumCr += sampleCr;
                            count++;
                        }
                    }

                    int index = (cy * chromaWidth) + cx;
                    cb[index] = (byte)((sumCb + (count / 2)) / count);
                    cr[index] = (byte)((sumCr + (count / 2)) / count);
                }
            }

            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    (int luminance, _, _) = ToYCbCr(rgba, width, height, x, y);
                    int sampleCb = upsampling == GltfJpegChromaUpsampling.Nearest
                        ? cb[(Math.Min(y / maxV, chromaHeight - 1) * chromaWidth)
                            + Math.Min(x / maxH, chromaWidth - 1)]
                        : SampleBilinear(cb, chromaWidth, chromaHeight, x, y, maxH, maxV);
                    int sampleCr = upsampling == GltfJpegChromaUpsampling.Nearest
                        ? cr[(Math.Min(y / maxV, chromaHeight - 1) * chromaWidth)
                            + Math.Min(x / maxH, chromaWidth - 1)]
                        : SampleBilinear(cr, chromaWidth, chromaHeight, x, y, maxH, maxV);
                    WritePixel(
                        result,
                        width,
                        x,
                        y,
                        Clamp(luminance + ((91881 * (sampleCr - 128)) >> 16)),
                        Clamp(luminance - (((22554 * (sampleCb - 128)) + (46802 * (sampleCr - 128))) >> 16)),
                        Clamp(luminance + ((116130 * (sampleCb - 128)) >> 16)));
                }
            }

            return result;
        }

        private static int SampleBilinear(
            byte[] plane,
            int planeWidth,
            int planeHeight,
            int x,
            int y,
            int maxH,
            int maxV)
        {
            long sourceX = ((((2L * x) + 1) * 32768) / (2 * maxH)) - 16384;
            long sourceY = ((((2L * y) + 1) * 32768) / (2 * maxV)) - 16384;
            sourceX = Math.Clamp(sourceX, 0, (planeWidth - 1) << 15);
            sourceY = Math.Clamp(sourceY, 0, (planeHeight - 1) << 15);
            int x0 = (int)(sourceX >> 15);
            int y0 = (int)(sourceY >> 15);
            int fractionX = (int)(sourceX >> 7) & 255;
            int fractionY = (int)(sourceY >> 7) & 255;
            int x1 = Math.Min(x0 + 1, planeWidth - 1);
            int y1 = Math.Min(y0 + 1, planeHeight - 1);
            int inverseX = 256 - fractionX;
            int inverseY = 256 - fractionY;
            int weighted = (plane[(y0 * planeWidth) + x0] * inverseX * inverseY)
                + (plane[(y0 * planeWidth) + x1] * fractionX * inverseY)
                + (plane[(y1 * planeWidth) + x0] * inverseX * fractionY)
                + (plane[(y1 * planeWidth) + x1] * fractionX * fractionY);
            return (weighted + 32768) >> 16;
        }

        private static void EncodeComponent(
            byte[] plane,
            int stride,
            int mcuCol,
            int mcuRow,
            int horizontal,
            int vertical,
            int[] predictors,
            int component,
            EntropyWriter writer)
        {
            for (int blockRow = 0; blockRow < vertical; blockRow++)
            {
                for (int blockColumn = 0; blockColumn < horizontal; blockColumn++)
                {
                    int blockX = ((mcuCol * horizontal) + blockColumn) * BlockSize;
                    int blockY = ((mcuRow * vertical) + blockRow) * BlockSize;
                    EncodeBlock(plane, stride, blockX, blockY, predictors, component, writer);
                }
            }
        }

        private static void EncodeBlock(
            byte[] plane,
            int stride,
            int blockX,
            int blockY,
            int[] predictors,
            int component,
            EntropyWriter writer)
        {
            Span<double> block = stackalloc double[64];
            for (int y = 0; y < BlockSize; y++)
            {
                for (int x = 0; x < BlockSize; x++)
                {
                    block[(y * BlockSize) + x] = plane[((blockY + y) * stride) + blockX + x] - 128;
                }
            }

            Span<double> coefficients = stackalloc double[64];
            ForwardDct(block, coefficients);

            Span<int> quantized = stackalloc int[64];
            for (int index = 0; index < 64; index++)
            {
                quantized[index] = (int)Math.Round(coefficients[index], MidpointRounding.AwayFromZero);
            }

            int difference = quantized[0] - predictors[component];
            predictors[component] = quantized[0];
            int dcCategory = MagnitudeBits(difference);
            writer.WriteCode(DcCodes[dcCategory]);
            if (dcCategory > 0)
            {
                writer.WriteBits(EncodeValue(difference, dcCategory), dcCategory);
            }

            int run = 0;
            for (int zigzagIndex = 1; zigzagIndex < 64; zigzagIndex++)
            {
                int value = quantized[ZigZag[zigzagIndex]];
                if (value == 0)
                {
                    run++;
                    continue;
                }

                while (run >= 16)
                {
                    writer.WriteCode(AcCodes[0xF0]);
                    run -= 16;
                }

                int size = MagnitudeBits(value);
                writer.WriteCode(AcCodes[(run << 4) | size]);
                writer.WriteBits(EncodeValue(value, size), size);
                run = 0;
            }

            if (run > 0)
            {
                writer.WriteCode(AcCodes[0x00]);
            }
        }

        private static void ForwardDct(ReadOnlySpan<double> block, Span<double> coefficients)
        {
            for (int v = 0; v < 8; v++)
            {
                for (int u = 0; u < 8; u++)
                {
                    double sum = 0.0;
                    for (int y = 0; y < 8; y++)
                    {
                        for (int x = 0; x < 8; x++)
                        {
                            sum += block[(y * 8) + x] * Cosine[(u * 8) + x] * Cosine[(v * 8) + y];
                        }
                    }

                    double cu = u == 0 ? 1.0 / Math.Sqrt(2.0) : 1.0;
                    double cv = v == 0 ? 1.0 / Math.Sqrt(2.0) : 1.0;
                    coefficients[(v * 8) + u] = 0.25 * cu * cv * sum;
                }
            }
        }

        private static (int Luminance, int Cb, int Cr) ToYCbCr(
            byte[] rgba,
            int width,
            int height,
            int x,
            int y)
        {
            int sourceX = Math.Min(x, width - 1);
            int sourceY = Math.Min(y, height - 1);
            int pixel = ((sourceY * width) + sourceX) * 4;
            int red = rgba[pixel];
            int green = rgba[pixel + 1];
            int blue = rgba[pixel + 2];
            int luminance = (int)Math.Round((0.299 * red) + (0.587 * green) + (0.114 * blue), MidpointRounding.AwayFromZero);
            int cb = (int)Math.Round(((-0.168736 * red) - (0.331264 * green) + (0.5 * blue)) + 128, MidpointRounding.AwayFromZero);
            int cr = (int)Math.Round(((0.5 * red) - (0.418688 * green) - (0.081312 * blue)) + 128, MidpointRounding.AwayFromZero);
            return (Clamp(luminance), Clamp(cb), Clamp(cr));
        }

        private static void WritePixel(byte[] target, int width, int x, int y, int red, int green, int blue)
        {
            int pixel = ((y * width) + x) * 4;
            target[pixel] = (byte)red;
            target[pixel + 1] = (byte)green;
            target[pixel + 2] = (byte)blue;
            target[pixel + 3] = 255;
        }

        private static int Clamp(int value) => value < 0 ? 0 : value > 255 ? 255 : value;

        private static int MagnitudeBits(int value)
        {
            int magnitude = Math.Abs(value);
            int bits = 0;
            while (magnitude != 0)
            {
                bits++;
                magnitude >>= 1;
            }

            return bits;
        }

        private static int EncodeValue(int value, int size) =>
            value >= 0 ? value : value + (1 << size) - 1;

        private static void WriteMarker(List<byte> output, byte marker)
        {
            output.Add(0xFF);
            output.Add(marker);
        }

        private static void WriteSegment(List<byte> output, byte marker, byte[] payload)
        {
            int length = payload.Length + 2;
            WriteMarker(output, marker);
            output.Add((byte)(length >> 8));
            output.Add((byte)length);
            output.AddRange(payload);
        }

        private static byte[] QuantizationSegment()
        {
            byte[] payload = new byte[65];
            payload[0] = 0x00;
            payload.AsSpan(1).Fill(1);
            return payload;
        }

        private static byte[] FrameSegment(
            int width,
            int height,
            int components,
            int horizontalSampling,
            int verticalSampling)
        {
            byte[] payload = new byte[6 + (components * 3)];
            payload[0] = 8;
            payload[1] = (byte)(height >> 8);
            payload[2] = (byte)height;
            payload[3] = (byte)(width >> 8);
            payload[4] = (byte)width;
            payload[5] = (byte)components;
            for (int component = 0; component < components; component++)
            {
                int offset = 6 + (component * 3);
                payload[offset] = (byte)(component + 1);
                payload[offset + 1] = component == 0
                    ? (byte)((horizontalSampling << 4) | verticalSampling)
                    : (byte)0x11;
                payload[offset + 2] = 0;
            }

            return payload;
        }

        private static byte[] HuffmanSegment()
        {
            byte[] dcCounts = DcCounts();
            byte[] dcSymbols = DcSymbols();
            byte[] acCounts = AcCounts();
            byte[] acSymbols = AcSymbols();
            byte[] payload = new byte[1 + 16 + dcSymbols.Length + 1 + 16 + acSymbols.Length];
            int position = 0;
            payload[position++] = (byte)((0 << 4) | DcTableId);
            dcCounts.CopyTo(payload, position);
            position += 16;
            dcSymbols.CopyTo(payload, position);
            position += dcSymbols.Length;
            payload[position++] = (byte)((1 << 4) | AcTableId);
            acCounts.CopyTo(payload, position);
            position += 16;
            acSymbols.CopyTo(payload, position);
            return payload;
        }

        private static byte[] ScanSegment(int components)
        {
            byte[] payload = new byte[1 + (components * 2) + 3];
            payload[0] = (byte)components;
            for (int component = 0; component < components; component++)
            {
                payload[1 + (component * 2)] = (byte)(component + 1);
                payload[2 + (component * 2)] = 0x00;
            }

            payload[1 + (components * 2)] = 0;
            payload[2 + (components * 2)] = 63;
            payload[3 + (components * 2)] = 0;
            return payload;
        }

        private static byte[] DcCounts()
        {
            byte[] counts = new byte[16];
            counts[3] = 12;
            return counts;
        }

        private static byte[] DcSymbols() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

        private static byte[] AcCounts()
        {
            byte[] counts = new byte[16];
            counts[7] = 162;
            return counts;
        }

        private static byte[] AcSymbols()
        {
            var symbols = new List<byte>(162)
            {
                0x00,
                0xF0,
            };
            for (int run = 0; run < 16; run++)
            {
                for (int size = 1; size <= 10; size++)
                {
                    symbols.Add((byte)((run << 4) | size));
                }
            }

            return [.. symbols];
        }

        private static HuffmanCode[] BuildCodes(byte[] counts, byte[] symbols)
        {
            var codes = new HuffmanCode[256];
            int code = 0;
            int symbolIndex = 0;
            for (int length = 1; length <= 16; length++)
            {
                for (int entry = 0; entry < counts[length - 1]; entry++)
                {
                    codes[symbols[symbolIndex++]] = new HuffmanCode(code, length);
                    code++;
                }

                code <<= 1;
            }

            return codes;
        }

        private static double[] CreateCosine()
        {
            double[] table = new double[64];
            for (int frequency = 0; frequency < 8; frequency++)
            {
                for (int position = 0; position < 8; position++)
                {
                    table[(frequency * 8) + position] =
                        Math.Cos((((2.0 * position) + 1.0) * frequency * Math.PI) / 16.0);
                }
            }

            return table;
        }

        private readonly record struct HuffmanCode(int Bits, int Length);

        private sealed class EntropyWriter(List<byte> output)
        {
            private readonly List<byte> _output = output;
            private int _buffer;
            private int _bits;

            public void WriteCode(HuffmanCode code) => WriteBits(code.Bits, code.Length);

            public void WriteBits(int value, int count)
            {
                for (int bit = count - 1; bit >= 0; bit--)
                {
                    _buffer = (_buffer << 1) | ((value >> bit) & 1);
                    _bits++;
                    if (_bits == 8)
                    {
                        Emit((byte)_buffer);
                        _buffer = 0;
                        _bits = 0;
                    }
                }
            }

            public void Align()
            {
                while (_bits != 0)
                {
                    WriteBits(1, 1);
                }
            }

            private void Emit(byte value)
            {
                _output.Add(value);
                if (value == 0xFF)
                {
                    _output.Add(0x00);
                }
            }
        }
    }
}
