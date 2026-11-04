namespace Axrone.Scene.Runtime;

using Axrone.Physics2D;

/// <summary>
/// Bridges scene actors carrying the 2D joint data components into the joint
/// store of a <see cref="ScenePhysicsBridge2D"/>. Joints are reconciled after
/// bodies: the body bridge must run <c>SyncBodies</c> first so entity
/// references resolve to live <c>BodyId</c> values. Unresolved references stay
/// pending and retry on the next sync; invalid payloads fault with a counted
/// report instead of being swallowed.
/// </summary>
public sealed class SceneJointBridge2D : IDisposable
{
    internal readonly record struct SceneJointKey2D(SceneActor Actor, SceneJointKind2D Kind);

    private readonly SceneWorld _world;
    private readonly ScenePhysicsBridge2D _physics;
    private readonly Dictionary<SceneJointKey2D, SceneJointEntry2D> _state;
    private readonly HashSet<SceneJointKey2D> _seen;
    private readonly List<SceneJointKey2D> _removals;
    private readonly SceneJointBuildContext2D _context;
    private int _liveCount;
    private int _pendingCount;
    private int _faultCount;
    private int _mouseTargetFaultCount;
    private bool _disposed;

    /// <summary>Creates a joint bridge over a body bridge on the same world.</summary>
    public SceneJointBridge2D(SceneWorld world, ScenePhysicsBridge2D physics)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(physics);

