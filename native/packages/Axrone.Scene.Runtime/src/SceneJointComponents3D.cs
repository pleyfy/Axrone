namespace Axrone.Scene.Runtime;

using Axrone.Physics3D;

/// <summary>3D joint kinds published by the scene joint layer.</summary>
public enum SceneJointKind3D
{
    /// <summary>Rigid fixed (weld) joint.</summary>
    Fixed = 0,

    /// <summary>Rotational hinge joint with optional limits and motor.</summary>
    Hinge = 1,

    /// <summary>Translational slider joint with optional limits and motor.</summary>
    Slider = 2,

    /// <summary>Distance spring joint.</summary>
    Spring = 3,

    /// <summary>Character cone-twist joint.</summary>
    Character = 4,

    /// <summary>Per-axis configurable joint.</summary>
    Configurable = 5
}

/// <summary>Angular or linear limit triple mirroring the TypeScript joint limits struct.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct SceneJointLimits3D
{
    /// <summary>Constructs a limit triple.</summary>
    public SceneJointLimits3D(float min, float max, float bounciness, float contactDistance)
    {
        Min = min;
        Max = max;
        Bounciness = bounciness;
        ContactDistance = contactDistance;
    }

    /// <summary>Lower bound in solver units.</summary>
    public float Min { get; }

    /// <summary>Upper bound in solver units.</summary>
    public float Max { get; }

    /// <summary>Restitution on limit contact in [0, 1].</summary>
    public float Bounciness { get; }

    /// <summary>Distance before contact at which the limit engages.</summary>
    public float ContactDistance { get; }
}

/// <summary>Motor triple mirroring the TypeScript joint motor struct.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct SceneJointMotor3D
{
    /// <summary>Constructs a motor triple.</summary>
    public SceneJointMotor3D(float targetVelocity, float force, bool freeSpin)
    {
        TargetVelocity = targetVelocity;
        Force = force;
        FreeSpin = freeSpin;
    }

    /// <summary>Target velocity in solver units per second.</summary>
    public float TargetVelocity { get; }

    /// <summary>Maximum driving force or torque.</summary>
    public float Force { get; }

    /// <summary>Whether the motor ignores gravity on the driven axis.</summary>
    public bool FreeSpin { get; }
}

/// <summary>Soft limit triple mirroring the TypeScript soft joint limit struct.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct SceneSoftJointLimit3D
{
    /// <summary>Constructs a soft limit triple.</summary>
    public SceneSoftJointLimit3D(float limit, float bounciness, float contactDistance)
    {
        Limit = limit;
        Bounciness = bounciness;
        ContactDistance = contactDistance;
    }

    /// <summary>Limit magnitude in solver units.</summary>
    public float Limit { get; }

    /// <summary>Restitution on limit contact in [0, 1].</summary>
    public float Bounciness { get; }

    /// <summary>Distance before contact at which the limit engages.</summary>
    public float ContactDistance { get; }
}

/// <summary>Limit spring pair mirroring the TypeScript soft joint limit spring struct.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct SceneSoftJointLimitSpring3D
{
    /// <summary>Constructs a limit spring pair.</summary>
    public SceneSoftJointLimitSpring3D(float spring, float damper)
    {
        Spring = spring;
        Damper = damper;
    }

    /// <summary>Limit spring stiffness.</summary>
    public float Spring { get; }

    /// <summary>Limit spring damping.</summary>
    public float Damper { get; }
}

/// <summary>Drive quadruple mirroring the TypeScript joint drive struct.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct SceneJointDrive3D
{
    /// <summary>Constructs a drive quadruple.</summary>
    public SceneJointDrive3D(float positionSpring, float positionDamper, float maximumForce, bool useAcceleration)
    {
        PositionSpring = positionSpring;
        PositionDamper = positionDamper;
        MaximumForce = maximumForce;
        UseAcceleration = useAcceleration;
    }

    /// <summary>Position spring coefficient.</summary>
    public float PositionSpring { get; }

    /// <summary>Position damper coefficient.</summary>
    public float PositionDamper { get; }

    /// <summary>Force cap for the drive; positive infinity is unbounded.</summary>
    public float MaximumForce { get; }

    /// <summary>Whether the drive interprets gains as accelerations.</summary>
    public bool UseAcceleration { get; }
}

