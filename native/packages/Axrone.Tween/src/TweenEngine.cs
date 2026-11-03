namespace Axrone.Tween;

using System.Runtime.ExceptionServices;
using Axrone.Utility.Backoff.SpinPolicies;

/// <summary>
/// Tween orchestrator over a <see cref="TweenStore"/>: scheduling, lifecycle, clocked pump.
/// </summary>
public sealed class TweenEngine : IDisposable
{
    private const int StateRunning = 0;
    private const int StateCompleting = 1;
    private const int StateTerminated = 2;
    private const int StateFaulted = 3;

    private const int RecentSettledCapacity = 64;

    private readonly TweenStore _store;
    private readonly ITweenClock _clock;
    private readonly TweenTelemetry _telemetry;
    private readonly Action<uint, uint, bool> _settledHook;
    private readonly Lock _awaitGate = new();
    private readonly Dictionary<TweenId, List<TaskCompletionSource<bool>>> _awaiters = new();
    private readonly Queue<(TweenId Id, bool Completed)> _recentlySettled = new();
    private float _timeScale = 1.0f;
    private int _state;
    private ExceptionDispatchInfo? _fault;
    private int _disposed;

    /// <summary>Creates an engine.</summary>
    /// <param name="capacity">Tween slots.</param>
    /// <param name="clock">Time source; wall clock by default.</param>
    /// <param name="meterName">OpenTelemetry meter name.</param>
    public TweenEngine(int capacity = 1024, ITweenClock? clock = null, string meterName = "Axrone.Tween")
    {
        _store = new TweenStore(capacity);
        _clock = clock ?? new StopwatchTweenClock();
        _telemetry = new TweenTelemetry(meterName);
        _settledHook = OnTweenSettled;
    }

    /// <summary>Global playback rate multiplier.</summary>
    public float TimeScale
    {
        get => Volatile.Read(ref _timeScale);
        set => Volatile.Write(ref _timeScale, value);
    }

    /// <summary>Live tweens.</summary>
    public int ActiveCount => _store.ActiveCount;

    /// <summary>
    /// Ceiling for a single pump step; larger deltas are clamped. Guards against stall
    /// jumps (a frozen frame must not fast-forward the choreography). Null disables.
    /// </summary>
    public DurationNs? MaxDelta { get; set; }

