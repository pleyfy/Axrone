namespace Axrone.Event;

/// <summary>Internal control surface exposed through <see cref="EventTimerHandle"/>.</summary>
internal interface IEventTimerControl
{
    Guid Id { get; }

    bool IsActive { get; }

    bool IsPaused { get; }

    DateTimeOffset DueAt { get; }

    TimeSpan Interval { get; }

    int RemainingTicks { get; }

    int FiredTicks { get; }

    void Pause();

    void Resume();

    void Cancel();
}

/// <summary>
/// Handle to a scheduled delay, deadline or recurring timer. Disposing cancels the timer;
/// pause/resume shift the due time by the paused duration.
/// </summary>
public sealed class EventTimerHandle : IDisposable
{
    private static readonly EventTimerHandle InactiveHandle = new(control: null);

    private readonly IEventTimerControl? _control;

    internal EventTimerHandle(IEventTimerControl? control) => _control = control;

    /// <summary>Handle for a timer rejected because its cancellation token was already signalled.</summary>
    public static EventTimerHandle Inactive => InactiveHandle;

    /// <summary>Stable timer identity.</summary>
    public Guid Id => _control?.Id ?? Guid.Empty;

    /// <summary>Whether the timer can still fire or is recurring.</summary>
    public bool IsActive => _control?.IsActive == true;

    /// <summary>Whether the timer is paused.</summary>
    public bool IsPaused => _control?.IsPaused == true;

    /// <summary>Next due instant; shifted by pause/resume and recurring intervals.</summary>
    public DateTimeOffset DueAt => _control?.DueAt ?? DateTimeOffset.MinValue;

    /// <summary>Recurring interval; zero for one-shot timers.</summary>
    public TimeSpan Interval => _control?.Interval ?? TimeSpan.Zero;

    /// <summary>Remaining ticks, or -1 for an unlimited recurring timer.</summary>
    public int RemainingTicks => _control?.RemainingTicks ?? 0;

    /// <summary>Number of ticks already produced.</summary>
    public int FiredTicks => _control?.FiredTicks ?? 0;

    /// <summary>Pauses the timer; due time freezes until <see cref="Resume"/>.</summary>
    public void Pause() => _control?.Pause();

    /// <summary>Resumes a paused timer and shifts its due time by the paused duration.</summary>
    public void Resume() => _control?.Resume();

    /// <summary>Cancels the timer; idempotent.</summary>
    public void Cancel() => _control?.Cancel();

    /// <inheritdoc/>
    public void Dispose() => _control?.Cancel();
}
