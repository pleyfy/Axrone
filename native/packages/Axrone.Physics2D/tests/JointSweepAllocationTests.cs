namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class JointSweepAllocationTests
{
    private const float Dt = 1f / 60f;
    private const int WindowIterations = 200;

    [Fact]
    public void JointSweep_SteadyStateAllocatesZero()
    {
        using var world = new World(new WorldDef { Flags = SolverFlags.Default & ~SolverFlags.SleepingBodies });
        BodyId anchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, 0f) });

        BodyId rod = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, -1f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, rod, Vec2.Zero, 0.25f);
        world.Joints.CreateDistance(world.Bodies, new DistanceDef
        {
            BodyA = anchor,
            BodyB = rod,
            Length = 2f,
            Stiffness = 20f,
            Damping = 1f,
            MinDistance = 1.5f,
            MaxDistance = 3f,
        });

        BodyId spring = world.Bodies.Create(new BodyDef { Position = new Vec2(4f, -1f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, spring, Vec2.Zero, 0.25f);
        world.Joints.CreateSpring(world.Bodies, new SpringDef
        {
            BodyA = anchor,
            BodyB = spring,
            LocalAnchorA = new Vec2(4f, -1f),
            LocalAnchorB = new Vec2(0f, 0f),
            Distance = 2f,
            Stiffness = 20f,
            Damping = 1f,
        });

        BodyId chassis = world.Bodies.Create(new BodyDef { Position = new Vec2(8f, 2f) });
        BodyId wheel = world.Bodies.Create(new BodyDef { Position = new Vec2(8f, 0f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, wheel, Vec2.Zero, 0.4f);
        world.Joints.CreateWheel(world.Bodies, new WheelDef
        {
            BodyA = chassis,
            BodyB = wheel,
            WorldAnchor = new Vec2(8f, 0f),
            WorldAxis = new Vec2(0f, 1f),
            SuspensionFrequency = 1.5f,
            SuspensionDamping = 0.7f,
            EnableLimit = true,
            LowerTranslation = -0.25f,
            UpperTranslation = 0.25f,
        });

        BodyId weldAnchor = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(12f, 0f) });
        BodyId welded = world.Bodies.Create(new BodyDef { Position = new Vec2(12f, -2f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, welded, Vec2.Zero, 0.25f);
        world.Joints.CreateWeld(world.Bodies, new WeldDef
        {
            BodyA = weldAnchor,
            BodyB = welded,
            WorldAnchor = new Vec2(12f, -2f),
            Frequency = 1f,
            DampingRatio = 0.7f,
        });

        for (int i = 0; i < 100; i++)
        {
            world.Step(Dt);
        }

        world.Joints.Count.Should().Be(4);

        for (int window = 0; window < 3; window++)
        {
            Vec2 before = world.Bodies.GetTransform(rod).Position;
            long allocatedBefore = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < WindowIterations; i++)
            {
                world.Step(Dt);
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - allocatedBefore;

            Vec2 after = world.Bodies.GetTransform(rod).Position;
            after.Should().NotBe(before);
            allocated.Should().Be(0L, "the joint sweep must not allocate in steady state");
        }
    }
}
