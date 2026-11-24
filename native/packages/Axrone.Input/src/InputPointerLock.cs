namespace Axrone.Input;

/// <summary>
/// Pointer-lock lifecycle. Locked means the platform stopped reporting an absolute cursor
/// position and started reporting relative motion only.
/// </summary>
public enum PointerLockState : byte
{
    /// <summary>The feature is switched off; the controller never calls the platform.</summary>
    Disabled = 0,

    /// <summary>Enabled and free: the cursor is visible and positioned absolutely.</summary>
    Unlocked = 1,

    /// <summary>Enabled and held: motion is relative and the cursor is not visible.</summary>
    Locked = 2,
}

/// <summary>
/// Pointer-lock policy, mirroring the web engine's <c>InputPointerLockOptions</c> field for field.
/// </summary>
/// <param name="Enabled">Master switch. The web default is <see langword="false"/>.</param>
/// <param name="RequestOnMouseDown">
/// Request the lock on the first mouse press, which is how a browser satisfies the
/// user-gesture rule. The web default is <see langword="false"/>.
/// </param>
/// <param name="ExitOnDispose">
/// Release the lock when the attachment is disposed; the web default is <see langword="true"/>.
/// </param>
/// <param name="UseRawMovement">
/// While locked, feed motion from the platform's raw relative counters instead of reconstructing a
/// delta from two absolute positions. The web default is <see langword="true"/>.
/// </param>
public readonly record struct InputPointerLockOptions(
    bool Enabled = false,
    bool RequestOnMouseDown = false,
    bool ExitOnDispose = true,
    bool UseRawMovement = true);

/// <summary>
/// The pointer-lock state machine, with the platform left as three injected functions so the
/// policy is testable without a window system and the engine keeps reflecting over nothing.
/// </summary>
/// <remarks>
/// <para><b>State follows the platform, not the request.</b> <see cref="TryRequest"/> and
/// <see cref="Release"/> only change state when the injected platform call returns
/// <see langword="true"/>: a window manager that refuses the lock (a browser tab that lost
/// focus, a compositor that has the cursor) leaves the state at
/// <see cref="PointerLockState.Unlocked"/> and the caller sees <see langword="false"/>.</para>
/// <para><b>No hidden allocation.</b> Transitions publish through one stored delegate, so a
/// subscriber costs one object at subscribe time and a transition costs nothing.</para>
/// </remarks>
public sealed class PointerLockController
{
    private readonly Func<bool>? _request;
    private readonly Func<bool>? _release;
    private readonly Func<bool>? _isLocked;
    private int _state;

    /// <summary>Creates a controller.</summary>
    /// <param name="options">The policy.</param>
    /// <param name="request">Asks the platform to take the lock; <see langword="null"/> refuses.</param>
    /// <param name="release">Asks the platform to drop the lock; <see langword="null"/> refuses.</param>
    /// <param name="isLocked">
    /// Reads the platform's own view of the lock, used to notice an external release.
    /// <see langword="null"/> means the platform cannot be polled.
    /// </param>
    public PointerLockController(
        InputPointerLockOptions options,
        Func<bool>? request = null,
        Func<bool>? release = null,
        Func<bool>? isLocked = null)
    {
        Options = options;
        _request = request;
        _release = release;
        _isLocked = isLocked;
        _state = (int)(options.Enabled ? PointerLockState.Unlocked : PointerLockState.Disabled);
    }

    /// <summary>Gets the policy this controller enforces.</summary>
    public InputPointerLockOptions Options { get; }

    /// <summary>Gets the current lifecycle state.</summary>
    public PointerLockState State => (PointerLockState)Volatile.Read(ref _state);

    /// <summary>Gets whether motion is currently relative-only.</summary>
    public bool IsLocked => State == PointerLockState.Locked;

    /// <summary>Gets whether the platform is asked for raw relative counters while locked.</summary>
    public bool ReportsRelativeMotion => IsLocked && Options.UseRawMovement;

    /// <summary>
    /// Invoked once per accepted transition. One handler, not a multicast list: the transition is
    /// a window-server event with exactly one owner, the attachment.
    /// </summary>
    public Action<PointerLockState>? Changed { get; set; }

    /// <summary>Requests the lock, honouring the master switch.</summary>
    /// <returns><see langword="true"/> when the platform granted it and the state is now locked.</returns>
    public bool TryRequest()
    {
        if (State == PointerLockState.Disabled || _request is null)
        {
            return false;
        }

        if (State == PointerLockState.Locked)
        {
            return true;
        }

        if (!_request())
        {
            return false;
        }

        SetState(PointerLockState.Locked);
        return true;
    }

    /// <summary>Releases the lock.</summary>
    /// <returns><see langword="true"/> when the state is unlocked afterwards.</returns>
    public bool Release()
    {
        if (State != PointerLockState.Locked)
        {
            return State == PointerLockState.Unlocked;
        }

        if (_release is not null && !_release())
        {
            return false;
        }

        SetState(PointerLockState.Unlocked);
        return true;
    }

    /// <summary>
    /// Observes a mouse press. With <see cref="InputPointerLockOptions.RequestOnMouseDown"/> it
    /// takes the lock; a press while locked releases it, which is the escape hatch every
    /// pointer-locked UI needs.
    /// </summary>
    /// <returns><see langword="true"/> when the press changed the lock state.</returns>
    public bool OnMouseDown()
    {
        if (State == PointerLockState.Locked)
        {
            return Release();
        }

        return Options.RequestOnMouseDown && TryRequest();
    }

    /// <summary>
    /// Reconciles the state with the platform, which is how an external release - the window manager
    /// taking the cursor back, alt-tab, escape - is noticed. Polling is optional: a platform that
    /// cannot be queried leaves the state untouched.
    /// </summary>
    /// <returns><see langword="true"/> when the reconciliation changed the state.</returns>
    public bool SyncWithPlatform()
    {
        if (_isLocked is null || State == PointerLockState.Disabled)
        {
            return false;
        }

        bool locked = _isLocked();
        PointerLockState expected = locked ? PointerLockState.Locked : PointerLockState.Unlocked;
        if (expected == State)
        {
            return false;
        }

        SetState(expected);
        return true;
    }

    /// <summary>Applies the exit-on-dispose policy.</summary>
    /// <returns><see langword="true"/> when the controller was not holding a lock afterwards.</returns>
    public bool OnDisposed() => !Options.ExitOnDispose || Release();

    private void SetState(PointerLockState next)
    {
        Volatile.Write(ref _state, (int)next);
        Changed?.Invoke(next);
    }
}
