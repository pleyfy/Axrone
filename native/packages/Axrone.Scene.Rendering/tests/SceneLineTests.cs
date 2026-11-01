namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneLineTests
{
    private static SceneLineRenderer Line(uint polylineId, bool loop = false, int layer = 0, int order = 0)
    {
        SceneLineRenderer line = SceneLineRenderer.Default;
        line.PolylineId = polylineId;
        line.Loop = loop;
        line.SortingLayer = layer;
        line.RenderOrder = order;
        line.Width = 0.1f;
        return line;
    }

    [Fact]
    public void CollectorExpandsPolylineIntoWorldSegments()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Line);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var polylines = new ScenePolylineRegistry();
        polylines.Register(1, [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(1, 1, 0)]);

        SceneActor actor = world.CreateActor("Line");
        world.GetTransform3D(actor).SetPosition(new Vec3(2.0f, 0.0f, 0.0f));
        world.AddData(actor, Line(1));
        world.UpdateTransforms();

        var collector = new SceneLineItemCollector();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);

        count.Should().Be(2);
        collector.Items[0].Start.Should().Be(new Vec3(2.0f, 0.0f, 0.0f));
        collector.Items[0].End.Should().Be(new Vec3(3.0f, 0.0f, 0.0f));
        collector.Items[1].End.Should().Be(new Vec3(3.0f, 1.0f, 0.0f));
        collector.Items[0].Sequence.Should().Be(0);
    }

    [Fact]
    public void LoopClosesThePolyline()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Line);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var polylines = new ScenePolylineRegistry();
        polylines.Register(2, [new Vec3(0, 0, 0), new Vec3(1, 0, 0), new Vec3(1, 1, 0)]);

        SceneActor actor = world.CreateActor("Loop");
        world.AddData(actor, Line(2, loop: true));
        world.UpdateTransforms();

        var collector = new SceneLineItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);

        collector.Count.Should().Be(3);
        collector.Items[2].End.Should().Be(new Vec3(0.0f, 0.0f, 0.0f));
    }

    [Fact]
    public void MissingPolylineAndDisabledRendererAreSkipped()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Line);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var polylines = new ScenePolylineRegistry();
        polylines.Register(3, [new Vec3(0, 0, 0), new Vec3(1, 0, 0)]);

        SceneActor missing = world.CreateActor("Missing");
        world.AddData(missing, Line(99));

        SceneLineRenderer disabled = Line(3);
        disabled.Enabled = false;
        SceneActor disabledActor = world.CreateActor("Disabled");
        world.AddData(disabledActor, disabled);

        var collector = new SceneLineItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, polylines).Should().Be(0);
    }

    [Fact]
    public void SegmentsBehindCameraAreCulled()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Line);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var polylines = new ScenePolylineRegistry();
        polylines.Register(4, [new Vec3(0, 0, 20), new Vec3(1, 0, 20)]);

        SceneActor actor = world.CreateActor("Behind");
        world.AddData(actor, Line(4));
        world.UpdateTransforms();

        var collector = new SceneLineItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);

        collector.Count.Should().Be(0);
        collector.CulledCount.Should().Be(1);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Line);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 1280, 720)!;

        var polylines = new ScenePolylineRegistry();
        var points = new Vec3[16];
        for (int i = 0; i < points.Length; i++)
        {
            points[i] = new Vec3(i * 0.1f, 0.0f, 0.0f);
        }

        polylines.Register(5, points);
        SceneActor actor = world.CreateActor("Line");
        world.AddData(actor, Line(5));
        world.UpdateTransforms();

        var collector = new SceneLineItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);
        collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, polylines);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(15);
        delta.Should().Be(0);
    }

    [Fact]
    public void RegistryRejectsZeroIdAndRemovesEntries()
    {
        var polylines = new ScenePolylineRegistry();

        Action register = () => polylines.Register(0, [Vec3.Zero, Vec3.UnitX]);

        register.Should().Throw<SceneConfigurationException>();
        polylines.Register(1, [Vec3.Zero, Vec3.UnitX]);
        polylines.Count.Should().Be(1);
        polylines.TryGetPoints(1, out ReadOnlySpan<Vec3> points).Should().BeTrue();
        points.Length.Should().Be(2);
        polylines.Remove(1).Should().BeTrue();
        polylines.Remove(1).Should().BeFalse();
        polylines.TryGetPoints(1, out _).Should().BeFalse();
    }

    [Fact]
    public void GeometryBuildsCameraFacingCorners()
    {
        Span<Vec3> corners = stackalloc Vec3[4];

        int count = SceneLineGeometry.BuildRibbon(
            new Vec3(0.0f, 0.0f, 0.0f),
            new Vec3(1.0f, 0.0f, 0.0f),
            width: 0.5f,
            viewDirection: Vec3.UnitZ,
            SceneLineCap.Butt,
            corners);

        count.Should().Be(4);
        corners[0].X.Should().Be(0.0f);
        corners[2].X.Should().Be(1.0f);
        MathF.Abs(corners[1].Y - corners[0].Y).Should().BeApproximately(0.5f, 1e-5f);
    }

    [Fact]
    public void SquareCapExtendsEndpoints()
    {
        Span<Vec3> corners = stackalloc Vec3[4];

        SceneLineGeometry.BuildRibbon(
            new Vec3(0.0f, 0.0f, 0.0f),
            new Vec3(1.0f, 0.0f, 0.0f),
            width: 0.5f,
            viewDirection: Vec3.UnitZ,
            SceneLineCap.Square,
            corners);

        corners[0].X.Should().BeApproximately(-0.25f, 1e-5f);
        corners[2].X.Should().BeApproximately(1.25f, 1e-5f);
    }

    [Fact]
    public void DegenerateGeometryReturnsZero()
    {
        Span<Vec3> corners = stackalloc Vec3[4];

        SceneLineGeometry.BuildRibbon(Vec3.Zero, Vec3.Zero, 1.0f, Vec3.UnitZ, SceneLineCap.Butt, corners)
            .Should().Be(0);
        SceneLineGeometry.BuildRibbon(Vec3.Zero, Vec3.UnitX, 0.0f, Vec3.UnitZ, SceneLineCap.Butt, corners)
            .Should().Be(0);
        SceneLineGeometry.BuildRibbon(Vec3.Zero, Vec3.UnitX, 1.0f, Vec3.UnitZ, SceneLineCap.Butt, stackalloc Vec3[3])
            .Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsLineFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/debug");
        var codec = new SceneLineRendererCodec(assets.Names);

        var value = new SceneLineRenderer
        {
            PolylineId = 42,
            PassId = pass,
            Enabled = true,
            Visible = false,
            Loop = true,
            Width = 0.125f,
            Color = new Vec4(0.2f, 0.4f, 0.6f, 0.8f),
            SortingLayer = 2,
            RenderOrder = 9,
            Depth = 1.5f,
            Cap = SceneLineCap.Round,
            Join = SceneLineJoin.Bevel
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneLineRenderer restored = codec.Read(payload);

        payload.GetProperty("polyline").GetInt32().Should().Be(42);
        payload.GetProperty("cap").GetString().Should().Be("round");
        restored.PolylineId.Should().Be(42);
        restored.PassId.Should().Be(pass);
        restored.Loop.Should().BeTrue();
        restored.Visible.Should().BeFalse();
        restored.Width.Should().BeApproximately(0.125f, 1e-6f);
        restored.Cap.Should().Be(SceneLineCap.Round);
        restored.Join.Should().Be(SceneLineJoin.Bevel);
    }

    [Fact]
    public void CodecRejectsUnknownCap()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneLineRendererCodec(assets.Names);
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("cap", "triangular"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }
}
