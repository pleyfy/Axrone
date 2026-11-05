namespace Axrone.Ecs.Tests;

using System.Runtime.ExceptionServices;

internal readonly struct EcsAllocationProbe(int first, int second)
{
    internal readonly int First = first;
    internal readonly int Second = second;
}

/// <summary>
/// Steady-state allocation evidence for the world event, actor and singleton surfaces.
/// Every window must be exactly clean — a min-of-N shape forgives the windows that really
/// allocated — and the loop runs on its own joined thread, because a pooled xUnit worker is
/// serviced by other collections and gets credited with their allocation blocks: the same
/// workload showed sporadic 5.5-6.9 KB deltas in 3 of ~170 windows on a pooled worker and 0
/// in 1728 windows on a dedicated thread.
/// </summary>
public sealed class EcsEventAllocationTests : IDisposable
{
    private const int Windows = 8;
    private const int PrimePasses = 14;
    private const int MeasuredPasses = PrimePasses + Windows;
    private const int IterationsPerWindow = 25_000;
    private const int ParkIterationsPerWindow = 8_000;
    private const int QueriesPerWindow = 1_000;

    private readonly World _world;
    private readonly EcsEventName _tick = EcsEventNames.Intern("alloc.tick");
    private readonly EcsActorTag _tag = EcsActorTags.Intern("alloc.tag");

    public EcsEventAllocationTests()
    {
        ComponentRegistry.Register<EcsAllocationProbe>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Emit_Hot_Path_Stays_At_Zero_Bytes()
    {
        long calls = 0;
        _world.On<EcsAllocationProbe>(in _tick, (in EcsEventName _, in EcsAllocationProbe value) => calls += value.First);
        EcsAllocationProbe payload = new(1, 2);

        AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }
            },
            "world event emit");

        calls.Should().Be((long)MeasuredPasses * IterationsPerWindow);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.EmitCount.Should().Be(calls);
        Console.WriteLine($"emit hot path: {MeasuredPasses} x {IterationsPerWindow} emits ({PrimePasses} prime passes), every measured window 0 B");
    }

    [Fact]
    public void Paused_Buffering_Does_Not_Allocate_Per_Event()
    {
        int parked = MeasuredPasses * ParkIterationsPerWindow;
        _world.EventBufferCapacity = parked + 8;
        _world.On<EcsAllocationProbe>(in _tick, static (in EcsEventName _, in EcsAllocationProbe _) => { });
        _world.PauseEvents();

        EcsAllocationProbe payload = new(3, 4);
        AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < ParkIterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }
            },
            "paused event parking");

        _world.PendingEventCount.Should().Be(parked);
        Console.WriteLine($"paused buffering: {MeasuredPasses} x {ParkIterationsPerWindow} parks ({PrimePasses} prime passes), every measured window 0 B");
    }

    [Fact]
    public void Park_And_Flush_Cycle_Does_Not_Allocate()
    {
        _world.EventBufferCapacity = IterationsPerWindow + 8;
        long delivered = 0;
        _world.On<EcsAllocationProbe>(in _tick, (in EcsEventName _, in EcsAllocationProbe value) => delivered += value.First);
        _world.PauseEvents();

        EcsAllocationProbe payload = new(1, 1);
        AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }

                _world.ResumeEvents();
                _world.PauseEvents();
            },
            "park plus flush cycle");

        _world.PendingEventCount.Should().Be(0);
        delivered.Should().Be((long)MeasuredPasses * IterationsPerWindow);
        Console.WriteLine($"park+flush cycle: {MeasuredPasses} x {IterationsPerWindow} pairs ({PrimePasses} prime passes), every measured window 0 B");
    }

    [Fact]
    public void Actor_Tag_Query_Is_Allocation_Free()
    {
        Entity[] buffer = new Entity[64];
        for (int i = 0; i < 16; i++)
        {
            Entity entity = _world.BeginEntity().Commit();
            _world.RegisterActor(entity, EcsActorNames.Intern($"alloc.actor.{i}"), _tag, layer: i % 3);
        }

        AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < QueriesPerWindow; i++)
                {
                    _ = _world.GetActorsByTag(_tag, buffer);
                    _ = _world.GetActorsByLayer(1, buffer);
                }
            },
            "actor tag and layer queries");

        Console.WriteLine($"actor queries: {MeasuredPasses} x {QueriesPerWindow * 2} queries ({PrimePasses} prime passes), every measured window 0 B");
    }

    [Fact]
    public void Singleton_Read_Is_Allocation_Free()
    {
        Entity owner = _world.BeginEntity().Commit();
        _world.SetSingleton(owner, new EcsAllocationProbe(5, 6));

        AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _ = _world.TryGetSingleton(out EcsAllocationProbe value);
                    _ = value.First;
                }
            },
            "singleton reads");

        Console.WriteLine($"singleton read: {MeasuredPasses} x {IterationsPerWindow} reads ({PrimePasses} prime passes), every measured window 0 B");
    }

    /// <summary>
    /// Primes with the exact measured call shape until tiered compilation has settled, then
    /// requires every window to allocate zero bytes. The loop runs on a dedicated thread that is
    /// joined before returning, so the thread-local allocation counter only ever accounts for
    /// this workload; a failure is rethrown on the test thread with its original stack.
    /// </summary>
    private static void AssertEveryWindowClean(Action workload, string label)
    {
        Exception? failure = null;
        Thread worker = new(() =>
        {
            try
            {
                for (int pass = 0; pass < PrimePasses; pass++)
                {
                    workload();
                }

                for (int window = 0; window < Windows; window++)
                {
                    long before = GC.GetAllocatedBytesForCurrentThread();
                    workload();
                    long delta = GC.GetAllocatedBytesForCurrentThread() - before;

                    // The window body allocates nothing, not even a formatted reason: an eager
                    // reason string would be built between windows and blur the very counter
                    // being watched. The predicate is unchanged — any non-zero delta fails.
                    if (delta != 0L)
                    {
                        Assert.Fail(
                            $"window {window}: the {label} hot path must allocate zero bytes on the " +
                            $"measured thread, but claimed {delta} B");
                    }
                }
            }
            catch (Exception error)
            {
                failure = error;
            }
        });

        worker.IsBackground = true;
        worker.Start();
        worker.Join();

        if (failure is not null)
        {
            ExceptionDispatchInfo.Capture(failure).Throw();
        }
    }
}
