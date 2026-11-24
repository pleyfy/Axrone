namespace Axrone.Profiler;

/// <summary>Sampler runtime snapshot.</summary>
public readonly record struct SamplerState(
    double IntervalMs,
    long TickCount,
    double LastDurationMs,
    bool IsRunning,
    bool IsAdaptive);

/// <summary>
/// The source of a sampler's ticks. Separating "when" from "what" is what lets a test drive a
/// whole adaptive schedule without waiting on a wall clock, and it is the only seam the sampler
/// needs to be deterministic.
/// </summary>
public interface ISamplerSchedule
{
    /// <summary>
    /// Requests one future delivery of <paramref name="fire"/> after <paramref name="delayMs"/>.
    /// The sampler re-arms after every delivery, so a one-shot request is enough to keep the
    /// cadence and it always uses the interval that is current at that moment.
    /// </summary>
    /// <param name="fire">The tick entry point.</param>
    /// <param name="delayMs">Delay before the delivery.</param>
    void Arm(Action fire, double delayMs);

    /// <summary>Cancels any delivery that has not happened yet.</summary>
    void Cancel();
}

/// <summary>
/// Default schedule: one <see cref="Timer"/> held for the sampler's lifetime, rearmed one-shot per
/// tick so an interval change never races a pending period.
/// </summary>
public sealed class TimerSamplerSchedule : ISamplerSchedule, IDisposable
{
    private readonly object _gate = new();
    private Timer? _timer;
    private Action? _fire;

    /// <inheritdoc />
    public void Arm(Action fire, double delayMs)
    {
        ArgumentNullException.ThrowIfNull(fire);
        lock (_gate)
        {
            _fire = fire;
            _timer ??= new Timer(static state => Volatile.Read(ref ((TimerSamplerSchedule)state!)._fire)?.Invoke(), this, Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
            _timer.Change(TimeSpan.FromMilliseconds(delayMs), Timeout.InfiniteTimeSpan);
        }
    }

    /// <inheritdoc />
    public void Cancel()
    {
        lock (_gate)
        {
            _timer?.Change(Timeout.InfiniteTimeSpan, Timeout.InfiniteTimeSpan);
        }
    }

    /// <summary>Releases the underlying timer.</summary>
    public void Dispose()
    {
        lock (_gate)
        {
            _timer?.Dispose();
            _timer = null;
        }

        GC.SuppressFinalize(this);
    }
}

/// <summary>Periodic sampler with overhead-driven adaptive intervals.</summary>
public sealed class ContinuousSampler : IDisposable, IAsyncDisposable
{
    private readonly Action<Nanoseconds> _onTick;
    private readonly ISamplerSchedule _schedule;
    private readonly bool _ownsSchedule;
    private readonly double _minIntervalMs;
    private readonly double _maxIntervalMs;
    private readonly object _gate = new();
    private double _intervalMs;
    private double _targetFrameBudgetMs;
    private bool _adaptive;
    private bool _running;
    private long _tickCount;
    private double _lastDurationMs;
    private int _disposed;

    /// <summary>Creates a sampler.</summary>
    public ContinuousSampler(
        Action<Nanoseconds> onTick,
        double intervalMs = 10.0,
        double minIntervalMs = 1.0,
        double maxIntervalMs = 100.0,
        double targetFrameBudgetMs = 16.0,
        bool adaptive = true,
        ISamplerSchedule? schedule = null)
    {
        ArgumentNullException.ThrowIfNull(onTick);
        if (!(intervalMs >= minIntervalMs && intervalMs <= maxIntervalMs) || double.IsNaN(intervalMs) || double.IsInfinity(intervalMs))
        {
            ProfilerThrowHelper.ThrowArgument(nameof(intervalMs), "Interval must sit inside [min, max].");
        }

        if (!(minIntervalMs >= 1.0) || double.IsNaN(minIntervalMs) || double.IsInfinity(minIntervalMs))
        {
            ProfilerThrowHelper.ThrowArgument(nameof(minIntervalMs), "Minimum interval must be at least 1 ms.");
        }

        if (!(maxIntervalMs >= minIntervalMs) || double.IsNaN(maxIntervalMs) || double.IsInfinity(maxIntervalMs))
        {
            ProfilerThrowHelper.ThrowArgument(nameof(maxIntervalMs), "Maximum interval must cover the minimum.");
        }

        if (!(targetFrameBudgetMs > 0.0) || double.IsNaN(targetFrameBudgetMs) || double.IsInfinity(targetFrameBudgetMs))
        {
            ProfilerThrowHelper.ThrowArgument(nameof(targetFrameBudgetMs), "Frame budget must be positive.");
        }

        _onTick = onTick;
        _intervalMs = intervalMs;
        _minIntervalMs = minIntervalMs;
        _maxIntervalMs = maxIntervalMs;
        _targetFrameBudgetMs = targetFrameBudgetMs;
        _adaptive = adaptive;
        _ownsSchedule = schedule is null;
        _schedule = schedule ?? new TimerSamplerSchedule();
    }

