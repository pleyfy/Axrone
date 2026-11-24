using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Step clamp gate: a step buys at most <see cref="PhysicsConstants.MaxTranslation"/>
/// metres and <see cref="PhysicsConstants.MaxRotation"/> radians of integration
/// per body, whatever its velocity and however the step split itself, and the
/// declared speed caps are the numbers the integrator actually enforces.
/// </summary>
public sealed class StepClamp3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Overspeed = 150.0f;
    private const float UnclampedSpeed = 60.0f;
    private readonly ITestOutputHelper _output;

    public StepClamp3DTests(ITestOutputHelper output) => _output = output;

    [Theory]
    [InlineData(1)]
    [InlineData(4)]
    public void Translation_CapIsPerStep_NotPerSlice(int slices)
    {
        float travel = StepTravel(Overspeed, slices);
        float freeTravel = StepTravel(UnclampedSpeed, slices);

        _output.WriteLine(
            $"slices={slices}: {Overspeed} m/s travelled {travel:0.#####} m in one step (raw " +
            $"{Overspeed * Dt:0.#####} m), {UnclampedSpeed} m/s travelled {freeTravel:0.#####} m");

        travel.Should().BeApproximately(PhysicsConstants.MaxTranslation, 1e-4f,
            $"{Overspeed} m/s over {slices} slice(s) travelled {travel:0.#####} m in one step instead of the " +
            $"{PhysicsConstants.MaxTranslation:0.##} m per-step budget.");
        freeTravel.Should().BeApproximately(UnclampedSpeed * Dt, 1e-5f,
            $"{UnclampedSpeed} m/s over {slices} slice(s) travelled {freeTravel:0.#####} m instead of its own " +
            $"{UnclampedSpeed * Dt:0.#####} m, so the cap is biting below itself.");
    }

    [Fact]
    public void ClampedBody_CrawlsInsteadOfBeingTeleported()
    {
        using World world = Build(slices: 1);
        BodyId shell = FreeBody(world, new Vec3(0.0f, 0.0f, 0.0f), new Vec3(500.0f, 0.0f, 0.0f));

        for (int step = 0; step < 10; step++)
        {
            world.Step(Dt);
        }

        float travelled = world.Bodies.GetTransform(shell).Position.X;
        float expected = 10.0f * PhysicsConstants.MaxTranslation;
        float uncapped = 10.0f * PhysicsConstants.MaxVelocity * Dt;

        _output.WriteLine(
            $"a body driven at 500 m/s covered {travelled:0.#####} m in 10 steps (capped budget {expected:0.##} m, " +
            $"uncapped {uncapped:0.#####} m), and reports |v| = {world.Bodies.GetLinearVelocity(shell).Length():0.#####} m/s");

        travelled.Should().BeApproximately(expected, 1e-3f,
            $"ten steps at 500 m/s covered {travelled:0.#####} m rather than the {expected:0.##} m the caps allow.");
    }

    [Theory]
    [InlineData(500.0f, PhysicsConstants.MaxVelocity)]
    [InlineData(UnclampedSpeed, UnclampedSpeed)]
    public void MaxVelocity_IsRead(float start, float expected)
    {
        using World world = Build(slices: 1);
        BodyId shell = FreeBody(world, Vec3.Zero, new Vec3(start, 0.0f, 0.0f));
        world.Step(Dt);

        float speed = world.Bodies.GetLinearVelocity(shell).Length();
        _output.WriteLine($"{start} m/s after one step reports {speed:0.#####} m/s");
        speed.Should().BeApproximately(expected, 1e-4f,
            $"{start} m/s reported {speed:0.#####} m/s after a step; PhysicsConstants.MaxVelocity is " +
            $"{PhysicsConstants.MaxVelocity:0.##}.");
    }

    [Theory]
    [InlineData(1000.0f, PhysicsConstants.MaxAngularVelocity)]
    [InlineData(10.0f, 10.0f)]
    public void MaxAngularVelocity_IsRead(float start, float expected)
    {
        using World world = Build(slices: 1);
        BodyId shell = FreeBody(world, Vec3.Zero, Vec3.Zero, new Vec3(0.0f, 0.0f, start));
        world.Step(Dt);

        float spin = world.Bodies.GetAngularVelocity(shell).Length();
        _output.WriteLine($"{start} rad/s after one step reports {spin:0.#####} rad/s");
        spin.Should().BeApproximately(expected, 1e-4f,
            $"{start} rad/s reported {spin:0.#####} rad/s after a step; PhysicsConstants.MaxAngularVelocity is " +
            $"{PhysicsConstants.MaxAngularVelocity:0.##}.");
    }

    [Theory]
    [InlineData(200.0f, PhysicsConstants.MaxRotation)]
    [InlineData(60.0f, 1.0f)]
    public void Rotation_CapIsPerStep(float start, float expected)
    {
        using World world = Build(slices: 1);
        BodyId shell = FreeBody(world, Vec3.Zero, Vec3.Zero, new Vec3(0.0f, 0.0f, start));
        Quat before = world.Bodies.GetTransform(shell).Rotation;
        world.Step(Dt);
        float turned = TurnedRadians(before, world.Bodies.GetTransform(shell).Rotation);

        _output.WriteLine($"{start} rad/s turned {turned:0.#####} rad in one step (raw {start * Dt:0.#####} rad)");
        turned.Should().BeApproximately(expected, 1e-5f,
            $"{start} rad/s turned {turned:0.#####} rad in one step; PhysicsConstants.MaxRotation is " +
            $"{PhysicsConstants.MaxRotation:0.#####}.");
    }

    [Fact]
    public void StaticBodies_NeverMove_UnderAnyCap()
    {
        using World world = Build(slices: 1);
        BodyId scenery = world.Bodies.Create(new BodyDef
        {
            Type = BodyType.Static,
            Position = new Vec3(0.0f, 0.0f, 0.0f),
            LinearVelocity = new Vec3(500.0f, 0.0f, 0.0f),
        });

        world.Step(Dt);

        world.Bodies.GetTransform(scenery).Position.Should().Be(Vec3.Zero,
            "a static body with 500 m/s stored on it moved to " +
            $"{world.Bodies.GetTransform(scenery).Position.ToString()} after one step.");
    }

    private static World Build(int slices) => new(new WorldDef
    {
        CcdSweepStep = (Overspeed * Dt) / slices,
        MaxCcdSubsteps = 8,
        Gravity = Vec3.Zero,
    });

    private static BodyId FreeBody(World world, Vec3 position, Vec3 linear, Vec3? angular = null) =>
        world.Bodies.Create(new BodyDef
        {
            Position = position,
            LinearVelocity = linear,
            AngularVelocity = angular ?? Vec3.Zero,
            Bullet = true,
            AllowSleep = false,
        });

    private static float StepTravel(float speed, int slices)
    {
        using World world = Build(slices);
        BodyId shell = FreeBody(world, Vec3.Zero, new Vec3(speed, 0.0f, 0.0f));
        world.Step(Dt);
        return world.Bodies.GetTransform(shell).Position.X;
    }

    private static float TurnedRadians(Quat before, Quat after)
    {
        Quat delta = after * before.Conjugate();
        float w = MathF.Min(1.0f, MathF.Abs(delta.W));
        return 2.0f * MathF.Acos(w);
    }
}
