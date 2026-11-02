namespace Axrone.Scene.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

public sealed class SceneSpriteBatchPlannerTests
{
    private static SceneSpriteRenderItem Item(string texture, string? material) => new()
    {
        TextureId = SceneAssetId<TextureAssetTag>.FromName(texture),
        MaterialId = material is null
            ? default
            : SceneAssetId<MaterialAssetTag>.FromName(material),
    };

    private static SceneSpriteRenderItem[] Fill(int count, string texture, string? material)
    {
        var items = new SceneSpriteRenderItem[count];
        for (int i = 0; i < count; i++)
        {
            items[i] = Item(texture, material);
        }

        return items;
    }

    [Fact]
    public void PlanGroupsByTextureAndMaterial()
    {
        var planner = new SceneSpriteBatchPlanner();
        SceneSpriteRenderItem[] items =
        [
            Item("texture/a", "material/one"),
            Item("texture/a", "material/one"),
            Item("texture/a", "material/two"),
            Item("texture/b", "material/two"),
        ];

        planner.Plan(items).Should().Be(3);
        ReadOnlySpan<SceneSpriteInstanceGroup> groups = planner.Groups;
        groups[0].FirstItem.Should().Be(0);
        groups[0].Count.Should().Be(2);
        groups[0].TextureId.Should().Be(SceneAssetId<TextureAssetTag>.FromName("texture/a"));
        groups[0].MaterialId.Should().Be(SceneAssetId<MaterialAssetTag>.FromName("material/one"));
        groups[1].FirstItem.Should().Be(2);
        groups[1].Count.Should().Be(1);
        groups[1].MaterialId.Should().Be(SceneAssetId<MaterialAssetTag>.FromName("material/two"));
        groups[2].FirstItem.Should().Be(3);
        groups[2].Count.Should().Be(1);
    }

    [Fact]
    public void DefaultMaterialKeepsTextureOnlyGrouping()
    {
        var planner = new SceneSpriteBatchPlanner();
        SceneSpriteRenderItem[] items =
        [
            Item("texture/a", null),
            Item("texture/a", null),
            Item("texture/a", null),
        ];

        planner.Plan(items).Should().Be(1);
        planner.Groups[0].MaterialId.Should().Be(default(SceneAssetId<MaterialAssetTag>));
    }

    [Fact]
    public void ThresholdBoundaryIsDeterministic()
    {
        var planner = new SceneSpriteBatchPlanner(8, minInstancesForFastPath: 4);
        planner.Plan(Fill(4, "texture/a", "material/one")).Should().Be(1);
        planner.Groups[0].Instanced.Should().BeTrue();

        planner.Plan(Fill(3, "texture/a", "material/one")).Should().Be(1);
        planner.Groups[0].Instanced.Should().BeFalse();
        planner.InstancedGroupCount.Should().Be(0);
    }

    [Fact]
    public void PlanIsStableAcrossRepeatedRuns()
    {
        var planner = new SceneSpriteBatchPlanner();
        SceneSpriteRenderItem[] items =
        [
            Item("texture/a", "material/one"),
            Item("texture/a", "material/one"),
            Item("texture/b", null),
            Item("texture/b", null),
        ];

        planner.Plan(items).Should().Be(2);
        var first = planner.Groups.ToArray();
        planner.Plan(items).Should().Be(2);
        planner.Groups.ToArray().Should().Equal(first);
    }

    [Fact]
    public void PlanningDoesNotAllocateAfterWarmup()
    {
        var planner = new SceneSpriteBatchPlanner();
        SceneSpriteRenderItem[] items = Fill(256, "texture/a", "material/one");
        for (int warmup = 0; warmup < 128; warmup++)
        {
            _ = planner.Plan(items);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int groups = 0;
        for (int round = 0; round < 2000; round++)
        {
            groups += planner.Plan(items);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        groups.Should().Be(2000);
    }

    [Fact]
    public void InvalidConfigurationIsRejected()
    {
        FluentActions.Invoking(static () => _ = new SceneSpriteBatchPlanner(0)).Should().Throw<SceneConfigurationException>();
        FluentActions.Invoking(static () => _ = new SceneSpriteBatchPlanner(8, 0)).Should().Throw<SceneConfigurationException>();
    }

    [Fact]
    public void PlanGrowsForManyRuns()
    {
        var planner = new SceneSpriteBatchPlanner(4);
        var items = new SceneSpriteRenderItem[200];
        for (int i = 0; i < items.Length; i++)
        {
            items[i] = Item(i % 2 == 0 ? "texture/a" : "texture/b", null);
        }

        planner.Plan(items).Should().Be(200);
        planner.Count.Should().Be(200);
    }
}

