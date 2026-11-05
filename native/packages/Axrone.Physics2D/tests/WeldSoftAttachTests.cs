namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class WeldSoftAttachTests
{
    private const float Dt = 1f / 60f;

    private static (BodyId Anchor, BodyId Ball) Rig(World world)
    {
        BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0, 0) });
        BodyId ball = world.Bodies.Create(new BodyDef { Position = new Vec2(0, -2f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, new Vec2(0, 0), 0.25f);
        return (anchor, ball);
    }

    private static float Sag(World world, BodyId ball, int steps)
    {
        for (int i = 0; i < steps; i++)
        {
            world.Step(Dt);
        }

        return -2f - world.Bodies.GetTransform(ball).Position.Y;
    }

    [Fact]
    public void RigidWeld_DefaultsToFullLock()
    {
        using var world = new World();
        (BodyId anchor, BodyId ball) = Rig(world);
        world.Joints.CreateWeld(world.Bodies, new WeldDef
        {
            BodyA = anchor,
            BodyB = ball,
            WorldAnchor = new Vec2(0, -2f),
        });

        Sag(world, ball, 240).Should().BeApproximately(0f, 5e-3f);
    }

    [Fact]
    public void SoftWeld_YieldsToGravityWhereTheRigidWeldDoesNot()
    {
        using var softWorld = new World();
        (BodyId softAnchor, BodyId softBall) = Rig(softWorld);
        softWorld.Joints.CreateWeld(softWorld.Bodies, new WeldDef
        {
            BodyA = softAnchor,
            BodyB = softBall,
            WorldAnchor = new Vec2(0, -2f),
            Frequency = 1f,
            DampingRatio = 0.7f,
        });

        using var rigidWorld = new World();
        (BodyId rigidAnchor, BodyId rigidBall) = Rig(rigidWorld);
        rigidWorld.Joints.CreateWeld(rigidWorld.Bodies, new WeldDef
        {
            BodyA = rigidAnchor,
            BodyB = rigidBall,
            WorldAnchor = new Vec2(0, -2f),
        });

        float softSag = Sag(softWorld, softBall, 240);
        float rigidSag = Sag(rigidWorld, rigidBall, 240);
        softSag.Should().BeGreaterThan(rigidSag + 5e-2f);
        MathF.Abs(softWorld.Bodies.GetTransform(softBall).Position.X).Should().BeLessThan(5e-2f);
    }

    [Fact]
    public void IncreasingFrequency_RetractsTowardTheWeldedPose()
    {
        float WorstCaseSag(float frequency)
        {
            using var world = new World();
            (BodyId anchor, BodyId ball) = Rig(world);
            world.Joints.CreateWeld(world.Bodies, new WeldDef
            {
                BodyA = anchor,
                BodyB = ball,
                WorldAnchor = new Vec2(0, -2f),
                Frequency = frequency,
                DampingRatio = 0.7f,
            });

            return Sag(world, ball, 240);
        }

        float soft = WorstCaseSag(1f);
        float mid = WorstCaseSag(3f);
        float stiff = WorstCaseSag(10f);
        soft.Should().BeGreaterThan(mid);
        mid.Should().BeGreaterThan(stiff);
        stiff.Should().BeApproximately(0f, 5e-2f);
    }

    [Fact]
    public void DampingRatio_ChangesTheTrajectory()
    {
        float[] Trajectory(float dampingRatio)
        {
            using var world = new World();
            (BodyId anchor, BodyId ball) = Rig(world);
            world.Joints.CreateWeld(world.Bodies, new WeldDef
            {
                BodyA = anchor,
                BodyB = ball,
                WorldAnchor = new Vec2(0, -2f),
                Frequency = 2f,
                DampingRatio = dampingRatio,
            });

            float[] samples = new float[120];
            for (int i = 0; i < 120; i++)
            {
                world.Step(Dt);
                samples[i] = world.Bodies.GetTransform(ball).Position.Y;
            }

            return samples;
        }

        Trajectory(0.1f).Should().NotEqual(Trajectory(1.5f));
        Trajectory(0.1f).Should().Equal(Trajectory(0.1f));
    }

    [Fact]
    public void SoftWeld_AllowsTransientPinDriftWhereRigidHolds()
    {
        float KickDepth(float frequency, float dampingRatio)
        {
            using var world = new World();
            (BodyId anchor, BodyId ball) = Rig(world);
            world.Joints.CreateWeld(world.Bodies, new WeldDef
            {
                BodyA = anchor,
                BodyB = ball,
                WorldAnchor = new Vec2(0, -2f),
                Frequency = frequency,
                DampingRatio = dampingRatio,
            });
            world.Bodies.SetLinearVelocity(ball, new Vec2(3f, 0f));

            float deepest = 0f;
            for (int i = 0; i < 120; i++)
            {
                world.Step(Dt);
                deepest = MathF.Max(deepest, MathF.Abs(world.Bodies.GetTransform(ball).Position.X));
            }

            return deepest;
        }

        float rigid = KickDepth(0f, 0.7f);
        float slack = KickDepth(0.3f, 0.1f);
        rigid.Should().BeLessThan(5e-2f);
        slack.Should().BeGreaterThan(rigid + 5e-2f);
    }

    [Fact]
    public void BuilderWithSoftAttach_MatchesDef()
    {
        using var defWorld = new World();
        (BodyId defAnchor, BodyId defBall) = Rig(defWorld);
        defWorld.Joints.CreateWeld(defWorld.Bodies, new WeldDef
        {
            BodyA = defAnchor,
            BodyB = defBall,
            WorldAnchor = new Vec2(0, -2f),
            Frequency = 1.5f,
            DampingRatio = 0.4f,
        });

        using var builderWorld = new World();
        (BodyId anchor, BodyId ball) = Rig(builderWorld);
        var start = WeldJointBuilder<Typestate.Unconfigured>.Create();
        var bodies = start.WithBodies(anchor, ball);
        var pinned = bodies.WithAnchor(new Vec2(0, -2f));
        pinned.WithSoftAttach(1.5f, 0.4f).Build(builderWorld.Bodies, builderWorld.Joints);

        float[] defSamples = new float[120];
        float[] builderSamples = new float[120];
        for (int i = 0; i < 120; i++)
        {
            defWorld.Step(Dt);
            builderWorld.Step(Dt);
            defSamples[i] = defWorld.Bodies.GetTransform(defBall).Position.Y;
            builderSamples[i] = builderWorld.Bodies.GetTransform(ball).Position.Y;
        }

        builderSamples.Should().Equal(defSamples);
    }

    [Fact]
    public void WeldDefGuards_RejectBadAttachTuning()
    {
        Action negativeFrequency = () => _ = new WeldDef { Frequency = -1f };
        Action nanFrequency = () => _ = new WeldDef { Frequency = float.NaN };
        Action infiniteFrequency = () => _ = new WeldDef { Frequency = float.PositiveInfinity };
        Action negativeRatio = () => _ = new WeldDef { DampingRatio = -0.1f };
        Action nanRatio = () => _ = new WeldDef { DampingRatio = float.NaN };
        Action zeroFrequency = () => _ = new WeldDef { Frequency = 0f, DampingRatio = 0.7f };

        negativeFrequency.Should().Throw<ArgumentOutOfRangeException>();
        nanFrequency.Should().Throw<ArgumentOutOfRangeException>();
        infiniteFrequency.Should().Throw<ArgumentOutOfRangeException>();
        negativeRatio.Should().Throw<ArgumentOutOfRangeException>();
        nanRatio.Should().Throw<ArgumentOutOfRangeException>();
        zeroFrequency.Should().NotThrow();
    }

    [Fact]
    public void ExtremeStep_KeepsTheSoftWeldFinite()
    {
        using var world = new World();
        (BodyId anchor, BodyId ball) = Rig(world);
        world.Joints.CreateWeld(world.Bodies, new WeldDef
        {
            BodyA = anchor,
            BodyB = ball,
            WorldAnchor = new Vec2(0, -2f),
            Frequency = 50f,
            DampingRatio = 500f,
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
}
