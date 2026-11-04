namespace Axrone.Physics3D;

/// <summary>Rigid rod state: bodies, body-frame anchors, rest length and the accumulated impulse.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct DistanceJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Rest separation; never negative.</summary>
    public float Length;

    /// <summary>Accumulated impulse.</summary>
    public float Impulse;

    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Point-to-point state: bodies, body-frame anchors and the accumulated impulse vector.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct BallSocketJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Accumulated impulse.</summary>
    public Vec3 Impulse;

    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Full rigid-lock state: point coincidence plus the reference relative rotation and both impulses.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct WeldJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Relative orientation of B in A's frame at creation.</summary>
    public Quat ReferenceRotation;

    /// <summary>Accumulated linear impulse.</summary>
    public Vec3 LinearImpulse;

    /// <summary>Accumulated angular impulse.</summary>
    public Vec3 AngularImpulse;

    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Hinge state: point coincidence, axis alignment, stops and a speed motor.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct HingeJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Hinge axis in the first body frame.</summary>
    public Vec3 LocalAxisA;

    /// <summary>Hinge axis in the second body frame.</summary>
    public Vec3 LocalAxisB;

    /// <summary>Reference perpendicular in the first body frame for angle measurement.</summary>
    public Vec3 LocalPerpA;

    /// <summary>Reference perpendicular in the second body frame.</summary>
    public Vec3 LocalPerpB;

    /// <summary>Lower angular stop in radians.</summary>
    public float LowerLimit;

    /// <summary>Upper angular stop in radians.</summary>
    public float UpperLimit;

    /// <summary>Whether stops are enforced.</summary>
    public bool EnableLimit;

    /// <summary>Motor target speed in radians per second.</summary>
    public float MotorSpeed;

    /// <summary>Motor torque cap.</summary>
    public float MaxMotorTorque;

    /// <summary>Whether the motor drives.</summary>
    public bool EnableMotor;

    /// <summary>Accumulated point impulse.</summary>
    public Vec3 PointImpulse;

    /// <summary>Accumulated axis-alignment impulse (two rows).</summary>
    public Vec3 AxisImpulse;

    /// <summary>Accumulated limit impulse.</summary>
    public float LimitImpulse;

    /// <summary>Accumulated motor impulse.</summary>
    public float MotorImpulse;

    /// <summary>Stop enforcement mode.</summary>
    public JointLimitMode LimitMode;

    /// <summary>Spring parameters used when the stop mode is soft.</summary>
    public LimitSpringSettings LimitSpring;

    /// <summary>Frozen rebound velocity budget consumed by the first soft push.</summary>
    public float LimitBounceBias;

    /// <summary>Soft-stop engagement flag (1.0 when engaged).</summary>
    public float LimitEngaged;
    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Slider state: translation locked to one axis with stops and a drive motor.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct PrismaticJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Slide axis in the first body frame.</summary>
    public Vec3 LocalAxisA;

    /// <summary>Slide axis in the second body frame.</summary>
    public Vec3 LocalAxisB;

    /// <summary>Lower translation stop along the axis.</summary>
    public float LowerLimit;

    /// <summary>Upper translation stop along the axis.</summary>
    public float UpperLimit;

    /// <summary>Whether stops are enforced.</summary>
    public bool EnableLimit;

    /// <summary>Motor target speed along the axis.</summary>
    public float MotorSpeed;

    /// <summary>Motor force cap.</summary>
    public float MaxMotorForce;

    /// <summary>Whether the motor drives.</summary>
    public bool EnableMotor;

    /// <summary>Accumulated point-to-line impulse (two rows).</summary>
    public Vec3 LineImpulse;

    /// <summary>Accumulated axis-alignment impulse (two rows).</summary>
    public Vec3 AxisImpulse;

    /// <summary>Accumulated rotation-lock impulse.</summary>
    public Vec3 AngularImpulse;

    /// <summary>Accumulated limit impulse.</summary>
    public float LimitImpulse;

    /// <summary>Accumulated motor impulse.</summary>
    public float MotorImpulse;

    /// <summary>Stop enforcement mode.</summary>
    public JointLimitMode LimitMode;

    /// <summary>Spring parameters used when the stop mode is soft.</summary>
    public LimitSpringSettings LimitSpring;

    /// <summary>Frozen rebound velocity budget consumed by the first soft push.</summary>
    public float LimitBounceBias;

    /// <summary>Soft-stop engagement flag (1.0 when engaged).</summary>
    public float LimitEngaged;
    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Swing-cone state: point coincidence, cone stops, twist stops and a twist motor.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct ConeTwistJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Twist axis in the first body frame.</summary>
    public Vec3 LocalAxisA;

    /// <summary>Twist axis in the second body frame.</summary>
    public Vec3 LocalAxisB;

    /// <summary>Reference perpendicular in the first body frame for twist measurement.</summary>
    public Vec3 LocalPerpA;

    /// <summary>Reference perpendicular in the second body frame.</summary>
    public Vec3 LocalPerpB;

    /// <summary>Swing cone half-angle in radians.</summary>
    public float SwingSpan;

    /// <summary>Twist range in radians, centered on the reference.</summary>
    public float TwistSpan;

    /// <summary>Twist motor target speed in radians per second.</summary>
    public float MotorSpeed;

    /// <summary>Twist motor torque cap.</summary>
    public float MaxMotorTorque;

    /// <summary>Whether the twist motor drives.</summary>
    public bool EnableMotor;

    /// <summary>Accumulated point impulse.</summary>
    public Vec3 PointImpulse;

    /// <summary>Accumulated swing-correction impulse (two rows).</summary>
    public Vec3 SwingImpulse;

    /// <summary>Accumulated twist-limit impulse.</summary>
    public float TwistLimitImpulse;

    /// <summary>Accumulated twist-motor impulse.</summary>
    public float TwistMotorImpulse;

    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Per-axis motion mode of a configurable joint.</summary>
