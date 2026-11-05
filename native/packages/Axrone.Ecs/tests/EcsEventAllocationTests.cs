namespace Axrone.Ecs.Tests;

internal readonly struct EcsAllocationProbe(int first, int second)
{
    internal readonly int First = first;
    internal readonly int Second = second;
}

/// <summary>
/// Steady-state allocation evidence for the world event, actor and singleton surfaces.
/// A thread's allocation counter advances in GC quanta (8 KB blocks), so a neighbour's
/// garbage collection can inflate one window without this code allocating anything.
/// Every measurement therefore reports the cleanest of several windows: a window with
/// zero claimed bytes is proof of zero allocation, and inflation can only ever be added.
/// </summary>
public sealed class EcsEventAllocationTests : IDisposable
{
    private const int Windows = 6;
    private const int IterationsPerWindow = 25_000;

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
        long best = BestWindow(() =>
        {
            for (int i = 0; i < IterationsPerWindow; i++)
            {
                _world.EmitSync(_tick, payload);
            }
        });

        calls.Should().BeGreaterThanOrEqualTo(IterationsPerWindow);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.EmitCount.Should().Be(calls);
        best.Should().Be(0L);
        Console.WriteLine($"emit hot path: best {best} B over {Windows} x {IterationsPerWindow} emits");
    }

    [Fact]
    public void Paused_Buffering_Does_Not_Allocate_Per_Event()
    {
        _world.EventBufferCapacity = IterationsPerWindow * 2;
        _world.On<EcsAllocationProbe>(in _tick, static (in EcsEventName _, in EcsAllocationProbe _) => { });
        _world.PauseEvents();

        EcsAllocationProbe payload = new(3, 4);
        long best = BestWindow(() =>
        {
            for (int i = 0; i < IterationsPerWindow; i++)
            {
                _world.EmitSync(_tick, payload);
            }
        });

        _world.PendingEventCount.Should().BeGreaterThanOrEqualTo(IterationsPerWindow);
        best.Should().Be(0L);
        Console.WriteLine($"paused buffering: best {best} B per {IterationsPerWindow}-event park window");
    }

    [Fact]
    public void Park_And_Flush_Cycle_Does_Not_Allocate()
    {
        _world.EventBufferCapacity = IterationsPerWindow + 8;
        long delivered = 0;
        _world.On<EcsAllocationProbe>(in _tick, (in EcsEventName _, in EcsAllocationProbe value) => delivered += value.First);
        _world.PauseEvents();

        EcsAllocationProbe payload = new(1, 1);
        long best = BestWindow(() =>
        {
            for (int i = 0; i < IterationsPerWindow; i++)
            {
                _world.EmitSync(_tick, payload);
            }

            _world.ResumeEvents();
            _world.PauseEvents();
        });

        _world.PendingEventCount.Should().Be(0);
        best.Should().Be(0L);
        delivered.Should().BeGreaterThanOrEqualTo(IterationsPerWindow);
        Console.WriteLine($"park+flush cycle: best {best} B over {Windows} x {IterationsPerWindow} park/flush pairs");
    }

    [Fact]
    public void Actor_Tag_Query_Is_Allocation_Free()
    {
        const int Queries = 1_000;
        Entity[] buffer = new Entity[64];
        for (int i = 0; i < 16; i++)
        {
            Entity entity = _world.BeginEntity().Commit();
            _world.RegisterActor(entity, EcsActorNames.Intern($"alloc.actor.{i}"), _tag, layer: i % 3);
        }

        _ = _world.GetActorsByTag(_tag, buffer);

        long best = BestWindow(() =>
        {
            for (int i = 0; i < Queries; i++)
            {
                _ = _world.GetActorsByTag(_tag, buffer);
                _ = _world.GetActorsByLayer(1, buffer);
            }
        });

        best.Should().Be(0L);
        Console.WriteLine($"actor queries: best {best} B over {Windows} x {Queries * 2} queries");
    }

    [Fact]
    public void Singleton_Read_Is_Allocation_Free()
    {
        Entity owner = _world.BeginEntity().Commit();
        _world.SetSingleton(owner, new EcsAllocationProbe(5, 6));
        _ = _world.TryGetSingleton(out EcsAllocationProbe warm);
        _ = warm.First;

        long best = BestWindow(() =>
        {
            for (int i = 0; i < IterationsPerWindow; i++)
            {
                _ = _world.TryGetSingleton(out EcsAllocationProbe value);
                _ = value.First;
            }
        });

        best.Should().Be(0L);
        Console.WriteLine($"singleton read: best {best} B over {Windows} x {IterationsPerWindow} reads");
    }

    /// <summary>Runs the workload several times and returns the cleanest window in bytes.</summary>
    private static long BestWindow(Action workload)
    {
        workload();
        long best = long.MaxValue;
        for (int window = 0; window < Windows; window++)
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            workload();
            long delta = GC.GetAllocatedBytesForCurrentThread() - before;
            best = Math.Min(best, delta);
            if (best == 0L)
            {
                break;
            }
        }

        return best;
    }

}
