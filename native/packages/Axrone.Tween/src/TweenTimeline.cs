namespace Axrone.Tween;

/// <summary>
/// Absolute-time choreography over engine tweens: entries placed at fixed positions,
/// launched as the virtual playhead passes, rewindable by scrubbing.
/// </summary>
/// <remarks>
/// The timeline never pumps the engine — one pump thread stays yours; call
/// <see cref="Update"/> then pump the engine with the same delta. Each entry keeps its
/// own spec, so infinite members block completion exactly like an endless final act.
/// The timeline rate is stamped onto launched entries (multiplied with their own rate),
/// so members truly play at timeline speed. Scrubbing is kill-plus-replay, not time
/// travel for side effects: jumping past a live entry kills it (its kill callback
/// fires), jumping back replays finished entries from the scrub offset. Entry completion
/// callbacks fire only on natural completion.
/// </remarks>
public sealed class TweenTimeline
{
    private struct Entry
    {
        public TweenSpec Spec;
        public DurationNs Start;
        public DurationNs End;
        public TweenHandle Handle;
        public bool Launched;
        public bool Finished;
    }

    private readonly TweenEngine _engine;
    private readonly Lock _gate = new();
    private Entry[] _entries;
    private int _count;
    private DurationNs _clock;
    private bool _playing;
    private bool _paused;
    private bool _completed;
    private float _timeScale = 1.0f;
    private Action? _onComplete;
    private Action<DurationNs>? _onUpdate;

    /// <summary>Creates a timeline.</summary>
    public TweenTimeline(TweenEngine engine, int initialCapacity = 8)
    {
        ArgumentNullException.ThrowIfNull(engine);
        _engine = engine;
        _entries = new Entry[Math.Max(initialCapacity, 4)];
    }

    /// <summary>Places a spec at an absolute position.</summary>
    public TweenTimeline Add(TweenSpec spec, DurationNs at)
    {
        if (at.Value < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(at));
        }

