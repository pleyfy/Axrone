namespace Axrone.Physics2D;

/// <summary>
/// Construction parameters of a distance joint: two body anchors held at a
/// rest separation. With <see cref="Stiffness"/> the rod pulls softly toward
/// the rest length instead of rigidly; with a
/// <see cref="MinDistance"/>/<see cref="MaxDistance"/> pair a hard range row
/// joins the rod and bounds the separation from leaving it.
/// </summary>
public readonly struct DistanceDef
{
    /// <summary>Creates default parameters: a rigid rod of zero rest length.</summary>
    public DistanceDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec2 LocalAnchorA { get; init; } = default;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec2 LocalAnchorB { get; init; } = default;

    /// <summary>Rest separation of the anchors; finite and never negative.</summary>
    public float Length
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Length));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Spring stiffness per unit effective mass; zero keeps the rod rigid.</summary>
    public float Stiffness
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Stiffness));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Spring damping; never negative, and only read while the joint is soft.</summary>
    public float Damping
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Damping));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Smallest allowed separation; zero leaves the range open below.</summary>
    public float MinDistance
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MinDistance));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Largest allowed separation; zero leaves the range open above.</summary>
    public float MaxDistance
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxDistance));
            }

            field = value;
        }
    } = 0.0f;
}

/// <summary>
/// Construction parameters of a spring joint: a soft distance constraint with
/// a restoring pull toward the rest length. The spring shares the distance
/// joint's storage and solver path; it differs in requiring positive
/// stiffness so a named spring can never collapse into a rigid rod silently.
/// </summary>
public readonly struct SpringDef
{
    /// <summary>Creates default parameters: a unit-length spring matching the engine's soft-joint defaults.</summary>
    public SpringDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec2 LocalAnchorA { get; init; } = default;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec2 LocalAnchorB { get; init; } = default;

    /// <summary>Rest length of the spring; finite and never negative.</summary>
    public float Distance
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Distance));
            }

            field = value;
        }
    } = 1.0f;

    /// <summary>Spring stiffness; strictly positive, finite. Zero would silently rigidify the spring.</summary>
    public float Stiffness
    {
        get => field;
        init
        {
            if (value <= 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Stiffness));
            }

            field = value;
        }
    } = 10.0f;

    /// <summary>Spring damping; finite and never negative.</summary>
    public float Damping
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Damping));
            }

            field = value;
        }
    } = 0.5f;
}

/// <summary>
/// Construction parameters of a revolute joint: two bodies pinned through a
/// shared world anchor, with optional angular stops and a speed motor.
/// Local anchors and the reference angle derive from the world anchor at
/// creation, so the caller never converts frames by hand.
/// </summary>
public readonly struct RevoluteDef
{
    /// <summary>Creates default parameters.</summary>
    public RevoluteDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Shared world anchor.</summary>
    public Vec2 WorldAnchor { get; init; } = default;

    /// <summary>Lower angular stop in radians.</summary>
    public float LowerAngle
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(LowerAngle));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Upper angular stop in radians.</summary>
    public float UpperAngle
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(UpperAngle));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Whether angular stops apply.</summary>
    public bool EnableLimit { get; init; } = false;

    /// <summary>Target relative angular velocity.</summary>
    public float MotorSpeed
    {
        get => field;
        init
        {
            if (float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MotorSpeed));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Peak motor torque; never negative.</summary>
    public float MaxMotorTorque
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxMotorTorque));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Whether the motor drives.</summary>
    public bool EnableMotor { get; init; } = false;
}

/// <summary>
/// Construction parameters of a weld joint: two bodies locked through a
/// shared world anchor. Local anchors and the reference angle derive from
/// the world anchor at creation.
/// </summary>
public readonly struct WeldDef
{
    /// <summary>Creates default parameters.</summary>
    public WeldDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Shared world anchor.</summary>
    public Vec2 WorldAnchor { get; init; } = default;
}

