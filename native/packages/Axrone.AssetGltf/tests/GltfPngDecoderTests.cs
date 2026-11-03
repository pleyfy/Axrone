namespace Axrone.AssetGltf.Tests;

using System.IO.Compression;
using System.Text;

public sealed class GltfPngDecoderTests
{
    private static readonly byte[] Signature = [137, 80, 78, 71, 13, 10, 26, 10];

    [Fact]
    public void Decode_Rgba8_ReturnsPixels()
    {
        byte[] pixels =
        [
            255, 0, 0, 255,
            0, 255, 0, 128,
            0, 0, 255, 0,
            10, 20, 30, 40
        ];

        byte[] png = EncodePng(2, 2, colorType: 6, bitDepth: 8, Rows(2, 2, 4, pixels));

        GltfPngDecoder.TryDecode(png, out GltfDecodedImage? image, out GltfImageDecodeError? error).Should().BeTrue();

        error.Should().BeNull();
        image!.Width.Should().Be(2);
        image.Height.Should().Be(2);
        image.Rgba.ToArray().Should().Equal(pixels);
    }

    [Fact]
    public void Decode_Rgb8_AppliesEveryFilter()
    {
        byte[][] rows =
        [
            [10, 20, 30, 40, 50, 60],
            [70, 80, 90, 100, 110, 120],
            [13, 23, 33, 43, 53, 63],
            [200, 100, 50, 25, 12, 6]
        ];
        byte[] scanlines = FilterRows(rows, bpp: 3, [1, 2, 3, 4]);
        byte[] png = EncodePng(2, 4, colorType: 2, bitDepth: 8, scanlines);

        GltfPngDecoder.TryDecode(png, out GltfDecodedImage? image, out GltfImageDecodeError? error).Should().BeTrue();

        error.Should().BeNull();
        byte[] expected = new byte[2 * 4 * 4];
        for (int row = 0; row < 4; row++)
        {
            for (int column = 0; column < 2; column++)
            {
                int source = column * 3;
                int target = (row * 8) + (column * 4);
                expected[target] = rows[row][source];
                expected[target + 1] = rows[row][source + 1];
                expected[target + 2] = rows[row][source + 2];
                expected[target + 3] = 255;
            }
        }

        image!.Rgba.ToArray().Should().Equal(expected);
    }

    [Fact]
    public void Decode_IndexedPalette_AppliesTransparency()
    {
        byte[] scanlines = [0, 0, 1];
        byte[] palette = [255, 0, 0, 0, 255, 0];
        byte[] transparency = [0, 255];

        byte[] png = EncodePng(2, 1, colorType: 3, bitDepth: 8, scanlines, palette, transparency);

        GltfPngDecoder.TryDecode(png, out GltfDecodedImage? image, out GltfImageDecodeError? error).Should().BeTrue();

        error.Should().BeNull();
        image!.Rgba.ToArray().Should().Equal(
            255, 0, 0, 0,
            0, 255, 0, 255);
    }

    [Fact]
    public void Decode_Adam7Interlaced_ReturnsFullImage()
    {
        const int width = 8;
        const int height = 7;
        byte[] pixels = new byte[width * height * 4];
        for (int i = 0; i < width * height; i++)
        {
            pixels[(i * 4) + 0] = (byte)(i * 3);
            pixels[(i * 4) + 1] = (byte)(255 - (i * 2));
            pixels[(i * 4) + 2] = (byte)(i * 7);
            pixels[(i * 4) + 3] = (byte)(i * 5);
        }

        byte[] interlaced = BuildAdam7Scanlines(width, height, pixels);
        byte[] png = EncodePng(width, height, colorType: 6, bitDepth: 8, interlaced, interlace: 1);

        GltfPngDecoder.TryDecode(png, out GltfDecodedImage? image, out GltfImageDecodeError? error).Should().BeTrue();

        error.Should().BeNull();
        image!.Width.Should().Be(width);
        image.Height.Should().Be(height);
        image.Rgba.ToArray().Should().Equal(pixels);
    }

