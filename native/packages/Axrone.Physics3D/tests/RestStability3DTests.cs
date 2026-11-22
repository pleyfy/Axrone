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
    private const int ScenerySteps = 200;
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
        Face diagonal = harness.WidestFace();
        Manifold3D asClipped = diagonal.Pairing(adjacent: false);
        Manifold3D asAdjacent = diagonal.Pairing(adjacent: true);

        RestOutcome same = harness.Solve(asClipped, sweeps: 1);
        RestOutcome edge = harness.Solve(asAdjacent, sweeps: 1);

        same.SignedTwistDegrees.Should().BeApproximately(0.0f, 1e-4f,
            $"the diagonal pair spun the upper box by {same.SignedTwistDegrees:0.#####} deg in one sweep.");
        edge.SignedTwistDegrees.Should().BeApproximately(0.0f, 1e-4f,
            $"the adjacent pair spun the upper box by {edge.SignedTwistDegrees:0.#####} deg in one sweep; a pair whose " +
            "witnesses share a line through the bodies cannot report that twist, so applying one is invented geometry.");
        same.NormalGain.Should().BeApproximately(edge.NormalGain, 1e-6f,
            $"the diagonal pair lifted the box by {same.NormalGain:0.#####} m and the adjacent pair by " +
            $"{edge.NormalGain:0.#####} m; the correction must not depend on how the face was paired.");

        RestOutcome sameAgain = harness.Solve(asClipped, sweeps: 8);
        RestOutcome edgeAgain = harness.Solve(asAdjacent, sweeps: 8);
        sameAgain.NormalGain.Should().BeApproximately(same.NormalGain, 1e-6f,
            $"eight sweeps lifted the diagonal pair by {sameAgain.NormalGain:0.#####} m against one sweep's " +
            $"{same.NormalGain:0.#####} m, so the pass is paying for geometry it already corrected.");
        edgeAgain.NormalGain.Should().BeApproximately(edge.NormalGain, 1e-6f,
            $"eight sweeps lifted the adjacent pair by {edgeAgain.NormalGain:0.#####} m against one sweep's " +
            $"{edge.NormalGain:0.#####} m, so the pass is paying for geometry it already corrected.");
    }

    [Fact]
    public void Pairing_SwapsNothingAtTheWindowBoundary()
    {
        using var harness = new PairHarness();
        Face face = harness.WidestFace();
        Manifold3D asClipped = face.Pairing(adjacent: false);
        Manifold3D asAdjacent = face.Pairing(adjacent: true);
        int window = PositionGeometryWindow.MaxContacts;

        Contact3D[] clipped = harness.Contacts(asClipped, window + 1);
        Contact3D[] adjacent = harness.Contacts(asAdjacent, window + 1);

        harness.Bodies.SetTransform(harness.Lower, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);
        harness.Bodies.SetTransform(harness.Upper, new Vec3(0.0f, 1.15f, 0.0f), Quat.Identity);
        ContactSolver.SolvePositions(harness.Bodies, clipped, 1);
        Vec3 clippedLift = harness.Bodies.GetTransform(harness.Upper).Position;

        harness.Bodies.SetTransform(harness.Lower, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);
        harness.Bodies.SetTransform(harness.Upper, new Vec3(0.0f, 1.15f, 0.0f), Quat.Identity);
        ContactSolver.SolvePositions(harness.Bodies, adjacent, 1);
        Vec3 adjacentLift = harness.Bodies.GetTransform(harness.Upper).Position;

        (adjacentLift - clippedLift).Length().Should().BeLessThan(1e-6f,
            $"{window + 1} copies of the same face lifted the box by {clippedLift.Y - 1.15f:0.#####} m as clipped and " +
            $"{adjacentLift.Y - 1.15f:0.#####} m as an adjacent pair across {window} contact windows; the pairing may " +
            "not change an answer, and no copy may be dropped or duplicated at a window boundary.");
    }

    [Fact]
    public void ObservableWedgeDifferential_IsStillClosed()
    {
        using var harness = new PairHarness();
        Face face = harness.WidestFace();
        Manifold3D wedge = face.Pairing(adjacent: true, deeperSecond: 0.01f);

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

        int corruptionStep = -1;
        Vec3 corruptGroundVelocity = Vec3.Zero;
        Vec3 corruptGroundAngular = Vec3.Zero;
        float worstGroundSpeed = 0.0f;
        for (int step = 0; step < ScenerySteps; step++)
        {
            world.Step(Dt);
            Vec3 groundVelocity = world.Bodies.GetLinearVelocity(ground);
            Vec3 groundAngular = world.Bodies.GetAngularVelocity(ground);
            if (!IsFinite(groundVelocity) || !IsFinite(groundAngular))
            {
                corruptionStep = step;
                corruptGroundVelocity = groundVelocity;
                corruptGroundAngular = groundAngular;
                break;
            }

            worstGroundSpeed = MathF.Max(worstGroundSpeed, groundVelocity.Length());
        }

        corruptionStep.Should().Be(-1,
            $"a box coming to rest over scenery must not write through it; the shared ground first went non-finite " +
            $"at step {corruptionStep} of {ScenerySteps} with linear velocity {Format(corruptGroundVelocity)} and " +
            $"angular velocity {Format(corruptGroundAngular)}.");
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
        Manifold3D diagonal = harness.WidestFace().Pairing(adjacent: false);
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

        long sweptOneSweep = GC.GetAllocatedBytesForCurrentThread() - before;
        sweptOneSweep.Should().Be(0L,
            $"1000 sweeps of a {diagonal.Count}-witness face pair allocated {sweptOneSweep} bytes.");
    }

    [Fact]
    public void PositionPass_SweepsLongContactLists_WithoutAllocation()
    {
        using var harness = new PairHarness();
        Contact3D[] contacts = harness.Contacts(harness.WidestFace().Pairing(adjacent: false), 600);

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

        long swept = GC.GetAllocatedBytesForCurrentThread() - before;
        int windows = (contacts.Length + PositionGeometryWindow.MaxContacts - 1) / PositionGeometryWindow.MaxContacts;
        swept.Should().Be(0L,
            $"{contacts.Length} contacts are {windows} windows of at most {PositionGeometryWindow.MaxContacts}; " +
            $"200 passes over them allocated {swept} bytes.");
        Vec3 lower = harness.Bodies.GetTransform(harness.Lower).Position;
        Vec3 upper = harness.Bodies.GetTransform(harness.Upper).Position;
        (IsFinite(lower) && IsFinite(upper)).Should().BeTrue(
            $"a windowed pass over {contacts.Length} contacts left non-finite body frames behind: lower " +
            $"{Format(lower)}, upper {Format(upper)}.");
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
    /// Second witness of a face pair, moved onto the dominant axis of the pair's
    /// own chord so both witnesses share a line through the bodies instead of a
    /// diagonal. Derived from the measured chord, so it holds however many
    /// witnesses the narrowphase clipped and whichever way the face points.
    /// </summary>
    private static ContactPoint3D SameEdge(ContactPoint3D first, ContactPoint3D second)
    {
        Vec3 chord = second.PositionA - first.PositionA;
        Vec3 axis = DominantAxis(chord);
        Vec3 offAxis = chord - (axis * Vec3.Dot(chord, axis));
        return new ContactPoint3D(
            second.PositionA - offAxis,
            second.PositionB - offAxis,
            second.Separation,
            37u);
    }

    private static Vec3 DominantAxis(Vec3 vector)
    {
        float magnitudeX = MathF.Abs(vector.X);
        float magnitudeY = MathF.Abs(vector.Y);
        float magnitudeZ = MathF.Abs(vector.Z);
        if (magnitudeX >= magnitudeY && magnitudeX >= magnitudeZ)
        {
            return new Vec3(1.0f, 0.0f, 0.0f);
        }

        return magnitudeY >= magnitudeZ ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(0.0f, 0.0f, 1.0f);
    }

    private static ContactPoint3D[] LivePoints(in Manifold3D manifold)
    {
        var points = new ContactPoint3D[manifold.Count];
        for (int index = 0; index < manifold.Count; index++)
        {
            points[index] = manifold[index];
        }

        return points;
    }

    /// <summary>
    /// The two witnesses of <paramref name="points"/> furthest apart, which is a
    /// diagonal of the clipped face whenever the face has any width at all.
    /// </summary>
    private static (int First, int Second) WidestPair(ContactPoint3D[] points)
    {
        points.Length.Should().BeGreaterThanOrEqualTo(2,
            "every pairing gate compares two ways of pairing one face, so it needs at least two witnesses; " +
            $"the narrowphase reported {points.Length}.");

        int widest = 0;
        float width = 0.0f;
        for (int index = 1; index < points.Length; index++)
        {
            float span = (points[index].PositionA - points[0].PositionA).LengthSquared();
            if (span > width)
            {
                width = span;
                widest = index;
            }
        }

        width.Should().BeGreaterThan(0.0f,
            $"witness 0 and its widest partner are {(width > 0.0f ? MathF.Sqrt(width) : width):0.#####} m apart; a face " +
            "pair whose witnesses coincide cannot show what a pairing does.");
        return (0, widest);
    }

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
    /// The two widest witnesses of the face the narrowphase actually clipped,
    /// kept with the shared normal and the witness count so a gate can say how
    /// wide the face was without naming a number of points.
    /// </summary>
    private readonly record struct Face(
        Vec3 Normal, ContactPoint3D First, ContactPoint3D Second, int WitnessCount)
    {
        /// <summary>
        /// A two-witness manifold out of this face: as clipped, or with the
        /// second witness pulled onto the same edge; <paramref name="deeperSecond"/>
        /// opens a wedge between the two separations.
        /// </summary>
        public Manifold3D Pairing(bool adjacent, float deeperSecond = 0.0f)
        {
            ContactPoint3D second = adjacent ? SameEdge(First, Second) : Second;
            if (deeperSecond != 0.0f)
            {
                second.Separation -= deeperSecond;
            }

            return Manifold3D.Pair(Normal, First, second);
        }
    }

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

        public Face WidestFace()
        {
            Sync();
            var box = new Box3(Vec3.Zero, BoxHalf);
            Penetration3D.BoxBox(in box, Shapes.GetWorldFrame(LowerShape), in box, Shapes.GetWorldFrame(UpperShape), out Manifold3D manifold);
            ContactPoint3D[] points = LivePoints(manifold);
            (int first, int second) = WidestPair(points);
            return new Face(manifold.Normal, points[first], points[second], points.Length);
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

            ContactPoint3D[] witnesses = LivePoints(manifold);
            (int wide, int wider) = WidestPair(witnesses);
            Vec3 chord = Vec3.Normalize(witnesses[wide].PositionA - witnesses[wider].PositionA);
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
