namespace Axrone.Reactive;

public readonly record struct RegistryValidation(
    bool IsHealthy,
    int TotalObservers,
    int ActiveObservers,
    int InactiveObservers,
    int SubjectCount);

public sealed class ObservableRegistry : IDisposable
{
    private readonly Lock _gate = new();
    private readonly Dictionary<int, SubjectRecord> _subjects = new();
    private readonly Dictionary<int, ObserverRecord> _observers = new();
    private readonly ObservableMemoryManager? _memoryManager;
    private readonly bool _disposeMemoryManager;
    private readonly bool _enableMemoryTracking;
    private int _nextSubjectId;
    private int _nextObserverId;
    private bool _disposed;

    public ObservableRegistry(
        bool enableMemoryTracking = true,
        ObservableMemoryManager? memoryManager = null,
        bool disposeMemoryManager = false)
    {
        _enableMemoryTracking = enableMemoryTracking;
        if (enableMemoryTracking)
        {
            _memoryManager = memoryManager ?? new ObservableMemoryManager();
            _disposeMemoryManager = memoryManager is null || disposeMemoryManager;
        }
    }

    public int SubjectCount
    {
        get
        {
            lock (_gate)
            {
                return _subjects.Count;
            }
        }
    }

    public int ActiveObserverCount
    {
        get
        {
            lock (_gate)
            {
                int count = 0;
                foreach (ObserverRecord record in _observers.Values)
                {
                    if (record.Active)
                    {
                        count++;
                    }
                }

                return count;
            }
        }
    }

    public int RegisterSubject(object subject, in SubjectOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(subject);
        SubjectOptions normalized = options.MaxObservers > 0 ? options.Normalize() : SubjectOptions.Default;
        lock (_gate)
        {
            ThrowIfDisposed();
            int id = ++_nextSubjectId;
            int memoryId = _enableMemoryTracking ? _memoryManager!.TrackSubject(subject, normalized) : 0;
            _subjects.Add(id, new SubjectRecord(subject, normalized, memoryId));
            return id;
        }
    }

    public bool UnregisterSubject(int subjectId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!_subjects.Remove(subjectId, out SubjectRecord? record))
            {
                return false;
            }

            foreach (int observerId in record.Observers)
            {
                if (_observers.Remove(observerId, out ObserverRecord? observer))
                {
                    Untrack(observer.MemoryId);
                }
            }

