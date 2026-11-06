using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class MaterialCombineTests
{
    private static PhysicsMaterial Mat(float friction, CombineMode mode)
    {
        return new PhysicsMaterial(friction, 0.0f, friction, 0.0f, 0.0f, mode, CombineMode.Max);
    }

    [Fact]
    public void Friction_DefaultModes_MaxWins()
    {
        float combined = MaterialCombiner.CombineFriction(0.5f, 0.8f, CombineMode.Max, CombineMode.Max);

        combined.Should().BeApproximately(0.8f, 1e-6f);
    }

    [Fact]
    public void Friction_Every_Mode_Blends_Correctly()
    {
        PhysicsMaterial left = Mat(0.5f, CombineMode.Multiply);
        PhysicsMaterial right = new(0.8f, 0.0f);

        foreach (CombineMode mode in new[] { CombineMode.Average, CombineMode.Min, CombineMode.Max, CombineMode.Multiply })
        {
            PhysicsMaterial tuned = new(0.5f, 0.0f, 0.5f, 0.0f, 0.0f, mode, CombineMode.Max);
            float expected = mode switch
            {
                CombineMode.Average => 0.65f,
                CombineMode.Min => 0.5f,
                CombineMode.Max => 0.8f,
                _ => 0.4f,
            };
            ContactSolver.DefaultTuning(in tuned, in right).Friction
                .Should().BeApproximately(expected, 1e-5f);
        }
    }

    [Fact]
    public void Friction_Mode_Comes_From_Slower_Side()
    {
        PhysicsMaterial strong = new(0.8f, 0.0f, 0.8f, 0.0f, 0.0f, CombineMode.Average, CombineMode.Max);
        PhysicsMaterial slow = new(0.5f, 0.0f, 0.5f, 0.0f, 0.0f, CombineMode.Min, CombineMode.Max);

        ContactSolver.DefaultTuning(in strong, in slow).Friction.Should().BeApproximately(0.5f, 1e-5f);
    }

    [Fact]
    public void Restitution_Mode_Comes_From_Faster_Side()
    {
        PhysicsMaterial dull = new(0.0f, 0.5f, 0.0f, 0.0f, 0.0f, CombineMode.Max, CombineMode.Min);
        PhysicsMaterial bouncy = new(0.0f, 0.8f, 0.0f, 0.0f, 0.0f, CombineMode.Max, CombineMode.Average);

        ContactSolver.DefaultTuning(in dull, in bouncy).Restitution.Should().BeApproximately(0.65f, 1e-5f);
    }

    [Fact]
    public void DefaultTuning_DynamicFriction_Mirrors_Static_When_Unset()
    {
        PhysicsMaterial a = new(0.6f, 0.0f);
        PhysicsMaterial b = new(0.6f, 0.0f);

        ContactTuning tuning = ContactSolver.DefaultTuning(in a, in b);

        tuning.Friction.Should().BeApproximately(0.6f, 1e-6f);
        tuning.DynamicFriction.Should().BeApproximately(0.6f, 1e-6f);
    }

    [Fact]
    public void DefaultTuning_Keeps_SlideRatio_Of_Dynamic_Friction()
    {
        PhysicsMaterial a = new(0.6f, 0.0f, 0.6f, 0.3f, 0.0f, CombineMode.Max, CombineMode.Max);
        PhysicsMaterial b = new(0.6f, 0.0f, 0.6f, 0.3f, 0.0f, CombineMode.Max, CombineMode.Max);

        ContactTuning tuning = ContactSolver.DefaultTuning(in a, in b);

        tuning.Friction.Should().BeApproximately(0.6f, 1e-6f);
        tuning.DynamicFriction.Should().BeApproximately(0.3f, 1e-6f);
    }

    [Fact]
    public void Contacts_Carry_DefaultTuning_At_Init()
    {
        using var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground, new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f),
            material: new PhysicsMaterial(0.5f, 0.0f, 0.5f, 0.0f, 0.0f, CombineMode.Average, CombineMode.Max));
        BodyId ball = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 1.0f,
            material: new PhysicsMaterial(0.8f, 0.0f));
        world.Bodies.SetTransform(ball, new Vec3(0.0f, 0.9f, 0.0f), Quat.Identity);

        world.Step(1.0f / 60.0f);

        world.ContactCount.Should().BeGreaterThan(0);
        Contact3D contact = world.GetContact(0);
        contact.Tuning.Friction.Should().BeApproximately(0.65f, 1e-5f);
        contact.Tuning.DynamicFriction.Should().BeApproximately(0.845f, 1e-4f);
        contact.Tuning.RestitutionThreshold.Should().BeApproximately(PhysicsConstants.VelocityThreshold, 1e-6f);
    }

    [Fact]
    public void SlidingFriction_Scales_With_DynamicRatio()
    {
        using var tree = new Axrone.Geometry.DynamicAabbTree<ShapeId, Axrone.Geometry.SurfaceAreaHeuristicStrategy, Axrone.Geometry.NullSpatialMetricsSink>();
        var bodies = new BodyStore();
        var shapes = new ShapeStore();

        BodyId ground = bodies.Create(new BodyDef { Type = BodyType.Static });
        ShapeId groundShape = shapes.AttachSphere(bodies, tree, ground, new Vec3(0.0f, -100.0f, 0.0f), 100.0f);

        BodyId ball = bodies.Create(new BodyDef { Position = new Vec3(0.0f, 0.9f, 0.0f) });
        ShapeId ballShape = shapes.AttachSphere(bodies, tree, ball, Vec3.Zero, 1.0f);
        shapes.SyncBody(bodies, tree, ball);

        Penetration3D.SphereSphere(shapes.GetWorldSphere(ballShape), shapes.GetWorldSphere(groundShape), out Manifold3D manifold).Should().BeTrue();
        manifold.Count.Should().Be(1);
        ContactPoint3D point = manifold[0];
        point.NormalImpulse = 10.0f;
        manifold.SetPoint(0, point);

        var grip = new Contact3D
        {
            BodyA = ball,
            BodyB = ground,
            ShapeA = ballShape,
            ShapeB = groundShape,
            Manifold = manifold,
            Tuning = new ContactTuning
            {
                Friction = 100.0f,
                DynamicFriction = 100.0f,
                RestitutionThreshold = 1.0f,
            },
        };
        var slippery = grip;
        slippery.Tuning = new ContactTuning
        {
            Friction = 100.0f,
            DynamicFriction = 1e-5f,
            RestitutionThreshold = 1.0f,
        };

        bodies.SetLinearVelocity(ball, new Vec3(0.004f, 0.0f, 0.0f));
        ContactSolver.SolveVelocityPass(bodies, shapes, new[] { grip }.AsSpan(), 16);
        float rollingOut = bodies.GetLinearVelocity(ball).X;

        bodies.SetLinearVelocity(ball, new Vec3(0.004f, 0.0f, 0.0f));
        bodies.SetAngularVelocity(ball, Vec3.Zero);
        ContactSolver.SolveVelocityPass(bodies, shapes, new[] { slippery }.AsSpan(), 16);
        float slipperyOut = bodies.GetLinearVelocity(ball).X;

        rollingOut.Should().BeApproximately(0.004f * 5.0f / 7.0f, 0.0006f);
        slipperyOut.Should().BeGreaterThan(0.0039f);
    }
}
