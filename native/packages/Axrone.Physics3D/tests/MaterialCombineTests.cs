using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class MaterialCombineTests
{
    private static ShapeRecord Record(PhysicsMaterial material, SurfaceSettings surface)
    {
        return new ShapeRecord
        {
            Live = true,
            Material = material,
            Surface = surface,
        };
    }

    [Fact]
    public void Friction_Canonical_Is_GeometricMean()
    {
        ShapeRecord a = Record(new PhysicsMaterial(0.5f, 0.0f), default);
        ShapeRecord b = Record(new PhysicsMaterial(0.8f, 0.0f), default);

        SurfaceSettings.MixFriction(in a, in b, false).Should().BeApproximately(MathF.Sqrt(0.5f * 0.8f), 1e-5f);
    }

    [Fact]
    public void Friction_Every_Mode_Blends_Correctly()
    {
        ShapeRecord a = Record(new PhysicsMaterial(0.5f, 0.0f), default);
        ShapeRecord b = Record(new PhysicsMaterial(0.8f, 0.0f), default);

        foreach (CombineMode mode in new[] { CombineMode.Average, CombineMode.Minimum, CombineMode.Maximum, CombineMode.Multiply })
        {
            a.Surface = a.Surface with { FrictionCombine = mode };
            float expected = mode switch
            {
                CombineMode.Average => 0.65f,
                CombineMode.Minimum => 0.5f,
                CombineMode.Maximum => 0.8f,
                _ => MathF.Sqrt(0.4f),
            };
            SurfaceSettings.MixFriction(in a, in b, false).Should().BeApproximately(expected, 1e-5f);
        }
    }

    [Fact]
    public void Mode_Precedence_Goes_To_Explicit_Left_Then_Right()
    {
        ShapeRecord a = Record(new PhysicsMaterial(0.5f, 0.0f), default);
        ShapeRecord b = Record(new PhysicsMaterial(0.8f, 0.0f), default);

        b.Surface = b.Surface with { FrictionCombine = CombineMode.Average };
        SurfaceSettings.MixFriction(in a, in b, false).Should().BeApproximately(0.65f, 1e-5f);

        a.Surface = a.Surface with { FrictionCombine = CombineMode.Minimum };
        SurfaceSettings.MixFriction(in a, in b, false).Should().BeApproximately(0.5f, 1e-5f);
    }

    [Fact]
    public void Static_Channel_Inherits_Material_When_Zero()
    {
        ShapeRecord a = Record(new PhysicsMaterial(0.6f, 0.0f), new SurfaceSettings(0.0f, 0.0f, CombineMode.Maximum, CombineMode.Inherit));
        ShapeRecord b = Record(new PhysicsMaterial(0.2f, 0.0f), default);

        SurfaceSettings.MixFriction(in a, in b, true).Should().BeApproximately(0.6f, 1e-5f);
        SurfaceSettings.MixFriction(in a, in b, false).Should().BeApproximately(0.6f, 1e-5f);
    }

    [Fact]
    public void Restitution_Multiply_Is_Product_And_Default_Is_Max()
    {
        ShapeRecord a = Record(new PhysicsMaterial(0.0f, 0.5f), default);
        ShapeRecord b = Record(new PhysicsMaterial(0.0f, 0.8f), default);

        SurfaceSettings.MixRestitution(in a, in b).Should().BeApproximately(0.8f, 1e-5f);

        a.Surface = a.Surface with { RestitutionCombine = CombineMode.Multiply };
        SurfaceSettings.MixRestitution(in a, in b).Should().BeApproximately(0.4f, 1e-5f);
    }

    [Fact]
    public void Contacts_Carry_Blended_Values_From_Build()
    {
        using var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground, new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f),
            material: new PhysicsMaterial(0.5f, 0.0f));
        BodyId ball = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 1.0f,
            material: new PhysicsMaterial(0.8f, 0.0f), surface: new SurfaceSettings(0.0f, 0.0f, CombineMode.Average, CombineMode.Inherit));
        world.Bodies.SetTransform(ball, new Vec3(0.0f, 0.9f, 0.0f), Quat.Identity);

        world.Step(1.0f / 60.0f);

        world.ContactCount.Should().BeGreaterThan(0);
        Contact3D contact = world.GetContact(0);
        contact.Blended.Should().BeTrue();
        contact.Friction.Should().BeApproximately(0.65f, 1e-5f);
        contact.StaticFriction.Should().BeApproximately(0.65f, 1e-5f);
    }

    [Fact]
    public void StickPhase_Uses_Static_When_Sliding_Uses_Dynamic()
    {
        using var tree = new DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink>();
        var bodies = new BodyStore();
        var shapes = new ShapeStore();

        BodyId ground = bodies.Create(new BodyDef { Type = BodyType.Static });
        ShapeId groundShape = shapes.AttachSphere(bodies, tree, ground, new Vec3(0.0f, -100.0f, 0.0f), 100.0f);

        BodyId ball = bodies.Create(new BodyDef());
        bodies.SetMassData(ball, 1.0f, new Vec3(0.0f, 0.0f, 0.0f));
        ShapeId ballShape = shapes.AttachSphere(bodies, tree, ball, Vec3.Zero, 1.0f);
        bodies.SetTransform(ball, new Vec3(0.0f, 0.9f, 0.0f), Quat.Identity);
        shapes.SyncBody(bodies, tree, ball);

        Penetration3D.SphereSphere(shapes.GetWorldSphere(ballShape), shapes.GetWorldSphere(groundShape), out Manifold3D manifold).Should().BeTrue();
        manifold.Count.Should().Be(1);

        ContactPoint3D point = manifold[0];
        point.NormalImpulse = 10.0f;
        point.TangentImpulse1 = 0.0f;
        point.TangentImpulse2 = 0.0f;
        manifold.SetPoint(0, point);

        var contact = new Contact3D
        {
            BodyA = ball,
            BodyB = ground,
            ShapeA = ballShape,
            ShapeB = groundShape,
            Manifold = manifold,
            StaticFriction = 100.0f,
            Friction = 0.001f,
            Restitution = 0.0f,
            Blended = true,
        };

        // Below the slop threshold the static cone governs: a strong static cone converts
        // the creep into rolling (5/7 of the initial speed); a negligible static cone barely touches it.
        var weak = contact;
        weak.StaticFriction = 1e-7f;

        bodies.SetTransform(ball, new Vec3(0.0f, 0.9f, 0.0f), Quat.Identity);
        bodies.SetLinearVelocity(ball, new Vec3(0.004f, 0.0f, 0.0f));
        bodies.SetAngularVelocity(ball, Vec3.Zero);
        ContactSolver.SolveVelocityPass(bodies, shapes, new[] { contact }.AsSpan(), 16);
        float rollingOut = bodies.GetLinearVelocity(ball).X;

        bodies.SetTransform(ball, new Vec3(0.0f, 0.9f, 0.0f), Quat.Identity);
        bodies.SetLinearVelocity(ball, new Vec3(0.004f, 0.0f, 0.0f));
        bodies.SetAngularVelocity(ball, Vec3.Zero);
        ContactSolver.SolveVelocityPass(bodies, shapes, new[] { weak }.AsSpan(), 16);
        float slipperyOut = bodies.GetLinearVelocity(ball).X;

        rollingOut.Should().BeApproximately(0.004f * 5.0f / 7.0f, 0.0006f);
        slipperyOut.Should().BeGreaterThan(0.0039f);
    }
}
