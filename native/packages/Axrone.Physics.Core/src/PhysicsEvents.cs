namespace Axrone.Physics.Core;

/// <summary>
/// Contact lifecycle mirroring the web physics-core contract. Begin/stay/end
/// are emitted by both world implementations at the end of a step;
/// pre-solve and post-solve are emitted through the solver callback hooks
/// (<see cref="IContactSolverCallbacks{TContact, TManifold, TContext}"/>)
/// around the velocity pass.
/// </summary>
public enum CollisionEventType : byte
{
    /// <summary>A new overlap appeared.</summary>
    Begin = 0,

    /// <summary>An overlap persisted.</summary>
    Stay = 1,

    /// <summary>A previous overlap is gone.</summary>
    End = 2,

    /// <summary>Pre-solve callback point: tuning is mutable inside the callback.</summary>
    PreSolve = 3,

    /// <summary>Post-solve callback point: carries the accumulated impulses.</summary>
    PostSolve = 4,
}

/// <summary>
/// Sensor overlap lifecycle mirroring the web physics-core contract.
/// </summary>
public enum SensorEventType : byte
{
    /// <summary>A body entered the trigger volume.</summary>
    Enter = 0,

    /// <summary>A body stayed inside the trigger volume.</summary>
    Stay = 1,

    /// <summary>A body exited the trigger volume.</summary>
    Exit = 2,
}

/// <summary>
/// Per-point impulses accumulated by the solver for one contact pair,
/// reported at the post-solve callback point. The count matches the
/// manifold's contact count; unused slots stay zero. Slots live inline so
/// reporting a contact never allocates.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct ContactImpulses : IEquatable<ContactImpulses>
{
    /// <summary>Number of valid contact points; at most four.</summary>
    public int Count { get; set; }

    /// <summary>Callback point that produced this payload; always <see cref="CollisionEventType.PostSolve"/> when the solver emits it.</summary>
    public CollisionEventType Phase { get; set; }

    /// <summary>Accumulated normal impulse of contact point <paramref name="index"/>; non-negative.</summary>
    /// <param name="index">Contact point index, below <see cref="Count"/>.</param>
    /// <returns>The normal impulse.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly float NormalAt(int index) => _normals[index];

    /// <summary>Accumulated tangent impulse of contact point <paramref name="index"/>.</summary>
    /// <param name="index">Contact point index, below <see cref="Count"/>.</param>
    /// <returns>The tangent impulse.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly float TangentAt(int index) => _tangents[index];

    /// <inheritdoc/>
    public readonly bool Equals(ContactImpulses other)
    {
        if (Count != other.Count || Phase != other.Phase)
        {
            return false;
        }

        for (int i = 0; i < Math.Clamp(Count, 0, 4); i++)
        {
            if (NormalAt(i) != other.NormalAt(i) || TangentAt(i) != other.TangentAt(i))
            {
                return false;
            }
        }

        return true;
    }

    /// <inheritdoc/>
    public override readonly bool Equals(object? obj) => obj is ContactImpulses other && Equals(other);

    /// <inheritdoc/>
    public override readonly int GetHashCode()
    {
        HashCode code = default;
        code.Add(Count);
        code.Add(Phase);
        for (int i = 0; i < Math.Clamp(Count, 0, 4); i++)
        {
            code.Add(NormalAt(i));
            code.Add(TangentAt(i));
        }

        return code.ToHashCode();
    }

    /// <summary>Determines whether two impulse payloads report identical slots.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(ContactImpulses left, ContactImpulses right) => left.Equals(right);

    /// <summary>Determines whether two impulse payloads differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(ContactImpulses left, ContactImpulses right) => !left.Equals(right);

    /// <summary>Writes one point's pair of impulses during collection.</summary>
    /// <param name="index">Contact point index, below four.</param>
    /// <param name="normal">Accumulated normal impulse.</param>
    /// <param name="tangent">Accumulated tangent impulse.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void WritePoint(int index, float normal, float tangent)
    {
        _normals[index] = normal;
        _tangents[index] = tangent;
    }

    private ImpulseBuffer _normals;

    private ImpulseBuffer _tangents;
}

/// <summary>Inline four-slot buffer of scalar impulses inside <see cref="ContactImpulses"/>.</summary>
[InlineArray(4)]
internal struct ImpulseBuffer
{
    private float _element0;
}

/// <summary>
/// Solver tuning a pre-solve callback may rewrite for one contact pair:
/// the combined Coulomb friction, the combined restitution, and the
/// velocity threshold under which restitution stays silent.
/// </summary>
public struct ContactTuning : IEquatable<ContactTuning>
{
    /// <summary>Callback point that produced this tuning; always <see cref="CollisionEventType.PreSolve"/> when the solver emits it.</summary>
    public CollisionEventType Phase { get; set; }

    /// <summary>Combined friction coefficient for this pair.</summary>
    public float Friction { get; set; }

    /// <summary>Combined restitution coefficient for this pair.</summary>
    public float Restitution { get; set; }

    /// <summary>Approach speed above which restitution applies.</summary>
    public float RestitutionThreshold { get; set; }

    /// <summary>
    /// Signed surface speed along the contact tangent driving the relative
    /// sliding target (conveyor): the solver steers the pair's relative
    /// tangent velocity toward this value. In 2D the tangent is the contact
    /// normal rotated +90° and the pair's speed is shape A minus shape B;
    /// dimension code decides the exact use.
    /// </summary>
    public float TangentSpeed { get; set; }

