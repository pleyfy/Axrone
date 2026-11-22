using System.Collections.Generic;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Rest-closure gate for the 3D position pass: box stacks must settle on their
/// spawn axis instead of tumbling out of the world, warm start must not change
/// that answer, a pair must be corrected the same way however the narrowphase
/// paired its witnesses, and settling scenery must never be corrupted by the
/// body that came to rest on it. Each threshold is the number the scene
/// measures, so a regression reports the value that moved.
/// </summary>
public sealed class RestStability3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int Steps = 900;
    private const int SettleStep = 300;
    private const float WarmAgreementMetres = 0.005f;
    private static readonly Vec3 GroundHalf = new(40.0f, 0.5f, 40.0f);
    private static readonly Vec3 BoxHalf = new(Half, Half, Half);

    private readonly record struct RestReport(
        float MaxTiltDegrees,
        float MaxTiltAfterSettle,
        float MaxLateralMetres,
        float MaxSpinAfterSettle,
        float TopHeightErrorMetres,
        float LowestCentreY,
        float SignedTiltDeltaDegrees);

    [Theory]
    [InlineData(2, 1)]
    [InlineData(3, 1)]
    [InlineData(2, 4)]
    [InlineData(3, 4)]
    public void Stack_Settles_OnItsSpawnAxis_WithAndWithoutWarmStart(int count, int positionIterations)
    {
        RestReport warm = RunStack(count, 10, positionIterations, warmStart: true);
        RestReport cold = RunStack(count, 10, positionIterations, warmStart: false);

        warm.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(count, positionIterations, "warm ON ", warm));
        warm.MaxTiltAfterSettle.Should().BeLessThan(5.0f, Because(count, positionIterations, "warm ON ", warm));
        warm.MaxLateralMetres.Should().BeLessThan(0.05f, Because(count, positionIterations, "warm ON ", warm));
        warm.MaxSpinAfterSettle.Should().BeLessThan(0.1f, Because(count, positionIterations, "warm ON ", warm));
        warm.TopHeightErrorMetres.Should().BeLessThan(0.02f, Because(count, positionIterations, "warm ON ", warm));
        warm.LowestCentreY.Should().BeGreaterThan(0.0f, Because(count, positionIterations, "warm ON ", warm));

        cold.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(count, positionIterations, "warm OFF", cold));
        cold.MaxTiltAfterSettle.Should().BeLessThan(5.0f, Because(count, positionIterations, "warm OFF", cold));
        cold.MaxLateralMetres.Should().BeLessThan(0.05f, Because(count, positionIterations, "warm OFF", cold));
        cold.MaxSpinAfterSettle.Should().BeLessThan(0.1f, Because(count, positionIterations, "warm OFF", cold));
        cold.TopHeightErrorMetres.Should().BeLessThan(0.02f, Because(count, positionIterations, "warm OFF", cold));
        cold.LowestCentreY.Should().BeGreaterThan(0.0f, Because(count, positionIterations, "warm OFF", cold));

        MathF.Abs(warm.TopHeightErrorMetres - cold.TopHeightErrorMetres).Should().BeLessThan(
            WarmAgreementMetres,
            $"carried impulses must not decide whether the stack rests: warm ON err={warm.TopHeightErrorMetres:0.#####} m, " +
            $"warm OFF err={cold.TopHeightErrorMetres:0.#####} m, difference {MathF.Abs(warm.TopHeightErrorMetres - cold.TopHeightErrorMetres):0.#####} m.");
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(8)]
    public void PositionIterationsZero_KeepsTheVelocityPassTiltFree(int count)
    {
        RestReport warm = RunStack(count, 10, 0, warmStart: true);
        RestReport cold = RunStack(count, 10, 0, warmStart: false);

        warm.MaxTiltDegrees.Should().BeLessThan(0.01f, Because(count, 0, "warm ON ", warm));
        warm.MaxSpinAfterSettle.Should().BeLessThan(0.02f, Because(count, 0, "warm ON ", warm));
        warm.MaxLateralMetres.Should().BeLessThan(0.01f, Because(count, 0, "warm ON ", warm));
        cold.MaxTiltDegrees.Should().BeLessThan(0.01f, Because(count, 0, "warm OFF", cold));
        cold.MaxSpinAfterSettle.Should().BeLessThan(0.02f, Because(count, 0, "warm OFF", cold));
        cold.MaxLateralMetres.Should().BeLessThan(0.01f, Because(count, 0, "warm OFF", cold));
    }

    [Fact]
    public void EightStack_HoldsEveryBodyOnItsAxis_WithAndWithoutWarmStart()
    {
        RestReport warm = RunStack(8, 10, 4, warmStart: true);
        RestReport cold = RunStack(8, 10, 4, warmStart: false);

        warm.MaxLateralMetres.Should().BeLessThan(0.5f, Because(8, 4, "warm ON ", warm));
        warm.LowestCentreY.Should().BeGreaterThan(0.0f, Because(8, 4, "warm ON ", warm));
        warm.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(8, 4, "warm ON ", warm));
        warm.TopHeightErrorMetres.Should().BeLessThan(0.06f, Because(8, 4, "warm ON ", warm));

        cold.MaxLateralMetres.Should().BeLessThan(0.5f, Because(8, 4, "warm OFF", cold));
        cold.LowestCentreY.Should().BeGreaterThan(0.0f, Because(8, 4, "warm OFF", cold));
        cold.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(8, 4, "warm OFF", cold));
    }

    [Fact]
    public void DiagonalAndAdjacentPairing_RestWithoutNetSpin()
    {
        using var harness = new PairHarness();
        Manifold3D diagonal = harness.RealPair();
        diagonal.Count.Should().Be(2, "the settling stack is expected to present a two-point face pair.");
        Manifold3D adjacent = Manifold3D.Pair(
            diagonal.Normal, diagonal[0], EdgePartner(diagonal[1], id: 37u));

        RestOutcome same = harness.Solve(diagonal, sweeps: 1);
        RestOutcome edge = harness.Solve(adjacent, sweeps: 1);

        same.SignedTwistDegrees.Should().BeApproximately(0.0f, 1e-4f,
            $"the diagonal pair spun the upper box by {same.SignedTwistDegrees:0.#####} deg in one sweep.");
        edge.SignedTwistDegrees.Should().BeApproximately(0.0f, 1e-4f,
            $"the adjacent pair spun the upper box by {edge.SignedTwistDegrees:0.#####} deg in one sweep; a pair whose " +
            "witnesses share a line through the bodies cannot report that twist, so applying one is invented geometry.");
        same.NormalGain.Should().BeApproximately(edge.NormalGain, 1e-6f,
            $"the diagonal pair lifted the box by {same.NormalGain:0.#####} m and the adjacent pair by " +
            $"{edge.NormalGain:0.#####} m; the correction must not depend on how the face was paired.");

        RestOutcome sameAgain = harness.Solve(diagonal, sweeps: 8);
        RestOutcome edgeAgain = harness.Solve(adjacent, sweeps: 8);
        sameAgain.NormalGain.Should().BeApproximately(same.NormalGain, 1e-6f,
            $"eight sweeps lifted the diagonal pair by {sameAgain.NormalGain:0.#####} m against one sweep's " +
            $"{same.NormalGain:0.#####} m, so the pass is paying for geometry it already corrected.");
        edgeAgain.NormalGain.Should().BeApproximately(edge.NormalGain, 1e-6f,
            $"eight sweeps lifted the adjacent pair by {edgeAgain.NormalGain:0.#####} m against one sweep's " +
            $"{edge.NormalGain:0.#####} m, so the pass is paying for geometry it already corrected.");
    }

    [Fact]
    public void ObservableWedgeDifferential_IsStillClosed()
    {
        using var harness = new PairHarness();
        Manifold3D diagonal = harness.RealPair();
        ContactPoint3D first = diagonal[0];
        ContactPoint3D second = EdgePartner(diagonal[1], id: 37u);
        second.Separation -= 0.01f;
        Manifold3D wedge = Manifold3D.Pair(diagonal.Normal, first, second);

        RestOutcome outcome = harness.Solve(wedge, sweeps: 1);

        outcome.TwistAboutObservableAxis.Should().NotBe(0.0f,
            "an edge pair with unequal separations still reports a twist about the axis the pair can see, and " +
            $"the pass applied {outcome.TwistAboutObservableAxis:0.#####} deg of it.");
        MathF.Abs(outcome.SignedTwistDegrees).Should().BeLessThan(1e-4f,
            $"the same wedge applied {outcome.SignedTwistDegrees:0.#####} deg about the axis the pair cannot observe.");
    }

    [Fact]
    public void SleepingBox_LeavesStaticSceneryUntouched_AndLaterBodiesStillSettle()
    {
        using var world = new World();
        world.Gravity = new Vec3(0.0f, -9.81f, 0.0f);
        world.VelocityIterations.Should().Be(8, "the corruption reproduced on the default solver budget.");
        world.PositionIterations.Should().Be(3, "the corruption reproduced on the default position budget.");

        BodyId ground = AddBox(world, BodyType.Static, new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 0.8f);
        BodyId box = AddBox(world, BodyType.Dynamic, new Vec3(0.0f, 0.8f, 0.0f), BoxHalf, 0.7f, allowSleep: true);

        float worstGroundSpeed = 0.0f;
        string firstCorruption = "none";
        for (int step = 0; step < 200; step++)
        {
            world.Step(Dt);
            Vec3 groundVelocity = world.Bodies.GetLinearVelocity(ground);
            Vec3 groundAngular = world.Bodies.GetAngularVelocity(ground);
            if (!IsFinite(groundVelocity) || !IsFinite(groundAngular))
            {
                firstCorruption = $"step {step}: ground velocity {Format(groundVelocity)} angular {Format(groundAngular)}";
                break;
            }

            worstGroundSpeed = MathF.Max(worstGroundSpeed, groundVelocity.Length());
        }

        firstCorruption.Should().Be("none", "a box coming to rest over scenery must not write through it.");
        worstGroundSpeed.Should().Be(0.0f,
            $"the shared static ground accumulated {worstGroundSpeed:0.#####} m/s of solver velocity while the box slept on it.");

        BodyId later = AddBox(world, BodyType.Dynamic, new Vec3(3.0f, 4.0f, 0.0f), BoxHalf, 0.7f, allowSleep: true);
        for (int step = 0; step < 120; step++)
        {
            world.Step(Dt);
        }

        Vec3 laterPosition = world.Bodies.GetTransform(later).Position;
        IsFinite(laterPosition).Should().BeTrue($"a body dropped onto corrupted scenery landed at {Format(laterPosition)}");
        MathF.Abs(laterPosition.Y - Half).Should().BeLessThan(0.02f,
            $"the later box settled at y={laterPosition.Y:0.#####} m instead of resting within 0.02 m of {Half:0.###} m.");
        MathF.Abs(laterPosition.X - 3.0f).Should().BeLessThan(0.05f,
            $"the later box drifted to x={laterPosition.X:0.#####} m from its spawn axis.");
    }

    [Fact]
    public void PositionPass_ResolvesTheResidualInOneSweep_WithoutAllocation()
    {
        using var harness = new PairHarness();
        Manifold3D diagonal = harness.RealPair();
        Contact3D[] contacts = harness.Contacts(diagonal);

        ContactSolver.SolvePositions(harness.Bodies, contacts, 1);
        Vec3 oneSweep = harness.Bodies.GetTransform(harness.Upper).Position;

        harness.Reset();
        ContactSolver.SolvePositions(harness.Bodies, contacts, 8);
        Vec3 eightSweeps = harness.Bodies.GetTransform(harness.Upper).Position;

        (eightSweeps - oneSweep).LengthSquared().Should().BeLessThan(
            1e-12f,
            "eight sweeps move the upper box by " + (eightSweeps - oneSweep).Length().ToString("0.##########") +
            " metres past the first sweep, so the pass is still paying for geometry it already corrected.");

        for (int i = 0; i < 2_000; i++)
        {
            ContactSolver.SolvePositions(harness.Bodies, contacts, 4);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1_000; i++)
        {
            ContactSolver.SolvePositions(harness.Bodies, contacts, 4);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0L, "1000 sweeps of the two-point stack allocated this many bytes.");
    }

    [Fact]
    public void PositionPass_SweepsLongContactLists_WithoutAllocation()
    {
        using var harness = new PairHarness();
        Contact3D[] contacts = harness.Contacts(harness.RealPair(), 600);

        ContactSolver.SolvePositions(harness.Bodies, contacts, 4);

        for (int i = 0; i < 300; i++)
        {
            ContactSolver.SolvePositions(harness.Bodies, contacts, 4);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 200; i++)
        {
            ContactSolver.SolvePositions(harness.Bodies, contacts, 4);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0L, "200 passes over 600 contacts allocated this many bytes.");
        Vec3 lower = harness.Bodies.GetTransform(harness.Lower).Position;
        Vec3 upper = harness.Bodies.GetTransform(harness.Upper).Position;
        (IsFinite(lower) && IsFinite(upper)).Should().BeTrue("a windowed pass left non-finite body frames behind.");
    }

    private static string Because(int count, int positionIterations, string warm, RestReport report) =>
        $"n={count}, VelocityIterations=10, PositionIterations={positionIterations}, {warm}: the 900-step run measured " +
        $"tilt={report.MaxTiltDegrees:0.####}deg (after step {SettleStep}: {report.MaxTiltAfterSettle:0.####}deg), " +
        $"lateral={report.MaxLateralMetres:0.#####}m, |omega| after step {SettleStep}={report.MaxSpinAfterSettle:0.#####}rad/s, " +
        $"top height error={report.TopHeightErrorMetres:0.#####}m, lowest centre y={report.LowestCentreY:0.#####}m.";

    private static RestReport RunStack(int count, int velocityIterations, int positionIterations, bool warmStart)
    {
        using var world = new World();
        world.Gravity = new Vec3(0.0f, -9.81f, 0.0f);
        world.VelocityIterations = velocityIterations;
        world.PositionIterations = positionIterations;

        AddBox(world, BodyType.Static, new Vec3(0.0f, -0.5f, 0.0f), GroundHalf, 0.8f);
        var boxes = new List<BodyId>(count);
        for (int i = 0; i < count; i++)
        {
            boxes.Add(AddBox(world, BodyType.Dynamic, new Vec3(0.0f, 0.8f + (0.8f * i), 0.0f), BoxHalf, 0.7f));
        }

        float maxTilt = 0.0f;
        float maxTiltAfterSettle = 0.0f;
        float maxLateral = 0.0f;
        float maxSpinAfterSettle = 0.0f;
        float lowestCentreY = float.MaxValue;
        float signedTwist = 0.0f;
        var coldState = new NoWarmContext();

        for (int step = 0; step < Steps; step++)
        {
            if (warmStart)
            {
                world.Step(Dt);
            }
            else
            {
                world.Step(Dt, new NoWarmStart(), ref coldState);
            }

            for (int i = 0; i < boxes.Count; i++)
            {
                RigidTransform3D frame = world.Bodies.GetTransform(boxes[i]);
                float tilt = TiltDegrees(frame.Rotation);
                float lateral = MathF.Sqrt((frame.Position.X * frame.Position.X) + (frame.Position.Z * frame.Position.Z));
                float spin = world.Bodies.GetAngularVelocity(boxes[i]).Length();

                maxTilt = MathF.Max(maxTilt, tilt);
                maxLateral = MathF.Max(maxLateral, lateral);
                lowestCentreY = MathF.Min(lowestCentreY, frame.Position.Y);
                if (step >= SettleStep)
                {
                    maxTiltAfterSettle = MathF.Max(maxTiltAfterSettle, tilt);
                    maxSpinAfterSettle = MathF.Max(maxSpinAfterSettle, spin);
                }

                if (i == boxes.Count - 1)
                {
                    signedTwist = MathF.Max(signedTwist, SignedTwistAboutX(frame.Rotation));
                }
            }
        }

        float topY = world.Bodies.GetTransform(boxes[^1]).Position.Y;
        float analyticTopY = Half + (2.0f * Half * (count - 1));
        return new RestReport(maxTilt, maxTiltAfterSettle, maxLateral, maxSpinAfterSettle, MathF.Abs(topY - analyticTopY), lowestCentreY, signedTwist);
    }

    private static BodyId AddBox(World world, BodyType type, Vec3 position, Vec3 halfExtents, float friction, bool allowSleep = false)
    {
        BodyId body = world.Bodies.Create(new BodyDef
        {
            Type = type,
            Position = position,
            Rotation = Quat.Identity,
            AllowSleep = allowSleep,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, body, Vec3.Zero, halfExtents,
            1.0f, default, new PhysicsMaterial(friction, 0.0f));
        return body;
    }

    private static float TiltDegrees(Quat rotation)
    {
        float norm = MathF.Sqrt((rotation.X * rotation.X) + (rotation.Y * rotation.Y) + (rotation.Z * rotation.Z) + (rotation.W * rotation.W));
        float w = norm == 0.0f ? 1.0f : MathF.Abs(rotation.W) / norm;
        return 2.0f * (MathF.Acos(MathF.Min(1.0f, w)) * 180.0f / MathF.PI);
    }

    private static float SignedTwistAboutX(Quat rotation) =>
        2.0f * MathF.Atan2(rotation.X, rotation.W) * 180.0f / MathF.PI;

    private static bool IsFinite(Vec3 vector) =>
        float.IsFinite(vector.X) && float.IsFinite(vector.Y) && float.IsFinite(vector.Z);

    private static string Format(Vec3 vector) => $"({vector.X:0.#####},{vector.Y:0.#####},{vector.Z:0.#####})";

    /// <summary>
    /// Second witness of a face pair, moved onto the same edge as the first so
    /// the pair spans one axis only instead of a diagonal.
    /// </summary>
    private static ContactPoint3D EdgePartner(ContactPoint3D point, uint id) => new(
        new Vec3(point.PositionA.X, point.PositionA.Y, -point.PositionA.Z),
        new Vec3(point.PositionB.X, point.PositionB.Y, -point.PositionB.Z),
        point.Separation, id);

    private struct NoWarmContext
    {
    }

    /// <summary>
    /// Pre-solve hook that discards the impulses the world carried in, so a
    /// scene can be measured as if warm starting had never happened.
    /// </summary>
    private struct NoWarmStart : IContactSolverCallbacks<Contact3D, Manifold3D, NoWarmContext>
    {
        public static void OnPreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref NoWarmContext context)
        {
            for (int p = 0; p < manifold.Count; p++)
            {
                ContactPoint3D point = manifold[p];
                ContactPoint3D cold = point;
                cold.NormalImpulse = 0.0f;
                cold.TangentImpulse1 = 0.0f;
                cold.TangentImpulse2 = 0.0f;
                manifold.SetPoint(p, cold);
            }
        }

        public static void OnPostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref NoWarmContext context)
        {
        }
    }

    private readonly record struct RestOutcome(
        float SignedTwistDegrees, float TwistAboutObservableAxis, float NormalGain);

    /// <summary>
    /// Two stacked boxes plus hand-built manifolds, so a pairing can be swapped
    /// without the narrowphase quietly picking a different one.
    /// </summary>
    private sealed class PairHarness : IDisposable
    {
        public readonly BodyStore Bodies = new();
        public readonly ShapeStore Shapes = new();
        public readonly DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink> Tree = new();
        public BodyId Lower;
        public BodyId Upper;
        public ShapeId LowerShape;
        public ShapeId UpperShape;

        public PairHarness()
        {
            Lower = Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec3(0.0f, 0.4f, 0.0f), AllowSleep = false });
            Upper = Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec3(0.0f, 1.15f, 0.0f), AllowSleep = false });
            LowerShape = Shapes.AttachBox(Bodies, Tree, Lower, Vec3.Zero, BoxHalf, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
            UpperShape = Shapes.AttachBox(Bodies, Tree, Upper, Vec3.Zero, BoxHalf, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
        }

        public Manifold3D RealPair()
        {
            Sync();
            var box = new Box3(Vec3.Zero, BoxHalf);
            Penetration3D.BoxBox(in box, Shapes.GetWorldFrame(LowerShape), in box, Shapes.GetWorldFrame(UpperShape), out Manifold3D manifold);
            return manifold;
        }

        public Contact3D[] Contacts(Manifold3D manifold, int count = 1)
        {
            var contacts = new Contact3D[count];
            Contact3D one = new()
            {
                BodyA = Lower,
                BodyB = Upper,
                ShapeA = LowerShape,
                ShapeB = UpperShape,
                IsSensor = false,
                Manifold = manifold,
            };

            for (int i = 0; i < count; i++)
            {
                contacts[i] = one;
            }

            return contacts;
        }

        public RestOutcome Solve(Manifold3D manifold, int sweeps)
        {
            Reset();
            Contact3D[] contacts = Contacts(manifold);
            Quat before = Bodies.GetTransform(Upper).Rotation;
            Vec3 positionBefore = Bodies.GetTransform(Upper).Position;

            Vec3 chord = Vec3.Normalize(manifold[0].PositionA - manifold[1].PositionA);
            Vec3 observable = Vec3.Normalize(Vec3.Cross(manifold.Normal, chord));

            ContactSolver.SolvePositions(Bodies, contacts, sweeps);

            Quat relative = Bodies.GetTransform(Upper).Rotation * before.Conjugate();
            if (relative.W < 0.0f)
            {
                relative = new Quat(-relative.X, -relative.Y, -relative.Z, -relative.W);
            }

            var axisPart = new Vec3(relative.X, relative.Y, relative.Z);
            const float Rad2Deg = 180.0f / MathF.PI;
            float unobservable = 2.0f * Vec3.Dot(axisPart, chord) * Rad2Deg;
            float observed = 2.0f * Vec3.Dot(axisPart, observable) * Rad2Deg;
            return new RestOutcome(
                unobservable,
                observed,
                Vec3.Dot(manifold.Normal, Bodies.GetTransform(Upper).Position - positionBefore) * -1.0f);
        }

        public void Reset()
        {
            Bodies.SetTransform(Lower, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);
            Bodies.SetTransform(Upper, new Vec3(0.0f, 1.15f, 0.0f), Quat.Identity);
            Sync();
        }

        public void Dispose() => Tree.Dispose();

        private void Sync()
        {
            Shapes.SyncBody(Bodies, Tree, Lower);
            Shapes.SyncBody(Bodies, Tree, Upper);
        }
    }
}
