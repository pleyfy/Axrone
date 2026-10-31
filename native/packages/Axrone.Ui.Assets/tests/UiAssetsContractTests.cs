namespace Axrone.Ui.Assets.Tests;

using System.Buffers;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiAssetsContractTests
{
    [Fact]
    public void ErrorSentinelHasNoFailure()
    {
        UiDocumentError none = UiDocumentError.None;

        none.HasError.Should().BeFalse();
        none.Code.Should().Be(UiDocumentErrorCode.None);
        none.Offset.Should().Be(-1);
        none.Message.Should().BeEmpty();
    }

    [Fact]
    public void ErrorCarriesCodeAndOffset()
    {
        UiDocumentError error = new(UiDocumentErrorCode.DuplicateNode, 128, "duplicate node");

        error.HasError.Should().BeTrue();
        error.Code.Should().Be(UiDocumentErrorCode.DuplicateNode);
        error.Offset.Should().Be(128);
    }

    [Fact]
    public void CodecRejectsEmptyPayload()
    {
        StubCodec codec = new();

        bool read = codec.TryRead(ReadOnlySpan<byte>.Empty, out IUiDocument? document, out UiDocumentError error);

        read.Should().BeFalse();
        document.Should().BeNull();
        error.Code.Should().Be(UiDocumentErrorCode.Malformed);
        codec.FormatId.Should().Be(StubCodec.Id);
        codec.Version.Should().Be(1);
    }

    [Fact]
    public void ImporterProbesHeaderBeforeImport()
    {
        StubImporter importer = new();
        RecordingSink sink = new();

        importer.CanImport(ReadOnlySpan<byte>.Empty).Should().BeFalse();

        bool imported = importer.TryImport(ReadOnlySpan<byte>.Empty, sink, out UiDocumentError error);

        imported.Should().BeFalse();
        error.Code.Should().Be(UiDocumentErrorCode.UnsupportedVersion);
        sink.Documents.Should().Be(0);
        sink.Resources.Should().Be(0);
    }

    [Fact]
    public void ImportSinkReceivesDocumentsAndResources()
    {
        RecordingSink sink = new();
        StubDocument document = new();

        sink.AddDocument(document);
        sink.AddResource(new UiAssetResource(new UiResourceId(5UL), "fonts/ui.ttf", "font/ttf", 2048));

        sink.Documents.Should().Be(1);
        sink.Resources.Should().Be(1);
        document.Info.Id.Should().Be(new UiDocumentId(1));
        document.Nodes.Root.Should().Be(UiNodeId.Invalid);
    }

    [Fact]
    public void GenericBinderInstantiatesWithoutSceneReference()
    {
        SampleScene scene = new();
        SampleBinder binder = new();

        binder.Bind(new StubDocument(), scene);
        binder.Unbind(new StubDocument(), scene);

        scene.BindCount.Should().Be(1);
        scene.UnbindCount.Should().Be(1);
    }

    [Fact]
    public void EditorHostOpensAndReloadsDocuments()
    {
        SampleEditorHost host = new();

        host.TryOpen("ui/main.ui.json", out IUiDocument? opened).Should().BeTrue();
        opened.Should().NotBeNull();

        host.TryReload(opened!.Info.Id, out IUiDocument? reloaded).Should().BeTrue();
        reloaded.Should().NotBeNull();
        reloaded!.Info.Id.Should().Be(opened.Info.Id);
    }
}

internal sealed class StubCodec : IUiDocumentCodec
{
    public const string Id = "ui.stub";

    public string FormatId => Id;

    public int Version => 1;

    public bool TryRead(ReadOnlySpan<byte> data, out IUiDocument? document, out UiDocumentError failure)
    {
        document = null;
        failure = data.IsEmpty
            ? new UiDocumentError(UiDocumentErrorCode.Malformed, 0, "empty payload")
            : UiDocumentError.None;
        return false;
    }

    public void Write(IUiDocument document, IBufferWriter<byte> destination)
    {
        _ = document;
        _ = destination;
    }
}

internal sealed class StubImporter : IUiAssetImporter
{
    public string FormatId => "ui.stub";

    public bool CanImport(ReadOnlySpan<byte> header) => !header.IsEmpty;

    public bool TryImport(ReadOnlySpan<byte> source, IUiAssetImportSink sink, out UiDocumentError failure)
    {
        _ = source;
        _ = sink;
        failure = new UiDocumentError(UiDocumentErrorCode.UnsupportedVersion, 0, "unsupported");
        return false;
    }
}

internal sealed class RecordingSink : IUiAssetImportSink
{
    public int Documents { get; private set; }

    public int Resources { get; private set; }

    public void AddDocument(IUiDocument document)
    {
        _ = document;
        Documents++;
    }

    public void AddResource(in UiAssetResource resource)
    {
        _ = resource;
        Resources++;
    }
}

internal sealed class EmptyNodeTree : IUiNodeTree
{
    public int Count => 0;

    public UiNodeId Root => UiNodeId.Invalid;

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        _ = id;
        record = default;
        return false;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id)
    {
        _ = id;
        return ReadOnlySpan<UiNodeId>.Empty;
    }
}

internal sealed class StubDocument : IUiDocument
{
    public UiDocumentInfo Info { get; } = new(new UiDocumentId(1), "document", 1, default);

    public IUiNodeTree Nodes { get; } = new EmptyNodeTree();
}

internal sealed class SampleScene
{
    public int BindCount { get; private set; }

    public int UnbindCount { get; private set; }

    public void OnBound() => BindCount++;

    public void OnUnbound() => UnbindCount++;
}

internal sealed class SampleBinder : IUiSceneDocumentBinder<SampleScene>
{
    public void Bind(IUiDocument document, SampleScene scene)
    {
        _ = document;
        scene.OnBound();
    }

    public void Unbind(IUiDocument document, SampleScene scene)
    {
        _ = document;
        scene.OnUnbound();
    }
}

internal sealed class SampleEditorHost : IUiEditorDocumentHost
{
    private readonly StubDocument _document = new();

    public bool TryOpen(string path, out IUiDocument? document)
    {
        _ = path;
        document = _document;
        return true;
    }

    public bool TrySave(IUiDocument document, string path)
    {
        _ = document;
        _ = path;
        return true;
    }

    public bool TryReload(UiDocumentId document, out IUiDocument? reloaded)
    {
        _ = document;
        reloaded = _document;
        return true;
    }
}
