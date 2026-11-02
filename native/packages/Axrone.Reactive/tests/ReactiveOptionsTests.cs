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
        defaults.MemoryManagement.Enabled.Should().BeTrue();
        defaults.MemoryManagement.GcIntervalMs.Should().Be(60000);
        defaults.Replay.BufferSize.Should().Be(10);
        defaults.Concurrency.MaxConcurrent.Should().Be(10);

        var invalid = new SubjectOptions(
            maxObservers: 0,
            autoComplete: true,
            errorPropagation: false,
            memoryManagement: new SubjectMemoryOptions(true, -5, true),
            replay: new SubjectReplayOptions(true, 0),
            concurrency: new SubjectConcurrencyOptions(true, 0));
        SubjectOptions normalized = invalid.Normalize();
        normalized.MaxObservers.Should().Be(100);
        normalized.AutoComplete.Should().BeTrue();
        normalized.ErrorPropagation.Should().BeFalse();
        normalized.MemoryManagement.GcIntervalMs.Should().Be(60000);
        normalized.MemoryManagement.WeakReferences.Should().BeTrue();
        normalized.Replay.BufferSize.Should().Be(10);
        normalized.Concurrency.MaxConcurrent.Should().Be(10);

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

        var subjectBase = new SubjectOptions(
            maxObservers: 50,
            autoComplete: false,
            errorPropagation: true,
            memoryManagement: new SubjectMemoryOptions(true, 100, false),
            replay: new SubjectReplayOptions(true, 2),
            concurrency: new SubjectConcurrencyOptions(true, 4));
        var subjectOverride = new SubjectOptions(
            maxObservers: 75,
            autoComplete: true,
            errorPropagation: false,
            memoryManagement: new SubjectMemoryOptions(false, 0, true),
            replay: new SubjectReplayOptions(false, 0),
            concurrency: new SubjectConcurrencyOptions(false, 0));
        SubjectOptions mergedSubject = SubjectOptions.Merge(subjectBase, subjectOverride);
        mergedSubject.MaxObservers.Should().Be(75);
        mergedSubject.AutoComplete.Should().BeTrue();
        mergedSubject.ErrorPropagation.Should().BeFalse();
        mergedSubject.MemoryManagement.Enabled.Should().BeTrue();
        mergedSubject.MemoryManagement.GcIntervalMs.Should().Be(100);
        mergedSubject.MemoryManagement.WeakReferences.Should().BeTrue();
        mergedSubject.Replay.BufferSize.Should().Be(2);
        mergedSubject.Concurrency.MaxConcurrent.Should().Be(4);
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
        var max = new MaxObserversExceededError(2, 10, 10);
        max.MaxObservers.Should().Be(10);
        max.CurrentCount.Should().Be(10);
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
    public void MemoryManagerTracksAndCollects()
    {
        using var manager = new ObservableMemoryManager(true, gcIntervalMs: 0);
        object subject = new();
        object observer = new();
        int subjectId = manager.TrackSubject(subject, SubjectOptions.Default);
        int observerId = manager.TrackObserver(observer, ObservationOptions.Default);
        ObservableMemoryUsage usage = manager.GetMemoryUsage();
        usage.Subjects.Should().Be(1);
        usage.Observers.Should().Be(1);
        usage.TotalBytes.Should().BeGreaterThan(0);
        manager.Untrack(subjectId).Should().BeTrue();
        manager.GetMemoryUsage().Subjects.Should().Be(0);
        manager.Untrack(observerId).Should().BeTrue();
        manager.GetHealth().IsHealthy.Should().BeTrue();
    }

    [Fact]
    public void RegistryTracksObserversAndMemory()
    {
        using var registry = new ObservableRegistry();
        var subjectOptions = new SubjectOptions(maxObservers: 2);
        int subjectId = registry.RegisterSubject(new object(), subjectOptions);
        int first = registry.RegisterObserver(subjectId, new object());
        int second = registry.RegisterObserver(subjectId, new object());
        registry.ActiveObserverCount.Should().Be(2);
        registry.GetObserversForSubject(subjectId).Should().Be(2);
        registry.RecordExecution(first).Should().BeTrue();
        registry.GetExecutionCount(first).Should().Be(1);
        registry.GetMemoryUsage().TotalBytes.Should().BeGreaterThan(0);
        FluentActions.Invoking(() => registry.RegisterObserver(subjectId, new object()))
            .Should().Throw<MaxObserversExceededError>();
        registry.DeactivateObserver(first).Should().BeTrue();
        registry.ActiveObserverCount.Should().Be(1);
        registry.Validate().InactiveObservers.Should().Be(1);
        registry.UnregisterObserver(first).Should().BeTrue();
        registry.ActiveObserverCount.Should().Be(1);
        registry.Validate().IsHealthy.Should().BeTrue();
        registry.UnregisterObserverByReference(registry.GetObserver(second)).Should().BeTrue();
        registry.UnregisterSubject(subjectId).Should().BeTrue();
        registry.SubjectCount.Should().Be(0);
        registry.Dispose();
        FluentActions.Invoking(() => registry.RegisterSubject(new object())).Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void ConfigIsInstanceScopedAndProbeRecognizesSubjects()
    {
        ObservableConfig config = ObservableConfig.Default;
        config.ObserverOptions.Should().Be(ObservationOptions.Default);
        var custom = config.WithObserverOptions(new ObservationOptions(ObservationPriority.Low));
        custom.ObserverOptions.Priority.Should().Be(ObservationPriority.Low);
        ObservableConfig.Default.ObserverOptions.Priority.Should().Be(ObservationPriority.Normal);

        var subject = new Subject<int>();
        ObservableProbe.IsObservable(subject).Should().BeTrue();
        ObservableProbe.IsObservable("not observable").Should().BeFalse();
        ObservableProbe.IsObservableSubject<int>(subject).Should().BeTrue();
        using var behavior = new BehaviorSubject<int>(0);
        ObservableProbe.IsObservableSubject<int>(behavior).Should().BeTrue();
        ObservableProbe.TryGetObservable<int>(subject, out IObservable<int>? observable).Should().BeTrue();
        observable.Should().BeSameAs(subject);
        subject.Dispose();
    }
}
