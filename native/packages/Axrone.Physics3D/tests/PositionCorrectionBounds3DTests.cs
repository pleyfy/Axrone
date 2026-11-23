using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public sealed class PositionCorrectionBounds3DTests
{
    private const float Tolerance = 1e-5f;

    [Fact]
    public void TwoWitnessCorrection_CapsTheFinalRelativeDisplacement()
    {
        using var harness = new PositionHarness();
        ContactPoint3D first = PositionHarness.Point(0.0f, -0.2f);
        ContactPoint3D second = PositionHarness.Point(0.0f, -0.2f);
        Contact3D[] contacts = harness.Contact(first, second);

        ContactSolver.SolvePositions(harness.Bodies, contacts, 1);

        float lift = harness.Bodies.GetTransform(harness.Upper).Position.Y - harness.InitialUpperY;
        lift.Should().BeLessThanOrEqualTo(PhysicsConstants.MaxLinearCorrection + Tolerance,
            $"two clamped witnesses produced {lift:0.#####} m of relative correction in one sweep; " +
            $"the per-sweep cap is {PhysicsConstants.MaxLinearCorrection:0.#####} m.");
    }

    [Fact]
    public void NearCoincidentWitnesses_FallBackLikeExactlyCoincidentWitnesses()
    {
        using var harness = new PositionHarness();
        ContactPoint3D control0 = PositionHarness.Point(0.0f, -0.05f);
        ContactPoint3D control1 = PositionHarness.Point(0.0f, -0.03f);
        ContactSolver.SolvePositions(harness.Bodies, harness.Contact(control0, control1), 1);
        float controlLift = harness.Bodies.GetTransform(harness.Upper).Position.Y - harness.InitialUpperY;

        harness.Reset();
        ContactPoint3D near0 = PositionHarness.Point(0.0f, -0.05f);
        ContactPoint3D near1 = PositionHarness.Point(0.001f, -0.03f);
        ContactSolver.SolvePositions(harness.Bodies, harness.Contact(near0, near1), 1);
        float nearLift = harness.Bodies.GetTransform(harness.Upper).Position.Y - harness.InitialUpperY;

        nearLift.Should().BeApproximately(controlLift, Tolerance,
            $"exactly coincident witnesses used the sequential fallback and lifted {controlLift:0.#####} m, " +
            $"while near-coincident witnesses lifted {nearLift:0.#####} m; the coupled matrix is ill-conditioned.");
    }

    private sealed class PositionHarness : IDisposable
    {
        private readonly DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink> _tree = new();

        public readonly BodyStore Bodies = new();
        public readonly ShapeStore Shapes = new();
        public readonly BodyId Lower;
        public readonly BodyId Upper;
        public readonly float InitialUpperY = 1.15f;

        public PositionHarness()
        {
            Lower = Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec3(0.0f, 0.4f, 0.0f), AllowSleep = false });
            Upper = Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec3(0.0f, InitialUpperY, 0.0f), AllowSleep = false });
            var half = new Vec3(0.4f, 0.4f, 0.4f);
            Shapes.AttachBox(Bodies, _tree, Lower, Vec3.Zero, half, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
            Shapes.AttachBox(Bodies, _tree, Upper, Vec3.Zero, half, 1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
            Reset();
        }

        public static ContactPoint3D Point(float x, float separation) =>
            new(new Vec3(x, 0.8f, 0.0f), new Vec3(x, 0.75f, 0.0f), separation, (uint)(x == 0.0f ? 1 : 2));

        public Contact3D[] Contact(ContactPoint3D first, ContactPoint3D second)
        {
            var contact = new Contact3D
            {
                BodyA = Lower,
                BodyB = Upper,
                Manifold = Manifold3D.Pair(new Vec3(0.0f, -1.0f, 0.0f), first, second),
            };
            return new[] { contact };
        }

        public void Reset()
        {
            Bodies.SetTransform(Lower, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);
            Bodies.SetTransform(Upper, new Vec3(0.0f, InitialUpperY, 0.0f), Quat.Identity);
            Shapes.SyncBody(Bodies, _tree, Lower);
            Shapes.SyncBody(Bodies, _tree, Upper);
        }

        public void Dispose() => _tree.Dispose();
    }
}
