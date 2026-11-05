namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class WheelTravelLimitTests
{
    private const float Dt = 1f / 60f;

    private static (BodyId Chassis, BodyId Wheel) Rig(World world, float startVy)
    {
        BodyId chassis = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0, 2f) });
        BodyId wheel = world.Bodies.Create(new BodyDef { Position = new Vec2(0, -1f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, wheel, new Vec2(0, 0), 0.4f);
        if (startVy != 0f)
        {
            world.Bodies.SetLinearVelocity(wheel, new Vec2(0, startVy));
        }

        return (chassis, wheel);
    }

    private static float[] Travel(World world, BodyId wheel, int steps)
    {
        float[] samples = new float[steps];
        for (int i = 0; i < steps; i++)
        {
            world.Step(Dt);
            samples[i] = world.Bodies.GetTransform(wheel).Position.Y + 1f;
        }

        return samples;
    }

    private static float Lowest(float[] samples) => samples.Min();

    private static float Highest(float[] samples) => samples.Max();

    [Fact]
    public void Travel_LowerStop_CatchesTheDroppedBody()
    {
        using var world = new World();
        (BodyId chassis, BodyId wheel) = Rig(world, -8f);
        world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            SuspensionFrequency = 1.5f,
            SuspensionDamping = 0.7f,
            EnableLimit = true,
            LowerTranslation = -0.25f,
            UpperTranslation = 5f,
        });

        float[] samples = Travel(world, wheel, 240);
        Lowest(samples).Should().BeLessThanOrEqualTo(-0.245f);
        Lowest(samples).Should().BeGreaterThanOrEqualTo(-0.28f);
    }

    [Fact]
    public void Travel_DisabledStopsLeaveTheSpringInCharge()
    {
        using var world = new World();
        (BodyId chassis, BodyId wheel) = Rig(world, -8f);
        world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            SuspensionFrequency = 1.5f,
            SuspensionDamping = 0.7f,
            LowerTranslation = -0.25f,
            UpperTranslation = 5f,
        });

        float[] samples = Travel(world, wheel, 240);
        Lowest(samples).Should().BeLessThan(-0.30f);
    }

    [Fact]
    public void Travel_UpperStop_CatchesTheThrownBody()
    {
        using var world = new World();
        (BodyId chassis, BodyId wheel) = Rig(world, 8f);
        world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            SuspensionFrequency = 1.5f,
            SuspensionDamping = 0.7f,
            EnableLimit = true,
            LowerTranslation = -5f,
            UpperTranslation = 0.3f,
        });

        float[] samples = Travel(world, wheel, 240);
        Highest(samples).Should().BeGreaterThan(0.28f);
        Highest(samples).Should().BeLessThanOrEqualTo(0.35f);
    }

    [Fact]
    public void Travel_CoincidentStops_LockTheBodyAtTheStop()
    {
        using var world = new World();
        (BodyId chassis, BodyId wheel) = Rig(world, 0f);
        world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            SuspensionFrequency = 8f,
            SuspensionDamping = 0.7f,
            EnableLimit = true,
            LowerTranslation = -0.5f,
            UpperTranslation = -0.5f,
        });

        float[] samples = Travel(world, wheel, 240);
        samples[^1].Should().BeApproximately(-0.5f, 3e-2f);
    }

    [Fact]
    public void Travel_BuilderWithLimitsMatchesDef()
    {
        using var defWorld = new World();
        (BodyId defChassis, BodyId defWheel) = Rig(defWorld, -8f);
        defWorld.Joints.CreateWheel(defWorld.Bodies, new WheelDef
        {
            BodyA = defChassis,
            BodyB = defWheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            SuspensionFrequency = 1.5f,
            SuspensionDamping = 0.7f,
            EnableLimit = true,
            LowerTranslation = -0.25f,
            UpperTranslation = 5f,
        });

        using var builderWorld = new World();
        (BodyId chassis, BodyId wheel) = Rig(builderWorld, -8f);
        var builder = WheelJointBuilder<Typestate.Unconfigured>.Create();
        var bodiesBound = builder.WithBodies(chassis, wheel);
        var suspended = bodiesBound.WithSuspension(new Vec2(0, -1f), new Vec2(0, 1f), 1.5f, 0.7f);
        WheelJointBuilder<Typestate.GeometryConfigured> limited = suspended.WithLimits(-0.25f, 5f);
        limited.Build(builderWorld.Bodies, builderWorld.Joints);

        float[] defSamples = Travel(defWorld, defWheel, 120);
        float[] builderSamples = Travel(builderWorld, wheel, 120);
        builderSamples.Should().Equal(defSamples);
    }

    [Fact]
    public void Travel_IsDeterministicAndFieldSensitive()
    {
        static float[] Run(bool enableLimit)
        {
            using var world = new World();
            (BodyId chassis, BodyId wheel) = Rig(world, -8f);
            world.Joints.CreateWheel(world.Bodies, new WheelDef
            {
                BodyA = chassis,
                BodyB = wheel,
                WorldAnchor = new Vec2(0, -1f),
                WorldAxis = new Vec2(0, 1f),
                SuspensionFrequency = 1.5f,
                SuspensionDamping = 0.7f,
                EnableLimit = enableLimit,
                LowerTranslation = -0.25f,
                UpperTranslation = 5f,
            });

            return Travel(world, wheel, 180);
        }

        Run(true).Should().Equal(Run(true));
        Run(true).Should().NotEqual(Run(false));
    }

    [Fact]
    public void Travel_RejectsInvertedStops()
    {
        using var world = new World();
        (BodyId chassis, BodyId wheel) = Rig(world, 0f);

        Action inverted = () => world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(0, -1f),
            WorldAxis = new Vec2(0, 1f),
            EnableLimit = true,
            LowerTranslation = 1f,
            UpperTranslation = -1f,
        });
        inverted.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void TravelDefGuards_RejectNaNStops()
    {
        Action nanLower = () => _ = new WheelDef { LowerTranslation = float.NaN };
        Action nanUpper = () => _ = new WheelDef { UpperTranslation = float.NaN };
        Action openStops = () => _ = new WheelDef
        {
            EnableLimit = true,
            LowerTranslation = float.NegativeInfinity,
            UpperTranslation = float.PositiveInfinity,
        };

        nanLower.Should().Throw<ArgumentOutOfRangeException>();
        nanUpper.Should().Throw<ArgumentOutOfRangeException>();
        openStops.Should().NotThrow();
    }

    [Fact]
    public void Travel_OpenStops_BehaveLikeNoLimit()
    {
        static float[] Run(bool enableOpenLimit)
        {
            using var world = new World();
            (BodyId chassis, BodyId wheel) = Rig(world, -8f);
            world.Joints.CreateWheel(world.Bodies, new WheelDef
            {
                BodyA = chassis,
                BodyB = wheel,
                WorldAnchor = new Vec2(0, -1f),
                WorldAxis = new Vec2(0, 1f),
                SuspensionFrequency = 1.5f,
                SuspensionDamping = 0.7f,
                EnableLimit = enableOpenLimit,
                LowerTranslation = enableOpenLimit ? float.NegativeInfinity : 0f,
                UpperTranslation = enableOpenLimit ? float.PositiveInfinity : 0f,
            });

            return Travel(world, wheel, 180);
        }

        Run(true).Should().Equal(Run(false));
    }
}