internal interface ISceneJoint3D<TSelf> : ISceneDataComponent
    where TSelf : unmanaged, ISceneDataComponent
{
    static abstract SceneJointKind3D JointKind { get; }

    static abstract ulong ComputePayloadHash(in TSelf value);

    static abstract SceneJointBuildResult3D Create(in TSelf value, SceneJointBuildContext3D context, out JointId jointId);

    SceneJointActorRef TargetBodyRef { get; }

    bool IsJointEnabled { get; }
}

/// <summary>Outcome of one 3D joint build attempt during bridge reconciliation.</summary>
internal enum SceneJointBuildResult3D
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

internal static class SceneJointHash3D
{
    internal static ulong Seed() => 14695981039346656037UL;

    internal static ulong Mix(ulong hash, uint value) => (hash ^ value) * SceneJointHash2D.FnvPrime;

    internal static ulong Mix(ulong hash, bool value) => (hash ^ (value ? 1u : 0u)) * SceneJointHash2D.FnvPrime;

    internal static ulong Mix(ulong hash, float value) =>
        Mix(hash, unchecked((uint)BitConverter.SingleToInt32Bits(value)));

    internal static ulong Mix(ulong hash, int value) => Mix(hash, unchecked((uint)value));

    internal static ulong Mix(ulong hash, in Vec3 value) =>
        Mix(Mix(Mix(hash, value.X), value.Y), value.Z);

    internal static ulong Mix(ulong hash, in Quat value) =>
        Mix(Mix(Mix(Mix(hash, value.X), value.Y), value.Z), value.W);

    internal static ulong Mix(ulong hash, in SceneJointActorRef value) =>
        Mix(Mix(hash, value.Slot), value.Generation);

    internal static ulong Mix(ulong hash, in SceneJointLimits3D value) =>
        Mix(Mix(Mix(Mix(hash, value.Min), value.Max), value.Bounciness), value.ContactDistance);

    internal static ulong Mix(ulong hash, in SceneJointMotor3D value) =>
        Mix(Mix(Mix(hash, value.TargetVelocity), value.Force), value.FreeSpin);

    internal static ulong Mix(ulong hash, in SceneSoftJointLimit3D value) =>
        Mix(Mix(Mix(hash, value.Limit), value.Bounciness), value.ContactDistance);

    internal static ulong MixSpring(ulong hash, in SceneSoftJointLimitSpring3D value) =>
        Mix(Mix(hash, value.Spring), value.Damper);

    internal static ulong MixDrive(ulong hash, in SceneJointDrive3D value) =>
        Mix(Mix(Mix(Mix(hash, value.PositionSpring), value.PositionDamper), value.MaximumForce), value.UseAcceleration);

    internal static ulong ComputeBase(
        in SceneJointActorRef connectedBody,
        in Vec3 anchor,
        in Vec3 connectedAnchor,
        bool autoConfigureConnectedAnchor,
        in Vec3 axis,
        in Vec3 secondaryAxis,
        float breakForce,
        float breakTorque,
        bool enableCollision,
        bool enablePreprocessing,
        float massScale,
        float connectedMassScale,
        bool enabled)
    {
        ulong hash = Seed();
        hash = Mix(hash, in connectedBody);
        hash = Mix(hash, in anchor);
        hash = Mix(hash, in connectedAnchor);
        hash = Mix(hash, autoConfigureConnectedAnchor);
        hash = Mix(hash, in axis);
        hash = Mix(hash, in secondaryAxis);
        hash = Mix(hash, breakForce);
        hash = Mix(hash, breakTorque);
        hash = Mix(hash, enableCollision);
        hash = Mix(hash, enablePreprocessing);
        hash = Mix(hash, massScale);
        hash = Mix(hash, connectedMassScale);
        hash = Mix(hash, enabled);
        return hash;
    }
}

/// <summary>
/// Fixed (weld) 3D data component. Rigidly attaches body B to body A at the
/// configured anchors.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneFixedJoint3D : ISceneJoint3D<SceneFixedJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Primary joint axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Default rigid weld with auto-configured connected anchor.</summary>
    public static SceneFixedJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneFixedJoint3D>.JointKind => SceneJointKind3D.Fixed;

    SceneJointActorRef ISceneJoint3D<SceneFixedJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneFixedJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneFixedJoint3D>.ComputePayloadHash(in SceneFixedJoint3D value) =>
        SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);

    static SceneJointBuildResult3D ISceneJoint3D<SceneFixedJoint3D>.Create(
        in SceneFixedJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Fixed(value, context, out jointId);
}

