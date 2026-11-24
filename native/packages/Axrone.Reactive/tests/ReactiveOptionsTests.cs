namespace Axrone.Reactive.Tests;

using FluentAssertions;
using Xunit;

public sealed class ReactiveOptionsTests
{
    [Fact]
    public void NormalizesAndMergesOptions()
    {
        SubjectOptions defaults = SubjectOptions.Default;
        defaults.MaxObservers.Should().Be(100);
        defaults.AutoComplete.Should().BeFalse();
        defaults.ErrorPropagation.Should().BeTrue();

        SubjectOptions normalized = new SubjectOptions(maxObservers: 0, autoComplete: true, errorPropagation: false).Normalize();
        normalized.MaxObservers.Should().Be(100);
        normalized.AutoComplete.Should().BeTrue();
        normalized.ErrorPropagation.Should().BeFalse();

        ObservationOptions observerDefaults = ObservationOptions.Default;
        observerDefaults.Priority.Should().Be(ObservationPriority.Normal);
        observerDefaults.Buffering.MaxSize.Should().Be(100);
        observerDefaults.Buffering.FlushIntervalMs.Should().Be(1000);
        observerDefaults.Replay.BufferSize.Should().Be(10);

        var invalidObserver = new ObservationOptions(
            (ObservationPriority)99,
            false,
            -5,
            -9,
            new ObservationBufferOptions(true, 0, 0),
            new ObservationReplayOptions(true, 0),
            false,
            (ObservationErrorHandling)99);
        ObservationOptions observerNormalized = invalidObserver.Normalize();
        observerNormalized.Priority.Should().Be(ObservationPriority.Normal);
        observerNormalized.DebounceMs.Should().Be(0);
        observerNormalized.ThrottleMs.Should().Be(0);
        observerNormalized.Buffering.MaxSize.Should().Be(100);
        observerNormalized.Buffering.FlushIntervalMs.Should().Be(1000);
        observerNormalized.Replay.BufferSize.Should().Be(10);
        observerNormalized.ErrorHandling.Should().Be(ObservationErrorHandling.Throw);

        var baseOptions = new ObservationOptions(
            ObservationPriority.Low,
            false,
            5,
            0,
            new ObservationBufferOptions(true, 50, 100),
            new ObservationReplayOptions(true, 3));
        var overrides = new ObservationOptions(
            ObservationPriority.Normal,
            false,
            0,
            7,
            new ObservationBufferOptions(false, 75, 0),
            new ObservationReplayOptions(false, 5));
        ObservationOptions merged = ObservationOptions.Merge(baseOptions, overrides);
        merged.DebounceMs.Should().Be(5);
        merged.ThrottleMs.Should().Be(7);
        merged.Buffering.Enabled.Should().BeTrue();
        merged.Buffering.MaxSize.Should().Be(75);
        merged.Buffering.FlushIntervalMs.Should().Be(100);
        merged.Replay.Enabled.Should().BeTrue();
        merged.Replay.BufferSize.Should().Be(5);

        var subjectBase = new SubjectOptions(maxObservers: 50, autoComplete: false, errorPropagation: true);
        var subjectOverride = new SubjectOptions(maxObservers: 75, autoComplete: true, errorPropagation: false);
        SubjectOptions mergedSubject = SubjectOptions.Merge(subjectBase, subjectOverride);
        mergedSubject.MaxObservers.Should().Be(75);
        mergedSubject.AutoComplete.Should().BeTrue();
        mergedSubject.ErrorPropagation.Should().BeFalse();
    }

