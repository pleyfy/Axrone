using System.Globalization;
using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Depth-sweep acceptance gate for curved-prism penetration. A cylinder parked
/// inside a slab used to register a contact at a scatter of depths only, which
/// is what made the shipped gravity default look load-bearing. Every rule here
/// is paired with the configuration that must not produce a contact, so the
/// suite cannot be satisfied by an always-penetrating narrowphase.
/// </summary>
public class EpaDepthSweepTests
{
    private const float CylinderRadius = 0.5f;
    private const float CylinderHeight = 1.0f;

    /// <summary>Analytic rest height of a CylinderHeight prism standing on the slab top at y = 0.</summary>
    private const float AnalyticRestY = CylinderHeight * 0.5f;

    private const int SweepSteps = 100;
    private const float DepthStep = 0.01f;

    private static string F(float value) => value.ToString("0.##########", CultureInfo.InvariantCulture);

    private static string N(Vec3 value) => $"{F(value.X)},{F(value.Y)},{F(value.Z)}";

    private static bool SlabFirst(float depth, out Manifold3D manifold) =>
        Query(Vec3.Zero, depth, Vec3.Zero, false, out manifold);

    private static bool CylinderFirst(float depth, out Manifold3D manifold) =>
        Query(Vec3.Zero, depth, Vec3.Zero, true, out manifold);

    private static bool SlabFirstShifted(
        float depth, Vec3 slabShift, Vec3 cylinderShift, out Manifold3D manifold) =>
        Query(slabShift, depth, cylinderShift, false, out manifold);

    private static bool SlabFirstOverlapped(float gap, out Manifold3D manifold) =>
        Query(Vec3.Zero, -gap, Vec3.Zero, false, out manifold);

    /// <summary>One prism/slab query. The shapes stay inside this frame because OrientedShape is a ref struct.</summary>
    private static bool Query(
        Vec3 slabShift, float depth, Vec3 cylinderShift, bool cylinderFirst, out Manifold3D manifold)
    {
        var slab = new OrientedShape<Box3>(
            new Box3(new Vec3(0.0f, -1.0f, 0.0f) + slabShift, new Vec3(10.0f, 1.0f, 10.0f)),
            RigidTransform3D.Identity);
        var cylinder = new OrientedShape<Cylinder3>(
            new Cylinder3(new Vec3(0.0f, AnalyticRestY - depth, 0.0f) + cylinderShift, CylinderRadius, CylinderHeight, ShapeAxis3D.Y),
            RigidTransform3D.Identity);

        return cylinderFirst
            ? Epa3D.ComputePenetration(cylinder, slab, out manifold)
            : Epa3D.ComputePenetration(slab, cylinder, out manifold);
    }