            Untrack(record.MemoryId);
            return true;
        }
    }

    public int RegisterObserver(int subjectId, object observer, in ObservationOptions options = default)
    {
        ArgumentNullException.ThrowIfNull(observer);
        ObservationOptions normalized = options.Normalize();
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!_subjects.TryGetValue(subjectId, out SubjectRecord? subject))
            {
                throw new ObserverNotFoundError(subjectId);
            }

            int active = 0;
            foreach (int observerId in subject.Observers)
            {
                if (_observers.TryGetValue(observerId, out ObserverRecord? existing) && existing.Active)
                {
                    active++;
                }
            }

            if (active >= subject.Options.MaxObservers)
            {
                throw new MaxObserversExceededError(subjectId, subject.Options.MaxObservers, active);
            }

            int id = ++_nextObserverId;
            int memoryId = _enableMemoryTracking ? _memoryManager!.TrackObserver(observer, normalized) : 0;
            var record = new ObserverRecord(id, subjectId, observer, memoryId);
            _observers.Add(id, record);
            subject.Observers.Add(id);
            return id;
        }
    }

    public bool UnregisterObserver(int observerId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            return RemoveObserverCore(observerId);
        }
    }

    public bool UnregisterObserverByReference(object observer)
    {
        ArgumentNullException.ThrowIfNull(observer);
        lock (_gate)
        {
            ThrowIfDisposed();
            int found = 0;
            foreach (ObserverRecord record in _observers.Values)
            {
                if (ReferenceEquals(record.Observer, observer))
                {
                    found = record.Id;
                    break;
                }
            }

            if (found == 0)
            {
                return false;
            }

            return RemoveObserverCore(found);
        }
    }

    public object GetObserver(int observerId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            return _observers.TryGetValue(observerId, out ObserverRecord? record)
                ? record.Observer
                : throw new ObserverNotFoundError(observerId);
        }
    }

    public object GetSubject(int subjectId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            return _subjects.TryGetValue(subjectId, out SubjectRecord? record)
                ? record.Subject
                : throw new ObserverNotFoundError(subjectId);
        }
    }

    public int GetObserversForSubject(int subjectId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!_subjects.TryGetValue(subjectId, out SubjectRecord? subject))
            {
                return 0;
            }

            int count = 0;
            foreach (int observerId in subject.Observers)
            {
                if (_observers.TryGetValue(observerId, out ObserverRecord? record) && record.Active)
                {
                    count++;
                }
            }

            return count;
        }
    }

    public bool DeactivateObserver(int observerId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!_observers.TryGetValue(observerId, out ObserverRecord? record) || !record.Active)
            {
                return false;
            }

            record.Active = false;
            return true;
        }
    }

    public bool RecordExecution(int observerId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!_observers.TryGetValue(observerId, out ObserverRecord? record))
            {
                return false;
            }

            record.ExecutionCount++;
            return true;
        }
    }

    public int GetExecutionCount(int observerId)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            return _observers.TryGetValue(observerId, out ObserverRecord? record)
                ? record.ExecutionCount
                : 0;
        }
    }

    public ObservableMemoryUsage GetMemoryUsage()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (_enableMemoryTracking)
            {
                return _memoryManager!.GetMemoryUsage();
            }

            int subjects = _subjects.Count;
            int observers = 0;
            foreach (ObserverRecord record in _observers.Values)
            {
                if (record.Active)
                {
                    observers++;
                }
            }

            return new ObservableMemoryUsage(subjects, observers, 0, (subjects * 256L) + (observers * 128L));
        }
    }

    public RegistryValidation Validate()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            int active = 0;
            int inactive = 0;
            foreach (ObserverRecord record in _observers.Values)
            {
                if (record.Active)
                {
                    active++;
                }
                else
                {
                    inactive++;
                }
            }

            return new RegistryValidation(
                inactive == 0,
                _observers.Count,
                active,
                inactive,
                _subjects.Count);
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            ClearCore();
        }
    }

    public void Dispose()
    {
        ObservableMemoryManager? manager;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            ClearCore();
            _disposed = true;
            manager = _disposeMemoryManager ? _memoryManager : null;
        }

        manager?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool RemoveObserverCore(int observerId)
    {
        if (!_observers.Remove(observerId, out ObserverRecord? record))
        {
            return false;
        }

        if (_subjects.TryGetValue(record.SubjectId, out SubjectRecord? subject))
        {
            subject.Observers.Remove(observerId);
        }

        Untrack(record.MemoryId);
        return true;
    }

    private void ClearCore()
    {
        if (_enableMemoryTracking)
        {
            foreach (SubjectRecord record in _subjects.Values)
            {
                Untrack(record.MemoryId);
            }

            foreach (ObserverRecord record in _observers.Values)
            {
                Untrack(record.MemoryId);
            }
        }

        _subjects.Clear();
        _observers.Clear();
    }

    private void Untrack(int memoryId)
    {
        if (_enableMemoryTracking && memoryId != 0)
        {
            _memoryManager!.Untrack(memoryId);
        }
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

    private sealed class SubjectRecord
    {
        public SubjectRecord(object subject, SubjectOptions options, int memoryId)
        {
            Subject = subject;
            Options = options;
            MemoryId = memoryId;
        }

        public object Subject { get; }

        public SubjectOptions Options { get; }

        public int MemoryId { get; }

        public List<int> Observers { get; } = [];
    }

    private sealed class ObserverRecord
    {
        public ObserverRecord(
            int id,
            int subjectId,
            object observer,
            int memoryId)
        {
            Id = id;
            SubjectId = subjectId;
            Observer = observer;
            MemoryId = memoryId;
            Active = true;
        }

        public int Id { get; }

        public int SubjectId { get; }

        public object Observer { get; }

        public int MemoryId { get; }

        public int ExecutionCount { get; set; }

        public bool Active { get; set; }
    }
}
