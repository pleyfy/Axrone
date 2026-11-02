namespace Axrone.Reactive;

/// <summary>
/// Derivable cold-observable root: game classes inherit stream behavior instead of wiring it.
/// </summary>
/// <remarks>
/// <para><b>Allocation contract:</b> subscribing allocates (subscription node plus one array
/// copy — cold path); publishing never allocates and never locks, readers take a snapshot
/// reference. Concurrent publishes may interleave per observer.</para>
/// <para><b>Ordering:</b> the subscription snapshot is sorted by
/// <see cref="ObservationPriority"/> (high, normal, low) and then registration order.
/// Within one priority, a concurrently inserted subscription keeps subscription-id order,
/// so notify order is deterministic.</para>
/// <para><b>Backpressure:</b> none — this is a push model. A slow observer blocks the publishing
/// thread for every subscriber behind it. Shed, sample, or buffer upstream (operators,
/// transport queues) instead of slowing observers.</para>
/// <para><b>Fault philosophy:</b> a throwing observer aborts the broadcast and propagates to the
/// publisher (Reactive parity). This differs deliberately from the event bus, which isolates
/// per-subscriber faults into dead letters: isolation needs somewhere to put the failure, and
/// only a transport owns a dead-letter queue. Isolate at the transport edge, not the source.</para>
/// <para><b>Terminal races:</b> an in-flight publish racing a terminal call may still deliver
/// after the terminal signal; late subscribers always observe exactly one terminal, in order.
/// No schedulers, no timers — the engine drives threads.</para>
/// </remarks>
/// <typeparam name="T">Notification type.</typeparam>
public abstract class ObservableBase<T> : IObservable<T>, IObservableMarker, IDisposable
{
    private const int StateActive = 0;
    private const int StateCompleted = 1;
    private const int StateFaulted = 2;

    private readonly SubjectOptions _subjectOptions;
    private SubscriptionEntry[] _observers = [];
    private int _terminal;
    private Exception? _error;
    private int _disposed;
    private int _observerFaultCount;
    private long _nextSubscriptionId;

    /// <summary>Guards fault publication only; hot paths never take it.</summary>
    private readonly Lock _faultGate = new();

    protected ObservableBase()
        : this(SubjectOptions.Default)
    {
    }

    protected ObservableBase(in SubjectOptions options) =>
        _subjectOptions = options.MaxObservers > 0 ? options.Normalize() : SubjectOptions.Default;

    /// <summary>Live subscriptions.</summary>
    public int SubscriberCount => Volatile.Read(ref _observers).Length;

    public int ObserverFaultCount => Volatile.Read(ref _observerFaultCount);

    /// <summary>Whether error/completed was delivered.</summary>
    public bool IsTerminated => Volatile.Read(ref _terminal) != StateActive;

    /// <summary>Whether the terminal signal was a fault.</summary>
    public bool IsFaulted => Volatile.Read(ref _terminal) == StateFaulted;

    /// <inheritdoc/>
    public virtual IDisposable Subscribe(IObserver<T> observer) =>
        Subscribe(observer, ObservationPriority.Normal);

    /// <summary>
    /// Subscribes at an explicit priority. High runs first, low last; equal priorities keep
    /// registration order.
    /// </summary>
    public virtual IDisposable Subscribe(IObserver<T> observer, ObservationPriority priority)
    {
        ArgumentNullException.ThrowIfNull(observer);
        if (!IsTerminated && SubscriberCount >= _subjectOptions.MaxObservers)
        {
            ReactiveThrowHelper.ThrowMaxObserversExceeded(_subjectOptions.MaxObservers, SubscriberCount);
        }

        int terminal = Volatile.Read(ref _terminal);
        if (terminal == StateCompleted)
        {
            observer.OnCompleted();
            return NoopDisposable.Instance;
        }

        if (terminal == StateFaulted)
        {
            return SubscribeTerminal(observer);
        }

        long id = Interlocked.Increment(ref _nextSubscriptionId);
        while (true)
        {
            SubscriptionEntry[] current = Volatile.Read(ref _observers);
            if (Volatile.Read(ref _terminal) != StateActive)
            {
                return SubscribeTerminal(observer);
            }

            var next = new SubscriptionEntry[current.Length + 1];
            int insert = 0;
            while (insert < current.Length)
            {
                int comparison = current[insert].Priority.CompareTo(priority);
                if (comparison > 0 || (comparison == 0 && current[insert].Id > id))
                {
                    break;
                }

                insert++;
            }

            Array.Copy(current, 0, next, 0, insert);
            next[insert] = new SubscriptionEntry(observer, priority, id);
            Array.Copy(current, insert, next, insert + 1, current.Length - insert);

            if (Interlocked.CompareExchange(ref _observers, next, current) == current)
            {
                if (Volatile.Read(ref _terminal) != StateActive)
                {
                    return Unsubscribe(id) ? SubscribeTerminal(observer) : NoopDisposable.Instance;
                }

                ReactiveTelemetry.Subscribed();
                return new Subscription(this, id);
            }
        }
    }