    private static GjkResult SlabFirstDistance(float depth)
    {
        var slab = new OrientedShape<Box3>(
            new Box3(new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f)), RigidTransform3D.Identity);
        var cylinder = new OrientedShape<Cylinder3>(
            new Cylinder3(new Vec3(0.0f, AnalyticRestY - depth, 0.0f), CylinderRadius, CylinderHeight, ShapeAxis3D.Y),
            RigidTransform3D.Identity);
        return Gjk3D.ComputeDistance<OrientedShape<Box3>, OrientedShape<Cylinder3>, StandardGjkPolicy, NullGjkObserver>(
            slab, cylinder);
    }

    private static GjkResult SlabFirstDistanceOverlapped(float gap)
    {
        var slab = new OrientedShape<Box3>(
            new Box3(new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f)), RigidTransform3D.Identity);
        var cylinder = new OrientedShape<Cylinder3>(
            new Cylinder3(new Vec3(0.0f, AnalyticRestY + gap, 0.0f), CylinderRadius, CylinderHeight, ShapeAxis3D.Y),
            RigidTransform3D.Identity);
        return Gjk3D.ComputeDistance<OrientedShape<Box3>, OrientedShape<Cylinder3>, StandardGjkPolicy, NullGjkObserver>(
            slab, cylinder);
    }

    private static bool Stacked(float depth, out Manifold3D manifold)
    {
        var lower = new OrientedShape<Cylinder3>(
            new Cylinder3(Vec3.Zero, CylinderRadius, CylinderHeight, ShapeAxis3D.Y), RigidTransform3D.Identity);
        var upper = new OrientedShape<Cylinder3>(
            new Cylinder3(new Vec3(0.0f, CylinderHeight - depth, 0.0f), CylinderRadius, CylinderHeight, ShapeAxis3D.Y),
            RigidTransform3D.Identity);
        return Epa3D.ComputePenetration(lower, upper, out manifold);
    }

    /// <summary>Runs one probe per 0.01 m of depth and collects "depth: reason" for each failure.</summary>
    private static void Sweep(List<string> failures, string label, int steps, Func<float, string?> probe)
    {
        for (int i = 1; i <= steps; i++)
        {
            float depth = i * DepthStep;
            string? fault = probe(depth);
            if (fault is not null)
            {
                failures.Add($"{label} depth={F(depth)}: {fault}");
            }
        }
    }

    private static void Report(List<string> failures, int steps) =>
        Assert.True(
            failures.Count == 0,
            $"{failures.Count} of {steps} sweep rows failed. " + string.Join(" | ", failures));

    [Fact]
    public void CylinderAgainstSlab_EveryDepth_ReportsTruePenetration_SlabFirst()
    {
        List<string> failures = new();
        float previousSeparation = float.PositiveInfinity;

        Sweep(failures, "slab-first", SweepSteps, depth =>
        {
            if (!SlabFirst(depth, out Manifold3D manifold))
            {
                return "no contact";
            }

            float separation = manifold[0].Separation;
            if (MathF.Abs(MathF.Abs(separation) - depth) > 1e-4f)
            {
                return $"separation {F(separation)}, expected {F(-depth)}";
            }

            // The normal points from the second shape toward the first: from
            // the prism down into the slab, which is how the solver lifts the
            // prism back out.
            if (manifold.Normal.Y > -0.999f)
            {
                return $"normal {N(manifold.Normal)}, expected 0,-1,0";
            }

            // Separation must deepen monotonically; a sweep with holes cannot,
            // and the hole is the defect this file pins.
            if (separation >= previousSeparation)
            {
                return $"separation {F(separation)} is not deeper than {F(previousSeparation)}";
            }

            previousSeparation = separation;
            return null;
        });

        Report(failures, SweepSteps);
    }

    [Fact]
    public void CylinderAgainstSlab_EveryDepth_ReportsTruePenetration_CylinderFirst()
    {
        List<string> failures = new();

        Sweep(failures, "cylinder-first", SweepSteps, depth =>
        {
            if (!CylinderFirst(depth, out Manifold3D flipped))
            {
                return "no contact";
            }

            if (flipped.Normal.Y < 0.999f)
            {
                return $"normal {N(flipped.Normal)}, expected 0,1,0";
            }

            if (MathF.Abs(MathF.Abs(flipped[0].Separation) - depth) > 1e-4f)
            {
                return $"separation {F(flipped[0].Separation)}, expected {F(-depth)}";
            }

            if (!SlabFirst(depth, out Manifold3D direct))
            {
                return "argument orders disagree: no contact slab-first";
            }

            // Argument order may flip the normal, not the physics.
            if ((flipped.Normal + direct.Normal).Length() > 1e-6f)
            {
                return $"normals disagree {N(direct.Normal)} against {N(flipped.Normal)}";
            }

            if (MathF.Abs(flipped[0].Separation - direct[0].Separation) > 1e-6f)
            {
                return $"separations disagree {F(direct[0].Separation)} against {F(flipped[0].Separation)}";
            }

            return null;
        });

        Report(failures, SweepSteps);
    }

    /// <summary>
    /// Past full immersion the minimum translation flips to the far side of the
    /// slab, so the expected depth is min(depth, slabThickness - depth) with the
    /// opposite sign. Exact across the flip, which the old dead band missed.
    /// </summary>
    [Fact]
    public void CylinderAgainstSlab_PastFullImmersion_ReportsTheShortestWayOut()
    {
        List<string> failures = new();
        int steps = 60;

        Sweep(failures, "immersed", steps, depth =>
        {
            if (!SlabFirst(depth, out Manifold3D manifold))
            {
                return "no contact";
            }

            float expected = MathF.Min(depth, 3.0f - depth);
            if (MathF.Abs(MathF.Abs(manifold[0].Separation) - expected) > 1e-4f)
            {
                return $"separation {F(manifold[0].Separation)}, expected {F(-expected)}";
            }

            float wantY = depth < 1.5f ? -1.0f : 1.0f;
            if ((manifold.Normal.Y - wantY) * wantY > 1e-3f)
            {
                return $"normal {N(manifold.Normal)}, expected 0,{F(wantY)},0";
            }

            return null;
        });

        Report(failures, steps);
    }

    [Fact]
    public void CylinderAgainstCylinder_EveryDepth_ReportsTruePenetration()
    {
        List<string> failures = new();
        float previousSeparation = float.PositiveInfinity;
        int steps = SweepSteps - 1;

        // 0.01..0.99: full immersion of two identical prisms is 1.00, where the
        // minimum translation is genuinely degenerate. See the coincident test.
        Sweep(failures, "stack", steps, depth =>
        {
            if (!Stacked(depth, out Manifold3D manifold))
            {
                return "no contact";
            }

            float separation = manifold[0].Separation;
            if (MathF.Abs(MathF.Abs(separation) - depth) > 1e-4f)
            {
                return $"separation {F(separation)}, expected {F(-depth)}";
            }

            if (manifold.Normal.Y > -0.999f)
            {
                return $"normal {N(manifold.Normal)}, expected 0,-1,0";
            }

            if (separation >= previousSeparation)
            {
                return $"separation {F(separation)} is not deeper than {F(previousSeparation)}";
            }

            previousSeparation = separation;
            return null;
        });

        Report(failures, steps);
    }

    /// <summary>
    /// Documented limitation, not a pass weakened to fit: two exactly
    /// coincident prisms have infinitely many minimum translations of the same
    /// length, and an inscribed polytope can only approach that length from
    /// below. Contact still exists and the depth stays within 1 %.
    /// </summary>
    [Fact]
    public void CylinderAgainstCylinder_FullyCoinident_StillReportsContact()
    {
        Stacked(1.00f, out Manifold3D manifold).Should().BeTrue();

        float error = MathF.Abs(MathF.Abs(manifold[0].Separation) - 1.00f);
        Assert.True(
            error <= 0.01f,
            $"coincident prisms reported separation {F(manifold[0].Separation)}, 1.00 expected, error {F(error)}");
        manifold.Normal.Length().Should().BeApproximately(1.0f, 1e-3f);
    }

    /// <summary>
    /// Negative case for the three sweeps: the scale-aware origin test must not
    /// swallow gaps the scene can resolve. One millimetre against a twenty metre
    /// slab is four orders above the float32 floor, so it stays disjoint.
    /// </summary>
    [Theory]
    [InlineData(0.001f)]
    [InlineData(0.01f)]
    [InlineData(0.1f)]
    [InlineData(1.0f)]
    public void CylinderAboveSlab_ResolvableGap_ReportsNoContact(float gap)
    {
        SlabFirstOverlapped(gap, out _).Should().BeFalse(
            $"a {F(gap)} m gap is resolvable at this scene scale");
        CylinderFirst(-gap, out _).Should().BeFalse();

        GjkResult result = SlabFirstDistanceOverlapped(gap);
        result.IsDisjoint.Should().BeTrue();
        result.Distance.Value.Value.Should().BeApproximately(gap, 1e-5f);
    }

    /// <summary>
    /// The origin test is relative, so a half-metre scene resolves a gap the
    /// slab scene cannot. Same code, same gap, opposite verdict.
    /// </summary>
    [Fact]
    public void SmallScene_ResolvesGapsTheSlabSceneCannot()
    {
        var small = new OrientedShape<Box3>(
            new Box3(new Vec3(0.0f, -0.25f, 0.0f), new Vec3(0.25f, 0.25f, 0.25f)), RigidTransform3D.Identity);
        var prism = new OrientedShape<Cylinder3>(
            new Cylinder3(new Vec3(0.0f, 0.25001f, 0.0f), 0.05f, 0.1f, ShapeAxis3D.Y), RigidTransform3D.Identity);

        Epa3D.ComputePenetration(small, prism, out _).Should().BeFalse(
            "ten microns is far above the resolution floor of a half-metre scene");
    }

    [Fact]
    public void Gjk_DoesNotReportDisjoint_ForEveryOverlappingPrismDepth()
    {
        List<string> failures = new();

        Sweep(failures, "gjk", SweepSteps, depth =>
        {
            GjkResult result = SlabFirstDistance(depth);
            return result.IsDisjoint
                ? $"status {result.Status} after {result.Iterations.Value} iterations, " +
                  $"distance {F(result.Distance.Value.Value)}"
                : null;
        });

        Report(failures, SweepSteps);
    }

    [Fact]
    public void CylinderDropped_OnGround_RestsAtAnalyticHeight()
    {
        float restingY = Drop(5.0f, -9.81f, out int contactSteps, out float lowestY);

        Assert.True(
            contactSteps > 150,
            $"only {contactSteps} of 240 steps carried a contact; the dead band this test pins is the defect");
        restingY.Should().BeApproximately(AnalyticRestY, 0.12f);
        lowestY.Should().BeGreaterThan(-1.0f, "the prism must never pass through the slab top");
    }

    [Fact]
    public void CylinderDropped_AtShippedGravity_RestsAtAnalyticHeight()
    {
        float restingY = Drop(5.0f, -10.0f, out int contactSteps, out float lowestY);

        contactSteps.Should().BeGreaterThan(150);
        restingY.Should().BeApproximately(AnalyticRestY, 0.12f);
        lowestY.Should().BeGreaterThan(-1.0f);
    }

    /// <summary>
    /// The scenario behind the WorldDef.Gravity confession: released from 0.20 m
    /// inside the slab the prism used to register three contacts in 240 steps
    /// and end at y = -78.7 m.
    /// </summary>
    [Fact]
    public void CylinderParkedTwentyCentimetresInsideGround_RecoversInsteadOfTunnelling()
    {
        float restingY = Drop(AnalyticRestY - 0.20f, -9.81f, out int contactSteps, out float lowestY);

        Assert.True(
            restingY > 0.3f,
            $"parked 0.20 m inside and released, the prism ended at y={F(restingY)} with {contactSteps} contact steps");
        contactSteps.Should().BeGreaterThan(150);
        lowestY.Should().BeGreaterThan(-1.0f);
    }

    [Fact]
    public void CylinderParkedInsideGround_AtShippedGravity_Recovers()
    {
        float restingY = Drop(AnalyticRestY - 0.20f, -10.0f, out int contactSteps, out float lowestY);

        restingY.Should().BeGreaterThan(0.3f);
        contactSteps.Should().BeGreaterThan(150);
        lowestY.Should().BeGreaterThan(-1.0f);
    }

    /// <summary>Negative control: with no slab the same body must fall freely, so the resting assertions are not vacuous.</summary>
    [Fact]
    public void CylinderWithNoGround_Falls()
    {
        using var world = new World();
        BodyId body = world.Bodies.Create(new BodyDef());
        world.Shapes.AttachCylinder(world.Bodies, world.Broadphase, body, Vec3.Zero, CylinderRadius, CylinderHeight);
        world.Bodies.SetTransform(body, new Vec3(0.0f, 5.0f, 0.0f), Quat.Identity);
        world.Gravity = new Vec3(0.0f, -9.81f, 0.0f);

        for (int step = 0; step < 240; step++)
        {
            world.Step(1.0f / 60.0f);
        }

        world.ContactCount.Should().Be(0);
        world.Bodies.GetTransform(body).Position.Y.Should().BeLessThan(-10.0f);
    }

    [Fact]
    public void EpaPointIds_AreNeverTheLegacyZero()
    {
        List<string> failures = new();

        for (int i = 0; i <= SweepSteps; i++)
        {
            float depth = i * DepthStep;
            if (SlabFirst(depth, out Manifold3D direct) && direct[0].Id == 0u)
            {
                failures.Add($"slab-first depth={F(depth)}");
            }

            if (CylinderFirst(depth, out Manifold3D flipped) && flipped[0].Id == 0u)
            {
                failures.Add($"cylinder-first depth={F(depth)}");
            }
        }

        Assert.True(failures.Count == 0, "points still carrying the legacy zero id: " + string.Join(" | ", failures));
    }

    [Theory]
    [InlineData(0.05f)]
    [InlineData(0.20f)]
    [InlineData(0.50f)]
    [InlineData(1.00f)]
    public void EpaPointId_UnchangedByOneMillimetreTranslation(float depth)
    {
        SlabFirst(depth, out Manifold3D reference);
        uint expected = reference[0].Id;
        Vec3[] shifts =
        {
            new(0.001f, 0.0f, 0.0f),
            new(-0.001f, 0.0f, 0.0f),
            new(0.0f, 0.0f, 0.001f),
            new(0.0f, 0.0f, -0.001f),
            new(0.001f, 0.001f, 0.001f),
        };

        foreach (Vec3 shift in shifts)
        {
            SlabFirstShifted(depth, shift, shift, out Manifold3D both);
            SlabFirstShifted(depth, shift, Vec3.Zero, out Manifold3D slabOnly);
            SlabFirstShifted(depth, Vec3.Zero, shift, out Manifold3D cylinderOnly);

            Assert.True(
                both[0].Id == expected && slabOnly[0].Id == expected && cylinderOnly[0].Id == expected,
                $"shift {N(shift)}: reference {expected}, translated {both[0].Id} (both shapes), " +
                $"{slabOnly[0].Id} (slab only), {cylinderOnly[0].Id} (prism only); " +
                $"separations {F(both[0].Separation)}, {F(slabOnly[0].Separation)}, {F(cylinderOnly[0].Separation)}");
        }
    }

    /// <summary>
    /// Negative case for the id rule: the same prism entering the same slab from
    /// the far side is a different contact feature and must not inherit the
    /// carried impulses. With every point stamped 0 this pair aliased.
    /// </summary>
    [Fact]
    public void EpaPointId_DiffersWhenTheContactNormalFlips()
    {
        SlabFirst(0.20f, out Manifold3D shallow);
        SlabFirst(1.55f, out Manifold3D buried);

        shallow.Normal.Y.Should().BeNegative("at 0.20 m the shortest way out is up through the slab top");
        buried.Normal.Y.Should().BePositive("at 1.55 m the shortest way out is down through the slab bottom");
        Assert.NotEqual(shallow[0].Id, buried[0].Id);
    }

    private static float Drop(float startY, float gravity, out int contactSteps, out float lowestY)
    {
        using var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground,
            new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f));

        BodyId body = world.Bodies.Create(new BodyDef());
        world.Shapes.AttachCylinder(world.Bodies, world.Broadphase, body, Vec3.Zero, CylinderRadius, CylinderHeight);
        world.Bodies.SetTransform(body, new Vec3(0.0f, startY, 0.0f), Quat.Identity);
        world.Gravity = new Vec3(0.0f, gravity, 0.0f);

        contactSteps = 0;
        lowestY = float.PositiveInfinity;
        for (int step = 0; step < 240; step++)
        {
            world.Step(1.0f / 60.0f);
            if (world.ContactCount > 0)
            {
                contactSteps++;
            }

            float y = world.Bodies.GetTransform(body).Position.Y;
            if (y < lowestY)
            {
                lowestY = y;
            }
        }

        return world.Bodies.GetTransform(body).Position.Y;
    }
}
