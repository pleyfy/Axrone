namespace Axrone.AssetGltf.Tests;

using System.Diagnostics.CodeAnalysis;
using System.Text;

public sealed class GltfImageCodecTests
{
    private static ReadOnlySpan<byte> PngSignature => [137, 80, 78, 71, 13, 10, 26, 10];

    [Fact]
    public void Detect_MagicWinsOverMime()
    {
        GltfImageCodec.Detect(PngSignature, "image/jpeg").Should().Be(GltfImageCodecKind.Png);
        GltfImageCodec.Detect([0xFF, 0xD8, 0xFF, 0xE0], "image/png").Should().Be(GltfImageCodecKind.Jpeg);
        GltfImageCodec.Detect(Ktx2TestData.Build(145, 4, 4, [[1]]), "image/png")
            .Should().Be(GltfImageCodecKind.Ktx2);
    }

    [Fact]
    public void Detect_UsesMimeThenExtension()
    {
        GltfImageCodec.Detect([], "image/jpg").Should().Be(GltfImageCodecKind.Jpeg);
        GltfImageCodec.Detect([], "image/ktx2").Should().Be(GltfImageCodecKind.Ktx2);
        GltfImageCodec.Detect([], mimeType: null, "textures/albedo.jpg").Should().Be(GltfImageCodecKind.Jpeg);
        GltfImageCodec.Detect([], mimeType: null, "textures/albedo.ktx2?cache=1").Should().Be(GltfImageCodecKind.Ktx2);
        GltfImageCodec.Detect([], mimeType: null, "textures/albedo.png#fragment").Should().Be(GltfImageCodecKind.Png);
        GltfImageCodec.Detect([], mimeType: null, uri: null).Should().Be(GltfImageCodecKind.Unknown);
    }

    [Fact]
    public void TryDecodeRaster_Jpeg_ReturnsDecodedImage()
    {
        byte[] rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0];
        byte[] jpeg = GltfJpegDecoderTests.JpegWriter.Encode(rgba, 2, 2, components: 3);

        GltfImageCodec.TryDecodeRaster(jpeg, "image/jpeg", "image.jpg", out GltfDecodedImage? image, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        image!.Width.Should().Be(2);
        image.Height.Should().Be(2);
        image.Rgba.Length.Should().Be(16);
    }

    [Fact]
    public void TryDecodeRaster_Ktx2_FailsClosedAsUnsupported()
    {
        byte[] ktx2 = Ktx2TestData.Build(145, 4, 4, [[1, 2, 3, 4]]);

        GltfImageCodec.TryDecodeRaster(ktx2, "image/ktx2", "texture.ktx2", out _, out GltfImageDecodeError? error)
            .Should().BeFalse();

        error!.Value.Codec.Should().Be(GltfImageCodecKind.Ktx2);
        error.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
    }

    [Fact]
    public void TryResolve_Jpeg_IsDeterministic()
    {
        byte[] rgba = [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255];
        byte[] jpeg = GltfJpegDecoderTests.JpegWriter.Encode(rgba, 2, 2, components: 3);

        GltfImageCodec.TryResolve(jpeg, "image/jpeg", "image.jpg", out GltfImagePayload? first, out _)
            .Should().BeTrue();
        GltfImageCodec.TryResolve(jpeg, "image/jpeg", "image.jpg", out GltfImagePayload? second, out _)
            .Should().BeTrue();

        first!.Codec.Should().Be(GltfImageCodecKind.Jpeg);
        first.MimeType.Should().Be("image/jpeg");
        first.IsDecoded.Should().BeTrue();
        first.Ktx2.Should().BeNull();
        second!.Decoded!.Rgba.ToArray().Should().Equal(first.Decoded!.Rgba.ToArray());
    }

    [Fact]
    public void TryDecodeRaster_UnsupportedJpeg_ReportsFailingMarker()
    {
        byte[] jpeg = GltfJpegDecoderTests.JpegWriter.Encode(SolidPixels(8, 8, 40, 50, 60), 8, 8, components: 3);
        int sof = FindMarker(jpeg, 0xC0);
        sof.Should().BeGreaterThan(0);
        jpeg[sof + 1] = 0xC2;

        GltfImageCodec.TryDecodeRaster(jpeg, "image/jpeg", "image.jpg", out _, out GltfImageDecodeError? error)
            .Should().BeFalse();

        error!.Value.Codec.Should().Be(GltfImageCodecKind.Jpeg);
        error.Value.Failure.Should().Be(GltfImageDecodeFailure.Unsupported);
        error.Value.Marker.Should().Be("SOF2");
    }