    [Fact]
    public void Decode_InvalidBuffers_FailClosed()
    {
        GltfPngDecoder.TryDecode([1, 2, 3], out _, out GltfImageDecodeError? signatureError).Should().BeFalse();
        signatureError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Signature);
        signatureError.Value.Codec.Should().Be(GltfImageCodecKind.Png);

        byte[] invalidColorType = EncodePng(1, 1, colorType: 7, bitDepth: 8, [0, 0, 0, 0]);
        GltfPngDecoder.TryDecode(invalidColorType, out _, out GltfImageDecodeError? colorError).Should().BeFalse();
        colorError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
        colorError.Value.Marker.Should().Be("IHDR");

        byte[] missingPalette = EncodePng(1, 1, colorType: 3, bitDepth: 8, [0, 0]);
        GltfPngDecoder.TryDecode(missingPalette, out _, out GltfImageDecodeError? paletteError).Should().BeFalse();
        paletteError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        paletteError.Value.Marker.Should().Be("PLTE");

        byte[] truncated = EncodePng(2, 2, colorType: 6, bitDepth: 8, Rows(2, 2, 4, new byte[16]));
        GltfPngDecoder.TryDecode(truncated.AsSpan(0, 40), out _, out GltfImageDecodeError? truncatedError).Should().BeFalse();
        truncatedError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Truncated);
    }

    [Fact]
    public void Decode_StructuralFailures_CarryTheirOwnCode()
    {
        byte[] invalidFilter = EncodePng(1, 1, colorType: 6, bitDepth: 8, [9, 0, 0, 0, 0]);
        GltfPngDecoder.TryDecode(invalidFilter, out _, out GltfImageDecodeError? filterError).Should().BeFalse();
        filterError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        filterError.Value.Marker.Should().Be("IDAT");

        byte[] paletteOutOfRange = EncodePng(1, 1, colorType: 3, bitDepth: 8, [0, 5], [255, 0, 0, 0, 255, 0]);
        GltfPngDecoder.TryDecode(paletteOutOfRange, out _, out GltfImageDecodeError? indexError).Should().BeFalse();
        indexError!.Value.Failure.Should().Be(GltfImageDecodeFailure.ScanData);
        indexError.Value.Marker.Should().Be("PLTE");

        byte[] badDepth = EncodePng(1, 1, colorType: 2, bitDepth: 4, [0, 0]);
        GltfPngDecoder.TryDecode(badDepth, out _, out GltfImageDecodeError? depthError).Should().BeFalse();
        depthError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);

        byte[] badTransparency = EncodePng(1, 1, colorType: 6, bitDepth: 8, [0, 0, 0, 0, 0], transparency: [255]);
        GltfPngDecoder.TryDecode(badTransparency, out _, out GltfImageDecodeError? trnsError).Should().BeFalse();
        trnsError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        trnsError.Value.Marker.Should().Be("tRNS");

        byte[] oversize = EncodePng(9000, 1, colorType: 6, bitDepth: 8, [0, 0, 0, 0, 0]);
        GltfPngDecoder.TryDecode(oversize, out _, out GltfImageDecodeError? limitError).Should().BeFalse();
        limitError!.Value.Failure.Should().Be(GltfImageDecodeFailure.LimitExceeded);
    }

    [Fact]
    public void Decode_ChunkLengthBeyondBuffer_IsTruncatedWithChunkName()
    {
        byte[] idatChunkType = [0x49, 0x44, 0x41, 0x54];
        var png = new List<byte>(Signature);
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, 4096);
        png.AddRange(length);
        png.AddRange(idatChunkType);
        png.AddRange([1, 2, 3, 4]);

        GltfPngDecoder.TryDecode([.. png], out _, out GltfImageDecodeError? error).Should().BeFalse();
        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Truncated);
        error.Value.Marker.Should().Be("IDAT");
    }

    [Fact]
    public void Decode_GrayscaleVector_ProducesNoErrorObject()
    {
        byte[] png = EncodePng(1, 1, colorType: 0, bitDepth: 8, [0, 128]);
        GltfPngDecoder.TryDecode(png, out GltfDecodedImage? image, out GltfImageDecodeError? error).Should().BeTrue();
        error.Should().BeNull();
        image!.Rgba.ToArray().Should().Equal(128, 128, 128, 255);
    }

    [Fact]
    public void Codec_PngFailure_IsTheDecoderCode()
    {
        byte[] missingPalette = EncodePng(1, 1, colorType: 3, bitDepth: 8, [0, 0]);
        GltfImageCodec.TryDecodeRaster(missingPalette, "image/png", null, out _, out GltfImageDecodeError? codecError)
            .Should().BeFalse();
        codecError!.Value.Codec.Should().Be(GltfImageCodecKind.Png);
        codecError.Value.Failure.Should().Be(GltfImageDecodeFailure.Marker);
        codecError.Value.Marker.Should().Be("PLTE");
    }

    [Fact]
    public async Task Import_DecodesPngDataUriIntoRgba8Texture()
    {
        byte[] pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0];
        byte[] png = EncodePng(2, 2, colorType: 6, bitDepth: 8, Rows(2, 2, 4, pixels));
        string json = $$"""
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/png;base64,{{Convert.ToBase64String(png)}}"}],
              "textures": [{"source": 0}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "png.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfTranscodedTexturePayload payload = texture.Payload
            .Should().BeOfType<GltfTranscodedTexturePayload>().Subject;
        payload.Format.Should().Be(GltfTextureFormat.R8G8B8A8_UNorm);
        payload.Bytes.ToArray().Should().Equal(pixels);
        payload.Levels.Should().ContainSingle();
        payload.Levels[0].Width.Should().Be(2);
        payload.Levels[0].Height.Should().Be(2);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.R8G8B8A8_UNorm);
        texture.TranscodeState.Success.Should().BeTrue();
        texture.TranscodeState.TranscoderId.Should().Be("builtin/png");
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public async Task Import_TruncatedJpegMarksTheRawPayloadUnusable()
    {
        string json = """
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/jpeg;base64,/9j/4A=="}],
              "textures": [{"source": 0}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "jpeg.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfRawTexturePayload payload = texture.Payload.Should().BeOfType<GltfRawTexturePayload>().Subject;
        payload.MimeType.Should().Be("image/jpeg");
        payload.Unusable!.Value.Codec.Should().Be(GltfImageCodecKind.Jpeg);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.Unknown);
        GltfDiagnostic diagnostic = result.Diagnostics.Should().ContainSingle().Subject;
        diagnostic.Code.Should().Be("gltf.texture.decode.failed");
        diagnostic.Level.Should().Be(GltfDiagnosticLevel.Error);
    }

    [Fact]
    public async Task Import_DecodesJpegDataUriIntoRgba8Texture()
    {
        byte[] rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0];
        byte[] jpeg = GltfJpegDecoderTests.JpegWriter.Encode(rgba, 2, 2, components: 3);
        string json = $$"""
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/jpeg;base64,{{Convert.ToBase64String(jpeg)}}"}],
              "textures": [{"source": 0}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "jpeg.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfTranscodedTexturePayload payload = texture.Payload
            .Should().BeOfType<GltfTranscodedTexturePayload>().Subject;
        payload.Format.Should().Be(GltfTextureFormat.R8G8B8A8_UNorm);
        payload.Levels.Should().ContainSingle();
        payload.Levels[0].Width.Should().Be(2);
        payload.Levels[0].Height.Should().Be(2);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.R8G8B8A8_UNorm);
        texture.TranscodeState.Success.Should().BeTrue();
        texture.TranscodeState.TranscoderId.Should().Be("builtin/jpeg");
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public async Task Import_InvalidPngMarksTheRawPayloadUnusable()
    {
        string json = """
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/png;base64,iVBORw0KGgo="}],
              "textures": [{"source": 0}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "broken.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        texture.Payload.Should().BeOfType<GltfRawTexturePayload>()
            .Which.Unusable!.Value.Codec.Should().Be(GltfImageCodecKind.Png);
        result.Diagnostics.Should().ContainSingle()
            .Which.Code.Should().Be("gltf.texture.decode.failed");
    }

    [Fact]
    public async Task Import_DecodeDisabledKeepsRawPayload()
    {
        byte[] pixels = [1, 2, 3, 4];
        byte[] png = EncodePng(1, 1, colorType: 6, bitDepth: 8, Rows(1, 1, 4, pixels));
        string json = $$"""
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/png;base64,{{Convert.ToBase64String(png)}}"}],
              "textures": [{"source": 0}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "raw.gltf",
            DecodeEncodedTextures = false
        });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        result.Textures[0].Payload.Should().BeOfType<GltfRawTexturePayload>();
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public async Task Import_MeshAndNodeMorphWeights_AreExposed()
    {
        string bufferUri = Convert.ToBase64String(new byte[36]);
        string json = $$$"""
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0, "weights": [1.0, 0.0]}],
              "meshes": [{
                "weights": [0.25, 0.75],
                "primitives": [{"attributes": {"POSITION": 0}}]
              }],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 36, "uri": "data:application/octet-stream;base64,{{{bufferUri}}}"}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "weights.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        result.Meshes[0].Definition.MorphWeights.Should().Equal(0.25f, 0.75f);
        GltfMeshRendererComponent renderer = result.Prefabs[0].Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfMeshRendererComponent>()
            .Should().ContainSingle().Subject;
        renderer.MorphWeights.Should().Equal(1.0f, 0.0f);
    }

    [Fact]
    public async Task Import_NodeWithoutWeights_FallsBackToMeshWeights()
    {
        string bufferUri = Convert.ToBase64String(new byte[36]);
        string json = $$$"""
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{
                "weights": [0.25, 0.75],
                "primitives": [{"attributes": {"POSITION": 0}}]
              }],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 36, "uri": "data:application/octet-stream;base64,{{{bufferUri}}}"}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "weights-fallback.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfMeshRendererComponent renderer = result.Prefabs[0].Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfMeshRendererComponent>()
            .Should().ContainSingle().Subject;
        renderer.MorphWeights.Should().Equal(0.25f, 0.75f);
    }

    [Fact]
    public async Task Import_CubicSplineTrack_ExposesSampleMultiplier()
    {
        string bufferUri = Convert.ToBase64String(new byte[80]);
        string json = $$$"""
            {
              "asset": {"version": "2.0"},
              "nodes": [{"name": "N"}],
              "animations": [{
                "samplers": [{"input": 0, "output": 1, "interpolation": "CUBICSPLINE"}],
                "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}]
              }],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 2, "type": "SCALAR"},
                {"bufferView": 1, "componentType": 5126, "count": 6, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 8},
                {"buffer": 0, "byteOffset": 8, "byteLength": 72}
              ],
              "buffers": [{"byteLength": 80, "uri": "data:application/octet-stream;base64,{{{bufferUri}}}"}]
            }
            """;

        var importer = new GltfImporter(new GltfImporterOptions { Id = "cubic.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfAnimationTrackAsset track = result.Animations.Should().ContainSingle()
            .Subject.Tracks.Should().ContainSingle().Subject;
        track.Interpolation.Should().Be(GltfInterpolation.CubicSpline);
        track.SampleMultiplier.Should().Be(3);
        track.SampleStride.Should().Be(9);
        track.Values.Length.Should().Be(18);
    }

    private static byte[] Rows(int width, int height, int channels, byte[] pixels)
    {
        int rowBytes = width * channels;
        var raw = new byte[(rowBytes + 1) * height];
        for (int row = 0; row < height; row++)
        {
            raw[row * (rowBytes + 1)] = 0;
            pixels.AsSpan(row * rowBytes, rowBytes)
                .CopyTo(raw.AsSpan((row * (rowBytes + 1)) + 1, rowBytes));
        }

        return raw;
    }

    private static byte[] FilterRows(byte[][] rows, int bpp, byte[] filters)
    {
        int rowBytes = rows[0].Length;
        var result = new byte[(rowBytes + 1) * rows.Length];
        int offset = 0;
        for (int row = 0; row < rows.Length; row++)
        {
            byte filter = filters[row];
            result[offset++] = filter;
            byte[] current = rows[row];
            byte[] previous = row > 0 ? rows[row - 1] : [];
            for (int i = 0; i < rowBytes; i++)
            {
                int left = i >= bpp ? current[i - bpp] : 0;
                int up = row > 0 ? previous[i] : 0;
                int upLeft = i >= bpp && row > 0 ? previous[i - bpp] : 0;
                int predictor = filter switch
                {
                    1 => left,
                    2 => up,
                    3 => (left + up) >> 1,
                    4 => Paeth(left, up, upLeft),
                    _ => 0
                };
                result[offset++] = (byte)(current[i] - predictor);
            }
        }

        return result;
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

    private static byte[] BuildAdam7Scanlines(int width, int height, byte[] pixels)
    {
        ReadOnlySpan<int> xStart = [0, 4, 0, 2, 0, 1, 0];
        ReadOnlySpan<int> xStep = [8, 8, 4, 4, 2, 2, 1];
        ReadOnlySpan<int> yStart = [0, 0, 4, 0, 2, 0, 1];
        ReadOnlySpan<int> yStep = [8, 8, 8, 4, 4, 2, 2];
        var output = new List<byte>();
        for (int pass = 0; pass < 7; pass++)
        {
            int passWidth = width <= xStart[pass]
                ? 0
                : (width - xStart[pass] + xStep[pass] - 1) / xStep[pass];
            int passHeight = height <= yStart[pass]
                ? 0
                : (height - yStart[pass] + yStep[pass] - 1) / yStep[pass];
            for (int row = 0; row < passHeight; row++)
            {
                output.Add(0);
                int y = yStart[pass] + (row * yStep[pass]);
                for (int column = 0; column < passWidth; column++)
                {
                    int x = xStart[pass] + (column * xStep[pass]);
                    int pixel = (y * width + x) * 4;
                    output.Add(pixels[pixel]);
                    output.Add(pixels[pixel + 1]);
                    output.Add(pixels[pixel + 2]);
                    output.Add(pixels[pixel + 3]);
                }
            }
        }

        return [.. output];
    }

    private static byte[] EncodePng(
        int width,
        int height,
        byte colorType,
        byte bitDepth,
        byte[] scanlines,
        byte[]? palette = null,
        byte[]? transparency = null,
        byte interlace = 0)
    {
        using var output = new MemoryStream();
        output.Write(Signature);

        byte[] header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header, width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), height);
        header[8] = bitDepth;
        header[9] = colorType;
        header[10] = 0;
        header[11] = 0;
        header[12] = interlace;
        WriteChunk(output, "IHDR", header);

        if (palette is not null)
        {
            WriteChunk(output, "PLTE", palette);
        }

        if (transparency is not null)
        {
            WriteChunk(output, "tRNS", transparency);
        }

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            zlib.Write(scanlines);
        }

        WriteChunk(output, "IDAT", compressed.ToArray());
        WriteChunk(output, "IEND", []);
        return output.ToArray();
    }

    private static void WriteChunk(Stream stream, string type, byte[] data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        stream.Write(length);
        stream.Write(Encoding.ASCII.GetBytes(type));
        stream.Write(data);
        stream.Write(stackalloc byte[4]);
    }
}
