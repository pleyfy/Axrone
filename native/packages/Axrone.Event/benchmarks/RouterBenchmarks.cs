namespace Axrone.Event.Benchmarks;

using Axrone.Event.Hub;
using BenchmarkDotNet.Attributes;

/// <summary>
/// Baselines for the paths the engine actually runs: immediate dispatch, transport publish and
/// hub fan-out. The previous benchmark suite measured only the task scheduler, which had no
/// production consumer — these numbers are the ones to track.
/// </summary>
[MemoryDiagnoser]
[SimpleJob]
public class RouterBenchmarks : IDisposable
{
    private EventRouter<int> _router = null!;
    private IEventSubscription _subscription = null!;
    private EventHub<int> _hub = null!;
    private int _sink;

    [GlobalSetup]
    public void Setup()
    {
        _router = new EventRouter<int>(RouterOptions.Default with
        {
            Capacity = 65536,
            DispatchBatchSize = 256,
            MaxListeners = 0,
        });

        _subscription = _router.Subscribe((envelope, _) => _sink += envelope.Payload);

        _hub = new EventHub<int>(new EventHubOptions { MaxSubscribers = 32 });
        _hub.Subscribe(value => _sink += value);
    }

    [GlobalCleanup]
    public void Cleanup() => Dispose();

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!disposing)
        {
            return;
        }

        _subscription?.Dispose();
        _router?.Dispose();
        _hub?.Dispose();
    }

    [Benchmark(Baseline = true)]
    public int PublishImmediate() => _router.PublishImmediate(1);

    [Benchmark]
    public void PublishTransport() => _router.Publish(1);

    [Benchmark]
    public bool TryPublishTransport() => _router.TryPublish(1);

    [Benchmark]
    public void HubPublish() => _hub.Publish(1);
}
