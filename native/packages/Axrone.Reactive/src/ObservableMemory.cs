namespace Axrone.Reactive;

using System.Runtime.InteropServices;

public enum MemoryPressure
{
    Low,
    Medium,
    High,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ObservableMemoryUsage(
    int Subjects,
    int Observers,
    long ReplayBufferBytes,
    long TotalBytes);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct MemoryCollectionResult(
    int SubjectsCleared,
    int ObserversCleared,
    long MemoryFreed);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct MemoryHealth(
    bool IsHealthy,
    MemoryPressure Pressure,
    double UsageRatio,
    int DeadSubjects,
    int DeadObservers,
    long TotalBytes,
    long ThresholdBytes);

public sealed class ObservableMemoryManager : IDisposable
{
    private const long SubjectEstimate = 256;
    private const long ObserverEstimate = 128;
    private const long BufferEntryEstimate = 32;

    private readonly Lock _gate = new();
    private readonly Dictionary<int, Entry> _entries = new();
    private readonly TimeProvider _timeProvider;
    private readonly long _thresholdBytes;
    private readonly ITimer? _timer;
    private int _nextId;
    private bool _disposed;

    public ObservableMemoryManager(
        bool enableTracking = true,
        int gcIntervalMs = 60000,
        int autoGcThresholdMb = 50,
        TimeProvider? timeProvider = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(gcIntervalMs);
        ArgumentOutOfRangeException.ThrowIfNegative(autoGcThresholdMb);
        EnableTracking = enableTracking;
        GcIntervalMs = gcIntervalMs;
        _thresholdBytes = Math.Max(1, autoGcThresholdMb) * 1024L * 1024L;
        _timeProvider = timeProvider ?? TimeProvider.System;
        if (enableTracking && gcIntervalMs > 0)
        {
            _timer = _timeProvider.CreateTimer(
                static state => ((ObservableMemoryManager)state!).RunGarbageCollection(),
                this,
                TimeSpan.FromMilliseconds(gcIntervalMs),
                TimeSpan.FromMilliseconds(gcIntervalMs));
        }
    }

    public bool EnableTracking { get; }

    public int GcIntervalMs { get; }

    public int TrackedCount
    {
        get
        {
            lock (_gate)
            {
                return _entries.Count;
            }
        }
    }

    public int TrackSubject(object subject)
    {
        ArgumentNullException.ThrowIfNull(subject);
        return Track(subject, SubjectEstimate, subjectEntry: true);
    }

    public int TrackObserver(object observer, in ObservationOptions options)
    {
        ArgumentNullException.ThrowIfNull(observer);
        long bytes = ObserverEstimate;
        if (options.Replay.Enabled)
        {
            bytes += options.Replay.BufferSize * BufferEntryEstimate;
        }

        if (options.Buffering.Enabled)
        {
            bytes += options.Buffering.MaxSize * BufferEntryEstimate;
        }

        return Track(observer, bytes, subjectEntry: false);
    }

    public bool Untrack(int id)
    {
        lock (_gate)
        {
            return _entries.Remove(id);
        }
    }

    public ObservableMemoryUsage GetMemoryUsage()
    {
        lock (_gate)
        {
            int subjects = 0;
            int observers = 0;
            long replayBytes = 0;
            long total = 0;
            foreach (Entry entry in _entries.Values)
            {
                entry.Touch(_timeProvider);
                if (!entry.Target.TryGetTarget(out _))
                {
                    continue;
                }

                if (entry.IsSubject)
                {
                    subjects++;
                }
                else
                {
                    observers++;
                }

                total += entry.Bytes;
                if (entry.BufferBytes > 0)
                {
                    replayBytes += entry.BufferBytes;
                }
            }

            return new ObservableMemoryUsage(subjects, observers, replayBytes, total);
        }
    }

    public MemoryCollectionResult RunGarbageCollection()
    {
        lock (_gate)
        {
            int subjects = 0;
            int observers = 0;
            long freed = 0;
            List<int>? dead = null;
            foreach (KeyValuePair<int, Entry> pair in _entries)
            {
                if (pair.Value.Target.TryGetTarget(out _) && !pair.Value.IsExpired(_timeProvider))
                {
                    continue;
                }

                dead ??= [];
                dead.Add(pair.Key);
                if (pair.Value.IsSubject)
                {
                    subjects++;
                }
                else
                {
                    observers++;
                }

                freed += pair.Value.Bytes;
            }

            if (dead is not null)
            {
                foreach (int id in dead)
                {
                    _entries.Remove(id);
                }
            }

            return new MemoryCollectionResult(subjects, observers, freed);
        }
    }

    public MemoryHealth GetHealth()
    {
        ObservableMemoryUsage usage = GetMemoryUsage();
        int deadSubjects = 0;
        int deadObservers = 0;
        lock (_gate)
        {
            foreach (Entry entry in _entries.Values)
            {
                if (entry.Target.TryGetTarget(out _))
                {
                    continue;
                }

                if (entry.IsSubject)
                {
                    deadSubjects++;
                }
                else
                {
                    deadObservers++;
                }
            }
        }

        double ratio = usage.TotalBytes / (double)_thresholdBytes;
        MemoryPressure pressure = ratio >= 1.0
            ? MemoryPressure.High
            : ratio >= 0.5
                ? MemoryPressure.Medium
                : MemoryPressure.Low;
        return new MemoryHealth(
            deadSubjects == 0 && deadObservers == 0 && pressure != MemoryPressure.High,
            pressure,
            ratio,
            deadSubjects,
            deadObservers,
            usage.TotalBytes,
            _thresholdBytes);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _timer?.Dispose();
            _entries.Clear();
        }

        GC.SuppressFinalize(this);
    }

    private int Track(object target, long bytes, bool subjectEntry)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            int id = ++_nextId;
            _entries.Add(id, new Entry(target, bytes, subjectEntry, _timeProvider));
            return id;
        }
    }

    private sealed class Entry
    {
        public Entry(object target, long bytes, bool subjectEntry, TimeProvider timeProvider)
        {
            Target = new WeakReference<object>(target);
            Bytes = bytes;
            BufferBytes = bytes > (subjectEntry ? SubjectEstimate : ObserverEstimate)
                ? bytes - (subjectEntry ? SubjectEstimate : ObserverEstimate)
                : 0;
            IsSubject = subjectEntry;
            LastAccess = timeProvider.GetTimestamp();
        }

        public WeakReference<object> Target { get; }

        public long Bytes { get; }

        public long BufferBytes { get; }

        public bool IsSubject { get; }

        public long LastAccess { get; private set; }

        public void Touch(TimeProvider timeProvider) => LastAccess = timeProvider.GetTimestamp();

        public bool IsExpired(TimeProvider timeProvider) =>
            timeProvider.GetElapsedTime(LastAccess) > TimeSpan.FromMinutes(5);
    }
}