        _world = world;
        _physics = physics;
        _state = new Dictionary<SceneJointKey2D, SceneJointEntry2D>();
        _seen = new HashSet<SceneJointKey2D>();
        _removals = new List<SceneJointKey2D>();
        _context = new SceneJointBuildContext2D(this);
    }

    /// <summary>Number of joints currently live in the solver store.</summary>
    public int JointCount => _liveCount;

    /// <summary>Number of joint payloads waiting on unresolved dependencies.</summary>
    public int PendingJointCount => _pendingCount;

    /// <summary>Cumulative count of joint payloads rejected by the solver layer.</summary>
    public int FaultCount => _faultCount;

    /// <summary>Cumulative count of non-finite mouse targets skipped during target pushes.</summary>
    public int MouseTargetFaultCount => _mouseTargetFaultCount;

    /// <summary>Backing body bridge whose physics world owns the joint store.</summary>
    public ScenePhysicsBridge2D Physics => _physics;

    /// <summary>Resolves the solver joint id created for an actor and joint kind.</summary>
    public bool TryGetJoint(SceneActor actor, SceneJointKind2D kind, out JointId jointId)
    {
        ThrowIfDisposed();

        jointId = JointId.Invalid;
        if (!_state.TryGetValue(new SceneJointKey2D(actor, kind), out SceneJointEntry2D entry) ||
            entry.Result != SceneJointBuildResult2D.Created)
        {
            return false;
        }

        if (!_physics.PhysicsWorld.Joints.IsValid(entry.Id))
        {
            return false;
        }

        jointId = entry.Id;
        return true;
    }

    /// <summary>Reconciles all 2D joint components with the solver joint store.</summary>
    public void SyncJoints()
    {
        ThrowIfDisposed();

        SyncType<SceneDistanceJoint2D>();
        SyncType<SceneHingeJoint2D>();
        SyncType<SceneFixedJoint2D>();
        SyncType<SceneSliderJoint2D>();
        SyncType<SceneSpringJoint2D>();
        SyncType<SceneMotorJoint2D>();
        SyncType<SceneWheelJoint2D>();
        SyncType<SceneRopeJoint2D>();
        SyncType<SceneMouseJoint2D>();
        SyncType<SceneGearJoint2D>();
        PushMouseTargets();
        RecomputeCounters();
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _state.Clear();
        _seen.Clear();
        _removals.Clear();
        _disposed = true;
    }

    internal SceneWorld SceneWorldRef => _world;

    internal JointStore Store => _physics.PhysicsWorld.Joints;

    internal BodyStore Bodies => _physics.PhysicsWorld.Bodies;

    internal Dictionary<SceneJointKey2D, SceneJointEntry2D> StateRef => _state;

    internal bool TryResolvePair(
        SceneActor actor,
        in SceneJointActorRef connected,
        out BodyId bodyA,
        out BodyId bodyB)
    {
        bodyA = BodyId.Invalid;
        bodyB = BodyId.Invalid;

        if (!_physics.TryGetBody(actor, out bodyA))
        {
            return false;
        }

        if (!connected.TryResolve(_world, out SceneActor target))
        {
            bodyA = BodyId.Invalid;
            return false;
        }

        if (!_physics.TryGetBody(target, out bodyB))
        {
            bodyA = BodyId.Invalid;
            return false;
        }

        return true;
    }

    private void SyncType<T>()
        where T : unmanaged, ISceneJoint2D<T>
    {
        SceneJointKind2D kind = T.JointKind;

        _seen.Clear();
        foreach (SceneActor actor in _world.Actors)
        {
            if (_world.IsActiveInHierarchy(actor) && _world.TryGetData(actor, out T probe))
            {
                _seen.Add(new SceneJointKey2D(actor, kind));
            }
        }

        _removals.Clear();
        foreach (KeyValuePair<SceneJointKey2D, SceneJointEntry2D> pair in _state)
        {
            if (pair.Key.Kind == kind && !_seen.Contains(pair.Key))
            {
                _removals.Add(pair.Key);
            }
        }

        for (int i = 0; i < _removals.Count; i++)
        {
            DestroyEntry(_removals[i]);
        }

        JointStore joints = Store;
        foreach (SceneJointKey2D seenKey in _seen)
        {
            SceneActor actor = seenKey.Actor;
            if (!_world.TryGetData(actor, out T value))
            {
                continue;
            }

            var key = seenKey;
            _state.TryGetValue(key, out SceneJointEntry2D entry);

            if (!value.IsJointEnabled)
            {
                if (entry.Result != SceneJointBuildResult2D.NotRequired ||
                    _state.ContainsKey(key))
                {
                    DestroyEntry(key);
                }

                continue;
            }

            ulong hash = T.ComputePayloadHash(value);
            bool isCreated = entry.Result == SceneJointBuildResult2D.Created;
            bool idAlive = isCreated && joints.IsValid(entry.Id);

            if (idAlive && entry.Hash == hash)
            {
                continue;
            }

            if (idAlive)
            {
                joints.Destroy(entry.Id);
            }

            if (!isCreated &&
                entry.Result == SceneJointBuildResult2D.NotRequired &&
                entry.Hash == hash)
            {
                continue;
            }

            _context.Actor = actor;
            SceneJointBuildResult2D result = T.Create(value, _context, out JointId jointId);
            _state[key] = new SceneJointEntry2D(jointId, hash, result);

            if (result == SceneJointBuildResult2D.Faulted &&
                entry.Result != SceneJointBuildResult2D.Faulted)
            {
                _faultCount++;
            }
        }
    }

    private void PushMouseTargets()
    {
        JointStore joints = Store;
        foreach (KeyValuePair<SceneJointKey2D, SceneJointEntry2D> pair in _state)
        {
            if (pair.Key.Kind != SceneJointKind2D.Mouse ||
                pair.Value.Result != SceneJointBuildResult2D.Created ||
                !joints.IsValid(pair.Value.Id))
            {
                continue;
            }

            if (!_world.TryGetData(pair.Key.Actor, out SceneMouseJoint2D mouse))
            {
                continue;
            }

            Vec2 target = mouse.Target;
            if (float.IsFinite(target.X) && float.IsFinite(target.Y))
            {
                joints.SetMouseTarget(pair.Value.Id, target);
            }
            else
            {
                _mouseTargetFaultCount++;
            }
        }
    }

    private void DestroyEntry(SceneJointKey2D key)
    {
        if (_state.Remove(key, out SceneJointEntry2D entry) &&
            entry.Result == SceneJointBuildResult2D.Created)
        {
            JointStore joints = Store;
            if (joints.IsValid(entry.Id))
            {
                joints.Destroy(entry.Id);
            }
        }
    }

    private void RecomputeCounters()
    {
        int live = 0;
        int pending = 0;

        foreach (KeyValuePair<SceneJointKey2D, SceneJointEntry2D> pair in _state)
        {
            switch (pair.Value.Result)
            {
                case SceneJointBuildResult2D.Created:
                    live++;
                    break;
                case SceneJointBuildResult2D.Pending:
                    pending++;
                    break;
            }
        }

        _liveCount = live;
        _pendingCount = pending;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneJointBridge2D));
        }
    }
}

