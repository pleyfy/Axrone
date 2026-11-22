using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Pins each NaN shield of the contact solver on its own. A pair at rest over
/// scenery has no movable surface anywhere in its rows, so the guarded reciprocal
/// in the effective masses and the dynamic-only condition at the application sites
/// both stop the same corruption, and a scene can only ever show that the two of
/// them together hold. Each row here calls one defence alone, with the other
/// defence irrelevant to it, so deleting either one is visible by itself.
/// </summary>
public sealed class SceneryImmunity3DTests
{
    private const float Half = 0.4f;
    private const float Depth = 0.05f;
    private static readonly Vec3 Up = new(0.0f, 1.0f, 0.0f);
    private static readonly Vec3 Forward = new(1.0f, 0.0f, 0.0f);
    private static readonly Vec3 WitnessA = new(Half, -Half, Half);
    private static readonly Vec3 WitnessB = new(-Half, -Half, -Half);

    [Fact]
    public void NormalRow_NobodyCanMove_ReportsZeroEffectiveMass()
    {
        float immobile = ContactSolver.ComputeNormalMass(
            0.0f, 0.0f, Vec3.Zero, Vec3.Zero, Quat.Identity, Quat.Identity, WitnessA, WitnessB, Up);

        float.IsFinite(immobile).Should().BeTrue(
            $"the normal row of a pair with no movable surface anywhere returned effective mass {immobile:R}; " +
            "the reciprocal of its zero denominator reaches the solver as infinity and becomes NaN on the first " +
            "zero sliding speed.");
        immobile.Should().Be(0.0f,
            $"the normal row of a pair with no movable surface anywhere returned effective mass {immobile:R} " +
            "instead of the zero the solver can multiply safely.");

        float movable = ContactSolver.ComputeNormalMass(
            1.0f, 0.0f, new Vec3(0.5f, 0.5f, 0.5f), Vec3.Zero, Quat.Identity, Quat.Identity, WitnessA, WitnessB, Up);
        movable.Should().BeGreaterThan(0.0f,
            $"a row that does have a movable surface must still report real mass, otherwise the zero above is " +
            $"just a dead helper; measured {movable:R}.");
    }

    [Fact]
    public void TangentRow_NobodyCanMove_ReportsZeroEffectiveMass()
    {
        Vec3 slideA = Vec3.Cross(WitnessA, Forward);
        Vec3 slideB = Vec3.Cross(WitnessB, Forward);
        float immobile = ContactSolver.ComputeTangentMass(
            0.0f, 0.0f, Vec3.Zero, Vec3.Zero, Quat.Identity, Quat.Identity, slideA, slideB);

        float.IsFinite(immobile).Should().BeTrue(
            $"the tangent row of a pair with no movable surface anywhere returned effective mass {immobile:R}; " +
            "an unguarded reciprocal turns a resting pair's zero sliding speed into NaN through it.");
        immobile.Should().Be(0.0f,
            $"the tangent row of a pair with no movable surface anywhere returned effective mass {immobile:R} " +
            "instead of the zero the solver can multiply safely.");

        float movable = ContactSolver.ComputeTangentMass(
            1.0f, 0.0f, new Vec3(0.5f, 0.5f, 0.5f), Vec3.Zero, Quat.Identity, Quat.Identity, slideA, slideB);
        movable.Should().BeGreaterThan(0.0f,
            $"a tangent row that does have a movable surface must still report real mass, otherwise the zero " +
            $"above is just a dead helper; measured {movable:R}.");
    }

    [Theory]
    [InlineData(BodyType.Static, true)]
    [InlineData(BodyType.Static, false)]
    [InlineData(BodyType.Kinematic, true)]
    [InlineData(BodyType.Kinematic, false)]
    public void AwakeScenery_IsNotWrittenByANormalImpulse(BodyType sceneryType, bool sceneryIsA)
    {
        BodyState scenery = Scenery(sceneryType);
        BodyState mover = Mover();
        ref BodyState stateA = ref sceneryIsA ? ref scenery : ref mover;
        ref BodyState stateB = ref sceneryIsA ? ref mover : ref scenery;

        ContactSolver.ApplyNormalImpulse(
            ref stateA, ref stateB, awakeA: true, awakeB: true,
            stateA.InverseMass, stateB.InverseMass, stateA.InverseInertia, stateB.InverseInertia,
            WitnessA, WitnessB, Up, float.PositiveInfinity);

        IsZero(scenery.LinearVelocity).Should().BeTrue(WriteReason("normal impulse", sceneryType, sceneryIsA, scenery));
        IsZero(scenery.AngularVelocity).Should().BeTrue(WriteReason("normal impulse", sceneryType, sceneryIsA, scenery));
        IsFinite(mover.LinearVelocity).Should().BeFalse(
            $"the impulse has to reach the movable side or the scenery row above proves nothing; the mover " +
            $"reports {Format(mover.LinearVelocity)}.");
    }

