using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class ContactEventsTests
{
    private sealed class Listener : IContactEvents3D
    {
        public int PreCount;
        public int PostCount;
        public float MaxPostNormalImpulse;
        public float ForceRestitution = -1.0f;

        public void PreSolve(ref Contact3D contact)
        {
            PreCount++;
            if (ForceRestitution >= 0.0f)
            {
                contact.Restitution = ForceRestitution;
            }
        }

        public void PostSolve(in Contact3D contact)
        {
            PostCount++;
            Manifold3D manifold = contact.Manifold;
            for (int p = 0; p < manifold.Count; p++)
            {
                MaxPostNormalImpulse = MathF.Max(MaxPostNormalImpulse, manifold[p].NormalImpulse);
            }
        }
    }

    private static (World World, BodyId Ball) FallingBallWorld(float restitution)
    {
        var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground, new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f),
            material: new PhysicsMaterial(0.0f, restitution));
        BodyId ball = world.Bodies.Create(new BodyDef());
        world.Bodies.SetMassData(ball, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 1.0f,
            material: new PhysicsMaterial(0.0f, restitution));
        world.Bodies.SetTransform(ball, new Vec3(0.0f, 3.0f, 0.0f), Quat.Identity);
        return (world, ball);
    }

    [Fact]
    public void Callbacks_Fire_And_Supply_Impulses()
    {
        var (world, _) = FallingBallWorld(0.9f);
        using (world)
        {
            var listener = new Listener();
            world.ContactEvents = listener;

            for (int i = 0; i < 120; i++)
            {
                world.Step(1.0f / 60.0f);
            }

            listener.PreCount.Should().BeGreaterThan(0);
            listener.PostCount.Should().BeGreaterThan(0);
            listener.MaxPostNormalImpulse.Should().BeGreaterThan(0.0f);
        }
    }

    [Fact]
    public void PreSolve_Mutation_Lifts_Rebound()
    {
        float plainUp = 0.0f;
        var (worldPlain, ballPlain) = FallingBallWorld(0.0f);
        using (worldPlain)
        {
            for (int i = 0; i < 30; i++)
            {
                worldPlain.Step(1.0f / 60.0f);
            }

            for (int i = 0; i < 30; i++)
            {
                worldPlain.Step(1.0f / 60.0f);
                plainUp = MathF.Max(plainUp, worldPlain.Bodies.GetLinearVelocity(ballPlain).Y);
            }
        }

        var (worldBoosted, ballBoosted) = FallingBallWorld(0.0f);
        using (worldBoosted)
        {
            worldBoosted.ContactEvents = new Listener { ForceRestitution = 1.0f };
            float boostedUp = 0.0f;
            for (int i = 0; i < 60; i++)
            {
                worldBoosted.Step(1.0f / 60.0f);
                boostedUp = MathF.Max(boostedUp, worldBoosted.Bodies.GetLinearVelocity(ballBoosted).Y);
            }

            plainUp.Should().BeLessThanOrEqualTo(0.1f);
            boostedUp.Should().BeGreaterThan(1.0f);
        }
    }
}