    /// <summary>Publishes to current subscribers; ignored once terminated.</summary>
    protected void Publish(T value)
    {
        if (Volatile.Read(ref _terminal) != StateActive)
        {
            return;
        }

        SubscriptionEntry[] snapshot = Volatile.Read(ref _observers);
        bool propagate = PropagateObserverErrors;
        for (int i = 0; i < snapshot.Length; i++)
        {
            if (propagate)
            {
                snapshot[i].Observer.OnNext(value);
            }
            else
            {
                try
                {
                    snapshot[i].Observer.OnNext(value);
                }
                catch (Exception)
                {
                    Interlocked.Increment(ref _observerFaultCount);
                }
            }
        }
    }

    protected bool PropagateObserverErrors => _subjectOptions.ErrorPropagation;

    /// <summary>Delivers completion; later publishes are ignored, late subscribers replay it.</summary>
    protected void Complete()
    {
        if (Interlocked.CompareExchange(ref _terminal, StateCompleted, StateActive) != StateActive)
        {
            return;
        }

        ReactiveTelemetry.SourceCompleted();
        ReactiveEventSource.Log.SourceCompleted();

        SubscriptionEntry[] snapshot = Interlocked.Exchange(ref _observers, []);
        for (int i = 0; i < snapshot.Length; i++)
        {
            snapshot[i].Observer.OnCompleted();
        }

        if (_subjectOptions.AutoComplete)
        {
            Dispose();
        }
    }

    /// <summary>Delivers a terminal fault; later publishes are ignored, late subscribers replay it.</summary>
    protected void Fault(Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);

        SubscriptionEntry[] snapshot;
        lock (_faultGate)
        {
            if (_terminal != StateActive)
            {
                return;
            }

            _error = error;
            Volatile.Write(ref _terminal, StateFaulted);
            snapshot = Interlocked.Exchange(ref _observers, []);
        }

        ReactiveTelemetry.SourceFaulted();
        ReactiveEventSource.Log.FaultDelivered(error.GetType().Name, error.Message);

        for (int i = 0; i < snapshot.Length; i++)
        {
            snapshot[i].Observer.OnError(error);
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    /// <summary>Releases subscriptions; derived types release managed state when disposing.</summary>
    protected virtual void Dispose(bool disposing)
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        if (disposing)
        {
            Complete();
        }
    }

    private NoopDisposable SubscribeTerminal(IObserver<T> observer)
    {
        if (Volatile.Read(ref _terminal) == StateFaulted)
        {
            Exception error;
            lock (_faultGate)
            {
                error = _error!;
            }

            observer.OnError(error);
        }
        else
        {
            observer.OnCompleted();
        }

        return NoopDisposable.Instance;
    }

    private bool Unsubscribe(long subscriptionId)
    {
        while (true)
        {
            SubscriptionEntry[] current = Volatile.Read(ref _observers);
            int index = -1;
            for (int i = 0; i < current.Length; i++)
            {
                if (current[i].Id == subscriptionId)
                {
                    index = i;
                    break;
                }
            }

            if (index < 0)
            {
                return false;
            }

            var next = new SubscriptionEntry[current.Length - 1];
            Array.Copy(current, 0, next, 0, index);
            Array.Copy(current, index + 1, next, index, current.Length - index - 1);
            if (Interlocked.CompareExchange(ref _observers, next, current) == current)
            {
                return true;
            }
        }
    }

    private readonly struct SubscriptionEntry
    {
        public readonly IObserver<T> Observer;
        public readonly ObservationPriority Priority;
        public readonly long Id;

        public SubscriptionEntry(IObserver<T> observer, ObservationPriority priority, long id)
        {
            Observer = observer;
            Priority = priority;
            Id = id;
        }
    }

    private sealed class Subscription : IDisposable
    {
        private readonly ObservableBase<T> _source;
        private readonly long _id;
        private int _disposed;

        public Subscription(ObservableBase<T> source, long id)
        {
            _source = source;
            _id = id;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _source.Unsubscribe(_id);
            }
        }
    }

    private sealed class NoopDisposable : IDisposable
    {
        public static readonly NoopDisposable Instance = new();

        public void Dispose()
        {
        }
    }
}

internal static class ReactiveThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMaxObserversExceeded(int maxObservers, int currentCount) =>
        throw new MaxObserversExceededError(maxObservers, currentCount);
}
