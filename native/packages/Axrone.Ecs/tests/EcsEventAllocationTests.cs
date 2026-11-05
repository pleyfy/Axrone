namespace Axrone.Ecs.Tests;

internal readonly struct EcsAllocationProbe(int first, int second)
{
    internal readonly int First = first;
    internal readonly int Second = second;
}

/// <summary>
/// Steady-state allocation evidence for the world event, actor and singleton surfaces, gated by
/// <see cref="EcsAllocationHarness"/>: every measured window must claim exactly zero bytes. Each
/// gate also asserts the workload's observable effect, so a green verdict cannot come from a loop
/// that quietly stopped doing the production work.
/// </summary>
public sealed class EcsEventAllocationTests : IDisposable
{
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

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "world event emit",
            [new EcsGatePhase("single-emit", () => _ = _world.EmitSync(_tick, payload))]);

        long expected = (long)outcome.TotalInvocations * IterationsPerWindow;
        calls.Should().Be(expected);
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.EmitCount.Should().Be(expected);
        metrics.InvocationCount.Should().Be(expected);
        Console.WriteLine($"emit hot path: {outcome.PrimePasses} prime + {EcsAllocationHarness.Windows} gated windows x {IterationsPerWindow} emits, each 0 B");
    }

    [Fact]
    public void Paused_Buffering_Does_Not_Allocate_Per_Event()
    {
        _world.EventBufferCapacity = ParkIterationsPerWindow + 8;
        _world.On<EcsAllocationProbe>(in _tick, static (in EcsEventName _, in EcsAllocationProbe _) => { });
        _world.PauseEvents();

        EcsAllocationProbe payload = new(3, 4);
        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < ParkIterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }
            },

            // The ring is emptied between windows, outside the measurement, so the gate parks
            // into a rolling buffer that wraps instead of growing one giant ring.
            betweenWindows: () =>
            {
                _ = _world.ResumeEvents();
                _world.PauseEvents();
            },
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "paused event parking",
            [new EcsGatePhase("park-one", () => _ = _world.EmitSync(_tick, payload))]);

        long expected = (long)outcome.TotalInvocations * ParkIterationsPerWindow;
        _world.TryGetEventMetrics(_tick, out EcsEventMetrics metrics).Should().BeTrue();
        metrics.BufferedCount.Should().Be(expected);
        metrics.InvocationCount.Should().Be(expected);
        metrics.DroppedCount.Should().Be(0);
        metrics.UndeliveredCount.Should().Be(0);
        Console.WriteLine($"paused buffering: {outcome.PrimePasses} prime + {EcsAllocationHarness.Windows} gated windows x {ParkIterationsPerWindow} parks, each 0 B");
    }

    [Fact]
    public void Park_And_Flush_Cycle_Does_Not_Allocate()
    {
        _world.EventBufferCapacity = IterationsPerWindow + 8;
        long delivered = 0;
        _world.On<EcsAllocationProbe>(in _tick, (in EcsEventName _, in EcsAllocationProbe value) => delivered += value.First);
        _world.PauseEvents();

        EcsAllocationProbe payload = new(1, 1);
        EcsAllocationHarness.Outcome flushed = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _world.EmitSync(_tick, payload);
                }

                _world.ResumeEvents();
                _world.PauseEvents();
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "park plus flush cycle",
            [
                new EcsGatePhase("park-batch-1000", () =>
                {
                    for (int i = 0; i < 1_000; i++)
                    {
                        _ = _world.EmitSync(_tick, payload);
                    }
                }),
                new EcsGatePhase("flush", () =>
                {
                    _ = _world.ResumeEvents();
                    _world.PauseEvents();
                }),
            ]);

        _world.PendingEventCount.Should().Be(0);
        delivered.Should().Be((long)flushed.TotalInvocations * IterationsPerWindow);
        Console.WriteLine($"park+flush cycle: {flushed.PrimePasses} prime + {EcsAllocationHarness.Windows} gated windows x {IterationsPerWindow} pairs, each 0 B");
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

        EcsGatePhase[] phases =
        [
            new EcsGatePhase("tag-query", () => _ = _world.GetActorsByTag(_tag, buffer)),
            new EcsGatePhase("layer-query", () => _ = _world.GetActorsByLayer(1, buffer)),
        ];

        EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < QueriesPerWindow; i++)
                {
                    _ = _world.GetActorsByTag(_tag, buffer);
                    _ = _world.GetActorsByLayer(1, buffer);
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "actor tag and layer queries",
            phases);

        // The gate only means something if the loops still found the same actors.
        _world.GetActorsByTag(_tag, buffer).Should().Be(16);
        _world.GetActorsByLayer(1, buffer).Should().Be(5);
        buffer[0].Should().NotBe(Entity.Null);
        Console.WriteLine($"actor queries: {EcsAllocationHarness.Windows} measured windows x {QueriesPerWindow * 2} queries, each 0 B");
    }

    [Fact]
    public void Singleton_Read_Is_Allocation_Free()
    {
        Entity owner = _world.BeginEntity().Commit();
        _world.SetSingleton(owner, new EcsAllocationProbe(5, 6));

        EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int i = 0; i < IterationsPerWindow; i++)
                {
                    _ = _world.TryGetSingleton(out EcsAllocationProbe value);
                    _ = value.First;
                }
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "singleton reads",
            [new EcsGatePhase("singleton-read", () => _ = _world.TryGetSingleton(out EcsAllocationProbe _))]);

        _world.TryGetSingleton(out EcsAllocationProbe current).Should().BeTrue();
        current.First.Should().Be(5);
        current.Second.Should().Be(6);
        Console.WriteLine($"singleton read: {EcsAllocationHarness.Windows} measured windows x {IterationsPerWindow} reads, each 0 B");
    }
}