    /// <summary>
    /// Schedules a spec; false when full or not running (backpressure, not an error).
    /// A throwing start callback releases the slot and propagates — loud user bug, clean engine.
    /// </summary>
    public bool TryPlay(TweenSpec spec, out TweenHandle handle)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            handle = default;
            return false;
        }

        if (!_store.TryAllocate(out uint index))
        {
            handle = default;
            return false;
        }

        _store.Initialize(
            index,
            spec.Start,
            spec.End,
            spec.Duration,
            spec.Delay,
            spec.RepeatDelay,
            spec.Easing,
            spec.CustomEasing,
            spec.Mode,
            spec.LoopCount,
            spec.TimeScale,
            spec.ChannelCount,
            spec.OnUpdateFloat,
            spec.OnUpdateVector2,
            spec.OnUpdateVector3,
            spec.OnUpdateVector4,
            spec.OnStart,
            spec.OnComplete,
            spec.OnStepComplete,
            spec.OnKill);

        uint generation = _store.GenerationOf(index);
        handle = new TweenHandle(this, new TweenId(index, generation));
        _telemetry.RecordSubmitted();
        return true;
    }

    /// <summary>Schedules a spec, spinning while full. Throws once completed.</summary>
    public TweenHandle Play(TweenSpec spec)
    {
        ProgressiveSpinBackoff.Initialize(out int backoff);
        TweenHandle handle = default;
        while (!TryPlay(spec, out handle))
        {
            ThrowIfFaulted();
            if (Volatile.Read(ref _state) != StateRunning)
            {
                ThrowHelper.ThrowInvalidOperation("The tween engine has completed and no longer accepts schedules.");
            }

            ProgressiveSpinBackoff.Advance(ref backoff);
        }

        return handle;
    }

    /// <summary>Pumps one clock step.</summary>
    public void Update() => Update(_clock.Tick());

    /// <summary>Pumps an explicit delta (deterministic stepping).</summary>
    public void Update(DurationNs delta)
    {
        long start = Stopwatch.GetTimestamp();
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) == StateTerminated)
        {
            return;
        }

        if (MaxDelta.HasValue && delta > MaxDelta.Value)
        {
            delta = MaxDelta.Value;
        }

        int completed = _store.Update(delta, TimeScale, _settledHook);
        if (completed > 0)
        {
            _telemetry.RecordCompleted(completed);
        }

        _telemetry.RecordTick((Stopwatch.GetTimestamp() - start) * 1000d / Stopwatch.Frequency);
    }

    /// <summary>
    /// Awaits termination: true for natural completion, false for cancel/fault/unknown outcome.
    /// Awaiting an already-settled tween consults a bounded recent-settled record; older history
    /// reports false. Continuations never run on the tick thread.
    /// </summary>
    public Task<bool> AwaitAsync(TweenId id)
    {
        List<TaskCompletionSource<bool>>? list = null;
        lock (_awaitGate)
        {
            if (!_store.Validate(id))
            {
                foreach ((TweenId settledId, bool completed) in _recentlySettled)
                {
                    if (settledId.Equals(id))
                    {
                        return Task.FromResult(completed);
                    }
                }

                return Task.FromResult(false);
            }

            var source = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (!_awaiters.TryGetValue(id, out list))
            {
                list = new List<TaskCompletionSource<bool>>(1);
                _awaiters[id] = list;
            }

            list.Add(source);
            if (!_store.Validate(id))
            {
                _awaiters.Remove(id);
                foreach ((TweenId settledId, bool settled) in _recentlySettled)
                {
                    if (settledId.Equals(id))
                    {
                        return Task.FromResult(settled);
                    }
                }

                return Task.FromResult(false);
            }

            return source.Task;
        }
    }

    private void OnTweenSettled(uint index, uint generation, bool completed)
    {
        var id = new TweenId(index, generation);
        List<TaskCompletionSource<bool>>? list = null;
        lock (_awaitGate)
        {
            _recentlySettled.Enqueue((id, completed));
            while (_recentlySettled.Count > RecentSettledCapacity)
            {
                _recentlySettled.Dequeue();
            }

            if (_awaiters.Remove(id, out list))
            {
                for (int i = 0; i < list.Count; i++)
                {
                    list[i].SetResult(completed);
                }
            }
        }
    }

    /// <summary>
    /// Cancels a tween, firing its kill callback; false for stale identities. Pending awaiters
    /// complete false. A throwing kill callback still releases the slot and settles awaiters —
    /// the exception propagates but the engine never keeps the wreckage.
    /// </summary>
    public bool Cancel(TweenId id)
    {
        if (!_store.Validate(id))
        {
            return false;
        }

        // Claim before firing: the tick thread claims the same way, so completion and
        // cancel produce exactly one outcome. A lost claim means the tween just settled.
        Action? onKill = _store.OnKillOf((int)id.Index);
        if (!_store.TryRetire(id.Index))
        {
            return false;
        }

        try
        {
            onKill?.Invoke();
        }
        finally
        {
            _telemetry.RecordCanceled();

            lock (_awaitGate)
            {
                if (_awaiters.Remove(id, out List<TaskCompletionSource<bool>>? list))
                {
                    for (int i = 0; i < list.Count; i++)
                    {
                        list[i].SetResult(false);
                    }
                }
            }
        }

        return true;
    }

    /// <summary>
    /// Finishes a live tween immediately: fires the final update, step, and completion
    /// callbacks, then settles it. Paused tweens complete too. False for stale identities
    /// or tweens another settler already claimed.
    /// </summary>
    public bool Complete(TweenId id) => _store.TryComplete(id.Index, id.Generation, _settledHook);

    /// <summary>Pauses a playing tween.</summary>
    public bool Pause(TweenId id) =>
        _store.TryTransition(id.Index, id.Generation, TweenState.Playing, TweenState.Playing, TweenState.Paused, null);

    /// <summary>Resumes a paused tween.</summary>
    public bool Resume(TweenId id) =>
        _store.TryTransition(id.Index, id.Generation, TweenState.Paused, TweenState.Paused, TweenState.Playing, null);

    /// <summary>Queries tween state; stale identities report inactive.</summary>
    public TweenState QueryState(TweenId id)
    {
        if (!_store.Validate(id))
        {
            return TweenState.Inactive;
        }

        return _store.GetState((int)id.Index);
    }

    /// <summary>Restarts a live tween from zero and plays it. Completed tweens are freed;
    /// replay them by scheduling again.</summary>
    public bool Restart(TweenId id) =>
        _store.TryTransition(id.Index, id.Generation, TweenState.Playing, TweenState.Paused, TweenState.Playing, DurationNs.Zero);

    /// <summary>Moves the play head, preserving state; past-the-end finishes on the next tick.</summary>
    public bool Goto(TweenId id, DurationNs position) => _store.TrySeek(id.Index, id.Generation, position);

    /// <summary>Moves the play head to zero, preserving state.</summary>
    public bool Rewind(TweenId id) => Goto(id, DurationNs.Zero);

    /// <summary>Stops accepting schedules; in-flight tweens keep ticking until terminated.</summary>
    public void Complete(Exception? error = null)
    {
        if (error is not null)
        {
            _fault = ExceptionDispatchInfo.Capture(error);
            Volatile.Write(ref _state, StateFaulted);
            TweenEventSource.Log.FaultOccurred(error.GetType().Name, error.Message);
        }
        else
        {
            Interlocked.CompareExchange(ref _state, StateCompleting, StateRunning);
        }
    }

    /// <summary>Rethrows the terminal fault captured by <see cref="Complete(Exception?)"/>.</summary>
    public void ThrowIfFaulted() => _fault?.Throw();

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        _store.Dispose();
        _telemetry.Dispose();
    }
}
