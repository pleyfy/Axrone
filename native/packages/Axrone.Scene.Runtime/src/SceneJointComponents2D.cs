namespace Axrone.Scene.Runtime;

using Axrone.Physics2D;

/// <summary>2D joint kinds published by the scene joint layer.</summary>
public enum SceneJointKind2D
{
    /// <summary>Fixed-length distance joint.</summary>
    Distance = 0,

    /// <summary>Revolute hinge joint with optional limits and motor.</summary>
    Hinge = 1,

    /// <summary>Welded fixed joint.</summary>
    Fixed = 2,

    /// <summary>Prismatic slider joint with optional limits and motor.</summary>
    Slider = 3,

    /// <summary>Soft spring joint.</summary>
    Spring = 4,

    /// <summary>Position-matching motor joint.</summary>
    Motor = 5,

    /// <summary>Wheel joint with suspension, limit and motor channels.</summary>
    Wheel = 6,

    /// <summary>Unilateral maximum-length rope joint.</summary>
    Rope = 7,

    /// <summary>Target-driven mouse joint.</summary>
    Mouse = 8,

    /// <summary>Gear joint coupling two existing joints.</summary>
    Gear = 9
}

/// <summary>
/// Serialised actor reference for joint payloads. Carries a slot and a
/// generation fence; a recycled slot resolves as stale instead of aliasing
/// the new occupant. Runtime body identities are never stored here.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneJointActorRef(int Slot, uint Generation)
{
    /// <summary>No-reference sentinel; a joint with this target never resolves.</summary>
    public static SceneJointActorRef Invalid => new(-1, 0u);

    /// <summary>Whether this reference names a possible live actor.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Slot >= 0 && Generation != 0u;
    }

    /// <summary>Captures a live actor handle as a serialisable reference.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SceneJointActorRef FromActor(SceneActor actor) =>
        new(actor.Slot, actor.Generation.Value);

    /// <summary>Resolves the reference against a world, rejecting stale generations.</summary>
    public bool TryResolve(SceneWorld world, out SceneActor actor)
    {
        ArgumentNullException.ThrowIfNull(world);

        actor = default;
        if (!IsValid)
        {
            return false;
        }

        SceneActor candidate = SceneActor.FromSlot(Slot, new Axrone.Utility.Slots.Generation(Generation));
        return world.TryGetActor(candidate, out actor);
    }
}

/// <summary>
/// Serialised joint reference for gear payloads: an actor reference plus the
/// joint kind hosted on that actor.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneJointRef2D(int Slot, uint Generation, SceneJointKind2D Kind)
{
    /// <summary>No-joint sentinel.</summary>
    public static SceneJointRef2D Invalid => new(-1, 0u, SceneJointKind2D.Distance);

    /// <summary>Whether this reference names a possible live joint.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Slot >= 0 && Generation != 0u;
    }

    /// <summary>Resolves the actor half of the reference against a world.</summary>
    public bool TryResolveActor(SceneWorld world, out SceneActor actor) =>
        new SceneJointActorRef(Slot, Generation).TryResolve(world, out actor);
}

/// <summary>Outcome of one joint build attempt during bridge reconciliation.</summary>
internal enum SceneJointBuildResult2D
{
    /// <summary>The solver joint is live.</summary>
    Created,

    /// <summary>A dependency is missing this frame; the bridge retries next sync.</summary>
    Pending,

    /// <summary>The payload is invalid and was rejected by the solver layer.</summary>
    Faulted,

    /// <summary>The payload intentionally requests no solver joint.</summary>
    NotRequired
}

internal interface ISceneJoint2D<TSelf> : ISceneDataComponent
    where TSelf : unmanaged, ISceneDataComponent
{
    static abstract SceneJointKind2D JointKind { get; }

    static abstract ulong ComputePayloadHash(in TSelf value);

    static abstract SceneJointBuildResult2D Create(in TSelf value, SceneJointBuildContext2D context, out JointId jointId);

    SceneJointActorRef TargetBodyRef { get; }

    bool IsJointEnabled { get; }
}

internal static class SceneJointHash2D
{
    internal const ulong FnvPrime = 1099511628211UL;

    internal static ulong Seed() => 14695981039346656037UL;

    internal static ulong Mix(ulong hash, uint value) => (hash ^ value) * FnvPrime;

    internal static ulong Mix(ulong hash, float value) =>
        Mix(hash, unchecked((uint)BitConverter.SingleToInt32Bits(value)));

    internal static ulong Mix(ulong hash, bool value) => (hash ^ (value ? 1u : 0u)) * FnvPrime;

