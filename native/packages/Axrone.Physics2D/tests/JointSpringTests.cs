namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class JointSpringTests
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

    private static float SpringDrop(World world, BodyId anchor, BodyId ball, in SpringDef definition, int steps)
    {
        world.Joints.CreateSpring(world.Bodies, in definition);
        for (int i = 0; i < steps; i++)
        {
            world.Step(Dt);
        }

        return world.Bodies.GetTransform(ball).Position.Y;
    }

    [Fact]
    public void CreateSpring_LagsTheRigidRodOnTheWayToRest()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(0, -1f));
        SpringDef def = new()
        {
            BodyA = anchor,
            BodyB = ball,
            Distance = 2f,
            Stiffness = 10f,
            Damping = 0.5f,
        };

        float soft = SpringDrop(world, anchor, ball, in def, 120);

        using var rigidWorld = new World();
        BodyId rigidAnchor = Anchor(rigidWorld);
        BodyId rigidBall = Ball(rigidWorld, new Vec2(0, -1f));
        rigidWorld.Joints.CreateDistance(
            rigidWorld.Bodies, rigidAnchor, rigidBall, new Vec2(0, 0), new Vec2(0, 0), 2f);
        for (int i = 0; i < 120; i++)
        {
            rigidWorld.Step(Dt);
        }

        float rigid = rigidWorld.Bodies.GetTransform(rigidBall).Position.Y;
        soft.Should().BeGreaterThan(rigid + 0.2f);
        rigid.Should().BeApproximately(-2f, 5e-2f);
    }

    [Fact]
    public void CreateSpring_MatchesTheEquivalentSoftDistanceJoint()
    {
        using var springWorld = new World();
        BodyId springAnchor = Anchor(springWorld);
        BodyId springBall = Ball(springWorld, new Vec2(0, -1f));
        SpringDef spring = new()
        {
            BodyA = springAnchor,
            BodyB = springBall,
            Distance = 2f,
            Stiffness = 20f,
            Damping = 1f,
        };
        float springEnd = SpringDrop(springWorld, springAnchor, springBall, in spring, 300);

        using var rodWorld = new World();
        BodyId rodAnchor = Anchor(rodWorld);
        BodyId rodBall = Ball(rodWorld, new Vec2(0, -1f));
        DistanceDef rod = new()
        {
            BodyA = rodAnchor,
            BodyB = rodBall,
            Length = 2f,
            Stiffness = 20f,
            Damping = 1f,
        };
        rodWorld.Joints.CreateDistance(rodWorld.Bodies, in rod);
        for (int i = 0; i < 300; i++)
        {
            rodWorld.Step(Dt);
        }

        float rodEnd = rodWorld.Bodies.GetTransform(rodBall).Position.Y;
        springEnd.Should().Be(rodEnd);
    }

    [Fact]
    public void SpringDistance_ChangesTheOutcome()
    {
        using var shortWorld = new World();
        BodyId shortAnchor = Anchor(shortWorld);
        BodyId shortBall = Ball(shortWorld, new Vec2(0, -1f));
        SpringDef shortSpring = new()
        {
            BodyA = shortAnchor,
            BodyB = shortBall,
            Distance = 2f,
            Stiffness = 50f,
            Damping = 2f,
        };
        float shortEnd = SpringDrop(shortWorld, shortAnchor, shortBall, in shortSpring, 240);

        using var longWorld = new World();
        BodyId longAnchor = Anchor(longWorld);
        BodyId longBall = Ball(longWorld, new Vec2(0, -1f));
        SpringDef longSpring = new()
        {
            BodyA = longAnchor,
            BodyB = longBall,
            Distance = 3f,
            Stiffness = 50f,
            Damping = 2f,
        };
        float longEnd = SpringDrop(longWorld, longAnchor, longBall, in longSpring, 240);

        shortEnd.Should().NotBe(longEnd);
        longEnd.Should().BeLessThan(shortEnd);
    }

    [Fact]
    public void SpringTagIsDistanceKind_AndStaysValid()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        BodyId ball = Ball(world, new Vec2(0, -1f));
        SpringDef def = new() { BodyA = anchor, BodyB = ball, Distance = 2f };
        JointId joint = world.Joints.CreateSpring(world.Bodies, in def);

        joint.Kind.Should().Be(JointKind.Distance);
        world.Joints.IsValid(joint).Should().BeTrue();
    }

    [Fact]
    public void SpringDefGuards_RejectDeadTuning()
    {
        Action zeroStiffness = () => _ = new SpringDef { Stiffness = 0f };
        Action negativeStiffness = () => _ = new SpringDef { Stiffness = -1f };
        Action nanStiffness = () => _ = new SpringDef { Stiffness = float.NaN };
        Action infiniteDistance = () => _ = new SpringDef { Distance = float.PositiveInfinity };
        Action negativeDistance = () => _ = new SpringDef { Distance = -0.5f };
        Action negativeDamping = () => _ = new SpringDef { Damping = -0.1f };
        Action accepted = () => _ = new SpringDef { Distance = 2f, Stiffness = 10f, Damping = 0.5f };

        zeroStiffness.Should().Throw<ArgumentOutOfRangeException>();
        negativeStiffness.Should().Throw<ArgumentOutOfRangeException>();
        nanStiffness.Should().Throw<ArgumentOutOfRangeException>();
        infiniteDistance.Should().Throw<ArgumentOutOfRangeException>();
        negativeDistance.Should().Throw<ArgumentOutOfRangeException>();
        negativeDamping.Should().Throw<ArgumentOutOfRangeException>();
        accepted.Should().NotThrow();
    }

    [Fact]
    public void CreateSpring_RejectsDeadBodies()
    {
        using var world = new World();
        BodyId anchor = Anchor(world);
        SpringDef def = new() { BodyA = anchor, BodyB = BodyId.Invalid };

        Action create = () => world.Joints.CreateSpring(world.Bodies, in def);
        create.Should().Throw<InvalidOperationException>();
    }
}