    /// <summary>Current interval.</summary>
    public double IntervalMs
    {
        get { lock (_gate) { return _intervalMs; } }
    }

    /// <summary>Total ticks fired.</summary>
    public long TickCount => Interlocked.Read(ref _tickCount);

    /// <summary>Last tick body duration.</summary>
    public double LastDurationMs => Volatile.Read(ref _lastDurationMs);

    /// <summary>Whether sampling is armed.</summary>
    public bool IsRunning
    {
        get { lock (_gate) { return _running; } }
    }

    /// <summary>Starts sampling.</summary>
    public void Start()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed != 0, this);
            if (!_running)
            {
                _running = true;
                _schedule.Arm(Fire, _intervalMs);
            }
        }
    }

    /// <summary>Stops sampling.</summary>
    public void Stop()
    {
        lock (_gate)
        {
            if (!_running)
            {
                return;
            }

            _running = false;
            _schedule.Cancel();
        }
    }

    /// <summary>Changes the interval.</summary>
    public void SetInterval(double intervalMs)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed != 0, this);
            if (!(intervalMs >= _minIntervalMs) || intervalMs > _maxIntervalMs || double.IsNaN(intervalMs) || double.IsInfinity(intervalMs))
            {
                ProfilerThrowHelper.ThrowArgument(nameof(intervalMs), "Interval must sit inside [min, max].");
            }

            _intervalMs = intervalMs;
            if (_running)
            {
                _schedule.Arm(Fire, _intervalMs);
            }
        }
    }

    /// <summary>Toggles adaptation.</summary>
    public void SetAdaptation(bool enabled)
    {
        lock (_gate)
        {
            _adaptive = enabled;
        }
    }

    /// <summary>Changes the frame budget the adaptation steers by.</summary>
    public void SetTargetFrameBudget(double budgetMs)
    {
        lock (_gate)
        {
            if (!(budgetMs > 0.0) || double.IsNaN(budgetMs) || double.IsInfinity(budgetMs))
            {
                ProfilerThrowHelper.ThrowArgument(nameof(budgetMs), "Frame budget must be positive.");
            }

            _targetFrameBudgetMs = budgetMs;
        }
    }

    /// <summary>Returns a snapshot of the sampler state.</summary>
    public SamplerState GetState()
    {
        lock (_gate)
        {
            return new SamplerState(_intervalMs, Interlocked.Read(ref _tickCount), Volatile.Read(ref _lastDurationMs), _running, _adaptive);
        }
    }

    private void Fire()
    {
        long start = Stopwatch.GetTimestamp();
        Nanoseconds timestamp = new(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() * TimeConversion.Milliseconds);
        try
        {
            _onTick(timestamp);
        }
        catch (Exception ex)
        {
            throw new ProfilerTickException("Sampler tick callback failed.", ex);
        }
        finally
        {
            double elapsedMs = (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;
            Volatile.Write(ref _lastDurationMs, elapsedMs);
            Interlocked.Increment(ref _tickCount);

            lock (_gate)
            {
                if (_running)
                {
                    if (_adaptive)
                    {
                        double next = elapsedMs > _targetFrameBudgetMs
                            ? Math.Min(_intervalMs * 2.0, _maxIntervalMs)
                            : Math.Max(_intervalMs / 2.0, _minIntervalMs);
                        if (next != _intervalMs)
                        {
                            _intervalMs = next;
                        }
                    }

                    _schedule.Arm(Fire, _intervalMs);
                }
            }
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        IDisposable? owned = null;
        lock (_gate)
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            _running = false;
            _schedule.Cancel();
            if (_ownsSchedule && _schedule is IDisposable disposable)
            {
                owned = disposable;
            }
        }

        owned?.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }
}