public enum JointAxisMode : byte
{
    /// <summary>No constraint on this axis.</summary>
    Free = 0,

    /// <summary>Bilateral lock holding the reference.</summary>
    Locked = 1,

    /// <summary>Stops with an optional motor.</summary>
    Limited = 2,
}

/// <summary>One-axis tuning of a configurable joint: stops plus an optional drive.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct JointAxisDef
{
    /// <summary>Motion mode of this axis.</summary>
    public JointAxisMode Mode;

    /// <summary>Lower stop.</summary>
    public float LowerLimit;

    /// <summary>Upper stop.</summary>
    public float UpperLimit;

    /// <summary>Motor target velocity.</summary>
    public float MotorVelocity;

    /// <summary>Motor force or torque cap.</summary>
    public float MaxForce;

    /// <summary>Whether the motor drives.</summary>
    public bool EnableMotor;

    /// <summary>Stop enforcement mode for this axis.</summary>
    public JointLimitMode LimitMode;

    /// <summary>Spring parameters used when the stop mode is soft.</summary>
    public LimitSpringSettings LimitSpring;
}

/// <summary>Six-degree tuning of a configurable joint: three linear slides plus three twists.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct ConfigurableJointDef
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Reference frame in the first body.</summary>
    public Quat LocalFrameA;

    /// <summary>Reference frame in the second body.</summary>
    public Quat LocalFrameB;

    /// <summary>Linear tuning per local axis.</summary>
    public JointAxisDef X;

    /// <summary>Linear tuning per local axis.</summary>
    public JointAxisDef Y;

    /// <summary>Linear tuning per local axis.</summary>
    public JointAxisDef Z;

    /// <summary>Angular tuning per local axis.</summary>
    public JointAxisDef AngularX;

    /// <summary>Angular tuning per local axis.</summary>
    public JointAxisDef AngularY;

    /// <summary>Angular tuning per local axis.</summary>
    public JointAxisDef AngularZ;
}

/// <summary>Six-degree state: anchors, reference frames, per-axis tuning and impulses.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct ConfigurableJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Reference orientation in the first body frame.</summary>
    public Quat LocalFrameA;

    /// <summary>Reference orientation in the second body frame.</summary>
    public Quat LocalFrameB;

    /// <summary>Linear tuning per axis.</summary>
    public JointAxisDef X;

    /// <summary>Linear tuning per axis.</summary>
    public JointAxisDef Y;

    /// <summary>Linear tuning per axis.</summary>
    public JointAxisDef Z;

    /// <summary>Angular tuning per axis.</summary>
    public JointAxisDef AngularX;

    /// <summary>Angular tuning per axis.</summary>
    public JointAxisDef AngularY;

    /// <summary>Angular tuning per axis.</summary>
    public JointAxisDef AngularZ;

    /// <summary>Accumulated linear impulses per axis.</summary>
    public Vec3 LinearImpulse;

    /// <summary>Accumulated angular impulses per axis.</summary>
    public Vec3 AngularImpulse;

    /// <summary>World anchor separation at creation; limited and locked axes hold it.</summary>
    public Vec3 ReferenceTranslation;

    /// <summary>Relative reference orientation at creation; locked axes hold it.</summary>
    public Quat ReferenceRotation;

    /// <summary>Per-axis soft-stop engagement budgets (1.0 when engaged).</summary>
    public Vec3 AxisEngaged;

    /// <summary>Per-axis frozen rebound velocity budgets.</summary>
    public Vec3 AxisBounceBias;
    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>Spring-damper state: rest length, stiffness, damping and endpoints.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct SpringJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec3 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec3 LocalAnchorB;

    /// <summary>Unstretched length; pulls together past it, pushes apart below it.</summary>
    public float RestLength;

    /// <summary>Spring stiffness.</summary>
    public float Stiffness;

    /// <summary>Damping against separation rate.</summary>
    public float Damping;

    /// <summary>Whether the slot holds a live joint.</summary>
    public bool Live;
}

/// <summary>
/// Dense segregated store of joints: one packed table per archetype,
/// kind-tagged identities, stable slots recycled through intrusive stacks.
/// Creation validates bodies and wakes sleeping dynamics; destroying a body
/// drops every joint touching it through <see cref="DestroyJointsOfBody"/>.
/// </summary>
public sealed class JointStore
{
    private const int InitialCapacity = 8;

    private DistanceJointData[] _distance;
    private int[] _distanceFree;
    private int _distanceFreeCount;
    private int _distanceHighWater;
    private int _distanceCount;

    private BallSocketJointData[] _ballSocket;
    private int[] _ballSocketFree;
    private int _ballSocketFreeCount;
    private int _ballSocketHighWater;
    private int _ballSocketCount;

    private WeldJointData[] _weld;
    private int[] _weldFree;
    private int _weldFreeCount;
    private int _weldHighWater;
    private int _weldCount;

    private HingeJointData[] _hinge;
    private int[] _hingeFree;
    private int _hingeFreeCount;
    private int _hingeHighWater;
    private int _hingeCount;

