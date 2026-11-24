namespace Axrone.Utility.Tests;

using Axrone.Utility.Identifiers;
using FluentAssertions;
using Xunit;

public sealed class StrongIdTests
{
    private readonly struct EntityTag : IIdentifierTag<EntityTag>
    {
        public static string TagName => "Entity";
        public static string Prefix => "a";
        public static bool IsOneBased => true;
    }

    private readonly struct SlotTag : IIdentifierTag<SlotTag>
    {
        public static string TagName => "Slot";
        public static string Prefix => "s";
        public static bool IsOneBased => false;
    }

    [Fact]
    public void OneBased_RoundTripsIndex()
    {
        var id = StrongId<EntityTag, uint>.FromIndex(4);

        id.RawValue.Should().Be(5u);
        id.IsValid.Should().BeTrue();
        id.ToIndex().Should().Be(4);
    }

    [Fact]
    public void ZeroBased_RoundTripsIndex()
    {
        var slot = StrongId<SlotTag, int>.FromIndex(4);

        slot.RawValue.Should().Be(4);
        slot.IsValid.Should().BeTrue();
        slot.ToIndex().Should().Be(4);
    }

    [Fact]
    public void Invalid_IsDistinguishablePerBase()
    {
        StrongId<EntityTag, uint>.Invalid.IsValid.Should().BeFalse();
        StrongId<EntityTag, uint>.Invalid.ToIndex().Should().Be(-1);

        StrongId<SlotTag, int>.Invalid.IsValid.Should().BeFalse();
        StrongId<SlotTag, int>.Invalid.RawValue.Should().Be(-1);
    }

    [Fact]
    public void FromIndex_RejectsNegative()
    {
        Action act = () => _ = StrongId<EntityTag, uint>.FromIndex(-1);

        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Ordering_FollowsRawValue()
    {
        var first = StrongId<EntityTag, uint>.FromRaw(2u);
        var second = StrongId<EntityTag, uint>.FromRaw(9u);

        (first < second).Should().BeTrue();
        (second > first).Should().BeTrue();
        first.CompareTo(second).Should().BeLessThan(0);
    }

    [Fact]
    public void SpanFormatting_WritesPrefixedValue()
    {
        var id = StrongId<EntityTag, uint>.FromRaw(12u);

        Span<char> buffer = stackalloc char[32];
        id.TryFormat(buffer, out int written).Should().BeTrue();
        buffer.Slice(0, written).ToString().Should().Be("a_12");
        id.ToString().Should().Be("a_12");

        Span<byte> utf8 = stackalloc byte[32];
        id.TryFormat(utf8, out int bytesWritten).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(utf8.Slice(0, bytesWritten)).Should().Be("a_12");
    }

    [Fact]
    public void SpanFormatting_RejectsShortDestination()
    {
        var id = StrongId<EntityTag, uint>.FromRaw(12u);

        Span<char> tiny = stackalloc char[2];
        id.TryFormat(tiny, out int written).Should().BeFalse();
        written.Should().Be(0);
    }
}
