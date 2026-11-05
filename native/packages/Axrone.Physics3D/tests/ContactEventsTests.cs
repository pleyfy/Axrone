using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class ContactEventsTests
{
    private struct RunState
    {
        public int PreCount;
        public int PostCount;
        public float MaxNormal0;
        public float MaxTangent0;
        public float ForceRestitution;
        public int ReportedPointCount;
    }

    private struct TestHandler : IContactSolverCallbacks<Contact3D, Manifold3D, RunState>
    {
        public static void OnPreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref RunState state)
        {
            state.PreCount++;
            if (state.ForceRestitution >= 0.0f)
            {
                tuning.Restitution = state.ForceRestitution;
            }
        }

        public static void OnPostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref RunState state)
        {
            state.PostCount++;
            state.MaxNormal0 = MathF.Max(state.MaxNormal0, impulses.NormalAt(0));
            state.MaxTangent0 = MathF.Max(state.MaxTangent0, impulses.TangentAt(0));
            state.ReportedPointCount = impulses.Count;
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
            var state = new RunState { ForceRestitution = -1.0f };
            for (int i = 0; i < 120; i++)
            {
                world.Step(1.0f / 60.0f, new TestHandler(), ref state);
            }

            state.PreCount.Should().BeGreaterThan(0);
            state.PostCount.Should().BeGreaterThan(0);
            state.MaxNormal0.Should().BeGreaterThan(0.0f);
        }
    }

    [Fact]
    public void PreSolve_Tuning_Mutation_Lifts_Rebound()
    {
        var (plainWorld, plainBall) = FallingBallWorld(0.0f);
        float plainUp = 0.0f;
        using (plainWorld)
        {
            for (int i = 0; i < 60; i++)
            {
                plainWorld.Step(1.0f / 60.0f);
                plainUp = MathF.Max(plainUp, plainWorld.Bodies.GetLinearVelocity(plainBall).Y);
            }
        }

        var (boostedWorld, boostedBall) = FallingBallWorld(0.0f);
        using (boostedWorld)
        {
            var state = new RunState { ForceRestitution = 1.0f };
            float boostedUp = 0.0f;
            for (int i = 0; i < 60; i++)
            {
                boostedWorld.Step(1.0f / 60.0f, new TestHandler(), ref state);
                boostedUp = MathF.Max(boostedUp, boostedWorld.Bodies.GetLinearVelocity(boostedBall).Y);
            }

            state.PreCount.Should().BeGreaterThan(0);
            plainUp.Should().BeLessThanOrEqualTo(0.1f);
            boostedUp.Should().BeGreaterThan(1.0f);
        }
    }

    [Fact]
    public void PostSolve_Impulses_Match_Manifold()
    {
        var (world, _) = FallingBallWorld(0.5f);
        using (world)
        {
            var state = new RunState { ForceRestitution = -1.0f };
            float manifoldNormal = 0.0f;
            int manifoldCount = 0;
            for (int i = 0; i < 120; i++)
            {
                world.Step(1.0f / 60.0f, new TestHandler(), ref state);
                if (state.PostCount > 0)
                {
                    Contact3D contact = world.GetContact(0);
                    Manifold3D manifold = contact.Manifold;
                    manifoldCount = manifold.Count;
                    manifoldNormal = manifold[0].NormalImpulse;
                }
            }

            state.ReportedPointCount.Should().Be(manifoldCount);
            state.MaxNormal0.Should().BeGreaterThan(0.0f);
            manifoldNormal.Should().BeGreaterThan(0.0f);
            state.MaxNormal0.Should().BeGreaterThanOrEqualTo(manifoldNormal * 0.999f);
        }
    }

    [Fact]
    public void Callback_Emit_Is_SteadyState_Zero_Alloc()
    {
        var (world, _) = FallingBallWorld(0.9f);
        using (world)
        {
            var state = new RunState { ForceRestitution = -1.0f };
            for (int i = 0; i < 60; i++)
            {
                world.Step(1.0f / 60.0f, new TestHandler(), ref state);
            }

            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 240; i++)
            {
                world.Step(1.0f / 60.0f, new TestHandler(), ref state);
            }

            long delta = GC.GetAllocatedBytesForCurrentThread() - before;

            delta.Should().Be(0L);
        }
    }

    [Fact]
    public void Builtin_Notice_Reports_Impulses_And_Resets_Per_Step()
    {
        var (world, _) = FallingBallWorld(0.5f);
        using (world)
        {
            float peakNormal = 0.0f;
            int sawNotice = 0;
            for (int i = 0; i < 120; i++)
            {
                world.Step(1.0f / 60.0f);
                if (world.ContactImpulseEventCount > 0)
                {
                    sawNotice++;
                    ContactImpulseEvent notice = world.GetContactImpulseEvent(0);
                    notice.PointCount.Should().BeGreaterThan(0);
                    peakNormal = MathF.Max(peakNormal, notice.NormalAt(0));
                }

                world.ContactImpulseEventCount.Should().BeLessThanOrEqualTo(1);
            }

            sawNotice.Should().BeGreaterThan(0);
            peakNormal.Should().BeGreaterThan(0.0f);
        }
    }

    [Fact]
    public void Duplicate_Callback_Surface_Is_Gone()
    {
        typeof(World).GetProperty("ContactEvents").Should().BeNull();
        typeof(World).Assembly.GetType("Axrone.Physics3D.IContactEvents3D").Should().BeNull();
    }
}
