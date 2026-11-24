namespace Axrone.Reactive;

using Axrone.Reactive.Internal;

/// <summary>
/// Derivable cold-observable root: game classes inherit stream behavior instead of wiring it.
/// </summary>
/// <remarks>
/// <para><b>Allocation contract:</b> subscribing allocates the observer adapter and its handle
/// (cold path); publishing never allocates and never locks, and reads a per-priority slot order
/// snapshot. Concurrent publishes may interleave per observer.</para>
/// <para><b>Ordering:</b> the dispatch order is <see cref="ObservationPriority"/> (high, normal,
/// low) and then registration order within a priority.</para>
/// <para><b>Backpressure:</b> none — this is a push model. A slow observer blocks the publishing
/// thread for every subscriber behind it. Shed, sample, or buffer upstream.</para>
/// <para><b>Fault philosophy:</b> <see cref="SubjectOptions.ErrorPropagation"/> selects between
/// propagating the fault to the publisher (the default, Reactive parity) and isolating it per
/// observer while the broadcast continues.</para>
/// <para><b>Snapshot semantics:</b> a publish pins the current slot order before invoking anyone,
/// so a subscription disposed by an earlier observer still receives the event already in flight,
/// while new subscriptions only see the next publish.</para>
/// <para><b>Terminal races:</b> late subscribers always observe exactly one terminal, in order.
/// No schedulers, no timers — the engine drives threads.</para>
/// </remarks>
/// <typeparam name="T">Notification type.</typeparam>
public abstract class ObservableBase<T> : IObservable<T>, IPriorityObservable<T>, IDisposable
{
    private readonly ObserverEngine<T> _engine;
    private readonly SubjectOptions _subjectOptions;

    protected ObservableBase()
        : this(SubjectOptions.Default)
    {
    }

    protected ObservableBase(in SubjectOptions options)
    {
        _subjectOptions = options.Normalize();

        int requested = Math.Max(2, _subjectOptions.MaxObservers);
        int slots = NextPowerOfTwo(Math.Min(65_536, requested));
        _engine = new ObserverEngine<T>(new ObserverEngineOptions
        {
            MaxObservers = slots,
            MaxSubscribers = _subjectOptions.MaxObservers,
            FaultBehavior = _subjectOptions.ErrorPropagation
                ? ObserverFaultBehavior.Propagate
                : ObserverFaultBehavior.IsolateObserver,
        });
    }

    /// <summary>Live subscriptions.</summary>
    public int SubscriberCount => _engine.ActiveSubscriberCount;

    internal int SlotCapacity => _engine.Capacity;

    /// <summary>Observer callbacks that faulted under isolation.</summary>
    public int ObserverFaultCount => _engine.ObserverFaultCount;

    /// <summary>Whether error/completed was delivered.</summary>
    public bool IsTerminated => _engine.Status is
        ObserverEngineStatus.Completed or
        ObserverEngineStatus.Faulted or
        ObserverEngineStatus.Disposed;

    /// <summary>Whether the terminal signal was a fault.</summary>
    public bool IsFaulted => _engine.Status == ObserverEngineStatus.Faulted;

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

        ObserverEngineStatus status = _engine.Status;
        if (status is ObserverEngineStatus.Completed or ObserverEngineStatus.Disposed)
        {
            observer.OnCompleted();
            return NoopDisposable.Instance;
        }

        if (status == ObserverEngineStatus.Faulted)
        {
            observer.OnError(_engine.TerminalError!);
            return NoopDisposable.Instance;
        }

        try
        {
            ObserverSubscription subscription = _engine.Subscribe(new ObserverAdapter(observer), (byte)priority);
            ReactiveTelemetry.Subscribed();
            return new Subscription(subscription);
        }
        catch (InvalidOperationException) when (_engine.Status == ObserverEngineStatus.Active)
        {
            ReactiveThrowHelper.ThrowMaxObserversExceeded(_subjectOptions.MaxObservers, SubscriberCount);
            throw;
        }
        catch (InvalidOperationException)
        {
            if (_engine.Status == ObserverEngineStatus.Faulted)
            {
                observer.OnError(_engine.TerminalError!);
            }
            else
            {
                observer.OnCompleted();
            }

            return NoopDisposable.Instance;
        }
    }

    /// <summary>Publishes to current subscribers; ignored once terminated.</summary>
    protected void Publish(T value)
    {
        if (_engine.Status != ObserverEngineStatus.Active)
        {
            return;
        }

        _ = _engine.TryPublish(value, out _);
    }

    /// <summary>Delivers completion; later publishes are ignored, late subscribers replay it.</summary>
    protected void Complete()
    {
        if (!_engine.Complete())
        {
            return;
        }

        ReactiveTelemetry.SourceCompleted();
        ReactiveEventSource.Log.SourceCompleted();

        if (_subjectOptions.AutoComplete)
        {
            Dispose();
        }
    }

    /// <summary>Delivers a terminal fault; later publishes are ignored, late subscribers replay it.</summary>
    protected void Fault(Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        if (!_engine.Complete(error))
        {
            return;
        }

        ReactiveTelemetry.SourceFaulted();
        ReactiveEventSource.Log.FaultDelivered(error.GetType().Name, error.Message);
    }

    /// <summary>Whether observer faults propagate to the publisher instead of being isolated.</summary>
    protected bool PropagateObserverErrors => _subjectOptions.ErrorPropagation;

    /// <inheritdoc/>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    /// <summary>Releases subscriptions; derived types release managed state when disposing.</summary>
    protected virtual void Dispose(bool disposing)
    {
        if (!disposing)
        {
            return;
        }

        bool wasActive = _engine.Status == ObserverEngineStatus.Active;
        _engine.Dispose();
        if (wasActive)
        {
            ReactiveTelemetry.SourceCompleted();
            ReactiveEventSource.Log.SourceCompleted();
        }
    }

    private static int NextPowerOfTwo(int value)
    {
        int result = 2;
        while (result < value)
        {
            result <<= 1;
        }

        return result;
    }

    private sealed class ObserverAdapter(IObserver<T> observer) : IValueObserver<T>
    {
        public void OnNext(in T value, nint context) => observer.OnNext(value);

        public void OnError(Exception error, nint context) => observer.OnError(error);

        public void OnCompleted(nint context) => observer.OnCompleted();
    }

    private sealed class Subscription : IDisposable
    {
        private readonly ObserverSubscription _inner;
        private int _disposed;

        public Subscription(ObserverSubscription inner) => _inner = inner;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _inner.Dispose();
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

/// <summary>Cold-path exception throwers for the observable base.</summary>
internal static class ReactiveThrowHelper
{
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMaxObserversExceeded(int maxObservers, int currentCount) =>
        throw new MaxObserversExceededError(maxObservers, currentCount);
}
