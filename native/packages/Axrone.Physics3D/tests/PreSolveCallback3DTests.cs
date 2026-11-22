using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Pre-solve seam gate: a caller that rewrites a pair's tuning once per step
/// must have that rewrite hold for the whole step, however many CCD slices the
/// step split into, and both callback points must fire once per solid pair per
/// step rather than once per slice or not at all. A ball driven into the ground
/// with its restitution forced to zero is the witness: the materials would
/// bounce it at 0.9 and only the handler can keep it at zero.
/// </summary>
public sealed class PreSolveCallback3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Radius = 0.5f;
    private const float ImpactSpeed = 9.0f;
    private const float Restitution = 0.9f;
    private readonly ITestOutputHelper _output;

    public PreSolveCallback3DTests(ITestOutputHelper output) => _output = output;

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void PreSolve_FiresOnceForThePair_PerSliceCount(int slices)
    {
        Run(slices, forceNoBounce: true, out float rebound, out int preSolveCalls, out int postSolveCalls);

        _output.WriteLine(
            $"slices={slices}: pre-solve calls {preSolveCalls}, post-solve calls {postSolveCalls}, " +
            $"rebound {rebound:0.#####} m/s");
        preSolveCalls.Should().Be(1,
            $"a step of {slices} slice(s) over one solid pair ran the pre-solve hook {preSolveCalls} time(s); " +
            "it is a per-step surface, so the pair must be offered exactly once.");
        postSolveCalls.Should().Be(1,
            $"a step of {slices} slice(s) reported post-solve impulses {postSolveCalls} time(s) for one solid " +
            "pair; that surface is per-step too.");
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void ForcedRestitution_HoldsAcrossEverySlice(int slices)
    {
        Run(slices, forceNoBounce: true, out float forced, out _, out _);
        Run(slices, forceNoBounce: false, out float material, out _, out _);

        _output.WriteLine(
            $"slices={slices}: handler-forced rebound {forced:0.#####} m/s, material rebound {material:0.#####} m/s");
        forced.Should().Be(0.0f,
            $"the handler forced restitution 0 and the ball still left the ground at {forced:0.#####} m/s over " +
            $"{slices} slices, so a slice after the callback fell back to the material coefficients.");
        material.Should().BeGreaterThan(Restitution * ImpactSpeed * 0.5f,
            $"the same scene without a rewrite only rebounded {material:0.#####} m/s, so the zero above would be " +
            "the scene refusing to bounce rather than the rewrite winning.");
    }

    private static void Run(int slices, bool forceNoBounce, out float rebound, out int preSolveCalls, out int postSolveCalls)
    {
        using World world = Build(slices);
        BodyId ball = Ball(world);
        CallbackCounters counters = new() { ForceNoBounce = forceNoBounce };
        world.Step(Dt, new Handlers(), ref counters);

        rebound = world.Bodies.GetLinearVelocity(ball).Y;
        preSolveCalls = counters.PreSolveCalls;
        postSolveCalls = counters.PostSolveCalls;
    }

    private static World Build(int slices) => new(new WorldDef
    {
        CcdSweepStep = (ImpactSpeed * Dt) / slices,
        MaxCcdSubsteps = 8,
        Gravity = Vec3.Zero,
    });

    private static BodyId Ball(World world)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground,
            new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 1.0f, default, new PhysicsMaterial(0.8f, 0.0f));

        BodyId ball = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, Radius - 0.05f, 0.0f),
            LinearVelocity = new Vec3(0.0f, -ImpactSpeed, 0.0f),
            Bullet = true,
            AllowSleep = false,
        });
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, Radius,
            1.0f, default, new PhysicsMaterial(0.0f, Restitution));
        return ball;
    }

    private sealed class CallbackCounters
    {
        public bool ForceNoBounce;
        public int PreSolveCalls;
        public int PostSolveCalls;
    }

    private readonly struct Handlers : IContactSolverCallbacks<Contact3D, Manifold3D, CallbackCounters>
    {
        public static void OnPreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref CallbackCounters context)
        {
            context.PreSolveCalls++;
            if (context.ForceNoBounce)
            {
                tuning.Restitution = 0.0f;
            }
        }

        public static void OnPostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref CallbackCounters context)
        {
            context.PostSolveCalls++;
        }
    }
}
