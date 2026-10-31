namespace Axrone.Ui.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiMeasureCacheTests
{
    [Fact]
    public void ZeroKeyLookupsMiss()
    {
        UiMeasureCache cache = new();

        cache.TryGetInProgress(0).Should().BeFalse();
        cache.TryGetComplete(0, out UiMeasureResult result).Should().BeFalse();
        result.Should().Be(default(UiMeasureResult));
        cache.Count.Should().Be(0);
    }

    [Fact]
    public void ZeroKeyInsertsAreRejected()
    {
        UiMeasureCache cache = new();

        Action setInProgress = () => cache.SetInProgress(0);
        Action store = () => cache.Store(0, new UiMeasureResult(new UiSize(1.0f, 1.0f), 0.0f, false));

        setInProgress.Should().Throw<ArgumentOutOfRangeException>();
        store.Should().Throw<ArgumentOutOfRangeException>();
        cache.Count.Should().Be(0);
    }

    [Fact]
    public void EntriesTransitionFromInProgressToComplete()
    {
        UiMeasureCache cache = new();
        UiMeasureResult measured = new(new UiSize(10.0f, 20.0f), 3.0f, true);

        cache.SetInProgress(7);
        cache.TryGetInProgress(7).Should().BeTrue();
        cache.TryGetComplete(7, out _).Should().BeFalse();

        cache.Store(7, in measured);
        cache.TryGetInProgress(7).Should().BeFalse();
        cache.TryGetComplete(7, out UiMeasureResult stored).Should().BeTrue();
        stored.Size.Should().Be(new UiSize(10.0f, 20.0f));
        stored.Baseline.Should().Be(3.0f);
        stored.HasBaseline.Should().BeTrue();
        cache.Count.Should().Be(1);
    }

    [Fact]
    public void StoringTheSameKeyUpdatesInPlace()
    {
        UiMeasureCache cache = new();
        UiMeasureResult first = new(new UiSize(1.0f, 1.0f), 0.0f, false);
        UiMeasureResult second = new(new UiSize(2.0f, 2.0f), 1.0f, true);

        cache.SetInProgress(11);
        cache.Store(11, in first);
        cache.Store(11, in second);

        cache.Count.Should().Be(1);
        cache.TryGetComplete(11, out UiMeasureResult stored).Should().BeTrue();
        stored.Size.Should().Be(new UiSize(2.0f, 2.0f));
    }

    [Fact]
    public void GrowthPreservesEveryEntry()
    {
        UiMeasureCache cache = new();

        for (uint key = 1; key <= 200; key++)
        {
            cache.SetInProgress(key);
            UiMeasureResult measured = new(new UiSize(key, key * 2.0f), 0.0f, false);
            cache.Store(key, in measured);
        }

        cache.Count.Should().Be(200);
        for (uint key = 1; key <= 200; key++)
        {
            cache.TryGetComplete(key, out UiMeasureResult stored).Should().BeTrue();
            stored.Size.Width.Should().Be(key);
            stored.Size.Height.Should().Be(key * 2.0f);
        }
    }

    [Fact]
    public void ClearRemovesEveryEntry()
    {
        UiMeasureCache cache = new();
        for (uint key = 1; key <= 40; key++)
        {
            cache.SetInProgress(key);
            cache.Store(key, new UiMeasureResult(new UiSize(key, key), 0.0f, false));
        }

        cache.Clear();

        cache.Count.Should().Be(0);
        cache.TryGetComplete(1, out _).Should().BeFalse();
        cache.TryGetInProgress(1).Should().BeFalse();
    }

    [Fact]
    public void RepeatedPassesAreAllocationFree()
    {
        UiMeasureCache cache = new();
        UiMeasureResult measured = new(new UiSize(4.0f, 8.0f), 0.0f, false);

        for (int pass = 0; pass < 4; pass++)
        {
            for (uint key = 1; key <= 64; key++)
            {
                cache.SetInProgress(key);
                cache.Store(key, in measured);
            }

            cache.Clear();
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int pass = 0; pass < 100; pass++)
        {
            for (uint key = 1; key <= 64; key++)
            {
                cache.SetInProgress(key);
                cache.Store(key, in measured);
            }

            cache.Clear();
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        cache.Count.Should().Be(0);
    }

    [Fact]
    public void EngineRejectsInvalidNodeForMeasure()
    {
        FixedNodeTree tree = new();
        UiLayoutEngine engine = new();

        Action measure = () => engine.Measure(tree, UiNodeId.Invalid, UiMeasureConstraints.Unbounded);

        ArgumentException error = measure.Should().Throw<ArgumentException>().Which;
        error.ParamName.Should().Be("node");
        error.Message.Should().NotContain("cycle");
    }

    [Fact]
    public void EngineRejectsInvalidNodeForArrange()
    {
        FixedNodeTree tree = new();
        UiLayoutEngine engine = new();
        RecordingSink sink = new();

        Action arrange = () => engine.Arrange(tree, UiNodeId.Invalid, new Rect(0.0f, 0.0f, 10.0f, 10.0f), sink);

        arrange.Should().Throw<ArgumentException>().Which.ParamName.Should().Be("node");
    }

    [Fact]
    public void EngineRejectsInvalidChildIdentifier()
    {
        InvalidChildTree tree = new();
        UiLayoutEngine engine = new();

        Action measure = () => engine.Measure(tree, new UiNodeId(1), UiMeasureConstraints.Unbounded);

        ArgumentException error = measure.Should().Throw<ArgumentException>().Which;
        error.Message.Should().NotContain("cycle");
    }
}

internal sealed class FixedNodeTree : IUiLayoutTree
{
    public bool TryGetNode(UiNodeId id, out IUiLayoutNode? node)
    {
        node = new FixedNode(id);
        return true;
    }
}

internal sealed class FixedNode : IUiLayoutNode
{
    public FixedNode(UiNodeId id) => Id = id;

    public UiNodeId Id { get; }

    public UiLayoutStyle Style => UiLayoutStyle.Default;

    public ReadOnlySpan<UiNodeId> Children => ReadOnlySpan<UiNodeId>.Empty;

    public UiSize MeasureContent(in UiMeasureConstraints constraints)
    {
        _ = constraints;
        return new UiSize(10.0f, 10.0f);
    }
}

internal sealed class InvalidChildTree : IUiLayoutTree
{
    public bool TryGetNode(UiNodeId id, out IUiLayoutNode? node)
    {
        node = new InvalidChildNode(id);
        return true;
    }
}

internal sealed class InvalidChildNode : IUiLayoutNode
{
    public InvalidChildNode(UiNodeId id) => Id = id;

    public UiNodeId Id { get; }

    public UiLayoutStyle Style => UiLayoutStyle.Default;

    public ReadOnlySpan<UiNodeId> Children =>
        Id.Value == 1 ? new[] { UiNodeId.Invalid } : ReadOnlySpan<UiNodeId>.Empty;

    public UiSize MeasureContent(in UiMeasureConstraints constraints)
    {
        _ = constraints;
        return new UiSize(10.0f, 10.0f);
    }
}