    /// <summary>
    /// Friction coefficient applied while the pair slides. Zero mirrors
    /// <see cref="Friction"/>; a pre-solve rewrite of <see cref="Friction"/>
    /// rescales it by the same ratio the materials carried in.
    /// </summary>
    public float DynamicFriction { get; set; }

    /// <inheritdoc/>
    public readonly bool Equals(ContactTuning other) =>
        Friction == other.Friction && Restitution == other.Restitution &&
        RestitutionThreshold == other.RestitutionThreshold && TangentSpeed == other.TangentSpeed &&
        DynamicFriction == other.DynamicFriction && Phase == other.Phase;

    /// <inheritdoc/>
    public override readonly bool Equals(object? obj) => obj is ContactTuning other && Equals(other);

    /// <inheritdoc/>
    public override readonly int GetHashCode() =>
        HashCode.Combine(Friction, Restitution, RestitutionThreshold, TangentSpeed, DynamicFriction, Phase);

    /// <summary>Determines whether two tuning payloads carry identical coefficients.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(ContactTuning left, ContactTuning right) => left.Equals(right);

    /// <summary>Determines whether two tuning payloads differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(ContactTuning left, ContactTuning right) => !left.Equals(right);
}

/// <summary>
/// Solver callback hooks both dimensions emit around the velocity pass of
/// one step. The contact and manifold types are dimension-owned; the handler
/// is a static-abstract struct so the dispatch devirtualizes and allocates
/// nothing. Pre-solve receives the pair's tuning by reference for mutation
/// (the solver reads the result before iterating); post-solve receives the
/// accumulated impulses read-only after the last sweep.
/// </summary>
/// <typeparam name="TContact">Dimension-owned contact storage type.</typeparam>
/// <typeparam name="TManifold">Dimension-owned manifold type.</typeparam>
/// <typeparam name="TContext">Caller state; may be a <see langword="ref"/> struct.</typeparam>
public interface IContactSolverCallbacks<TContact, TManifold, TContext>
    where TContact : struct
    where TManifold : struct
    where TContext : allows ref struct
{
    /// <summary>Called once per solid contact before its constraints are initialized.</summary>
    /// <param name="contact">The contact about to be solved, by reference.</param>
    /// <param name="manifold">The current manifold of the contact, by reference.</param>
    /// <param name="tuning">Pair tuning; mutations feed the very next solve.</param>
    /// <param name="context">Caller state the handler may read and write.</param>
    static abstract void OnPreSolve(
        ref TContact contact, ref TManifold manifold, ref ContactTuning tuning, ref TContext context);

    /// <summary>Called once per solid contact after the velocity sweeps finished.</summary>
    /// <param name="contact">The solved contact, by reference.</param>
    /// <param name="manifold">The manifold holding the accumulated impulses.</param>
    /// <param name="impulses">Normal and tangent impulses per contact point.</param>
    /// <param name="context">Caller state the handler may read and write.</param>
    static abstract void OnPostSolve(
        ref readonly TContact contact, in TManifold manifold, in ContactImpulses impulses, ref TContext context);
}

/// <summary>
/// Dimension-neutral sink the solvers drive per contact: <c>Tune</c>
/// supplies the pair's default combined tuning, <c>PreSolve</c> hands it to
/// the callback point for rewrite, <c>PostSolve</c> reports accumulated
/// impulses. The world's built-in sink records notices; user sinks forward
/// to an <see cref="IContactSolverCallbacks{TContact, TManifold, TContext}"/>
/// handler.
/// </summary>
/// <typeparam name="TContact">Dimension-owned contact storage type.</typeparam>
/// <typeparam name="TManifold">Dimension-owned manifold type.</typeparam>
/// <typeparam name="TContext">Caller state; may be a <see langword="ref"/> struct.</typeparam>
public interface IContactSolveContext<TContact, TManifold, TContext>
    where TContact : struct
    where TManifold : struct
    where TContext : allows ref struct
{
    /// <summary>Combined tuning for one contact before any callback rewrite.</summary>
    /// <param name="contact">The contact being initialized.</param>
    /// <param name="context">Caller state the sink may read.</param>
    /// <returns>The pair tuning seed.</returns>
    ContactTuning Tune(ref readonly TContact contact, ref TContext context);

    /// <summary>Runs the pre-solve callback point for one contact.</summary>
    /// <param name="contact">The contact about to be solved, by reference.</param>
    /// <param name="manifold">The current manifold, by reference.</param>
    /// <param name="tuning">Pair tuning the callback may rewrite.</param>
    /// <param name="context">Caller state the sink may read and write.</param>
    void PreSolve(ref TContact contact, ref TManifold manifold, ref ContactTuning tuning, ref TContext context);

    /// <summary>Runs the post-solve callback point for one contact.</summary>
    /// <param name="contact">The solved contact, by reference.</param>
    /// <param name="manifold">The manifold holding the accumulated impulses.</param>
    /// <param name="impulses">Normal and tangent impulses per contact point.</param>
    /// <param name="context">Caller state the sink may read and write.</param>
    void PostSolve(ref readonly TContact contact, in TManifold manifold, in ContactImpulses impulses, ref TContext context);
}

/// <summary>
/// Time-of-impact outcome mirroring the web physics-core contract.
/// </summary>
public enum ToiState : byte
{
    /// <summary>Not evaluated yet.</summary>
    Unknown = 0,

    /// <summary>Sweep failed to converge.</summary>
    Failed = 1,

    /// <summary>Shapes overlap at time zero.</summary>
    Overlapped = 2,

    /// <summary>Shapes touch within the sweep.</summary>
    Touching = 3,

    /// <summary>No touch within the sweep.</summary>
    Separated = 4,
}