    private PrismaticJointData[] _prismatic;
    private int[] _prismaticFree;
    private int _prismaticFreeCount;
    private int _prismaticHighWater;
    private int _prismaticCount;

    private ConeTwistJointData[] _coneTwist;
    private int[] _coneTwistFree;
    private int _coneTwistFreeCount;
    private int _coneTwistHighWater;
    private int _coneTwistCount;

    private ConfigurableJointData[] _configurable;
    private int[] _configurableFree;
    private int _configurableFreeCount;
    private int _configurableHighWater;
    private int _configurableCount;

    private SpringJointData[] _spring;
    private int[] _springFree;
    private int _springFreeCount;
    private int _springHighWater;
    private int _springCount;

    /// <summary>Creates a store with room for eight joints per archetype.</summary>
    public JointStore()
    {
        _distance = new DistanceJointData[InitialCapacity];
        _distanceFree = new int[InitialCapacity];
        _ballSocket = new BallSocketJointData[InitialCapacity];
        _ballSocketFree = new int[InitialCapacity];
        _weld = new WeldJointData[InitialCapacity];
        _weldFree = new int[InitialCapacity];
        _hinge = new HingeJointData[InitialCapacity];
        _hingeFree = new int[InitialCapacity];
        _prismatic = new PrismaticJointData[InitialCapacity];
        _prismaticFree = new int[InitialCapacity];
        _coneTwist = new ConeTwistJointData[InitialCapacity];
        _coneTwistFree = new int[InitialCapacity];
        _configurable = new ConfigurableJointData[InitialCapacity];
        _configurableFree = new int[InitialCapacity];
        _spring = new SpringJointData[InitialCapacity];
        _springFree = new int[InitialCapacity];
    }

