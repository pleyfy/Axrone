using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class WorldOpsTests
{
    [Fact]
    public void AutoClearForces_False_Keeps_Forces_Across_Steps()
    {
        using var world = new World(new WorldDef { Gravity = Vec3.Zero });
        world.AutoClearForces = false;
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));

        world.Bodies.ApplyForceToCenter(id, new Vec3(6.0f, 0.0f, 0.0f));
        world.Step(1.0f);
        world.Step(1.0f);

        world.Bodies.GetLinearVelocity(id).X.Should().BeApproximately(12.0f, 1e-4f);
    }

    [Fact]
    public void AutoClearForces_True_Default_Clears_After_Step()
    {
        using var world = new World(new WorldDef { Gravity = Vec3.Zero });
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));

        world.Bodies.ApplyForceToCenter(id, new Vec3(6.0f, 0.0f, 0.0f));
        world.Step(1.0f);
        world.Step(1.0f);

        world.Bodies.GetLinearVelocity(id).X.Should().BeApproximately(6.0f, 1e-4f);
    }

    [Fact]
    public void ClearForces_Drops_PendingLoads()
    {
        using var world = new World(new WorldDef { Gravity = Vec3.Zero });
        world.AutoClearForces = false;
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));

        world.Bodies.ApplyForceToCenter(id, new Vec3(6.0f, 0.0f, 0.0f));
        world.ClearForces();
        world.Step(1.0f);

        world.Bodies.GetLinearVelocity(id).X.Should().BeApproximately(0.0f, 1e-6f);
    }

    [Fact]
    public void WakeAllBodies_Resumes_Gravity()
    {
        using var world = new World();
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Bodies.SetAwake(id, false);

        world.Step(1.0f / 60.0f);
        world.Bodies.GetTransform(id).Position.Should().Be(Vec3.Zero);

        world.WakeAllBodies();
        world.Step(1.0f / 60.0f);
        world.Bodies.GetTransform(id).Position.Y.Should().BeLessThan(0.0f);
    }

    [Fact]
    public void GetStatistics_Counts_Population()
    {
        using var world = new World();
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, id, Vec3.Zero, 0.5f);
        BodyId other = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Joints.CreateDistance(world.Bodies, id, other, Vec3.Zero, Vec3.Zero, 1.0f);

        WorldStatistics3D stats = world.GetStatistics();

        stats.BodyCount.Should().Be(2);
        stats.ShapeCount.Should().Be(1);
        stats.JointCount.Should().Be(1);
        stats.ContactCount.Should().Be(0);
    }

    [Fact]
    public void Validate_Detects_DanglingJointReferences()
    {
        using var world = new World();
        BodyId a = world.Bodies.Create(new BodyDef());
        BodyId b = world.Bodies.Create(new BodyDef());
        world.Joints.CreateHinge(world.Bodies, a, b, Vec3.Zero, Vec3.Zero, new Vec3(0.0f, 1.0f, 0.0f), new Vec3(0.0f, 1.0f, 0.0f));

        world.Validate().Should().BeTrue();

        world.Bodies.Destroy(b);
        world.Validate().Should().BeFalse();
    }

    [Fact]
    public void ShiftOrigin_Translates_BodiesExactly()
    {
        using var world = new World();
        BodyId id = world.Bodies.Create(new BodyDef { Position = new Vec3(1000.0f, 0.0f, 0.0f) });

        world.ShiftOrigin(new Vec3(500.0f, 0.0f, 0.0f));

        world.Bodies.GetTransform(id).Position.Should().Be(new Vec3(500.0f, 0.0f, 0.0f));
    }
}
