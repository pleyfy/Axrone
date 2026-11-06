namespace Axrone.Ui.Assets.Tests;

using System.Buffers;
using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiZeroAllocationTests
{
    private const int OpsPerWindow = 64;
    private const int PrimeWindows = 3;

    [Fact]
    public void WarmReadsDoNotAllocate()
    {
        byte[] bytes = Encode(UiTestDocuments.CreateSample());
        using var codec = new UiDocumentJsonCodec();

        bool succeeded = true;
        var readWindow = new Action(() =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
                succeeded &= codec.TryRead(bytes, out IUiDocument? document, out _);
                succeeded &= document is UiAssetDocument;
            }
        });
        Action noopWindow = () =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
            }
        };
        Action readPhase = () =>
        {
            for (int i = 0; i < OpsPerWindow / 2; i++)
            {
                _ = codec.TryRead(bytes, out _, out _);
            }
        };

        UiAssetsAllocationHarness.Outcome outcome = UiAssetsAllocationHarness.AssertEveryWindowClean(
            readWindow,
            betweenWindows: null,
            UiAssetsAllocationHarness.Windows,
            PrimeWindows,
            label: "document json read",
            diagnostics:
            [
                new UiAssetsGatePhase("read-loop", readPhase),
                new UiAssetsGatePhase("noop-control", noopWindow),
            ]);

        outcome.MeasuredWindows.Should().Be(UiAssetsAllocationHarness.Windows);
        succeeded.Should().BeTrue();
    }

    // The write path is mode-agnostic: UiDocumentJsonCodec.Write never reads
    // _reuseStorage (only TryRead branches on it), and the class contract promises
    // warm writes allocate zero bytes in both modes. The reuseStorage:false codec
    // here therefore measures the same writer the default mode exposes; the false
    // mode's documented per-read allocation is pinned separately in
    // IndependentReadModeAllocatesPerRead.
    [Fact]
    public void WarmWritesDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        var buffer = new ArrayBufferWriter<byte>(4096);
        codec.Write(document, buffer);
        int baseline = buffer.WrittenCount;

        var writeWindow = new Action(() =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
                buffer.Clear();
                codec.Write(document, buffer);
            }
        });
        Action noopWindow = () =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
            }
        };
        Action writePhase = () =>
        {
            for (int i = 0; i < OpsPerWindow / 2; i++)
            {
                buffer.Clear();
                codec.Write(document, buffer);
            }
        };

        UiAssetsAllocationHarness.Outcome outcome = UiAssetsAllocationHarness.AssertEveryWindowClean(
            writeWindow,
            betweenWindows: null,
            UiAssetsAllocationHarness.Windows,
            PrimeWindows,
            label: "document json write",
            diagnostics:
            [
                new UiAssetsGatePhase("write-loop", writePhase),
                new UiAssetsGatePhase("noop-control", noopWindow),
            ]);

        outcome.MeasuredWindows.Should().Be(UiAssetsAllocationHarness.Windows);
        baseline.Should().BeGreaterThan(0);
        buffer.WrittenCount.Should().Be(baseline);
    }

    [Fact]
    public void BindingLookupsDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        UiBindingTable bindings = document.Bindings;

        bool found = true;
        var lookupWindow = new Action(() =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
                found &= bindings.TryGet("title".AsSpan(), out UiBindingValue value);
                found &= value.Kind == UiBindingValueKind.Text;
                found &= bindings.TryGetString("title".AsSpan(), out ReadOnlySpan<byte> text);
                found &= !text.IsEmpty;
                found &= bindings.TryGet("score".AsSpan(), out UiBindingValue score);
                found &= score.Number == 42.0;
            }
        });
        Action noopWindow = () =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
            }
        };
        Action lookupPhase = () =>
        {
            for (int i = 0; i < OpsPerWindow / 2; i++)
            {
                found &= bindings.TryGet("title".AsSpan(), out _);
            }
        };

        UiAssetsAllocationHarness.Outcome outcome = UiAssetsAllocationHarness.AssertEveryWindowClean(
            lookupWindow,
            betweenWindows: null,
            UiAssetsAllocationHarness.Windows,
            PrimeWindows,
            label: "binding lookup",
            diagnostics:
            [
                new UiAssetsGatePhase("lookup-loop", lookupPhase),
                new UiAssetsGatePhase("noop-control", noopWindow),
            ]);

        outcome.MeasuredWindows.Should().Be(UiAssetsAllocationHarness.Windows);
        found.Should().BeTrue();
    }

    [Fact]
    public void PayloadSpanAccessorsDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        var panel = new UiNodeId(2);
        var label = new UiNodeId(3);
        var icon = new UiNodeId(4);

        bool found = true;
        var accessorWindow = new Action(() =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
                found &= document.TryGetRoleUtf8(panel, out ReadOnlySpan<byte> role);
                found &= !role.IsEmpty;
                found &= document.TryGetTextValueUtf8(label, out ReadOnlySpan<byte> text);
                found &= !text.IsEmpty;
                found &= document.TryGetImageResourceUtf8(icon, out ReadOnlySpan<byte> resource);
                found &= !resource.IsEmpty;
                found &= document.TryGetLayout(label, out UiLayoutStyle layout);
                found &= layout.Equals(UiLayoutStyle.Default);
            }
        });
        Action noopWindow = () =>
        {
            for (int i = 0; i < OpsPerWindow; i++)
            {
            }
        };
        Action accessorPhase = () =>
        {
            for (int i = 0; i < OpsPerWindow / 2; i++)
            {
                found &= document.TryGetRoleUtf8(panel, out _);
            }
        };

        UiAssetsAllocationHarness.Outcome outcome = UiAssetsAllocationHarness.AssertEveryWindowClean(
            accessorWindow,
            betweenWindows: null,
            UiAssetsAllocationHarness.Windows,
            PrimeWindows,
            label: "payload span accessor",
            diagnostics:
            [
                new UiAssetsGatePhase("accessor-loop", accessorPhase),
                new UiAssetsGatePhase("noop-control", noopWindow),
            ]);

        outcome.MeasuredWindows.Should().Be(UiAssetsAllocationHarness.Windows);
        found.Should().BeTrue();
    }

    // Positive counterpart of the zero-gate: reuseStorage:false is the independent-document
    // mode of TryRead (UiDocumentJsonCodec.cs allocates fresh storage, reader and document per
    // read), so a warm read window there must allocate. This pins the mode contract the
    // zero-allocation promise deliberately does not cover.
    [Fact]
    public void IndependentReadModeAllocatesPerRead()
    {
        byte[] bytes = Encode(UiTestDocuments.CreateSample());
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        for (int i = 0; i < OpsPerWindow; i++)
        {
            _ = codec.TryRead(bytes, out _, out _);
        }

        _ = codec.TryRead(bytes, out IUiDocument? first, out _);
        _ = codec.TryRead(bytes, out IUiDocument? second, out _);
        first.Should().NotBeNull();
        ReferenceEquals(first, second).Should().BeFalse("false mode promises independent documents");

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < OpsPerWindow; i++)
        {
            _ = codec.TryRead(bytes, out _, out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().BeGreaterThan(0, "independent reads allocate fresh storage per payload");
    }

    [Fact]
    public void RepeatedWritesAreByteIdentical()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        var buffer = new ArrayBufferWriter<byte>(4096);

        codec.Write(document, buffer);
        byte[] reference = buffer.WrittenSpan.ToArray();

        for (int i = 0; i < 8; i++)
        {
            buffer.Clear();
            codec.Write(document, buffer);
            buffer.WrittenSpan.SequenceEqual(reference).Should().BeTrue();
        }
    }

    private static byte[] Encode(IUiDocument document)
    {
        var buffer = new ArrayBufferWriter<byte>(1024);
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        codec.Write(document, buffer);
        return buffer.WrittenSpan.ToArray();
    }
}
