namespace Axrone.Scene.Runtime.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class ScenePathAgentBridgeTests
{
    [Fact]
    public void SetPathMovesAgentTowardFirstWaypoint()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 5.0f, loop: true, waypoints: new[]
        {
            new Vec3(5.0f, 0.0f, 0.0f),
            new Vec3(5.0f, 0.0f, 5.0f),
        });

        bridge.Step(0.2f);

        world.GetData<SceneTransform3D>(actor).Position.X.Should().BeApproximately(1.0f, 0.001f);
        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Moving);
        state.WaypointIndex.Should().Be(0);
        state.WaypointCount.Should().Be(2);
    }

    [Fact]
    public void ArrivalAdvancesToNextWaypoint()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 10.0f, loop: true, waypoints: new[]
        {
            new Vec3(1.0f, 0.0f, 0.0f),
            new Vec3(2.0f, 0.0f, 0.0f),
        });

        bridge.Step(0.2f);
        world.GetData<SceneTransform3D>(actor).Position.X.Should().BeApproximately(1.0f, 0.001f);

        bridge.Step(0.01f);
        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.WaypointIndex.Should().Be(1);
        state.Status.Should().Be(ScenePathAgentStatus.Moving);
    }

    [Fact]
    public void NonLoopingPathCompletesAndStops()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 10.0f, loop: false, waypoints: new[]
        {
            new Vec3(2.0f, 0.0f, 0.0f),
        });

        bridge.Step(0.2f);
        bridge.Step(0.01f);

        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Completed);
        state.WaypointIndex.Should().Be(1);

        Vec3 completed = world.GetData<SceneTransform3D>(actor).Position;
        bridge.Step(0.5f);
        world.GetData<SceneTransform3D>(actor).Position.Should().Be(completed);
    }

    [Fact]
    public void LoopingPathWrapsToFirstWaypoint()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 10.0f, loop: true, waypoints: new[]
        {
            new Vec3(1.0f, 0.0f, 0.0f),
            new Vec3(1.0f, 0.0f, 1.0f),
        });

        bridge.Step(0.1f);
        bridge.Step(0.01f);
        bridge.Step(0.1f);
        bridge.Step(0.01f);

        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Moving);
        state.WaypointIndex.Should().Be(0);
    }

    [Fact]
    public void ObstacleSteersTheAgentLaterally()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 2.0f, loop: true, waypoints: new[]
        {
            new Vec3(10.0f, 0.0f, 0.0f),
        });

        ref ScenePathAgent component = ref world.GetData<ScenePathAgent>(actor);
        component.AvoidanceRadius = 3.0f;
        bridge.AddObstacle(Aabb3D.FromCenterExtents(new Vec3(5.0f, 0.0f, 0.0f), new Vec3(1.0f, 1.0f, 1.0f)));

        bridge.Step(0.5f);
        bridge.Step(0.5f);

        Vec3 position = world.GetData<SceneTransform3D>(actor).Position;
        position.Z.Should().BeGreaterThan(0.1f);
        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Moving);
    }

    [Fact]
    public void AgentWithoutTransformStaysIdle()
    {
        SceneProfile profile = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/path-nodes")))
            .AddPathAgents3D()
            .Build();
        using SceneWorld world = profile.CreateWorld();
        using ScenePathAgentBridge bridge = new(world);

        SceneActor actor = world.CreateActor("NoTransform");
        world.AddData(actor, ScenePathAgent.Default);
        bridge.SetPath(actor, new[] { new Vec3(1.0f, 0.0f, 0.0f) }).Should().BeTrue();

        bridge.Step(0.5f);

        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Idle);
    }

    [Fact]
    public void EmptyPathIsRejected()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = world.CreateActor("Agent");
        world.AddData(actor, ScenePathAgent.Default);

        bridge.RegisterPath(ReadOnlySpan<Vec3>.Empty).IsValid.Should().BeFalse();
        bridge.SetPath(actor, ReadOnlySpan<Vec3>.Empty).Should().BeFalse();
        bridge.PathCount.Should().Be(0);
    }

    [Fact]
    public void ReleasedPathHandleIsRejected()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = world.CreateActor("Agent");
        world.AddData(actor, ScenePathAgent.Default);

        ScenePathHandle path = bridge.RegisterPath(new[] { new Vec3(1.0f, 0.0f, 0.0f) });
        path.IsValid.Should().BeTrue();
        bridge.ReleasePath(path).Should().BeTrue();
        bridge.ReleasePath(path).Should().BeFalse();

        bridge.TrySetPath(actor, path).Should().BeFalse();
        bridge.PathCount.Should().Be(0);
    }

    [Fact]
    public void ClearingPathIdlesTheAgent()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 5.0f, loop: true, waypoints: new[]
        {
            new Vec3(5.0f, 0.0f, 0.0f),
        });

        bridge.ClearPath(actor).Should().BeTrue();
        bridge.Step(0.2f);

        bridge.TryGetState(actor, out ScenePathAgentState state).Should().BeTrue();
        state.Status.Should().Be(ScenePathAgentStatus.Idle);
        world.GetData<SceneTransform3D>(actor).Position.Should().Be(Vec3.Zero);
    }

    [Fact]
    public void RemovedComponentReleasesAgentOnSync()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 5.0f, loop: true, waypoints: new[]
        {
            new Vec3(5.0f, 0.0f, 0.0f),
        });
        bridge.AgentCount.Should().Be(1);

        world.RemoveData<ScenePathAgent>(actor);
        bridge.Sync();

        bridge.AgentCount.Should().Be(0);
        bridge.TryGetState(actor, out _).Should().BeFalse();
    }

    [Fact]
    public void SteppingIsDeterministic()
    {
        using SceneWorld firstWorld = CreateWorld();
        using SceneWorld secondWorld = CreateWorld();
        using ScenePathAgentBridge firstBridge = new(firstWorld);
        using ScenePathAgentBridge secondBridge = new(secondWorld);
        SceneActor firstActor = CreateAgent(firstWorld, firstBridge, speed: 2.0f, loop: true, waypoints: new[]
        {
            new Vec3(4.0f, 0.0f, 0.0f),
            new Vec3(4.0f, 0.0f, 4.0f),
        });
        SceneActor secondActor = CreateAgent(secondWorld, secondBridge, speed: 2.0f, loop: true, waypoints: new[]
        {
            new Vec3(4.0f, 0.0f, 0.0f),
            new Vec3(4.0f, 0.0f, 4.0f),
        });

        Aabb3D obstacle = Aabb3D.FromCenterExtents(new Vec3(2.0f, 0.0f, 0.0f), new Vec3(0.5f, 1.0f, 0.5f));
        firstBridge.AddObstacle(obstacle);
        secondBridge.AddObstacle(obstacle);

        for (int i = 0; i < 10; i++)
        {
            firstBridge.Step(0.1f);
            secondBridge.Step(0.1f);
        }

        firstWorld.GetData<SceneTransform3D>(firstActor).Should().Be(secondWorld.GetData<SceneTransform3D>(secondActor));
    }

    [Fact]
    public void SteadyStateSteppingAllocatesNothing()
    {
        using SceneWorld world = CreateWorld();
        using ScenePathAgentBridge bridge = new(world);
        SceneActor actor = CreateAgent(world, bridge, speed: 2.0f, loop: true, waypoints: new[]
        {
            new Vec3(4.0f, 0.0f, 0.0f),
            new Vec3(4.0f, 0.0f, 4.0f),
        });
        _ = actor;

        for (int i = 0; i < 4; i++)
        {
            bridge.Step(0.016f);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            bridge.Step(0.016f);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/path")))
            .AddTransform3D()
            .AddPathAgents3D()
            .Build()
            .CreateWorld();

    private static SceneActor CreateAgent(
        SceneWorld world,
        ScenePathAgentBridge bridge,
        float speed,
        bool loop,
        ReadOnlySpan<Vec3> waypoints)
    {
        SceneActor actor = world.CreateActor("Agent");
        world.GetTransform3D(actor).SetPosition(Vec3.Zero);

        ScenePathAgent component = ScenePathAgent.Default;
        component.Speed = speed;
        component.Loop = loop;
        world.AddData(actor, component);
        bridge.SetPath(actor, waypoints).Should().BeTrue();
        return actor;
    }
}
