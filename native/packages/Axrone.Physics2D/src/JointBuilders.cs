namespace Axrone.Physics2D;

using System.Runtime.CompilerServices;

#pragma warning disable CA1000 // Typestate factories live on the phased builder itself: the phase type parameter is the whole point, and a parallel factory class would split the construction protocol from its states.

/// <summary>Distance joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct DistanceJointBuilder<TPhase>
{
    private readonly BodyId _bodyA;
    private readonly BodyId _bodyB;
    private readonly Vec2 _localAnchorA;
    private readonly Vec2 _localAnchorB;
    private readonly float _length;

    internal DistanceJointBuilder(BodyId bodyA, BodyId bodyB, Vec2 anchorA, Vec2 anchorB, float length)
    {
        _bodyA = bodyA;
        _bodyB = bodyB;
        _localAnchorA = anchorA;
        _localAnchorB = anchorB;
        _length = length;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static DistanceJointBuilder<Typestate.Unconfigured> Create() =>
        new(BodyId.Invalid, BodyId.Invalid, default, default, 0.0f);

    internal BodyId BodyA => _bodyA;
    internal BodyId BodyB => _bodyB;
    internal Vec2 LocalAnchorA => _localAnchorA;
    internal Vec2 LocalAnchorB => _localAnchorB;
    internal float Length => _length;
}

/// <summary>Phased extensions of the distance joint builder.</summary>
public static class DistanceJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static DistanceJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this DistanceJointBuilder<Typestate.Unconfigured> _, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Distance joint requires two distinct valid bodies.");
        }

        return new DistanceJointBuilder<Typestate.BodiesConfigured>(bodyA, bodyB, default, default, 0.0f);
    }

    /// <summary>Binds the anchors and the rest length.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static DistanceJointBuilder<Typestate.GeometryConfigured> WithAnchors(
        this DistanceJointBuilder<Typestate.BodiesConfigured> builder,
        Vec2 localAnchorA, Vec2 localAnchorB, float length)
    {
        if (length < 0.0f || float.IsNaN(length) || float.IsInfinity(length))
        {
            ThrowHelper.ThrowInvalidOperation("Rest length must be finite and non-negative.");
        }

        return new DistanceJointBuilder<Typestate.GeometryConfigured>(
            builder.BodyA, builder.BodyB, localAnchorA, localAnchorB, length);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this DistanceJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        return store.CreateDistance(bodies, builder.BodyA, builder.BodyB,
            builder.LocalAnchorA, builder.LocalAnchorB, builder.Length);
    }
}