internal struct SceneJointEntry2D
{
    internal SceneJointEntry2D(JointId id, ulong hash, SceneJointBuildResult2D result)
    {
        Id = id;
        Hash = hash;
        Result = result;
    }

    public JointId Id;
    public ulong Hash;
    public SceneJointBuildResult2D Result;
}

internal sealed class SceneJointBuildContext2D
{
    internal SceneJointBuildContext2D(SceneJointBridge2D bridge)
    {
        Bridge = bridge;
    }

    public readonly SceneJointBridge2D Bridge;

    public SceneActor Actor;
}

internal static class SceneJointRuntime2D
{
    private const float DegreesToRadians = MathF.PI / 180.0f;
    private const float AxisEpsilon = 1e-6f;
    private const float DefaultSuspensionFrequency = 2.0f;

    public static SceneJointBuildResult2D Distance(
        in SceneDistanceJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        float length = value.Distance;
        if (value.AutoConfigureDistance)
        {
            Transform2D first = context.Bridge.Bodies.GetTransform(bodyA);
            Transform2D second = context.Bridge.Bodies.GetTransform(bodyB);
            float dx = first.Position.X - second.Position.X;
            float dy = first.Position.Y - second.Position.Y;
            length = MathF.Sqrt((dx * dx) + (dy * dy));
        }

        if (!float.IsFinite(length) || length < 0.0f)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!IsFinite(value.AnchorA) || !IsFinite(value.AnchorB))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreateDistance(
                context.Bridge.Bodies, bodyA, bodyB, value.AnchorA, value.AnchorB, length);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Hinge(
        in SceneHingeJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (!IsFinite(value.Anchor) ||
            !float.IsFinite(value.LimitsMin) ||
            !float.IsFinite(value.LimitsMax) ||
            !float.IsFinite(value.MotorSpeed) ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque) ||
            (value.UseMotor && value.MaxMotorTorque < 0.0f))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (bodyA == bodyB)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        var definition = new RevoluteDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            WorldAnchor = context.Bridge.Bodies.GetTransform(bodyA).TransformPoint(value.Anchor),
            LowerAngle = value.LimitsMin * DegreesToRadians,
            UpperAngle = value.LimitsMax * DegreesToRadians,
            EnableLimit = value.UseLimits,
            MotorSpeed = value.MotorSpeed,
            MaxMotorTorque = value.MaxMotorTorque,
            EnableMotor = value.UseMotor
        };

        try
        {
            jointId = context.Bridge.Store.CreateRevolute(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Fixed(
        in SceneFixedJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (!IsFinite(value.Anchor) ||
            !float.IsFinite(value.DampingRatio) ||
            !float.IsFinite(value.Frequency) ||
            value.DampingRatio < 0.0f ||
            value.DampingRatio > 1.0f ||
            value.Frequency < 0.0f ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (bodyA == bodyB)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        var definition = new WeldDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            WorldAnchor = context.Bridge.Bodies.GetTransform(bodyA).TransformPoint(value.Anchor)
        };

        try
        {
            jointId = context.Bridge.Store.CreateWeld(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Slider(
        in SceneSliderJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (!IsFinite(value.Anchor) ||
            !float.IsFinite(value.LimitsMin) ||
            !float.IsFinite(value.LimitsMax) ||
            !float.IsFinite(value.MotorSpeed) ||
            (value.UseMotor && value.MaxMotorForce < 0.0f) ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (bodyA == bodyB)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!TryNormalize(value.Axis, out Vec2 axis))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        Transform2D frame = context.Bridge.Bodies.GetTransform(bodyA);
        var definition = new PrismaticDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            WorldAnchor = frame.TransformPoint(value.Anchor),
            WorldAxis = frame.Rotate(axis),
            LowerTranslation = value.LimitsMin,
            UpperTranslation = value.LimitsMax,
            EnableLimit = value.UseLimits,
            MotorSpeed = value.MotorSpeed,
            MaxMotorForce = value.MaxMotorForce,
            EnableMotor = value.UseMotor
        };

        try
        {
            jointId = context.Bridge.Store.CreatePrismatic(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Spring(
        in SceneSpringJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        float length = value.Distance;
        if (value.AutoConfigureDistance)
        {
            Transform2D first = context.Bridge.Bodies.GetTransform(bodyA);
            Transform2D second = context.Bridge.Bodies.GetTransform(bodyB);
            float dx = first.Position.X - second.Position.X;
            float dy = first.Position.Y - second.Position.Y;
            length = MathF.Sqrt((dx * dx) + (dy * dy));
        }

        if (!float.IsFinite(length) ||
            length < 0.0f ||
            !IsFinite(value.AnchorA) ||
            !IsFinite(value.AnchorB) ||
            value.Stiffness < 0.0f ||
            value.Damping < 0.0f ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        try
        {
            // Compliance (stiffness/damping) has no solver-side parameter yet;
            // the joint is created as a rigid distance constraint. Tracked as a
            // cross-package request.
            jointId = context.Bridge.Store.CreateDistance(
                context.Bridge.Bodies, bodyA, bodyB, value.AnchorA, value.AnchorB, length);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Motor(
        in SceneMotorJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (bodyA == bodyB)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!IsFinite(value.LinearOffset) ||
            !float.IsFinite(value.AngularOffset) ||
            value.MaxForce < 0.0f ||
            value.MaxTorque < 0.0f ||
            value.CorrectionFactor <= 0.0f ||
            value.CorrectionFactor > 1.0f ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        var definition = new MotorDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LinearOffset = value.LinearOffset,
            AngularOffset = value.AngularOffset,
            MaxForce = value.MaxForce,
            MaxTorque = value.MaxTorque,
            CorrectionFactor = value.CorrectionFactor
        };

        try
        {
            jointId = context.Bridge.Store.CreateMotor(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Wheel(
        in SceneWheelJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (bodyA == bodyB)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!IsFinite(value.AnchorA) ||
            !IsFinite(value.AnchorB) ||
            !float.IsFinite(value.MotorSpeed) ||
            value.MaxMotorTorque < 0.0f ||
            value.Damping < 0.0f ||
            value.Stiffness < 0.0f ||
            !float.IsFinite(value.Stiffness) ||
            !float.IsFinite(value.Damping) ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!TryNormalize(value.Axis, out Vec2 axis))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        // Translation limits have no wheel-def slot yet; enableLimit,
        // lowerTranslation and upperTranslation are tracked as a
        // cross-package request. Zero stiffness selects the store default
        // frequency because the C# wheel is always sprung.
        float frequency = value.Stiffness > 0.0f ? value.Stiffness : DefaultSuspensionFrequency;
        Transform2D frame = context.Bridge.Bodies.GetTransform(bodyA);
        var definition = new WheelDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            WorldAnchor = frame.TransformPoint(value.AnchorA),
            WorldAxis = frame.Rotate(axis),
            MotorSpeed = value.MotorSpeed,
            MaxMotorTorque = value.MaxMotorTorque,
            EnableMotor = value.EnableMotor,
            SuspensionFrequency = frequency,
            SuspensionDamping = value.Damping
        };

        try
        {
            jointId = context.Bridge.Store.CreateWheel(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Rope(
        in SceneRopeJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (!IsFinite(value.AnchorA) ||
            !IsFinite(value.AnchorB) ||
            !float.IsFinite(value.MaxLength) ||
            value.MaxLength < 0.0f ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        var definition = new RopeDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = value.AnchorA,
            LocalAnchorB = value.AnchorB,
            MaxLength = value.MaxLength
        };

        try
        {
            jointId = context.Bridge.Store.CreateRope(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Mouse(
        in SceneMouseJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;

        // The store models a mouse joint with the ground holder as body A and
        // the dragged body as body B, so the scene component — which sits on
        // the dragged actor — maps its owner to body B.
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId ownerBody, out BodyId groundBody))
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (ownerBody == groundBody)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!IsFinite(value.Target) ||
            value.MaxForce < 0.0f ||
            value.Stiffness < 0.0f ||
            value.Damping < 0.0f ||
            value.Damping >= 1.0f ||
            !float.IsFinite(value.MaxForce) ||
            !float.IsFinite(value.Stiffness) ||
            !float.IsFinite(value.Damping) ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        var definition = new MouseDef
        {
            BodyA = groundBody,
            BodyB = ownerBody,
            Target = value.Target,
            MaxForce = value.MaxForce,
            Stiffness = value.Stiffness,
            Damping = value.Damping
        };

        try
        {
            jointId = context.Bridge.Store.CreateMouse(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    public static SceneJointBuildResult2D Gear(
        in SceneGearJoint2D value, SceneJointBuildContext2D context, out JointId jointId)
    {
        jointId = JointId.Invalid;

        bool hasFirst = value.JointA.IsValid;
        bool hasSecond = value.JointB.IsValid;
        if (!hasFirst && !hasSecond)
        {
            return SceneJointBuildResult2D.NotRequired;
        }

        if (!hasFirst || !hasSecond)
        {
            return SceneJointBuildResult2D.Pending;
        }

        if (!float.IsFinite(value.Ratio) ||
            value.Ratio == 0.0f ||
            !IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque))
        {
            return SceneJointBuildResult2D.Faulted;
        }

        if (!value.JointA.TryResolveActor(context.Bridge.SceneWorldRef, out SceneActor actorA) ||
            !value.JointB.TryResolveActor(context.Bridge.SceneWorldRef, out SceneActor actorB))
        {
            return SceneJointBuildResult2D.Pending;
        }

        Dictionary<SceneJointBridge2D.SceneJointKey2D, SceneJointEntry2D> state = context.Bridge.StateRef;
        if (!state.TryGetValue(new SceneJointBridge2D.SceneJointKey2D(actorA, value.JointA.Kind), out SceneJointEntry2D entryA) ||
            !state.TryGetValue(new SceneJointBridge2D.SceneJointKey2D(actorB, value.JointB.Kind), out SceneJointEntry2D entryB) ||
            entryA.Result != SceneJointBuildResult2D.Created ||
            entryB.Result != SceneJointBuildResult2D.Created)
        {
            return SceneJointBuildResult2D.Pending;
        }

        JointStore joints = context.Bridge.Store;
        if (!joints.IsValid(entryA.Id) || !joints.IsValid(entryB.Id))
        {
            return SceneJointBuildResult2D.Pending;
        }

        var definition = new GearDef
        {
            JointA = entryA.Id,
            JointB = entryB.Id,
            Ratio = value.Ratio
        };

        try
        {
            jointId = joints.CreateGear(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult2D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult2D.Faulted;
        }

        return SceneJointBuildResult2D.Created;
    }

    private static bool IsFinite(in Vec2 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y);

    private static bool IsFiniteOrInfinity(float value) =>
        float.IsFinite(value) || float.IsPositiveInfinity(value);

    private static bool TryNormalize(in Vec2 axis, out Vec2 normalized)
    {
        if (!IsFinite(axis))
        {
            normalized = default;
            return false;
        }

        float length = MathF.Sqrt((axis.X * axis.X) + (axis.Y * axis.Y));
        if (length < AxisEpsilon)
        {
            normalized = default;
            return false;
        }

        normalized = new Vec2(axis.X / length, axis.Y / length);
        return true;
    }
}
