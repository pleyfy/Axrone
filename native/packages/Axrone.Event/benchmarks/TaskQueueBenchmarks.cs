namespace AxroneTaskQueueBenchmarks;

using Axrone.Event;
using BenchmarkDotNet.Attributes;
using System;

[MemoryDiagnoser]
public class TaskQueueBenchmarks : IDisposable
{
    private EventTaskScheduler? _scheduler;
    private Func<object?, CancellationToken, ValueTask<object?>>? _boundBody;
    private object? _state;

    [Params(1024)]
    public int QueueSize { get; set; }

    [GlobalSetup]
    public void Setup()
    {
        _scheduler = new EventTaskScheduler(
            new EventTaskSchedulerOptionsBuilder()
                .WithMaxQueueSize(QueueSize)
                .WithConcurrencyLimit(1)
                .WithTaskTimeout(TimeSpan.Zero)
                .Build());
        _boundBody = SyncBoundBody;
        _state = new object();

        for (int i = 0; i < 4096; i++)
        {
            _ = SubmitOne();
        }

        _scheduler.DrainAsync().AsTask().GetAwaiter().GetResult();
    }

    [GlobalCleanup]
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (disposing)
        {
            _scheduler?.Dispose();
        }
    }

    [Benchmark(OperationsPerInvoke = 512)]
    public int SubmitRunDrain()
    {
        int completed = 0;
        for (int i = 0; i < 512; i++)
        {
            EventTaskHandle handle = SubmitOne();
            completed += handle.State == EventTaskState.Completed ? 1 : 0;
        }

        _scheduler!.DrainAsync().AsTask().GetAwaiter().GetResult();
        return completed;
    }

    [Benchmark(OperationsPerInvoke = 512)]
    public int SubmitVoid()
    {
        int completed = 0;
        for (int i = 0; i < 512; i++)
        {
            EventTaskHandle handle = _scheduler!.SubmitVoid(SyncVoidBody);
            completed += handle.State == EventTaskState.Completed ? 1 : 0;
        }

        _scheduler!.DrainAsync().AsTask().GetAwaiter().GetResult();
        return completed;
    }

    private EventTaskHandle SubmitOne() => _scheduler!.SubmitBound(_boundBody!, _state);

    private static ValueTask<object?> SyncBoundBody(object? state, CancellationToken token) => ValueTask.FromResult<object?>(null);

    private static ValueTask SyncVoidBody(CancellationToken token) => default;
}