    internal static ulong Mix(ulong hash, in Vec2 value) =>
        Mix(Mix(hash, unchecked((uint)BitConverter.SingleToInt32Bits(value.X))),
            unchecked((uint)BitConverter.SingleToInt32Bits(value.Y)));

    internal static ulong Mix(ulong hash, int value) => Mix(hash, unchecked((uint)value));

    internal static ulong Mix(ulong hash, in SceneJointActorRef value) =>
        Mix(Mix(hash, value.Slot), value.Generation);

    internal static ulong Mix(ulong hash, in SceneJointRef2D value) =>
        Mix(Mix(Mix(hash, value.Slot), value.Generation), (uint)value.Kind);
}

/// <summary>
/// Distance data component. Anchors the two bodies at a fixed separation;
/// <see cref="AutoConfigureDistance"/> derives the length from live body
/// positions at spawn, mirroring the TypeScript joint.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneDistanceJoint2D : ISceneJoint2D<SceneDistanceJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Target separation in metres.</summary>
    public float Distance;

    /// <summary>Minimum separation in metres.</summary>
    public float MinDistance;

    /// <summary>Maximum separation; positive infinity is unbounded.</summary>
    public float MaxDistance;

    /// <summary>Solver stiffness for soft behaviour.</summary>
    public float Stiffness;

    /// <summary>Solver damping for soft behaviour.</summary>
    public float Damping;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 AnchorA;

    /// <summary>Local anchor on body B.</summary>
    public Vec2 AnchorB;

    /// <summary>Derive the length from live body positions at spawn.</summary>
    public bool AutoConfigureDistance;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default one-metre auto-configured distance joint.</summary>
    public static SceneDistanceJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Distance = 1.0f,
            MinDistance = 0.0f,
            MaxDistance = float.PositiveInfinity,
            Stiffness = 0.0f,
            Damping = 0.0f,
            AutoConfigureDistance = true,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneDistanceJoint2D>.JointKind => SceneJointKind2D.Distance;

    SceneJointActorRef ISceneJoint2D<SceneDistanceJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneDistanceJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneDistanceJoint2D>.ComputePayloadHash(in SceneDistanceJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.Distance);
        hash = SceneJointHash2D.Mix(hash, value.MinDistance);
        hash = SceneJointHash2D.Mix(hash, value.MaxDistance);
        hash = SceneJointHash2D.Mix(hash, value.Stiffness);
        hash = SceneJointHash2D.Mix(hash, value.Damping);
        hash = SceneJointHash2D.Mix(hash, value.AnchorA);
        hash = SceneJointHash2D.Mix(hash, value.AnchorB);
        hash = SceneJointHash2D.Mix(hash, value.AutoConfigureDistance);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneDistanceJoint2D>.Create(
        in SceneDistanceJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Distance(value, context, out jointId);
}

/// <summary>
/// Hinge (revolute) data component. Limits are authored in degrees and
/// converted to radians at solver creation, matching the TypeScript hinge.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneHingeJoint2D : ISceneJoint2D<SceneHingeJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 Anchor;

    /// <summary>Whether the motor channel drives the solver joint.</summary>
    public bool UseMotor;

    /// <summary>Motor speed in radians per second.</summary>
    public float MotorSpeed;

    /// <summary>Maximum motor torque.</summary>
    public float MaxMotorTorque;

    /// <summary>Whether the angular limit channel constrains the solver joint.</summary>
    public bool UseLimits;

    /// <summary>Lower angle limit in degrees.</summary>
    public float LimitsMin;

    /// <summary>Upper angle limit in degrees.</summary>
    public float LimitsMax;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default free-spinning hinge with an unused 0..360 degree limit.</summary>
    public static SceneHingeJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            UseMotor = false,
            MotorSpeed = 0.0f,
            MaxMotorTorque = 10000.0f,
            UseLimits = false,
            LimitsMin = 0.0f,
            LimitsMax = 360.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneHingeJoint2D>.JointKind => SceneJointKind2D.Hinge;

    SceneJointActorRef ISceneJoint2D<SceneHingeJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneHingeJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneHingeJoint2D>.ComputePayloadHash(in SceneHingeJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.Anchor);
        hash = SceneJointHash2D.Mix(hash, value.UseMotor);
        hash = SceneJointHash2D.Mix(hash, value.MotorSpeed);
        hash = SceneJointHash2D.Mix(hash, value.MaxMotorTorque);
        hash = SceneJointHash2D.Mix(hash, value.UseLimits);
        hash = SceneJointHash2D.Mix(hash, value.LimitsMin);
        hash = SceneJointHash2D.Mix(hash, value.LimitsMax);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneHingeJoint2D>.Create(
        in SceneHingeJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Hinge(value, context, out jointId);
}

