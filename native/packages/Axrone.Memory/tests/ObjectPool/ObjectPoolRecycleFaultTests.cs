namespace Axrone.Memory.Tests.ObjectPool;

/// <summary>
/// A bounded-channel return that cannot enqueue must still account for the item: counters,
/// last exception, destroy callback, and live count all move instead of the item vanishing.
/// </summary>
public class ObjectPoolRecycleFaultTests
{
    private static PoolableHandler<List<int>> Handler(List<List<int>> disposed) =>
        new()
        {
            Factory = () => new List<int>(),
            OnDispose = item =>
            {
                lock (disposed)
                {
                    disposed.Add(item);
                }
            },
        };

    private static PoolConfiguration BoundedChannelConfiguration() =>
        new()
        {
            InitialCapacity = 0,
            MaximumCapacity = 16,
            ClearOnReturn = false,
            Strategy = PoolingStrategy.BoundedChannel,
            DiagnosticsLevel = DiagnosticsLevel.Full,
        };

    [Fact]
    public async Task ReturnAsync_WhenEnqueueFails_DestroysAndCountsTheItem()
    {
        var disposed = new List<List<int>>();
        using var pool = new ObjectPool<List<int>>(BoundedChannelConfiguration(), Handler(disposed));

        List<int> item = pool.Rent();
        pool.Count.Should().Be(1);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // The return path owns the wreckage: it must not rethrow and must not lose the item.
        await pool.ReturnAsync(item, cts.Token);

        var diagnostics = pool.GetDiagnostics();
        diagnostics.RecycleFailureCount.Should().Be(1);
        diagnostics.DisposeFailureCount.Should().Be(0);
        pool.GetMetrics().TotalDestroyed.Should().Be(1);
        diagnostics.LastException.Should().BeAssignableTo<OperationCanceledException>();
        disposed.Should().ContainSingle().Which.Should().BeSameAs(item);
        pool.Count.Should().Be(0, "a destroyed item must leave the live-object accounting");
    }

    [Fact]
    public async Task ReturnAsync_WhenEnqueueSucceeds_KeepsTheItemPooledWithoutFaults()
    {
        var disposed = new List<List<int>>();
        using var pool = new ObjectPool<List<int>>(BoundedChannelConfiguration(), Handler(disposed));

        List<int> item = pool.Rent();
        await pool.ReturnAsync(item);

        var diagnostics = pool.GetDiagnostics();
        diagnostics.RecycleFailureCount.Should().Be(0);
        pool.GetMetrics().TotalDestroyed.Should().Be(0);
        diagnostics.LastException.Should().BeNull();
        disposed.Should().BeEmpty();
        pool.Count.Should().Be(1);
        pool.Rent().Should().BeSameAs(item, "the returned item stays available for reuse");
    }

    [Fact]
    public async Task ReturnAsync_WhenDisposeAlsoFails_CountsBothFailures()
    {
        var disposed = new List<List<int>>();
        var handler = new PoolableHandler<List<int>>
        {
            Factory = () => new List<int>(),
            OnDispose = _ => throw new InvalidOperationException("dispose failed"),
        };

        using var pool = new ObjectPool<List<int>>(BoundedChannelConfiguration(), handler);

        List<int> item = pool.Rent();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await pool.ReturnAsync(item, cts.Token);

        var diagnostics = pool.GetDiagnostics();
        diagnostics.RecycleFailureCount.Should().Be(1);
        diagnostics.DisposeFailureCount.Should().Be(1);
        pool.GetMetrics().TotalDestroyed.Should().Be(1);
        disposed.Should().BeEmpty();
        pool.Count.Should().Be(0);
    }
}
