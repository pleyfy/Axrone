namespace Axrone.Scene.Runtime;

using Axrone.Physics3D;

/// <summary>
/// Bridges scene actors carrying the 3D joint data components into the joint
/// store of a <see cref="ScenePhysicsBridge3D"/>. The body bridge must run
/// <c>SyncBodies</c> first so entity references resolve to live <c>BodyId</c>
/// values. Unresolved references stay pending and retry on the next sync;
/// invalid payloads fault with a counted report instead of being swallowed.
/// </summary>
public sealed class SceneJointBridge3D : IDisposable
{
    internal readonly record struct SceneJointKey3D(SceneActor Actor, SceneJointKind3D Kind);

    private readonly SceneWorld _world;
    private readonly ScenePhysicsBridge3D _physics;
    private readonly Dictionary<SceneJointKey3D, SceneJointEntry3D> _state;
    private readonly HashSet<SceneJointKey3D> _seen;
    private readonly List<SceneJointKey3D> _removals;
    private readonly SceneJointBuildContext3D _context;
    private int _liveCount;
    private int _pendingCount;
    private int _faultCount;
    private bool _disposed;

    /// <summary>Creates a joint bridge over a body bridge on the same world.</summary>
    public SceneJointBridge3D(SceneWorld world, ScenePhysicsBridge3D physics)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(physics);