    /// <summary>Live joints across all archetypes.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _distanceCount + _ballSocketCount + _weldCount + _hingeCount + _prismaticCount + _coneTwistCount + _configurableCount + _springCount;
    }

    /// <summary>Whether <paramref name="id"/> names a live joint.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsValid(JointId id)
    {
        if (!id.IsValid)
        {
            return false;
        }

        int slot = (int)id.SlotIndex;
        return id.Kind switch
        {
            JointKind.Distance => slot < _distance.Length && _distance[slot].Live,
            JointKind.BallSocket => slot < _ballSocket.Length && _ballSocket[slot].Live,
            JointKind.Weld => slot < _weld.Length && _weld[slot].Live,
            JointKind.Hinge => slot < _hinge.Length && _hinge[slot].Live,
            JointKind.Prismatic => slot < _prismatic.Length && _prismatic[slot].Live,
            JointKind.ConeTwist => slot < _coneTwist.Length && _coneTwist[slot].Live,
            JointKind.Configurable => slot < _configurable.Length && _configurable[slot].Live,
            JointKind.Spring => slot < _spring.Length && _spring[slot].Live,
            _ => false,
        };
    }

    /// <summary>Creates a rigid rod between two body-frame anchors and wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="length">Rest separation; finite and never negative.</param>
    public JointId CreateDistance(
        BodyStore bodies, BodyId bodyA, BodyId bodyB, Vec3 localAnchorA, Vec3 localAnchorB, float length)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (!(length >= 0.0f) || float.IsNaN(length) || float.IsInfinity(length))
        {
            ThrowHelper.ThrowInvalidOperation("Joint rest length must be finite and non-negative.");
        }

        int slot = AllocateDistance();
        _distance[slot] = new DistanceJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            Length = length,
            Impulse = 0.0f,
            Live = true,
        };
        _distanceCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.Distance, (uint)slot);
    }

    /// <summary>Creates a point-to-point joint between two body-frame anchors and wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    public JointId CreateBallSocket(BodyStore bodies, BodyId bodyA, BodyId bodyB, Vec3 localAnchorA, Vec3 localAnchorB)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        int slot = AllocateBallSocket();
        _ballSocket[slot] = new BallSocketJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            Impulse = Vec3.Zero,
            Live = true,
        };
        _ballSocketCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.BallSocket, (uint)slot);
    }

    /// <summary>Freezes the current relative placement of two bodies and wakes both.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    public JointId CreateWeld(BodyStore bodies, BodyId bodyA, BodyId bodyB, Vec3 localAnchorA, Vec3 localAnchorB)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ref BodyState stateA = ref bodies.Slot(bodyA);
        ref BodyState stateB = ref bodies.Slot(bodyB);

        int slot = AllocateWeld();
        _weld[slot] = new WeldJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            ReferenceRotation = stateA.Rotation.Conjugate() * stateB.Rotation,
            LinearImpulse = Vec3.Zero,
            AngularImpulse = Vec3.Zero,
            Live = true,
        };
        _weldCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.Weld, (uint)slot);
    }

    /// <summary>Creates a hinge around a body-frame axis with optional stops and motor; wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="localAxisA">Hinge axis in the first body frame; must be a unit vector.</param>
    /// <param name="localAxisB">Hinge axis in the second body frame; must be a unit vector.</param>
    /// <param name="lowerLimit">Lower angular stop in radians.</param>
    /// <param name="upperLimit">Upper angular stop in radians.</param>
    /// <param name="enableLimit">Whether stops are enforced.</param>
    /// <param name="motorSpeed">Motor target speed in radians per second.</param>
    /// <param name="maxMotorTorque">Motor torque cap.</param>
    /// <param name="enableMotor">Whether the motor drives.</param>
    /// <param name="limitMode">Hard or soft stop enforcement.</param>
    /// <param name="limitSpring">Spring parameters used when the stop mode is soft.</param>
    public JointId CreateHinge(
        BodyStore bodies, BodyId bodyA, BodyId bodyB,
        Vec3 localAnchorA, Vec3 localAnchorB, Vec3 localAxisA, Vec3 localAxisB,
        float lowerLimit = 0.0f, float upperLimit = 0.0f, bool enableLimit = false,
        float motorSpeed = 0.0f, float maxMotorTorque = 0.0f, bool enableMotor = false,
        JointLimitMode limitMode = JointLimitMode.Hard, LimitSpringSettings limitSpring = default)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (limitMode == JointLimitMode.Soft)
        {
            limitSpring.ValidateForSoft();
        }

        if (MathF.Abs(localAxisA.LengthSquared() - 1.0f) > 1e-4f || MathF.Abs(localAxisB.LengthSquared() - 1.0f) > 1e-4f)
        {
            ThrowHelper.ThrowInvalidOperation("Hinge axes must be unit vectors.");
        }

        if (enableLimit && lowerLimit > upperLimit)
        {
            ThrowHelper.ThrowInvalidOperation("Hinge lower limit must not exceed the upper limit.");
        }

        if (enableMotor && (!(maxMotorTorque >= 0.0f) || float.IsNaN(maxMotorTorque)))
        {
            ThrowHelper.ThrowInvalidOperation("Hinge motor torque cap must not be negative.");
        }

        int slot = AllocateHinge();
        _hinge[slot] = new HingeJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            LocalAxisA = localAxisA,
            LocalAxisB = localAxisB,
            LocalPerpA = Perpendicular(localAxisA),
            LocalPerpB = Perpendicular(localAxisB),
            LowerLimit = lowerLimit,
            UpperLimit = upperLimit,
            EnableLimit = enableLimit,
            MotorSpeed = motorSpeed,
            MaxMotorTorque = maxMotorTorque,
            EnableMotor = enableMotor,
            LimitMode = limitMode,
            LimitSpring = limitSpring,
            LimitBounceBias = 0.0f,
            LimitEngaged = 0.0f,
            PointImpulse = Vec3.Zero,
            AxisImpulse = Vec3.Zero,
            LimitImpulse = 0.0f,
            MotorImpulse = 0.0f,
            Live = true,
        };
        _hingeCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.Hinge, (uint)slot);
    }

    /// <summary>Creates a slider along a body-frame axis with optional stops and motor; wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="localAxisA">Slide axis in the first body frame; must be a unit vector.</param>
    /// <param name="localAxisB">Slide axis in the second body frame; must be a unit vector.</param>
    /// <param name="lowerLimit">Lower translation stop along the axis.</param>
    /// <param name="upperLimit">Upper translation stop along the axis.</param>
    /// <param name="enableLimit">Whether stops are enforced.</param>
    /// <param name="motorSpeed">Motor target speed along the axis.</param>
    /// <param name="maxMotorForce">Motor force cap.</param>
    /// <param name="enableMotor">Whether the motor drives.</param>
    /// <param name="limitMode">Hard or soft stop enforcement.</param>
    /// <param name="limitSpring">Spring parameters used when the stop mode is soft.</param>
    public JointId CreatePrismatic(
        BodyStore bodies, BodyId bodyA, BodyId bodyB,
        Vec3 localAnchorA, Vec3 localAnchorB, Vec3 localAxisA, Vec3 localAxisB,
        float lowerLimit = 0.0f, float upperLimit = 0.0f, bool enableLimit = false,
        float motorSpeed = 0.0f, float maxMotorForce = 0.0f, bool enableMotor = false,
        JointLimitMode limitMode = JointLimitMode.Hard, LimitSpringSettings limitSpring = default)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (limitMode == JointLimitMode.Soft)
        {
            limitSpring.ValidateForSoft();
        }

        if (MathF.Abs(localAxisA.LengthSquared() - 1.0f) > 1e-4f || MathF.Abs(localAxisB.LengthSquared() - 1.0f) > 1e-4f)
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic axes must be unit vectors.");
        }

        if (enableLimit && lowerLimit > upperLimit)
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic lower limit must not exceed the upper limit.");
        }

        if (enableMotor && (!(maxMotorForce >= 0.0f) || float.IsNaN(maxMotorForce)))
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic motor force cap must not be negative.");
        }

        int slot = AllocatePrismatic();
        _prismatic[slot] = new PrismaticJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            LocalAxisA = localAxisA,
            LocalAxisB = localAxisB,
            LowerLimit = lowerLimit,
            UpperLimit = upperLimit,
            EnableLimit = enableLimit,
            MotorSpeed = motorSpeed,
            MaxMotorForce = maxMotorForce,
            EnableMotor = enableMotor,
            LimitMode = limitMode,
            LimitSpring = limitSpring,
            LimitBounceBias = 0.0f,
            LimitEngaged = 0.0f,
            LineImpulse = Vec3.Zero,
            AxisImpulse = Vec3.Zero,
            AngularImpulse = Vec3.Zero,
            LimitImpulse = 0.0f,
            MotorImpulse = 0.0f,
            Live = true,
        };
        _prismaticCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.Prismatic, (uint)slot);
    }

    /// <summary>Creates a swing-cone joint with twist stops and an optional twist motor; wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="localAxisA">Twist axis in the first body frame; must be a unit vector.</param>
    /// <param name="localAxisB">Twist axis in the second body frame; must be a unit vector.</param>
    /// <param name="swingSpan">Swing cone half-angle in radians; never negative.</param>
    /// <param name="twistSpan">Twist range in radians centered on the reference; never negative.</param>
    /// <param name="motorSpeed">Twist motor target speed in radians per second.</param>
    /// <param name="maxMotorTorque">Twist motor torque cap.</param>
    /// <param name="enableMotor">Whether the twist motor drives.</param>
    public JointId CreateConeTwist(
        BodyStore bodies, BodyId bodyA, BodyId bodyB,
        Vec3 localAnchorA, Vec3 localAnchorB, Vec3 localAxisA, Vec3 localAxisB,
        float swingSpan = 0.5f, float twistSpan = 0.5f,
        float motorSpeed = 0.0f, float maxMotorTorque = 0.0f, bool enableMotor = false)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (MathF.Abs(localAxisA.LengthSquared() - 1.0f) > 1e-4f || MathF.Abs(localAxisB.LengthSquared() - 1.0f) > 1e-4f)
        {
            ThrowHelper.ThrowInvalidOperation("Cone-twist axes must be unit vectors.");
        }

        if (swingSpan < 0.0f || float.IsNaN(swingSpan) || twistSpan < 0.0f || float.IsNaN(twistSpan))
        {
            ThrowHelper.ThrowInvalidOperation("Cone-twist spans must not be negative.");
        }

        if (enableMotor && (!(maxMotorTorque >= 0.0f) || float.IsNaN(maxMotorTorque)))
        {
            ThrowHelper.ThrowInvalidOperation("Cone-twist motor torque cap must not be negative.");
        }

        int slot = AllocateConeTwist();
        _coneTwist[slot] = new ConeTwistJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            LocalAxisA = localAxisA,
            LocalAxisB = localAxisB,
            LocalPerpA = Perpendicular(localAxisA),
            LocalPerpB = Perpendicular(localAxisB),
            SwingSpan = swingSpan,
            TwistSpan = twistSpan,
            MotorSpeed = motorSpeed,
            MaxMotorTorque = maxMotorTorque,
            EnableMotor = enableMotor,
            PointImpulse = Vec3.Zero,
            SwingImpulse = Vec3.Zero,
            TwistLimitImpulse = 0.0f,
            TwistMotorImpulse = 0.0f,
            Live = true,
        };
        _coneTwistCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.ConeTwist, (uint)slot);
    }

    /// <summary>Creates a six-degree joint from a tuning definition; wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="definition">Anchors, reference frames and per-axis tuning.</param>
    public JointId CreateConfigurable(BodyStore bodies, in ConfigurableJointDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(definition.BodyA);
        bodies.Slot(definition.BodyB);
        ValidateAxis(definition.X, nameof(ConfigurableJointDef.X));
        ValidateAxis(definition.Y, nameof(ConfigurableJointDef.Y));
        ValidateAxis(definition.Z, nameof(ConfigurableJointDef.Z));
        ValidateAxis(definition.AngularX, nameof(ConfigurableJointDef.AngularX));
        ValidateAxis(definition.AngularY, nameof(ConfigurableJointDef.AngularY));
        ValidateAxis(definition.AngularZ, nameof(ConfigurableJointDef.AngularZ));

        ref BodyState stateARef = ref bodies.Slot(definition.BodyA);
        ref BodyState stateBRef = ref bodies.Slot(definition.BodyB);
        Quat frameARef = definition.LocalFrameA.Equals(default(Quat)) ? Quat.Identity : definition.LocalFrameA;
        Quat frameBRef = definition.LocalFrameB.Equals(default(Quat)) ? Quat.Identity : definition.LocalFrameB;
        var worldARef = new RigidTransform3D(stateARef.Position, stateARef.Rotation);
        var worldBRef = new RigidTransform3D(stateBRef.Position, stateBRef.Rotation);

        int slot = AllocateConfigurable();
        _configurable[slot] = new ConfigurableJointData
        {
            BodyA = definition.BodyA,
            BodyB = definition.BodyB,
            LocalAnchorA = definition.LocalAnchorA,
            LocalAnchorB = definition.LocalAnchorB,
            LocalFrameA = frameARef,
            LocalFrameB = frameBRef,
            X = definition.X,
            Y = definition.Y,
            Z = definition.Z,
            AngularX = definition.AngularX,
            AngularY = definition.AngularY,
            AngularZ = definition.AngularZ,
            LinearImpulse = Vec3.Zero,
            AngularImpulse = Vec3.Zero,
            ReferenceTranslation = worldBRef.TransformPoint(definition.LocalAnchorB) - worldARef.TransformPoint(definition.LocalAnchorA),
            ReferenceRotation = (stateARef.Rotation * frameARef).Conjugate() * (stateBRef.Rotation * frameBRef),
            Live = true,
        };
        _configurableCount++;
        bodies.SetAwake(definition.BodyA, true);
        bodies.SetAwake(definition.BodyB, true);
        return new JointId(JointKind.Configurable, (uint)slot);
    }

    /// <summary>Validates one axis tuning block.</summary>
    private static void ValidateAxis(in JointAxisDef axis, string name)
    {
        if (axis.Mode == JointAxisMode.Limited && axis.LowerLimit > axis.UpperLimit)
        {
            ThrowHelper.ThrowInvalidOperation($"{name} lower limit must not exceed the upper limit.");
        }

        if (axis.EnableMotor && (!(axis.MaxForce >= 0.0f) || float.IsNaN(axis.MaxForce)))
        {
            ThrowHelper.ThrowInvalidOperation($"{name} motor cap must not be negative.");
        }

        if (axis.Mode == JointAxisMode.Limited && axis.LimitMode == JointLimitMode.Soft)
        {
            axis.LimitSpring.ValidateForSoft();
        }
    }

    /// <summary>Rewrites hinge stops and wakes both bodies.</summary>
    public void SetHingeLimit(BodyStore bodies, JointId id, float lowerLimit, float upperLimit, bool enableLimit)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        int slot = Validate(id);
        ref HingeJointData joint = ref _hinge[slot];
        if (enableLimit && lowerLimit > upperLimit)
        {
            ThrowHelper.ThrowInvalidOperation("Hinge lower limit must not exceed the upper limit.");
        }

        joint.LowerLimit = lowerLimit;
        joint.UpperLimit = upperLimit;
        joint.EnableLimit = enableLimit;
        ResetHingeLimitState(ref joint);
        bodies.SetAwake(joint.BodyA, true);
        bodies.SetAwake(joint.BodyB, true);
    }

    /// <summary>Switches hinge stop enforcement between hard and soft modes and wakes both bodies.</summary>
    public void SetHingeLimitSpring(BodyStore bodies, JointId id, JointLimitMode mode, LimitSpringSettings spring)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        int slot = Validate(id);
        ref HingeJointData joint = ref _hinge[slot];
        if (mode == JointLimitMode.Soft)
        {
            spring.ValidateForSoft();
        }

        joint.LimitMode = mode;
        joint.LimitSpring = spring;
        ResetHingeLimitState(ref joint);
        bodies.SetAwake(joint.BodyA, true);
        bodies.SetAwake(joint.BodyB, true);
    }

    /// <summary>Rewrites prismatic stops and wakes both bodies.</summary>
    public void SetPrismaticLimit(BodyStore bodies, JointId id, float lowerLimit, float upperLimit, bool enableLimit)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        int slot = Validate(id);
        ref PrismaticJointData joint = ref _prismatic[slot];
        if (enableLimit && lowerLimit > upperLimit)
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic lower limit must not exceed the upper limit.");
        }

        joint.LowerLimit = lowerLimit;
        joint.UpperLimit = upperLimit;
        joint.EnableLimit = enableLimit;
        ResetPrismaticLimitState(ref joint);
        bodies.SetAwake(joint.BodyA, true);
        bodies.SetAwake(joint.BodyB, true);
    }

    /// <summary>Switches prismatic stop enforcement between hard and soft modes and wakes both bodies.</summary>
    public void SetPrismaticLimitSpring(BodyStore bodies, JointId id, JointLimitMode mode, LimitSpringSettings spring)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        int slot = Validate(id);
        ref PrismaticJointData joint = ref _prismatic[slot];
        if (mode == JointLimitMode.Soft)
        {
            spring.ValidateForSoft();
        }

        joint.LimitMode = mode;
        joint.LimitSpring = spring;
        ResetPrismaticLimitState(ref joint);
        bodies.SetAwake(joint.BodyA, true);
        bodies.SetAwake(joint.BodyB, true);
    }

    private static void ResetHingeLimitState(ref HingeJointData joint)
    {
        joint.LimitImpulse = 0.0f;
        joint.LimitBounceBias = 0.0f;
        joint.LimitEngaged = 0.0f;
    }

    private static void ResetPrismaticLimitState(ref PrismaticJointData joint)
    {
        joint.LimitImpulse = 0.0f;
        joint.LimitBounceBias = 0.0f;
        joint.LimitEngaged = 0.0f;
    }

    /// <summary>Creates a spring-damper between two body-frame anchors; wakes both bodies.</summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="restLength">Unstretched length; finite and never negative.</param>
    /// <param name="stiffness">Spring stiffness; never negative.</param>
    /// <param name="damping">Damping; never negative.</param>
    public JointId CreateSpring(
        BodyStore bodies, BodyId bodyA, BodyId bodyB,
        Vec3 localAnchorA, Vec3 localAnchorB, float restLength, float stiffness, float damping)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (!(restLength >= 0.0f) || float.IsNaN(restLength) || float.IsInfinity(restLength))
        {
            ThrowHelper.ThrowInvalidOperation("Spring rest length must be finite and non-negative.");
        }

        if (!(stiffness >= 0.0f) || float.IsNaN(stiffness) || !(damping >= 0.0f) || float.IsNaN(damping))
        {
            ThrowHelper.ThrowInvalidOperation("Spring stiffness and damping must not be negative.");
        }

        int slot = AllocateSpring();
        _spring[slot] = new SpringJointData
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            RestLength = restLength,
            Stiffness = stiffness,
            Damping = damping,
            Live = true,
        };
        _springCount++;
        bodies.SetAwake(bodyA, true);
        bodies.SetAwake(bodyB, true);
        return new JointId(JointKind.Spring, (uint)slot);
    }

    /// <summary>Drops a joint; its identity dies with it.</summary>
    public void Destroy(JointId id)
    {
        int slot = Validate(id);
        switch (id.Kind)
        {
            case JointKind.Distance:
                _distance[slot] = default;
                _distanceFree[_distanceFreeCount++] = slot;
                _distanceCount--;
                break;
            case JointKind.BallSocket:
                _ballSocket[slot] = default;
                _ballSocketFree[_ballSocketFreeCount++] = slot;
                _ballSocketCount--;
                break;
            case JointKind.Weld:
                _weld[slot] = default;
                _weldFree[_weldFreeCount++] = slot;
                _weldCount--;
                break;
            case JointKind.Hinge:
                _hinge[slot] = default;
                _hingeFree[_hingeFreeCount++] = slot;
                _hingeCount--;
                break;
            case JointKind.Prismatic:
                _prismatic[slot] = default;
                _prismaticFree[_prismaticFreeCount++] = slot;
                _prismaticCount--;
                break;
            case JointKind.ConeTwist:
                _coneTwist[slot] = default;
                _coneTwistFree[_coneTwistFreeCount++] = slot;
                _coneTwistCount--;
                break;
            case JointKind.Configurable:
                _configurable[slot] = default;
                _configurableFree[_configurableFreeCount++] = slot;
                _configurableCount--;
                break;
            default:
                _spring[slot] = default;
                _springFree[_springFreeCount++] = slot;
                _springCount--;
                break;
        }
    }

    /// <summary>Drops every joint touching a body; call before destroying the body.</summary>
    public void DestroyJointsOfBody(BodyId bodyId)
    {
        for (int i = 0; i < _distance.Length; i++)
        {
            if (_distance[i].Live && (_distance[i].BodyA == bodyId || _distance[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Distance, (uint)i));
            }
        }

        for (int i = 0; i < _ballSocket.Length; i++)
        {
            if (_ballSocket[i].Live && (_ballSocket[i].BodyA == bodyId || _ballSocket[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.BallSocket, (uint)i));
            }
        }

        for (int i = 0; i < _weld.Length; i++)
        {
            if (_weld[i].Live && (_weld[i].BodyA == bodyId || _weld[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Weld, (uint)i));
            }
        }

        for (int i = 0; i < _hinge.Length; i++)
        {
            if (_hinge[i].Live && (_hinge[i].BodyA == bodyId || _hinge[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Hinge, (uint)i));
            }
        }

        for (int i = 0; i < _prismatic.Length; i++)
        {
            if (_prismatic[i].Live && (_prismatic[i].BodyA == bodyId || _prismatic[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Prismatic, (uint)i));
            }
        }

        for (int i = 0; i < _coneTwist.Length; i++)
        {
            if (_coneTwist[i].Live && (_coneTwist[i].BodyA == bodyId || _coneTwist[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.ConeTwist, (uint)i));
            }
        }

        for (int i = 0; i < _configurable.Length; i++)
        {
            if (_configurable[i].Live && (_configurable[i].BodyA == bodyId || _configurable[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Configurable, (uint)i));
            }
        }

        for (int i = 0; i < _spring.Length; i++)
        {
            if (_spring[i].Live && (_spring[i].BodyA == bodyId || _spring[i].BodyB == bodyId))
            {
                Destroy(new JointId(JointKind.Spring, (uint)i));
            }
        }
    }

    /// <summary>Copies every live joint edge into the destination; returns the edges written.</summary>
    internal int CopyJointPairs(Span<JointPair3D> destination)
    {
        int count = 0;
        for (int i = 0; i < _distance.Length && count < destination.Length; i++)
        {
            if (_distance[i].Live)
            {
                destination[count++] = new JointPair3D(_distance[i].BodyA, _distance[i].BodyB);
            }
        }

        for (int i = 0; i < _ballSocket.Length && count < destination.Length; i++)
        {
            if (_ballSocket[i].Live)
            {
                destination[count++] = new JointPair3D(_ballSocket[i].BodyA, _ballSocket[i].BodyB);
            }
        }

        for (int i = 0; i < _weld.Length && count < destination.Length; i++)
        {
            if (_weld[i].Live)
            {
                destination[count++] = new JointPair3D(_weld[i].BodyA, _weld[i].BodyB);
            }
        }

        for (int i = 0; i < _hinge.Length && count < destination.Length; i++)
        {
            if (_hinge[i].Live)
            {
                destination[count++] = new JointPair3D(_hinge[i].BodyA, _hinge[i].BodyB);
            }
        }

        for (int i = 0; i < _prismatic.Length && count < destination.Length; i++)
        {
            if (_prismatic[i].Live)
            {
                destination[count++] = new JointPair3D(_prismatic[i].BodyA, _prismatic[i].BodyB);
            }
        }

        for (int i = 0; i < _coneTwist.Length && count < destination.Length; i++)
        {
            if (_coneTwist[i].Live)
            {
                destination[count++] = new JointPair3D(_coneTwist[i].BodyA, _coneTwist[i].BodyB);
            }
        }

        for (int i = 0; i < _configurable.Length && count < destination.Length; i++)
        {
            if (_configurable[i].Live)
            {
                destination[count++] = new JointPair3D(_configurable[i].BodyA, _configurable[i].BodyB);
            }
        }

        for (int i = 0; i < _spring.Length && count < destination.Length; i++)
        {
            if (_spring[i].Live)
            {
                destination[count++] = new JointPair3D(_spring[i].BodyA, _spring[i].BodyB);
            }
        }

        return count;
    }

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref DistanceJointData Distance(int slot) => ref _distance[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref BallSocketJointData BallSocket(int slot) => ref _ballSocket[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref WeldJointData Weld(int slot) => ref _weld[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref HingeJointData Hinge(int slot) => ref _hinge[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref PrismaticJointData Prismatic(int slot) => ref _prismatic[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref ConeTwistJointData ConeTwist(int slot) => ref _coneTwist[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref ConfigurableJointData Configurable(int slot) => ref _configurable[slot];

    /// <summary>Internal table access for the solver; validated.</summary>
    internal ref SpringJointData Spring(int slot) => ref _spring[slot];

    /// <summary>Table length for solver iteration.</summary>
    internal int DistanceCapacity => _distance.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int BallSocketCapacity => _ballSocket.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int WeldCapacity => _weld.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int HingeCapacity => _hinge.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int PrismaticCapacity => _prismatic.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int ConeTwistCapacity => _coneTwist.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int ConfigurableCapacity => _configurable.Length;

    /// <summary>Table length for solver iteration.</summary>
    internal int SpringCapacity => _spring.Length;

    /// <summary>Whether a distance slot holds a live joint; for solver iteration.</summary>
    internal bool IsDistanceLive(int slot) => _distance[slot].Live;

    /// <summary>Whether a ball-socket slot holds a live joint; for solver iteration.</summary>
    internal bool IsBallSocketLive(int slot) => _ballSocket[slot].Live;

    /// <summary>Whether a weld slot holds a live joint; for solver iteration.</summary>
    internal bool IsWeldLive(int slot) => _weld[slot].Live;

    /// <summary>Whether a hinge slot holds a live joint; for solver iteration.</summary>
    internal bool IsHingeLive(int slot) => _hinge[slot].Live;

    /// <summary>Whether a prismatic slot holds a live joint; for solver iteration.</summary>
    internal bool IsPrismaticLive(int slot) => _prismatic[slot].Live;

    /// <summary>Whether a cone-twist slot holds a live joint; for solver iteration.</summary>
    internal bool IsConeTwistLive(int slot) => _coneTwist[slot].Live;

    /// <summary>Whether a configurable slot holds a live joint; for solver iteration.</summary>
    internal bool IsConfigurableLive(int slot) => _configurable[slot].Live;

    /// <summary>Whether a spring slot holds a live joint; for solver iteration.</summary>
    internal bool IsSpringLive(int slot) => _spring[slot].Live;

    private int AllocateDistance()
    {
        if (_distanceFreeCount > 0)
        {
            return _distanceFree[--_distanceFreeCount];
        }

        if (_distanceHighWater >= _distance.Length)
        {
            Array.Resize(ref _distance, _distance.Length * 2);
            Array.Resize(ref _distanceFree, _distanceFree.Length * 2);
        }

        return _distanceHighWater++;
    }


    private int AllocateBallSocket()
    {
        if (_ballSocketFreeCount > 0)
        {
            return _ballSocketFree[--_ballSocketFreeCount];
        }

        if (_ballSocketHighWater >= _ballSocket.Length)
        {
            Array.Resize(ref _ballSocket, _ballSocket.Length * 2);
            Array.Resize(ref _ballSocketFree, _ballSocketFree.Length * 2);
        }

        return _ballSocketHighWater++;
    }


    private int AllocateWeld()
    {
        if (_weldFreeCount > 0)
        {
            return _weldFree[--_weldFreeCount];
        }

        if (_weldHighWater >= _weld.Length)
        {
            Array.Resize(ref _weld, _weld.Length * 2);
            Array.Resize(ref _weldFree, _weldFree.Length * 2);
        }

        return _weldHighWater++;
    }

    private int AllocateHinge()
    {
        if (_hingeFreeCount > 0)
        {
            return _hingeFree[--_hingeFreeCount];
        }

        if (_hingeHighWater >= _hinge.Length)
        {
            Array.Resize(ref _hinge, _hinge.Length * 2);
            Array.Resize(ref _hingeFree, _hingeFree.Length * 2);
        }

        return _hingeHighWater++;
    }

    private int AllocatePrismatic()
    {
        if (_prismaticFreeCount > 0)
        {
            return _prismaticFree[--_prismaticFreeCount];
        }

        if (_prismaticHighWater >= _prismatic.Length)
        {
            Array.Resize(ref _prismatic, _prismatic.Length * 2);
            Array.Resize(ref _prismaticFree, _prismaticFree.Length * 2);
        }

        return _prismaticHighWater++;
    }

    private int AllocateConeTwist()
    {
        if (_coneTwistFreeCount > 0)
        {
            return _coneTwistFree[--_coneTwistFreeCount];
        }

        if (_coneTwistHighWater >= _coneTwist.Length)
        {
            Array.Resize(ref _coneTwist, _coneTwist.Length * 2);
            Array.Resize(ref _coneTwistFree, _coneTwistFree.Length * 2);
        }

        return _coneTwistHighWater++;
    }

    private int AllocateConfigurable()
    {
        if (_configurableFreeCount > 0)
        {
            return _configurableFree[--_configurableFreeCount];
        }

        if (_configurableHighWater >= _configurable.Length)
        {
            Array.Resize(ref _configurable, _configurable.Length * 2);
            Array.Resize(ref _configurableFree, _configurableFree.Length * 2);
        }

        return _configurableHighWater++;
    }

    private int AllocateSpring()
    {
        if (_springFreeCount > 0)
        {
            return _springFree[--_springFreeCount];
        }

        if (_springHighWater >= _spring.Length)
        {
            Array.Resize(ref _spring, _spring.Length * 2);
            Array.Resize(ref _springFree, _springFree.Length * 2);
        }

        return _springHighWater++;
    }

    /// <summary>Builds a unit perpendicular to an axis.</summary>
    private static Vec3 Perpendicular(Vec3 axis)
    {
        Vec3 reference = MathF.Abs(axis.Y) < 0.99f ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(1.0f, 0.0f, 0.0f);
        return Vec3.Normalize(Vec3.Cross(axis, reference));
    }


    private int Validate(JointId id)
    {
        if (!IsValid(id))
        {
            ThrowHelper.ThrowInvalidOperation($"Joint is unallocated or has been removed.");
        }

        return (int)id.SlotIndex;
    }
}
