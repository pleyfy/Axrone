namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class MaterialCombineTests
{
    private const float Tolerance = 1e-4f;

    private static BodyId AddSlidingBlockOnGround(
        World world,
        PhysicsMaterial blockMaterial,
        PhysicsMaterial groundMaterial,
        float initialSpeed = 4f)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-20f, 0f), new(20f, 0f), new(20f, 1f), new(-20f, 1f) },
            material: groundMaterial);

        BodyId block = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.1f), LinearVelocity = new Vec2(initialSpeed, 0f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, block,
            new Vec2[] { new(-0.5f, -0.5f), new(0.5f, -0.5f), new(0.5f, 0.5f), new(-0.5f, 0.5f) },
            material: blockMaterial);
        return block;
    }

    private static PhysicsMaterial Material(float friction, float restitution, CombineMode mode) =>
        new(friction, restitution, friction, 0f, 0f, mode, mode);

    private static float TunedFriction(CombineMode mode)
    {
        using var world = new World();
        AddSlidingBlockOnGround(world, Material(0.4f, 0f, mode), Material(0.8f, 0f, mode));
        world.Step(1f / 60f);

        return world.GetContact(0).Tuning.Friction;
    }

    [Fact]
    public void CombineModes_MixBothSidesThroughTheSelectedRule()
    {
        TunedFriction(CombineMode.Max).Should().BeApproximately(0.8f, Tolerance);
        TunedFriction(CombineMode.Average).Should().BeApproximately(0.6f, Tolerance);
        TunedFriction(CombineMode.Min).Should().BeApproximately(0.4f, Tolerance);
        TunedFriction(CombineMode.Multiply).Should().BeApproximately(0.32f, Tolerance);
    }

    [Fact]
    public void StricterRuleOfTheLowerFrictionSideDecidesWhenModesDiffer()
    {
        using var world = new World();
        AddSlidingBlockOnGround(
            world,
            Material(0.4f, 0f, CombineMode.Min),
            Material(0.8f, 0f, CombineMode.Max));
        world.Step(1f / 60f);

        world.GetContact(0).Tuning.Friction.Should().BeApproximately(0.4f, Tolerance);
    }

    [Fact]
    public void TwoArgMaterial_DefaultsToMaxRule()
    {
        using var world = new World();
        BodyId block = AddSlidingBlockOnGround(
            world,
            new PhysicsMaterial(0.4f, 0f),
            new PhysicsMaterial(0.8f, 0f));
        world.Step(1f / 60f);

        world.GetContact(0).Tuning.Friction.Should().BeApproximately(0.8f, Tolerance);
        block.Should().NotBe(default);
    }

    [Fact]
    public void HigherCombinedFriction_SlowsTheBlockDownMore()
    {
        float looseDistance = Slide(CombineMode.Multiply);
        float stickyDistance = Slide(CombineMode.Max);

        stickyDistance.Should().BeLessThan(looseDistance);
        looseDistance.Should().BeGreaterThan(0f);

        static float Slide(CombineMode mode)
        {
            using var world = new World();
            BodyId block = AddSlidingBlockOnGround(
                world,
                Material(0.4f, 0f, mode),
                Material(0.8f, 0f, mode));
            for (int i = 0; i < 12; i++)
            {
                world.Step(1f / 60f);
            }

            return world.Bodies.GetTransform(block).Position.X;
        }
    }

    [Fact]
    public void RestitutionModes_MixBothSidesThroughTheSelectedRule()
    {
        float maxBounce = Bounce(CombineMode.Max);
        float averageBounce = Bounce(CombineMode.Average);
        float minBounce = Bounce(CombineMode.Min);
        float multiplyBounce = Bounce(CombineMode.Multiply);

        maxBounce.Should().BeGreaterThan(averageBounce);
        averageBounce.Should().BeGreaterThan(minBounce);
        minBounce.Should().BeGreaterThan(multiplyBounce);

        static float Bounce(CombineMode mode)
        {
            using var world = new World();
            BodyId ball = AddDroppingBall(world, Material(0.4f, 0.8f, mode), Material(0.4f, 0.4f, mode));
            float apex = 0f;
            bool bounced = false;
            for (int i = 0; i < 120; i++)
            {
                world.Step(1f / 60f);
                if (!bounced)
                {
                    bounced = world.Bodies.GetLinearVelocity(ball).Y > 0f;
                    continue;
                }

                float y = world.Bodies.GetTransform(ball).Position.Y;
                if (y > apex)
                {
                    apex = y;
                }
            }

            return apex;
        }
    }

    [Fact]
    public void RestitutionSidesMatch_ModesAgree()
    {
        float maxBounce = BounceSymmetric(CombineMode.Max);
        float averageBounce = BounceSymmetric(CombineMode.Average);

        maxBounce.Should().BeApproximately(averageBounce, 1e-3f);

        static float BounceSymmetric(CombineMode mode)
        {
            using var world = new World();
            BodyId ball = AddDroppingBall(world, Material(0.4f, 0.5f, mode), Material(0.4f, 0.5f, mode));
            float apex = 0f;
            bool bounced = false;
            for (int i = 0; i < 120; i++)
            {
                world.Step(1f / 60f);
                if (!bounced)
                {
                    bounced = world.Bodies.GetLinearVelocity(ball).Y > 0f;
                    continue;
                }

                float y = world.Bodies.GetTransform(ball).Position.Y;
                if (y > apex)
                {
                    apex = y;
                }
            }

            return apex;
        }
    }

    private static BodyId AddDroppingBall(World world, PhysicsMaterial ballMaterial, PhysicsMaterial groundMaterial)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-10f, 0f), new(10f, 0f), new(10f, 1f), new(-10f, 1f) },
            material: groundMaterial);

        BodyId ball = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 3f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, Vec2.Zero, 0.4f, material: ballMaterial);
        return ball;
    }

    [Fact]
    public void ConveyorTangentSpeed_DrivesTheFrictionlessBlockAlong()
    {
        using var world = new World();
        AddConveyorGround(world, tangentSpeed: 2f);
        BodyId block = AddFrictionlessBlock(world);
        for (int i = 0; i < 60; i++)
        {
            world.Step(1f / 60f);
        }

        float positiveX = world.Bodies.GetTransform(block).Position.X;
        positiveX.Should().NotBeApproximately(0f, 1e-2f);

        using var negativeWorld = new World();
        AddConveyorGround(negativeWorld, tangentSpeed: -2f);
        BodyId negativeBlock = AddFrictionlessBlock(negativeWorld);
        for (int i = 0; i < 60; i++)
        {
            negativeWorld.Step(1f / 60f);
        }

        float negativeX = negativeWorld.Bodies.GetTransform(negativeBlock).Position.X;
        Math.Sign(negativeX).Should().Be(-Math.Sign(positiveX));

        using var zeroWorld = new World();
        AddConveyorGround(zeroWorld, tangentSpeed: 0f);
        BodyId zeroBlock = AddFrictionlessBlock(zeroWorld);
        for (int i = 0; i < 60; i++)
        {
            zeroWorld.Step(1f / 60f);
        }

        zeroWorld.Bodies.GetTransform(zeroBlock).Position.X.Should().BeApproximately(0f, 1e-2f);
    }

    private static void AddConveyorGround(World world, float tangentSpeed)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-20f, 0f), new(20f, 0f), new(20f, 1f), new(-20f, 1f) },
            material: new PhysicsMaterial(0f, 0f, 0f, 0f, tangentSpeed, CombineMode.Max, CombineMode.Max));
    }

    private static BodyId AddFrictionlessBlock(World world)
    {
        BodyId block = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.05f) });
        world.Bodies.SetMassData(block, 1f, 1f, Vec2.Zero);
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, block,
            new Vec2[] { new(-0.5f, -0.5f), new(0.5f, -0.5f), new(0.5f, 0.5f), new(-0.5f, 0.5f) },
            material: new PhysicsMaterial(0f, 0f));
        return block;
    }
}