        _world = world;
        _physics = physics;
        _state = new Dictionary<SceneJointKey3D, SceneJointEntry3D>();
        _seen = new HashSet<SceneJointKey3D>();
        _removals = new List<SceneJointKey3D>();
        _context = new SceneJointBuildContext3D(this);
    }

    /// <summary>Number of joints currently live in the solver store.</summary>
    public int JointCount => _liveCount;

    /// <summary>Number of joint payloads waiting on unresolved dependencies.</summary>
    public int PendingJointCount => _pendingCount;

    /// <summary>Cumulative count of joint payloads rejected by the solver layer.</summary>
    public int FaultCount => _faultCount;

    /// <summary>Backing body bridge whose physics world owns the joint store.</summary>
    public ScenePhysicsBridge3D Physics => _physics;

    /// <summary>Resolves the solver joint id created for an actor and joint kind.</summary>
    public bool TryGetJoint(SceneActor actor, SceneJointKind3D kind, out JointId jointId)
    {
        ThrowIfDisposed();

        jointId = JointId.Invalid;
        if (!_state.TryGetValue(new SceneJointKey3D(actor, kind), out SceneJointEntry3D entry) ||
            entry.Result != SceneJointBuildResult3D.Created)
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

    /// <summary>Reconciles all 3D joint components with the solver joint store.</summary>
    public void SyncJoints()
    {
        ThrowIfDisposed();

        SyncType<SceneFixedJoint3D>();
        SyncType<SceneHingeJoint3D>();
        SyncType<SceneSliderJoint3D>();
        SyncType<SceneSpringJoint3D>();
        SyncType<SceneCharacterJoint3D>();
        SyncType<SceneConfigurableJoint3D>();
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

        if (!connected.TryResolve(_world, out SceneActor target) ||
            !_physics.TryGetBody(target, out bodyB))
        {
            bodyA = BodyId.Invalid;
            return false;
        }

        return true;
    }

    private bool HasLiveBodies(SceneActor actor, in SceneJointActorRef connected)
    {
        if (!_physics.TryGetBody(actor, out _))
        {
            return false;
        }

        return connected.TryResolve(_world, out SceneActor target) &&
            _physics.TryGetBody(target, out _);
    }

    private void SyncType<T>()
        where T : unmanaged, ISceneJoint3D<T>
    {
        SceneJointKind3D kind = T.JointKind;

        _seen.Clear();
        foreach (SceneActor actor in _world.Actors)
        {
            if (_world.IsActiveInHierarchy(actor) && _world.TryGetData(actor, out T probe))
            {
                _seen.Add(new SceneJointKey3D(actor, kind));
            }
        }

        _removals.Clear();
        foreach (KeyValuePair<SceneJointKey3D, SceneJointEntry3D> pair in _state)
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
        foreach (SceneJointKey3D seenKey in _seen)
        {
            SceneActor actor = seenKey.Actor;
            if (!_world.TryGetData(actor, out T value))
            {
                continue;
            }

            var key = seenKey;
            _state.TryGetValue(key, out SceneJointEntry3D entry);

            if (!value.IsJointEnabled)
            {
                DestroyEntry(key);
                continue;
            }

            ulong hash = T.ComputePayloadHash(value);
            bool isCreated = entry.Result == SceneJointBuildResult3D.Created;
            bool idAlive = isCreated && joints.IsValid(entry.Id);

            if (idAlive &&
                entry.Hash == hash &&
                HasLiveBodies(actor, value.TargetBodyRef))
            {
                continue;
            }

            if (idAlive)
            {
                joints.Destroy(entry.Id);
            }

            if (!isCreated &&
                entry.Result == SceneJointBuildResult3D.NotRequired &&
                entry.Hash == hash)
            {
                continue;
            }

            _context.Actor = actor;
            SceneJointBuildResult3D result = T.Create(value, _context, out JointId jointId);
            _state[key] = new SceneJointEntry3D(jointId, hash, result);

            if (result == SceneJointBuildResult3D.Faulted &&
                entry.Result != SceneJointBuildResult3D.Faulted)
            {
                _faultCount++;
            }
        }
    }

    private void DestroyEntry(SceneJointKey3D key)
    {
        if (_state.Remove(key, out SceneJointEntry3D entry) &&
            entry.Result == SceneJointBuildResult3D.Created)
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

        foreach (KeyValuePair<SceneJointKey3D, SceneJointEntry3D> pair in _state)
        {
            switch (pair.Value.Result)
            {
                case SceneJointBuildResult3D.Created:
                    live++;
                    break;
                case SceneJointBuildResult3D.Pending:
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
            throw new SceneDisposedException(nameof(SceneJointBridge3D));
        }
    }
}

internal struct SceneJointEntry3D
{
    internal SceneJointEntry3D(JointId id, ulong hash, SceneJointBuildResult3D result)
    {
        Id = id;
        Hash = hash;
        Result = result;
    }

    public JointId Id;
    public ulong Hash;
    public SceneJointBuildResult3D Result;
}

internal sealed class SceneJointBuildContext3D
{
    internal SceneJointBuildContext3D(SceneJointBridge3D bridge)
    {
        Bridge = bridge;
    }

    public readonly SceneJointBridge3D Bridge;

    public SceneActor Actor;
}

internal static class SceneJointRuntime3D
{
    private const float AxisEpsilon = 1e-6f;
    private const float MotionLocked = 0.0f;
    private const float MotionLimited = 2.0f;
    private const float UnboundedForce = float.MaxValue;

    public static SceneJointBuildResult3D Fixed(
        in SceneFixedJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque) ||
            !IsPositive(value.MassScale) ||
            !IsPositive(value.ConnectedMassScale))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryResolveAnchors(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
                context, bodyA, bodyB, out Vec3 anchorA, out Vec3 anchorB))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreateWeld(context.Bridge.Bodies, bodyA, bodyB, anchorA, anchorB);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    public static SceneJointBuildResult3D Hinge(
        in SceneHingeJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!TryValidateChannels(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor, value.Axis,
                value.BreakForce, value.BreakTorque, value.MassScale, value.ConnectedMassScale,
                value.Limits, value.Motor, context, bodyA, bodyB,
                out Vec3 anchorA, out Vec3 anchorB, out Vec3 axis))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreateHinge(
                context.Bridge.Bodies,
                bodyA,
                bodyB,
                anchorA,
                anchorB,
                axis,
                axis,
                value.Limits.Min,
                value.Limits.Max,
                value.UseLimits,
                value.Motor.TargetVelocity,
                value.Motor.Force,
                value.UseMotor);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    public static SceneJointBuildResult3D Slider(
        in SceneSliderJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!TryValidateChannels(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor, value.Axis,
                value.BreakForce, value.BreakTorque, value.MassScale, value.ConnectedMassScale,
                value.Limits, value.Motor, context, bodyA, bodyB,
                out Vec3 anchorA, out Vec3 anchorB, out Vec3 axis))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreatePrismatic(
                context.Bridge.Bodies,
                bodyA,
                bodyB,
                anchorA,
                anchorB,
                axis,
                axis,
                value.Limits.Min,
                value.Limits.Max,
                value.UseLimits,
                value.Motor.TargetVelocity,
                value.Motor.Force,
                value.UseMotor);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    public static SceneJointBuildResult3D Spring(
        in SceneSpringJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque) ||
            !IsPositive(value.MassScale) ||
            !IsPositive(value.ConnectedMassScale) ||
            value.Spring < 0.0f ||
            value.Damper < 0.0f ||
            value.MinDistance < 0.0f ||
            value.MaxDistance < 0.0f ||
            !float.IsFinite(value.Spring) ||
            !float.IsFinite(value.Damper) ||
            !float.IsFinite(value.MinDistance) ||
            !float.IsFinite(value.MaxDistance))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryResolveAnchors(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
                context, bodyA, bodyB, out Vec3 anchorA, out Vec3 anchorB))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        float restLength;
        if (value.AutoConfigureDistance)
        {
            BodyStore bodies = context.Bridge.Bodies;
            Vec3 worldAnchor = bodies.GetTransform(bodyA).TransformPoint(value.Anchor);
            Vec3 connectedWorld = bodies.GetTransform(bodyB).TransformPoint(anchorB);
            restLength = Length(connectedWorld - worldAnchor);
        }
        else
        {
            // TypeScript derives the rest length as the mean of the distance window.
            restLength = (value.MinDistance + value.MaxDistance) * 0.5f;
        }

        if (!float.IsFinite(restLength) || restLength < 0.0f)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreateSpring(
                context.Bridge.Bodies, bodyA, bodyB, anchorA, anchorB, restLength, value.Spring, value.Damper);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    public static SceneJointBuildResult3D Character(
        in SceneCharacterJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque) ||
            !IsPositive(value.MassScale) ||
            !IsPositive(value.ConnectedMassScale) ||
            value.MaxMotorTorque < 0.0f ||
            !float.IsFinite(value.MaxMotorTorque) ||
            !float.IsFinite(value.MotorSpeed) ||
            !float.IsFinite(value.Swing1Limit.Limit) ||
            !float.IsFinite(value.Swing2Limit.Limit) ||
            !float.IsFinite(value.LowTwistLimit.Limit) ||
            !float.IsFinite(value.HighTwistLimit.Limit))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        float swingSpan = MathF.Max(value.Swing1Limit.Limit, value.Swing2Limit.Limit);
        float twistSpan = value.HighTwistLimit.Limit - value.LowTwistLimit.Limit;
        if (swingSpan < 0.0f || twistSpan < 0.0f)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryResolveAnchors(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
                context, bodyA, bodyB, out Vec3 anchorA, out Vec3 anchorB))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryNormalize(value.Axis, out Vec3 axis))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        try
        {
            jointId = context.Bridge.Store.CreateConeTwist(
                context.Bridge.Bodies,
                bodyA,
                bodyB,
                anchorA,
                anchorB,
                axis,
                axis,
                swingSpan,
                twistSpan,
                value.MotorSpeed,
                value.MaxMotorTorque,
                value.MaxMotorTorque > 0.0f);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    public static SceneJointBuildResult3D Configurable(
        in SceneConfigurableJoint3D value, SceneJointBuildContext3D context, out JointId jointId)
    {
        jointId = JointId.Invalid;
        if (!context.Bridge.TryResolvePair(context.Actor, in value.ConnectedBody, out BodyId bodyA, out BodyId bodyB))
        {
            return SceneJointBuildResult3D.Pending;
        }

        if (!IsFiniteOrInfinity(value.BreakForce) ||
            !IsFiniteOrInfinity(value.BreakTorque) ||
            !IsPositive(value.MassScale) ||
            !IsPositive(value.ConnectedMassScale) ||
            !IsFinite(value.TargetPosition) ||
            !IsFinite(value.TargetVelocity) ||
            !IsFinite(value.TargetAngularVelocity) ||
            !IsFiniteUnit(value.TargetRotation) ||
            !float.IsFinite(value.LinearLimit.Limit) ||
            value.LinearLimit.Limit < 0.0f)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryResolveAnchors(
                value.Anchor, value.ConnectedAnchor, value.AutoConfigureConnectedAnchor,
                context, bodyA, bodyB, out Vec3 anchorA, out Vec3 anchorB))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        if (!TryLinearAxis(value.XMotion, in value.LinearLimit, value.TargetVelocity.X, in value.XDrive, out JointAxisDef xAxis) ||
            !TryLinearAxis(value.YMotion, in value.LinearLimit, value.TargetVelocity.Y, in value.YDrive, out JointAxisDef yAxis) ||
            !TryLinearAxis(value.ZMotion, in value.LinearLimit, value.TargetVelocity.Z, in value.ZDrive, out JointAxisDef zAxis) ||
            !TryAngularAxis(
                value.AngularXMotion, value.LowAngularXLimit.Limit, value.HighAngularXLimit.Limit,
                value.TargetAngularVelocity.X, in value.AngularXDrive, out JointAxisDef angularX) ||
            !TryAngularAxis(
                value.AngularYMotion, -value.AngularYLimit.Limit, value.AngularYLimit.Limit,
                value.TargetAngularVelocity.Y, in value.AngularYZDrive, out JointAxisDef angularY) ||
            !TryAngularAxis(
                value.AngularZMotion, -value.AngularZLimit.Limit, value.AngularZLimit.Limit,
                value.TargetAngularVelocity.Z, in value.AngularYZDrive, out JointAxisDef angularZ))
        {
            return SceneJointBuildResult3D.Faulted;
        }

        var definition = new ConfigurableJointDef
        {
            BodyA = bodyA,
            BodyB = bodyB,
            LocalAnchorA = anchorA,
            LocalAnchorB = anchorB,
            LocalFrameA = Quat.Identity,
            LocalFrameB = Quat.Identity,
            X = xAxis,
            Y = yAxis,
            Z = zAxis,
            AngularX = angularX,
            AngularY = angularY,
            AngularZ = angularZ
        };

        try
        {
            jointId = context.Bridge.Store.CreateConfigurable(context.Bridge.Bodies, in definition);
        }
        catch (InvalidOperationException)
        {
            return SceneJointBuildResult3D.Faulted;
        }
        catch (ArgumentNullException)
        {
            return SceneJointBuildResult3D.Faulted;
        }

        return SceneJointBuildResult3D.Created;
    }

    private static bool TryValidateChannels(
        in Vec3 anchor,
        in Vec3 connectedAnchor,
        bool autoConfigureConnectedAnchor,
        in Vec3 axis,
        float breakForce,
        float breakTorque,
        float massScale,
        float connectedMassScale,
        in SceneJointLimits3D limits,
        in SceneJointMotor3D motor,
        SceneJointBuildContext3D context,
        BodyId bodyA,
        BodyId bodyB,
        out Vec3 resolvedAnchorA,
        out Vec3 resolvedAnchorB,
        out Vec3 normalizedAxis)
    {
        resolvedAnchorA = resolvedAnchorB = normalizedAxis = default;

        if (!IsFiniteOrInfinity(breakForce) ||
            !IsFiniteOrInfinity(breakTorque) ||
            !IsPositive(massScale) ||
            !IsPositive(connectedMassScale) ||
            !float.IsFinite(limits.Min) ||
            !float.IsFinite(limits.Max) ||
            !float.IsFinite(motor.TargetVelocity) ||
            motor.Force < 0.0f ||
            !float.IsFinite(motor.Force))
        {
            return false;
        }

        if (!TryResolveAnchors(
                anchor, connectedAnchor, autoConfigureConnectedAnchor,
                context, bodyA, bodyB, out resolvedAnchorA, out resolvedAnchorB))
        {
            return false;
        }

        return TryNormalize(axis, out normalizedAxis);
    }

    private static bool TryResolveAnchors(
        in Vec3 anchor,
        in Vec3 connectedAnchor,
        bool autoConfigure,
        SceneJointBuildContext3D context,
        BodyId bodyA,
        BodyId bodyB,
        out Vec3 anchorA,
        out Vec3 anchorB)
    {
        anchorA = anchor;
        anchorB = connectedAnchor;

        if (!IsFinite(anchor))
        {
            return false;
        }

        if (!autoConfigure)
        {
            return IsFinite(connectedAnchor);
        }

        BodyStore bodies = context.Bridge.Bodies;
        Vec3 worldAnchor = bodies.GetTransform(bodyA).TransformPoint(anchor);
        Vec3 bodyPosition = bodies.GetTransform(bodyB).Position;
        anchorB = worldAnchor - bodyPosition;
        return IsFinite(anchorB);
    }

    private static bool TryLinearAxis(
        float motion,
        in SceneSoftJointLimit3D linearLimit,
        float velocity,
        in SceneJointDrive3D drive,
        out JointAxisDef axis)
    {
        axis = default;

        if (!float.IsFinite(velocity) || !TryDriveForce(in drive, out float maxForce))
        {
            return false;
        }

        if (motion == MotionLocked)
        {
            axis.Mode = JointAxisMode.Locked;
        }
        else if (motion == MotionLimited)
        {
            axis.Mode = JointAxisMode.Limited;
            axis.LowerLimit = -linearLimit.Limit;
            axis.UpperLimit = linearLimit.Limit;
        }
        else
        {
            axis.Mode = JointAxisMode.Free;
        }

        axis.MotorVelocity = velocity;
        axis.MaxForce = maxForce;
        axis.EnableMotor = velocity != 0.0f && maxForce != 0.0f;
        return true;
    }

    private static bool TryAngularAxis(
        float motion,
        float lower,
        float upper,
        float velocity,
        in SceneJointDrive3D drive,
        out JointAxisDef axis)
    {
        axis = default;

        if (!float.IsFinite(velocity) ||
            !float.IsFinite(lower) ||
            !float.IsFinite(upper) ||
            !TryDriveForce(in drive, out float maxForce))
        {
            return false;
        }

        if (motion == MotionLocked)
        {
            axis.Mode = JointAxisMode.Locked;
        }
        else if (motion == MotionLimited)
        {
            axis.Mode = JointAxisMode.Limited;
            axis.LowerLimit = lower;
            axis.UpperLimit = upper;
        }
        else
        {
            axis.Mode = JointAxisMode.Free;
        }

        axis.MotorVelocity = velocity;
        axis.MaxForce = maxForce;
        axis.EnableMotor = velocity != 0.0f && maxForce != 0.0f;
        return true;
    }

    private static bool TryDriveForce(in SceneJointDrive3D drive, out float maxForce)
    {
        if (float.IsNaN(drive.MaximumForce))
        {
            maxForce = 0.0f;
            return false;
        }

        // TypeScript treats an unbounded drive force as positive infinity; the
        // 3D configurable definition carries finite caps.
        maxForce = float.IsPositiveInfinity(drive.MaximumForce) ? UnboundedForce : drive.MaximumForce;
        return float.IsFinite(maxForce) && maxForce >= 0.0f;
    }

    private static bool IsFinite(in Vec3 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) && float.IsFinite(value.Z);

    private static bool IsFiniteUnit(in Quat value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) &&
        float.IsFinite(value.Z) && float.IsFinite(value.W);

    private static bool IsFiniteOrInfinity(float value) =>
        float.IsFinite(value) || float.IsPositiveInfinity(value);

    private static bool IsPositive(float value) => float.IsFinite(value) && value > 0.0f;

    private static bool TryNormalize(in Vec3 value, out Vec3 normalized)
    {
        if (!IsFinite(value))
        {
            normalized = default;
            return false;
        }

        float length = Length(value);
        if (length < AxisEpsilon)
        {
            normalized = default;
            return false;
        }

        normalized = new Vec3(value.X / length, value.Y / length, value.Z / length);
        return true;
    }

    private static float Length(in Vec3 value) =>
        MathF.Sqrt((value.X * value.X) + (value.Y * value.Y) + (value.Z * value.Z));
}
