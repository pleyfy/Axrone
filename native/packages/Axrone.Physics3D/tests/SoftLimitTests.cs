using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class SoftLimitTests
{
    private static (World World, BodyId Anchor, BodyId Slider) PrismaticRig(
        float mass, Vec3 start, JointLimitMode mode, LimitSpringSettings spring)
    {
        var world = new World();
        BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        BodyId slider = world.Bodies.Create(new BodyDef { Position = start });
        world.Bodies.SetMassData(slider, mass, new Vec3(0.0f, 0.0f, 0.0f));
        world.Joints.CreatePrismatic(
            world.Bodies, anchor, slider, Vec3.Zero, Vec3.Zero,
            new Vec3(0.0f, 1.0f, 0.0f), new Vec3(0.0f, 1.0f, 0.0f),
            lowerLimit: 0.0f, upperLimit: 10.0f, enableLimit: true,
            limitMode: mode, limitSpring: spring);
        return (world, anchor, slider);
    }

    private static LimitSpringSettings Spring(float f = 2.0f, float zeta = 0.7f, float bounce = 0.0f, float threshold = 0.0f, float margin = 0.0f)
    {
        return new LimitSpringSettings(f, zeta, bounce, threshold, margin);
    }

    [Fact]
    public void SoftLimit_GravitySag_SettlesAtSpringEquilibrium()
    {
        var (world, _, slider) = PrismaticRig(1.0f, Vec3.Zero, JointLimitMode.Soft, Spring());
        using (world)
        {
            for (int i = 0; i < 600; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            float y = world.Bodies.GetTransform(slider).Position.Y;
            // gravity penetrates the spring stop but stays bounded and settled: the sag
            // is far below the free geometric equilibrium and the body is at rest
            y.Should().BeGreaterThan(-0.15f);
            y.Should().BeLessThan(0.0f);
            world.Bodies.GetLinearVelocity(slider).Y.Should().BeApproximately(0.0f, 0.05f);
        }
    }

    [Fact]
    public void SoftLimit_Penetration_StaysWithinEnergyBound()
    {
        var (world, _, slider) = PrismaticRig(1.0f, Vec3.Zero, JointLimitMode.Soft, Spring(f: 1.0f, zeta: 0.0f));
        using (world)
        {
            float worst = 0.0f;
            for (int i = 0; i < 600; i++)
            {
                world.Step(1.0f / 60.0f);
                worst = MathF.Max(worst, -world.Bodies.GetTransform(slider).Position.Y);
            }

            // undamped: amplitude equals the first-contact sag, never unbounded growth
            worst.Should().BeLessThan(0.5f);
            worst.Should().BeGreaterThan(0.05f);
        }
    }

    [Fact]
    public void SoftLimit_Bounce_ReboundsFastApproach()
    {
        var (world, _, slider) = PrismaticRig(1.0f, new Vec3(0.0f, 1.0f, 0.0f), JointLimitMode.Soft,
            Spring(f: 2.0f, zeta: 1.0f, bounce: 1.0f, threshold: 1.0f));
        using (world)
        {
            world.Bodies.SetLinearVelocity(slider, new Vec3(0.0f, -8.0f, 0.0f));
            float peakUp = float.MinValue;
            for (int i = 0; i < 300; i++)
            {
                world.Step(1.0f / 60.0f);
                peakUp = MathF.Max(peakUp, world.Bodies.GetLinearVelocity(slider).Y);
            }

            peakUp.Should().BeGreaterThan(1.0f);
        }
    }

    [Fact]
    public void SoftLimit_NoBounce_DissipatesApproach()
    {
        var (world, _, slider) = PrismaticRig(1.0f, new Vec3(0.0f, 1.0f, 0.0f), JointLimitMode.Soft,
            Spring(f: 2.0f, zeta: 1.0f, bounce: 0.0f));
        using (world)
        {
            world.Bodies.SetLinearVelocity(slider, new Vec3(0.0f, -8.0f, 0.0f));
            float peakUp = float.MinValue;
            for (int i = 0; i < 300; i++)
            {
                world.Step(1.0f / 60.0f);
                peakUp = MathF.Max(peakUp, world.Bodies.GetLinearVelocity(slider).Y);
            }

            // spring can push back but the rebound is capped well below the bouncy case
            peakUp.Should().BeLessThan(6.0f);
        }
    }

    [Fact]
    public void SoftLimit_ExtremeDt_HeavyFrequency_StaysFinite()
    {
        var (world, _, slider) = PrismaticRig(1e-3f, Vec3.Zero, JointLimitMode.Soft,
            Spring(f: 500.0f, zeta: 0.0f));
        using (world)
        {
            for (int i = 0; i < 10; i++)
            {
                world.Step(0.5f);
            }

            Vec3 position = world.Bodies.GetTransform(slider).Position;
            Vec3 velocity = world.Bodies.GetLinearVelocity(slider);
            float magnitude = position.LengthSquared() + velocity.LengthSquared();
            float.IsFinite(magnitude).Should().BeTrue();
            velocity.Y.Should().BeGreaterThan(-200000.0f); // growth stays polynomial, no blowup
        }
    }

    [Fact]
    public void SoftLimit_ZeroEffectiveMass_NoRow_NoNan()
    {
        var (world, _, slider) = PrismaticRig(0.0f, Vec3.Zero, JointLimitMode.Soft, Spring());
        using (world)
        {
            for (int i = 0; i < 120; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            float.IsFinite(world.Bodies.GetTransform(slider).Position.LengthSquared()).Should().BeTrue();
            float.IsFinite(world.Bodies.GetLinearVelocity(slider).LengthSquared()).Should().BeTrue();
        }
    }

    [Fact]
    public void SoftLimit_MotorAgainstSpring_SaturatesNearEquilibrium()
    {
        var world = new World();
        using (world)
        {
            BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
            BodyId slider = world.Bodies.Create(new BodyDef());
            world.Bodies.SetMassData(slider, 1.0f, new Vec3(0.0f, 0.0f, 0.0f));
            world.Joints.CreatePrismatic(
                world.Bodies, anchor, slider, Vec3.Zero, Vec3.Zero,
                new Vec3(0.0f, 1.0f, 0.0f), new Vec3(0.0f, 1.0f, 0.0f),
                lowerLimit: 0.0f, upperLimit: 10.0f, enableLimit: true,
                motorSpeed: -4.0f, maxMotorForce: 100.0f, enableMotor: true,
                limitMode: JointLimitMode.Soft, limitSpring: Spring(f: 2.0f, zeta: 1.0f));

            for (int i = 0; i < 600; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            // motor pushes deep; spring balances at g_eff / omega^2, bounded, no runaway
            float y = world.Bodies.GetTransform(slider).Position.Y;
            y.Should().BeGreaterThan(-1.5f);
            y.Should().BeLessThan(0.0f);
        }
    }

    [Fact]
    public void SoftLimit_Deterministic_AcrossRebuilds()
    {
        float[] ys = new float[2];
        float[] vs = new float[2];
        for (int run = 0; run < 2; run++)
        {
            var (world, _, slider) = PrismaticRig(1.0f, Vec3.Zero, JointLimitMode.Soft,
                Spring(f: 3.0f, zeta: 0.2f, bounce: 0.4f, threshold: 0.5f, margin: 0.1f));
            using (world)
            {
                for (int i = 0; i < 240; i++)
                {
                    world.Step(1.0f / 60.0f);
                }

                ys[run] = world.Bodies.GetTransform(slider).Position.Y;
                vs[run] = world.Bodies.GetLinearVelocity(slider).Y;
            }
        }

        ys[0].Should().Be(ys[1]);
        vs[0].Should().Be(vs[1]);
    }

    [Fact]
    public void HardLimit_Default_RestoresLegacyStop()
    {
        var (hardWorld, _, hardSlider) = PrismaticRig(1.0f, Vec3.Zero, JointLimitMode.Hard, default);
        using (hardWorld)
        {
            float worst = 0.0f;
            for (int i = 0; i < 600; i++)
            {
                hardWorld.Step(1.0f / 60.0f);
                worst = MathF.Max(worst, -hardWorld.Bodies.GetTransform(hardSlider).Position.Y);
            }

            worst.Should().BeLessThan(0.05f);
        }
    }

    [Fact]
    public void HingeSoftLimit_SettlesUnderGravity()
    {
        var world = new World();
        using (world)
        {
            BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
            BodyId arm = world.Bodies.Create(new BodyDef { Position = new Vec3(0.0f, -1.0f, 0.0f) });
            world.Bodies.SetMassData(arm, 1.0f, new Vec3(0.0f, 0.5f, 0.5f));
            world.Joints.CreateHinge(
                world.Bodies, anchor, arm, new Vec3(0.0f, 0.0f, 0.0f), new Vec3(0.0f, -1.0f, 0.0f),
                new Vec3(0.0f, 0.0f, 1.0f), new Vec3(0.0f, 0.0f, 1.0f),
                lowerLimit: -1.0f, upperLimit: 0.0f, enableLimit: true,
                limitMode: JointLimitMode.Soft,
                limitSpring: new LimitSpringSettings(2.0f, 0.9f, 0.0f, 0.0f, 0.0f));

            for (int i = 0; i < 600; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            Vec3 velocity = world.Bodies.GetLinearVelocity(arm);
            float.IsFinite(velocity.LengthSquared()).Should().BeTrue();
            world.Bodies.GetAngularVelocity(arm).Z.Should().BeApproximately(0.0f, 0.2f);
        }
    }

    [Fact]
    public void ConfigurableSoftAxis_KeepsBodyNearStop()
    {
        var world = new World(new WorldDef { Gravity = new Vec3(0.0f, 0.0f, -9.81f) });
        using (world)
        {
            BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
            BodyId slider = world.Bodies.Create(new BodyDef());
            world.Bodies.SetMassData(slider, 1.0f, new Vec3(0.0f, 0.0f, 0.0f));
            var def = new ConfigurableJointDef
            {
                BodyA = anchor,
                BodyB = slider,
                Z = new JointAxisDef
                {
                    Mode = JointAxisMode.Limited,
                    LowerLimit = 0.0f,
                    UpperLimit = 10.0f,
                    LimitMode = JointLimitMode.Soft,
                    LimitSpring = new LimitSpringSettings(2.0f, 0.7f, 0.0f, 0.0f, 0.0f),
                },
            };
            world.Joints.CreateConfigurable(world.Bodies, in def);

            for (int i = 0; i < 600; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            float z = world.Bodies.GetTransform(slider).Position.Z;
            z.Should().BeGreaterThan(-0.15f);
            z.Should().BeLessThan(0.0f);
        }
    }
}