/// <summary>
/// Construction parameters of a prismatic joint: two bodies sliding along a
/// shared world axis through a world anchor, with optional slide stops and
/// a slide motor. Local anchors, axis and reference translation derive from
/// the world frame at creation.
/// </summary>
public readonly struct PrismaticDef
{
    /// <summary>Creates default parameters.</summary>
    public PrismaticDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Shared world anchor.</summary>
    public Vec2 WorldAnchor { get; init; } = default;

    /// <summary>Slide axis in world coordinates; normalized at creation.</summary>
    public Vec2 WorldAxis { get; init; } = new Vec2(1, 0);

    /// <summary>Lower slide stop along the axis.</summary>
    public float LowerTranslation
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(LowerTranslation));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Upper slide stop along the axis.</summary>
    public float UpperTranslation
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(UpperTranslation));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Whether slide stops apply.</summary>
    public bool EnableLimit { get; init; } = false;

    /// <summary>Target slide speed along the axis.</summary>
    public float MotorSpeed
    {
        get => field;
        init
        {
            if (float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MotorSpeed));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Peak slide force; never negative.</summary>
    public float MaxMotorForce
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxMotorForce));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Whether the slide motor drives.</summary>
    public bool EnableMotor { get; init; } = false;
}

/// <summary>
/// Construction parameters of a motor joint: the second body is servoed
/// toward a target pose rigidly attached to the first body. Force and torque
/// caps bound the drive; the correction factor sets the response speed.
/// </summary>
public readonly struct MotorDef
{
    /// <summary>Creates default parameters.</summary>
    public MotorDef()
    {
    }

    /// <summary>First body; carries the target frame.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body; servoed toward the target.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Target offset of the second body origin in the first body frame.</summary>
    public Vec2 LinearOffset { get; init; } = default;

    /// <summary>Target relative angle in radians.</summary>
    public float AngularOffset { get; init; } = 0.0f;

    /// <summary>Peak servo force; never negative.</summary>
    public float MaxForce
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxForce));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Peak servo torque; never negative.</summary>
    public float MaxTorque
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxTorque));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Fraction of the pose error corrected per second; in (0, 1].</summary>
    public float CorrectionFactor
    {
        get => field;
        init
        {
            if (value <= 0.0f || value > 1.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(CorrectionFactor));
            }

            field = value;
        }
    } = 0.3f;
}

/// <summary>
/// Construction parameters of a wheel joint: the second body hangs off the
/// first along a suspension axis with a spring, slides freely otherwise, and
/// spins under an optional hub motor. The rest position freezes at creation.
/// </summary>
public readonly struct WheelDef
{
    /// <summary>Creates default parameters.</summary>
    public WheelDef()
    {
    }

    /// <summary>First body; carries the suspension.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body; the wheel.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Shared world anchor.</summary>
    public Vec2 WorldAnchor { get; init; } = default;

    /// <summary>Suspension axis in world coordinates; normalized at creation.</summary>
    public Vec2 WorldAxis { get; init; } = new Vec2(0, 1);

    /// <summary>Target hub speed.</summary>
    public float MotorSpeed { get; init; } = 0.0f;

    /// <summary>Peak hub torque; never negative.</summary>
    public float MaxMotorTorque { get; init; } = 0.0f;

    /// <summary>Whether the hub motor drives.</summary>
    public bool EnableMotor { get; init; } = false;

    /// <summary>Whether the travel stops clamp the suspension axis.</summary>
    public bool EnableLimit { get; init; } = false;

    /// <summary>Lower travel stop along the suspension axis, relative to the rest translation.</summary>
    public float LowerTranslation
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(LowerTranslation));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Upper travel stop along the suspension axis, relative to the rest translation.</summary>
    public float UpperTranslation
    {
        get => field;
        init
        {
            if (float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(UpperTranslation));
            }

            field = value;
        }
    } = 0.0f;

    /// <summary>Suspension frequency in hertz; strictly positive, stable below 1 / (pi * dt).</summary>
    public float SuspensionFrequency
    {
        get => field;
        init
        {
            if (value <= 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(SuspensionFrequency));
            }

            field = value;
        }
    } = 2.0f;

    /// <summary>Suspension damping ratio; never negative.</summary>
    public float SuspensionDamping
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(SuspensionDamping));
            }

            field = value;
        }
    } = 0.7f;
}

