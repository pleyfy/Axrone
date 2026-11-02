namespace Axrone.Tween;

using System.Runtime.Intrinsics;

/// <summary>
/// Struct-of-arrays tween storage with dense iteration and lock-free slot allocation.
/// </summary>
/// <remarks>
/// <para>Numeric lanes live in plain managed arrays — no pinning (indexing needs none; pinning
/// twenty arrays would fragment the heap for zero gain).</para>
/// <para>Concurrency: slot allocation is a lock-free freelist pop; dense bookkeeping serializes
/// on a lock taken only by allocate/free (cold paths). The tick loop reads lock-free — a
/// concurrent mutation may hide a newborn tween for one tick or step a shifted one twice;
/// both self-correct on the next tick. Allocate-then-activate (fields, fence, then Playing)
/// keeps partially built slots invisible: the tick skips anything not Playing or Paused.</para>
/// </remarks>
public sealed class TweenStore : IDisposable
{

    private readonly Vector128<float>[] _starts;
    private readonly Vector128<float>[] _ends;
    private readonly Vector128<float>[] _currents;
    private readonly DurationNs[] _durations;
    private readonly DurationNs[] _delays;
    private readonly DurationNs[] _repeatDelays;
    private readonly DurationNs[] _elapsed;
    private readonly float[] _timeScales;
    private readonly uint[] _generations;
    private readonly byte[] _states;
    private readonly EasingKind[] _easings;
    private readonly Func<float, float>?[] _customEasings;
    private readonly PlaybackMode[] _modes;
    private readonly int[] _loopCounts;
    private readonly int[] _remainingLoops;
    private readonly byte[] _channels;
    private readonly Action<float>?[] _updateFloats;
    private readonly Action<Vec2>?[] _updateVector2s;
    private readonly Action<Vec3>?[] _updateVector3s;
    private readonly Action<Vec4>?[] _updateVector4s;
    private readonly Action?[] _onStarts;
    private readonly Action?[] _onCompletes;
    private readonly Action?[] _onSteps;
    private readonly Action?[] _onKills;

    private readonly int[] _dense;
    private readonly int[] _sparse;
    private int _activeCount;

    private readonly int[] _nextFree;
    private int _freeHead;
    private readonly Lock _gate = new();
    private int _disposed;

    /// <summary>Slot capacity.</summary>
    public int Capacity { get; }

    /// <summary>Creates storage.</summary>
    public TweenStore(int capacity = 1024)
    {
        if (capacity <= 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(capacity));
        }

        Capacity = capacity;
        _starts = new Vector128<float>[capacity];
        _ends = new Vector128<float>[capacity];
        _currents = new Vector128<float>[capacity];
        _durations = new DurationNs[capacity];
        _delays = new DurationNs[capacity];
        _repeatDelays = new DurationNs[capacity];
        _elapsed = new DurationNs[capacity];
        _timeScales = new float[capacity];
        _generations = new uint[capacity];
        _states = new byte[capacity];
        _easings = new EasingKind[capacity];
        _customEasings = new Func<float, float>?[capacity];
        _modes = new PlaybackMode[capacity];
        _loopCounts = new int[capacity];
        _remainingLoops = new int[capacity];
        _channels = new byte[capacity];
        _updateFloats = new Action<float>?[capacity];
        _updateVector2s = new Action<Vec2>?[capacity];
        _updateVector3s = new Action<Vec3>?[capacity];
        _updateVector4s = new Action<Vec4>?[capacity];
        _onStarts = new Action?[capacity];
        _onCompletes = new Action?[capacity];
        _onSteps = new Action?[capacity];
        _onKills = new Action?[capacity];
        _dense = new int[capacity];
        _sparse = new int[capacity];
        _nextFree = new int[capacity];

        for (int i = 0; i < capacity; i++)
        {
            _nextFree[i] = i + 1;
            _generations[i] = 1;
            _timeScales[i] = 1.0f;
        }

