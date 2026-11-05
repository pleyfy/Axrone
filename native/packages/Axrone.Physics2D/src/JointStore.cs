namespace Axrone.Physics2D;

using System.Buffers;
using System.Runtime.CompilerServices;
using System.Threading;

/// <summary>
/// Dense segregated store of joints: one packed table per archetype, kind-tagged
/// identities, geometrically growing buffers. Creation validates bodies and wakes
/// sleeping dynamics; destroying a joint also drops the gears locked to it, and
/// destroying a body drops every joint touching it.
/// </summary>
public sealed class JointStore : IJointRegistry
{
    private readonly Lock _lock = new();

    private readonly JointStorage<DistancePolicy, DistanceJointData> _distance = new();
    private readonly JointStorage<RevolutePolicy, RevoluteJointData> _revolute = new();
    private readonly JointStorage<WeldPolicy, WeldJointData> _weld = new();
    private readonly JointStorage<PrismaticPolicy, PrismaticJointData> _prismatic = new();
    private readonly JointStorage<MotorPolicy, MotorJointData> _motor = new();
    private readonly JointStorage<WheelPolicy, WheelJointData> _wheel = new();
    private readonly JointStorage<PulleyPolicy, PulleyJointData> _pulley = new();
    private readonly JointStorage<GearPolicy, GearJointData> _gear = new();
    private readonly JointStorage<RopePolicy, RopeJointData> _rope = new();
    private readonly JointStorage<MousePolicy, MouseJointData> _mouse = new();

    /// <inheritdoc/>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _distance.Count + _revolute.Count + _weld.Count + _prismatic.Count +
               _motor.Count + _wheel.Count + _pulley.Count + _gear.Count + _rope.Count + _mouse.Count;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsValid(JointId id)
    {
        if (!id.IsValid)
        {
            return false;
        }

        uint slot = id.SlotIndex;
        return id.Kind switch
        {
            JointKind.Distance => _distance.TryGetBySparseIndex(slot, out _),
            JointKind.Revolute => _revolute.TryGetBySparseIndex(slot, out _),
            JointKind.Weld => _weld.TryGetBySparseIndex(slot, out _),
            JointKind.Prismatic => _prismatic.TryGetBySparseIndex(slot, out _),
            JointKind.Motor => _motor.TryGetBySparseIndex(slot, out _),
            JointKind.Wheel => _wheel.TryGetBySparseIndex(slot, out _),
            JointKind.Pulley => _pulley.TryGetBySparseIndex(slot, out _),
            JointKind.Gear => _gear.TryGetBySparseIndex(slot, out _),
            JointKind.Rope => _rope.TryGetBySparseIndex(slot, out _),
            JointKind.Mouse => _mouse.TryGetBySparseIndex(slot, out _),
            _ => false,
        };
    }

    /// <summary>
    /// Creates a rigid distance joint between two anchor points and wakes
    /// both bodies. The rest length is fixed at creation.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="bodyA">First body.</param>
    /// <param name="bodyB">Second body.</param>
    /// <param name="localAnchorA">Anchor in the first body frame.</param>
    /// <param name="localAnchorB">Anchor in the second body frame.</param>
    /// <param name="length">Rest separation; finite and never negative.</param>
    public JointId CreateDistance(
        BodyStore bodies,
        BodyId bodyA,
        BodyId bodyB,
        Vec2 localAnchorA,
        Vec2 localAnchorB,
        float length)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        bodies.Slot(bodyA);
        bodies.Slot(bodyB);

        if (!(length >= 0.0f) || float.IsNaN(length) || float.IsInfinity(length))
        {
            ThrowHelper.ThrowInvalidOperation("Joint rest length must be finite and non-negative.");
        }

