namespace Axrone.Ui.Assets.Tests;

using System.Buffers;
using System.Text;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiZeroAllocationTests
{
    private const int WarmupIterations = 16;
    private const int MeasuredIterations = 64;

    [Fact]
    public void WarmReadsDoNotAllocate()
    {
        byte[] bytes = Encode(UiTestDocuments.CreateSample());
        using var codec = new UiDocumentJsonCodec();

        for (int i = 0; i < WarmupIterations; i++)
        {
            _ = codec.TryRead(bytes, out _, out _);
        }

        bool succeeded = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            succeeded &= codec.TryRead(bytes, out IUiDocument? document, out _);
            succeeded &= document is UiAssetDocument;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        succeeded.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmWritesDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        using var codec = new UiDocumentJsonCodec(reuseStorage: false);
        var buffer = new ArrayBufferWriter<byte>(4096);

        for (int i = 0; i < WarmupIterations; i++)
        {
            buffer.Clear();
            codec.Write(document, buffer);
        }

        int baseline = buffer.WrittenCount;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            buffer.Clear();
            codec.Write(document, buffer);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        buffer.WrittenCount.Should().Be(baseline);
        baseline.Should().BeGreaterThan(0);
        allocated.Should().Be(0);
    }

    [Fact]
    public void BindingLookupsDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        UiBindingTable bindings = document.Bindings;

        for (int i = 0; i < WarmupIterations; i++)
        {
            _ = bindings.TryGet("title".AsSpan(), out _);
            _ = bindings.TryGetString("title".AsSpan(), out _);
        }

        bool found = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
        {
            found &= bindings.TryGet("title".AsSpan(), out UiBindingValue value);
            found &= value.Kind == UiBindingValueKind.Text;
            found &= bindings.TryGetString("title".AsSpan(), out ReadOnlySpan<byte> text);
            found &= !text.IsEmpty;
            found &= bindings.TryGet("score".AsSpan(), out UiBindingValue score);
            found &= score.Number == 42.0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        found.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void PayloadSpanAccessorsDoNotAllocate()
    {
        UiAssetDocument document = UiTestDocuments.CreateSample();
        var panel = new UiNodeId(2);
        var label = new UiNodeId(3);
        var icon = new UiNodeId(4);

        for (int i = 0; i < WarmupIterations; i++)
        {
            _ = document.TryGetRoleUtf8(panel, out _);
            _ = document.TryGetTextValueUtf8(label, out _);
            _ = document.TryGetImageResourceUtf8(icon, out _);
            _ = document.TryGetLayout(label, out UiLayoutStyle warmLayout);
            _ = warmLayout.Equals(UiLayoutStyle.Default);
        }

        bool found = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < MeasuredIterations; i++)
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

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        found.Should().BeTrue();
        allocated.Should().Be(0);
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