    [Fact]
    public void SubjectOptionsNormalizeTreatsDefaultAsDefault()
    {
        default(SubjectOptions).Normalize().Should().Be(SubjectOptions.Default);
        new SubjectOptions(maxObservers: 0).Normalize().Should().Be(SubjectOptions.Default);

        using var subject = new Subject<int>(new SubjectOptions(maxObservers: 0, autoComplete: true, errorPropagation: false));
        using var failing = subject.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));

        FluentActions.Invoking(() => subject.OnNext(1)).Should().NotThrow();
        subject.ObserverFaultCount.Should().Be(1);
    }

    [Fact]
    public void ConfigNormalizesSubjectOptions()
    {
        var config = new ObservableConfig(
            subjectOptions: new SubjectOptions(maxObservers: 0, autoComplete: true, errorPropagation: false));
        config.SubjectOptions.MaxObservers.Should().Be(100);
        config.SubjectOptions.AutoComplete.Should().BeTrue();
        config.SubjectOptions.ErrorPropagation.Should().BeFalse();
    }

    [Fact]
    public void SubjectEnforcesMaxObserversAndErrorHandling()
    {
        using var subject = new Subject<int>(new SubjectOptions(maxObservers: 1, errorPropagation: false));
        var first = new TestObserver<int>();
        using var firstSubscription = subject.Subscribe(first);
        FluentActions.Invoking(() => subject.Subscribe(new TestObserver<int>()))
            .Should().Throw<MaxObserversExceededError>()
            .Which.MaxObservers.Should().Be(1);

        FluentActions.Invoking(() => subject.Subscribe(null!)).Should().Throw<ArgumentNullException>();
        subject.OnNext(1);
        first.Values.Should().Equal(1);
        subject.OnCompleted();
        first.Completed.Should().BeTrue();
        subject.SubscriberCount.Should().Be(0);

        using var swallowing = new Subject<int>(new SubjectOptions(errorPropagation: false));
        using var throwingSubscription = swallowing.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));
        FluentActions.Invoking(() => swallowing.OnNext(1)).Should().NotThrow();
    }

    [Fact]
    public void SubjectCountsSwallowedObserverFaultsAndKeepsDelivering()
    {
        using var subject = new Subject<int>(new SubjectOptions(errorPropagation: false));
        int received = 0;
        using var failing = subject.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));
        using var healthy = subject.Subscribe(new ActionObserver<int>(_ => received++));

        subject.OnNext(1);
        subject.OnNext(2);

        subject.ObserverFaultCount.Should().Be(2);
        received.Should().Be(2);
    }

    [Fact]
    public void SubjectPropagatesObserverFaultsByDefault()
    {
        using var subject = new Subject<int>();
        using var failing = subject.Subscribe(new ActionObserver<int>(_ =>
            throw new InvalidOperationException("observer")));

        FluentActions.Invoking(() => subject.OnNext(1))
            .Should().Throw<InvalidOperationException>()
            .WithMessage("observer");
        subject.ObserverFaultCount.Should().Be(0);
    }

    [Fact]
    public void AutoCompleteDisposesSubjectAfterCompletion()
    {
        var subject = new Subject<int>(new SubjectOptions(autoComplete: true));
        var observer = new TestObserver<int>();
        using var subscription = subject.Subscribe(observer);
        subject.OnCompleted();
        observer.Completed.Should().BeTrue();
        subject.IsTerminated.Should().BeTrue();
        var late = new TestObserver<int>();
        using var lateSubscription = subject.Subscribe(late);
        late.Completed.Should().BeTrue();
    }

    [Fact]
    public void NormalizationAndMergeDoNotAllocateWhenWarm()
    {
        ObservationOptions options = ObservationOptions.Default;
        for (int i = 0; i < 32; i++)
        {
            _ = options.Normalize();
            _ = ObservationOptions.Merge(options, options);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 256; i++)
        {
            _ = options.Normalize();
            _ = ObservationOptions.Merge(options, options);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0);
    }

    [Fact]
    public void ExposesTypedErrorTaxonomy()
    {
        var inner = new InvalidOperationException("inner");
        new ObserverNotFoundError(4).Code.Should().Be("OBSERVER_ERROR");
        new SubjectCompletedError(3).SubjectId.Should().Be(3);
        new SubjectDisposedError(3).Code.Should().Be("SUBJECT_ERROR");
        var max = new MaxObserversExceededError(10, 10);
        max.MaxObservers.Should().Be(10);
        max.CurrentCount.Should().Be(10);
        max.Message.Should().Contain("Max: 10").And.Contain("Current: 10");
        var execution = new ObserverExecutionError(7, "payload", inner);
        execution.ObserverId.Should().Be(7);
        execution.OriginalError.Should().BeSameAs(inner);
        execution.NotificationData.Should().Be("payload");
        new ValidationError(42).InvalidData.Should().Be(42);
        var concurrency = new ConcurrencyLimitError(1, 4, 5);
        concurrency.Limit.Should().Be(4);
        concurrency.Current.Should().Be(5);
        new FilterError(inner).OriginalError.Should().BeSameAs(inner);
        new TransformError("input", inner).InputData.Should().Be("input");
        new ObserverError().Code.Should().Be("OBSERVER_ERROR");
        new SubjectError(5).SubjectId.Should().Be(5);
        new ObserverExecutionError(1, null, inner).Timestamp.Should().BeGreaterThan(0);
    }

    [Fact]
    public void ConfigIsInstanceScoped()
    {
        ObservableConfig config = ObservableConfig.Default;
        config.ObserverOptions.Should().Be(ObservationOptions.Default);
        var custom = config.WithObserverOptions(new ObservationOptions(ObservationPriority.Low));
        custom.ObserverOptions.Priority.Should().Be(ObservationPriority.Low);
        ObservableConfig.Default.ObserverOptions.Priority.Should().Be(ObservationPriority.Normal);
    }
}
