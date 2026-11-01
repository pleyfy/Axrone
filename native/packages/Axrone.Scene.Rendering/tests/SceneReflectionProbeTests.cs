namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneReflectionProbeTests
{
    private static SceneReflectionProbe Probe(string cubemap, int priority = 0, Vec3? extents = null)
    {
        SceneReflectionProbe probe = SceneReflectionProbe.Default;
        probe.CubemapId = SceneAssetId<TextureAssetTag>.FromName(cubemap);
        probe.Priority = priority;
        probe.Extents = extents ?? Vec3.One;
        return probe;
    }

    [Fact]
    public void OrdersByPriorityAndSelectsContainingProbe()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.ReflectionProbe);

        SceneActor low = world.CreateActor("Low");
        world.AddData(low, Probe("cubemap/low", priority: 0));

        SceneActor high = world.CreateActor("High");
        world.GetTransform3D(high).SetPosition(new Vec3(5, 0, 0));
        world.AddData(high, Probe("cubemap/high", priority: 10));
        world.UpdateTransforms();

        var collector = new SceneReflectionProbeCollector();
        collector.Collect(world, Vec3.Zero).Should().Be(2);

        collector.Items[0].Actor.Should().Be(high);
        collector.Items[1].Actor.Should().Be(low);
        collector.SelectedIndex.Should().Be(1);
        collector.TryGetSelected(out SceneReflectionProbeRenderItem selected).Should().BeTrue();
        selected.Actor.Should().Be(low);
        selected.ContainsCamera.Should().BeTrue();
    }

    [Fact]
    public void ContainmentUsesTransformedWorldVolume()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.ReflectionProbe);
        SceneActor actor = world.CreateActor("Probe");
        world.GetTransform3D(actor).SetPosition(new Vec3(2, 0, 0));
        world.AddData(actor, Probe("cubemap/room", extents: new Vec3(1, 1, 1)));
        world.UpdateTransforms();

        var collector = new SceneReflectionProbeCollector();

        collector.Collect(world, new Vec3(2.5f, 0, 0));
        collector.Items[0].ContainsCamera.Should().BeTrue();

        collector.Collect(world, new Vec3(4.0f, 0, 0));
        collector.Items[0].ContainsCamera.Should().BeFalse();
        collector.SelectedIndex.Should().Be(-1);
    }

    [Fact]
    public void DisabledAndMalformedProbesAreSkipped()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.ReflectionProbe);

        SceneReflectionProbe disabled = Probe("cubemap/disabled");
        disabled.Enabled = false;
        SceneActor disabledActor = world.CreateActor("Disabled");
        world.AddData(disabledActor, disabled);

        SceneActor missingCubemap = world.CreateActor("Missing");
        SceneReflectionProbe missing = Probe("cubemap/missing");
        missing.CubemapId = default;
        world.AddData(missingCubemap, missing);

        SceneActor flat = world.CreateActor("Flat");
        world.AddData(flat, Probe("cubemap/flat", extents: new Vec3(1, 0, 1)));

        var collector = new SceneReflectionProbeCollector();
        collector.Collect(world, Vec3.Zero).Should().Be(0);
        collector.SelectedIndex.Should().Be(-1);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.ReflectionProbe);
        for (int i = 0; i < 8; i++)
        {
            SceneActor actor = world.CreateActor($"Probe{i}");
            world.GetTransform3D(actor).SetPosition(new Vec3(i, 0, 0));
            world.AddData(actor, Probe($"cubemap/{i}", priority: i % 3));
        }

        world.UpdateTransforms();
        var collector = new SceneReflectionProbeCollector();
        collector.Collect(world, Vec3.Zero);
        collector.Collect(world, Vec3.Zero);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, Vec3.Zero);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(8);
        delta.Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsProbeFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<TextureAssetTag> cubemap = assets.CreateId<TextureAssetTag>("cubemap/studio");
        var codec = new SceneReflectionProbeCodec(assets.Names);

        var value = new SceneReflectionProbe
        {
            CubemapId = cubemap,
            LocalCenter = new Vec3(1, 2, 3),
            Extents = new Vec3(4, 5, 6),
            Intensity = 1.5f,
            Priority = 3,
            Enabled = false
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneReflectionProbe restored = codec.Read(payload);

        payload.GetProperty("cubemap").GetString().Should().Be("cubemap/studio");
        restored.CubemapId.Should().Be(cubemap);
        restored.LocalCenter.Should().Be(new Vec3(1, 2, 3));
        restored.Extents.Should().Be(new Vec3(4, 5, 6));
        restored.Intensity.Should().BeApproximately(1.5f, 1e-6f);
        restored.Priority.Should().Be(3);
        restored.Enabled.Should().BeFalse();
    }

    [Fact]
    public void CodecDefaultsWhenPayloadIsSparse()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneReflectionProbeCodec(assets.Names);

        SceneReflectionProbe restored = codec.Read(JsonCapture.Capture(static _ => { }));

        restored.Enabled.Should().BeTrue();
        restored.Extents.Should().Be(Vec3.One);
        restored.Intensity.Should().Be(1.0f);
    }
}
