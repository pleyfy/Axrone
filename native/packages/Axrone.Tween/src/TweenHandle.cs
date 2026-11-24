namespace Axrone.Tween;

/// <summary>
/// Generational tween handle routing control operations to the owning engine. Stale handles
/// (recycled slots) fail safely instead of touching the new occupant.
/// </summary>
public readonly struct TweenHandle : IEquatable<TweenHandle>
{
    private readonly TweenEngine? _engine;

    /// <summary>Tween identity.</summary>
    public TweenId Id { get; }

    internal TweenHandle(TweenEngine engine, TweenId id)
    {
        _engine = engine;
        Id = id;
    }

    /// <summary>Whether the handle names a live engine allocation.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _engine != null && Id.IsValid;
    }

    /// <summary>Current state; stale identities report inactive.</summary>
    public TweenState State
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _engine?.QueryState(Id) ?? TweenState.Inactive;
    }

    /// <summary>Whether the handle routes to this engine rather than a same-shaped one.</summary>
    /// <param name="engine">Engine to test ownership against.</param>
    /// <returns><see langword="true"/> when the handle was produced by <paramref name="engine"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool OwnedBy(TweenEngine engine) => ReferenceEquals(_engine, engine);

    /// <summary>Cancels the tween; false for stale identities.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Cancel() => _engine != null && _engine.Cancel(Id);

    /// <summary>Finishes the tween now, firing final update, step, and completion callbacks.</summary>
    public bool Complete() => _engine != null && _engine.Complete(Id);

    /// <summary>Pauses a playing tween.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Pause() => _engine != null && _engine.Pause(Id);

    /// <summary>Resumes a paused tween.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Resume() => _engine != null && _engine.Resume(Id);

    /// <summary>Restarts a live tween from zero and plays it.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Restart() => _engine != null && _engine.Restart(Id);

    /// <summary>Moves the play head, preserving state.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Goto(DurationNs position) => _engine != null && _engine.Goto(Id, position);

    /// <summary>Moves the play head to zero, preserving state.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Rewind() => _engine != null && _engine.Rewind(Id);

    /// <summary>
    /// Awaits termination through the owning engine (no downcast, no polling): true for natural
    /// completion, false for cancel, fault, or unknown outcome.
    /// </summary>
    public TaskAwaiter<bool> GetAwaiter() =>
        (_engine != null ? _engine.AwaitAsync(Id) : Task.FromResult(false)).GetAwaiter();

    /// <inheritdoc/>
    public bool Equals(TweenHandle other) => Id.Equals(other.Id) && ReferenceEquals(_engine, other._engine);

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is TweenHandle other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(_engine, Id);

    public static bool operator ==(TweenHandle left, TweenHandle right) => left.Equals(right);

    public static bool operator !=(TweenHandle left, TweenHandle right) => !left.Equals(right);
}
