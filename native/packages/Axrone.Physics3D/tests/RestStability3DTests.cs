using System.Collections.Generic;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Rest-closure gate for the 3D position pass: box stacks must settle on their
/// spawn axis instead of tumbling out of the world. Each threshold is the
/// number the scene measures once the pass re-reads its own geometry, so a
/// regression reports the value that moved rather than a bare bound.
/// </summary>
public sealed class RestStability3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int Steps = 900;
    private const int SettleStep = 300;
    private static readonly Vec3 GroundHalf = new(40.0f, 0.5f, 40.0f);
    private static readonly Vec3 BoxHalf = new(Half, Half, Half);

    private readonly record struct RestReport(
        float MaxTiltDegrees,
        float MaxTiltAfterSettle,
        float MaxLateralMetres,
        float MaxSpinAfterSettle,
        float TopHeightErrorMetres,
        float LowestCentreY);

    [Theory]
    [InlineData(2, 1)]
    [InlineData(3, 1)]
    [InlineData(2, 4)]
    [InlineData(3, 4)]
    public void Stack_Settles_OnItsSpawnAxis_WithoutTumbling(int count, int positionIterations)
    {
        RestReport report = RunStack(count, 10, positionIterations);

        report.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(count, positionIterations, report));
        report.MaxTiltAfterSettle.Should().BeLessThan(5.0f, Because(count, positionIterations, report));
        report.MaxLateralMetres.Should().BeLessThan(0.05f, Because(count, positionIterations, report));
        report.MaxSpinAfterSettle.Should().BeLessThan(0.1f, Because(count, positionIterations, report));
        report.TopHeightErrorMetres.Should().BeLessThan(0.02f, Because(count, positionIterations, report));
        report.LowestCentreY.Should().BeGreaterThan(0.0f, Because(count, positionIterations, report));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(8)]
    public void PositionIterationsZero_KeepsTheVelocityPassTiltFree(int count)
    {
        RestReport report = RunStack(count, 10, 0);

        report.MaxTiltDegrees.Should().BeLessThan(0.01f, Because(count, 0, report));
        report.MaxSpinAfterSettle.Should().BeLessThan(0.02f, Because(count, 0, report));
        report.MaxLateralMetres.Should().BeLessThan(0.01f, Because(count, 0, report));
    }

    [Fact]
    public void EightStack_HoldsEveryBodyOnItsAxis_AndStaysAboveTheGround()
    {
        RestReport report = RunStack(8, 10, 4);

        report.MaxLateralMetres.Should().BeLessThan(0.5f, Because(8, 4, report));
        report.LowestCentreY.Should().BeGreaterThan(0.0f, Because(8, 4, report));
        report.MaxTiltDegrees.Should().BeLessThan(5.0f, Because(8, 4, report));
        report.TopHeightErrorMetres.Should().BeLessThan(0.06f, Because(8, 4, report));
    }

    [Fact]
    public void PositionPass_ResolvesTheResidualInOneSweep_WithoutAllocation()
    {
        using var harness = new PositionHarness();
        Contact3D[] contacts = harness.TwoPointStack();
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
        using var harness = new PositionHarness();
        Contact3D[] contacts = harness.WideStack(600);

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
        harness.FramesAreFinite().Should().BeTrue("a windowed pass left non-finite body frames behind.");
    }

    private static string Because(int count, int positionIterations, RestReport report) =>
        $"n={count}, VelocityIterations=10, PositionIterations={positionIterations}: the 900-step run measured " +
        $"tilt={report.MaxTiltDegrees:0.####}deg (after step {SettleStep}: {report.MaxTiltAfterSettle:0.####}deg), " +
        $"lateral={report.MaxLateralMetres:0.#####}m, |omega| after step {SettleStep}={report.MaxSpinAfterSettle:0.#####}rad/s, " +
        $"top height error={report.TopHeightErrorMetres:0.#####}m, lowest centre y={report.LowestCentreY:0.#####}m.";

    private static RestReport RunStack(int count, int velocityIterations, int positionIterations)
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

        for (int step = 0; step < Steps; step++)
        {
            world.Step(Dt);
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
            }
        }

        float topY = world.Bodies.GetTransform(boxes[^1]).Position.Y;
        float analyticTopY = Half + (2.0f * Half * (count - 1));
        return new RestReport(maxTilt, maxTiltAfterSettle, maxLateral, maxSpinAfterSettle, MathF.Abs(topY - analyticTopY), lowestCentreY);
    }

    private static BodyId AddBox(World world, BodyType type, Vec3 position, Vec3 halfExtents, float friction)
    {
        BodyId body = world.Bodies.Create(new BodyDef
        {
            Type = type,
            Position = position,
            Rotation = Quat.Identity,
            AllowSleep = false,
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

    /// <summary>
    /// Two stacked boxes plus hand-built contacts, so the position pass can be
    /// driven directly without a world stepping velocities underneath it.
    /// </summary>
    private sealed class PositionHarness : IDisposable
    {
        public readonly BodyStore Bodies = new();
        public readonly ShapeStore Shapes = new();
        public readonly DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink> Tree = new();
        public BodyId Lower;
        public BodyId Upper;
        public ShapeId LowerShape;
        public ShapeId UpperShape;

        public Contact3D[] TwoPointStack()
        {
            Lower = Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec3(0.0f, 0.4f, 0.0f), AllowSleep = false });
            Upper = Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec3(0.0f, 1.15f, 0.0f), AllowSleep = false });
            LowerShape = Shapes.AttachBox(Bodies, Tree, Lower, Vec3.Zero, BoxHalf, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
            UpperShape = Shapes.AttachBox(Bodies, Tree, Upper, Vec3.Zero, BoxHalf, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));

            return new[] { StackContact() };
        }

        public Contact3D[] WideStack(int contacts)
        {
            Contact3D[] wide = TwoPointStack();
            var many = new Contact3D[contacts];
            for (int i = 0; i < contacts; i++)
            {
                many[i] = wide[0];
            }

            return many;
        }

        public void Reset()
        {
            Bodies.SetTransform(Lower, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);
            Bodies.SetTransform(Upper, new Vec3(0.0f, 1.15f, 0.0f), Quat.Identity);
        }

        public bool FramesAreFinite()
        {
            Vec3 lower = Bodies.GetTransform(Lower).Position;
            Vec3 upper = Bodies.GetTransform(Upper).Position;
            Vec3 spin = Bodies.GetAngularVelocity(Upper);
            return float.IsFinite(lower.X) && float.IsFinite(lower.Y) && float.IsFinite(lower.Z)
                && float.IsFinite(upper.X) && float.IsFinite(upper.Y) && float.IsFinite(upper.Z)
                && float.IsFinite(spin.X) && float.IsFinite(spin.Y) && float.IsFinite(spin.Z);
        }

        public void Dispose() => Tree.Dispose();

        private Contact3D StackContact()
        {
            var box = new Box3(Vec3.Zero, BoxHalf);
            Shapes.SyncBody(Bodies, Tree, Lower);
            Shapes.SyncBody(Bodies, Tree, Upper);
            Penetration3D.BoxBox(in box, Shapes.GetWorldFrame(LowerShape), in box, Shapes.GetWorldFrame(UpperShape), out Manifold3D manifold);
            manifold.Count.Should().Be(2, "the two-point face pair is the geometry the position pass has to re-read.");

            return new Contact3D
            {
                BodyA = Lower,
                BodyB = Upper,
                ShapeA = LowerShape,
                ShapeB = UpperShape,
                IsSensor = false,
                Manifold = manifold,
            };
        }
    }
}