/// <summary>
/// Hinge 3D data component. Constrains rotation to one axis with optional
/// limits, motor and spring channels.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneHingeJoint3D : ISceneJoint3D<SceneHingeJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Hinge axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Whether the angular limit channel constrains the solver joint.</summary>
    public bool UseLimits;

    /// <summary>Angular limit triple.</summary>
    public SceneJointLimits3D Limits;

    /// <summary>Whether the motor channel drives the solver joint.</summary>
    public bool UseMotor;

    /// <summary>Motor triple.</summary>
    public SceneJointMotor3D Motor;

    /// <summary>Whether the limit spring channel is requested.</summary>
    public bool UseSpring;

    /// <summary>Limit spring pair.</summary>
    public SceneSoftJointLimitSpring3D Spring;

    /// <summary>Default free hinge with all channels disabled.</summary>
    public static SceneHingeJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true,
            UseLimits = false,
            UseMotor = false,
            UseSpring = false
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneHingeJoint3D>.JointKind => SceneJointKind3D.Hinge;

    SceneJointActorRef ISceneJoint3D<SceneHingeJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneHingeJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneHingeJoint3D>.ComputePayloadHash(in SceneHingeJoint3D value)
    {
        ulong hash = SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);
        hash = SceneJointHash3D.Mix(hash, value.UseLimits);
        hash = SceneJointHash3D.Mix(hash, in value.Limits);
        hash = SceneJointHash3D.Mix(hash, value.UseMotor);
        hash = SceneJointHash3D.Mix(hash, in value.Motor);
        hash = SceneJointHash3D.Mix(hash, value.UseSpring);
        hash = SceneJointHash3D.MixSpring(hash, in value.Spring);
        return hash;
    }

    static SceneJointBuildResult3D ISceneJoint3D<SceneHingeJoint3D>.Create(
        in SceneHingeJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Hinge(value, context, out jointId);
}

/// <summary>
/// Slider 3D data component. Constrains translation to one axis with optional
/// limits and motor; the spring channel mirrors the TypeScript slider but is
/// documented there as a silent no-op.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSliderJoint3D : ISceneJoint3D<SceneSliderJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Slide axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Whether the translation limit channel constrains the solver joint.</summary>
    public bool UseLimits;

    /// <summary>Translation limit triple.</summary>
    public SceneJointLimits3D Limits;

    /// <summary>Whether the motor channel drives the solver joint.</summary>
    public bool UseMotor;

    /// <summary>Motor triple.</summary>
    public SceneJointMotor3D Motor;

    /// <summary>Whether the limit spring channel is requested; no-op in the solver.</summary>
    public bool UseSpring;

    /// <summary>Limit spring pair; no-op in the solver.</summary>
    public SceneSoftJointLimitSpring3D Spring;

    /// <summary>Default free slider along X with all channels disabled.</summary>
    public static SceneSliderJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true,
            UseLimits = false,
            UseMotor = false,
            UseSpring = false
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneSliderJoint3D>.JointKind => SceneJointKind3D.Slider;

    SceneJointActorRef ISceneJoint3D<SceneSliderJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneSliderJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneSliderJoint3D>.ComputePayloadHash(in SceneSliderJoint3D value)
    {
        ulong hash = SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);
        hash = SceneJointHash3D.Mix(hash, value.UseLimits);
        hash = SceneJointHash3D.Mix(hash, in value.Limits);
        hash = SceneJointHash3D.Mix(hash, value.UseMotor);
        hash = SceneJointHash3D.Mix(hash, in value.Motor);
        hash = SceneJointHash3D.Mix(hash, value.UseSpring);
        hash = SceneJointHash3D.MixSpring(hash, in value.Spring);
        return hash;
    }

    static SceneJointBuildResult3D ISceneJoint3D<SceneSliderJoint3D>.Create(
        in SceneSliderJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Slider(value, context, out jointId);
}