/// <summary>
/// Fixed (weld) data component. The solver consumes the anchor;
/// <see cref="DampingRatio"/> and <see cref="Frequency"/> derive solver
/// compliance parameters that the current 2D weld definition does not carry
/// (recorded as a cross-package request).
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneFixedJoint2D : ISceneJoint2D<SceneFixedJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 Anchor;

    /// <summary>Weld damping ratio in [0, 1].</summary>
    public float DampingRatio;

    /// <summary>Weld oscillation frequency in Hertz; zero is a rigid weld.</summary>
    public float Frequency;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default rigid weld with a 0.7 damping ratio.</summary>
    public static SceneFixedJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            DampingRatio = 0.7f,
            Frequency = 0.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneFixedJoint2D>.JointKind => SceneJointKind2D.Fixed;

    SceneJointActorRef ISceneJoint2D<SceneFixedJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneFixedJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneFixedJoint2D>.ComputePayloadHash(in SceneFixedJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.Anchor);
        hash = SceneJointHash2D.Mix(hash, value.DampingRatio);
        hash = SceneJointHash2D.Mix(hash, value.Frequency);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneFixedJoint2D>.Create(
        in SceneFixedJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Fixed(value, context, out jointId);
}

/// <summary>
/// Slider (prismatic) data component. Translation limits are authored in
/// metres along <see cref="Axis"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSliderJoint2D : ISceneJoint2D<SceneSliderJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 Anchor;

    /// <summary>Slide axis in the frame of body A.</summary>
    public Vec2 Axis;

    /// <summary>Whether the motor channel drives the solver joint.</summary>
    public bool UseMotor;

    /// <summary>Motor speed in metres per second.</summary>
    public float MotorSpeed;

    /// <summary>Maximum motor force.</summary>
    public float MaxMotorForce;

    /// <summary>Whether the translation limit channel constrains the solver joint.</summary>
    public bool UseLimits;

    /// <summary>Lower translation limit in metres.</summary>
    public float LimitsMin;

    /// <summary>Upper translation limit in metres.</summary>
    public float LimitsMax;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default free slider along X with an unused -1..1 metre limit.</summary>
    public static SceneSliderJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec2(1.0f, 0.0f),
            UseMotor = false,
            MotorSpeed = 0.0f,
            MaxMotorForce = 10000.0f,
            UseLimits = false,
            LimitsMin = -1.0f,
            LimitsMax = 1.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneSliderJoint2D>.JointKind => SceneJointKind2D.Slider;

    SceneJointActorRef ISceneJoint2D<SceneSliderJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneSliderJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneSliderJoint2D>.ComputePayloadHash(in SceneSliderJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.Anchor);
        hash = SceneJointHash2D.Mix(hash, value.Axis);
        hash = SceneJointHash2D.Mix(hash, value.UseMotor);
        hash = SceneJointHash2D.Mix(hash, value.MotorSpeed);
        hash = SceneJointHash2D.Mix(hash, value.MaxMotorForce);
        hash = SceneJointHash2D.Mix(hash, value.UseLimits);
        hash = SceneJointHash2D.Mix(hash, value.LimitsMin);
        hash = SceneJointHash2D.Mix(hash, value.LimitsMax);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneSliderJoint2D>.Create(
        in SceneSliderJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Slider(value, context, out jointId);
}

/// <summary>
/// Spring data component. The TypeScript spring is a soft distance joint;
/// compliance is carried here while the solver-side spring parameters are a
/// cross-package request.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSpringJoint2D : ISceneJoint2D<SceneSpringJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Rest length in metres.</summary>
    public float Distance;

    /// <summary>Spring stiffness; higher is stiffer.</summary>
    public float Stiffness;

    /// <summary>Spring damping.</summary>
    public float Damping;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 AnchorA;

    /// <summary>Local anchor on body B.</summary>
    public Vec2 AnchorB;

    /// <summary>Derive the rest length from live body positions at spawn.</summary>
    public bool AutoConfigureDistance;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default one-metre auto-configured spring.</summary>
    public static SceneSpringJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Distance = 1.0f,
            Stiffness = 10.0f,
            Damping = 0.5f,
            AutoConfigureDistance = true,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneSpringJoint2D>.JointKind => SceneJointKind2D.Spring;

    SceneJointActorRef ISceneJoint2D<SceneSpringJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneSpringJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneSpringJoint2D>.ComputePayloadHash(in SceneSpringJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.Distance);
        hash = SceneJointHash2D.Mix(hash, value.Stiffness);
        hash = SceneJointHash2D.Mix(hash, value.Damping);
        hash = SceneJointHash2D.Mix(hash, value.AnchorA);
        hash = SceneJointHash2D.Mix(hash, value.AnchorB);
        hash = SceneJointHash2D.Mix(hash, value.AutoConfigureDistance);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneSpringJoint2D>.Create(
        in SceneSpringJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Spring(value, context, out jointId);
}

