using System.Diagnostics;
using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

public sealed class StaticRelocation3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float CubeHalf = 0.4f;
    private const float GroundHalf = 0.5f;
    private const float Slop = PhysicsConstants.LinearSlop;

    private readonly ITestOutputHelper _output;
    private readonly World _world = new();

    public StaticRelocation3DTests(ITestOutputHelper output)
    {
        _output = output;
    }

    public void Dispose() => _world.Dispose();

    [Fact]
    public void SupportDroppedUnderSleepingCube_WakesItAndItLandsOnTheNewSurface()
    {
        BodyId ground = CreateGround();
        BodyId cube = CreateCube(0.8f, Vec3.Zero, allowSleep: true);
        int sleepStep = StepUntilAsleep(cube, 300);
        Assert.True(sleepStep > 0, $"precondition: cube never slept within 300 steps.");

        Vec3 before = _world.Bodies.GetTransform(cube).Position;
        Assert.True(!_world.Bodies.IsAwake(cube), $"precondition: cube awake at step {sleepStep}.");

        _world.Bodies.SetTransform(ground, new Vec3(0.0f, -1.0f, 0.0f), Quat.Identity);
        _world.Step(Dt);
        Assert.True(_world.Bodies.IsAwake(cube), $"cube still asleep one step after its support dropped 1 m; y={before.Y:0.0000000}.");

        _world.Step(Dt);
        float vy = _world.Bodies.GetLinearVelocity(cube).Y;
        Assert.True(vy < 0.0f, $"cube not falling two steps after the support dropped; vy={vy:0.0000000}.");

        for (int i = 0; i < 118; i++)
        {
            _world.Step(Dt);
        }

        float restY = _world.Bodies.GetTransform(cube).Position.Y;
        float analytic = AnalyticRestY(-1.0f);
        Assert.True(Math.Abs(restY - analytic) <= 0.1f, $"cube did not land on the new ground: y={restY:0.0000000}, analytic={analytic:0.0000000}, delta={Math.Abs(restY - analytic):0.0000000}.");
    }

    [Fact]
    public void UntouchedSupport_KeepsSleepingCubeAsleep()
    {
        CreateGround();
        BodyId cube = CreateCube(0.8f, Vec3.Zero, allowSleep: true);
        Assert.True(StepUntilAsleep(cube, 300) > 0, "precondition: cube never slept within 300 steps.");

        Vec3 before = _world.Bodies.GetTransform(cube).Position;
        for (int i = 0; i < 120; i++)
        {
            _world.Step(Dt);
        }

        Vec3 after = _world.Bodies.GetTransform(cube).Position;
        Assert.True(!_world.Bodies.IsAwake(cube), $"control failed: a body with a still support woke by itself at y={after.Y:0.0000000}.");
        Assert.True(after == before, $"control failed: a body with a still support drifted from {before} to {after}.");
    }

    [Fact]
    public void SupportSlidSidewaysFromUnderSleepingCube_DropsIt()
    {
        BodyId ground = CreateGround();
        BodyId cube = CreateCube(0.8f, Vec3.Zero, allowSleep: true);
        Assert.True(StepUntilAsleep(cube, 300) > 0, "precondition: cube never slept within 300 steps.");

        float before = _world.Bodies.GetTransform(cube).Position.Y;
        _world.Bodies.SetTransform(ground, new Vec3(0.0f, 0.0f, 20.0f), Quat.Identity);
        _world.Step(Dt);

        Assert.True(_world.Bodies.IsAwake(cube), $"cube still asleep one step after its support slid 20 m sideways; y={before:0.0000000}.");
        for (int i = 0; i < 30; i++)
        {
            _world.Step(Dt);
        }

        float after = _world.Bodies.GetTransform(cube).Position.Y;
        Assert.True(before - after > 0.5f, $"cube did not fall after its support was withdrawn: y={after:0.0000000}, was {before:0.0000000}.");
    }

    [Fact]
    public void StaticPlatformMovedUpIntoFallingCube_CatchesItWithoutCallerSync()
    {
        CreateGround();
        BodyId platform = CreateSlab(new Vec3(0.0f, -20.0f, 0.0f), 1.0f);
        BodyId cube = CreateCube(6.0f, Vec3.Zero, allowSleep: false);

        int step = 0;
        float y = 6.0f;
        while (step < 200)
        {
            _world.Step(Dt);
            step++;
            y = _world.Bodies.GetTransform(cube).Position.Y;
            if (y <= 5.2f)
            {
                break;
            }
        }

        _world.Bodies.SetTransform(platform, new Vec3(0.0f, 3.5f, 0.0f), Quat.Identity);
        for (int i = 0; i < 600; i++)
        {
            _world.Step(Dt);
        }

        float restY = _world.Bodies.GetTransform(cube).Position.Y;
        float analytic = AnalyticRestY(3.5f);
        Assert.True(
            Math.Abs(restY - analytic) <= 0.05f,
            $"cube did not stop on the relocated platform: intercept at step {step} with y={y:0.0000000}, rest y={restY:0.0000000}, analytic={analytic:0.0000000}, delta={Math.Abs(restY - analytic):0.0000000}.");
    }

    [Fact]
    public void PlatformLeftParked_CubeFallsToTheGround()
    {
        CreateGround();
        CreateSlab(new Vec3(0.0f, -20.0f, 0.0f), 1.0f);
        BodyId cube = CreateCube(6.0f, Vec3.Zero, allowSleep: false);

        for (int i = 0; i < 700; i++)
        {
            _world.Step(Dt);
        }

        float restY = _world.Bodies.GetTransform(cube).Position.Y;
        float platformRest = AnalyticRestY(3.5f);
        Assert.True(
            restY < platformRest - 0.05f,
            $"control failed: with the platform parked 20 m below, nothing should catch the cube at the platform height {platformRest:0.0000000}; measured rest {restY:0.0000000}.");
    }

    [Fact]
    public void RestingBox_ReportsSeparationMatchingTrueOverlap()
    {
        CreateGround();
        BodyId cube = CreateCube(0.8f, Vec3.Zero, allowSleep: false);
        for (int i = 0; i < 240; i++)
        {
            _world.Step(Dt);
        }

        float y = _world.Bodies.GetTransform(cube).Position.Y;
        float trueOverlap = 0.0f - (y - CubeHalf);
        float separation = ReadContactSeparation(cube);
        Assert.True(
            Math.Abs(-separation - trueOverlap) <= Slop,
            $"calibration broken: a plain resting box reports sep={separation:0.0000000} against a true overlap of {trueOverlap:0.0000000} (delta {Math.Abs(-separation - trueOverlap):0.0000000}, slop {Slop:0.000}).");
    }

    [Fact]
    public void SupportDroppedUnderAwakeCube_RecoversWithoutBuryingItself()
    {
        BodyId ground = CreateGround();
        BodyId cube = CreateCube(0.8f, Vec3.Zero, allowSleep: false);
        for (int i = 0; i < 240; i++)
        {
            _world.Step(Dt);
        }

        _world.Bodies.SetTransform(ground, new Vec3(0.0f, -1.0f, 0.0f), Quat.Identity);
        for (int i = 0; i < 600; i++)
        {
            _world.Step(Dt);
        }

        float y = _world.Bodies.GetTransform(cube).Position.Y;
        float analytic = AnalyticRestY(-1.0f);
        float trueOverlap = -1.0f - (y - CubeHalf);
        float separation = ReadContactSeparation(cube);
        Assert.True(
            Math.Abs(y - analytic) <= Slop,
            $"awake cube did not recover the dropped support: y={y:0.0000000}, analytic={analytic:0.0000000}, delta={Math.Abs(y - analytic):0.0000000}, slop={Slop:0.000}.");
        Assert.True(
            Math.Abs(-separation - trueOverlap) <= Slop,
            $"awake cube reports a separation that disagrees with its overlap: sep={separation:0.0000000}, true overlap={trueOverlap:0.0000000}, y={y:0.0000000}.");
    }

    [Fact]
    public void RestlessNeighbourOnTheSameSupport_DoesNotDelaySleep()
    {
        int alone = MeasureSleepStep(neighbour: false);
        int withNeighbour = MeasureSleepStep(neighbour: true);

        _output.WriteLine($"sleep step alone={alone}, with AllowSleep=false neighbour={withNeighbour}");
        Assert.True(alone > 0, $"baseline control broken: the lone sleeper never slept (limit 600).");
        Assert.True(
            withNeighbour > 0,
            $"a body sharing its support with an AllowSleep=false neighbour never slept within 600 steps; lone baseline was step {alone}.");
        Assert.True(
            withNeighbour <= alone,
            $"restless neighbour delayed the sleep from step {alone} to step {withNeighbour} (delta {withNeighbour - alone}).");
    }

    [Fact]
    public void RestlessNeighbour_NeverSleepsItself()
    {
        CreateGround();
        BodyId sleeper = CreateCube(0.8f, Vec3.Zero, allowSleep: true);
        BodyId restless = CreateCube(0.8f, new Vec3(1.4f, 0.0f, 0.0f), allowSleep: false);

        Assert.True(StepUntilAsleep(sleeper, 600) > 0, "precondition: the sleeping cube never slept within 600 steps.");
        Assert.True(_world.Bodies.IsAwake(restless), "control failed: the AllowSleep=false body slept, so the island pinning was removed entirely.");

        for (int i = 0; i < 600; i++)
        {
            _world.Step(Dt);
        }

        Assert.True(_world.Bodies.IsAwake(restless), "control failed: the AllowSleep=false body slept within 1200 steps.");
    }

    [Fact]
    public void PerStepCost_WithOneSupportAndTwoHundredBodies()
    {
        const int Warmup = 60;
        const int Samples = 2000;

        CreateSlab(Vec3.Zero, 20.0f);
        for (int i = 0; i < 200; i++)
        {
            int row = i / 10;
            int column = i % 10;
            CreateCube(
                0.8f + 0.05f * (i % 4),
                new Vec3((column - 5) * 1.6f, 0.0f, (row - 10) * 1.6f),
                allowSleep: false);
        }

        BodyId shuttle = CreateSlab(new Vec3(0.0f, 8.0f, 0.0f), 12.0f);
        for (int i = 0; i < Warmup; i++)
        {
            _world.Step(Dt);
        }

        double idleTicks = 0.0;
        double relocatedTicks = 0.0;
        long idleSteps = 0;
        long relocatedSteps = 0;
        long frequency = Stopwatch.Frequency;

        for (int i = 0; i < Samples; i++)
        {
            bool relocate = (i % 2) == 0;
            if (relocate)
            {
                _world.Bodies.SetTransform(shuttle, new Vec3(0.0f, (i % 4) == 0 ? 8.0f : -8.0f, 0.0f), Quat.Identity);
            }

            long start = Stopwatch.GetTimestamp();
            _world.Step(Dt);
            double ms = (Stopwatch.GetTimestamp() - start) * 1000.0 / frequency;

            if (relocate)
            {
                relocatedTicks += ms;
                relocatedSteps++;
            }
            else
            {
                idleTicks += ms;
                idleSteps++;
            }
        }

        double idleMs = idleTicks / idleSteps;
        double relocatedMs = relocatedTicks / relocatedSteps;
        _output.WriteLine(
            $"per-step ms over {Samples} alternating steps: nothing relocated={idleMs:0.0000}, " +
            $"support relocated through the scene={relocatedMs:0.0000}, delta={relocatedMs - idleMs:0.0000} ms " +
            $"({(relocatedMs / idleMs - 1.0) * 100.0:0.0}%), contacts={_world.ContactCount}");
        Assert.True(
            relocatedMs <= idleMs * 1.5 + 0.05,
            $"relocation path costs too much per step: idle {idleMs:0.0000} ms, relocating {relocatedMs:0.0000} ms.");
    }

    [Fact]
    public void SupportTeleportScenario_IsBitReproducible()
    {
        Vec3 first = RunTeleportOnce();
        Vec3 second = RunTeleportOnce();
        Assert.True(
            first == second,
            $"the relocation path is not deterministic: the same scene ended at {first} and {second}.");
    }

    private static Vec3 RunTeleportOnce()
    {
        using World world = new();
        BodyId ground = CreateGround(world);
        BodyId cube = CreateCube(world, 0.8f, Vec3.Zero, allowSleep: true);
        for (int i = 0; i < 300; i++)
        {
            world.Step(Dt);
            if (!world.Bodies.IsAwake(cube))
            {
                break;
            }
        }

        world.Bodies.SetTransform(ground, new Vec3(0.0f, -1.0f, 0.0f), Quat.Identity);
        for (int i = 0; i < 200; i++)
        {
            world.Step(Dt);
        }

        return world.Bodies.GetTransform(cube).Position;
    }

    private static int MeasureSleepStep(bool neighbour)
    {
        using World world = new();
        CreateGround(world);
        BodyId cube = CreateCube(world, 0.8f, Vec3.Zero, allowSleep: true);
        if (neighbour)
        {
            CreateCube(world, 0.8f, new Vec3(1.4f, 0.0f, 0.0f), allowSleep: false);
        }

        for (int i = 1; i <= 600; i++)
        {
            world.Step(Dt);
            if (!world.Bodies.IsAwake(cube))
            {
                return i;
            }
        }

        return -1;
    }

    private float ReadContactSeparation(BodyId cube)
    {
        for (int i = 0; i < _world.ContactCount; i++)
        {
            Contact3D contact = _world.GetContact(i);
            if ((contact.BodyA == cube || contact.BodyB == cube) && contact.Manifold.Count > 0)
            {
                return contact.Manifold[0].Separation;
            }
        }

        return float.NaN;
    }

    private static float AnalyticRestY(float surfaceY) => surfaceY + CubeHalf - Slop;

    private BodyId CreateGround() => CreateSlab(_world, Vec3.Zero, 4.0f);

    private static BodyId CreateGround(World world) => CreateSlab(world, Vec3.Zero, 4.0f);

    private BodyId CreateSlab(Vec3 surfaceCenter, float halfWidth) => CreateSlab(_world, surfaceCenter, halfWidth);

    private static BodyId CreateSlab(World world, Vec3 surfaceCenter, float halfWidth)
    {
        BodyId slab = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = surfaceCenter });
        world.Shapes.AttachBox(
            world.Bodies,
            world.Broadphase,
            slab,
            new Vec3(0.0f, -GroundHalf, 0.0f),
            new Vec3(halfWidth, GroundHalf, halfWidth));
        return slab;
    }

    private BodyId CreateCube(float y, Vec3 offset, bool allowSleep) => CreateCube(_world, y, offset, allowSleep);

    private static BodyId CreateCube(World world, float y, Vec3 offset, bool allowSleep)
    {
        BodyId cube = world.Bodies.Create(new BodyDef { AllowSleep = allowSleep });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, cube, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
        world.Bodies.SetTransform(cube, new Vec3(offset.X, y, offset.Z), Quat.Identity);
        return cube;
    }

    private int StepUntilAsleep(BodyId cube, int limit)
    {
        for (int i = 1; i <= limit; i++)
        {
            _world.Step(Dt);
            if (!_world.Bodies.IsAwake(cube))
            {
                return i;
            }
        }

        return -1;
    }
}
