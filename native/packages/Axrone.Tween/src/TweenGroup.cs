namespace Axrone.Tween;

/// <summary>
/// Membership over a shared <see cref="TweenEngine"/>: batch start, stop, pause and resume
/// over the members, with each member's spec retained so a retired one can be replayed.
/// </summary>
/// <remarks>
/// <para><b>The engine pumps, the group does not.</b> A group owns no clock and no store, so
/// <see cref="Start"/> never advances time; calling <see cref="TweenEngine.Update()"/> drives
/// every group attached to that engine. Driving per group would tick the same store once per
/// group.</para>
/// <para><b>Restartable members.</b> The engine frees a slot the moment a tween settles, so a
/// finished member is a stale identity rather than a parked object. The group keeps the
/// <see cref="TweenSpec"/> instead and re-schedules from it, which is what makes
/// <see cref="Start"/> meaningful after <see cref="Stop()"/>.</para>
/// <para><b>Pause bookkeeping.</b> <see cref="Pause()"/> records only the members that were
/// actually playing, so <see cref="Resume()"/> cannot un-pause a tween a caller paused
/// individually, and a pause/resume cycle twice in a row is idempotent.</para>
/// </remarks>
public sealed class TweenGroup : IDisposable
{
    private struct Entry
    {
        internal TweenSpec Spec;
        internal TweenId Live;
        internal bool HasLive;
        internal bool PausedByGroup;
    }

    private readonly TweenEngine _engine;
    private readonly Lock _gate = new();
    private Entry[] _entries;
    private int _count;

    /// <summary>Creates a group over one engine.</summary>
    /// <param name="engine">Engine that owns the members' slots.</param>
    /// <param name="capacity">Initial member capacity; the array grows by doubling.</param>
    /// <exception cref="ArgumentNullException"><paramref name="engine"/> is <see langword="null"/>.</exception>
    public TweenGroup(TweenEngine engine, int capacity = 8)
    {
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentOutOfRangeException.ThrowIfLessThan(capacity, 1);

        _engine = engine;
        _entries = new Entry[capacity];
    }

    /// <summary>Number of members, live or retired.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _count;
            }
        }
    }

    /// <summary>Schedules a tween and makes it a member, keeping its spec for replays.</summary>
    /// <param name="spec">The tween to schedule.</param>
    /// <returns>The handle of the newly scheduled tween.</returns>
    /// <exception cref="InvalidOperationException">The engine has no free slot for the spec.</exception>
    public TweenHandle Play(TweenSpec spec)
    {
        TweenHandle handle = _engine.Play(spec);
        lock (_gate)
        {
            GrowIfNeeded(_count);
            _entries[_count++] = new Entry { Spec = spec, Live = handle.Id, HasLive = true };
        }

        return handle;
    }

    /// <summary>Adds an already-scheduled tween to the group.</summary>
    /// <param name="handle">Handle produced by this group's engine.</param>
    /// <returns><see langword="true"/> when the tween joined; <see langword="false"/> when the
    /// handle belongs to another engine, names no live slot, or is already a member.</returns>
    public bool Add(TweenHandle handle)
    {
        if (!handle.IsValid || !handle.OwnedBy(_engine) || _engine.QueryState(handle.Id) == TweenState.Inactive)
        {
            return false;
        }

        lock (_gate)
        {
            int found = IndexOfLive(handle.Id);
            if (found >= 0)
            {
                return false;
            }

            GrowIfNeeded(_count);
            _entries[_count++] = new Entry { Live = handle.Id, HasLive = true };
        }

        return true;
    }

    /// <summary>Drops a member without touching its tween.</summary>
    /// <param name="id">Member identity.</param>
    /// <returns><see langword="true"/> when a member was removed.</returns>
    public bool Remove(TweenId id)
    {
        lock (_gate)
        {
            int found = IndexOfAny(id);
            if (found < 0)
            {
                return false;
            }

            _entries[found] = _entries[--_count];
            _entries[_count] = default;
            return true;
        }
    }

    /// <summary>Reports whether an identity is a member, live or retired.</summary>
    /// <param name="id">Identity to look up.</param>
    /// <returns><see langword="true"/> when the group holds the identity.</returns>
    public bool Contains(TweenId id)
    {
        lock (_gate)
        {
            return IndexOfAny(id) >= 0;
        }
    }

    /// <summary>
    /// Plays every member from <paramref name="position"/>: live tweens are seeked and resumed,
    /// retired ones are re-scheduled from the stored spec.
    /// </summary>
    /// <param name="position">Play head to place members at; the start of the tween by default.</param>
    /// <returns>This group.</returns>
    public TweenGroup Start(DurationNs? position = null)
    {
        DurationNs target = position ?? DurationNs.Zero;
        lock (_gate)
        {
            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                if (entry.HasLive && _engine.QueryState(entry.Live) != TweenState.Inactive)
                {
                    _engine.Goto(entry.Live, target);
                    _engine.Resume(entry.Live);
                }
                else
                {
                    entry.Live = _engine.Play(entry.Spec).Id;
                    entry.HasLive = true;
                }

                entry.PausedByGroup = false;
            }
        }

        return this;
    }

    /// <summary>Cancels every live member and clears pause bookkeeping, keeping membership.</summary>
    /// <returns>This group.</returns>
    public TweenGroup Stop()
    {
        lock (_gate)
        {
            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                if (entry.HasLive)
                {
                    _engine.Cancel(entry.Live);
                    entry.HasLive = false;
                }

                entry.PausedByGroup = false;
            }
        }

        return this;
    }

    /// <summary>Pauses the members that are playing and records exactly those for the next resume.</summary>
    /// <returns>This group.</returns>
    public TweenGroup Pause()
    {
        lock (_gate)
        {
            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                if (entry.HasLive && _engine.Pause(entry.Live))
                {
                    entry.PausedByGroup = true;
                }
            }
        }

        return this;
    }

    /// <summary>Resumes only the members this group paused, then clears the record.</summary>
    /// <returns>This group.</returns>
    public TweenGroup Resume()
    {
        lock (_gate)
        {
            for (int i = 0; i < _count; i++)
            {
                ref Entry entry = ref _entries[i];
                if (entry.PausedByGroup)
                {
                    entry.PausedByGroup = false;
                    if (entry.HasLive)
                    {
                        _engine.Resume(entry.Live);
                    }
                }
            }
        }

        return this;
    }

    /// <summary>Drops every member without touching their tweens.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            Array.Clear(_entries, 0, _count);
            _count = 0;
        }
    }

    /// <summary>Cancels every live member and drops the membership.</summary>
    public void Dispose()
    {
        Stop();
        Clear();
    }

    private void GrowIfNeeded(int needed)
    {
        if (needed < _entries.Length)
        {
            return;
        }

        long expanded = (long)_entries.Length * 2;
        Array.Resize(ref _entries, expanded > int.MaxValue ? int.MaxValue : (int)expanded);
    }

    private int IndexOfLive(TweenId id)
    {
        for (int i = 0; i < _count; i++)
        {
            if (_entries[i].HasLive && _entries[i].Live.Equals(id))
            {
                return i;
            }
        }

        return -1;
    }

    private int IndexOfAny(TweenId id)
    {
        for (int i = 0; i < _count; i++)
        {
            if (_entries[i].Live.Equals(id))
            {
                return i;
            }
        }

        return -1;
    }
}
