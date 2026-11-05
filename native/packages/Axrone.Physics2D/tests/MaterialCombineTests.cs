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
        float maxBounce = BounceApex(0.8f, 0.4f, CombineMode.Max, CombineMode.Max);
        float averageBounce = BounceApex(0.8f, 0.4f, CombineMode.Average, CombineMode.Average);
        float minBounce = BounceApex(0.8f, 0.4f, CombineMode.Min, CombineMode.Min);
        float multiplyBounce = BounceApex(0.8f, 0.4f, CombineMode.Multiply, CombineMode.Multiply);

        maxBounce.Should().BeGreaterThan(averageBounce);
        averageBounce.Should().BeGreaterThan(minBounce);
        minBounce.Should().BeGreaterThan(multiplyBounce);
        multiplyBounce.Should().BeGreaterThan(0.5f, "even the weakest rule must reverse the drop visibly");
    }

    [Fact]
    public void RestitutionSidesMatch_ModesAgreeAndActuallyBounce()
    {
        float maxBounce = BounceApex(0.6f, 0.6f, CombineMode.Max, CombineMode.Max);
        float averageBounce = BounceApex(0.6f, 0.6f, CombineMode.Average, CombineMode.Average);
        float minBounce = BounceApex(0.6f, 0.6f, CombineMode.Min, CombineMode.Min);
        float multiplyBounce = BounceApex(0.6f, 0.6f, CombineMode.Multiply, CombineMode.Multiply);

        maxBounce.Should().BeApproximately(averageBounce, 1e-3f);
        maxBounce.Should().BeApproximately(minBounce, 1e-3f);
        maxBounce.Should().BeGreaterThan(1f, "a symmetric 0.6 pair must rebound near 0.6 squared of the drop height");

        TunedRestitution(0.6f, CombineMode.Multiply, 0.6f, CombineMode.Multiply)
            .Should().BeApproximately(0.36f, Tolerance);
        multiplyBounce.Should().BeLessThan(averageBounce,
            "the multiplier rule is legitimately weaker: 0.6 times 0.6, not 0.6");
        multiplyBounce.Should().BeGreaterThan(0.5f);
    }

    [Fact]
    public void RestitutionTuning_MixesValuesThroughTheLargerSidesRule()
    {
        TunedRestitution(0.8f, CombineMode.Max, 0.4f, CombineMode.Max).Should().BeApproximately(0.8f, Tolerance);
        TunedRestitution(0.8f, CombineMode.Average, 0.4f, CombineMode.Average).Should().BeApproximately(0.6f, Tolerance);
        TunedRestitution(0.8f, CombineMode.Min, 0.4f, CombineMode.Min).Should().BeApproximately(0.4f, Tolerance);
        TunedRestitution(0.8f, CombineMode.Multiply, 0.4f, CombineMode.Multiply).Should().BeApproximately(0.32f, Tolerance);
    }

    [Fact]
    public void Restitution_LargerSidePicksTheRuleWhicheverBodyItCarries()
    {
        TunedRestitution(0.8f, CombineMode.Min, 0.4f, CombineMode.Max).Should().BeApproximately(0.4f, Tolerance);
        TunedRestitution(0.8f, CombineMode.Max, 0.4f, CombineMode.Min).Should().BeApproximately(0.8f, Tolerance);
        TunedRestitution(0.4f, CombineMode.Min, 0.8f, CombineMode.Max).Should().BeApproximately(0.8f, Tolerance);

        float mixedWithHardSideChoosingMin = BounceApex(0.8f, 0.4f, CombineMode.Min, CombineMode.Max);
        float pureMin = BounceApex(0.8f, 0.4f, CombineMode.Min, CombineMode.Min);
        float pureMax = BounceApex(0.8f, 0.4f, CombineMode.Max, CombineMode.Max);
        mixedWithHardSideChoosingMin.Should().Be(pureMin);
        mixedWithHardSideChoosingMin.Should().NotBe(pureMax);
    }

    private static PhysicsMaterial Bouncy(float restitution, CombineMode mode) =>
        new(0.4f, restitution, 0.4f, 0f, 0f, CombineMode.Max, mode);

    private static float TunedRestitution(
        float ballRestitution, CombineMode ballMode, float groundRestitution, CombineMode groundMode)
    {
        using var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-20f, 0f), new(20f, 0f), new(20f, 1f), new(-20f, 1f) },
            material: Bouncy(groundRestitution, groundMode));

        BodyId ball = world.Bodies.Create(
            new BodyDef { Position = new Vec2(0f, 0.39f), LinearVelocity = new Vec2(0f, -4f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, Vec2.Zero, 0.4f, material: Bouncy(ballRestitution, ballMode));
        world.Step(1f / 60f);

        return world.GetContact(0).Tuning.Restitution;
    }

    private static float BounceApex(
        float ballRestitution, float groundRestitution, CombineMode ballMode, CombineMode groundMode)
    {
        using var world = new World();
        BodyId ball = AddDroppingBall(world, Bouncy(ballRestitution, ballMode), Bouncy(groundRestitution, groundMode));
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

        bounced.Should().BeTrue("the combined restitution must reverse the fall before any apex is meaningful");
        return apex;
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
