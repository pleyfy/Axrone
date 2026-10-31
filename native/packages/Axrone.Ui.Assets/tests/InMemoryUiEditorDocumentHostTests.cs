namespace Axrone.Ui.Assets.Tests;

using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class InMemoryUiEditorDocumentHostTests
{
    private const string MinimalJson =
        "{\"version\":1,\"id\":\"ui.min\",\"name\":\"Min\",\"canvas\":{\"referenceWidth\":1920,\"referenceHeight\":1080,\"scaleMode\":\"match-width\"},\"root\":{\"role\":\"root\"}}";

    [Fact]
    public void OpenReturnsCachedDocumentForUnknownPathAndInvalidPayload()
    {
        using var host = new InMemoryUiEditorDocumentHost();
        host.TryOpen("missing.ui.json", out IUiDocument? missing).Should().BeFalse();
        missing.Should().BeNull();

        host.AddFile("bad.ui.json", Encoding.UTF8.GetBytes("{\"version\":1}"));
        host.TryOpen("bad.ui.json", out IUiDocument? invalid).Should().BeFalse();
        invalid.Should().BeNull();
    }

    [Fact]
    public void OpenDecodesOnceAndReloadShortCircuitsOnCrc()
    {
        int created = 0;
        using var host = new InMemoryUiEditorDocumentHost(() =>
        {
            created++;
            return new UiDocumentJsonCodec(reuseStorage: false);
        });

        host.AddFile("ui/main.ui.json", Encoding.UTF8.GetBytes(MinimalJson));
        created.Should().Be(0);

        host.TryOpen("ui/main.ui.json", out IUiDocument? first).Should().BeTrue();
        created.Should().Be(1);
        first!.Info.Name.Should().Be("Min");

        host.TryReload(first.Info.Id, out IUiDocument? reloaded).Should().BeTrue();
        reloaded.Should().BeSameAs(first);
        created.Should().Be(1);
    }

    [Fact]
    public void ReloadDetectsByteChangesAndKeepsIdentity()
    {
        int created = 0;
        using var host = new InMemoryUiEditorDocumentHost(() =>
        {
            created++;
            return new UiDocumentJsonCodec(reuseStorage: false);
        });

        host.AddFile("ui/main.ui.json", Encoding.UTF8.GetBytes(MinimalJson));
        host.TryOpen("ui/main.ui.json", out IUiDocument? first).Should().BeTrue();
        created.Should().Be(1);

        host.ReplaceFile("ui/main.ui.json", Encoding.UTF8.GetBytes(" " + MinimalJson)).Should().BeTrue();
        host.TryReload(first!.Info.Id, out IUiDocument? reloaded).Should().BeTrue();

        created.Should().Be(2);
        reloaded.Should().NotBeSameAs(first);
        reloaded!.Info.Id.Should().Be(first.Info.Id);
        reloaded.Info.Name.Should().Be("Min");
    }

    [Fact]
    public void ReloadFailsWhenIdentityChanges()
    {
        using var host = new InMemoryUiEditorDocumentHost();
        host.AddFile("ui/main.ui.json", Encoding.UTF8.GetBytes(MinimalJson));
        host.TryOpen("ui/main.ui.json", out IUiDocument? first).Should().BeTrue();

        host.ReplaceFile("ui/main.ui.json", Encoding.UTF8.GetBytes(MinimalJson.Replace("ui.min", "ui.changed", StringComparison.Ordinal)))
            .Should().BeTrue();

        host.TryReload(first!.Info.Id, out IUiDocument? reloaded).Should().BeFalse();
        reloaded.Should().BeNull();
    }

    [Fact]
    public void SaveWritesReadableDocument()
    {
        using var host = new InMemoryUiEditorDocumentHost();
        UiAssetDocument document = UiTestDocuments.CreateSample();

        host.TrySave(document, "ui/saved.ui.json").Should().BeTrue();
        host.TryOpen("ui/saved.ui.json", out IUiDocument? opened).Should().BeTrue();
        opened!.Info.Name.Should().Be("sample");
        opened.Nodes.Count.Should().Be(4);
    }

    [Fact]
    public void DuplicateDocumentIdsAreRejected()
    {
        using var host = new InMemoryUiEditorDocumentHost();
        host.AddFile("a.ui.json", Encoding.UTF8.GetBytes(MinimalJson));
        host.AddFile("b.ui.json", Encoding.UTF8.GetBytes(MinimalJson));

        host.TryOpen("a.ui.json", out _).Should().BeTrue();
        host.TryOpen("b.ui.json", out IUiDocument? duplicate).Should().BeFalse();
        duplicate.Should().BeNull();
    }

    [Fact]
    public void BomsAreAccepted()
    {
        using var host = new InMemoryUiEditorDocumentHost();
        byte[] payload = [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(MinimalJson)];
        host.AddFile("bom.ui.json", payload);

        host.TryOpen("bom.ui.json", out IUiDocument? document).Should().BeTrue();
        document!.Info.Name.Should().Be("Min");
    }

    [Fact]
    public void DisposeIsIdempotentAndTerminal()
    {
        var host = new InMemoryUiEditorDocumentHost();
        host.AddFile("ui/main.ui.json", Encoding.UTF8.GetBytes(MinimalJson));
        host.TryOpen("ui/main.ui.json", out _).Should().BeTrue();

        host.Dispose();
        host.Dispose();

        FluentActions.Invoking(() => host.TryOpen("ui/main.ui.json", out _))
            .Should().Throw<ObjectDisposedException>();
        FluentActions.Invoking(() => host.AddFile("x.ui.json", ReadOnlySpan<byte>.Empty))
            .Should().Throw<ObjectDisposedException>();
    }
}
