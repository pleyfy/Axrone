namespace Axrone.AssetGltf.Tests;

using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Text;

public sealed class GltfKtx2ReaderTests
{
    [Fact]
    public void TryRead_MinimalHeader_ReportsHeaderAndLevels()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[9, 8, 7, 6]]);

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        error.Should().BeNull();
        GltfKtx2Header header = texture!.Header;
        header.VkFormat.Should().Be(145);
        header.PixelWidth.Should().Be(4);
        header.PixelHeight.Should().Be(4);
        header.LevelCount.Should().Be(1);
        header.Supercompression.Should().Be(GltfKtx2SupercompressionScheme.None);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.BC7_RGBA);
        texture.RequiresBasisTranscode.Should().BeFalse();
        texture.HasDataFormat.Should().BeFalse();
        texture.Levels.Should().ContainSingle();
        texture.Levels[0].Width.Should().Be(4);
        texture.Levels[0].Height.Should().Be(4);
        texture.Levels[0].ByteLength.Should().Be(4);
        texture.Data.ToArray().Should().Equal(ktx2);
    }

    [Fact]
    public void TryRead_DeclaredZeroLevelCount_DefaultsToOne()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 131,
            width: 2,
            height: 2,
            levels: [[1, 2, 3]],
            declaredLevelCount: 0);

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        texture!.Header.LevelCount.Should().Be(1);
        texture.Levels.Should().ContainSingle();
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.BC1_RGB);
    }

    [Fact]
    public void TryRead_MultipleLevels_ComputesDimensionsAndRanges()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 8,
            height: 4,
            levels: [[1, 2, 3, 4], [5, 6], [7]]);

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        texture!.Levels.Should().HaveCount(3);
        texture.Levels[0].Width.Should().Be(8);
        texture.Levels[0].Height.Should().Be(4);
        texture.Levels[1].Width.Should().Be(4);
        texture.Levels[1].Height.Should().Be(2);
        texture.Levels[2].Width.Should().Be(2);
        texture.Levels[2].Height.Should().Be(1);
        texture.Levels[0].ByteLength.Should().Be(4);
        texture.Levels[1].ByteLength.Should().Be(2);
        texture.Levels[2].ByteLength.Should().Be(1);
        texture.Levels[0].ByteOffset.Should().BeLessThan(texture.Levels[1].ByteOffset);
        texture.Levels[1].ByteOffset.Should().BeLessThan(texture.Levels[2].ByteOffset);
    }

    [Fact]
    public void TryRead_KeyValues_ExposesDkmdSDefODefK10NInFileOrder()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1]],
            keys:
            [
                ("Dkmd", new byte[] { 1, 2, 3 }),
                ("SDef", Encoding.UTF8.GetBytes("sample")),
                ("ODef", new byte[] { 0 }),
                ("K10N", new byte[] { 0xFF, 0x00 }),
            ]);

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        texture!.KeyValues.Should().HaveCount(4);
        texture.KeyValues[0].Key.Should().Be("Dkmd");
        texture.KeyValues[0].Value.ToArray().Should().Equal(1, 2, 3);
        texture.KeyValues[1].Key.Should().Be("SDef");
        texture.KeyValues[2].Key.Should().Be("ODef");
        texture.KeyValues[3].Key.Should().Be("K10N");
        texture.Dkmd.ToArray().Should().Equal(1, 2, 3);
        texture.SDef.ToArray().Should().Equal(Encoding.UTF8.GetBytes("sample"));
        texture.ODef.ToArray().Should().Equal(0);
        texture.K10N.ToArray().Should().Equal(0xFF, 0x00);
        texture.TryGetKeyValue("SDef", out ReadOnlyMemory<byte> value).Should().BeTrue();
        value.ToArray().Should().Equal(Encoding.UTF8.GetBytes("sample"));
        texture.TryGetKeyValue("missing", out _).Should().BeFalse();

        GltfKtx2Reader.TryValidate(ktx2, out GltfKtx2Info info, out _).Should().BeTrue();
        info.KeyValueCount.Should().Be(4);
        info.HasDkmd.Should().BeTrue();
        info.HasSDef.Should().BeTrue();
        info.HasODef.Should().BeTrue();
        info.HasK10N.Should().BeTrue();
    }

    [Fact]
    public void TryRead_DataFormatDescriptor_ParsesUastcColorModelAndSamples()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        texture!.HasDataFormat.Should().BeTrue();
        GltfKtx2DataFormat format = texture.DataFormat;
        format.ColorModel.Should().Be(GltfKtx2ColorModel.UASTC);
        format.IsBasisUniversal.Should().BeTrue();
        format.TexelBlockWidth.Should().Be(4);
        format.TexelBlockHeight.Should().Be(4);
        format.SampleCount.Should().Be(1);
        format.FirstSampleBitLength.Should().Be(8);
        format.FirstSampleChannelType.Should().Be(3);
        texture.RequiresBasisTranscode.Should().BeTrue();
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.Unknown);
    }

    [Fact]
    public void TryRead_BasisLz_RequiresEtc1sDescriptorAndGlobalData()
    {
        byte[] valid = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            scheme: GltfKtx2SupercompressionScheme.BasisLz,
            dfd: Ktx2TestData.BuildDfd(163),
            sgd: [1, 2, 3, 4]);

        GltfKtx2Reader.TryRead(valid, out GltfKtx2Texture? texture, out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());
        texture!.RequiresBasisTranscode.Should().BeTrue();

        byte[] withoutGlobalData = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            scheme: GltfKtx2SupercompressionScheme.BasisLz,
            dfd: Ktx2TestData.BuildDfd(163));

        GltfKtx2Reader.TryRead(withoutGlobalData, out _, out GltfImageDecodeError? missingGlobal)
            .Should().BeFalse();
        missingGlobal!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
        missingGlobal.Value.Marker.Should().Be("supercompression");

        byte[] wrongColorModel = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            scheme: GltfKtx2SupercompressionScheme.BasisLz,
            dfd: Ktx2TestData.BuildDfd(166),
            sgd: [1, 2, 3, 4]);

        GltfKtx2Reader.TryRead(wrongColorModel, out _, out GltfImageDecodeError? wrongModel).Should().BeFalse();
        wrongModel!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
    }

    [Fact]
    public void TryRead_ZstdAndZlibSupercompression_ReturnTypedUnsupported()
    {
        byte[] zstd = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            scheme: GltfKtx2SupercompressionScheme.Zstandard);

        GltfKtx2Reader.TryRead(zstd, out _, out GltfImageDecodeError? zstdError).Should().BeFalse();
        zstdError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Supercompression);
        zstdError.Value.Marker.Should().Be("supercompression");
        zstdError.Value.Message.Should().Contain("Zstandard");

        byte[] zlib = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            scheme: GltfKtx2SupercompressionScheme.Zlib);

        GltfKtx2Reader.TryRead(zlib, out _, out GltfImageDecodeError? zlibError).Should().BeFalse();
        zlibError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Supercompression);
    }

    [Fact]
    public void TryRead_WrongMagic_FailsTyped()
    {
        byte[] ktx2 = Ktx2TestData.Build(vkFormat: 145, width: 4, height: 4, levels: [[1]]);
        ktx2[0] = 0x00;

        GltfKtx2Reader.TryRead(ktx2, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Signature);
        error.Value.Marker.Should().Be("identifier");
    }

    [Fact]
    public void TryRead_TruncatedStructures_FailTyped()
    {
        byte[] ktx2 = Ktx2TestData.Build(vkFormat: 145, width: 4, height: 4, levels: [[1, 2, 3, 4]]);

        GltfKtx2Reader.TryRead(ktx2.AsMemory(0, 40), out _, out GltfImageDecodeError? headerError).Should().BeFalse();
        headerError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Truncated);
        headerError.Value.Marker.Should().Be("header");

        GltfKtx2Reader.TryRead(ktx2.AsMemory(0, 80), out _, out GltfImageDecodeError? indexError).Should().BeFalse();
        indexError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Truncated);
        indexError.Value.Marker.Should().Be("level index");

        byte[] oversizedLevel = (byte[])ktx2.Clone();
        BinaryPrimitives.WriteUInt64LittleEndian(oversizedLevel.AsSpan(80 + 8, 8), 4096);
        GltfKtx2Reader.TryRead(oversizedLevel, out _, out GltfImageDecodeError? levelError).Should().BeFalse();
        levelError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
        levelError.Value.Marker.Should().Be("level 0");

        byte[] misalignedLevel = (byte[])ktx2.Clone();
        BinaryPrimitives.WriteUInt64LittleEndian(misalignedLevel.AsSpan(80, 8), 105);
        GltfKtx2Reader.TryRead(misalignedLevel, out _, out GltfImageDecodeError? alignmentError).Should().BeFalse();
        alignmentError!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
        alignmentError.Value.Marker.Should().Be("level 0");
    }

    [Fact]
    public void TryRead_TruncatedDataFormatDescriptor_FailsTyped()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));

        BinaryPrimitives.WriteUInt32LittleEndian(ktx2.AsSpan(52, 4), 2);

        GltfKtx2Reader.TryRead(ktx2, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
        error.Value.Marker.Should().Be("DFD");
    }

    [Fact]
    public void TryRead_TruncatedKeyValueRegion_FailsTyped()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 4,
            height: 4,
            levels: [[1]],
            keys: [("Dkmd", new byte[] { 1 })]);

        BinaryPrimitives.WriteUInt32LittleEndian(ktx2.AsSpan(60, 4), 4096);

        GltfKtx2Reader.TryRead(ktx2, out _, out GltfImageDecodeError? error).Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.Container);
        error.Value.Marker.Should().Be("KVD");
    }

    [Fact]
    public void TryValidate_IsAllocationFreeAfterWarmup()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 8,
            height: 8,
            levels: [[1, 2, 3, 4], [5, 6, 7, 8]],
            dfd: Ktx2TestData.BuildDfd(166),
            keys:
            [
                ("Dkmd", new byte[] { 1, 2, 3, 4 }),
                ("SDef", Encoding.UTF8.GetBytes("def")),
                ("ODef", new byte[] { 9 }),
                ("K10N", new byte[] { 10, 11 }),
            ]);

        for (int warmup = 0; warmup < 16; warmup++)
        {
            GltfKtx2Reader.TryValidate(ktx2, out _, out _).Should().BeTrue();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int iteration = 0; iteration < 64; iteration++)
        {
            _ = GltfKtx2Reader.TryValidate(ktx2, out _, out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void TryResolvePayload_BasisWithoutTranscoder_ReturnsClearDiagnostic()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));
        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out _).Should().BeTrue();

        bool ok = GltfKtx2Reader.TryResolvePayload(
            texture!,
            transcoder: null,
            GltfTextureFormat.BC7_RGBA,
            out GltfTexturePayload? payload,
            out GltfTextureFormat format,
            out GltfImageDecodeError? error);

        ok.Should().BeFalse();
        payload.Should().BeNull();
        format.Should().Be(GltfTextureFormat.Unknown);
        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.TranscoderMissing);
        error.Value.Marker.Should().Be("transcoder");
        error.Value.Message.Should().Contain("IGltfCompressedTextureTranscoder");
    }

    [Fact]
    public void TryResolvePayload_NonBasis_ReturnsCompressedPayload()
    {
        byte[] ktx2 = Ktx2TestData.Build(vkFormat: 145, width: 4, height: 4, levels: [[1, 2, 3, 4]]);
        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out _).Should().BeTrue();

        GltfKtx2Reader.TryResolvePayload(
                texture!,
                transcoder: null,
                GltfTextureFormat.BC7_RGBA,
                out GltfTexturePayload? payload,
                out GltfTextureFormat format,
                out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        format.Should().Be(GltfTextureFormat.BC7_RGBA);
        GltfCompressedTexturePayload compressed = payload.Should()
            .BeOfType<GltfCompressedTexturePayload>().Subject;
        compressed.VkFormat.Should().Be(145);
        compressed.Width.Should().Be(4);
        compressed.Height.Should().Be(4);
        compressed.Levels.Should().ContainSingle();
        compressed.MipLevels.Should().ContainSingle();
    }

    [Fact]
    public void TryResolvePayload_WithTranscoder_ReturnsTranscodedOutput()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));
        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out _).Should().BeTrue();
        var transcoder = new StubTranscoder("stub/basis");

        GltfKtx2Reader.TryResolvePayload(
                texture!,
                transcoder,
                GltfTextureFormat.BC7_RGBA,
                out GltfTexturePayload? payload,
                out GltfTextureFormat format,
                out GltfImageDecodeError? error)
            .Should().BeTrue(error.ToString());

        format.Should().Be(GltfTextureFormat.BC7_RGBA);
        payload.Should().BeOfType<GltfTranscodedTexturePayload>();
        transcoder.LastTexture.Should().BeSameAs(texture);
        transcoder.CallCount.Should().Be(1);
    }

    [Fact]
    public void TryResolvePayload_RefusingTranscoder_ReturnsFailure()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 0,
            width: 4,
            height: 4,
            levels: [[1, 2, 3, 4]],
            dfd: Ktx2TestData.BuildDfd(166));
        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? texture, out _).Should().BeTrue();
        var transcoder = new StubTranscoder("stub/refuse", canTranscode: false);

        GltfKtx2Reader.TryResolvePayload(
                texture!,
                transcoder,
                GltfTextureFormat.BC7_RGBA,
                out _,
                out _,
                out GltfImageDecodeError? error)
            .Should().BeFalse();

        error!.Value.Failure.Should().Be(GltfImageDecodeFailure.TranscoderFailed);
        error.Value.Message.Should().Contain("stub/refuse");
    }

    [Fact]
    public void TryRead_Repeated_ParsesIdentically()
    {
        byte[] ktx2 = Ktx2TestData.Build(
            vkFormat: 145,
            width: 8,
            height: 8,
            levels: [[1, 2, 3], [4, 5]],
            keys: [("Dkmd", new byte[] { 7, 8 })]);

        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? first, out _).Should().BeTrue();
        GltfKtx2Reader.TryRead(ktx2, out GltfKtx2Texture? second, out _).Should().BeTrue();

        second!.Header.Should().Be(first!.Header);
        second.Levels.Should().Equal(first.Levels);
        second.KeyValues.Select(static entry => entry.Key).Should().Equal(first.KeyValues.Select(static entry => entry.Key));
        second.Dkmd.ToArray().Should().Equal(first.Dkmd.ToArray());
    }

    private sealed class StubTranscoder(string id, bool canTranscode = true) : IGltfCompressedTextureTranscoder
    {
        public string Id { get; } = id;

        public int CallCount { get; private set; }

        public GltfKtx2Texture? LastTexture { get; private set; }

        public bool CanTranscode(GltfKtx2Texture texture, GltfTextureFormat targetFormat) => canTranscode;

        public bool TryTranscode(
            GltfKtx2Texture texture,
            GltfTextureFormat targetFormat,
            [NotNullWhen(true)] out GltfTexturePayload? payload,
            out GltfTextureFormat format,
            out string? failureReason)
        {
            CallCount++;
            LastTexture = texture;
            if (!canTranscode)
            {
                payload = null;
                format = GltfTextureFormat.Unknown;
                failureReason = "refused";
                return false;
            }

            payload = new GltfTranscodedTexturePayload(
                new byte[] { 1, 2, 3 },
                targetFormat,
                [new GltfTextureMipLevel(0, texture.Header.PixelWidth, texture.Header.PixelHeight, 0, 3)]);
            format = targetFormat;
            failureReason = null;
            return true;
        }
    }
}