/// <summary>
/// Motor data component. Drives bodies to a relative pose from linear and
/// angular offsets without anchors.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneMotorJoint2D : ISceneJoint2D<SceneMotorJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Target linear offset in the frame of body A.</summary>
    public Vec2 LinearOffset;

    /// <summary>Target angular offset in radians.</summary>
    public float AngularOffset;

    /// <summary>Maximum correcting force.</summary>
    public float MaxForce;

    /// <summary>Maximum correcting torque.</summary>
    public float MaxTorque;

    /// <summary>Error correction factor in (0, 1].</summary>
    public float CorrectionFactor;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default motor with unit force caps and a 0.3 correction factor.</summary>
    public static SceneMotorJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            AngularOffset = 0.0f,
            MaxForce = 1.0f,
            MaxTorque = 1.0f,
            CorrectionFactor = 0.3f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneMotorJoint2D>.JointKind => SceneJointKind2D.Motor;

    SceneJointActorRef ISceneJoint2D<SceneMotorJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneMotorJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneMotorJoint2D>.ComputePayloadHash(in SceneMotorJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.LinearOffset);
        hash = SceneJointHash2D.Mix(hash, value.AngularOffset);
        hash = SceneJointHash2D.Mix(hash, value.MaxForce);
        hash = SceneJointHash2D.Mix(hash, value.MaxTorque);
        hash = SceneJointHash2D.Mix(hash, value.CorrectionFactor);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneMotorJoint2D>.Create(
        in SceneMotorJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Motor(value, context, out jointId);
}

/// <summary>
/// Wheel data component. Suspension compliance maps onto the solver's
/// frequency/damping pair; translation limit fields mirror the TypeScript
/// wheel but are a cross-package request for the 2D wheel definition.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneWheelJoint2D : ISceneJoint2D<SceneWheelJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 AnchorA;

    /// <summary>Local anchor on body B.</summary>
    public Vec2 AnchorB;

    /// <summary>Suspension axis in the frame of body A.</summary>
    public Vec2 Axis;

    /// <summary>Whether the translation limit channel is requested.</summary>
    public bool EnableLimit;

    /// <summary>Lower translation limit in metres.</summary>
    public float LowerTranslation;

    /// <summary>Upper translation limit in metres.</summary>
    public float UpperTranslation;

    /// <summary>Whether the motor channel drives the solver joint.</summary>
    public bool EnableMotor;

    /// <summary>Motor speed in radians per second.</summary>
    public float MotorSpeed;

    /// <summary>Maximum motor torque.</summary>
    public float MaxMotorTorque;

    /// <summary>Suspension stiffness; zero selects the solver default frequency.</summary>
    public float Stiffness;

    /// <summary>Suspension damping.</summary>
    public float Damping;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default unsprung wheel along Y with all channels disabled.</summary>
    public static SceneWheelJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec2(0.0f, 1.0f),
            EnableLimit = false,
            LowerTranslation = 0.0f,
            UpperTranslation = 0.0f,
            EnableMotor = false,
            MotorSpeed = 0.0f,
            MaxMotorTorque = 0.0f,
            Stiffness = 0.0f,
            Damping = 0.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneWheelJoint2D>.JointKind => SceneJointKind2D.Wheel;

    SceneJointActorRef ISceneJoint2D<SceneWheelJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneWheelJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneWheelJoint2D>.ComputePayloadHash(in SceneWheelJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.AnchorA);
        hash = SceneJointHash2D.Mix(hash, value.AnchorB);
        hash = SceneJointHash2D.Mix(hash, value.Axis);
        hash = SceneJointHash2D.Mix(hash, value.EnableLimit);
        hash = SceneJointHash2D.Mix(hash, value.LowerTranslation);
        hash = SceneJointHash2D.Mix(hash, value.UpperTranslation);
        hash = SceneJointHash2D.Mix(hash, value.EnableMotor);
        hash = SceneJointHash2D.Mix(hash, value.MotorSpeed);
        hash = SceneJointHash2D.Mix(hash, value.MaxMotorTorque);
        hash = SceneJointHash2D.Mix(hash, value.Stiffness);
        hash = SceneJointHash2D.Mix(hash, value.Damping);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneWheelJoint2D>.Create(
        in SceneWheelJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Wheel(value, context, out jointId);
}

