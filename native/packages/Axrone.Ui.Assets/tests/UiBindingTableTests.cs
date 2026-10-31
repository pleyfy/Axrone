namespace Axrone.Ui.Assets.Tests;

using FluentAssertions;
using Xunit;

public sealed class UiBindingTableTests
{
    [Fact]
    public void BuildSortsNamesOrdinallyAndResolvesValues()
    {
        UiBindingTableBuilder builder = new();
        builder.SetString("zeta", "last");
        builder.SetNumber("alpha", 1.5);
        builder.SetBoolean("middle", true);
        builder.SetNull("omega");

        UiBindingTable table = builder.Build();

        table.Count.Should().Be(4);
        table.TryGetAt(0, out ReadOnlySpan<byte> firstName, out _, out _).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(firstName).Should().Be("alpha");
        table.TryGetAt(3, out ReadOnlySpan<byte> lastName, out _, out _).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(lastName).Should().Be("zeta");

        table.TryGet("alpha".AsSpan(), out UiBindingValue alpha).Should().BeTrue();
        alpha.Kind.Should().Be(UiBindingValueKind.Numeric);
        alpha.Number.Should().Be(1.5);

        table.TryGet("middle".AsSpan(), out UiBindingValue middle).Should().BeTrue();
        middle.Kind.Should().Be(UiBindingValueKind.Flag);
        middle.Boolean.Should().BeTrue();

        table.TryGet("omega".AsSpan(), out UiBindingValue omega).Should().BeTrue();
        omega.Kind.Should().Be(UiBindingValueKind.Null);

        table.TryGetString("zeta".AsSpan(), out ReadOnlySpan<byte> text).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(text).Should().Be("last");
    }

    [Fact]
    public void StringLookupFailsForNonStringValues()
    {
        UiBindingTableBuilder builder = new();
        builder.SetNumber("n", 3.0);
        UiBindingTable table = builder.Build();

        table.TryGetString("n".AsSpan(), out ReadOnlySpan<byte> text).Should().BeFalse();
        text.IsEmpty.Should().BeTrue();
    }

    [Fact]
    public void DuplicateSetReplacesInsteadOfAdding()
    {
        UiBindingTableBuilder builder = new();
        builder.SetString("name", "first");
        builder.SetString("name", "second");
        builder.SetNumber("name", 9.0);

        UiBindingTable table = builder.Build();

        table.Count.Should().Be(1);
        table.TryGet("name".AsSpan(), out UiBindingValue value).Should().BeTrue();
        value.Kind.Should().Be(UiBindingValueKind.Numeric);
        value.Number.Should().Be(9.0);
    }

    [Fact]
    public void MissingAndEmptyNamesReturnFalse()
    {
        UiBindingTableBuilder builder = new();
        builder.SetBoolean("flag", false);
        UiBindingTable table = builder.Build();

        table.TryGet("missing".AsSpan(), out _).Should().BeFalse();
        table.TryGet(ReadOnlySpan<char>.Empty, out _).Should().BeFalse();
        table.TryGetString("missing".AsSpan(), out _).Should().BeFalse();
        table.TryGetAt(5, out _, out _, out _).Should().BeFalse();
    }

    [Fact]
    public void BuilderRejectsInvalidInput()
    {
        UiBindingTableBuilder builder = new();

        builder.Invoking(static b => b.SetString(string.Empty, "x")).Should().Throw<ArgumentException>();
        builder.Invoking(static b => b.SetString("x", null!)).Should().Throw<ArgumentNullException>();
        builder.Invoking(static b => b.SetNumber("x", double.NaN)).Should().Throw<ArgumentOutOfRangeException>();
        builder.Invoking(static b => b.SetNumber("x", double.PositiveInfinity)).Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void LongNamesUsePooledLookupPath()
    {
        string name = new string('k', 600);
        UiBindingTableBuilder builder = new();
        builder.SetString(name, "value");
        UiBindingTable table = builder.Build();

        table.TryGet(name.AsSpan(), out UiBindingValue value).Should().BeTrue();
        value.Kind.Should().Be(UiBindingValueKind.Text);
        table.TryGetString(name.AsSpan(), out ReadOnlySpan<byte> text).Should().BeTrue();
        System.Text.Encoding.UTF8.GetString(text).Should().Be("value");
    }
}
