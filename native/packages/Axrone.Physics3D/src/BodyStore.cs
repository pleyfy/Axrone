namespace Axrone.Physics3D;

/// <summary>
/// Dense slot store of simulated bodies: identities are slot plus one, freed
/// slots recycle through an intrusive stack, and the arrays grow
/// geometrically. All validation lives here; frames, velocities, forces and
/// mass flow through guarded accessors, and <see cref="Integrate"/> advances
/// every awake body with semi-implicit Euler plus Box2D-style damping.
/// Orientation integrates through incremental axis-angle quaternions.
/// </summary>
public sealed class BodyStore
{
    private const int InitialCapacity = 16;

    private BodyState[] _bodies;
    private int[] _freeStack;
    private int _freeCount;
    private int _highWater;
    private int _count;
    private int _capacity;

    /// <summary>Creates a store with room for sixteen bodies.</summary>
    public BodyStore()
    {
        _capacity = InitialCapacity;
        _bodies = new BodyState[_capacity];
        _freeStack = new int[_capacity];
        _freeCount = 0;
        _highWater = 0;
        _count = 0;
    }

    /// <summary>Live bodies.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _count;
    }

    /// <summary>Adds a body and returns its identity.</summary>
    /// <param name="definition">Construction parameters; damping must not be negative.</param>
    public BodyId Create(in BodyDef definition)
    {
        if (definition.LinearDamping < 0.0f || float.IsNaN(definition.LinearDamping) ||
            definition.AngularDamping < 0.0f || float.IsNaN(definition.AngularDamping))
        {
            ThrowHelper.ThrowInvalidOperation("Damping must not be negative.");
        }

        if (float.IsNaN(definition.GravityScale) || float.IsInfinity(definition.GravityScale))
        {
            ThrowHelper.ThrowInvalidOperation("Gravity scale must be finite.");
        }

        int slot = AllocateSlot();
        ref BodyState body = ref _bodies[slot];

        body = default;
        body.Live = true;
        body.FirstShape = -1;
        body.Type = definition.Type;
        body.Flags = BodyFlags.None;
        if (definition.Awake)
        {
            body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
        }

        if (definition.Bullet)
        {
            body.Flags |= BodyFlags.Bullet;
        }

        if (definition.FixedRotation)
        {
            body.Flags |= BodyFlags.FixedRotation;
        }

        if (definition.AllowSleep)
        {
            body.Flags |= BodyFlags.AutoSleep;
        }

        body.Flags |= BodyFlags.Active;

        body.Position = definition.Position;
        body.Rotation = definition.Rotation;
        body.LinearVelocity = definition.Type == BodyType.Static ? Vec3.Zero : definition.LinearVelocity;
        body.AngularVelocity = definition is { Type: BodyType.Static } or { FixedRotation: true }
            ? Vec3.Zero
            : definition.AngularVelocity;
        body.LinearDamping = definition.LinearDamping;
        body.AngularDamping = definition.AngularDamping;
        body.GravityScale = definition.GravityScale;

        _count++;
        return BodyId.FromIndex(slot);
    }

    /// <summary>Drops a body; its identity dies with it.</summary>
    public void Destroy(BodyId id)
    {
        int slot = Validate(id);
        _bodies[slot] = default;
        _freeStack[_freeCount++] = slot;
        _count--;
    }

    /// <summary>Whether <paramref name="id"/> names a live body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsValid(BodyId id)
    {
        int slot = id.ToIndex();
        return id.IsValid && slot >= 0 && slot < _capacity && _bodies[slot].Live;
    }

    /// <summary>Reads the frame of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public RigidTransform3D GetTransform(BodyId id)
    {
        ref readonly BodyState body = ref Slot(id);
        return new RigidTransform3D(body.Position, body.Rotation);
    }

    /// <summary>Moves a body without touching its velocities; wakes it.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetTransform(BodyId id, Vec3 position, Quat rotation)
    {
        ref BodyState body = ref Slot(id);
        body.Position = position;
        body.Rotation = rotation;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Reads the linear velocity of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetLinearVelocity(BodyId id) => Slot(id).LinearVelocity;

    /// <summary>Writes the linear velocity of a body; statics ignore it.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetLinearVelocity(BodyId id, Vec3 velocity)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Static)
        {
            body.LinearVelocity = velocity;
            body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
        }
    }

    /// <summary>Reads the angular velocity of a body in radians per second.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetAngularVelocity(BodyId id) => Slot(id).AngularVelocity;

    /// <summary>Writes the angular velocity of a body; statics and locked bodies ignore it.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetAngularVelocity(BodyId id, Vec3 velocity)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Static && (body.Flags & BodyFlags.FixedRotation) == 0)
        {
            body.AngularVelocity = velocity;
            body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
        }
    }

    /// <summary>Reads the type of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public BodyType GetType(BodyId id) => Slot(id).Type;

    /// <summary>Whether the body is awake.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsAwake(BodyId id) => (Slot(id).Flags & BodyFlags.Awake) != 0;

    /// <summary>Whether the body rests with the sleeping bit set.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsSleeping(BodyId id) => (Slot(id).Flags & BodyFlags.Sleeping) != 0;

    /// <summary>Puts a body to sleep or wakes it; sleeping zeroes velocities and forces.</summary>
    public void SetAwake(BodyId id, bool awake)
    {
        ref BodyState body = ref Slot(id);
        if (awake)
        {
            body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
            body.SleepTime = 0.0f;
            return;
        }

        body.Flags = (body.Flags | BodyFlags.Sleeping) & ~BodyFlags.Awake;
        body.LinearVelocity = Vec3.Zero;
        body.AngularVelocity = Vec3.Zero;
        body.Force = Vec3.Zero;
        body.Torque = Vec3.Zero;
    }

    /// <summary>Accumulates a world force at the center of mass; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyForce(BodyId id, Vec3 force)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        body.Force += force;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Accumulates a world force applied at a world-space point; the offset from the center of mass adds torque; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyForce(BodyId id, Vec3 force, Vec3 point)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        Vec3 lever = point - CenterOfMass(in body);
        body.Force += force;
        body.Torque += Vec3.Cross(lever, force);
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Accumulates a world force through the center of mass; produces no torque; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyForceToCenter(BodyId id, Vec3 force)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        body.Force += force;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Accumulates a torque; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyTorque(BodyId id, Vec3 torque)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        body.Torque += torque;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Applies an instantaneous linear impulse at the center of mass; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyLinearImpulse(BodyId id, Vec3 impulse)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        body.LinearVelocity += impulse * body.InverseMass;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Applies an instantaneous linear impulse at a world-space point; the offset from the center of mass spins the body; wakes it.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyLinearImpulse(BodyId id, Vec3 impulse, Vec3 point)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic)
        {
            return;
        }

        Vec3 lever = point - CenterOfMass(in body);
        body.LinearVelocity += impulse * body.InverseMass;
        body.AngularVelocity += ContactSolver.ApplyInverseInertia(body.Rotation, body.InverseInertia, Vec3.Cross(lever, impulse));
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Applies an instantaneous angular impulse; wakes the body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ApplyAngularImpulse(BodyId id, Vec3 impulse)
    {
        ref BodyState body = ref Slot(id);
        if (body.Type != BodyType.Dynamic || (body.Flags & BodyFlags.FixedRotation) != 0)
        {
            return;
        }

        body.AngularVelocity += impulse * body.InverseInertia;
        body.Flags = (body.Flags | BodyFlags.Awake) & ~BodyFlags.Sleeping;
    }

    /// <summary>Overwrites the mass properties; zero mass means infinite (static-like response).</summary>
    /// <param name="id">The body.</param>
    /// <param name="mass">Mass; must not be negative.</param>
    /// <param name="inertiaDiagonal">Diagonal of the inertia tensor in the body frame; must not be negative.</param>
    public void SetMassData(BodyId id, float mass, Vec3 inertiaDiagonal)
    {
        if (mass < 0.0f || float.IsNaN(mass) ||
            inertiaDiagonal.X < 0.0f || inertiaDiagonal.Y < 0.0f || inertiaDiagonal.Z < 0.0f ||
            float.IsNaN(inertiaDiagonal.X + inertiaDiagonal.Y + inertiaDiagonal.Z))
        {
            ThrowHelper.ThrowInvalidOperation("Mass and inertia must not be negative.");
        }

        ref BodyState body = ref Slot(id);
        body.Mass = mass;
        body.InertiaDiagonal = inertiaDiagonal;
        body.InverseMass = body.Type != BodyType.Dynamic || mass <= 0.0f ? 0.0f : 1.0f / mass;
        RecomputeInverseInertia(ref body);
    }

    /// <summary>Rebuilds the inverse inertia from the stored tensor, type and rotation lock.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void RecomputeInverseInertia(ref BodyState body)
    {
        bool infinite = body.Type != BodyType.Dynamic;
        bool locked = (body.Flags & BodyFlags.FixedRotation) != 0;
        body.InverseInertia = new Vec3(
            !infinite && !locked && body.InertiaDiagonal.X > 0.0f ? 1.0f / body.InertiaDiagonal.X : 0.0f,
            !infinite && !locked && body.InertiaDiagonal.Y > 0.0f ? 1.0f / body.InertiaDiagonal.Y : 0.0f,
            !infinite && !locked && body.InertiaDiagonal.Z > 0.0f ? 1.0f / body.InertiaDiagonal.Z : 0.0f);
    }

    /// <summary>Reads the full mass properties: mass and inverses, the body-frame inertia diagonal and the local center of mass.</summary>
    public MassData3D GetMassData(BodyId id)
    {
        ref readonly BodyState body = ref Slot(id);
        return new MassData3D(body.Mass, body.InverseMass, body.InertiaDiagonal, body.InverseInertia, body.LocalCenter);
    }

    /// <summary>Reads whether rotation is locked.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsFixedRotation(BodyId id) => (Slot(id).Flags & BodyFlags.FixedRotation) != 0;

    /// <summary>Locks or unlocks rotation; locking zeroes angular velocity and pins the inverse inertia, unlocking restores it from the stored tensor.</summary>
    public void SetFixedRotation(BodyId id, bool fixedRotation)
    {
        ref BodyState body = ref Slot(id);
        if (fixedRotation)
        {
            body.Flags |= BodyFlags.FixedRotation;
            body.AngularVelocity = Vec3.Zero;
            body.InverseInertia = Vec3.Zero;
            return;
        }

        body.Flags &= ~BodyFlags.FixedRotation;
        RecomputeInverseInertia(ref body);
    }

    /// <summary>Reads the continuous-detection hint.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsBullet(BodyId id) => (Slot(id).Flags & BodyFlags.Bullet) != 0;

    /// <summary>Toggles the continuous-detection hint for fast movers.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetBullet(BodyId id, bool bullet)
    {
        ref BodyState body = ref Slot(id);
        if (bullet)
        {
            body.Flags |= BodyFlags.Bullet;
        }
        else
        {
            body.Flags &= ~BodyFlags.Bullet;
        }
    }

    /// <summary>Reads whether the body participates in simulation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsEnabled(BodyId id) => (Slot(id).Flags & BodyFlags.Active) != 0;

    /// <summary>Enables or disables the body; disabling zeroes motion, clears loads and sleeps it, enabling restores participation without waking.</summary>
    public void SetEnabled(BodyId id, bool enabled)
    {
        ref BodyState body = ref Slot(id);
        if (enabled)
        {
            body.Flags |= BodyFlags.Active;
            return;
        }

        body.Flags &= ~(BodyFlags.Active | BodyFlags.Awake);
        body.Flags |= BodyFlags.Sleeping;
        body.LinearVelocity = Vec3.Zero;
        body.AngularVelocity = Vec3.Zero;
        body.Force = Vec3.Zero;
        body.Torque = Vec3.Zero;
    }

    /// <summary>Puts a body to sleep or wakes it; the inverse view of <see cref="SetAwake"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetSleeping(BodyId id, bool sleeping) => SetAwake(id, !sleeping);

    /// <summary>Reads the linear velocity a rigidly attached world point would carry.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetLinearVelocityAtPoint(BodyId id, Vec3 point)
    {
        ref readonly BodyState body = ref Slot(id);
        return body.LinearVelocity + Vec3.Cross(body.AngularVelocity, point - CenterOfMass(in body));
    }

    /// <summary>Maps a body-frame point into world space.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetWorldPoint(BodyId id, Vec3 localPoint)
    {
        ref readonly BodyState body = ref Slot(id);
        return new RigidTransform3D(body.Position, body.Rotation).TransformPoint(localPoint);
    }

    /// <summary>Maps a world point into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetLocalPoint(BodyId id, Vec3 worldPoint)
    {
        ref readonly BodyState body = ref Slot(id);
        return new RigidTransform3D(body.Position, body.Rotation).InverseTransformPoint(worldPoint);
    }

    /// <summary>Rotates a body-frame vector into world space; translation is ignored.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetWorldVector(BodyId id, Vec3 localVector) => Slot(id).Rotation * localVector;

    /// <summary>Rotates a world vector into the body frame; translation is ignored.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetLocalVector(BodyId id, Vec3 worldVector) => Slot(id).Rotation.Conjugate() * worldVector;


    /// <summary>Reads the mass of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float GetMass(BodyId id) => Slot(id).Mass;

    /// <summary>Reads the inverse mass of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public float GetInverseMass(BodyId id) => Slot(id).InverseMass;

    /// <summary>Reads the diagonal of the inverse inertia tensor of a body.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetInverseInertia(BodyId id) => Slot(id).InverseInertia;

    /// <summary>
    /// Advances every awake body by <paramref name="dt"/> under
    /// <paramref name="gravity"/>: forces integrate into velocities, damping
    /// scales them, velocities integrate into frames, and forces clear.
    /// Static bodies never move; kinematic bodies translate on velocity
    /// alone; locked rotation pins the angular channel.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void Integrate(float dt, Vec3 gravity)
    {
        IntegrateVelocities(dt, gravity);
        IntegratePositions(dt);
    }

    /// <summary>
    /// Force half of the step: gravity and accumulated forces integrate into
    /// velocities with damping applied, then forces clear. Positions untouched.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void IntegrateVelocities(float dt, Vec3 gravity)
    {
        if (!(dt > 0.0f))
        {
            ThrowHelper.ThrowInvalidOperation("Time step must be positive.");
        }

        Span<BodyState> bodies = _bodies.AsSpan(0, _capacity);
        for (int i = 0; i < bodies.Length; i++)
        {
            ref BodyState body = ref bodies[i];
            if ((body.Flags & BodyFlags.Awake) == 0 || (body.Flags & BodyFlags.Active) == 0)
            {
                continue;
            }

            if (body.Type != BodyType.Dynamic)
            {
                continue;
            }

            body.LinearVelocity += dt * ((gravity * body.GravityScale) + (body.Force * body.InverseMass));
            body.AngularVelocity += dt * (body.Torque * body.InverseInertia);

            body.LinearVelocity *= 1.0f / (1.0f + (dt * body.LinearDamping));
            body.AngularVelocity *= 1.0f / (1.0f + (dt * body.AngularDamping));

            if ((body.Flags & BodyFlags.FixedRotation) != 0)
            {
                body.AngularVelocity = Vec3.Zero;
            }

            body.Force = Vec3.Zero;
            body.Torque = Vec3.Zero;
        }
    }

    /// <summary>
    /// Position half of the step: velocities integrate into frames. Static and
    /// sleeping bodies never move; kinematic bodies translate on velocity
    /// alone. Orientation advances through an incremental axis-angle
    /// quaternion, renormalized every step against drift.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void IntegratePositions(float dt)
    {
        if (!(dt > 0.0f))
        {
            ThrowHelper.ThrowInvalidOperation("Time step must be positive.");
        }

        Span<BodyState> bodies = _bodies.AsSpan(0, _capacity);
        for (int i = 0; i < bodies.Length; i++)
        {
            ref BodyState body = ref bodies[i];
            if ((body.Flags & BodyFlags.Awake) == 0 || (body.Flags & BodyFlags.Active) == 0)
            {
                continue;
            }

            if (body.Type == BodyType.Static)
            {
                continue;
            }

            body.Position += body.LinearVelocity * dt;

            float spinSq = body.AngularVelocity.LengthSquared();
            if (spinSq > 0.0f)
            {
                float spin = MathF.Sqrt(spinSq);
                Quat increment = Quat.CreateFromAxisAngle(body.AngularVelocity / spin, spin * dt);
                body.Rotation = (increment * body.Rotation).Normalize();
            }
        }
    }

    /// <summary>Internal slot access for the world and the solver; validated.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ref BodyState Slot(BodyId id) => ref _bodies[Validate(id)];

    /// <summary>Raw slot of an identity without validation; the caller holds the invariant.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static int SlotOf(BodyId id) => id.ToIndex();

    /// <summary>Slot capacity for internal iteration.</summary>
    internal int SlotCapacity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _capacity;
    }

    /// <summary>Whether a raw slot holds a live body; for internal iteration.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal bool IsSlotLive(int slot) => slot >= 0 && slot < _capacity && _bodies[slot].Live;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int AllocateSlot()
    {
        if (_freeCount > 0)
        {
            return _freeStack[--_freeCount];
        }

        if (_highWater >= _capacity)
        {
            Grow();
        }

        return _highWater++;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Grow()
    {
        int newCapacity = _capacity * 2;
        Array.Resize(ref _bodies, newCapacity);
        Array.Resize(ref _freeStack, newCapacity);
        _capacity = newCapacity;
    }

    /// <summary>World-space center of mass: the body origin plus the rotated local offset.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec3 CenterOfMass(in BodyState body) => body.Position + (body.Rotation * body.LocalCenter);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int Validate(BodyId id)
    {
        int slot = id.ToIndex();
        if (!id.IsValid || slot < 0 || slot >= _capacity || !_bodies[slot].Live)
        {
            ThrowHelper.ThrowBodyNotFound(id);
        }

        return slot;
    }
}
