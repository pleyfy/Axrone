namespace Axrone.Reactive.Tests;

using Axrone.Reactive.Internal;

/// <summary>
/// Contract tests for the hot observer registry. Each test here targets a failure mode that the
/// original slot design either deadlocked on or left unspecified.
/// </summary>
public sealed class ObserverEngineTests
{
    [Fact]
    public void PriorityThenRegistrationOrder_IsDeterministic()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        var log = new List<string>();

        using ObserverSubscription normalFirst = engine.Subscribe(new DelegateObserver<int>(_ => log.Add("normal-1")), priority: 1);
        using ObserverSubscription low = engine.Subscribe(new DelegateObserver<int>(_ => log.Add("low")), priority: 2);
        using ObserverSubscription high = engine.Subscribe(new DelegateObserver<int>(_ => log.Add("high")), priority: 0);
        using ObserverSubscription normalSecond = engine.Subscribe(new DelegateObserver<int>(_ => log.Add("normal-2")), priority: 1);

        engine.Publish(1);

        log.Should().Equal("high", "normal-1", "normal-2", "low");
    }

    [Fact]
    public async Task ObserverCanDisposeItselfWithoutDeadlocking()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        ObserverSubscription subscription = default;
        int calls = 0;

        subscription = engine.Subscribe(
            new DelegateObserver<int>(_ =>
            {
                calls++;
                subscription.Dispose();
            }));

        Task publish = Task.Run(() =>
        {
            engine.Publish(1);
            engine.Publish(2);
        });

        Task winner = await Task.WhenAny(publish, Task.Delay(TimeSpan.FromSeconds(5)));
        winner.Should().BeSameAs(publish, "unsubscribe must never wait for the callback that is calling it");
        await publish;

        calls.Should().Be(1);
        engine.ActiveSubscriberCount.Should().Be(0);
        subscription.IsActive.Should().BeFalse();
    }

    [Fact]
    public void DisposingAnotherSubscriptionDuringNotify_KeepsTheCurrentSnapshot()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        ObserverSubscription later = default;
        int laterCalls = 0;

        using ObserverSubscription first = engine.Subscribe(new DelegateObserver<int>(_ => later.Dispose()));
        later = engine.Subscribe(new DelegateObserver<int>(_ => laterCalls++));

        engine.Publish(1);

        laterCalls.Should().Be(1, "the in-flight snapshot was pinned before notification");
        engine.ActiveSubscriberCount.Should().Be(1, "only the observer that disposed its peer remains");

        engine.Publish(2);
        laterCalls.Should().Be(1, "the disposed slot is gone from the next publish");
    }

    [Fact]
    public void FaultIsolation_ContinuesToTheNextObserver()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.IsolateObserver,
        });

        int delivered = 0;
        using ObserverSubscription faulting = engine.Subscribe(new DelegateObserver<int>(_ => throw new InvalidOperationException("boom")));
        using ObserverSubscription survivor = engine.Subscribe(new DelegateObserver<int>(_ => delivered++));

        Action publish = () => engine.Publish(1);

        publish.Should().NotThrow();
        delivered.Should().Be(1);
        engine.Status.Should().Be(ObserverEngineStatus.Active);
    }

    [Fact]
    public void FaultEngine_CompletesAndRethrowsWithoutDeadlocking()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.FaultEngine,
        });

        var terminal = new DelegateObserver<int>();
        using ObserverSubscription faulting = engine.Subscribe(new DelegateObserver<int>(_ => throw new InvalidOperationException("boom")));
        using ObserverSubscription survivor = engine.Subscribe(terminal);

        Action publish = () => engine.Publish(1);

        publish.Should().Throw<InvalidOperationException>().WithMessage("boom");
        engine.Status.Should().Be(ObserverEngineStatus.Faulted);
        terminal.ErrorCount.Should().Be(1);
    }

    [Fact]
    public async Task CompleteFromCallback_ThrowsInsteadOfDeadlocking()
    {
        var engine = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.Propagate,
        });
        ObserverSubscription? subscription = null;
        Task<Exception?>? task = null;

        try
        {
            ObserverEngine<int> captured = engine;
            subscription = engine.Subscribe(new DelegateObserver<int>(_ => captured.Complete()));

            task = Task.Run<Exception?>(() =>
            {
                try
                {
                    engine.Publish(1);
                    return null;
                }
                catch (Exception exception)
                {
                    return exception;
                }
            });

            Task winner = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)));
            winner.Should().BeSameAs(task, "terminal-from-callback must fail fast, not hang");
            Exception? exception = await task;
            exception.Should().BeOfType<InvalidOperationException>()
                .Which.Message.Should().Contain("inside an observer callback");
            engine.Status.Should().Be(ObserverEngineStatus.Active);
        }
        finally
        {
            // A regression leaves the dispatch spinning; disposing it would hang the test host too.
            if (task?.IsCompletedSuccessfully == true)
            {
                subscription?.Dispose();
                engine.Dispose();
            }
        }
    }

    [Fact]
    public async Task CrossEngineCompleteFromCallback_ThrowsInsteadOfDeadlocking()
    {
        var source = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.Propagate,
        });
        var sink = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.Propagate,
        });
        ObserverSubscription? sourceSub = null;
        ObserverSubscription? sinkSub = null;
        Task<Exception?>? task = null;

        try
        {
            sourceSub = source.Subscribe(new DelegateObserver<int>(_ => sink.Publish(0)));
            sinkSub = sink.Subscribe(new DelegateObserver<int>(_ => source.Complete()));

            task = Task.Run<Exception?>(() =>
            {
                try
                {
                    source.Publish(1);
                    return null;
                }
                catch (Exception exception)
                {
                    return exception;
                }
            });

            Task winner = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)));
            winner.Should().BeSameAs(task, "cross-engine terminal from a callback must fail fast, not hang");
            Exception? exception = await task;
            exception.Should().BeOfType<InvalidOperationException>()
                .Which.Message.Should().Contain("inside an observer callback");
            source.Status.Should().Be(ObserverEngineStatus.Active);
            sink.Status.Should().Be(ObserverEngineStatus.Active);
        }
        finally
        {
            if (task?.IsCompletedSuccessfully == true)
            {
                sourceSub?.Dispose();
                sinkSub?.Dispose();
                source.Dispose();
                sink.Dispose();
            }
        }
    }

    [Fact]
    public async Task DisposeFromCallback_ThrowsInsteadOfDeadlocking()
    {
        var engine = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.Propagate,
        });
        ObserverSubscription? subscription = null;
        Task<Exception?>? task = null;

        try
        {
            ObserverEngine<int> captured = engine;
            subscription = engine.Subscribe(new DelegateObserver<int>(_ => captured.Dispose()));

            task = Task.Run<Exception?>(() =>
            {
                try
                {
                    engine.Publish(1);
                    return null;
                }
                catch (Exception exception)
                {
                    return exception;
                }
            });

            Task winner = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)));
            winner.Should().BeSameAs(task, "dispose-from-callback must fail fast, not hang");
            Exception? exception = await task;
            exception.Should().BeOfType<InvalidOperationException>()
                .Which.Message.Should().Contain("inside an observer callback");
        }
        finally
        {
            if (task?.IsCompletedSuccessfully == true)
            {
                subscription?.Dispose();
                engine.Dispose();
            }
        }
    }

    [Fact]
    public async Task DrainAsync_SharesOneCompletionAcrossConcurrentWaiters()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        var observer = new DelegateObserver<int>();
        using ObserverSubscription subscription = engine.Subscribe(observer);

        Task first = engine.DrainAsync().AsTask();
        Task second = engine.DrainAsync().AsTask();
        Task both = Task.WhenAll(first, second);

        Task winner = await Task.WhenAny(both, Task.Delay(TimeSpan.FromSeconds(5)));
        winner.Should().BeSameAs(both);
        await both;

        first.IsCompletedSuccessfully.Should().BeTrue();
        second.IsCompletedSuccessfully.Should().BeTrue();
        observer.CompletedCount.Should().Be(1);
        engine.Status.Should().Be(ObserverEngineStatus.Completed);
    }

    [Fact]
    public void TopicMask_FiltersPerSlot()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        int first = 0;
        int second = 0;

        using ObserverSubscription firstSub = engine.Subscribe(new DelegateObserver<int>(_ => first++), topicMask: 0b01u);
        using ObserverSubscription secondSub = engine.Subscribe(new DelegateObserver<int>(_ => second++), topicMask: 0b10u);

        engine.Publish(1, topicMask: 0b01u);

        first.Should().Be(1);
        second.Should().Be(0);
    }

    [Fact]
    public void Capacity_IsEnforcedWithoutOverwritingSlots()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 2 });
        using ObserverSubscription first = engine.Subscribe(new DelegateObserver<int>());
        using ObserverSubscription second = engine.Subscribe(new DelegateObserver<int>());

        Action third = () => engine.Subscribe(new DelegateObserver<int>());

        third.Should().Throw<InvalidOperationException>();
        engine.ActiveSubscriberCount.Should().Be(2);
    }

    [Fact]
    public void Complete_NotifiesEveryObserverExactlyOnce()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        var first = new DelegateObserver<int>();
        var second = new DelegateObserver<int>();
        using ObserverSubscription firstSub = engine.Subscribe(first);
        using ObserverSubscription secondSub = engine.Subscribe(second);

        engine.Complete().Should().BeTrue();
        engine.Complete().Should().BeFalse();

        first.CompletedCount.Should().Be(1);
        second.CompletedCount.Should().Be(1);
        engine.ActiveSubscriberCount.Should().Be(0);
    }

    [Fact]
    public void Publish_DoesNotAllocate()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        using ObserverSubscription high = engine.Subscribe(new DelegateObserver<int>(), priority: 0);
        using ObserverSubscription normal = engine.Subscribe(new DelegateObserver<int>(), priority: 1);
        using ObserverSubscription low = engine.Subscribe(new DelegateObserver<int>(), priority: 2);

        for (int i = 0; i < 1_000; i++)
        {
            engine.Publish(i);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 10_000; i++)
        {
            engine.Publish(i);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void SubscribeDisposeChurn_KeepsActiveCountBounded()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 128, MaxSubscribers = 100 });
        var observer = new DelegateObserver<int>();

        for (int i = 0; i < 10_000; i++)
        {
            ObserverSubscription subscription = engine.Subscribe(observer);
            subscription.Dispose();
        }

        engine.ActiveSubscriberCount.Should().Be(0);
    }

    [Fact]
    public void SubjectChurn_DisposesSubscriptions()
    {
        using var subject = new Subject<int>();
        var observer = new NoopObserver<int>();

        for (int i = 0; i < 1_000; i++)
        {
            using IDisposable subscription = subject.Subscribe(observer);
        }

        subject.SubscriberCount.Should().Be(0);
    }

    [Fact]
    public async Task SubjectConcurrentChurn_KeepsActiveCountBounded()
    {
        using var subject = new Subject<int>();
        var stable = new NoopObserver<int>();
        using IDisposable stableSubscription = subject.Subscribe(stable);

        Task[] churn = [.. Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
        {
            var dummy = new NoopObserver<int>();
            for (int i = 0; i < 1_000; i++)
            {
                using IDisposable subscription = subject.Subscribe(dummy);
            }
        }))];

        await Task.WhenAll(churn).WaitAsync(TimeSpan.FromSeconds(10));
        subject.SubscriberCount.Should().Be(1);
    }

    private sealed class NoopObserver<T> : IObserver<T>
    {
        public void OnNext(T value)
        {
        }

        public void OnError(Exception error)
        {
        }

        public void OnCompleted()
        {
        }
    }

    [Fact]
    public void DeepNestedDispatchGrowsAndUnwindsTheFrameStack()
    {
        using var engine = new ObserverEngine<int>(new ObserverEngineOptions { MaxObservers = 8 });
        int depth = 0;

        using ObserverSubscription subscription = engine.Subscribe(new DelegateObserver<int>(_ =>
        {
            depth++;
            if (depth < 24)
            {
                engine.Publish(depth);
            }
        }));

        engine.Publish(0);

        depth.Should().Be(24);
        engine.Complete().Should().BeTrue();
    }

    [Fact]
    public async Task DrainFromCompletionCallback_ThrowsInsteadOfDeadlocking()
    {
        var engine = new ObserverEngine<int>(new ObserverEngineOptions
        {
            MaxObservers = 8,
            FaultBehavior = ObserverFaultBehavior.Propagate,
        });
        ObserverSubscription? subscription = null;
        Task? task = null;

        try
        {
            subscription = engine.Subscribe(new DelegateObserver<int>(
                onCompleted: () => engine.DrainAsync().AsTask().GetAwaiter().GetResult()));

            task = Task.Run(() => engine.Complete());

            Task winner = await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)));
            winner.Should().BeSameAs(task, "drain-from-completion must fail fast, not hang");
            await task;
            engine.Status.Should().Be(ObserverEngineStatus.Completed);
        }
        finally
        {
            if (task?.IsCompletedSuccessfully == true)
            {
                subscription?.Dispose();
                engine.Dispose();
            }
        }
    }

    private sealed class DelegateObserver<T> : IValueObserver<T>
    {
        private readonly Action<T>? _onNext;
        private readonly Action? _onCompleted;

        public DelegateObserver(Action<T>? onNext = null, Action? onCompleted = null)
        {
            _onNext = onNext;
            _onCompleted = onCompleted;
        }

        public int NextCount;

        public int ErrorCount;

        public int CompletedCount;

        public void OnNext(in T value, nint context)
        {
            NextCount++;
            _onNext?.Invoke(value);
        }

        public void OnError(Exception error, nint context) => ErrorCount++;

        public void OnCompleted(nint context)
        {
            CompletedCount++;
            _onCompleted?.Invoke();
        }
    }
}