internal static class Ktx2TestData
{
    private static ReadOnlySpan<byte> Identifier =>
        [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

    public static byte[] Build(
        int vkFormat,
        int width,
        int height,
        IReadOnlyList<byte[]> levels,
        GltfKtx2SupercompressionScheme scheme = GltfKtx2SupercompressionScheme.None,
        byte[]? dfd = null,
        (string Key, byte[] Value)[]? keys = null,
        byte[]? sgd = null,
        int? declaredLevelCount = null)
    {
        int count = levels.Count;
        int cursor = 80 + (count * 24);

        int dfdOffset = 0;
        int dfdLength = 0;
        if (dfd is not null)
        {
            dfdOffset = Align(cursor, 4);
            cursor = dfdOffset + dfd.Length;
            dfdLength = dfd.Length;
        }

        int kvdOffset = 0;
        int kvdLength = 0;
        byte[]? kvd = null;
        if (keys is not null)
        {
            kvd = BuildKeyValueData(keys);
            kvdOffset = Align(cursor, 4);
            cursor = kvdOffset + kvd.Length;
            kvdLength = kvd.Length;
        }

        int sgdOffset = 0;
        int sgdLength = 0;
        if (sgd is not null)
        {
            sgdOffset = Align(cursor, 8);
            cursor = sgdOffset + sgd.Length;
            sgdLength = sgd.Length;
        }

        int[] levelOffsets = new int[count];
        for (int level = 0; level < count; level++)
        {
            levelOffsets[level] = Align(cursor, 8);
            cursor = levelOffsets[level] + levels[level].Length;
        }

        byte[] output = new byte[cursor];
        Identifier.CopyTo(output);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(12, 4), (uint)vkFormat);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(16, 4), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(20, 4), (uint)width);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(24, 4), (uint)height);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(28, 4), 0);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(32, 4), 0);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(36, 4), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(
            output.AsSpan(40, 4),
            (uint)(declaredLevelCount ?? count));
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(44, 4), (uint)scheme);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(48, 4), (uint)dfdOffset);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(52, 4), (uint)dfdLength);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(56, 4), (uint)kvdOffset);
        BinaryPrimitives.WriteUInt32LittleEndian(output.AsSpan(60, 4), (uint)kvdLength);
        BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(64, 8), (ulong)sgdOffset);
        BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(72, 8), (ulong)sgdLength);

        for (int level = 0; level < count; level++)
        {
            int entry = 80 + (level * 24);
            BinaryPrimitives.WriteUInt64LittleEndian(output.AsSpan(entry, 8), (ulong)levelOffsets[level]);
            BinaryPrimitives.WriteUInt64LittleEndian(
                output.AsSpan(entry + 8, 8),
                (ulong)levels[level].Length);
            BinaryPrimitives.WriteUInt64LittleEndian(
                output.AsSpan(entry + 16, 8),
                (ulong)levels[level].Length);
            levels[level].CopyTo(output, levelOffsets[level]);
        }

        if (dfd is not null)
        {
            dfd.CopyTo(output, dfdOffset);
        }

        if (kvd is not null)
        {
            kvd.CopyTo(output, kvdOffset);
        }

        if (sgd is not null)
        {
            sgd.CopyTo(output, sgdOffset);
        }

        return output;
    }

    public static byte[] BuildDfd(byte colorModel, int samples = 1)
    {
        int blockSize = 24 + (samples * 16);
        int totalSize = 4 + blockSize;
        byte[] dfd = new byte[totalSize];
        BinaryPrimitives.WriteUInt32LittleEndian(dfd.AsSpan(0, 4), (uint)totalSize);
        BinaryPrimitives.WriteUInt32LittleEndian(dfd.AsSpan(4, 4), 0);
        BinaryPrimitives.WriteUInt32LittleEndian(
            dfd.AsSpan(8, 4),
            (uint)((blockSize << 16) | 2));
        dfd[12] = colorModel;
        dfd[13] = 1;
        dfd[14] = 1;
        dfd[15] = 0;
        dfd[16] = 3;
        dfd[17] = 3;
        dfd[18] = 0;
        dfd[19] = 0;
        dfd[20] = 16;

        for (int sample = 0; sample < samples; sample++)
        {
            int offset = 28 + (sample * 16);
            BinaryPrimitives.WriteUInt16LittleEndian(dfd.AsSpan(offset, 2), 0);
            dfd[offset + 2] = 8;
            dfd[offset + 3] = 3;
            dfd[offset + 4] = 0;
            dfd[offset + 5] = 1;
            dfd[offset + 6] = 2;
            dfd[offset + 7] = 3;
            BinaryPrimitives.WriteUInt32LittleEndian(dfd.AsSpan(offset + 8, 4), 0);
            BinaryPrimitives.WriteUInt32LittleEndian(dfd.AsSpan(offset + 12, 4), 255);
        }

        return dfd;
    }

    private static byte[] BuildKeyValueData((string Key, byte[] Value)[] entries)
    {
        using var payload = new MemoryStream();
        Span<byte> header = stackalloc byte[4];
        foreach ((string key, byte[] value) in entries)
        {
            byte[] keyBytes = Encoding.UTF8.GetBytes(key);
            int entryLength = keyBytes.Length + 1 + value.Length;
            BinaryPrimitives.WriteUInt32LittleEndian(header, (uint)entryLength);
            payload.Write(header);
            payload.Write(keyBytes);
            payload.WriteByte(0);
            payload.Write(value);
            int padding = (4 - (entryLength & 3)) & 3;
            for (int pad = 0; pad < padding; pad++)
            {
                payload.WriteByte(0);
            }
        }

        return payload.ToArray();
    }

    private static int Align(int value, int alignment) => (value + alignment - 1) & ~(alignment - 1);
}