/// <summary>
/// Rope data component. A unilateral guard that keeps the bodies within
/// <see cref="MaxLength"/> of each other.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneRopeJoint2D : ISceneJoint2D<SceneRopeJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec2 AnchorA;

    /// <summary>Local anchor on body B.</summary>
    public Vec2 AnchorB;

    /// <summary>Maximum rope length in metres.</summary>
    public float MaxLength;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default one-metre rope.</summary>
    public static SceneRopeJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            MaxLength = 1.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneRopeJoint2D>.JointKind => SceneJointKind2D.Rope;

    SceneJointActorRef ISceneJoint2D<SceneRopeJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneRopeJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneRopeJoint2D>.ComputePayloadHash(in SceneRopeJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.AnchorA);
        hash = SceneJointHash2D.Mix(hash, value.AnchorB);
        hash = SceneJointHash2D.Mix(hash, value.MaxLength);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneRopeJoint2D>.Create(
        in SceneRopeJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Rope(value, context, out jointId);
}

/// <summary>
/// Mouse data component. <see cref="Target"/> is world-space and is pushed to
/// the live solver joint every sync through the store's mouse-target path.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneMouseJoint2D : ISceneJoint2D<SceneMouseJoint2D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>World-space drag target.</summary>
    public Vec2 Target;

    /// <summary>Maximum correcting force.</summary>
    public float MaxForce;

    /// <summary>Target-tracking stiffness.</summary>
    public float Stiffness;

    /// <summary>Target-tracking damping in [0, 1).</summary>
    public float Damping;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default mouse joint with a 1000 force cap.</summary>
    public static SceneMouseJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            MaxForce = 1000.0f,
            Stiffness = 5.0f,
            Damping = 0.7f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneMouseJoint2D>.JointKind => SceneJointKind2D.Mouse;

    SceneJointActorRef ISceneJoint2D<SceneMouseJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneMouseJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneMouseJoint2D>.ComputePayloadHash(in SceneMouseJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.MaxForce);
        hash = SceneJointHash2D.Mix(hash, value.Stiffness);
        hash = SceneJointHash2D.Mix(hash, value.Damping);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneMouseJoint2D>.Create(
        in SceneMouseJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Mouse(value, context, out jointId);
}

/// <summary>
/// Gear data component coupling two existing joints by reference. A gear with
/// one unresolved joint reference stays pending and retries each sync,
/// mirroring the TypeScript deferred-creation path; a gear with no references
/// requests no solver joint.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneGearJoint2D : ISceneJoint2D<SceneGearJoint2D>
{
    /// <summary>Body B reference; carried for TypeScript parity.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>First coupled joint reference.</summary>
    public SceneJointRef2D JointA;

    /// <summary>Second coupled joint reference.</summary>
    public SceneJointRef2D JointB;

    /// <summary>Gear ratio; zero is rejected, negative reverses direction.</summary>
    public float Ratio;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default gear with ratio one and no coupled joints.</summary>
    public static SceneGearJoint2D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            JointA = SceneJointRef2D.Invalid,
            JointB = SceneJointRef2D.Invalid,
            Ratio = 1.0f,
            EnableCollision = false,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            Enabled = true
        };
    }

    static SceneJointKind2D ISceneJoint2D<SceneGearJoint2D>.JointKind => SceneJointKind2D.Gear;

    SceneJointActorRef ISceneJoint2D<SceneGearJoint2D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint2D<SceneGearJoint2D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint2D<SceneGearJoint2D>.ComputePayloadHash(in SceneGearJoint2D value)
    {
        ulong hash = SceneJointHash2D.Seed();
        hash = SceneJointHash2D.Mix(hash, value.ConnectedBody);
        hash = SceneJointHash2D.Mix(hash, value.JointA);
        hash = SceneJointHash2D.Mix(hash, value.JointB);
        hash = SceneJointHash2D.Mix(hash, value.Ratio);
        hash = SceneJointHash2D.Mix(hash, value.EnableCollision);
        hash = SceneJointHash2D.Mix(hash, value.BreakForce);
        hash = SceneJointHash2D.Mix(hash, value.BreakTorque);
        hash = SceneJointHash2D.Mix(hash, value.Enabled);
        return hash;
    }

    static SceneJointBuildResult2D ISceneJoint2D<SceneGearJoint2D>.Create(
        in SceneGearJoint2D value, SceneJointBuildContext2D context, out JointId jointId) =>
        SceneJointRuntime2D.Gear(value, context, out jointId);
}
