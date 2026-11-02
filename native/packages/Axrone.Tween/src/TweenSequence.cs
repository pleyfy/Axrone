namespace Axrone.Tween;

/// <summary>
/// Ordered tween choreography: append runs after the previous group, join runs beside it,
/// intervals wait, callbacks fire inline. Groups advance iteratively — callback chains never
/// recurse — and user callbacks never run under the structural lock, so cancelling from
/// inside a callback cannot deadlock.
/// </summary>
public sealed class TweenSequence
{
    private struct Node
    {
        public TweenSpec Spec;
        public Action? Callback;
        public DurationNs Interval;
        public bool IsJoin;
        public bool IsCallback;
        public bool IsInterval;
    }

    private readonly TweenEngine _engine;
    private readonly Lock _gate = new();
    private Node[] _nodes;
    private int _count;
    private int _cursor;
    private int _remaining;
    private readonly List<TweenHandle> _active = new();
    private bool _playing;
    private bool _paused;
    private bool _canceled;
    private bool _completed;
    private Action? _onComplete;

    /// <summary>Creates a sequence.</summary>
    public TweenSequence(TweenEngine engine, int initialCapacity = 8)
    {
        _engine = engine;
        _nodes = new Node[Math.Max(initialCapacity, 4)];
    }

    /// <summary>Runs after the previous group finishes.</summary>
    public TweenSequence Append(TweenSpec spec)
    {
        lock (_gate)
        {
            Grow();
            _nodes[_count++] = new Node { Spec = spec };
            return this;
        }
    }

    /// <summary>Runs beside the current group.</summary>
    public TweenSequence Join(TweenSpec spec)
    {
        lock (_gate)
        {
            Grow();
            _nodes[_count++] = new Node { Spec = spec, IsJoin = true };
            return this;
        }
    }

    /// <summary>Waits before the next group.</summary>
    public TweenSequence AppendInterval(DurationNs interval)
    {
        lock (_gate)
        {
            Grow();
            _nodes[_count++] = new Node { Interval = interval, IsInterval = true };
            return this;
        }
    }

    /// <summary>Fires inline between groups.</summary>
    public TweenSequence AppendCallback(Action callback)
    {
        lock (_gate)
        {
            Grow();
            _nodes[_count++] = new Node { Callback = callback, IsCallback = true };
            return this;
        }
    }

    /// <summary>Fires when the sequence finishes.</summary>
    public TweenSequence OnComplete(Action callback)
    {
        lock (_gate)
        {
            _onComplete = callback;
            return this;
        }
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

    /// <summary>Starts playback from the first group. Replays are ignored once started.</summary>
    public void Play()
    {
        lock (_gate)
        {
            if (_playing)
            {
                return;
            }

            _playing = true;
            _paused = false;
        }

        Advance();
    }

    /// <summary>Pauses the running group so it can be resumed where it stopped.</summary>
    public void Pause()
    {
        TweenHandle[] running;
        lock (_gate)
        {
            if (!_playing || _paused || _completed || _canceled)
            {
                return;
            }

            _paused = true;
            running = _active.ToArray();
        }

        for (int i = 0; i < running.Length; i++)
        {
            _ = running[i].Pause();
        }
    }

    /// <summary>Resumes a paused sequence from the group that was running.</summary>
    public void Resume()
    {
        TweenHandle[] running;
        bool continueNow;
        lock (_gate)
        {
            if (!_playing || !_paused)
            {
                return;
            }

            _paused = false;
            running = _active.ToArray();

            // A child may have completed while the pause gate was held; its continuation
            // flag is set but Advance refused to run. Re-check here so the chain cannot stall.
            continueNow = _remaining == 0;
        }

        for (int i = 0; i < running.Length; i++)
        {
            _ = running[i].Resume();
        }

        if (continueNow)
        {
            Advance();
        }
    }

    /// <summary>Stops playback and cancels the running group.</summary>
    public void Cancel()
    {
        List<TweenHandle> running = new();
        lock (_gate)
        {
            if (_completed || _canceled)
            {
                return;
            }

            _canceled = true;
            _paused = false;
            running.AddRange(_active);
            _active.Clear();
        }

        for (int i = 0; i < running.Count; i++)
        {
            running[i].Cancel();
        }
    }

    private void Grow()
    {
        if (_count == _nodes.Length)
        {
            Array.Resize(ref _nodes, _nodes.Length * 2);
        }
    }

    /// <summary>
    /// Drives groups iteratively: collect under the gate, invoke outside it. Pure-sync groups
    /// advance immediately; async groups wait for child completion. Never nested, never recursive.
    /// </summary>
    private void Advance()
    {
        while (true)
        {
            List<Action> immediate = new();
            bool launchedAsync = false;
            bool finished = false;
            Action? completion = null;

            lock (_gate)
            {
                if (_canceled || _completed || _paused)
                {
                    return;
                }

                if (_cursor >= _count)
                {
                    _completed = true;
                    finished = true;
                    completion = _onComplete;
                }
                else
                {
                    launchedAsync = CollectGroupLocked(immediate);
                }
            }

            RunImmediate(immediate);
            if (finished)
            {
                completion?.Invoke();
                return;
            }

            lock (_gate)
            {
                if (_canceled || _paused)
                {
                    return;
                }
            }

            if (!launchedAsync)
            {
                continue;
            }

            return;
        }
    }

    /// <summary>Requires the gate. Schedules one group, collecting inline callbacks.</summary>
    private bool CollectGroupLocked(List<Action> immediate)
    {
        _active.Clear();
        int start = _cursor;
        int end = start + 1;
        while (end < _count && _nodes[end].IsJoin)
        {
            end++;
        }

        _cursor = end;
        _remaining = 0;
        bool launchedAsync = false;
        for (int i = start; i < end; i++)
        {
            Node node = _nodes[i];
            if (node.IsCallback)
            {
                if (node.Callback != null)
                {
                    immediate.Add(node.Callback);
                }
            }
            else
            {
                TweenSpec spec = node.IsInterval ? IntervalSpec(node.Interval) : node.Spec;
                _active.Add(_engine.Play(HookCompletion(spec)));
                launchedAsync = true;
                _remaining++;
            }
        }

        return launchedAsync;
    }

    private static TweenSpec IntervalSpec(DurationNs interval) =>
        new TweenBuilder()
            .From(0f)
            .To(0f)
            .Duration(interval)
            .Build();

    private TweenSpec HookCompletion(TweenSpec spec)
    {
        Action? original = spec.OnComplete;
        return spec with
        {
            OnComplete = () =>
            {
                original?.Invoke();
                ChildFinished();
            }
        };
    }

    private void ChildFinished()
    {
        lock (_gate)
        {
            if (_canceled || _completed)
            {
                return;
            }

            if (--_remaining > 0)
            {
                return;
            }
        }

        Advance();
    }

    private static void RunImmediate(List<Action> immediate)
    {
        for (int i = 0; i < immediate.Count; i++)
        {
            immediate[i]();
        }
    }
}
