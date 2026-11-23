using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Slice-budget gate for the 3D step: the sweeps a step may spend belong to the
/// step, not to each of its CCD slices, so one step of position correction lands
/// the same depth however the step happened to be subdivided. A far-away bullet
/// body forces the subdivision, which keeps the measured pair free of
/// integration travel.
/// </summary>
public sealed class SliceBudget3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const float Overlap = 0.6f;
    private const int PileLevels = 3;
    private const float ClockSpeed = 90.0f;
    private const float ClockTravel = ClockSpeed * Dt;
    private const int VelocitySweeps = 8;
    private const int PositionSweeps = 3;
    private const float SliceSpreadTolerance = 0.01f;
    private readonly ITestOutputHelper _output;

    public SliceBudget3DTests(ITestOutputHelper output) => _output = output;

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void Step_SplitsIntoTheRequestedSliceCount(int slices)
    {
        using World world = Build(slices, PositionSweeps);
        world.Step(Dt);

        world.LastCcdSlices.Should().Be(slices,
            $"the clock bullet travels {ClockTravel:0.###} m per step at CcdSweepStep " +
            $"{ClockTravel / slices:0.#####} m, so the step must have run {slices} slices.");
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void Step_SpendsItsSweepBudgetOnce_PerSliceCountsDoNotMultiply(int slices)
    {
        using World split = Build(slices, PositionSweeps);
        split.Step(Dt);

        using World single = Build(1, PositionSweeps);
        single.Step(Dt);

        split.LastCcdSlices.Should().Be(slices, "the subdivided world must have subdivided to be a witness.");
        _output.WriteLine(
            $"slices={slices}: velocity sweeps {split.LastVelocitySweeps} vs control {single.LastVelocitySweeps}, " +
            $"position sweeps {split.LastPositionSweeps} vs control {single.LastPositionSweeps}");
        single.LastCcdSlices.Should().Be(1, "the control world must not have subdivided.");
        split.LastVelocitySweeps.Should().Be(single.LastVelocitySweeps,
            $"a step of {slices} slices ran {split.LastVelocitySweeps} velocity sweeps against the single-slice " +
            $"step's {single.LastVelocitySweeps}; the budget is {VelocitySweeps} per step, not per slice.");
        split.LastPositionSweeps.Should().Be(single.LastPositionSweeps,
            $"a step of {slices} slices ran {split.LastPositionSweeps} position sweeps against the single-slice " +
            $"step's {single.LastPositionSweeps}; the budget is {PositionSweeps} per step, not per slice.");
        split.LastVelocitySweeps.Should().Be(VelocitySweeps,
            $"the step spent {split.LastVelocitySweeps} velocity sweeps; WorldDef.VelocityIterations is " +
            $"{VelocitySweeps}, so the distribution lost or duplicated sweeps.");
        split.LastPositionSweeps.Should().Be(PositionSweeps,
            $"the step spent {split.LastPositionSweeps} position sweeps; WorldDef.PositionIterations is " +
            $"{PositionSweeps}, so the distribution lost or duplicated sweeps.");
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void OneStepPositionCorrection_DoesNotGrowWithSliceCount(int slices)
    {
        float single = Correct(1);
        float split = Correct(slices);

        float delta = split - single;
        _output.WriteLine(
            $"pile lift per step: 1 slice {single:0.#####} m, {slices} slices {split:0.#####} m, delta {delta:+0.#####;-0.#####} m");
        delta.Should().BeLessThan(SliceSpreadTolerance,
            $"one step lifted the top box of a 0.6 m interpenetrating three-pile by {single:0.#####} m at 1 slice " +
            $"and {split:0.#####} m at {slices} slices ({delta:+0.#####;-0.#####} m more), so the per-step " +
            $"correction budget scales with the slice count instead of staying near {PositionSweeps} x " +
            $"{PhysicsConstants.MaxLinearCorrection:0.##} m.");
    }

    [Fact]
    public void PositionBudget_IsStillSpent_SlicesDoNotZeroIt()
    {
        float none = Correct(1, 0);
        float one = Correct(1, 1);
        float three = Correct(1, 3);

        none.Should().Be(0.0f, $"with no position sweeps the overlapped pile still moved {none:0.#####} m.");
        one.Should().BeGreaterThan(0.1f, $"one sweep lifted the pile's top box by only {one:0.#####} m.");
        three.Should().BeGreaterThan(one,
            $"three sweeps lifted the top box by {three:0.#####} m against one sweep's {one:0.#####} m, so " +
            "capping the per-step budget would have been capping something the step never spent.");
    }

    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    public void SweepsDistributeWithoutLoss_AcrossEverySliceCount(int positionIterations)
    {
        using World world = Build(8, positionIterations);
        world.Step(Dt);

        world.LastPositionSweeps.Should().Be(positionIterations,
            $"{positionIterations} position iterations spread over 8 slices ran " +
            $"{world.LastPositionSweeps} sweeps.");
    }

    private static float Correct(int slices, int positionIterations)
    {
        using World world = Build(slices, positionIterations);
        BodyId top = Pile(world);
        float before = world.Bodies.GetTransform(top).Position.Y;
        world.Step(Dt);
        return world.Bodies.GetTransform(top).Position.Y - before;
    }

    private static float Correct(int slices) => Correct(slices, PositionSweeps);

    private static World Build(int slices, int positionIterations)
    {
        var world = new World(new WorldDef
        {
            CcdSweepStep = ClockTravel / slices,
            MaxCcdSubsteps = 8,
            VelocityIterations = VelocitySweeps,
            PositionIterations = positionIterations,
            Gravity = Vec3.Zero,
        });

        Ground(world);
        world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, 40.0f, 0.0f),
            LinearVelocity = new Vec3(0.0f, 0.0f, ClockSpeed),
            Bullet = true,
            AllowSleep = false,
            GravityScale = 0.0f,
        });
        return world;
    }

    private static void Ground(World world)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground,
            new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 1.0f, default, new PhysicsMaterial(0.8f, 0.0f));
    }

    private static BodyId Pile(World world)
    {
        BodyId top = BodyId.Invalid;
        for (int level = 0; level < PileLevels; level++)
        {
            top = world.Bodies.Create(new BodyDef
            {
                Position = new Vec3(0.0f, Half - Overlap + ((Half * 2.0f) - Overlap) * level, 0.0f),
                AllowSleep = false,
                GravityScale = 0.0f,
            });
            world.Shapes.AttachBox(world.Bodies, world.Broadphase, top, Vec3.Zero, new Vec3(Half, Half, Half),
                1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
        }

        return top;
    }
}
