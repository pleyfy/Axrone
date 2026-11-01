namespace Axrone.Scene.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneRenderCacheTests
{
    private static SceneRenderCacheKey Key(ulong version, ulong settings = 0) =>
        new(version, SceneRenderPassIds.Main, settings);

    private static SceneRenderItem Item(int index) => new()
    {
        Actor = default,
        MeshId = SceneAssetId<MeshAssetTag>.FromName($"mesh/{index}"),
        MaterialId = SceneAssetId<MaterialAssetTag>.FromName("material/cache"),
        RenderOrder = index,
        DistanceSquared = index,
        Transparent = false,
        ReceiveLighting = true,
        HasBounds = false,
        WorldBounds = default
    };

    [Fact]
    public void StoreAndLookupRequireAnExactKey()
    {
        var cache = new SceneRenderCache<SceneRenderItem>();
        SceneRenderItem[] items = [Item(1), Item(2)];

        cache.IsValid.Should().BeFalse();
        cache.Store(Key(1), items);

        cache.IsValid.Should().BeTrue();
        cache.Count.Should().Be(2);
        cache.TryGet(Key(1), out ReadOnlySpan<SceneRenderItem> found).Should().BeTrue();
        found.Length.Should().Be(2);
        found[0].MeshId.Should().Be(items[0].MeshId);

        cache.TryGet(Key(2), out _).Should().BeFalse();
        cache.TryGet(Key(1, settings: 9), out _).Should().BeFalse();
    }

    [Fact]
    public void InvalidateForcesTheNextLookupToMiss()
    {
        var cache = new SceneRenderCache<SceneRenderItem>();
        cache.Store(Key(1), [Item(1)]);

        cache.Invalidate();

        cache.IsValid.Should().BeFalse();
        cache.Count.Should().Be(0);
        cache.TryGet(Key(1), out _).Should().BeFalse();
    }

    [Fact]
    public void StoreCopiesTheSpan()
    {
        var cache = new SceneRenderCache<SceneRenderItem>();
        SceneRenderItem[] items = [Item(1), Item(2), Item(3)];
        cache.Store(Key(1), items);

        items[0] = Item(99);

        cache.TryGet(Key(1), out ReadOnlySpan<SceneRenderItem> found).Should().BeTrue();
        found[0].MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/1"));
    }

    [Fact]
    public void CapacityIsRetainedAcrossShrinkingStores()
    {
        var cache = new SceneRenderCache<SceneRenderItem>();
        SceneRenderItem[] large = new SceneRenderItem[32];
        for (int i = 0; i < large.Length; i++)
        {
            large[i] = Item(i);
        }

        cache.Store(Key(1), large);
        cache.Store(Key(2), large.AsSpan(0, 4));

        cache.TryGet(Key(2), out ReadOnlySpan<SceneRenderItem> found).Should().BeTrue();
        found.Length.Should().Be(4);

        cache.Store(Key(3), large);
        cache.Count.Should().Be(32);
    }

    [Fact]
    public void StoreAndLookupAreZeroAllocationAtSteadyCapacity()
    {
        var cache = new SceneRenderCache<SceneRenderItem>();
        SceneRenderItem[] items = new SceneRenderItem[16];
        for (int i = 0; i < items.Length; i++)
        {
            items[i] = Item(i);
        }

        cache.Store(Key(1), items);
        cache.TryGet(Key(1), out _);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            cache.Store(Key(1), items);
            if (!cache.TryGet(Key(1), out ReadOnlySpan<SceneRenderItem> found) || found.Length != 16)
            {
                throw new InvalidOperationException("Cache lookup failed.");
            }
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void PassDefinitionsCanBeCachedToo()
    {
        var cache = new SceneRenderCache<SceneRenderPassDefinition>();
        var pass = new SceneRenderPassDefinition(
            SceneRenderPassIds.Main,
            clearMask: SceneClearMask.Color,
            clearColor: Vec4.One,
            depthTest: false,
            blend: true);
        cache.Store(Key(1), [pass]);

        cache.TryGet(Key(1), out ReadOnlySpan<SceneRenderPassDefinition> found).Should().BeTrue();
        found[0].Id.Should().Be(SceneRenderPassIds.Main);
        found[0].Blend.Should().BeTrue();
    }
}