/// <summary>Revolute joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct RevoluteJointBuilder<TPhase>
{
    private readonly RevoluteDef _definition;

    internal RevoluteJointBuilder(in RevoluteDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RevoluteJointBuilder<Typestate.Unconfigured> Create() => new(new RevoluteDef());

    internal RevoluteDef Definition => _definition;
}

/// <summary>Phased extensions of the revolute joint builder.</summary>
public static class RevoluteJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RevoluteJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this RevoluteJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Revolute joint requires two distinct valid bodies.");
        }

        RevoluteDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new RevoluteJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the shared world anchor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RevoluteJointBuilder<Typestate.GeometryConfigured> WithAnchor(
        this RevoluteJointBuilder<Typestate.BodiesConfigured> builder, Vec2 worldAnchor)
    {
        RevoluteDef definition = builder.Definition with { WorldAnchor = worldAnchor };
        return new RevoluteJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the angular stops.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RevoluteJointBuilder<Typestate.GeometryConfigured> WithLimits(
        this RevoluteJointBuilder<Typestate.GeometryConfigured> builder, float lowerAngle, float upperAngle)
    {
        RevoluteDef definition = builder.Definition with
        {
            LowerAngle = lowerAngle,
            UpperAngle = upperAngle,
            EnableLimit = true,
        };
        return new RevoluteJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the speed motor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static RevoluteJointBuilder<Typestate.GeometryConfigured> WithMotor(
        this RevoluteJointBuilder<Typestate.GeometryConfigured> builder, float speed, float maxTorque)
    {
        RevoluteDef definition = builder.Definition with
        {
            MotorSpeed = speed,
            MaxMotorTorque = maxTorque,
            EnableMotor = true,
        };
        return new RevoluteJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this RevoluteJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        RevoluteDef definition = builder.Definition;
        return store.CreateRevolute(bodies, in definition);
    }
}

/// <summary>Weld joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct WeldJointBuilder<TPhase>
{
    private readonly WeldDef _definition;

    internal WeldJointBuilder(in WeldDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WeldJointBuilder<Typestate.Unconfigured> Create() => new(new WeldDef());

    internal WeldDef Definition => _definition;
}

/// <summary>Phased extensions of the weld joint builder.</summary>
public static class WeldJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WeldJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this WeldJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Weld joint requires two distinct valid bodies.");
        }

        WeldDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new WeldJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the shared world anchor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WeldJointBuilder<Typestate.GeometryConfigured> WithAnchor(
        this WeldJointBuilder<Typestate.BodiesConfigured> builder, Vec2 worldAnchor)
    {
        WeldDef definition = builder.Definition with { WorldAnchor = worldAnchor };
        return new WeldJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the soft attach: a frequency relaxes the rigid lock into a spring toward the welded pose.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WeldJointBuilder<Typestate.GeometryConfigured> WithSoftAttach(
        this WeldJointBuilder<Typestate.GeometryConfigured> builder, float frequency, float dampingRatio)
    {
        WeldDef definition = builder.Definition with
        {
            Frequency = frequency,
            DampingRatio = dampingRatio,
        };
        return new WeldJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this WeldJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        WeldDef definition = builder.Definition;
        return store.CreateWeld(bodies, in definition);
    }
}

/// <summary>Prismatic joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct PrismaticJointBuilder<TPhase>
{
    private readonly PrismaticDef _definition;

    internal PrismaticJointBuilder(in PrismaticDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PrismaticJointBuilder<Typestate.Unconfigured> Create() => new(new PrismaticDef());

    internal PrismaticDef Definition => _definition;
}

/// <summary>Phased extensions of the prismatic joint builder.</summary>
public static class PrismaticJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PrismaticJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this PrismaticJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic joint requires two distinct valid bodies.");
        }

        PrismaticDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new PrismaticJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the shared world anchor and the slide axis.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PrismaticJointBuilder<Typestate.GeometryConfigured> WithAxis(
        this PrismaticJointBuilder<Typestate.BodiesConfigured> builder, Vec2 worldAnchor, Vec2 worldAxis)
    {
        PrismaticDef definition = builder.Definition with { WorldAnchor = worldAnchor, WorldAxis = worldAxis };
        return new PrismaticJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the slide stops.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PrismaticJointBuilder<Typestate.GeometryConfigured> WithLimits(
        this PrismaticJointBuilder<Typestate.GeometryConfigured> builder, float lower, float upper)
    {
        PrismaticDef definition = builder.Definition with
        {
            LowerTranslation = lower,
            UpperTranslation = upper,
            EnableLimit = true,
        };
        return new PrismaticJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the slide motor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PrismaticJointBuilder<Typestate.GeometryConfigured> WithMotor(
        this PrismaticJointBuilder<Typestate.GeometryConfigured> builder, float speed, float maxForce)
    {
        PrismaticDef definition = builder.Definition with
        {
            MotorSpeed = speed,
            MaxMotorForce = maxForce,
            EnableMotor = true,
        };
        return new PrismaticJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this PrismaticJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        PrismaticDef definition = builder.Definition;
        return store.CreatePrismatic(bodies, in definition);
    }
}

/// <summary>Motor joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct MotorJointBuilder<TPhase>
{
    private readonly MotorDef _definition;

    internal MotorJointBuilder(in MotorDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static MotorJointBuilder<Typestate.Unconfigured> Create() => new(new MotorDef());

    internal MotorDef Definition => _definition;
}

/// <summary>Phased extensions of the motor joint builder.</summary>
public static class MotorJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static MotorJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this MotorJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Motor joint requires two distinct valid bodies.");
        }

        MotorDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new MotorJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the servo target, caps and response speed.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static MotorJointBuilder<Typestate.GeometryConfigured> WithServo(
        this MotorJointBuilder<Typestate.BodiesConfigured> builder,
        Vec2 linearOffset, float angularOffset, float maxForce, float maxTorque, float correctionFactor)
    {
        MotorDef definition = builder.Definition with
        {
            LinearOffset = linearOffset,
            AngularOffset = angularOffset,
            MaxForce = maxForce,
            MaxTorque = maxTorque,
            CorrectionFactor = correctionFactor,
        };
        return new MotorJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this MotorJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        MotorDef definition = builder.Definition;
        return store.CreateMotor(bodies, in definition);
    }
}

/// <summary>Wheel joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct WheelJointBuilder<TPhase>
{
    private readonly WheelDef _definition;

    internal WheelJointBuilder(in WheelDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WheelJointBuilder<Typestate.Unconfigured> Create() => new(new WheelDef());

    internal WheelDef Definition => _definition;
}

/// <summary>Phased extensions of the wheel joint builder.</summary>
public static class WheelJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WheelJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this WheelJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Wheel joint requires two distinct valid bodies.");
        }

        WheelDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new WheelJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the suspension anchor, axis and spring tuning.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WheelJointBuilder<Typestate.GeometryConfigured> WithSuspension(
        this WheelJointBuilder<Typestate.BodiesConfigured> builder,
        Vec2 worldAnchor, Vec2 worldAxis, float frequency, float dampingRatio)
    {
        WheelDef definition = builder.Definition with
        {
            WorldAnchor = worldAnchor,
            WorldAxis = worldAxis,
            SuspensionFrequency = frequency,
            SuspensionDamping = dampingRatio,
        };
        return new WheelJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the hub motor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WheelJointBuilder<Typestate.GeometryConfigured> WithMotor(
        this WheelJointBuilder<Typestate.GeometryConfigured> builder, float speed, float maxTorque)
    {
        WheelDef definition = builder.Definition with
        {
            MotorSpeed = speed,
            MaxMotorTorque = maxTorque,
            EnableMotor = true,
        };
        return new WheelJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Binds the travel stops along the suspension axis.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static WheelJointBuilder<Typestate.GeometryConfigured> WithLimits(
        this WheelJointBuilder<Typestate.GeometryConfigured> builder, float lower, float upper)
    {
        WheelDef definition = builder.Definition with
        {
            LowerTranslation = lower,
            UpperTranslation = upper,
            EnableLimit = true,
        };
        return new WheelJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this WheelJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        WheelDef definition = builder.Definition;
        return store.CreateWheel(bodies, in definition);
    }
}

/// <summary>Pulley joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct PulleyJointBuilder<TPhase>
{
    private readonly PulleyDef _definition;

    internal PulleyJointBuilder(in PulleyDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PulleyJointBuilder<Typestate.Unconfigured> Create() => new(new PulleyDef());

    internal PulleyDef Definition => _definition;
}

/// <summary>Phased extensions of the pulley joint builder.</summary>
public static class PulleyJointBuilderExtensions
{
    /// <summary>Binds the two bodies; rejects shared or invalid identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PulleyJointBuilder<Typestate.BodiesConfigured> WithBodies(
        this PulleyJointBuilder<Typestate.Unconfigured> builder, BodyId bodyA, BodyId bodyB)
    {
        if (!bodyA.IsValid || !bodyB.IsValid || bodyA == bodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Pulley joint requires two distinct valid bodies.");
        }

        PulleyDef definition = builder.Definition with { BodyA = bodyA, BodyB = bodyB };
        return new PulleyJointBuilder<Typestate.BodiesConfigured>(in definition);
    }

    /// <summary>Binds the ground pulleys, the body anchors and the rope ratio.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static PulleyJointBuilder<Typestate.GeometryConfigured> WithRopes(
        this PulleyJointBuilder<Typestate.BodiesConfigured> builder,
        Vec2 groundA, Vec2 groundB, Vec2 anchorA, Vec2 anchorB, float ratio)
    {
        PulleyDef definition = builder.Definition with
        {
            GroundAnchorA = groundA,
            GroundAnchorB = groundB,
            WorldAnchorA = anchorA,
            WorldAnchorB = anchorB,
            Ratio = ratio,
        };
        return new PulleyJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this PulleyJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        PulleyDef definition = builder.Definition;
        return store.CreatePulley(bodies, in definition);
    }
}

/// <summary>Gear joint builder; each step returns the next phase.</summary>
/// <typeparam name="TPhase">The current configuration phase.</typeparam>
public readonly struct GearJointBuilder<TPhase>
{
    private readonly GearDef _definition;

    internal GearJointBuilder(in GearDef definition)
    {
        _definition = definition;
    }

    /// <summary>Starts an unconfigured builder.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static GearJointBuilder<Typestate.Unconfigured> Create() => new(new GearDef());

    internal GearDef Definition => _definition;
}

/// <summary>Phased extensions of the gear joint builder.</summary>
public static class GearJointBuilderExtensions
{
    /// <summary>Binds the two geared joints; rejects shared, invalid or geared identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static GearJointBuilder<Typestate.JointsConfigured> WithJoints(
        this GearJointBuilder<Typestate.Unconfigured> builder, JointId jointA, JointId jointB)
    {
        if (!jointA.IsValid || !jointB.IsValid || jointA == jointB)
        {
            ThrowHelper.ThrowInvalidOperation("Gear joint requires two distinct live joints.");
        }

        GearDef definition = builder.Definition with { JointA = jointA, JointB = jointB };
        return new GearJointBuilder<Typestate.JointsConfigured>(in definition);
    }

    /// <summary>Binds the coordinate ratio.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static GearJointBuilder<Typestate.GeometryConfigured> WithRatio(
        this GearJointBuilder<Typestate.JointsConfigured> builder, float ratio)
    {
        GearDef definition = builder.Definition with { Ratio = ratio };
        return new GearJointBuilder<Typestate.GeometryConfigured>(in definition);
    }

    /// <summary>Allocates the joint in the store.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static JointId Build(
        this GearJointBuilder<Typestate.GeometryConfigured> builder,
        BodyStore bodies, JointStore store)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(store);
        GearDef definition = builder.Definition;
        return store.CreateGear(bodies, in definition);
    }
}

#pragma warning restore CA1000
