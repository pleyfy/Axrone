using Axrone.Numeric;
using Axrone.Physics3D;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// The shared substep budget is not decoration: <see cref="PhysicsConstants.MaxSubSteps"/>
/// is the default slice cap of a shipped world, and a bullet that needs the whole budget
/// to keep its narrowphase samples closer than its own sweep step goes through a thin wall
/// when the cap is halved. Both halves of that claim are measured here, so the constant is
/// pinned by behaviour and not by its own name.
/// </summary>
public sealed class SubStepCap3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Speed = 240.0f;
    private const float SweepStep = 0.5f;
    private const float StartX = -1.35f;
    private const float Radius = 0.1f;
    private const float WallHalf = 0.05f;
    private const int HalvedCap = 4;

    [Fact]
    public void ShippedSubStepCap_KeepsTheBulletThatNeedsEverySlice_AndAHalvedOneDoesNot()
    {
        int required = (int)MathF.Ceiling((Speed * Dt) / SweepStep);
        Assert.True(
            required >= PhysicsConstants.MaxSubSteps,
            $"the witness scene asks for {required} slices ({Speed:0} m/s x {Dt:0.####} s / {SweepStep:0.##} m sweep step), which must be at least the shipped " +
            $"budget PhysicsConstants.MaxSubSteps={PhysicsConstants.MaxSubSteps}; if the shipped budget moved, re-derive the scene instead of the constant.");

        Run shipped = RunBullet(cap: null);
        Run halved = RunBullet(HalvedCap);

        Assert.True(
            shipped.X < 0.0f,
            $"the shipped budget let a {Radius:0.##} m sphere tunnel a {WallHalf:0.###} m wall at {Speed:0} m/s: it ended at x={shipped.X:0.0000} past the " +
            $"near face at {-(WallHalf):0.###}; slices={shipped.Slices} of {required} required, cap={shipped.Cap}.");
        Assert.True(
            halved.X > WallHalf,
            $"control refused: with the cap halved to {HalvedCap} the same bullet must cross, because the sweep samples {Dt * Speed / HalvedCap:0.###} m apart " +
            $"against a {(2.0f * (Radius + WallHalf)):0.###} m overlap window; it ended at x={halved.X:0.0000}, slices={halved.Slices}, " +
            $"shipped ended at x={shipped.X:0.0000}.");
        Assert.True(
            shipped.Speed < 0.5f * halved.Speed,
            $"the wall must have absorbed the stopped bullet: shipped ended at {shipped.Speed:0.###} m/s against the halved control's {halved.Speed:0.###} m/s " +
            $"(it kept flying); shipped x={shipped.X:0.0000}, halved x={halved.X:0.0000}.");
        Assert.True(
            shipped.Cap == PhysicsConstants.MaxSubSteps,
            $"a default World bought {shipped.Cap} slices, expected the shipped PhysicsConstants.MaxSubSteps={PhysicsConstants.MaxSubSteps}: the default no " +
            $"longer reads the shared constant, so the constant pins nothing. Slices measured {shipped.Slices}, bullet x={shipped.X:0.0000}.");
        Assert.True(
            shipped.Slices == required && halved.Slices == HalvedCap,
            $"slice counts did not follow the caps: shipped {shipped.Slices} (expected {required}), halved {halved.Slices} (expected {HalvedCap}); the halved " +
            $"control is the witness that the cap is what bounded the sweep.");
    }

    private static Run RunBullet(int? cap)
    {
        using var world = cap is null ? new World() : new World(new WorldDef { MaxCcdSubsteps = cap.Value });
        BodyId wall = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, wall, Vec3.Zero, new Vec3(WallHalf, 5.0f, 5.0f));

        BodyId bullet = world.Bodies.Create(new BodyDef { Bullet = true });
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, bullet, Vec3.Zero, Radius);
        world.Bodies.SetTransform(bullet, new Vec3(StartX, 0.0f, 0.0f), Quat.Identity);
        world.Bodies.SetLinearVelocity(bullet, new Vec3(Speed, 0.0f, 0.0f));

        world.Step(Dt);
        return new Run(
            world.Bodies.GetTransform(bullet).Position.X,
            world.Bodies.GetLinearVelocity(bullet).Length(),
            world.LastCcdSlices,
            cap ?? PhysicsConstants.MaxSubSteps);
    }

    private readonly record struct Run(float X, float Speed, int Slices, int Cap);
}