        DistanceDef definition = new()
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = localAnchorA,
            LocalAnchorB = localAnchorB,
            Length = length,
        };
        return CreateDistance(bodies, in definition);
    }

    /// <summary>
    /// Creates a distance joint from <paramref name="definition"/> and wakes
    /// both bodies: a rigid rod by default, a soft spring when the definition
    /// carries stiffness, and a bounded separation range when it carries
    /// bounds.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="definition">Anchors, rest length, compliance and range.</param>
    public JointId CreateDistance(BodyStore bodies, in DistanceDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        bodies.Slot(definition.BodyA);
        bodies.Slot(definition.BodyB);

        bool ranged = MathPhysics.HasRange(definition.MinDistance, definition.MaxDistance);
        if (ranged && definition.MinDistance > 0.0f && definition.MaxDistance > 0.0f &&
            definition.MinDistance > definition.MaxDistance)
        {
            ThrowHelper.ThrowInvalidOperation("The distance range needs its lower bound at or below its upper bound.");
        }

        if (ranged && definition.Length > 0.0f &&
            ((definition.MinDistance > 0.0f && definition.Length < definition.MinDistance) ||
            (definition.MaxDistance > 0.0f && definition.Length > definition.MaxDistance)))
        {
            ThrowHelper.ThrowInvalidOperation("The rest length must sit inside the separation range.");
        }

        lock (_lock)
        {
            DistanceJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = definition.LocalAnchorA,
                LocalAnchorB = definition.LocalAnchorB,
                Length = definition.Length,
                Stiffness = definition.Stiffness,
                Damping = definition.Damping,
                MinDistance = definition.MinDistance,
                MaxDistance = definition.MaxDistance,
                Impulse = 0.0f,
            };
            uint sparse = _distance.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Distance, sparse);
        }
    }

    /// <summary>
    /// Creates a spring joint from <paramref name="definition"/> and wakes both
    /// bodies: a soft distance constraint whose stiffness keeps it strictly
    /// positive, sharing the distance joint's storage and solver path.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live.</param>
    /// <param name="definition">Anchors, rest length, stiffness and damping.</param>
    /// <returns>The identity of the created joint, tagged <see cref="JointKind.Distance"/>.</returns>
    public JointId CreateSpring(BodyStore bodies, in SpringDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        DistanceDef rod = new()
        {
            BodyA = definition.BodyA,
            BodyB = definition.BodyB,
            LocalAnchorA = definition.LocalAnchorA,
            LocalAnchorB = definition.LocalAnchorB,
            Length = definition.Distance,
            Stiffness = definition.Stiffness,
            Damping = definition.Damping,
        };
        return CreateDistance(bodies, in rod);
    }

    /// <summary>
    /// Creates a pinned hinge between two bodies through a shared world
    /// anchor and wakes both bodies. Angular stops and the speed motor are
    /// configured by <paramref name="definition"/>.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Pin anchor, stops and motor tuning.</param>
    public JointId CreateRevolute(BodyStore bodies, in RevoluteDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Revolute joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.WorldAnchor.X) || float.IsNaN(definition.WorldAnchor.Y) ||
            float.IsInfinity(definition.WorldAnchor.X) || float.IsInfinity(definition.WorldAnchor.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Joint anchor must be finite.");
        }

        if (definition.EnableLimit && definition.LowerAngle > definition.UpperAngle)
        {
            ThrowHelper.ThrowInvalidOperation("Lower angular stop must not exceed the upper stop.");
        }

        ref BodyState stateA = ref bodies.Slot(definition.BodyA);
        ref BodyState stateB = ref bodies.Slot(definition.BodyB);

        Transform2D transformA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        lock (_lock)
        {
            RevoluteJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = transformA.InverseTransformPoint(definition.WorldAnchor),
                LocalAnchorB = transformB.InverseTransformPoint(definition.WorldAnchor),
                ReferenceAngle = transformB.Angle - transformA.Angle,
                LowerAngle = definition.LowerAngle,
                UpperAngle = definition.UpperAngle,
                EnableLimit = definition.EnableLimit,
                MotorSpeed = definition.MotorSpeed,
                MaxMotorTorque = definition.MaxMotorTorque,
                EnableMotor = definition.EnableMotor,
            };
            uint sparse = _revolute.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Revolute, sparse);
        }
    }

    /// <summary>
    /// Creates a weld locking two bodies through a shared world anchor and
    /// wakes both bodies. The relative angle and anchor separation freeze at
    /// creation.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Pin anchor.</param>
    public JointId CreateWeld(BodyStore bodies, in WeldDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Weld joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.WorldAnchor.X) || float.IsNaN(definition.WorldAnchor.Y) ||
            float.IsInfinity(definition.WorldAnchor.X) || float.IsInfinity(definition.WorldAnchor.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Joint anchor must be finite.");
        }

        ref BodyState stateA = ref bodies.Slot(definition.BodyA);
        ref BodyState stateB = ref bodies.Slot(definition.BodyB);

        Transform2D transformA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        lock (_lock)
        {
            WeldJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = transformA.InverseTransformPoint(definition.WorldAnchor),
                LocalAnchorB = transformB.InverseTransformPoint(definition.WorldAnchor),
                ReferenceAngle = transformB.Angle - transformA.Angle,
            };
            uint sparse = _weld.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Weld, sparse);
        }
    }

    /// <summary>
    /// Creates a slider along a world axis through a world anchor and wakes
    /// both bodies. Slide stops and the slide motor are configured by
    /// <paramref name="definition"/>.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Slide anchor, axis, stops and motor tuning.</param>
    public JointId CreatePrismatic(BodyStore bodies, in PrismaticDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Prismatic joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.WorldAnchor.X) || float.IsNaN(definition.WorldAnchor.Y) ||
            float.IsInfinity(definition.WorldAnchor.X) || float.IsInfinity(definition.WorldAnchor.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Joint anchor must be finite.");
        }

        if (definition.WorldAxis.LengthSquared() < 1e-12f ||
            float.IsNaN(definition.WorldAxis.X) || float.IsNaN(definition.WorldAxis.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Slide axis must be a finite non-zero vector.");
        }

        if (definition.EnableLimit && definition.LowerTranslation > definition.UpperTranslation)
        {
            ThrowHelper.ThrowInvalidOperation("Lower slide stop must not exceed the upper stop.");
        }

        ref BodyState stateA = ref bodies.Slot(definition.BodyA);
        ref BodyState stateB = ref bodies.Slot(definition.BodyB);

        Transform2D transformA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        Vec2 axis = Vec2.Normalize(definition.WorldAxis);

        lock (_lock)
        {
            Vec2 localAnchorA = transformA.InverseTransformPoint(definition.WorldAnchor);
            Vec2 localAnchorB = transformB.InverseTransformPoint(definition.WorldAnchor);
            Vec2 localAxisA = new(
                (transformA.Cos * axis.X) + (transformA.Sin * axis.Y),
                (-transformA.Sin * axis.X) + (transformA.Cos * axis.Y));

            PrismaticJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = localAnchorA,
                LocalAnchorB = localAnchorB,
                LocalAxisA = localAxisA,
                ReferenceAngle = transformB.Angle - transformA.Angle,
                ReferenceTranslation = Vec2.Dot(
                    transformB.TransformPoint(localAnchorB) - transformA.TransformPoint(localAnchorA), axis),
                LowerTranslation = definition.LowerTranslation,
                UpperTranslation = definition.UpperTranslation,
                EnableLimit = definition.EnableLimit,
                MotorSpeed = definition.MotorSpeed,
                MaxMotorForce = definition.MaxMotorForce,
                EnableMotor = definition.EnableMotor,
            };
            uint sparse = _prismatic.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Prismatic, sparse);
        }
    }

    /// <summary>
    /// Creates a servo driving the second body toward a target pose attached
    /// to the first body and wakes both bodies. Force and torque caps bound
    /// the drive; the correction factor sets the response speed.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Target offset, caps and response speed.</param>
    public JointId CreateMotor(BodyStore bodies, in MotorDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Motor joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.LinearOffset.X) || float.IsNaN(definition.LinearOffset.Y) ||
            float.IsInfinity(definition.LinearOffset.X) || float.IsInfinity(definition.LinearOffset.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Servo offset must be finite.");
        }

        if (float.IsNaN(definition.AngularOffset) || float.IsInfinity(definition.AngularOffset))
        {
            ThrowHelper.ThrowInvalidOperation("Servo angle must be finite.");
        }

        bodies.Slot(definition.BodyA);
        bodies.Slot(definition.BodyB);

        lock (_lock)
        {
            MotorJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                ServoOffset = definition.LinearOffset,
                ServoAngle = definition.AngularOffset,
                ServoMaxForce = definition.MaxForce,
                ServoMaxTorque = definition.MaxTorque,
                ServoFactor = definition.CorrectionFactor,
            };
            uint sparse = _motor.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Motor, sparse);
        }
    }

    /// <summary>
    /// Creates a sprung suspension along a world axis through a world anchor
    /// and wakes both bodies. The rest position freezes at creation; the hub
    /// motor optionally spins the wheel.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Suspension anchor, axis, spring and hub tuning.</param>
    public JointId CreateWheel(BodyStore bodies, in WheelDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Wheel joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.WorldAnchor.X) || float.IsNaN(definition.WorldAnchor.Y) ||
            float.IsInfinity(definition.WorldAnchor.X) || float.IsInfinity(definition.WorldAnchor.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Joint anchor must be finite.");
        }

        if (definition.WorldAxis.LengthSquared() < 1e-12f ||
            float.IsNaN(definition.WorldAxis.X) || float.IsNaN(definition.WorldAxis.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Suspension axis must be a finite non-zero vector.");
        }

        ref BodyState stateA = ref bodies.Slot(definition.BodyA);
        ref BodyState stateB = ref bodies.Slot(definition.BodyB);

        Transform2D transformA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        Vec2 axis = Vec2.Normalize(definition.WorldAxis);

        lock (_lock)
        {
            Vec2 localAnchorA = transformA.InverseTransformPoint(definition.WorldAnchor);
            Vec2 localAnchorB = transformB.InverseTransformPoint(definition.WorldAnchor);
            Vec2 localAxisA = new(
                (transformA.Cos * axis.X) + (transformA.Sin * axis.Y),
                (-transformA.Sin * axis.X) + (transformA.Cos * axis.Y));

            WheelJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = localAnchorA,
                LocalAnchorB = localAnchorB,
                LocalAxisA = localAxisA,
                ReferenceTranslation = Vec2.Dot(
                    transformB.TransformPoint(localAnchorB) - transformA.TransformPoint(localAnchorA), axis),
                MotorSpeed = definition.MotorSpeed,
                MaxMotorTorque = definition.MaxMotorTorque,
                EnableMotor = definition.EnableMotor,
                SuspensionFrequency = definition.SuspensionFrequency,
                SuspensionDamping = definition.SuspensionDamping,
            };
            uint sparse = _wheel.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Wheel, sparse);
        }
    }

    /// <summary>
    /// Creates a rope over two fixed ground pulleys between two body anchors
    /// and wakes both bodies. Rope lengths freeze at creation; the weighted
    /// total stays fixed.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Ground pulleys, body anchors and rope ratio.</param>
    public JointId CreatePulley(BodyStore bodies, in PulleyDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Pulley joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.GroundAnchorA.X) || float.IsNaN(definition.GroundAnchorA.Y) ||
            float.IsInfinity(definition.GroundAnchorA.X) || float.IsInfinity(definition.GroundAnchorA.Y) ||
            float.IsNaN(definition.GroundAnchorB.X) || float.IsNaN(definition.GroundAnchorB.Y) ||
            float.IsInfinity(definition.GroundAnchorB.X) || float.IsInfinity(definition.GroundAnchorB.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Ground anchors must be finite.");
        }

        if (float.IsNaN(definition.WorldAnchorA.X) || float.IsNaN(definition.WorldAnchorA.Y) ||
            float.IsInfinity(definition.WorldAnchorA.X) || float.IsInfinity(definition.WorldAnchorA.Y) ||
            float.IsNaN(definition.WorldAnchorB.X) || float.IsNaN(definition.WorldAnchorB.Y) ||
            float.IsInfinity(definition.WorldAnchorB.X) || float.IsInfinity(definition.WorldAnchorB.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Body anchors must be finite.");
        }

        ref BodyState stateA = ref bodies.Slot(definition.BodyA);
        ref BodyState stateB = ref bodies.Slot(definition.BodyB);

        Transform2D transformA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        float lengthA = (definition.WorldAnchorA - definition.GroundAnchorA).Length();
        float lengthB = (definition.WorldAnchorB - definition.GroundAnchorB).Length();
        if (lengthA <= SolverTuning.LinearSlop || lengthB <= SolverTuning.LinearSlop)
        {
            ThrowHelper.ThrowInvalidOperation("Body anchors must start clear of their ground pulleys.");
        }

        lock (_lock)
        {
            PulleyJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = transformA.InverseTransformPoint(definition.WorldAnchorA),
                LocalAnchorB = transformB.InverseTransformPoint(definition.WorldAnchorB),
                PulleyGroundA = definition.GroundAnchorA,
                PulleyGroundB = definition.GroundAnchorB,
                PulleyRatio = definition.Ratio,
                PulleyConstant = lengthA + (definition.Ratio * lengthB),
            };
            uint sparse = _pulley.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Pulley, sparse);
        }
    }

    /// <summary>
    /// Locks the coordinates of two live revolute or prismatic joints in a
    /// ratio and wakes every connected body. Gears of gears are rejected; the
    /// coordinate sum freezes at creation.
    /// </summary>
    /// <param name="bodies">Body registry for coordinate capture and waking.</param>
    /// <param name="definition">Geared joints and ratio.</param>
    public JointId CreateGear(BodyStore bodies, in GearDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.JointA.IsValid || !definition.JointB.IsValid || definition.JointA == definition.JointB)
        {
            ThrowHelper.ThrowInvalidOperation("Gear joints need two distinct live joints.");
        }

        if (definition.JointA.Kind == JointKind.Gear || definition.JointB.Kind == JointKind.Gear)
        {
            ThrowHelper.ThrowInvalidOperation("Gear joints cannot reference other gears.");
        }

        if (!IsGearedKind(definition.JointA.Kind) || !IsGearedKind(definition.JointB.Kind))
        {
            ThrowHelper.ThrowInvalidOperation("Gear joints need revolute or prismatic joints.");
        }

        if (!IsValid(definition.JointA) || !IsValid(definition.JointB))
        {
            ThrowHelper.ThrowInvalidOperation("Gear joints need live joints.");
        }

        float coordinateA = GetCoordinate(bodies, definition.JointA);
        float coordinateB = GetCoordinate(bodies, definition.JointB);

        lock (_lock)
        {
            GetGearedBodies(definition.JointA, out BodyId bridgeA, out _);
            GetGearedBodies(definition.JointB, out BodyId bridgeB, out _);

            GearJointData data = new()
            {
                BodyA = bridgeA,
                BodyB = bridgeB,
                GearJointA = definition.JointA,
                GearJointB = definition.JointB,
                GearRatio = definition.Ratio,
                GearConstant = coordinateA + (definition.Ratio * coordinateB),
            };
            uint sparse = _gear.Allocate(in data);
            WakeGearedBodies(bodies, definition.JointA);
            WakeGearedBodies(bodies, definition.JointB);
            return new JointId(JointKind.Gear, sparse);
        }
    }

    /// <summary>
    /// Creates a max-distance tether between two body-frame anchors and wakes
    /// both bodies. Slack ropes exert nothing; taut ropes pull the anchors
    /// back inside the rest length.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Body anchors and max separation.</param>
    public JointId CreateRope(BodyStore bodies, in RopeDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Rope joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.LocalAnchorA.X) || float.IsNaN(definition.LocalAnchorA.Y) ||
            float.IsInfinity(definition.LocalAnchorA.X) || float.IsInfinity(definition.LocalAnchorA.Y) ||
            float.IsNaN(definition.LocalAnchorB.X) || float.IsNaN(definition.LocalAnchorB.Y) ||
            float.IsInfinity(definition.LocalAnchorB.X) || float.IsInfinity(definition.LocalAnchorB.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Rope anchors must be finite.");
        }

        bodies.Slot(definition.BodyA);
        bodies.Slot(definition.BodyB);

        lock (_lock)
        {
            RopeJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorA = definition.LocalAnchorA,
                LocalAnchorB = definition.LocalAnchorB,
                MaxLength = definition.MaxLength,
                Impulse = 0.0f,
            };
            uint sparse = _rope.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Rope, sparse);
        }
    }

    /// <summary>
    /// Creates a mouse servo dragging a body-frame grab point toward a world
    /// target and wakes both bodies. The grab point freezes at creation; the
    /// target moves with <see cref="SetMouseTarget"/>.
    /// </summary>
    /// <param name="bodies">Body registry; both bodies must be live and distinct.</param>
    /// <param name="definition">Grab target, force cap and servo response.</param>
    public JointId CreateMouse(BodyStore bodies, in MouseDef definition)
    {
        ArgumentNullException.ThrowIfNull(bodies);

        if (!definition.BodyA.IsValid || !definition.BodyB.IsValid || definition.BodyA == definition.BodyB)
        {
            ThrowHelper.ThrowInvalidOperation("Mouse joints need two distinct live bodies.");
        }

        if (float.IsNaN(definition.Target.X) || float.IsNaN(definition.Target.Y) ||
            float.IsInfinity(definition.Target.X) || float.IsInfinity(definition.Target.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Mouse target must be finite.");
        }

        bodies.Slot(definition.BodyA);
        bodies.Slot(definition.BodyB);

        ref BodyState stateB = ref bodies.Slot(definition.BodyB);
        Transform2D transformB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);

        lock (_lock)
        {
            MouseJointData data = new()
            {
                BodyA = definition.BodyA,
                BodyB = definition.BodyB,
                LocalAnchorB = transformB.InverseTransformPoint(definition.Target),
                Target = definition.Target,
                MaxForce = definition.MaxForce,
                Stiffness = definition.Stiffness,
                Damping = definition.Damping,
                Impulse = Vec2.Zero,
                MaxImpulse = 0.0f,
            };
            uint sparse = _mouse.Allocate(in data);
            bodies.SetAwake(definition.BodyA, true);
            bodies.SetAwake(definition.BodyB, true);
            return new JointId(JointKind.Mouse, sparse);
        }
    }

    /// <summary>Moves a live mouse joint's world target.</summary>
    /// <param name="id">A live mouse joint.</param>
    /// <param name="target">The new finite world target.</param>
    public void SetMouseTarget(JointId id, Vec2 target)
    {
        if (id.Kind != JointKind.Mouse || !id.IsValid)
        {
            ThrowHelper.ThrowInvalidOperation("SetMouseTarget needs a live mouse joint.");
        }

        if (float.IsNaN(target.X) || float.IsNaN(target.Y) ||
            float.IsInfinity(target.X) || float.IsInfinity(target.Y))
        {
            ThrowHelper.ThrowInvalidOperation("Mouse target must be finite.");
        }

        lock (_lock)
        {
            ref MouseJointData data = ref _mouse.GetBySparseIndex(id.SlotIndex);
            data.Target = target;
        }
    }

    /// <inheritdoc/>
    public void Destroy(JointId id)
    {
        if (!id.IsValid)
        {
            return;
        }

        lock (_lock)
        {
            switch (id.Kind)
            {
                case JointKind.Distance:
                    _distance.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Revolute:
                    _revolute.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Weld:
                    _weld.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Prismatic:
                    _prismatic.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Motor:
                    _motor.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Wheel:
                    _wheel.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Pulley:
                    _pulley.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Gear:
                    _gear.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Rope:
                    _rope.DestroySlot(id.SlotIndex);
                    break;
                case JointKind.Mouse:
                    _mouse.DestroySlot(id.SlotIndex);
                    break;
                default:
                    return;
            }

            CascadeGearDestruction(id);
        }
    }

    /// <summary>Drops every gear locked to a destroyed joint.</summary>
    /// <param name="droppedId">The destroyed joint.</param>
    private void CascadeGearDestruction(JointId droppedId)
    {
        ReadOnlySpan<GearJointData> gears = _gear.DataSpan;
        for (int i = gears.Length - 1; i >= 0; i--)
        {
            ref readonly GearJointData gear = ref gears[i];
            if (gear.GearJointA == droppedId || gear.GearJointB == droppedId)
            {
                _gear.DestroySlot(_gear.SparseOfDense(i));
            }
        }
    }

    /// <summary>Drops every joint naming a destroyed body, gears included through their geared joints.</summary>
    /// <param name="body">The destroyed body.</param>
    internal void DestroyJointsOfBody(BodyId body)
    {
        int budget = Count;
        if (budget <= 0)
        {
            return;
        }

        JointId[] rented = ArrayPool<JointId>.Shared.Rent(budget);
        try
        {
            int found = CollectTouching(body, rented.AsSpan(0, budget));
            for (int i = 0; i < found; i++)
            {
                Destroy(rented[i]);
            }
        }
        finally
        {
            ArrayPool<JointId>.Shared.Return(rented);
        }
    }

    /// <summary>Copies every live joint as a body pair for island wiring.</summary>
    /// <param name="destination">The destination span.</param>
    /// <returns>The number of pairs written.</returns>
    internal int CopyJointPairs(Span<JointPair> destination)
    {
        int count = 0;
        count += CopyPairsFrom(_distance, destination[count..]);
        count += CopyPairsFrom(_revolute, destination[count..]);
        count += CopyPairsFrom(_weld, destination[count..]);
        count += CopyPairsFrom(_prismatic, destination[count..]);
        count += CopyPairsFrom(_motor, destination[count..]);
        count += CopyPairsFrom(_wheel, destination[count..]);
        count += CopyPairsFrom(_pulley, destination[count..]);
        count += CopyPairsFrom(_gear, destination[count..]);
        count += CopyPairsFrom(_rope, destination[count..]);
        count += CopyPairsFrom(_mouse, destination[count..]);
        return count;
    }

    private static int CopyPairsFrom<TPolicy, TData>(
        JointStorage<TPolicy, TData> storage, Span<JointPair> destination)
        where TPolicy : struct, IJointPolicy<TPolicy, TData>
        where TData : struct
    {
        ReadOnlySpan<TData> span = storage.DataSpan;
        int count = 0;
        for (int i = 0; i < span.Length && count < destination.Length; i++)
        {
            TPolicy.GetBodies(ref Unsafe.AsRef(in span[i]), out BodyId bodyA, out BodyId bodyB);
            destination[count++] = new JointPair(bodyA, bodyB);
        }

        return count;
    }

    /// <summary>Collects the identities touching a body, gears resolved through their geared joints.</summary>
    /// <param name="body">The body to match.</param>
    /// <param name="destination">The destination span.</param>
    /// <returns>The number of identities written.</returns>
    internal int CollectTouching(BodyId body, Span<JointId> destination)
    {
        int count = 0;
        count += CollectFrom(_distance, JointKind.Distance, body, destination[count..]);
        count += CollectFrom(_revolute, JointKind.Revolute, body, destination[count..]);
        count += CollectFrom(_weld, JointKind.Weld, body, destination[count..]);
        count += CollectFrom(_prismatic, JointKind.Prismatic, body, destination[count..]);
        count += CollectFrom(_motor, JointKind.Motor, body, destination[count..]);
        count += CollectFrom(_wheel, JointKind.Wheel, body, destination[count..]);
        count += CollectFrom(_pulley, JointKind.Pulley, body, destination[count..]);
        count += CollectFrom(_rope, JointKind.Rope, body, destination[count..]);
        count += CollectFrom(_mouse, JointKind.Mouse, body, destination[count..]);

        ReadOnlySpan<GearJointData> gears = _gear.DataSpan;
        for (int i = 0; i < gears.Length && count < destination.Length; i++)
        {
            ref readonly GearJointData gear = ref gears[i];
            if (GearTouchesBody(in gear, body))
            {
                destination[count++] = new JointId(JointKind.Gear, _gear.SparseOfDense(i));
            }
        }

        return count;
    }

    private static int CollectFrom<TPolicy, TData>(
        JointStorage<TPolicy, TData> storage, JointKind kind, BodyId body, Span<JointId> destination)
        where TPolicy : struct, IJointPolicy<TPolicy, TData>
        where TData : struct
    {
        ReadOnlySpan<TData> span = storage.DataSpan;
        int count = 0;
        for (int i = 0; i < span.Length && count < destination.Length; i++)
        {
            TPolicy.GetBodies(ref Unsafe.AsRef(in span[i]), out BodyId bodyA, out BodyId bodyB);
            if (bodyA == body || bodyB == body)
            {
                destination[count++] = new JointId(kind, storage.SparseOfDense(i));
            }
        }

        return count;
    }

    /// <summary>Whether a gear names a body directly or through either geared joint.</summary>
    private bool GearTouchesBody(in GearJointData gear, BodyId body)
    {
        if (gear.BodyA == body || gear.BodyB == body)
        {
            return true;
        }

        if (GearedBodies(gear.GearJointA, out BodyId aA, out BodyId aB) &&
            (aA == body || aB == body))
        {
            return true;
        }

        return GearedBodies(gear.GearJointB, out BodyId bA, out BodyId bB) &&
            (bA == body || bB == body);
    }

    /// <summary>Reads the four bodies coupled by a gear reference; false while either side is dead.</summary>
    private bool GearedBodies(JointId id, out BodyId bodyA, out BodyId bodyB)
    {
        bodyA = BodyId.Invalid;
        bodyB = BodyId.Invalid;

        if (id.Kind == JointKind.Revolute)
        {
            if (!_revolute.TryGetBySparseIndex(id.SlotIndex, out uint dense))
            {
                return false;
            }

            RevoluteJointData data = _revolute.DataSpan[(int)dense];
            bodyA = data.BodyA;
            bodyB = data.BodyB;
            return true;
        }

        if (id.Kind == JointKind.Prismatic)
        {
            if (!_prismatic.TryGetBySparseIndex(id.SlotIndex, out uint dense))
            {
                return false;
            }

            PrismaticJointData data = _prismatic.DataSpan[(int)dense];
            bodyA = data.BodyA;
            bodyB = data.BodyB;
            return true;
        }

        return false;
    }

    /// <summary>Reads the two bodies of a geared joint reference.</summary>
    private void GetGearedBodies(JointId id, out BodyId bodyA, out BodyId bodyB)
    {
        bodyA = BodyId.Invalid;
        bodyB = BodyId.Invalid;

        if (id.Kind == JointKind.Revolute)
        {
            ref readonly RevoluteJointData data = ref _revolute.GetBySparseIndex(id.SlotIndex);
            bodyA = data.BodyA;
            bodyB = data.BodyB;
        }
        else if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            bodyA = data.BodyA;
            bodyB = data.BodyB;
        }
    }

    /// <summary>Whether a joint kind carries a scalar coordinate gearable by ratio.</summary>
    /// <param name="kind">The kind to test.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static bool IsGearedKind(JointKind kind) =>
        kind == JointKind.Revolute || kind == JointKind.Prismatic;

    /// <summary>Reads the scalar coordinate of a geared joint: angle or translation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal float GetCoordinate(BodyStore bodies, JointId id)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            ref readonly BodyState stateA = ref bodies.Slot(data.BodyA);
            ref readonly BodyState stateB = ref bodies.Slot(data.BodyB);

            Vec2 axis = MathPhysics.Rotate(stateA, data.LocalAxisA);
            if (axis.LengthSquared() > 1e-12f)
            {
                axis *= 1.0f / MathF.Sqrt(axis.LengthSquared());
            }

            Vec2 pA = stateA.Position + MathPhysics.Rotate(stateA, data.LocalAnchorA);
            Vec2 pB = stateB.Position + MathPhysics.Rotate(stateB, data.LocalAnchorB);
            return Vec2.Dot(pB - pA, axis) - data.ReferenceTranslation;
        }

        ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
        ref readonly BodyState a = ref bodies.Slot(revolute.BodyA);
        ref readonly BodyState b = ref bodies.Slot(revolute.BodyB);

        float angleA = MathF.Atan2(a.Sin, a.Cos);
        float angleB = MathF.Atan2(b.Sin, b.Cos);
        return MathPhysics.NormalizeAngle((angleB - angleA) - revolute.ReferenceAngle);
    }

    /// <summary>Reads the coordinate rate of a geared joint: relative spin or slide speed.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal float GetCoordinateRate(BodyStore bodies, JointId id)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            ref readonly BodyState stateA = ref bodies.Slot(data.BodyA);
            ref readonly BodyState stateB = ref bodies.Slot(data.BodyB);

            Vec2 axis = MathPhysics.Rotate(stateA, data.LocalAxisA);
            if (axis.LengthSquared() > 1e-12f)
            {
                axis *= 1.0f / MathF.Sqrt(axis.LengthSquared());
            }

            Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
            Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);
            Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
            Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
            return Vec2.Dot(vB - vA, axis);
        }

        ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
        return bodies.Slot(revolute.BodyB).AngularVelocity - bodies.Slot(revolute.BodyA).AngularVelocity;
    }

    /// <summary>Reads the effective mass of a geared coordinate with sleep-gated inverses.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal float GetEffectiveCoordinateMass(BodyStore bodies, JointId id)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            ref readonly BodyState stateA = ref bodies.Slot(data.BodyA);
            ref readonly BodyState stateB = ref bodies.Slot(data.BodyB);

            bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
            bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
            float invMassA = awakeA ? stateA.InverseMass : 0.0f;
            float invMassB = awakeB ? stateB.InverseMass : 0.0f;
            float invIA = awakeA ? stateA.InverseInertia : 0.0f;
            float invIB = awakeB ? stateB.InverseInertia : 0.0f;

            Vec2 axis = MathPhysics.Rotate(stateA, data.LocalAxisA);
            if (axis.LengthSquared() > 1e-12f)
            {
                axis *= 1.0f / MathF.Sqrt(axis.LengthSquared());
            }

            Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
            Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);
            float rnA = Vec2.Cross(rA, axis);
            float rnB = Vec2.Cross(rB, axis);
            return invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB);
        }

        ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
        ref readonly BodyState a = ref bodies.Slot(revolute.BodyA);
        ref readonly BodyState b = ref bodies.Slot(revolute.BodyB);
        float iA = (a.Flags & BodyFlags.Awake) != 0 ? a.InverseInertia : 0.0f;
        float iB = (b.Flags & BodyFlags.Awake) != 0 ? b.InverseInertia : 0.0f;
        return iA + iB;
    }

    /// <summary>Applies a generalized velocity impulse to a geared coordinate.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal void ApplyGearedVelocity(BodyStore bodies, JointId id, float impulse)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            ref BodyState stateA = ref bodies.Slot(data.BodyA);
            ref BodyState stateB = ref bodies.Slot(data.BodyB);

            bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
            bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
            float invMassA = awakeA ? stateA.InverseMass : 0.0f;
            float invMassB = awakeB ? stateB.InverseMass : 0.0f;
            float invIA = awakeA ? stateA.InverseInertia : 0.0f;
            float invIB = awakeB ? stateB.InverseInertia : 0.0f;

            Vec2 axis = MathPhysics.Rotate(stateA, data.LocalAxisA);
            if (axis.LengthSquared() > 1e-12f)
            {
                axis *= 1.0f / MathF.Sqrt(axis.LengthSquared());
            }

            Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
            Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);
            Vec2 applied = axis * impulse;

            if (awakeA)
            {
                stateA.LinearVelocity -= applied * invMassA;
                stateA.AngularVelocity -= invIA * Vec2.Cross(rA, applied);
            }

            if (awakeB)
            {
                stateB.LinearVelocity += applied * invMassB;
                stateB.AngularVelocity += invIB * Vec2.Cross(rB, applied);
            }

            return;
        }

        ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
        ref BodyState revoluteA = ref bodies.Slot(revolute.BodyA);
        ref BodyState revoluteB = ref bodies.Slot(revolute.BodyB);
        bool revoluteAwakeA = (revoluteA.Flags & BodyFlags.Awake) != 0;
        bool revoluteAwakeB = (revoluteB.Flags & BodyFlags.Awake) != 0;
        float revoluteInvIA = revoluteAwakeA ? revoluteA.InverseInertia : 0.0f;
        float revoluteInvIB = revoluteAwakeB ? revoluteB.InverseInertia : 0.0f;

        if (revoluteAwakeA)
        {
            revoluteA.AngularVelocity -= revoluteInvIA * impulse;
        }

        if (revoluteAwakeB)
        {
            revoluteB.AngularVelocity += revoluteInvIB * impulse;
        }
    }

    /// <summary>Applies a generalized position correction to a geared coordinate.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal void ApplyGearedPosition(BodyStore bodies, JointId id, float correction)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData data = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            ref BodyState stateA = ref bodies.Slot(data.BodyA);
            ref BodyState stateB = ref bodies.Slot(data.BodyB);

            bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
            bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
            if (!awakeA && !awakeB)
            {
                return;
            }

            float invMassA = awakeA ? stateA.InverseMass : 0.0f;
            float invMassB = awakeB ? stateB.InverseMass : 0.0f;
            float invIA = awakeA ? stateA.InverseInertia : 0.0f;
            float invIB = awakeB ? stateB.InverseInertia : 0.0f;

            Vec2 axis = MathPhysics.Rotate(stateA, data.LocalAxisA);
            if (axis.LengthSquared() > 1e-12f)
            {
                axis *= 1.0f / MathF.Sqrt(axis.LengthSquared());
            }

            Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
            Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);
            MathPhysics.ApplyPositionCorrection(ref stateA, ref stateB, rA, rB, axis * correction,
                invMassA, invMassB, invIA, invIB, awakeA, awakeB);
            return;
        }

        ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
        ref BodyState revoluteA = ref bodies.Slot(revolute.BodyA);
        ref BodyState revoluteB = ref bodies.Slot(revolute.BodyB);

        bool revoluteAwakeA = (revoluteA.Flags & BodyFlags.Awake) != 0;
        bool revoluteAwakeB = (revoluteB.Flags & BodyFlags.Awake) != 0;
        if (!revoluteAwakeA && !revoluteAwakeB)
        {
            return;
        }

        float revoluteInvIA = revoluteAwakeA ? revoluteA.InverseInertia : 0.0f;
        float revoluteInvIB = revoluteAwakeB ? revoluteB.InverseInertia : 0.0f;
        float axialMass = revoluteInvIA + revoluteInvIB;
        if (axialMass <= 0.0f)
        {
            return;
        }

        if (revoluteAwakeA)
        {
            float angleA = MathF.Atan2(revoluteA.Sin, revoluteA.Cos) - (revoluteInvIA * correction);
            revoluteA.Cos = MathF.Cos(angleA);
            revoluteA.Sin = MathF.Sin(angleA);
        }

        if (revoluteAwakeB)
        {
            float angleB = MathF.Atan2(revoluteB.Sin, revoluteB.Cos) + (revoluteInvIB * correction);
            revoluteB.Cos = MathF.Cos(angleB);
            revoluteB.Sin = MathF.Sin(angleB);
        }
    }

    /// <summary>Wakes every body coupled by a geared joint reference.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal void WakeGearedBodies(BodyStore bodies, JointId id)
    {
        if (id.Kind == JointKind.Prismatic)
        {
            ref readonly PrismaticJointData prismatic = ref _prismatic.GetBySparseIndex(id.SlotIndex);
            bodies.SetAwake(prismatic.BodyA, true);
            bodies.SetAwake(prismatic.BodyB, true);
        }
        else if (id.Kind == JointKind.Revolute)
        {
            ref readonly RevoluteJointData revolute = ref _revolute.GetBySparseIndex(id.SlotIndex);
            bodies.SetAwake(revolute.BodyA, true);
            bodies.SetAwake(revolute.BodyB, true);
        }
    }

    /// <summary>Runs the policy init over every packed table.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal void InitVelocityPass(BodyStore bodies, float wakeTolerance, float dt)
    {
        _distance.InitVelocity(bodies, this, wakeTolerance, dt);
        _revolute.InitVelocity(bodies, this, wakeTolerance, dt);
        _weld.InitVelocity(bodies, this, wakeTolerance, dt);
        _prismatic.InitVelocity(bodies, this, wakeTolerance, dt);
        _motor.InitVelocity(bodies, this, wakeTolerance, dt);
        _wheel.InitVelocity(bodies, this, wakeTolerance, dt);
        _pulley.InitVelocity(bodies, this, wakeTolerance, dt);
        _gear.InitVelocity(bodies, this, wakeTolerance, dt);
        _rope.InitVelocity(bodies, this, wakeTolerance, dt);
        _mouse.InitVelocity(bodies, this, wakeTolerance, dt);
    }

    /// <summary>Runs one velocity sweep over every packed table.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal void SolveVelocitySweep(BodyStore bodies)
    {
        _distance.SolveVelocity(bodies, this);
        _revolute.SolveVelocity(bodies, this);
        _weld.SolveVelocity(bodies, this);
        _prismatic.SolveVelocity(bodies, this);
        _motor.SolveVelocity(bodies, this);
        _wheel.SolveVelocity(bodies, this);
        _pulley.SolveVelocity(bodies, this);
        _gear.SolveVelocity(bodies, this);
        _rope.SolveVelocity(bodies, this);
        _mouse.SolveVelocity(bodies, this);
    }

    /// <summary>Runs one position sweep over every packed table.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal void SolvePositionSweep(BodyStore bodies)
    {
        _distance.SolvePosition(bodies, this);
        _revolute.SolvePosition(bodies, this);
        _weld.SolvePosition(bodies, this);
        _prismatic.SolvePosition(bodies, this);
        _wheel.SolvePosition(bodies, this);
        _pulley.SolvePosition(bodies, this);
        _gear.SolvePosition(bodies, this);
        _rope.SolvePosition(bodies, this);
        _mouse.SolvePosition(bodies, this);
    }

    /// <summary>Visits every live joint across all packed tables.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Accept<TVisitor, TContext>(ref TVisitor visitor, ref TContext context)
        where TVisitor : struct, IJointVisitor<TContext>
        where TContext : allows ref struct
    {
        AcceptFrom(_distance, JointKind.Distance, ref visitor, ref context);
        AcceptFrom(_revolute, JointKind.Revolute, ref visitor, ref context);
        AcceptFrom(_weld, JointKind.Weld, ref visitor, ref context);
        AcceptFrom(_prismatic, JointKind.Prismatic, ref visitor, ref context);
        AcceptFrom(_motor, JointKind.Motor, ref visitor, ref context);
        AcceptFrom(_wheel, JointKind.Wheel, ref visitor, ref context);
        AcceptFrom(_pulley, JointKind.Pulley, ref visitor, ref context);
        AcceptFrom(_gear, JointKind.Gear, ref visitor, ref context);
        AcceptFrom(_rope, JointKind.Rope, ref visitor, ref context);
        AcceptFrom(_mouse, JointKind.Mouse, ref visitor, ref context);
    }

    private static void AcceptFrom<TPolicy, TData, TVisitor, TContext>(
        JointStorage<TPolicy, TData> storage, JointKind kind, ref TVisitor visitor, ref TContext context)
        where TPolicy : struct, IJointPolicy<TPolicy, TData>
        where TData : struct
        where TVisitor : struct, IJointVisitor<TContext>
        where TContext : allows ref struct
    {
        ReadOnlySpan<TData> span = storage.DataSpan;
        for (int i = 0; i < span.Length; i++)
        {
            visitor.Visit<TPolicy, TData>(
                new JointId(kind, storage.SparseOfDense(i)), ref Unsafe.AsRef(in span[i]), ref context);
        }
    }
}