/// <summary>
/// Spring 3D data component. A distance spring whose rest length is the mean
/// of the configured distance window, matching the TypeScript derivation.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSpringJoint3D : ISceneJoint3D<SceneSpringJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Primary joint axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Minimum spring distance in metres.</summary>
    public float MinDistance;

    /// <summary>Maximum spring distance in metres.</summary>
    public float MaxDistance;

    /// <summary>Spring stiffness coefficient.</summary>
    public float Spring;

    /// <summary>Spring damping coefficient.</summary>
    public float Damper;

    /// <summary>Trigger tolerance; carried for parity, not wired to the solver.</summary>
    public float Tolerance;

    /// <summary>Derive the distance window from live body poses at spawn.</summary>
    public bool AutoConfigureDistance;

    /// <summary>Default closed-window auto-configured spring.</summary>
    public static SceneSpringJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true,
            MinDistance = 0.0f,
            MaxDistance = 0.0f,
            Spring = 0.0f,
            Damper = 0.0f,
            Tolerance = 0.025f,
            AutoConfigureDistance = true
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneSpringJoint3D>.JointKind => SceneJointKind3D.Spring;

    SceneJointActorRef ISceneJoint3D<SceneSpringJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneSpringJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneSpringJoint3D>.ComputePayloadHash(in SceneSpringJoint3D value)
    {
        ulong hash = SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);
        hash = SceneJointHash3D.Mix(hash, value.MinDistance);
        hash = SceneJointHash3D.Mix(hash, value.MaxDistance);
        hash = SceneJointHash3D.Mix(hash, value.Spring);
        hash = SceneJointHash3D.Mix(hash, value.Damper);
        hash = SceneJointHash3D.Mix(hash, value.Tolerance);
        hash = SceneJointHash3D.Mix(hash, value.AutoConfigureDistance);
        return hash;
    }

    static SceneJointBuildResult3D ISceneJoint3D<SceneSpringJoint3D>.Create(
        in SceneSpringJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Spring(value, context, out jointId);
}

/// <summary>
/// Character (cone-twist) 3D data component. Limits author the swing and twist
/// spans consumed by the cone-twist solver joint.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneCharacterJoint3D : ISceneJoint3D<SceneCharacterJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Primary joint axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Swing axis in the frame of body A.</summary>
    public Vec3 SwingAxis;

    /// <summary>Lower twist limit.</summary>
    public SceneSoftJointLimit3D LowTwistLimit;

    /// <summary>Upper twist limit.</summary>
    public SceneSoftJointLimit3D HighTwistLimit;

    /// <summary>First swing limit.</summary>
    public SceneSoftJointLimit3D Swing1Limit;

    /// <summary>Second swing limit.</summary>
    public SceneSoftJointLimit3D Swing2Limit;

    /// <summary>Twist limit spring; carried for parity, not wired to the solver.</summary>
    public SceneSoftJointLimitSpring3D TwistLimitSpring;

    /// <summary>Swing limit spring; carried for parity, not wired to the solver.</summary>
    public SceneSoftJointLimitSpring3D SwingLimitSpring;

    /// <summary>Whether body projection is requested; not wired to the solver.</summary>
    public bool EnableProjection;

    /// <summary>Projection distance; not wired to the solver.</summary>
    public float ProjectionDistance;

    /// <summary>Projection angle; not wired to the solver.</summary>
    public float ProjectionAngle;

    /// <summary>Twist motor speed in radians per second.</summary>
    public float MotorSpeed;

    /// <summary>Maximum twist motor torque; zero disables the motor.</summary>
    public float MaxMotorTorque;

    /// <summary>Default cone-twist joint with zero spans and no motor.</summary>
    public static SceneCharacterJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true,
            SwingAxis = new Vec3(1.0f, 0.0f, 0.0f),
            ProjectionDistance = 0.1f,
            ProjectionAngle = 180.0f
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneCharacterJoint3D>.JointKind => SceneJointKind3D.Character;

    SceneJointActorRef ISceneJoint3D<SceneCharacterJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneCharacterJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneCharacterJoint3D>.ComputePayloadHash(in SceneCharacterJoint3D value)
    {
        ulong hash = SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);
        hash = SceneJointHash3D.Mix(hash, in value.SwingAxis);
        hash = SceneJointHash3D.Mix(hash, in value.LowTwistLimit);
        hash = SceneJointHash3D.Mix(hash, in value.HighTwistLimit);
        hash = SceneJointHash3D.Mix(hash, in value.Swing1Limit);
        hash = SceneJointHash3D.Mix(hash, in value.Swing2Limit);
        hash = SceneJointHash3D.MixSpring(hash, in value.TwistLimitSpring);
        hash = SceneJointHash3D.MixSpring(hash, in value.SwingLimitSpring);
        hash = SceneJointHash3D.Mix(hash, value.EnableProjection);
        hash = SceneJointHash3D.Mix(hash, value.ProjectionDistance);
        hash = SceneJointHash3D.Mix(hash, value.ProjectionAngle);
        hash = SceneJointHash3D.Mix(hash, value.MotorSpeed);
        hash = SceneJointHash3D.Mix(hash, value.MaxMotorTorque);
        return hash;
    }

    static SceneJointBuildResult3D ISceneJoint3D<SceneCharacterJoint3D>.Create(
        in SceneCharacterJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Character(value, context, out jointId);
}