/// <summary>
/// Construction parameters of a pulley joint: two body anchors hung over two
/// fixed ground pulleys with a rope ratio. Rope lengths freeze at creation;
/// the weighted total stays fixed.
/// </summary>
public readonly struct PulleyDef
{
    /// <summary>Creates default parameters.</summary>
    public PulleyDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Fixed world pulley of the first rope.</summary>
    public Vec2 GroundAnchorA { get; init; } = default;

    /// <summary>Fixed world pulley of the second rope.</summary>
    public Vec2 GroundAnchorB { get; init; } = default;

    /// <summary>World anchor on the first body.</summary>
    public Vec2 WorldAnchorA { get; init; } = default;

    /// <summary>World anchor on the second body.</summary>
    public Vec2 WorldAnchorB { get; init; } = default;

    /// <summary>Rope length ratio; strictly positive.</summary>
    public float Ratio
    {
        get => field;
        init
        {
            if (value <= 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Ratio));
            }

            field = value;
        }
    } = 1.0f;
}

/// <summary>
/// Construction parameters of a gear joint: the coordinates of two live
/// revolute or prismatic joints (never gears) are locked in a ratio. The
/// coordinate sum freezes at creation.
/// </summary>
public readonly struct GearDef
{
    /// <summary>Creates default parameters.</summary>
    public GearDef()
    {
    }

    /// <summary>First geared joint; must be live, revolute or prismatic.</summary>
    public JointId JointA { get; init; } = JointId.Invalid;

    /// <summary>Second geared joint; must be live, revolute or prismatic.</summary>
    public JointId JointB { get; init; } = JointId.Invalid;

    /// <summary>Coordinate ratio of the second joint; finite and non-zero.</summary>
    public float Ratio
    {
        get => field;
        init
        {
            if (value == 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Ratio));
            }

            field = value;
        }
    } = 1.0f;
}

/// <summary>
/// Construction parameters of a rope joint: two body-frame anchors kept
/// within a max separation. Slack ropes exert nothing; taut ropes pull.
/// </summary>
public readonly struct RopeDef
{
    /// <summary>Creates default parameters.</summary>
    public RopeDef()
    {
    }

    /// <summary>First body.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Second body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec2 LocalAnchorA { get; init; } = default;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec2 LocalAnchorB { get; init; } = default;

    /// <summary>Longest allowed separation; finite and never negative.</summary>
    public float MaxLength
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxLength));
            }

            field = value;
        }
    } = 1.0f;
}

/// <summary>
/// Construction parameters of a mouse joint: a body-frame grab point pulled
/// toward a moving world target with capped force. The grab point freezes at
/// creation; the target moves with <see cref="JointStore.SetMouseTarget"/>.
/// </summary>
public readonly struct MouseDef
{
    /// <summary>Creates default parameters.</summary>
    public MouseDef()
    {
    }

    /// <summary>Ground holder; usually static.</summary>
    public BodyId BodyA { get; init; } = BodyId.Invalid;

    /// <summary>Dragged body.</summary>
    public BodyId BodyB { get; init; } = BodyId.Invalid;

    /// <summary>World target.</summary>
    public Vec2 Target { get; init; } = default;

    /// <summary>Peak force; finite and never negative.</summary>
    public float MaxForce
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(MaxForce));
            }

            field = value;
        }
    } = 100.0f;

    /// <summary>Convergence rate per second; finite and never negative.</summary>
    public float Stiffness
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Stiffness));
            }

            field = value;
        }
    } = 5.0f;

    /// <summary>Relative-velocity blend in [0, 1).</summary>
    public float Damping
    {
        get => field;
        init
        {
            if (value < 0.0f || value >= 1.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(Damping));
            }

            field = value;
        }
    } = 0.0f;
}