    [Fact]
    public void TryResolve_Ktx2_ReturnsParsedContainer()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            keys: [("Dkmd", new byte[] { 5 })]);

        GltfImageCodec.TryResolve(ktx2, mimeType: null, "textures/albedo.ktx2", out GltfImagePayload? payload, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        payload!.Codec.Should().Be(GltfImageCodecKind.Ktx2);
        payload.MimeType.Should().Be("image/ktx2");
        payload.IsCompressed.Should().BeTrue();
        payload.Decoded.Should().BeNull();
        payload.Ktx2!.Header.VkFormat.Should().Be(145);
        payload.Ktx2.Dkmd.ToArray().Should().Equal(5);
    }

    [Fact]
    public async Task Import_Ktx2WithoutRuntimeTranscoder_RetainsCompressedPayloadWithDiagnostic()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));
        string json = BuildKtx2Gltf(ktx2);

        var importer = new GltfImporter(new GltfImporterOptions { Id = "basis.gltf" });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        texture.Payload.Should().BeOfType<GltfCompressedTexturePayload>();
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.Unknown);
        texture.TranscodeState.Success.Should().BeFalse();
        result.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == "gltf.texture.transcode.unavailable");
    }

    [Fact]
    public async Task Import_Ktx2WithRuntimeTranscoder_ProducesTranscodedPayload()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));
        string json = BuildKtx2Gltf(ktx2);
        var transcoder = new StubRuntimeTranscoder();

        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "basis.gltf",
            CompressedTextureTranscoder = transcoder,
        });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfTranscodedTexturePayload payload = texture.Payload
            .Should().BeOfType<GltfTranscodedTexturePayload>().Subject;
        payload.Format.Should().Be(GltfTextureFormat.BC7_RGBA);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.BC7_RGBA);
        texture.TranscodeState.Success.Should().BeTrue();
        texture.TranscodeState.TranscoderId.Should().Be("stub/runtime");
        transcoder.CallCount.Should().Be(1);
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public async Task Import_Ktx2WithUnknownTranscodeTarget_KeepsCompressedPayload()
    {
        byte[] ktx2 = Ktx2TestData.Build(vkFormat: 145, width: 4, height: 4, levels: [[1, 2, 3, 4]]);
        string json = BuildKtx2Gltf(ktx2);

        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "bc7.gltf",
            TranscodeTargetFormat = GltfTextureFormat.Unknown,
        });
        GltfImportResult result = await importer.ImportAsync(Encoding.UTF8.GetBytes(json));

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        texture.Payload.Should().BeOfType<GltfCompressedTexturePayload>();
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.BC7_RGBA);
        texture.TranscodeState.Success.Should().BeTrue();
        result.Diagnostics.Should().BeEmpty();
    }

    private static string BuildKtx2Gltf(byte[] ktx2) => $$"""
        {
          "asset": {"version": "2.0"},
          "images": [{"uri": "data:image/ktx2;base64,{{Convert.ToBase64String(ktx2)}}"}],
          "textures": [{"source": 0}]
        }
        """;

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

    private static byte[] SolidPixels(int width, int height, int red, int green, int blue)
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

    private sealed class StubRuntimeTranscoder : IGltfCompressedTextureTranscoder
    {
        public string Id => "stub/runtime";

        public int CallCount { get; private set; }

        public bool CanTranscode(GltfKtx2Texture texture, GltfTextureFormat targetFormat) => true;

        public bool TryTranscode(
            GltfKtx2Texture texture,
            GltfTextureFormat targetFormat,
            [NotNullWhen(true)] out GltfTexturePayload? payload,
            out GltfTextureFormat format,
            out string? failureReason)
        {
            CallCount++;
            payload = new GltfTranscodedTexturePayload(
                new byte[] { 1, 2, 3, 4 },
                targetFormat,
                [new GltfTextureMipLevel(0, texture.Header.PixelWidth, texture.Header.PixelHeight, 0, 4)]);
            format = targetFormat;
            failureReason = null;
            return true;
        }
    }
}
