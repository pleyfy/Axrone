namespace Axrone.Ui.Assets.Tests;

using System.Buffers;
using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiDocumentJsonCodecTests
{
    private const string MinimalJson =
        "{\"version\":1,\"id\":\"ui.min\",\"name\":\"Min\",\"canvas\":{\"referenceWidth\":1920,\"referenceHeight\":1080,\"scaleMode\":\"match-width\"},\"root\":{\"role\":\"root\"}}";

    [Fact]
    public void RoundTripsEveryAuthoredPayload()
    {
        UiAssetDocument source = UiTestDocuments.CreateSample();
        byte[] bytes = Encode(source);

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(bytes, out IUiDocument? decoded, out UiDocumentError failure).Should().BeTrue();
        failure.HasError.Should().BeFalse();
        UiAssetDocument document = decoded.Should().BeOfType<UiAssetDocument>().Subject;

        document.AssetId.Should().Be("ui.sample");
        document.Info.Name.Should().Be("sample");
        document.Info.Version.Should().Be(1);
        document.Info.Canvas.ReferenceWidth.Should().Be(1920.0f);
        document.Info.Canvas.ScaleMode.Should().Be(UiCanvasScaleMode.MatchWidthOrHeight);
        document.Nodes.Count.Should().Be(4);
        document.Nodes.Root.Should().Be(new UiNodeId(1));
        document.Nodes.GetChildren(new UiNodeId(1)).ToArray().Should().Equal(new UiNodeId(2));

        document.TryGetRole(new UiNodeId(2), out string? panelRole).Should().BeTrue();
        panelRole.Should().Be("panel");
        document.TryGetKey(new UiNodeId(2), out UiBindingKey panelKey).Should().BeTrue();
        panelKey.Kind.Should().Be(UiKeyKind.Text);
        panelKey.Text.Should().Be("panel");

        document.TryGetText(new UiNodeId(3), out UiNodeText text).Should().BeTrue();
        text.Value.Should().Be("Hello");
        text.Family.Should().Be("Inter");
        text.Size.Should().Be(18.0f);
        text.Weight.Should().Be(UiFontWeight.SemiBold);
        text.Overflow.Should().Be(UiTextOverflow.Ellipsis);
        text.Align.Should().Be(UiTextAlign.Center);
        text.Direction.Should().Be(UiTextDirection.Ltr);
        text.LineHeight.Should().Be(1.2f);
        text.LetterSpacing.Should().Be(0.5f);
        text.MaxLines.Should().Be(2);

        document.TryGetImage(new UiNodeId(4), out UiNodeImage image).Should().BeTrue();
        image.SourceKind.Should().Be(UiImageSourceKind.Texture);
        image.ResourceId.Should().Be("ui/icon.png");
        image.Fit.Should().Be(UiImageFit.Contain);
        image.SourceSize.Width.Should().Be(64.0f);

        document.Bindings.Count.Should().Be(4);
        document.Bindings.TryGet("title".AsSpan(), out UiBindingValue title).Should().BeTrue();
        title.Kind.Should().Be(UiBindingValueKind.Text);
        document.Bindings.TryGetString("title".AsSpan(), out ReadOnlySpan<byte> titleText).Should().BeTrue();
        Encoding.UTF8.GetString(titleText).Should().Be("Play");
        document.Bindings.TryGet("score".AsSpan(), out UiBindingValue score).Should().BeTrue();
        score.Number.Should().Be(42.0);
        document.Bindings.TryGet("paused".AsSpan(), out UiBindingValue paused).Should().BeTrue();
        paused.Boolean.Should().BeTrue();
        document.Bindings.TryGet("selected".AsSpan(), out UiBindingValue selected).Should().BeTrue();
        selected.Kind.Should().Be(UiBindingValueKind.Null);
    }

    [Fact]
    public void WriteIsByteDeterministicAndStableAcrossRead()
    {
        UiAssetDocument source = UiTestDocuments.CreateSample();
        byte[] first = Encode(source);
        byte[] second = Encode(source);
        first.Should().Equal(second);

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(first, out IUiDocument? decoded, out _).Should().BeTrue();
        byte[] rewrote = Encode(decoded!);
        rewrote.Should().Equal(first);
    }

    [Fact]
    public void WriterElidesDefaultsAndOrdersKeys()
    {
        UiAssetDocument source = UiTestDocuments.CreateSample();
        string json = Encoding.UTF8.GetString(Encode(source));

        json.Should().StartWith("{\"version\":1,\"id\":\"ui.sample\",\"name\":\"sample\",\"canvas\":");
        json.Should().NotContain("\"props\"");
        json.Should().NotContain("\"components\"");
    }

    [Fact]
    public void ReadsMinimalDocumentWithDefaults()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(MinimalJson), out IUiDocument? decoded, out UiDocumentError failure)
            .Should().BeTrue();

        UiAssetDocument document = (UiAssetDocument)decoded!;
        document.Nodes.TryGetNode(new UiNodeId(1), out UiNodeRecord root).Should().BeTrue();
        root.Flags.Should().HaveFlag(UiNodeFlags.Visible);
        root.Flags.Should().HaveFlag(UiNodeFlags.Enabled);
        root.Flags.Should().HaveFlag(UiNodeFlags.Interactive);
        document.TryGetLayout(new UiNodeId(1), out UiLayoutStyle layout).Should().BeTrue();
        layout.Should().Be(UiLayoutStyle.Default);
        document.Bindings.Count.Should().Be(0);
        failure.HasError.Should().BeFalse();
    }

    [Theory]
    [InlineData("", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"}}", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"version\":2,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"}}", UiDocumentErrorCode.UnsupportedVersion)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"}}", UiDocumentErrorCode.MissingRoot)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"},\"extra\":1}", UiDocumentErrorCode.UnsupportedFeature)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"role\":\"root\"}}", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"},\"bindings\":{\"a\":1,\"a\":2}}", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"sideways\"},\"root\":{\"role\":\"root\"}}", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":0,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"}}", UiDocumentErrorCode.Malformed)]
    [InlineData("{\"version\":1,\"id\":\"ui.x\",\"name\":\"X\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"style\":{\"opacity\":2}}}", UiDocumentErrorCode.Malformed)]
    public void RejectsInvalidPayloadsWithStableCodes(string json, UiDocumentErrorCode expected)
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        bool read = codec.TryRead(Encoding.UTF8.GetBytes(json), out IUiDocument? document, out UiDocumentError failure);

        read.Should().BeFalse();
        document.Should().BeNull();
        failure.Code.Should().Be(expected);
    }

    [Fact]
    public void TruncatedPayloadIsMalformed()
    {
        byte[] bytes = Encoding.UTF8.GetBytes(MinimalJson);
        ReadOnlySpan<byte> truncated = bytes.AsSpan(0, bytes.Length / 2);

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(truncated, out _, out UiDocumentError failure).Should().BeFalse();
        failure.Code.Should().Be(UiDocumentErrorCode.Malformed);
    }

    [Fact]
    public void EscapedStringsAreDecoded()
    {
        const string json =
            "{\"version\":1,\"id\":\"ui.esc\",\"name\":\"N\\u0061me\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"A\\u0042\\n\"}}]}}";

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(json), out IUiDocument? decoded, out _).Should().BeTrue();
        UiAssetDocument document = (UiAssetDocument)decoded!;

        document.Info.Name.Should().Be("Name");
        document.TryGetText(new UiNodeId(2), out UiNodeText text).Should().BeTrue();
        text.Value.Should().Be("AB\n");
    }

    [Fact]
    public void ReadsHexColorsAndLengthForms()
    {
        const string json =
            "{\"version\":1,\"id\":\"ui.style\",\"name\":\"S\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"layout\":{\"width\":\"50%\",\"height\":\"stretch:2\",\"gap\":10,\"insetLeft\":\"viewport:10\"},\"style\":{\"background\":\"#3366FF\"}}}";

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(json), out IUiDocument? decoded, out UiDocumentError failure).Should().BeTrue(failure.Message);

        UiAssetDocument document = (UiAssetDocument)decoded!;
        document.TryGetLayout(new UiNodeId(1), out UiLayoutStyle layout).Should().BeTrue();
        layout.Width.Should().Be(UiLength.Percent(50.0f));
        layout.Height.Should().Be(UiLength.Stretch(2.0f));
        layout.Gap.Should().Be(10.0f);
        layout.InsetLeft.Should().Be(UiLength.Viewport(10.0f));

        document.TryGetStyle(new UiNodeId(1), out UiWidgetStyle style).Should().BeTrue();
        style.Background.R.Should().BeApproximately(0.2f, 1e-4f);
        style.Background.G.Should().BeApproximately(0.4f, 1e-4f);
        style.Background.B.Should().BeApproximately(1.0f, 1e-4f);
        style.Background.A.Should().Be(1.0f);
    }

    [Fact]
    public void SuccessfulReadInvalidatesReusableDocumentButFailedReadDoesNot()
    {
        using var codec = new UiDocumentJsonCodec();
        byte[] sample = Encode(UiTestDocuments.CreateSample());
        codec.TryRead(sample, out IUiDocument? first, out _).Should().BeTrue();

        codec.TryRead(ReadOnlySpan<byte>.Empty, out IUiDocument? failed, out _).Should().BeFalse();
        failed.Should().BeNull();
        first!.Info.Name.Should().Be("sample");

        byte[] minimal = Encoding.UTF8.GetBytes(MinimalJson);
        codec.TryRead(minimal, out IUiDocument? second, out _).Should().BeTrue();
        second.Should().BeSameAs(first);
        second!.Info.Name.Should().Be("Min");
    }

    [Fact]
    public void IsolatedCodecKeepsDocumentsAliveIndependently()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(MinimalJson), out IUiDocument? first, out _).Should().BeTrue();
        codec.TryRead(Encoding.UTF8.GetBytes(MinimalJson.Replace("ui.min", "ui.second", StringComparison.Ordinal)), out IUiDocument? second, out _).Should().BeTrue();

        first!.Info.Name.Should().Be("Min");
        second!.Info.Id.Should().NotBe(first.Info.Id);
    }

    [Fact]
    public void MigrationPipelineUpgradesOlderPayloads()
    {
        const string v0 =
            "{\"version\":0,\"id\":\"ui.old\",\"name\":\"Old\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\"}}";
        var pipeline = new UiDocumentMigrationPipeline([new VersionZeroToV1Migration()]);

        using var codec = new UiDocumentJsonCodec(pipeline, reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(v0), out IUiDocument? decoded, out UiDocumentError failure).Should().BeTrue(failure.Message);
        decoded!.Info.Name.Should().Be("Old");
    }

    [Fact]
    public void MigrationPipelineFailsClosedOnMissingLinkAndInvalidRegistration()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        string v0 = MinimalJson.Replace("\"version\":1", "\"version\":0", StringComparison.Ordinal);
        codec.TryRead(Encoding.UTF8.GetBytes(v0), out _, out UiDocumentError failure).Should().BeFalse();
        failure.Code.Should().Be(UiDocumentErrorCode.UnsupportedVersion);

        FluentActions.Invoking(static () => new UiDocumentMigrationPipeline([new DuplicateStartMigration(), new DuplicateStartMigration()]))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(static () => new UiDocumentMigrationPipeline([new BackwardsMigration()]))
            .Should().Throw<ArgumentException>();
    }

    [Fact]
    public void PipelineChainsMultipleMigrations()
    {
        var pipeline = new UiDocumentMigrationPipeline([new VersionZeroToV1Migration(), new VersionOneToTwoMigration()]);
        var destination = new ArrayBufferWriter<byte>();
        string v0 = MinimalJson.Replace("\"version\":1", "\"version\":0", StringComparison.Ordinal);

        pipeline.TryMigrate(Encoding.UTF8.GetBytes(v0), 0, 2, destination, out UiDocumentError failure)
            .Should().BeTrue(failure.Message);
        Encoding.UTF8.GetString(destination.WrittenSpan).Should().Contain("\"version\":2");
    }

    [Fact]
    public void StructuralDocumentsWriteAndRead()
    {
        var document = new StructuralDocument();
        byte[] bytes = Encode(document);

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(bytes, out IUiDocument? decoded, out UiDocumentError failure).Should().BeTrue(failure.Message);
        decoded!.Nodes.Count.Should().Be(2);
        decoded.Nodes.GetChildren(decoded.Nodes.Root).ToArray().Should().HaveCount(1);
    }

    [Fact]
    public void WriteRejectsInvalidDocuments()
    {
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        var destination = new ArrayBufferWriter<byte>();

        FluentActions.Invoking(() => codec.Write(new StructuralDocument { ValidRoot = false }, destination))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => codec.Write(new WrongVersionDocument(), destination))
            .Should().Throw<ArgumentException>();
    }

    [Fact]
    public void NodeDepthBeyondLimitIsResourceLimit()
    {
        var builder = new StringBuilder("{\"version\":1,\"id\":\"ui.deep\",\"name\":\"D\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":");
        for (int i = 0; i < 140; i++)
        {
            builder.Append("{\"role\":\"root\",\"children\":[");
        }

        builder.Append("]}");
        for (int i = 0; i < 140; i++)
        {
            builder.Append("]}");
        }

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(builder.ToString()), out _, out UiDocumentError failure).Should().BeFalse();
        failure.Code.Should().BeOneOf(UiDocumentErrorCode.ResourceLimit, UiDocumentErrorCode.Malformed);
    }

    [Fact]
    public void OversizedStringIsResourceLimit()
    {
        string huge = new('x', UiDocumentJsonSchema.MaxStringBytes + 1);
        string json =
            "{\"version\":1,\"id\":\"ui.big\",\"name\":\"B\",\"canvas\":{\"referenceWidth\":1,\"referenceHeight\":1,\"scaleMode\":\"fill\"},\"root\":{\"role\":\"root\",\"children\":[{\"role\":\"text\",\"text\":{\"value\":\"" +
            huge +
            "\"}}]}}";

        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.TryRead(Encoding.UTF8.GetBytes(json), out _, out UiDocumentError failure).Should().BeFalse();
        failure.Code.Should().Be(UiDocumentErrorCode.ResourceLimit);
    }

    private static byte[] Encode(IUiDocument document)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.Write(document, buffer);
        return buffer.WrittenSpan.ToArray();
    }

    private sealed class VersionZeroToV1Migration : IUiDocumentMigration
    {
        public int FromVersion => 0;

        public int ToVersion => 1;

        public bool TryMigrate(ReadOnlySpan<byte> source, IBufferWriter<byte> destination, out UiDocumentError failure)
        {
            return TestMigration.Rewrite(source, destination, "\"version\":0", "\"version\":1", out failure);
        }
    }

    private sealed class VersionOneToTwoMigration : IUiDocumentMigration
    {
        public int FromVersion => 1;

        public int ToVersion => 2;

        public bool TryMigrate(ReadOnlySpan<byte> source, IBufferWriter<byte> destination, out UiDocumentError failure)
        {
            return TestMigration.Rewrite(source, destination, "\"version\":1", "\"version\":2", out failure);
        }
    }

    private sealed class DuplicateStartMigration : IUiDocumentMigration
    {
        public int FromVersion => 5;

        public int ToVersion => 6;

        public bool TryMigrate(ReadOnlySpan<byte> source, IBufferWriter<byte> destination, out UiDocumentError failure)
        {
            _ = source;
            _ = destination;
            failure = UiDocumentError.None;
            return true;
        }
    }

    private sealed class BackwardsMigration : IUiDocumentMigration
    {
        public int FromVersion => 7;

        public int ToVersion => 7;

        public bool TryMigrate(ReadOnlySpan<byte> source, IBufferWriter<byte> destination, out UiDocumentError failure)
        {
            _ = source;
            _ = destination;
            failure = UiDocumentError.None;
            return true;
        }
    }

    private static class TestMigration
    {
        public static bool Rewrite(
            ReadOnlySpan<byte> source,
            IBufferWriter<byte> destination,
            string from,
            string to,
            out UiDocumentError failure)
        {
            string text = Encoding.UTF8.GetString(source).Replace(from, to, StringComparison.Ordinal);
            int bytes = Encoding.UTF8.GetByteCount(text);
            Span<byte> span = destination.GetSpan(bytes);
            _ = Encoding.UTF8.GetBytes(text, span);
            destination.Advance(bytes);
            failure = UiDocumentError.None;
            return true;
        }
    }

    private sealed class StructuralDocument : IUiDocument
    {
        private readonly StructuralTree _tree = new();

        public bool ValidRoot { get; init; } = true;

        public UiDocumentInfo Info { get; } = new(
            new UiDocumentId(7),
            "structural",
            1,
            new UiCanvasConfig(320.0f, 240.0f, UiCanvasScaleMode.Fixed, 0.5f, UiEdgeInsets.Zero));

        public IUiNodeTree Nodes => ValidRoot ? _tree : new StructuralTree(rootValid: false);
    }

    private sealed class StructuralTree : IUiNodeTree
    {
        private static readonly UiNodeRecord RootRecord = new(
            new UiNodeId(1),
            UiNodeId.Invalid,
            new UiNodeId(2),
            UiNodeId.Invalid,
            UiNodeKind.Root,
            UiNodeFlags.Visible | UiNodeFlags.Enabled);

        private static readonly UiNodeRecord ChildRecord = new(
            new UiNodeId(2),
            new UiNodeId(1),
            UiNodeId.Invalid,
            UiNodeId.Invalid,
            UiNodeKind.Text,
            UiNodeFlags.Visible | UiNodeFlags.Enabled);

        private readonly bool _rootValid;

        public StructuralTree(bool rootValid = true)
        {
            _rootValid = rootValid;
        }

        public int Count => 2;

        public UiNodeId Root => _rootValid ? new UiNodeId(1) : UiNodeId.Invalid;

        public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
        {
            if (id == new UiNodeId(1))
            {
                record = RootRecord;
                return true;
            }

            if (id == new UiNodeId(2))
            {
                record = ChildRecord;
                return true;
            }

            record = default;
            return false;
        }

        private static readonly UiNodeId[] ChildIds = [new UiNodeId(2)];

        public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id) =>
            id == new UiNodeId(1) ? ChildIds : ReadOnlySpan<UiNodeId>.Empty;
    }

    private sealed class WrongVersionDocument : IUiDocument
    {
        public UiDocumentInfo Info { get; } = new(
            new UiDocumentId(9),
            "wrong",
            2,
            new UiCanvasConfig(1.0f, 1.0f, UiCanvasScaleMode.Fill, 0.5f, UiEdgeInsets.Zero));

        public IUiNodeTree Nodes { get; } = new StructuralTree();
    }
}