        lock (_gate)
        {
            Grow();
            DurationNs end = spec.TotalDuration is DurationNs total ? at + total : new DurationNs(long.MaxValue);
            _entries[_count++] = new Entry { Spec = spec, Start = at, End = end };
            return this;
        }
    }

    /// <summary>Places a spec after the current end plus an offset.</summary>
    public TweenTimeline Append(TweenSpec spec, DurationNs offset = default)
    {
        if (offset.Value < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(offset));
        }

        lock (_gate)
        {
            Grow();
            DurationNs at = EndLocked() + offset;
            DurationNs end = spec.TotalDuration is DurationNs total ? at + total : new DurationNs(long.MaxValue);
            _entries[_count++] = new Entry { Spec = spec, Start = at, End = end };
            SortLocked();
            return this;
        }
    }

    /// <summary>End of the last entry; zero when empty. Infinite members push it to maximum.</summary>
    public DurationNs Duration
    {
        get
        {
            lock (_gate)
            {
                return EndLocked();
            }
        }
    }

    private DurationNs EndLocked()
    {
        DurationNs end = DurationNs.Zero;
        for (int i = 0; i < _count; i++)
        {
            if (_entries[i].End > end)
            {
                end = _entries[i].End;
            }
        }

        return end;
    }

    /// <summary>Whether playback is active (running or paused).</summary>
    public bool IsPlaying
    {
        get
        {
            lock (_gate)
            {
                return _playing;
            }
        }
    }

    /// <summary>Whether playback is paused.</summary>
    public bool IsPaused
    {
        get
        {
            lock (_gate)
            {
                return _paused;
            }
        }
    }

    /// <summary>Virtual playhead position.</summary>
    public DurationNs Position
    {
        get
        {
            lock (_gate)
            {
                return _clock;
            }
        }
    }

    /// <summary>Playback rate multiplier; must be positive.</summary>
    public float TimeScale
    {
        get => Volatile.Read(ref _timeScale);
        set
        {
            if (value <= 0.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(value));
            }

            Volatile.Write(ref _timeScale, value);
        }
    }

    /// <summary>Pauses the virtual clock and every live member tween.</summary>
    public void Pause()
    {
        TweenHandle[] running;
        lock (_gate)
        {
            if (!_playing || _paused)
            {
                return;
            }

            _paused = true;
            running = CollectLiveLocked();
        }

        for (int i = 0; i < running.Length; i++)
        {
            _ = running[i].Pause();
        }
    }

    /// <summary>Resumes the virtual clock and every paused member tween.</summary>
    public void Resume()
    {
        TweenHandle[] running;
        lock (_gate)
        {
            if (!_playing || !_paused)
            {
                return;
            }

            _paused = false;
            running = CollectLiveLocked();
        }

        for (int i = 0; i < running.Length; i++)
        {
            _ = running[i].Resume();
        }
    }

    /// <summary>Fires when the playhead passes the end with every entry settled.</summary>
    public TweenTimeline OnComplete(Action callback)
    {
        lock (_gate)
        {
            _onComplete = callback;
            return this;
        }
    }

    /// <summary>Fires per update with the playhead position.</summary>
    public TweenTimeline OnUpdate(Action<DurationNs> callback)
    {
        lock (_gate)
        {
            _onUpdate = callback;
            return this;
        }
    }

    /// <summary>Starts playback from the current playhead.</summary>
    public void Play()
    {
        lock (_gate)
        {
            _playing = true;
            _paused = false;
            _completed = false;
        }

        Update(DurationNs.Zero);
    }

    /// <summary>Stops playback and kills launched entries.</summary>
    public void Cancel()
    {
        TweenHandle[] running;
        lock (_gate)
        {
            _playing = false;
            _paused = false;
            running = CollectLiveLocked();
        }

        for (int i = 0; i < running.Length; i++)
        {
            running[i].Cancel();
        }
    }

    /// <summary>
    /// Advances the virtual clock, launching due entries and settling finished ones. Pump
    /// the engine separately with the same delta.
    /// </summary>
    public void Update(DurationNs delta)
    {
        Action<DurationNs>? tick = null;
        Action? done = null;
        DurationNs position = DurationNs.Zero;

        lock (_gate)
        {
            if (!_playing || _paused || _completed)
            {
                return;
            }

            _clock = new DurationNs(unchecked(_clock.Value + (long)(delta.Value * _timeScale)));
            position = _clock;
            tick = _onUpdate;

            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                if (entry.Finished)
                {
                    continue;
                }

                if (!entry.Launched && entry.Start <= _clock)
                {
                    TryLaunchLocked(ref entry);
                    continue;
                }

                if (entry.Launched && entry.Handle.State == TweenState.Inactive)
                {
                    entry.Finished = true;
                }
            }

            if (_clock >= EndLocked() && AllFinishedLocked())
            {
                _completed = true;
                _playing = false;
                done = _onComplete;
            }
        }

        tick?.Invoke(position);
        done?.Invoke();
    }

    /// <summary>
    /// Jumps the playhead: live entries past the target are killed, entries covering the
    /// target replay from its offset, future entries reset. Never fires timeline completion.
    /// </summary>
    public void Scrub(DurationNs position)
    {
        if (position.Value < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(position));
        }

        TweenHandle[] doomed;
        (int Index, DurationNs Offset)[] replays;
        lock (_gate)
        {
            _clock = position;
            _completed = false;
            var kills = new List<TweenHandle>();
            var plays = new List<(int, DurationNs)>();
            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                bool live = entry.Launched && entry.Handle.State != TweenState.Inactive;
                if (entry.End <= position)
                {
                    if (live)
                    {
                        kills.Add(entry.Handle);
                    }

                    entry.Launched = true;
                    entry.Finished = true;
                }
                else if (entry.Start <= position)
                {
                    DurationNs offset = position - entry.Start;
                    if (live)
                    {
                        entry.Handle.Goto(offset);
                    }
                    else
                    {
                        plays.Add((i, offset));
                        entry.Finished = false;
                    }

                    entry.Launched = true;
                }
                else
                {
                    if (live)
                    {
                        kills.Add(entry.Handle);
                    }

                    entry.Launched = false;
                    entry.Finished = false;
                }
            }

            doomed = kills.ToArray();
            replays = plays.ToArray();
        }

        for (int i = 0; i < doomed.Length; i++)
        {
            doomed[i].Cancel();
        }

        lock (_gate)
        {
            for (int i = 0; i < replays.Length; i++)
            {
                ref Entry entry = ref _entries[replays[i].Index];
                if (entry.Finished || entry.Handle.State != TweenState.Inactive)
                {
                    continue;
                }

                if (TryLaunchLocked(ref entry))
                {
                    entry.Handle.Goto(replays[i].Offset);
                }
            }
        }
    }

    /// <summary>Requires the gate. Launches with the timeline rate stamped onto the spec.</summary>
    private bool TryLaunchLocked(ref Entry entry)
    {
        TweenSpec scaled = entry.Spec with { TimeScale = entry.Spec.TimeScale * _timeScale };
        if (_engine.TryPlay(scaled, out TweenHandle handle))
        {
            entry.Handle = handle;
            entry.Launched = true;
            return true;
        }

        return false;
    }

    private TweenHandle[] CollectLiveLocked()
    {
        var live = new List<TweenHandle>();
        for (int i = 0; i < _count; i++)
        {
            if (_entries[i].Launched && _entries[i].Handle.State != TweenState.Inactive)
            {
                live.Add(_entries[i].Handle);
            }
        }

        return live.ToArray();
    }

    private bool AllFinishedLocked()
    {
        for (int i = 0; i < _count; i++)
        {
            if (!_entries[i].Finished)
            {
                return false;
            }
        }

        return true;
    }

    private void Grow()
    {
        if (_count == _entries.Length)
        {
            Array.Resize(ref _entries, _entries.Length * 2);
        }
    }

    private void SortLocked()
    {
        Array.Sort(_entries, 0, _count, Comparer<Entry>.Create(static (a, b) => a.Start.CompareTo(b.Start)));
    }
}
