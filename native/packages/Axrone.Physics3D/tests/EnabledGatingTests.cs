using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class EnabledGatingTests
{
    private static (World World, BodyId Ball, ShapeId Shape) BallWorld()
    {
        var world = new World();
        BodyId ball = world.Bodies.Create(new BodyDef { Position = new Vec3(0.0f, 0.0f, 5.0f) });
        world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        ShapeId shape = world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 0.5f);
        return (world, ball, shape);
    }

    [Fact]
    public void Disabled_Body_Is_Invisible_To_Every_Query_Path()
    {
        var (world, ball, _) = BallWorld();
        using (world)
        {
            world.Bodies.SetEnabled(ball, false);
            var ray = new Ray3D(new Vec3(0.0f, 0.0f, -5.0f), new Vec3(0.0f, 0.0f, 1.0f));

            Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
            world.Raycast(in ray, 20.0f, hits).Should().Be(0);
            world.Raycast(in ray, 20.0f, hits, new QueryFilter(0xFFFFu, 0xFFFFu, 0)).Should().Be(0);
            world.RaycastClosest(in ray, 20.0f, out _).Should().BeFalse();
            Span<ShapeId> overlaps = stackalloc ShapeId[4];
            world.OverlapAabb(new Aabb3D(new Vec3(-1.0f, -1.0f, 4.0f), new Vec3(1.0f, 1.0f, 6.0f)), overlaps).Should().Be(0);
            Span<ClosestPointHit3D> points = stackalloc ClosestPointHit3D[4];
            world.QueryPoint(new Vec3(0.0f, 0.0f, 5.0f), 3.0f, points).Should().Be(0);

            world.Bodies.SetEnabled(ball, true);
            world.Raycast(in ray, 20.0f, hits).Should().Be(1);
            world.OverlapAabb(new Aabb3D(new Vec3(-1.0f, -1.0f, 4.0f), new Vec3(1.0f, 1.0f, 6.0f)), overlaps).Should().Be(1);
        }
    }

    [Fact]
    public void Disabled_Body_Produces_No_Contacts_And_Reenable_Resumes()
    {
        var world = new World();
        using (world)
        {
            BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
            world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground, new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f));
            BodyId ball = world.Bodies.Create(new BodyDef());
            world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
            world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 1.0f);
            world.Bodies.SetTransform(ball, new Vec3(0.0f, 0.5f, 0.0f), Quat.Identity);

            world.Bodies.SetEnabled(ball, false);
            world.Step(1.0f / 60.0f);
            world.ContactCount.Should().Be(0);
            world.Bodies.GetTransform(ball).Position.Y.Should().BeApproximately(0.5f, 1e-5f);

            world.Bodies.SetEnabled(ball, true);
            world.Step(1.0f / 60.0f);
            world.ContactCount.Should().BeGreaterThan(0);
        }
    }

    [Fact]
    public void Disabled_Body_Does_Not_Accumulate_Forces_Torque_Or_Impulses()
    {
        using var world = new World(new WorldDef { Gravity = Vec3.Zero });
        BodyId ball = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Bodies.SetEnabled(ball, false);

        world.Bodies.ApplyForce(ball, new Vec3(100.0f, 0.0f, 0.0f));
        world.Bodies.ApplyForce(ball, new Vec3(0.0f, 100.0f, 0.0f), new Vec3(5.0f, 0.0f, 0.0f));
        world.Bodies.ApplyTorque(ball, new Vec3(0.0f, 0.0f, 100.0f));
        world.Bodies.ApplyLinearImpulse(ball, new Vec3(50.0f, 0.0f, 0.0f));
        world.Bodies.ApplyAngularImpulse(ball, new Vec3(0.0f, 0.0f, 50.0f));

        world.Bodies.SetEnabled(ball, true);
        world.Bodies.SetAwake(ball, true);
        world.Step(1.0f);

        world.Bodies.GetLinearVelocity(ball).Should().Be(Vec3.Zero);
        world.Bodies.GetAngularVelocity(ball).Should().Be(Vec3.Zero);
    }
}