        _nextFree[capacity - 1] = -1;
    }

    /// <summary>Live tweens.</summary>
    public int ActiveCount => Volatile.Read(ref _activeCount);

    /// <summary>Dense slot at the position (tick iteration).</summary>
    public int GetDense(int index) => _dense[index];

    /// <summary>Validates an identity against the live generation.</summary>
    public bool Validate(TweenId id) =>
        id.Index < (uint)Capacity && Volatile.Read(ref _generations[id.Index]) == id.Generation;

    /// <summary>Pops a free slot; false when exhausted.</summary>
    public bool TryAllocate(out uint index)
    {
        while (true)
        {
            int head = Volatile.Read(ref _freeHead);
            if (head < 0)
            {
                index = 0;
                return false;
            }

            if (Interlocked.CompareExchange(ref _freeHead, _nextFree[head], head) == head)
            {
                index = (uint)head;
                return true;
            }
        }
    }

    /// <summary>Writes all lanes, then publishes Playing with a fence.</summary>
    public void Initialize(
        uint index,
        Vector128<float> start,
        Vector128<float> end,
        DurationNs duration,
        DurationNs delay,
        DurationNs repeatDelay,
        EasingKind easing,
        Func<float, float>? customEasing,
        PlaybackMode mode,
        int loopCount,
        float timeScale,
        byte channels,
        Action<float>? onUpdateFloat,
        Action<Vec2>? onUpdateVector2,
        Action<Vec3>? onUpdateVector3,
        Action<Vec4>? onUpdateVector4,
        Action? onStart,
        Action? onComplete,
        Action? onStepComplete,
        Action? onKill)
    {
        int i = (int)index;
        _starts[i] = start;
        _ends[i] = end;
        _currents[i] = start;
        _durations[i] = duration;
        _delays[i] = delay;
        _repeatDelays[i] = repeatDelay;
        _elapsed[i] = DurationNs.Zero;
        _timeScales[i] = timeScale;
        _easings[i] = easing;
        _customEasings[i] = customEasing;
        _modes[i] = mode;
        _loopCounts[i] = loopCount;
        _remainingLoops[i] = loopCount;
        _channels[i] = channels;
        _updateFloats[i] = onUpdateFloat;
        _updateVector2s[i] = onUpdateVector2;
        _updateVector3s[i] = onUpdateVector3;
        _updateVector4s[i] = onUpdateVector4;
        _onStarts[i] = onStart;
        _onCompletes[i] = onComplete;
        _onSteps[i] = onStepComplete;
        _onKills[i] = onKill;

        lock (_gate)
        {
            int denseIndex = _activeCount++;
            _dense[denseIndex] = i;
            _sparse[i] = denseIndex;
        }

        SetState(i, TweenState.Playing);
        try
        {
            _onStarts[i]?.Invoke();
        }
        catch (Exception)
        {
            // A throwing start callback must not orphan the slot in the dense set:
            // release it, then let the user exception propagate with its stack intact.
            Free((uint)i);
            throw;
        }
    }

    private int _ticking;

    /// <summary>
    /// Advances all live tweens by the delta; returns completions. A throwing callback faults
    /// only its own tween (retired, tick continues) — engine availability never depends on
    /// user code. The optional hook observes every settle with its outcome before release.
    /// </summary>
    /// <remarks>
    /// Single-pump only: concurrent or reentrant <see cref="Update"/> calls throw instead of
    /// tearing the dense iteration. Drive all ticks from one thread.
    /// </remarks>
    public int Update(DurationNs delta, float globalTimeScale, Action<uint, uint, bool>? settled = null)
    {
        if (Interlocked.Exchange(ref _ticking, 1) != 0)
        {
            ThrowHelper.ThrowInvalidOperation("TweenStore.Update is single-pump: concurrent or reentrant ticks are not allowed.");
        }

        try
        {
            return UpdateCore(delta, globalTimeScale, settled);
        }
        finally
        {
            Volatile.Write(ref _ticking, 0);
        }
    }

    private int UpdateCore(DurationNs delta, float globalTimeScale, Action<uint, uint, bool>? settled)
    {
        int completed = 0;
        int count = ActiveCount;
        for (int d = 0; d < count; d++)
        {
            int slot = _dense[d];
            if (GetState(slot) != TweenState.Playing)
            {
                continue;
            }

            try
            {
                if (TickSlot(slot, delta, globalTimeScale))
                {
                    // Read everything the settlement needs before claiming: the claim
                    // releases the callbacks. A lost claim means an external cancel won
                    // the race and already settled this tween — report nothing more.
                    uint generation = GenerationOf((uint)slot);
                    Action? onComplete = OnCompleteOf(slot);
                    if (!TryRetire((uint)slot))
                    {
                        continue;
                    }

                    try
                    {
                        onComplete?.Invoke();
                    }
                    catch (Exception)
                    {
                        settled?.Invoke((uint)slot, generation, false);
                        continue;
                    }

                    settled?.Invoke((uint)slot, generation, true);
                    completed++;
                }
            }
            catch (Exception)
            {
                uint generation = GenerationOf((uint)slot);
                if (TryRetire((uint)slot))
                {
                    settled?.Invoke((uint)slot, generation, false);
                }
            }
        }

        return completed;
    }

    private bool TickSlot(int slot, DurationNs delta, float globalTimeScale)
    {
        long effectiveDelta = (long)(delta.Value * globalTimeScale * _timeScales[slot]);
        long elapsed = _elapsed[slot].Value + effectiveDelta;
        long delay = _delays[slot].Value;
        if (elapsed < delay)
        {
            _elapsed[slot] = new DurationNs(elapsed);
            return false;
        }

        long duration = _durations[slot].Value;
        long active = elapsed - delay;
        float t = duration > 0 ? Math.Clamp((float)active / duration, 0.0f, 1.0f) : 1.0f;

        float factor = _easings[slot] == EasingKind.Custom
            ? _customEasings[slot]!(t)
            : EasingEvaluator.Evaluate(_easings[slot], t);

        Vector128<float> current = Vector128.Add(
            _starts[slot],
            Vector128.Multiply(Vector128.Subtract(_ends[slot], _starts[slot]), Vector128.Create(factor)));
        _currents[slot] = current;

        switch (_channels[slot])
        {
            case 1:
                OnUpdateFloatOf(slot)?.Invoke(current.GetElement(0));
                break;
            case 2:
                OnUpdateVector2Of(slot)?.Invoke(new Vec2(current.GetElement(0), current.GetElement(1)));
                break;
            case 3:
                OnUpdateVector3Of(slot)?.Invoke(new Vec3(current.GetElement(0), current.GetElement(1), current.GetElement(2)));
                break;
            default:
                OnUpdateVector4Of(slot)?.Invoke((Vec4)current);
                break;
        }

        if (active < duration)
        {
            _elapsed[slot] = new DurationNs(elapsed);
            return false;
        }

        int remaining = _remainingLoops[slot];
        if (remaining > 1 || remaining < 0)
        {
            if (remaining > 1)
            {
                _remainingLoops[slot] = remaining - 1;
            }

            // Rewind behind the delay line by the repeat gap: the next playthrough
            // waits out the gap before producing values again. Zero gap replays
            // back-to-back exactly as before.
            _elapsed[slot] = new DurationNs(delay - _repeatDelays[slot].Value);
            if (_modes[slot] == PlaybackMode.PingPong)
            {
                SwapEnds(slot);
            }

            OnStepCompleteOf(slot)?.Invoke();
            return false;
        }

        // Final playthrough: step fires here too, then completion follows upstream.
        OnStepCompleteOf(slot)?.Invoke();
        return true;
    }

    /// <summary>
    /// Retires a live slot: invisible first, then unlinked, callbacks released. Playing, paused,
    /// and faulted slots retire — the final state is unobservable after the generation bump, so
    /// it is not stored and repeat frees are safe no-ops.
    /// </summary>
    public void Free(uint index) => TryRetire(index);

    /// <summary>
    /// Claims a live slot for settlement: the state check and dense unlink happen under one
    /// gate, so racing settlers (tick completion versus external cancel) produce exactly one
    /// winner. Generation bump and callback release follow the claim. Returns false when
    /// another settler already claimed the slot.
    /// </summary>
    internal bool TryRetire(uint index)
    {
        int i = (int)index;
        lock (_gate)
        {
            if (!TryRetireLocked(i))
            {
                return false;
            }
        }

        FinishRetire(i);
        return true;
    }

    /// <summary>Requires the gate: hides the slot and unlinks it from dense iteration.</summary>
    private bool TryRetireLocked(int i)
    {
        TweenState observed = GetState(i);
        if (observed != TweenState.Playing && observed != TweenState.Paused && observed != TweenState.Faulted)
        {
            return false;
        }

        SetState(i, TweenState.Inactive);

        int denseIndex = _sparse[i];
        int last = _dense[_activeCount - 1];
        _dense[denseIndex] = last;
        _sparse[last] = denseIndex;
        _activeCount--;
        return true;
    }

    /// <summary>Releases callbacks and recycles the slot once the claim is visible.</summary>
    private void FinishRetire(int i)
    {
        uint generation = _generations[i] + 1;
        _generations[i] = generation == 0 ? 1 : generation;

        _updateFloats[i] = null;
        _updateVector2s[i] = null;
        _updateVector3s[i] = null;
        _updateVector4s[i] = null;
        _onStarts[i] = null;
        _onCompletes[i] = null;
        _onSteps[i] = null;
        _onKills[i] = null;
        _customEasings[i] = null;

        while (true)
        {
            int head = Volatile.Read(ref _freeHead);
            _nextFree[i] = head;
            if (Interlocked.CompareExchange(ref _freeHead, i, head) == head)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Moves the play head without touching state, only when the slot is live, holds the
    /// expected generation, and is playing or paused — all checked under the gate.
    /// </summary>
    internal bool TrySeek(uint index, uint generation, DurationNs position)
    {
        int i = (int)index;
        lock (_gate)
        {
            if (Volatile.Read(ref _generations[i]) != generation)
            {
                return false;
            }

            TweenState observed = GetState(i);
            if (observed != TweenState.Playing && observed != TweenState.Paused)
            {
                return false;
            }

            _elapsed[i] = position;
            return true;
        }
    }

    /// <summary>
    /// Finishes a live tween immediately: emits the final update, the step callback, and the
    /// completion callback, then settles it. Paused tweens complete too, matching a forced
    /// end rather than a tick. False when another settler won or the identity is stale.
    /// </summary>
    internal bool TryComplete(uint index, uint generation, Action<uint, uint, bool>? settled)
    {
        int i = (int)index;
        Vector128<float> start;
        Vector128<float> end;
        EasingKind easing;
        Func<float, float>? customEasing;
        int channels;
        Action<float>? updateFloat;
        Action<Vec2>? updateVector2;
        Action<Vec3>? updateVector3;
        Action<Vec4>? updateVector4;
        Action? onStep;
        Action? onComplete;

        lock (_gate)
        {
            if (Volatile.Read(ref _generations[i]) != generation)
            {
                return false;
            }

            TweenState observed = GetState(i);
            if (observed != TweenState.Playing && observed != TweenState.Paused)
            {
                return false;
            }

            start = _starts[i];
            end = _ends[i];
            easing = _easings[i];
            customEasing = _customEasings[i];
            channels = _channels[i];
            updateFloat = _updateFloats[i];
            updateVector2 = _updateVector2s[i];
            updateVector3 = _updateVector3s[i];
            updateVector4 = _updateVector4s[i];
            onStep = _onSteps[i];
            onComplete = _onCompletes[i];

            if (!TryRetireLocked(i))
            {
                return false;
            }
        }

        FinishRetire(i);

        try
        {
            float factor = easing == EasingKind.Custom
                ? customEasing!(1.0f)
                : EasingEvaluator.Evaluate(easing, 1.0f);
            Vector128<float> current = Vector128.Add(
                start,
                Vector128.Multiply(Vector128.Subtract(end, start), Vector128.Create(factor)));

            switch (channels)
            {
                case 1:
                    updateFloat?.Invoke(current.GetElement(0));
                    break;
                case 2:
                    updateVector2?.Invoke(new Vec2(current.GetElement(0), current.GetElement(1)));
                    break;
                case 3:
                    updateVector3?.Invoke(new Vec3(current.GetElement(0), current.GetElement(1), current.GetElement(2)));
                    break;
                default:
                    updateVector4?.Invoke((Vec4)current);
                    break;
            }

            onStep?.Invoke();
            onComplete?.Invoke();
        }
        catch (Exception)
        {
            settled?.Invoke((uint)i, generation, false);
            return true;
        }

        settled?.Invoke((uint)i, generation, true);
        return true;
    }

    /// <summary>
    /// Applies a lifecycle transition only when the slot is live, holds the expected
    /// generation, and sits in one of the accepted states — all checked under the gate, so a
    /// racing settlement cannot resurrect a retired slot. Optionally resets the play head.
    /// </summary>
    internal bool TryTransition(
        uint index,
        uint generation,
        TweenState fromA,
        TweenState fromB,
        TweenState to,
        DurationNs? elapsedOverride)
    {
        int i = (int)index;
        lock (_gate)
        {
            if (Volatile.Read(ref _generations[i]) != generation)
            {
                return false;
            }

            TweenState observed = GetState(i);
            if (observed != fromA && observed != fromB)
            {
                return false;
            }

            if (elapsedOverride.HasValue)
            {
                _elapsed[i] = elapsedOverride.Value;
            }

            SetState(i, to);
            return true;
        }
    }

    /// <summary>Reads a state cell.</summary>
    public TweenState GetState(int index) => (TweenState)Volatile.Read(ref _states[index]);

    /// <summary>Writes a state cell.</summary>
    public void SetState(int index, TweenState state) => Volatile.Write(ref _states[index], (byte)state);

    internal Vector128<float> StartOf(int index) => _starts[index];
    internal Vector128<float> EndOf(int index) => _ends[index];
    internal void CurrentOf(int index, Vector128<float> value) => _currents[index] = value;
    internal DurationNs DurationOf(int index) => _durations[index];
    internal DurationNs DelayOf(int index) => _delays[index];
    internal DurationNs ElapsedOf(int index) => _elapsed[index];
    internal void ElapsedOf(int index, DurationNs value) => _elapsed[index] = value;
    internal float TimeScaleOf(int index) => _timeScales[index];
    internal EasingKind EasingOf(int index) => _easings[index];
    internal Func<float, float>? CustomEasingOf(int index) => _customEasings[index];
    internal PlaybackMode ModeOf(int index) => _modes[index];
    internal int RemainingLoopsOf(int index) => _remainingLoops[index];
    internal void RemainingLoopsOf(int index, int value) => _remainingLoops[index] = value;
    internal byte ChannelsOf(int index) => _channels[index];
    internal uint GenerationOf(uint index) => Volatile.Read(ref _generations[index]);
    internal Action<float>? OnUpdateFloatOf(int index) => _updateFloats[index];
    internal Action<Vec2>? OnUpdateVector2Of(int index) => _updateVector2s[index];
    internal Action<Vec3>? OnUpdateVector3Of(int index) => _updateVector3s[index];
    internal Action<Vec4>? OnUpdateVector4Of(int index) => _updateVector4s[index];
    internal Action? OnCompleteOf(int index) => _onCompletes[index];
    internal Action? OnStepCompleteOf(int index) => _onSteps[index];
    internal Action? OnKillOf(int index) => _onKills[index];
    internal void SwapEnds(int index)
    {
        Vector128<float> temp = _starts[index];
        _starts[index] = _ends[index];
        _ends[index] = temp;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            Array.Clear(_updateFloats);
            Array.Clear(_updateVector2s);
            Array.Clear(_updateVector3s);
            Array.Clear(_updateVector4s);
            Array.Clear(_onStarts);
            Array.Clear(_onCompletes);
            Array.Clear(_onSteps);
            Array.Clear(_onKills);
            Array.Clear(_customEasings);
        }
    }
}