    [Theory]
    [InlineData(BodyType.Static, true)]
    [InlineData(BodyType.Static, false)]
    [InlineData(BodyType.Kinematic, true)]
    [InlineData(BodyType.Kinematic, false)]
    public void AwakeScenery_IsNotWrittenByATangentImpulse(BodyType sceneryType, bool sceneryIsA)
    {
        BodyState scenery = Scenery(sceneryType);
        BodyState mover = Mover();
        ref BodyState stateA = ref sceneryIsA ? ref scenery : ref mover;
        ref BodyState stateB = ref sceneryIsA ? ref mover : ref scenery;

        ContactSolver.ApplyTangentImpulse(
            ref stateA, ref stateB, awakeA: true, awakeB: true,
            stateA.InverseMass, stateB.InverseMass, stateA.InverseInertia, stateB.InverseInertia,
            WitnessA, WitnessB, Forward, float.PositiveInfinity);

        IsZero(scenery.LinearVelocity).Should().BeTrue(WriteReason("tangent impulse", sceneryType, sceneryIsA, scenery));
        IsZero(scenery.AngularVelocity).Should().BeTrue(WriteReason("tangent impulse", sceneryType, sceneryIsA, scenery));
        IsFinite(mover.LinearVelocity).Should().BeFalse(
            $"the friction impulse has to reach the movable side or the scenery row above proves nothing; the " +
            $"mover reports {Format(mover.LinearVelocity)}.");
    }

    [Theory]
    [InlineData(BodyType.Static, true)]
    [InlineData(BodyType.Static, false)]
    [InlineData(BodyType.Kinematic, true)]
    [InlineData(BodyType.Kinematic, false)]
    public void AwakeScenery_IsNotWrittenByAPositionCorrection(BodyType sceneryType, bool sceneryIsA)
    {
        var bodies = new BodyStore();
        BodyId scenery = bodies.Create(new BodyDef
        {
            Type = sceneryType,
            Position = new Vec3(0.0f, -0.5f, 0.0f),
            Rotation = Quat.Identity,
            AllowSleep = false,
        });
        BodyId mover = bodies.Create(new BodyDef
        {
            Type = BodyType.Dynamic,
            Position = new Vec3(0.0f, 0.4f, 0.0f),
            Rotation = Quat.Identity,
            AllowSleep = false,
        });
        ref BodyState moverState = ref bodies.Slot(mover);
        moverState.Mass = 1.0f;
        moverState.InverseMass = 1.0f;
        moverState.InverseInertia = new Vec3(0.5f, 0.5f, 0.5f);

        bodies.IsAwake(scenery).Should().BeTrue(
            "this row is about scenery that carries the awake flag; measured flags say otherwise.");

        Contact3D[] contacts = new Contact3D[1];
        contacts[0] = new Contact3D
        {
            BodyA = sceneryIsA ? scenery : mover,
            BodyB = sceneryIsA ? mover : scenery,
            IsSensor = false,
            Manifold = PoisonedRow(sceneryIsA),
        };

        ContactSolver.SolvePositions(bodies, contacts, 1);

        RigidTransform3D sceneryFrame = bodies.GetTransform(scenery);
        IsFinite(sceneryFrame.Position).Should().BeTrue(
            $"one sweep of a poisoned position row moved scenery: {WriteFrame(sceneryType, sceneryIsA, sceneryFrame)}.");
        IsFinite(sceneryFrame.Rotation).Should().BeTrue(
            $"one sweep of a poisoned position row spun scenery: {WriteFrame(sceneryType, sceneryIsA, sceneryFrame)}.");
        IsFinite(bodies.GetTransform(mover).Position).Should().BeFalse(
            "the poisoned row has to reach the movable body or the scenery rows above prove nothing; the mover " +
            $"reports {Format(bodies.GetTransform(mover).Position)}.");
    }

