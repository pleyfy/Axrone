namespace Axrone.Tween.Tests;

using Axrone.Numeric;

public class TweenWaypointTests
{
    private static readonly Vec4 P0 = new(0.0f, 0.0f, 0.0f, 0.0f);
    private static readonly Vec4 P1 = new(10.0f, 0.0f, 0.0f, 0.0f);
    private static readonly Vec4 P2 = new(10.0f, 10.0f, 0.0f, 0.0f);
    private static readonly Vec4 P3 = new(0.0f, 10.0f, 0.0f, 0.0f);

    [Fact]
    public void Linear_MidpointsAndEndpoints()
    {
        var path = new WaypointPath(WaypointMode.Linear, P0, P1, P2);
        path.Sample(0.0f).Should().Be(P0);
        path.Sample(1.0f).Should().Be(P2);
        path.Sample(0.25f).Should().Be(new Vec4(5.0f, 0.0f, 0.0f, 0.0f));
        path.Sample(0.75f).Should().Be(new Vec4(10.0f, 5.0f, 0.0f, 0.0f));
    }

    [Fact]
    public void Step_HoldsPoints()
    {
        var path = new WaypointPath(WaypointMode.Step, P0, P1, P2);
        path.Sample(0.0f).Should().Be(P0);
        path.Sample(0.32f).Should().Be(P0);
        path.Sample(0.5f).Should().Be(P1);
        path.Sample(1.0f).Should().Be(P2);
    }

    [Fact]
    public void Smoothstep_HasCalmEndsAndExactMidpoint()
    {
        var path = new WaypointPath(WaypointMode.Smoothstep, P0, P1);
        path.Sample(0.0f).Should().Be(P0);
        path.Sample(1.0f).Should().Be(P1);
        path.Sample(0.5f).Should().Be(new Vec4(5.0f, 0.0f, 0.0f, 0.0f));
        float near = path.Sample(0.1f).X;
        near.Should().BeLessThan(1.0f);
    }

    [Fact]
    public void Bezier_HitsQuadraticMidpointAndEndpoints()
    {
        var path = new WaypointPath(WaypointMode.Bezier, P0, P1, P2);
        path.Sample(0.0f).Should().Be(P0);
        path.Sample(1.0f).Should().Be(P2);
        Vec4 mid = path.Sample(0.5f);
        mid.X.Should().BeApproximately(7.5f, 1e-5f);
        mid.Y.Should().BeApproximately(2.5f, 1e-5f);
    }

    [Fact]
    public void CatmullRom_PassesThroughEveryKnot()
    {
        var path = new WaypointPath(WaypointMode.CatmullRom, P0, P1, P2, P3);
        path.Sample(0.0f).Should().Be(P0);
        path.Sample(1.0f / 3.0f).X.Should().BeApproximately(P1.X, 1e-4f);
        path.Sample(2.0f / 3.0f).Should().Be(new Vec4(P2.X, P2.Y, P2.Z, P2.W));
        path.Sample(1.0f).Should().Be(P3);
    }

    [Fact]
    public void CatmullRom_ClosedLoopStaysInBounds()
    {
        var path = new WaypointPath(WaypointMode.CatmullRom, P0, P1, P2, P3, P0);
        for (int i = 0; i <= 40; i++)
        {
            Vec4 sample = path.Sample(i / 40.0f);
            sample.X.Should().BeInRange(-2.0f, 12.0f);
            sample.Y.Should().BeInRange(-2.0f, 12.0f);
        }
    }

    [Fact]
    public void BadPaths_Throw()
    {
        Action single = () => { _ = new WaypointPath(WaypointMode.Linear, P0); };
        single.Should().Throw<ArgumentOutOfRangeException>();
        Action none = () => { _ = new WaypointPath(WaypointMode.Linear, Array.Empty<Vec4>()); };
        none.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Waypoints_PlayThroughEngine()
    {
        var clock = new ManualTweenClock();
        using var engine = new TweenEngine(16, clock);
        var path = new WaypointPath(WaypointMode.Linear, P0, P1, P2);
        var visited = new List<Vec4>();
        var progress = new List<float>();
        TweenSpec spec = new TweenBuilder()
            .DurationSeconds(1.0f)
            .OnUpdate(progress.Add)
            .Waypoints(path, visited.Add)
            .Build();

        _ = engine.Play(spec);
        for (int i = 0; i < 4; i++)
        {
            clock.Advance(DurationNs.FromSeconds(0.25f));
            engine.Update();
        }

        visited.Should().HaveCount(4);
        visited[^1].Should().Be(P2);
        visited.Should().Contain(v => v == new Vec4(5.0f, 0.0f, 0.0f, 0.0f));
        progress.Should().Equal(0.25f, 0.5f, 0.75f, 1.0f);
        engine.ActiveCount.Should().Be(0);
    }
}