/// <summary>
/// Configurable 3D data component. Per-axis motion values use the TypeScript
/// encoding: zero locks, one frees, two limits the axis.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneConfigurableJoint3D : ISceneJoint3D<SceneConfigurableJoint3D>
{
    /// <summary>Body B reference; body A is the rigid body on this actor.</summary>
    public SceneJointActorRef ConnectedBody;

    /// <summary>Local anchor on body A.</summary>
    public Vec3 Anchor;

    /// <summary>Local anchor on body B.</summary>
    public Vec3 ConnectedAnchor;

    /// <summary>Derive the body B anchor from live body poses at spawn.</summary>
    public bool AutoConfigureConnectedAnchor;

    /// <summary>Primary joint axis in the frame of body A.</summary>
    public Vec3 Axis;

    /// <summary>Secondary joint axis in the frame of body A.</summary>
    public Vec3 SecondaryAxis;

    /// <summary>Breaking threshold for force; positive infinity is unbreakable.</summary>
    public float BreakForce;

    /// <summary>Breaking threshold for torque; positive infinity is unbreakable.</summary>
    public float BreakTorque;

    /// <summary>Whether the connected bodies collide with each other.</summary>
    public bool EnableCollision;

    /// <summary>Whether solver preprocessing is requested for this joint.</summary>
    public bool EnablePreprocessing;

    /// <summary>Mass scale applied to body A at the joint.</summary>
    public float MassScale;

    /// <summary>Mass scale applied to body B at the joint.</summary>
    public float ConnectedMassScale;

    /// <summary>Whether the joint participates in the simulation.</summary>
    public bool Enabled;

    /// <summary>Motion mode for linear X; zero locked, one free, two limited.</summary>
    public float XMotion;

    /// <summary>Motion mode for linear Y; zero locked, one free, two limited.</summary>
    public float YMotion;

    /// <summary>Motion mode for linear Z; zero locked, one free, two limited.</summary>
    public float ZMotion;

    /// <summary>Motion mode for angular X; zero locked, one free, two limited.</summary>
    public float AngularXMotion;

    /// <summary>Motion mode for angular Y; zero locked, one free, two limited.</summary>
    public float AngularYMotion;

    /// <summary>Motion mode for angular Z; zero locked, one free, two limited.</summary>
    public float AngularZMotion;

    /// <summary>Shared linear limit consumed by limited linear axes.</summary>
    public SceneSoftJointLimit3D LinearLimit;

    /// <summary>Lower angular X limit; consumed at creation, not serialized, matching TypeScript.</summary>
    public SceneSoftJointLimit3D LowAngularXLimit;

    /// <summary>Upper angular X limit; consumed at creation, not serialized, matching TypeScript.</summary>
    public SceneSoftJointLimit3D HighAngularXLimit;

    /// <summary>Angular Y limit; consumed at creation, not serialized, matching TypeScript.</summary>
    public SceneSoftJointLimit3D AngularYLimit;

    /// <summary>Angular Z limit; consumed at creation, not serialized, matching TypeScript.</summary>
    public SceneSoftJointLimit3D AngularZLimit;

    /// <summary>Linear X drive.</summary>
    public SceneJointDrive3D XDrive;

    /// <summary>Linear Y drive.</summary>
    public SceneJointDrive3D YDrive;

    /// <summary>Linear Z drive.</summary>
    public SceneJointDrive3D ZDrive;

    /// <summary>Angular X drive.</summary>
    public SceneJointDrive3D AngularXDrive;

    /// <summary>Shared angular YZ drive.</summary>
    public SceneJointDrive3D AngularYZDrive;

    /// <summary>Target position drive per linear axis.</summary>
    public Vec3 TargetPosition;

    /// <summary>Target velocity drive per linear axis.</summary>
    public Vec3 TargetVelocity;

    /// <summary>Target rotation drive as a unit quaternion.</summary>
    public Quat TargetRotation;

    /// <summary>Target angular velocity drive per angular axis.</summary>
    public Vec3 TargetAngularVelocity;

    /// <summary>Rotation drive mode; carried for parity, not consumed by the solver.</summary>
    public int RotationDriveMode;

    /// <summary>Whether configuration is authored in world space; not consumed by the solver.</summary>
    public bool ConfiguredInWorldSpace;

    /// <summary>Whether the TypeScript swap flag is set; not consumed by the solver.</summary>
    public bool SwapBodies;

    /// <summary>Default configurable joint with every axis locked.</summary>
    public static SceneConfigurableJoint3D Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            ConnectedBody = SceneJointActorRef.Invalid,
            Axis = new Vec3(1.0f, 0.0f, 0.0f),
            SecondaryAxis = new Vec3(0.0f, 1.0f, 0.0f),
            AutoConfigureConnectedAnchor = true,
            BreakForce = float.PositiveInfinity,
            BreakTorque = float.PositiveInfinity,
            EnableCollision = false,
            EnablePreprocessing = true,
            MassScale = 1.0f,
            ConnectedMassScale = 1.0f,
            Enabled = true,
            XDrive = new SceneJointDrive3D(0.0f, 0.0f, float.PositiveInfinity, false),
            YDrive = new SceneJointDrive3D(0.0f, 0.0f, float.PositiveInfinity, false),
            ZDrive = new SceneJointDrive3D(0.0f, 0.0f, float.PositiveInfinity, false),
            AngularXDrive = new SceneJointDrive3D(0.0f, 0.0f, float.PositiveInfinity, false),
            AngularYZDrive = new SceneJointDrive3D(0.0f, 0.0f, float.PositiveInfinity, false),
            TargetRotation = Quat.Identity
        };
    }

    static SceneJointKind3D ISceneJoint3D<SceneConfigurableJoint3D>.JointKind => SceneJointKind3D.Configurable;

    SceneJointActorRef ISceneJoint3D<SceneConfigurableJoint3D>.TargetBodyRef => ConnectedBody;

    bool ISceneJoint3D<SceneConfigurableJoint3D>.IsJointEnabled => Enabled;

    static ulong ISceneJoint3D<SceneConfigurableJoint3D>.ComputePayloadHash(in SceneConfigurableJoint3D value)
    {
        ulong hash = SceneJointHash3D.ComputeBase(
            value.ConnectedBody, in value.Anchor, in value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
            in value.Axis, in value.SecondaryAxis, value.BreakForce, value.BreakTorque, value.EnableCollision,
            value.EnablePreprocessing, value.MassScale, value.ConnectedMassScale, value.Enabled);
        hash = SceneJointHash3D.Mix(hash, value.XMotion);
        hash = SceneJointHash3D.Mix(hash, value.YMotion);
        hash = SceneJointHash3D.Mix(hash, value.ZMotion);
        hash = SceneJointHash3D.Mix(hash, value.AngularXMotion);
        hash = SceneJointHash3D.Mix(hash, value.AngularYMotion);
        hash = SceneJointHash3D.Mix(hash, value.AngularZMotion);
        hash = SceneJointHash3D.Mix(hash, in value.LinearLimit);
        hash = SceneJointHash3D.Mix(hash, in value.LowAngularXLimit);
        hash = SceneJointHash3D.Mix(hash, in value.HighAngularXLimit);
        hash = SceneJointHash3D.Mix(hash, in value.AngularYLimit);
        hash = SceneJointHash3D.Mix(hash, in value.AngularZLimit);
        hash = SceneJointHash3D.MixDrive(hash, in value.XDrive);
        hash = SceneJointHash3D.MixDrive(hash, in value.YDrive);
        hash = SceneJointHash3D.MixDrive(hash, in value.ZDrive);
        hash = SceneJointHash3D.MixDrive(hash, in value.AngularXDrive);
        hash = SceneJointHash3D.MixDrive(hash, in value.AngularYZDrive);
        hash = SceneJointHash3D.Mix(hash, in value.TargetPosition);
        hash = SceneJointHash3D.Mix(hash, in value.TargetVelocity);
        hash = SceneJointHash3D.Mix(hash, in value.TargetRotation);
        hash = SceneJointHash3D.Mix(hash, in value.TargetAngularVelocity);
        hash = SceneJointHash3D.Mix(hash, value.RotationDriveMode);
        hash = SceneJointHash3D.Mix(hash, value.ConfiguredInWorldSpace);
        hash = SceneJointHash3D.Mix(hash, value.SwapBodies);
        return hash;
    }

    static SceneJointBuildResult3D ISceneJoint3D<SceneConfigurableJoint3D>.Create(
        in SceneConfigurableJoint3D value, SceneJointBuildContext3D context, out JointId jointId) =>
        SceneJointRuntime3D.Configurable(value, context, out jointId);
}
