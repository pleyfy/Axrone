namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class JointSoftConstraintTests
{
    private const float Dt = 1f / 60f;

    private static BodyId Anchor(World world) =>
        world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0, 0) });

    private static BodyId Ball(World world, Vec2 position)
    {
        BodyId ball = world.Bodies.Create(new BodyDef { Position = position });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, new Vec2(0, 0), 0.25f);
        return ball;
    }

    /// <summary>Hangs a ball below a fixed anchor through one distance joint and returns the settled separation.</summary>
    private static float HangingSeparation(
        float length,
        float stiffness = 0f,
        float damping = 0f,
        float minDistance = 0f,
        float maxDistance = 0f,
        int steps = 240,
        float startY = -1f,
        float startVy = 0f)
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(0, startY));
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = length,
            Stiffness = stiffness,
            Damping = damping,
            MinDistance = minDistance,
            MaxDistance = maxDistance,
        });
        if (startVy != 0f)
        {
            world.Bodies.SetLinearVelocity(ball, new Vec2(0, startVy));
        }

        for (int i = 0; i < steps; i++)
        {
            world.Step(Dt);
        }

        return world.Bodies.GetTransform(ball).Position.Length();
    }

    [Fact]
    public void RigidRod_HoldsTheRestLengthUnderLoad()
    {
        HangingSeparation(length: 2f).Should().BeApproximately(2f, 5e-2f);
    }

    [Fact]
    public void SoftRod_ApproachesRestMoreSlowlyThanTheRigidRod()
    {
        float rigid = HangingSeparation(length: 2f, steps: 120);
        float soft = HangingSeparation(length: 2f, stiffness: 20f, damping: 1f, steps: 120);
        float softLong = HangingSeparation(length: 2f, stiffness: 20f, damping: 1f, steps: 600);

        rigid.Should().BeApproximately(2f, 5e-2f);
        soft.Should().BeLessThan(rigid - 0.3f);
        soft.Should().BeGreaterThan(1.2f);
        softLong.Should().BeApproximately(2f, 5e-2f);
    }

    [Fact]
    public void IncreasingStiffness_ConvergesFasterToRest()
    {
        float weak = HangingSeparation(length: 2f, stiffness: 10f, damping: 1f, steps: 120);
        float strong = HangingSeparation(length: 2f, stiffness: 400f, damping: 1f, steps: 120);

        strong.Should().BeGreaterThan(weak + 0.2f);
        strong.Should().BeLessThanOrEqualTo(2f + 5e-2f);
    }

    [Fact]
    public void IncreasingDamping_SlowsTheReturnToRest()
    {
        float light = HangingSeparation(length: 2f, stiffness: 20f, damping: 1f, steps: 600);
        float heavy = HangingSeparation(length: 2f, stiffness: 20f, damping: 20f, steps: 600);

        heavy.Should().BeLessThan(light - 0.5f);
    }

    [Fact]
    public void MaxDistance_CapsTheStretchOfASoftRod()
    {
        float unbounded = HangingSeparation(
            length: 2f, stiffness: 2f, damping: 0.2f, steps: 600, startVy: -6f);
        float bounded = HangingSeparation(
            length: 2f, stiffness: 2f, damping: 0.2f, maxDistance: 2.4f, steps: 600, startVy: -6f);

        unbounded.Should().BeGreaterThan(bounded + 0.05f);
        bounded.Should().BeLessThanOrEqualTo(2.4f + 5e-2f);
    }

    [Fact]
    public void MinDistance_HoldsThePairAboveTheBoundWhileTheSpringExtends()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(0, -1f));
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 2f,
            Stiffness = 2f,
            Damping = 0.2f,
            MinDistance = 1.5f,
        });

        float lowest = float.MaxValue;
        for (int i = 0; i < 600; i++)
        {
            world.Step(Dt);
            lowest = MathF.Min(lowest, world.Bodies.GetTransform(ball).Position.Length());
        }

        lowest.Should().BeGreaterThanOrEqualTo(1.49f);
        world.Bodies.GetTransform(ball).Position.Length().Should().BeGreaterThan(2f);
    }

    [Fact]
    public void SlackRange_LeavesTheRodInCharge()
    {
        float slack = HangingSeparation(length: 2f, minDistance: 1f, maxDistance: 40f);

        slack.Should().BeApproximately(2f, 5e-2f);
    }

    [Fact]
    public void CoincidentBounds_LockTheSeparationAtTheSharedValue()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(4f, 0f));
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 2f,
            MinDistance = 2f,
            MaxDistance = 2f,
        });

        for (int i = 0; i < 120; i++)
        {
            world.Step(Dt);
        }

        world.Bodies.GetTransform(ball).Position.Length().Should().BeApproximately(2f, 5e-2f);
    }

    [Fact]
    public void SoftAndRangedJoint_IsDeterministicAndFieldSensitive()
    {
        static float Run(float stiffness, float damping)
        {
            using var world = new World();
            BodyId anchor = Anchor(world);
            BodyId ball = Ball(world, new Vec2(2f, 0f));
            world.Joints.CreateDistance(world.Bodies, new DistanceDef
            {
                BodyA = anchor,
                BodyB = ball,
                Length = 3f,
                Stiffness = stiffness,
                Damping = damping,
                MinDistance = 1f,
                MaxDistance = 4f,
            });

            for (int i = 0; i < 90; i++)
            {
                world.Step(Dt);
            }

            return world.Bodies.GetTransform(ball).Position.X;
        }

        Run(50f, 4f).Should().Be(Run(50f, 4f));
        Run(50f, 4f).Should().NotBe(Run(5f, 0.4f));
    }

    [Fact]
    public void ExtremeStep_KeepsTheSoftRangedRodFinite()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(2f, 0f));
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 3f,
            Stiffness = 5000f,
            Damping = 500f,
            MinDistance = 1f,
            MaxDistance = 4f,
        });

        for (int i = 0; i < 20; i++)
        {
            world.Step(5f);
        }

        Vec2 position = world.Bodies.GetTransform(ball).Position;
        float.IsFinite(position.X).Should().BeTrue();
        float.IsFinite(position.Y).Should().BeTrue();
        world.Validate(out string? failure).Should().BeTrue();
        failure.Should().BeNull();
    }

    [Fact]
    public void TinyStep_LeavesTheSoftRodUnmoved()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(2f, 0f));
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 3f,
            Stiffness = 200f,
            Damping = 10f,
        });

        for (int i = 0; i < 60; i++)
        {
            world.Step(1e-4f);
        }

        Vec2 position = world.Bodies.GetTransform(ball).Position;
        position.X.Should().BeApproximately(2f, 1e-2f);
        position.Y.Should().BeApproximately(0f, 1e-2f);
    }

    [Fact]
    public void DefinitionGuards_RejectBadTuning()
    {
        Action negativeLength = () => _ = new DistanceDef { Length = -1f };
        Action nanLength = () => _ = new DistanceDef { Length = float.NaN };
        Action infiniteLength = () => _ = new DistanceDef { Length = float.PositiveInfinity };
        Action negativeStiffness = () => _ = new DistanceDef { Stiffness = -0.5f };
        Action nanDamping = () => _ = new DistanceDef { Damping = float.NaN };
        Action negativeMin = () => _ = new DistanceDef { MinDistance = -2f };
        Action infiniteMax = () => _ = new DistanceDef { MaxDistance = float.PositiveInfinity };
        Action accepted = () => _ = new DistanceDef
        {
            Length = 2f,
            Stiffness = 10f,
            Damping = 1f,
            MinDistance = 1f,
            MaxDistance = 3f,
        };

        negativeLength.Should().Throw<ArgumentOutOfRangeException>();
        nanLength.Should().Throw<ArgumentOutOfRangeException>();
        infiniteLength.Should().Throw<ArgumentOutOfRangeException>();
        negativeStiffness.Should().Throw<ArgumentOutOfRangeException>();
        nanDamping.Should().Throw<ArgumentOutOfRangeException>();
        negativeMin.Should().Throw<ArgumentOutOfRangeException>();
        infiniteMax.Should().Throw<ArgumentOutOfRangeException>();
        accepted.Should().NotThrow();
    }

    [Fact]
    public void CreationGuards_RejectContradictoryRanges()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(2f, 0f));

        Action inverted = () => world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 2f,
            MinDistance = 4f,
            MaxDistance = 1f,
        });
        Action lengthBelowRange = () => world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 0.5f,
            MinDistance = 1f,
            MaxDistance = 4f,
        });
        Action lengthAboveRange = () => world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 9f,
            MinDistance = 1f,
            MaxDistance = 4f,
        });
        Action coherent = () => world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = ball,
            Length = 2f,
            MinDistance = 1f,
            MaxDistance = 4f,
        });

        inverted.Should().Throw<InvalidOperationException>();
        lengthBelowRange.Should().Throw<InvalidOperationException>();
        lengthAboveRange.Should().Throw<InvalidOperationException>();
        coherent.Should().NotThrow();
    }

    [Fact]
    public void LegacyPositionalCreate_StillBuildsARigidRod()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(2f, 0f));
        JointId joint = world.Joints.CreateDistance(world.Bodies, anchor, ball, new Vec2(0, 0), new Vec2(0, 0), 2f);

        for (int i = 0; i < 240; i++)
        {
            world.Step(Dt);
        }

        world.Bodies.GetTransform(ball).Position.Length().Should().BeApproximately(2f, 5e-2f);
        joint.Kind.Should().Be(JointKind.Distance);
    }
}