    [Fact]
    public void ShippedScenery_CarriesTheAwakeFlagAndInfiniteMass()
    {
        using var world = new World();
        BodyId scenery = world.Bodies.Create(new BodyDef
        {
            Type = BodyType.Static,
            Position = new Vec3(0.0f, -0.5f, 0.0f),
            Rotation = Quat.Identity,
        });
        world.Shapes.AttachBox(
            world.Bodies, world.Broadphase, scenery, Vec3.Zero, new Vec3(10.0f, 0.5f, 10.0f),
            1.0f, default, new PhysicsMaterial(0.8f, 0.0f));
        BodyId box = world.Bodies.Create(new BodyDef
        {
            Type = BodyType.Dynamic,
            Position = new Vec3(0.0f, 0.4f, 0.0f),
            Rotation = Quat.Identity,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half),
            1.0f, default, new PhysicsMaterial(0.7f, 0.0f));

        ref readonly BodyState sceneryState = ref world.Bodies.Slot(scenery);
        world.Bodies.IsAwake(scenery).Should().BeTrue(
            "scenery is awake in a shipped world, so only its type keeps it out of an impulse write.");
        sceneryState.InverseMass.Should().Be(0.0f,
            $"scenery reads as infinite mass; measured inverse mass {sceneryState.InverseMass:R}.");
        IsZero(sceneryState.InverseInertia).Should().BeTrue(
            $"scenery reads as infinite inertia; measured inverse inertia {Format(sceneryState.InverseInertia)}.");

        ref readonly BodyState boxState = ref world.Bodies.Slot(box);
        boxState.InverseMass.Should().BeGreaterThan(0.0f,
            $"the body standing on that scenery is movable; measured inverse mass {boxState.InverseMass:R}.");
        IsFinite(boxState.InverseInertia).Should().BeTrue(
            $"the movable body needs a finite inverse inertia; measured {Format(boxState.InverseInertia)}.");
    }

    private static Manifold3D PoisonedRow(bool sceneryIsA)
    {
        var first = new ContactPoint3D(
            new Vec3(-Half, 0.0f, -Half), new Vec3(-Half, -Depth, -Half), float.NaN, 0u);
        return Manifold3D.One(sceneryIsA ? -Up : Up, first);
    }

    private static BodyState Scenery(BodyType type) => new()
    {
        Type = type,
        Flags = BodyFlags.Awake | BodyFlags.Active,
        Position = new Vec3(0.0f, -0.5f, 0.0f),
        Rotation = Quat.Identity,
        LocalCenter = Vec3.Zero,
    };

    private static BodyState Mover() => new()
    {
        Type = BodyType.Dynamic,
        Flags = BodyFlags.Awake | BodyFlags.Active,
        Position = new Vec3(0.0f, 0.4f, 0.0f),
        Rotation = Quat.Identity,
        Mass = 1.0f,
        InverseMass = 1.0f,
        InverseInertia = new Vec3(0.5f, 0.5f, 0.5f),
        LocalCenter = Vec3.Zero,
    };

    private static string WriteReason(string what, BodyType sceneryType, bool sceneryIsA, in BodyState scenery) =>
        $"an awake {sceneryType} scenery body on side {(sceneryIsA ? "A" : "B")} absorbed a {what} of " +
        $"{float.PositiveInfinity:R} and now reports linear velocity {Format(scenery.LinearVelocity)} and angular " +
        $"velocity {Format(scenery.AngularVelocity)}; scenery reacts with infinite mass and must never be written.";

    private static string WriteFrame(BodyType sceneryType, bool sceneryIsA, in RigidTransform3D frame) =>
        $"an awake {sceneryType} scenery body on side {(sceneryIsA ? "A" : "B")} absorbed a position correction and " +
        $"now reports position {Format(frame.Position)} and rotation " +
        $"({frame.Rotation.X:R},{frame.Rotation.Y:R},{frame.Rotation.Z:R},{frame.Rotation.W:R}).";

    private static bool IsZero(Vec3 vector) =>
        vector.X == 0.0f && vector.Y == 0.0f && vector.Z == 0.0f;

    private static bool IsFinite(Vec3 vector) =>
        float.IsFinite(vector.X) && float.IsFinite(vector.Y) && float.IsFinite(vector.Z);

    private static bool IsFinite(Quat rotation) =>
        float.IsFinite(rotation.X) && float.IsFinite(rotation.Y) && float.IsFinite(rotation.Z) && float.IsFinite(rotation.W);

    private static string Format(Vec3 vector) => $"({vector.X:R},{vector.Y:R},{vector.Z:R})";
}
